"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Terminal, Key, Lock, MoreVertical, Pencil, Trash2, Copy, Clock, UserRound, ShieldCheck } from "lucide-react";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import type { Session } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  session: Session;
  onEdit: (s: Session) => void;
  onDelete: (s: Session) => void;
  onConnect: (s: Session) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never connected";
  const diff = Date.now() - new Date(dateStr + "Z").getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SessionCard({ session, onEdit, onDelete, onConnect }: Props) {
  const tags: string[] = JSON.parse(session.tags || "[]");
  const accent = session.profile_color ? COLOR_HEX[session.profile_color as ProfileColor] || COLOR_HEX.cyan : COLOR_HEX.cyan;

  function copyCommand() {
    const user = session.profile_username;
    const target = user ? `${user}@${session.host}` : session.host;
    const portFlag = session.port !== 22 ? ` -p ${session.port}` : "";
    navigator.clipboard.writeText(`ssh${portFlag} ${target}`);
    toast.success("SSH command copied");
  }

  return (
    <div
      className="group relative flex flex-col rounded-xl overflow-hidden transition-all duration-200"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}66`; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 24px ${accent}10`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
    >
      {/* Top accent strip - colored by profile */}
      <div style={{ height: "2px", background: `linear-gradient(90deg, ${accent}b3 0%, ${accent}33 60%, transparent 100%)` }} />

      <div className="flex flex-col gap-3 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight truncate" style={{ color: "var(--foreground)" }}>
              {session.name}
            </h3>
            <p className="text-xs font-mono mt-0.5 truncate" style={{ color: accent }}>
              {session.host}
              <span style={{ color: "var(--muted-foreground)", opacity: 0.6 }}>
                {session.port !== 22 ? `:${session.port}` : ""}
              </span>
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors" style={{ color: "var(--muted-foreground)" }}>
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onClick={() => onConnect(session)}>
                <Terminal className="h-3.5 w-3.5 mr-2" style={{ color: accent }} /> Connect
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyCommand}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Copy SSH command
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onEdit(session)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(session)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Profile pill */}
        {session.profile_name ? (
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5 w-fit max-w-full" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {session.profile_auth_type === "password"
              ? <Lock className="h-3 w-3 shrink-0" style={{ color: "#fbbf24" }} />
              : session.profile_auth_type === "key_with_passphrase"
              ? <ShieldCheck className="h-3 w-3 shrink-0" style={{ color: accent }} />
              : <Key className="h-3 w-3 shrink-0" style={{ color: accent }} />}
            <span className="text-xs truncate" style={{ color: "var(--muted-foreground)" }}>{session.profile_name}</span>
            <span style={{ color: "rgba(139,148,158,0.4)", fontSize: "10px" }}>·</span>
            <UserRound className="h-3 w-3 shrink-0" style={{ color: "rgba(139,148,158,0.5)" }} />
            <span className="text-xs font-mono truncate" style={{ color: "rgba(230,237,243,0.6)" }}>{session.profile_username}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5 w-fit" style={{ border: "1px dashed rgba(255,255,255,0.08)" }}>
            <span className="text-xs italic" style={{ color: "rgba(139,148,158,0.4)" }}>No profile</span>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <Badge
                key={tag}
                variant="outline"
                className="text-xs px-1.5 py-0 h-5 font-normal"
                style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(139,148,158,0.8)", background: "rgba(255,255,255,0.03)" }}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Notes */}
        {session.notes && (
          <p className="text-xs line-clamp-1 leading-relaxed" style={{ color: "rgba(139,148,158,0.6)" }}>{session.notes}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 mt-auto" style={{ borderTop: "1px solid rgba(48,54,61,0.6)" }}>
          <div className="flex items-center gap-1 text-xs" style={{ color: "rgba(139,148,158,0.4)" }}>
            <Clock className="h-3 w-3" />
            {timeAgo(session.last_connected_at)}
          </div>
          <button
            onClick={() => onConnect(session)}
            className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 transition-all duration-150"
            style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}33` }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}2e`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}1a`; }}
          >
            <Terminal className="h-3 w-3" />
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
