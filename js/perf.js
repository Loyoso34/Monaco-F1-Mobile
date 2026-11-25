// Adaptive quality: keeps the frame time near 16.7 ms by scaling the render resolution first
// (the HUD is DOM and stays sharp), then the shadow map, then shadows altogether.
export const TIERS = {
  high: { ratio: 2.0, shadow: 2048, shadows: true },
  medium: { ratio: 1.6, shadow: 1024, shadows: true },
  low: { ratio: 1.2, shadow: 512, shadows: false },
};

export function autoTier() {
  const ua = navigator.userAgent || '';
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (/iPhone|iPad|Macintosh/.test(ua)) return 'high';         // Apple GPUs (A16+ / M-series)
  if (mem >= 6 && cores >= 8) return 'high';
  if (mem >= 4) return 'medium';
  return 'low';
}

export class Perf {
  constructor(renderer, sun, tierName) {
    this.r = renderer; this.sun = sun;
    this.setTier(tierName);
    this.samples = []; this.t = 0; this.slow = 0; this.fast = 0; this.fps = 60; this.frames = 0; this.acc = 0;
  }
  setTier(name) {
    this.tierName = name; this.tier = TIERS[name];
    this.scale = 1;
    this.apply();
    if (this.onTier) this.onTier(name);
  }
  apply() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const ratio = Math.min(dpr, this.tier.ratio) * this.scale;
    this.r.setPixelRatio(Math.max(0.6, ratio));
    this.r.shadowMap.enabled = this.tier.shadows;
    if (this.sun) {
      this.sun.castShadow = this.tier.shadows;
      if (this.sun.shadow.mapSize.x !== this.tier.shadow) {
        this.sun.shadow.mapSize.set(this.tier.shadow, this.tier.shadow);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
    }
  }
  // dtMs: frame interval; adaptive only when `adaptive` is true (graphics = Auto)
  frame(dtMs, adaptive) {
    this.frames++; this.acc += dtMs;
    if (this.acc >= 500) { this.fps = Math.round(this.frames * 1000 / this.acc); this.frames = 0; this.acc = 0; }
    if (!adaptive) return;
    this.samples.push(dtMs);
    if (this.samples.length < 45) return;
    const s = this.samples.slice().sort((a, b) => a - b);
    const med = s[Math.floor(s.length * 0.6)];
    this.samples.length = 0;
    if (med > 18.2) { this.slow++; this.fast = 0; } else if (med < 14.5) { this.fast++; this.slow = 0; } else { this.slow = 0; this.fast = 0; }
    if (this.slow >= 2) {
      this.slow = 0;
      if (this.scale > 0.62) { this.scale *= 0.88; this.apply(); }
      else if (this.tierName === 'high') { this.setTier('medium'); this.scale = 0.85; this.apply(); }
      else if (this.tierName === 'medium') { this.setTier('low'); this.scale = 0.9; this.apply(); }
    } else if (this.fast >= 6) {
      this.fast = 0;
      if (this.scale < 1) { this.scale = Math.min(1, this.scale * 1.06); this.apply(); }
    }
  }
}
