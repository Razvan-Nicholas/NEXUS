import type { ZoneId, ZoneInfo } from './types';

export const ZONES: Record<ZoneId, ZoneInfo> = {
  gateway: {
    id: 'gateway',
    index: '01',
    name: 'The Gateway',
    subtitle: 'Threshold of the digital void',
    scene: 'gateway',
    blurb: 'Where the render begins.',
  },
  cosmos: {
    id: 'cosmos',
    index: '02',
    name: 'The Cosmos',
    subtitle: 'Outer arm · Sector 7G',
    scene: 'cosmos',
    blurb: 'A procedurally generated spiral galaxy.',
  },
  archive: {
    id: 'archive',
    index: '03',
    name: 'Planetary Archive',
    subtitle: 'Lumen system · 4 bodies catalogued',
    scene: 'cosmos',
    blurb: 'Four worlds, each with its own glyph signature.',
  },
  singularity: {
    id: 'singularity',
    index: '04',
    name: 'The Singularity',
    subtitle: 'Galactic core · SGR-Ø',
    scene: 'singularity',
    blurb: 'Light bends here. So does everything else.',
  },
  unknown: {
    id: 'unknown',
    index: '05',
    name: 'The Unknown',
    subtitle: 'Coordinates undefined',
    scene: 'unknown',
    blurb: 'Beyond the event horizon, the renderer improvises.',
  },
};

export const ZONE_ORDER: ZoneId[] = ['gateway', 'cosmos', 'archive', 'singularity', 'unknown'];
