'use strict';

/* ================= Constantes ================= */
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const STORE_KEY = 'sequence.v1';
const SHOW_REFRESH_MS = 6 * 3600e3;

const ICON = {
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  chevron: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bookmark: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z"/></svg>',
};

/* ================= État persistant ================= */
function blankState() { return { v: 1, token: '', shows: {}, movies: {} }; }
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.v === 1) return Object.assign(blankState(), s);
  } catch (e) { /* stockage indisponible */ }
  return blankState();
}
let state = loadState();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Enregistrement impossible : le stockage du téléphone est plein.'); }
}
// Évite que le navigateur efface les données quand l'espace manque.
navigator.storage?.persist?.().catch(() => {});

/* État d'interface (non sauvegardé) */
const ui = {
  seriesTab: 'watch',
  filmsTab: 'watchlist',
  query: '',
  openSeasons: {},     // id série -> Set de numéros de saison ouverts
  expanded: {},        // résumés dépliés
  confirm: null,       // action destructive en attente de confirmation
  pendingImport: null,
  tokenMsg: '',
};

/* ================= TMDB ================= */
function tmdbFetch(path, params = {}, token = state.token) {
  const url = new URL(API + path);
  url.searchParams.set('language', 'fr-FR');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  const t = token.trim();
  if (t.length > 40) headers.Authorization = 'Bearer ' + t;
  else url.searchParams.set('api_key', t);
  return fetch(url, { headers }).then(async r => {
    if (r.status === 401) throw new Error('Clé TMDB refusée. Vérifie-la dans Profil.');
    if (r.status === 404) throw new Error('Introuvable sur TMDB.');
    if (!r.ok) throw new Error('TMDB ne répond pas (erreur ' + r.status + ').');
    return r.json();
  }, () => { throw new Error('Pas de connexion internet.'); });
}

const mem = new Map();     // clé -> { t, data, p }
const errors = new Map();  // clé -> message
const cacheKey = (path, params) => path + '?' + new URLSearchParams(params);

function api(path, params = {}, ttl = 10 * 60e3) {
  const key = cacheKey(path, params);
  const hit = mem.get(key);
  if (hit?.p) return hit.p;
  if (hit && hit.data !== undefined && Date.now() - hit.t < ttl) return Promise.resolve(hit.data);
  const p = tmdbFetch(path, params).then(
    data => { mem.set(key, { t: Date.now(), data }); errors.delete(key); return data; },
    err => {
      if (hit?.data !== undefined) mem.set(key, { t: hit.t, data: hit.data }); else mem.delete(key);
      errors.set(key, err.message);
      throw err;
    });
  mem.set(key, { ...hit, p });
  return p;
}

// Lecture synchrone pour le rendu : renvoie la donnée en cache ou lance le chargement.
function useData(path, params = {}) {
  const key = cacheKey(path, params);
  const hit = mem.get(key);
  if (hit?.data !== undefined) return { data: hit.data, t: hit.t };
  if (errors.has(key)) return { error: errors.get(key) };
  if (!hit?.p) {
    const route = location.hash;
    api(path, params).then(
      () => { if (location.hash === route) rerender(); },
      () => { if (location.hash === route) rerender(); });
  }
  return { loading: true };
}

/* ================= Séries : logique ================= */
const epKey = (s, e) => s + 'x' + e;

function slimShow(d, prev) {
  const ep = x => x ? { s: x.season_number, e: x.episode_number, d: x.air_date || '', name: x.name || '' } : null;
  return {
    id: d.id,
    name: d.name,
    poster: d.poster_path || null,
    backdrop: d.backdrop_path || null,
    status: d.status || '',
    year: (d.first_air_date || '').slice(0, 4),
    runtime: (d.episode_run_time && d.episode_run_time[0]) || d.last_episode_to_air?.runtime || 40,
    seasons: (d.seasons || [])
      .filter(s => s.season_number > 0 && s.episode_count > 0)
      .map(s => ({ n: s.season_number, c: s.episode_count }))
      .sort((a, b) => a.n - b.n),
    last: ep(d.last_episode_to_air),
    next: ep(d.next_episode_to_air),
    updatedAt: Date.now(),
    addedAt: prev?.addedAt || Date.now(),
    watched: prev?.watched || {},
    archived: prev?.archived || false,
  };
}

function isAired(sh, s, e) {
  const l = sh.last;
  return !!l && (s < l.s || (s === l.s && e <= l.e));
}

function airedEpisodes(sh) {
  const out = [];
  for (const se of sh.seasons) {
    for (let e = 1; e <= se.c; e++) {
      if (!isAired(sh, se.n, e)) break;
      out.push([se.n, e]);
    }
  }
  return out;
}

function progress(sh) {
  const aired = airedEpisodes(sh);
  let watched = 0, next = null;
  for (const [s, e] of aired) {
    if (sh.watched[epKey(s, e)]) watched++;
    else if (!next) next = { s, e };
  }
  return { aired: aired.length, watched, next, left: aired.length - watched };
}

function bucket(sh) {
  if (sh.archived) return 'archived';
  const p = progress(sh);
  if (p.next) return p.watched > 0 ? 'watching' : 'notstarted';
  if (sh.status === 'Ended' || sh.status === 'Canceled') return 'finished';
  return 'uptodate';
}

const lastWatchedAt = sh => Math.max(0, ...Object.values(sh.watched));

function setEp(sh, s, e, on) {
  const k = epKey(s, e);
  if (on) sh.watched[k] = sh.watched[k] || Date.now();
  else delete sh.watched[k];
}

async function trackShow(id) {
  const d = await api(`/tv/${id}`);
  state.shows[id] = slimShow(d, state.shows[id]);
  save();
  return state.shows[id];
}

let refreshing = false;
async function refreshShows(force = false) {
  if (refreshing || !state.token) return;
  refreshing = true;
  const stale = Object.values(state.shows)
    .filter(sh => !sh.archived && (force || Date.now() - sh.updatedAt > SHOW_REFRESH_MS));
  let changed = false;
  const work = stale.slice();
  async function worker() {
    while (work.length) {
      const sh = work.shift();
      try {
        const d = await api(`/tv/${sh.id}`, {}, 0);
        if (state.shows[sh.id]) { state.shows[sh.id] = slimShow(d, state.shows[sh.id]); changed = true; }
      } catch (e) { /* on réessaiera plus tard */ }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  refreshing = false;
  if (changed) { save(); rerender(); }
}

/* ================= Formatage ================= */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const code = (s, e) => `S${pad(s)} E${pad(e)}`;

function parseDay(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dayDiff(iso) {
  const d = parseDay(iso); if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400e3);
}
const fmtLong = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
function relDay(iso) {
  const n = dayDiff(iso);
  if (n === null) return 'Date inconnue';
  if (n < 0) return 'Déjà diffusé';
  if (n === 0) return 'Aujourd’hui';
  if (n === 1) return 'Demain';
  if (n < 7) return fmtWeekday.format(parseDay(iso));
  return fmtShort.format(parseDay(iso));
}
const longDate = iso => iso ? fmtLong.format(parseDay(iso)) : '';

function fmtDuration(min) {
  min = Math.round(min);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d} j ${h} h`;
  if (h) return m ? `${h} h ${pad(m)}` : `${h} h`;
  return `${m} min`;
}
const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

const STATUS_FR = {
  'Returning Series': 'En cours de diffusion',
  'Ended': 'Terminée',
  'Canceled': 'Annulée',
  'In Production': 'En production',
  'Planned': 'Prévue',
  'Pilot': 'Pilote',
};

function poster(path, alt, size = 'w342') {
  const img = path
    ? `<img src="${IMG}${size}${esc(path)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
    : '';
  return `<div class="poster">${img}<div class="ph">${esc(alt)}</div></div>`;
}

/* ================= Vues ================= */
function viewWelcome() {
  return `<div class="pad welcome">
    <h1>Séquence</h1>
    <p class="lede">Coche chaque épisode, garde une liste de films à voir et sache ce qui sort cette semaine.</p>
    <div class="panel">
      <b>Une étape avant de commencer</b>
      <p>Les infos des séries et films viennent de TMDB, une base gratuite. Il faut une clé personnelle (2 minutes) :</p>
      <ol class="steps">
        <li>Crée un compte sur <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener">themoviedb.org</a></li>
        <li>Va dans <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Paramètres → API</a> et demande une clé (usage personnel)</li>
        <li>Copie le <b>jeton d’accès en lecture</b> (ou la clé API) et colle-le ici</li>
      </ol>
      ${tokenField()}
    </div>
  </div>`;
}

function tokenField() {
  return `<div class="field">
      <label for="tok">Clé ou jeton TMDB</label>
      <input class="input" id="tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="eyJhbGciOi… ou 32 caractères" value="${esc(state.token)}">
    </div>
    <div class="row"><button class="btn primary" data-act="save-token">Enregistrer la clé</button></div>
    ${ui.tokenMsg ? `<div class="${ui.tokenMsg.startsWith('✓') ? '' : 'err'}">${esc(ui.tokenMsg)}</div>` : ''}`;
}

function seg(name, current, options) {
  return `<div class="seg" role="group">${options.map(([v, label]) =>
    `<button data-act="seg" data-name="${name}" data-v="${v}" aria-pressed="${v === current}">${label}</button>`).join('')}</div>`;
}

function viewSeries() {
  const shows = Object.values(state.shows);
  let body;
  if (!shows.length) {
    body = `<div class="empty"><b>Aucune série suivie</b><p>Cherche une série et appuie sur + pour la suivre épisode par épisode.</p><a class="btn primary" href="#/decouvrir">Trouver une série</a></div>`;
  } else if (ui.seriesTab === 'watch') {
    const watching = shows.filter(s => bucket(s) === 'watching').sort((a, b) => lastWatchedAt(b) - lastWatchedAt(a));
    const fresh = shows.filter(s => bucket(s) === 'notstarted').sort((a, b) => b.addedAt - a.addedAt);
    body = '';
    if (watching.length) body += `<h2>À regarder <small>${watching.length}</small></h2><div class="wlist">${watching.map(watchCard).join('')}</div>`;
    if (fresh.length) body += `<h2>Pas encore commencées <small>${fresh.length}</small></h2><div class="wlist">${fresh.map(watchCard).join('')}</div>`;
    if (!body) body = `<div class="empty"><b>Tu es à jour</b><p>Plus aucun épisode en retard. Les prochains apparaîtront ici dès leur diffusion.</p></div>`;
  } else if (ui.seriesTab === 'upcoming') {
    const ups = shows.filter(s => !s.archived && s.next && dayDiff(s.next.d) !== null && dayDiff(s.next.d) >= 0)
      .sort((a, b) => a.next.d.localeCompare(b.next.d));
    if (!ups.length) body = `<div class="empty"><b>Rien d’annoncé</b><p>Aucune date de diffusion connue pour tes séries.</p></div>`;
    else {
      body = ''; let lastDay = null;
      for (const sh of ups) {
        if (sh.next.d !== lastDay) {
          lastDay = sh.next.d;
          body += `<div class="daylabel ${dayDiff(lastDay) === 0 ? 'today' : ''}">${esc(relDay(lastDay))}</div>`;
        }
        body += `<a class="uprow" href="#/tv/${sh.id}">${poster(sh.poster, sh.name, 'w154')}
          <div style="min-width:0"><div class="uprow-name">${esc(sh.name)}</div>
          <div class="uprow-ep"><span class="code">${code(sh.next.s, sh.next.e)}</span>${esc(sh.next.name)}</div></div>
          <div class="when">${esc(fmtShort.format(parseDay(sh.next.d)))}</div></a>`;
      }
    }
  } else {
    const groups = [
      ['watching', 'En cours'], ['notstarted', 'Pas commencées'], ['uptodate', 'À jour'],
      ['finished', 'Terminées'], ['archived', 'Abandonnées'],
    ];
    body = groups.map(([b, label]) => {
      const list = shows.filter(s => bucket(s) === b).sort((x, y) => x.name.localeCompare(y.name, 'fr'));
      if (!list.length) return '';
      return `<h2>${label} <small>${list.length}</small></h2><div class="grid">${list.map(sh => {
        const p = progress(sh);
        const pct = p.aired ? Math.round(p.watched / p.aired * 100) : 0;
        return `<a class="tile" href="#/tv/${sh.id}">${poster(sh.poster, sh.name)}
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="tile-name">${esc(sh.name)}</div>
          <div class="tile-sub">${p.watched}/${p.aired} ép.</div></a>`;
      }).join('')}</div>`;
    }).join('');
  }
  return `<div class="pad">
    <header class="top"><h1>Séries</h1></header>
    ${shows.length ? seg('seriesTab', ui.seriesTab, [['watch', 'À regarder'], ['upcoming', 'À venir'], ['all', 'Toutes']]) : ''}
    ${body}
  </div>`;
}

function watchCard(sh) {
  const p = progress(sh);
  const pct = p.aired ? Math.round(p.watched / p.aired * 100) : 0;
  const n = p.next;
  return `<article class="wcard">
    <a href="#/tv/${sh.id}" tabindex="-1">${poster(sh.poster, sh.name, 'w154')}</a>
    <div class="wcard-body">
      <a href="#/tv/${sh.id}" class="wcard-title">${esc(sh.name)}</a>
      <div class="wcard-ep"><span class="code">${code(n.s, n.e)}</span><span data-title="${sh.id}:${n.s}:${n.e}"></span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="wcard-meta">${p.left > 1 ? plural(p.left, 'épisode restant', 'épisodes restants') : 'Dernier épisode disponible'}</div>
    </div>
    <button class="checkbtn" data-act="next" data-id="${sh.id}" aria-label="Marquer ${code(n.s, n.e)} comme vu">${ICON.check}</button>
  </article>`;
}

// Complète les titres d'épisodes après le rendu (saisons chargées à la demande).
function fillTitles() {
  for (const el of document.querySelectorAll('[data-title]')) {
    const [id, s, e] = el.dataset.title.split(':').map(Number);
    api(`/tv/${id}/season/${s}`, {}, SHOW_REFRESH_MS).then(season => {
      const ep = season.episodes?.find(x => x.episode_number === e);
      if (ep?.name && el.isConnected) el.textContent = ep.name;
    }, () => {});
  }
}

function viewFilms() {
  const all = Object.values(state.movies);
  const list = all.filter(m => m.status === ui.filmsTab)
    .sort((a, b) => ui.filmsTab === 'watched' ? (b.watchedAt || 0) - (a.watchedAt || 0) : b.addedAt - a.addedAt);
  const counts = { watchlist: all.filter(m => m.status === 'watchlist').length, watched: all.filter(m => m.status === 'watched').length };
  let body;
  if (!list.length) {
    body = ui.filmsTab === 'watchlist'
      ? `<div class="empty"><b>Ta liste est vide</b><p>Ajoute les films que tu veux voir depuis Découvrir.</p><a class="btn primary" href="#/decouvrir">Trouver un film</a></div>`
      : `<div class="empty"><b>Aucun film vu</b><p>Marque un film comme vu depuis sa fiche pour le retrouver ici.</p></div>`;
  } else {
    body = `<div class="grid" style="margin-top:16px">${list.map(m => `<a class="tile" href="#/movie/${m.id}">${poster(m.poster, m.title)}
      <div class="tile-name">${esc(m.title)}</div>
      <div class="tile-sub">${esc(m.year || '')}${m.status === 'watched' && m.watchedAt ? ' · vu le ' + new Date(m.watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''}</div></a>`).join('')}</div>`;
  }
  return `<div class="pad">
    <header class="top"><h1>Films</h1></header>
    ${seg('filmsTab', ui.filmsTab, [['watchlist', `À voir · ${counts.watchlist}`], ['watched', `Vus · ${counts.watched}`]])}
    ${body}
  </div>`;
}

function viewDiscover() {
  return `<div class="pad">
    <header class="top"><h1>Découvrir</h1></header>
    <label class="searchbox">${ICON.search}
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Une série, un film…" value="${esc(ui.query)}" aria-label="Rechercher une série ou un film">
    </label>
    <div id="results">${resultsHTML()}</div>
  </div>`;
}

function isAdded(type, id) { return type === 'tv' ? !!state.shows[id] : !!state.movies[id]; }

function resultsHTML() {
  const q = ui.query.trim();
  if (q.length >= 2) {
    const r = useData('/search/multi', { query: q, include_adult: 'false' });
    if (r.loading) return `<div class="loading"><div class="spinner"></div>Recherche…</div>`;
    if (r.error) return errorBlock(r.error);
    const items = (r.data.results || []).filter(x => x.media_type === 'tv' || x.media_type === 'movie');
    if (!items.length) return `<div class="empty"><b>Aucun résultat</b><p>Essaie avec le titre original ou moins de mots.</p></div>`;
    return `<div class="rlist" style="margin-top:8px">${items.map(x => {
      const type = x.media_type, title = x.name || x.title;
      const year = (x.first_air_date || x.release_date || '').slice(0, 4);
      const on = isAdded(type, x.id);
      return `<div class="rrow">
        <a class="rrow-link" href="#/${type}/${x.id}">${poster(x.poster_path, title, 'w154')}
          <div style="min-width:0"><div class="rrow-title">${esc(title)}</div>
          <div class="rrow-meta"><span class="chip">${type === 'tv' ? 'Série' : 'Film'}</span>${esc(year)}</div>
          ${x.overview ? `<div class="rrow-over">${esc(x.overview)}</div>` : ''}</div></a>
        <button class="addbtn ${on ? 'on' : ''}" data-act="quickadd" data-type="${type}" data-id="${x.id}" aria-label="${on ? 'Déjà ajouté' : 'Ajouter'}">${on ? ICON.check : ICON.plus}</button>
      </div>`;
    }).join('')}</div>`;
  }
  const tv = useData('/trending/tv/week');
  const mv = useData('/trending/movie/week');
  const rail = (r, type) => {
    if (r.loading) return `<div class="loading"><div class="spinner"></div></div>`;
    if (r.error) return errorBlock(r.error);
    return `<div class="rail">${r.data.results.slice(0, 20).map(x => {
      const title = x.name || x.title;
      return `<a class="tile" href="#/${type}/${x.id}"><div style="position:relative">${poster(x.poster_path, title)}${isAdded(type, x.id) ? `<span class="badge">${ICON.check}</span>` : ''}</div>
        <div class="tile-name">${esc(title)}</div></a>`;
    }).join('')}</div>`;
  };
  return `<h2>Séries populaires cette semaine</h2>${rail(tv, 'tv')}<h2>Films populaires cette semaine</h2>${rail(mv, 'movie')}`;
}

function errorBlock(msg) {
  return `<div class="empty"><b class="err">${esc(msg)}</b><button class="btn" data-act="retry">Réessayer</button></div>`;
}
function loadingView() {
  return `<button class="backbtn" data-act="back" aria-label="Retour">${ICON.back}</button><div class="loading" style="padding-top:120px"><div class="spinner"></div>Chargement…</div>`;
}

function hero(backdrop, posterPath, title, meta) {
  return `<div class="hero">
    <div class="hero-bg">${backdrop ? `<img src="${IMG}w780${esc(backdrop)}" alt="" onerror="this.remove()">` : ''}</div>
    <button class="backbtn" data-act="back" aria-label="Retour">${ICON.back}</button>
    <div class="hero-inner pad">${poster(posterPath, title)}
      <div style="min-width:0"><h1>${esc(title)}</h1><div class="hero-meta">${meta}</div></div>
    </div>
  </div>`;
}

function overviewBlock(key, text) {
  if (!text) return '';
  const open = ui.expanded[key];
  return `<p class="overview ${open || text.length < 260 ? '' : 'clamp'}">${esc(text)}</p>
    ${text.length >= 260 ? `<button class="linkbtn" data-act="expand" data-key="${key}">${open ? 'Réduire' : 'Lire la suite'}</button>` : ''}`;
}

function viewTv(id) {
  let sh = state.shows[id];
  const r = useData(`/tv/${id}`);
  const d = r.data;
  if (!d && !sh) return r.error ? `<button class="backbtn" data-act="back" aria-label="Retour">${ICON.back}</button><div style="padding-top:80px">${errorBlock(r.error)}</div>` : loadingView();
  // Met à jour la série suivie avec les infos fraîches.
  if (d && sh && r.t > sh.updatedAt) { sh = state.shows[id] = slimShow(d, sh); save(); }
  const base = sh || slimShow(d);
  const meta = [base.year, d?.networks?.[0]?.name, STATUS_FR[base.status] || base.status].filter(Boolean).map(esc).join(' · ');

  let actions;
  if (sh) {
    const armed = ui.confirm === 'untrack:' + id;
    actions = `<div class="actions pad">
      <button class="btn small" data-act="archive" data-id="${id}">${sh.archived ? 'Reprendre la série' : 'Abandonner'}</button>
      <button class="btn small danger ${armed ? 'armed' : ''}" data-act="untrack" data-id="${id}">${armed ? 'Confirmer : tout effacer' : 'Retirer de mes séries'}</button>
    </div>`;
  } else {
    actions = `<div class="actions pad"><button class="btn primary grow" data-act="track" data-id="${id}">${ICON.plus} Suivre cette série</button></div>`;
  }

  let prog = '';
  if (sh) {
    const p = progress(sh);
    const pct = p.aired ? Math.round(p.watched / p.aired * 100) : 0;
    const nextTxt = p.next ? `Prochain : <b>${code(p.next.s, p.next.e)}</b>` : (base.next ? `Prochain épisode : ${esc(relDay(base.next.d)).toLowerCase()}` : 'À jour');
    prog = `<div class="progress pad">
      <div class="progress-row"><span><b>${p.watched}</b> / ${p.aired} épisodes vus</span><span>${nextTxt}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }

  const genres = d?.genres?.length ? `<div class="genres pad">${d.genres.map(g => `<span class="chip">${esc(g.name)}</span>`).join('')}</div>` : '';

  // Saisons : ouvre par défaut celle du prochain épisode.
  if (!ui.openSeasons[id]) {
    const nxt = sh ? progress(sh).next : null;
    ui.openSeasons[id] = new Set([nxt ? nxt.s : (base.seasons[0]?.n ?? 1)]);
  }
  const seasons = base.seasons.map(se => seasonBlock(base, sh, se)).join('');

  return `${hero(base.backdrop, base.poster, base.name, meta)}
    ${prog}${actions}${genres}
    <div class="pad">${overviewBlock('tv' + id, d?.overview)}</div>
    <div class="pad"><h2>Saisons <small>${base.seasons.length}</small></h2>${seasons || '<p class="ep-date">Aucun épisode annoncé.</p>'}</div>`;
}

function seasonBlock(base, sh, se) {
  const open = ui.openSeasons[base.id].has(se.n);
  let airedCount = 0, seenCount = 0;
  for (let e = 1; e <= se.c; e++) {
    if (isAired(base, se.n, e)) { airedCount++; if (sh?.watched[epKey(se.n, e)]) seenCount++; }
  }
  const done = airedCount > 0 && seenCount === airedCount;
  let eps = '';
  if (open) {
    const r = useData(`/tv/${base.id}/season/${se.n}`);
    const list = r.data?.episodes?.length
      ? r.data.episodes.filter(x => x.episode_number <= se.c)
      : Array.from({ length: se.c }, (_, i) => ({ episode_number: i + 1 }));
    eps = `<ol class="eps">${r.loading ? `<li class="ep"><span class="ep-date">Chargement des épisodes…</span></li>` : ''}${list.map(x => {
      const e = x.episode_number;
      const aired = isAired(base, se.n, e);
      const seen = !!sh?.watched[epKey(se.n, e)];
      const bits = [];
      if (x.air_date) bits.push(aired || dayDiff(x.air_date) < 0 ? longDate(x.air_date) : 'Diffusion ' + relDay(x.air_date).toLowerCase());
      if (x.runtime) bits.push(x.runtime + ' min');
      return `<li class="ep ${aired ? '' : 'future'} ${seen ? 'seen' : ''}">
        <div class="ep-main"><span class="ep-num">E${pad(e)}</span>
          <div style="min-width:0"><div class="ep-title">${esc(x.name || 'Épisode ' + e)}</div>${bits.length ? `<div class="ep-date">${esc(bits.join(' · '))}</div>` : ''}</div></div>
        <button class="tick ${seen ? 'on' : ''}" data-act="ep" data-id="${base.id}" data-s="${se.n}" data-e="${e}" ${aired ? '' : 'disabled'} aria-pressed="${seen}" aria-label="${code(se.n, e)} ${seen ? 'vu' : 'pas vu'}">${ICON.check}</button>
      </li>`;
    }).join('')}</ol>`;
  }
  return `<section class="season ${open ? 'open' : ''}">
    <div class="season-head">
      <button class="season-toggle" data-act="season" data-id="${base.id}" data-n="${se.n}" aria-expanded="${open}">
        <b>Saison ${se.n}</b><small>${seenCount}/${airedCount || se.c}</small>${ICON.chevron}
      </button>
      <button class="tick ${done ? 'on' : ''}" data-act="season-all" data-id="${base.id}" data-n="${se.n}" ${airedCount ? '' : 'disabled'} aria-label="${done ? 'Décocher' : 'Cocher'} toute la saison ${se.n}">${ICON.check}</button>
    </div>${eps}
  </section>`;
}

function viewMovie(id) {
  const m = state.movies[id];
  const r = useData(`/movie/${id}`);
  const d = r.data;
  if (!d && !m) return r.error ? `<button class="backbtn" data-act="back" aria-label="Retour">${ICON.back}</button><div style="padding-top:80px">${errorBlock(r.error)}</div>` : loadingView();
  const title = d?.title || m.title;
  const runtime = d?.runtime || m?.runtime;
  const release = d?.release_date || '';
  const meta = [
    (release || m?.year || '').slice(0, 4),
    runtime ? fmtDuration(runtime) : '',
    dayDiff(release) > 0 ? 'Sortie le ' + longDate(release) : '',
  ].filter(Boolean).map(esc).join(' · ');
  const inList = m?.status === 'watchlist', seen = m?.status === 'watched';
  const genres = d?.genres?.length ? `<div class="genres pad">${d.genres.map(g => `<span class="chip">${esc(g.name)}</span>`).join('')}</div>` : '';
  return `${hero(d?.backdrop_path || m?.backdrop, d?.poster_path || m?.poster, title, meta)}
    <div class="actions pad">
      <button class="btn grow ${inList ? 'primary' : ''}" data-act="m-list" data-id="${id}" aria-pressed="${inList}">${inList ? ICON.check : ICON.bookmark} ${inList ? 'Dans ma liste' : 'À voir'}</button>
      <button class="btn grow ${seen ? 'primary' : ''}" data-act="m-seen" data-id="${id}" aria-pressed="${seen}">${ICON.check} ${seen ? 'Vu' : 'J’ai vu'}</button>
    </div>
    ${seen && m.watchedAt ? `<div class="pad ep-date">Vu le ${new Date(m.watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>` : ''}
    ${genres}
    <div class="pad">${overviewBlock('mv' + id, d?.overview)}</div>`;
}

function viewProfile() {
  const shows = Object.values(state.shows);
  let eps = 0, tvMin = 0, month = 0;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  for (const sh of shows) {
    const ts = Object.values(sh.watched);
    eps += ts.length; tvMin += ts.length * sh.runtime;
    month += ts.filter(t => t >= monthStart.getTime()).length;
  }
  const seen = Object.values(state.movies).filter(m => m.status === 'watched');
  const mvMin = seen.reduce((a, m) => a + (m.runtime || 0), 0);
  const finished = shows.filter(s => bucket(s) === 'finished').length;

  const imp = ui.pendingImport;
  const importBlock = imp ? `<div class="panel" style="margin-top:10px">
      <b>Remplacer toutes tes données ?</b>
      <p>La sauvegarde contient ${plural(Object.keys(imp.shows).length, 'série', 'séries')} et ${plural(Object.keys(imp.movies).length, 'film', 'films')}. Tes données actuelles seront effacées.</p>
      <div class="row"><button class="btn primary" data-act="import-ok">Remplacer</button><button class="btn" data-act="import-cancel">Annuler</button></div>
    </div>` : '';
  const armed = ui.confirm === 'reset';

  return `<div class="pad">
    <header class="top"><h1>Profil</h1></header>
    <div class="stats">
      <div class="stat wide"><b>${fmtDuration(tvMin + mvMin)}</b><span>passés devant l’écran</span></div>
      <div class="stat"><b>${eps.toLocaleString('fr-FR')}</b><span>épisodes vus</span></div>
      <div class="stat"><b>${fmtDuration(tvMin)}</b><span>de séries</span></div>
      <div class="stat"><b>${shows.length}</b><span>séries suivies · ${finished} terminées</span></div>
      <div class="stat"><b>${month}</b><span>épisodes ce mois-ci</span></div>
      <div class="stat"><b>${seen.length}</b><span>films vus</span></div>
      <div class="stat"><b>${fmtDuration(mvMin)}</b><span>de films</span></div>
    </div>

    <h2>Sauvegarde</h2>
    <div class="panel">
      <p>Tes données restent sur ce téléphone. Exporte une sauvegarde de temps en temps pour ne rien perdre.</p>
      <div class="row">
        <button class="btn" data-act="export">Exporter</button>
        <label class="btn" for="importFile">Importer</label>
        <input id="importFile" type="file" accept="application/json,.json" hidden>
      </div>
    </div>
    ${importBlock}

    <h2>Clé TMDB</h2>
    <div class="panel">${tokenField()}</div>

    <h2>Données</h2>
    <div class="panel">
      <div class="row">
        <button class="btn" data-act="refresh">Actualiser les séries</button>
        <button class="btn danger ${armed ? 'armed' : ''}" data-act="reset">${armed ? 'Confirmer : tout effacer' : 'Tout effacer'}</button>
      </div>
    </div>

    <p class="fine">Données et images fournies par <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. Cette application utilise l’API TMDB sans être approuvée ni certifiée par TMDB.</p>
  </div>`;
}

/* ================= Routeur et rendu ================= */
const main = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const scrollMemo = {};
let navDepth = 0;

function route() {
  const [, name = 'series', id] = (location.hash || '#/series').split('/');
  return { name, id: id ? Number(id) : null };
}

function render() {
  const r = route();
  if (!state.token) {
    main.innerHTML = viewWelcome();
    tabbar.hidden = true;
    return;
  }
  tabbar.hidden = false;
  // Sur Découvrir, on ne remplace que les résultats pour garder le clavier ouvert.
  if (r.name === 'decouvrir' && document.getElementById('q')) {
    document.getElementById('results').innerHTML = resultsHTML();
    return;
  }
  const focusId = document.activeElement?.id;
  let html;
  switch (r.name) {
    case 'tv': html = viewTv(r.id); break;
    case 'movie': html = viewMovie(r.id); break;
    case 'films': html = viewFilms(); break;
    case 'decouvrir': html = viewDiscover(); break;
    case 'profil': html = viewProfile(); break;
    default: html = viewSeries();
  }
  main.innerHTML = html;
  if (focusId) document.getElementById(focusId)?.focus();
  const tab = ['tv'].includes(r.name) ? 'series' : r.name === 'movie' ? 'films' : r.name;
  for (const a of tabbar.querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === tab);
  fillTitles();
}

function rerender() {
  const y = scrollY;
  render();
  scrollTo(0, y);
}

let currentHash = location.hash;
addEventListener('hashchange', () => {
  scrollMemo[currentHash] = scrollY;
  currentHash = location.hash;
  navDepth++;
  ui.confirm = null;
  main.innerHTML = '';   // force un rendu complet (y compris Découvrir)
  render();
  const r = route();
  scrollTo(0, (r.name === 'tv' || r.name === 'movie') ? 0 : (scrollMemo[location.hash] || 0));
});

/* ================= Toast ================= */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, action) {
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  toastEl.hidden = false;
  if (action) toastEl.querySelector('button').onclick = () => { hideToast(); action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2600);
}
function hideToast() { toastEl.hidden = true; }

function armConfirm(key) {
  ui.confirm = key;
  setTimeout(() => { if (ui.confirm === key) { ui.confirm = null; rerender(); } }, 4000);
}

/* ================= Actions ================= */
function fail(err) { toast(err.message || 'Une erreur est survenue.'); }

const actions = {
  seg({ name, v }) { ui[name] = v; render(); scrollTo(0, 0); },

  back() {
    if (navDepth > 0) history.back();
    else location.hash = '#/series';
  },

  retry() { errors.clear(); main.innerHTML = ''; render(); },

  expand({ key }) { ui.expanded[key] = !ui.expanded[key]; rerender(); },

  next({ id }) {
    const sh = state.shows[id];
    const n = progress(sh).next;
    if (!n) return;
    setEp(sh, n.s, n.e, true); save(); rerender();
    toast(`${sh.name} · ${code(n.s, n.e)} vu`, {
      label: 'Annuler', run() { setEp(sh, n.s, n.e, false); save(); rerender(); },
    });
  },

  async track({ id }) {
    try {
      const sh = await trackShow(id);
      rerender();
      toast(`${sh.name} ajoutée à tes séries`);
    } catch (e) { fail(e); }
  },

  untrack({ id }) {
    if (ui.confirm !== 'untrack:' + id) { armConfirm('untrack:' + id); rerender(); return; }
    const name = state.shows[id]?.name;
    delete state.shows[id]; ui.confirm = null; save(); rerender();
    toast(`${name} retirée`);
  },

  archive({ id }) {
    const sh = state.shows[id];
    sh.archived = !sh.archived; save(); rerender();
    toast(sh.archived ? `${sh.name} abandonnée` : `${sh.name} reprise`);
  },

  season({ id, n }) {
    const set = ui.openSeasons[id];
    n = Number(n);
    set.has(n) ? set.delete(n) : set.add(n);
    rerender();
  },

  async ep({ id, s, e }) {
    s = Number(s); e = Number(e);
    let sh = state.shows[id];
    if (!sh) {
      try { sh = await trackShow(id); } catch (err) { return fail(err); }
    }
    const on = !sh.watched[epKey(s, e)];
    setEp(sh, s, e, on); save(); rerender();
    if (!on) return;
    // Propose de cocher les épisodes précédents non vus.
    const before = airedEpisodes(sh).filter(([a, b]) => (a < s || (a === s && b < e)) && !sh.watched[epKey(a, b)]);
    if (before.length) {
      toast(`${code(s, e)} vu`, {
        label: `Cocher aussi les ${before.length} précédents`,
        run() { for (const [a, b] of before) setEp(sh, a, b, true); save(); rerender(); },
      });
    }
  },

  async ['season-all']({ id, n }) {
    n = Number(n);
    let sh = state.shows[id];
    if (!sh) {
      try { sh = await trackShow(id); } catch (err) { return fail(err); }
    }
    const se = sh.seasons.find(x => x.n === n);
    const eps = [];
    for (let e = 1; e <= se.c; e++) if (isAired(sh, n, e)) eps.push(e);
    const allSeen = eps.every(e => sh.watched[epKey(n, e)]);
    for (const e of eps) setEp(sh, n, e, !allSeen);
    save(); rerender();
    toast(allSeen ? `Saison ${n} décochée` : `Saison ${n} marquée comme vue`);
  },

  async quickadd({ type, id }, el) {
    id = Number(id);
    if (isAdded(type, id)) { location.hash = `#/${type}/${id}`; return; }
    el.disabled = true;
    try {
      if (type === 'tv') {
        const sh = await trackShow(id);
        toast(`${sh.name} ajoutée à tes séries`);
      } else {
        const m = await addMovie(id, 'watchlist');
        toast(`${m.title} ajouté à ta liste`);
      }
    } catch (e) { fail(e); }
    rerender();
  },

  async ['m-list']({ id }) {
    const m = state.movies[id];
    if (m?.status === 'watchlist') { delete state.movies[id]; save(); rerender(); toast('Retiré de ta liste'); return; }
    try { await addMovie(id, 'watchlist'); rerender(); toast('Ajouté à ta liste « À voir »'); } catch (e) { fail(e); }
  },

  async ['m-seen']({ id }) {
    const m = state.movies[id];
    if (m?.status === 'watched') {
      const prev = { ...m };
      delete state.movies[id]; save(); rerender();
      toast('Film retiré des films vus', { label: 'Annuler', run() { state.movies[id] = prev; save(); rerender(); } });
      return;
    }
    try { await addMovie(id, 'watched'); rerender(); toast('Film marqué comme vu'); } catch (e) { fail(e); }
  },

  async ['save-token']() {
    const val = document.getElementById('tok').value.trim();
    if (!val) { ui.tokenMsg = 'Colle ta clé TMDB avant d’enregistrer.'; rerender(); return; }
    ui.tokenMsg = 'Vérification…'; rerender();
    try {
      await tmdbFetch('/configuration', {}, val);
      const first = !state.token;
      state.token = val; save();
      ui.tokenMsg = '✓ Clé valide et enregistrée.';
      errors.clear(); mem.clear();
      main.innerHTML = '';
      if (first) { ui.tokenMsg = ''; location.hash = '#/decouvrir'; }
      render();
    } catch (e) {
      ui.tokenMsg = e.message === 'Clé TMDB refusée. Vérifie-la dans Profil.' ? 'Cette clé est refusée par TMDB. Vérifie que tu as copié la clé en entier.' : e.message;
      rerender();
    }
  },

  async export() {
    const { token, ...data } = state;
    const json = JSON.stringify({ ...data, exportedAt: new Date().toISOString() });
    const name = `sequence-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Sauvegarde Séquence' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  ['import-ok']() {
    state = { ...blankState(), ...ui.pendingImport, token: state.token, v: 1 };
    delete state.exportedAt;
    ui.pendingImport = null; save(); rerender();
    toast('Sauvegarde importée');
  },
  ['import-cancel']() { ui.pendingImport = null; rerender(); },

  async refresh() {
    toast('Actualisation…');
    await refreshShows(true);
    toast('Séries à jour');
  },

  reset() {
    if (ui.confirm !== 'reset') { armConfirm('reset'); rerender(); return; }
    state = { ...blankState(), token: state.token };
    ui.confirm = null; save(); rerender();
    toast('Toutes les données ont été effacées');
  },
};

async function addMovie(id, status) {
  const d = await api(`/movie/${id}`);
  const prev = state.movies[id];
  state.movies[id] = {
    id: d.id, title: d.title, poster: d.poster_path || null, backdrop: d.backdrop_path || null,
    year: (d.release_date || '').slice(0, 4), runtime: d.runtime || 0,
    status, addedAt: prev?.addedAt || Date.now(),
    watchedAt: status === 'watched' ? Date.now() : null,
  };
  save();
  return state.movies[id];
}

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { ev.preventDefault(); fn({ ...el.dataset }, el); }
});

let searchTimer;
document.addEventListener('input', ev => {
  if (ev.target.id !== 'q') return;
  ui.query = ev.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 350);
});
document.addEventListener('keydown', ev => {
  if (ev.target.id === 'q' && ev.key === 'Enter') { ev.target.blur(); clearTimeout(searchTimer); render(); }
  if (ev.target.id === 'tok' && ev.key === 'Enter') actions['save-token']();
});

document.addEventListener('change', async ev => {
  if (ev.target.id !== 'importFile') return;
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data?.v !== 1 || typeof data.shows !== 'object' || typeof data.movies !== 'object') throw new Error();
    ui.pendingImport = data;
  } catch (e) { toast('Ce fichier n’est pas une sauvegarde Séquence.'); }
  ev.target.value = '';
  rerender();
});

// Actualise les séries quand on revient sur l'appli.
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshShows(); });

/* ================= Démarrage ================= */
render();
refreshShows();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
