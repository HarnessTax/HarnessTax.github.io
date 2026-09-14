// Single fetch seam: everything the dashboard reads goes through getJSON,
// so a future query backend can slot in without touching views.
const cache = new Map();

export function getJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(url);
}
