export const ORANGE = '#E64833';
export const TEAL   = '#244855';
export const BROWN  = '#874F41';
export const SLATE  = '#90AEAD';
export const CREAM  = '#FBE9D0';
// GREEN and RED remapped to palette — teal for success, orange for danger
export const GREEN  = '#244855';
export const RED    = '#E64833';

export const GRID_STROKE  = 'rgba(144,174,173,0.22)'; /* SLATE at 22% */
export const GRID_CURSOR  = 'rgba(144,174,173,0.12)'; /* SLATE at 12% */

// Donut slices — opacity variants of the 5 palette colors only
export const SLICE_COLORS = [
  '#E64833', '#244855', '#874F41', '#90AEAD',
  'rgba(230,72,51,0.70)',  'rgba(36,72,85,0.70)',  'rgba(135,79,65,0.70)',  'rgba(144,174,173,0.70)',
  'rgba(230,72,51,0.45)',  'rgba(36,72,85,0.45)',  'rgba(135,79,65,0.45)',  'rgba(144,174,173,0.45)',
];

export const TOOLTIP_STYLE = {
  background: '#FBE9D0',
  border: '1px solid rgba(144,174,173,0.32)',
  borderRadius: 10,
  fontSize: 12,
  color: '#244855',
  boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
  padding: '8px 12px',
};

export const AXIS_TICK = { fontSize: 11, fill: BROWN };

export function fmtINR(v: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(v);
}

export function fmtINRShort(v: number) {
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)}L`;
  if (v >= 1_000)   return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
}
