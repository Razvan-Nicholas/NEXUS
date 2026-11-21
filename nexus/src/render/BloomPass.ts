import * as THREE from 'three';
import { FullscreenQuad, passMaterial } from './FullscreenQuad';

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uPrefilter;
varying vec2 vUv;
vec3 s(vec2 o){ return texture(tSrc, vUv + o * uTexel).rgb; }
void main(){
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) {
    float br = max(col.r, max(col.g, col.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = (rq * rq) / (4.0 * uKnee + 1e-4);
    col *= max(rq, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(24.0));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uScatter;
varying vec2 vUv;
vec3 s(vec2 o){ return texture(tSrc, vUv + o * uTexel).rgb; }
void main(){
  vec3 col = s(vec2(-1.0, 1.0)) + s(vec2(0.0, 1.0)) * 2.0 + s(vec2(1.0, 1.0))
           + s(vec2(-1.0, 0.0)) * 2.0 + s(vec2(0.0)) * 4.0 + s(vec2(1.0, 0.0)) * 2.0
           + s(vec2(-1.0, -1.0)) + s(vec2(0.0, -1.0)) * 2.0 + s(vec2(1.0, -1.0));
  gl_FragColor = vec4(col / 16.0 * uScatter, 1.0);
}
`;

/** Progressive down/up-sample bloom (13-tap down, tent up) on a half-resolution mip chain. */
export class BloomPass {
  private mips: THREE.WebGLRenderTarget[] = [];
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  levels = 5;
  threshold = 0.6;
  knee = 0.35;
  scatter = 0.85;
  private w = 1;
  private h = 1;

  constructor() {
    this.down = passMaterial(DOWN, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 0.6 },
      uKnee: { value: 0.35 },
      uPrefilter: { value: 0 },
    });
    this.up = passMaterial(UP, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uScatter: { value: 0.85 },
    }, { blending: THREE.AdditiveBlending, transparent: true });
  }

  setSize(w: number, h: number, levels: number) {
    if (w === this.w && h === this.h && levels === this.levels && this.mips.length) return;
    this.w = w;
    this.h = h;
    this.levels = levels;
    this.mips.forEach((m) => m.dispose());
    this.mips = [];
    let mw = Math.max(1, Math.floor(w / 2));
    let mh = Math.max(1, Math.floor(h / 2));
    for (let i = 0; i < levels; i++) {
      this.mips.push(
        new THREE.WebGLRenderTarget(mw, mh, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          generateMipmaps: false,
        }),
      );
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
    }
  }

  render(renderer: THREE.WebGLRenderer, quad: FullscreenQuad, input: THREE.Texture, srcW: number, srcH: number) {
    const d = this.down.uniforms;
    d.uThreshold.value = this.threshold;
    d.uKnee.value = this.knee;
    let src = input;
    let sw = srcW;
    let sh = srcH;
    for (let i = 0; i < this.mips.length; i++) {
      d.tSrc.value = src;
      d.uTexel.value.set(1 / sw, 1 / sh);
      d.uPrefilter.value = i === 0 ? 1 : 0;
      quad.render(renderer, this.down, this.mips[i]);
      src = this.mips[i].texture;
      sw = this.mips[i].width;
      sh = this.mips[i].height;
    }
    const u = this.up.uniforms;
    u.uScatter.value = this.scatter;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const s = this.mips[i];
      u.tSrc.value = s.texture;
      u.uTexel.value.set(1 / s.width, 1 / s.height);
      quad.render(renderer, this.up, this.mips[i - 1]);
    }
    return this.mips[0].texture;
  }

  dispose() {
    this.mips.forEach((m) => m.dispose());
    this.down.dispose();
    this.up.dispose();
  }
}
