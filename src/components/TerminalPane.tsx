"use client";

// Hosts one or more open terminals as a tabbed pane that slides up from the
// bottom of the dashboard. Phase 1 ships single-tab; Phase 3 turns this into
// a real multi-tab strip.

import { useEffect, useState } from "react";
import Terminal, { type TerminalTarget } from "./Terminal";
import { Terminal as TerminalIcon, X, ChevronDown, ChevronUp } from "lucide-react";

export interface OpenTerminal {
  /** A locally unique key — distinct from the underlying target so the same
   *  session may be open in multiple tabs at once. */
  key: string;
  target: TerminalTarget;
  label: string;
}

interface Props {
  terminals: OpenTerminal[];
  onCloseTab: (key: string) => void;
  onCloseAll: () => void;
  /** When true, the pane fills its parent (split layout). When false, the
   *  pane sits at the bottom of the dashboard with a fixed/collapsible height. */
  stretched?: boolean;
  /** In stretched mode, what to render when no terminals are open. */
  emptyState?: React.ReactNode;
}

export default function TerminalPane({ terminals, onCloseTab, onCloseAll, stretched = false, emptyState }: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(terminals[0]?.key ?? null);
  const [collapsed, setCollapsed] = useState(false);

  // Keep activeKey valid as terminals change.
  useEffect(() => {
    if (terminals.length === 0) {
      setActiveKey(null);
      return;
    }
    if (!terminals.some((t) => t.key === activeKey)) {
      setActiveKey(terminals[terminals.length - 1].key);
    }
  }, [terminals, activeKey]);

  // In dashboard (bottom-strip) mode, hide the whole strip when there are no
  // terminals open. In stretched mode, we want to render the empty state so
  // the right column doesn't go blank.
  if (terminals.length === 0 && !stretched) return null;

  if (stretched) {
    return (
      <div className="flex flex-col flex-1 min-h-0" style={{ background: "#0d1117" }}>
        {terminals.length === 0 ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: "var(--muted-fg)" }}>
            {emptyState ?? (
              <div className="text-center px-6">
                <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>No active terminals</p>
                <p className="text-[12.5px] mt-1">Click a session on the left to connect.</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <TabStrip terminals={terminals} activeKey={activeKey} setActiveKey={setActiveKey} onCloseTab={onCloseTab} onCloseAll={onCloseAll} />
            <div className="flex-1 min-h-0 relative">
              {terminals.map((t) => (
                <div
                  key={t.key}
                  className="absolute inset-0"
                  style={{ display: t.key === activeKey ? "block" : "none" }}
                >
                  <Terminal
                    target={t.target}
                    label={t.label}
                    onClose={() => onCloseTab(t.key)}
                  />
                </div>
              ))}
            </div>
          </>
        )}
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
      <TabStrip
        terminals={terminals}
        activeKey={activeKey}
        setActiveKey={(k) => { setActiveKey(k); setCollapsed(false); }}
        onCloseTab={onCloseTab}
        onCloseAll={onCloseAll}
        collapsible
        collapsed={collapsed}
        toggleCollapsed={() => setCollapsed((v) => !v)}
      />

      {!collapsed && (
        <div className="flex-1 min-h-0 relative">
          {terminals.map((t) => (
            <div
              key={t.key}
              className="absolute inset-0"
              style={{ display: t.key === activeKey ? "block" : "none" }}
            >
              <Terminal
                target={t.target}
                label={t.label}
                onClose={() => onCloseTab(t.key)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabStrip({
  terminals, activeKey, setActiveKey, onCloseTab, onCloseAll,
  collapsible = false, collapsed = false, toggleCollapsed,
}: {
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
      </div>
      <button
        onClick={onCloseAll}
        className="px-2 text-[11px] transition-colors"
        style={{ color: "var(--muted-fg)" }}
        title="Close all terminals"
      >
        Close all
      </button>
    </div>
  );
}
