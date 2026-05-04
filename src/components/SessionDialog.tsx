"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import ProfilePicker from "./ProfilePicker";
import ProfileDialog from "./ProfileDialog";
import type { Profile, Session } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  session?: Session | null;
  profiles: Profile[];
  onProfilesChanged: () => void;
}

export default function SessionDialog({ open, onClose, onSave, session, profiles, onProfilesChanged }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  useEffect(() => {
    if (session) {
      setName(session.name);
      setHost(session.host);
      setPort(String(session.port));
      setProfileId(session.profile_id);
      setNotes(session.notes || "");
      setTags(JSON.parse(session.tags || "[]"));
    } else {
      setName("");
      setHost("");
      setPort("22");
      // Auto-select default profile, or first one
      const defaultProfile = profiles.find(p => p.is_default) || profiles[0];
      setProfileId(defaultProfile?.id ?? null);
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
      setError("Host and display name are required.");
      return;
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port) || 22,
      profile_id: profileId,
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
            <DialogDescription style={{ color: "var(--muted-foreground)" }}>
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
                <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Host / IP address</Label>
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
                  <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Display name</Label>
                  <Input placeholder="My Server" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Port</Label>
                  <Input type="number" placeholder="22" value={port} onChange={e => setPort(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Credential picker */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
                  Credential profile
                </Label>
                {profiles.length > 0 && (
                  <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
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

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
                Tags <span className="normal-case">(Enter or comma to add)</span>
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
              <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
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

      {/* Inline profile creation */}
      <ProfileDialog
        open={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
        onSave={(saved) => {
          onProfilesChanged();
          if (saved?.id) setProfileId(saved.id);
        }}
      />
    </>
  );
}
