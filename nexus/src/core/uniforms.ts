import * as THREE from 'three';

/**
 * Uniforms shared by every scene material. Materials reference these objects directly,
 * so a single assignment per frame updates the whole universe.
 */
export const G = {
  uTime: { value: 0 },
  /** 0 shaded → 1 wireframe. Animated by the mode switch. */
  uWire: { value: 0 },
  /** How much of the frame is currently glyphs (0..1), so materials can stay legible as ASCII. */
  uAscii: { value: 1 },
  uFogColor: { value: new THREE.Color('#050509') },
  uFogDensity: { value: 0.002 },
  /** Size of the scene render target in pixels. */
  uRTSize: { value: new THREE.Vector2(1, 1) },
  /** Scene render-target pixels per CSS pixel (DPR × dynamic scale). */
  uRTScale: { value: 1 },
  /** Minimum point size in render-target pixels; smaller points fade instead of shrinking. */
  uPointMin: { value: 1.25 },
  /** World-space mouse ray, for particles that react to the cursor. */
  uMouseOrigin: { value: new THREE.Vector3() },
  uMouseDir: { value: new THREE.Vector3(0, 0, -1) },
  uMouseActive: { value: 0 },
  uCamVel: { value: new THREE.Vector3() },
};

export type SharedUniforms = typeof G;

export function shared(): Record<string, THREE.IUniform> {
  return { ...G } as unknown as Record<string, THREE.IUniform>;
}

/** Additive blending that leaves the destination alpha (glyph style id) untouched. */
export function additive<M extends THREE.Material>(mat: M): M {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

/** Additive colour; alpha = max(src, dst) so additive particles can claim a glyph style. */
export function additiveStyled<M extends THREE.Material>(mat: M): M {
  additive(mat);
  mat.blendEquationAlpha = THREE.MaxEquation;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

/** Premultiplied "over" blending that also preserves destination alpha. */
export function overPremultiplied<M extends THREE.Material>(mat: M): M {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

/** Glyph style ids written into the scene alpha channel; each maps to an atlas row. */
export const STYLE = {
  STANDARD: 0,
  VOLCANIC: 1,
  VOID: 2,
  CRYSTAL: 3,
  GAS: 4,
  DATA: 5,
  SINGULARITY: 6,
  GLITCH: 7,
  STAR: 8,
} as const;

export const color = (hex: string) => new THREE.Color(hex);
