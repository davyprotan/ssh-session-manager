"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Key, Lock, MoreVertical, Pencil, Trash2, Server, Hash, Star, ShieldCheck } from "lucide-react";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import type { Profile } from "@/lib/types";

interface Props {
  profile: Profile;
  sessionCount: number;
  onEdit: (p: Profile) => void;
  onDelete: (p: Profile) => void;
}

export default function ProfileCard({ profile, sessionCount, onEdit, onDelete }: Props) {
  const isPassword = profile.auth_type === "password";
  const authLabel = { key: "SSH Key", key_with_passphrase: "Key + Passphrase", password: "Password" }[profile.auth_type];
  const color = COLOR_HEX[profile.color as ProfileColor] || COLOR_HEX.cyan;

  return (
    <div
      className="group relative flex items-center gap-4 rounded-xl px-4 py-3.5 transition-all duration-200 overflow-hidden"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${color}80`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
    >
      {/* Color strip */}
      <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full" style={{ background: color }} />

      {/* Icon */}
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ml-1"
        style={{ background: `${color}1a`, color }}
      >
        {isPassword ? <Lock className="h-4 w-4" /> : profile.auth_type === "key_with_passphrase" ? <ShieldCheck className="h-4 w-4" /> : <Key className="h-4 w-4" />}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>{profile.name}</span>
          {profile.is_default ? (
            <span className="flex items-center gap-1 text-xs font-medium rounded-md px-1.5 py-0.5" style={{ background: `${color}15`, color }}>
              <Star className="h-3 w-3 fill-current" />
              Default
            </span>
          ) : null}
          <span
            className="text-xs font-medium rounded-md px-1.5 py-0.5"
            style={isPassword ? { background: "rgba(251,191,36,0.1)", color: "#fbbf24" } : { background: `${color}15`, color }}
          >
            {authLabel}
          </span>
          {sessionCount > 0 && (
            <span className="flex items-center gap-1 text-xs ml-auto" style={{ color: "rgba(139,148,158,0.5)" }}>
              <Server className="h-3 w-3" />
              {sessionCount} session{sessionCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
          <span className="text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>{profile.username}</span>
          {profile.port !== 22 && (
            <span className="flex items-center gap-0.5 text-xs" style={{ color: "rgba(139,148,158,0.5)" }}>
              <Hash className="h-3 w-3" />{profile.port}
            </span>
          )}
          {profile.key_path && (
            <span className="text-xs font-mono truncate max-w-64" style={{ color: "rgba(139,148,158,0.4)" }}>{profile.key_path}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--muted-foreground)" }}
          onClick={() => onEdit(profile)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors" style={{ color: "rgba(139,148,158,0.5)" }}>
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(profile)}>
              <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(profile)}>
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
