// Reliable taps for every button in the game.
//
// iOS Safari only synthesises a `click` after a touch if the finger did not move and nothing
// cancelled the gesture; a thumb that drifts a few pixels (or a busy WebGL frame) loses it, so
// buttons needed a second tap. Here a button acts on `pointerup` - immediately, on the first
// tap - as long as the finger lifts on (or within 18 px of) the button it went down on. It
// shows a pressed state the moment it is touched. The `click` that may follow is swallowed, so
// one tap is exactly one action; a `click` with no pointer before it (keyboard, VoiceOver,
// element.click()) still works. Driving controls do not use this: they read raw multi-touch
// (js/controls.js) and never wait for a click.
const handlers = new WeakMap();
const lastFire = new WeakMap();
let down = null;                         // { el, id, x, y }
let ghost = null;                        // { x, y }: the browser click still to come for the last tap
const SLOP = 18, REPEAT_MS = 280;

export function onTap(el, fn) {
  if (!el) return;
  handlers.set(el, fn);
  el.setAttribute('data-tap', '');
}

const target = (e) => {
  const el = e.target && e.target.closest ? e.target.closest('[data-tap]') : null;
  return el && handlers.has(el) && !el.disabled ? el : null;
};
function fire(el, e) {
  const now = performance.now();
  if (now - (lastFire.get(el) || -1e9) < REPEAT_MS) return false;    // one tap, one action
  lastFire.set(el, now);
  try { handlers.get(el)(e); } catch (err) { console.error(err); }
  return true;
}
const release = () => { if (down) { down.el.classList.remove('pressed'); down = null; } };

document.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  ghost = null;                            // a new touch: no click left over from the last one
  const el = target(e);
  if (!el) return;
  release();
  down = { el, id: e.pointerId, x: e.clientX, y: e.clientY };
  el.classList.add('pressed');
}, { capture: true, passive: true });

document.addEventListener('pointerup', (e) => {
  if (!down || e.pointerId !== down.id) return;
  const { el } = down;
  release();
  const r = el.getBoundingClientRect();
  const inside = e.clientX >= r.left - SLOP && e.clientX <= r.right + SLOP && e.clientY >= r.top - SLOP && e.clientY <= r.bottom + SLOP;
  // the browser's own click for this tap may come late (after a busy frame) or not at all: either
  // way it must not act again, so it is swallowed whenever it arrives
  // (if the tap hid its button, that click would land on whatever is underneath: a ghost tap)
  if (inside) { ghost = { x: e.clientX, y: e.clientY }; fire(el, e); }
}, { capture: true, passive: true });

document.addEventListener('pointercancel', (e) => { if (down && e.pointerId === down.id) release(); }, { capture: true, passive: true });

document.addEventListener('click', (e) => {
  if (ghost && e.isTrusted && Math.abs(e.clientX - ghost.x) < 40 && Math.abs(e.clientY - ghost.y) < 40) {
    ghost = null; e.preventDefault(); e.stopPropagation(); return;       // already acted on pointerup
  }
  const el = target(e);
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  fire(el, e);
}, { capture: true });
