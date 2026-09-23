import { hslToHex } from '@/lib/utils/color';
import { seasonalPalettes } from '@/lib/themes/seasonalThemes';

export interface ColorPaletteTheme {
  id: PaletteId;
  label: string;
  colors: string[]; // 8 hex colors
}

export type PaletteId = 'seasonal' | 'ocean' | 'sunset' | 'forest' | 'mono' | 'candy';

const OCEAN: ColorPaletteTheme = {
  id: 'ocean',
  label: 'Ocean',
  colors: [
    '#0EA5E9', // sky blue
    '#0284C7', // ocean blue
    '#0369A1', // deep blue
    '#06B6D4', // cyan
    '#14B8A6', // teal
    '#2DD4BF', // aquamarine
    '#67E8F9', // light cyan
    '#D4A574', // sandy
  ],
};

const SUNSET: ColorPaletteTheme = {
  id: 'sunset',
  label: 'Sunset',
  colors: [
    '#F97316', // orange
    '#FB923C', // light orange
    '#F59E0B', // amber
    '#EF4444', // red
    '#EC4899', // pink
    '#D946EF', // fuchsia
    '#A855F7', // purple
    '#FBBF24', // gold
  ],
};

const FOREST: ColorPaletteTheme = {
  id: 'forest',
  label: 'Forest',
  colors: [
    '#16A34A', // green
    '#22C55E', // light green
    '#65A30D', // lime
    '#84CC16', // yellow-green
    '#A16207', // dark gold
    '#92400E', // brown
    '#78716C', // stone
    '#059669', // emerald
  ],
};

const MONO: ColorPaletteTheme = {
  id: 'mono',
  label: 'Mono',
  colors: [
    '#FFFFFF', // white
    '#D4D4D4', // light gray
    '#A3A3A3', // gray
    '#737373', // mid gray
    '#525252', // dark gray
    '#404040', // charcoal
    '#262626', // near-black
    '#000000', // black
  ],
};

const CANDY: ColorPaletteTheme = {
  id: 'candy',
  label: 'Candy',
  colors: [
    '#EC4899', // pink
    '#F472B6', // light pink
    '#A855F7', // purple
    '#818CF8', // indigo
    '#22D3EE', // cyan
    '#34D399', // mint
    '#FACC15', // yellow
    '#FB923C', // peach
  ],
};

const STATIC_PALETTES: Record<Exclude<PaletteId, 'seasonal'>, ColorPaletteTheme> = {
  ocean: OCEAN,
  sunset: SUNSET,
  forest: FOREST,
  mono: MONO,
  candy: CANDY,
};

/**
 * Generate a seasonal palette from the current month's theme colors.
 * Reads accent, highlight, accentForeground, subtle from seasonalPalettes,
 * then generates 4 complementary colors by shifting hue/saturation.
 */
export function getSeasonalPalette(isDark: boolean): ColorPaletteTheme {
  const month = new Date().getMonth() + 1; // 1-12
  const palette = seasonalPalettes[month];
  if (!palette) {
    return { id: 'seasonal', label: 'Seasonal', colors: OCEAN.colors };
  }

  const variant = isDark ? palette.dark : palette.light;

  // Parse the accent HSL to get base hue for complementary generation
  const accentParts = variant.accent.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  const baseHue = accentParts?.[1] ? parseFloat(accentParts[1]) : 0;
  const baseSat = accentParts?.[2] ? parseFloat(accentParts[2]) : 50;

  // 4 colors from theme definition
  const themeColors = [
    hslToHex(variant.accent),
    hslToHex(variant.highlight),
    hslToHex(variant.accentForeground),
    hslToHex(variant.subtle),
  ];

  // 4 complementary colors by shifting hue
  const complementary = [
    hslToHex(`${(baseHue + 30) % 360} ${Math.min(baseSat + 10, 100)}% ${isDark ? 50 : 55}%`),
    hslToHex(`${(baseHue + 60) % 360} ${baseSat}% ${isDark ? 45 : 60}%`),
    hslToHex(`${(baseHue + 180) % 360} ${Math.max(baseSat - 15, 20)}% ${isDark ? 50 : 50}%`),
    hslToHex(`${(baseHue + 210) % 360} ${Math.max(baseSat - 10, 25)}% ${isDark ? 55 : 45}%`),
  ];

  return {
    id: 'seasonal',
    label: 'Seasonal',
    colors: [...themeColors, ...complementary],
  };
}

/** Get a palette by ID. Seasonal palette requires isDark for light/dark variant. */
export function getColorPalette(id: PaletteId, isDark: boolean): ColorPaletteTheme {
  if (id === 'seasonal') return getSeasonalPalette(isDark);
  return STATIC_PALETTES[id];
}

/** Black + White — always appended after theme colors (skipped for mono) */
export const FIXED_COLORS = ['#000000', '#FFFFFF'];

/** Display order for theme selector pills */
export const PALETTE_ORDER: PaletteId[] = [
  'seasonal',
  'ocean',
  'sunset',
  'forest',
  'mono',
  'candy',
];
