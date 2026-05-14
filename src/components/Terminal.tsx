"use client";

// xterm.js-based terminal pane.
//
// Lifecycle:
//   1. Mount → instantiate xterm, attach to DOM
//   2. window.sshTerm.open({ sessionId, cols, rows }) → handle from main
//   3. Pipe pty data → xterm; pipe xterm input → pty
//   4. On unmount or exit → close handle, dispose xterm
//
// Performance notes:
//   - Uses the canvas addon. WebGL exists but is overkill for typical loads
//     and adds GPU memory pressure when many tabs are open.
//   - We re-attach `fit` on container resize via ResizeObserver so the pty
//     stays in lockstep with the visible window.

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { Loader2, AlertCircle, Terminal as TerminalIcon, X, RotateCw } from "lucide-react";

const AUTO_FILL_KEY = "ssh-manager-autofill-enabled";
const COPY_ON_SELECT_KEY = "ssh-manager-copy-on-select";

function getAutoFillSetting(): boolean {
  try {
    const v = localStorage.getItem(AUTO_FILL_KEY);
    return v === null ? true : v === "true";
  } catch { return true; }
}

function getCopyOnSelectSetting(): boolean {
  try {
    const v = localStorage.getItem(COPY_ON_SELECT_KEY);
    return v === null ? true : v === "true";
  } catch { return true; }
}

interface SavedSessionTarget {
  kind: "session";
  sessionId: number;
}
interface AdHocTarget {
  kind: "ad-hoc";
  host: string;
  profileId: number;
  port?: number;
  jumpHost?: string;
}
export type TerminalTarget = SavedSessionTarget | AdHocTarget;

interface Props {
  /** What to spawn — saved session or ad-hoc host. */
  target: TerminalTarget;
  /** Display label for the header. */
  label: string;
  /** Called when the terminal exits (for parent to clean up tab/pane). */
  onExit?: (info: { exitCode: number; signal: number | null }) => void;
  /** Called when the user closes the pane (e.g. clicking X). */
  onClose?: () => void;
}

type ConnState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "connected"; handle: number; display: string }
  | { phase: "exited"; exitCode: number; signal: number | null }
  | { phase: "error"; error: string };

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

export default function Terminal({ target, label, onExit, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const handleRef = useRef<number | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  // Imperative reconnect handle, wired inside the main effect so the
  // Reconnect button can re-spawn the pty without tearing down the xterm
  // instance (and therefore without losing scrollback).
  const reconnectRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<ConnState>({ phase: "idle" });

  useEffect(() => {
    if (!containerRef.current) return;

    // Bridge availability check — when running in plain browser dev mode
    // (no Electron), the API is unavailable.
    const bridge = typeof window !== "undefined" ? window.sshTerm : undefined;
    if (!bridge) {
      setState({ phase: "error", error: "The built-in terminal only works inside the Electron app." });
      return;
    }

    const term = new XTerm({
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#22d3ee",
        cursorAccent: "#0d1117",
        selectionBackground: "rgba(34,211,238,0.25)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    // Local-only keyboard shortcuts intercepted BEFORE xterm forwards the
    // key to the pty. Return false to swallow; return true to pass through.
    //
    //   Cmd+A   (Mac) / Ctrl+Shift+A (other) → select-all + copy scrollback
    //   Cmd+K   (Mac) / Ctrl+Shift+K (other) → clear scrollback buffer
    //
    // Plain Ctrl+A / Ctrl+K are left alone — the shell uses them as
    // beginning-of-line and kill-to-end-of-line, so stealing them would
    // break standard line editing.
    const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const key = e.key.toLowerCase();
      const macCombo = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const otherCombo = e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;
      const combo = isMac ? macCombo : otherCombo;
      if (!combo) return true;

      if (key === "a") {
        try {
          term.selectAll();
          const sel = term.getSelection();
          if (sel) void navigator.clipboard.writeText(sel);
        } catch { /* ignore */ }
        return false;
      }
      if (key === "k") {
        try { term.clear(); } catch { /* ignore */ }
        return false;
      }
      return true;
    });
    // Renderer ladder: WebGL → Canvas → DOM.
    //
    // xterm.js 5.x deprecated CanvasAddon in favour of WebglAddon, which is
    // both faster and free of the wrap-boundary redraw artifacts CanvasAddon
    // is known for (the "stray char at column 1 after a wrapped prompt"
    // glitch users see on long network-device prompts). WebGL is rock-solid
    // on Apple Silicon Metal and modern Windows/Linux drivers, but can lose
    // its GPU context under low-power / display-sleep — we handle that by
    // disposing the addon on `onContextLoss` so xterm falls back to its DOM
    // pipeline for subsequent renders rather than freezing on a stale
    // framebuffer.
    //
    // If WebGL fails to initialise at all (e.g. headless / WebGL disabled
    // in some embedded contexts), we try CanvasAddon, then leave DOM.
    let webglUsed = false;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try { webgl.dispose(); } catch { /* ignore */ }
      });
      term.loadAddon(webgl);
      webglUsed = true;
    } catch (e) {
      console.warn("WebglAddon unavailable, trying CanvasAddon:", e);
    }
    if (!webglUsed) {
      try { term.loadAddon(new CanvasAddon()); }
      catch (e) { console.warn("CanvasAddon also failed, falling back to DOM renderer:", e); }
    }
    xtermRef.current = term;
    fitRef.current = fit;

    // Copy-on-select: when the user releases the mouse and there's a
    // non-empty selection, write it to the clipboard. Mouseup is the right
    // anchor (not onSelectionChange) so we don't pound the clipboard while
    // the user is still dragging. Cmd+C still works because the selection
    // remains until the user clicks elsewhere.
    const onMouseUp = () => {
      if (!getCopyOnSelectSetting()) return;
      const sel = term.getSelection();
      if (!sel) return;
      try {
        // navigator.clipboard.writeText is async; ignore failures (e.g. when
        // the renderer doesn't have focus on macOS — Cmd+C still works).
        void navigator.clipboard.writeText(sel);
      } catch { /* ignore */ }
    };
    containerRef.current.addEventListener("mouseup", onMouseUp);

    // Track the latest cols/rows that xterm believes the grid is.
    //
    // Subtle: web fonts (JetBrains Mono) load asynchronously. If the font
    // isn't ready when we first call `fit.fit()`, xterm computes cell
    // dimensions from the fallback font. Once the real font loads, the cell
    // width changes and xterm fires `onResize` with corrected cols. We MUST
    // capture that even before the pty handle exists, then re-sync the pty
    // once we have a handle — otherwise the shell believes the terminal is
    // narrower than xterm renders and `up-arrow` history recall paints over
    // stale content from the old wrap boundary.
    let latestCols = 80;
    let latestRows = 24;
    let ptyHandle: number | null = null;
    const earlyOnResize = term.onResize(({ cols: c, rows: r }) => {
      latestCols = c;
      latestRows = r;
      // Once the pty exists, propagate every resize. Before it exists,
      // we just hold the latest values for the initial spawn.
      if (ptyHandle != null) {
        bridge.resize(ptyHandle, c, r).catch(() => { /* ignore */ });
      }
    });
    // Push cleanup immediately so unmount during the async font/spawn dance
    // still tears the listener down.
    unsubsRef.current.push(() => earlyOnResize.dispose());

    setState({ phase: "connecting" });
    let aborted = false;

    const fontsReady: Promise<unknown> = (typeof document !== "undefined" && document.fonts && typeof document.fonts.ready?.then === "function")
      ? document.fonts.ready.catch(() => undefined)
      : Promise.resolve();

    // Per-connection cleanups (data/exit/input handlers). Reset on each
    // reconnect — the earlyOnResize listener above lives for the whole
    // xterm lifetime and is NOT in here.
    const connectHandlers: Array<() => void> = [];
    function disposeConnectHandlers() {
      for (const off of connectHandlers) {
        try { off(); } catch { /* ignore */ }
      }
      connectHandlers.length = 0;
    }

    async function doConnect(isReconnect: boolean): Promise<void> {
      if (aborted) return;
      // Re-narrow inside the async closure — TS loses the outer narrow across awaits.
      if (!bridge) return;

      // Tear down any handlers from the previous (now-dead) pty.
      disposeConnectHandlers();
      const oldHandle = ptyHandle;
      ptyHandle = null;
      handleRef.current = null;
      if (oldHandle != null) {
        bridge.close(oldHandle).catch(() => { /* may already be dead */ });
      }

      if (isReconnect) {
        try { term.write("\r\n\x1b[2m── reconnecting ──\x1b[0m\r\n"); } catch { /* ignore */ }
      }
      setState({ phase: "connecting" });

      await fontsReady;
      if (aborted) return;
      try { fit.fit(); } catch { /* ignore */ }

      const disableAutoFill = !getAutoFillSetting();
      const openCall = target.kind === "session"
        ? bridge.open({ sessionId: target.sessionId, cols: latestCols, rows: latestRows, disableAutoFill })
        : bridge.openAdHoc({
            host: target.host,
            profileId: target.profileId,
            port: target.port,
            jumpHost: target.jumpHost,
            label,
            cols: latestCols, rows: latestRows,
            disableAutoFill,
          });

      const res = await openCall;
      if (aborted) {
        if (res.ok) bridge.close(res.handle).catch(() => { /* ignore */ });
        return;
      }
      if (!res.ok) {
        setState({ phase: "error", error: res.error });
        return;
      }

      const handle = res.handle;
      handleRef.current = handle;
      ptyHandle = handle;
      setState({ phase: "connected", handle, display: res.display });

      // Defensive: if cols/rows drifted between spawn and now (very fast
      // double-fit, container layout settling), force one resync.
      if (term.cols !== latestCols || term.rows !== latestRows) {
        latestCols = term.cols;
        latestRows = term.rows;
      }
      bridge.resize(handle, latestCols, latestRows).catch(() => { /* ignore */ });

      // Pipe pty data → terminal.
      const offData = bridge.onData(handle, (chunk) => {
        try { term.write(chunk); }
        catch { term.write(TEXT_DECODER.decode(chunk)); }
      });

      const offExit = bridge.onExit(handle, (info) => {
        setState({ phase: "exited", exitCode: info.exitCode, signal: info.signal });
        try {
          term.write(`\r\n\x1b[2m[disconnected — exit ${info.exitCode}${info.signal ? `, signal ${info.signal}` : ""}]\x1b[0m\r\n`);
        } catch { /* ignore */ }
        onExit?.(info);
      });

      // Pipe terminal input → pty.
      const offInput = term.onData((data) => {
        bridge.write(handle, data).catch(() => { /* ignore — pty may be closed */ });
      });

      connectHandlers.push(offData, offExit, () => offInput.dispose());
    }

    // Expose reconnect to the JSX. The button calls this; the existing
    // useEffect mount/unmount stays untouched — we never tear down xterm
    // for a reconnect, so scrollback survives.
    reconnectRef.current = () => { void doConnect(true); };

    // Kick off the initial connect.
    void doConnect(false);

    // Track outer container size with ResizeObserver. Don't call fit() in a
    // tight loop — debounce a touch via requestAnimationFrame.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try { fit.fit(); } catch { /* container went away */ }
      });
    });
    ro.observe(containerRef.current);

    const cleanupContainer = containerRef.current;
    return () => {
      aborted = true;
      reconnectRef.current = null;
      ro.disconnect();
      cancelAnimationFrame(raf);
      cleanupContainer?.removeEventListener("mouseup", onMouseUp);
      // xterm-lifetime listeners (renderer, font-aware onResize)
      for (const off of unsubsRef.current) {
        try { off(); } catch { /* ignore */ }
      }
      unsubsRef.current = [];
      // Per-connection listeners (data/exit/input) — survives reconnects,
      // disposed once on unmount.
      disposeConnectHandlers();
      const h = handleRef.current;
      handleRef.current = null;
      if (h != null && bridge) {
        bridge.close(h).catch(() => { /* ignore */ });
      }
      try { term.dispose(); } catch { /* ignore */ }
      xtermRef.current = null;
      fitRef.current = null;
    };
    // We deliberately omit `onExit` from deps — we want to mount once per
    // target identity and not tear down on parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Identity key — change in any of these means "different connection".
    target.kind,
    target.kind === "session" ? target.sessionId : `${target.host}:${target.port ?? 22}@${target.profileId}`,
  ]);

  return (
    <div className="flex flex-col h-full" style={{ background: "#0d1117" }}>
      {/* Header strip */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{
        borderColor: "color-mix(in srgb, var(--fg) 8%, transparent)",
        background: "color-mix(in srgb, var(--fg) 3%, #0d1117)",
      }}>
        <TerminalIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
        <span className="text-[12.5px] font-semibold truncate" style={{ color: "var(--foreground)" }}>{label}</span>
        <StatusPill state={state} />
        <div className="flex-1" />
        {(state.phase === "exited" || state.phase === "error") && (
          <button
            onClick={() => reconnectRef.current?.()}
            className="inline-flex items-center gap-1 h-6 rounded px-2 text-[11.5px] font-semibold transition-colors"
            style={{
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: "var(--accent)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--accent) 20%, transparent)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--accent) 12%, transparent)"; }}
            title="Reconnect — re-spawn this session without losing scrollback"
          >
            <RotateCw className="h-3 w-3" />
            Reconnect
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="h-6 w-6 rounded flex items-center justify-center transition-colors"
            style={{ color: "var(--muted-fg)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--fg) 8%, transparent)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            title="Close terminal"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Terminal canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 px-2 pt-1 pb-2 overflow-hidden" />

      {state.phase === "error" && (
        <div className="px-3 py-2 text-[12px] flex items-center gap-2 border-t" style={{
          color: "var(--destructive)",
          background: "color-mix(in srgb, var(--destructive) 8%, transparent)",
          borderColor: "color-mix(in srgb, var(--destructive) 20%, transparent)",
        }}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ state }: { state: ConnState }) {
  if (state.phase === "connecting") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{
        background: "color-mix(in srgb, var(--accent) 18%, transparent)",
        color: "var(--accent)",
      }}>
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        connecting
      </span>
    );
  }
  if (state.phase === "connected") {
    return (
      <span className="text-[10.5px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{
        background: "rgba(34,197,94,0.15)", color: "#4ade80",
      }}>connected</span>
    );
  }
  if (state.phase === "exited") {
    return (
      <span className="text-[10.5px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{
        background: "color-mix(in srgb, var(--muted-fg) 15%, transparent)", color: "var(--muted-fg)",
      }}>exited · {state.exitCode}</span>
    );
  }
  if (state.phase === "error") {
    return (
      <span className="text-[10.5px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{
        background: "color-mix(in srgb, var(--destructive) 18%, transparent)", color: "var(--destructive)",
      }}>error</span>
    );
  }
  return null;
}
