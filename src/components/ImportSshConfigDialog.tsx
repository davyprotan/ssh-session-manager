"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Server, KeyRound, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface SshConfigEntry {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function ImportSshConfigDialog({ open, onClose, onImported }: Props) {
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<SshConfigEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    fetch("/api/import-ssh-config")
      .then(r => r.json())
      .then(data => {
        if (!data.available) {
          setError(data.error || "No ~/.ssh/config found");
          setEntries([]);
        } else {
          setEntries(data.entries || []);
          setSelected(new Set((data.entries || []).map((e: SshConfigEntry) => e.host)));
          setPath(data.path);
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  function toggle(host: string) {
    const next = new Set(selected);
    if (next.has(host)) next.delete(host);
    else next.add(host);
    setSelected(next);
  }

  async function handleImport() {
    setImporting(true);
    const toImport = entries.filter(e => selected.has(e.host));
    const res = await fetch("/api/import-ssh-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: toImport }),
    });
    setImporting(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(`Imported ${data.imported} session${data.imported !== 1 ? "s" : ""}`, {
        description: data.skipped ? `Skipped ${data.skipped} duplicates` : undefined,
      });
      onImported();
      onClose();
    } else {
      toast.error("Import failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-hidden flex flex-col" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" style={{ color: "var(--accent)" }} />
            Import from ~/.ssh/config
          </DialogTitle>
          <DialogDescription style={{ color: "var(--muted-fg)" }}>
            Select which hosts to import. We&apos;ll create matching credential profiles automatically.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12" style={{ color: "var(--muted-fg)" }}>
            Reading config…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 5%, transparent)", color: "var(--muted-fg)" }}>
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-mono px-1" style={{ color: "var(--subtle-fg)" }}>{path}</p>

            <div className="flex items-center justify-between text-xs px-1">
              <span style={{ color: "var(--muted-fg)" }}>{selected.size} of {entries.length} selected</span>
              <div className="flex gap-2">
                <button
                  className="hover:underline"
                  style={{ color: "var(--accent)" }}
                  onClick={() => setSelected(new Set(entries.map(e => e.host)))}
                >Select all</button>
                <span style={{ color: "var(--subtle-fg)" }}>·</span>
                <button
                  className="hover:underline"
                  style={{ color: "var(--accent)" }}
                  onClick={() => setSelected(new Set())}
                >Deselect all</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 -mx-1 px-1">
              {entries.length === 0 ? (
                <p className="text-sm py-8 text-center" style={{ color: "var(--muted-fg)" }}>No hosts found in your config</p>
              ) : entries.map(e => {
                const checked = selected.has(e.host);
                return (
                  <button
                    key={e.host}
                    onClick={() => toggle(e.host)}
                    className="w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all"
                    style={{
                      borderColor: checked ? "color-mix(in srgb, var(--accent) 50%, transparent)" : "var(--border)",
                      background: checked ? "color-mix(in srgb, var(--accent) 7%, transparent)" : "transparent",
                    }}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded mt-0.5" style={{
                      background: checked ? "var(--accent)" : "transparent",
                      border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                    }}>
                      {checked && <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--accent-foreground)" }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Server className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-fg)" }} />
                        <span className="font-semibold text-[14px]" style={{ color: "var(--foreground)" }}>{e.host}</span>
                        {e.hostname && e.hostname !== e.host && (
                          <span className="text-[12px] font-mono" style={{ color: "var(--accent)" }}>→ {e.hostname}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {e.user && <span className="text-[12px] font-mono" style={{ color: "var(--muted-fg)" }}>{e.user}</span>}
                        {e.port && e.port !== 22 && <span className="text-[12px]" style={{ color: "var(--subtle-fg)" }}>port {e.port}</span>}
                        {e.identityFile && (
                          <span className="text-[12px] font-mono truncate flex items-center gap-1" style={{ color: "var(--subtle-fg)" }}>
                            <KeyRound className="h-3 w-3" /> {e.identityFile.split("/").pop()}
                          </span>
                        )}
                        {e.proxyJump && (
                          <span className="text-[12px]" style={{ color: "var(--subtle-fg)" }}>via {e.proxyJump}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={importing || selected.size === 0 || !!error}
            style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
          >
            {importing ? "Importing…" : `Import ${selected.size} session${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
