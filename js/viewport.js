// Bounded zoom and pan for a plotly cartesian figure, owned by the card.
//
// Plotly's built-in gestures move the curve layers with a CSS transform and
// redraw images and annotations only when the gesture settles, so against a
// range limit the curves drift and snap back while the badges and labels
// stay put. Here every step of a gesture is a clamped Plotly.relayout, so
// curves, badges and labels always move together and nothing moves that will
// not stay moved. The view can never leave `bounds` (the designed axis
// ranges: no negative cost or rate, no zooming out past the designed view),
// panning stops at the walls with the span intact, and zooming in stops at
// MAX_ZOOM: the view is never narrower than a tenth of the designed range on
// either axis, a window that still holds a few of the data's steps rather than
// a single point in empty space. Wheel and pinch zoom stop on both axes the
// moment one reaches that limit, so the figure stops instead of stretching
// along the other axis; a box zoom drawn narrower than the limit opens up to
// it around the box's centre.
//
//   wheel / trackpad   zoom about the cursor
//   drag               pan
//   shift + drag       box zoom
//   two fingers        pinch zoom (and pan)
//   double-click       reset (the card's own redraw of the designed view)
//   tap / click        reported to the card (onTap) when the pointer did not move

const MAX_ZOOM = 10;         // finest zoom: a tenth of the designed range on each axis
const WHEEL_RATE = 0.0016;   // zoom factor per wheel pixel: e^(dy·rate)

function clampRange(a, b, lo, hi) {
  let span = b - a;
  const full = hi - lo;
  if (span >= full) return [lo, hi];
  if (span < full / MAX_ZOOM) { const c = (a + b) / 2; span = full / MAX_ZOOM; a = c - span / 2; b = c + span / 2; }
  if (a < lo) return [lo, lo + span];
  if (b > hi) return [hi - span, hi];
  return [a, b];
}

const TAP_MOVE = 4;          // px a pointer may travel and still count as a tap

// attachViewport(plot, { bounds, reset, onTap })
//   bounds(): { x0, x1, y0, y1 } in plot units (log10 on a log axis) or null
//   reset():  redraw the designed view
//   onTap({ clientX, clientY }): optional; a single pointer pressed and
//             released in place inside the plot area (not the tail of a pinch)
export function attachViewport(plot, { bounds, reset, onTap }) {
  if (plot._viewport) return;
  plot._viewport = true;
  plot.style.touchAction = 'none'; // one-finger drags pan the figure, not the page

  const axes = () => {
    const fl = plot._fullLayout;
    if (!fl || !fl.xaxis || !fl._size) return null;
    return { xr: fl.xaxis.range.slice(), yr: fl.yaxis.range.slice(), size: fl._size, rect: plot.getBoundingClientRect() };
  };
  // client pixel -> plot units under the given axes
  const toData = (ax, cx, cy) => ({
    x: ax.xr[0] + ((cx - ax.rect.left - ax.size.l) / ax.size.w) * (ax.xr[1] - ax.xr[0]),
    y: ax.yr[1] - ((cy - ax.rect.top - ax.size.t) / ax.size.h) * (ax.yr[1] - ax.yr[0]),
  });

  // one relayout per animation frame, the latest requested view winning
  let pending = null;
  let raf = null;
  function apply(xr, yr) {
    const bd = bounds();
    if (!bd) return;
    const x = clampRange(xr[0], xr[1], bd.x0, bd.x1);
    const y = clampRange(yr[0], yr[1], bd.y0, bd.y1);
    pending = { 'xaxis.range': x, 'yaxis.range': y };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const update = pending;
      pending = null;
      if (update && window.Plotly) window.Plotly.relayout(plot, update);
    });
  }
  // the smallest zoom factor the current view may take before an axis would
  // pass its finest span (1 once either axis is already there)
  function finest(xr, yr) {
    const bd = bounds();
    if (!bd) return 0;
    return Math.min(1, Math.max((bd.x1 - bd.x0) / MAX_ZOOM / (xr[1] - xr[0]), (bd.y1 - bd.y0) / MAX_ZOOM / (yr[1] - yr[0])));
  }
  // zoom the ranges `xr`/`yr` by `f` (held at the zoom-in limit) about the
  // data point (cx, cy), then move that data point to the client pixel
  // (px, py) under the new spans
  function zoomed(ax, xr, yr, f0, cxData, cyData, px, py) {
    const f = Math.max(f0, finest(xr, yr));
    const x = [cxData - (cxData - xr[0]) * f, cxData + (xr[1] - cxData) * f];
    const y = [cyData - (cyData - yr[0]) * f, cyData + (yr[1] - cyData) * f];
    const xAt = x[0] + ((px - ax.rect.left - ax.size.l) / ax.size.w) * (x[1] - x[0]);
    const yAt = y[1] - ((py - ax.rect.top - ax.size.t) / ax.size.h) * (y[1] - y[0]);
    const dx = cxData - xAt;
    const dy = cyData - yAt;
    return { x: [x[0] + dx, x[1] + dx], y: [y[0] + dy, y[1] + dy] };
  }

  // wheel: zoom about the cursor (a horizontal-only wheel is left to the page)
  plot.addEventListener('wheel', (e) => {
    const ax = axes();
    if (!ax || !e.deltaY) return;
    e.preventDefault();
    const f = Math.exp(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1) * WHEEL_RATE);
    const c = toData(ax, e.clientX, e.clientY);
    const v = zoomed(ax, ax.xr, ax.yr, f, c.x, c.y, e.clientX, e.clientY);
    apply(v.x, v.y);
  }, { passive: false });

  // pointers: one pans (or box-zooms with shift), two pinch
  const pointers = new Map();
  let gesture = null; // { kind: 'pan'|'box'|'pinch', ax, ... }
  let multi = false;  // a second pointer joined since the last release of all
  let box = null;     // the box-zoom rectangle element
  const inPlotArea = (ax, cx, cy) => cx >= ax.rect.left + ax.size.l && cx <= ax.rect.left + ax.size.l + ax.size.w
    && cy >= ax.rect.top + ax.size.t && cy <= ax.rect.top + ax.size.t + ax.size.h;

  function startGesture() {
    const ax = axes();
    if (!ax) return;
    const pts = [...pointers.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = {
        kind: 'pinch', ax, xr: ax.xr, yr: ax.yr,
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      gesture.midData = toData(ax, gesture.mid.x, gesture.mid.y);
      hideBox();
    } else if (pts.length === 1) {
      const p = pts[0];
      gesture = { kind: p.shift ? 'box' : 'pan', ax, xr: ax.xr, yr: ax.yr, from: { x: p.x, y: p.y } };
      if (gesture.kind === 'box') showBox(p.x, p.y, p.x, p.y);
    }
  }
  function showBox(x0, y0, x1, y1) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'vp-box';
      plot.appendChild(box);
    }
    const r = plot.getBoundingClientRect();
    box.style.left = `${Math.min(x0, x1) - r.left}px`;
    box.style.top = `${Math.min(y0, y1) - r.top}px`;
    box.style.width = `${Math.abs(x1 - x0)}px`;
    box.style.height = `${Math.abs(y1 - y0)}px`;
    box.style.display = 'block';
  }
  function hideBox() { if (box) box.style.display = 'none'; }

  plot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const ax = axes();
    if (!ax || !inPlotArea(ax, e.clientX, e.clientY)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, shift: e.shiftKey, x0: e.clientX, y0: e.clientY });
    if (pointers.size > 1) multi = true;
    try { plot.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    startGesture();
    e.preventDefault();
  });
  plot.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    const p = pointers.get(e.pointerId);
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gesture;
    if (g.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = zoomed(g.ax, g.xr, g.yr, g.dist / dist, g.midData.x, g.midData.y, mid.x, mid.y);
      apply(v.x, v.y);
    } else if (g.kind === 'pan') {
      const dx = ((p.x - g.from.x) / g.ax.size.w) * (g.xr[1] - g.xr[0]);
      const dy = ((p.y - g.from.y) / g.ax.size.h) * (g.yr[1] - g.yr[0]);
      apply([g.xr[0] - dx, g.xr[1] - dx], [g.yr[0] + dy, g.yr[1] + dy]);
    } else if (g.kind === 'box') {
      showBox(g.from.x, g.from.y, p.x, p.y);
    }
    e.preventDefault();
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    const g = gesture;
    gesture = null;
    if (g && g.kind === 'box') {
      hideBox();
      if (Math.abs(p.x - g.from.x) > 6 && Math.abs(p.y - g.from.y) > 6) {
        const a = toData(g.ax, g.from.x, g.from.y);
        const b = toData(g.ax, p.x, p.y);
        apply([Math.min(a.x, b.x), Math.max(a.x, b.x)], [Math.min(a.y, b.y), Math.max(a.y, b.y)]);
      }
    }
    if (pointers.size) { startGesture(); return; } // a pinch that lost a finger continues as a pan
    const tapped = !multi && g && g.kind === 'pan' && Math.hypot(p.x - p.x0, p.y - p.y0) <= TAP_MOVE;
    multi = false;
    if (tapped && onTap) onTap({ clientX: p.x, clientY: p.y });
  }
  plot.addEventListener('pointerup', endPointer);
  plot.addEventListener('pointercancel', endPointer);
  plot.addEventListener('lostpointercapture', endPointer);

  plot.addEventListener('dblclick', (e) => {
    const ax = axes();
    if (!ax || !inPlotArea(ax, e.clientX, e.clientY)) return;
    e.preventDefault();
    pointers.clear();
    gesture = null;
    hideBox();
    reset();
  });
}
