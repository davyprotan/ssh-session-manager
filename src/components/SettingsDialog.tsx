"use client";

import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download, Upload, Settings as SettingsIcon, FolderInput } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenSshImport: () => void;
}

export default function SettingsDialog({ open, onClose, onChanged, onOpenSshImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  function handleExport() {
    // Trigger browser download
    window.location.href = "/api/export";
    toast.success("Backup exported");
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
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
          description: `${r.profilesAdded} profiles, ${r.sessionsAdded} sessions, ${r.foldersAdded} folders added`,
        });
        onChanged();
        onClose();
      } else {
        toast.error("Import failed");
      }
    } catch (err) {
      setImporting(false);
      toast.error("Invalid backup file", { description: String(err) });
    }
    e.target.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" style={{ color: "var(--accent)" }} />
            Settings & Tools
          </DialogTitle>
          <DialogDescription style={{ color: "var(--muted-fg)" }}>
            Import existing config, back up your data, or restore a backup.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <SettingItem
            icon={<FileText className="h-4 w-4" />}
            title="Import from ~/.ssh/config"
            description="Pull in existing hosts you already have configured"
            onClick={() => { onOpenSshImport(); onClose(); }}
          />

          <SettingItem
            icon={<Download className="h-4 w-4" />}
            title="Export backup"
            description="Download all profiles, sessions, and folders as JSON"
            onClick={handleExport}
          />

          <SettingItem
            icon={<Upload className="h-4 w-4" />}
            title={importing ? "Importing…" : "Import backup"}
            description="Merge a previously-exported JSON file"
            onClick={triggerFilePicker}
            disabled={importing}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFile}
            className="hidden"
          />
        </div>

        <div className="text-[11px] pt-2 border-t flex items-center gap-1.5" style={{ color: "var(--subtle-fg)", borderColor: "var(--border)" }}>
          <FolderInput className="h-3 w-3" />
          Data lives in <span className="font-mono">~/.ssh-session-manager/</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingItem({ icon, title, description, onClick, disabled }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      className="w-full h-auto justify-start gap-3 p-3 rounded-xl text-left disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>{title}</p>
        <p className="text-[12px] mt-0.5 whitespace-normal" style={{ color: "var(--muted-fg)" }}>{description}</p>
      </div>
    </Button>
  );
}
