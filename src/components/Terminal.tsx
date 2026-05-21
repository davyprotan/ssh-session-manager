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
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Profile } from "@/lib/types";

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
  | { phase: "reconnecting"; attempt: number; maxAttempts: number; secondsLeft: number }
  | { phase: "exited"; exitCode: number; signal: number | null }
  | { phase: "error"; error: string };

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

// Backoff schedule for auto-reconnect on network failure (OpenSSH exit 255).
// Each value is the delay BEFORE that attempt, in seconds. Length = max
// attempts. Kept conservative so we don't hammer flapping hosts.
const RECONNECT_BACKOFF_SECONDS: readonly number[] = [2, 5, 10];

// Sliding window of recent decoded PTY output we keep around to scan after
// exit. 8 KB is more than enough to catch the OpenSSH error line, and small
// enough that the per-chunk slice cost is negligible.
const ERROR_TAIL_BYTES = 8 * 1024;

// OpenSSH error strings emitted when modern client meets legacy gear that
// only supports SHA-1 KEX / ssh-rsa host keys / CBC ciphers / etc. The
// "invalid format" line also surfaces from broken host key negotiation on
// these devices. If any of these appears in the tail and SSH exits non-zero
// before authenticating, we offer to flip `compat_legacy` on the profile.
const LEGACY_ALGO_PATTERNS: readonly RegExp[] = [
  /no matching key exchange method found/i,
  /no matching host key type found/i,
  /no matching cipher found/i,
  /no matching MAC found/i,
  /Unable to negotiate with .* port \d+:/i,
  /ssh_dispatch_run_fatal: .* invalid format/i,
];

function tailMatchesLegacyAlgoFailure(tail: string): boolean {
  return LEGACY_ALGO_PATTERNS.some((re) => re.test(tail));
}

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
  // Set when the most recent exit looked like "modern OpenSSH refused to
  // negotiate with legacy gear" — drives the prompt that offers to enable
  // compat_legacy on the underlying profile and retry. profileId may be null
  // if the bridge could not associate the connection with a saved profile.
  const [legacyPrompt, setLegacyPrompt] = useState<{ profileId: number | null } | null>(null);
  const [legacyApplying, setLegacyApplying] = useState(false);

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

    // Profile id for the currently-open pty, captured from the open() result.
    // Used by the legacy-algo prompt to PATCH the right profile. Null when
    // the connection isn't backed by a saved profile.
    let currentProfileId: number | null = null;

    // Auto-reconnect state. Counter increments on every consecutive
    // network-failure exit and resets the moment we land in "connected".
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTicker: ReturnType<typeof setInterval> | null = null;
    function cancelPendingReconnect() {
      if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (reconnectTicker != null) { clearInterval(reconnectTicker); reconnectTicker = null; }
    }
    function scheduleAutoReconnect() {
      cancelPendingReconnect();
      const delaySec = RECONNECT_BACKOFF_SECONDS[reconnectAttempt];
      const maxAttempts = RECONNECT_BACKOFF_SECONDS.length;
      const attemptNumber = reconnectAttempt + 1; // 1-indexed for display
      let remaining = delaySec;
      setState({ phase: "reconnecting", attempt: attemptNumber, maxAttempts, secondsLeft: remaining });
      reconnectTicker = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (reconnectTicker != null) { clearInterval(reconnectTicker); reconnectTicker = null; }
          return;
        }
        setState({ phase: "reconnecting", attempt: attemptNumber, maxAttempts, secondsLeft: remaining });
      }, 1000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (reconnectTicker != null) { clearInterval(reconnectTicker); reconnectTicker = null; }
        if (aborted) return;
        reconnectAttempt += 1;
        void doConnect(true);
      }, delaySec * 1000);
    }

    async function doConnect(isReconnect: boolean): Promise<void> {
      if (aborted) return;
      // Re-narrow inside the async closure — TS loses the outer narrow across awaits.
      if (!bridge) return;

      // Any pending auto-reconnect timer is now obsolete — either we're
      // about to honour it ourselves, or the user manually re-fired.
      cancelPendingReconnect();

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
      currentProfileId = res.profileId;
      // A successful (re)connect clears the auto-reconnect attempt counter
      // so the next unrelated network blip gets the full retry budget again.
      reconnectAttempt = 0;
      setState({ phase: "connected", handle, display: res.display });

      // Rolling buffer of recent decoded output for post-mortem error
      // pattern matching. Reset each (re)connect so old output from a prior
      // session doesn't trigger a false-positive prompt. Uses a dedicated
      // streaming decoder so partial multibyte chars at the chunk boundary
      // don't get mixed with the (non-streaming) fallback decode that xterm
      // uses below if its native chunk write throws.
      let errorTail = "";
      const errorTailDecoder = new TextDecoder("utf-8", { fatal: false });
      function appendToErrorTail(chunk: Uint8Array) {
        errorTail = (errorTail + errorTailDecoder.decode(chunk, { stream: true })).slice(-ERROR_TAIL_BYTES);
      }

      // Defensive: if cols/rows drifted between spawn and now (very fast
      // double-fit, container layout settling), force one resync.
      if (term.cols !== latestCols || term.rows !== latestRows) {
        latestCols = term.cols;
        latestRows = term.rows;
      }
      bridge.resize(handle, latestCols, latestRows).catch(() => { /* ignore */ });

      // Pipe pty data → terminal. We also tee a copy into the rolling tail
      // buffer so the exit handler below can scan it for known SSH error
      // patterns without us having to re-read from xterm's scrollback.
      const offData = bridge.onData(handle, (chunk) => {
        appendToErrorTail(chunk);
        try { term.write(chunk); }
        catch { term.write(TEXT_DECODER.decode(chunk)); }
      });

      const offExit = bridge.onExit(handle, (info) => {
        try {
          term.write(`\r\n\x1b[2m[disconnected — exit ${info.exitCode}${info.signal ? `, signal ${info.signal}` : ""}]\x1b[0m\r\n`);
        } catch { /* ignore */ }

        // If the failure mode is "modern OpenSSH refused to negotiate with
        // legacy algorithms" (a fixable config issue, not a network blip),
        // skip auto-reconnect and offer to enable compat_legacy on the
        // profile. Without this, the auto-reconnect loop would just burn
        // through its budget hitting the same algorithm wall every time.
        const looksLikeLegacyAlgoFailure =
          !info.signal && info.exitCode !== 0 && tailMatchesLegacyAlgoFailure(errorTail);
        if (!aborted && looksLikeLegacyAlgoFailure) {
          setLegacyPrompt({ profileId: currentProfileId });
          setState({ phase: "exited", exitCode: info.exitCode, signal: info.signal });
          onExit?.(info);
          return;
        }

        // OpenSSH exits 255 for "ssh itself failed" — almost always a
        // dropped link (the keepalive defaults in buildSshArgs ensure this
        // surfaces within ~90s of network loss). Anything else (0 = clean
        // logout, 1/2/127 = remote command failed) is a user-meaningful
        // exit and shouldn't loop. We also skip auto-reconnect on signal
        // kills — those are typically intentional (Ctrl-C of `ssh`, app
        // shutdown).
        const isNetworkFailure = info.exitCode === 255 && !info.signal;
        const budgetLeft = reconnectAttempt < RECONNECT_BACKOFF_SECONDS.length;
        if (!aborted && isNetworkFailure && budgetLeft) {
          scheduleAutoReconnect();
        } else {
          setState({ phase: "exited", exitCode: info.exitCode, signal: info.signal });
        }
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
      cancelPendingReconnect();
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

  async function enableCompatLegacyAndRetry(profileId: number) {
    setLegacyApplying(true);
    try {
      // Fetch the full profile, flip compat_legacy, PUT it back. The PUT
      // endpoint requires a complete object (see /api/profiles/[id]/route.ts)
      // and preserves the keychain link when no `password` field is sent.
      const listRes = await fetch("/api/profiles");
      if (!listRes.ok) throw new Error(`profile lookup failed (${listRes.status})`);
      const profiles = (await listRes.json()) as Profile[];
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) throw new Error("profile no longer exists");

      // parseProfile on the server reads only known keys, so passing the
      // join-only `has_password` flag through is harmless. We don't include
      // `password` either — the PUT endpoint preserves the keychain link
      // when no fresh secret is supplied.
      const body = { ...profile, compat_legacy: 1 };
      const putRes = await fetch(`/api/profiles/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!putRes.ok) {
        const errBody = (await putRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `update failed (${putRes.status})`);
      }
      toast.success("Legacy compatibility enabled — reconnecting…");
      setLegacyPrompt(null);
      reconnectRef.current?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to enable legacy compatibility");
    } finally {
      setLegacyApplying(false);
    }
  }

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
        {(state.phase === "exited" || state.phase === "error" || state.phase === "reconnecting") && (
          <button
            onClick={() => reconnectRef.current?.()}
            className="inline-flex items-center gap-1 h-6 rounded px-2 text-[11.5px] font-semibold transition-colors"
            style={{
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: "var(--accent)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--accent) 20%, transparent)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--accent) 12%, transparent)"; }}
            title={state.phase === "reconnecting" ? "Reconnect now — skip the backoff timer" : "Reconnect — re-spawn this session without losing scrollback"}
          >
            <RotateCw className="h-3 w-3" />
            {state.phase === "reconnecting" ? "Reconnect now" : "Reconnect"}
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
      {/* pb-4 (16px) gives the FitAddon enough slack that the bottom row
          never lands mid-cell — pb-2 was just under one cell of headroom on
          some zoom levels and clipped the last line's descenders. */}
      <div ref={containerRef} className="flex-1 min-h-0 px-2 pt-1 pb-4 overflow-hidden" />

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

      <AlertDialog open={legacyPrompt !== null} onOpenChange={(open) => { if (!open) setLegacyPrompt(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable legacy SSH compatibility?</AlertDialogTitle>
            <AlertDialogDescription>
              {legacyPrompt?.profileId != null ? (
                <>
                  This host only accepts older SSH algorithms (SHA-1 key
                  exchange, ssh-rsa host keys, or CBC ciphers) that modern
                  OpenSSH disables by default. Enabling{" "}
                  <span className="font-mono">Legacy compatibility</span> on
                  this profile appends the legacy algorithms to the
                  negotiation list so the connection can complete.
                </>
              ) : (
                <>
                  This host only accepts older SSH algorithms that modern
                  OpenSSH disables by default. This session isn&apos;t tied
                  to a saved profile, so there&apos;s nothing here to flip —
                  open the host&apos;s profile in the sidebar and enable{" "}
                  <span className="font-mono">Legacy compatibility</span>{" "}
                  under Advanced.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={legacyApplying}>
              {legacyPrompt?.profileId != null ? "Not now" : "Close"}
            </AlertDialogCancel>
            {legacyPrompt?.profileId != null ? (
              <AlertDialogAction
                disabled={legacyApplying}
                onClick={(e) => {
                  e.preventDefault();
                  if (legacyPrompt?.profileId != null) {
                    void enableCompatLegacyAndRetry(legacyPrompt.profileId);
                  }
                }}
              >
                {legacyApplying ? "Enabling…" : "Enable & retry"}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  if (state.phase === "reconnecting") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5" style={{
        background: "color-mix(in srgb, #f59e0b 18%, transparent)",
        color: "#f59e0b",
      }}>
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        reconnecting · {state.secondsLeft}s · {state.attempt}/{state.maxAttempts}
      </span>
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
