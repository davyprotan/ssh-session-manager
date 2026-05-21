// Type declaration for the preload-bridge API exposed by electron/preload.js.
// Available only inside Electron. In a plain browser dev mode (no Electron) the
// global is `undefined` — components must check before calling.

export interface OpenResultOk {
  ok: true;
  handle: number;
  display: string;
  sessionLabel: string;
  /** Profile backing this connection, if any. Used by the renderer to offer
   *  "enable legacy compatibility & retry" when SSH fails with a no-matching-
   *  algorithm error. Null for connections with no associated profile. */
  profileId: number | null;
  /** Saved-session id, if this terminal is for a saved session (vs. ad-hoc). */
  sessionId: number | null;
}
export interface OpenResultErr {
  ok: false;
  error: string;
}
export type OpenResult = OpenResultOk | OpenResultErr;

export interface OkResult { ok: true }
export interface ErrResult { ok: false; error: string }
export type WriteResult = OkResult | ErrResult;
export type ResizeResult = OkResult | ErrResult;
export type CloseResult = OkResult | ErrResult;

export interface ExitInfo {
  exitCode: number;
  signal: number | null;
}

export interface SshTermBridge {
  open(opts: {
    sessionId: number;
    cols?: number;
    rows?: number;
    /** When true, the main process will not auto-inject the stored password
     *  for this session even if the global setting allows it. */
    disableAutoFill?: boolean;
  }): Promise<OpenResult>;
  /** Open an ad-hoc connection (Quick Connect): host + profile, no saved session. */
  openAdHoc(opts: {
    host: string;
    profileId: number;
    port?: number;
    jumpHost?: string;
    label?: string;
    cols?: number;
    rows?: number;
    disableAutoFill?: boolean;
  }): Promise<OpenResult>;
  write(handle: number, data: string): Promise<WriteResult>;
  resize(handle: number, cols: number, rows: number): Promise<ResizeResult>;
  close(handle: number): Promise<CloseResult>;
  onData(handle: number, cb: (chunk: Uint8Array) => void): () => void;
  onExit(handle: number, cb: (info: ExitInfo) => void): () => void;
}

declare global {
  interface Window {
    sshTerm?: SshTermBridge;
  }
}

export {};
