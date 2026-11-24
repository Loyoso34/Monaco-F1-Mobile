// Persistent settings and the personal-best lap (localStorage, failure-tolerant).
const KEY = 'monacoTT.settings.v1';
const BEST = 'monacoTT.best.v1';
const DEFAULTS = { steerSens: 1.0, master: 0.9, engine: 0.9, fx: 0.8, camera: 'tcam', gfx: 'auto', assists: 'standard', showFps: false };

function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

export const settings = Object.assign({}, DEFAULTS, read(KEY) || {});
export function saveSettings() { write(KEY, settings); }

export function loadBest() { const b = read(BEST); return b && typeof b.time === 'number' && b.time > 30 ? b : null; }
export function saveBest(time) { write(BEST, { time, date: new Date().toISOString() }); }
export function clearBest() { try { localStorage.removeItem(BEST); } catch {} }

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '–:––.–––';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
