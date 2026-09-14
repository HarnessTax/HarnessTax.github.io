// Standalone post page: the dashboard's own blog renderer and chart cards,
// without the tab router, the trace viewer or the benchmark dashboard.
import { getJSON } from './data.js';
import { initCharts, onThemeChange } from './charts.js';
import { route as blogRoute } from './blog.js';

const boot = window.__AB_BOOT__;
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function currentMode() {
  const saved = localStorage.getItem('ab-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return mq.matches ? 'dark' : 'light';
}

function applyMode(mode) {
  document.documentElement.dataset.theme = mode;
  onThemeChange(mode);
}

async function main() {
  document.documentElement.dataset.theme = currentMode();
  const themes = await getJSON(boot.theme);
  initCharts(themes, currentMode());

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = currentMode() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ab-theme', next);
    applyMode(next);
  });
  mq.addEventListener('change', () => {
    if (!localStorage.getItem('ab-theme')) applyMode(currentMode());
  });

  await blogRoute(location.hash, boot, { draft: false });
}

main();
