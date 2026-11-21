import * as THREE from 'three';
import type { PlanetDefinition, SelectionInfo } from '../../core/types';
import { STYLE } from '../../core/uniforms';

/** The Lumen system sits in the galaxy's outer arm; the galactic core (SGR-Ø) is ~2.8 ku away. */
export const CORE_POSITION = new THREE.Vector3(-1400, 444, -2400);
export const GALAXY_NORMAL = new THREE.Vector3(0.18, 1, 0.08).normalize();
export const SPAWN = new THREE.Vector3(18, 46, 372);
export const ARCHIVE_VIEW = new THREE.Vector3(-150, 70, 230);

export const PLANETS: PlanetDefinition[] = [
  {
    id: 'nova-01',
    name: 'NOVA-01',
    designation: 'CLASS-V // PYROCLASTIC',
    surface: 'volcanic',
    radius: 7,
    orbitRadius: 72,
    orbitSpeed: 0.016,
    orbitPhase: 3.55,
    inclination: 0.04,
    rotationSpeed: 0.11,
    axialTilt: 0.32,
    glyphStyle: STYLE.VOLCANIC,
    palette: { primary: '#FF6A1F', secondary: '#FF00A8', accent: '#FFB36B', atmosphere: '#FF3D6E' },
    stats: [
      { label: 'Radius', value: '0.81 R⊕' },
      { label: 'Surface temp', value: '1,420 K' },
      { label: 'Rotation', value: '14.2 h' },
      { label: 'Orbit', value: '0.41 AU' },
      { label: 'Atmosphere', value: 'SO₂ · CO₂ · Xe' },
      { label: 'Status', value: 'ACTIVE' },
    ],
    description:
      'A world that never finishes rendering. Its crust tears open every 14.2 hours, and the lava rivers trace the same 4,096-character sequence each cycle.',
    tone: 392,
  },
  {
    id: 'void-07',
    name: 'VOID-07',
    designation: 'CLASS-D // DARK ICE',
    surface: 'void',
    radius: 9,
    orbitRadius: 122,
    orbitSpeed: 0.011,
    orbitPhase: -0.62,
    inclination: -0.05,
    rotationSpeed: 0.05,
    axialTilt: 0.15,
    glyphStyle: STYLE.VOID,
    palette: { primary: '#0B1018', secondary: '#1A2A3A', accent: '#00E5FF', atmosphere: '#00E5FF' },
    stats: [
      { label: 'Radius', value: '1.12 R⊕' },
      { label: 'Albedo', value: '0.03' },
      { label: 'Surface temp', value: '41 K' },
      { label: 'Rotation', value: '61.0 h' },
      { label: 'Orbit', value: '0.88 AU' },
      { label: 'Atmosphere', value: 'Ionized N₂' },
    ],
    description:
      'It absorbs 97% of the light that touches it. The cyan aurora is the only part of VOID-07 that wants to be seen — the rest of it seems to be listening.',
    tone: 196,
  },
  {
    id: 'echo-12',
    name: 'ECHO-12',
    designation: 'CLASS-X // CRYSTALLINE',
    surface: 'crystal',
    radius: 7.5,
    orbitRadius: 176,
    orbitSpeed: 0.008,
    orbitPhase: 2.3,
    inclination: 0.07,
    rotationSpeed: 0.09,
    axialTilt: 0.5,
    glyphStyle: STYLE.CRYSTAL,
    palette: { primary: '#A000FF', secondary: '#3A5BFF', accent: '#00E5FF', atmosphere: '#8A6BFF' },
    stats: [
      { label: 'Radius', value: '0.68 R⊕' },
      { label: 'Lattice', value: 'Silicate-quartz' },
      { label: 'Resonance', value: '432.0 Hz' },
      { label: 'Rotation', value: '9.6 h' },
      { label: 'Orbit', value: '1.37 AU' },
      { label: 'Facets', value: '7,412,883' },
    ],
    description:
      'Every facet reflects a slightly older version of the system. Survey drones report hearing their own transmissions arrive before they were sent.',
    tone: 432,
  },
  {
    id: 'halo-21',
    name: 'HALO-21',
    designation: 'CLASS-J // RINGED GIANT',
    surface: 'gas',
    radius: 17,
    orbitRadius: 258,
    orbitSpeed: 0.0045,
    orbitPhase: 1.16,
    inclination: -0.03,
    rotationSpeed: 0.07,
    axialTilt: 0.42,
    glyphStyle: STYLE.GAS,
    palette: { primary: '#E9E4F7', secondary: '#7C84A8', accent: '#C04BFF', atmosphere: '#B49CFF' },
    rings: { inner: 24, outer: 41 },
    stats: [
      { label: 'Radius', value: '4.6 R⊕' },
      { label: 'Ring span', value: '2.4 × radius' },
      { label: 'Moons', value: '31 (unresolved)' },
      { label: 'Rotation', value: '10.4 h' },
      { label: 'Orbit', value: '2.05 AU' },
      { label: 'Atmosphere', value: 'H₂ · He · CH₄' },
    ],
    description:
      'Its rings are not ice. Spectral analysis resolves them as an orbiting archive of compressed glyph streams — the oldest data in the system.',
    tone: 147,
  },
];

export const LUMEN_INFO: SelectionInfo = {
  id: 'lumen',
  name: 'LUMEN',
  designation: 'CLASS-F // MAIN SEQUENCE',
  kind: 'star',
  accent: '#F5F3FF',
  stats: [
    { label: 'Surface temp', value: '6,900 K' },
    { label: 'Luminosity', value: '2.3 L☉' },
    { label: 'Age', value: '1.1 Gyr' },
    { label: 'Bodies', value: '4 catalogued' },
  ],
  description: 'The anchor of the Archive. Its light is slightly too regular — as if it were rendered at a fixed frame rate.',
};

export const LATTICE_INFO: SelectionInfo = {
  id: 'lattice',
  name: 'THE LATTICE',
  designation: 'MEGASTRUCTURE // ORIGIN UNKNOWN',
  kind: 'structure',
  accent: '#00E5FF',
  stats: [
    { label: 'Span', value: '118 u' },
    { label: 'Nodes', value: '12' },
    { label: 'Edges', value: '30' },
    { label: 'Period', value: '314 s' },
  ],
  description: 'Twelve nodes, thirty edges, no visible purpose. The lattice completes one rotation every 314 seconds, whatever frame you measure it from.',
};

export const MONOLITH_INFO: SelectionInfo = {
  id: 'monoliths',
  name: 'MONOLITH ARRAY',
  designation: 'ARTIFACT // DATA OBELISKS',
  kind: 'artifact',
  accent: '#A000FF',
  stats: [
    { label: 'Obelisks', value: '7' },
    { label: 'Height', value: '36 u' },
    { label: 'Signal', value: 'Binary, looping' },
  ],
  description: 'Seven obelisks scrolling the same binary sequence. Decoded, it reads: DO NOT RENDER BEYOND THIS POINT.',
};

export const CORE_INFO: SelectionInfo = {
  id: 'sgr-0',
  name: 'SGR-Ø',
  designation: 'SUPERMASSIVE // GALACTIC CORE',
  kind: 'singularity',
  accent: '#00E5FF',
  stats: [
    { label: 'Mass', value: '4.1 × 10⁶ M☉' },
    { label: 'Distance', value: '2.8 ku' },
    { label: 'Spin', value: 'a* ≈ 0.0' },
  ],
  description: 'Everything in this galaxy is falling toward it — slowly, politely, inevitably. Set a course and the drive will do the rest.',
};

export const ANOMALY_INFO: SelectionInfo = {
  id: 'anomaly-sigma',
  name: 'ANOMALY Σ',
  designation: 'UNRESOLVED // RENDER ERROR',
  kind: 'anomaly',
  accent: '#FF00A8',
  stats: [
    { label: 'Mass', value: 'NaN' },
    { label: 'Position', value: 'Uncertain' },
    { label: 'Visibility', value: 'Intermittent' },
  ],
  description: 'Something here failed to load — or loaded something that was never part of the scene.',
};
