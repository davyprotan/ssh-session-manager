export interface Theme {
  id: string;
  name: string;
  description: string;
  // Surfaces
  bg: string;
  card: string;
  cardElevated: string;
  muted: string;
  border: string;
  // Text — three legible tiers
  fg: string;          // primary text — high contrast
  mutedFg: string;     // secondary — readable, ~7:1 in dark
  subtleFg: string;    // tertiary captions — ~4.5:1, used sparingly
  // Accent
  accent: string;
  accentForeground: string;
  // For preview chips
  preview: [string, string];
}

export const THEMES: Theme[] = [
  {
    id: "cyan",
    name: "Cyan Terminal",
    description: "Classic terminal cyan on deep blue-black",
    bg: "#0d1117",
    card: "#161b22",
    cardElevated: "#1c2128",
    muted: "#1c2128",
    border: "rgba(73, 81, 92, 0.55)",
    fg: "#f0f6fc",
    mutedFg: "#b1bac4",
    subtleFg: "#7d8590",
    accent: "#22d3ee",
    accentForeground: "#0d1117",
    preview: ["#22d3ee", "#0d1117"],
  },
  {
    id: "emerald",
    name: "Matrix",
    description: "Hacker-green on midnight",
    bg: "#0a0f0a",
    card: "#10171d",
    cardElevated: "#162127",
    muted: "#13191c",
    border: "rgba(70, 90, 80, 0.55)",
    fg: "#e8f4ee",
    mutedFg: "#b0c0b6",
    subtleFg: "#7d8d83",
    accent: "#34d399",
    accentForeground: "#0a0f0a",
    preview: ["#34d399", "#0a0f0a"],
  },
  {
    id: "amber",
    name: "Amber Glow",
    description: "Warm amber on graphite",
    bg: "#13110d",
    card: "#1d1a13",
    cardElevated: "#26221a",
    muted: "#1f1c14",
    border: "rgba(105, 90, 65, 0.55)",
    fg: "#f4ecd8",
    mutedFg: "#bfb195",
    subtleFg: "#897e6a",
    accent: "#fbbf24",
    accentForeground: "#1a1410",
    preview: ["#fbbf24", "#13110d"],
  },
  {
    id: "violet",
    name: "Violet Storm",
    description: "Electric violet on cosmic black",
    bg: "#0e0d1a",
    card: "#171625",
    cardElevated: "#1f1d31",
    muted: "#1a1828",
    border: "rgba(95, 80, 120, 0.55)",
    fg: "#ece8f8",
    mutedFg: "#b6adc9",
    subtleFg: "#857d96",
    accent: "#a78bfa",
    accentForeground: "#0e0d1a",
    preview: ["#a78bfa", "#0e0d1a"],
  },
  {
    id: "rose",
    name: "Rose Garden",
    description: "Soft pink on charcoal",
    bg: "#170d14",
    card: "#22141d",
    cardElevated: "#2c1c25",
    muted: "#241620",
    border: "rgba(115, 75, 95, 0.55)",
    fg: "#f4e4ec",
    mutedFg: "#c2a9b4",
    subtleFg: "#8a7681",
    accent: "#f472b6",
    accentForeground: "#170d14",
    preview: ["#f472b6", "#170d14"],
  },
  {
    id: "crimson",
    name: "Crimson",
    description: "Bold red on noir",
    bg: "#15090a",
    card: "#1f1213",
    cardElevated: "#2a1819",
    muted: "#211415",
    border: "rgba(120, 70, 70, 0.55)",
    fg: "#f6e1e1",
    mutedFg: "#c5a8a8",
    subtleFg: "#8a7575",
    accent: "#f87171",
    accentForeground: "#15090a",
    preview: ["#f87171", "#15090a"],
  },
  {
    id: "sky",
    name: "Sky High",
    description: "Crisp sky-blue on slate",
    bg: "#0a121b",
    card: "#121d2a",
    cardElevated: "#1a2638",
    muted: "#13202d",
    border: "rgba(70, 90, 120, 0.55)",
    fg: "#e0eef9",
    mutedFg: "#a8b8cb",
    subtleFg: "#7382a0",
    accent: "#38bdf8",
    accentForeground: "#0a121b",
    preview: ["#38bdf8", "#0a121b"],
  },
  {
    id: "lime",
    name: "Lime Light",
    description: "Vivid lime on forest dark",
    bg: "#0d130a",
    card: "#161e10",
    cardElevated: "#1e2818",
    muted: "#181f12",
    border: "rgba(75, 95, 65, 0.55)",
    fg: "#e8f3da",
    mutedFg: "#b6c4a3",
    subtleFg: "#82907a",
    accent: "#a3e635",
    accentForeground: "#0d130a",
    preview: ["#a3e635", "#0d130a"],
  },
  {
    id: "slate",
    name: "Monochrome",
    description: "Minimal silver on jet",
    bg: "#0a0c10",
    card: "#13161d",
    cardElevated: "#1b1f28",
    muted: "#161a22",
    border: "rgba(80, 88, 105, 0.55)",
    fg: "#e6e9f0",
    mutedFg: "#aab1c0",
    subtleFg: "#727a8d",
    accent: "#cbd5e1",
    accentForeground: "#0a0c10",
    preview: ["#cbd5e1", "#0a0c10"],
  },
  {
    id: "light",
    name: "Daylight",
    description: "Cyan on porcelain (light mode)",
    bg: "#f8fafc",
    card: "#ffffff",
    cardElevated: "#f1f5f9",
    muted: "#f1f5f9",
    border: "rgba(148, 163, 184, 0.4)",
    fg: "#0f172a",
    mutedFg: "#475569",
    subtleFg: "#94a3b8",
    accent: "#0891b2",
    accentForeground: "#ffffff",
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
  // Theme variables
  r.style.setProperty("--accent", theme.accent);
  r.style.setProperty("--accent-foreground", theme.accentForeground);
  r.style.setProperty("--bg", theme.bg);
  r.style.setProperty("--fg", theme.fg);
  r.style.setProperty("--card", theme.card);
  r.style.setProperty("--card-elevated", theme.cardElevated);
  r.style.setProperty("--muted-fg", theme.mutedFg);
  r.style.setProperty("--subtle-fg", theme.subtleFg);
  r.style.setProperty("--border", theme.border);

  // Sync the existing shadcn variables so Tailwind classes stay in sync
  r.style.setProperty("--background", theme.bg);
  r.style.setProperty("--foreground", theme.fg);
  r.style.setProperty("--card-foreground", theme.fg);
  r.style.setProperty("--popover", theme.cardElevated);
  r.style.setProperty("--popover-foreground", theme.fg);
  r.style.setProperty("--primary", theme.accent);
  r.style.setProperty("--primary-foreground", theme.accentForeground);
  r.style.setProperty("--muted", theme.muted);
  r.style.setProperty("--muted-foreground", theme.mutedFg);

  r.dataset.theme = theme.id;
}
