"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FileText, Download, Upload, Settings as SettingsIcon, FolderInput,
  ShieldCheck, Lock, Database, RotateCcw, Trash2, AlertCircle, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";

interface BackupInfo {
  filename: string;
  size: number;
  encrypted: boolean;
  contains_secrets: boolean;
  created_at: string;
  format_version: number | null;
  invalid?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenSshImport: () => void;
}

export default function SettingsDialog({ open, onClose, onChanged, onOpenSshImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsDir, setBackupsDir] = useState("");

  const [encryptOpen, setEncryptOpen] = useState(false);
  const [bkPassword, setBkPassword] = useState("");
  const [bkPasswordConfirm, setBkPasswordConfirm] = useState("");
  const [bkShowPwd, setBkShowPwd] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [creating, setCreating] = useState(false);

  const [restoreFile, setRestoreFile] = useState<BackupInfo | null>(null);
  const [restorePwd, setRestorePwd] = useState("");
  const [restoring, setRestoring] = useState(false);

  async function fetchBackups() {
    const res = await fetch("/api/backup/list");
    if (res.ok) {
      const data = await res.json();
      setBackups(data.backups || []);
      setBackupsDir(data.dir || "");
    }
  }

  useEffect(() => { if (open) fetchBackups(); }, [open]);

  function handleQuickExport() {
    window.location.href = "/api/export";
    toast.success("Backup downloaded (no passwords)");
  }

  async function createBackup(encrypted: boolean) {
    if (encrypted) {
      if (!bkPassword || bkPassword.length < 12) {
        toast.error("Password must be at least 12 characters");
        return;
      }
      if (bkPassword !== bkPasswordConfirm) {
        toast.error("Passwords don't match");
        return;
      }
    }
    setCreating(true);
    const res = await fetch("/api/backup/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: encrypted ? bkPassword : undefined,
        include_secrets: includeSecrets,
      }),
    });
    setCreating(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(encrypted ? "Encrypted backup saved" : "Backup saved", {
        description: data.path,
      });
      setBkPassword("");
      setBkPasswordConfirm("");
      setEncryptOpen(false);
      fetchBackups();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error("Backup failed", { description: err.error });
    }
  }

  function triggerFilePicker() { fileInputRef.current?.click(); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // If encrypted, prompt for password
      if (data.format === "ssh-manager-backup" && data.encrypted) {
        const pwd = window.prompt("This backup is encrypted. Enter password:");
        if (!pwd) { e.target.value = ""; return; }
        data.password = pwd;
      }

      setImporting(true);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, mode: "merge" }),
      });
      setImporting(false);
      if (res.ok) {
        const r = await res.json();
        toast.success("Backup imported", {
          description: `${r.profilesAdded} profiles, ${r.sessionsAdded} sessions, ${r.foldersAdded} folders`,
        });
        onChanged();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error("Import failed", { description: err.error });
      }
    } catch (err) {
      setImporting(false);
      toast.error("Invalid backup file", { description: String(err) });
    }
    e.target.value = "";
  }

  async function handleRestore(b: BackupInfo) {
    if (b.encrypted && !restorePwd) {
      setRestoreFile(b);
      return;
    }
    setRestoring(true);
    const res = await fetch("/api/backup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: b.filename, password: b.encrypted ? restorePwd : undefined, mode: "merge" }),
    });
    setRestoring(false);
    if (res.ok) {
      const r = await res.json();
      toast.success("Restored from backup", {
        description: `${r.profilesAdded} profiles, ${r.sessionsAdded} sessions, ${r.foldersAdded} folders`,
      });
      setRestoreFile(null);
      setRestorePwd("");
      onChanged();
      onClose();
    } else {
      const err = await res.json().catch(() => ({}));
      if (err.needs_password) {
        toast.error("Password required");
      } else {
        toast.error("Restore failed", { description: err.error });
      }
    }
  }

  async function handleDelete(b: BackupInfo) {
    if (!window.confirm(`Delete backup "${b.filename}"?`)) return;
    const res = await fetch("/api/backup/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: b.filename }),
    });
    if (res.ok) {
      toast.success("Backup deleted");
      fetchBackups();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" style={{ color: "var(--accent)" }} />
            Settings & Backups
          </DialogTitle>
          <DialogDescription style={{ color: "var(--muted-fg)" }}>
            Manage your data, create encrypted backups, or restore from history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Quick actions */}
          <Section title="Tools">
            <SettingItem
              icon={<FileText className="h-4 w-4" />}
              title="Import from ~/.ssh/config"
              description="Pull in existing hosts you already have configured"
              onClick={onOpenSshImport}
            />
            <SettingItem
              icon={<Upload className="h-4 w-4" />}
              title={importing ? "Importing…" : "Import a backup file"}
              description="Pick a JSON or .encrypted.json from anywhere"
              onClick={triggerFilePicker}
              disabled={importing}
            />
            <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFile} className="hidden" />
          </Section>

          {/* Create backup */}
          <Section title="Create backup">
            {!encryptOpen ? (
              <>
                <SettingItem
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Encrypted backup (recommended)"
                  description="AES-256-GCM with your password — includes saved passwords, safe to store anywhere"
                  onClick={() => setEncryptOpen(true)}
                  highlight
                />
                <SettingItem
                  icon={<Database className="h-4 w-4" />}
                  title="Plain JSON (no passwords)"
                  description="Saves to ~/.ssh-session-manager/backups/ — readable, no secrets"
                  onClick={() => createBackup(false)}
                  disabled={creating}
                />
                <SettingItem
                  icon={<Download className="h-4 w-4" />}
                  title="Download to my computer"
                  description="Quick download of plain JSON (no passwords) to your Downloads folder"
                  onClick={handleQuickExport}
                />
              </>
            ) : (
              <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)", background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}>
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4" style={{ color: "var(--accent)" }} />
                  <span className="font-semibold text-[14px]" style={{ color: "var(--foreground)" }}>Set a backup password</span>
                </div>
                <p className="text-[12px]" style={{ color: "var(--muted-fg)" }}>
                  You&apos;ll need this exact password to restore. There&apos;s no recovery — write it down.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Password (12+ characters)</Label>
                  <div className="relative">
                    <Input
                      type={bkShowPwd ? "text" : "password"}
                      value={bkPassword}
                      onChange={e => setBkPassword(e.target.value)}
                      placeholder="•••••••••"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setBkShowPwd(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      style={{ color: "var(--muted-fg)" }}
                      aria-label={bkShowPwd ? "Hide password" : "Show password"}
                    >
                      {bkShowPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Confirm password</Label>
                  <Input type={bkShowPwd ? "text" : "password"} value={bkPasswordConfirm} onChange={e => setBkPasswordConfirm(e.target.value)} placeholder="•••••••••" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" onClick={() => { setEncryptOpen(false); setBkPassword(""); setBkPasswordConfirm(""); }}>Cancel</Button>
                  <Button
                    onClick={() => createBackup(true)}
                    disabled={creating || bkPassword.length < 12 || bkPassword !== bkPasswordConfirm}
                    style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                    {creating ? "Encrypting…" : "Create encrypted backup"}
                  </Button>
                </div>
              </div>
            )}
          </Section>

          {/* History */}
          <Section title={`Backup history${backups.length ? ` (${backups.length})` : ""}`}>
            {backups.length === 0 ? (
              <p className="text-[12.5px] py-2" style={{ color: "var(--muted-fg)" }}>
                No backups yet. Create one above — they&apos;ll be saved to your home folder.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {backups.map(b => (
                  <BackupRow
                    key={b.filename}
                    info={b}
                    onRestore={() => handleRestore(b)}
                    onDelete={() => handleDelete(b)}
                  />
                ))}
              </div>
            )}
            <p className="text-[11px] flex items-center gap-1.5 pt-2" style={{ color: "var(--subtle-fg)" }}>
              <FolderInput className="h-3 w-3" />
              <span className="font-mono truncate">{backupsDir}</span>
            </p>
          </Section>
        </div>

        {/* Restore password prompt */}
        <Dialog open={!!restoreFile} onOpenChange={v => !v && setRestoreFile(null)}>
          <DialogContent className="sm:max-w-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4" style={{ color: "var(--accent)" }} />
                Encrypted backup
              </DialogTitle>
              <DialogDescription style={{ color: "var(--muted-fg)" }}>
                Enter the password used when this backup was created.
              </DialogDescription>
            </DialogHeader>
            <Input
              type="password"
              autoFocus
              value={restorePwd}
              onChange={e => setRestorePwd(e.target.value)}
              placeholder="Backup password"
              onKeyDown={e => { if (e.key === "Enter" && restoreFile) handleRestore(restoreFile); }}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setRestoreFile(null); setRestorePwd(""); }}>Cancel</Button>
              <Button
                onClick={() => restoreFile && handleRestore(restoreFile)}
                disabled={restoring || !restorePwd}
                style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
              >
                {restoring ? "Restoring…" : "Restore"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-fg)" }}>{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function SettingItem({ icon, title, description, onClick, disabled, highlight }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all disabled:opacity-50"
      style={{
        border: `1px solid ${highlight ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "var(--border)"}`,
        background: highlight ? "color-mix(in srgb, var(--accent) 5%, transparent)" : "transparent",
      }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>{title}</p>
        <p className="text-[12px] mt-0.5 whitespace-normal" style={{ color: "var(--muted-fg)" }}>{description}</p>
      </div>
    </button>
  );
}

function BackupRow({ info, onRestore, onDelete }: { info: BackupInfo; onRestore: () => void; onDelete: () => void }) {
  const ago = timeAgo(info.created_at);
  const sizeMb = (info.size / 1024).toFixed(0);
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 border" style={{ borderColor: "var(--border)" }}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0" style={{
        background: info.encrypted ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "color-mix(in srgb, var(--fg) 5%, transparent)",
        color: info.encrypted ? "var(--accent)" : "var(--muted-fg)",
      }}>
        {info.encrypted ? <Lock className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-mono truncate" style={{ color: "var(--foreground)" }}>{info.filename}</p>
        <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: "var(--subtle-fg)" }}>
          <span>{ago}</span>
          <span>·</span>
          <span>{sizeMb} KB</span>
          {info.encrypted && <><span>·</span><span style={{ color: "var(--accent)" }}>encrypted</span></>}
          {!info.encrypted && info.contains_secrets && <><span>·</span><span style={{ color: "#fbbf24" }}>contains secrets</span></>}
          {info.invalid && <><span>·</span><span className="flex items-center gap-1" style={{ color: "var(--destructive)" }}><AlertCircle className="h-3 w-3" />{info.invalid}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="ghost" onClick={onRestore} disabled={!!info.invalid} title="Restore" className="h-8 w-8 p-0" style={{ color: "var(--muted-fg)" }}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Delete" className="h-8 w-8 p-0" style={{ color: "var(--muted-fg)" }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
