"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Key, Terminal as TerminalIcon, Check, AlertCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { Session, Profile } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  profile: Profile | null;
  onDone: () => void;
}

type Step = "intro" | "running" | "verify";

export default function SetupPasswordlessDialog({ open, onClose, session, profile, onDone }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [generating, setGenerating] = useState(false);
  const [keyPath, setKeyPath] = useState<string>("");
  const [pubPath, setPubPath] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setStep("intro");
    setError("");
    setKeyPath("");
    setPubPath("");
  }, [open]);

  if (!session || !profile) return null;

  const username = profile.username;
  const host = session.host;
  const port = session.port;
  const jumpHost = session.jump_host;

  async function setUp() {
    if (!session || !profile) return;
    setGenerating(true);
    setError("");

    // Use existing key if profile already has one and the file exists; otherwise generate.
    let privPath = profile.key_path || "";
    let pubKeyPath = "";

    if (privPath) {
      const validate = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: privPath }),
      });
      const v = await validate.json();
      if (v.exists) {
        pubKeyPath = privPath.replace(/^~/, "") + ".pub";
      } else {
        privPath = "";
      }
    }

    if (!privPath) {
      // Generate a new key for this user@host
      const safeName = `${username}-at-${host}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
      const res = await fetch("/api/keys/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: safeName,
          comment: `${username}@${host} (created by SSH Manager)`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Failed to generate SSH key");
        setGenerating(false);
        return;
      }
      const k = await res.json();
      privPath = k.privatePath;
      pubKeyPath = k.publicPath;
      setKeyPath(privPath);
      setPubPath(pubKeyPath);
    } else {
      setKeyPath(privPath);
      setPubPath(pubKeyPath);
    }

    // Open terminal with ssh-copy-id
    const copyRes = await fetch("/api/keys/copy-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        username,
        port,
        public_key_path: pubKeyPath,
        jump_host: jumpHost || undefined,
      }),
    });

    if (!copyRes.ok) {
      const err = await copyRes.json().catch(() => ({}));
      setError(err.error || "Failed to launch ssh-copy-id");
      setGenerating(false);
      return;
    }

    setGenerating(false);
    setStep("running");
  }

  async function confirmAndSwitch() {
    if (!profile || !session) return;
    setGenerating(true);

    // Update the profile to use key auth, pointing at the new key
    const res = await fetch(`/api/profiles/${profile.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...profile,
        auth_type: "key",
        key_path: keyPath,
        password: "", // clear stored password
      }),
    });

    setGenerating(false);
    if (!res.ok) {
      setError("Failed to update profile");
      return;
    }

    toast.success(`"${profile.name}" is now key-based`, {
      description: "No more password prompts on connect",
    });
    onDone();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}>
              <ShieldCheck className="h-4 w-4" style={{ color: "var(--accent)" }} />
            </div>
            Set up passwordless login
          </DialogTitle>
          <DialogDescription style={{ color: "var(--muted-fg)" }}>
            Switch from password to SSH key auth — no more typing passwords on connect.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "color-mix(in srgb, var(--destructive) 8%, transparent)", borderColor: "var(--destructive)" }}>
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--destructive)" }} />
            <p className="text-[13px]" style={{ color: "var(--destructive)" }}>{error}</p>
          </div>
        )}

        {step === "intro" && (
          <div className="space-y-3 py-1">
            <div className="rounded-lg p-3" style={{ background: "color-mix(in srgb, var(--fg) 4%, transparent)", border: "1px solid var(--border)" }}>
              <p className="text-[12.5px] font-mono" style={{ color: "var(--accent)" }}>
                {username}@{host}{port !== 22 ? `:${port}` : ""}
              </p>
              {jumpHost && (
                <p className="text-[11.5px] font-mono mt-1" style={{ color: "var(--subtle-fg)" }}>via {jumpHost}</p>
              )}
            </div>

            <div className="space-y-2.5">
              <Step n={1} title="Generate or reuse a key" desc={`We'll ${profile.key_path ? "use your existing key" : "create a new ed25519 key"} for ${username}@${host}.`} />
              <Step n={2} title="Run ssh-copy-id in Terminal" desc="A terminal opens with the command pre-typed. Press Return to run, type your password ONE LAST TIME." />
              <Step n={3} title="Switch profile to key auth" desc="After the key is installed, this profile becomes passwordless." />
            </div>
          </div>
        )}

        {step === "running" && (
          <div className="space-y-3 py-1">
            <div className="rounded-lg p-3" style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>
              <p className="text-[13px] font-semibold flex items-center gap-2" style={{ color: "var(--accent)" }}>
                <TerminalIcon className="h-3.5 w-3.5" /> Terminal is open with ssh-copy-id
              </p>
              <p className="text-[12px] mt-1.5" style={{ color: "var(--muted-fg)" }}>
                In the terminal:
              </p>
              <ol className="list-decimal pl-4 mt-1 space-y-0.5 text-[12px]" style={{ color: "var(--muted-fg)" }}>
                <li>Press <span className="font-mono">Return</span> to run the command</li>
                <li>Type your password and press <span className="font-mono">Return</span></li>
                <li>You should see <span className="font-mono">Number of key(s) added: 1</span></li>
                <li>Come back here and click <span className="font-semibold">It worked</span></li>
              </ol>
            </div>

            <p className="text-[11px]" style={{ color: "var(--subtle-fg)" }}>
              Public key being installed: <span className="font-mono">{pubPath}</span>
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "intro" && (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={setUp}
                disabled={generating}
                className="gap-1.5"
                style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
              >
                <Key className="h-3.5 w-3.5" />
                {generating ? "Setting up…" : "Set up passwordless login"}
              </Button>
            </>
          )}
          {step === "running" && (
            <>
              <Button variant="outline" onClick={onClose}>I&apos;ll do this later</Button>
              <Button
                onClick={confirmAndSwitch}
                disabled={generating}
                className="gap-1.5"
                style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
              >
                <Check className="h-3.5 w-3.5" />
                {generating ? "Switching…" : "It worked — switch to key auth"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold mt-0.5" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
        {n}
      </div>
      <div>
        <p className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: "var(--foreground)" }}>
          {title}
          {n < 3 && <ArrowRight className="h-3 w-3" style={{ color: "var(--subtle-fg)" }} />}
        </p>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-fg)" }}>{desc}</p>
      </div>
    </div>
  );
}
