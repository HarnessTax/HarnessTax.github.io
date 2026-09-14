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

// Do the segments a and b ({ x1, y1, x2, y2 }) cross each other (properly,
// at an interior point of both)? Two leaders must not.
export function segmentsCross(a, b) {
  const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// The placer's prices. Words are the one thing a label may never cover, so a
// label on another label, a leader through a label or two leaders crossing
// cost WORDS; a leader itself costs LEADER plus a step per ring travelled, so
// a label sits beside its marker over a curve, a staircase or a dimmed badge
// rather than take a leader, and takes a leader only where every seat beside
// the marker would block words or pile up several such things. Callers price
// their own obstacles on the same scale: tick text and captions at WORDS, a
// highlighted badge about 12, a staircase about 10, a highlighted curve about
// 6, a dimmed badge 4 to 6, a faint curve about 2, a whisker about 4.
export const COST = { words: 40, bounds: 100, leader: 16, ring: 1.5, anchor: 0.5, slide: 0.6, spare: 2 };
const RING = 14; // px a pushed-out label travels per ring
const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// items: [{ px, py, w, h, r? }] in pixel space (r = marker radius, default 7);
// geo: { W, H, l, b } plot bounds.
// opts.order: near-position preference (a NEAR_ORDER entry; the other
// anchors follow it at a small extra price);
// opts.sequence: 'given' (settle in item order) or 'x-desc' (rightmost first);
// opts.obstacles: [{ x0, y0, x1, y1, weight, group? }] extra boxes to avoid
// (boxes sharing a `group`, the segments of one curve, charge a label once);
// opts.markers: extra marker boxes ({ ..., weight }) besides the labelled ones;
// opts.gap: px between the marker's edge and the label (default 2);
// opts.bias: { right, down } surcharges on a pushed-out seat in those
// directions, or 'top-left' for { right: 6, down: 12 } (a frontier label stays
// above or left of its point, where it is expected; endpoint labels take less);
// opts.reach: rings a pushed-out label may travel (default 8).
// Returns one { x0, y0, x1, y1, cx, cy, leader } per item.
//
// Every label gets a candidate seat list: the eight anchors beside its marker,
// the four cardinal ones also slid a third of the label along the marker or a
// third of its height away from it (so two labels stacked marker over marker
// need no leader), and pushed-out seats on rings around it, each tied back
// with a leader. A seat's
// own price is what it covers (bounds, markers, obstacles) plus the leader's
// price and what the leader runs over; pairs of labels price each other for
// covering, leaders through the other's words and crossing leaders. The
// assignment is settled by coordinate descent from each label's cheapest own
// seat, then any pair still in conflict is re-seated jointly over both lists.
// The search is deterministic, so the SVG story and the plotly figure, which
// place the same items, agree.
export function placeLabels(items, geo, opts = {}) {
  const gap = opts.gap == null ? 2 : opts.gap;
  const reach = opts.reach == null ? 8 : opts.reach;
  // clearance from the marker's centre: its radius plus the gap, so a label
  // keeps the same visual distance from a marker of any size
  const off = (p) => (p.r || 7) + gap;
  const order = (opts.order || NEAR_ORDER.endpoint).slice();
  for (const name of Object.keys(ANCHORS)) if (!order.includes(name)) order.push(name);
  const spare = (opts.order || NEAR_ORDER.endpoint).length; // anchors past the caller's list cost a little more
  // a pushed-out label goes up or left when it can: below costs most, right less
  const bias = opts.bias === 'top-left' ? { right: 6, down: 12 } : { right: 0, down: 0, ...(opts.bias || {}) };
  const biasPenalty = (ux, uy) => (ux > 0 ? bias.right : 0) + (uy > 0 ? bias.down : 0);
  const own = items.map((p) => { const r = p.r || 7; return { x0: p.px - r, x1: p.px + r, y0: p.py - r, y1: p.py + r, weight: 12 }; });
  const markers = own.concat(opts.markers || []);
  const obstacles = opts.obstacles || [];
  const n = items.length;
  const outOfBounds = (bx) => bx.x0 < geo.l - 2 || bx.x1 > geo.W - 2 || bx.y0 < 0 || bx.y1 > geo.H - geo.b + 2;

  const cands = items.map((p, i) => {
    // only the markers and obstacles within this label's furthest seat matter
    const span = off(p) + RING * reach + Math.max(p.w, p.h) + 4;
    const env = { x0: p.px - span, x1: p.px + span, y0: p.py - span, y1: p.py + span };
    const near = (list) => list.map((q, j) => [q, j]).filter(([q]) => intersects(env, q, 2));
    const ms = near(markers).filter(([, j]) => j !== i);
    const obs = near(obstacles);
    const list = [];
    const add = (x0, y0, leader, how, price) => {
      const box = { x0, y0, x1: x0 + p.w, y1: y0 + p.h };
      let s = price;
      if (outOfBounds(box)) s += COST.bounds;
      for (const [m] of ms) if (intersects(box, m, 1)) s += m.weight;
      const charged = new Set();
      for (const [q] of obs) {
        if (!intersects(box, q, 2)) continue;
        if (q.group != null) { if (charged.has(q.group)) continue; charged.add(q.group); }
        s += q.weight;
      }
      let seg = null;
      if (leader) {
        const e = edgePoint(box, p.px, p.py);
        seg = { x1: p.px, y1: p.py, x2: e.x, y2: e.y };
        for (const [m] of ms) if (segmentHitsBox(seg.x1, seg.y1, seg.x2, seg.y2, m, 0)) s += m.weight;
        // a leader keeps off word obstacles (tick text, captions) like a label does
        for (const [q] of obs) if (q.weight >= COST.words && segmentHitsBox(seg.x1, seg.y1, seg.x2, seg.y2, q, 1)) s += q.weight;
      }
      list.push({ box, s, leader, seg, how });
    };
    order.forEach((name, a) => {
      const base = ANCHORS[name](p, off(p));
      const price = a * COST.anchor + (a >= spare ? COST.spare : 0);
      add(base.x0, base.y0, false, `near:${name}`, price);
      for (const [dx, dy] of SLIDES[name] || []) {
        add(base.x0 + dx * (p.w / 3), base.y0 + dy * (p.h / 3), false, `near:${name}${dx > 0 || dy > 0 ? '+' : '-'}`, price + COST.slide);
      }
      const away = AWAY[name];
      if (away) add(base.x0 + away[0] * (p.h / 3), base.y0 + away[1] * (p.h / 3), false, `near:${name}>`, price + COST.slide);
    });
    for (let k = 1; k <= reach; k++) {
      const r = off(p) + RING * k;
      for (const [ux, uy] of DIRS) {
        const cx = p.px + ux * (r + (p.w / 2) * Math.abs(ux));
        const cy = p.py + uy * (r * 0.8 + (p.h / 2) * Math.abs(uy));
        add(cx - p.w / 2, cy - p.h / 2, true, `pushed:${ux},${uy}:k${k}`, COST.leader + COST.ring * k + biasPenalty(ux, uy));
      }
    }
    return list;
  });

  // what two seated labels cost each other
  const pair = (a, b) => {
    let s = 0;
    if (intersects(a.box, b.box, 2)) s += COST.words;
    if (a.seg && segmentHitsBox(a.seg.x1, a.seg.y1, a.seg.x2, a.seg.y2, b.box, 1)) s += COST.words;
    if (b.seg && segmentHitsBox(b.seg.x1, b.seg.y1, b.seg.x2, b.seg.y2, a.box, 1)) s += COST.words;
    if (a.seg && b.seg && segmentsCross(a.seg, b.seg)) s += COST.words;
    return s;
  };

  const sequence = items.map((_, i) => i);
  if (opts.sequence === 'x-desc') sequence.sort((a, b) => items[b].px - items[a].px);
  const choice = cands.map((list) => list.reduce((best, c, k) => (c.s < list[best].s ? k : best), 0));
  const seated = (i) => cands[i][choice[i]];
  const priceOf = (i, c) => {
    let s = c.s;
    for (let j = 0; j < n; j++) if (j !== i) s += pair(c, seated(j));
    return s;
  };
  const sweep = () => {
    let changed = false;
    for (const i of sequence) {
      let best = choice[i];
      let bestS = priceOf(i, seated(i));
      cands[i].forEach((c, k) => { const s = priceOf(i, c); if (s < bestS - 1e-9) { bestS = s; best = k; } });
      if (best !== choice[i]) { choice[i] = best; changed = true; }
    }
    return changed;
  };
  for (let round = 0; round < 8 && sweep(); round++);
  // Pairs are then re-seated together: every seat of one against every seat
  // of the other, the rest of the labels held where they are. In a small set
  // every pair gets this (two labels that both want the same spot settle
  // with one stepping down to a poor seat, when a half-step by each would
  // seat both well); in a large set only pairs still in conflict do.
  const jointPass = n <= 8;
  let moved = true;
  for (let round = 0; round < 3 && moved; round++) {
    moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = seated(i);
        const b = seated(j);
        if (!jointPass && pair(a, b) === 0) continue;
        const others = sequence.filter((k) => k !== i && k !== j).map(seated);
        const rest = (c) => others.reduce((s, o) => s + pair(c, o), 0);
        const costI = cands[i].map((c) => c.s + rest(c));
        const costJ = cands[j].map((c) => c.s + rest(c));
        let best = { s: costI[choice[i]] + costJ[choice[j]] + pair(a, b), ci: choice[i], cj: choice[j] };
        cands[i].forEach((ci, x) => {
          if (costI[x] >= best.s) return;
          cands[j].forEach((cj, y) => {
            const s = costI[x] + costJ[y] + pair(ci, cj);
            if (s < best.s - 1e-9) best = { s, ci: x, cj: y };
          });
        });
        if (best.ci !== choice[i] || best.cj !== choice[j]) { choice[i] = best.ci; choice[j] = best.cj; sweep(); moved = true; }
      }
    }
  }
  return items.map((p, i) => {
    const c = seated(i);
    return { ...c.box, cx: (c.box.x0 + c.box.x1) / 2, cy: (c.box.y0 + c.box.y1) / 2, leader: c.leader, how: `${c.how}:${priceOf(i, c).toFixed(1)}` };
  });
}

// the eight seats beside a marker, given the label's size and the clearance
// `d` from the marker's centre
const ANCHORS = {
  'above-left': (p, d) => ({ x0: p.px - d - p.w, y0: p.py - d - p.h }),
  'above-right': (p, d) => ({ x0: p.px + d, y0: p.py - d - p.h }),
  'below-right': (p, d) => ({ x0: p.px + d, y0: p.py + d }),
  'below-left': (p, d) => ({ x0: p.px - d - p.w, y0: p.py + d }),
  'above-center': (p, d) => ({ x0: p.px - p.w / 2, y0: p.py - d - p.h }),
  'below-center': (p, d) => ({ x0: p.px - p.w / 2, y0: p.py + d }),
  'middle-right': (p, d) => ({ x0: p.px + d, y0: p.py - p.h / 2 }),
  'middle-left': (p, d) => ({ x0: p.px - d - p.w, y0: p.py - p.h / 2 }),
};
// the cardinal seats also slide a third of the label along the marker's edge
const SLIDES = {
  'above-center': [[-1, 0], [1, 0]],
  'below-center': [[-1, 0], [1, 0]],
  'middle-left': [[0, -1], [0, 1]],
  'middle-right': [[0, -1], [0, 1]],
};
// and a third of the label's height further from the marker
const AWAY = {
  'above-center': [0, -1],
  'below-center': [0, 1],
  'middle-left': [-1, 0],
  'middle-right': [1, 0],
};

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
