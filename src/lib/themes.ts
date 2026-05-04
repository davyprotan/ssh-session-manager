export interface Theme {
  id: string;
  name: string;
  description: string;
  // CSS variables
  accent: string;
  accentForeground: string;
  bg: string;
  fg: string;
  card: string;
  cardElevated: string;
  muted: string;
  mutedFg: string;
  border: string;
  // For preview chips
  preview: [string, string]; // [accent, bg]
}

export const THEMES: Theme[] = [
  {
    id: "cyan",
    name: "Cyan Terminal",
    description: "Classic terminal cyan on deep blue-black",
    accent: "#22d3ee",
    accentForeground: "#0d1117",
    bg: "#0d1117",
    fg: "#e6edf3",
    card: "#161b22",
    cardElevated: "#1c2128",
    muted: "#1c2128",
    mutedFg: "#8b949e",
    border: "rgba(48, 54, 61, 0.9)",
    preview: ["#22d3ee", "#0d1117"],
  },
  {
    id: "emerald",
    name: "Matrix",
    description: "Hacker-green on midnight",
    accent: "#34d399",
    accentForeground: "#0a0f0a",
    bg: "#0a0f0a",
    fg: "#e0f0e6",
    card: "#10171d",
    cardElevated: "#162127",
    muted: "#13191c",
    mutedFg: "#8a9a91",
    border: "rgba(40, 60, 50, 0.85)",
    preview: ["#34d399", "#0a0f0a"],
  },
  {
    id: "amber",
    name: "Amber Glow",
    description: "Warm amber on graphite",
    accent: "#fbbf24",
    accentForeground: "#1a1410",
    bg: "#13110d",
    fg: "#f0e8d8",
    card: "#1d1a13",
    cardElevated: "#26221a",
    muted: "#1f1c14",
    mutedFg: "#9a9082",
    border: "rgba(70, 60, 40, 0.85)",
    preview: ["#fbbf24", "#13110d"],
  },
  {
    id: "violet",
    name: "Violet Storm",
    description: "Electric violet on cosmic black",
    accent: "#a78bfa",
    accentForeground: "#0e0d1a",
    bg: "#0e0d1a",
    fg: "#e8e4f5",
    card: "#171625",
    cardElevated: "#1f1d31",
    muted: "#1a1828",
    mutedFg: "#928aa6",
    border: "rgba(60, 50, 80, 0.85)",
    preview: ["#a78bfa", "#0e0d1a"],
  },
  {
    id: "rose",
    name: "Rose Garden",
    description: "Soft pink on charcoal",
    accent: "#f472b6",
    accentForeground: "#170d14",
    bg: "#170d14",
    fg: "#f0e0e8",
    card: "#22141d",
    cardElevated: "#2c1c25",
    muted: "#241620",
    mutedFg: "#9c8a92",
    border: "rgba(80, 50, 65, 0.85)",
    preview: ["#f472b6", "#170d14"],
  },
  {
    id: "crimson",
    name: "Crimson",
    description: "Bold red on noir",
    accent: "#f87171",
    accentForeground: "#15090a",
    bg: "#15090a",
    fg: "#f0dcdc",
    card: "#1f1213",
    cardElevated: "#2a1819",
    muted: "#211415",
    mutedFg: "#a88a8a",
    border: "rgba(85, 45, 45, 0.85)",
    preview: ["#f87171", "#15090a"],
  },
  {
    id: "sky",
    name: "Sky High",
    description: "Crisp sky-blue on slate",
    accent: "#38bdf8",
    accentForeground: "#0a121b",
    bg: "#0a121b",
    fg: "#dceaf5",
    card: "#121d2a",
    cardElevated: "#1a2638",
    muted: "#13202d",
    mutedFg: "#7d92aa",
    border: "rgba(40, 60, 85, 0.85)",
    preview: ["#38bdf8", "#0a121b"],
  },
  {
    id: "lime",
    name: "Lime Light",
    description: "Vivid lime on forest dark",
    accent: "#a3e635",
    accentForeground: "#0d130a",
    bg: "#0d130a",
    fg: "#e0eed5",
    card: "#161e10",
    cardElevated: "#1e2818",
    muted: "#181f12",
    mutedFg: "#8a9580",
    border: "rgba(50, 65, 40, 0.85)",
    preview: ["#a3e635", "#0d130a"],
  },
  {
    id: "slate",
    name: "Monochrome",
    description: "Minimal silver on jet",
    accent: "#cbd5e1",
    accentForeground: "#0a0c10",
    bg: "#0a0c10",
    fg: "#dde2eb",
    card: "#13161d",
    cardElevated: "#1b1f28",
    muted: "#161a22",
    mutedFg: "#7a8294",
    border: "rgba(55, 60, 75, 0.85)",
    preview: ["#cbd5e1", "#0a0c10"],
  },
  {
    id: "light",
    name: "Daylight",
    description: "Cyan on porcelain (light mode)",
    accent: "#0891b2",
    accentForeground: "#ffffff",
    bg: "#f8fafc",
    fg: "#0f172a",
    card: "#ffffff",
    cardElevated: "#f1f5f9",
    muted: "#f1f5f9",
    mutedFg: "#64748b",
    border: "rgba(203, 213, 225, 0.7)",
    preview: ["#0891b2", "#f8fafc"],
  },
];

export const DEFAULT_THEME_ID = "cyan";

export function getTheme(id: string): Theme {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

/** Apply a theme's CSS variables to the document root */
export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const r = document.documentElement;
  r.style.setProperty("--accent", theme.accent);
  r.style.setProperty("--accent-foreground", theme.accentForeground);
  r.style.setProperty("--bg", theme.bg);
  r.style.setProperty("--fg", theme.fg);
  r.style.setProperty("--card", theme.card);
  r.style.setProperty("--card-elevated", theme.cardElevated);
  r.style.setProperty("--muted", theme.muted);
  r.style.setProperty("--muted-fg", theme.mutedFg);
  r.style.setProperty("--border", theme.border);

  // Sync the existing shadcn variables so Tailwind classes stay in sync
  r.style.setProperty("--background", theme.bg);
  r.style.setProperty("--foreground", theme.fg);
  r.style.setProperty("--card-foreground", theme.fg);
  r.style.setProperty("--popover", theme.cardElevated);
  r.style.setProperty("--popover-foreground", theme.fg);
  r.style.setProperty("--primary", theme.accent);
  r.style.setProperty("--primary-foreground", theme.accentForeground);
  r.style.setProperty("--muted-foreground", theme.mutedFg);
  r.style.setProperty("--accent-foreground", theme.fg);

  r.dataset.theme = theme.id;
}
