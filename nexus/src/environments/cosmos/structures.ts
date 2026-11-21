import * as THREE from 'three';
import { HASH, SCENE, SIMPLEX, WIRE } from '../../render/glsl/chunks';
import { STYLE, additive, shared } from '../../core/uniforms';
import { withBarycentric } from '../../materials/library';
import { gaussian, type Rng } from '../../core/math';

const ROTATE = /* glsl */ `
vec3 rotateAxis(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
`;

// ───────────────────────────── asteroid belt ─────────────────────────────

const ROCK_VERT = /* glsl */ `
${SCENE}
${SIMPLEX}
${ROTATE}
attribute vec3 aBary;
attribute vec4 aOrbit;
attribute vec4 aSpin;
attribute float aScale;
attribute float aSeed;
varying vec3 vWorld;
varying vec3 vBary;
varying float vSeed;
void main(){
  float ang = aOrbit.y + uTime * aOrbit.z;
  vec3 center = vec3(cos(ang) * aOrbit.x, aOrbit.w, sin(ang) * aOrbit.x);
  vec3 p = position;
  p *= 1.0 + snoise(p * 1.6 + aSeed * 31.0) * 0.38;
  p *= aScale * vec3(1.0, 0.65 + aSeed * 0.5, 0.85);
  p = rotateAxis(p, normalize(aSpin.xyz), uTime * aSpin.w + aSeed * 10.0);
  vec4 wp = modelMatrix * vec4(center + p, 1.0);
  vWorld = wp.xyz;
  vBary = aBary;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ROCK_FRAG = /* glsl */ `
${SCENE}
${WIRE}
uniform vec3 uStarPos;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uWireCol;
varying vec3 vWorld;
varying vec3 vBary;
varying float vSeed;
void main(){
  vec3 N = flatNormal(vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uStarPos - vWorld);
  float diff = max(dot(N, L), 0.0);
  vec3 base = mix(uColA, uColB, vSeed);
  vec3 col = base * (0.03 + diff * 1.1);
  col += uWireCol * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.06;
  float e = lineBary(vBary, 1.0);
  col = mix(col, uWireCol * e * 1.2 + base * 0.01, wireMix());
  col = applyFog(col, length(cameraPosition - vWorld));
  gl_FragColor = vec4(col, STYLE(0));
}
`;

export class AsteroidBelt {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  private max: number;

  constructor(rng: Rng, count: number, inner: number, outer: number, starPos: THREE.Vector3) {
    this.max = count;
    const base = withBarycentric(new THREE.IcosahedronGeometry(1, 1));
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setAttribute('aBary', base.attributes.aBary);
    const orbit = new Float32Array(count * 4);
    const spin = new Float32Array(count * 4);
    const scale = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = inner + (outer - inner) * (0.5 + gaussian(rng) * 0.22);
      orbit.set([r, rng() * Math.PI * 2, 0.012 * Math.pow(170 / r, 1.5), gaussian(rng) * 3.5], i * 4);
      const ax = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      spin.set([ax.x, ax.y, ax.z, (rng() - 0.5) * 1.4], i * 4);
      scale[i] = 0.25 + Math.pow(rng(), 5) * 3.2;
      seed[i] = rng();
    }
    g.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = count;
    this.material = new THREE.ShaderMaterial({
      vertexShader: ROCK_VERT,
      fragmentShader: ROCK_FRAG,
      uniforms: {
        ...shared(),
        uStarPos: { value: starPos },
        uColA: { value: new THREE.Color('#5A5470') },
        uColB: { value: new THREE.Color('#2A2638') },
        uWireCol: { value: new THREE.Color('#8A91A8').multiplyScalar(0.55) },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  setScale(s: number) {
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.max(1, Math.floor(this.max * s));
  }
}

// ───────────────────────────── beams / blocks with edge lines ─────────────────────────────

const BLOCK_VERT = /* glsl */ `
${SCENE}
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vWN;
varying float vAlong;
varying float vId;
void main(){
  vec4 local = vec4(position, 1.0);
  vec3 nrm = normal;
  vId = 0.0;
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  nrm = mat3(instanceMatrix) * normal;
  vId = float(gl_InstanceID);
  #endif
  vUv = uv;
  vAlong = position.z + 0.5;
  vec4 wp = modelMatrix * local;
  vWorld = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LATTICE_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform vec3 uStarPos;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vWN;
varying float vAlong;
varying float vId;
void main(){
  vec3 N = normalize(vWN);
  vec3 L = normalize(uStarPos - vWorld);
  float diff = max(dot(N, L), 0.0);
  float e = lineGrid(vUv, 1.2);
  float pulse = smoothstep(0.86, 1.0, fract(vAlong * 1.0 - uTime * 0.22 + hash11(vId) ));
  vec3 col = vec3(0.05, 0.045, 0.085) * (0.15 + diff * 1.2);
  col += uColA * e * 0.9 + uColA * pulse * 2.4 + uColB * pulse * e;
  col = mix(col, uColA * e * 1.6 + uColB * pulse * 0.8, wireMix());
  col = applyFog(col, length(cameraPosition - vWorld));
  gl_FragColor = vec4(col, STYLE(${STYLE.DATA}));
}
`;

const NODE_FRAG = /* glsl */ `
${SCENE}
${WIRE}
uniform vec3 uColA;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vWN;
varying float vAlong;
varying float vId;
void main(){
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  float beat = 0.6 + 0.4 * sin(uTime * 2.0 + vId * 1.7);
  vec3 col = uColA * (1.2 + fres * 2.0) * beat;
  col = mix(col, uColA * 1.4 * fres + uColA * 0.2, wireMix());
  gl_FragColor = vec4(applyFog(col, length(cameraPosition - vWorld)), STYLE(0));
}
`;

export function buildLattice(radius: number, starPos: THREE.Vector3) {
  const group = new THREE.Group();
  const ico = new THREE.IcosahedronGeometry(radius, 0);
  const pos = ico.attributes.position as THREE.BufferAttribute;
  const verts: THREE.Vector3[] = [];
  const key = (v: THREE.Vector3) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const map = new Map<string, number>();
  const tri: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = key(v);
    if (!map.has(k)) {
      map.set(k, verts.length);
      verts.push(v);
    }
    tri.push(map.get(k)!);
  }
  ico.dispose();
  const edges = new Set<string>();
  for (let i = 0; i < tri.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = tri[i + j];
      const b = tri[i + ((j + 1) % 3)];
      edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
  }
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: BLOCK_VERT,
    fragmentShader: LATTICE_FRAG,
    uniforms: { ...shared(), uStarPos: { value: starPos }, uColA: { value: new THREE.Color('#00E5FF') }, uColB: { value: new THREE.Color('#A000FF') } },
  });
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), beamMat, edges.size);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const z = new THREE.Vector3(0, 0, 1);
  let idx = 0;
  edges.forEach((e) => {
    const [a, b] = e.split('-').map(Number);
    const pa = verts[a];
    const pb = verts[b];
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const dir = pb.clone().sub(pa);
    const len = dir.length();
    q.setFromUnitVectors(z, dir.normalize());
    m.compose(mid, q, new THREE.Vector3(1.6, 1.6, len));
    beams.setMatrixAt(idx++, m);
  });
  beams.instanceMatrix.needsUpdate = true;
  group.add(beams);

  const nodeMat = new THREE.ShaderMaterial({
    vertexShader: BLOCK_VERT,
    fragmentShader: NODE_FRAG,
    uniforms: { ...shared(), uColA: { value: new THREE.Color('#00E5FF') } },
  });
  const nodes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(4.2, 0), nodeMat, verts.length);
  verts.forEach((v, i) => {
    m.compose(v, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    nodes.setMatrixAt(i, m);
  });
  nodes.instanceMatrix.needsUpdate = true;
  group.add(nodes);
  return group;
}

const MONOLITH_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform vec3 uStarPos;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vWN;
varying float vAlong;
varying float vId;
void main(){
  vec3 N = normalize(vWN);
  vec3 L = normalize(uStarPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 30.0);
  float rows = 54.0;
  float row = floor(vUv.y * rows + uTime * 3.0 + vId * 7.0);
  float colm = floor(vUv.x * 6.0);
  float bit = step(0.55, hash12(vec2(colm + vId * 13.0, row)));
  vec2 cell = fract(vec2(vUv.x * 6.0, vUv.y * rows + uTime * 3.0 + vId * 7.0));
  float glyph = bit * step(0.18, cell.x) * step(cell.x, 0.82) * step(0.2, cell.y) * step(cell.y, 0.8);
  float side = step(0.5, abs(N.y)) ;
  vec3 col = vec3(0.012, 0.01, 0.02) * (0.3 + diff) + vec3(0.5) * spec * 0.25;
  col += mix(uColA, uColB, hash11(vId)) * glyph * 1.5 * (1.0 - side);
  float e = lineGrid(vUv, 1.2);
  col += uColA * e * 0.35;
  col = mix(col, uColA * e * 1.5 + uColA * glyph * 0.25, wireMix());
  col = applyFog(col, length(cameraPosition - vWorld));
  gl_FragColor = vec4(col, STYLE(${STYLE.DATA}));
}
`;

export function buildMonoliths(count: number, radius: number, starPos: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: BLOCK_VERT,
    fragmentShader: MONOLITH_FRAG,
    uniforms: { ...shared(), uStarPos: { value: starPos }, uColA: { value: new THREE.Color('#A000FF') }, uColB: { value: new THREE.Color('#00E5FF') } },
  });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 36, 1.2), mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const a = (i / (count - 1) - 0.5) * 1.9;
    const p = new THREE.Vector3(Math.sin(a) * radius, Math.sin(i * 1.7) * 3, -Math.cos(a) * radius);
    q.setFromEuler(new THREE.Euler(0, -a, 0));
    m.compose(p, q, new THREE.Vector3(1, 0.8 + (i % 3) * 0.15, 1));
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ───────────────────────────── anomaly ─────────────────────────────

const ANOMALY_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform float uVisible;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vWN;
varying float vAlong;
varying float vId;
void main(){
  if (uVisible < 0.5) discard;
  vec3 N = normalize(vWN);
  float blocks = hash12(floor(vUv * 6.0) + floor(uTime * 14.0));
  vec3 a = vec3(1.0, 0.0, 0.66) * 2.2;
  vec3 b = vec3(0.0, 0.9, 1.0) * 2.2;
  vec3 col = mix(a, b, step(0.5, blocks)) * (0.4 + 0.6 * step(0.3, blocks));
  col *= 0.6 + 0.4 * abs(N.x);
  float e = lineGrid(vUv, 1.4);
  col = mix(col, b * e, wireMix());
  gl_FragColor = vec4(col, STYLE(${STYLE.GLITCH}));
}
`;

export function buildAnomaly() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: BLOCK_VERT,
    fragmentShader: ANOMALY_FRAG,
    uniforms: { ...shared(), uVisible: { value: 1 } },
  });
  return new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 3.2), mat);
}

// ───────────────────────────── orbit paths ─────────────────────────────

const ORBIT_VERT = /* glsl */ `
${SCENE}
attribute float aT;
uniform float uPhase;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  gl_PointSize = max(1.6 * uRTScale, uPointMin);
  float trail = fract(aT - uPhase);
  vA = (0.22 + 0.78 * pow(trail, 10.0)) * fogKeep(dist) * (1.0 - 0.5 * uWire);
  gl_Position = projectionMatrix * mv;
}
`;

const ORBIT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.3, 1.0, d);
  gl_FragColor = vec4(uColor * vA * a, 1.0);
}
`;

export function buildOrbitPath(radius: number, inclination: number, color: string, count = 360) {
  const pos = new Float32Array(count * 3);
  const t = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pos.set([Math.cos(a) * radius, Math.sin(a) * radius * inclination, Math.sin(a) * radius], i * 3);
    t[i] = i / count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  const mat = additive(
    new THREE.ShaderMaterial({
      vertexShader: ORBIT_VERT,
      fragmentShader: ORBIT_FRAG,
      uniforms: { ...shared(), uColor: { value: new THREE.Color(color).multiplyScalar(0.55) }, uPhase: { value: 0 } },
    }),
  );
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}
