// Client-safe constants — no server-only imports here
export const PROFILE_COLORS = ['cyan', 'green', 'amber', 'purple', 'pink', 'rose'] as const;
export type ProfileColor = typeof PROFILE_COLORS[number];

export const COLOR_HEX: Record<ProfileColor, string> = {
  cyan: '#22d3ee',
  green: '#34d399',
  amber: '#fbbf24',
  purple: '#a78bfa',
  pink: '#f472b6',
  rose: '#fb7185',
};
