import { CELL_TRANSITION, HASH, SIMPLEX } from './glsl/chunks';
import { NUM_ROWS, NUM_STYLES, ROW_EDGE, ROW_SCRAMBLE } from './GlyphAtlas';

/**
 * Stage 1 — runs once per character cell (cols × rows fragments).
 * Supersamples the scene, tone-maps, picks a glyph through the calibrated LUT, animates it
 * per style, detects silhouettes from depth and packs (colour, atlas code) into RGBA16F.
 */
export const CELL_FRAG = /* glsl */ `
#define NUM_ROWS ${NUM_ROWS}
#define NUM_STYLES ${NUM_STYLES}
#define ROW_EDGE ${ROW_EDGE}.0
#define ROW_SCRAMBLE ${ROW_SCRAMBLE}.0
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tLUT;
uniform vec2 uCanvasPx;
uniform vec2 uCellPx;
uniform vec2 uGrid;
uniform float uTime;
uniform float uExposure;
uniform float uGamma;
uniform float uEdge;
uniform float uNear;
uniform float uFar;
uniform float uAscii;
uniform float uScramble;
uniform float uVoidDust;
uniform float uGlyphGain;
uniform float uFloor;
uniform vec2 uMouse;
uniform float uMouseEnergy;
uniform float uLensRadius;
uniform int uTaps;
uniform float uCounts[NUM_ROWS];
varying vec2 vUv;
${HASH}
${SIMPLEX}
${CELL_TRANSITION}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float logDepthAt(vec2 px){
  float d = texture(tDepth, clamp(px / uCanvasPx, vec2(0.0), vec2(1.0))).r;
  float dist = (uNear * uFar) / max(uFar - (uFar - uNear) * d, 1e-6);
  return log(max(dist, 1e-4));
}

void main(){
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 origin = cell * uCellPx;
  float taps = float(uTaps);
  vec3 sum = vec3(0.0);
  vec3 brightest = vec3(0.0);
  float maxL = -1.0;
  float styleA = 0.0;
  for (int j = 0; j < 4; j++) {
    if (j >= uTaps) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uTaps) break;
      vec2 o = (vec2(float(i), float(j)) + 0.5) / taps;
      vec4 s = texture(tScene, clamp((origin + o * uCellPx) / uCanvasPx, vec2(0.0), vec2(1.0)));
      sum += s.rgb;
      float l = luma(s.rgb);
      if (l > maxL) { maxL = l; brightest = s.rgb; }
      styleA = max(styleA, s.a);
    }
  }
  vec3 avg = sum / (taps * taps);
  vec3 col = max(mix(avg, brightest, 0.45), vec3(0.0));
  vec3 tm = 1.0 - exp(-col * uExposure);
  float L = pow(clamp((luma(tm) * 1.2 - uFloor) / (1.0 - uFloor), 0.0, 1.0), uGamma);

  float style = clamp(floor(styleA * 16.0), 0.0, float(NUM_STYLES - 1));
  float row = style;
  float count = uCounts[int(row)];
  float idx = floor(texture(tLUT, vec2((L * 255.0 + 0.5) / 256.0, (row + 0.5) / float(NUM_ROWS))).r * 255.0 + 0.5);

  float maxc = max(tm.r, max(tm.g, tm.b));
  vec3 hue = maxc > 1e-4 ? tm / maxc : vec3(0.0);
  vec3 outCol = hue * mix(0.32, 1.0, L) * uGlyphGain;
  float hdr = max(luma(col) - 0.9, 0.0);
  outCol *= 1.0 + hdr * 0.55;

  // ---- animated glyph patterns, per style ----
  float t = uTime;
  if (idx > 0.5) {
    float jitter = 0.0;
    if (style < 0.5) {
      jitter = floor(snoise(vec3(cell * 0.11, t * 0.35)) * 1.25 + 0.5);
    } else if (style < 1.5) {
      float n = snoise(vec3(cell.x * 0.22, cell.y * 0.17 - t * 2.4, t * 0.45));
      jitter = floor(n * 2.4);
      outCol *= 1.0 + max(n, 0.0) * 0.35;
    } else if (style < 2.5) {
      jitter = floor(sin(t * 0.9 + length(cell - uGrid * 0.5) * 0.18) * 1.5);
    } else if (style < 3.5) {
      float band = fract((cell.x + cell.y * 1.6) * 0.03 - t * 0.22);
      float g = smoothstep(0.0, 0.02, band) * (1.0 - smoothstep(0.03, 0.07, band));
      jitter = floor(g * 5.0);
      outCol *= 1.0 + g * 1.4;
    } else if (style < 4.5) {
      jitter = floor(snoise(vec3(cell.x * 0.06 - t * 0.7, cell.y * 0.45, t * 0.15)) * 2.2);
    } else if (style < 5.5) {
      float h = hash12(cell + floor(t * 5.0 + hash12(cell) * 7.0));
      jitter = h > 0.82 ? floor(h * 9.0) - 4.0 : 0.0;
    } else if (style < 6.5) {
      vec2 d = cell - uGrid * 0.5;
      jitter = floor(sin(atan(d.y, d.x) * 3.0 + length(d) * 0.25 - t * 2.0) * 1.6);
    } else if (style < 7.5) {
      float h = hash12(vec2(floor(cell.y / 3.0), floor(t * 9.0)));
      jitter = h > 0.9 ? floor(hash12(cell + floor(t * 20.0)) * 8.0) - 4.0 : 0.0;
    } else {
      jitter = floor(sin(t * 3.0 + hash12(cell) * 40.0) * 1.2);
    }
    idx = clamp(idx + jitter, 1.0, count - 1.0);
  } else if (uVoidDust > 0.0) {
    float h = hash12(cell * 0.913 + floor(t * 0.6 + hash12(cell * 1.7) * 13.0));
    if (h > 1.0 - 0.0035 * uVoidDust) {
      idx = 1.0;
      outCol = vec3(0.11, 0.09, 0.2);
    }
  }

  // ---- depth silhouettes: oriented edge glyphs on the near side ----
  if (uEdge > 0.0) {
    vec2 c = origin + 0.5 * uCellPx;
    vec2 dx = vec2(uCellPx.x, 0.0);
    vec2 dy = vec2(0.0, uCellPx.y);
    float d00 = logDepthAt(c - dx - dy), d10 = logDepthAt(c - dy), d20 = logDepthAt(c + dx - dy);
    float d01 = logDepthAt(c - dx),      d11 = logDepthAt(c),      d21 = logDepthAt(c + dx);
    float d02 = logDepthAt(c - dx + dy), d12 = logDepthAt(c + dy), d22 = logDepthAt(c + dx + dy);
    float gx = (d20 + 2.0 * d21 + d22) - (d00 + 2.0 * d01 + d02);
    float gy = (d02 + 2.0 * d12 + d22) - (d00 + 2.0 * d10 + d20);
    float mag = length(vec2(gx, gy));
    float avgN = (d00 + d10 + d20 + d01 + d21 + d02 + d12 + d22) * 0.125;
    if (mag > 0.9 && d11 < avgN - 0.015) {
      float a = mod(atan(gy, gx) + 3.14159265, 3.14159265);
      float q = mod(floor(a / 0.78539816 + 0.5), 4.0);
      float e = q < 0.5 ? 0.0 : (q < 1.5 ? 3.0 : (q < 2.5 ? 2.0 : 1.0));
      row = ROW_EDGE;
      idx = e;
      bool lit = maxc > 0.02;
      vec3 eh = lit ? hue : vec3(0.55, 0.6, 0.85);
      outCol = eh * (lit ? max(mix(0.32, 1.0, L), 0.42) : 0.2) * uGlyphGain * uEdge * 1.15;
    }
  }

  // ---- scrambling: mode decode wave, mouse ring, global storms ----
  vec2 centerPx = origin + 0.5 * uCellPx;
  float md = length(centerPx - uMouse);
  float ring = smoothstep(uLensRadius * 0.55, uLensRadius * 0.92, md) * (1.0 - smoothstep(uLensRadius * 0.92, uLensRadius * 1.2, md));
  float tr = cellTransition(cell, uGrid, uCellPx, uAscii);
  float decode = (tr > 0.015 && tr < 0.985) ? 1.0 : 0.0;
  float storm = uScramble * (0.35 + 0.65 * smoothstep(-0.3, 0.6, snoise(vec3(cell * 0.06, t * 1.3))));
  float p = max(max(ring * uMouseEnergy * 0.45, decode * 0.9), storm);
  if (p > 0.0 && hash12(cell + fract(floor(t * 22.0) * 0.371) * 97.0) < p) {
    bool empty = idx < 0.5;
    row = ROW_SCRAMBLE;
    idx = floor(hash12(cell * 1.71 + floor(t * 16.0)) * uCounts[${ROW_SCRAMBLE}]);
    vec3 accent = decode > 0.5 ? vec3(0.55, 1.6, 1.8) : vec3(0.75, 0.35, 1.6);
    outCol = empty ? accent * (0.25 + 0.6 * uScramble) : mix(outCol, accent, 0.5) * 1.2;
  }

  gl_FragColor = vec4(outCol, row * 32.0 + idx);
}
`;

/**
 * Stage 2 — full resolution. Looks up the cell, draws the glyph from the atlas 1:1, blends
 * with the shaded scene during mode transitions and applies the cursor lens.
 */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tCells;
uniform sampler2D tAtlas;
uniform vec2 uCanvasPx;
uniform vec2 uCellPx;
uniform vec2 uGrid;
uniform vec2 uAtlasTiles;
uniform float uAscii;
uniform vec2 uMouse;
uniform float uLensRadius;
uniform float uLensStrength;
uniform int uLensType;
uniform vec3 uBackground;
uniform float uTime;
varying vec2 vUv;
${HASH}
${CELL_TRANSITION}
void main(){
  vec2 frag = gl_FragCoord.xy;
  float probe = 0.0;
  if (uLensStrength > 0.001) {
    vec2 d = frag - uMouse;
    float r = length(d);
    if (r < uLensRadius) {
      float x = r / uLensRadius;
      float fall = 1.0 - smoothstep(0.55, 1.0, x);
      if (uLensType == 0) {
        frag = uMouse + d * (1.0 - uLensStrength * 0.45 * (1.0 - x * x));
      } else if (uLensType == 1) {
        float E = uLensRadius * 0.22 * uLensStrength;
        vec2 dir = d / max(r, 1e-3);
        float src = r - (E * E) / max(r, 1.0);
        frag = uMouse + dir * mix(r, src, fall);
        probe = 1.0 - smoothstep(E * 0.32, E * 0.42, r);
      } else {
        vec2 blk = floor(frag / vec2(uCellPx.x * 3.0, uCellPx.y));
        vec2 j = hash22(blk + floor(uTime * 14.0)) - 0.5;
        frag += j * uCellPx * vec2(5.0, 1.0) * uLensStrength * fall * step(0.55, hash12(blk + floor(uTime * 9.0)));
      }
    }
  }
  vec3 reality = texture(tScene, frag / uCanvasPx).rgb;
  vec3 col = reality;
  if (uAscii > 0.001) {
    vec2 cf = frag / uCellPx;
    vec2 cell = clamp(floor(cf), vec2(0.0), uGrid - 1.0);
    vec2 local = fract(cf);
    vec4 c = texelFetch(tCells, ivec2(cell), 0);
    float code = c.a + 0.5;
    float row = floor(code / 32.0);
    float idx = floor(code - row * 32.0);
    vec2 auv = vec2((idx + local.x) / uAtlasTiles.x, 1.0 - (row + 1.0 - local.y) / uAtlasTiles.y);
    float g = texture(tAtlas, auv).r;
    vec3 ascii = uBackground + c.rgb * g;
    col = mix(reality, ascii, cellTransition(cell, uGrid, uCellPx, uAscii));
  }
  col *= 1.0 - probe;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Final grade: bloom, chromatic aberration, warp, glitch, ink inversion, tone map, grain. */
export const FINAL_FRAG = /* glsl */ `
uniform sampler2D tComposite;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBloom;
uniform float uChroma;
uniform float uGrain;
uniform float uVignette;
uniform float uWarp;
uniform vec2 uWarpCenter;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uFade;
uniform float uInvert;
uniform float uGlitch;
uniform float uExposure;
uniform vec3 uPaper;
uniform vec3 uInk;
varying vec2 vUv;
${HASH}
vec3 toSRGB(vec3 c){
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 fetchCA(vec2 uv, vec2 off){
  return vec3(texture(tComposite, uv + off).r, texture(tComposite, uv).g, texture(tComposite, uv - off).b);
}
void main(){
  vec2 uv = vUv;
  if (uGlitch > 0.001) {
    float band = floor(uv.y * 54.0);
    float h = hash12(vec2(band, floor(uTime * 24.0)));
    if (h < uGlitch * 0.4) uv.x += (hash12(vec2(band * 3.1, floor(uTime * 31.0))) - 0.5) * 0.09 * uGlitch;
  }
  vec2 dir = uv - uWarpCenter;
  float ca = uChroma * (0.35 + dot(dir, dir) * 3.0) + uWarp * 0.01;
  vec2 off = dir * ca;
  vec3 col;
  if (uWarp > 0.002) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 12; i++) {
      float t = float(i) / 11.0;
      vec2 suv = uWarpCenter + dir * (1.0 - t * uWarp * 0.28);
      float w = 1.0 - t * 0.55;
      acc += fetchCA(suv, off) * w;
      wsum += w;
    }
    col = acc / wsum;
  } else {
    col = fetchCA(uv, off);
  }
  col += texture(tBloom, uv).rgb * uBloom;
  col *= 1.0 + uWarp * 1.4;
  col = 1.0 - exp(-col * uExposure);
  if (uInvert > 0.001) {
    float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float m = max(col.r, max(col.g, col.b));
    vec3 hue = m > 1e-4 ? col / m : vec3(0.0);
    vec3 inked = mix(uPaper, mix(uInk, hue * 0.3, 0.45), clamp(L * 2.4, 0.0, 1.0));
    col = mix(col, inked, uInvert);
  }
  float vig = 1.0 - smoothstep(0.45, 1.3, length((vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0)));
  col *= mix(1.0, vig, uVignette);
  col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
  col = toSRGB(col);
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 911.0) - 0.5) * uGrain;
  col *= 1.0 - clamp(uFade, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`;
