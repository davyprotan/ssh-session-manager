// Client-safe keyboard shortcut labels. Kept out of TerminalPane so pages can
// import them without pulling xterm (which touches `self`) into SSR.
export const NEW_TAB_SHORTCUT =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘T" : "Ctrl+Shift+T"; // plain Ctrl+T is transpose-chars in the shell
