/** Keyboard, mouse and touch state. Movement is polled each frame; actions are callbacks. */
export class Input {
  keys = new Set<string>();
  lookX = 0;
  lookY = 0;
  wheel = 0;
  pointer = { x: -1e4, y: -1e4, inside: false, down: false, type: 'mouse' as string };
  /** Smoothed pointer speed in px/s, used for reactive distortion. */
  pointerSpeed = 0;
  joystick = { x: 0, y: 0 };
  touchVertical = 0;
  touchBoost = false;
  locked = false;
  onClick: (x: number, y: number) => void = () => {};
  onKey: (code: string, e: KeyboardEvent) => void = () => {};
  onPointerMove: () => void = () => {};

  private el: HTMLElement | null = null;
  private downAt = { x: 0, y: 0, t: 0 };
  private dragDist = 0;
  private lastMove = { x: 0, y: 0, t: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private cleanup: (() => void)[] = [];

  attach(el: HTMLElement) {
    this.el = el;
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(el, 'pointerdown', (e: PointerEvent) => {
      this.pointer.type = e.pointerType;
      if (e.pointerType === 'touch') this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      el.setPointerCapture?.(e.pointerId);
      this.pointer.down = true;
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.dragDist = 0;
      this.setPointer(e);
      if (this.touches.size === 2) this.pinch = this.touchDistance();
    });

    on(el, 'pointermove', (e: PointerEvent) => {
      this.pointer.type = e.pointerType;
      const prev = { x: this.pointer.x, y: this.pointer.y };
      this.setPointer(e);
      if (e.pointerType === 'touch') {
        if (!this.touches.has(e.pointerId)) return;
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size >= 2) {
          const d = this.touchDistance();
          if (this.pinch > 0) this.wheel += (this.pinch - d) * 4;
          this.pinch = d;
          this.dragDist += 10;
          return;
        }
      }
      if (this.pointer.down && prev.x > -1e3) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        this.dragDist += Math.abs(dx) + Math.abs(dy);
        if (this.dragDist > 4) {
          this.lookX += dx;
          this.lookY += dy;
        }
      }
      this.onPointerMove();
    });

    const end = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touches.delete(e.pointerId);
        if (this.touches.size < 2) this.pinch = 0;
      }
      if (!this.pointer.down) return;
      this.pointer.down = false;
      const dt = performance.now() - this.downAt.t;
      if (e.type === 'pointerup' && this.dragDist < 6 && dt < 600) this.onClick(e.clientX, e.clientY);
      if (e.pointerType === 'touch') this.pointer.inside = false;
    };
    on(el, 'pointerup', end);
    on(el, 'pointercancel', end);
    on(el, 'pointerleave', () => {
      if (this.pointer.type === 'mouse') this.pointer.inside = false;
    });
    on(el, 'pointerenter', (e: PointerEvent) => {
      this.setPointer(e);
    });
    on(el, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 300 : 1;
      this.wheel += e.deltaY * scale;
    }, { passive: false });
    on(el, 'contextmenu', (e: Event) => e.preventDefault());

    on(window, 'keydown', (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing && e.code !== 'Escape' && e.code !== 'Tab') return;
      if (!e.repeat) this.onKey(e.code, e);
      this.keys.add(e.code);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    });
    on(window, 'blur', () => {
      this.keys.clear();
      this.pointer.down = false;
    });
  }

  private touchDistance() {
    const pts = [...this.touches.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private setPointer(e: PointerEvent) {
    const now = performance.now();
    const rect = this.el!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dt = Math.max(1, now - this.lastMove.t);
    const v = (Math.hypot(x - this.lastMove.x, y - this.lastMove.y) / dt) * 1000;
    if (this.lastMove.t > 0 && dt < 120) this.pointerSpeed = Math.max(this.pointerSpeed, Math.min(v, 6000));
    this.lastMove = { x, y, t: now };
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.inside = true;
  }

  update(dt: number) {
    this.pointerSpeed *= Math.exp(-dt * 4);
  }

  /** Pointer position in [-1, 1] (y down), 0 when the pointer is outside or unknown. */
  centered(w: number, h: number) {
    const p = this.pointer;
    if (!p.inside || p.x < -1000) return { x: 0, y: 0 };
    return { x: Math.max(-1, Math.min(1, (p.x / Math.max(1, w)) * 2 - 1)), y: Math.max(-1, Math.min(1, (p.y / Math.max(1, h)) * 2 - 1)) };
  }

  private key(...codes: string[]) {
    for (const c of codes) if (this.keys.has(c)) return 1;
    return 0;
  }

  get forward() {
    if (this.locked) return 0;
    return this.key('KeyW', 'ArrowUp') - this.key('KeyS', 'ArrowDown') + this.joystick.y;
  }
  get strafe() {
    if (this.locked) return 0;
    return this.key('KeyD', 'ArrowRight') - this.key('KeyA', 'ArrowLeft') + this.joystick.x;
  }
  get vertical() {
    if (this.locked) return 0;
    return this.key('Space') - this.key('KeyQ', 'KeyC') + this.touchVertical;
  }
  get boost() {
    return !this.locked && (this.key('ShiftLeft', 'ShiftRight') === 1 || this.touchBoost);
  }

  consumeLook() {
    const r = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    if (this.locked) return { x: 0, y: 0 };
    return r;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return this.locked ? 0 : w;
  }

  dispose() {
    this.cleanup.forEach((c) => c());
    this.cleanup = [];
  }
}
