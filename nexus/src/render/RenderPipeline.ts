import * as THREE from 'three';
import { BloomPass } from './BloomPass';
import { FullscreenQuad, passMaterial } from './FullscreenQuad';
import { ATLAS_COLS, GlyphAtlas, NUM_ROWS } from './GlyphAtlas';
import { CELL_FRAG, COMPOSITE_FRAG, FINAL_FRAG } from './shaders';
import { G } from '../core/uniforms';
import type { EnvironmentConfig, LensType, QualitySettings } from '../core/types';

export interface PipelineFx {
  warp: number;
  warpX: number;
  warpY: number;
  flash: number;
  fade: number;
  scramble: number;
  chroma: number;
  glitch: number;
  invert: number;
}

/**
 * scene → [RT: colour + glyph style in alpha + depth]
 *       → cell pass (one fragment per character)
 *       → glyph composite at full resolution (+ mode blend, cursor lens)
 *       → bloom mip chain → final grade → canvas
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly atlas: GlyphAtlas;
  private quad = new FullscreenQuad();
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private cellRT: THREE.WebGLRenderTarget | null = null;
  private compositeRT: THREE.WebGLRenderTarget | null = null;
  private bloom = new BloomPass();
  private cellMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;

  quality!: QualitySettings;
  /** 0 → shaded/wire scene, 1 → glyphs. Animated by the mode switch. */
  asciiMix = 1;
  /** Keep the scene target at full resolution (during mode transitions). */
  fullResHold = false;
  adaptiveScale = 1;
  background = new THREE.Color('#050509');
  bloomStrength = 0.9;
  exposure = 1;
  ascii = { exposure: 1.2, gamma: 0.85, edge: 1, voidDust: 0.3, lens: 0 as LensType, glyphGain: 1, floor: 0.02 };
  fx: PipelineFx = { warp: 0, warpX: 0.5, warpY: 0.5, flash: 0, fade: 0, scramble: 0, chroma: 0, glitch: 0, invert: 0 };
  flashColor = new THREE.Color('#F5F3FF');
  mouse = { x: -1e4, y: -1e4, energy: 0, lens: 0 };

  cssW = 1;
  cssH = 1;
  dpr = 1;
  canvasW = 1;
  canvasH = 1;
  cellCss = 9;
  cellW = 9;
  cellH = 15;
  cols = 1;
  rows = 1;
  sceneW = 1;
  sceneH = 1;

  constructor(renderer: THREE.WebGLRenderer, atlas: GlyphAtlas) {
    this.renderer = renderer;
    this.atlas = atlas;
    this.cellMat = passMaterial(CELL_FRAG, {
      tScene: { value: null },
      tDepth: { value: null },
      tLUT: { value: atlas.lut },
      uCanvasPx: { value: new THREE.Vector2() },
      uCellPx: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2() },
      uTime: G.uTime,
      uExposure: { value: 1.2 },
      uGamma: { value: 0.85 },
      uEdge: { value: 1 },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uAscii: { value: 1 },
      uScramble: { value: 0 },
      uVoidDust: { value: 0 },
      uGlyphGain: { value: 1 },
      uFloor: { value: 0.02 },
      uMouse: { value: new THREE.Vector2(-1e4, -1e4) },
      uMouseEnergy: { value: 0 },
      uLensRadius: { value: 120 },
      uTaps: { value: 3 },
      uCounts: { value: atlas.counts.slice(0, NUM_ROWS) },
    });
    this.compositeMat = passMaterial(COMPOSITE_FRAG, {
      tScene: { value: null },
      tCells: { value: null },
      tAtlas: { value: null },
      uCanvasPx: { value: new THREE.Vector2() },
      uCellPx: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2() },
      uAtlasTiles: { value: new THREE.Vector2(ATLAS_COLS, NUM_ROWS) },
      uAscii: { value: 1 },
      uMouse: { value: new THREE.Vector2(-1e4, -1e4) },
      uLensRadius: { value: 120 },
      uLensStrength: { value: 0 },
      uLensType: { value: 0 },
      uBackground: { value: this.background },
      uTime: G.uTime,
    });
    this.finalMat = passMaterial(FINAL_FRAG, {
      tComposite: { value: null },
      tBloom: { value: null },
      uResolution: { value: new THREE.Vector2() },
      uTime: G.uTime,
      uBloom: { value: 0.9 },
      uChroma: { value: 0 },
      uGrain: { value: 0.035 },
      uVignette: { value: 0.55 },
      uWarp: { value: 0 },
      uWarpCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uFlash: { value: 0 },
      uFlashColor: { value: this.flashColor },
      uFade: { value: 0 },
      uInvert: { value: 0 },
      uGlitch: { value: 0 },
      uExposure: { value: 1 },
      uPaper: { value: new THREE.Color('#F5F3FF') },
      uInk: { value: new THREE.Color('#0b0a14') },
    });
  }

  setQuality(q: QualitySettings) {
    const msaaChanged = !this.quality || this.quality.msaa !== q.msaa;
    this.quality = q;
    this.cellMat.uniforms.uTaps.value = q.taps;
    if (msaaChanged) this.disposeSceneTarget();
    this.resize(this.cssW, this.cssH, Math.min(window.devicePixelRatio || 1, q.maxDpr));
  }

  applyEnvironment(cfg: EnvironmentConfig) {
    this.background.set(cfg.background);
    this.ascii = { floor: 0.02, ...cfg.ascii };
    this.bloomStrength = cfg.bloom.strength;
    this.bloom.threshold = cfg.bloom.threshold;
    this.exposure = cfg.exposure;
  }

  setCellSize(css: number) {
    this.cellCss = css;
    this.resize(this.cssW, this.cssH, this.dpr);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = dpr;
    this.canvasW = Math.max(1, Math.round(this.cssW * dpr));
    this.canvasH = Math.max(1, Math.round(this.cssH * dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.canvasW, this.canvasH, false);

    this.cellW = Math.max(4, Math.round(this.cellCss * dpr));
    this.cellH = Math.max(7, Math.round(this.cellW * 1.62));
    this.cols = Math.ceil(this.canvasW / this.cellW);
    this.rows = Math.ceil(this.canvasH / this.cellH);
    const atlasTex = this.atlas.build(this.cellW, this.cellH);

    if (!this.cellRT || this.cellRT.width !== this.cols || this.cellRT.height !== this.rows) {
      this.cellRT?.dispose();
      this.cellRT = new THREE.WebGLRenderTarget(this.cols, this.rows, {
        type: THREE.HalfFloatType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
    }
    if (!this.compositeRT || this.compositeRT.width !== this.canvasW || this.compositeRT.height !== this.canvasH) {
      this.compositeRT?.dispose();
      this.compositeRT = new THREE.WebGLRenderTarget(this.canvasW, this.canvasH, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
    }
    this.bloom.setSize(this.canvasW, this.canvasH, this.quality?.bloomLevels ?? 5);

    const cu = this.cellMat.uniforms;
    cu.uCanvasPx.value.set(this.canvasW, this.canvasH);
    cu.uCellPx.value.set(this.cellW, this.cellH);
    cu.uGrid.value.set(this.cols, this.rows);
    cu.uLensRadius.value = 150 * dpr;
    cu.uCounts.value = this.atlas.counts.slice(0, NUM_ROWS);
    const co = this.compositeMat.uniforms;
    co.uCanvasPx.value.set(this.canvasW, this.canvasH);
    co.uCellPx.value.set(this.cellW, this.cellH);
    co.uGrid.value.set(this.cols, this.rows);
    co.tAtlas.value = atlasTex;
    co.tCells.value = this.cellRT.texture;
    co.uLensRadius.value = 150 * dpr;
    this.finalMat.uniforms.uResolution.value.set(this.canvasW, this.canvasH);
    this.finalMat.uniforms.tComposite.value = this.compositeRT.texture;
    this.ensureSceneTarget();
  }

  private disposeSceneTarget() {
    if (this.sceneRT) {
      this.sceneRT.depthTexture?.dispose();
      this.sceneRT.dispose();
      this.sceneRT = null;
    }
  }

  /** The scene target shrinks while glyphs are steady: cells only need a few samples each. */
  private ensureSceneTarget() {
    const q = this.quality;
    const steadyAscii = this.asciiMix >= 0.999 && !this.fullResHold;
    const dprCap = Math.min(1, q.maxSceneDpr / this.dpr);
    const scale = this.adaptiveScale * (steadyAscii ? Math.min(q.asciiSceneScale, dprCap) : dprCap);
    const w = Math.max(16, Math.round(this.canvasW * scale));
    const h = Math.max(16, Math.round(this.canvasH * scale));
    const msaa = steadyAscii ? 0 : q.msaa;
    if (this.sceneRT && this.sceneRT.width === w && this.sceneRT.height === h && this.sceneRT.samples === msaa) return;
    this.disposeSceneTarget();
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      depthTexture: depth,
      samples: msaa,
      generateMipmaps: false,
    });
    this.sceneW = w;
    this.sceneH = h;
    G.uRTSize.value.set(w, h);
    G.uRTScale.value = (w / this.canvasW) * this.dpr;
    this.cellMat.uniforms.tScene.value = this.sceneRT.texture;
    this.cellMat.uniforms.tDepth.value = depth;
    this.compositeMat.uniforms.tScene.value = this.sceneRT.texture;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    this.ensureSceneTarget();
    const sceneRT = this.sceneRT!;

    r.setRenderTarget(sceneRT);
    r.setClearColor(this.background, 0);
    r.clear(true, true, false);
    r.render(scene, camera);

    const a = this.ascii;
    const cu = this.cellMat.uniforms;
    const lensActive = this.mouse.lens;
    if (this.asciiMix > 0.001) {
      cu.uExposure.value = a.exposure;
      cu.uGamma.value = a.gamma;
      cu.uEdge.value = a.edge;
      cu.uVoidDust.value = a.voidDust;
      cu.uGlyphGain.value = a.glyphGain;
      cu.uFloor.value = a.floor ?? 0.02;
      cu.uNear.value = camera.near;
      cu.uFar.value = camera.far;
      cu.uAscii.value = this.asciiMix;
      cu.uScramble.value = this.fx.scramble;
      cu.uMouse.value.set(this.mouse.x, this.mouse.y);
      cu.uMouseEnergy.value = this.mouse.energy * lensActive;
      this.quad.render(r, this.cellMat, this.cellRT);
    }

    const co = this.compositeMat.uniforms;
    co.uAscii.value = this.asciiMix;
    co.uMouse.value.set(this.mouse.x, this.mouse.y);
    co.uLensType.value = a.lens;
    const lensBase = a.lens === 1 ? 1 : a.lens === 2 ? 0.6 * this.mouse.energy : 0.25 + 0.75 * this.mouse.energy;
    co.uLensStrength.value = lensBase * lensActive;
    this.quad.render(r, this.compositeMat, this.compositeRT);

    const bloomTex = this.bloom.render(r, this.quad, this.compositeRT!.texture, this.canvasW, this.canvasH);

    const f = this.finalMat.uniforms;
    f.tBloom.value = bloomTex;
    f.uBloom.value = this.bloomStrength;
    f.uExposure.value = this.exposure;
    f.uChroma.value = (this.quality.chroma ? 0.0022 : 0) + this.fx.chroma;
    f.uGrain.value = this.quality.grain ? 0.03 : 0;
    f.uWarp.value = this.fx.warp;
    f.uWarpCenter.value.set(this.fx.warpX, this.fx.warpY);
    f.uFlash.value = this.fx.flash;
    f.uFade.value = this.fx.fade;
    f.uInvert.value = this.fx.invert;
    f.uGlitch.value = this.fx.glitch;
    this.quad.render(r, this.finalMat, null);
  }

  /** Converts a CSS-pixel position (top-left origin) into canvas pixels (bottom-left origin). */
  setMouse(cssX: number, cssY: number) {
    this.mouse.x = cssX * this.dpr;
    this.mouse.y = (this.cssH - cssY) * this.dpr;
  }

  dispose() {
    this.disposeSceneTarget();
    this.cellRT?.dispose();
    this.compositeRT?.dispose();
    this.bloom.dispose();
    this.quad.dispose();
    this.cellMat.dispose();
    this.compositeMat.dispose();
    this.finalMat.dispose();
  }
}
