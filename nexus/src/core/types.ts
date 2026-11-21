import type * as THREE from 'three';
import type { Engine } from './Engine';

/** A loadable 3D scene. The Planetary Archive is a zone inside the Cosmos scene. */
export type SceneId = 'gateway' | 'cosmos' | 'singularity' | 'unknown';
/** The five environments a visitor can be in. */
export type ZoneId = 'gateway' | 'cosmos' | 'archive' | 'singularity' | 'unknown';
export type RenderMode = 'ascii' | 'wireframe' | 'reality';
export type QualityTier = 'high' | 'balanced' | 'performance';
export type TransitionKind = 'boot' | 'enter' | 'warp' | 'singularity' | 'horizon' | 'portal';
export type AudioProfile = 'gateway' | 'cosmos' | 'singularity' | 'unknown';
/** Mouse lens behaviour in the glyph composite: 0 magnify, 1 gravitational, 2 glitch. */
export type LensType = 0 | 1 | 2;

export interface ZoneInfo {
  id: ZoneId;
  index: string;
  name: string;
  subtitle: string;
  scene: SceneId;
  blurb: string;
}

export interface QualitySettings {
  label: string;
  maxDpr: number;
  /** Cap on scene render-target pixels per CSS pixel; the glyph composite stays at full DPR. */
  maxSceneDpr: number;
  minSceneScale: number;
  /** Scene render-target scale while the ASCII mode is steady (cells only need a few samples). */
  asciiSceneScale: number;
  particleScale: number;
  bloomLevels: number;
  /** Supersampling taps per cell axis in the ASCII cell pass. */
  taps: number;
  bhSteps: number;
  chroma: boolean;
  grain: boolean;
  msaa: number;
  defaultCell: number;
}

export interface StatLine {
  label: string;
  value: string;
}

export type SelectableKind = 'planet' | 'star' | 'structure' | 'singularity' | 'portal' | 'anomaly' | 'artifact';

export interface SelectionInfo {
  id: string;
  name: string;
  designation: string;
  kind: SelectableKind;
  description?: string;
  stats?: StatLine[];
  accent?: string;
  /** Planets can be inspected in close orbit. */
  inspectable?: boolean;
}

export interface Selectable {
  id: string;
  name: string;
  kind: SelectableKind;
  /** Picking radius in world units. */
  radius: number;
  getPosition(target: THREE.Vector3): THREE.Vector3;
  info: SelectionInfo;
  interactLabel?: string;
  /** Distance at which E works without selecting first. */
  interactRange?: number;
  isAvailable?(): boolean;
  onInteract?(): void;
  /** Base frequency for the object's interaction sound. */
  tone?: number;
}

/** Visual description of a planet in the Planetary Archive. */
export interface PlanetDefinition {
  id: string;
  name: string;
  designation: string;
  surface: 'volcanic' | 'void' | 'crystal' | 'gas';
  radius: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  inclination: number;
  rotationSpeed: number;
  axialTilt: number;
  glyphStyle: number;
  palette: { primary: string; secondary: string; accent: string; atmosphere: string };
  rings?: { inner: number; outer: number };
  stats: StatLine[];
  description: string;
  tone: number;
}

export interface EnvironmentConfig {
  id: SceneId;
  zone: ZoneId;
  audio: AudioProfile;
  background: string;
  fogColor: string;
  fogDensity: number;
  camera: { fov: number; near: number; far: number };
  movement: { speed: number; boost: number };
  ascii: { exposure: number; gamma: number; edge: number; voidDust: number; lens: LensType; glyphGain: number; floor?: number };
  bloom: { strength: number; threshold: number };
  exposure: number;
  hint: string;
}

export interface Environment {
  readonly id: SceneId;
  readonly config: EnvironmentConfig;
  readonly scene: THREE.Scene;
  init(engine: Engine): Promise<void>;
  /** Place the camera for arrival. Called right after the scene swap. */
  enter(engine: Engine, from: SceneId | null, kind: TransitionKind): void;
  /** Optional arrival cinematic; resolves when control can be handed to the visitor. */
  entryCinematic?(engine: Engine, from: SceneId | null, kind: TransitionKind): Promise<void>;
  /** Optional departure cinematic; must end with the screen covered (flash/warp/fade at 1). */
  exitCinematic?(engine: Engine, to: SceneId, kind: TransitionKind): Promise<void>;
  update(dt: number, time: number, engine: Engine): void;
  getSelectables(): Selectable[];
  getZone?(engine: Engine): ZoneId;
  onQualityChange?(q: QualitySettings): void;
  dispose(): void;
}
