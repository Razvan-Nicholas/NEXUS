import * as THREE from 'three';
import { mulberry32 } from '../core/math';

let cached: THREE.DataTexture | null = null;

/**
 * Tileable value-noise fbm, four variants packed in RGBA. Lets large translucent effects
 * (nebulae, disks) use two texture reads instead of per-pixel simplex octaves.
 */
export function getNoiseTexture(size = 256): THREE.DataTexture {
  if (cached) return cached;
  const data = new Uint8Array(size * size * 4);
  const rng = mulberry32(1337);
  const lattices: Float32Array[] = [];
  const periods = [4, 8, 16, 32, 64];
  for (let c = 0; c < 4; c++) {
    for (const p of periods) {
      const g = new Float32Array(p * p);
      for (let i = 0; i < g.length; i++) g[i] = rng();
      lattices.push(g);
    }
  }
  const fade = (t: number) => t * t * (3 - 2 * t);
  const sample = (g: Float32Array, p: number, x: number, y: number) => {
    const fx = x * p;
    const fy = y * p;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fade(fx - x0);
    const ty = fade(fy - y0);
    const xa = ((x0 % p) + p) % p;
    const ya = ((y0 % p) + p) % p;
    const xb = (xa + 1) % p;
    const yb = (ya + 1) % p;
    const a = g[ya * p + xa];
    const b = g[ya * p + xb];
    const c = g[yb * p + xa];
    const d = g[yb * p + xb];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        let amp = 0.5;
        let norm = 0;
        const start = c === 1 ? 1 : 0;
        for (let o = start; o < periods.length; o++) {
          let n = sample(lattices[c * periods.length + o], periods[o], u, v);
          if (c === 2) n = 1 - Math.abs(n * 2 - 1);
          sum += n * amp;
          norm += amp;
          amp *= 0.5;
        }
        let val = sum / norm;
        val = Math.min(1, Math.max(0, (val - 0.5) * 1.6 + 0.5));
        data[(y * size + x) * 4 + c] = Math.round(val * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.userData.shared = true;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
