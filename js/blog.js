// Blog tab: render build-time-rendered drafts (boot.blog) for visual review.
// The HTML comes from our own build (markdown-it over blog/*.md), so it is
// trusted authored content; images are content-hashed copies under /blog/.
// `![caption](dashboard:<chart>)` in a draft arrives as an empty
// <figure class="dash-figure" data-chart>; the dashboard's own card for that
// chart is mounted into it, so the post carries the live figure, not a picture.
// A run of such images whose names differ only in the benchmark suffix arrives
// as one <figure class="dash-switch"> with a .dash-pane per chart: a row of
// benchmark pills above the card shows one pane at a time (after the chart
// switchers on openai.com's model posts), so a plot drawn for two benchmarks
// takes one slot in the column.
// A citation is a superscript linking to its reference entry (`#ref-N`), a
// footnote marker one linking to its note (`#fn-N`, the note linking back to
// `#fnref-N`); the SPA routes on the hash, so a plain click scrolls there
// without changing it. For opening in a new tab (modifier or middle click,
// copied link) the anchors are rewritten to `#blog/<slug>/<id>` once mounted,
// and a `#ref-N` page hash (an older link) is routed here by app.js; both
// land on the entry.
// The tab shows the post and nothing else: build diagnostics (missing images
// or charts) go to the console, and the page title becomes the post's.
// Drafts are listed in the site-root manifest blog.json, written by
// dashboard/blog.py publish() after the build and served no-cache, rather
// than in the boot manifest: build.py stays byte-identical to its sealed
// hash bindings.
import { getJSON } from './data.js';
import { chartCard } from './charts.js';

const MANIFEST = 'blog.json';
async function loadPosts() {
  try {
    const manifest = await getJSON(MANIFEST);
    return Array.isArray(manifest.posts) ? manifest.posts : [];
  } catch (err) {
    if (/\b404\b/.test(String(err && err.message))) return []; // no publish step ran
    throw err;
  }
}

// The dashboard draws its headline figures about 1150px wide at heights
// chosen for that width; in the 736px reading column the frontier and
// cost-scaling plots keep their type, markers and margins at full size and
// give up some height instead, so they do not stand nearly square. The
// cost-scaling card keeps a taller top margin where its endpoint labels can
// stack instead of overlapping. `?h=<px>` on the dashboard: reference sets
// the height.
const COLUMN_LAYOUT = {
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

function columnLayout(spec, forcedHeight) {
  const patch = spec.frontier ? COLUMN_LAYOUT.frontier
    : spec.accrual ? COLUMN_LAYOUT.accrual
    : spec.context && window.matchMedia(NARROW).matches ? contextNarrowLayout(spec)
    : null;
  if (!patch && !forcedHeight) return null;
  return forcedHeight ? { ...(patch || {}), height: forcedHeight } : patch;
}

// The dashboard titles a card "<benchmark> — <figure>" with the figure half in
// lower case ("SWE-bench Lite — cost scaling: …"); in the post it reads as a
// figure title, so that half starts with a capital ("— Cost scaling: …").
// charts.py is provenance-bound, so the post's cards are retitled here.
function postTitle(title) {
  const text = String(title || '');
  const sep = ' — ';
  const at = text.indexOf(sep);
  if (at < 0) return text;
  const cut = at + sep.length;
  return text.slice(0, cut) + text.charAt(cut).toUpperCase() + text.slice(cut + 1);
}

// The card's status line (observation count, selection hints) sits at the
// end of the harness pill row on the dashboard; in the column it wraps, and
// its text changes with the selection and the tour, so there it would shift
// the plot. It moves under the plot (the same element, so the card keeps
// updating it).
function statusBelow(card) {
  const status = card.querySelector('.fr-status');
  const body = card.querySelector('.card-body');
  if (status && body) body.appendChild(status);
  return card;
}

// A figure in the reading column is drawn compact (the harness-effect card's
// two panels fit the column side by side, see harness.js); one marked wide
// (`?wide`, `.dash-wide`) keeps the dashboard's geometry at the wide width.
const inColumn = (fig) => !fig.classList.contains('dash-wide');

// The post's own caption says what a figure's marks are, so a card's note
// under the plot (the first-call context card's "Bars: mean per harness…")
// is not mounted here.
async function liveCard(name, forcedHeight, compact) {
  const card = await chartCard(name, { layout: (spec) => columnLayout(spec, forcedHeight), title: postTitle, compact, note: false });
  if (card) return statusBelow(card);
  const p = note(`dashboard chart “${name}” is not in this build`);
  p.classList.add('dash-missing');
  return p;
}

async function mountFigure(fig) {
  fig.replaceChildren(await liveCard(fig.dataset.chart, Number(fig.dataset.height) || null, inColumn(fig)));
}

// While a pane swaps in for the first time, the figure keeps the outgoing
// pane's height: the chart is drawn by charts.js on intersection a few frames
// after the reveal, and without the hold the text below would jump up and
// back down. The hold lifts once the pane has grown (its second resize
// observation) or after 1.5s. A pane that has been drawn before has its full
// height the moment it is shown, so it swaps in with no hold.
function holdHeight(fig, pane) {
  let done = false;
  let seen = 0;
  let ro = null;
  let timer = 0;
  const clear = () => {
    if (done) return;
    done = true;
    fig.style.minHeight = '';
    if (ro) ro.disconnect();
    clearTimeout(timer);
  };
  timer = setTimeout(clear, 1500);
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { if (seen++ > 0) clear(); });
    ro.observe(pane);
  }
  return clear;
}

// One slot, one benchmark at a time. Hidden panes are display:none, so their
// charts stay unrendered until first shown (charts.js renders on intersection
// and the frontier and cost-scaling stories autoplay on reveal).
async function mountSwitch(fig) {
  const panes = [...fig.querySelectorAll('.dash-pane[data-chart]')];
  const bar = document.createElement('div');
  bar.className = 'dash-bench';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'benchmark');
  let active = -1;
  let release = null;
  const show = (i) => {
    if (i === active) return;
    if (release) release();
    // a pane taller than its card head has had its chart drawn
    if (active >= 0 && panes[active].offsetHeight > 120) panes[active].dataset.drawn = '1';
    const hold = fig.isConnected && !panes[i].dataset.drawn;
    if (hold) fig.style.minHeight = `${fig.offsetHeight}px`;
    active = i;
    panes.forEach((p, j) => { p.hidden = j !== i; });
    buttons.forEach((b, j) => {
      b.setAttribute('aria-selected', String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    // hidden charts skipped lazy render; revealing one re-triggers the
    // IntersectionObserver, and an already drawn one re-fits on resize
    window.dispatchEvent(new Event('resize'));
    release = hold ? holdHeight(fig, panes[i]) : null;
  };
  const buttons = panes.map((pane, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.textContent = pane.dataset.label || pane.dataset.bench || pane.dataset.chart;
    btn.dataset.bench = pane.dataset.bench || '';
    btn.addEventListener('click', () => show(i));
    btn.addEventListener('keydown', (ev) => {
      const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      const next = (active + step + panes.length) % panes.length;
      show(next);
      buttons[next].focus();
    });
    return btn;
  });
  bar.append(...buttons);
  fig.prepend(bar);
  const cards = await Promise.all(panes.map((pane) => liveCard(pane.dataset.chart, Number(pane.dataset.height) || null, inColumn(fig))));
  panes.forEach((pane, i) => pane.replaceChildren(cards[i]));
  show(0);
}

function note(text) {
  const p = document.createElement('p');
  p.className = 'section-note';
  p.textContent = text;
  return p;
}

function postNav(posts, active) {
  const nav = document.createElement('nav');
  nav.className = 'bench-tabs blog-nav';
  for (const p of posts) {
    const a = document.createElement('a');
    a.href = `#blog/${encodeURIComponent(p.slug)}`;
    a.textContent = p.title;
    a.setAttribute('aria-pressed', String(p.slug === active));
    nav.appendChild(a);
  }
  return nav;
}

// The article stands on its own in either mode; `draft: false` (the standalone
// public page) additionally drops the post switcher shown when a build carries
// several drafts. The prose and the live figures are identical.
export async function route(hash, boot, { draft = true } = {}) {
  const root = document.getElementById('blog-root');
  root.setAttribute('aria-busy', 'true');
  try {
    const posts = await loadPosts();
    if (!posts.length) {
      root.replaceChildren(note('No blog drafts in this build. Add blog/<slug>.md and rebuild.'));
      return;
    }
    const [wanted, anchor] = hash.startsWith('#blog/') ? decodeURIComponent(hash.slice(6)).split('/')
      : hash.startsWith('#ref-') ? [posts[0].slug, hash.slice(1)] : [posts[0].slug, ''];
    const post = posts.find((p) => p.slug === wanted) || posts[0];
    const data = await getJSON(post.path);
    if (data.missing_images && data.missing_images.length) console.warn(`blog: missing image(s): ${data.missing_images.join(', ')}`);
    if (data.missing_charts && data.missing_charts.length) console.warn(`blog: unknown dashboard chart(s): ${data.missing_charts.join(', ')}`);
    if (!data.rendered) console.warn('blog: markdown renderer unavailable at build time, showing source');
    document.title = data.title || post.title;
    const article = document.createElement('article');
    article.className = 'prose'; // edgeless: the text sits on the page, only the figures' cards carry a border
    article.innerHTML = data.html;
    const jumpTo = (target) => {
      article.querySelectorAll('.ref-hit').forEach((el) => el.classList.remove('ref-hit'));
      target.classList.add('ref-hit');
      target.scrollIntoView({ block: 'center' });
    };
    for (const a of article.querySelectorAll('a[href^="#ref-"], a[href^="#fn-"], a[href^="#fnref-"]')) a.dataset.entry = a.getAttribute('href').slice(1);
    for (const a of article.querySelectorAll('a[data-entry]')) a.href = `#blog/${encodeURIComponent(post.slug)}/${a.dataset.entry}`;
    article.addEventListener('click', (ev) => {
      if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return; // the browser's new-tab gesture
      const a = ev.target.closest('a[data-entry]');
      const target = a ? document.getElementById(a.dataset.entry) : null;
      if (!target || !article.contains(target)) return;
      ev.preventDefault();
      jumpTo(target);
    });
    await Promise.all([...article.querySelectorAll('figure.dash-figure')]
      .map((fig) => (fig.classList.contains('dash-switch') ? mountSwitch(fig) : mountFigure(fig))));
    const children = [article]; // the post alone: build diagnostics went to the console above
    if (draft && posts.length > 1) children.unshift(postNav(posts, post.slug));
    root.replaceChildren(...children);
    const entry = anchor ? document.getElementById(anchor) : null;
    if (entry && article.contains(entry)) jumpTo(entry);
    else window.scrollTo(0, 0);
  } catch (err) {
    root.replaceChildren(note(`failed to load draft: ${err.message}`));
  } finally {
    root.removeAttribute('aria-busy');
  }
}
