// The harness palette: the ONE place the harness colours live in the
// dashboard. Colour encodes the HARNESS, not the model: one colour per
// harness, identical in every model group of the harness-effect card
// (harness.js, "Impact of harnesses on the same model") and reused by the
// Pareto card (frontier.js) for the frontier it draws within a harness
// selection, so one hue means one harness on both cards. The sister mockups
// under mockups/harness-redesign/ carry a verbatim copy of PALETTES.
//
// Owner's request: Pi lighter than pi.dev's dark "driftwood" grey (#5c5752
// read as too bold), Claude Code the Anthropic orange, Codex "the purple on
// the Codex official page". That page is rendered behind a bot check and its
// hex could not be read, so #6f4bd8 is a placeholder; ?codex=<hex> overrides
// it. ?palette=a|b|c switches between three variants to compare: a (default)
// = Pi as pi.dev's lighter warm grey #8b847d (its --color-warm-30 token);
// b = Pi as pi.dev's accent blue #6a9fcc (--color-accent-blue, the grey-blue
// its hero headline uses for the word "yours"); c = a, with a deeper purple
// for Codex and a deeper orange for Claude Code.
export const PALETTES = {
  a: { pi: '#8b847d', cc: '#d97757', codex: '#6f4bd8', words: { pi: 'warm grey', cc: 'orange', codex: 'purple' } },
  b: { pi: '#6a9fcc', cc: '#d97757', codex: '#6f4bd8', words: { pi: 'grey-blue', cc: 'orange', codex: 'purple' } },
  c: { pi: '#8b847d', cc: '#c9663f', codex: '#5b3fd6', words: { pi: 'warm grey', cc: 'deeper orange', codex: 'deeper purple' } },
};
export const PALETTE_PARAMS = new URLSearchParams(location.search);
// a parameter given more than once (?palette=zz&palette=b): the LAST valid value wins, so what the URL ends with is what shows
const lastValid = (key, parse) => PALETTE_PARAMS.getAll(key).reduce((acc, v) => { const r = parse(v); return r === null ? acc : r; }, null);
export const PALETTE_KEY = lastValid('palette', (v) => (PALETTES[v] ? v : null)) || 'a';
// a CSS hex colour, #rgb or #rrggbb, with or without the '#': anything else is ignored and the palette's own purple stands
const parseHex = (v) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((v || '').trim()); if (!m) return null; const h = m[1].length === 3 ? m[1].replace(/./g, (ch) => ch + ch) : m[1]; return '#' + h.toLowerCase(); };
export const CODEX_OVERRIDE = lastValid('codex', parseHex);
export const HARNESS_COLOR = { pi: PALETTES[PALETTE_KEY].pi, cc: PALETTES[PALETTE_KEY].cc, codex: CODEX_OVERRIDE || PALETTES[PALETTE_KEY].codex };
export const HARNESS_WORD = Object.assign({}, PALETTES[PALETTE_KEY].words, CODEX_OVERRIDE ? { codex: 'purple, overridden by ?codex' } : {});
