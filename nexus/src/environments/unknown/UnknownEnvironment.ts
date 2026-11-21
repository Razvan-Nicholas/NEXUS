import * as THREE from 'three';
import gsap from 'gsap';
import type { Engine } from '../../core/Engine';
import type { Environment, EnvironmentConfig, QualitySettings, SceneId, Selectable, TransitionKind } from '../../core/types';
import { G, STYLE, additive, additiveStyled, shared } from '../../core/uniforms';
import { HASH, POINTS, SCENE, SIMPLEX, WIRE } from '../../render/glsl/chunks';
import { mulberry32, type Rng } from '../../core/math';
import { pushToast, store } from '../../core/store';
import { SpaceDust, glyphMesh, quadGeometry, withBarycentric, type GlyphInstance } from '../../materials/library';

interface Dimension {
  key: string;
  label: string;
  a: string;
  b: string;
  c: string;
  fog: string;
  invert: number;
  flip: boolean;
  seed: number;
}

const DIMENSIONS: Record<string, Dimension> = {
  α: { key: 'α', label: 'α PRIME', a: '#A000FF', b: '#00E5FF', c: '#FF00A8', fog: '#08050f', invert: 0, flip: false, seed: 11 },
  β: { key: 'β', label: 'β NEGATIVE', a: '#6A00E0', b: '#0098B8', c: '#D4008C', fog: '#08050f', invert: 1, flip: false, seed: 23 },
  γ: { key: 'γ', label: 'γ INFRARED', a: '#FF00A8', b: '#FF6A1F', c: '#A000FF', fog: '#100509', invert: 0, flip: true, seed: 37 },
};

const SPAWN = new THREE.Vector3(0, 10, 118);
const PENROSE_POS = new THREE.Vector3(-118, 6, -24);
const PENROSE_DIR = new THREE.Vector3(0.62, 0.3, 0.72).normalize();
const SWARM_POS = new THREE.Vector3(70, 24, 52);
const FORM_POS = new THREE.Vector3(0, 40, -96);
const KNOT_POS = new THREE.Vector3(105, 16, -60);
const OMEGA_POS = new THREE.Vector3(-34, -8, 46);
const RETURN_POS = new THREE.Vector3(0, 6, 72);
const PHRASE = 'REALITY IS JUST ANOTHER RENDERING';

const ROTATE = /* glsl */ `
vec3 rotateAxis(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
`;

const DISTORT = /* glsl */ `
uniform float uTwist;
vec3 distort(vec3 wp){
  float a = sin(wp.y * 0.035 + uTime * 0.25) * 0.1 * uTwist + length(wp.xz) * 0.0008 * uTwist * sin(uTime * 0.17);
  float c = cos(a), s = sin(a);
  wp.xz = mat2(c, -s, s, c) * wp.xz;
  wp.y += sin(length(wp.xz) * 0.045 - uTime * 0.6) * 1.1 * uTwist;
  return wp;
}
`;

// ── curved grid floor and ceiling: a lens-shaped pocket universe ──
const GRID_VERT = /* glsl */ `
${SCENE}
uniform float uSide;
uniform float uBase;
uniform float uCurve;
varying vec3 vWorld;
varying float vD;
void main(){
  vec3 p = position;
  float d = length(p.xz);
  p.y = uBase + uSide * d * d * uCurve + sin(d * 0.05 - uTime * 0.5) * 0.8;
  vD = d;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GRID_FRAG = /* glsl */ `
${SCENE}
${WIRE}
uniform vec3 uColor;
uniform vec3 uPulse;
uniform float uLimit;
varying vec3 vWorld;
varying float vD;
void main(){
  if (vD > uLimit) discard;
  float l = lineGrid(vWorld.xz / 16.0, 1.15);
  float fine = lineGrid(vWorld.xz / 4.0, 0.8) * 0.18;
  float ring = smoothstep(0.96, 1.0, fract(vD * 0.012 - uTime * 0.08));
  float fade = 1.0 - smoothstep(uLimit * 0.75, uLimit, vD);
  vec3 col = uColor * (l * 0.42 + fine * 0.45) * fade + uPulse * ring * 0.28 * fade + vec3(0.006, 0.004, 0.012);
  col = mix(col, uColor * l * 0.9 * fade, wireMix());
  gl_FragColor = vec4(applyFog(col, length(cameraPosition - vWorld)), STYLE(0));
}
`;

// ── generic faceted sculpture material (tesseract, totems, Penrose) ──
const SOLID_VERT = /* glsl */ `
${SCENE}
${DISTORT}
attribute vec3 aBary;
uniform float uDistort;
varying vec3 vWorld;
varying vec3 vBary;
varying vec2 vUv;
varying vec3 vWN;
void main(){
  vec4 local = vec4(position, 1.0);
  vec3 nrm = normal;
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  nrm = mat3(instanceMatrix) * normal;
  #endif
  vec4 wp = modelMatrix * local;
  wp.xyz = mix(wp.xyz, distort(wp.xyz), uDistort);
  vWorld = wp.xyz;
  vBary = aBary;
  vUv = uv;
  vWN = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SOLID_FRAG = /* glsl */ `
${SCENE}
${WIRE}
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uMode;
uniform float uStyle;
uniform float uEmit;
varying vec3 vWorld;
varying vec3 vBary;
varying vec2 vUv;
varying vec3 vWN;
void main(){
  vec3 N = flatNormal(vWorld);
  if (dot(N, vWN) < 0.0) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float edge = uMode < 0.5 ? lineBary(vBary, 1.1) : lineGrid(vUv, 1.3);
  vec3 col;
  if (uMode > 1.5) {
    float top = max(N.y, 0.0);
    float side = abs(dot(N, normalize(vec3(1.0, 0.0, 0.4))));
    col = uB * (0.12 + top * 1.1) + uA * side * 0.55 + uC * (1.0 - top) * (1.0 - side) * 0.25;
  } else {
    vec3 L = normalize(vec3(0.4, 0.9, 0.3));
    float diff = max(dot(N, L), 0.0) * 0.8 + 0.2;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    col = mix(uA, uC, fres) * diff * 0.4 + uB * fres * 0.6;
  }
  col += uB * edge * uEmit;
  vec3 wcol = mix(uB, uA, 0.4) * edge * 1.5 + col * 0.02;
  col = mix(col, wcol, wireMix()) + uB * wireScan() * 2.0;
  gl_FragColor = vec4(applyFog(col, length(cameraPosition - vWorld)), (uStyle + 0.5) / 16.0);
}
`;

// ── torus knot with flowing data ──
const KNOT_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec3 vWorld;
varying vec3 vBary;
varying vec2 vUv;
varying vec3 vWN;
void main(){
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  float u = vUv.x * 160.0 - uTime * 6.0;
  float cell = floor(u);
  float bit = step(0.45, hash12(vec2(cell, floor(vUv.y * 6.0))));
  float g = bit * smoothstep(0.1, 0.25, fract(u)) * (1.0 - smoothstep(0.75, 0.9, fract(u)));
  vec3 col = mix(uA, uC, vUv.y) * (0.08 + fres * 0.9) + uB * g * 1.6;
  float e = lineGrid(vec2(vUv.x * 80.0, vUv.y * 8.0), 1.0);
  col = mix(col, uB * e * 1.4, wireMix());
  gl_FragColor = vec4(applyFog(col, length(cameraPosition - vWorld)), STYLE(${STYLE.DATA}));
}
`;

// ── morphing particle formation ──
const FORM_VERT = /* glsl */ `
${SCENE}
${POINTS}
${SIMPLEX}
attribute vec3 aRand;
attribute float aSize;
uniform float uShapeA;
uniform float uShapeB;
uniform float uMorph;
uniform vec3 uCenter;
uniform float uScale;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec3 vColor;
vec3 shape(float id, vec3 r){
  if (id < 0.5) {
    float th = r.x * 6.2831853;
    float ph = acos(2.0 * r.y - 1.0);
    return vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th)) * (0.92 + r.z * 0.08);
  } else if (id < 1.5) {
    float u = r.x * 6.2831853;
    float v = r.y * 6.2831853;
    return vec3((0.72 + 0.3 * cos(v)) * cos(u), 0.3 * sin(v), (0.72 + 0.3 * cos(v)) * sin(u));
  } else if (id < 2.5) {
    float t = r.x * 2.0 - 1.0;
    float a = t * 9.0 + step(0.5, r.y) * 3.14159265;
    float k = r.z < 0.18 ? (r.y * 2.0 - 1.0) : 1.0;
    return vec3(cos(a) * 0.5 * k, t * 1.15, sin(a) * 0.5 * k);
  } else {
    vec3 g = floor(r * 5.0) / 4.0 * 2.0 - 1.0;
    float axis = floor(fract(r.z * 7.31) * 3.0);
    float s = fract(r.x * 13.7) * 2.0 - 1.0;
    if (axis < 0.5) g.x = s; else if (axis < 1.5) g.y = s; else g.z = s;
    return g * 0.78;
  }
}
void main(){
  float m = smoothstep(0.0, 1.0, clamp(uMorph * 1.3 - aRand.z * 0.3, 0.0, 1.0));
  vec3 p = mix(shape(uShapeA, aRand), shape(uShapeB, aRand), m);
  p += vec3(snoise(p * 2.0 + uTime * 0.2), snoise(p * 2.0 + 7.0 + uTime * 0.2), snoise(p * 2.0 + 13.0 + uTime * 0.2)) * 0.05;
  vec3 wp = uCenter + p * uScale;
  vec3 toP = wp - uMouseOrigin;
  vec3 closest = uMouseOrigin + uMouseDir * dot(toP, uMouseDir);
  vec3 away = wp - closest;
  float dd = length(away);
  wp += away / max(dd, 1e-3) * uMouseActive * 10.0 * exp(-dd * dd / 60.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float fade;
  gl_PointSize = pointSize(aSize, -mv.z, 200.0, fade);
  vec3 c = mix(uA, uB, p.y * 0.5 + 0.5);
  c = mix(c, uC, smoothstep(0.7, 1.0, aRand.x));
  vColor = c * fade * (0.5 + 0.6 * sin(uTime * 2.0 + aRand.y * 30.0) * 0.5 + 0.3) * fogKeep(-mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = /* glsl */ `
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

// ── glyph swarm that can assemble into a sentence ──
const SWARM_VERT = /* glsl */ `
${SCENE}
${ROTATE}
attribute vec3 aOffset;
attribute vec3 aTarget;
attribute vec4 aRect;
attribute vec3 aColor;
attribute float aSeed;
attribute float aPhrase;
uniform vec3 uCenter;
uniform float uAssemble;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vUv;
varying vec3 vColor;
varying float vDist;
void main(){
  float k = smoothstep(aSeed * 0.35, aSeed * 0.35 + 0.65, uAssemble);
  vec3 drift = vec3(sin(uTime * 0.31 + aSeed * 40.0), cos(uTime * 0.23 + aSeed * 17.0), sin(uTime * 0.27 + aSeed * 9.0)) * 3.0;
  vec3 free = uCenter + aOffset + drift;
  float scale = mix(3.6 + aSeed * 3.0, 3.4, k * aPhrase);
  scale *= mix(1.0, aPhrase, k);
  vec3 axis = normalize(vec3(sin(aSeed * 12.0), 1.0, cos(aSeed * 7.0)));
  vec3 localFree = rotateAxis(vec3(position.xy * vec2(0.66, 1.0), 0.0), axis, uTime * (0.2 + aSeed * 0.6) + aSeed * 20.0);
  vec3 localBill = uRight * position.x * 0.66 + uUp * position.y;
  vec3 center = mix(free, aTarget, k * aPhrase);
  vec3 wp = center + mix(localFree, localBill, k * aPhrase) * scale;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  vUv = aRect.xy + (position.xy + 0.5) * aRect.zw;
  vColor = aColor * (1.0 + k * aPhrase * 1.2);
  gl_Position = projectionMatrix * mv;
}
`;

const SWARM_FRAG = /* glsl */ `
${SCENE}
uniform sampler2D tGlyphs;
varying vec2 vUv;
varying vec3 vColor;
varying float vDist;
void main(){
  float g = texture(tGlyphs, vUv).r;
  if (g < 0.4) discard;
  gl_FragColor = vec4(vColor * fogKeep(vDist), STYLE(0));
}
`;

// ── portals ──
const VORTEX_FRAG = /* glsl */ `
${SCENE}
${HASH}
uniform vec3 uA;
uniform vec3 uB;
uniform float uReveal;
uniform float uWireOnly;
varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float spiral = 0.5 + 0.5 * sin(a * 5.0 + log(r + 0.02) * 9.0 - uTime * 4.0);
  float rings = 0.5 + 0.5 * sin(r * 30.0 - uTime * 6.0);
  float vis = uReveal * mix(1.0, smoothstep(0.35, 0.75, uWire), uWireOnly);
  vec3 col = mix(uA, uB, spiral) * (spiral * 0.9 + rings * 0.3) * (1.0 - r * 0.6) * 1.4;
  col += uB * (1.0 - smoothstep(0.0, 0.2, r)) * 2.0;
  gl_FragColor = vec4(col * vis, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
${SCENE}
uniform vec3 uB;
uniform float uReveal;
uniform float uWireOnly;
varying vec2 vUv;
void main(){
  float vis = uReveal * mix(1.0, smoothstep(0.35, 0.75, uWire), uWireOnly);
  if (vis < 0.02) discard;
  float pulse = 0.7 + 0.3 * sin(vUv.x * 60.0 - uTime * 5.0);
  gl_FragColor = vec4(uB * 2.4 * pulse * vis, STYLE(${STYLE.GLITCH}));
}
`;

const BASIC_VERT = /* glsl */ `
${SCENE}
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

interface Portal {
  id: 'Δ' | 'Ω' | 'Ψ' | 'R';
  group: THREE.Group;
  reveal: { v: number };
  wireOnly: boolean;
  materials: THREE.ShaderMaterial[];
  destination: () => void;
}

export default class UnknownEnvironment implements Environment {
  readonly id = 'unknown' as const;
  readonly config: EnvironmentConfig = {
    id: 'unknown',
    zone: 'unknown',
    audio: 'unknown',
    background: '#050509',
    fogColor: '#08050f',
    fogDensity: 0.0042,
    camera: { fov: 62, near: 0.1, far: 4000 },
    movement: { speed: 16, boost: 5 },
    ascii: { exposure: 1.35, gamma: 0.9, edge: 1, voidDust: 0.9, lens: 2, glyphGain: 1.1, floor: 0.035 },
    bloom: { strength: 0.95, threshold: 0.5 },
    exposure: 1,
    hint: 'SOMETHING IS HIDDEN HERE · LOOK FROM EVERY ANGLE · TRY EVERY RENDERING',
  };
  readonly scene = new THREE.Scene();
  private engine!: Engine;
  private world = new THREE.Group();
  private U = {
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
    uC: { value: new THREE.Color() },
    uTwist: { value: 1 },
  };
  private dim: Dimension = DIMENSIONS['α'];
  private grids: THREE.ShaderMaterial[] = [];
  private tesseract!: THREE.InstancedMesh;
  private tesseractNodes!: THREE.InstancedMesh;
  private tPoints4 = [] as number[][];
  private tEdges = [] as [number, number][];
  private penrose!: THREE.Group;
  private vantage!: THREE.Mesh;
  private knot!: THREE.Mesh;
  private formMat!: THREE.ShaderMaterial;
  private form!: THREE.Points;
  private formCount = 0;
  private formState = { a: 0, b: 1, morph: 0, timer: 0 };
  private swarm!: THREE.Mesh;
  private swarmMat!: THREE.ShaderMaterial;
  private swarmState = { assemble: 0 };
  private assembled = false;
  private totems = new THREE.Group();
  private totemPieces: { mesh: THREE.Mesh; speed: number }[] = [];
  private horizon!: THREE.Mesh;
  private portals: Portal[] = [];
  private dust!: SpaceDust;
  private selectables: Selectable[] = [];
  private aligned = false;
  private timeIn = 0;
  private hinted = { wire: false, vantage: false };
  private shifting = false;
  private activePortal: Portal | null = null;
  private spatialOn = false;
  private tmpM = new THREE.Matrix4();
  private twistBase = 1;

  async init(engine: Engine) {
    this.engine = engine;
    const rng = mulberry32(99);
    this.scene.add(this.world);
    this.setPalette(DIMENSIONS['α']);

    // Floor and ceiling bend toward each other and meet at r ≈ 300.
    const gridGeo = new THREE.PlaneGeometry(680, 680, 136, 136);
    gridGeo.rotateX(-Math.PI / 2);
    for (const side of [1, -1]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          ...shared(),
          uSide: { value: side },
          uBase: { value: side > 0 ? -42 : 78 },
          uCurve: { value: 0.00064 },
          uColor: { value: side > 0 ? this.U.uA.value : this.U.uB.value },
          uPulse: { value: this.U.uC.value },
          uLimit: { value: 292 },
        },
      });
      this.grids.push(mat);
      const m = new THREE.Mesh(side > 0 ? gridGeo : gridGeo.clone(), mat);
      m.frustumCulled = false;
      this.world.add(m);
    }

    this.buildTesseract();
    this.buildPenrose();
    this.buildKnot();
    this.buildFormation(rng);
    this.buildSwarm(rng);
    this.buildHorizonGlyphs(rng);
    this.world.add(this.totems);
    this.buildTotems(this.dim.seed);
    this.buildPortals();

    this.dust = new SpaceDust(rng, 1600, 160, '#C9A6FF', 1.1, 0.05);
    this.scene.add(this.dust.mesh);
    this.buildSelectables();
  }

  private solidMaterial(mode: number, style: number, emit = 0.6, distort = 0) {
    return new THREE.ShaderMaterial({
      vertexShader: SOLID_VERT,
      fragmentShader: SOLID_FRAG,
      uniforms: { ...shared(), ...this.U, uMode: { value: mode }, uStyle: { value: style }, uEmit: { value: emit }, uDistort: { value: distort } },
    });
  }

  private setPalette(d: Dimension) {
    this.dim = d;
    this.U.uA.value.set(d.a);
    this.U.uB.value.set(d.b);
    this.U.uC.value.set(d.c);
    G.uFogColor.value.set(d.fog);
    store.set({ dimension: d.label });
  }

  // ── tesseract: a 4D hypercube rotating in XW / YW / ZW, perspective-projected to 3D ──
  private buildTesseract() {
    for (let i = 0; i < 16; i++) this.tPoints4.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
    for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) {
      const diff = this.tPoints4[a].reduce((n, v, k) => n + (v !== this.tPoints4[b][k] ? 1 : 0), 0);
      if (diff === 1) this.tEdges.push([a, b]);
    }
    const beamGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tesseract = new THREE.InstancedMesh(beamGeo, this.solidMaterial(1, STYLE.CRYSTAL, 1.1), this.tEdges.length);
    this.tesseract.frustumCulled = false;
    this.tesseractNodes = new THREE.InstancedMesh(withBarycentric(new THREE.OctahedronGeometry(1.3, 0)), this.solidMaterial(0, STYLE.CRYSTAL, 1.4), 16);
    this.tesseractNodes.frustumCulled = false;
    this.world.add(this.tesseract, this.tesseractNodes);
  }

  private updateTesseract(t: number) {
    const a1 = t * 0.31;
    const a2 = t * 0.19;
    const a3 = t * 0.13;
    const D = 4;
    const scale = 9;
    const pts: THREE.Vector3[] = [];
    for (const v of this.tPoints4) {
      let [x, y, z, w] = v;
      [x, w] = [x * Math.cos(a1) - w * Math.sin(a1), x * Math.sin(a1) + w * Math.cos(a1)];
      [y, w] = [y * Math.cos(a2) - w * Math.sin(a2), y * Math.sin(a2) + w * Math.cos(a2)];
      [z, w] = [z * Math.cos(a3) - w * Math.sin(a3), z * Math.sin(a3) + w * Math.cos(a3)];
      [x, z] = [x * Math.cos(a3 * 0.7) - z * Math.sin(a3 * 0.7), x * Math.sin(a3 * 0.7) + z * Math.cos(a3 * 0.7)];
      const k = D / (D - w);
      pts.push(new THREE.Vector3(x * k * scale, y * k * scale + 8, z * k * scale));
    }
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    this.tEdges.forEach(([a, b], i) => {
      const pa = pts[a];
      const pb = pts[b];
      const d = pb.clone().sub(pa);
      const len = d.length();
      q.setFromUnitVectors(zAxis, d.normalize());
      this.tmpM.compose(pa.clone().add(pb).multiplyScalar(0.5), q, new THREE.Vector3(0.7, 0.7, len + 0.7));
      this.tesseract.setMatrixAt(i, this.tmpM);
    });
    pts.forEach((p, i) => {
      this.tmpM.compose(p, q.identity(), new THREE.Vector3(1, 1, 1));
      this.tesseractNodes.setMatrixAt(i, this.tmpM);
    });
    this.tesseract.instanceMatrix.needsUpdate = true;
    this.tesseractNodes.instanceMatrix.needsUpdate = true;
  }

  // ── Penrose triangle: three beams that only close up when seen along one exact direction ──
  private buildPenrose() {
    const L = 20;
    const w = 3.2;
    const mat = this.solidMaterial(2, STYLE.STANDARD, 0.5);
    const g = new THREE.Group();
    const beam = (from: THREE.Vector3, to: THREE.Vector3) => {
      const d = to.clone().sub(from);
      const len = d.length() + w;
      const geo = new THREE.BoxGeometry(Math.abs(d.x) > 0 ? len : w, Math.abs(d.y) > 0 ? len : w, Math.abs(d.z) > 0 ? len : w);
      const m = new THREE.Mesh(withBarycentric(geo), mat);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      g.add(m);
    };
    const p0 = new THREE.Vector3(0, 0, 0);
    const p1 = new THREE.Vector3(L, 0, 0);
    const p2 = new THREE.Vector3(L, L, 0);
    const p3 = new THREE.Vector3(L, L, L);
    beam(p0, p1);
    beam(p1, p2);
    beam(p2, p3);
    g.children.forEach((c) => c.position.sub(new THREE.Vector3(L / 2, L / 2, L / 2)));
    this.penrose = new THREE.Group();
    this.penrose.add(g);
    this.penrose.quaternion.setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), PENROSE_DIR);
    this.penrose.position.copy(PENROSE_POS);
    this.world.add(this.penrose);

    const vMat = additive(
      new THREE.ShaderMaterial({
        vertexShader: BASIC_VERT,
        fragmentShader: /* glsl */ `
          ${SCENE}
          uniform vec3 uB;
          uniform float uOn;
          varying vec2 vUv;
          void main(){ float p = 0.55 + 0.45 * sin(uTime * 2.4 + vUv.x * 40.0); gl_FragColor = vec4(uB * p * 1.4 * uOn, 1.0); }
        `,
        uniforms: { ...shared(), uB: this.U.uB, uOn: { value: 1 } },
      }),
    );
    this.vantage = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.14, 8, 96), vMat);
    this.vantage.position.copy(PENROSE_POS).addScaledVector(PENROSE_DIR, 96);
    this.vantage.lookAt(PENROSE_POS);
    this.world.add(this.vantage);
  }

  private buildKnot() {
    const geo = new THREE.TorusKnotGeometry(13, 2.6, 360, 24, 2, 5);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SOLID_VERT,
      fragmentShader: KNOT_FRAG,
      uniforms: { ...shared(), ...this.U, uDistort: { value: 0 } },
    });
    this.knot = new THREE.Mesh(geo, mat);
    this.knot.position.copy(KNOT_POS);
    this.world.add(this.knot);
  }

  private buildFormation(rng: Rng) {
    const n = 16000;
    this.formCount = n;
    const rand = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      rand.set([rng(), rng(), rng()], i * 3);
      size[i] = 1.1 + Math.pow(rng(), 4) * 2.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rand, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.formMat = additiveStyled(
      new THREE.ShaderMaterial({
        vertexShader: FORM_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: {
          ...shared(),
          ...this.U,
          uShapeA: { value: 0 },
          uShapeB: { value: 1 },
          uMorph: { value: 0 },
          uCenter: { value: FORM_POS.clone() },
          uScale: { value: 30 },
          uStyleA: { value: (STYLE.GLITCH + 0.5) / 16 },
        },
      }),
    );
    this.form = new THREE.Points(g, this.formMat);
    this.form.frustumCulled = false;
    this.world.add(this.form);
  }

  private buildSwarm(rng: Rng) {
    const atlas = this.engine.atlas;
    const tex = atlas.getDisplayTexture();
    const phrase = PHRASE.replace(/ /g, '').split('');
    const extra = '#@%&?!$*<>/\\{}[]=+~^01'.split('');
    const n = phrase.length + 90;
    const g = quadGeometry();
    const off = new Float32Array(n * 3);
    const tgt = new Float32Array(n * 3);
    const rect = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const isPhrase = new Float32Array(n);
    const pal = [new THREE.Color('#F5F3FF'), new THREE.Color('#00E5FF'), new THREE.Color('#C77DFF')];
    for (let i = 0; i < n; i++) {
      const ch = i < phrase.length ? phrase[i] : extra[Math.floor(rng() * extra.length)];
      const d = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(6 + Math.cbrt(rng()) * 26);
      off.set([d.x, d.y * 0.6, d.z], i * 3);
      tgt.set([SWARM_POS.x, SWARM_POS.y, SWARM_POS.z], i * 3);
      rect.set(atlas.displayRect(ch), i * 4);
      const c = pal[i % pal.length].clone().multiplyScalar(0.7 + rng() * 0.6);
      col.set([c.r, c.g, c.b], i * 3);
      seed[i] = rng();
      isPhrase[i] = i < phrase.length ? 1 : 0;
    }
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('aTarget', new THREE.InstancedBufferAttribute(tgt, 3));
    g.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.setAttribute('aPhrase', new THREE.InstancedBufferAttribute(isPhrase, 1));
    g.instanceCount = n;
    this.swarmMat = new THREE.ShaderMaterial({
      vertexShader: SWARM_VERT,
      fragmentShader: SWARM_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...shared(),
        tGlyphs: { value: tex },
        uCenter: { value: SWARM_POS.clone() },
        uAssemble: { value: 0 },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
      },
    });
    this.swarm = new THREE.Mesh(g, this.swarmMat);
    this.swarm.frustumCulled = false;
    this.world.add(this.swarm);
  }

  /** Lay the phrase out on a line facing the visitor, then let the letters find their places. */
  private assemble() {
    if (this.assembled) return;
    this.assembled = true;
    const cam = this.engine.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    right.y = 0;
    right.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    this.swarmMat.uniforms.uRight.value.copy(right);
    this.swarmMat.uniforms.uUp.value.copy(up);
    const attr = this.swarm.geometry.getAttribute('aTarget') as THREE.InstancedBufferAttribute;
    const spacing = 3.6;
    const words = PHRASE.split(' ');
    const positions: THREE.Vector3[] = [];
    const lines = [words.slice(0, 2).join(' '), words.slice(2).join(' ')];
    lines.forEach((line, li) => {
      const start = -((line.length - 1) * spacing) / 2;
      line.split('').forEach((ch, ci) => {
        if (ch === ' ') return;
        positions.push(SWARM_POS.clone().addScaledVector(right, start + ci * spacing).addScaledVector(up, (0.5 - li) * 6));
      });
    });
    positions.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
    attr.needsUpdate = true;
    this.engine.audio.play('discover');
    gsap.to(this.swarmState, {
      assemble: 1,
      duration: 3.2,
      ease: 'power2.inOut',
      onComplete: () => this.revealPortal('Ψ', 'SIGNAL DECODED — PORTAL Ψ OPENED'),
    });
  }

  private buildHorizonGlyphs(rng: Rng) {
    const atlas = this.engine.atlas;
    const chars = '?@#&%$*NEXUS'.split('');
    const inst: GlyphInstance[] = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.1;
      const r = 230 + rng() * 40;
      inst.push({
        char: chars[i % chars.length],
        pos: new THREE.Vector3(Math.cos(a) * r, 10 + rng() * 40, Math.sin(a) * r),
        quat: new THREE.Quaternion(),
        scale: 16 + rng() * 22,
        color: new THREE.Color(rng() < 0.5 ? '#6B5A9E' : '#3E6E80'),
      });
    }
    this.horizon = glyphMesh(inst, atlas.getDisplayTexture(), (c) => atlas.displayRect(c), STYLE.GLITCH, true);
    this.world.add(this.horizon);
  }

  // ── totems: seeded stacks of rotating primitives, regenerated per dimension ──
  private buildTotems(seed: number) {
    this.totems.children.forEach((c) => disposeTree(c));
    this.totems.clear();
    this.totemPieces = [];
    const rng = mulberry32(seed);
    const geos = [
      () => new THREE.TorusGeometry(3.2, 0.9, 6, 18),
      () => new THREE.OctahedronGeometry(3.4, 0),
      () => new THREE.IcosahedronGeometry(3.2, 0),
      () => new THREE.BoxGeometry(4.6, 4.6, 4.6),
      () => new THREE.ConeGeometry(3, 6, 5),
      () => new THREE.DodecahedronGeometry(3.1, 0),
      () => new THREE.TorusGeometry(4.2, 0.4, 4, 4),
    ];
    const count = 8;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.3 + 0.2;
      const r = 150 + rng() * 60;
      const base = new THREE.Vector3(Math.cos(a) * r, -18 + rng() * 10, Math.sin(a) * r);
      const pieces = 3 + Math.floor(rng() * 4);
      let y = 0;
      for (let k = 0; k < pieces; k++) {
        const geo = withBarycentric(geos[Math.floor(rng() * geos.length)]());
        const mat = this.solidMaterial(0, k % 2 ? STYLE.CRYSTAL : STYLE.DATA, 0.8, 1);
        const mesh = new THREE.Mesh(geo, mat);
        const s = 0.8 + rng() * 1.6;
        mesh.scale.setScalar(s);
        y += 4 * s + 2;
        mesh.position.copy(base).add(new THREE.Vector3(0, y, 0));
        mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        this.totems.add(mesh);
        this.totemPieces.push({ mesh, speed: (rng() - 0.5) * 1.6 });
        y += 4 * s;
      }
    }
  }

  private buildPortals() {
    const make = (id: Portal['id'], pos: THREE.Vector3, wireOnly: boolean, destination: () => void, a: string, b: string): Portal => {
      const group = new THREE.Group();
      group.position.copy(pos);
      const reveal = { v: id === 'Ω' || id === 'R' ? 1 : 0 };
      const ua = { value: new THREE.Color(a) };
      const ub = { value: new THREE.Color(b) };
      const disc = additive(
        new THREE.ShaderMaterial({
          vertexShader: BASIC_VERT,
          fragmentShader: VORTEX_FRAG,
          side: THREE.DoubleSide,
          uniforms: { ...shared(), uA: ua, uB: ub, uReveal: { value: reveal.v }, uWireOnly: { value: wireOnly ? 1 : 0 } },
        }),
      );
      const ring = new THREE.ShaderMaterial({
        vertexShader: BASIC_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { ...shared(), uB: ub, uReveal: { value: reveal.v }, uWireOnly: { value: wireOnly ? 1 : 0 } },
      });
      group.add(new THREE.Mesh(new THREE.CircleGeometry(6.6, 64), disc));
      group.add(new THREE.Mesh(new THREE.TorusGeometry(7, 0.42, 8, 128), ring));
      group.visible = reveal.v > 0;
      this.world.add(group);
      return { id, group, reveal, wireOnly, materials: [disc, ring], destination };
    };
    this.portals = [
      make('Ω', OMEGA_POS, true, () => this.shiftDimension('β'), '#F5F3FF', '#00E5FF'),
      make('Δ', PENROSE_POS.clone().add(new THREE.Vector3(0, -17, 0)), false, () => this.shiftDimension('γ'), '#FF6A1F', '#FF00A8'),
      make('Ψ', SWARM_POS.clone().add(new THREE.Vector3(0, -16, 0)), false, () => void this.engine.director.travel('cosmos', 'portal'), '#A000FF', '#00E5FF'),
      make('R', RETURN_POS, false, () => this.shiftDimension('α'), '#F5F3FF', '#A000FF'),
    ];
    this.portalById('R').group.visible = false;
  }

  private portalById(id: Portal['id']) {
    return this.portals.find((p) => p.id === id)!;
  }

  private revealPortal(id: Portal['id'], message: string) {
    const p = this.portalById(id);
    if (p.reveal.v > 0.99 && p.group.visible) return;
    p.group.visible = true;
    gsap.to(p.reveal, { v: 1, duration: 2, ease: 'power2.out' });
    this.markAnomaly(id, message);
  }

  private markAnomaly(id: string, message: string) {
    const s = store.get();
    if (id === 'R' || s.anomalies.includes(id)) return;
    store.set({ anomalies: [...s.anomalies, id] });
    pushToast(message, 'discovery', 5200);
    this.engine.audio.play('discover');
  }

  private portalSelectable(p: Portal, name: string, designation: string, description: string): Selectable {
    return {
      id: `portal-${p.id}`,
      name,
      kind: 'portal',
      radius: 8,
      getPosition: (t) => p.group.getWorldPosition(t),
      info: { id: `portal-${p.id}`, name, designation, kind: 'portal', accent: '#FF00A8', description, stats: [{ label: 'Destination', value: designation.split('→ ')[1] ?? 'Unknown' }] },
      interactLabel: 'ENTER',
      interactRange: 34,
      tone: 587.33,
      isAvailable: () => p.group.visible && p.reveal.v > 0.5 && (!p.wireOnly || G.uWire.value > 0.6),
      onInteract: () => this.enterPortal(p),
    };
  }

  private buildSelectables() {
    const [omega, delta, psi, ret] = this.portals;
    this.selectables = [
      {
        id: 'tesseract',
        name: 'TESSERACT',
        kind: 'artifact',
        radius: 22,
        getPosition: (t) => t.set(0, 8, 0),
        info: {
          id: 'tesseract',
          name: 'TESSERACT',
          designation: '4D HYPERCUBE // PROJECTED',
          kind: 'artifact',
          accent: '#00E5FF',
          stats: [
            { label: 'Vertices', value: '16' },
            { label: 'Edges', value: '32' },
            { label: 'Rotation planes', value: 'XW · YW · ZW' },
          ],
          description: 'A cube that is also turning in a direction you cannot point to. What you see is its shadow in three dimensions.',
        },
        interactLabel: 'APPROACH',
        interactRange: 0,
        tone: 440,
        onInteract: () => this.engine.approach(new THREE.Vector3(0, 8, 0), 55),
      },
      {
        id: 'penrose',
        name: 'IMPOSSIBLE TRIANGLE',
        kind: 'artifact',
        radius: 22,
        getPosition: (t) => t.copy(PENROSE_POS),
        info: {
          id: 'penrose',
          name: 'IMPOSSIBLE TRIANGLE',
          designation: 'PENROSE // UNRESOLVED',
          kind: 'artifact',
          accent: '#FF6A1F',
          stats: [
            { label: 'Beams', value: '3' },
            { label: 'Closed', value: 'From one angle' },
          ],
          description: 'Three beams that never touch. From exactly one vantage point they agree to form a triangle — and something answers.',
        },
        interactLabel: 'OBSERVE',
        interactRange: 0,
        tone: 349.23,
        onInteract: () => this.observeVantage(),
      },
      {
        id: 'vantage',
        name: 'VANTAGE POINT',
        kind: 'anomaly',
        radius: 5,
        getPosition: (t) => this.vantage.getWorldPosition(t),
        info: { id: 'vantage', name: 'VANTAGE POINT', designation: 'OBSERVATION // MARKER', kind: 'anomaly', accent: '#00E5FF', description: 'Someone left a place to stand.' },
        interactLabel: 'OBSERVE FROM',
        interactRange: 40,
        tone: 523.25,
        onInteract: () => this.observeVantage(),
      },
      {
        id: 'swarm',
        name: 'GLYPH SWARM',
        kind: 'artifact',
        radius: 30,
        getPosition: (t) => t.copy(SWARM_POS),
        info: {
          id: 'swarm',
          name: 'GLYPH SWARM',
          designation: 'FLOATING ASCII // ENCRYPTED',
          kind: 'artifact',
          accent: '#C77DFF',
          stats: [
            { label: 'Characters', value: '117' },
            { label: 'Entropy', value: 'Suspiciously low' },
          ],
          description: 'Characters drifting in no order at all. Some of them seem to be waiting for an instruction.',
        },
        interactLabel: 'ASSEMBLE',
        interactRange: 70,
        tone: 659.25,
        isAvailable: () => true,
        onInteract: () => {
          if (!this.assembled) this.assemble();
          else this.engine.approach(SWARM_POS, 45);
        },
      },
      {
        id: 'formation',
        name: 'FORMATION',
        kind: 'artifact',
        radius: 34,
        getPosition: (t) => t.copy(FORM_POS),
        info: {
          id: 'formation',
          name: 'FORMATION',
          designation: 'REACTIVE PARTICLES // 16,000',
          kind: 'artifact',
          accent: '#A000FF',
          description: 'It keeps trying on shapes. Move your cursor through it and it moves out of the way, politely.',
        },
        interactLabel: 'APPROACH',
        interactRange: 0,
        tone: 293.66,
        onInteract: () => this.engine.approach(FORM_POS, 80),
      },
      {
        id: 'knot',
        name: 'INFINITE LOOP',
        kind: 'artifact',
        radius: 20,
        getPosition: (t) => t.copy(KNOT_POS),
        info: { id: 'knot', name: 'INFINITE LOOP', designation: 'TORUS KNOT (2,5) // DATA', kind: 'artifact', accent: '#FF00A8', description: 'A stream of data with no beginning, travelling a path with no end.' },
        interactLabel: 'APPROACH',
        interactRange: 0,
        tone: 392,
        onInteract: () => this.engine.approach(KNOT_POS, 60),
      },
      this.portalSelectable(omega, 'PORTAL Ω', 'WIRE-ONLY // → β NEGATIVE', 'It exists only in wireframe. In any other rendering, there is nothing here at all.'),
      this.portalSelectable(delta, 'PORTAL Δ', 'IMPOSSIBLE // → γ INFRARED', 'Opened by an angle that should not exist.'),
      this.portalSelectable(psi, 'PORTAL Ψ', 'DECODED // → THE COSMOS', 'The sentence was the key. The way back out.'),
      this.portalSelectable(ret, 'RETURN', 'STABLE // → α PRIME', 'A door back to the dimension you came from.'),
    ];
  }

  getSelectables() {
    return this.selectables;
  }

  private observeVantage() {
    const e = this.engine;
    if (e.director.busy) return;
    const rig = e.rig;
    rig.beginCinematic();
    const look = rig.lookTarget.clone();
    const to = PENROSE_POS.clone().addScaledVector(PENROSE_DIR, 96);
    store.set({ phase: 'transition' });
    gsap
      .timeline({
        onComplete: () => {
          rig.setFree();
          store.set({ phase: 'explore' });
        },
      })
      .to(look, { x: PENROSE_POS.x, y: PENROSE_POS.y, z: PENROSE_POS.z, duration: 1.0, ease: 'power2.inOut', onUpdate: () => rig.lookTarget.copy(look) }, 0)
      .to(rig.position, { x: to.x, y: to.y, z: to.z, duration: 3.4, ease: 'power3.inOut' }, 0.3);
  }

  private enterPortal(p: Portal) {
    if (this.shifting || this.engine.director.busy) return;
    this.activePortal = p;
    p.destination();
  }

  /** Dimension shift: dive into the portal, glitch out, re-seed the world, glitch back in. */
  private shiftDimension(key: string) {
    if (this.shifting || this.engine.director.busy) return;
    const target = DIMENSIONS[key];
    const e = this.engine;
    const rig = e.rig;
    const fx = e.pipeline.fx;
    const portal = this.activePortal ?? this.portals[0];
    const pos = portal.group.getWorldPosition(new THREE.Vector3());
    this.shifting = true;
    e.selection.select(null);
    e.input.locked = true;
    store.set({ phase: 'transition' });
    e.audio.play('portal');
    rig.beginCinematic();
    const look = rig.lookTarget.clone();
    gsap
      .timeline({
        onComplete: () => {
          rig.setFree();
          e.input.locked = false;
          this.shifting = false;
          store.set({ phase: 'explore' });
        },
      })
      .to(look, { x: pos.x, y: pos.y, z: pos.z, duration: 0.7, ease: 'power2.inOut', onUpdate: () => rig.lookTarget.copy(look) }, 0)
      .to(rig.position, { x: pos.x, y: pos.y, z: pos.z, duration: 1.8, ease: 'power3.in' }, 0.3)
      .to(fx, { glitch: 1, scramble: 0.7, chroma: 0.02, duration: 1.6, ease: 'power2.in' }, 0.3)
      .to(fx, { flash: 1, duration: 0.3 }, 1.8)
      .add(() => {
        this.applyDimension(target);
        rig.position.copy(SPAWN);
        rig.lookTarget.set(0, 8, 0);
        rig.camera.position.copy(SPAWN);
      }, 2.15)
      .to(fx, { flash: 0, duration: 0.6, ease: 'power2.out' }, 2.2)
      .to(fx, { glitch: 0, scramble: 0, chroma: 0, duration: 1.4, ease: 'power3.out' }, 2.2);
  }

  private applyDimension(d: Dimension, rebuild = true) {
    this.setPalette(d);
    if (rebuild) this.buildTotems(d.seed);
    this.grids[0].uniforms.uSide.value = d.flip ? -1 : 1;
    this.grids[1].uniforms.uSide.value = d.flip ? 1 : -1;
    this.twistBase = d.flip ? 2.6 : d.invert ? 1.6 : 1;
    this.engine.pipeline.fx.invert = d.invert;
    store.set({ inverted: d.invert > 0.5 });
    this.portalById('R').group.visible = d.key !== 'α';
    this.portalById('R').reveal.v = 1;
    this.formState.timer = 0;
    pushToast(`DIMENSION ${d.label}`, 'info', 3000);
  }

  enter(engine: Engine) {
    this.timeIn = 0;
    this.spatialOn = false;
    this.applyDimension(DIMENSIONS['α'], this.dim.key !== 'α');
    engine.pipeline.fx.invert = 1;
    const rig = engine.rig;
    rig.mode = 'free';
    rig.position.copy(SPAWN);
    rig.camera.position.copy(SPAWN);
    rig.lookAtNow(new THREE.Vector3(0, 8, 0));
  }

  entryCinematic(engine: Engine, from: SceneId | null, kind: TransitionKind): Promise<void> {
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    rig.mode = 'cinematic';
    const fromHorizon = kind === 'horizon';
    rig.position.set(0, fromHorizon ? 190 : 40, fromHorizon ? 40 : 260);
    rig.lookTarget.set(0, 8, 0);
    rig.fov = 110;
    rig.roll = fromHorizon ? 1.4 : 0;
    if (!fromHorizon) fx.invert = 0;
    return new Promise((resolve) => {
      gsap
        .timeline({
          onComplete: () => {
            rig.setFree();
            rig.zoomFov = this.config.camera.fov;
            resolve();
          },
        })
        .to(fx, { flash: 0, duration: 1.2, ease: 'power2.out' }, 0)
        .to(fx, { invert: 0, duration: 1.6, ease: 'power2.inOut' }, 0.6)
        .to(fx, { warp: 0, scramble: 0, chroma: 0, glitch: 0, fade: 0, duration: 2.4, ease: 'power3.out' }, 0)
        .to(rig.position, { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, duration: 4.0, ease: 'expo.out' }, 0)
        .to(rig, { fov: this.config.camera.fov, roll: 0, duration: 4.0, ease: 'expo.out' }, 0);
      void from;
    });
  }

  exitCinematic(engine: Engine, to: SceneId, kind: TransitionKind): Promise<void> {
    if (kind !== 'portal') return engine.director.defaultExit();
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    const p = this.portalById('Ψ').group.getWorldPosition(new THREE.Vector3());
    rig.beginCinematic();
    const look = rig.lookTarget.clone();
    void to;
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(look, { x: p.x, y: p.y, z: p.z, duration: 0.8, ease: 'power2.inOut', onUpdate: () => rig.lookTarget.copy(look) }, 0)
        .to(rig.position, { x: p.x, y: p.y, z: p.z, duration: 2.0, ease: 'power3.in' }, 0.3)
        .to(fx, { glitch: 0.8, scramble: 0.7, warp: 0.7, chroma: 0.015, duration: 1.8, ease: 'power2.in' }, 0.3)
        .to(fx, { flash: 1, duration: 0.35 }, 2.0);
    });
  }

  onQualityChange(q: QualitySettings) {
    this.form.geometry.setDrawRange(0, Math.floor(this.formCount * Math.max(0.35, q.particleScale)));
    this.dust.setScale(q.particleScale);
  }

  update(dt: number, t: number, engine: Engine) {
    this.timeIn += dt;
    this.updateTesseract(t);
    this.knot.rotation.set(t * 0.12, t * 0.2, 0);
    this.knot.position.y = KNOT_POS.y + Math.sin(t * 0.5) * 2;
    this.totemPieces.forEach((p) => (p.mesh.rotation.y += p.speed * dt));
    this.vantage.rotation.z += dt * 0.6;
    this.dust.update(engine.camera);
    this.swarmMat.uniforms.uAssemble.value = this.swarmState.assemble;
    this.U.uTwist.value = this.twistBase * (1 + Math.sin(t * 0.1) * 0.3);

    const fs = this.formState;
    fs.timer += dt;
    if (fs.timer > 7) {
      fs.timer = 0;
      fs.a = fs.b;
      fs.b = (fs.b + 1 + Math.floor(Math.random() * 2)) % 4;
      fs.morph = 0;
      gsap.to(fs, { morph: 1, duration: 2.6, ease: 'power2.inOut' });
    }
    const fu = this.formMat.uniforms;
    fu.uShapeA.value = fs.a;
    fu.uShapeB.value = fs.b;
    fu.uMorph.value = fs.morph;

    for (const p of this.portals) {
      p.group.lookAt(engine.camera.position);
      p.materials.forEach((m) => (m.uniforms.uReveal.value = p.reveal.v));
    }

    // Keep the negative dimension's inversion alive through transitions that reset effects.
    if (!this.shifting && store.get().phase === 'explore') engine.pipeline.fx.invert = this.dim.invert;

    if (!this.spatialOn && engine.audio.running) {
      this.spatialOn = true;
      engine.audio.addSpatial('tess', new THREE.Vector3(0, 8, 0), { freq: 220, gain: 0.04, ref: 30 });
      engine.audio.addSpatial('omega', OMEGA_POS, { freq: 1400, gain: 0.03, ref: 20, noise: true });
      engine.audio.addSpatial('penrose', PENROSE_POS, { freq: 900, gain: 0.03, ref: 25, noise: true });
    }

    if (store.get().phase !== 'explore' || this.shifting) return;
    const cam = engine.camera.position;

    // Hidden element: the Penrose triangle resolves only along its impossible axis.
    const toCam = cam.clone().sub(this.penrose.getWorldPosition(new THREE.Vector3()));
    const dist = toCam.length();
    const align = toCam.normalize().dot(PENROSE_DIR);
    if (!this.aligned && dist > 45 && dist < 190 && align > 0.9975) {
      this.aligned = true;
      this.revealPortal('Δ', 'IMPOSSIBLE GEOMETRY RESOLVED — PORTAL Δ');
    }
    if (!this.hinted.vantage && dist < 140) {
      this.hinted.vantage = true;
      pushToast('A VANTAGE POINT EXISTS', 'info', 3600);
    }
    if (!this.hinted.wire && this.timeIn > 24 && !store.get().anomalies.includes('Ω')) {
      this.hinted.wire = true;
      pushToast('SOME THINGS ONLY EXIST IN CERTAIN RENDERINGS', 'info', 5200);
    }
    if (G.uWire.value > 0.7) {
      const om = this.portalById('Ω');
      const omPos = om.group.getWorldPosition(new THREE.Vector3());
      const ndc = omPos.clone().project(engine.camera);
      if (Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.9 && ndc.z < 1 && cam.distanceTo(omPos) < 220) this.markAnomaly('Ω', 'WIREFRAME ANOMALY — PORTAL Ω');
    }
    // Flying through an open portal takes it.
    for (const p of this.portals) {
      if (!p.group.visible || p.reveal.v < 0.9 || (p.wireOnly && G.uWire.value < 0.6)) continue;
      if (cam.distanceTo(p.group.getWorldPosition(new THREE.Vector3())) < 5) {
        this.enterPortal(p);
        break;
      }
    }
    engine.rig.speedFactor = 1;
  }

  dispose() {
    gsap.killTweensOf(this.formState);
    gsap.killTweensOf(this.swarmState);
    this.portals.forEach((p) => gsap.killTweensOf(p.reveal));
    G.uFogColor.value.set('#050509');
    this.engine.pipeline.fx.invert = 0;
    store.set({ dimension: null, inverted: false });
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
}
