// Token resolution for chart specs.
//
// Specs never carry hex: they carry "@token" strings (plus "@seq" for the
// sequential ramp and "@harness:<id>" for the harness palette) that resolve
// against the active mode's map from dashboard/themes.py. The dashboard
// (js/charts.js) and the cross-post embeds (dashboard/embed_runtime.js) both
// resolve through here, so a figure pasted into a blog uses exactly the
// dashboard's palette.
import { HARNESS_COLOR } from './palette.js';

export function seqColorscale(theme) {
  const seq = theme.seq;
  return seq.map((hex, i) => [i / (seq.length - 1), hex]);
}

export function resolve(node, theme) {
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
