/** Shared GLSL. All scene shaders are compiled as GLSL ES 3.00 by three.js (WebGL2). */

/** "Hash without Sine" by David Hoskins (MIT). See THIRD_PARTY_NOTICES.md. */
export const HASH = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
`;

/**
 * 3D simplex noise from webgl-noise by Ian McEwan (Ashima Arts) and Stefan Gustavson (MIT).
 * https://github.com/stegu/webgl-noise. See THIRD_PARTY_NOTICES.md.
 */
export const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++){ s += a * snoise(p); p = p * 2.03 + vec3(17.1, 9.2, 4.7); a *= 0.5; }
  return s;
}
float fbm2(vec3 p){ return 0.6667 * snoise(p) + 0.3333 * snoise(p * 2.03 + 11.0); }
`;

/** Uniform declarations and helpers shared by scene materials (fog, wireframe, glyph style). */
export const SCENE = /* glsl */ `
uniform float uTime;
uniform float uWire;
uniform float uAscii;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec2 uRTSize;
uniform float uRTScale;
uniform float uPointMin;
uniform vec3 uMouseOrigin;
uniform vec3 uMouseDir;
uniform float uMouseActive;
#define STYLE(k) ((float(k) + 0.5) / 16.0)
float fogKeep(float d){ return exp(-uFogDensity * uFogDensity * d * d); }
vec3 applyFog(vec3 c, float d){ return mix(uFogColor, c, fogKeep(d)); }
`;

/** Fragment-only helpers (derivatives). */
export const WIRE = /* glsl */ `
float wireMix(){
  float v = 1.0 - gl_FragCoord.y / uRTSize.y;
  float e = uWire * 1.3 - 0.15;
  return 1.0 - smoothstep(e - 0.06, e + 0.06, v);
}
float wireScan(){
  float v = 1.0 - gl_FragCoord.y / uRTSize.y;
  float e = uWire * 1.3 - 0.15;
  float scanOn = step(0.002, uWire) * step(uWire, 0.998);
  return scanOn * exp(-pow((v - e) / 0.012, 2.0));
}
float lineBary(vec3 b, float w){
  vec3 d = fwidth(b);
  vec3 a = smoothstep(d * (w - 0.5), d * (w + 0.5), b);
  return 1.0 - min(min(a.x, a.y), a.z);
}
float lineGrid(vec2 uv, float w){
  vec2 f = abs(fract(uv - 0.5) - 0.5);
  vec2 d = fwidth(uv);
  vec2 a = smoothstep(d * (w - 0.5), d * (w + 0.5), f);
  return 1.0 - min(a.x, a.y);
}
/** Latitude/longitude wire grid on a unit direction, seam-safe. */
float lineGlobe(vec3 n, float lonDiv, float latDiv, float w){
  float lon = atan(n.z, n.x) / 6.2831853 + 0.5;
  float lat = asin(clamp(n.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  vec2 g = vec2(lon * lonDiv, lat * latDiv);
  vec2 f = abs(fract(g - 0.5) - 0.5);
  float dlon = min(fwidth(lon), fwidth(fract(lon + 0.5))) * lonDiv;
  vec2 d = vec2(dlon, fwidth(g.y));
  vec2 a = smoothstep(d * (w - 0.5), d * (w + 0.5), f);
  return 1.0 - min(a.x, a.y);
}
vec3 flatNormal(vec3 worldPos){ return normalize(cross(dFdx(worldPos), dFdy(worldPos))); }
`;

/** Point sprite helpers: constant-energy points that fade instead of shrinking below the minimum. */
export const POINTS = /* glsl */ `
float pointSize(float sizeCss, float dist, float attenRef, out float fade){
  float s = sizeCss * uRTScale * (attenRef > 0.0 ? attenRef / max(dist, 0.001) : 1.0);
  fade = clamp(s / uPointMin, 0.0, 1.0);
  fade *= fade;
  return max(s, uPointMin);
}
`;

/** Curve that maps a transition value to a per-cell flip, as a radial decode wave. */
export const CELL_TRANSITION = /* glsl */ `
float cellTransition(vec2 cell, vec2 grid, vec2 cellPx, float a){
  if (a >= 0.999) return 1.0;
  if (a <= 0.001) return 0.0;
  vec2 c = (cell + 0.5) / grid - 0.5;
  c.x *= (grid.x * cellPx.x) / (grid.y * cellPx.y);
  float r = length(c) / 0.9;
  float th = r * 0.72 + hash12(cell * 1.37 + 3.1) * 0.28;
  return smoothstep(th - 0.06, th + 0.06, a * 1.14 - 0.07);
}
`;
