"use client";

import { Clock, Terminal, BookmarkPlus, Bookmark, Trash2, Network, UserRound } from "lucide-react";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import type { HistoryEntry } from "@/lib/types";

interface Props {
  entry: HistoryEntry;
  onConnect: (entry: HistoryEntry) => void;
  onSaveAsSession: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso + "Z").getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso + "Z").toLocaleDateString();
}

export default function HistoryRow({ entry, onConnect, onSaveAsSession, onDelete }: Props) {
  const colorKey = (entry.profile_color || entry.profile_color_snapshot) as ProfileColor | null;
  const accent = colorKey ? COLOR_HEX[colorKey] || COLOR_HEX.cyan : COLOR_HEX.cyan;
  const isSaved = !!entry.session_id;
  const profileLabel = entry.profile_name || entry.profile_name_snapshot;
  const sessionLabel = entry.session_name || entry.session_name_snapshot;

  return (
    <div
      className="group flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}66`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${accent}15`, color: accent }}>
        <Terminal className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[13px] truncate" style={{ color: "var(--foreground)" }}>
            {entry.username && <span style={{ color: accent }}>{entry.username}@</span>}
            {entry.host}
            {entry.port !== 22 && <span style={{ color: "var(--subtle-fg)" }}>:{entry.port}</span>}
          </p>
          {isSaved && (
            <span
              title="This host is saved"
              className="flex items-center gap-1 text-[10.5px] font-medium rounded-md px-1.5 py-0.5"
              style={{ background: `${accent}15`, color: accent }}
            >
              <Bookmark className="h-2.5 w-2.5 fill-current" />
              {sessionLabel || "Saved"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-x-2.5 gap-y-0 mt-1 flex-wrap">
          <span className="flex items-center gap-1 text-[11.5px]" style={{ color: "var(--subtle-fg)" }}>
            <Clock className="h-3 w-3" />
            {timeAgo(entry.connected_at)}
          </span>
          {profileLabel && (
            <>
              <span style={{ color: "var(--subtle-fg)" }}>·</span>
              <span className="flex items-center gap-1 text-[11.5px]" style={{ color: "var(--muted-fg)" }}>
                <UserRound className="h-3 w-3" />
                {profileLabel}
              </span>
            </>
          )}
          {entry.jump_host && (
            <>
              <span style={{ color: "var(--subtle-fg)" }}>·</span>
              <span className="flex items-center gap-1 text-[11.5px] font-mono" style={{ color: "var(--subtle-fg)" }}>
                <Network className="h-3 w-3" />
                {entry.jump_host}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isSaved && (
          <button
            onClick={() => onSaveAsSession(entry)}
            title="Save as session"
            className="flex items-center justify-center h-8 w-8 rounded-md transition-colors"
            style={{ color: "var(--muted-fg)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}15`; (e.currentTarget as HTMLButtonElement).style.color = accent; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--muted-fg)"; }}
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(entry)}
          title="Remove from history"
          className="flex items-center justify-center h-8 w-8 rounded-md transition-colors"
          style={{ color: "var(--muted-fg)" }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        onClick={() => onConnect(entry)}
        className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 transition-all duration-150 shrink-0"
        style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}40` }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}33`; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}1a`; }}
      >
        <Terminal className="h-3 w-3" />
        Reconnect
      </button>
    </div>
  );
}
