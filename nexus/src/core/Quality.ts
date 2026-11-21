import type * as THREE from 'three';
import type { QualitySettings, QualityTier } from './types';

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: {
    label: 'High',
    maxDpr: 2,
    maxSceneDpr: 1.5,
    minSceneScale: 0.6,
    asciiSceneScale: 0.5,
    particleScale: 1,
    bloomLevels: 5,
    taps: 3,
    bhSteps: 150,
    chroma: true,
    grain: true,
    msaa: 4,
    defaultCell: 9,
  },
  balanced: {
    label: 'Balanced',
    maxDpr: 1.5,
    maxSceneDpr: 1.25,
    minSceneScale: 0.55,
    asciiSceneScale: 0.45,
    particleScale: 0.6,
    bloomLevels: 4,
    taps: 2,
    bhSteps: 96,
    chroma: true,
    grain: true,
    msaa: 0,
    defaultCell: 10,
  },
  performance: {
    label: 'Performance',
    maxDpr: 1,
    maxSceneDpr: 1,
    minSceneScale: 0.5,
    asciiSceneScale: 0.42,
    particleScale: 0.35,
    bloomLevels: 3,
    taps: 2,
    bhSteps: 60,
    chroma: false,
    grain: false,
    msaa: 0,
    defaultCell: 11,
  },
};

export interface DeviceProfile {
  tier: QualityTier;
  gpu: string;
  software: boolean;
  mobile: boolean;
}

export function profileDevice(renderer: THREE.WebGLRenderer): DeviceProfile {
  const gl = renderer.getContext();
  let gpu = 'WebGL2';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    else gpu = String(gl.getParameter(gl.RENDERER));
  } catch {
    /* ignore */
  }
  const software = /swiftshader|llvmpipe|lavapipe|software|basic render/i.test(gpu);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const mobile = mobileUA || (coarse && Math.min(window.innerWidth, window.innerHeight) < 820);
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  let tier: QualityTier = 'high';
  if (software || mobile) tier = 'performance';
  else if (cores <= 4 || memory <= 4) tier = 'balanced';
  return { tier, gpu: gpu.replace(/\s+/g, ' ').slice(0, 64), software, mobile };
}

/**
 * Adaptive resolution: watches frame time and moves the scene render scale in small steps,
 * with hysteresis so it never oscillates. Can also step the tier down once if it bottoms out.
 */
export class AdaptiveScaler {
  scale = 1;
  enabled = true;
  private ema = 1 / 60;
  private slow = 0;
  private fast = 0;
  private floorTime = 0;
  private cooldown = 2;

  reset(scale = 1) {
    this.scale = scale;
    this.slow = this.fast = this.floorTime = 0;
    this.cooldown = 2;
  }

  /** Returns 'scale' when the scale changed, 'tier-down' when the floor has been hit for long. */
  sample(dt: number, minScale: number): 'none' | 'scale' | 'tier-down' {
    if (!this.enabled || dt <= 0 || dt > 0.25) return 'none';
    this.ema += (dt - this.ema) * 0.08;
    this.cooldown -= dt;
    const fps = 1 / this.ema;
    if (fps < 50) {
      this.slow += dt;
      this.fast = 0;
    } else if (fps > 58) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - dt);
      this.fast = Math.max(0, this.fast - dt);
    }
    if (this.cooldown > 0) return 'none';
    if (this.slow > 1.2 && this.scale > minScale + 1e-3) {
      this.scale = Math.max(minScale, this.scale - 0.1);
      this.slow = 0;
      this.cooldown = 1.5;
      return 'scale';
    }
    if (this.fast > 4 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.fast = 0;
      this.cooldown = 2.5;
      return 'scale';
    }
    if (this.scale <= minScale + 1e-3 && fps < 34) {
      this.floorTime += dt;
      if (this.floorTime > 5) {
        this.floorTime = 0;
        return 'tier-down';
      }
    } else {
      this.floorTime = 0;
    }
    return 'none';
  }

  get fps() {
    return 1 / this.ema;
  }
}
