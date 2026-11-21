import { getEngine } from '../core/Engine';
import { QUALITY } from '../core/Quality';
import { useNexus } from '../core/store';
import type { QualityTier, RenderMode } from '../core/types';

const MODES: { id: RenderMode; label: string; key: string }[] = [
  { id: 'ascii', label: 'ASCII', key: '1' },
  { id: 'wireframe', label: 'WIRE', key: '2' },
  { id: 'reality', label: 'REALITY', key: '3' },
];

export function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const mode = useNexus((s) => s.mode);
  return (
    <div className="nx-legible pointer-events-auto flex items-center gap-2 font-mono text-[10px] tracking-[0.28em]" role="radiogroup" aria-label="Rendering mode">
      {MODES.map((m) => {
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={(e) => {
              getEngine()?.setMode(m.id);
              (e.currentTarget as HTMLButtonElement).blur();
            }}
            className={`relative px-2.5 py-1.5 transition-colors duration-300 ${on ? 'text-nx-cyan nx-glow' : 'text-nx-grey hover:text-nx-white'}`}
          >
            {!compact && <span className="mr-2 hidden text-nx-grey/45 sm:inline">{m.key}</span>}
            {m.label}
            <span className={`absolute inset-x-2 -bottom-px h-px bg-nx-cyan transition-transform duration-500 ${on ? 'scale-x-100' : 'scale-x-0'}`} />
          </button>
        );
      })}
    </div>
  );
}

export function AudioToggle() {
  const on = useNexus((s) => s.audioOn);
  return (
    <button
      type="button"
      onClick={(e) => {
        void getEngine()?.toggleAudio();
        (e.currentTarget as HTMLButtonElement).blur();
      }}
      className="nx-legible pointer-events-auto flex items-center gap-3 font-mono text-[10px] tracking-[0.3em] text-nx-grey transition-colors hover:text-nx-white"
      aria-pressed={on}
      aria-label={on ? 'Turn sound off' : 'Turn sound on'}
    >
      <span className={`nx-eq flex h-3 items-end gap-[3px] ${on ? 'text-nx-cyan' : 'off text-nx-grey/60'}`}>
        <span />
        <span />
        <span />
        <span />
      </span>
      SOUND {on ? 'ON' : 'OFF'}
    </button>
  );
}

export function QualityPicker() {
  const q = useNexus((s) => s.quality);
  const auto = useNexus((s) => s.autoQuality);
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] tracking-[0.22em]">
      {(Object.keys(QUALITY) as QualityTier[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => getEngine()?.setQuality(t)}
          className={`border px-2.5 py-1.5 transition-colors ${q === t ? 'border-nx-cyan/60 text-nx-cyan' : 'border-nx-grey/20 text-nx-grey hover:text-nx-white'}`}
        >
          {QUALITY[t].label.toUpperCase()}
        </button>
      ))}
      <button
        type="button"
        onClick={() => getEngine()?.setAutoQuality(!auto)}
        className={`ml-1 border px-2.5 py-1.5 transition-colors ${auto ? 'border-nx-purple/70 text-nx-white' : 'border-nx-grey/20 text-nx-grey hover:text-nx-white'}`}
        aria-pressed={auto}
      >
        ADAPTIVE {auto ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

export function DensitySlider() {
  const cell = useNexus((s) => s.cellSize);
  return (
    <label className="block font-mono text-[10px] tracking-[0.22em] text-nx-grey">
      <div className="mb-1 flex justify-between">
        <span>GLYPH DENSITY</span>
        <span className="text-nx-white/80">{cell}px CELLS</span>
      </div>
      <input
        className="nx-range"
        type="range"
        min={6}
        max={16}
        step={1}
        value={22 - cell}
        onChange={(e) => getEngine()?.setCellSize(22 - Number(e.target.value))}
        aria-label="Glyph density"
      />
      <div className="flex justify-between text-[9px] text-nx-grey/60">
        <span>COARSE</span>
        <span>FINE</span>
      </div>
    </label>
  );
}

export const CONTROL_LIST: [string, string][] = [
  ['W A S D', 'Fly'],
  ['DRAG', 'Look around'],
  ['WHEEL', 'Zoom'],
  ['SPACE / Q', 'Ascend / descend'],
  ['SHIFT', 'Accelerate'],
  ['CLICK', 'Select object'],
  ['E', 'Interact'],
  ['TAB', 'Exploration index'],
  ['1 2 3 / M', 'Render mode'],
  ['H', 'Hide interface'],
  ['ESC', 'Close · release · pause'],
];

export function ControlList() {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 font-mono text-[10px] tracking-[0.18em]">
      {CONTROL_LIST.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-nx-white/85">{k}</dt>
          <dd className="text-nx-grey">{v.toUpperCase()}</dd>
        </div>
      ))}
    </dl>
  );
}
