"use client";

import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Terminal, Key, Lock, MoreVertical, Pencil, Trash2, Copy, Clock, UserRound, ShieldCheck, Files, Network, FolderClosed, KeyRound } from "lucide-react";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import type { Session } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  session: Session;
  onEdit: (s: Session) => void;
  onDelete: (s: Session) => void;
  onConnect: (s: Session) => void;
  onClone: (s: Session) => void;
  onSetupPasswordless?: (s: Session) => void;
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

export default function SessionCard({ session, onEdit, onDelete, onConnect, onClone, onSetupPasswordless }: Props) {
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
            <h3 className="font-semibold text-[15px] leading-snug truncate" style={{ color: "var(--foreground)" }}>
              {session.name}
            </h3>
            {session.folder_name && (
              <div className="flex items-center gap-1 mt-1 text-[11px]" style={{ color: COLOR_HEX[(session.folder_color as ProfileColor) || 'cyan'] || COLOR_HEX.cyan }}>
                <FolderClosed className="h-3 w-3" />
                {session.folder_name}
              </div>
            )}
            <p className="text-[13px] font-mono mt-1 truncate" style={{ color: accent }}>
              {session.host}
              <span style={{ color: "var(--subtle-fg)" }}>
                {session.port !== 22 ? `:${session.port}` : ""}
              </span>
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors" style={{ color: "var(--muted-fg)" }}>
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onClick={() => onConnect(session)}>
                <Terminal className="h-3.5 w-3.5 mr-2" style={{ color: accent }} /> Connect
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyCommand}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Copy SSH command
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onClone(session)}>
                <Files className="h-3.5 w-3.5 mr-2" /> Duplicate
              </DropdownMenuItem>
              {session.profile_auth_type === "password" && onSetupPasswordless && (
                <DropdownMenuItem onClick={() => onSetupPasswordless(session)}>
                  <KeyRound className="h-3.5 w-3.5 mr-2" style={{ color: accent }} /> Set up passwordless login
                </DropdownMenuItem>
              )}
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
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1 w-fit max-w-full" style={{ background: "color-mix(in srgb, var(--fg) 5%, transparent)", border: "1px solid var(--border)" }}>
            {session.profile_auth_type === "password"
              ? <Lock className="h-3 w-3 shrink-0" style={{ color: "#fbbf24" }} />
              : session.profile_auth_type === "key_with_passphrase"
              ? <ShieldCheck className="h-3 w-3 shrink-0" style={{ color: accent }} />
              : <Key className="h-3 w-3 shrink-0" style={{ color: accent }} />}
            <span className="text-[12.5px] truncate" style={{ color: "var(--muted-fg)" }}>{session.profile_name}</span>
            <span style={{ color: "var(--subtle-fg)", fontSize: "10px" }}>·</span>
            <UserRound className="h-3 w-3 shrink-0" style={{ color: "var(--subtle-fg)" }} />
            <span className="text-[12.5px] font-mono truncate" style={{ color: "var(--muted-fg)" }}>{session.profile_username}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1 w-fit" style={{ border: "1px dashed var(--border)" }}>
            <span className="text-[12.5px] italic" style={{ color: "var(--subtle-fg)" }}>No profile</span>
          </div>
        )}

        {/* Nudge to ditch passwords */}
        {session.profile_auth_type === "password" && onSetupPasswordless && (
          <button
            onClick={() => onSetupPasswordless(session)}
            className="flex items-center gap-1 text-[11.5px] w-fit rounded-md px-1.5 py-0.5 -mt-1 transition-colors"
            style={{ color: "#fbbf24", background: "color-mix(in srgb, #fbbf24 8%, transparent)" }}
            title="Install your SSH key on this host to stop typing passwords"
          >
            <KeyRound className="h-3 w-3" />
            Make passwordless
          </button>
        )}

        {/* Jump host */}
        {session.jump_host && (
          <div className="flex items-center gap-1 text-[12px]" style={{ color: "var(--muted-fg)" }}>
            <Network className="h-3 w-3" style={{ color: "var(--subtle-fg)" }} />
            via <span className="font-mono">{session.jump_host}</span>
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
                style={{ borderColor: "var(--border)", color: "var(--muted-fg)", background: "color-mix(in srgb, var(--fg) 4%, transparent)" }}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Notes */}
        {session.notes && (
          <p className="text-[12.5px] line-clamp-1 leading-relaxed" style={{ color: "var(--muted-fg)" }}>{session.notes}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 mt-auto" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-1 text-[12px]" style={{ color: "var(--subtle-fg)" }}>
            <Clock className="h-3 w-3" />
            {timeAgo(session.last_connected_at)}
          </div>
          <button
            onClick={() => onConnect(session)}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 transition-all duration-150"
            style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}40` }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}33`; }}
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
