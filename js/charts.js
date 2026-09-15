// Chart rendering: resolve "@tokens" against the active theme, lazy-load
// plotly, re-render live on theme change. Specs are data; no hex lives here.
import { getJSON } from './data.js';
import { mountFrontier } from './frontier.js';
import { mountAccrual } from './accrual.js';
import { mountHarness } from './harness.js';
import { mountRankRace } from './rankrace.js';
import { HARNESS_COLOR } from './palette.js';

let THEMES = null;
let MODE = 'light';
const mounted = new Map(); // el -> { spec, ctl }
let plotlyPromise = null;

export function initCharts(themes, mode) {
  THEMES = themes;
  MODE = mode;
}

export function onThemeChange(mode) {
  MODE = mode;
  for (const [el, { spec, ctl }] of mounted) {
    if (ctl) ctl.rerender();
    else render(el, spec);
  }
}

// Context handed to custom renderers: token resolution against the active
// theme plus the shared lazy plotly loader.
const ctx = {
  resolve: (node) => resolve(node, THEMES[MODE]),
  loadPlotly: () => loadPlotly(),
};

function loadPlotly() {
  if (!plotlyPromise) {
    plotlyPromise = new Promise((ok, err) => {
      const s = document.createElement('script');
      s.src = window.__AB_BOOT__.plotly;
      s.onload = ok;
      s.onerror = () => err(new Error('plotly failed to load'));
      document.head.appendChild(s);
    });
  }
  return plotlyPromise;
}

function seqColorscale(theme) {
  const seq = theme.seq;
  return seq.map((hex, i) => [i / (seq.length - 1), hex]);
}

function resolve(node, theme) {
  if (typeof node === 'string') {
    if (node === '@seq') return seqColorscale(theme);
    // "@harness:pi|codex|cc": the harness palette (palette.js), the same hue
    // the harness-effect and Pareto cards give that harness
    if (node.startsWith('@harness:')) return HARNESS_COLOR[node.slice(9)] ?? node;
    if (node.startsWith('@')) return theme[node.slice(1)] ?? node;
    return node;
  }
  if (Array.isArray(node)) return node.map((v) => resolve(v, theme));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolve(v, theme);
    return out;
  }
  return node;
}

async function render(el, spec) {
  await loadPlotly();
  const theme = THEMES[MODE];
  const fig = resolve(spec.plotly, theme);
  window.Plotly.react(el, fig.data, fig.layout, {
    displayModeBar: false,
    responsive: true,
  });
}

// Charts that ship alternative encodings of one figure (e.g. an x-axis drawn
// linear, as −log10 x, or as 1/x) carry them as spec.variants, each a complete
// plotly figure. A seg in the card header swaps the figure; the table twin
// and every other part of the card stay put. The active variant is what the
// theme switch re-renders.
function mountVariants(plot, spec) {
  const variants = spec.variants;
  let active = Math.max(0, variants.findIndex((v) => v.default));
  let shown = false;
  const current = () => ({ ...spec, plotly: variants[active].plotly });
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', spec.variants_label || 'view');
  const buttons = variants.map((variant, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = variant.label;
    if (variant.title) btn.title = variant.title;
    btn.setAttribute('aria-pressed', String(i === active));
    btn.addEventListener('click', () => {
      if (i === active) return;
      active = i;
      buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
      if (shown) render(plot, current());
    });
    seg.appendChild(btn);
    return btn;
  });
  return {
    seg,
    show() { shown = true; render(plot, current()); },
    rerender() { if (shown) render(plot, current()); },
  };
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      io.unobserve(e.target);
      const { spec, ctl } = e.target._ab;
      mounted.set(e.target, { spec, ctl });
      if (ctl) ctl.show();
      else render(e.target, spec);
    }
  }
}, { rootMargin: '250px' });

// ------------------------------------------------------------- table cards

function statusChip(status) {
  const chip = document.createElement('span');
  chip.className = `chip ${status.tone || 'muted'}`;
  chip.textContent = status.value;
  return chip;
}

function externalLink(link) {
  const a = document.createElement('a');
  a.className = 'external-evidence';
  a.href = link.href;
  a.textContent = link.value || link.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function renderTable(root, table) {
  if (table.note) {
    // a statement shared by every row (e.g. the sample) sits above the table
    const note = document.createElement('p');
    note.className = 'table-note';
    note.textContent = table.note;
    root.appendChild(note);
  }
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const t = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const col of table.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  t.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of table.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      if (cell && typeof cell === 'object' && cell.kind === 'status') {
        td.appendChild(statusChip(cell));
      } else if (cell && typeof cell === 'object' && cell.kind === 'link') {
        td.appendChild(externalLink(cell));
      } else {
        const text = cell == null ? '—' : String(cell);
        td.textContent = text;
        if (/^[-+]?[$0-9][0-9,./%$ ]*$/.test(text)) td.className = 'num';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  wrap.appendChild(t);
  root.appendChild(wrap);
}

function renderAccordion(root, spec) {
  const wrap = document.createElement('div');
  wrap.className = 'analysis-accordion';

  for (const item of spec.items) {
    const disclosure = document.createElement('details');
    disclosure.className = 'analysis-disclosure';
    disclosure.open = Boolean(item.open);

    const summary = document.createElement('summary');
    const identity = document.createElement('span');
    identity.className = 'analysis-disclosure-identity';
    const title = document.createElement('strong');
    title.textContent = item.title;
    identity.appendChild(title);
    if (item.status && item.status.kind === 'status') {
      identity.appendChild(statusChip(item.status));
    }
    summary.appendChild(identity);

    const headline = document.createElement('span');
    headline.className = 'analysis-disclosure-headline';
    headline.textContent = item.summary || '';
    summary.appendChild(headline);

    const body = document.createElement('div');
    body.className = 'analysis-disclosure-body';
    if (item.reference) {
      const reference = document.createElement('p');
      reference.className = 'analysis-reference';
      reference.textContent = `Reference: ${item.reference}`;
      body.appendChild(reference);
    }

    if (Array.isArray(item.metrics) && item.metrics.length) {
      const metrics = document.createElement('dl');
      metrics.className = 'analysis-metrics';
      for (const metric of item.metrics) {
        const metricItem = document.createElement('div');
        const label = document.createElement('dt');
        label.textContent = metric.label;
        const value = document.createElement('dd');
        value.textContent = metric.value == null ? '—' : String(metric.value);
        metricItem.append(label, value);
        metrics.appendChild(metricItem);
      }
      body.appendChild(metrics);
    }

    if (Array.isArray(item.sections)) {
      for (const section of item.sections) {
        const block = document.createElement('section');
        block.className = 'analysis-detail';
        const heading = document.createElement('h4');
        heading.textContent = section.title;
        const text = document.createElement('p');
        text.textContent = section.text || '—';
        block.append(heading, text);
        body.appendChild(block);
      }
    }
    if (Array.isArray(item.sources) && item.sources.length) {
      const sources = document.createElement('nav');
      sources.className = 'analysis-sources';
      sources.setAttribute('aria-label', 'Public model evidence');
      const label = document.createElement('span');
      label.textContent = 'Public model evidence';
      sources.appendChild(label);
      for (const source of item.sources) {
        sources.appendChild(externalLink(source));
      }
      body.appendChild(sources);
    }

    disclosure.append(summary, body);
    wrap.appendChild(disclosure);
  }
  root.appendChild(wrap);
}

// -------------------------------------------------------------------- cards

// Every chart/table card is a disclosure: the title line toggles the body.
// The manifest decides the initial state (headline figures open, the rest
// collapsed); a collapsed body is display:none, so its plot skips the lazy
// IntersectionObserver render until first expanded.
let cardSeq = 0;

function card(title, subtitle, { collapsed = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  const head = document.createElement('div');
  head.className = 'card-head';
  const h = document.createElement('h3');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'card-toggle';
  const chevron = document.createElement('span');
  chevron.className = 'card-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  toggle.append(chevron, document.createTextNode(title));
  h.appendChild(toggle);
  head.appendChild(h);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.id = `card-body-${++cardSeq}`;
  toggle.setAttribute('aria-controls', body.id);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'card-sub';
    sub.textContent = subtitle;
    body.appendChild(sub);
  }
  el.appendChild(body);

  const setOpen = (open) => {
    el.classList.toggle('collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (open) {
      // a plot revealed for the first time is picked up by the observer; one
      // already drawn is re-fitted synchronously (plotly's resize handlers
      // are debounced, which would flash the stale width for a few frames)
      for (const gd of body.querySelectorAll('.plot')) {
        if (gd._fullLayout && window.Plotly) window.Plotly.relayout(gd, { autosize: true });
      }
      window.dispatchEvent(new Event('resize'));
    }
  };
  toggle.addEventListener('click', () => setOpen(body.hidden));
  setOpen(!collapsed);
  return { el, head, body };
}

// `layout` (a patch object, or a function of the loaded spec returning one) is
// merged over the plotly layout for this card only (margins merge key by key):
// the Blog tab draws the same figures in a reading column and fits their
// height to it. `title` (a string, or a function of the spec's title) heads
// this card instead of the spec's own title. The cached spec is shared with
// the dashboard, so the overrides live on a copy.
// `compact`: the harness-effect card draws its two panels in the compact
// geometry that fits a reading column (harness.js); every other card ignores it
export async function chartCard(name, { collapsed = false, layout = null, title = null, compact = false, note = true } = {}) {
  const boot = window.__AB_BOOT__;
  const url = boot.charts[name];
  if (!url) return null; // missing artifact -> the card removes itself
  let spec;
  try {
    spec = await getJSON(url);
  } catch {
    return null;
  }
  const patch = typeof layout === 'function' ? layout(spec) : layout;
  if (patch && spec.plotly && spec.plotly.layout) {
    const base = spec.plotly.layout;
    const next = { ...base, ...patch };
    if (patch.margin) next.margin = { ...(base.margin || {}), ...patch.margin };
    spec = { ...spec, plotly: { ...spec.plotly, layout: next } };
  }
  const heading = typeof title === 'function' ? title(spec.title) : (title || spec.title);
  const { el, head, body } = card(heading, spec.subtitle, { collapsed });
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  head.appendChild(actions);

  // frontier, cost-scaling, harness-effect and rank-race cards own their body
  // (custom views); every other chart is a plain plotly div
  let plot;
  let ctl = null;
  if (spec.frontier) {
    plot = document.createElement('div');
    plot.className = 'frontier-body';
    ctl = mountFrontier(plot, spec, ctx);
    if (ctl.seg) actions.appendChild(ctl.seg);
  } else if (spec.accrual) {
    plot = document.createElement('div');
    plot.className = 'accrual-body';
    ctl = mountAccrual(plot, spec, ctx);
    if (ctl.seg) actions.appendChild(ctl.seg);
  } else if (spec.harness) {
    plot = document.createElement('div');
    plot.className = 'harness-body';
    ctl = mountHarness(plot, spec, { ...ctx, compact });
    if (ctl.seg) actions.appendChild(ctl.seg);
  } else if (spec.race) {
    plot = document.createElement('div');
    plot.className = 'race-body';
    ctl = mountRankRace(plot, spec, ctx);
    if (ctl.seg) actions.appendChild(ctl.seg);
  } else {
    plot = document.createElement('div');
    plot.className = 'plot';
    if (Array.isArray(spec.variants) && spec.variants.length > 1) {
      ctl = mountVariants(plot, spec);
      actions.appendChild(ctl.seg);
    }
  }
  plot._ab = { spec, ctl };
  body.appendChild(plot);
  // a spec's `note` is the one line that says what the marks are (the
  // agent-context card: bars are means, whiskers ±1 SD); it sits under the
  // plot, where a legend would. A caller whose figure has a caption of its
  // own (the blog post) passes `note: false`
  if (spec.note && note) {
    const note = document.createElement('p');
    note.className = 'card-note';
    note.textContent = spec.note;
    body.appendChild(note);
  }

  io.observe(plot);
  return el;
}

export async function tableCard(name, { collapsed = false } = {}) {
  const boot = window.__AB_BOOT__;
  const url = boot.tables[name];
  if (!url) return null;
  let spec;
  try {
    spec = await getJSON(url);
  } catch {
    return null;
  }
  const { el, body } = card(spec.title, spec.subtitle, { collapsed });
  if (spec.presentation === 'accordion' && Array.isArray(spec.items)) {
    renderAccordion(body, spec);
  } else {
    renderTable(body, spec);
  }
  return el;
}
