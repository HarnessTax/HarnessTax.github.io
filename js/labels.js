// Shared two-line endpoint labels (model over harness) for the Part I cards.
//
// placeLabels() works in pixel space so the same boxes serve the animated SVG
// frontier and the plotly figures: a label first tries the near positions
// around its marker, and when every one of them collides it is pushed
// outwards and tied back with a leader. labelAnnotation() turns a placed box
// into a plotly annotation; the SVG renderer draws the box directly.

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const LABEL = {
  modelFont: `600 12px ${FONT}`,
  harnessFont: `400 11px ${FONT}`,
  pad: 4,
  baseline1: 11,   // first baseline below the box top (after padding)
  lineGap: 15,     // second baseline below the first
  height: 4 + 11 + 15 + 3 + 4,
};
export const NEAR_ORDER = {
  // frontier points are monotone and the staircase arrives from below and
  // leaves to the right, so the quadrant above-left of a frontier point is
  // free: labels go above or left of their badge, never below-right; a label
  // that fits nowhere near is pushed out upward with a leader (bias)
  frontier: ['above-left', 'above-center', 'middle-left', 'above-right', 'below-left', 'below-center'],
  // curve endpoints read best with the label trailing to the right
  endpoint: ['middle-right', 'above-right', 'below-right', 'above-left', 'below-left', 'above-center', 'below-center', 'middle-left'],
};

let measureCtx = null;
export function textWidth(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export function intersects(a, b, pad = 0) {
  return !(a.x1 + pad <= b.x0 || b.x1 + pad <= a.x0 || a.y1 + pad <= b.y0 || b.y1 + pad <= a.y0);
}

// Does the segment (x1, y1) → (x2, y2) cross the box (padded by `pad`)?
// Liang–Barsky clipping; used so leader lines never run through labels.
export function segmentHitsBox(x1, y1, x2, y2, box, pad = 0) {
  const xmin = box.x0 - pad;
  const xmax = box.x1 + pad;
  const ymin = box.y0 - pad;
  const ymax = box.y1 + pad;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, x1 - xmin) && clip(dx, xmax - x1) && clip(-dy, y1 - ymin) && clip(dy, ymax - y1);
}

export function labelSize(model, harness) {
  const w = Math.max(textWidth(model, LABEL.modelFont), textWidth(harness, LABEL.harnessFont));
  return { w: Math.ceil(w) + LABEL.pad * 2, h: LABEL.height };
}

export function escapeHTML(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// items: [{ px, py, w, h, r? }] in pixel space (r = marker radius, default 7);
// geo: { W, H, l, b } plot bounds.
// opts.order: near-position preference (a NEAR_ORDER entry);
// opts.sequence: 'given' (place in item order) or 'x-desc' (rightmost first);
// opts.obstacles: [{ x0, y0, x1, y1, weight }] extra boxes to avoid;
// opts.markers: extra marker boxes ({ ..., weight }) besides the labelled ones.
// Returns one { x0, y0, x1, y1, cx, cy, leader } per item.
// opts: order (anchor names to try), sequence ('given' | 'x-desc'), obstacles,
// markers, gap (px between the marker's edge and the label, default 2), bias
// ('top-left': a pushed-out label prefers directions above or left of its
// point, so it stays where a frontier label is expected) and joint (true: up
// to six labels are placed together, every combination of their first six
// anchors scored at once, so one label never crowds the next out of its
// natural spot; labels the joint pass cannot seat cleanly fall back to the
// pushed-out search below).
export function placeLabels(items, geo, opts = {}) {
  const gap = opts.gap == null ? 2 : opts.gap;
  // rings a pushed-out label may travel (14px each): a narrow figure, whose
  // badges crowd, may hand its labels a longer leader rather than an overlap
  const reach = opts.reach == null ? 8 : opts.reach;
  // clearance from the marker's centre: its radius plus the gap, so a label
  // keeps the same visual distance from a marker of any size
  const off = (p) => (p.r || 7) + gap;
  const order = opts.order || NEAR_ORDER.endpoint;
  // a pushed-out label goes up or left when it can: below costs most, right less
  const biasPenalty = (ux, uy) => (opts.bias === 'top-left' ? (ux > 0 ? 10 : 0) + (uy > 0 ? 25 : 0) : 0);
  const anchors = {
    'above-left': (p) => ({ x0: p.px - off(p) - p.w, y0: p.py - off(p) - p.h }),
    'above-right': (p) => ({ x0: p.px + off(p), y0: p.py - off(p) - p.h }),
    'below-right': (p) => ({ x0: p.px + off(p), y0: p.py + off(p) }),
    'below-left': (p) => ({ x0: p.px - off(p) - p.w, y0: p.py + off(p) }),
    'above-center': (p) => ({ x0: p.px - p.w / 2, y0: p.py - off(p) - p.h }),
    'below-center': (p) => ({ x0: p.px - p.w / 2, y0: p.py + off(p) }),
    'middle-right': (p) => ({ x0: p.px + off(p), y0: p.py - p.h / 2 }),
    'middle-left': (p) => ({ x0: p.px - off(p) - p.w, y0: p.py - p.h / 2 }),
  };
  const own = items.map((p) => { const r = p.r || 7; return { x0: p.px - r, x1: p.px + r, y0: p.py - r, y1: p.py + r, weight: 8 }; });
  const markers = own.concat(opts.markers || []);
  const obstacles = opts.obstacles || [];
  const sequence = items.map((_, i) => i);
  if (opts.sequence === 'x-desc') sequence.sort((a, b) => items[b].px - items[a].px);
  const placed = [];
  const leaders = []; // segments of already-placed leaders: labels keep clear of them
  const score = (bx, i) => {
    let s = 0;
    if (bx.x0 < geo.l - 2 || bx.x1 > geo.W - 2 || bx.y0 < 0 || bx.y1 > geo.H - geo.b + 2) s += 100;
    for (const q of placed) if (intersects(bx, q, 2)) s += 20;
    markers.forEach((m, j) => { if (j !== i && intersects(bx, m, 1)) s += m.weight; });
    for (const q of obstacles) if (intersects(bx, q, 2)) s += q.weight;
    for (const seg of leaders) if (segmentHitsBox(seg.x1, seg.y1, seg.x2, seg.y2, bx, 1)) s += 15;
    return s;
  };
  // a pushed-out label's own leader must not run through a placed label or
  // over another marker
  const leaderPenalty = (p, i, bx) => {
    const e = edgePoint(bx, p.px, p.py);
    let s = 0;
    for (const q of placed) if (segmentHitsBox(p.px, p.py, e.x, e.y, q, 1)) s += 15;
    markers.forEach((m, j) => { if (j !== i && segmentHitsBox(p.px, p.py, e.x, e.y, m, 0)) s += m.weight; });
    return s;
  };
  const out = new Array(items.length);
  const nearBox = (p, name) => { const a = anchors[name](p); return { x0: a.x0, y0: a.y0, x1: a.x0 + p.w, y1: a.y0 + p.h }; };
  const CLEAN = 8; // below the cost of sitting on a marker, a label or the staircase
  let remaining = sequence;
  if (opts.joint && items.length > 1 && items.length <= 6) {
    const nA = Math.min(order.length, 6);
    const cands = items.map((p) => order.slice(0, nA).map((name) => nearBox(p, name)));
    // the anchor's own cost (bounds, markers, obstacles; `placed` is empty
    // here) plus a nudge toward the earlier anchors in `order`
    const own = cands.map((cs, i) => cs.map((bx, a) => score(bx, i) + a * 0.5));
    const idx = new Array(items.length).fill(0);
    let best = null;
    const total = nA ** items.length;
    for (let c = 0; c < total; c++) {
      let s = 0;
      let rem = c;
      for (let i = 0; i < items.length; i++) { idx[i] = rem % nA; rem = Math.floor(rem / nA); s += own[i][idx[i]]; }
      if (best && s >= best.s) continue;
      for (let i = 0; i < items.length && (!best || s < best.s); i++) {
        for (let j = i + 1; j < items.length; j++) if (intersects(cands[i][idx[i]], cands[j][idx[j]], 2)) s += 20;
      }
      if (!best || s < best.s) best = { s, idx: idx.slice() };
    }
    // seat every label the joint solution places cleanly; the rest queue for
    // the pushed-out search, which sees the seated ones as placed
    const seated = [];
    for (let i = 0; i < items.length; i++) {
      const bx = cands[i][best.idx[i]];
      let s = own[i][best.idx[i]] - best.idx[i] * 0.5;
      for (let j = 0; j < items.length; j++) if (j !== i && intersects(bx, cands[j][best.idx[j]], 2)) s += 20;
      if (s < CLEAN) {
        placed.push(bx);
        out[i] = { ...bx, cx: (bx.x0 + bx.x1) / 2, cy: (bx.y0 + bx.y1) / 2, leader: false, how: `joint:${order[best.idx[i]]}:${s.toFixed(1)}` };
        seated.push(i);
      }
    }
    remaining = sequence.filter((i) => !seated.includes(i));
  }
  for (const i of remaining) {
    const p = items[i];
    let best = null;
    for (const name of order) {
      const a = anchors[name](p);
      const bx = { x0: a.x0, y0: a.y0, x1: a.x0 + p.w, y1: a.y0 + p.h };
      const s = score(bx, i);
      if (!best || s < best.s) best = { s, bx, leader: false, how: `near:${name}` };
      if (s === 0) break;
    }
    if (best.s > 0) {
      const dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
      for (let k = 1; k <= reach && best.s > 0; k++) {
        const r = off(p) + 14 * k;
        for (const [ux, uy] of dirs) {
          const cx = p.px + ux * (r + (p.w / 2) * Math.abs(ux));
          const cy = p.py + uy * (r * 0.8 + (p.h / 2) * Math.abs(uy));
          const bx = { x0: cx - p.w / 2, x1: cx + p.w / 2, y0: cy - p.h / 2, y1: cy + p.h / 2 };
          const s = score(bx, i) + leaderPenalty(p, i, bx) + k + biasPenalty(ux, uy); // nearer is better
          if (s < best.s) best = { s, bx, leader: true, how: `pushed:${ux},${uy}:k${k}` };
        }
      }
    }
    placed.push(best.bx);
    if (best.leader) {
      const e = edgePoint(best.bx, p.px, p.py);
      leaders.push({ x1: p.px, y1: p.py, x2: e.x, y2: e.y });
    }
    out[i] = { ...best.bx, cx: (best.bx.x0 + best.bx.x1) / 2, cy: (best.bx.y0 + best.bx.y1) / 2, leader: best.leader, how: `${best.how}:${best.s.toFixed(1)}` };
  }
  return out;
}

// Point where the segment (px, py) → box centre crosses the box edge. Plotly
// clips an annotation arrow there, so SVG leaders drawn to it coincide.
export function edgePoint(box, px, py) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const dx = px - cx;
  const dy = py - cy;
  let t = 1;
  if (dx) t = Math.min(t, ((dx > 0 ? box.x1 : box.x0) - cx) / dx);
  if (dy) t = Math.min(t, ((dy > 0 ? box.y1 : box.y0) - cy) / dy);
  return { x: cx + dx * t, y: cy + dy * t };
}

// How the two lines sit inside their box: ragged toward the point, so a
// label left of its point ends beside it and one right of it starts beside it.
export function labelAlign(box, px) {
  if (box.x1 <= px + 2) return 'right';
  if (box.x0 >= px - 2) return 'left';
  return 'center';
}
// the SVG x and text-anchor for that alignment
export function labelTextAnchor(box, px) {
  const align = labelAlign(box, px);
  if (align === 'right') return { x: box.x1 - LABEL.pad, anchor: 'end' };
  if (align === 'center') return { x: (box.x0 + box.x1) / 2, anchor: 'middle' };
  return { x: box.x0 + LABEL.pad, anchor: 'start' };
}

// Plotly annotation for a two-line label in `box` (pixel space) attached to
// the data point (x, y) whose pixel position is (px, py).
export function labelAnnotation({ x, y, px, py, model, harness, box, colors }) {
  const text = `<b>${escapeHTML(model)}</b><br><span style="font-size:11px;color:${colors.ink2}">${escapeHTML(harness)}</span>`;
  const base = { x, y, text, align: labelAlign(box, px), font: { color: colors.ink, size: 12, family: FONT }, captureevents: false };
  if (box.leader) {
    return {
      ...base, showarrow: true, ax: box.cx - px, ay: box.cy - py,
      arrowhead: 0, arrowwidth: 1, arrowcolor: colors.muted, standoff: 7,
      xanchor: 'center', yanchor: 'middle',
    };
  }
  return {
    ...base, showarrow: false, xanchor: 'left', yanchor: 'top',
    xshift: box.x0 + LABEL.pad - px - 1, yshift: py - box.y0 - LABEL.pad + 2,
  };
}
