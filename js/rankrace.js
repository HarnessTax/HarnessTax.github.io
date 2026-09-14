// Rank-race cards (a "bar chart race" over the cost-scaling card's curves).
//
// One horizontal bar per system (model × harness), the bar in the model's
// colour with the harness badge of icons.js at its head and the label
// "Model · Harness" to the left. Every system is on the board from the first
// frame; one shared sweep value rises and every bar is read off the system's
// exact cumulative curve (cheapest rollouts first: x cumulative cost per
// rollout, y cumulative resolved rate, spec.race.systems[*].curve):
//   accuracy-rank-race  the sweep is a shared spend per rollout; a bar is the
//                       system's cumulative resolved rate within that spend
//                       (the height of its cost-scaling curve there), ranked
//                       highest first; n/a until it has a solve in budget
//   cost-rank-race      the sweep is a resolved-rate target; a bar is the
//                       cheapest-first spend at which the system's curve
//                       reaches the target, ranked cheapest first; n/a once
//                       the target is beyond the system's resolved rate
// Bars grow with the sweep and rows slide to their new rank; the systems
// without a value follow the ranked ones, faded, ordered by how close they
// are to qualifying. The card autoplays when it scrolls into view (once), has
// play / pause / replay and a scrubber the reader can drag; dragging pauses
// the sweep. prefers-reduced-motion shows the finished board and drops the
// transitions.
//
// Everything here is presentation: the curves, endpoints and intervals arrive
// in spec.race (dashboard/rankrace.py); the client only looks values up.

import { h, s } from './pills.js';
import { badge } from './icons.js';
import { textWidth } from './labels.js';

const ROW = 25;        // row pitch (px); the CSS --rr-row must match
const BADGE_R = 9;     // badge radius (22 px box with its rim)
const SWEEP_MS = 14000;
const EASE = 1.7;      // spend eased like the cost-scaling story, so the cheap end gets time
const MAIN_SHARE = 0.9; // share of the spend sweep spent on the cost-scaling axis; the rest runs to a runaway endpoint
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5], MAX_MAJORS = 5;
const EPS = 1e-9;
// the label and value fonts of main.css (.rr-name, .rr-name b, .rr-val), measured so the
// label column is exactly as wide as the widest "Model · Harness" and the value reserve
// exactly as wide as the widest value: no slack between the rank and the names, more bar
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const NAME_MODEL_FONT = `600 11.5px ${FONT}`;
const NAME_HARNESS_FONT = `400 11.5px ${FONT}`;
const VALUE_FONT = `600 11px ${FONT}`;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const fmtUSD = (v) => '$' + (v >= 0.1 ? v.toFixed(2) : v.toFixed(3));
const fmtPct1 = (v) => (v * 100).toFixed(1) + '%';
const fmtCI = (ci, f) => (Array.isArray(ci) && ci.length === 2 ? ` [${f(ci[0])}, ${f(ci[1])}]` : '');

// the labelled step is the smallest m × 10^k (m in NICE) that covers the value
// in at most MAX_MAJORS steps (the harness card's tick chooser)
function niceStep(v) {
  for (let k = -4; k <= 6; k++) for (const m of NICE) {
    const step = +(m * Math.pow(10, k)).toFixed(10);
    if (Math.ceil(v / step - EPS) <= MAX_MAJORS) return step;
  }
  return v || 1;
}

// cost axis: linear from $0 to the nice-step multiple holding every on-axis
// system; a system more than 3× the next-costliest is off-axis (harness card rule)
function costAxis(values) {
  const xs = values.slice().sort((a, b) => b - a);
  const off = [];
  while (xs.length > 1 && xs[0] > 3 * xs[1]) off.push(xs.shift());
  const top = xs[0] || 0;
  const step = niceStep(top);
  const max = +(Math.ceil(top / step - EPS) * step).toFixed(6) || step;
  const ticks = [];
  for (let i = 0; i * step <= max + EPS; i++) ticks.push(+(i * step).toFixed(6));
  const dec = Number.isInteger(step) ? 0 : Number.isInteger(+(step * 10).toFixed(6)) ? 1 : 2;
  return { max, ticks, off, fmt: (t) => (t === 0 ? '$0' : '$' + t.toFixed(dec)), isOff: (v) => v > max + EPS };
}
const RATE_AXIS = {
  max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], off: [],
  fmt: (t) => Math.round(t * 100) + '%', isOff: () => false,
};

// ---- exact staircase lookups (x and y are non-decreasing, x[0] = y[0] = 0) ----
// the last ranked prefix whose spend fits the budget: its resolved share and size
function atSpend(c, B) {
  const xs = c.curve.x, ys = c.curve.y;
  if (B < xs[0] - EPS) return { y: 0, k: 0, done: false };
  let lo = 0, hi = xs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (xs[mid] <= B + EPS) lo = mid; else hi = mid - 1; }
  return { y: ys[lo], k: lo, done: lo === xs.length - 1 };
}
// the first ranked prefix whose resolved share reaches the target, or null when none does
function toReach(c, a) {
  const xs = c.curve.x, ys = c.curve.y;
  if (ys[ys.length - 1] < a - EPS) return null;
  let lo = 0, hi = ys.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ys[mid] >= a - EPS) hi = mid; else lo = mid + 1; }
  return { x: xs[lo], k: lo };
}
// the spend at which the curve first reached the share y (tie-break: cheaper first)
const reachedAt = (c, y) => { const r = toReach(c, y); return r ? r.x : Infinity; };
const label = (c) => `${c.model_label} · ${c.harness_label}`;

export function mountRankRace(body, spec, ctx) {
  const R = spec.race;
  const bySpend = R.sweep.key === 'cost'; // accuracy board: spend sweeps, bars are resolved rates
  const systems = R.systems.map((c) => ({ ...c })).filter((c) => c.curve && c.curve.x && c.curve.x.length > 1);
  const N = systems.length;
  const fmtSweep = bySpend ? fmtUSD : fmtPct1;
  const fmtRank = bySpend ? fmtPct1 : fmtUSD;
  const axis = bySpend ? RATE_AXIS : costAxis(systems.map((c) => c.cost));
  const endMax = Math.max(...systems.map((c) => c.cost));
  // the spend sweep runs over the cost-scaling axis, then on to a runaway endpoint if one lies beyond
  const axisEnd = R.axis_end > 0 ? Math.min(R.axis_end, endMax) : endMax;
  const tail = endMax > axisEnd * (1 + 1e-6);
  const rateMax = Math.max(...systems.map((c) => c.accuracy));
  const firstSolve = new Map(systems.map((c) => [c.id, reachedAt(c, c.curve.y.find((v) => v > 0) || Infinity)]));

  // progress p in [0, 1] → the sweep value
  function sweepAt(p) {
    p = Math.max(0, Math.min(1, p));
    if (!bySpend) return rateMax * p;
    if (!tail) return axisEnd * Math.pow(p, EASE);
    if (p <= MAIN_SHARE) return axisEnd * Math.pow(p / MAIN_SHARE, EASE);
    const u = (p - MAIN_SHARE) / (1 - MAIN_SHARE);
    return Math.exp(Math.log(axisEnd) + (Math.log(endMax) - Math.log(axisEnd)) * u);
  }

  // ---------- column widths: the widest label and the widest value, measured ----------
  const nameW = Math.max(...systems.map((c) => textWidth(c.model_label, NAME_MODEL_FONT) + textWidth(` · ${c.harness_label}`, NAME_HARNESS_FONT)));
  const valueTexts = systems.map((c) => (bySpend ? fmtPct1(c.accuracy) : fmtUSD(c.cost) + (axis.isOff(c.cost) ? ' →' : '')));
  const valueW = Math.max(...valueTexts.map((t) => textWidth(t, VALUE_FONT)), textWidth(bySpend ? '100.0%' : '$0.000', VALUE_FONT));
  body.style.setProperty('--rr-name', `${Math.ceil(nameW) + 4}px`);
  body.style.setProperty('--rr-valw', `${Math.ceil(valueW) + 10}px`); // + the 6 px value padding and a little air

  // ---------- DOM ----------
  const wrap = h('div', 'rr-wrap', body);
  const controls = h('div', 'rr-controls', wrap);
  const play = h('button', 'fr-replay rr-play', controls);
  play.type = 'button';
  const icon = s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' }, play);
  const range = h('input', 'rr-range', controls);
  range.type = 'range';
  range.min = '0'; range.max = '1000'; range.step = '1'; range.value = '0';
  range.setAttribute('aria-label', R.sweep.label);
  const readout = h('div', 'rr-readout', controls);
  h('span', 'k', readout).textContent = `${R.sweep.label} `;
  const roVal = h('b', null, readout);
  const roN = h('span', 'n', readout);

  const axisRow = h('div', 'rr-axis', wrap);
  h('span', null, axisRow); h('span', null, axisRow); h('span', null, axisRow);
  const axisScale = h('div', 'rr-scale', h('div', 'rr-cell', axisRow));
  axis.ticks.forEach((t, i) => {
    const tick = h('span', i === 0 ? 'rr-tick first' : 'rr-tick', axisScale);
    tick.style.left = `${(t / axis.max) * 100}%`;
    tick.textContent = axis.fmt(t);
  });

  const board = h('div', 'rr-board', wrap);
  board.style.height = `${N * ROW}px`;
  board.setAttribute('role', 'img');
  const gridLayer = h('div', 'rr-gridlayer', board);
  h('span', null, gridLayer); h('span', null, gridLayer); h('span', null, gridLayer);
  const gridScale = h('div', 'rr-scale', h('div', 'rr-cell', gridLayer));
  for (const t of axis.ticks) {
    const line = h('div', t === 0 ? 'rr-gridline zero' : 'rr-gridline', gridScale);
    line.style.left = `${(t / axis.max) * 100}%`;
  }
  const tip = h('div', 'fr-tip', wrap);

  systems.forEach((c, i) => {
    const row = h('div', 'rr-row', board);
    row.style.transform = `translateY(${i * ROW}px)`;
    c.rankEl = h('span', 'rr-rank', row);
    const name = h('span', 'rr-name', row);
    const model = document.createElement('b');
    model.textContent = c.model_label;
    name.append(model, document.createTextNode(` · ${c.harness_label}`));
    name.title = label(c);
    c.svg = s('svg', { class: 'rr-badge', viewBox: '-11 -11 22 22', width: 22, height: 22, 'aria-hidden': 'true' }, row);
    const scale = h('div', 'rr-scale', h('div', 'rr-track', row));
    c.bar = h('div', 'rr-bar', scale);
    c.val = h('span', 'rr-val', scale);
    c.row = row;
    c.sig = '';
    row.addEventListener('pointerenter', (e) => { state.hover = c; showTip(e); });
    row.addEventListener('pointermove', (e) => moveTip(e));
    row.addEventListener('pointerleave', () => { state.hover = null; tip.style.display = 'none'; });
  });

  const fn = h('p', 'rr-fn', wrap);
  const offNote = axis.off.length
    ? ` · off-axis (beyond ${axis.fmt(axis.max)}, bar broken): ${systems.filter((c) => axis.isOff(c.cost)).map((c) => `${label(c)} (${fmtUSD(c.cost)})`).join(', ')}`
    : '';
  fn.textContent = bySpend
    ? 'bar = cumulative resolved rate within the shared spend (the exact height of the system\'s cost-scaling curve there) · colour = model · badge = harness · n/a = no solved rollout within this spend yet · end cap = every rollout counted, the bar has reached the system\'s resolved rate'
    : `bar = cheapest-first spend per rollout at which the system reaches the resolved-rate target (read off its cost-scaling curve) · colour = model · badge = harness · n/a = the target is beyond the system's resolved rate (its bar stays at its full spend, faded)${offNote}`;

  // ---------- theme ----------
  let SURFACE = '#fcfcfb';
  function paint() {
    SURFACE = ctx.resolve('@surface');
    for (const c of systems) {
      c.hex = ctx.resolve(c.color);
      c.bar.style.background = c.hex;
      c.svg.replaceChildren();
      badge(c.harness, BADGE_R, c.hex, { variant: 'filled', surface: SURFACE }, c.svg);
    }
  }

  // ---------- state of the board at a sweep value ----------
  // each system: { value, ranked, done, k } and the order of the rows
  function boardAt(T) {
    const rows = systems.map((c) => {
      if (bySpend) {
        const at = atSpend(c, T);
        return { c, value: at.y, ranked: at.y > EPS, done: at.done, k: at.k };
      }
      const r = T > EPS ? toReach(c, T) : null;
      return r
        ? { c, value: r.x, ranked: true, done: false, k: r.k }
        : { c, value: c.cost, ranked: false, done: false, k: c.curve.x.length - 1 }; // topped out (or the sweep has not started)
    });
    const ranked = rows.filter((r) => r.ranked).sort((a, b) => {
      if (bySpend) {
        const d = b.value - a.value;
        if (Math.abs(d) > EPS) return d;
        const t = reachedAt(a.c, a.value) - reachedAt(b.c, b.value); // got there cheaper first
        if (Math.abs(t) > EPS) return t;
        const f = b.c.accuracy - a.c.accuracy;
        if (Math.abs(f) > EPS) return f;
      } else {
        const d = a.value - b.value;
        if (Math.abs(d) > EPS) return d;
        const f = b.c.accuracy - a.c.accuracy;
        if (Math.abs(f) > EPS) return f;
      }
      return label(a.c).localeCompare(label(b.c));
    });
    // the systems without a value: the next to qualify first
    const na = rows.filter((r) => !r.ranked).sort((a, b) => {
      const d = bySpend ? firstSolve.get(a.c.id) - firstSolve.get(b.c.id) : b.c.accuracy - a.c.accuracy;
      if (Math.abs(d) > EPS) return d;
      return label(a.c).localeCompare(label(b.c));
    });
    ranked.forEach((r, i) => { r.rank = i + 1; });
    return { rows: ranked.concat(na), ranked: ranked.length };
  }

  // ---------- layout ----------
  const state = { p: 0, phase: 'idle', raf: 0, last: 0, scrubbing: false, hover: null, board: null, T: 0 };

  function setIcon(kind) {
    icon.replaceChildren();
    if (kind === 'pause') {
      s('rect', { x: 3, y: 2.5, width: 3.4, height: 11, rx: 0.8, fill: 'currentColor' }, icon);
      s('rect', { x: 9.6, y: 2.5, width: 3.4, height: 11, rx: 0.8, fill: 'currentColor' }, icon);
      play.setAttribute('aria-label', 'Pause the sweep');
      play.title = 'pause';
    } else if (kind === 'replay') {
      s('path', { d: 'M8 1.5a6.5 6.5 0 1 0 5.5 10', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, icon);
      s('path', { d: 'M13.5 1.5v4h-4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, icon);
      play.setAttribute('aria-label', 'Replay the sweep');
      play.title = 'replay';
    } else {
      s('path', { d: 'M4 2.5v11l9-5.5z', fill: 'currentColor', 'stroke-linejoin': 'round' }, icon);
      play.setAttribute('aria-label', 'Play the sweep');
      play.title = 'play';
    }
  }

  function render() {
    const T = sweepAt(state.p);
    const B = boardAt(T);
    state.T = T;
    state.board = B;
    B.rows.forEach((r, i) => {
      const c = r.c;
      const off = !bySpend && axis.isOff(r.value);
      const pct = off ? 100 : Math.max(0, Math.min(100, (r.value / axis.max) * 100));
      const text = !r.ranked && (bySpend || T <= EPS) ? '—' : fmtRank(r.value) + (off ? ' →' : '');
      const rank = r.ranked ? String(r.rank) : 'n/a';
      const sig = `${i}|${pct.toFixed(3)}|${text}|${rank}|${r.done ? 1 : 0}|${off ? 1 : 0}`;
      if (sig === c.sig) return; // nothing changed for this row
      c.sig = sig;
      c.row.style.transform = `translateY(${i * ROW}px)`;
      c.row.classList.toggle('na', !r.ranked);
      c.bar.style.width = `${pct}%`;
      c.bar.classList.toggle('done', r.done);
      c.bar.classList.toggle('off', off);
      c.val.style.left = `${pct}%`;
      if (c.val.textContent !== text) c.val.textContent = text;
      if (c.rankEl.textContent !== rank) c.rankEl.textContent = rank;
      c.rankEl.classList.toggle('na', !r.ranked);
      c.row.setAttribute('aria-label', `${label(c)}: ${r.ranked ? `rank ${r.rank}, ` : 'no rank, '}${text}`);
    });
    roVal.textContent = fmtSweep(T);
    roN.textContent = ` · ${B.ranked} of ${N} ranked`;
    range.setAttribute('aria-valuetext', `${R.sweep.label} ${fmtSweep(T)}, ${B.ranked} of ${N} systems ranked`);
    board.setAttribute('aria-label', `${spec.title}: ${B.ranked} of ${N} systems ranked by ${R.rank.label} at ${R.sweep.label} ${fmtSweep(T)}`);
    if (!state.scrubbing) range.value = String(Math.round(state.p * 1000));
    if (state.hover) fillTip(state.hover);
  }

  // ---------- playback ----------
  function tick(now) {
    if (state.phase !== 'playing') return;
    const dt = Math.min(100, now - state.last); // a hidden tab resumes, not skips
    state.last = now;
    state.p = Math.min(1, state.p + dt / SWEEP_MS);
    render();
    if (state.p >= 1) { finish(); return; }
    state.raf = requestAnimationFrame(tick);
  }
  function start(fromStart) {
    cancelAnimationFrame(state.raf);
    if (fromStart || state.p >= 1) { state.p = 0; render(); }
    state.phase = 'playing';
    setIcon('pause');
    state.last = performance.now();
    state.raf = requestAnimationFrame(tick);
  }
  function pause() {
    cancelAnimationFrame(state.raf);
    state.phase = 'paused';
    setIcon('play');
  }
  function finish() {
    cancelAnimationFrame(state.raf);
    state.phase = 'done';
    state.p = 1;
    setIcon('replay');
    render();
  }
  function jumpTo(p) {
    cancelAnimationFrame(state.raf);
    state.p = Math.max(0, Math.min(1, p));
    if (state.p >= 1) { state.phase = 'done'; setIcon('replay'); } else { state.phase = 'paused'; setIcon('play'); }
    render();
  }

  play.addEventListener('click', () => {
    autoplay.unobserve(board);
    if (state.phase === 'playing') pause();
    else start(state.phase === 'done');
  });
  // the scrubber: dragging (or the arrow keys) takes over from the sweep
  range.addEventListener('input', () => { state.scrubbing = true; jumpTo(Number(range.value) / 1000); });
  range.addEventListener('change', () => { state.scrubbing = false; });
  range.addEventListener('pointerdown', () => { autoplay.unobserve(board); wrap.classList.add('scrub'); });
  const endScrub = () => { wrap.classList.remove('scrub'); state.scrubbing = false; };
  range.addEventListener('pointerup', endScrub);
  range.addEventListener('pointercancel', endScrub);
  range.addEventListener('lostpointercapture', endScrub);

  // ---------- tooltip: the exact ranked prefix behind the bar, then the endpoint ----------
  function fillTip(c) {
    const r = (state.board ? state.board.rows : []).find((x) => x.c === c);
    if (!r) return;
    const n = c.n || c.curve.x.length - 1;
    tip.replaceChildren();
    const head = h('div', 'fr-tip-head', tip);
    const sw = h('span', 'fr-swatch', head);
    sw.style.background = c.hex;
    h('b', null, head).textContent = c.model_label;
    head.appendChild(document.createTextNode(` · ${c.harness_label}`));
    if (c.qualifier) h('span', 'fr-tip-muted', head).textContent = `(${c.qualifier})`;
    const solves = Math.round(r.value * n);
    if (bySpend) {
      h('div', null, tip).textContent = r.ranked
        ? `at ${fmtUSD(state.T)} per rollout: ${fmtPct1(r.value)} resolved (${solves} solve${solves === 1 ? '' : 's'} in the cheapest ${r.k} of ${n} rollouts${r.done ? ' · every rollout counted' : ''})`
        : `at ${fmtUSD(state.T)} per rollout: no solved rollout within the spend yet (cheapest ${r.k} of ${n} rollouts counted)`;
    } else {
      h('div', null, tip).textContent = r.ranked
        ? `to reach ${fmtPct1(state.T)}: ${fmtUSD(r.value)} per rollout (the cheapest ${r.k} of ${n} rollouts)`
        : state.T > EPS
          ? `tops out at ${fmtPct1(c.accuracy)} resolved · the ${fmtPct1(state.T)} target is beyond its reach`
          : 'the sweep has not started';
    }
    h('div', 'fr-tip-muted', tip).textContent = `ends at ${fmtPct1(c.accuracy)} resolved${fmtCI(c.accuracy_ci, (v) => (v * 100).toFixed(1) + '%')} · ${fmtUSD(c.cost)} per rollout${fmtCI(c.cost_ci, fmtUSD)}`;
    h('div', 'fr-tip-muted', tip).textContent = [
      r.ranked ? `#${r.rank} of ${state.board.ranked} ranked` : 'rank n/a',
      c.frontier ? 'Pareto frontier' : null, c.sample,
    ].filter(Boolean).join(' · ');
  }
  function showTip(e) {
    if (!state.hover) return;
    fillTip(state.hover);
    tip.style.display = 'block';
    moveTip(e);
  }
  function moveTip(e) {
    if (tip.style.display === 'none') return;
    const r = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - r.left + 14;
    let y = e.clientY - r.top + 14;
    if (x + tw > r.width - 4) x = e.clientX - r.left - tw - 14;
    if (y + th > r.height - 4) y = e.clientY - r.top - th - 14;
    tip.style.left = `${Math.max(2, x)}px`;
    tip.style.top = `${Math.max(2, y)}px`;
  }

  // first play when the board scrolls well into view (a hidden benchmark tab
  // has no box, so the observer waits for the reveal)
  const autoplay = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || state.phase !== 'idle') continue;
      autoplay.unobserve(board);
      start(true);
    }
  }, { threshold: 0.4 });

  let armed = false;
  return {
    seg: null,
    show() {
      if (armed) return;
      armed = true;
      paint();
      setIcon('play');
      if (reduceMotion.matches) {
        // no motion: the finished board, the scrubber still works
        state.p = 1; state.phase = 'done'; setIcon('replay'); render();
        play.hidden = true;
        return;
      }
      render();
      autoplay.observe(board);
    },
    rerender() {
      // theme change: recolour in place; the sweep keeps its position
      if (!armed) return;
      paint();
    },
  };
}
