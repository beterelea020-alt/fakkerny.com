// core/theme-manager.js — theme system layered on top of the app's existing
// look. Two independent knobs:
//   1) mode: 'light' | 'dark' | 'system'  (already existed as Settings.theme;
//      untouched here — app.js still owns applyTheme()/data-theme).
//   2) color: 'default' (the app's original indigo, hand-tuned in style.css)
//      | one of a few calm presets | 'custom' (any color the user picks).
//
// The default color is never computed — when the user is on 'default' we
// simply clear any inline overrides so the original static CSS values (which
// were already contrast-checked by hand) apply exactly as authored. Presets
// and custom colors are derived at runtime with the same accessible-contrast
// algorithm, so no combination can ship unreadable text.
//
// Persistence reuses the existing Settings store (storage/db.js) — no second
// localStorage key, so import/export/backup keep working without changes.

import { Settings } from '../storage/db.js';

/* ---- small color-math toolkit (sRGB <-> HSL, WCAG contrast) ------------ */

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 91, g: 110, b: 245 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360; s /= 100; l /= 100;
  if (s === 0) { const v = l * 255; return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: hue2rgb(h + 1 / 3) * 255, g: hue2rgb(h) * 255, b: hue2rgb(h - 1 / 3) * 255 };
}

function relLuminance({ r, g, b }) {
  const ch = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relLuminance(rgb1), l2 = relLuminance(rgb2);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

const APP_DARK_TEXT = { r: 0x17, g: 0x19, b: 0x23 }; // matches --text in style.css

// Picks the more legible of white/dark text for content sitting directly on a
// solid fill of `rgb`. Prefers white (matches the app's existing button
// identity) unless white genuinely falls short and dark text is clearly
// better — avoids flip-flopping over marginal differences between presets.
function pickOnPrimaryText(rgb) {
  const cWhite = contrastRatio({ r: 255, g: 255, b: 255 }, rgb);
  const cDark = contrastRatio(APP_DARK_TEXT, rgb);
  if (cWhite >= 4.0 || cWhite >= cDark) return '#FFFFFF';
  return '#171923';
}

// Nudges lightness (same hue) until the color reads at >=4.5:1 against bgRgb.
// Bounded iteration count so a pathological hue can never hang the UI.
function findAccessibleShade(h, s, startL, bgRgb, direction) {
  let l = startL;
  let rgb = hslToRgb(h, s, l);
  for (let i = 0; i < 24; i++) {
    rgb = hslToRgb(h, s, l);
    if (contrastRatio(rgb, bgRgb) >= 4.5) return rgbToHex(rgb.r, rgb.g, rgb.b);
    const next = direction === 'darken' ? l - 4 : l + 4;
    if (next === l) break;
    l = clamp(next, 0, 100);
  }
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function isValidHex(v) {
  return /^#?[a-f\d]{6}$/i.test(String(v || '').trim());
}

// Given any base color, computes every shade the UI needs: the hover/active
// states for buttons, and accessible "on-tint" colors for text/icons sitting
// on a light wash of this color (pills, tile values) — one variant tuned for
// a white/light card, one for a dark card.
export function deriveShadesFromHex(baseHex) {
  const { r, g, b } = hexToRgb(baseHex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const hover = hslToRgb(h, s, clamp(l - 7, 8, 92));
  const active = hslToRgb(h, s, clamp(l - 14, 6, 90));
  const onTintLight = findAccessibleShade(h, clamp(s + 6, 0, 100), clamp(l - 18, 0, 40), { r: 255, g: 255, b: 255 }, 'darken');
  const onTintDark = findAccessibleShade(h, clamp(s - 4, 0, 100), clamp(l + 24, 55, 100), { r: 32, g: 33, b: 40 }, 'lighten');
  const onPrimary = pickOnPrimaryText({ r, g, b });
  return {
    primary: rgbToHex(r, g, b),
    primaryRgb: `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`,
    hover: rgbToHex(hover.r, hover.g, hover.b),
    active: rgbToHex(active.r, active.g, active.b),
    onTintLight,
    onTintDark,
    onPrimary
  };
}

/* ---- presets -------------------------------------------------------------
   "default" is the app's original color, kept separate from the computed
   presets below it (see applyThemeColor: default never gets inline overrides,
   so it always renders from the hand-tuned static CSS). */

export const DEFAULT_PRESET_ID = 'default';

export const PRESETS = [
  { id: 'default', name: 'الافتراضي', hex: '#5B6EF5' },
  { id: 'ocean', name: 'Ocean', hex: '#1E88A8' },
  { id: 'lavender', name: 'Lavender', hex: '#7C67B9' },
  { id: 'forest', name: 'Forest', hex: '#3D7A5C' },
  { id: 'sunset', name: 'Sunset', hex: '#C0581D' },
  { id: 'rose', name: 'Rose', hex: '#CC4368' },
  { id: 'slate', name: 'Slate', hex: '#55647A' }
];

function presetHex(id) {
  const p = PRESETS.find((x) => x.id === id);
  return p ? p.hex : PRESETS[0].hex;
}

/* ---- apply / persist ----------------------------------------------------- */

const OVERRIDE_PROPS = ['--primary', '--primary-rgb', '--primary-hover', '--primary-active', '--primary-on-tint', '--primary-contrast'];

function root() { return document.documentElement; }

function clearOverrides() {
  const el = root();
  OVERRIDE_PROPS.forEach((prop) => el.style.removeProperty(prop));
}

function applyOverrides(hex) {
  const el = root();
  const shades = deriveShadesFromHex(hex);
  const isDark = el.getAttribute('data-theme') === 'dark';
  el.style.setProperty('--primary', shades.primary);
  el.style.setProperty('--primary-rgb', shades.primaryRgb);
  el.style.setProperty('--primary-hover', shades.hover);
  el.style.setProperty('--primary-active', shades.active);
  el.style.setProperty('--primary-on-tint', isDark ? shades.onTintDark : shades.onTintLight);
  el.style.setProperty('--primary-contrast', shades.onPrimary);
}

// Re-applies whatever color the user has saved. Safe to call any time the
// theme (light/dark) or the color choice changes; a no-op-safe try/catch
// means a bad save can never take the whole app down with it.
export function applyThemeColor() {
  try {
    const s = Settings.get();
    const preset = s.themePreset || DEFAULT_PRESET_ID;
    if (preset === 'custom' && isValidHex(s.themeCustomColor)) {
      applyOverrides(s.themeCustomColor);
    } else if (preset === DEFAULT_PRESET_ID) {
      clearOverrides();
    } else {
      applyOverrides(presetHex(preset));
    }
  } catch (e) {
    console.warn('theme-manager: applyThemeColor failed, keeping default look', e);
    clearOverrides();
  }
}

export function setPreset(id) {
  if (!PRESETS.some((p) => p.id === id)) return;
  Settings.set({ themePreset: id, themeCustomColor: null });
  applyThemeColor();
}

export function setCustomColor(hex) {
  if (!isValidHex(hex)) return false;
  const normalized = hex.startsWith('#') ? hex : `#${hex}`;
  Settings.set({ themePreset: 'custom', themeCustomColor: normalized });
  applyThemeColor();
  return true;
}

export function resetTheme() {
  Settings.set({ themePreset: DEFAULT_PRESET_ID, themeCustomColor: null });
  applyThemeColor();
}
