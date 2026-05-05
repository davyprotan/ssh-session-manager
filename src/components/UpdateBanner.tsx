"use client";

import { useEffect, useState } from "react";
import { Download, X, Sparkles } from "lucide-react";

const LAST_CHECK_KEY = "ssh-manager-last-update-check";
const DISMISSED_VERSION_KEY = "ssh-manager-dismissed-version";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
    // Throttle: only hit GitHub once per 24h
    let lastCheck = 0;
    try { lastCheck = parseInt(localStorage.getItem(LAST_CHECK_KEY) || "0"); } catch {}

    const since = Date.now() - lastCheck;
    const stale = since > CHECK_INTERVAL_MS || isNaN(lastCheck);

    if (!stale) {
      // Use cached result if we have one
      try {
        const cached = localStorage.getItem("ssh-manager-update-cache");
        if (cached) setInfo(JSON.parse(cached));
      } catch {}
      return;
    }

    fetch("/api/update-check")
      .then(r => r.json())
      .then((data: UpdateInfo) => {
        setInfo(data);
        try {
          localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
          localStorage.setItem("ssh-manager-update-cache", JSON.stringify(data));
        } catch {}
      })
      .catch(() => {/* silent */});
  }, []);

  if (!info?.available || !info.latest) return null;

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
      className="border-b px-4 py-2 flex items-center gap-3"
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
