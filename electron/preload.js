// Preload runs in a privileged isolated world before the renderer's JS.
// It exposes a tiny, typed API to the page via contextBridge — never
// exposes ipcRenderer / Node primitives directly.
//
// SECURITY: every method here passes through to the main process where
// the actual privilege checks happen (see electron/pty-manager.js). The
// preload is just a thin marshaller; never trust the renderer's input.

const { contextBridge, ipcRenderer } = require('electron');

const sshTerm = {
  /**
   * Open a new ssh session in a pty.
   * @param {object} opts {sessionId: number, cols?: number, rows?: number}
   * @returns {Promise<{ok: true, handle: number, display: string} | {ok: false, error: string}>}
   */
  open: (opts) => ipcRenderer.invoke('sshterm:open', opts),

  /** Send keyboard input to the pty. */
  write: (handle, data) => ipcRenderer.invoke('sshterm:write', { handle, data }),

  /** Tell the pty about a window resize. */
  resize: (handle, cols, rows) => ipcRenderer.invoke('sshterm:resize', { handle, cols, rows }),

  /** Kill the pty. */
  close: (handle) => ipcRenderer.invoke('sshterm:close', { handle }),

  /**
   * Subscribe to pty output. Calls `onData(Uint8Array)` for each chunk.
   * Returns an unsubscribe function.
   */
  onData: (handle, onData) => {
    const channel = `sshterm:data:${handle}`;
    const listener = (_evt, buf) => {
      // `buf` arrives as a Uint8Array (Electron auto-converts Buffer over IPC).
      try { onData(buf); } catch (e) { console.error('onData handler threw:', e); }
    };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  /**
   * Subscribe to pty exit. Calls `onExit({exitCode, signal})` exactly once.
   * Returns an unsubscribe function.
   */
  onExit: (handle, onExit) => {
    const channel = `sshterm:exit:${handle}`;
    const listener = (_evt, info) => {
      try { onExit(info); } catch (e) { console.error('onExit handler threw:', e); }
      ipcRenderer.removeListener(channel, listener);
    };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('sshTerm', sshTerm);
