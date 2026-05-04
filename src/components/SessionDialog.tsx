"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X, Key, Lock } from "lucide-react";
import type { Profile, Session } from "@/lib/db";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  session?: Session | null;
  profiles: Profile[];
}

export default function SessionDialog({ open, onClose, onSave, session, profiles }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [profileId, setProfileId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (session) {
      setName(session.name);
      setHost(session.host);
      setPort(String(session.port));
      setProfileId(session.profile_id ? String(session.profile_id) : "");
      setNotes(session.notes || "");
      setTags(JSON.parse(session.tags || "[]"));
    } else {
      setName("");
      setHost("");
      setPort("22");
      setProfileId(profiles.length > 0 ? String(profiles[0].id) : "");
      setNotes("");
      setTags([]);
    }
    setError("");
  }, [session, open, profiles]);

  function addTag(e: React.KeyboardEvent) {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().replace(/,$/, "");
      if (t && !tags.includes(t)) setTags([...tags, t]);
      setTagInput("");
    }
  }

  async function handleSave() {
    setError("");
    if (!name.trim() || !host.trim()) {
      setError("Name and host are required.");
      return;
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port) || 22,
      profile_id: profileId ? parseInt(profileId) : null,
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

  const selectedProfile = profiles.find(p => String(p.id) === profileId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg border-border/60">
        <DialogHeader>
          <DialogTitle>{session ? "Edit session" : "New SSH session"}</DialogTitle>
          <DialogDescription className="text-muted-foreground/70">
            {session ? "Update connection details." : "Enter connection details and choose a credential profile."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Host / IP address</Label>
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
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Display name</Label>
              <Input placeholder="My Server" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Port</Label>
              <Input type="number" placeholder="22" value={port} onChange={e => setPort(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Credential profile</Label>
            {profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
                No profiles yet — create one in the Profiles tab first.
              </p>
            ) : (
              <Select value={profileId} onValueChange={(v) => setProfileId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a profile…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— No profile —</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      <span className="flex items-center gap-2">
                        {p.auth_type === "password"
                          ? <Lock className="h-3 w-3 text-amber-400" />
                          : <Key className="h-3 w-3 text-primary" />}
                        {p.name}
                        <span className="text-muted-foreground font-mono text-xs">({p.username})</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedProfile && (
              <p className="text-xs text-muted-foreground/60 px-1">
                {selectedProfile.auth_type === "key" || selectedProfile.auth_type === "key_with_passphrase"
                  ? `Key: ${selectedProfile.key_path}`
                  : "Password authentication"}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Tags <span className="normal-case">(Enter or comma to add)</span>
            </Label>
            <div className="flex flex-wrap gap-1.5 p-2.5 border border-input rounded-lg min-h-10 bg-transparent focus-within:ring-2 focus-within:ring-ring/50 transition-shadow">
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

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Notes <span className="normal-case">(optional)</span>
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
          <Button variant="outline" onClick={onClose} className="border-border/60">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-primary/90 hover:bg-primary shadow-sm shadow-primary/20">
            {saving ? "Saving…" : session ? "Save changes" : "Create session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
