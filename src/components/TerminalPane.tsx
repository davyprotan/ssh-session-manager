"use client";

// Hosts one or more open terminals as a tabbed pane that slides up from the
// bottom of the dashboard. Phase 1 ships single-tab; Phase 3 turns this into
// a real multi-tab strip.

import { useEffect, useRef, useState } from "react";
import Terminal, { type TerminalTarget } from "./Terminal";
import { Terminal as TerminalIcon, X, ChevronDown, ChevronUp, Plus } from "lucide-react";

export interface OpenTerminal {
  /** A locally unique key — distinct from the underlying target so the same
   *  session may be open in multiple tabs at once. */
  key: string;
  target: TerminalTarget;
  label: string;
}

interface Props {
  terminals: OpenTerminal[];
  /** The tab currently shown in the terminal viewport. */
  activeKey: string | null;
  /** Changes whenever an explicit open/select action should reveal and focus the active terminal. */
  focusRequest: number;
  onActiveKeyChange: (key: string | null) => void;
  onCloseTab: (key: string) => void;
  onCloseAll: () => void;
  /** When true, the pane fills its parent (split layout). When false, the
   *  pane sits at the bottom of the dashboard with a fixed/collapsible height. */
  stretched?: boolean;
  /** In stretched mode, what to render when no terminals are open. */
  emptyState?: React.ReactNode;
  /** "New tab" launcher. When given, the tab strip gets a + button that opens
   *  it as a pseudo-tab, and it is the stretched empty state. Receives a
   *  counter that changes whenever it should take focus. */
  renderLauncher?: (focusRequest: number) => React.ReactNode;
}

export default function TerminalPane({ terminals, activeKey, focusRequest, onActiveKeyChange, onCloseTab, onCloseAll, stretched = false, emptyState, renderLauncher }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  // The launcher pseudo-tab. It never owns activeKey (that stays a real
  // terminal key, so the parent's invariants hold); it just covers the
  // viewport while open. Opening any terminal or picking a tab closes it.
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherFocus, setLauncherFocus] = useState(0);
  const openLauncher = () => {
    setLauncherOpen(true);
    setCollapsed(false);
    setLauncherFocus((n) => n + 1);
  };
  // Track which keys we've already seen so we can detect "a new terminal was
  // just opened" vs "an existing one was closed".
  const prevKeysRef = useRef<string[]>(terminals.map((t) => t.key));

  // Keep activeKey valid as terminals change, and focus newly-opened tabs so
  // the user lands on the connection they just started.
  useEffect(() => {
    const prevKeys = prevKeysRef.current;
    const curKeys = terminals.map((t) => t.key);
    const added = curKeys.filter((k) => !prevKeys.includes(k));
    prevKeysRef.current = curKeys;

    if (terminals.length === 0) {
      if (activeKey !== null) onActiveKeyChange(null);
      return;
    }
    if (added.length > 0) {
      // Focus the most recently opened one. Also un-collapse so the user
      // actually sees it (otherwise the new tab opens behind the chevron).
      const nextActiveKey = added[added.length - 1];
      if (nextActiveKey !== activeKey) onActiveKeyChange(nextActiveKey);
      setCollapsed(false);
      setLauncherOpen(false);
      return;
    }
    if (!terminals.some((t) => t.key === activeKey)) {
      onActiveKeyChange(terminals[terminals.length - 1].key);
    }
  }, [terminals, activeKey, onActiveKeyChange]);

  // An explicit open request must reveal the pane even if it targets a tab
  // that was already open/active while the dashboard terminal was collapsed.
  useEffect(() => {
    if (focusRequest <= 0 || terminals.length === 0) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setCollapsed(false);
      setLauncherOpen(false);
    });
    return () => { cancelled = true; };
  }, [focusRequest, terminals.length]);

  // The launcher covers the viewport while its pseudo-tab is open. In split
  // layout it is also the empty state, so the right column is never blank.
  const showLauncher = !!renderLauncher && (launcherOpen || (stretched && terminals.length === 0));

  // In dashboard (bottom-strip) mode, hide the whole strip when nothing is
  // open. In stretched mode, render the empty state instead.
  if (terminals.length === 0 && !stretched && !showLauncher) return null;

  const viewport = (
    <div className="flex-1 min-h-0 relative">
      {showLauncher && (
        <div className="absolute inset-0 z-10" style={{ background: "#0d1117" }}>
          {renderLauncher!(launcherFocus)}
        </div>
      )}
      {stretched && terminals.length === 0 && !showLauncher && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--muted-fg)" }}>
          {emptyState ?? (
            <div className="text-center px-6">
              <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>No active terminals</p>
              <p className="text-[12.5px] mt-1">Click a session on the left to connect.</p>
            </div>
          )}
        </div>
      )}
      {terminals.map((t) => (
        <div
          key={t.key}
          className="absolute inset-0"
          style={{ display: t.key === activeKey ? "block" : "none" }}
        >
          <Terminal
            target={t.target}
            label={t.label}
            isActive={t.key === activeKey && !showLauncher}
            focusRequest={t.key === activeKey ? focusRequest : 0}
            onClose={() => onCloseTab(t.key)}
          />
        </div>
      ))}
    </div>
  );

  const strip = (
    <TabStrip
      terminals={terminals}
      activeKey={showLauncher ? null : activeKey}
      setActiveKey={(k) => { setLauncherOpen(false); onActiveKeyChange(k); setCollapsed(false); }}
      onCloseTab={onCloseTab}
      onCloseAll={onCloseAll}
      launcherOpen={showLauncher}
      // In split layout with nothing open the launcher can't be dismissed.
      onCloseLauncher={stretched && terminals.length === 0 ? undefined : () => setLauncherOpen(false)}
      onOpenLauncher={renderLauncher ? openLauncher : undefined}
      collapsible={!stretched}
      collapsed={collapsed}
      toggleCollapsed={() => setCollapsed((v) => !v)}
    />
  );

  if (stretched) {
    return (
      <div className="flex flex-col flex-1 min-h-0" style={{ background: "#0d1117" }}>
        {terminals.length > 0 && strip}
        {viewport}
      </div>
    );
  }

  return (
    <div
      className="border-t flex flex-col"
      style={{
        borderColor: "color-mix(in srgb, var(--fg) 10%, transparent)",
        background: "#0d1117",
        height: collapsed ? 36 : "min(60vh, 520px)",
        flex: "0 0 auto",
        transition: "height 180ms ease",
      }}
    >
      {strip}
      {!collapsed && viewport}
    </div>
  );
}

function TabStrip({
  terminals, activeKey, setActiveKey, onCloseTab, onCloseAll,
  collapsible = false, collapsed = false, toggleCollapsed,
  launcherOpen = false, onOpenLauncher, onCloseLauncher,
}: {
  launcherOpen?: boolean;
  onOpenLauncher?: () => void;
  onCloseLauncher?: () => void;
  terminals: OpenTerminal[];
  activeKey: string | null;
  setActiveKey: (k: string) => void;
  onCloseTab: (key: string) => void;
  onCloseAll: () => void;
  collapsible?: boolean;
  collapsed?: boolean;
  toggleCollapsed?: () => void;
}) {
  return (
    <div className="flex items-stretch border-b shrink-0" style={{
      borderColor: "color-mix(in srgb, var(--fg) 8%, transparent)",
    }}>
      {collapsible && toggleCollapsed && (
        <button
          onClick={toggleCollapsed}
          className="px-2 flex items-center gap-1 text-[11.5px] transition-colors"
          style={{ color: "var(--muted-fg)" }}
          title={collapsed ? "Expand terminals" : "Collapse terminals"}
        >
          {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <TerminalIcon className="h-3 w-3" />
          <span className="font-semibold">{terminals.length}</span>
        </button>
      )}
      <div className="flex-1 flex items-center overflow-x-auto">
        {terminals.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveKey(t.key)}
            className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 border-r text-[12px] transition-colors max-w-[240px]"
            style={{
              borderColor: "color-mix(in srgb, var(--fg) 8%, transparent)",
              background: t.key === activeKey
                ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                : "transparent",
              color: t.key === activeKey ? "var(--foreground)" : "var(--muted-fg)",
            }}
          >
            <span className="truncate">{t.label}</span>
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onCloseTab(t.key); }}
              className="h-4 w-4 flex items-center justify-center rounded transition-opacity opacity-50 group-hover:opacity-100"
              title="Close"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ))}
        {launcherOpen && (
          <button
            className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 border-r text-[12px]"
            style={{
              borderColor: "color-mix(in srgb, var(--fg) 8%, transparent)",
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: "var(--foreground)",
            }}
          >
            <Plus className="h-3 w-3" style={{ color: "var(--accent)" }} />
            <span>New tab</span>
            {onCloseLauncher && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); onCloseLauncher(); }}
                className="h-4 w-4 flex items-center justify-center rounded opacity-50 group-hover:opacity-100"
                title="Close"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        )}
        {onOpenLauncher && !launcherOpen && (
          <button
            onClick={onOpenLauncher}
            className="mx-1 h-6 px-2 inline-flex items-center gap-1 rounded shrink-0 text-[11.5px] font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]"
            style={{ color: "var(--muted-fg)" }}
            title="New tab — connect to a host"
          >
            <Plus className="h-3.5 w-3.5" />
            New tab
          </button>
        )}
      </div>
      {terminals.length > 0 && (
        <button
          onClick={onCloseAll}
          className="px-2 text-[11px] transition-colors"
          style={{ color: "var(--muted-fg)" }}
          title="Close all terminals"
        >
          Close all
        </button>
      )}
    </div>
  );
}
