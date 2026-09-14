// Harness marks for the Part I cards: each harness is drawn as its own logo
// inside a round badge filled with the model's colour (a filled badge for a
// frontier system, an outlined one for a dominated system), so a marker
// names the harness and the model at once. The same badge is emitted as an
// SVG element for the animated overlays and as an SVG data URI for the
// resting plotly figures (layout.images), so the two never differ.
//
// Glyph geometry: the vendor logos, normalised to a 24-unit box.
//   Codex       thesvg.org/icon/codex        (OpenAI's Codex mark)
//   Claude Code thesvg.org/icon/claude-code  (Anthropic's Claude Code mark)
//   Pi          thesvg.org/icon/pi           (pi.dev's mark)
// `box` is the glyph's own bounding box inside that unit square; the badge
// scales the glyph so its longer side spans GLYPH_SHARE of the diameter, or
// the icon's own `share`: Pi's square reaches the disc edge at its corners
// (0.68 · √2 / 2 ≈ 0.96 of the radius), so the Claude Code mark, a wide
// rectangle whose arms sit at mid-height, spans 0.96 of the diameter and its
// arm tips reach the edge the same way (its body corners stay inside). A
// `silhouette` mark (Codex: a solid cloud with the prompt cut out) is the
// badge itself, drawn in the model colour over a surface-coloured disc, since
// a solid glyph inside a disc would hide the disc.

const SVG_NS = 'http://www.w3.org/2000/svg';
const GLYPH_SHARE = 0.68;

export const HARNESS_ICON = {
  codex: {
    box: [0, 0, 24, 24],
    silhouette: true,
    fillRule: 'evenodd',
    paths: ['M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z'],
  },
  cc: {
    box: [0, 5, 24, 15],
    share: 0.96, // arm tips at the disc edge, like Pi's corners
    fillRule: 'evenodd',
    paths: ['M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z'],
  },
  pi: {
    box: [4.959, 4.959, 14.083, 14.083],
    fillRule: 'evenodd',
    paths: ['M4.959 4.959H15.521V12H12V15.521H8.48V19.042H4.959ZM8.48 8.48V12H12V8.48Z', 'M15.521 12H19.042V19.042H15.521Z'],
  },
};

// "#rgb" / "#rrggbb" to rgba() at the given alpha; anything else passes through
export function rgba(color, alpha) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// The glyph is drawn in white on a dark badge and in near-black on a light
// one (Haiku's manilla, Sonnet's kraft), chosen by the fill's luminance.
export function glyphInk(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#ffffff';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#1a1a19' : '#ffffff';
}

function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

// transform fitting the glyph's box into a square of side `side` centred on 0,0
function glyphTransform(icon, side) {
  const [x, y, w, h] = icon.box;
  const k = side / Math.max(w, h);
  return `translate(${(-(x + w / 2) * k).toFixed(3)} ${(-(y + h / 2) * k).toFixed(3)}) scale(${k.toFixed(4)})`;
}

// The badge as SVG markup centred on (0, 0). variant 'filled': disc in the
// model colour, glyph in contrasting ink, rim in the surface colour;
// 'open': disc in the surface colour, rim and glyph in the model colour.
function badgeMarkup(harness, r, color, { variant = 'filled', surface = '#ffffff', rim = 2 } = {}) {
  const icon = HARNESS_ICON[harness];
  const open = variant === 'open';
  if (icon && icon.silhouette) {
    // the mark spans the badge; a surface disc beneath it masks the curve
    // under the badge (the rim) and shows through the cut-outs
    const side = 2 * r;
    const k = side / Math.max(icon.box[2], icon.box[3]);
    const rule = icon.fillRule ? ` fill-rule="${icon.fillRule}" clip-rule="${icon.fillRule}"` : '';
    const mark = open
      ? icon.paths.map((d) => `<path d="${d}" fill="${surface}" stroke="${color}" stroke-width="${(Math.max(1.4, rim * 0.8) / k).toFixed(3)}" stroke-linejoin="round"${rule}/>`).join('')
      : icon.paths.map((d) => `<path d="${d}" fill="${color}"${rule}/>`).join('');
    return `<circle r="${(r + rim / 2).toFixed(2)}" fill="${surface}"/>`
      + `<g transform="${glyphTransform(icon, side)}">${mark}</g>`;
  }
  const disc = open
    ? `<circle r="${r}" fill="${surface}" stroke="${color}" stroke-width="${Math.max(1.4, rim * 0.8)}"/>`
    : `<circle r="${r}" fill="${color}" stroke="${surface}" stroke-width="${rim}"/>`;
  if (!icon) return disc;
  const ink = open ? color : glyphInk(color);
  const paths = icon.paths.map((d) => `<path d="${d}" fill="${ink}"${icon.fillRule ? ` fill-rule="${icon.fillRule}" clip-rule="${icon.fillRule}"` : ''}/>`).join('');
  return `${disc}<g transform="${glyphTransform(icon, 2 * r * (icon.share || GLYPH_SHARE))}">${paths}</g>`;
}

// SVG element version for the animated overlays (appended to `parent`).
export function badge(harness, r, color, opts = {}, parent) {
  const g = el('g', { class: 'hz-badge' }, parent);
  g.innerHTML = badgeMarkup(harness, r, color, opts);
  return g;
}

// Data-URI version for plotly layout.images: a square image `size` px wide
// (the disc plus its rim) that the caller positions by centre.
const uriCache = new Map();
export function badgeImage(harness, r, color, opts = {}) {
  const rim = opts.rim == null ? 2 : opts.rim;
  const half = r + rim;
  const size = 2 * half;
  const key = [harness, r, color, opts.variant || 'filled', opts.surface || '', rim].join('|');
  let uri = uriCache.get(key);
  if (!uri) {
    const svg = `<svg xmlns="${SVG_NS}" viewBox="${-half} ${-half} ${size} ${size}" width="${size}" height="${size}">`
      + badgeMarkup(harness, r, color, { ...opts, rim }) + '</svg>';
    uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    uriCache.set(key, uri);
  }
  return { uri, size };
}

// ---- placing badge images on a plotly figure -------------------------------
//
// A badge image is anchored in data coordinates (xref/yref 'x'/'y', the log10
// of the value on a log axis, as plotly expects) so zooming and panning move
// it with its hover marker; its size is a pixel diameter, converted to axis
// units for the axes currently shown. Callers keep the specs and re-size them
// on every 'plotly_relayout' (bindZoomSync), so a badge never grows or drifts
// with the view.

// axes: { x0, x1, y0, y1, iw, ih } in plot units (log10 on a log axis)
export function axesFromPlot(plot) {
  const fl = plot._fullLayout;
  if (!fl || !fl.xaxis || !fl.yaxis || !fl._size) return null;
  return { x0: fl.xaxis.range[0], x1: fl.xaxis.range[1], y0: fl.yaxis.range[0], y1: fl.yaxis.range[1], iw: fl._size.w, ih: fl._size.h };
}

const sameAxes = (a, b) => Boolean(a && b) && ['x0', 'x1', 'y0', 'y1', 'iw', 'ih'].every((k) => Math.abs(a[k] - b[k]) < 1e-9);

// imageSpec: { image: plotly image attributes without size, px: diameter }
export function imageSpec(uri, x, y, px, opacity) {
  return {
    px,
    image: {
      source: uri, xref: 'x', yref: 'y', x, y,
      xanchor: 'center', yanchor: 'middle', sizing: 'contain', layer: 'above', opacity,
    },
  };
}

export function sizeImages(specs, axes) {
  return specs.map(({ image, px }) => ({
    ...image,
    sizex: (px / axes.iw) * (axes.x1 - axes.x0),
    sizey: (px / axes.ih) * (axes.y1 - axes.y0),
  }));
}

// Keep `state.imageSpecs` sized to the axes after every zoom or pan, merging
// in whatever `extra(axes)` returns (e.g. labels re-placed for the view); a
// double-click (autorange) hands back to `reset`, which redraws the designed
// view. Binds once per plot div.
export function bindZoomSync(state, plot, reset, extra = null) {
  if (state.zoomBound) return;
  state.zoomBound = true;
  plot.on('plotly_relayout', (ev) => {
    if (ev && (ev['xaxis.autorange'] || ev['yaxis.autorange'])) { reset(); return; }
    const axes = axesFromPlot(plot);
    if (!axes || sameAxes(axes, state.lastAxes) || !state.imageSpecs) return;
    state.lastAxes = axes;
    window.Plotly.relayout(plot, { images: sizeImages(state.imageSpecs, axes), ...(extra ? extra(axes) : {}) });
  });
}

// Legend glyph (pills): the bare logo in the current text colour, or a dot
// for a harness without a mark.
export function iconGlyph(harness) {
  const svg = el('svg', { viewBox: '-8 -8 16 16', class: 'fr-glyph', 'aria-hidden': 'true' });
  const icon = HARNESS_ICON[harness];
  if (!icon) { el('circle', { r: 5.2, fill: 'currentColor' }, svg); return svg; }
  const g = el('g', { transform: glyphTransform(icon, 13) }, svg);
  for (const d of icon.paths) el('path', { d, fill: 'currentColor', 'fill-rule': icon.fillRule, 'clip-rule': icon.fillRule }, g);
  return svg;
}
