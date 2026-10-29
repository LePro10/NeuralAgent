/**
 * JS side of the tokens, for canvases, SVG and inline styles that cannot use
 * classes. Colours point at CSS variables, so accent themes still apply.
 */
export const color = {
  bg: 'var(--color-bg)', card: 'var(--color-card)', sheet: 'var(--color-sheet)', popover: 'var(--color-popover)',
  line: 'var(--color-line)', line2: 'var(--color-line-2)',
  bright: 'var(--color-bright)', ink: 'var(--color-ink)', dim: 'var(--color-dim)', faint: 'var(--color-faint)',
  accent: 'var(--color-accent)', accentDeep: 'var(--color-accent-deep)',
  ice: 'var(--color-ice)', azure: 'var(--color-azure)', lilac: 'var(--color-lilac)', sand: 'var(--color-sand)',
  ember: 'var(--color-ember)', mint: 'var(--color-mint)', live: 'var(--color-live)',
  danger: 'var(--color-danger)', warning: 'var(--color-warning)',
} as const;

/** The glow palette as hex — for WebGL, canvas and colour pickers (no CSS vars there). */
export const GLOW = { ice: '#b9d3ff', azure: '#3b5bff', lilac: '#a898ff', sand: '#eadcbc', ember: '#ff8a5c', mint: '#9fe7c8' } as const;

/** Tag / category / account colours: one list instead of five copies. Readable on dark, distinct from each other. */
export const TAG_COLORS = ['#b9d3ff', '#a898ff', '#9fe7c8', '#eadcbc', '#ff8a5c', '#5b9bff', '#ff9fd8', '#7ad0c8'] as const;

export const SERIES = ['var(--color-series-1)', 'var(--color-series-2)', 'var(--color-series-3)', 'var(--color-series-4)'] as const;

/**
 * Ambient light per place: five stops, dark → mid-tone → dark. Mid-tones only —
 * the light tints the dark, it never washes out text.
 */
export const AMBIENT = {
  home: ['#06070d', '#1f38e0', '#6a57e6', '#a8946c', '#08090e'],
  luna: ['#05070e', '#1f3ad6', '#4f8fe0', '#7b66e8', '#07080e'],
  files: ['#05080d', '#1a4cb3', '#4f86cc', '#2f8f86', '#070a0e'],
  screen: ['#0a080e', '#4630d0', '#c95a36', '#a88e6a', '#0c0a0e'],
  account: ['#060d0a', '#146a4b', '#4c9477', '#8a9a5c', '#09100c'],
  plan: ['#07080e', '#3a2fd0', '#7a5ce0', '#c9844f', '#0a090e'],
  progress: ['#060a0b', '#1b5fae', '#2f9a7a', '#c4743f', '#080a0b'],
  calendar: ['#050a0e', '#1d5fc9', '#3f9bd6', '#6b7fe6', '#070a0e'],
  mail: ['#07080d', '#2a44c9', '#5a7fe0', '#b0806a', '#08090d'],
  notes: ['#0b0a08', '#8a6b3a', '#b89a64', '#5a63c9', '#0c0b09'],
  tools: ['#07090b', '#2a4f8f', '#6a78a8', '#3e8f7c', '#080a0b'],
  ember: ['#0c0807', '#9a3a16', '#d0703c', '#7a5ce0', '#0d0908'],
  mono: ['#080909', '#2a2f2c', '#4a504c', '#6f7671', '#080909'],
} as const;
export type AmbientName = keyof typeof AMBIENT;

/**
 * Where each of the five lights sits, in the shader's units (0 = centre,
 * ±0.6 ≈ the short edge; y grows downwards). One fixed pose for every
 * palette, chosen so the light gathers at the top and fades towards the
 * content — the composition the dashboard showed, without its seed.
 */
export const AMBIENT_POSE: readonly (readonly [number, number])[] = [
  [-0.028, 0.166], [0.478, 0.525], [-0.512, -0.228], [0.099, -0.498], [0.4, 0.287],
];

/** Signal colours: one per place. Names map to --color-signal-* and data-signal. */
export const SIGNALS = ['silver', 'periwinkle', 'amber', 'teal', 'coral', 'sky', 'cyan', 'green', 'sage', 'sand', 'violet', 'rose'] as const;
export type Signal = (typeof SIGNALS)[number];

/**
 * NeuralHub's places: their signal colour and their light. Use the same
 * pairing in new products — or define your own places from SIGNALS + AMBIENT.
 */
export const PLACES = {
  home: { signal: 'silver', ambient: 'home' },
  luna: { signal: 'periwinkle', ambient: 'luna' },
  plan: { signal: 'amber', ambient: 'plan' },
  files: { signal: 'teal', ambient: 'files' },
  screen: { signal: 'coral', ambient: 'screen' },
  mail: { signal: 'sky', ambient: 'mail' },
  calendar: { signal: 'cyan', ambient: 'calendar' },
  progress: { signal: 'green', ambient: 'progress' },
  account: { signal: 'sage', ambient: 'account' },
  notes: { signal: 'sand', ambient: 'notes' },
  tools: { signal: 'violet', ambient: 'tools' },
  browser: { signal: 'rose', ambient: 'ember' },
} as const satisfies Record<string, { signal: Signal; ambient: AmbientName }>;
export type Place = keyof typeof PLACES;

export const ACCENTS = ['ice', 'mint', 'ember', 'lilac', 'sand', 'graphite'] as const;
export type Accent = (typeof ACCENTS)[number];
export const GLASS_LEVELS = ['subtle', 'default', 'strong', 'clear'] as const;
export type GlassLevel = (typeof GLASS_LEVELS)[number];

/** Runtime theming: accent and glass level on <html> (or pass an element). */
export type Corners = 'continuous' | 'round';
export const CORNERS: Corners[] = ['continuous', 'round'];

/** Theme switches on <html> (or a subtree — except `corners`, which is read on <html>). */
export function setTheme(t: { accent?: Accent; glass?: GlassLevel; corners?: Corners }, el: HTMLElement = document.documentElement) {
  if (t.accent) el.dataset.accent = t.accent;
  if (t.glass) el.dataset.glass = t.glass;
  if (t.corners) { if (t.corners === 'round') el.dataset.corners = 'round'; else delete el.dataset.corners; }
}

/** Common bottom-sheet snap sets (fractions of the viewport). Was 27 ad-hoc arrays. */
export const SNAPS = {
  peek: [0.45, 0.94],
  half: [0.62, 0.94],
  tall: [0.86, 0.94],
  full: [0.94],
} as const;

export const Z = { header: 30, sidebar: 40, tabbar: 50, sheet: 80, context: 85, search: 88, toast: 95, popover: 120, intro: 200 } as const;
