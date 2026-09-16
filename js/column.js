// How a dashboard figure is drawn in a reading column rather than on the
// 1150px dashboard page: the layout patches each card type needs at that
// width, and the status line's place under the plot. Shared by the Blog tab
// (js/blog.js) and the cross-post embeds (dashboard/embed_runtime.js) so a
// figure reads the same in the post and in the copy of it pasted elsewhere.

// The dashboard draws its headline figures about 1150px wide at heights
// chosen for that width; in the 736px reading column the frontier and
// cost-scaling plots keep their type, markers and margins at full size and
// give up some height instead, so they do not stand nearly square. The
// cost-scaling card keeps a taller top margin where its endpoint labels can
// stack instead of overlapping. `?h=<px>` on the dashboard: reference sets
// the height.
export const COLUMN_LAYOUT = {
  frontier: { height: 400 },
  accrual: { height: 520, margin: { t: 96 } },
};
// The agent-context card's four column panels share one row in the reading
// column as on the dashboard (its values are written on the columns, so a
// quarter of the column is wide enough). On a phone a quarter is not: there
// the same panels are re-seated two by two, the paper-relative axis domains
// and panel titles moving and nothing else changing.
const NARROW = '(max-width: 700px)';
function contextNarrowLayout(spec) {
  const base = spec.plotly && spec.plotly.layout;
  if (!base) return null;
  const cols = 2;
  const gapX = 0.1;
  const gapY = 0.24;
  const w = (1 - gapX * (cols - 1)) / cols;
  const rows = Math.ceil(spec.context.panels / cols);
  const h = (1 - gapY * (rows - 1)) / rows;
  const patch = { height: 210 * rows + 60, annotations: [] };
  for (let i = 0; i < spec.context.panels; i++) {
    const key = i === 0 ? '' : String(i + 1);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = col * (w + gapX);
    const y1 = 1 - row * (h + gapY);
    patch[`xaxis${key}`] = { ...base[`xaxis${key}`], domain: [x0, x0 + w] };
    patch[`yaxis${key}`] = { ...base[`yaxis${key}`], domain: [y1 - h, y1] };
    const title = (base.annotations || [])[i];
    if (title) patch.annotations.push({ ...title, x: x0 + w / 2, y: y1 });
  }
  return patch;
}

export function columnLayout(spec, forcedHeight) {
  const patch = spec.frontier ? COLUMN_LAYOUT.frontier
    : spec.accrual ? COLUMN_LAYOUT.accrual
    : spec.context && window.matchMedia(NARROW).matches ? contextNarrowLayout(spec)
    : null;
  if (!patch && !forcedHeight) return null;
  return forcedHeight ? { ...(patch || {}), height: forcedHeight } : patch;
}

// The card's status line (observation count, selection hints) sits at the
// end of the harness pill row on the dashboard; in the column it wraps, and
// its text changes with the selection and the tour, so there it would shift
// the plot. It moves under the plot (the same element, so the card keeps
// updating it).
export function statusBelow(card, body) {
  const status = card.querySelector('.fr-status');
  const target = body || card.querySelector('.card-body');
  if (status && target) target.appendChild(status);
  return card;
}
