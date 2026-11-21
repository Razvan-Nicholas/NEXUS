import { useEffect, useRef, useState } from 'react';
import { createEngine, type Engine } from './core/Engine';
import { useNexus } from './core/store';
import { Boot } from './ui/Boot';
import { AudioToggle, ModeSwitch } from './ui/Controls';
import { GatewayOverlay } from './ui/GatewayOverlay';
import { Hud } from './ui/Hud';
import { Explorer, InfoPanel, PauseMenu, Toasts, ZoneCardView } from './ui/Panels';
import { TouchControls } from './ui/TouchControls';

function Chrome() {
  const phase = useNexus((s) => s.phase);
  const hud = useNexus((s) => s.hudVisible);
  const touch = useNexus((s) => s.isTouch);
  const shown = phase !== 'boot' && (hud || phase === 'gateway');
  const audioTop = touch && phase !== 'gateway';
  return (
    <div className={`pointer-events-none fixed inset-0 z-30 transition-opacity duration-1000 ${shown ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute right-4 top-4 sm:right-5">
        <ModeSwitch />
      </div>
      <div className={`absolute ${audioTop ? 'right-5 top-14' : 'bottom-6 right-6'}`}>
        <AudioToggle />
      </div>
    </div>
  );
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const inverted = useNexus((s) => s.inverted);

  useEffect(() => {
    if (!host.current) return;
    const e = createEngine(host.current);
    setEngine(e);
    void e.boot();
    return () => e.dispose();
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-nx-void">
      <div ref={host} className="absolute inset-0" />
      {engine && (
        <div className={`fixed inset-0 transition-[filter] duration-700 ${inverted ? 'nx-inverted' : ''}`} style={{ pointerEvents: 'none' }}>
          <GatewayOverlay />
          <Hud />
          <InfoPanel />
          <ZoneCardView />
          <TouchControls />
          <Chrome />
          <Explorer />
          <PauseMenu />
          <Toasts />
        </div>
      )}
      <Boot />
    </main>
  );
}
