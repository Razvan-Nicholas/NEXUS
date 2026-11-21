import * as THREE from 'three';
import { HASH, POINTS, SCENE, SIMPLEX, WIRE } from '../render/glsl/chunks';
import { getNoiseTexture } from '../render/NoiseTexture';
import { additive, additiveStyled, shared } from '../core/uniforms';
import type { Rng } from '../core/math';

// ───────────────────────────── geometry helpers ─────────────────────────────

/** Adds a barycentric attribute (needs non-indexed geometry) for true triangle wireframes. */
export function withBarycentric(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const bary = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) bary[i * 3 + (i % 3)] = 1;
  g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  if (g !== geo) geo.dispose();
  return g;
}

/** Unit quad centred on the origin, used by instanced billboards. */
export function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// ───────────────────────────── star points ─────────────────────────────

export interface PointCloud {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  seeds?: Float32Array;
}

export function pointsGeometry(cloud: PointCloud) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(cloud.colors, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(cloud.sizes, 1));
  const n = cloud.sizes.length;
  const seeds = cloud.seeds ?? new Float32Array(n).map(() => Math.random());
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return g;
}

const POINTS_VERT = /* glsl */ `
${SCENE}
${POINTS}
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
uniform float uSizeScale;
uniform float uAttenRef;
uniform float uTwinkle;
uniform float uIntensity;
uniform float uFogMix;
varying vec3 vColor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  float fade;
  float size = pointSize(aSize * uSizeScale * (1.0 - 0.3 * uWire), dist, uAttenRef, fade);
  float tw = 1.0 + uTwinkle * sin(uTime * (0.6 + aSeed * 2.6) + aSeed * 61.0);
  vColor = aColor * tw * uIntensity * fade * mix(1.0, fogKeep(dist), uFogMix);
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;
}
`;

const POINTS_FRAG = /* glsl */ `
uniform float uStyleA;
varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, uStyleA);
}
`;

export function starPointsMaterial(o: { size?: number; atten?: number; twinkle?: number; intensity?: number; fog?: number; style?: number } = {}) {
  const blend = o.style !== undefined ? additiveStyled : additive;
  return blend(
    new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: {
        ...shared(),
        uSizeScale: { value: o.size ?? 1 },
        uAttenRef: { value: o.atten ?? 0 },
        uTwinkle: { value: o.twinkle ?? 0.25 },
        uIntensity: { value: o.intensity ?? 1 },
        uFogMix: { value: o.fog ?? 1 },
        uStyleA: { value: o.style !== undefined ? (o.style + 0.5) / 16 : 0 },
      },
    }),
  );
}

/** Random stars on a spherical shell, used for skies that follow the camera. */
export function shellStars(rng: Rng, count: number, radius: number, palette: THREE.Color[], sizeRange: [number, number], bright = 1): PointCloud {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * (0.85 + rng() * 0.3);
    positions.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
    c.copy(palette[Math.floor(rng() * palette.length)]);
    const b = bright * (0.25 + Math.pow(rng(), 3) * 1.6);
    colors.set([c.r * b, c.g * b, c.b * b], i * 3);
    sizes[i] = sizeRange[0] + Math.pow(rng(), 4) * (sizeRange[1] - sizeRange[0]);
  }
  return { positions, colors, sizes };
}

// ───────────────────────────── space dust ─────────────────────────────

const DUST_VERT = /* glsl */ `
${SCENE}
attribute vec3 aPos;
attribute float aSeed;
uniform vec3 uCamPos;
uniform vec3 uCamVel;
uniform float uBox;
uniform float uStretch;
uniform float uWidth;
varying float vA;
varying float vQ;
void main(){
  vec3 rel = fract(aPos - uCamPos / uBox) - 0.5;
  vec3 wp = uCamPos + rel * uBox;
  vec3 tail = wp - uCamVel * uStretch;
  vec4 ch = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  if (ch.w < 0.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vQ = 0.0; return; }
  if (ct.w < 0.2) ct = ch;
  vec2 h = ch.xy / ch.w;
  vec2 t = ct.xy / ct.w;
  vec2 asp = vec2(uRTSize.x / uRTSize.y, 1.0);
  vec2 d = (t - h) * asp;
  float len = min(length(d), 0.6);
  vec2 dir = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float wpx = uWidth * uRTScale * clamp(24.0 / ch.w, 0.5, 2.2);
  float px = 2.0 / uRTSize.y;
  float along = position.x * len + (position.x * 2.0 - 1.0) * wpx * px;
  vec2 ndc = h + (dir * along + nrm * position.y * wpx * px) / asp;
  gl_Position = vec4(ndc * ch.w, ch.z, ch.w);
  float edge = max(max(abs(rel.x), abs(rel.y)), abs(rel.z));
  vA = (1.0 - smoothstep(0.36, 0.5, edge)) * smoothstep(1.0, 6.0, ch.w) * (0.55 + 0.45 * aSeed) * (0.6 + 0.4 / (1.0 + len * 10.0));
  vQ = position.y;
}
`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uIntensity;
varying float vA;
varying float vQ;
void main(){
  float a = 1.0 - abs(vQ);
  gl_FragColor = vec4(uTint * vA * a * a * uIntensity, 1.0);
}
`;

export class SpaceDust {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  private max: number;

  constructor(rng: Rng, count: number, box: number, tint: string, width = 1.4, stretch = 0.09) {
    this.max = count;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([rng(), rng(), rng()], i * 3);
      seed[i] = rng();
    }
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = count;
    this.material = additive(
      new THREE.ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: {
          ...shared(),
          uCamPos: { value: new THREE.Vector3() },
          uBox: { value: box },
          uStretch: { value: stretch },
          uWidth: { value: width },
          uTint: { value: new THREE.Color(tint) },
          uIntensity: { value: 1 },
        },
      }),
    );
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setScale(s: number) {
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.max(1, Math.floor(this.max * s));
  }

  update(camera: THREE.Camera) {
    this.material.uniforms.uCamPos.value.copy(camera.position);
  }
}

// ───────────────────────────── nebula billboards ─────────────────────────────

const NEBULA_VERT = /* glsl */ `
${SCENE}
attribute vec3 aOffset;
attribute float aScale;
attribute vec3 aColor;
attribute float aSeed;
varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;
varying float vFade;
void main(){
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  float ang = aSeed * 6.2831 + uTime * 0.012 * (aSeed - 0.5);
  float c = cos(ang), s = sin(ang);
  mv.xy += mat2(c, s, -s, c) * position.xy * aScale;
  float dist = length(mv.xyz);
  vFade = smoothstep(aScale * 0.12, aScale * 0.85, dist) * fogKeep(dist * 0.6);
  vUv = position.xy + 0.5;
  vColor = aColor;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}
`;

const NEBULA_FRAG = /* glsl */ `
${SCENE}
${WIRE}
uniform sampler2D tNoise;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;
varying float vFade;
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float fall = 1.0 - smoothstep(0.15, 1.0, r);
  vec2 nuv = vUv * 0.75 + vec2(vSeed * 7.31, vSeed * 3.17) + vec2(uTime * 0.0015, -uTime * 0.001);
  vec4 n = texture(tNoise, nuv);
  vec4 n2 = texture(tNoise, nuv * 2.13 + 0.37);
  float dens = fall * smoothstep(0.28, 0.9, n.r * 0.62 + n2.g * 0.48);
  dens *= 0.55 + 0.9 * n.b;
  vec3 col = vColor * dens;
  float iso = dens * 7.0;
  float line = 1.0 - clamp(abs(fract(iso + 0.5) - 0.5) / max(fwidth(iso) * 1.2, 1e-4), 0.0, 1.0);
  vec3 wcol = vColor * line * step(0.03, dens) * 0.9;
  col = mix(col, wcol, wireMix());
  gl_FragColor = vec4(col * uIntensity * vFade, 1.0);
}
`;

export interface NebulaPuff {
  pos: THREE.Vector3;
  scale: number;
  color: THREE.Color;
}

export class NebulaField {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  private max: number;

  constructor(puffs: NebulaPuff[], intensity = 1) {
    this.max = puffs.length;
    const g = quadGeometry();
    const off = new Float32Array(puffs.length * 3);
    const sc = new Float32Array(puffs.length);
    const col = new Float32Array(puffs.length * 3);
    const seed = new Float32Array(puffs.length);
    puffs.forEach((p, i) => {
      off.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
      sc[i] = p.scale;
      col.set([p.color.r, p.color.g, p.color.b], i * 3);
      seed[i] = (i * 0.61803398875) % 1;
    });
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(sc, 1));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = puffs.length;
    this.material = additive(
      new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERT,
        fragmentShader: NEBULA_FRAG,
        uniforms: { ...shared(), tNoise: { value: getNoiseTexture() }, uIntensity: { value: intensity } },
      }),
    );
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  setScale(s: number) {
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.max(1, Math.floor(this.max * s));
  }
}

// ───────────────────────────── glow sprites ─────────────────────────────

const GLOW_VERT = /* glsl */ `
${SCENE}
uniform float uScale;
varying vec2 vUv;
varying float vDist;
void main(){
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uScale;
  vDist = length(mv.xyz);
  vUv = position.xy + 0.5;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
${SCENE}
${HASH}
${SIMPLEX}
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uIntensity;
uniform float uPower;
uniform float uRays;
uniform float uFog;
varying vec2 vUv;
varying float vDist;
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float g = pow(max(1.0 - r, 0.0), uPower);
  float core = pow(max(1.0 - r * 3.0, 0.0), 3.0);
  if (uRays > 0.0) {
    float a = atan(p.y, p.x);
    float rays = snoise(vec3(cos(a) * 2.5, sin(a) * 2.5, uTime * 0.15)) * 0.5 + 0.5;
    g *= mix(1.0, 0.55 + rays * 0.9, uRays * smoothstep(0.05, 0.4, r));
  }
  vec3 col = uColor * g + uCore * core;
  col *= uIntensity * mix(1.0, fogKeep(vDist), uFog) * (1.0 - 0.6 * uWire);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function glowSprite(o: { color: string; core?: string; scale: number; intensity?: number; power?: number; rays?: number; fog?: number }) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = additive(
    new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: {
        ...shared(),
        uScale: { value: o.scale },
        uColor: { value: new THREE.Color(o.color) },
        uCore: { value: new THREE.Color(o.core ?? '#000000') },
        uIntensity: { value: o.intensity ?? 1 },
        uPower: { value: o.power ?? 2.2 },
        uRays: { value: o.rays ?? 0 },
        uFog: { value: o.fog ?? 1 },
      },
    }),
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

// ───────────────────────────── 3D glyph objects ─────────────────────────────

const GLYPH_VERT = /* glsl */ `
${SCENE}
attribute vec3 aOffset;
attribute vec4 aRect;
attribute vec4 aRot;
attribute float aScale;
attribute vec3 aColor;
attribute float aSeed;
uniform float uBillboard;
varying vec2 vUv;
varying vec3 vColor;
varying float vDist;
vec3 rotateQ(vec3 v, vec4 q){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main(){
  vec3 local = vec3(position.xy * vec2(0.66, 1.0) * aScale, 0.0);
  vec4 mv;
  if (uBillboard > 0.5) {
    mv = modelViewMatrix * vec4(aOffset, 1.0);
    mv.xy += local.xy;
  } else {
    mv = modelViewMatrix * vec4(aOffset + rotateQ(local, aRot), 1.0);
  }
  vDist = length(mv.xyz);
  vUv = aRect.xy + (position.xy + 0.5) * aRect.zw;
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}
`;

const GLYPH_FRAG = /* glsl */ `
${SCENE}
uniform sampler2D tGlyphs;
uniform float uIntensity;
uniform float uStyle;
varying vec2 vUv;
varying vec3 vColor;
varying float vDist;
void main(){
  float g = texture(tGlyphs, vUv).r;
  if (g < 0.35) discard;
  vec3 col = vColor * uIntensity * fogKeep(vDist);
  gl_FragColor = vec4(col, (uStyle + 0.5) / 16.0);
}
`;

export interface GlyphInstance {
  char: string;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  color: THREE.Color;
}

/** Instanced, alpha-tested character planes: literal ASCII objects floating in 3D. */
export function glyphMesh(instances: GlyphInstance[], displayTex: THREE.Texture, rectFor: (c: string) => [number, number, number, number], style: number, billboard = false) {
  const g = quadGeometry();
  const n = instances.length;
  const off = new Float32Array(n * 3);
  const rect = new Float32Array(n * 4);
  const rot = new Float32Array(n * 4);
  const sc = new Float32Array(n);
  const col = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  instances.forEach((it, i) => {
    off.set([it.pos.x, it.pos.y, it.pos.z], i * 3);
    rect.set(rectFor(it.char), i * 4);
    rot.set([it.quat.x, it.quat.y, it.quat.z, it.quat.w], i * 4);
    sc[i] = it.scale;
    col.set([it.color.r, it.color.g, it.color.b], i * 3);
    seed[i] = i / Math.max(1, n);
  });
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  g.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  g.setAttribute('aRot', new THREE.InstancedBufferAttribute(rot, 4));
  g.setAttribute('aScale', new THREE.InstancedBufferAttribute(sc, 1));
  g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    vertexShader: GLYPH_VERT,
    fragmentShader: GLYPH_FRAG,
    uniforms: { ...shared(), tGlyphs: { value: displayTex }, uIntensity: { value: 1 }, uStyle: { value: style }, uBillboard: { value: billboard ? 1 : 0 } },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}
