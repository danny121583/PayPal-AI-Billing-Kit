import { Platform, ViewStyle } from 'react-native';

export type ShadowOptions = {
  color?: string;
  opacity?: number;
  radius?: number;
  x?: number;
  y?: number;
  elevation?: number;
};

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  let r = 0;
  let g = 0;
  let b = 0;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(0,0,0,${opacity})`;
  }
  return `rgba(${r},${g},${b},${opacity})`;
}

export function shadow(opts: ShadowOptions = {}): ViewStyle {
  const {
    color = '#000',
    opacity = 0.1,
    radius = 8,
    x = 0,
    y = 4,
    elevation,
  } = opts;

  const derivedElevation = elevation ?? Math.round(radius / 2);

  if (Platform.OS === 'web') {
    const rgba = hexToRgba(color, opacity);
    return {
      boxShadow: `${x}px ${y}px ${radius}px ${rgba}`,
    } as ViewStyle;
  }

  return {
    shadowColor: color,
    shadowOffset: { width: x, height: y },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation: derivedElevation,
  };
}

export const shadows = {
  card: shadow({ color: '#000', opacity: 0.1, radius: 12, y: 4 }),
  sm: shadow({ color: '#000', opacity: 0.06, radius: 8, y: 2 }),
  md: shadow({ color: '#000', opacity: 0.1, radius: 8, y: 4 }),
  lg: shadow({ color: '#000', opacity: 0.15, radius: 24, y: 8 }),
  drawer: shadow({ color: '#0F172A', opacity: 0.12, radius: 24, y: -6 }),
  primary: shadow({ color: '#1D4ED8', opacity: 0.2, radius: 8, y: 4 }),
  success: shadow({ color: '#22C55E', opacity: 0.35, radius: 8, y: 4 }),
  danger: shadow({ color: '#EF4444', opacity: 0.2, radius: 8, y: 2 }),
  cta: shadow({ color: '#EA580C', opacity: 0.3, radius: 8, y: 4 }),
  sidebar: shadow({ color: '#0F172A', opacity: 0.08, radius: 12, y: 6 }),
  xs: shadow({ color: '#000', opacity: 0.05, radius: 2, y: 1 }),
} as const;
