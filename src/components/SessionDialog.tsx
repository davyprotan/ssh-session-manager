"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, FolderClosed, Network } from "lucide-react";
import ProfilePicker from "./ProfilePicker";
import ProfileDialog from "./ProfileDialog";
import type { Profile, Session, Folder } from "@/lib/types";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  session?: Session | null;
  profiles: Profile[];
  folders: Folder[];
  onProfilesChanged: () => void;
  onFoldersChanged: () => void;
}

export default function SessionDialog({ open, onClose, onSave, session, profiles, folders, onProfilesChanged, onFoldersChanged }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [folderId, setFolderId] = useState<string>("");
  const [jumpHost, setJumpHost] = useState("");
  const [notes, setNotes] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [newFolderInput, setNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    if (session) {
      setName(session.name);
      setHost(session.host);
      setPort(String(session.port));
      setProfileId(session.profile_id);
      setFolderId(session.folder_id ? String(session.folder_id) : "");
      setJumpHost(session.jump_host || "");
      setNotes(session.notes || "");
      setTags(JSON.parse(session.tags || "[]"));
    } else {
      setName("");
      setHost("");
      setPort("22");
      const defaultProfile = profiles.find(p => p.is_default) || profiles[0];
      setProfileId(defaultProfile?.id ?? null);
      setFolderId("");
      setJumpHost("");
      setNotes("");
      setTags([]);
    }
    setError("");
    setNewFolderInput(false);
    setNewFolderName("");
  }, [session, open, profiles]);

  function addTag(e: React.KeyboardEvent) {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().replace(/,$/, "");
      if (t && !tags.includes(t)) setTags([...tags, t]);
      setTagInput("");
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName.trim() }),
    });
    if (res.ok) {
      const f: Folder = await res.json();
      onFoldersChanged();
      setFolderId(String(f.id));
      setNewFolderInput(false);
      setNewFolderName("");
    }
  }

  async function handleSave() {
    setError("");
    if (!name.trim() || !host.trim()) {
      setError("Host and display name are required.");
      return;
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port) || 22,
      profile_id: profileId,
      folder_id: folderId ? parseInt(folderId) : null,
      jump_host: jumpHost.trim() || null,
      notes,
      tags,
    };
    const res = await fetch(session ? `/api/sessions/${session.id}` : "/api/sessions", {
      method: session ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) { setError("Failed to save session."); return; }
    onSave();
    onClose();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <DialogHeader>
            <DialogTitle>{session ? "Edit session" : "New SSH session"}</DialogTitle>
            <DialogDescription style={{ color: "var(--muted-fg)" }}>
              {session ? "Update connection details." : "Where are you connecting, and which credentials should be used?"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {error && (
              <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
            )}

            {/* Connection */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Host / IP address</Label>
                <Input
                  placeholder="192.168.1.1 or server.example.com"
                  value={host}
                  onChange={e => { setHost(e.target.value); if (!session && !name) setName(e.target.value); }}
                  autoFocus
                  className="font-mono"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Display name</Label>
                  <Input placeholder="My Server" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Port</Label>
                  <Input type="number" placeholder="22" value={port} onChange={e => setPort(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Credential picker */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>
                  Credential profile
                </Label>
                {profiles.length > 0 && (
                  <span className="text-xs" style={{ color: "var(--subtle-fg)" }}>
                    {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}
                  </span>
                )}
              </div>
              <ProfilePicker
                profiles={profiles}
                selectedId={profileId}
                onSelect={setProfileId}
                onNewProfile={() => setProfileDialogOpen(true)}
                showNoneOption
              />
            </div>

            {/* Folder + Jump host */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold flex items-center gap-1.5" style={{ color: "var(--muted-fg)" }}>
                  <FolderClosed className="h-3.5 w-3.5" />
                  Folder
                </Label>
                {newFolderInput ? (
                  <div className="flex gap-1">
                    <Input
                      placeholder="Folder name"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setNewFolderInput(false); }}
                      autoFocus
                    />
                    <Button size="sm" onClick={createFolder} style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}>Add</Button>
                  </div>
                ) : (
                  <Select value={folderId} onValueChange={(v) => { if (v === "__new__") setNewFolderInput(true); else setFolderId(v ?? ""); }}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="No folder" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— No folder —</SelectItem>
                      {folders.map(f => (
                        <SelectItem key={f.id} value={String(f.id)}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: COLOR_HEX[f.color as ProfileColor] || COLOR_HEX.cyan }} />
                            {f.name}
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ New folder…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold flex items-center gap-1.5" style={{ color: "var(--muted-fg)" }}>
                  <Network className="h-3.5 w-3.5" />
                  Jump host (ProxyJump)
                </Label>
                <Input
                  placeholder="user@bastion.example.com"
                  value={jumpHost}
                  onChange={e => setJumpHost(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>
                Tags <span className="font-normal" style={{ color: "var(--subtle-fg)" }}>(Enter or comma to add)</span>
              </Label>
              <div className="flex flex-wrap gap-1.5 p-2.5 border rounded-lg min-h-10 transition-shadow" style={{ borderColor: "var(--border)", background: "var(--input)" }}>
                {tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1.5 h-6 font-normal">
                    {tag}
                    <button onClick={() => setTags(tags.filter(t => t !== tag))} className="hover:text-destructive ml-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  className="flex-1 min-w-24 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                  placeholder={tags.length === 0 ? "production, web, aws…" : ""}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={addTag}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>
                Notes <span className="font-normal" style={{ color: "var(--subtle-fg)" }}>(optional)</span>
              </Label>
              <Textarea
                placeholder="Purpose, location, anything useful…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
            >
              {saving ? "Saving…" : session ? "Save changes" : "Create session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProfileDialog
        open={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
        onSave={(saved) => {
          onProfilesChanged();
          if (saved?.id) setProfileId(saved.id);
        }}
        backLabel="Back to session"
      />
    </>
  );
}
