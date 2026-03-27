/**
 * Darken a hex colour by multiplying each channel by `factor` (0–1).
 * @param {string} hex  - e.g. "#60a5fa"
 * @param {number} factor - 0 (black) to 1 (unchanged)
 */
export function darkenHex(hex, factor = 0.6) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}
