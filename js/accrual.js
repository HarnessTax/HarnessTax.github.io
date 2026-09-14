// Cost-scaling card: smoothed resource-ranked accrual curves.
//
// One plotly figure with a toolbar (model/harness pills, Cost/Tokens/Steps,
// Replay) and, under the figure, a stats strip that appears for a selection.
// When the card first scrolls into view an SVG
// overlay plays the scaling story over the empty axes: every curve grows at
// the same spend with its endpoint badge riding the tip, the systems that led
// the frontier at some spend in full color and the rest faint, until the most
// expensive drawn curve has reached its end; the overlay then dissolves into
// the resting figure, which is the story's final frame. Endpoint markers are
// round badges in the model's colour carrying the harness logo (icons.js),
// drawn as layout.images over invisible plotly hover markers. Pills highlight
// a subset; selecting a model with two or more systems shades the gap between
// their curves and fills the strip with exact statistics. A click or tap on an
// endpoint badge selects that one system (its model and harness), a second
// click on it or a click on empty plot area clears the selection. Wheel, shift-drag
// and pinch zoom the figure, drag pans it and a double-click restores the
// designed view. Once the story has ended on its own the card tours the
// models: after a pause each model is highlighted in turn, its pill filling
// left to right as its time runs down, then the overview of all systems, and
// round again, until the reader clicks or touches the figure or a control.
// Every number arrives
// precomputed in spec.accrual (dashboard/charts.py::_cumulative_accrual_spec);
// this file only draws.
import { h, s, shape, createPills } from './pills.js';
import { LABEL, NEAR_ORDER, COST, textWidth, labelSize, placeLabels, labelAnnotation, labelTextAnchor, edgePoint, intersects } from './labels.js';
import { badge, badgeImage, rgba, imageSpec, sizeImages, bindZoomSync } from './icons.js';
import { ZOOM_HINT } from './frontier.js';
import { attachViewport } from './viewport.js';

const DIM_ACTIVE = 0.12; // alpha for systems outside an explicit selection
const END_R = 9;         // endpoint badge radius (px)
const TAP_R = END_R + 4; // a tap this close to a badge's centre selects it
// endpoint labels sit above or left of their badge, the side the curve does
// not continue to (a curve arrives from below-left and ends at the badge);
// the figure keeps room for a label above a point at 100%
const LABEL_GAP = 3;
const LABEL_ORDER = ['above-center', 'above-left', 'middle-left', 'above-right', 'below-left', 'below-center'];
const MERGE_D = 2 * END_R + 6; // badges of one model this close share one label
const TOP_ROOM = END_R + LABEL_GAP + LABEL.height + 4;
const plotHeight = (layout) => layout.height + Math.max(0, TOP_ROOM - layout.margin.t);
// opening story: fixed length, spend eased so the crowded cheap end gets time
const STORY_MS = 6000;
const STORY_EASE = 1.7;
const STORY_HOLD = 700;  // ms the final frame holds before the dissolve
const TIP_FADE = 0.08;   // share of the story over which the tips fade in
// model tour after the story: the pause before it starts and the time each
// stop is on show (a model, its pill's fill counting the time down, or the
// overview of all systems that closes each round)
const TOUR_DELAY = 3000;
const TOUR_STEP = 5000;
const TOUR_MAX_DT = 100; // ms a frame may add: a tab hidden for a while resumes, not skips
let clipSeq = 0;
const SMALL_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
// hover wording per ranking resource: `subset` names the k rollouts counted so
// far (plotly template refs for k and N), `peak` names the k-th rollout itself,
// which is the largest one included at that point
const FORMAT = {
  cost: {
    hover: (ref) => `$%{${ref}:.3f}`, text: (v) => `$${v.toFixed(3)}`,
    subset: (k, n) => `cheapest ${k} of ${n} rollouts`, peak: 'costliest rollout so far',
  },
  gross_tokens: {
    hover: (ref) => `%{${ref}:.2f}M tokens`, text: (v) => `${v.toFixed(2)}M tokens`,
    subset: (k, n) => `${k} of ${n} rollouts with the fewest tokens`, peak: 'most tokens in one rollout so far',
  },
  steps: {
    hover: (ref) => `%{${ref}:.1f} steps`, text: (v) => `${v.toFixed(1)} steps`,
    subset: (k, n) => `${k} of ${n} rollouts with the fewest steps`, peak: 'most steps in one rollout so far',
  },
};
// success-rate differences are shown as percentage points written with %
const pct = (v, signed = false) => `${signed && v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ------------------------------------------------------------------ helpers

function matches(curve, sel) {
  return (!sel.model || curve.model === sel.model) && (!sel.harness || curve.harness === sel.harness);
}

function endOf(curve, metric) {
  const ex = curve.series[metric].exact;
  return { x: ex.x[ex.x.length - 1], y: ex.y[ex.y.length - 1] };
}

function linearAt(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

// Where a curve's endpoint marker and label sit. A system whose endpoint lies
// beyond the axis (charts.py leaves runaway outliers off the axis, see
// spec.accrual.metrics[].off_axis) is anchored where its drawn curve meets the
// right edge; `off` says so and `end` keeps the exact endpoint for the label.
function anchorOf(curve, metric, xmax) {
  const end = endOf(curve, metric);
  if (!(end.x > xmax)) return { x: end.x, y: end.y, off: false, end };
  const { smooth } = curve.series[metric];
  return { x: xmax, y: linearAt(smooth.x, smooth.y, xmax), off: true, end };
}

// second label line: the harness, plus the exact endpoint when the curve
// leaves the frame ("Claude Code → $14.206 · 91.1%")
function harnessText(curve, anchor, metric) {
  if (!anchor.off) return curve.harness_label;
  return `${curve.harness_label} → ${FORMAT[metric].text(anchor.end.x)} · ${pct(anchor.end.y)}`;
}

function metricInfo(state) {
  return state.spec.accrual.metrics.find((m) => m.key === state.metric);
}

function curvesFor(state) {
  return state.spec.accrual.curves.filter((c) => c.series[state.metric]);
}

function countMatches(state, sel) {
  return curvesFor(state).filter((c) => matches(c, sel)).length;
}

// Systems that led the frontier of the drawn curves at some spend (the
// opening trace passes through exactly these); falls back to the endpoint
// frontier when no trace exists for the view.
function leadersFor(state) {
  const trace = state.spec.accrual.trace && state.spec.accrual.trace[state.metric];
  if (trace && trace.leaders.length) return new Set(trace.leaders);
  return new Set(curvesFor(state).filter((c) => c.frontier).map((c) => c.id));
}

// One pixel geometry for the plotly figure and the SVG overlay: the layout's
// height and margins (automargin off), the metric's fixed x range, y 0–1.
function geometry(state) {
  const layout = state.ctx.resolve(state.spec.plotly.layout);
  const xaxis = state.ctx.resolve(metricInfo(state).xaxis);
  const xr = xaxis.range;
  const yr = layout.yaxis.range;
  const m = { ...layout.margin, t: Math.max(layout.margin.t, TOP_ROOM) };
  const W = state.plot.clientWidth;
  const H = plotHeight(layout);
  return {
    W, H, l: m.l, b: m.b, t: m.t, iw: W - m.l - m.r, ih: H - m.t - m.b, xr, yr, layout, xaxis, margin: m,
    x2p: (x) => m.l + ((x - xr[0]) / (xr[1] - xr[0])) * (W - m.l - m.r),
    y2p: (y) => m.t + (1 - (y - yr[0]) / (yr[1] - yr[0])) * (H - m.t - m.b),
  };
}

// ------------------------------------------------------------------- traces

function lineTrace(curve, metric, hi, alpha, ctx, window) {
  const { smooth, exact } = curve.series[metric];
  const F = FORMAT[metric];
  const customdata = smooth.x.map((_, i) => [exact.n[i], curve.n, exact.successes[i], exact.x[i], exact.y[i], exact.threshold[i]]);
  return {
    type: 'scatter', mode: 'lines', x: smooth.x, y: smooth.y,
    name: curve.label, showlegend: false, opacity: hi ? 1 : alpha,
    // a dotted curve marks a system whose cost-frontier status is unavailable
    line: { color: ctx.resolve(curve.color), width: hi ? 2.2 : 1.6, shape: 'linear', dash: curve.pareto === 'unavailable' ? 'dot' : 'solid' },
    customdata,
    meta: { id: curve.id, role: 'curve', model: curve.model, harness: curve.harness, frontier: curve.frontier, hi },
    // e.g. "cheapest 80 of 90 rollouts / 76 of 90 solved (84.4%) · $0.286 per
    // rollout, averaged over all 90 / costliest rollout so far: $0.850"
    hovertemplate: `<b>${curve.label}</b>`
      + `<br>${F.subset('%{customdata[0]}', '%{customdata[1]}')}`
      + `<br>%{customdata[2]} of %{customdata[1]} solved (<b>%{customdata[4]:.1%}</b>)`
      + ` · <b>${F.hover('customdata[3]')}</b> per rollout, averaged over all %{customdata[1]}`
      + `<br>${F.peak}: ${F.hover('customdata[5]')}`
      + `<br><i>line smoothed over ${window} points; drawn here at ${F.hover('x')}, %{y:.1%}</i>`
      + '<extra></extra>',
  };
}

// `alpha` is the marker's own opacity: full for a highlighted system and, with
// nothing selected, for every system (an outlined badge already reads as
// dominated); faded only outside an explicit selection
function endpointTrace(curve, metric, hi, alpha, ctx, xmax) {
  const anchor = anchorOf(curve, metric, xmax);
  const end = anchor.end;
  const color = ctx.resolve(curve.color);
  const F = FORMAT[metric];
  const status = curve.pareto === 'frontier' || curve.frontier ? 'on the cost frontier'
    : curve.pareto === 'unavailable' ? 'cost-frontier status unavailable' : 'not on the cost frontier';
  const ex = curve.series[metric].exact;
  const solved = ex.successes[ex.successes.length - 1];
  // an off-axis system is marked where its curve leaves the frame, with an
  // arrowhead instead of its harness badge; every other endpoint is drawn by
  // its badge image (endpointImage), the marker here being its hover target
  const symbol = anchor.off ? 'triangle-right' : curve.symbol;
  return {
    type: 'scatter', mode: 'markers',
    x: [anchor.x], y: [anchor.y], name: curve.label, showlegend: false,
    opacity: hi ? 1 : alpha, cliponaxis: false,
    marker: {
      symbol: curve.frontier ? symbol : `${symbol}-open`,
      size: anchor.off ? 11 : 2 * END_R, color, opacity: anchor.off ? 1 : 0,
      line: { color: curve.frontier ? ctx.resolve('@surface') : color, width: 1.8 },
    },
    customdata: [[curve.n, end.x, end.y, status, solved]],
    meta: { id: curve.id, role: 'endpoint', model: curve.model, harness: curve.harness, frontier: curve.frontier, pareto: curve.pareto, hi, off_axis: anchor.off },
    // e.g. "all 90 rollouts / 86 of 90 solved (95.6%) · $0.422 per rollout /
    // on the cost frontier"; the experiment cohort is provenance, not shown
    hovertemplate: `<b>${curve.label}</b> · all %{customdata[0]} rollouts`
      + `<br>%{customdata[4]} of %{customdata[0]} solved (<b>%{customdata[2]:.1%}</b>)`
      + ` · <b>${F.hover('customdata[1]')}</b> per rollout`
      + '<br>%{customdata[3]}'
      + (anchor.off ? '<br><i>the curve continues past the right edge to this endpoint</i>' : '')
      + '<extra></extra>',
  };
}

// The endpoint badge image spec for a curve drawn to its endpoint: filled
// for a system on the cost frontier, outlined for a dominated one, faded like
// its curve; anchored in data coordinates so zooming moves it with its hover
// marker (icons.js sizes it for the axes shown).
function endpointImage(curve, anchor, opacity, ctx) {
  const { uri, size } = badgeImage(curve.harness, END_R, ctx.resolve(curve.color), {
    variant: curve.frontier ? 'filled' : 'open', surface: ctx.resolve('@surface'),
  });
  return imageSpec(uri, anchor.x, anchor.y, size, opacity);
}

// the designed view's axes
const axesOf = (geo) => ({ x0: geo.xr[0], x1: geo.xr[1], y0: geo.yr[0], y1: geo.yr[1], iw: geo.iw, ih: geo.ih });

// The off-axis arrowhead as SVG, matching the plotly marker the resting
// figure draws where a curve leaves the frame; in the story the curve's badge
// rides the tip and turns into this arrowhead on reaching the edge.
function arrowTip(curve, color, surface, parent) {
  return shape('triangle-right', 6, curve.frontier
    ? { fill: color, stroke: surface, 'stroke-width': 1.8 }
    : { fill: surface, stroke: color, 'stroke-width': 1.8 }, parent);
}

// The drawn curves as pixel boxes a label keeps clear of: a highlighted curve
// costs a label about what a leader would, a faint one little, so a label
// sits on faint curves rather than take a leader and on a highlighted one
// only when the leader would be long. Long segments are split so the boxes
// hug the line.
function curveObstacles(state, geo, hi) {
  const out = [];
  const xmax = geo.xr[1];
  for (const c of curvesFor(state)) {
    const { smooth } = c.series[state.metric];
    const pts = clipCurve(smooth.x, smooth.y, xmax).map(([x, y]) => [geo.x2p(x), geo.y2p(y)]);
    const weight = hi.includes(c) ? 6 : 2;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n;
        const x1 = ax + ((bx - ax) * (k + 1)) / n;
        const y0 = ay + ((by - ay) * k) / n;
        const y1 = ay + ((by - ay) * (k + 1)) / n;
        out.push({ x0: Math.min(x0, x1) - 1, x1: Math.max(x0, x1) + 1, y0: Math.min(y0, y1) - 1, y1: Math.max(y0, y1) + 1, weight, group: c.id });
      }
    }
  }
  return out;
}

// The endpoint labels of the resting figure with nothing selected (and of
// the story, which ends on that frame): the highlighted systems plus every
// faint system whose curve leaves the frame, placed by the shared placer.
// Labels hug their badge (LABEL_GAP) above or to its left, keep clear of every
// curve and every other badge, and a small set is placed jointly so one label
// does not crowd the next into a leader line.
// Two labelled systems of one model whose badges (nearly) coincide share one
// label naming both harnesses ("GPT-5.6 Luna" over "Pi · Codex"), anchored at
// the upper badge: two labels could not both hug that spot, and the badges'
// own harness logos tell them apart.
function labelPlan(state, geo, hi, offAxis, obstacles = []) {
  const metric = state.metric;
  const xmax = geo.xr[1];
  const labelled = [...hi, ...offAxis];
  const anchored = labelled.map((c) => ({ curve: c, anchor: anchorOf(c, metric, xmax) }));
  const groups = [];
  for (const a of anchored) {
    const g = !a.anchor.off && groups.find((gr) => !gr.anchor.off && gr.curve.model === a.curve.model
      && Math.hypot(geo.x2p(gr.anchor.x) - geo.x2p(a.anchor.x), geo.y2p(gr.anchor.y) - geo.y2p(a.anchor.y)) <= MERGE_D);
    if (g) {
      g.members.push(a);
      if (a.anchor.y > g.anchor.y) { g.anchor = a.anchor; g.curve = a.curve; }
    } else groups.push({ curve: a.curve, anchor: a.anchor, members: [a] });
  }
  const harnessRank = (c) => state.spec.accrual.harnesses.findIndex((hz) => hz.key === c.harness);
  const items = groups.map((g) => {
    const curves = g.members.map((m) => m.curve).sort((a, b) => harnessRank(a) - harnessRank(b));
    const harness = curves.length > 1 ? curves.map((c) => c.harness_label).join(' · ') : harnessText(g.curve, g.anchor, metric);
    return { x: g.anchor.x, y: g.anchor.y, harness, r: END_R, ...labelSize(g.curve.model_label, harness), px: geo.x2p(g.anchor.x), py: geo.y2p(g.anchor.y), curve: g.curve, curves, anchor: g.anchor };
  });
  // every other badge in the frame is an obstacle a label must not sit on,
  // the partner badges of a shared label included
  const badgeBox = (a, weight) => {
    const px = geo.x2p(a.x);
    const py = geo.y2p(a.y);
    const r = END_R + 1;
    return { x0: px - r, x1: px + r, y0: py - r, y1: py + r, weight };
  };
  const markers = curvesFor(state).filter((c) => !labelled.includes(c)).map((c) => badgeBox(anchorOf(c, metric, xmax), 6));
  for (const g of groups) for (const m of g.members) if (m.anchor !== g.anchor) markers.push(badgeBox(m.anchor, 12));
  const boxes = placeLabels(items, geo, {
    order: LABEL_ORDER, sequence: 'given', gap: LABEL_GAP, bias: { right: 3, down: 6 },
    obstacles: curveObstacles(state, geo, hi).concat(obstacles), markers,
    reach: geo.W < 900 ? 16 : 8, // a reading-column figure: reach the top margin rather than overlap
  });
  return { items, boxes };
}

// The curve whose endpoint badge (or edge arrowhead) lies under a tap, under
// the axes currently shown, or null.
function curveAt(state, pt) {
  const { plot } = state;
  const fl = plot._fullLayout;
  if (!fl || !fl.xaxis || !fl.yaxis || !fl._size) return null;
  const rect = plot.getBoundingClientRect();
  const x = pt.clientX - rect.left;
  const y = pt.clientY - rect.top;
  const xr = fl.xaxis.range;
  const yr = fl.yaxis.range;
  const sz = fl._size;
  const xmax = geometry(state).xr[1];
  let hit = null;
  for (const c of curvesFor(state)) {
    const a = anchorOf(c, state.metric, xmax);
    const px = sz.l + ((a.x - xr[0]) / (xr[1] - xr[0])) * sz.w;
    const py = sz.t + ((yr[1] - a.y) / (yr[1] - yr[0])) * sz.h;
    const d = Math.hypot(px - x, py - y);
    if (d <= TAP_R && (!hit || d < hit.d)) hit = { c, d };
  }
  return hit ? hit.c : null;
}

function bandTraces(band, color) {
  const base = { type: 'scatter', mode: 'lines', x: band.x, showlegend: false, hoverinfo: 'skip', line: { width: 0 } };
  return [
    { ...base, y: band.lower, meta: { role: 'band-lower' } },
    { ...base, y: band.upper, fill: 'tonexty', fillcolor: rgba(color, 0.14), meta: { role: 'band' } },
  ];
}

// the far endpoint of a band whose system leaves the frame is drawn at the edge
function connectorTrace(band, muted, xmax) {
  const { a, b } = band;
  const bx = Math.min(b.x_end, xmax);
  return {
    type: 'scatter', mode: 'lines', showlegend: false, hoverinfo: 'skip',
    x: [a.x_end, bx, bx], y: [a.y_end, a.y_end, b.y_end],
    line: { color: muted, width: 1.2, dash: 'dot' }, meta: { role: 'connector' },
  };
}

// The dotted L between the two furthest endpoints, its captions and the
// pixel boxes they occupy (so endpoint labels keep clear of them).
// `markers` are the highlighted endpoint markers (pixel boxes). The spend
// caption rides the horizontal leg when the leg is long enough to carry it,
// on the side away from the vertical leg (or the side without a badge); a
// shorter leg hands it to the rate caption beside the vertical leg, which
// then reads "+$0.118 / rollout · +2.3%". Captions stay inside the plot.
function connector(band, metric, muted, geo, xrange, markers = []) {
  const F = FORMAT[metric];
  const { a, b } = band;
  const annotations = [];
  const boxes = [];
  const xmax = geo.xr[1];
  const clipped = b.x_end > xmax;
  const bxData = Math.min(b.x_end, xmax);
  const ax = geo.x2p(a.x_end);
  const bx = geo.x2p(bxData);
  const ay = geo.y2p(a.y_end);
  const by = geo.y2p(b.y_end);
  const left = geo.l + 2;
  const right = geo.W - 2;
  boxes.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: ay - 3, y1: ay + 3, weight: 10, group: 'link' });
  boxes.push({ x0: bx - 3, x1: bx + 3, y0: Math.min(ay, by), y1: Math.max(ay, by), weight: 10, group: 'link' });
  const spend = band.dx_end > 0.02 * xrange ? `+${F.text(band.dx_end)} / rollout${clipped ? ' →' : ''}` : null;
  const rate = Math.abs(band.dy_end) > 0.0005 ? pct(band.dy_end, true) : null;
  const spendW = spend ? textWidth(spend, SMALL_FONT) : 0;
  const along = Boolean(spend) && Math.abs(bx - ax) >= spendW + 8;
  if (along) {
    const mid = (ax + bx) / 2;
    const cx = Math.min(Math.max(mid, left + spendW / 2), right - spendW / 2);
    const below = { x0: cx - spendW / 2, x1: cx + spendW / 2, y0: ay + 6, y1: ay + 20, weight: COST.words };
    const above = { x0: cx - spendW / 2, x1: cx + spendW / 2, y0: ay - 20, y1: ay - 6, weight: COST.words };
    const hits = (box) => markers.some((m) => intersects(box, m, 1));
    let flip = by > ay; // the vertical leg (and the rate caption) hang below: caption above
    if (flip && hits(above) && !hits(below)) flip = false;
    if (!flip && hits(below) && !hits(above)) flip = true;
    annotations.push({
      x: (a.x_end + bxData) / 2, y: a.y_end, text: spend,
      showarrow: false, xanchor: 'center', yanchor: flip ? 'bottom' : 'top', xshift: cx - mid, yshift: flip ? 6 : -6,
      font: { color: muted, size: 11 },
    });
    boxes.push(flip ? above : below);
  }
  const side = [along ? null : spend, rate].filter(Boolean).join(' · ');
  if (side) {
    const w = textWidth(side, SMALL_FONT);
    // beside the vertical leg, on the side with room (at the frame edge, the left)
    const roomRight = right - (bx + 8);
    const roomLeft = (bx - 8) - left;
    const onLeft = clipped || (w > roomRight && roomLeft > roomRight);
    const cy = (ay + by) / 2;
    annotations.push({
      x: bxData, y: (a.y_end + b.y_end) / 2, text: side,
      showarrow: false, xanchor: onLeft ? 'right' : 'left', yanchor: 'middle', xshift: onLeft ? -8 : 8,
      font: { color: muted, size: 11 },
    });
    boxes.push(onLeft
      ? { x0: bx - 8 - w, x1: bx - 8, y0: cy - 7, y1: cy + 7, weight: COST.words }
      : { x0: bx + 8, x1: bx + 8 + w, y0: cy - 7, y1: cy + 7, weight: COST.words });
  }
  return { annotations, boxes };
}

// ----------------------------------------------------------------- toolbar

function syncStatus(state) {
  const curves = curvesFor(state);
  const total = curves.length;
  const { sel } = state;
  const active = Boolean(sel.model || sel.harness);
  const touring = state.tour ? ' · touring the models, click anywhere to stop' : '';
  state.pills.status.textContent = active
    ? `${countMatches(state, sel)} of ${total} systems highlighted${touring}`
    : state.tour ? `all ${total} systems, the frontier's leaders in full color${touring}`
      : `pick a model or harness, or click a badge · ${ZOOM_HINT}`;
}

// -------------------------------------------------------------------- figure

async function render(state) {
  const { spec, ctx, plot } = state;
  await ctx.loadPlotly();
  if (!state.armed) return;
  if (!plot.clientWidth) { state.dirty = true; return; } // hidden (other bench tab); repainted on reveal
  const acc = spec.accrual;
  const metric = state.metric;
  const info = metricInfo(state);
  const story = state.phase !== 'interactive';
  const sel = story ? { model: null, harness: null } : state.sel;
  const active = Boolean(sel.model || sel.harness);
  const curves = curvesFor(state);
  const leaders = leadersFor(state);
  const hi = curves.filter((c) => (active ? matches(c, sel) : leaders.has(c.id)));
  const dim = curves.filter((c) => !hi.includes(c));
  const alpha = active ? DIM_ACTIVE : acc.dim_alpha;
  const band = active && sel.model
    ? (acc.bands || []).find((bd) => bd.metric === metric && bd.model === sel.model
      && (bd.harness || null) === (sel.harness || null)) || null
    : null;

  const geo = geometry(state);
  const xmax = geo.xr[1];
  const muted = ctx.resolve('@muted');
  const colors = { ink: ctx.resolve('@ink'), ink2: ctx.resolve('@ink2'), muted };
  // a curve that leaves the frame is always labelled at the edge with its
  // exact endpoint (faint when it is not highlighted), so the axis clip can
  // never read as a small endpoint
  const offAxis = dim.filter((c) => anchorOf(c, metric, xmax).off);
  const markerBoxes = hi.map((c) => {
    const anchor = anchorOf(c, metric, xmax);
    const px = geo.x2p(anchor.x);
    const py = geo.y2p(anchor.y);
    const k = END_R + 2;
    return { x0: px - k, x1: px + k, y0: py - k, y1: py + k };
  });
  const link = band ? connector(band, metric, muted, geo, geo.xr[1] - geo.xr[0], markerBoxes) : null;
  const { items, boxes } = labelPlan(state, geo, hi, offAxis, link ? link.boxes : []);
  const faint = { ink: muted, ink2: muted, muted };
  const labels = items.map((it, i) => labelAnnotation({
    x: it.x, y: it.y, px: it.px, py: it.py, model: it.curve.model_label,
    harness: it.harness, box: boxes[i], colors: hi.includes(it.curve) ? colors : faint,
  }));

  const data = [];
  const specs = [];
  const annotations = [];
  if (!story) {
    // the story overlay owns the curves while it plays: the figure under it
    // shows the axes alone, so no curve is ever seen ahead of its spend
    if (band) {
      const model = acc.models.find((md) => md.key === band.model);
      data.push(...bandTraces(band, ctx.resolve(model ? model.color : '@muted')));
    }
    // curves fade when they are not highlighted; their endpoint badges fade
    // only outside an explicit selection (an outlined badge already reads as
    // dominated, and its model colour should read true)
    const badgeAlpha = active ? alpha : 1;
    for (const c of dim) data.push(lineTrace(c, metric, false, alpha, ctx, acc.window));
    for (const c of hi) data.push(lineTrace(c, metric, true, 1, ctx, acc.window));
    for (const c of dim) data.push(endpointTrace(c, metric, false, badgeAlpha, ctx, xmax));
    for (const c of hi) data.push(endpointTrace(c, metric, true, 1, ctx, xmax));
    for (const c of [...dim, ...hi]) {
      const anchor = anchorOf(c, metric, xmax);
      if (!anchor.off) specs.push(endpointImage(c, anchor, hi.includes(c) ? 1 : badgeAlpha, ctx));
    }
    annotations.push(...labels);
  }
  if (info.annotation) annotations.push(ctx.resolve(info.annotation));
  if (band && !story) {
    data.push(connectorTrace(band, muted, xmax));
    annotations.push(...link.annotations);
  }
  state.imageSpecs = specs;
  state.lastAxes = axesOf(geo);
  const fullLayout = {
    ...geo.layout,
    height: geo.H,
    margin: geo.margin, // room for a label above a point at 100%
    dragmode: false, // zoom and pan are the card's own bounded gestures (viewport.js)
    xaxis: { ...geo.xaxis, autorange: false, automargin: false },
    yaxis: { ...geo.layout.yaxis, autorange: false, automargin: false },
    annotations,
    images: sizeImages(specs, state.lastAxes),
  };
  // bounded gestures: wheel/pinch/shift-drag zoom, drag pans, double-click
  // resets; every step redraws curves, badges and labels together
  window.Plotly.react(plot, data, fullLayout, { displayModeBar: false, responsive: true, scrollZoom: false, doubleClick: false });
  state.viewBounds = { x0: geo.xr[0], x1: geo.xr[1], y0: geo.yr[0], y1: geo.yr[1] };
  bindZoomSync(state, plot, () => render(state));
  attachViewport(plot, {
    bounds: () => state.viewBounds, reset: () => render(state),
    onTap: (pt) => { if (state.onTap) state.onTap(pt); },
  });
  if (!state.hoverBound) {
    // the pointer over an endpoint badge says it can be clicked
    state.hoverBound = true;
    plot.addEventListener('pointermove', (e) => {
      const over = state.phase === 'interactive' && e.pointerType === 'mouse' && Boolean(curveAt(state, e));
      plot.classList.toggle('over-point', over);
    });
    plot.addEventListener('pointerleave', () => plot.classList.remove('over-point'));
  }
  state.plotted = true;
  state.dirty = false;
}

// ------------------------------------------------------------ opening story

// SVG overlay: every drawn curve grows at one shared spend. At story progress
// t (0..1) the overlay reveals each curve up to x(t) = X · t^STORY_EASE, X
// being the furthest any drawn curve reaches on the axis, so the story runs
// until the most expensive curve has ended and the ease gives the crowded
// cheap end more time. A badge rides each tip and stops at its endpoint,
// where its label pops. Every curve starts faint; a system lights up in full
// color the moment it takes the lead of the drawn frontier (the spend where
// its first stretch in spec.accrual.trace begins) and stays lit, so by the
// end exactly the systems that led at some spend are in full color and the
// final frame is the resting figure the overlay dissolves into. Geometry,
// colors, widths and label boxes are the resting figure's. Returns
// { seek(t) } or null when hidden.
function clipCurve(xs, ys, xmax) {
  const out = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] <= xmax) { out.push([xs[i], ys[i]]); continue; }
    if (i > 0 && xs[i - 1] < xmax) out.push([xmax, linearAt(xs, ys, xmax)]);
    break;
  }
  return out;
}

function buildStory(state) {
  const { host, spec, ctx } = state;
  const geo = geometry(state);
  const curves = curvesFor(state);
  if (!geo.W || !curves.length) return null;
  const metric = state.metric;
  const acc = spec.accrual;
  const leaders = leadersFor(state);
  const hi = curves.filter((c) => leaders.has(c.id));
  const dim = curves.filter((c) => !leaders.has(c.id));
  const alpha = acc.dim_alpha;
  const xmax = geo.xr[1];
  const surface = ctx.resolve('@surface');
  // the spend at which each leader first tops the drawn frontier (segments
  // are in spend order; a step segment names the finished leader too)
  const trace = acc.trace && acc.trace[metric];
  const leadAt = new Map();
  for (const seg of (trace && trace.segments) || []) {
    if (!leadAt.has(seg.id)) leadAt.set(seg.id, seg.x[0]);
  }

  host.replaceChildren();
  const svg = s('svg', { viewBox: `0 0 ${geo.W} ${geo.H}`, width: geo.W, height: geo.H, 'aria-hidden': 'true' }, host);
  const clipId = `acc-reveal-${++clipSeq}`;
  const reveal = s('rect', { x: 0, y: 0, width: 0, height: geo.H }, s('clipPath', { id: clipId }, s('defs', {}, svg)));
  const curveLayer = s('g', { class: 'acc-curves', 'clip-path': `url(#${clipId})` }, svg);
  const tipLayer = s('g', { class: 'acc-tips' }, svg);
  const labelLayer = s('g', { class: 'acc-labels' }, svg);

  // curves and tips: faint systems first so the leaders draw on top
  const drawn = [];
  let X = 0;
  for (const c of [...dim, ...hi]) {
    const isHi = hi.includes(c);
    const { smooth } = c.series[metric];
    const pts = clipCurve(smooth.x, smooth.y, xmax);
    if (pts.length < 2) continue;
    const color = ctx.resolve(c.color);
    const d = `M${pts.map(([x, y]) => `${geo.x2p(x).toFixed(1)},${geo.y2p(y).toFixed(1)}`).join(' L')}`;
    // faint until it leads (.lead lifts opacity and width, see main.css)
    const path = s('path', {
      class: 'acc-curve', d, stroke: color, 'stroke-width': 1.6, opacity: alpha,
      'stroke-dasharray': c.pareto === 'unavailable' ? '3 3' : null,
    }, curveLayer);
    const anchor = anchorOf(c, metric, xmax);
    X = Math.max(X, anchor.x);
    const g = s('g', { class: 'acc-tip', opacity: 0 }, tipLayer);
    if (isHi) s('circle', { class: 'fr-pulse', r: END_R + 2 }, g);
    const tipBadge = badge(c.harness, END_R, color, { variant: c.frontier ? 'filled' : 'open', surface }, g);
    // a curve that leaves the frame rides its badge to the edge, where the
    // badge becomes the arrowhead the resting figure shows there
    const tipArrow = anchor.off ? arrowTip(c, color, surface, g) : null;
    if (tipArrow) tipArrow.setAttribute('display', 'none');
    drawn.push({
      curve: c, hi: isHi, anchor, smooth, g, path, tipBadge, tipArrow, label: null, arrived: false,
      leadAt: isHi ? (leadAt.has(c.id) ? leadAt.get(c.id) : 0) : Infinity,
    });
  }
  if (!drawn.length || !(X > 0)) return null;

  // labels: the resting figure's boxes, revealed as each curve arrives
  const offAxis = dim.filter((c) => anchorOf(c, metric, xmax).off);
  const { items, boxes } = labelPlan(state, geo, hi, offAxis);
  items.forEach((it, i) => {
    const box = boxes[i];
    const lg = s('g', { class: `fr-label${hi.includes(it.curve) ? '' : ' faint'}` }, labelLayer);
    if (box.leader) {
      const e = edgePoint(box, it.px, it.py);
      const len = Math.hypot(e.x - it.px, e.y - it.py) || 1;
      const k = 7 / len;
      s('line', { class: 'fr-leader', x1: it.px + (e.x - it.px) * k, y1: it.py + (e.y - it.py) * k, x2: e.x, y2: e.y }, lg);
    }
    const ta = labelTextAnchor(box, it.px); // ragged toward the point, as the plotly annotation
    s('text', { class: 'fr-label-model', x: ta.x, y: box.y0 + LABEL.pad + LABEL.baseline1, 'text-anchor': ta.anchor }, lg).textContent = it.curve.model_label;
    s('text', { class: 'fr-label-harness', x: ta.x, y: box.y0 + LABEL.pad + LABEL.baseline1 + LABEL.lineGap, 'text-anchor': ta.anchor }, lg).textContent = it.harness;
    // a label shared by two systems lights when the later of them arrives
    const owners = drawn.filter((d) => (it.curves || [it.curve]).includes(d.curve));
    lg.dataset.need = String(owners.length);
    for (const d of owners) d.label = lg;
  });

  function seek(t) {
    const x = X * Math.min(1, Math.max(0, t)) ** STORY_EASE;
    reveal.setAttribute('width', Math.max(0, geo.x2p(x)).toFixed(1));
    const fade = Math.min(1, t / TIP_FADE);
    for (const d of drawn) {
      const xe = d.anchor.x;
      const done = x >= xe;
      const xc = done ? xe : x;
      const y = done ? d.anchor.y : linearAt(d.smooth.x, d.smooth.y, xc);
      const lit = x >= d.leadAt; // leading now, or has led: full color from here on
      d.path.classList.toggle('lead', lit);
      d.g.setAttribute('transform', `translate(${geo.x2p(xc).toFixed(1)} ${geo.y2p(y).toFixed(1)})`);
      // a leader's filled badge waits for its lead; an outlined badge is
      // always at full strength, as in the resting figure
      d.g.setAttribute('opacity', ((lit || !d.hi ? 1 : alpha) * fade).toFixed(3));
      if (d.tipArrow) {
        if (done) { d.tipBadge.setAttribute('display', 'none'); d.tipArrow.removeAttribute('display'); }
        else { d.tipArrow.setAttribute('display', 'none'); d.tipBadge.removeAttribute('display'); }
      }
      if (done && !d.arrived) {
        d.arrived = true;
        d.g.classList.add('arrived');
        if (d.label) {
          const need = Number(d.label.dataset.need || 1) - 1;
          d.label.dataset.need = String(need);
          if (need <= 0) d.label.classList.add('on');
        }
      }
    }
  }
  seek(state.progress || 0);
  return { seek };
}

// requestAnimationFrame loop driving the story from its start time; a story
// rebuilt meanwhile (resize, theme) continues from the same progress
function play(state) {
  const start = performance.now();
  const run = state.run;
  state.progress = 0;
  const step = (now) => {
    if (state.phase !== 'story' || run !== state.run) return;
    const t = Math.min(1, (now - start) / STORY_MS);
    state.progress = t;
    if (state.story) state.story.seek(t);
    if (t < 1) state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
}

// ---------------------------------------------------------------- mounting

export function mountAccrual(body, spec, ctx) {
  const acc = spec.accrual;
  const state = {
    spec, ctx, metric: acc.default_metric,
    sel: { model: null, harness: null },
    phase: 'idle', armed: false, plotted: false, dirty: false,
    timer: null, run: 0, story: null, progress: 0, raf: null,
    tour: null, tourTimer: null, tourVisible: true,
  };

  // toolbar, laid out like the Pareto card's: the model row ends with Replay,
  // the harness row with the status line and the resource switch
  const toolbar = h('div', 'fr-toolbar acc-toolbar', body);
  const pills = createPills({
    models: acc.models, harnesses: acc.harnesses, sel: state.sel,
    resolve: (token) => ctx.resolve(token),
    count: (sel) => countMatches(state, sel),
    onChange: () => {
      syncStatus(state);
      if (state.phase !== 'interactive') { autoplay.unobserve(host); finishStory(); } else render(state);
    },
  });
  state.pills = pills;
  toolbar.appendChild(pills.el);
  const replay = h('button', 'fr-replay', pills.rows.model || pills.el);
  replay.type = 'button';
  replay.setAttribute('aria-label', 'Replay the opening animation');
  const icon = s('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true' }, replay);
  s('path', { d: 'M8 1.5a6.5 6.5 0 1 0 5.5 10', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, icon);
  s('path', { d: 'M13.5 1.5v4h-4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, icon);
  replay.appendChild(document.createTextNode('Replay'));
  if (reduceMotion.matches) replay.hidden = true; // nothing to replay without motion
  const metricSeg = h('div', 'seg acc-metric', pills.rows.harness || pills.el); // after the status line
  metricSeg.setAttribute('role', 'group');
  metricSeg.setAttribute('aria-label', 'ranking resource');
  const metricButtons = {};
  for (const info of acc.metrics) {
    const b = h('button', null, metricSeg);
    b.type = 'button';
    b.textContent = info.label;
    b.disabled = !info.published;
    b.title = info.published ? `rank rollouts by ${info.resource}` : `no complete ${info.noun} telemetry on this benchmark`;
    b.setAttribute('aria-pressed', String(info.key === state.metric));
    b.addEventListener('click', () => setMetric(info.key));
    metricButtons[info.key] = b;
  }
  // stage: the figure in flow, the trace overlay absolutely on top
  const height = plotHeight(ctx.resolve(spec.plotly.layout));
  const stage = h('div', 'acc-stage', body);
  stage.style.minHeight = `${height}px`;
  const plot = h('div', 'plot', stage);
  plot.style.height = `${height}px`;
  const host = h('div', 'acc-host', stage);
  state.plot = plot;
  state.host = host;

  // `tour` is true only when the story ran to its end on its own: a story cut
  // short by a click hands the figure to the reader without touring
  async function finishStory(tour = false) {
    if (state.timer) clearTimeout(state.timer);
    if (state.raf) cancelAnimationFrame(state.raf);
    state.timer = null;
    state.raf = null;
    state.phase = 'interactive';
    if (state.story) state.story.seek(1); // the final frame, whatever the progress
    await render(state);
    if (state.phase !== 'interactive') return;
    stage.classList.add('done');
    if (tour) scheduleTour();
  }

  async function startStory() {
    stopTour();
    if (state.timer) clearTimeout(state.timer);
    if (state.raf) cancelAnimationFrame(state.raf);
    state.phase = 'story';
    stage.classList.remove('done');
    const run = ++state.run;
    state.progress = 0;
    await render(state); // the axes under the overlay: never play over an empty stage
    if (state.phase !== 'story' || run !== state.run) return; // skipped or restarted meanwhile
    state.story = buildStory(state);
    if (!state.story) { finishStory(); return; } // nothing to draw (or hidden): go straight to the figure
    if (reduceMotion.matches) { finishStory(); return; }
    play(state);
    state.timer = setTimeout(() => finishStory(true), STORY_MS + STORY_HOLD);
  }

  // ---- model tour -----------------------------------------------------------
  // TOUR_DELAY after the story has ended on its own (never under
  // prefers-reduced-motion) the card highlights each model that has systems in
  // the view for TOUR_STEP, in pill order, then shows the overview (nothing
  // selected: the frontier's leaders in full color) for one more TOUR_STEP,
  // and rounds again. The pill on show carries the countdown: its background
  // fills left to right (--tour, 0..1, read by main.css); the overview stop
  // has no pill and says so in the status line. The count only runs while the
  // card is on screen. Any click or touch on the figure or a control ends the
  // tour and keeps whatever is highlighted; the pill of the model on show
  // keeps that model rather than toggling it off.
  function modelButtons() {
    const row = pills.rows.model;
    return row ? [...row.querySelectorAll('.fr-pill[data-dim="model"]')].filter((b) => !b.disabled) : [];
  }

  function scheduleTour() {
    clearTimeout(state.tourTimer);
    state.tourTimer = setTimeout(() => { state.tourTimer = null; startTour(); }, TOUR_DELAY);
  }

  function startTour() {
    stopTour();
    if (state.phase !== 'interactive' || reduceMotion.matches) return;
    if (state.sel.model || state.sel.harness) return; // the reader has chosen already
    const buttons = modelButtons();
    if (buttons.length < 2) return;
    const stops = [...buttons, null]; // null: the overview closes the round
    const tour = { stops, i: -1, btn: null, elapsed: 0, last: null, raf: null };
    state.tour = tour;
    const advance = () => {
      tour.i = (tour.i + 1) % tour.stops.length;
      tour.elapsed = 0;
      if (tour.btn) { tour.btn.classList.remove('touring'); tour.btn.style.removeProperty('--tour'); }
      tour.btn = tour.stops[tour.i];
      if (tour.btn) {
        tour.btn.classList.add('touring');
        tour.btn.style.setProperty('--tour', '0');
      }
      state.sel.model = tour.btn ? tour.btn.dataset.key : null;
      state.sel.harness = null;
      pills.sync();
      syncStatus(state);
      render(state);
    };
    const frame = (now) => {
      if (state.tour !== tour) return;
      if (tour.last != null && state.tourVisible) tour.elapsed += Math.min(TOUR_MAX_DT, now - tour.last);
      tour.last = now;
      if (tour.elapsed >= TOUR_STEP) advance();
      else if (tour.btn) tour.btn.style.setProperty('--tour', (tour.elapsed / TOUR_STEP).toFixed(4));
      tour.raf = requestAnimationFrame(frame);
    };
    advance();
    tour.raf = requestAnimationFrame(frame);
  }

  function stopTour() {
    clearTimeout(state.tourTimer);
    state.tourTimer = null;
    const tour = state.tour;
    if (!tour) return;
    state.tour = null;
    cancelAnimationFrame(tour.raf);
    if (tour.btn) { tour.btn.classList.remove('touring'); tour.btn.style.removeProperty('--tour'); }
    syncStatus(state);
  }

  // a tap on an endpoint badge selects that system alone (its model and
  // harness pills press); tapping it again, or empty plot area, shows all
  state.onTap = (pt) => {
    if (state.phase !== 'interactive') return;
    const c = curveAt(state, pt);
    const { sel } = state;
    if (c) {
      const same = sel.model === c.model && sel.harness === c.harness;
      sel.model = same ? null : c.model;
      sel.harness = same ? null : c.harness;
    } else if (sel.model || sel.harness) {
      sel.model = null;
      sel.harness = null;
    } else return;
    pills.sync();
    syncStatus(state);
    render(state);
  };

  // the reader takes over: a pointer on the figure (click, drag, touch), a
  // wheel, or a click on any control
  stage.addEventListener('pointerdown', () => stopTour(), { capture: true });
  stage.addEventListener('wheel', () => stopTour(), { capture: true, passive: true });
  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.fr-pill[data-dim="model"]');
    const keep = Boolean(state.tour && btn && btn.dataset.key === state.sel.model);
    stopTour();
    if (keep) { e.stopPropagation(); e.preventDefault(); }
  }, { capture: true });
  // the countdown pauses while the card is off screen (or on a hidden bench tab)
  const onScreen = new IntersectionObserver((entries) => {
    for (const e of entries) state.tourVisible = e.isIntersecting;
  }, { threshold: 0.2 });

  replay.addEventListener('click', () => {
    autoplay.unobserve(host);
    stopTour();
    state.sel.model = null;
    state.sel.harness = null;
    pills.sync();
    syncStatus(state);
    startStory();
  });

  function setMetric(key) {
    if (key === state.metric) return;
    state.metric = key;
    for (const [k, b] of Object.entries(metricButtons)) b.setAttribute('aria-pressed', String(k === key));
    // a selection that has nothing in the new view is dropped rather than
    // shown as an empty highlight
    if ((state.sel.model || state.sel.harness) && countMatches(state, state.sel) === 0) {
      state.sel.model = null;
      state.sel.harness = null;
    }
    pills.sync();
    syncStatus(state);
    if (state.phase !== 'interactive') { autoplay.unobserve(host); finishStory(); } else render(state);
  }

  // first play when the card scrolls well into view
  const autoplay = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || state.phase !== 'idle') continue;
      autoplay.unobserve(host);
      startStory();
    }
  }, { threshold: 0.4 });

  // re-fit on width changes without replaying; a repaint skipped while the
  // card was hidden is picked up on reveal
  let lastWidth = 0;
  let tick = null;
  const ro = new ResizeObserver(() => {
    const w = stage.clientWidth;
    if (!w || (w === lastWidth && !state.dirty)) return;
    lastWidth = w;
    if (tick) cancelAnimationFrame(tick);
    tick = requestAnimationFrame(() => {
      if (state.phase === 'story') state.story = buildStory(state); // continues at the same progress
      if (state.plotted || state.dirty) render(state);
    });
  });

  syncStatus(state);
  return {
    seg: null,
    show() {
      if (state.armed) return;
      state.armed = true;
      lastWidth = stage.clientWidth;
      if (reduceMotion.matches) { state.phase = 'story'; finishStory(); } else { render(state); autoplay.observe(host); }
      ro.observe(stage);
      onScreen.observe(stage);
    },
    rerender() {
      // theme change: repaint with the new tokens; never restart the story
      pills.sync();
      if (state.phase === 'story') state.story = buildStory(state);
      if (state.plotted || state.dirty) render(state);
    },
  };
}
