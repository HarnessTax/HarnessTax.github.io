// Shared building blocks for the Part I cards: tiny DOM/SVG helpers, the
// harness glyphs (the harness logos, see icons.js), and the model/harness
// highlight pills (two rows, single-select each). Pure presentation.

import { HARNESS_ICON, iconGlyph } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

export function s(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v != null) node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

// Marker shapes mirror the plotly symbols used by the interactive views.
export function shape(symbol, r, attrs, parent) {
  const base = symbol.replace(/-open$/, '');
  if (base === 'square') {
    const half = r * 0.9;
    return s('rect', { x: -half, y: -half, width: 2 * half, height: 2 * half, ...attrs }, parent);
  }
  if (base === 'diamond') {
    const k = r * 1.25;
    return s('path', { d: `M0,${-k} L${k},0 L0,${k} L${-k},0 Z`, ...attrs }, parent);
  }
  if (base === 'triangle-up') {
    const k = r * 1.2;
    return s('path', { d: `M0,${-k} L${k * 0.95},${k * 0.62} L${-k * 0.95},${k * 0.62} Z`, ...attrs }, parent);
  }
  if (base === 'triangle-right') {
    const k = r * 1.2;
    return s('path', { d: `M${k},0 L${-k * 0.62},${k * 0.95} L${-k * 0.62},${-k * 0.95} Z`, ...attrs }, parent);
  }
  if (base === 'hexagon') {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      pts.push(`${(r * 1.1 * Math.cos(a)).toFixed(2)},${(r * 1.1 * Math.sin(a)).toFixed(2)}`);
    }
    return s('path', { d: `M${pts.join(' L')} Z`, ...attrs }, parent);
  }
  return s('circle', { r, ...attrs }, parent);
}

// A harness with a logo shows it; any other harness falls back to the
// plotly marker shape the figures use for it.
export function glyphSVG(symbol, harness) {
  if (harness && HARNESS_ICON[harness]) return iconGlyph(harness);
  const svg = s('svg', { viewBox: '-8 -8 16 16', class: 'fr-glyph', 'aria-hidden': 'true' });
  shape(symbol, 5.2, { fill: 'currentColor' }, svg);
  return svg;
}

// createPills({ models, harnesses, sel, resolve, count, onChange })
//   models:    [{ key, label, color }]      (color is a theme token)
//   harnesses: [{ key, label, symbol }]
//   sel:       { model, harness } — mutated in place on click
//   count(sel): how many items a hypothetical selection would highlight; a
//              pill that would highlight nothing is disabled
//   onChange(): called after a click has updated `sel`
// Returns { el, status, rows, sync } where `status` is a span at the end of
// the last row for the caller's summary line.
export function createPills({ models, harnesses, sel, resolve, count, onChange }) {
  const el = h('div', 'fr-pills');
  const rows = {};
  const buttons = [];
  let lastRow = null;
  const spec = [
    { key: 'model', label: 'Model', items: models || [] },
    { key: 'harness', label: 'Harness', items: harnesses || [] },
  ];
  for (const row of spec) {
    if (!row.items.length) continue;
    h('span', 'fr-pill-label', el).textContent = row.label;
    const list = h('div', 'fr-pill-row', el);
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', `highlight one ${row.key}`);
    rows[row.key] = list;
    lastRow = list;
    for (const item of row.items) {
      const btn = h('button', 'fr-pill', list);
      btn.type = 'button';
      btn.dataset.dim = row.key;
      btn.dataset.key = item.key;
      btn.setAttribute('aria-pressed', 'false');
      if (row.key === 'model') {
        const sw = h('span', 'fr-swatch', btn);
        sw.dataset.token = item.color;
      } else {
        btn.appendChild(glyphSVG(item.symbol, item.key));
      }
      btn.appendChild(document.createTextNode(item.label));
      btn.addEventListener('click', () => {
        sel[row.key] = sel[row.key] === item.key ? null : item.key;
        sync();
        onChange();
      });
      buttons.push(btn);
    }
  }
  const status = h('span', 'fr-status', lastRow || el);

  function sync() {
    for (const btn of buttons) {
      const dim = btn.dataset.dim;
      const pressed = sel[dim] === btn.dataset.key;
      btn.setAttribute('aria-pressed', String(pressed));
      const would = count({ ...sel, [dim]: btn.dataset.key });
      btn.disabled = !pressed && would === 0;
      btn.title = btn.disabled ? 'not run on this benchmark with the current selection' : '';
    }
    for (const sw of el.querySelectorAll('.fr-swatch[data-token]')) {
      sw.style.background = resolve(sw.dataset.token);
    }
  }
  sync();
  return { el, status, rows, sync };
}
