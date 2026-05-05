// Display preferences beyond color theme — UI scale + font family.

export const UI_SCALES = [
  { id: 'compact', name: 'Compact', zoom: 0.9 },
  { id: 'normal', name: 'Normal', zoom: 1.0 },
  { id: 'comfortable', name: 'Comfortable', zoom: 1.1 },
  { id: 'large', name: 'Large', zoom: 1.2 },
] as const;

export type UIScaleId = typeof UI_SCALES[number]['id'];

export const FONT_FAMILIES = [
  {
    id: 'sans',
    name: 'Geist Sans',
    description: 'Default — modern grotesque',
    stack: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    id: 'system',
    name: 'System',
    description: 'Native OS UI font',
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'inter',
    name: 'Inter',
    description: 'Wider, geometric',
    stack: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    id: 'serif',
    name: 'Serif',
    description: 'Classic with serifs',
    stack: '"Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", serif',
  },
  {
    id: 'mono',
    name: 'Monospace',
    description: 'For terminal lovers',
    stack: 'var(--font-geist-mono), "SF Mono", Menlo, Consolas, monospace',
  },
] as const;

export type FontFamilyId = typeof FONT_FAMILIES[number]['id'];

export const DEFAULT_SCALE_ID: UIScaleId = 'normal';
export const DEFAULT_FONT_ID: FontFamilyId = 'sans';

export function getScale(id: string) {
  return UI_SCALES.find(s => s.id === id) || UI_SCALES.find(s => s.id === DEFAULT_SCALE_ID)!;
}

export function getFont(id: string) {
  return FONT_FAMILIES.find(f => f.id === id) || FONT_FAMILIES.find(f => f.id === DEFAULT_FONT_ID)!;
}

export function applyAppearance(scaleId: string, fontId: string) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  const scale = getScale(scaleId);
  const font = getFont(fontId);
  // CSS zoom scales every layout & font size — single-property full UI rescale
  r.style.zoom = String(scale.zoom);
  r.style.setProperty('--app-font-family', font.stack);
}
