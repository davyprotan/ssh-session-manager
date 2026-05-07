"use client";

// A slim sidebar list of saved sessions for the "Split" layout.
// Click a session → opens it in the terminal pane.

import { useMemo, useState } from "react";
import { Search, Plus, Zap, Clock, Lock, Key, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import type { Session } from "@/lib/types";

interface Props {
  sessions: Session[];
  /** session id of the currently-active terminal, if any. Used for highlighting. */
  activeSessionId?: number | null;
  onOpen: (s: Session) => void;
  onNewSession: () => void;
  onQuickConnect: () => void;
}

export default function CompactSessionList({ sessions, activeSessionId, onOpen, onNewSession, onQuickConnect }: Props) {
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
    // Sort by last-connected desc, fall back to name
    return [...list].sort((a, b) => {
      const at = a.last_connected_at ? new Date(a.last_connected_at).getTime() : 0;
      const bt = b.last_connected_at ? new Date(b.last_connected_at).getTime() : 0;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });
  }, [sessions, search]);

  return (
    <aside className="flex flex-col h-full" style={{
      borderRight: "1px solid var(--border)",
      background: "var(--card)",
      width: 300,
      flex: "0 0 300px",
    }}>
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
      {/* Color rail */}
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
