import * as THREE from 'three';
import { HASH, SCENE, SIMPLEX, WIRE } from '../../render/glsl/chunks';
import { getNoiseTexture } from '../../render/NoiseTexture';
import { additive, shared } from '../../core/uniforms';
import { gaussian, type Rng } from '../../core/math';
import type { NebulaPuff, PointCloud } from '../../materials/library';

export interface GalaxyFrame {
  core: THREE.Vector3;
  normal: THREE.Vector3;
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  armOffset: number;
  arms: number;
  pitch: number;
  r0: number;
}

export function galaxyFrame(core: THREE.Vector3, normal: THREE.Vector3): GalaxyFrame {
  const n = normal.clone().normalize();
  const t1 = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 0, 1)).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const rel = core.clone().negate();
  const x = rel.dot(t1);
  const z = rel.dot(t2);
  const rSys = Math.hypot(x, z);
  const thetaSys = Math.atan2(z, x);
  const pitch = Math.tan(THREE.MathUtils.degToRad(14));
  const r0 = 120;
  // Rotate the spiral so an arm passes right through the Lumen system.
  const armOffset = thetaSys - Math.log(rSys / r0) / pitch + 0.08;
  return { core: core.clone(), normal: n, t1, t2, armOffset, arms: 4, pitch, r0 };
}

export function galaxyPoint(f: GalaxyFrame, r: number, theta: number, y: number, out: THREE.Vector3) {
  return out
    .copy(f.core)
    .addScaledVector(f.t1, r * Math.cos(theta))
    .addScaledVector(f.t2, r * Math.sin(theta))
    .addScaledVector(f.normal, y);
}

function armTheta(f: GalaxyFrame, r: number, arm: number) {
  return f.armOffset + (arm * Math.PI * 2) / f.arms + Math.log(Math.max(r, f.r0) / f.r0) / f.pitch;
}

export function buildGalaxyStars(rng: Rng, f: GalaxyFrame, count: number): PointCloud {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const pal = {
    warm: new THREE.Color('#FFF1E0'),
    white: new THREE.Color('#F5F3FF'),
    cyan: new THREE.Color('#7FF3FF'),
    purple: new THREE.Color('#B266FF'),
    magenta: new THREE.Color('#FF5CC8'),
    blue: new THREE.Color('#9DB4FF'),
  };
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  let i = 0;
  while (i < count) {
    const field = rng() < 0.16;
    const bulge = rng() < 0.14;
    let r = bulge ? Math.abs(gaussian(rng)) * 380 + 30 : -Math.log(1 - rng() * 0.97) * 1450 + 120;
    r = Math.min(r, 5200);
    let theta: number;
    if (field || bulge) theta = rng() * Math.PI * 2;
    else {
      const arm = Math.floor(rng() * f.arms);
      const spread = 0.2 + 0.24 * (r / 5200);
      theta = armTheta(f, r, arm) + gaussian(rng) * spread;
    }
    const thick = bulge ? 240 : 26 + 200 * Math.exp(-r / 500);
    const y = gaussian(rng) * thick * 0.5;
    galaxyPoint(f, r, theta, y, p);
    if (p.length() < 260) continue;
    positions.set([p.x, p.y, p.z], i * 3);
    const roll = rng();
    if (r < 700 || bulge) c.copy(pal.warm).lerp(pal.cyan, rng() * 0.4);
    else if (roll < 0.42) c.copy(pal.white);
    else if (roll < 0.66) c.copy(pal.cyan);
    else if (roll < 0.84) c.copy(pal.purple);
    else if (roll < 0.93) c.copy(pal.blue);
    else c.copy(pal.magenta);
    const b = (bulge ? 0.7 : 0.35) + Math.pow(rng(), 3) * 1.7;
    colors.set([c.r * b, c.g * b, c.b * b], i * 3);
    sizes[i] = 1.05 + Math.pow(rng(), 6) * 3.6;
    seeds[i] = rng();
    i++;
  }
  return { positions, colors, sizes, seeds };
}

export function buildGalaxyNebulae(rng: Rng, f: GalaxyFrame, count: number): NebulaPuff[] {
  const out: NebulaPuff[] = [];
  const cols = ['#4A0E91', '#7A0A55', '#0B5566', '#2A1880', '#610B8C'].map((h) => new THREE.Color(h));
  const p = new THREE.Vector3();
  while (out.length < count) {
    const r = 500 + rng() * 4200;
    const arm = Math.floor(rng() * f.arms);
    const theta = armTheta(f, r, arm) + gaussian(rng) * 0.16 + 0.12;
    galaxyPoint(f, r, theta, gaussian(rng) * 30, p);
    if (p.length() < 700) continue;
    const color = cols[Math.floor(rng() * cols.length)].clone().multiplyScalar(0.11 + rng() * 0.1);
    out.push({ pos: p.clone(), scale: 220 + rng() * 520, color });
  }
  return out;
}

export function nebulaCluster(rng: Rng, center: THREE.Vector3, radius: number, count: number, hexes: string[], gain: number): NebulaPuff[] {
  const cols = hexes.map((h) => new THREE.Color(h));
  const out: NebulaPuff[] = [];
  for (let i = 0; i < count; i++) {
    const d = new THREE.Vector3(gaussian(rng), gaussian(rng) * 0.55, gaussian(rng)).multiplyScalar(radius * 0.42);
    const color = cols[Math.floor(rng() * cols.length)].clone().multiplyScalar(gain * (0.6 + rng() * 0.8));
    out.push({ pos: center.clone().add(d), scale: radius * (0.35 + rng() * 0.6), color });
  }
  return out;
}

// ───────────────────────────── sky ─────────────────────────────

const SKY_VERT = /* glsl */ `
${SCENE}
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

const SKY_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
${SIMPLEX}
uniform vec3 uNormal;
uniform vec3 uCoreDir;
uniform vec3 uBand;
uniform vec3 uCoreCol;
uniform vec3 uTint;
uniform sampler2D tNoise;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float lat = dot(d, uNormal);
  float band = exp(-pow(lat / 0.16, 2.0));
  float wisps = texture(tNoise, vec2(atan(d.z, d.x) * 0.6, lat * 3.0) + 0.3).r;
  float dust = texture(tNoise, vec2(atan(d.z, d.x) * 1.4, lat * 7.0) + 0.7).g;
  band *= 0.45 + 0.9 * wisps;
  band *= 1.0 - smoothstep(0.55, 0.85, dust) * 0.75 * exp(-pow(lat / 0.05, 2.0));
  float core = pow(max(dot(d, uCoreDir), 0.0), 18.0);
  float coreHalo = pow(max(dot(d, uCoreDir), 0.0), 4.0);
  vec3 col = uBand * band + uCoreCol * (core * 1.4 + coreHalo * 0.12 * band);
  col += uTint * (0.5 + 0.5 * snoise(d * 2.0)) * 0.012;
  col *= 1.0 - 0.75 * uWire;
  gl_FragColor = vec4(col, STYLE(0));
}
`;

export function buildSky(f: GalaxyFrame, radius: number) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      ...shared(),
      uNormal: { value: f.normal.clone() },
      uCoreDir: { value: f.core.clone().normalize() },
      uBand: { value: new THREE.Color('#3B2A78').multiplyScalar(0.045) },
      uCoreCol: { value: new THREE.Color('#C9B8FF').multiplyScalar(0.07) },
      uTint: { value: new THREE.Color('#A000FF') },
      tNoise: { value: getNoiseTexture() },
    },
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 5), mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}

// ───────────────────────────── distant galaxies ─────────────────────────────

const DG_VERT = /* glsl */ `
${SCENE}
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const DG_FRAG = /* glsl */ `
${SCENE}
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uArms;
uniform float uTwist;
uniform float uSeed;
uniform sampler2D tNoise;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float spiral = 0.5 + 0.5 * cos(uArms * (a - uTwist * log(r + 0.05)) + uSeed * 6.0);
  float n = texture(tNoise, p * 0.6 + uSeed).r;
  float disk = exp(-r * 3.2) * (0.35 + 0.9 * pow(spiral, 2.2) * (0.6 + 0.6 * n));
  float core = exp(-r * 16.0) * 1.6;
  vec3 col = mix(uColB, uColA, exp(-r * 4.0)) * disk + uColA * core;
  col *= (1.0 - smoothstep(0.75, 1.0, r)) * (1.0 - 0.7 * uWire);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildDistantGalaxies(rng: Rng, count: number, dist: number, avoidNormal: THREE.Vector3) {
  const group = new THREE.Group();
  const noise = getNoiseTexture();
  for (let i = 0; i < count; i++) {
    let d = new THREE.Vector3();
    do {
      d.set(gaussian(rng), gaussian(rng), gaussian(rng)).normalize();
    } while (Math.abs(d.dot(avoidNormal)) < 0.3);
    const size = dist * (0.035 + rng() * 0.05);
    const pal: [string, string][] = [
      ['#F5F3FF', '#6A2BD9'],
      ['#CFFAFF', '#1B6FA8'],
      ['#FFE3F6', '#9A1475'],
    ];
    const [a, b] = pal[i % pal.length];
    const mat = additive(
      new THREE.ShaderMaterial({
        vertexShader: DG_VERT,
        fragmentShader: DG_FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          ...shared(),
          uColA: { value: new THREE.Color(a).multiplyScalar(0.5) },
          uColB: { value: new THREE.Color(b).multiplyScalar(0.4) },
          uArms: { value: rng() < 0.5 ? 2 : 3 },
          uTwist: { value: 2.2 + rng() * 2 },
          uSeed: { value: rng() * 10 },
          tNoise: { value: noise },
        },
      }),
    );
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.position.copy(d.multiplyScalar(dist));
    m.lookAt(0, 0, 0);
    m.rotateX((rng() - 0.5) * 2.2);
    m.rotateZ(rng() * Math.PI);
    m.renderOrder = -90;
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
