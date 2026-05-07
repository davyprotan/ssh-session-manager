"use client";

// A slim sidebar list of saved sessions for the "Split" layout.
// Click a session → opens it in the terminal pane.
//
// Features:
//   - Filter input
//   - Resizable: drag the right edge to set width between 220–640px
//   - Collapsible: chevron in the header toggles a thin (40px) rail
//   - Both width + collapsed state persist via parent (localStorage)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Zap, Clock, Lock, Key, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import type { Session } from "@/lib/types";

const MIN_WIDTH = 220;
const MAX_WIDTH = 640;
const COLLAPSED_WIDTH = 40;

interface Props {
  sessions: Session[];
  /** session id of the currently-active terminal, if any. Used for highlighting. */
  activeSessionId?: number | null;
  /** Current sidebar width (full mode). */
  width: number;
  /** True when the sidebar is collapsed to a thin rail. */
  collapsed: boolean;
  /** Persist a new width. Caller is responsible for clamping if it cares. */
  onWidthChange: (px: number) => void;
  /** Toggle collapsed state. */
  onToggleCollapsed: () => void;
  onOpen: (s: Session) => void;
  onNewSession: () => void;
  onQuickConnect: () => void;
}

export default function CompactSessionList({
  sessions, activeSessionId,
  width, collapsed, onWidthChange, onToggleCollapsed,
  onOpen, onNewSession, onQuickConnect,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sessions;
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.host.toLowerCase().includes(q) ||
          (s.profile_name?.toLowerCase().includes(q) ?? false),
      );
    }
    return [...list].sort((a, b) => {
      const at = a.last_connected_at ? new Date(a.last_connected_at).getTime() : 0;
      const bt = b.last_connected_at ? new Date(b.last_connected_at).getTime() : 0;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });
  }, [sessions, search]);

  // ─── Drag-to-resize the right edge ────────────────────────────────────
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (collapsed) return;
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width, collapsed]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const s = dragStateRef.current;
      if (!s) return;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.startWidth + (e.clientX - s.startX)));
      onWidthChange(next);
    }
    function onUp() {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onWidthChange]);

  // ─── Collapsed rail ───────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        className="flex flex-col h-full items-center pt-2 gap-1 shrink-0"
        style={{
          width: COLLAPSED_WIDTH,
          flex: `0 0 ${COLLAPSED_WIDTH}px`,
          borderRight: "1px solid var(--border)",
          background: "var(--card)",
        }}
      >
        <Button
          size="sm" variant="ghost" className="h-7 w-7 p-0"
          onClick={onToggleCollapsed}
          title="Show sidebar"
          style={{ color: "var(--muted-fg)" }}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost" className="h-7 w-7 p-0 mt-1"
          onClick={onQuickConnect}
          title="Quick connect"
          style={{ color: "var(--accent)" }}
        >
          <Zap className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost" className="h-7 w-7 p-0"
          onClick={onNewSession}
          title="New session"
          style={{ color: "var(--muted-fg)" }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </aside>
    );
  }

  // ─── Full sidebar ─────────────────────────────────────────────────────
  return (
    <aside
      className="flex flex-col h-full relative"
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--card)",
        width,
        flex: `0 0 ${width}px`,
      }}
    >
      {/* Header */}
      <div className="px-3 py-2.5 flex items-center gap-1.5 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 className="text-[12px] font-semibold uppercase tracking-wider flex-1" style={{ color: "var(--muted-fg)" }}>
          Sessions <span style={{ color: "var(--subtle-fg)" }}>· {sessions.length}</span>
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={onQuickConnect}
          className="h-7 w-7 p-0"
          title="Quick connect"
          style={{ color: "var(--accent)" }}
        >
          <Zap className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onNewSession}
          className="h-7 w-7 p-0"
          title="New session"
          style={{ color: "var(--muted-fg)" }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleCollapsed}
          className="h-7 w-7 p-0"
          title="Collapse sidebar"
          style={{ color: "var(--muted-fg)" }}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--subtle-fg)" }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-7 text-[12.5px]"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[12.5px]" style={{ color: "var(--muted-fg)" }}>
              {sessions.length === 0 ? "No saved sessions yet." : `Nothing matches "${search}"`}
            </p>
          </div>
        ) : (
          filtered.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              onClick={() => onOpen(s)}
            />
          ))
        )}
      </div>

      {/* Drag handle on the right edge — 6px hit zone, 1px visible line on hover */}
      <div
        onMouseDown={onResizeStart}
        onDoubleClick={() => onWidthChange(300)}
        className="absolute top-0 bottom-0 -right-[3px] w-[6px] z-10"
        style={{ cursor: "col-resize" }}
        title="Drag to resize · double-click to reset"
      >
        <div
          className="h-full w-px ml-[2.5px] transition-colors"
          style={{ background: "transparent" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "color-mix(in srgb, var(--accent) 50%, transparent)"; }}
          onMouseLeave={(e) => { if (!dragStateRef.current) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
        />
      </div>
    </aside>
  );
}

function SessionRow({ session: s, active, onClick }: { session: Session; active: boolean; onClick: () => void }) {
  const accent = s.profile_color
    ? COLOR_HEX[s.profile_color as ProfileColor] || COLOR_HEX.cyan
    : COLOR_HEX.cyan;

  const auth = s.profile_auth_type;
  const Icon = auth === "password" ? Lock : auth === "key_with_passphrase" ? ShieldCheck : Key;

  return (
    <button
      onClick={onClick}
      className="group w-full flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors text-left"
      style={{
        background: active ? `color-mix(in srgb, ${accent} 14%, transparent)` : "transparent",
        border: `1px solid ${active ? `${accent}40` : "transparent"}`,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--fg) 4%, transparent)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <div className="w-0.5 self-stretch rounded-full mt-0.5" style={{ background: accent }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-semibold truncate flex-1" style={{ color: "var(--foreground)" }}>{s.name}</p>
          {auth && <Icon className="h-3 w-3 shrink-0" style={{ color: auth === "password" ? "#fbbf24" : accent }} />}
        </div>
        <p className="text-[11.5px] font-mono truncate mt-0.5" style={{ color: "var(--muted-fg)" }}>
          {s.host}{s.port !== 22 ? `:${s.port}` : ""}
        </p>
        {s.last_connected_at && (
          <p className="text-[10.5px] flex items-center gap-1 mt-0.5" style={{ color: "var(--subtle-fg)" }}>
            <Clock className="h-2.5 w-2.5" />
            {timeAgo(s.last_connected_at)}
          </p>
        )}
      </div>
    </button>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso + "Z").getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso + "Z").toLocaleDateString();
}
