// Harness-effect card: figure 2 of the harness-figure redesign, ported as is
// (visualization/mockups/harness-redesign/mockups/owner-proposal-v4-bars.html).
// Two bar charts share one set of rows: for each model its harnesses in the
// rows Pi, Codex, Claude Code; cost per rollout on the left (linear from $0,
// a cell more than 3× the next-costliest drawn as a broken bar), resolved
// rate on the right, faint 95 % whiskers on both, the model's best cell on
// each panel marked green. Hover washes the model's rows and shows a
// four-line tooltip; a click pins the model in both charts (and fits the cost
// axis to it when one of its cells is off-axis); Esc, a second click or the
// card background clears it. The notes and the table are the mockup's panes.
//
// What differs from the mockup page is only its wiring into the dashboard:
// the card is one benchmark (the section's benchmark tabs stand in for the
// mockup's own), the numbers come from spec.harness
// (dashboard/charts.py::_harness_effect_spec — `rows`, the task-paired Pi
// contrasts, and `frontier_points`, the Pareto card's cells) instead of
// data.json, the notes/table buttons sit in the card header, and the neutral
// colours follow the dashboard theme. Every number is drawn as the mockup
// draws it; a model whose cell is missing on a harness keeps an empty row.

import { PALETTE_PARAMS, PALETTE_KEY, HARNESS_COLOR, HARNESS_WORD } from './palette.js';

const HARNESSES = ['pi', 'codex', 'cc']; // row order within every model group, top to bottom: Pi, Codex, Claude Code (legend, hover "vs" list and notes follow it; the same order as the harness pills of the cards above)
const PAIRS = [['pi', 'codex'], ['pi', 'cc'], ['cc', 'codex']]; // difference = second − first; the Pi-based pairs first (they carry the paired statistics), Codex before Claude Code as in the rows
const HARNESS_LABEL = { pi: 'Pi', cc: 'Claude Code', codex: 'Codex' };
// ---------- palette: palette.js is the ONE place the harness colours live (shared with the Pareto card's harness frontier) ----------
// Colour encodes the HARNESS, not the model: one colour per harness, identical in every model group, so the eye compares
// harnesses within a model first and then the same three colours across models. Model identity is carried by the bold
// group header and the row order; every other accent on the card is neutral ink or grey. ?palette=a|b|c and
// ?codex=<hex> (see palette.js) switch the variants.
const CROSS_SCOPE = 'arena-cross-family-r1-r3'; // cells that ran through a different serving route
const SHORT = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', sol: 'Sol', luna: 'Luna', kimi: 'Kimi' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const WHISKER = { opacity: 0.12, width: 1, cap: 3 }; // present but almost invisible; one style for both panels (cost x_ci, rate y_ci)
const preModel = PALETTE_PARAMS.get('model'), preHarness = PALETTE_PARAMS.get('harness');

// ---------- helpers ----------
function el(tag, attrs, parent, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function s(tag, attrs, parent, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
const fmtUSD = (v) => '$' + (v >= 0.1 ? v.toFixed(2) : v.toFixed(3));
const fmtNum = (v) => (v >= 0.1 || v === 0 ? v.toFixed(2) : v.toFixed(3));
const fmtBr = (ci, f) => `[${f(ci[0])}, ${f(ci[1])}]`; // plain-bracket interval
const fmtPct = (v) => (v * 100).toFixed(1) + '%';
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '+');
const fmtPP = (d) => sgn(d) + Math.abs(d * 100).toFixed(1) + '%';
const fmtPPn = (d) => sgn(d) + Math.abs(d * 100).toFixed(1);
const fmtCI = (ci) => `[${fmtPPn(ci[0])}, ${fmtPPn(ci[1])}]`;
const fmtMult = (r) => (r >= 10 ? r.toFixed(1) : r >= 0.1 ? r.toFixed(2) : r.toPrecision(3)) + '×';
const fmtChg = (r) => { const p = (r - 1) * 100; const a = Math.abs(p); const txt = a >= 100 ? Math.round(a).toLocaleString('en-US') : a.toFixed(0); return sgn(p) + txt + ' %'; };
const isZero = (v) => Math.abs(v) < 1e-9;
const zeroWord = (ci) => (ci[0] < 0 && ci[1] > 0 && !isZero(ci[0]) && !isZero(ci[1])) ? 'covers 0' : (ci[0] <= 1e-9 && ci[1] >= -1e-9) ? 'touches 0 at a bound' : 'excludes 0';

// one tick chooser for every cost axis: the labelled step is the smallest m x 10^k (m in 1, 1.5, 2, 2.5, 3, 4, 5)
// that covers the value in at most MAX_MAJORS steps; minor gridlines sit at half the labelled step.
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5], MAX_MAJORS = 5;
function niceStep(v) {
  for (let k = -4; k <= 6; k++) for (const m of NICE) {
    const step = +(m * Math.pow(10, k)).toFixed(10);
    if (Math.ceil(v / step - 1e-9) <= MAX_MAJORS) return step;
  }
  return v;
}
// axis descriptor: end, labelled step, gridline ticks, which ticks carry a label, the $ format and the off-axis test
function axisFor(max, step) {
  const minor = step / 2, ticks = [];
  for (let i = 0; i * minor <= max + 1e-9; i++) ticks.push(+(i * minor).toFixed(6));
  const dec = Number.isInteger(step) ? 0 : Number.isInteger(+(step * 10).toFixed(6)) ? 1 : 2;
  return { max, step, minor, ticks,
           major: (t) => Math.round(t / minor) % 2 === 0,
           fmt: (t) => (t === 0 ? '$0' : '$' + t.toFixed(dec)),
           isOff: (c) => c.x > max + 1e-9 };
}
// the default window keeps the published steps ($0.20 labels, $0.10 gridlines); only a fitted axis picks its own step
const defaultAxis = (win) => axisFor(win.max, 0.2);

// ---------- two aligned bar charts ----------
// Shared vertical geometry (top, grpH, hdr, barH, gap) so row i of the left chart sits on exactly the same y as row i of the right chart.
// Both panels carry the same 98 px label column left of their axis (model name heads each group; harness name per row),
// then a linear axis: $ from 0 on the left, 0–100 % on the right.
// Row constants, identical in every sister card so the cards stack cleanly: row r of group g sits at y = top + g·grpH + hdr + r·(barH + gap).
const ROWS = { top: 30, grpH: 74, hdr: 20, barH: 13, gap: 4 };
// Best-in-group mark: within one model, the harness that is best on that panel's own quantity — the cheapest cell on the
// cost panel, the highest resolved rate on the rate panel — has its harness name in the label column written in green
// (BEST_GREEN) at weight 600 AND its bar wrapped by a 2 px green ring; the other two names stay the muted ink and their
// bars are unmarked. "Best" is read off the data, not off the bar, so it stays correct however a panel encodes its
// quantity, and exact ties all carry it.
// The ring is its own rect that WRAPS the bar from outside: the bar's rect expanded by BEST.pad on every side
// (x − 2, y − 2, width + 4, height + 4, rx 3), fill none, stroke-width 2, pointer-events none. A 2 px stroke centred on
// that rect covers y − 3 .. y − 1 and y + h + 1 .. y + h + 3: 3 px of the 4 px row gap, 1 px short of each neighbouring bar.
// The rings are drawn in a layer of their own (<g class="rings">, the plot's last child), above every row group, so a
// ring paints over the gridlines and the group's wash alike and all four edges read the same 2 px. The bar's own x/y/width/height never move, and its own edge stroke — which hover and selection thicken to
// ink — still reads inside the ring's gap. Two adjacent best rows (a tie) have rings that touch; that is accepted. A bar
// clamped to a sliver (a fitted axis can squeeze the cheapest cell below a pixel) is simply wrapped like any other: the
// ring marks the row, the value sits clear of it. The ring is in the node registry, so it follows the axis refit animation.
const BEST = { sw: 2, pad: 2, rx: 3 };
const COST = { host: 'cost', mode: 'cost', W: 556, x0: 98, right: 62, labels: true, lblX: 8, nameX: 8 };
const RATE = { host: 'rate', mode: 'rate', W: 578, x0: 98, right: 62, labels: true, lblX: 8, nameX: 8 };
const fmtTick = (t) => (t === 0 ? '$0' : '$' + t.toFixed(1)); // the default window's $ format, used by the notes prose
const FIT_MS = 300;
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

export function mountHarness(body, spec, ctx) {
  const B = spec.harness;
  // the neutral colours and the best-green follow the active theme; read at every draw
  let INK = '#0b0b0b', INK2 = '#52514e', GRID = '#e1e0d9', AXIS = '#c3c2b7', SURFACE = '#fcfcfb', BEST_GREEN = '#1e7f3c';
  function readTheme() {
    INK = ctx.resolve('@ink'); INK2 = ctx.resolve('@ink2'); GRID = ctx.resolve('@grid');
    AXIS = ctx.resolve('@axis'); SURFACE = ctx.resolve('@surface');
    BEST_GREEN = getComputedStyle(body).getPropertyValue('--hb-best').trim() || BEST_GREEN;
  }

  // ---------- card body: the mockup's DOM, one benchmark ----------
  const bodyEl = el('div', { class: 'hb-body' }, body);
  const left = el('div', { class: 'hb-left' }, bodyEl);
  const costHead = el('div', { class: 'hb-colhead' }, left);
  el('span', {}, costHead, 'Cost per rollout ($)');
  const costHint = el('span', { class: 'hb-hint' }, costHead);
  const hosts = { cost: el('div', {}, left), rate: null };
  const right = el('div', { class: 'hb-right' }, bodyEl);
  el('span', {}, el('div', { class: 'hb-colhead' }, right), 'Resolved rate (%)');
  hosts.rate = el('div', {}, right);
  const notesEl = el('div', { class: 'hb-pane hb-notes' }, body);
  const tableEl = el('div', { class: 'hb-pane hb-table' }, body);
  const legendEl = el('div', { class: 'hb-legend' }, body);
  const footnoteEl = el('p', { class: 'hb-fn' }, body);
  const tip = el('div', { class: 'hb-tip', role: 'tooltip' }, document.body);
  // the notes / table buttons: the card header holds them (charts.js appends `seg` to the card actions)
  const seg = el('div', { class: 'hb-actions' });
  const btnNotes = el('button', { type: 'button', 'aria-pressed': 'false' }, seg, 'notes');
  const btnTable = el('button', { type: 'button', 'aria-pressed': 'false' }, seg, 'table');
  const card = body.closest('.card') || body;

  const state = { pinned: null, hover: null, pane: null };
  // The cost panel's axis: `axis` is what is painted right now (the default window, a fitted window or a frame of the
  // transition); `target` is the settled axis that frame is heading for. Every piece of prose — the header hint, the SVG
  // and row aria-labels, the break mark and the tooltip's broken-bar clause — reads `target`, so no interpolated
  // mid-transition number is ever quoted and no bar is marked broken that will not stay broken.
  const CAXIS = { axis: null, target: null, fitted: null };
  let VIEW = null;

  // ---------- data model ----------
  // Every model: its cells (Pi, Codex, Claude Code) drawn identically; the ordered pairs of the cells it has, difference second − first.
  function buildView() {
    const fp = B.frontier_points || [];
    // the dashboard-wide model order, then any model that only has cells
    const order = B.models.map((m) => m.key);
    for (const p of fp) if (!order.includes(p.model)) order.push(p.model);
    const models = order.map((key) => {
      const m = B.models.find((x) => x.key === key) || { key, label: (fp.find((q) => q.model === key) || {}).model_label || key };
      const cells = {};
      for (const h of HARNESSES) {
        const p = fp.find((q) => q.model === key && q.harness === h);
        if (!p) continue;
        const row = B.rows.find((r) => r.kind === 'pair' && r.model === key && r.harness === h) || null;
        cells[h] = { model: key, harness: h, label: HARNESS_LABEL[h], symbol: p.symbol, x: p.x, y: p.y, x_ci: p.x_ci, y_ci: p.y_ci,
                     cross: p.publication_scope === CROSS_SCOPE, cohort: p.cohort, replicates: p.replicates, row };
      }
      const present = HARNESSES.filter((h) => cells[h]);
      const pairs = PAIRS.filter(([a, b]) => cells[a] && cells[b]).map(([a, b]) => makePair(cells[a], cells[b]));
      const xs = present.map((h) => cells[h].x);
      const M = { key, label: m.label, cells, present, pairs, spread: xs.length ? Math.max(...xs) / Math.min(...xs) : 1 };
      for (const p of pairs) p.model = M;
      return M;
    }).filter((m) => m.present.length);
    const allPairs = models.flatMap((m) => m.pairs);
    const covering = allPairs.filter((p) => p.covers).length;
    const matched = B.rows.filter((r) => r.kind === 'pair' && r.matched === true);
    return { B, models, allPairs, covering, matched, costWin: costWindow(models) };
  }
  const allCells = (models) => models.flatMap((m) => m.present.map((h) => ({ m, c: m.cells[h] })));
  // linear cost window per benchmark: a cell more than 3× the next-costliest cell on the bench goes off-axis (repeated from the top);
  // the axis end is the smallest $0.20 multiple that holds every on-axis cell
  function costWindow(models) {
    const xs = allCells(models).map((z) => z.c.x).sort((a, b) => b - a);
    const off = [];
    while (xs.length > 1 && xs[0] > 3 * xs[1]) off.push(xs.shift());
    const max = +(Math.ceil((xs[0] || 0) / 0.2 - 1e-9) * 0.2).toFixed(6) || 0.2;
    return { max, off, isOff: (c) => c.x > max };
  }
  // a model is fittable when the default window pushes one of its cells off-axis; the fitted end is the nice step multiple at or above its largest cost
  function fitAxisFor(m) {
    if (!m || !m.present.some((h) => VIEW.costWin.isOff(m.cells[h]))) return null;
    const v = Math.max(...m.present.map((h) => m.cells[h].x));
    const step = niceStep(v);
    return axisFor(+(Math.ceil(v / step - 1e-9) * step).toFixed(6), step);
  }
  function makePair(a, b) {
    const row = a.harness === 'pi' && b.row ? b.row : null;
    const dpp = b.y - a.y, ratio = b.x / a.x;
    let dpp_ci, ratio_ci, paired;
    if (row) { dpp_ci = row.rate.ci.slice(); ratio_ci = row.cost.ratio_ci.slice(); paired = true; }
    else {
      dpp_ci = [b.y_ci[0] - a.y_ci[1], b.y_ci[1] - a.y_ci[0]];
      ratio_ci = a.x_ci[0] > 0 && b.x_ci[0] > 0 ? [b.x_ci[0] / a.x_ci[1], b.x_ci[1] / a.x_ci[0]] : null;
      paired = false;
    }
    const covers = dpp_ci[0] <= 1e-9 && dpp_ci[1] >= -1e-9;
    let qual, kind, caveats = [];
    if (a.cross || b.cross) { kind = 'cross'; qual = 'serving route differs · approx. interval (cell means, not paired)'; }
    else if (row) {
      caveats = row.caveats || [];
      if (row.matched && !row.descriptive) { kind = 'controlled'; qual = 'controlled contrast (same cohort and billing route)'; }
      else if (row.matched) { kind = 'descriptive'; qual = 'same cohort and billing route · descriptive, no confirmatory test'; }
      else { kind = 'descriptive'; qual = (row.reasons || []).join(', ') + ' · descriptive'; }
    } else { kind = 'descriptive'; qual = 'cell means, not paired'; }
    return { a, b, key: `${a.harness}-${b.harness}`, dpp, ratio, dpp_ci, ratio_ci, paired, covers, kind, qual, caveats, row };
  }
  function bestHarnesses(m, mode) {
    const val = (h) => (mode === 'cost' ? m.cells[h].x : m.cells[h].y);
    const vs = m.present.map(val);
    const target = mode === 'cost' ? Math.min(...vs) : Math.max(...vs);
    const eps = Math.max(1e-9, Math.abs(target) * 1e-9);
    return m.present.filter((h) => Math.abs(val(h) - target) <= eps);
  }

  // A chart is drawn in two passes, because a rescale animates and nothing may be lost while it runs:
  //   buildChart(C)  — once per view: creates every node and attaches every listener. Node identity then survives the
  //                    whole transition, so a mousedown and its mouseup land on the same rect (the click fires), and a
  //                    keyboard focus stays on the row it was put on (Enter keeps working mid-animation).
  //   layoutChart(C) — on every frame: writes attributes and text only, never structure.
  // Two things are counted by presence rather than by attribute, so they are the only nodes layoutChart creates or
  // removes: the tick-label row (it must not carry blank entries) and the break marks (a fitted panel must contain
  // none at all). Neither is an interaction target, neither can hold focus, and both sit below the row hit areas.
  // NODES[mode] holds the node registry that the second pass writes into.
  const NODES = { cost: null, rate: null };

  function buildChart(C) {
    const host = hosts[C.host];
    host.innerHTML = '';
    NODES[C.mode] = null;
    const V = VIEW, mode = C.mode;
    const { top, grpH, hdr, barH, gap } = ROWS;
    const { W, x0, right } = C;
    const H = top + V.models.length * grpH + 4;
    const x1 = W - right, pw = x1 - x0;
    // aria-label quotes the settled axis, so it is written by the geometry pass
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'data-chart': mode }, host);
    // Gridlines and the zero axis run across each group's three bar rows only, leaving the header band clean.
    const bands = V.models.map((m, i) => ({ y1: top + i * grpH + hdr - 3, y2: top + i * grpH + hdr + HARNESSES.length * barH + (HARNESSES.length - 1) * gap + 3 })); // 3 px beyond the bars on either side
    // Gridline pool, sized for the most ticks this panel can ever ask for: the default window keeps the published
    // $0.20 labels (a long bench axis therefore needs more than five) while a fitted or mid-transition axis is capped
    // at MAX_MAJORS labelled steps, i.e. 2 x MAX_MAJORS + 1 half-step ticks. Unused lines are parked with display:none.
    // grid[tick][group]: each group's lines are created inside that group, right above its wash rect (below), so the
    // gridlines and the zero axis stay visible through the opaque yellow of a selected model and still sit under its bars.
    const maxTicks = mode === 'cost' ? Math.max(2 * MAX_MAJORS + 1, V.defAxis.ticks.length) : 11;
    const grid = [];
    for (let i = 0; i < maxTicks; i++) grid.push([]);
    // The tick labels are direct children of the <svg>, one row above the plot; `plot` is both the node they are
    // inserted before (so the label row always keeps its place in document order) and the group that holds the
    // model groups (each with its wash, its gridlines and its zero axis).
    const plot = s('g', { class: 'plot' }, svg);

    // The rings live in one layer of their own, appended to `plot` after the model groups (below), so a ring paints
    // over BOTH neighbouring bars and over the next group's separator line, and its four edges read the same 2 px.
    const rings = s('g', { class: 'rings', 'pointer-events': 'none' }, null);
    const cells = [];
    V.models.forEach((m, i) => {
      const gy = top + i * grpH;
      const g = s('g', { class: 'grp', 'data-model': m.key }, plot);
      s('rect', { class: 'grpbg', x: 0, y: gy, width: W, height: grpH, rx: 4 }, g);
      // this group's gridlines and zero axis: above the wash, below the separator, labels and bars
      const band = bands[i];
      for (let t = 0; t < maxTicks; t++) grid[t][i] = s('line', { x1: 0, x2: 0, y1: band.y1, y2: band.y2, stroke: GRID, 'stroke-width': 1 }, g);
      s('line', { x1: x0, x2: x0, y1: band.y1, y2: band.y2, stroke: AXIS, 'stroke-width': 1 }, g);
      if (i > 0) s('line', { x1: 4, x2: W - 4, y1: gy, y2: gy, stroke: GRID }, g);
      const cy0 = gy + hdr; // the first bar starts where the header band ends
      const best = bestHarnesses(m, mode); // cheapest on the cost panel, highest resolved rate on the rate panel; ties included
      if (C.labels) {
        const name = s('text', { class: 'mname', x: C.lblX, y: gy + 14, 'font-size': 12, 'font-weight': 600, fill: INK,
                                 role: 'button', tabindex: 0, 'aria-label': `${m.label}: highlight this model in both charts` }, g, m.label);
        name.addEventListener('click', () => togglePin(m.key, null));
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePin(m.key, null); } });
        name.addEventListener('mouseenter', () => setHover(m.key, null));
        name.addEventListener('mouseleave', () => clearHover());
      }
      HARNESSES.forEach((h, j) => {
        const c = m.cells[h];
        if (!c) return; // no cell on this harness: the row slot stays empty
        const cy = cy0 + j * (barH + gap), ymid = cy + barH / 2;
        const gb = s('g', { class: `bar ${h}`, 'data-harness': h }, g);
        const fill = HARNESS_COLOR[h]; // same colour for this harness in every model group
        const isBest = best.includes(h);
        if (C.labels) { // label column: harness name left of the axis (nothing is drawn inside the bar); the panel's best harness in green
          s('text', { class: isBest ? 'hlabel best' : 'hlabel', x: C.nameX, y: ymid + 3.6, 'font-size': 10.5, 'font-weight': isBest ? 600 : 500,
                      fill: isBest ? BEST_GREEN : INK2, 'data-best': isBest ? 'true' : null }, gb, c.label);
        }
        // width (bar) and x (value) are the only axis-dependent attributes; they are listed here at creation so the
        // attribute order of a node never depends on when it was last written, and filled in by layoutChart.
        const rect = s('rect', { class: 'barrect', x: x0, y: cy, width: 1, height: barH, rx: 2, fill, 'data-color': fill,
                                 stroke: fill, 'stroke-width': 0.6, 'stroke-opacity': 0.55 }, gb);
        // 95 % whisker on every bar of both panels (x_ci on the cost panel, y_ci on the rate panel): 1 px ink at 12 % opacity
        // with 3 px caps, centred on the bar, so it is present but almost invisible. Its endpoints are axis-dependent, so
        // they are written by layoutChart (the cost whiskers follow the axis refit frame by frame; the rate axis never moves).
        // An interval that runs past the axis end is clipped there: the line stops at the axis end and that end carries no
        // cap (a cap would claim the interval ends where it does not).
        const gw = s('g', { class: 'whisker', stroke: INK, 'stroke-width': WHISKER.width, 'stroke-opacity': WHISKER.opacity }, gb);
        const wLine = s('line', { x1: x0, x2: x0, y1: ymid, y2: ymid }, gw);
        const wCapLo = s('line', { x1: x0, x2: x0, y1: ymid - WHISKER.cap, y2: ymid + WHISKER.cap }, gw);
        const wCapHi = s('line', { x1: x0, x2: x0, y1: ymid - WHISKER.cap, y2: ymid + WHISKER.cap }, gw);
        // the value alone sits at the tip (a surface halo cuts the whisker beneath it); an off-axis bar's tip reads "$14.21 →"
        const val = s('text', { class: 'val', x: 0, y: ymid + 3.6, 'text-anchor': 'start', 'font-size': 10.5, 'font-weight': 600, fill: INK }, gb, '');
        // hit area (whole row): geometry is axis-independent, so this rect is created once and never replaced
        const hit = s('rect', { class: 'hit', x: 4, y: cy - 1, width: W - 4, height: barH + gap, tabindex: 0, role: 'button' }, gb);
        // best on this panel's quantity: one extra rect wrapping the bar from outside, written by layoutChart, never the bar
        // itself. It is created here, in row order, but lives in the `rings` layer (not in this row's group), see above.
        const bestRect = isBest
          ? s('rect', { class: 'bestrect', 'data-model': m.key, 'data-harness': h,
                        x: x0 - BEST.pad, y: cy - BEST.pad, width: 1 + 2 * BEST.pad, height: barH + 2 * BEST.pad, rx: BEST.rx,
                        fill: 'none', stroke: BEST_GREEN, 'stroke-width': BEST.sw, 'pointer-events': 'none' }, rings)
          : null;
        const rec = { m, c, h, gb, rect, val, hit, bestRect, whisker: { line: wLine, capLo: wCapLo, capHi: wCapHi }, cy, ymid, brk: null, tipX: x0 };
        hit.addEventListener('mouseenter', (e) => { setHover(m.key, h); showTip(tipHTML(m, c), e); });
        // A click hides the tooltip and drops the hover while the pointer is still on the row. This rect is never
        // replaced, so no second mouseenter is coming: the next move over the row re-establishes both.
        hit.addEventListener('mousemove', (e) => {
          const live = state.hover && state.hover.model === m.key && state.hover.harness === h;
          if (live && tip.style.display !== 'none') moveTip(e);
          else { setHover(m.key, h); showTip(tipHTML(m, c), e); }
        });
        hit.addEventListener('mouseleave', () => { clearHover(); hideTip(); });
        hit.addEventListener('click', () => togglePin(m.key, h));
        hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePin(m.key, h); } });
        hit.addEventListener('focus', () => { const r = host.getBoundingClientRect(); setHover(m.key, h); showTip(tipHTML(m, c), { clientX: r.left + rec.tipX, clientY: r.top + rec.ymid }); });
        hit.addEventListener('blur', () => { clearHover(); hideTip(); });
        cells.push(rec);
      });
    });
    plot.appendChild(rings); // last child of the plot: above every group, its bars and its separator lines
    NODES[mode] = { svg, plot, rings, grid, cells, labels: [], x0, x1, pw };
  }

  // geometry pass: attributes and text only (plus the tick labels and break marks noted above)
  function layoutChart(C) {
    const R = NODES[C.mode];
    if (!R) return;
    const V = VIEW, mode = C.mode, ax = CAXIS.axis;
    const tax = (mode === 'cost' && CAXIS.target) || ax; // settled axis: what the labels and the tooltip talk about
    const { x0, x1, pw } = R;
    let scale, ticks, tickFmt, major;
    if (mode === 'cost') {
      scale = (v) => x0 + Math.max(0, Math.min(1, v / ax.max)) * pw;
      ticks = ax.ticks; // half-step gridlines; every second one is a labelled major
      major = ax.major;
      tickFmt = ax.fmt;
    } else {
      scale = (v) => x0 + Math.max(0, Math.min(1, v)) * pw;
      ticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]; // 10 % gridlines; every 20 % labelled
      major = (t) => Math.round(t * 100) % 20 === 0;
      tickFmt = (t) => Math.round(t * 100) + '%';
    }
    // "off-axis" is judged against the settled axis, so a fitted panel carries no break mark at all and a transition
    // never marks a bar broken that is about to fit
    const hasOff = mode === 'cost' && allCells(V.models).some((z) => tax.isOff(z.c));
    R.svg.setAttribute('aria-label', mode === 'cost'
      ? `Cost per rollout per model and harness (linear axis, $0 to ${tax.fmt(tax.max)}, whisker = 95% interval${hasOff ? '; a broken bar runs beyond the axis end' : ''}${CAXIS.fitted ? `; axis fitted to ${CAXIS.fitted.label}` : ''})`
      : 'Resolved rate per model and harness (linear axis, 0 to 100%, whisker = 95% interval)');
    for (let i = 0; i < R.grid.length; i++) {
      const row = R.grid[i];
      if (i >= ticks.length) { for (const ln of row) ln.setAttribute('display', 'none'); continue; }
      const px = scale(ticks[i]), stroke = major(ticks[i]) ? AXIS : GRID;
      for (const ln of row) { ln.setAttribute('x1', px); ln.setAttribute('x2', px); ln.setAttribute('stroke', stroke); ln.removeAttribute('display'); }
    }
    // one row of tick labels on the major gridlines; minor gridlines unlabelled
    const majors = ticks.filter((t) => major(t));
    majors.forEach((t, i) => {
      const px = scale(t), first = t === ticks[0];
      let n = R.labels[i];
      if (!n) { n = s('text', { x: px, y: ROWS.top - 8, 'text-anchor': 'middle', 'font-size': 10, fill: INK2 }, null, ''); R.svg.insertBefore(n, R.plot); R.labels[i] = n; }
      n.setAttribute('x', first ? px - 2 : px);
      n.setAttribute('text-anchor', first ? 'start' : 'middle');
      const txt = tickFmt(t);
      if (n.textContent !== txt) n.textContent = txt;
    });
    while (R.labels.length > majors.length) { const n = R.labels.pop(); if (n.parentNode) n.parentNode.removeChild(n); }

    for (const rec of R.cells) {
      const c = rec.c, m = rec.m;
      const v = mode === 'cost' ? c.x : c.y;
      const clipped = mode === 'cost' && ax.isOff(c);  // beyond the axis end of the frame being painted
      const off = mode === 'cost' && tax.isOff(c);     // beyond the settled axis end: what the labels report
      const brk = clipped && off;                      // break mark only where the bar is clipped and will stay clipped
      const tipX = clipped ? x1 : scale(v);
      rec.tipX = tipX;
      const bw = Math.max(tipX - x0, 1);
      rec.rect.setAttribute('width', bw);
      // the 95 % whisker: both ends mapped through this frame's axis (the cost whiskers rescale with the bars); an end past
      // the axis end is clipped to it and loses its cap. The value at the tip is placed from the bar alone, never the whisker.
      const ci = mode === 'cost' ? c.x_ci : c.y_ci;
      const wmax = mode === 'cost' ? ax.max : 1;
      const wlo = scale(ci[0]), whi = scale(ci[1]);
      const loClip = ci[0] > wmax + 1e-9, hiClip = ci[1] > wmax + 1e-9;
      const Wk = rec.whisker;
      Wk.line.setAttribute('x1', wlo); Wk.line.setAttribute('x2', whi);
      Wk.capLo.setAttribute('x1', wlo); Wk.capLo.setAttribute('x2', wlo);
      Wk.capHi.setAttribute('x1', whi); Wk.capHi.setAttribute('x2', whi);
      if (loClip) Wk.capLo.setAttribute('display', 'none'); else Wk.capLo.removeAttribute('display');
      if (hiClip) Wk.capHi.setAttribute('display', 'none'); else Wk.capHi.removeAttribute('display');
      Wk.line.setAttribute('data-clipped', hiClip ? 'hi' : loClip ? 'lo' : 'none');
      const valX = tipX + 6; // the ring's outer edge ends at tip + 3, so the value always sits clear of it
      if (rec.bestRect) { // the ring follows the bar's rect, expanded by BEST.pad on every side; only its width is axis-dependent
        const R2 = rec.bestRect;
        R2.setAttribute('x', x0 - BEST.pad); R2.setAttribute('y', rec.cy - BEST.pad);
        R2.setAttribute('width', bw + 2 * BEST.pad); R2.setAttribute('height', ROWS.barH + 2 * BEST.pad);
        R2.setAttribute('rx', BEST.rx);
      }
      rec.val.setAttribute('x', valX);
      const valTxt = mode === 'cost' ? fmtUSD(c.x) + (brk ? ' →' : '') : fmtPct(c.y);
      if (rec.val.textContent !== valTxt) rec.val.textContent = valTxt;
      if (brk && !rec.brk) { // break mark: a surface-coloured gap crossed by two short diagonal slashes near the bar's end
        const bx = x1 - 13, yA = rec.cy - 1.5, yB = rec.cy + ROWS.barH + 1.5;
        const poly = s('polygon', { class: 'brk', points: `${bx - 3},${yB} ${bx + 3},${yA} ${bx + 9},${yA} ${bx + 3},${yB}`, fill: SURFACE });
        const lA = s('line', { x1: bx - 3, y1: yB, x2: bx + 3, y2: yA, stroke: INK, 'stroke-width': 1.2 });
        const lB = s('line', { x1: bx + 3, y1: yB, x2: bx + 9, y2: yA, stroke: INK, 'stroke-width': 1.2 });
        rec.brk = [poly, lA, lB];
        for (const n of rec.brk) rec.gb.insertBefore(n, rec.val); // stays under the value and under the row's hit area
      } else if (!brk && rec.brk) {
        for (const n of rec.brk) if (n.parentNode) n.parentNode.removeChild(n);
        rec.brk = null;
      }
      const aria = `${m.label} on ${c.label}: ${fmtUSD(c.x)} per rollout${off ? ' (beyond the axis end)' : ''}, ${fmtPct(c.y)} resolved`;
      if (rec.hit.getAttribute('aria-label') !== aria) rec.hit.setAttribute('aria-label', aria);
    }
    // header hint: the break-mark note while the default window is in force, the fit note while an axis is fitted
    if (mode === 'cost') costHint.textContent = CAXIS.fitted
      ? `axis fitted to ${CAXIS.fitted.label} · click again to reset`
      : hasOff ? `broken bar: beyond the ${tax.fmt(tax.max)} axis end` : 'linear from $0';
  }

  // ---------- highlight state (applies to both charts at once) ----------
  const outlineBar = (model, harness, width) => body.querySelectorAll(`.grp[data-model="${model}"] .bar.${harness} .barrect`).forEach((r) => { r.setAttribute('stroke', INK); r.setAttribute('stroke-width', width); r.setAttribute('stroke-opacity', 1); });
  function applyHighlight() {
    body.querySelectorAll('.grp').forEach((g) => {
      const k = g.getAttribute('data-model');
      g.classList.toggle('focus', !!state.pinned && k === state.pinned.model);
      g.classList.toggle('hov', !!state.hover && k === state.hover.model && !(state.pinned && k === state.pinned.model));
    });
    body.querySelectorAll('.bar .barrect').forEach((r) => { r.setAttribute('stroke', r.getAttribute('data-color')); r.setAttribute('stroke-width', 0.6); r.setAttribute('stroke-opacity', 0.55); });
    if (state.pinned && state.pinned.harness) outlineBar(state.pinned.model, state.pinned.harness, 1.5);
    if (state.hover && state.hover.harness) outlineBar(state.hover.model, state.hover.harness, 1.2);
  }
  function setHover(model, harness) { state.hover = { model, harness }; applyHighlight(); }
  function clearHover() { state.hover = null; applyHighlight(); }
  function togglePin(model, harness) {
    const p = state.pinned;
    if (p && p.model === model) state.pinned = null;           // the same model again clears it (name, row or bar)
    else state.pinned = { model, harness };                    // a different model switches directly
    state.hover = null;
    hideTip();
    syncAxis(true);
  }
  function clearPin() {
    if (!state.pinned) { state.hover = null; hideTip(); applyHighlight(); return; }
    state.pinned = null; state.hover = null; hideTip(); syncAxis(true);
  }

  // ---------- axis fit: the selected model's off-axis cell is brought on-axis, and every cost bar rescales with it ----------
  const ANIM = { raf: 0 };
  function axisTarget() {
    const m = state.pinned ? VIEW.models.find((x) => x.key === state.pinned.model) : null;
    const fit = m ? fitAxisFor(m) : null;
    return fit ? { axis: fit, fitted: m } : { axis: VIEW.defAxis, fitted: null };
  }
  // A frame writes geometry only: no node is created, moved or removed, so a click that straddles the transition keeps
  // its target, the focused row keeps focus, and Esc, Enter or a second click land exactly as they do at rest.
  function paintAxis(axis, fitted) { CAXIS.axis = axis; CAXIS.fitted = fitted; layoutChart(COST); }
  function syncAxis(animate) {
    if (ANIM.raf) { cancelAnimationFrame(ANIM.raf); ANIM.raf = 0; } // a new selection takes over from wherever the last one got to
    const t = axisTarget(), from = CAXIS.axis.max;
    CAXIS.target = t.axis; // the settled axis is published before the first frame, so every label quotes the end state
    applyHighlight();      // the wash and the outlines follow the selection at once, whether or not the axis moves
    const same = Math.abs(t.axis.max - from) < 1e-9;
    if (same && CAXIS.fitted === t.fitted) return;                        // no rescale: ordinary highlight only
    if (same || !animate || reduceMotion()) { paintAxis(t.axis, t.fitted); return; } // nothing to interpolate: settle now
    const to = t.axis.max, t0 = performance.now();
    const frame = (now) => {
      const u = Math.min(1, (now - t0) / FIT_MS);
      if (u >= 1) { ANIM.raf = 0; paintAxis(t.axis, t.fitted); return; } // the endpoint is the stored descriptor, so a restore is exact
      const mx = from + (to - from) * easeInOut(u);
      paintAxis(axisFor(mx, niceStep(mx)), t.fitted);
      ANIM.raf = requestAnimationFrame(frame);
    };
    ANIM.raf = requestAnimationFrame(frame);
  }
  // "4 Claude Code runs hit the 100-turn cap (4 unsolved)" → "4 of 90 runs hit the 100-turn cap"
  const capNote = (pr) => {
    const c = pr.caveats.find((t) => /turn cap/.test(t));
    if (!c) return '';
    const mm = c.match(/^(\d+)\s.*?runs hit the (\d+)-turn cap/);
    const n = pr.row ? (pr.row.tasks || 30) * (pr.b.replicates || 3) : 90;
    return mm ? `${mm[1]} of ${n} runs hit the ${mm[2]}-turn cap` : c;
  };

  // ---------- tooltip: at most four short lines; the two that repeat bar-tip numbers are demoted (class dup), the comparison line keeps full size and ink ----------
  function tipHTML(m, c) {
    const tax = CAXIS.target || CAXIS.axis; // the settled axis, never a transition frame
    const lines = [`<div class="t">${m.label} · ${c.label}</div>`,
      // lines 2–3 repeat the numbers already printed at the bar tips (the intervals are not on the bars, so they stay): demoted to 11 px muted
      `<div class="dup">${fmtPct(c.y)} resolved ${fmtBr(c.y_ci, (v) => (v * 100).toFixed(1))}</div>`,
      `<div class="dup">${fmtUSD(c.x)} per rollout ${fmtBr(c.x_ci, fmtNum)}${tax.isOff(c) ? ' · bar broken: beyond the ' + tax.fmt(tax.max) + ' axis end' : ''}</div>`];
    // this cell against the model's other two harnesses (this − other; this ÷ other)
    const others = m.present.filter((h) => h !== c.harness).map((h) => { const o = m.cells[h]; return `vs ${o.label} ${fmtPP(c.y - o.y)}, ${fmtMult(c.x / o.x)} cost`; });
    let l4 = `<span class="r">${others.join(' · ')}</span>`;
    const pr = m.pairs.find((p) => p.b.harness === c.harness && p.a.harness === 'pi');
    const cn = pr ? capNote(pr) : '';
    if (cn) l4 += ` · <span class="cap">${cn}</span>`;
    lines.push(`<div>${l4}</div>`);
    return lines.join('');
  }
  function showTip(html, e) { tip.innerHTML = html; tip.style.display = 'block'; moveTip(e); }
  function moveTip(e) {
    const pad = 14, w = tip.offsetWidth, hgt = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + hgt > window.innerHeight - 8) y = e.clientY - hgt - pad;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  // ---------- legend, footnote, notes, table ----------
  function swatch(fill) {
    const svg = s('svg', { viewBox: '0 0 16 12', 'aria-hidden': 'true' });
    s('rect', { x: 1, y: 2.5, width: 14, height: 7, rx: 1.5, fill, stroke: fill, 'stroke-width': 0.6, 'stroke-opacity': 0.55 }, svg);
    return svg;
  }
  // legend key for the best ring: a hollow green ring around a small neutral bar, the same 2 px stroke as on the chart
  function ringSwatch() {
    const svg = s('svg', { viewBox: '0 0 16 12', 'aria-hidden': 'true' });
    s('rect', { x: 4, y: 3.5, width: 8, height: 5, rx: 1, fill: GRID }, svg);
    s('rect', { x: 2, y: 1.5, width: 12, height: 9, rx: 2, fill: 'none', stroke: BEST_GREEN, 'stroke-width': 1.6 }, svg);
    return svg;
  }
  // legend: the three harness swatches (row order) and one ring item that covers both best-in-group marks
  function renderLegend() {
    const L = legendEl;
    L.innerHTML = '';
    const item = (node, text) => { const d = el('span', { class: 'item' }, L); if (node) d.appendChild(node); el('span', {}, d, text); };
    for (const h of HARNESSES) item(swatch(HARNESS_COLOR[h]), HARNESS_LABEL[h]); // colour = harness, the same in every model group
    item(ringSwatch(), 'green ring / green label = model\'s best (cheapest; highest rate)');
  }
  // the muted line under the legend: what the bars and the whiskers encode (the serving-route note lives in the notes pane and the table)
  function renderFootnote() {
    const fn = footnoteEl;
    fn.innerHTML = '';
    el('span', {}, fn, 'bars: cost per rollout and resolved rate · whisker = 95 % interval · ');
    el('span', { class: 'cue' }, fn, '← is better');
    el('span', {}, fn, ' for cost, ');
    el('span', { class: 'cue' }, fn, '→ is better');
    el('span', {}, fn, ' for accuracy');
  }
  function renderNotes() {
    const n = notesEl;
    n.innerHTML = '';
    const V = VIEW;
    const short = (key) => SHORT[key] || (V.models.find((m) => m.key === key) || {}).label || key;
    const byH = {};
    for (const r of V.matched) (byH[r.harness] = byH[r.harness] || []).push(short(r.model));
    const matchedTxt = HARNESSES.filter((h) => byH[h]).map((h) => `${byH[h].join(', ')} × ${HARNESS_LABEL[h]}`).join('; ');
    const descr = V.allPairs.filter((p) => p.kind === 'descriptive' && p.row && p.row.reasons.length).map((p) => `${short(p.model.key)} ${p.a.label} → ${p.b.label} (${p.row.reasons.join(', ')})`);
    const win = V.costWin;
    const offTxt = win.off.length
      ? win.off.map((x) => { const z = allCells(V.models).find((q) => q.c.x === x); return `${z.m.label} × ${z.c.label} (${fmtUSD(x)})`; }).join(', ')
      : 'none';
    el('p', {}, n, `Two bar charts share one set of rows: for each model, its three harnesses in the rows Pi, Codex, Claude Code (top to bottom), 30 tasks × 3 runs per cell. Left: cost per rollout on a linear axis from $0 in $0.20 steps ($0.10 minor gridlines) to a per-benchmark end, the smallest $0.20 multiple that holds every cell except off-axis outliers (${fmtTick(win.max)} here). A cell costing more than 3× the next-costliest cell on the benchmark is off-axis: its bar runs to the axis end, carries a break mark and reads its value at the tip with an arrow; on this benchmark: ${offTxt}. Right: resolved rate on a linear 0–100% axis (labels every 20%, gridlines every 10%), the same rows at the same heights. Every bar on both charts carries its 95% task-bootstrap whisker (the cost interval on the left, the resolved-rate interval on the right), 1 px ink drawn at ${Math.round(WHISKER.opacity * 100)}% opacity with 3 px caps so the bar reads first and the interval stays available; a cost interval that runs past the axis end is clipped there (the line stops at the axis end without a cap) and rescales with the bars when the axis is fitted. Each chart has its own 98 px label column: the model name heads each group and the harness name sits beside each bar; only the value is written at a bar\'s tip; a bar\'s colour is its harness (${HARNESSES.map((h) => `${HARNESS_LABEL[h]} ${HARNESS_WORD[h]} ${HARNESS_COLOR[h]}`).join(', ')}; palette "${PALETTE_KEY}" of a/b/c, switched with ?palette=, and ?codex=<hex> overrides the Codex purple), the same three colours in every model group, so the harness comparison reads within a model and then across models; palette a is the default (Pi the lighter warm grey), b tries Pi in pi.dev\'s grey-blue, c deepens the purple and the orange. On each panel the model\'s best cell — the cheapest on the left, the highest resolved rate on the right, ties included, judged from the data rather than the bar — has its harness name in the label column written in green (${BEST_GREEN}, weight 600) and its bar wrapped by a 2 px green (${BEST_GREEN}) ring drawn 2 px outside the bar on every side, in a layer above the neighbouring rows so its four edges read alike and following the bar through an axis fit; the other two names stay muted and their bars carry no ring. The legend\'s swatches follow the row order.`);
    el('p', {}, n, 'Hover a bar: its twin in the other chart is outlined too, the model\'s rows get a faint yellow wash, and a four-line tooltip names the cell, repeats its rate and cost in small muted type with the 95% intervals the bars do not show, and sets the cell against the model\'s other two harnesses (this − other in %; this ÷ other in cost). Click a bar, a harness label or a model name to keep that model\'s rows highlighted in light yellow (#fff3b0) in both charts; click again, press Esc or click the card background to clear. Selecting a model whose cell is off-axis also fits the cost axis to that model: the axis end becomes the nice step multiple at or above its largest cost, the bar is drawn complete with no break mark, and every other cost bar is redrawn on that same axis, so the panel is never mixed-scale; the header says which model the axis is fitted to, and clearing the selection restores the default window. The resolved-rate axis never changes.');
    el('p', {}, n, `Intervals: ${matchedTxt ? 'the controlled contrasts (same cohort and billing route: ' + matchedTxt + ')' : 'no pair'} and the other Pi-based direct-route pairs${descr.length ? ' (descriptive, cohort or billing route differs: ' + descr.join('; ') + ')' : ''} carry paired per-task statistics (runs averaged within task, task-bootstrap 95% intervals); these drive the table\'s "cover 0" column. Every other pair uses the ratio or difference of cell means with an approximate interval formed from the two cells\' 95% intervals (difference of the bounds, not paired). The whiskers on both charts are the per-cell intervals, not the paired ones.`);
    el('p', {}, n, 'Serving route: Codex on the Claude models and Kimi, and Claude Code on Sol, Luna and Kimi (3 reps each) ran through a different serving route from the Pi cells, so their costs are not directly comparable: on the 13 SWE-bench cells that exist on both routes, that route billed 1.3–1.5× the other for the Claude models and 5–6× for Pi × Sol/Luna, with no detectable resolved-rate difference. Bars are styled by harness only; the route is stated here and in the table, not on the card.');
    const cav = V.allPairs.filter((p) => p.caveats.length);
    const zeroLo = allCells(V.models).filter((z) => z.c.x_ci && z.c.x_ci[0] === 0);
    if (zeroLo.length) el('p', {}, n, zeroLo.map((z) => `${z.m.label} × ${z.c.label}`).join(', ') + ': the cost interval\'s lower bound is reported as $0.00 because the task bootstrap could not resolve it with 3 runs per task; the upper bound stands.');
    if (cav.length) el('p', {}, n, cav.map((p) => `${p.model.label} (${p.b.label}): ${p.caveats.join('; ')}.`).join(' '));
    if (V.matched.length && V.matched.every((r) => r.descriptive)) el('p', {}, n, 'All Terminal-Bench contrasts are descriptive common-n30 estimates with no confirmatory test. The Claude Code cells ran later than the Pi cells and only Claude Code had the 100-turn cap.');
  }

  function renderTable() {
    const t = tableEl;
    t.innerHTML = '';
    const tbl = el('table', {}, t);
    const tr = el('tr', {}, el('thead', {}, tbl));
    for (const hdr of ['Model', 'Pair (second − first)', 'First $', 'Second $', 'Cost change', 'Cost ×', 'First resolved', 'Second resolved', 'Δ %', 'Δ interval', 'Qualifier']) el('th', {}, tr, hdr);
    const tb = el('tbody', {}, tbl);
    for (const m of VIEW.models) for (const pr of m.pairs) {
      const r = el('tr', {}, tb);
      [m.label, `${pr.a.label} → ${pr.b.label}`, fmtUSD(pr.a.x), fmtUSD(pr.b.x), fmtChg(pr.ratio), fmtMult(pr.ratio), fmtPct(pr.a.y), fmtPct(pr.b.y), fmtPP(pr.dpp),
       (pr.paired ? 'paired 95% CI ' : 'approx. ') + fmtCI(pr.dpp_ci) + ' (' + zeroWord(pr.dpp_ci) + ')', pr.qual + (pr.caveats.length ? '; ' + pr.caveats.join('; ') : '')]
        .forEach((v) => el('td', {}, r, v));
    }
  }

  // ---------- controls ----------
  function render() {
    readTheme();
    VIEW = buildView();
    state.hover = null;
    if (state.pinned && !VIEW.models.find((m) => m.key === state.pinned.model)) state.pinned = null;
    VIEW.defAxis = defaultAxis(VIEW.costWin);
    if (ANIM.raf) { cancelAnimationFrame(ANIM.raf); ANIM.raf = 0; }
    const t0 = axisTarget(); CAXIS.axis = t0.axis; CAXIS.target = t0.axis; CAXIS.fitted = t0.fitted;
    // a view change (the first paint, a theme change) rebuilds both structures; every later axis move is layout only
    buildChart(COST); buildChart(RATE); layoutChart(COST); layoutChart(RATE); applyHighlight();
    renderLegend(); renderFootnote(); renderNotes(); renderTable();
    applyPane();
  }
  function applyPane() {
    hideTip();
    bodyEl.classList.toggle('hide', !!state.pane);
    notesEl.classList.toggle('show', state.pane === 'notes');
    tableEl.classList.toggle('show', state.pane === 'table');
    btnNotes.setAttribute('aria-pressed', String(state.pane === 'notes'));
    btnTable.setAttribute('aria-pressed', String(state.pane === 'table'));
  }
  btnNotes.addEventListener('click', () => { state.pane = state.pane === 'notes' ? null : 'notes'; applyPane(); });
  btnTable.addEventListener('click', () => { state.pane = state.pane === 'table' ? null : 'table'; applyPane(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearPin(); });
  // clicking the card background (not a bar row, a model name or a control) clears the selection
  card.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.hit, .mname, button, a')) return;
    if (state.pinned) clearPin();
  });
  // Belt and braces for the hover state: a row's own mouseleave clears it (the rects persist across a rescale, so that
  // event is not lost), and this catches any hover left behind without one — a pointer move off the rows clears the
  // wash and the tooltip, so neither outlives the pointer.
  document.addEventListener('mousemove', (e) => {
    if (e.target && e.target.closest && e.target.closest('.hit, .mname')) return;
    if (state.hover) clearHover();
    if (tip.style.display !== 'none') hideTip();
  });

  if (preModel && B.models.some((m) => m.key === preModel)) state.pinned = { model: preModel, harness: HARNESSES.includes(preHarness) ? preHarness : null };

  let shown = false;
  return {
    seg,
    show() {
      if (shown) return;
      shown = true;
      render();
    },
    rerender() {
      // theme change: redraw in place with the new neutrals; the selection and the open pane stay
      if (shown) render();
    },
  };
}
