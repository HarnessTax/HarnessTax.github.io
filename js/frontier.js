// Performance-cost Pareto frontier card.
//
// When the card scrolls into view an SVG animation traces the empirical
// frontier over the (still invisible) plotly figure, then dissolves into it.
// The figure's resting state is the animation's final frame: same geometry,
// same two-line labels (model over harness). Every observation is a round
// badge in its model's colour carrying its harness logo (icons.js): filled
// and large for a frontier system, small and outlined for a dominated one
// (the outline, not a fade, marks it, so its model colour reads true); drawn
// as SVG in the story and as layout.images over the plotly figure, whose own
// markers stay invisible hover targets.
// Model/harness pills highlight a subset (a harness selection also draws its
// own frontier, in that harness's colour from the harness-effect card,
// palette.js, at a lower alpha so the model-coloured badges read first);
// Replay runs the trace again. Once the story has ended on its
// own the card tours the harnesses: after a pause each harness is highlighted
// in turn with its own frontier drawn, its pill filling left to right as its
// time runs down, then the overview of all systems, and round again, until
// the reader clicks or touches the figure or a control.
//
// Everything here is presentation. Points, frontier order, display names and
// every subset frontier arrive precomputed in spec.frontier (see
// dashboard/charts.py::_frontier_story); the client never classifies Pareto
// membership itself.
import { h, s, createPills } from './pills.js';
import { badge, badgeImage, rgba, imageSpec, sizeImages, bindZoomSync } from './icons.js';
import { HARNESS_COLOR } from './palette.js';
import { attachViewport, ZOOM_HINT } from './viewport.js';
import { LABEL, NEAR_ORDER, COST, labelSize, placeLabels, labelAnnotation, labelTextAnchor, edgePoint, intersects } from './labels.js';

// shared by the SVG and the plotly figure; the top margin leaves room for a
// label row above the highest frontier points (labels prefer above / left)
const MARGIN = { l: 58, r: 22, t: 56, b: 46 };
const DIM = 0.12;   // outside an explicit selection
const FAINT = 0.3;  // a dominated observation's hover marker and intervals when nothing is selected
const CI_ALPHA = 0.3; // confidence-interval bars: the model colour, well behind the badges
// a harness's own frontier: the harness colour of the harness-effect card
// (palette.js), lightened so the model-coloured badges riding on it stay in front
const SUBSET_ALPHA = 0.6;
// the status line's one gesture hint, shared with the cost-scaling card. The
// other gestures (drag pans, double-click resets) go unsaid so the idle line
// reads as one short hint; wheeling back out returns to the designed view
// harness tour after the story (the same timing as the cost-scaling card's
// model tour): the pause before it starts and the time each stop is on show (a
// harness, its pill's fill counting the time down, or the overview of all
// systems that closes each round)
const TOUR_DELAY = 3000;
const TOUR_STEP = 5000;
const TOUR_MAX_DT = 100; // ms a frame may add: a tab hidden for a while resumes, not skips
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ------------------------------------------------------------------ helpers

function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function ticks(max, target) {
  const step = niceStep(max, target);
  const out = [];
  for (let v = 0; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return { values: out, step };
}

// trailing zeros are dropped only after a decimal point: "$0.10" → "$0.1",
// but "$10" stays "$10"
const trimZeros = (text) => (text.includes('.') ? text.replace(/\.?0+$/, '') : text);
function fmtUSD(v, step) {
  if (!(step > 0)) {
    const dec = v < 0.1 ? 3 : v < 1 ? 2 : v < 10 ? 1 : 0;
    const text = trimZeros(v.toFixed(dec));
    return `$${text === '' || text === '-' ? '0' : text}`;
  }
  let dec = 0;
  while (dec < 4 && Math.abs(step * 10 ** dec - Math.round(step * 10 ** dec)) > 1e-9) dec += 1;
  const text = trimZeros(v.toFixed(dec));
  return `$${text === '' || text === '-' ? '0' : text}`;
}

// Marker sizes (plotly px) shared with the resting figure; radii for the SVG
// story and the label placer's clearance derive from them.
function markerSizes(spec) {
  const sizes = spec.frontier.marker_size || {};
  return { frontier: sizes.frontier || 17, dominated: sizes.dominated || 8 };
}
const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtPct1 = (v) => `${(v * 100).toFixed(1)}%`;

function interactiveRanges(points) {
  let xhi = 0;
  let yhi = 0;
  for (const p of points) {
    const xarm = p.x_ci ? Math.max(0, p.x_ci[1] - p.x) : 0;
    xhi = Math.max(xhi, p.x + Math.min(xarm, p.x)); // arms wider than the mean run off the edge
    yhi = Math.max(yhi, p.y_ci ? p.y_ci[1] : p.y);
  }
  return { x: [0, xhi * 1.08], y: [0, Math.min(1.05, yhi + 0.04)] };
}

// Ticks for a zoomed view (`axes` in plot units). An axis still at its
// designed span keeps the geometry's ticks, the grid the animation drew; a
// zoomed axis gets ticks that read at that scale. The log cost axis takes the
// coarsest of powers of ten, 1-2-5 or 1-2-3-5-7 mantissas that still gives
// three labels, or evenly spaced nice values once the window is under half a
// decade; the rate axis a nice step of whole percents giving about five labels.
const LOG_MANTISSAS = [[1], [1, 2, 5], [1, 2, 3, 5, 7]];
const evenTicks = (lo, hi, step) => {
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
};
function zoomTicks(geo, axes) {
  const patch = {};
  const xSpan = axes.x1 - axes.x0;
  const xZoomed = xSpan < geo.plotXr[1] - geo.plotXr[0] - 1e-9;
  if (geo.logX) {
    let values = geo.xt.values;
    let step = null;
    if (xZoomed && xSpan >= 0.5) {
      for (const mantissas of LOG_MANTISSAS) {
        values = [];
        for (let k = Math.floor(axes.x0); k <= Math.ceil(axes.x1); k += 1) {
          for (const m of mantissas) {
            const e = k + Math.log10(m);
            if (e >= axes.x0 - 1e-9 && e <= axes.x1 + 1e-9) values.push(+(m * 10 ** k).toPrecision(12));
          }
        }
        if (values.length >= 3) break;
      }
    } else if (xZoomed) {
      const lo = 10 ** axes.x0;
      const hi = 10 ** axes.x1;
      step = niceStep(hi - lo, 5);
      values = evenTicks(lo, hi, step);
    }
    patch['xaxis.tickvals'] = values;
    // evenly spaced ticks keep the step's decimals ("$0.35 $0.40 $0.45")
    const dec = step ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 0;
    patch['xaxis.ticktext'] = values.map((v) => (step ? `$${v.toFixed(dec)}` : fmtUSD(v, null)));
  } else {
    patch['xaxis.dtick'] = xZoomed ? niceStep(xSpan, 5) : geo.xt.step;
  }
  const ySpan = axes.y1 - axes.y0;
  patch['yaxis.dtick'] = ySpan < geo.yr[1] - geo.yr[0] - 1e-9 ? Math.max(0.01, niceStep(ySpan, 6)) : geo.yt.step;
  return patch;
}

// One pixel geometry for both renderers: the plotly layout's height, fixed
// margins, the interactive ranges and nice tick steps (handed to plotly as
// dtick so the grids coincide).
function geometry(state, width) {
  const layout = state.ctx.resolve(state.spec.plotly.layout);
  const fr = state.spec.frontier;
  const logX = fr.x_scale === 'log';
  const ranges = interactiveRanges(fr.points);
  let xr;
  let plotXr;
  let xt;
  let xs;
  if (logX) {
    const positive = fr.points.flatMap((p) => [
      p.x,
      ...(p.x_ci || []).filter((value) => value > 0),
    ]).filter((value) => value > 0 && Number.isFinite(value));
    const rawLo = Math.min(...positive);
    const rawHi = Math.max(...positive);
    const span = Math.max(Math.log10(rawHi) - Math.log10(rawLo), 1);
    const lo = Math.log10(rawLo) - span * 0.06;
    const hi = Math.log10(rawHi) + span * 0.06;
    xr = [10 ** lo, 10 ** hi];
    plotXr = [lo, hi]; // Plotly log-axis ranges are expressed as exponents.
    const values = [];
    for (let exponent = Math.ceil(lo); exponent <= Math.floor(hi); exponent += 1) {
      values.push(10 ** exponent);
    }
    xt = { values, step: null };
    xs = (v) => MARGIN.l + ((Math.log10(v) - lo) / (hi - lo)) * (width - MARGIN.l - MARGIN.r);
  } else {
    xr = layout.xaxis.range || ranges.x;
    plotXr = xr;
    xt = ticks(xr[1], 6);
    xs = (v) => MARGIN.l + ((v - xr[0]) / (xr[1] - xr[0])) * (width - MARGIN.l - MARGIN.r);
  }
  const yr = ranges.y;
  const W = width; // the plotly figure autosizes to the same container
  const H = layout.height;
  const iw = W - MARGIN.l - MARGIN.r;
  const ih = H - MARGIN.t - MARGIN.b;
  const yt = ticks(yr[1], 5);
  const ys = (v) => MARGIN.t + ih - ((v - yr[0]) / (yr[1] - yr[0])) * ih;
  return { W, H, iw, ih, xr, plotXr, yr, xt, yt, xs, ys, logX, l: MARGIN.l, b: MARGIN.b, layout };
}

// `axes` (plot units, log10 on the log axis) maps the points for a zoomed
// view; without it the designed view's scales apply
// Every observation on a card is the same sample (unique tasks × repetitions:
// "30 unique tasks over 3 repetitions"), so the card states it once, under the
// plot, and a hover keeps only what sets its observation apart: the caveats
// charts.py appends to the statement after " · " (a turn-cap count, say). A
// card whose observations differ in sample states nothing under the plot and
// every hover keeps its own full statement.
function sampleParts(text) {
  const [head, ...rest] = (text || '').split(' · ');
  return { head, rest: rest.join(' · ') };
}
function sharedSample(points) {
  const heads = new Set(points.map((p) => sampleParts(p.sample).head));
  return heads.size === 1 ? [...heads][0] || null : null;
}
// what a hover says of an observation's sample: its caveats alone when the
// statement is the card's shared one, else the text as written
function hoverSample(shared, text) {
  const parts = sampleParts(text);
  return shared && parts.head === shared ? parts.rest : text || '';
}
// the plotly hover's sample line (charts.py's frontier traces: customdata[4])
const SAMPLE_LINE = '<br>%{customdata[4]}';
// the line under the plot: the shared statement spelled out for the reader
// ("30 unique tasks over 3 repetitions" becomes "30 unique randomly sampled
// tasks over 3 repetitions for every model × harness point"); a statement of
// another shape is quoted as written
function sampleLine(shared) {
  const m = /^(\d+) unique tasks? over (\d+) repetitions?$/.exec(shared);
  if (!m) return `every observation: ${shared}`;
  return `${m[1]} unique randomly sampled tasks over ${m[2]} repetition${m[2] === '1' ? '' : 's'} for every model × harness point`;
}

function pixelPoints(state, geo, axes = null) {
  const xs = axes
    ? (v) => MARGIN.l + (((geo.logX ? Math.log10(v) : v) - axes.x0) / (axes.x1 - axes.x0)) * geo.iw
    : geo.xs;
  const ys = axes
    ? (v) => MARGIN.t + geo.ih - ((v - axes.y0) / (axes.y1 - axes.y0)) * geo.ih
    : geo.ys;
  const points = state.spec.frontier.points.map((p) => ({
    ...p, px: xs(p.x), py: ys(p.y), hex: state.ctx.resolve(p.color), hover: hoverSample(state.shared, p.sample),
  }));
  const byId = Object.fromEntries(points.map((p) => [p.id, p]));
  const frontier = state.spec.frontier.path.map((id) => byId[id]).filter(Boolean);
  return { points, byId, frontier };
}

// A single-replicate (descriptive) cell wears a dashed ring outside its badge,
// the badge version of plotly's dotted marker.
function singleReplicateRing(r, hex, parent) {
  return s('circle', { r: r + 3, fill: 'none', stroke: hex, 'stroke-width': 1, 'stroke-dasharray': '2 2' }, parent);
}

// Badge image specs for the resting figure: one per observation, anchored
// in data coordinates so zooming moves it with its hover marker, sized in
// pixels (icons.js sizes them for the axes shown), faded exactly like the
// trace that carries its hover.
function badgeImageSpecs(points, geo, sizes, surface, opacityOf) {
  const ordered = [...points].sort((a, b) => Number(a.frontier) - Number(b.frontier)); // frontier badges on top
  return ordered.map((p) => {
    const r = (p.frontier ? sizes.frontier : sizes.dominated) / 2;
    const { uri, size } = badgeImage(p.harness, r, p.hex, { variant: p.frontier ? 'filled' : 'open', surface });
    return imageSpec(uri, geo.logX ? Math.log10(p.x) : p.x, p.y, size, opacityOf(p));
  });
}

// the designed view's axes in plot units (log10 on the log axis)
const axesOf = (geo) => ({ x0: geo.plotXr[0], x1: geo.plotXr[1], y0: geo.yr[0], y1: geo.yr[1], iw: geo.iw, ih: geo.ih });

// Boxes labels must keep clear of: y tick labels and the frontier staircase.
// tick text is words (a label never covers it); the staircase (one group, so
// a seat on a step's corner pays once) is priced under a leader, so a label
// sits over it rather than take a long leader
function labelObstacles(geo, frontier) {
  const out = geo.yt.values.map((v) => ({ x0: 0, x1: MARGIN.l - 4, y0: geo.ys(v) - 7, y1: geo.ys(v) + 7, weight: COST.words }));
  for (let i = 1; i < frontier.length; i++) {
    const a = frontier[i - 1];
    const b = frontier[i];
    out.push({ x0: Math.min(a.px, b.px), x1: Math.max(a.px, b.px), y0: a.py - 2, y1: a.py + 2, weight: 10, group: 'staircase' });
    out.push({ x0: b.px - 2, x1: b.px + 2, y0: Math.min(a.py, b.py), y1: Math.max(a.py, b.py), weight: 10, group: 'staircase' });
  }
  return out;
}

// Place two-line labels for `targets` (in the given order); other
// observations' badges count as obstacles a label must not sit on. Labels
// hug their badge (LABEL_GAP), prefer the quadrant above or left of it, and
// a small set (the frontier) is placed jointly so labels do not crowd each
// other out; a label with no clean spot is pushed out toward the top-left
// with a leader.
const LABEL_GAP = 3; // px between a badge's edge and its label
function placeFrontierLabels(targets, points, frontier, geo, sizes, extraObstacles = []) {
  const radius = (p) => (p.frontier ? sizes.frontier : sizes.dominated) / 2;
  const items = targets.map((p) => ({ px: p.px, py: p.py, r: radius(p), ...labelSize(p.model_label, p.harness_label) }));
  // the unlabelled badges are dimmed (or small) in every view that labels
  // these targets: covering one costs less than a leader
  const others = points.filter((p) => !targets.includes(p))
    .map((p) => { const r = radius(p) + 1; return { x0: p.px - r, x1: p.px + r, y0: p.py - r, y1: p.py + r, weight: 4 }; });
  return placeLabels(items, geo, {
    order: NEAR_ORDER.frontier, sequence: 'given', gap: LABEL_GAP, bias: 'top-left', joint: true,
    obstacles: labelObstacles(geo, frontier).concat(extraObstacles), markers: others,
  });
}

// Labels for the view under `axes`: the frontier's (or the selection's) as
// always, plus, once the view is zoomed in with nothing selected, a label for
// every dominated observation in view that fits cleanly beside its badge
// (no leader, clear of every other badge, label and the frontier staircase).
// Returns [{ p, box, faint }] with pixel positions for those axes.
const zoomedIn = (axes, bd) => Boolean(axes && bd)
  && (axes.x1 - axes.x0 < (bd.x1 - bd.x0) * 0.999 || axes.y1 - axes.y0 < (bd.y1 - bd.y0) * 0.999);

function labelPlan(state, geo, axes) {
  const { points, frontier } = pixelPoints(state, geo, axes);
  const sel = state.sel;
  const active = Boolean(sel.model || sel.harness);
  const sizes = markerSizes(state.spec);
  const targets = active
    ? points.filter((p) => (!sel.model || p.model === sel.model) && (!sel.harness || p.harness === sel.harness))
      .sort((a, b) => a.x - b.x || a.y - b.y)
    : frontier;
  const boxes = placeFrontierLabels(targets, points, frontier, geo, sizes, active ? intervalObstacles(targets, geo) : []);
  const labels = targets.map((p, i) => ({ p, box: boxes[i], faint: false }));
  if (active || !zoomedIn(axes, state.viewBounds)) return { labels, points, frontier };

  const inView = (p) => p.px >= MARGIN.l && p.px <= MARGIN.l + geo.iw && p.py >= MARGIN.t && p.py <= MARGIN.t + geo.ih;
  const candidates = points.filter((p) => !p.frontier && inView(p));
  if (!candidates.length) return { labels, points, frontier };
  const radius = (p) => (p.frontier ? sizes.frontier : sizes.dominated) / 2;
  const markerBox = (p) => { const r = radius(p) + 1; return { x0: p.px - r, x1: p.px + r, y0: p.py - r, y1: p.py + r, weight: 8 }; };
  const staircase = labelObstacles(geo, frontier);
  const items = candidates.map((p) => ({ px: p.px, py: p.py, r: radius(p), ...labelSize(p.model_label, p.harness_label) }));
  const extra = placeLabels(items, geo, {
    order: NEAR_ORDER.frontier, sequence: 'given', gap: LABEL_GAP, bias: 'top-left',
    obstacles: staircase.concat(boxes.map((b) => ({ ...b, weight: 20 }))),
    markers: points.filter((p) => !candidates.includes(p)).map(markerBox),
  });
  const plotArea = { x0: MARGIN.l, x1: MARGIN.l + geo.iw, y0: MARGIN.t, y1: MARGIN.t + geo.ih };
  const taken = boxes.slice();
  candidates.forEach((p, i) => {
    const bx = extra[i];
    if (bx.leader) return;
    if (bx.x0 < plotArea.x0 || bx.x1 > plotArea.x1 || bx.y0 < plotArea.y0 || bx.y1 > plotArea.y1) return;
    if (taken.some((q) => intersects(bx, q, 2))) return;
    if (staircase.some((q) => intersects(bx, q, 1))) return;
    if (points.some((q) => q !== p && intersects(bx, markerBox(q), 0))) return;
    taken.push(bx);
    labels.push({ p, box: bx, faint: true });
  });
  return { labels, points, frontier };
}

// plotly annotations for a label plan (log axis: x as log10, as plotly wants)
function annotationsFor(state, geo, plan) {
  const ctx = state.ctx;
  const full = { ink: ctx.resolve('@ink'), ink2: ctx.resolve('@ink2'), muted: ctx.resolve('@muted') };
  const faint = { ink: full.ink2, ink2: full.muted, muted: full.muted };
  return plan.labels.map(({ p, box, faint: isFaint }) => labelAnnotation({
    x: geo.logX ? Math.log10(p.x) : p.x, y: p.y, px: p.px, py: p.py,
    model: p.model_label, harness: p.harness_label, box, colors: isFaint ? faint : full,
  }));
}

// The confidence bars the interactive view draws for a selection, as pixel
// boxes labels should keep clear of (thin, low weight).
function intervalObstacles(targets, geo) {
  const out = [];
  targets.forEach((p, i) => {
    const group = `ci${i}`; // one point's two whiskers charge a label once
    if (p.x_ci) {
      const lo = geo.logX ? Math.max(p.x_ci[0], p.x * 1e-6, geo.xr[0]) : Math.max(p.x_ci[0], geo.xr[0]);
      const hi = Math.min(p.x_ci[1], geo.xr[1]);
      if (hi > lo) out.push({ x0: geo.xs(lo), x1: geo.xs(hi), y0: p.py - 2, y1: p.py + 2, weight: 4, group });
    }
    if (p.y_ci) {
      const top = Math.min(p.y_ci[1], geo.yr[1]);
      const bottom = Math.max(p.y_ci[0], geo.yr[0]);
      if (top > bottom) out.push({ x0: p.px - 2, x1: p.px + 2, y0: geo.ys(top), y1: geo.ys(bottom), weight: 4, group });
    }
  });
  return out;
}

// ------------------------------------------------------------ animated view

function buildStory(state) {
  const { host, spec } = state;
  const fr = spec.frontier;
  const width = host.clientWidth;
  if (!width) return false; // hidden (other bench tab); the ResizeObserver will call again
  const geo = geometry(state, width);
  state.geo = geo;
  const { points, frontier } = pixelPoints(state, geo);
  const sizes = markerSizes(spec);

  host.replaceChildren();
  host.classList.remove('static', 'played', 'animated');
  host.classList.add(state.played && !state.replaying ? 'static' : 'animated');
  const svg = s('svg', {
    viewBox: `0 0 ${geo.W} ${geo.H}`, width: geo.W, height: geo.H,
    role: 'img', 'aria-label': `${spec.title}: animated Pareto frontier`,
  }, host);

  // grid + axes
  const grid = s('g', { class: 'fr-gridlayer' }, svg);
  for (const v of geo.yt.values) {
    if (geo.ys(v) < MARGIN.t - 1) continue;
    s('line', { class: 'fr-grid', x1: MARGIN.l, x2: geo.W - MARGIN.r, y1: geo.ys(v), y2: geo.ys(v) }, grid);
    s('text', { class: 'fr-tick', x: MARGIN.l - 3.2, y: geo.ys(v) + 4, 'text-anchor': 'end' }, grid).textContent = fmtPct(v);
  }
  for (const v of geo.xt.values) {
    if (geo.xs(v) > geo.W - MARGIN.r + 1) continue;
    s('line', { class: 'fr-grid', x1: geo.xs(v), x2: geo.xs(v), y1: MARGIN.t, y2: MARGIN.t + geo.ih }, grid);
    s('text', { class: 'fr-tick', x: geo.xs(v), y: MARGIN.t + geo.ih + 14, 'text-anchor': 'middle' }, grid).textContent = fmtUSD(v, geo.xt.step);
  }
  s('line', { class: 'fr-axis', x1: MARGIN.l, x2: geo.W - MARGIN.r, y1: MARGIN.t + geo.ih, y2: MARGIN.t + geo.ih }, grid);
  s('line', { class: 'fr-axis', x1: MARGIN.l, x2: MARGIN.l, y1: MARGIN.t, y2: MARGIN.t + geo.ih }, grid);
  s('text', { class: 'fr-axis-title', x: MARGIN.l + geo.iw / 2, y: geo.H - 4, 'text-anchor': 'middle' }, grid).textContent = fr.x_label;
  const ty = MARGIN.l - 34; // plotly's default left y-title offset: 10 + 1.5·12 (title font) + 0.5·12 (tick labels)
  s('text', {
    class: 'fr-axis-title', x: ty, y: MARGIN.t + geo.ih / 2, 'text-anchor': 'middle',
    transform: `rotate(-90 ${ty} ${MARGIN.t + geo.ih / 2})`,
  }, grid).textContent = fr.y_label;

  // dominated observations: small outlined badges, dimmed like the unreached
  // frontier points while the trace plays and lit together once it has ended
  const dom = s('g', { class: 'fr-dom' }, svg);
  for (const p of points.filter((q) => !q.frontier)) {
    const g = s('g', { transform: `translate(${p.px.toFixed(1)} ${p.py.toFixed(1)})` }, dom);
    badge(p.harness, sizes.dominated / 2, p.hex, { variant: 'open', surface: 'var(--surface)' }, g);
    if (p.single_replicate) singleReplicateRing(sizes.dominated / 2, p.hex, g);
  }

  // frontier path (staircase; drawn left → right at constant pixel speed)
  let d = '';
  const cum = [];
  let len = 0;
  frontier.forEach((p, i) => {
    if (i === 0) { d += `M${p.px.toFixed(1)},${p.py.toFixed(1)}`; cum.push(0); return; }
    const prev = frontier[i - 1];
    d += ` H${p.px.toFixed(1)} V${p.py.toFixed(1)}`;
    len += Math.abs(p.px - prev.px) + Math.abs(prev.py - p.py);
    cum.push(len);
  });
  const segments = Math.max(frontier.length - 1, 0);
  const duration = Math.min(4200, Math.max(1400, 700 + 520 * segments));
  const base = 140; // ms before the first point pops
  const delays = cum.map((c) => base + (len > 0 ? (c / len) * duration : 0));
  if (frontier.length > 1) {
    s('path', { class: 'fr-path', d }, svg);
  }
  host.style.setProperty('--len', String(len.toFixed(1)));
  host.style.setProperty('--dur', `${duration}ms`);
  host.style.setProperty('--end', `${Math.round(base + duration)}ms`); // when the dominated badges light up
  state.duration = base + duration;

  // frontier points: faint until the trace reaches them
  const layer = s('g', { class: 'fr-frontier' }, svg);
  frontier.forEach((p, i) => {
    const g = s('g', {
      class: 'fr-pt', transform: `translate(${p.px.toFixed(1)} ${p.py.toFixed(1)})`,
    }, layer);
    g.style.setProperty('--delay', `${Math.round(delays[i])}ms`);
    s('circle', { class: 'fr-pulse', r: sizes.frontier / 2 + 2 }, g);
    badge(p.harness, sizes.frontier / 2, p.hex, { variant: 'filled', surface: 'var(--surface)' }, g);
    if (p.single_replicate) singleReplicateRing(sizes.frontier / 2, p.hex, g);
  });

  // labels: model over harness, revealed with their point; the same boxes
  // serve the plotly figure this animation dissolves into
  const boxes = placeFrontierLabels(frontier, points, frontier, geo, sizes);
  const labelLayer = s('g', { class: 'fr-labels' }, svg);
  frontier.forEach((p, i) => {
    const box = boxes[i];
    const g = s('g', { class: 'fr-label' }, labelLayer);
    g.style.setProperty('--delay', `${Math.round(delays[i] + 60)}ms`);
    if (box.leader) {
      // same segment plotly draws for the annotation arrow: marker → box
      // centre, clipped at the box edge, starting 7px (standoff) off the marker
      const e = edgePoint(box, p.px, p.py);
      const len = Math.hypot(e.x - p.px, e.y - p.py) || 1;
      const k = 7 / len;
      s('line', { class: 'fr-leader', x1: p.px + (e.x - p.px) * k, y1: p.py + (e.y - p.py) * k, x2: e.x, y2: e.y }, g);
    }
    const ta = labelTextAnchor(box, p.px); // ragged toward the point, as the plotly annotation
    s('text', { class: 'fr-label-model', x: ta.x, y: box.y0 + LABEL.pad + LABEL.baseline1, 'text-anchor': ta.anchor }, g).textContent = p.model_label;
    s('text', { class: 'fr-label-harness', x: ta.x, y: box.y0 + LABEL.pad + LABEL.baseline1 + LABEL.lineGap, 'text-anchor': ta.anchor }, g).textContent = p.harness_label;
  });

  // hover targets (≥ 24px) with a tooltip, for every observation
  const tip = h('div', 'fr-tip', host);
  const hits = s('g', { class: 'fr-hits' }, svg);
  for (const p of points) {
    const c = s('circle', { class: 'fr-hit', cx: p.px, cy: p.py, r: Math.max(13, sizes.frontier / 2 + 4) }, hits);
    c.addEventListener('pointerenter', () => showTip(tip, host, p, geo));
    c.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  }
  return true;
}

function showTip(tip, host, p, geo) {
  tip.replaceChildren();
  const head = h('div', 'fr-tip-head', tip);
  const sw = h('span', 'fr-swatch', head);
  sw.style.background = p.hex;
  const name = h('b', null, head);
  name.textContent = p.model_label;
  head.appendChild(document.createTextNode(` · ${p.harness_label}`));
  if (p.qualifier) {
    // same cohort qualifier the table and plotly hover append to a duplicate name
    h('span', 'fr-tip-muted', head).textContent = `(${p.qualifier})`;
  }
  const line1 = h('div', null, tip);
  line1.textContent = `${fmtPct1(p.y)} resolved · ${fmtUSD(p.x, 0.001)} per rollout`;
  const line2 = h('div', 'fr-tip-muted', tip);
  line2.textContent = [p.frontier ? 'frontier' : 'dominated', p.hover].filter(Boolean).join(' · ');
  tip.style.display = 'block';
  const scale = host.clientWidth / geo.W;
  const tw = tip.offsetWidth;
  let left = p.px * scale + 14;
  if (left + tw > host.clientWidth - 4) left = p.px * scale - tw - 14;
  tip.style.left = `${Math.max(2, left)}px`;
  tip.style.top = `${Math.max(2, p.py * scale - 12)}px`;
}

function play(state) {
  const { host } = state;
  if (!host.querySelector('svg')) return;
  state.played = true;
  host.classList.remove('static', 'played');
  host.classList.add('animated');
  void host.offsetWidth; // flush so the armed state is committed before transitions fire
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (host.classList.contains('animated')) host.classList.add('played');
  }));
}

// --------------------------------------------------------- interactive view

function countMatches(state, sel) {
  return state.spec.frontier.points.filter((p) =>
    (!sel.model || p.model === sel.model) && (!sel.harness || p.harness === sel.harness)).length;
}

// The status line carries no counts ("7 of 21 observations highlighted" said
// nothing the faded badges do not): a selection's own note and the tour's,
// else the idle hint
function syncPills(state) {
  const { sel } = state;
  state.pills.sync();
  const active = Boolean(sel.model || sel.harness);
  const notes = [];
  if (active && sel.harness && !sel.model) notes.push('frontier drawn within the selection');
  if (state.tour) notes.push('touring the harnesses, click anywhere to stop');
  state.pills.status.textContent = notes.length ? notes.join(' · ') : `pick a model or harness to highlight it · ${ZOOM_HINT}`;
}

async function renderInteractive(state) {
  const { spec, ctx, plot } = state;
  await ctx.loadPlotly();
  const width = plot.clientWidth;
  if (!width) { state.dirty = true; return; } // hidden; repainted on reveal
  const fr = spec.frontier;
  const fig = ctx.resolve(spec.plotly);
  const sel = state.sel;
  const active = Boolean(sel.model || sel.harness);
  const geo = geometry(state, width);
  const { points, byId, frontier } = pixelPoints(state, geo);

  const data = fig.data.map((tr) => ({ ...tr }));
  for (const tr of data) {
    if (!tr.meta || tr.meta.model === undefined) {
      if (tr.mode === 'lines') tr.opacity = active ? 0.3 : 1; // headline frontier as reference
      continue;
    }
    const match = (!sel.model || tr.meta.model === sel.model)
      && (!sel.harness || tr.meta.harness === sel.harness);
    // confidence intervals only for an explicit selection, drawn light so
    // the badges and labels stay in front
    const showIntervals = active && match;
    if (tr.error_x) tr.error_x = { ...tr.error_x, visible: showIntervals, color: rgba(tr.error_x.color, CI_ALPHA) };
    if (tr.error_y) tr.error_y = { ...tr.error_y, visible: showIntervals, color: rgba(tr.error_y.color, CI_ALPHA) };
    if (!active) tr.opacity = tr.meta.frontier ? 1 : FAINT;
    else if (match) tr.opacity = 1;
    else tr.opacity = DIM;
    // the badge image draws the observation; the marker stays as the hover
    // target (the trace opacity still fades its intervals)
    tr.marker = { ...tr.marker, opacity: 0 };
    // the hover's sample line keeps only the observation's caveats (the shared
    // statement is under the plot); an observation left with none loses the line
    if (state.shared && Array.isArray(tr.customdata) && typeof tr.hovertemplate === 'string') {
      const rows = tr.customdata.map((row) => {
        if (!Array.isArray(row) || typeof row[4] !== 'string') return row;
        const r = row.slice(); r[4] = hoverSample(state.shared, r[4]); return r;
      });
      const bare = rows.map((r, i) => r !== tr.customdata[i] && !r[4]);
      tr.customdata = rows;
      if (bare.every(Boolean)) tr.hovertemplate = tr.hovertemplate.replace(SAMPLE_LINE, '');
      else if (bare.some(Boolean)) tr.hovertemplate = bare.map((b) => (b ? tr.hovertemplate.replace(SAMPLE_LINE, '') : tr.hovertemplate));
    }
  }
  state.imageSpecs = badgeImageSpecs(points, geo, markerSizes(spec), ctx.resolve('@surface'), (p) => {
    if (!active) return 1; // outlined badges already read as dominated
    const match = (!sel.model || p.model === sel.model) && (!sel.harness || p.harness === sel.harness);
    return match ? 1 : DIM;
  });
  state.lastAxes = axesOf(geo);
  const images = sizeImages(state.imageSpecs, state.lastAxes);
  // a harness selection draws its own frontier under the labels; a model
  // selection only highlights its points (its three systems are not a
  // frontier worth reading)
  const subset = active && sel.harness && !sel.model && (fr.subsets || []).find(
    (sub) => (sub.model || null) === (sel.model || null) && (sub.harness || null) === (sel.harness || null),
  );
  const path = subset ? subset.path.map((id) => byId[id]).filter(Boolean) : [];
  const subsetTrace = {
    type: 'scatter', mode: 'lines', name: 'highlighted frontier', showlegend: false,
    hoverinfo: 'skip', meta: { role: 'subset-frontier' },
    x: path.length > 1 ? path.map((p) => p.x) : [],
    y: path.length > 1 ? path.map((p) => p.y) : [],
    line: { color: rgba(HARNESS_COLOR[sel.harness] || ctx.resolve('@muted'), SUBSET_ALPHA), width: 3, shape: 'hv' },
  };
  // plotly paints traces in order: insert before the first marker trace so
  // the line sits under every marker
  const firstMarkers = data.findIndex((tr) => tr.mode && tr.mode.includes('markers'));
  data.splice(firstMarkers < 0 ? data.length : firstMarkers, 0, subsetTrace);

  // labels: with nothing selected these are exactly the animation's boxes
  // (dominated observations gain labels only once the view is zoomed in,
  // re-placed on every zoom or pan by the relayout sync below)
  state.igeo = geo;
  state.viewBounds = { x0: geo.plotXr[0], x1: geo.plotXr[1], y0: geo.yr[0], y1: geo.yr[1] };
  const annotations = annotationsFor(state, geo, labelPlan(state, geo, null));

  const layout = {
    ...fig.layout,
    showlegend: false,
    height: geo.H,
    margin: { ...MARGIN },
    dragmode: false, // zoom and pan are the card's own bounded gestures (viewport.js)
    xaxis: geo.logX
      ? {
        ...fig.layout.xaxis, type: 'log', range: geo.plotXr,
        autorange: false, automargin: false, tickmode: 'array',
        tickvals: geo.xt.values,
        ticktext: geo.xt.values.map((value) => fmtUSD(value, null)),
      }
      : {
        ...fig.layout.xaxis, range: geo.plotXr, autorange: false,
        automargin: false, tick0: 0, dtick: geo.xt.step,
      },
    yaxis: { ...fig.layout.yaxis, range: geo.yr, autorange: false, automargin: false, tick0: 0, dtick: geo.yt.step },
    annotations,
    images,
  };
  // bounded gestures: wheel/pinch/shift-drag zoom, drag pans, double-click
  // resets; every step redraws curves, badges, labels and ticks together
  window.Plotly.react(plot, data, layout, { displayModeBar: false, responsive: true, scrollZoom: false, doubleClick: false });
  bindZoomSync(state, plot, () => renderInteractive(state), (axes) => ({
    annotations: annotationsFor(state, state.igeo, labelPlan(state, state.igeo, axes)),
    ...zoomTicks(state.igeo, axes),
  }));
  attachViewport(plot, { bounds: () => state.viewBounds, reset: () => renderInteractive(state) });
  state.plotted = true;
  state.dirty = false;
}

// ---------------------------------------------------------------- mounting

export function mountFrontier(body, spec, ctx) {
  const state = {
    spec, ctx, sel: { model: null, harness: null },
    phase: 'idle', played: false, plotted: false, replaying: false, dirty: false,
    timer: null, plotReady: null, duration: 0,
    tour: null, tourTimer: null, tourVisible: true,
    shared: sharedSample(spec.frontier.points), // the one sample statement every observation shares, or null
  };

  // toolbar: pills (with the status line) and Replay at the end of the model row
  const toolbar = h('div', 'fr-toolbar', body);
  state.pills = createPills({
    models: spec.frontier.models,
    harnesses: spec.frontier.harnesses,
    sel: state.sel,
    resolve: (token) => ctx.resolve(token),
    count: (sel) => countMatches(state, sel),
    onChange: () => {
      syncPills(state);
      // a selection made before or during the story skips straight to the figure
      if (state.phase !== 'interactive') { autoplay.unobserve(host); finishStory(); }
      renderInteractive(state);
    },
  });
  toolbar.appendChild(state.pills.el);
  const replay = h('button', 'fr-replay', state.pills.rows.model || state.pills.el);
  replay.type = 'button';
  replay.setAttribute('aria-label', 'Replay animation');
  const icon = s('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true' }, replay);
  s('path', { d: 'M8 1.5a6.5 6.5 0 1 0 5.5 10', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, icon);
  s('path', { d: 'M13.5 1.5v4h-4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, icon);
  replay.appendChild(document.createTextNode('Replay'));
  if (reduceMotion.matches) replay.hidden = true; // nothing to replay without motion
  syncPills(state);

  // stage: the plotly figure in flow, the SVG story absolutely on top
  const height = ctx.resolve(spec.plotly.layout).height;
  const stage = h('div', 'fr-stage', body);
  stage.style.minHeight = `${height}px`;
  const plot = h('div', 'plot', stage);
  plot.style.height = `${height}px`;
  const host = h('div', 'fr-host', stage);
  state.plot = plot;
  state.host = host;
  // the sample statement, once, under the plot (see sharedSample); the hovers
  // then carry only an observation's caveats
  if (state.shared) h('p', 'fr-sample', body).textContent = sampleLine(state.shared);

  function ensurePlot() {
    if (!state.plotReady) state.plotReady = renderInteractive(state);
    return state.plotReady;
  }

  // `tour` is true only when the story ran to its end on its own: a story cut
  // short by a click hands the figure to the reader without touring
  async function finishStory(tour = false) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.phase = 'interactive';
    await ensurePlot();
    if (state.phase !== 'interactive') return;
    stage.classList.add('done');
    if (tour) scheduleTour();
  }

  function startStory(replaying) {
    stopTour();
    if (state.timer) clearTimeout(state.timer);
    state.phase = 'story';
    stage.classList.remove('done');
    state.replaying = replaying;
    const built = buildStory(state);
    state.replaying = false;
    if (!built) { state.phase = 'idle'; autoplay.observe(host); return; } // hidden mid-dispatch; retry on reveal
    if (reduceMotion.matches) { finishStory(); return; }
    play(state);
    state.timer = setTimeout(() => finishStory(true), state.duration + 750);
  }

  // ---- harness tour ---------------------------------------------------------
  // TOUR_DELAY after the story has ended on its own (never under
  // prefers-reduced-motion) the card highlights each harness that has systems
  // on the figure for TOUR_STEP, in pill order, each with its own frontier
  // drawn, then shows the overview (nothing selected: the frontier systems as
  // filled badges) for one more TOUR_STEP, and rounds again. The pill on show
  // carries the countdown: its background fills left to right (--tour, 0..1,
  // read by main.css); the overview stop has no pill and says so in the status
  // line. The count only runs while the card is on screen. Any click or touch
  // on the figure or a control ends the tour and keeps whatever is
  // highlighted; the pill of the harness on show keeps that harness rather
  // than toggling it off. The cost-scaling card tours its models the same way.
  function harnessButtons() {
    const row = state.pills.rows.harness;
    return row ? [...row.querySelectorAll('.fr-pill[data-dim="harness"]')].filter((b) => !b.disabled) : [];
  }

  function scheduleTour() {
    clearTimeout(state.tourTimer);
    state.tourTimer = setTimeout(() => { state.tourTimer = null; startTour(); }, TOUR_DELAY);
  }

  function startTour() {
    stopTour();
    if (state.phase !== 'interactive' || reduceMotion.matches) return;
    if (state.sel.model || state.sel.harness) return; // the reader has chosen already
    const buttons = harnessButtons();
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
      state.sel.harness = tour.btn ? tour.btn.dataset.key : null;
      state.sel.model = null;
      syncPills(state);
      renderInteractive(state);
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
    syncPills(state);
  }

  // the reader takes over: a pointer on the figure (click, drag, touch), a
  // wheel, or a click on any control
  stage.addEventListener('pointerdown', () => stopTour(), { capture: true });
  stage.addEventListener('wheel', () => stopTour(), { capture: true, passive: true });
  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.fr-pill[data-dim="harness"]');
    const keep = Boolean(state.tour && btn && btn.dataset.key === state.sel.harness);
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
    syncPills(state);
    state.plotReady = renderInteractive(state);
    startStory(true);
  });

  // first play when the card scrolls well into view
  const autoplay = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || state.phase !== 'idle') continue;
      autoplay.unobserve(host);
      ensurePlot();
      startStory(false);
    }
  }, { threshold: 0.4 });

  // re-fit on width changes without replaying; a repaint skipped while the
  // card was hidden is picked up on reveal
  let resizeTick = null;
  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    const w = stage.clientWidth;
    if (!w || (w === lastWidth && !state.dirty)) return;
    lastWidth = w;
    if (resizeTick) cancelAnimationFrame(resizeTick);
    resizeTick = requestAnimationFrame(() => {
      if (state.phase !== 'interactive') buildStory(state); // static once played
      if (state.plotted || state.dirty) renderInteractive(state);
    });
  });

  let armed = false;
  return {
    seg: null,
    show() {
      if (armed) return;
      armed = true;
      buildStory(state);
      lastWidth = stage.clientWidth;
      ro.observe(stage);
      onScreen.observe(stage);
      if (reduceMotion.matches) { state.phase = 'story'; finishStory(); } else autoplay.observe(host);
    },
    rerender() {
      // theme change: repaint in place; never restart the animation
      syncPills(state);
      if (state.phase !== 'interactive' && !buildStory(state)) state.dirty = true;
      if (state.plotted) renderInteractive(state);
      else if (state.phase === 'interactive') state.dirty = true;
    },
  };
}
