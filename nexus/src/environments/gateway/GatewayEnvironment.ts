import * as THREE from 'three';
import gsap from 'gsap';
import type { Engine } from '../../core/Engine';
import type { Environment, EnvironmentConfig, SceneId, Selectable, TransitionKind } from '../../core/types';
import { G, STYLE, additive, shared } from '../../core/uniforms';
import { HASH, POINTS, SCENE, SIMPLEX, WIRE } from '../../render/glsl/chunks';
import { glowSprite, pointsGeometry, shellStars, starPointsMaterial } from '../../materials/library';
import { damp, mulberry32 } from '../../core/math';
import { store } from '../../core/store';

const R = 2.35;
const CENTER = new THREE.Vector3(0, 0.42, 0);
const ROTATE = /* glsl */ `
vec3 rotateAxis(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
`;

const SPHERE_VERT = /* glsl */ `
${SCENE}
${SIMPLEX}
uniform float uMaterialize;
uniform vec3 uHitN;
uniform float uHit;
uniform float uEnergy;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vWN;
varying float vRipple;
void main(){
  vec3 n = normalize(position);
  float breathe = snoise(n * 1.7 + vec3(0.0, uTime * 0.12, uTime * 0.05));
  float d = distance(n, uHitN);
  float ripple = sin(d * 15.0 - uTime * 5.5) * exp(-d * 3.2) * uHit;
  float sn = snoise(n * 2.6 + 7.0) * 0.5 + 0.5;
  float scatter = 1.0 - uMaterialize;
  float r = 1.0 + breathe * 0.018 + ripple * 0.055 + uEnergy * 0.045 * sin(uTime * 11.0 + n.y * 12.0);
  r += scatter * scatter * (0.5 + sn * 2.4);
  vN = n;
  vRipple = ripple;
  vec4 wp = modelMatrix * vec4(position * r, 1.0);
  vWorld = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SPHERE_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${SIMPLEX}
uniform float uMaterialize;
uniform float uEnergy;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vWN;
varying float vRipple;
void main(){
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  float dn = snoise(vN * 3.4 + 2.0) * 0.5 + 0.5;
  float th = uMaterialize * 1.15 - 0.05;
  if (dn > th) discard;
  float edge = 1.0 - smoothstep(0.0, 0.07, th - dn);
  float plasma = snoise(vN * 2.4 + vec3(uTime * 0.11, -uTime * 0.07, uTime * 0.05)) * 0.5 + 0.5;
  vec3 base = mix(uColA, uColB, smoothstep(0.15, 0.85, plasma * 0.8 + vN.y * 0.35 + 0.1));
  base = mix(base, uColC, smoothstep(0.7, 0.95, plasma) * 0.75);
  vec3 col;
  if (gl_FrontFacing) {
    vec3 L = normalize(uLight);
    float ndl = dot(N, L);
    float diff = max(ndl, 0.0);
    float wrap = max(ndl * 0.5 + 0.5, 0.0);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    float bands = 0.5 + 0.5 * sin(vN.y * 26.0 + uTime * 0.9 + plasma * 3.0);
    col = base * (0.05 + diff * 1.15 + wrap * 0.12) * (0.6 + 0.4 * bands);
    col += mix(uColB, uColA, fres) * fres * 1.45;
    col += vec3(1.0) * pow(max(dot(N, normalize(L + V)), 0.0), 42.0) * 0.9;
    col += uColB * max(vRipple, 0.0) * 1.1;
  } else {
    float a = atan(vN.z, vN.x);
    float stripes = 0.5 + 0.5 * sin(a * 24.0 + vN.y * 18.0 - uTime * 9.0);
    col = mix(uColA, uColB, vN.y * 0.5 + 0.5) * (0.2 + stripes * 1.3) * (0.35 + uEnergy * 1.8);
  }
  col *= 1.0 + uEnergy * 0.9;
  col += uColB * edge * 3.2;
  float wl = lineGlobe(vN, 32.0, 16.0, 1.2);
  vec3 wcol = mix(uColB, uColA, 0.5 - vN.y * 0.5) * wl * 1.7 + base * 0.02;
  col = mix(col, wcol, wireMix()) + uColB * wireScan() * 2.5;
  col = applyFog(col, dist);
  gl_FragColor = vec4(col, STYLE(0));
}
`;

const SHELL_VERT = /* glsl */ `
${SCENE}
${POINTS}
${ROTATE}
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
attribute vec4 aOrbit;
uniform float uMaterialize;
uniform float uEnergy;
uniform vec3 uCenter;
varying vec3 vColor;
void main(){
  vec3 dir = normalize(position);
  float shell = aOrbit.w;
  vec3 axis = normalize(vec3(sin(shell * 2.1 + 0.4), 1.0, cos(shell * 1.7)));
  dir = rotateAxis(dir, axis, uTime * aOrbit.z * (1.0 + uEnergy * 5.0) + aOrbit.y);
  float m = clamp(uMaterialize * 1.5 - aSeed * 0.5, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  float rr = mix(aOrbit.x * 5.0 + 16.0 * aSeed, aOrbit.x, m);
  rr = mix(rr, aOrbit.x * 0.55, uEnergy * 0.7);
  vec3 wp = uCenter + dir * rr;
  vec3 toP = wp - uMouseOrigin;
  vec3 closest = uMouseOrigin + uMouseDir * dot(toP, uMouseDir);
  vec3 away = wp - closest;
  float dd = length(away);
  wp += (away / max(dd, 1e-3)) * uMouseActive * 1.1 * exp(-dd * dd * 0.9);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float fade;
  gl_PointSize = pointSize(aSize, -mv.z, 11.0, fade);
  float tw = 0.75 + 0.25 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 40.0);
  vColor = aColor * fade * tw * m * (1.0 + uEnergy * 1.5) * fogKeep(-mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_VERT = /* glsl */ `
${SCENE}
${POINTS}
${ROTATE}
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
uniform float uMaterialize;
uniform float uEnergy;
uniform vec3 uCenter;
varying vec3 vColor;
void main(){
  float speed = 0.05 + aSeed * 0.07;
  float t = fract(uTime * speed * (1.0 + uEnergy * 5.0) + aSeed * 7.13);
  float rr = mix(30.0, ${R.toFixed(2)} * 1.03, pow(t, 0.55));
  vec3 dir = rotateAxis(normalize(position), vec3(0.0, 1.0, 0.0), t * 3.2 + aSeed * 4.0);
  vec3 wp = uCenter + dir * rr;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float fade;
  gl_PointSize = pointSize(aSize, -mv.z, 11.0, fade);
  float life = smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.88, 1.0, t));
  vColor = aColor * fade * life * (0.35 + t * 1.4) * uMaterialize * fogKeep(-mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

const RING_VERT = /* glsl */ `
${SCENE}
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
${SCENE}
${WIRE}
${HASH}
uniform vec3 uColor;
uniform float uSegments;
uniform float uSpeed;
uniform float uMaterialize;
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  float u = fract(vUv.x + uTime * uSpeed);
  float seg = floor(u * uSegments);
  float on = step(0.42, hash11(seg + floor(uTime * 1.5 + hash11(seg * 1.7) * 4.0)));
  float gap = smoothstep(0.0, 0.08, fract(u * uSegments)) * (1.0 - smoothstep(0.82, 0.92, fract(u * uSegments)));
  float a = on * gap * smoothstep(0.6, 1.0, uMaterialize);
  if (a < 0.05) discard;
  vec3 col = uColor * (1.6 + on * 0.6) * a;
  col = mix(col, uColor * 1.2, wireMix());
  gl_FragColor = vec4(applyFog(col, length(cameraPosition - vWorld)), STYLE(${STYLE.DATA}));
}
`;

export default class GatewayEnvironment implements Environment {
  readonly id = 'gateway' as const;
  readonly config: EnvironmentConfig = {
    id: 'gateway',
    zone: 'gateway',
    audio: 'gateway',
    background: '#050509',
    fogColor: '#050509',
    fogDensity: 0.012,
    camera: { fov: 40, near: 0.05, far: 600 },
    movement: { speed: 0, boost: 1 },
    ascii: { exposure: 1.3, gamma: 0.82, edge: 1, voidDust: 0.6, lens: 0, glyphGain: 1.1 },
    bloom: { strength: 0.95, threshold: 0.5 },
    exposure: 1,
    hint: '',
  };
  readonly scene = new THREE.Scene();
  state = { materialize: 0, energy: 0 };
  private sphere!: THREE.Mesh;
  private sphereMat!: THREE.ShaderMaterial;
  private shellMat!: THREE.ShaderMaterial;
  private moteMat!: THREE.ShaderMaterial;
  private ringMats: THREE.ShaderMaterial[] = [];
  private rings: THREE.Mesh[] = [];
  private halo!: THREE.Mesh;
  private intro: gsap.core.Timeline | null = null;
  private tilt = new THREE.Vector2();
  private spin = 0;
  private hit = 0;
  private hitN = new THREE.Vector3(0, 0, 1);

  async init() {
    const rng = mulberry32(7);
    const purple = new THREE.Color('#A000FF');
    const cyan = new THREE.Color('#00E5FF');
    const magenta = new THREE.Color('#FF00A8');
    const white = new THREE.Color('#F5F3FF');

    this.sphereMat = new THREE.ShaderMaterial({
      vertexShader: SPHERE_VERT,
      fragmentShader: SPHERE_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...shared(),
        uMaterialize: { value: 0 },
        uHitN: { value: new THREE.Vector3(0, 0, 1) },
        uHit: { value: 0 },
        uEnergy: { value: 0 },
        uColA: { value: purple.clone().multiplyScalar(1.1) },
        uColB: { value: cyan.clone() },
        uColC: { value: magenta.clone() },
        uLight: { value: new THREE.Vector3(-0.55, 0.75, 0.65) },
      },
    });
    this.sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 40), this.sphereMat);
    this.sphere.position.copy(CENTER);
    this.scene.add(this.sphere);

    // Orbital particle shells
    const shellCount = 5200;
    const pos = new Float32Array(shellCount * 3);
    const col = new Float32Array(shellCount * 3);
    const size = new Float32Array(shellCount);
    const seed = new Float32Array(shellCount);
    const orbit = new Float32Array(shellCount * 4);
    const pal = [purple, cyan, magenta, white];
    const radii = [3.0, 3.7, 4.6, 6.2];
    for (let i = 0; i < shellCount; i++) {
      const shell = Math.floor(rng() * radii.length);
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const band = shell === 1 ? 0.35 : 1;
      pos.set([Math.cos(th) * s, u * band, Math.sin(th) * s], i * 3);
      const c = pal[shell === 3 ? 3 : Math.floor(rng() * 3)];
      const b = 0.35 + rng() * 0.9;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
      size[i] = 1.1 + Math.pow(rng(), 3) * 2.6;
      seed[i] = rng();
      orbit.set([radii[shell] * (0.94 + rng() * 0.14), rng() * 6.28, (0.05 + rng() * 0.08) * (shell % 2 ? -1 : 1), shell], i * 4);
    }
    const shellGeo = pointsGeometry({ positions: pos, colors: col, sizes: size, seeds: seed });
    shellGeo.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
    this.shellMat = additive(
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: { ...shared(), uMaterialize: { value: 0 }, uEnergy: { value: 0 }, uCenter: { value: CENTER.clone() } },
      }),
    );
    const shells = new THREE.Points(shellGeo, this.shellMat);
    shells.frustumCulled = false;
    this.scene.add(shells);

    // Inflowing data motes
    const motes = 1800;
    const mp = new Float32Array(motes * 3);
    const mc = new Float32Array(motes * 3);
    const ms = new Float32Array(motes);
    for (let i = 0; i < motes; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      mp.set([Math.cos(th) * s, u, Math.sin(th) * s], i * 3);
      const c = rng() < 0.6 ? cyan : rng() < 0.5 ? purple : white;
      mc.set([c.r * 0.9, c.g * 0.9, c.b * 0.9], i * 3);
      ms[i] = 1 + rng() * 1.8;
    }
    this.moteMat = additive(
      new THREE.ShaderMaterial({
        vertexShader: MOTE_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: { ...shared(), uMaterialize: { value: 0 }, uEnergy: { value: 0 }, uCenter: { value: CENTER.clone() } },
      }),
    );
    const moteObj = new THREE.Points(pointsGeometry({ positions: mp, colors: mc, sizes: ms }), this.moteMat);
    moteObj.frustumCulled = false;
    this.scene.add(moteObj);

    // Data rings
    const ringDefs = [
      { r: 3.25, tube: 0.026, color: cyan, seg: 150, speed: 0.012, rot: new THREE.Euler(1.2, 0.2, 0.35) },
      { r: 4.05, tube: 0.022, color: magenta, seg: 190, speed: -0.008, rot: new THREE.Euler(1.85, -0.4, -0.3) },
    ];
    for (const d of ringDefs) {
      const m = new THREE.ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { ...shared(), uColor: { value: d.color.clone() }, uSegments: { value: d.seg }, uSpeed: { value: d.speed }, uMaterialize: { value: 0 } },
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, d.tube, 6, 320), m);
      ring.position.copy(CENTER);
      ring.rotation.copy(d.rot);
      this.scene.add(ring);
      this.rings.push(ring);
      this.ringMats.push(m);
    }

    // Halo and distant stars
    this.halo = glowSprite({ color: '#5a10b0', core: '#000000', scale: 15, intensity: 0.32, power: 2.6, fog: 0 });
    this.halo.position.copy(CENTER).add(new THREE.Vector3(0, 0, -1.5));
    this.halo.renderOrder = -1;
    this.scene.add(this.halo);

    const sky = shellStars(rng, 1400, 160, [white, cyan, purple], [0.9, 2.2], 0.45);
    const stars = new THREE.Points(pointsGeometry(sky), starPointsMaterial({ twinkle: 0.45, fog: 0 }));
    stars.frustumCulled = false;
    this.scene.add(stars);
  }

  enter(engine: Engine, _from: SceneId | null, kind: TransitionKind) {
    const rig = engine.rig;
    rig.mode = 'anchored';
    // Pull back on narrow (portrait) screens so the sphere keeps its margins.
    const aspect = engine.camera.aspect || 16 / 9;
    const fit = R / (0.78 * Math.tan(THREE.MathUtils.degToRad(this.config.camera.fov / 2)) * aspect);
    rig.anchor.base.set(0, aspect < 1 ? -0.6 : 0.15, Math.max(11.6, fit));
    rig.anchor.target.set(0, 0.05, 0);
    rig.anchor.parallax.set(0.55, 0.32);
    rig.anchor.px = rig.anchor.py = 0;
    rig.fov = rig.zoomFov = this.config.camera.fov;
    rig.position.copy(rig.anchor.base);
    this.state.materialize = 0;
    this.state.energy = 0;
    if (kind !== 'boot') store.set({ gatewayStage: 0 });
  }

  /** Called once the boot overlay has gone: the sphere assembles, then the title appears. */
  beginIntro(engine: Engine, fast = false) {
    this.intro?.kill();
    const fx = engine.pipeline.fx;
    const k = fast ? 0.55 : 1;
    store.set({ gatewayStage: 0 });
    this.intro = gsap
      .timeline()
      .fromTo(fx, { scramble: 0.55 }, { scramble: 0, duration: 4.6 * k, ease: 'power2.out' }, 0)
      .to(this.state, { materialize: 1, duration: 5.4 * k, ease: 'power2.inOut' }, 0.2)
      .call(() => store.set({ gatewayStage: 1 }), [], 1.9 * k)
      .call(() => store.set({ gatewayStage: 2 }), [], 3.1 * k)
      .call(() => store.set({ gatewayStage: 3 }), [], 4.3 * k);
  }

  entryCinematic(engine: Engine): Promise<void> {
    const fx = engine.pipeline.fx;
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(fx, { flash: 0, duration: 0.7, ease: 'power2.out' }, 0)
        .to(fx, { warp: 0, chroma: 0, glitch: 0, fade: 0, duration: 1.4, ease: 'power3.out' }, 0)
        .call(() => this.beginIntro(engine, true), [], 0.2);
    });
  }

  /** ENTER THE NEXUS: dolly into the sphere, through its surface, into a white-out. */
  exitCinematic(engine: Engine): Promise<void> {
    this.intro?.kill();
    this.state.materialize = 1;
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    rig.beginCinematic();
    rig.lookTarget.copy(CENTER);
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(this.state, { energy: 1, duration: 1.5, ease: 'power2.in' }, 0)
        .to(rig.position, { x: CENTER.x, y: CENTER.y, z: CENTER.z + R * 1.65, duration: 1.7, ease: 'power3.inOut' }, 0)
        .to(rig, { fov: 64, duration: 1.7, ease: 'power2.in' }, 0)
        .to(fx, { chroma: 0.008, scramble: 0.3, duration: 1.5, ease: 'power2.in' }, 0)
        .to(rig.position, { z: CENTER.z - R * 0.4, duration: 0.85, ease: 'power2.in' }, 1.7)
        .to(rig.lookTarget, { z: CENTER.z - 20, duration: 0.85, ease: 'power2.in' }, 1.7)
        .to(rig, { roll: 0.6, fov: 96, duration: 0.85, ease: 'power2.in' }, 1.7)
        .to(fx, { warp: 1, scramble: 0.7, duration: 0.9, ease: 'power2.in' }, 1.6)
        .to(fx, { flash: 1, duration: 0.35, ease: 'power2.in' }, 2.2);
    });
  }

  update(dt: number, _t: number, engine: Engine) {
    const input = engine.input;
    const p = input.pointer;
    const c = input.centered(engine.pipeline.cssW, engine.pipeline.cssH);
    this.tilt.x = damp(this.tilt.x, c.y * 0.35, 2.5, dt);
    this.tilt.y = damp(this.tilt.y, c.x * 0.45, 2.5, dt);
    this.spin += dt * (0.09 + this.state.energy * 2.4);
    this.sphere.rotation.set(this.tilt.x, this.spin + this.tilt.y, 0);

    // Cursor ray against the sphere drives the surface ripple.
    let target = 0;
    if (p.inside && G.uMouseActive.value > 0.05) {
      const o = G.uMouseOrigin.value;
      const d = G.uMouseDir.value;
      const oc = o.clone().sub(CENTER);
      const b = oc.dot(d);
      const c = oc.lengthSq() - R * R;
      const h = b * b - c;
      if (h > 0) {
        const tHit = -b - Math.sqrt(h);
        if (tHit > 0) {
          const hitW = o.clone().addScaledVector(d, tHit).sub(CENTER).normalize();
          const inv = this.sphere.quaternion.clone().invert();
          this.hitN.copy(hitW.applyQuaternion(inv));
          target = 0.6 + Math.min(1, input.pointerSpeed / 1500) * 0.8;
        }
      }
    }
    this.hit = damp(this.hit, target, target > this.hit ? 6 : 1.5, dt);

    const m = this.state.materialize;
    const e = this.state.energy;
    const su = this.sphereMat.uniforms;
    su.uMaterialize.value = m;
    su.uEnergy.value = e;
    su.uHit.value = this.hit;
    su.uHitN.value.copy(this.hitN);
    this.shellMat.uniforms.uMaterialize.value = m;
    this.shellMat.uniforms.uEnergy.value = e;
    this.moteMat.uniforms.uMaterialize.value = m;
    this.moteMat.uniforms.uEnergy.value = e;
    this.ringMats.forEach((r) => (r.uniforms.uMaterialize.value = m));
    this.rings[0].rotation.z += dt * 0.05 * (1 + e * 8);
    this.rings[1].rotation.z -= dt * 0.035 * (1 + e * 8);
    (this.halo.material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.3 * m + e * 0.6;
  }

  getSelectables(): Selectable[] {
    return [];
  }

  dispose() {
    this.intro?.kill();
  }
}
