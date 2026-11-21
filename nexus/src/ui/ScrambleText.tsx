import { useEffect, useRef } from 'react';

const GLYPHS = '!<>-_\\/[]{}=+*^?#%&@$01';

interface Props {
  text: string;
  play?: boolean;
  duration?: number;
  delay?: number;
  className?: string;
}

/** Decodes text from random glyphs, left to right — the NEXUS "render resolve" effect. */
export function ScrambleText({ text, play = true, duration = 900, delay = 0, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const blank = text.replace(/[^ ]/g, ' ');
    if (!play) {
      el.textContent = blank;
      return;
    }
    let raf = 0;
    let start = 0;
    let lastSwap = 0;
    let current = blank;
    const step = (now: number) => {
      if (!start) start = now;
      const t = (now - start - delay) / duration;
      if (t >= 1) {
        el.textContent = text;
        return;
      }
      if (t >= 0 && now - lastSwap > 45) {
        lastSwap = now;
        let out = '';
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          const at = (i / Math.max(1, text.length)) * 0.7;
          if (ch === ' ') out += ' ';
          else if (t >= at + 0.3) out += ch;
          else if (t >= at - 0.05) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          else out += ' ';
        }
        current = out;
        el.textContent = current;
      }
      raf = requestAnimationFrame(step);
    };
    el.textContent = blank;
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, play, duration, delay]);

  return <span ref={ref} className={className} aria-label={text} />;
}
