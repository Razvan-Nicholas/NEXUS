import * as THREE from 'three';

/**
 * Glyph sets, one per atlas row. Rows 0–8 are luminance ramps (re-sorted by measured ink
 * coverage at runtime), row 9 holds oriented edge glyphs, row 10 the scramble/decoding set.
 */
export const GLYPH_SETS: { key: string; chars: string; sort: boolean }[] = [
  { key: 'standard', chars: " .',:;-~=+*!lrtcvxzuoaeXO0#%&@", sort: true },
  { key: 'volcanic', chars: ` .'^",:;~*+!/|()xX%&#@$`, sort: true },
  { key: 'void', chars: ' .:-~=+ocO08Q@', sort: true },
  { key: 'crystal', chars: " .'/\\|_<>^vVAXYKNMW#", sort: true },
  { key: 'gas', chars: ' .-_~=:;+zsxSEZ$#', sort: true },
  { key: 'data', chars: ' .:-+01lI|[]{}=#%', sort: true },
  { key: 'singularity', chars: " .'-~:;=()+*{}oO%@", sort: true },
  { key: 'glitch', chars: ' .,!?/\\|<>{}[]$%&#@', sort: true },
  { key: 'star', chars: " .,'+*xX%#@", sort: true },
  { key: 'edge', chars: '|/-\\_', sort: false },
  { key: 'scramble', chars: '#$%&*+-/0123456789<=>?@ABCDEFXYZ', sort: false },
];

export const ATLAS_COLS = 32;
export const NUM_ROWS = GLYPH_SETS.length;
export const ROW_EDGE = 9;
export const ROW_SCRAMBLE = 10;
export const NUM_STYLES = 9;

const FONT_STACK = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Printable ASCII laid out 16×6 for 3D glyph objects (floating characters, glyph rings). */
const DISPLAY_CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

export class GlyphAtlas {
  rows: { chars: string[]; coverage: number[] }[] = [];
  counts: number[] = [];
  lut: THREE.DataTexture | null = null;
  texture: THREE.CanvasTexture | null = null;
  tileW = 0;
  tileH = 0;
  display: THREE.CanvasTexture | null = null;
  totalGlyphs = 0;

  /** Measures ink coverage of every glyph with the loaded font and sorts each ramp. */
  measure() {
    const tw = 40;
    const th = 64;
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const fontPx = 52;
    const coverageOf = (ch: string) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, tw, th);
      ctx.fillStyle = '#fff';
      ctx.font = `500 ${fontPx}px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, tw / 2, th / 2);
      const d = ctx.getImageData(0, 0, tw, th).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i];
      return sum / (255 * tw * th);
    };

    this.rows = GLYPH_SETS.map((set) => {
      const chars = Array.from(new Set(set.chars.split(''))).slice(0, ATLAS_COLS);
      const cov = chars.map((c) => (c === ' ' ? 0 : coverageOf(c)));
      if (!set.sort) return { chars, coverage: cov };
      const order = chars.map((c, i) => ({ c, v: cov[i] })).sort((a, b) => a.v - b.v);
      return { chars: order.map((o) => o.c), coverage: order.map((o) => o.v) };
    });
    this.counts = this.rows.map((r) => r.chars.length);
    this.totalGlyphs = this.counts.reduce((a, b) => a + b, 0);
  }

  /** Luminance → glyph index lookup, 256 levels per row, matched on normalized coverage. */
  buildLUT() {
    const w = 256;
    const data = new Uint8Array(w * NUM_ROWS * 4);
    this.rows.forEach((row, r) => {
      const maxCov = Math.max(...row.coverage, 1e-6);
      const norm = row.coverage.map((c) => c / maxCov);
      for (let x = 0; x < w; x++) {
        const target = x / (w - 1);
        let best = 0;
        if (target > 0.04) {
          let bestD = Infinity;
          for (let k = 1; k < norm.length; k++) {
            const d = Math.abs(norm[k] - target);
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
        const o = (r * w + x) * 4;
        data[o] = best;
        data[o + 3] = 255;
      }
    });
    this.lut?.dispose();
    const tex = new THREE.DataTexture(data, w, NUM_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.lut = tex;
  }

  /**
   * Renders the atlas with tiles exactly one cell in size (device pixels), so the glyph pass
   * samples texel centres 1:1 and characters stay terminal-crisp at any density.
   */
  build(tileW: number, tileH: number) {
    if (tileW === this.tileW && tileH === this.tileH && this.texture) return this.texture;
    this.tileW = tileW;
    this.tileH = tileH;
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_COLS * tileW;
    canvas.height = NUM_ROWS * tileH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const fontPx = Math.min(tileH * 0.9, (tileW / 0.6) * 0.98);
    const weight = tileW <= 10 ? 500 : 400;
    ctx.font = `${weight} ${fontPx}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    this.rows.forEach((row, r) => {
      row.chars.forEach((ch, c) => {
        if (ch === ' ') return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(c * tileW, r * tileH, tileW, tileH);
        ctx.clip();
        ctx.fillText(ch, c * tileW + tileW / 2, r * tileH + tileH / 2 + fontPx * 0.03);
        ctx.restore();
      });
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.userData.shared = true;
    this.texture?.dispose();
    this.texture = tex;
    return tex;
  }

  /** High-resolution atlas of printable ASCII used by 3D glyph objects. */
  getDisplayTexture() {
    if (this.display) return this.display;
    const tw = 64;
    const th = 96;
    const canvas = document.createElement('canvas');
    canvas.width = 16 * tw;
    canvas.height = 6 * th;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${th * 0.82}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < DISPLAY_CHARS.length; i++) {
      const cx = (i % 16) * tw + tw / 2;
      const cy = Math.floor(i / 16) * th + th / 2;
      ctx.fillText(DISPLAY_CHARS[i], cx, cy + th * 0.03);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.userData.shared = true;
    this.display = tex;
    return tex;
  }

  /** UV rect (x, y, w, h) of a character inside the display texture (flipY applied). */
  displayRect(ch: string): [number, number, number, number] {
    let i = DISPLAY_CHARS.indexOf(ch);
    if (i < 0) i = DISPLAY_CHARS.indexOf('?');
    const col = i % 16;
    const row = Math.floor(i / 16);
    return [col / 16, 1 - (row + 1) / 6, 1 / 16, 1 / 6];
  }
}
