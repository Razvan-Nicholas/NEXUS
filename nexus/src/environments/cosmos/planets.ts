import * as THREE from 'three';
import { HASH, SCENE, SIMPLEX, WIRE } from '../../render/glsl/chunks';
import { STYLE, additive, shared } from '../../core/uniforms';
import { withBarycentric } from '../../materials/library';
import { mulberry32 } from '../../core/math';
import type { PlanetDefinition } from '../../core/types';

const BUMP = /* glsl */ `
vec3 bumpNormal(vec3 N, vec3 pos, float h, float k){
  vec3 dpx = dFdx(pos);
  vec3 dpy = dFdy(pos);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dpy, N);
  vec3 r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  if (abs(det) < 1e-8) return N;
  vec3 g = (dhx * r1 + dhy * r2) / det;
  return normalize(N - g * k);
}
`;

const PLANET_VERT = /* glsl */ `
${SCENE}
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vWN;
void main(){
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PLANET_HEAD = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
${SIMPLEX}
${BUMP}
uniform vec3 uStarPos;
uniform vec3 uColP;
uniform vec3 uColS;
uniform vec3 uColA;
uniform vec3 uAtmo;
uniform float uSeed;
uniform float uStyle;
uniform float uFocus;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vWN;
`;

const PLANET_TAIL = /* glsl */ `
  float wl = lineGlobe(normalize(vObj), 36.0, 18.0, 1.15);
  vec3 wcol = uColA * wl * 1.5 + uColP * 0.015 + uAtmo * fres * 0.35;
  col = mix(col, wcol, wireMix()) + uColA * wireScan() * 2.0;
  col = applyFog(col, length(cameraPosition - vWorld));
  gl_FragColor = vec4(col, (uStyle + 0.5) / 16.0);
}
`;

const SURFACES: Record<PlanetDefinition['surface'], string> = {
  volcanic: /* glsl */ `
void main(){
  vec3 p = normalize(vObj);
  vec3 N0 = normalize(vWN);
  vec3 L = normalize(uStarPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTime;
  float crust = fbm3(p * 2.3 + uSeed);
  float r1 = 1.0 - abs(snoise(p * 3.4 + vec3(0.0, t * 0.012, uSeed)));
  float r2 = 1.0 - abs(snoise(p * 7.8 - vec3(t * 0.018, 0.0, 0.0)));
  float veins = pow(r1, 7.0) * 0.85 + pow(r2, 11.0) * 0.6;
  float flow = snoise(p * 5.0 + vec3(t * 0.07, -t * 0.05, t * 0.03)) * 0.5 + 0.5;
  float lava = smoothstep(0.22, 0.8, veins) * (0.5 + 0.5 * flow);
  float h = crust * 0.6 - lava * 0.6;
  vec3 N = bumpNormal(N0, vWorld, h, 2.2);
  float diff = max(dot(N, L), 0.0);
  vec3 rock = mix(vec3(0.03, 0.012, 0.02), vec3(0.2, 0.065, 0.08), crust * 0.5 + 0.5);
  vec3 col = rock * (0.035 + diff * 1.15);
  vec3 lavaCol = mix(uColS, uColP, flow) * (2.2 + 1.8 * flow);
  col += lavaCol * lava;
  float fres = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
  col += uAtmo * fres * (0.25 + 0.9 * smoothstep(-0.3, 0.7, dot(N0, L)));
${PLANET_TAIL}`,

  void: /* glsl */ `
void main(){
  vec3 p = normalize(vObj);
  vec3 N0 = normalize(vWN);
  vec3 L = normalize(uStarPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTime;
  float n = fbm3(p * 3.0 + uSeed);
  float cracks = pow(1.0 - abs(snoise(p * 8.5 + uSeed)), 16.0) + pow(1.0 - abs(snoise(p * 19.0 - uSeed)), 22.0) * 0.6;
  vec3 N = bumpNormal(N0, vWorld, n * 0.5 - cracks * 0.3, 1.4);
  float diff = max(dot(N, L), 0.0);
  vec3 base = uColP + uColS * (n * 0.5 + 0.5) * 0.6;
  vec3 col = base * (0.06 + diff * 0.95) + uColA * cracks * (0.12 + diff * 0.5);
  float lat = p.y;
  float aur = smoothstep(0.5, 0.72, abs(lat)) * (1.0 - smoothstep(0.78, 0.96, abs(lat)));
  float curtain = snoise(vec3(atan(p.z, p.x) * 3.0, lat * 5.0, t * 0.35)) * 0.5 + 0.5;
  col += uAtmo * aur * curtain * curtain * 1.9;
  float fres = pow(1.0 - max(dot(N0, V), 0.0), 2.4);
  col += uAtmo * fres * 1.5 * (0.18 + 0.82 * smoothstep(-0.35, 0.6, dot(N0, L)));
${PLANET_TAIL}`,

  gas: /* glsl */ `
void main(){
  vec3 p = normalize(vObj);
  vec3 N = normalize(vWN);
  vec3 L = normalize(uStarPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTime;
  float turb = fbm3(p * vec3(2.2, 7.0, 2.2) + vec3(t * 0.012, 0.0, uSeed));
  float lat = p.y;
  float b1 = sin(lat * 21.0 + turb * 2.6) * 0.5 + 0.5;
  float b2 = sin(lat * 58.0 + turb * 4.2 + 1.3) * 0.5 + 0.5;
  vec3 sc = normalize(vec3(0.62, -0.32, 0.72));
  float sd = distance(p, sc);
  float swirl = snoise(vec3(p * 9.0 + vec3(t * 0.05)));
  float storm = 1.0 - smoothstep(0.08, 0.24 + swirl * 0.03, sd);
  vec3 base = mix(uColS, uColP, b1);
  base = mix(base, uColA, b2 * 0.22 + storm * 0.65);
  float diff = max(dot(N, L), 0.0);
  float terminator = smoothstep(-0.1, 0.25, dot(N, L));
  vec3 col = base * (0.025 + diff * 1.05) * (0.6 + 0.4 * terminator);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uAtmo * fres * 0.9 * (0.15 + 0.85 * terminator);
${PLANET_TAIL}`,

  crystal: '',
};

const CRYSTAL_VERT = /* glsl */ `
${SCENE}
attribute vec3 aBary;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vWN;
varying vec3 vBary;
void main(){
  vec4 local = vec4(position, 1.0);
  vec3 nrm = normal;
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  nrm = mat3(instanceMatrix) * normal;
  #endif
  vObj = local.xyz;
  vBary = aBary;
  vec4 wp = modelMatrix * local;
  vWorld = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CRYSTAL_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform vec3 uStarPos;
uniform vec3 uColP;
uniform vec3 uColS;
uniform vec3 uColA;
uniform float uStyle;
uniform float uGlow;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vWN;
varying vec3 vBary;
void main(){
  vec3 N = flatNormal(vWorld);
  if (dot(N, vWN) < 0.0) N = -N;
  vec3 L = normalize(uStarPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 48.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  float facet = hash13(floor(N * 9.0) + 0.5);
  vec3 base = mix(uColP, uColS, facet);
  vec3 col = base * (0.05 + diff * 0.95);
  col += vec3(0.85, 0.92, 1.0) * spec * 3.0;
  col += uColA * fres * 0.65;
  col += base * uGlow * (0.4 + 0.6 * sin(uTime * 1.4 + facet * 6.28)) * 0.35;
  float edge = lineBary(vBary, 1.0);
  col += uColA * edge * 0.12;
  vec3 wcol = mix(uColA, uColP, facet) * edge * 1.6 + base * 0.015;
  col = mix(col, wcol, wireMix()) + uColA * wireScan() * 2.0;
  col = applyFog(col, length(cameraPosition - vWorld));
  gl_FragColor = vec4(col, (uStyle + 0.5) / 16.0);
}
`;

const ATMO_VERT = /* glsl */ `
${SCENE}
varying vec3 vWN;
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMO_FRAG = /* glsl */ `
${SCENE}
uniform vec3 uColor;
uniform vec3 uStarPos;
uniform float uDepth;
uniform float uIntensity;
varying vec3 vWN;
varying vec3 vWorld;
void main(){
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWorld);
  float d = -dot(N, V);
  float i = smoothstep(0.0, uDepth, d);
  i = pow(i, 1.6) * (1.0 - smoothstep(uDepth, uDepth * 1.35, d) * 0.5);
  float light = smoothstep(-0.45, 0.6, dot(N, normalize(uStarPos - vWorld)));
  vec3 col = uColor * i * (0.12 + light) * uIntensity * (1.0 - 0.7 * uWire);
  gl_FragColor = vec4(col * fogKeep(length(cameraPosition - vWorld)), 1.0);
}
`;

const RING_VERT = /* glsl */ `
${SCENE}
varying vec3 vWorld;
varying vec2 vLocal;
void main(){
  vLocal = position.xy;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform vec3 uStarPos;
uniform vec3 uPlanetPos;
uniform float uPlanetR;
uniform float uInner;
uniform float uOuter;
uniform vec3 uColP;
uniform vec3 uColS;
uniform vec3 uColA;
uniform vec3 uNormal;
varying vec3 vWorld;
varying vec2 vLocal;
void main(){
  float r = length(vLocal);
  float x = (r - uInner) / (uOuter - uInner);
  float fine = 0.5 + 0.5 * sin(x * 160.0) * sin(x * 41.0 + 1.3);
  float coarse = 0.5 + 0.5 * sin(x * 23.0 + 0.7);
  float gap = smoothstep(0.52, 0.535, x) * (1.0 - smoothstep(0.575, 0.59, x));
  float gap2 = smoothstep(0.8, 0.81, x) * (1.0 - smoothstep(0.825, 0.835, x));
  float dens = (0.25 + 0.5 * fine + 0.35 * coarse) * (1.0 - gap) * (1.0 - gap2 * 0.85);
  dens *= smoothstep(0.0, 0.04, x) * (1.0 - smoothstep(0.93, 1.0, x));
  vec3 toStar = normalize(uStarPos - vWorld);
  vec3 oc = vWorld - uPlanetPos;
  float b = dot(oc, toStar);
  float c = dot(oc, oc) - uPlanetR * uPlanetR;
  float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.08 : 1.0;
  float lit = 0.35 + 0.65 * abs(dot(normalize(uNormal), toStar));
  vec3 base = mix(uColS, uColP, coarse) + uColA * fine * 0.25;
  vec3 col = base * dens * lit * shadow * 0.9;
  float wl = lineGrid(vec2(x * 14.0, atan(vLocal.y, vLocal.x) / 6.2831853 * 72.0), 1.1);
  float wm = wireMix();
  if (dens < 0.12 && wm < 0.5) discard;
  col = mix(col, uColA * wl * 1.3 + base * 0.02, wm);
  col = applyFog(col, length(cameraPosition - vWorld));
  gl_FragColor = vec4(col, STYLE(${STYLE.DATA}));
}
`;

export interface PlanetObject {
  def: PlanetDefinition;
  root: THREE.Group;
  tilt: THREE.Group;
  body: THREE.Object3D;
  materials: THREE.ShaderMaterial[];
  position: THREE.Vector3;
  angle: number;
}

function planetUniforms(def: PlanetDefinition, starPos: THREE.Vector3) {
  return {
    ...shared(),
    uStarPos: { value: starPos },
    uColP: { value: new THREE.Color(def.palette.primary) },
    uColS: { value: new THREE.Color(def.palette.secondary) },
    uColA: { value: new THREE.Color(def.palette.accent) },
    uAtmo: { value: new THREE.Color(def.palette.atmosphere) },
    uSeed: { value: def.orbitPhase * 3.7 },
    uStyle: { value: def.glyphStyle },
    uFocus: { value: 0 },
    uGlow: { value: 0.6 },
  };
}

export function buildPlanet(def: PlanetDefinition, starPos: THREE.Vector3): PlanetObject {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = def.axialTilt;
  root.add(tilt);
  const materials: THREE.ShaderMaterial[] = [];
  let body: THREE.Object3D;

  if (def.surface === 'crystal') {
    const rng = mulberry32(1212);
    const geo = withBarycentric(new THREE.IcosahedronGeometry(def.radius, 2));
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
      const j = 1 + ((h - Math.floor(h)) - 0.5) * 0.22;
      v.multiplyScalar(j);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({ vertexShader: CRYSTAL_VERT, fragmentShader: CRYSTAL_FRAG, uniforms: planetUniforms(def, starPos) });
    materials.push(mat);
    const core = new THREE.Mesh(geo, mat);
    const spikeGeo = withBarycentric(new THREE.OctahedronGeometry(1, 0));
    const count = 70;
    const spikes = new THREE.InstancedMesh(spikeGeo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      dir.set(Math.cos(th) * s, u, Math.sin(th) * s);
      q.setFromUnitVectors(up, dir);
      const len = 1.6 + Math.pow(rng(), 2) * 5.5;
      const w = 0.35 + rng() * 0.45;
      m.compose(dir.clone().multiplyScalar(def.radius * 0.96 + len * 0.35), q, new THREE.Vector3(w, len, w));
      spikes.setMatrixAt(i, m);
    }
    spikes.instanceMatrix.needsUpdate = true;
    const g = new THREE.Group();
    g.add(core, spikes);
    body = g;
  } else {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_HEAD + SURFACES[def.surface],
      uniforms: planetUniforms(def, starPos),
    });
    materials.push(mat);
    body = new THREE.Mesh(new THREE.IcosahedronGeometry(def.radius, def.radius > 12 ? 40 : 30), mat);
  }
  tilt.add(body);

  if (def.surface !== 'crystal') {
    const atmo = additive(
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        uniforms: {
          ...shared(),
          uColor: { value: new THREE.Color(def.palette.atmosphere) },
          uStarPos: { value: starPos },
          uDepth: { value: 0.42 },
          uIntensity: { value: def.surface === 'void' ? 1.6 : def.surface === 'volcanic' ? 1.1 : 0.8 },
        },
      }),
    );
    materials.push(atmo);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(def.radius * 1.1, 16), atmo);
    shell.renderOrder = 4;
    tilt.add(shell);
  }

  if (def.rings) {
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...shared(),
        uStarPos: { value: starPos },
        uPlanetPos: { value: new THREE.Vector3() },
        uPlanetR: { value: def.radius },
        uInner: { value: def.rings.inner },
        uOuter: { value: def.rings.outer },
        uColP: { value: new THREE.Color('#D9D2F2') },
        uColS: { value: new THREE.Color('#5E5A86') },
        uColA: { value: new THREE.Color(def.palette.accent) },
        uNormal: { value: new THREE.Vector3(0, 1, 0) },
      },
    });
    materials.push(ringMat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(def.rings.inner, def.rings.outer, 256, 1), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'rings';
    tilt.add(ring);
  }

  return { def, root, tilt, body, materials, position: new THREE.Vector3(), angle: def.orbitPhase };
}

/** Orbit position for a given time. */
export function orbitPosition(def: PlanetDefinition, time: number, target: THREE.Vector3) {
  const a = def.orbitPhase + time * def.orbitSpeed;
  const r = def.orbitRadius;
  target.set(Math.cos(a) * r, Math.sin(a) * r * def.inclination, Math.sin(a) * r);
  return target;
}

// ───────────────────────────── the star ─────────────────────────────

const STAR_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${SIMPLEX}
uniform vec3 uColA;
uniform vec3 uColB;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vWN;
void main(){
  vec3 p = normalize(vObj);
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = max(dot(N, V), 0.0);
  float gran = fbm3(p * 6.0 + vec3(uTime * 0.05, 0.0, -uTime * 0.04)) * 0.5 + 0.5;
  float spots = smoothstep(0.62, 0.8, snoise(p * 2.2 + uTime * 0.01) * 0.5 + 0.5);
  float limb = 0.35 + 0.65 * pow(mu, 0.45);
  vec3 col = mix(uColB, uColA, gran) * (4.2 * limb) * (1.0 - spots * 0.55);
  float fres = 0.0;
  float wl = lineGlobe(p, 30.0, 15.0, 1.2);
  col = mix(col, uColA * wl * 2.0 + uColB * 0.05, wireMix());
  gl_FragColor = vec4(col, STYLE(0));
}
`;

export function buildStar(radius: number) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: { ...shared(), uColA: { value: new THREE.Color('#F5F3FF') }, uColB: { value: new THREE.Color('#7FEFFF') } },
  });
  return new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 24), mat);
}
