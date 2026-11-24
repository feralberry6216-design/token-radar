/* Token Launch Radar — the page. Everything renders from window.RADAR (data.js, written by
   main.ts from the sealed snapshot): no fetch, no network, no framework.
   Routes: #/ board · #/live already-trading strip · #/protocol/<slug> detail overlay ·
   #/?category=Dexs&chain=Base&q=… pre-set filters (the same links the screenshots use). */
'use strict';

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.s, r]));
const state = { view: 'board', q: '', cat: '', chain: '', minTvl: 0, watch: false, sort: 'i', dir: -1, shown: 60 };

const $ = (sel, el) => (el || document).querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function pct(n) {
  if (n === null || n === undefined) return '<span class="chains">n/a</span>';
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 365) return `${days} days`;
  const y = Math.floor(days / 365);
  return `${y} yr ${days - y * 365} d`;
}

/* ------------------------------------------------ header stats */
function renderStats() {
  const totalImplied = rows.reduce((n, r) => n + r.i, 0);
  const cell = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  $('#stats').innerHTML =
    cell(R.scanned, 'protocols scanned') +
    cell(rows.length, 'pre-token ranked') +
    cell(`${R.watchlist_size} / ${R.watchlist_size}`, 'watchlist covered') +
    cell(money(totalImplied), 'total implied value') +
    cell(R.as_of, 'snapshot date');
}

/* ------------------------------------------------ the board */
function filtered() {
  const q = state.q.trim().toLowerCase();
  return rows.filter((r) =>
    (state.cat === '' || r.c === state.cat) &&
    (state.chain === '' || r.ch.includes(state.chain)) &&
    r.t >= state.minTvl &&
    (!state.watch || r.w) &&
    (q === '' || r.n.toLowerCase().includes(q) || r.s.includes(q)),
  );
}
function sorted(list) {
  const k = state.sort, d = state.dir;
  const val = (r) => (k === 'n' ? r.n.toLowerCase() : k === 'ratio' ? r.i / r.t : r[k]);
  return [...list].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === vb) return a.r - b.r;
    return (va < vb ? -1 : 1) * d;
  });
}
function rowHtml(r) {
  const chains = r.ch.slice(0, 3).join(', ') + (r.ch.length > 3 ? ` +${r.ch.length - 3}` : '');
  return `<tr data-slug="${esc(r.s)}" tabindex="0" aria-label="Details for ${esc(r.n)}">
    <td class="rank">${r.r}</td>
    <td class="name">${esc(r.n)}${r.w ? '<span class="badge watch">WATCHLIST</span>' : ''}<span class="badge pre">PRE-TOKEN</span></td>
    <td class="cat">${esc(r.c ?? '—')}</td>
    <td class="chains">${esc(chains)}</td>
    <td class="money num">${money(r.t)}</td>
    <td class="pct num">${pct(r.d)}</td>
    <td class="implied num">${money(r.i)}</td>
    <td class="money num">${(r.i / r.t).toFixed(2)}×</td></tr>`;
}
function boardHtml() {
  const list = sorted(filtered());
  const visible = list.slice(0, state.shown);
  const cats = [...new Set(rows.map((r) => r.c).filter(Boolean))].sort();
  const chainCounts = new Map();
  for (const r of rows) for (const c of r.ch) chainCounts.set(c, (chainCounts.get(c) || 0) + 1);
  const chains = [...chainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([c]) => c);
  const opts = (items, cur, all) =>
    `<option value="">${all}</option>` + items.map((v) => `<option ${v === cur ? 'selected' : ''} value="${esc(typeof v === 'string' ? v : v)}">${esc(v)}</option>`).join('');
  const th = (key, label, num) => `<th data-sort="${key}" class="${num ? 'num' : ''}">${label}${state.sort === key ? (state.dir === -1 ? ' ↓' : ' ↑') : ''}</th>`;
  return `
  <div class="controls">
    <input type="search" id="q" placeholder="Search name or slug…" value="${esc(state.q)}" aria-label="Search protocols">
    <select id="cat" aria-label="Filter by category">${opts(cats, state.cat, 'All categories')}</select>
    <select id="chain" aria-label="Filter by chain">${opts(chains, state.chain, 'All chains')}</select>
    <select id="minTvl" aria-label="Minimum TVL">
      ${[[0, 'Any TVL'], [1e7, 'TVL ≥ $10M'], [5e7, 'TVL ≥ $50M'], [2.5e8, 'TVL ≥ $250M'], [1e9, 'TVL ≥ $1B']].map(([v, l]) => `<option value="${v}" ${state.minTvl === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <label><input type="checkbox" id="watch" ${state.watch ? 'checked' : ''}> Watchlist only</label>
    <span class="count">${list.length} of ${rows.length} shown</span>
  </div>
  <table class="board"><thead><tr>
    ${th('r', '#')}${th('n', 'Protocol')}<th>Category</th><th class="chains">Chains</th>
    ${th('t', 'TVL', 1)}${th('d', '7d %', 1)}${th('i', 'Implied value', 1)}${th('ratio', 'FDV / TVL', 1)}
  </tr></thead><tbody>${visible.map(rowHtml).join('')}</tbody></table>
  ${list.length > state.shown ? `<button class="more" id="more">Show more (${list.length - state.shown} remaining)</button>` : ''}
  ${modelHtml()}`;
}
function wireBoard() {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('#q', 'input', (e) => { state.q = e.target.value; state.shown = 60; rerender(false); $('#q').focus(); const q = $('#q'); q.setSelectionRange(q.value.length, q.value.length); });
  on('#cat', 'change', (e) => { state.cat = e.target.value; state.shown = 60; rerender(); });
  on('#chain', 'change', (e) => { state.chain = e.target.value; state.shown = 60; rerender(); });
  on('#minTvl', 'change', (e) => { state.minTvl = Number(e.target.value); state.shown = 60; rerender(); });
  on('#watch', 'change', (e) => { state.watch = e.target.checked; state.shown = 60; rerender(); });
  on('#more', 'click', () => { state.shown += 120; rerender(); });
  document.querySelectorAll('th[data-sort]').forEach((el) => el.addEventListener('click', () => {
    const k = el.getAttribute('data-sort');
    if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'n' ? 1 : -1; }
    rerender();
  }));
  document.querySelectorAll('tbody tr[data-slug]').forEach((el) => {
    const open = () => { location.hash = `#/protocol/${el.getAttribute('data-slug')}`; };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

/* ------------------------------------------------ already trading */
function liveHtml() {
  const body = R.live.map((p) => `<tr>
    <td class="name">${esc(p.n)}${p.y ? ` <span class="chains">${esc(p.y)}</span>` : ''}</td>
    <td class="cat">${esc(p.c ?? '—')}</td>
    <td class="money num">${money(p.t)}</td>
    <td class="money num">${money(p.k)}</td>
    <td class="money num">${p.k ? `${(p.k / p.t).toFixed(2)}×` : '—'}</td></tr>`).join('');
  return `<p class="tagline" style="margin:16px 0 4px">These protocols already have a token — the market has priced them, so the radar never ranks them.
    They are shown only to calibrate the model: its category multiples are set against the FDV/TVL these peers actually trade at.</p>
  <table class="board"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap (real)</th><th class="num">Mcap / TVL</th></tr></thead>
  <tbody>${body}</tbody></table>${modelHtml()}`;
}

/* ------------------------------------------------ the model, stated on the page */
function modelHtml() {
  const m = R.model;
  const mults = Object.entries(R.multiples).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<b>${esc(k)}</b> ${v.toFixed(2)}×`).join(' · ');
  return `<section class="model"><h2>HOW IMPLIED VALUE IS COMPUTED</h2>
  <p><code>implied = TVL × category multiple × growth factor × maturity factor × breadth factor</code> — every term comes from the snapshot's own figures (version <code>${esc(R.model_version)}</code>).</p>
  <p><b>Growth factor</b> clamps the 7-day TVL change to ${m.growth_input_floor}%…+${m.growth_input_cap}% and scales it by ${m.growth_weight}, bounded to ${m.growth_floor}×–${m.growth_cap}×.
     <b>Maturity factor</b> runs ${m.maturity_base}–${(m.maturity_base + m.maturity_span).toFixed(2)} over ${m.maturity_days} days since DefiLlama first tracked the protocol (unknown dates count as ${m.unknown_age_days} days): a long tokenless record is worth more.
     <b>Breadth factor</b> adds ${(m.breadth_per_chain * 100).toFixed(0)}% per extra chain, up to ${m.breadth_max_extra_chains}.</p>
  <p class="mults">Category multiples (FDV per $1 of TVL): ${mults} · anything unlisted ${m.default_multiple.toFixed(2)}×</p>
  <p><b>Where the multiples come from.</b> For every category with at least five tokenised peers in the snapshot, the multiple is measured, not chosen: it is the median market cap per $1 of TVL at which those launched peers actually trade (lending 0.13×, DEXs 0.34×, yield 0.19×, RWA 0.28×, basis trading 0.65×). Categories with fewer tokenised peers keep an estimated multiple. The growth, maturity and breadth adjustments above apply on top in both cases.</p>
  <p><b>Curators are priced as asset managers.</b> A vault curator's TVL is other people's money: assets under management sitting inside host protocols, where the same dollars are already counted in the host's own TVL. What the curator owns is a fee stream on that AUM — management and performance fees of roughly 0.5–2% of AUM a year — so curator and allocator rows are priced at 0.26× TVL, twice the lending median, rather than at a per-TVL rate of their own. The rule fires on the curator categories, plus a short named list of curator businesses the snapshot files under other categories.</p>
  <p>Click any row for its own arithmetic — the five factors behind its number — and the farm plan the radar writes for it.</p></section>`;
}

/* ------------------------------------------------ detail overlay */
function detailHtml(r) {
  const cells = [
    [money(r.i), 'implied value'], [money(r.t), 'TVL'], [r.d === null ? 'n/a' : `${r.d > 0 ? '+' : ''}${r.d.toFixed(1)}%`, 'TVL change, 7d'],
    [ageText(r.a), 'tracked for'], [r.l ?? 'unknown', 'first tracked'], [`#${r.r} of ${rows.length}`, 'radar rank'],
  ].map(([v, l]) => `<div class="cell"><b>${v}</b><span>${l}</span></div>`).join('');
  const steps = r.f.map((s) => `<li>${esc(s)}</li>`).join('');
  return `<div class="scrim" id="scrim"><article class="detail" role="dialog" aria-label="Details for ${esc(r.n)}">
    <button class="close" id="close">✕ Close</button>
    <h2>${esc(r.n)}</h2>
    <p class="sub">${esc(r.c ?? 'Uncategorised')} · ${esc(r.ch.join(', ') || 'no chains listed')} · slug <span style="font-family:var(--mono)">${esc(r.s)}</span>
    ${r.w ? ' · <span style="color:var(--amber)">on the house watchlist</span>' : ''} · records no token yet</p>
    <div class="grid">${cells}</div>
    <h3>Why this value — the model, line by line</h3>
    <p class="breakdown">
      TVL <b>${money(r.t)}</b> × category multiple <b>${r.m.toFixed(2)}×</b> (${esc(r.c ?? 'default')})<br>
      × growth factor <b>${r.g.toFixed(3)}×</b> (7d change ${r.d === null ? 'unreported' : `${r.d.toFixed(1)}%`})<br>
      × maturity factor <b>${r.u.toFixed(3)}×</b> (${ageText(r.a)} with no token)<br>
      × breadth factor <b>${r.b.toFixed(3)}×</b> (${r.ch.length} chain${r.ch.length === 1 ? '' : 's'})<br>
      = <span class="eq">${money(r.i)} implied launch value</span> — an FDV of ${(r.i / r.t).toFixed(2)}× its current TVL.
    </p>
    <h3>Farm plan — before the token exists</h3>
    <ol class="steps">${steps}</ol>
  </article></div>`;
}
function openDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) return;
  document.body.insertAdjacentHTML('beforeend', detailHtml(r));
  const close = () => { location.hash = state.view === 'live' ? '#/live' : '#/'; };
  $('#close').addEventListener('click', close);
  $('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim') close(); });
  document.addEventListener('keydown', function esc2(e) {
    if (e.key === 'Escape') { document.removeEventListener('keydown', esc2); close(); }
  });
}
function closeDetail() { const s = $('#scrim'); if (s) s.remove(); }

/* ------------------------------------------------ routing + render */
function tabsHtml() {
  return `<nav class="tabs">
    <button class="tab" data-view="board" aria-selected="${state.view === 'board'}">PRE-TOKEN BOARD</button>
    <button class="tab" data-view="live" aria-selected="${state.view === 'live'}">ALREADY TRADING</button>
  </nav>`;
}
function rerender(rewire = true) {
  closeDetail();
  $('#app').innerHTML = tabsHtml() + (state.view === 'board' ? boardHtml() : liveHtml());
  $('#app').setAttribute('aria-busy', 'false');
  document.querySelectorAll('.tab').forEach((el) => el.addEventListener('click', () => {
    state.view = el.getAttribute('data-view');
    location.hash = state.view === 'live' ? '#/live' : '#/';
    rerender();
  }));
  if (state.view === 'board' && rewire) wireBoard();
}
function route() {
  const h = location.hash || '#/';
  const detail = h.match(/^#\/protocol\/(.+)$/);
  if (h.startsWith('#/?')) {
    const params = new URLSearchParams(h.slice(3));
    state.cat = params.get('category') || '';
    state.chain = params.get('chain') || '';
    state.q = params.get('q') || '';
    state.watch = params.get('watch') === '1';
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl'));
    state.view = 'board';
    rerender();
  } else if (h === '#/live') {
    state.view = 'live';
    rerender();
  } else if (detail) {
    if (!$('#scrim')) rerender();
    closeDetail();
    openDetail(decodeURIComponent(detail[1]));
    return;
  } else {
    state.view = 'board';
    rerender();
  }
  if (detail) openDetail(decodeURIComponent(detail[1]));
}
window.addEventListener('hashchange', route);
renderStats();
route();
