export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Deterministic PRNG so procedural content is identical between visits. */
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof mulberry32>;

export function gaussian(rng: Rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function formatSigned(v: number, int = 4, frac = 1) {
  const s = v < 0 ? '-' : '+';
  const a = Math.abs(v).toFixed(frac);
  const [i, f] = a.split('.');
  return `${s}${i.padStart(int, '0')}${f !== undefined ? '.' + f : ''}`;
}
