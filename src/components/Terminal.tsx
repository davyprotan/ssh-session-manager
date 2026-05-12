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
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { Loader2, AlertCircle, Terminal as TerminalIcon, X } from "lucide-react";

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
    // Canvas renderer is much faster than the default DOM renderer for
    // typical SSH workloads (logs, file lists, etc). Loaded after open()
    // because Canvas needs the host element to size against.
    try { term.loadAddon(new CanvasAddon()); }
    catch (e) { console.warn("CanvasAddon failed, falling back to DOM renderer:", e); }
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

    // Initial fit + initial connect.
    fit.fit();
    const cols = term.cols;
    const rows = term.rows;

    setState({ phase: "connecting" });

    let aborted = false;

    const disableAutoFill = !getAutoFillSetting();
    const openCall = target.kind === "session"
      ? bridge.open({ sessionId: target.sessionId, cols, rows, disableAutoFill })
      : bridge.openAdHoc({
          host: target.host,
          profileId: target.profileId,
          port: target.port,
          jumpHost: target.jumpHost,
          label,
          cols, rows,
          disableAutoFill,
        });

    openCall.then((res) => {
      if (aborted) {
        if (res.ok) bridge.close(res.handle);
        return;
      }
      if (!res.ok) {
        setState({ phase: "error", error: res.error });
        return;
      }
      const handle = res.handle;
      handleRef.current = handle;
      setState({ phase: "connected", handle, display: res.display });

      // Pipe pty data → terminal.
      const offData = bridge.onData(handle, (chunk) => {
        // chunk arrives as Uint8Array. xterm.js can write Uint8Array directly.
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

      // Resize handling: xterm tells us its new size when fit() runs.
      const offResize = term.onResize(({ cols: c, rows: r }) => {
        bridge.resize(handle, c, r).catch(() => { /* ignore */ });
      });

      unsubsRef.current.push(offData, offExit, () => offInput.dispose(), () => offResize.dispose());
    });

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
      ro.disconnect();
      cancelAnimationFrame(raf);
      cleanupContainer?.removeEventListener("mouseup", onMouseUp);
      for (const off of unsubsRef.current) {
        try { off(); } catch { /* ignore */ }
      }
      unsubsRef.current = [];
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
      <div ref={containerRef} className="flex-1 min-h-0 px-2 pt-1 overflow-hidden" />

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
