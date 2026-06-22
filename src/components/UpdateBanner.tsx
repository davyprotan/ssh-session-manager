"use client";

import { useEffect, useState } from "react";
import { Download, X, Sparkles } from "lucide-react";
import packageJson from "../../package.json";

const LAST_CHECK_KEY = "ssh-manager-last-update-check";
const DISMISSED_VERSION_KEY = "ssh-manager-dismissed-version";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const APP_VERSION = packageJson.version;

function parseSemver(v: string): [number, number, number] | null {
  const m = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

interface UpdateInfo {
  available: boolean;
  current: string;
  latest?: string;
  release_url?: string;
  release_name?: string;
  reason?: string;
}

export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Throttle: only hit GitHub once per 24h. Both branches resolve via a Promise
    // callback so the eventual setInfo() is never called synchronously from the
    // effect body — this avoids cascading-render lint warnings.
    let cancelled = false;

    let lastCheck = 0;
    try { lastCheck = parseInt(localStorage.getItem(LAST_CHECK_KEY) || "0"); } catch {}
    const since = Date.now() - lastCheck;
    const stale = since > CHECK_INTERVAL_MS || isNaN(lastCheck);

    const work: Promise<UpdateInfo | null> = stale
      ? fetch("/api/update-check")
          .then(r => r.json())
          .then((data: UpdateInfo) => {
            try {
              localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
              localStorage.setItem("ssh-manager-update-cache", JSON.stringify(data));
            } catch {}
            return data;
          })
      : Promise.resolve().then<UpdateInfo | null>(() => {
          try {
            const cached = localStorage.getItem("ssh-manager-update-cache");
            return cached ? (JSON.parse(cached) as UpdateInfo) : null;
          } catch { return null; }
        });

    work.then((data) => { if (!cancelled && data) setInfo(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!info?.available || !info.latest) return null;

  // The cached `available` flag was computed server-side against whatever build
  // was installed at check time. After an in-place upgrade, that cache can stay
  // stale for up to 24h and keep showing the banner even though we're now on the
  // latest version. Re-verify against the actually-installed build version.
  if (!isNewer(info.latest, APP_VERSION)) return null;

  // Respect "dismissed for this version"
  let dismissedVersion = "";
  try { dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY) || ""; } catch {}
  if (dismissedVersion === info.latest) return null;

  function dismiss() {
    try { localStorage.setItem(DISMISSED_VERSION_KEY, info!.latest!); } catch {}
    setInfo({ ...info!, available: false });
  }

  function download() {
    if (info?.release_url) window.open(info.release_url, "_blank");
  }

  return (
    <div
      className="app-drag-region border-b px-4 py-2 flex items-center gap-3"
      style={{
        background: "color-mix(in srgb, var(--accent) 8%, var(--background))",
        borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
      }}
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}>
        <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
      </div>
      <div className="flex-1 min-w-0 text-[13px]">
        <span className="font-semibold" style={{ color: "var(--foreground)" }}>
          {info.release_name || info.latest} is available
        </span>
        <span className="ml-2" style={{ color: "var(--muted-fg)" }}>
          You&apos;re on v{info.current}
        </span>
      </div>
      <button
        onClick={download}
        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[12.5px] font-semibold transition-all"
        style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        <Download className="h-3 w-3" />
        Download
      </button>
      <button
        onClick={dismiss}
        className="h-7 w-7 rounded-md flex items-center justify-center transition-colors"
        style={{ color: "var(--muted-fg)" }}
        aria-label={`Dismiss ${info.latest}`}
        title={`Don't show again for ${info.latest}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
