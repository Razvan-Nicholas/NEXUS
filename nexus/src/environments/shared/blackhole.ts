import * as THREE from 'three';
import { HASH, SCENE, WIRE } from '../../render/glsl/chunks';
import { getNoiseTexture } from '../../render/NoiseTexture';
import { STYLE, overPremultiplied, shared } from '../../core/uniforms';

/**
 * Schwarzschild black hole, ray-marched inside a proxy sphere. Units: r_s = 1 in object space.
 * Photon paths use the classic Binet trick: a = -1.5 h² r̂ / r⁴, integrated with adaptive steps.
 * The accretion disk is a thin emissive annulus in the object XZ plane with Keplerian swirl,
 * relativistic Doppler beaming and gravitational-wave ripples. Escaped rays sample a cube map,
 * so background stars are genuinely lensed (Einstein ring, secondary images).
 */
const BH_VERT = /* glsl */ `
${SCENE}
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BH_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform mat4 uInvModel;
uniform mat3 uObjToWorld;
uniform samplerCube uSky;
uniform float uHasSky;
uniform sampler2D tNoise;
uniform float uSteps;
uniform float uLens;
uniform float uDiskIn;
uniform float uDiskOut;
uniform vec3 uHot;
uniform vec3 uMid;
uniform vec3 uCool;
uniform vec3 uRed;
uniform vec3 uRing;
uniform float uDiskGain;
uniform float uGravity;
uniform float uFlare;
uniform float uDiskTime;
varying vec3 vWorld;

vec4 disk(vec3 p, float r, vec3 rayDir, out float wire){
  float x = (r - uDiskIn) / (uDiskOut - uDiskIn);
  float ang = atan(p.z, p.x);
  float omega = 1.6 * pow(uDiskIn / r, 1.5);
  float T = 22.0;
  float t1 = mod(uDiskTime, T);
  float t2 = mod(uDiskTime + T * 0.5, T);
  float w1 = sin(3.14159265 * t1 / T); w1 *= w1;
  float w2 = 1.0 - w1;
  vec2 uv1 = vec2((ang + omega * t1) / 6.2831853 * 3.0, r * 0.085);
  vec2 uv2 = vec2((ang + omega * t2) / 6.2831853 * 3.0 + 0.37, r * 0.085 + 0.21);
  float n1 = texture(tNoise, uv1).r * 0.55 + texture(tNoise, uv1 * vec2(4.0, 2.7) + 0.13).g * 0.45;
  float n2 = texture(tNoise, uv2).r * 0.55 + texture(tNoise, uv2 * vec2(4.0, 2.7) + 0.13).g * 0.45;
  float n = n1 * w1 + n2 * w2;
  float streak = texture(tNoise, vec2((ang + omega * t1) / 6.2831853 * 2.0, r * 0.9)).b * w1
               + texture(tNoise, vec2((ang + omega * t2) / 6.2831853 * 2.0 + 0.5, r * 0.9)).b * w2;
  float dens = pow(max(1.0 - x, 0.0), 1.25) * smoothstep(0.0, 0.05, x);
  dens *= 0.25 + 1.25 * n * n + 0.35 * streak;
  vec3 c = mix(uHot, uMid, smoothstep(0.0, 0.32, x));
  c = mix(c, uCool, smoothstep(0.32, 1.0, x));
  vec3 v = normalize(vec3(-p.z, 0.0, p.x));
  float beta = clamp(0.6 * sqrt(uDiskIn / r), 0.0, 0.8);
  float g = 1.0 / (sqrt(1.0 - beta * beta) * (1.0 - beta * dot(v, -rayDir)));
  float boost = pow(g, 2.1);
  c = mix(c, uRed, clamp((1.0 - g) * 1.4, 0.0, 0.85));
  c = mix(c, uHot, clamp((g - 1.0) * 0.6, 0.0, 0.6));
  float rip = 0.82 + 0.18 * sin(r * 1.4 - uDiskTime * 2.6);
  wire = (1.0 - smoothstep(0.0, 0.12, abs(fract(r * 0.5) - 0.5) * 2.0)) + (1.0 - smoothstep(0.0, 0.06, abs(fract(ang / 6.2831853 * 24.0) - 0.5) * 2.0)) * 0.7;
  wire *= smoothstep(0.0, 0.03, x) * (1.0 - smoothstep(0.97, 1.0, x));
  return vec4(c * boost * uDiskGain * rip, clamp(dens * 1.3, 0.0, 0.94));
}

void main(){
  vec3 ro = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  vec3 pw = (uInvModel * vec4(vWorld, 1.0)).xyz;
  vec3 rd = normalize(pw - ro);
  float R = uLens;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float h = b * b - c;
  if (c > 0.0) {
    if (h <= 0.0) discard;
    float t0 = -b - sqrt(h);
    if (t0 < 0.0) discard;
    ro += rd * t0;
  }
  vec3 pos = ro;
  vec3 vel = rd;
  vec3 L = cross(pos, vel);
  float h2 = dot(L, L);
  vec3 col = vec3(0.0);
  vec3 wcol = vec3(0.0);
  float trans = 1.0;
  float minR = 1e5;
  float captured = 0.0;
  int steps = int(uSteps);
  for (int i = 0; i < 220; i++) {
    if (i >= steps) break;
    float r = length(pos);
    minR = min(minR, r);
    if (r < 1.0) { captured = 1.0; break; }
    if (r > R * 1.001 && dot(pos, vel) > 0.0) break;
    float dt = clamp(0.075 * r, 0.03, 1.8);
    float bend = 1.0 - smoothstep(R * 0.62, R, r);
    vec3 acc = -1.5 * h2 * pos / (r * r * r * r * r) * uGravity * bend;
    vec3 prev = pos;
    vel += acc * dt;
    pos += vel * dt;
    if (prev.y * pos.y < 0.0) {
      vec3 hit = mix(prev, pos, prev.y / (prev.y - pos.y));
      float hr = length(hit.xz);
      if (hr > uDiskIn && hr < uDiskOut) {
        float w;
        vec4 d = disk(hit, hr, normalize(vel), w);
        col += trans * d.rgb * d.a;
        wcol += trans * mix(uMid, uCool, (hr - uDiskIn) / (uDiskOut - uDiskIn)) * w * 1.4;
        trans *= 1.0 - d.a;
        if (trans < 0.02) break;
      }
    }
  }
  float esc = 1.0 - captured;
  float ringW = mix(0.07, 0.16, uAscii);
  float ring = exp(-pow((minR - 1.52) / ringW, 2.0)) * esc;
  col += trans * uRing * ring * (0.5 + uFlare * 2.2 + uAscii * 0.9);
  vec3 dirW = normalize(uObjToWorld * normalize(vel));
  float lon = atan(dirW.z, dirW.x) / 6.2831853 + 0.5;
  float lat = asin(clamp(dirW.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  vec2 g = vec2(lon * 48.0, lat * 24.0);
  vec2 f = abs(fract(g - 0.5) - 0.5);
  vec2 fw = vec2(min(fwidth(g.x), fwidth(fract(lon + 0.5) * 48.0)), fwidth(g.y));
  vec2 la = smoothstep(fw * 0.4, fw * 1.6, f);
  float grid = (1.0 - min(la.x, la.y)) * esc;
  wcol += trans * grid * uMid * 0.55 + trans * uRing * ring * 0.6;
  float wm = wireMix();
  if (uHasSky > 0.5) {
    vec3 bg = texture(uSky, dirW).rgb * esc;
    vec3 shaded = col + trans * bg;
    vec3 outc = mix(shaded, wcol, wm) + uMid * wireScan() * 2.0;
    gl_FragColor = vec4(outc, STYLE(${STYLE.SINGULARITY}));
  } else {
    float alpha = max(captured, 1.0 - trans);
    vec3 outc = mix(col, wcol, wm);
    gl_FragColor = vec4(outc * fogKeep(length(cameraPosition - vWorld) * 0.5), alpha);
  }
}
`;

export interface BlackHoleOptions {
  rs: number;
  lens: number;
  diskIn: number;
  diskOut: number;
  steps: number;
  sky: THREE.Texture | null;
  gain?: number;
}

export class BlackHole {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  rs: number;

  constructor(o: BlackHoleOptions) {
    this.rs = o.rs;
    this.material = new THREE.ShaderMaterial({
      vertexShader: BH_VERT,
      fragmentShader: BH_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        ...shared(),
        uInvModel: { value: new THREE.Matrix4() },
        uObjToWorld: { value: new THREE.Matrix3() },
        uSky: { value: o.sky },
        uHasSky: { value: o.sky ? 1 : 0 },
        tNoise: { value: getNoiseTexture() },
        uSteps: { value: o.steps },
        uLens: { value: o.lens },
        uDiskIn: { value: o.diskIn },
        uDiskOut: { value: o.diskOut },
        uHot: { value: new THREE.Color('#E6FDFF').multiplyScalar(1.7) },
        uMid: { value: new THREE.Color('#00E5FF').multiplyScalar(1.4) },
        uCool: { value: new THREE.Color('#7A00E6').multiplyScalar(1.1) },
        uRed: { value: new THREE.Color('#FF00A8').multiplyScalar(0.9) },
        uRing: { value: new THREE.Color('#BFF8FF').multiplyScalar(2.2) },
        uDiskGain: { value: o.gain ?? 1 },
        uGravity: { value: 1 },
        uFlare: { value: 0 },
        uDiskTime: { value: 0 },
      },
    });
    if (!o.sky) overPremultiplied(this.material);
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(o.lens * 1.02, 4), this.material);
    this.mesh.scale.setScalar(o.rs);
    this.mesh.frustumCulled = false;
  }

  /** Must run after the mesh's world matrix is final for the frame. */
  update(diskTime: number) {
    this.mesh.updateMatrixWorld();
    const u = this.material.uniforms;
    u.uInvModel.value.copy(this.mesh.matrixWorld).invert();
    const m = new THREE.Matrix4().extractRotation(this.mesh.matrixWorld);
    u.uObjToWorld.value.setFromMatrix4(m);
    u.uDiskTime.value = diskTime;
  }
}
