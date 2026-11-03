'use strict';

/* ================= Constantes ================= */
const IMG = 'https://image.tmdb.org/t/p/';
const SEASON_TTL = 6 * 3600e3;

// Logo : deux boutons « lecture » décalés (on regarde à deux), même dessin que les icônes de l'appli.
const LOGO = `<svg class="logo" viewBox="0 0 512 512" aria-hidden="true">
  <defs><linearGradient id="lg-bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="512"><stop offset="0" stop-color="#1B1F2A"/><stop offset="1" stop-color="#0D0F14"/></linearGradient>
  <linearGradient id="lg-or" gradientUnits="userSpaceOnUse" x1="200" y1="180" x2="380" y2="380"><stop offset="0" stop-color="#FFC768"/><stop offset="1" stop-color="#FF9A2A"/></linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="url(#lg-bg)"/>
  <path d="M146 140 L290 222 L146 304 Z" fill="#EEF0F4" stroke="#EEF0F4" stroke-width="40" stroke-linejoin="round"/>
  <path d="M222 208 L366 290 L222 372 Z" fill="url(#lg-bg)" stroke="url(#lg-bg)" stroke-width="84" stroke-linejoin="round"/>
  <path d="M222 208 L366 290 L222 372 Z" fill="url(#lg-or)" stroke="url(#lg-or)" stroke-width="40" stroke-linejoin="round"/>
</svg>`;
const WORDMARK = 'what<span class="two">2</span>watch';

const ICON = {
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" pathLength="1"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  chevron: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bookmark: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z"/></svg>',
  pen: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  send: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7z"/></svg>',
  filter: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.5"/><circle cx="10" cy="17" r="2.5"/></svg>',
  gear: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
};

/* ================= Réseau ================= */
class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(method, url, body) {
  let r;
  try {
    r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new ApiError('Pas de connexion au serveur.', 0); }
  let data = null;
  try { data = await r.json(); } catch (e) { /* réponse vide */ }
  if (r.status === 401 && me && !/^\/api\/(login|register|me\/password)/.test(url)) sessionExpired();
  if (!r.ok) throw new ApiError(data?.error || `Erreur ${r.status}`, r.status);
  return data;
}
const get = url => request('GET', url);
const post = (url, body = {}) => request('POST', url, body);
const tmdbUrl = (p, params) => '/api/tmdb' + p + (params ? '?' + new URLSearchParams(params) : '');

/* Cache des lectures : affiche tout de suite ce qu'on a, recharge en arrière-plan si c'est vieux. */
const mem = new Map();     // url -> { t, data, p }
const errors = new Map();  // url -> message

function load(url, ttl = 10 * 60e3) {
  const hit = mem.get(url);
  if (hit?.p) return hit.p;
  if (hit?.data !== undefined && Date.now() - hit.t < ttl) return Promise.resolve(hit.data);
  const p = get(url).then(
    data => { mem.set(url, { t: Date.now(), data }); errors.delete(url); return data; },
    err => {
      if (hit?.data !== undefined) mem.set(url, { t: hit.t, data: hit.data }); else mem.delete(url);
      errors.set(url, err.message);
      throw err;
    });
  mem.set(url, { ...hit, p });
  return p;
}

function useData(url, ttl = 10 * 60e3) {
  const hit = mem.get(url);
  const fetchNow = hadData => {
    const route = location.hash;
    load(url, ttl).then(
      () => { if (location.hash === route) rerender(); },
      () => { if (location.hash === route && !hadData) rerender(); });
  };
  if (hit?.data !== undefined) {
    if (!hit.p && Date.now() - hit.t >= ttl) fetchNow(true);
    return { data: hit.data };
  }
  if (errors.has(url)) return { error: errors.get(url) };
  if (!hit?.p) fetchNow(false);
  return { loading: true };
}

function invalidate(...prefixes) {
  for (const map of [mem, errors]) {
    for (const k of [...map.keys()]) if (prefixes.some(p => k.startsWith(p))) map.delete(k);
  }
}

/* ================= Session et données ================= */
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou bloqué */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
};

let me = LS.get('sequence.me');
let badges = { recos: 0 };
let state = { shows: {}, movies: {} };
let queue = [];   // modifications pas encore envoyées au serveur

function loadLocal() {
  state = LS.get('sequence.state.' + me.id) || { shows: {}, movies: {} };
  queue = LS.get('sequence.queue.' + me.id) || [];
}
function saveLocal() {
  if (!me) return;
  LS.set('sequence.state.' + me.id, state);
  LS.set('sequence.queue.' + me.id, queue);
}

function sessionExpired() {
  me = null;
  LS.del('sequence.me');
  ui.authMsg = 'Ta session a expiré. Reconnecte-toi.';
  main.innerHTML = '';
  render();
}

async function refreshMe() {
  try {
    const r = await get('/api/me');
    me = r.user; badges = r.badges;
    LS.set('sequence.me', me);
    updateBadge();
    showAnnouncement(r.announcement).then(() => showDuels(r.duels)).then(askEmail);
  } catch (e) { return; }
  pull();
}

// Membre sans adresse mail : on la lui demande une fois (puis pas avant une semaine s'il répond « Plus tard »).
const MAIL_LATER = 'w2w.mailLater';
let mailAsked = false;
async function askEmail() {
  if (!me || me.email || mailAsked || askEl.open || (LS.get(MAIL_LATER) || 0) > Date.now() || location.hash.startsWith('#/collection') && mailInviteHTML()) return;
  mailAsked = true;
  const yes = await ask({ title: '📧 Ajoute ton adresse mail', text: EMAIL_WHY, yes: 'Ajouter mon adresse', no: 'Plus tard' });
  if (!yes) return LS.set(MAIL_LATER, Date.now() + 7 * DAY_MS);
  ui.profTab = 'settings';
  if (location.hash !== '#/profil') location.hash = '#/profil'; else render();
  setTimeout(() => { const i = document.getElementById('acc-mail'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); } }, 350);
}

// Message de l'administrateur : affiché une fois, puis marqué comme vu sur le compte.
let annShown = 0;
async function showAnnouncement(a) {
  if (!a || annShown === a.id) return;
  annShown = a.id;
  if (askEl.open) await new Promise(done => askEl.addEventListener('close', done, { once: true }));
  await ask({ title: a.title, text: a.text, yes: 'OK' });
  post(`/api/announcement/${a.id}/seen`, {}).catch(() => {});
}

// Applique une modification tout de suite sur le téléphone, puis l'envoie au serveur.
function commit(op, localMeta) {
  op.at = op.at || Date.now();
  applyLocal(op, localMeta);
  queue.push(op);
  saveLocal();
  flushSoon();
}

function applyLocal(op, local) {
  const id = op.id;
  switch (op.op) {
    case 'show.track':
      if (!state.shows[id]) state.shows[id] = { ...local, addedAt: op.at, archived: false, watched: {}, updatedAt: Date.now() };
      break;
    case 'show.untrack': delete state.shows[id]; break;
    case 'show.archive': if (state.shows[id]) state.shows[id].archived = op.on; break;
    case 'eps': {
      const sh = state.shows[id];
      if (!sh) break;
      for (const [s, e] of op.list) {
        const k = epKey(s, e);
        if (op.on) sh.watched[k] = sh.watched[k] || op.at; else delete sh.watched[k];
      }
      break;
    }
    case 'movie.set': {
      if (op.status === null) { delete state.movies[id]; break; }
      const prev = state.movies[id];
      state.movies[id] = {
        ...(prev || local), status: op.status, addedAt: prev?.addedAt || op.at,
        watchedAt: op.status === 'watched' ? (prev?.watchedAt || op.at) : null,
      };
      break;
    }
  }
}

let flushing = false, flushTimer;
function flushSoon(ms = 300) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }

async function flush() {
  if (flushing || !me || !queue.length) return;
  flushing = true;
  const batch = queue.slice(0, 200);
  let sent = false;
  try {
    const res = await post('/api/sync', { ops: batch.map(({ op, id, on, list, status, at }) => ({ op, id, on, list, status, at })) });
    queue.splice(0, batch.length);
    sent = true;
    if (!queue.length) { state = { shows: res.shows, movies: res.movies }; rerender(); }
    saveLocal();
  } catch (e) {
    if (e.status === 0 || e.status >= 500) flushSoon(20e3);   // hors connexion : on réessaie plus tard
    else if (e.status !== 401) { queue.splice(0, batch.length); saveLocal(); toast(e.message); }
  } finally { flushing = false; }
  if (sent && queue.length) flushSoon(50);
}

async function pull() {
  if (queue.length) { await flush(); return; }
  try {
    const res = await get('/api/state');
    if (!queue.length) { state = res; saveLocal(); rerender(); }
  } catch (e) { /* hors connexion : on garde la copie locale */ }
}

/* ================= Séries : logique ================= */
const epKey = (s, e) => s + 'x' + e;

function slimShow(d) {
  const ep = x => x ? { s: x.season_number, e: x.episode_number, d: x.air_date || '', name: x.name || '' } : null;
  return {
    id: d.id, name: d.name,
    poster: d.poster_path || null, backdrop: d.backdrop_path || null,
    status: d.status || '', year: (d.first_air_date || '').slice(0, 4),
    runtime: (d.episode_run_time && d.episode_run_time[0]) || d.last_episode_to_air?.runtime || 40,
    seasons: (d.seasons || []).filter(s => s.season_number > 0 && s.episode_count > 0)
      .map(s => ({ n: s.season_number, c: s.episode_count })).sort((a, b) => a.n - b.n),
    last: ep(d.last_episode_to_air), next: ep(d.next_episode_to_air),
  };
}
function slimMovie(d) {
  return {
    id: d.id, title: d.title, poster: d.poster_path || null, backdrop: d.backdrop_path || null,
    year: (d.release_date || '').slice(0, 4), runtime: d.runtime || 0,
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

async function trackShow(id) {
  if (state.shows[id]) return state.shows[id];
  const d = await load(tmdbUrl(`/tv/${id}`));
  commit({ op: 'show.track', id: Number(id) }, slimShow(d));
  return state.shows[id];
}
async function addMovie(id, status) {
  const d = await load(tmdbUrl(`/movie/${id}`));
  commit({ op: 'movie.set', id: Number(id), status }, slimMovie(d));
  return state.movies[id];
}
function setEps(id, list, on) { commit({ op: 'eps', id: Number(id), list, on }); }
// Envoie tout de suite les changements en attente (le serveur doit les connaître avant la suite).
async function syncNow() {
  clearTimeout(flushTimer);
  for (let k = 0; k < 20 && queue.length; k++) {
    await flush();
    if (queue.length) await new Promise(r => setTimeout(r, 300));
  }
  if (queue.length) throw new Error('Connexion impossible pour l’instant, réessaie dans un moment.');
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

function timeAgo(ts) {
  const min = (Date.now() - ts) / 60e3;
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${Math.floor(min)} min`;
  if (min < 1440) return `il y a ${Math.floor(min / 60)} h`;
  const days = Math.floor(min / 1440);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtDuration(min) {
  min = Math.round(min);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d} j ${h} h`;
  if (h) return m ? `${h} h ${pad(m)}` : `${h} h`;
  return `${m} min`;
}
const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

const STATUS_FR = {
  'Returning Series': 'En cours de diffusion', 'Ended': 'Terminée', 'Canceled': 'Annulée',
  'In Production': 'En production', 'Planned': 'Prévue', 'Pilot': 'Pilote',
};

function poster(path, alt, size = 'w342') {
  const img = path ? `<img src="${IMG}${size}${esc(path)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '';
  return `<div class="poster">${img}<div class="ph">${esc(alt)}</div></div>`;
}
// Avatars prédéfinis (même nombre que AVATAR_PRESETS côté serveur) : un emoji sur un fond coloré.
const AVATARS = [
  ['🍿', 10], ['🎬', 220], ['📺', 260], ['🎮', 290], ['🦊', 25], ['🐼', 160], ['🐸', 120], ['🦁', 40],
  ['🐙', 330], ['👾', 275], ['🤖', 200], ['🦄', 310], ['🐱', 50], ['🌵', 140], ['🍕', 0], ['🚀', 230],
];
function avatar(u, size = '') {
  const a = u.avatar || '';
  if (a.startsWith('p')) return `<span class="av ${size} photo" aria-hidden="true"><img src="/api/avatar/${u.id}?v=${esc(a.slice(1))}" alt="" loading="lazy" decoding="async"></span>`;
  const preset = a.startsWith('e') ? AVATARS[Number(a.slice(1))] : null;
  if (preset) return `<span class="av ${size} emoji" style="--h:${preset[1]}" aria-hidden="true">${preset[0]}</span>`;
  const hue = (u.id * 67) % 360;
  return `<span class="av ${size}" style="--h:${hue}" aria-hidden="true">${esc((u.name || u.username || '?').trim().charAt(0).toUpperCase())}</span>`;
}
function stars(n) {
  if (!n) return '';
  return `<span class="stars" role="img" aria-label="${n} sur 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
}

/* ================= État d'interface ================= */
// Filtres de la recherche avancée (Découvrir). Années en texte ('' = pas de limite), note sur 10 (0 = toutes).
const ADV_DEFAULT = { kind: 'movie', genres: [], from: '', to: '', dur: '', person: null, rating: 0, lang: '', providers: [], sort: 'popularity.desc' };
const ui = {
  authMode: LS.get('w2w.invite') ? 'register' : 'login', authMsg: '',   // invité par un lien : on propose de créer un compte
  profTab: 'settings',   // Profil : 'settings' (Réglages) ou 'stats' (Statistiques)
  collTab: 'tv', seriesTab: 'watch', filmsTab: 'watchlist', sugTab: 'tv', amisTab: 'feed',
  query: '',
  openSeasons: {}, expanded: {},
  drafts: {},          // avis en cours d'écriture
  confirm: null,
  accountMsg: '',
  goReview: null,
  openReplies: new Set(), replyDrafts: {},   // réponses dépliées et brouillons de réponse, par avis      // id du champ d'avis à ouvrir après navigation
  theme: LS.get('w2w.theme.ui') || 'auto',
  adv: { ...structuredClone(ADV_DEFAULT), ...(LS.get('w2w.adv') || {}) },   // filtres appliqués
  advOn: !!LS.get('w2w.advOn'),   // résultats filtrés affichés dans Découvrir
  advDraft: null,                 // filtres en cours de réglage dans le panneau
  advPages: 1,
  group: LS.get('w2w.group') || 'all',   // groupe affiché dans l'onglet Amis ('all' = tous mes groupes)
  grpEmoji: null,                        // emoji choisi dans le panneau de création / réglages d'un groupe
};

/* ================= Vues : connexion ================= */
const EMAIL_WHY = 'Seulement pour retrouver ton pseudo ou ton mot de passe si tu les perds. Personne d’autre ne la voit.';
function viewAuth() {
  const reg = ui.authMode === 'register';
  if (ui.authMode === 'forgot') return viewForgot();
  return `<div class="pad welcome">
    <div class="brand">${LOGO}<h1 class="wordmark">${WORDMARK}</h1></div>
    ${inviteCard() || installBlock()}
    <p class="lede">Coche tes épisodes, garde ta liste de films et partage tes avis avec tes potes.</p>
    <div class="panel">
      ${seg('authMode', ui.authMode, [['login', 'Connexion'], ['register', 'Créer un compte']])}
      <form id="authForm" class="form" novalidate>
        <div class="field"><label for="au-user">Pseudo</label>
          <input class="input" id="au-user" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>
        ${reg ? `<div class="field"><label for="au-name">Nom affiché <span class="opt">(ce que tes amis verront)</span></label>
          <input class="input" id="au-name" name="name" autocomplete="nickname" maxlength="40"></div>
        <div class="field"><label for="au-mail">Adresse mail</label>
          <input class="input" id="au-mail" name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" required>
          <p class="muted small field-help">🔒 ${EMAIL_WHY}</p></div>` : ''}
        <div class="field"><label for="au-pass">Mot de passe${reg ? ' <span class="opt">(8 caractères minimum)</span>' : ''}</label>
          <input class="input" id="au-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></div>
        ${ui.authMsg ? `<div class="err">${esc(ui.authMsg)}</div>` : ''}
        <button class="btn primary" type="submit">${reg ? 'Créer mon compte' : 'Me connecter'}</button>
        ${reg ? '' : `<button type="button" class="linkbtn forgot-link" data-act="forgot">Pseudo ou mot de passe oublié ?</button>`}
      </form>
    </div>
  </div>`;
}

// Identifiants oubliés : la demande part chez l'administrateur, qui recontacte la personne.
function viewForgot() {
  return `<div class="pad welcome">
    <div class="brand">${LOGO}<h1 class="wordmark">${WORDMARK}</h1></div>
    <div class="panel">
      <h2 class="forgot-title">Pseudo ou mot de passe oublié</h2>
      ${ui.forgotSent ? `<p>✅ Demande envoyée. L’administrateur de l’appli va te recontacter avec ton pseudo et un mot de passe provisoire, que tu pourras changer ensuite dans Profil.</p>
        <p class="muted small">Si tu n’avais pas enregistré d’adresse mail, contacte-le directement.</p>`
      : `<p class="muted">Entre l’adresse mail de ton compte. L’administrateur de l’appli recevra ta demande et te recontactera.</p>
      <form id="forgotForm" class="form" novalidate>
        <div class="field"><label for="fg-mail">Adresse mail</label>
          <input class="input" id="fg-mail" name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" required></div>
        ${ui.authMsg ? `<div class="err">${esc(ui.authMsg)}</div>` : ''}
        <button class="btn primary" type="submit">Envoyer la demande</button>
      </form>`}
      <button type="button" class="linkbtn forgot-link" data-act="forgot-back">← Retour à la connexion</button>
    </div>
  </div>`;
}

// Arrivée par un lien d'invitation, pas encore connecté : on montre le groupe qui attend.
function inviteCard() {
  const code = LS.get('w2w.invite');
  if (!code) return '';
  const g = useData(`/api/invite/${code}`, 3600e3).data?.group;
  if (!g) return '';
  return `<div class="invite-card"><span class="gemoji">${esc(g.emoji)}</span>
    <div class="min0"><b>Tu es invité dans « ${esc(g.name)} »</b><div class="muted small">Crée ton compte ou connecte-toi pour rejoindre le groupe (${plural(g.count, 'membre', 'membres')}).</div></div></div>`;
}

async function submitAuth(form) {
  const reg = ui.authMode === 'register';
  const body = Object.fromEntries(new FormData(form));
  const invite = LS.get('w2w.invite');
  if (reg && invite) body.invite = invite;   // le serveur l'ajoute directement au groupe
  ui.authMsg = '';
  try {
    const r = await post(reg ? '/api/register' : '/api/login', body);
    me = r.user;
    LS.set('sequence.me', me);
    loadLocal();
    main.innerHTML = '';
    let target = reg ? '#/decouvrir' : '#/collection';
    if (invite) {
      if (reg) {
        LS.del('w2w.invite');
        const g = mem.get(`/api/invite/${invite}`)?.data?.group;
        if (g) { setGroup(g.id); target = '#/amis'; toast(`Bienvenue dans ${g.emoji} ${g.name}`); }
      } else setTimeout(handleInvite, 300);
    }
    if (location.hash !== target) location.hash = target; else render();
    refreshMe();
  } catch (e) {
    ui.authMsg = e.message;
    const keep = { u: form.elements.username.value, n: form.elements.name?.value, m: form.elements.email?.value };
    render();
    document.getElementById('au-user').value = keep.u;
    if (keep.n != null && document.getElementById('au-name')) document.getElementById('au-name').value = keep.n;
    if (keep.m != null && document.getElementById('au-mail')) document.getElementById('au-mail').value = keep.m;
  }
}

/* ================= Vues : séries ================= */
// Onglets de section (Collection, Suggestions, Amis, Profil) : soulignés, sur toute la largeur.
function tabs(name, current, options) {
  const i = Math.max(0, options.findIndex(([v]) => v === current));
  return `<div class="tabs" role="tablist" data-tabs="${name}" style="--i:${i};--n:${options.length}">${options.map(([v, label]) =>
    `<button type="button" role="tab" data-act="seg" data-name="${name}" data-v="${v}" aria-selected="${v === current}">${label}</button>`).join('')}</div>`;
}
// Choix entre quelques options (thème, connexion…) : boutons groupés.
function seg(name, current, options) {
  return `<div class="seg" role="group">${options.map(([v, label]) =>
    `<button type="button" data-act="seg" data-name="${name}" data-v="${v}" aria-pressed="${v === current}">${label}</button>`).join('')}</div>`;
}

/* ================= Collection : séries + films ================= */
function viewCollection() {
  const nTv = Object.keys(state.shows).length, nMv = Object.keys(state.movies).length;
  return `<div class="pad">
    <header class="top"><h1>Collection</h1></header>
    ${mailInviteHTML() || pushInviteHTML()}
    ${tabs('collTab', ui.collTab, [['tv', `Séries · ${nTv}`], ['movie', `Films · ${nMv}`]])}
    <div class="subseg">${ui.collTab === 'movie' ? filmsBody() : seriesBody()}</div>
  </div>`;
}

function seriesBody() {
  const shows = Object.values(state.shows);
  let body;
  if (!shows.length) {
    body = `<div class="empty"><b>Aucune série suivie</b><p>Cherche une série et appuie sur + pour la suivre épisode par épisode.</p><a class="btn primary" href="#/decouvrir">Trouver une série</a></div>`;
  } else if (ui.seriesTab !== 'all') {
    body = timelineHTML(shows);
  } else {
    const groups = [['watching', 'En cours'], ['notstarted', 'Pas commencées'], ['uptodate', 'À jour'], ['finished', 'Terminées'], ['archived', 'Abandonnées']];
    body = groups.map(([b, label]) => {
      const list = shows.filter(s => bucket(s) === b).sort((x, y) => x.name.localeCompare(y.name, 'fr'));
      if (!list.length) return '';
      return `<h2>${label} <small>${list.length}</small></h2><div class="grid">${list.map(sh => {
        const p = progress(sh);
        return showTile(sh, p.watched, p.aired);
      }).join('')}</div>`;
    }).join('');
  }
  const jump = ui.seriesTab !== 'all' && body.includes('class="wlist"')
    ? `<button type="button" class="btn small cal-jump" data-act="cal-jump">📅 Prochaines sorties</button>` : '';
  return `${shows.length ? `<div class="seg-row">${seg('seriesTab', ui.seriesTab === 'all' ? 'all' : 'watch', [['watch', 'À regarder'], ['all', 'Toutes']])}${jump}</div>` : ''}
    ${body}`;
}

// Fil chronologique : ce qui reste à regarder en haut, puis aujourd'hui, puis les épisodes à venir jour par jour.
function timelineHTML(shows) {
  const watching = shows.filter(s => bucket(s) === 'watching').sort((a, b) => lastWatchedAt(b) - lastWatchedAt(a));
  const fresh = shows.filter(s => bucket(s) === 'notstarted').sort((a, b) => b.addedAt - a.addedAt);
  let html = '';
  if (watching.length) html += `<h2>À regarder <small>${watching.length}</small></h2><div class="wlist">${watching.map(watchCard).join('')}</div>`;
  if (fresh.length) html += `<h2>Pas encore commencées <small>${fresh.length}</small></h2><div class="wlist">${fresh.map(watchCard).join('')}</div>`;
  if (!html) html = `<p class="muted uptodate">${ICON.check} Tu es à jour : plus aucun épisode en retard.</p>`;

  const today = new Date();
  html += `<div class="nowline"><span>Aujourd’hui · ${esc(fmtLong.format(today))}</span></div>`;

  const ups = [...upcomingEpisodes(shows), ...upcomingMovies()].sort((a, b) => a.d.localeCompare(b.d));
  if (!ups.length) return html + `<p class="muted gap-top">Aucune date de sortie annoncée pour tes séries et tes films à voir.</p>`;
  let lastDay = null;
  for (const u of ups) {
    if (u.d !== lastDay) {
      lastDay = u.d;
      // Le jour même est déjà annoncé par la ligne « Aujourd'hui ».
      const n = dayDiff(u.d), d = parseDay(u.d);
      if (n > 0) html += `<div class="daylabel">${n === 1 ? 'Demain' : esc(fmtWeekday.format(d))}<small>${esc(fmtLong.format(d))}</small></div>`;
    }
    if (u.mv) {
      html += `<a class="uprow" href="#/movie/${u.mv.id}">${poster(u.mv.poster, u.mv.title, 'w154')}
        <div class="min0"><div class="uprow-name">${esc(u.mv.title)}</div>
        <div class="uprow-ep"><span class="code">Film</span>Sortie en France</div></div>
        ${daysLeft(dayDiff(u.d))}</a>`;
      continue;
    }
    html += `<a class="uprow" href="#/ep/${u.sh.id}/${u.s}/${u.e}">${poster(u.sh.poster, u.sh.name, 'w154')}
      <div class="min0"><div class="uprow-name">${esc(u.sh.name)}</div>
      <div class="uprow-ep"><span class="code">${code(u.s, u.e)}</span>${esc(u.name || '')}</div></div>
      ${daysLeft(dayDiff(u.d))}</a>`;
  }
  return html;
}

// Épisodes à venir de toutes les séries suivies (saison en cours complète quand elle est connue), triés par date.
function upcomingEpisodes(shows) {
  const out = [];
  for (const sh of shows) {
    if (sh.archived || !sh.next) continue;
    const season = useData(tmdbUrl(`/tv/${sh.id}/season/${sh.next.s}`), SEASON_TTL).data;
    const eps = (season?.episodes || [])
      .filter(ep => ep.air_date && dayDiff(ep.air_date) >= 0 && ep.episode_number >= sh.next.e)
      .map(ep => ({ sh, s: sh.next.s, e: ep.episode_number, d: ep.air_date, name: ep.name }));
    if (eps.length) out.push(...eps);
    else if (sh.next.d && dayDiff(sh.next.d) >= 0) out.push({ sh, s: sh.next.s, e: sh.next.e, d: sh.next.d, name: sh.next.name });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d) || a.sh.name.localeCompare(b.sh.name, 'fr') || a.e - b.e);
}

// Films « à voir » dont la sortie est annoncée (aujourd'hui ou plus tard).
function upcomingMovies() {
  return Object.values(state.movies)
    .filter(m => m.status === 'watchlist' && m.release && dayDiff(m.release) >= 0)
    .map(m => ({ mv: m, d: m.release }));
}

function daysLeft(n) {
  if (n === 0) return `<div class="left today"><b>Auj.</b></div>`;
  return `<div class="left"><b>${n}</b><span>${n === 1 ? 'jour' : 'jours'}</span></div>`;
}

// Petit bouton crayon posé sur l'affiche d'un titre vu mais pas encore commenté.
function reviewPin(kind, id) {
  const r = useData('/api/reviews/mine', 60e3);
  if (!r.data || r.data.items.includes(kind + ':' + id)) return '';
  return `<span class="tile-review" role="button" tabindex="0" data-act="review-open" data-kind="${kind}" data-id="${id}" aria-label="Écrire un avis">${ICON.pen}</span>`;
}

function showTile(sh, watched, aired) {
  const pct = aired ? Math.round(watched / aired * 100) : 0;
  return `<a class="tile" href="#/tv/${sh.id}"><div class="rel">${poster(sh.poster, sh.name)}${watched ? reviewPin('tv', sh.id) : ''}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="tile-name">${esc(sh.name)}</div>
    <div class="tile-sub">${watched}/${aired} ép.</div></a>`;
}

function watchCard(sh) {
  const p = progress(sh);
  const pct = p.aired ? Math.round(p.watched / p.aired * 100) : 0;
  const n = p.next;
  return `<article class="wcard">
    <a href="#/tv/${sh.id}" tabindex="-1">${poster(sh.poster, sh.name, 'w154')}</a>
    <div class="wcard-body">
      <a href="#/tv/${sh.id}" class="wcard-title">${esc(sh.name)}</a>
      <a href="#/ep/${sh.id}/${n.s}/${n.e}" class="wcard-ep"><span class="code">${code(n.s, n.e)}</span><span data-title="${sh.id}:${n.s}:${n.e}"></span></a>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="wcard-meta">${p.left > 1 ? plural(p.left, 'épisode restant', 'épisodes restants') : 'Dernier épisode disponible'}</div>
    </div>
    <button class="checkbtn" data-act="next" data-id="${sh.id}" aria-label="Marquer ${code(n.s, n.e)} comme vu">${ICON.check}</button>
  </article>`;
}

// Complète les titres d'épisodes après le rendu.
function fillTitles() {
  for (const el of document.querySelectorAll('[data-title]')) {
    const [id, s, e] = el.dataset.title.split(':').map(Number);
    load(tmdbUrl(`/tv/${id}/season/${s}`), SEASON_TTL).then(season => {
      const ep = season.episodes?.find(x => x.episode_number === e);
      if (ep?.name && el.isConnected) el.textContent = ep.name;
    }, () => {});
  }
}

function filmsBody() {
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
    body = `<div class="grid gap-top">${list.map(movieTile).join('')}</div>`;
  }
  return `${seg('filmsTab', ui.filmsTab, [['watchlist', `À voir · ${counts.watchlist}`], ['watched', `Vus · ${counts.watched}`]])}
    ${body}`;
}
function movieTile(m) {
  return `<a class="tile" href="#/movie/${m.id}"><div class="rel">${poster(m.poster, m.title)}${m.status === 'watched' ? reviewPin('movie', m.id) : ''}</div>
    <div class="tile-name">${esc(m.title)}</div>
    <div class="tile-sub">${esc(m.year || '')}${m.status === 'watched' && m.watchedAt ? ' · vu le ' + new Date(m.watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''}</div></a>`;
}

/* ================= Vues : découvrir ================= */
function viewDiscover() {
  return `<div class="pad">
    <header class="top"><h1>Découvrir</h1></header>
    <div class="searchrow">
      <label class="searchbox">${ICON.search}
        <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Une série, un film…" value="${esc(ui.query)}" aria-label="Rechercher une série ou un film">
      </label>
      ${advBtnHTML()}
    </div>
    <div id="results">${resultsHTML()}</div>
  </div>`;
}

const isAdded = (type, id) => type === 'tv' ? !!state.shows[id] : !!state.movies[id];

function resultsHTML() {
  const q = ui.query.trim();
  if (q.length >= 2) {
    const r = useData(tmdbUrl('/search/multi', { query: q, include_adult: 'false' }));
    if (r.loading) return spinner('Recherche…');
    if (r.error) return errorBlock(r.error);
    const items = (r.data.results || []).filter(x => x.media_type === 'tv' || x.media_type === 'movie');
    if (!items.length) return `<div class="empty"><b>Aucun résultat</b><p>Essaie avec le titre original ou moins de mots.</p></div>`;
    return `<div class="rlist gap-top">${items.map(x => {
      const type = x.media_type, title = x.name || x.title;
      const year = (x.first_air_date || x.release_date || '').slice(0, 4);
      const on = isAdded(type, x.id), open = !on && ui.addOpen === `${type}:${x.id}`;
      return `<div class="rrow ${open ? 'adding' : ''}">
        <a class="rrow-link" href="#/${type}/${x.id}">${poster(x.poster_path, title, 'w154')}
          <div class="min0"><div class="rrow-title">${esc(title)}</div>
          <div class="rrow-meta"><span class="chip">${type === 'tv' ? 'Série' : 'Film'}</span>${esc(year)}${scoreBadge(x, 'inline')}</div>
          ${x.overview ? `<div class="rrow-over">${esc(x.overview)}</div>` : ''}</div></a>
        <button class="addbtn ${on ? 'on' : ''} ${open ? 'open' : ''}" data-act="quickadd" data-type="${type}" data-id="${x.id}" aria-expanded="${open}" aria-label="${on ? 'Déjà ajouté' : open ? 'Fermer' : 'Ajouter'}">${on ? ICON.check : ICON.plus}</button>
        ${open ? `<div class="addchoice">
          <button class="btn small" data-act="quickadd-as" data-type="${type}" data-id="${x.id}" data-st="watchlist">${ICON.bookmark} À voir</button>
          <button class="btn small primary" data-act="quickadd-as" data-type="${type}" data-id="${x.id}" data-st="watched">${ICON.check} J’ai vu</button>
        </div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }
  if (ui.advOn) return advResultsHTML();
  return `<h2>Séries populaires cette semaine</h2>${rail(useData(tmdbUrl('/trending/tv/week')), 'tv')}
    <h2>Films populaires cette semaine</h2>${rail(useData(tmdbUrl('/trending/movie/week')), 'movie')}`;
}

function rail(r, type) {
  if (r.loading) return skelRail();
  if (r.error) return errorBlock(r.error);
  const items = (r.data.results || []).slice(0, 20);
  if (!items.length) return `<p class="muted">Rien à proposer pour l’instant.</p>`;
  return `<div class="rail">${items.map(x => tmdbTile(x, type)).join('')}</div>`;
}

// Affiche d'un résultat TMDB, avec la note du public et une coche si on l'a déjà.
// Petit + sur l'affiche d'un titre pas encore ajouté : il s'ouvre sur « À voir » / « J'ai vu ».
function tileAdd(type, id) {
  if (isAdded(type, id)) return '';
  const open = ui.addOpen === `${type}:${id}`;
  return `<button class="tileplus ${open ? 'open' : ''}" data-act="quickadd" data-type="${type}" data-id="${id}" aria-expanded="${open}" aria-label="${open ? 'Fermer' : 'Ajouter'}">${ICON.plus}</button>
    ${open ? `<span class="tilechoice addchoice" data-act="noop">
      <button class="btn small" data-act="quickadd-as" data-type="${type}" data-id="${id}" data-st="watchlist">${ICON.bookmark} À voir</button>
      <button class="btn small primary" data-act="quickadd-as" data-type="${type}" data-id="${id}" data-st="watched">${ICON.check} J’ai vu</button>
    </span>` : ''}`;
}

function tmdbTile(x, type, withYear) {
  const title = x.name || x.title, year = (x.first_air_date || x.release_date || '').slice(0, 4);
  return `<a class="tile" href="#/${type}/${x.id}"><div class="rel">${poster(x.poster_path, title)}${scoreBadge(x)}${isAdded(type, x.id) ? `<span class="badge">${ICON.check}</span>` : tileAdd(type, x.id)}</div>
    <div class="tile-name">${esc(title)}</div>${withYear && year ? `<div class="tile-sub">${esc(year)}</div>` : ''}</a>`;
}

/* ----- Notes de la communauté TMDB (sur 10) ----- */
const fmtScore = n => (Math.round(n * 10) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const scoreLvl = n => n >= 7 ? 'hi' : n >= 5.5 ? 'mid' : 'lo';
// Pas de note affichée en dessous de 10 votes : trop peu pour vouloir dire quelque chose.
function scoreBadge(x, cls = '') {
  if (!x?.vote_average || (x.vote_count || 0) < 10) return '';
  return `<span class="score ${cls} ${scoreLvl(x.vote_average)}" aria-label="Note TMDB ${fmtScore(x.vote_average)} sur 10">★ ${fmtScore(x.vote_average)}</span>`;
}
function scoreLine(d) {
  if (!d?.vote_average || (d.vote_count || 0) < 10) return '';
  return `<div class="score-line">${scoreBadge(d, 'inline')}<span>/10 · ${plural(d.vote_count, 'vote', 'votes')} TMDB</span></div>`;
}

/* ================= Recherche avancée ================= */
const YEAR = new Date().getFullYear();
const ADV_PERIODS = [[YEAR, YEAR, 'Cette année'], [2020, YEAR, 'Années 2020'], [2010, 2019, 'Années 2010'], [2000, 2009, 'Années 2000'], [1990, 1999, 'Années 90'], ['', 1989, 'Avant 1990']];
const ADV_DUR = {
  movie: [['short', 'Moins de 1 h 30', { lte: 89 }], ['mid', '1 h 30 à 2 h', { gte: 90, lte: 120 }], ['long', 'Plus de 2 h', { gte: 121 }]],
  tv: [['short', 'Épisodes courts', { lte: 35 }], ['long', 'Épisodes longs', { gte: 36 }]],
};
const ADV_LANGS = [['fr', 'Français'], ['en', 'Anglais'], ['ko', 'Coréen'], ['ja', 'Japonais'], ['es', 'Espagnol']];
const ADV_SORTS = [['popularity.desc', 'Populaires'], ['vote_average.desc', 'Mieux notés'], ['date', 'Plus récents']];
const DAY_MS = 24 * 3600e3;
const genresUrl = kind => tmdbUrl(`/genre/${kind}/list`);
const providersUrl = kind => tmdbUrl(`/watch/providers/${kind}`, { watch_region: 'FR' });
// Les plateformes d'abonnement les plus courantes en France, dans l'ordre de TMDB (sans les boutiques de location).
const STORE = /store|vod|youtube|rakuten|google play|amazon video|microsoft|madelen|universcine|filmotv|premium|channel/i;
function advProviders(data) {
  return (data?.results || []).filter(p => !STORE.test(p.provider_name))
    .sort((a, b) => (a.display_priorities?.FR ?? 99) - (b.display_priorities?.FR ?? 99)).slice(0, 14);
}
const saveAdv = () => { LS.set('w2w.adv', ui.adv); LS.set('w2w.advOn', ui.advOn); };

function advParams(f, page) {
  const date = f.kind === 'movie' ? 'primary_release_date' : 'first_air_date';
  const p = { page, include_adult: 'false', watch_region: 'FR', sort_by: f.sort === 'date' ? date + '.desc' : f.sort };
  if (f.genres.length) p.with_genres = f.genres.join(',');
  if (f.from) p[date + '.gte'] = f.from + '-01-01';
  if (f.to) p[date + '.lte'] = f.to + '-12-31';
  else if (f.sort === 'date') p[date + '.lte'] = new Date().toISOString().slice(0, 10);   // pas les sorties à venir
  const dur = ADV_DUR[f.kind].find(d => d[0] === f.dur)?.[2];
  if (dur?.gte) p['with_runtime.gte'] = dur.gte;
  if (dur?.lte) p['with_runtime.lte'] = dur.lte;
  if (f.rating) p['vote_average.gte'] = f.rating;
  // Assez de votes pour qu'une note veuille dire quelque chose (sinon un inconnu noté 10 par 3 personnes passe devant).
  p['vote_count.gte'] = f.rating || f.sort === 'vote_average.desc' ? (f.kind === 'tv' ? 50 : 100) : f.person ? 0 : 10;
  if (f.person) p.with_people = f.person.id;
  if (f.lang) p.with_original_language = f.lang;
  if (f.providers.length) p.with_watch_providers = f.providers.join('|');
  return p;
}

// Séries d'une personne : TMDB ne sait pas filtrer les séries par acteur, on part donc de sa filmographie.
function personTv(f) {
  const r = useData(tmdbUrl(`/person/${f.person.id}/tv_credits`), DAY_MS);
  if (!r.data) return r;
  const seen = new Set();
  const items = [...(r.data.cast || []), ...(r.data.crew || [])].filter(x => !seen.has(x.id) && seen.add(x.id)).filter(x => {
    const g = x.genre_ids || [], y = Number((x.first_air_date || '').slice(0, 4));
    // Talk-shows, infos, télé-réalité et passages où la personne joue son propre rôle : pas des séries « avec » elle.
    if (!f.genres.some(id => [10763, 10764, 10767].includes(id)) && g.some(id => [10763, 10764, 10767].includes(id))) return false;
    if (/\b(self|himself|herself|themselves|lui-même|elle-même)\b/i.test(x.character || '')) return false;
    if (!f.genres.every(id => g.includes(id))) return false;
    if (f.from && !(y >= Number(f.from))) return false;
    if (f.to && !(y && y <= Number(f.to))) return false;
    if (f.rating && !(x.vote_average >= f.rating && x.vote_count >= 20)) return false;
    if (f.lang && x.original_language !== f.lang) return false;
    return true;
  });
  const by = { 'popularity.desc': x => x.popularity || 0, 'vote_average.desc': x => (x.vote_count >= 20 ? 10 : 0) + (x.vote_average || 0), date: x => Date.parse(x.first_air_date) || 0 }[f.sort];
  items.sort((a, b) => by(b) - by(a));
  return { data: { results: items, total_results: items.length, total_pages: 1 } };
}

// Filtres actifs, sous forme de pastilles qu'on retire d'un toucher.
function advChips(f) {
  const genres = useData(genresUrl(f.kind), DAY_MS).data?.genres || [];
  const provs = useData(providersUrl(f.kind), DAY_MS).data?.results || [];
  const chips = [];
  for (const id of f.genres) chips.push(['genres', id, genres.find(g => g.id === id)?.name || 'Genre']);
  if (f.from || f.to) chips.push(['years', '', f.from && f.to ? (f.from === f.to ? f.from : `${f.from}–${f.to}`) : f.from ? `Depuis ${f.from}` : `Jusqu’à ${f.to}`]);
  if (f.dur) chips.push(['dur', '', ADV_DUR[f.kind].find(d => d[0] === f.dur)?.[1] || '']);
  if (f.person) chips.push(['person', '', f.person.name]);
  if (f.rating) chips.push(['rating', '', `★ ${fmtScore(f.rating)}+`]);
  for (const id of f.providers) chips.push(['providers', id, provs.find(p => p.provider_id === id)?.provider_name || 'Plateforme']);
  if (f.lang) chips.push(['lang', '', ADV_LANGS.find(l => l[0] === f.lang)?.[1] || f.lang]);
  if (f.sort !== 'popularity.desc') chips.push(['sort', '', ADV_SORTS.find(s => s[0] === f.sort)[1]]);
  return chips;
}
const advCount = () => ui.advOn ? advChips(ui.adv).filter(c => c[0] !== 'sort').length : 0;
function advBtnHTML() {
  const n = advCount();
  return `<button id="advBtn" class="filterbtn ${ui.advOn ? 'on' : ''}" data-act="adv-open" aria-label="Filtres${n ? ` (${n} actifs)` : ''}">${ICON.filter}<span>Filtres</span>${n ? `<b class="fcount">${n}</b>` : ''}</button>`;
}

function advResultsHTML() {
  const f = ui.adv;
  const chips = `<div class="fchips">
    <button class="fchip kind" data-act="adv-open">${f.kind === 'tv' ? 'Séries' : 'Films'}</button>
    ${advChips(f).map(([k, v, label]) => `<button class="fchip" data-act="adv-drop" data-k="${k}" data-v="${v}" aria-label="Retirer le filtre ${esc(label)}">${esc(label)}${ICON.close}</button>`).join('')}
  </div>`;
  const items = [], ids = new Set();
  let first, more = false, status = '';
  if (f.person && f.kind === 'tv') {
    const r = personTv(f);
    if (r.loading) status = spinner('Recherche…'); else if (r.error) status = errorBlock(r.error);
    else { first = r.data; items.push(...r.data.results); }
  } else {
    for (let page = 1; page <= ui.advPages; page++) {
      const r = useData(tmdbUrl(`/discover/${f.kind}`, advParams(f, page)), 3600e3);
      if (r.loading) { status = spinner('Recherche…'); break; }
      if (r.error) { status = errorBlock(r.error); break; }
      first = first || r.data;
      for (const x of r.data.results || []) if (!ids.has(x.id)) { ids.add(x.id); items.push(x); }
      more = page < Math.min(r.data.total_pages || 1, 500);
    }
  }
  const head = `<div class="advhead"><b>${first ? plural(first.total_results || 0, 'résultat', 'résultats') : 'Filtres'}</b>
    <button class="linkbtn" data-act="adv-clear">Effacer les filtres</button></div>`;
  if (first && !items.length) return `${head}${chips}<div class="empty"><b>Aucun résultat</b><p>Essaie en retirant un filtre.</p></div>`;
  return `${head}${chips}
    ${f.person && f.kind === 'tv' && (f.dur || f.providers.length) ? '<p class="muted small gap-top">Pour les séries d’une personne, la durée et les plateformes ne sont pas prises en compte.</p>' : ''}
    ${items.length ? `<div class="grid gap-top">${items.map(x => tmdbTile(x, f.kind, true)).join('')}</div>` : ''}
    ${status || (more ? `<button class="btn morebtn" data-act="adv-more">Voir plus</button>` : '')}`;
}

/* ----- Panneau des filtres ----- */
const filtersEl = document.getElementById('filters');
const pill = (act, k, v, label, on, extra = '') => `<button type="button" class="pill" data-act="${act}" data-k="${k}" data-v="${v}" aria-pressed="${on}">${extra}${esc(label)}</button>`;

function sheetHTML() {
  const f = ui.advDraft, k = f.kind;
  const genres = mem.get(genresUrl(k))?.data?.genres;
  const provs = advProviders(mem.get(providersUrl(k))?.data);
  const wait = '<div class="muted small">Chargement…</div>';
  return `<div class="askbox advsheet">
    <div class="sheet-head"><h2 id="filters-title">Filtres</h2><button type="button" class="linkbtn" data-act="adv-reset">Réinitialiser</button>
      <button type="button" class="sheet-x" data-act="adv-close" aria-label="Fermer les filtres">${ICON.close}</button></div>
    <div class="sheet-body">
      <div class="seg">${[['movie', 'Films'], ['tv', 'Séries']].map(([v, l]) => `<button type="button" data-act="adv-set" data-k="kind" data-v="${v}" aria-pressed="${k === v}">${l}</button>`).join('')}</div>
      <h3>Genres</h3>
      <div class="pills">${genres ? genres.map(g => pill('adv-toggle', 'genres', g.id, g.name, f.genres.includes(g.id))).join('') : wait}</div>
      <h3>Année de sortie</h3>
      <div class="pills">${ADV_PERIODS.map(([a, b, l]) => pill('adv-set', 'period', `${a}-${b}`, l, f.from === String(a) && f.to === String(b))).join('')}</div>
      <div class="yrs"><input id="advFrom" class="input" type="number" inputmode="numeric" min="1900" max="${YEAR + 2}" placeholder="De" value="${esc(f.from)}" aria-label="À partir de l’année">
        <span>à</span><input id="advTo" class="input" type="number" inputmode="numeric" min="1900" max="${YEAR + 2}" placeholder="À" value="${esc(f.to)}" aria-label="Jusqu’à l’année"></div>
      <h3>Durée${k === 'tv' ? ' d’un épisode' : ''}</h3>
      <div class="pills">${ADV_DUR[k].map(([v, l]) => pill('adv-set', 'dur', v, l, f.dur === v)).join('')}</div>
      <h3>Avec</h3>
      ${f.person
        ? `<div class="pills"><button type="button" class="pill person" data-act="adv-noperson" aria-pressed="true" aria-label="Retirer ${esc(f.person.name)}">${f.person.photo ? `<img src="${IMG}w185${esc(f.person.photo)}" alt="">` : ''}${esc(f.person.name)}${ICON.close}</button></div>
           ${k === 'tv' ? '<p class="muted small">Pour les séries, on part de sa filmographie : la durée et les plateformes ne sont pas prises en compte.</p>' : ''}`
        : `<input id="advPerson" class="input" type="search" autocomplete="off" enterkeyhint="search" placeholder="Un acteur, une réalisatrice…" aria-label="Chercher une personne"><div id="advPeople" class="people-res"></div>`}
      <h3>Note TMDB minimale <b id="advRateTxt">${f.rating ? `★ ${fmtScore(f.rating)}+` : 'Toutes'}</b></h3>
      <input id="advRate" class="range" type="range" min="0" max="9" step="0.5" value="${f.rating}" aria-label="Note minimale sur 10">
      <h3>Plateformes</h3>
      <div class="pills">${provs.length ? provs.map(p => pill('adv-toggle', 'providers', p.provider_id, p.provider_name, f.providers.includes(p.provider_id), p.logo_path ? `<img src="${IMG}w92${esc(p.logo_path)}" alt="">` : '')).join('') : wait}</div>
      <h3>Langue d’origine</h3>
      <div class="pills">${ADV_LANGS.map(([v, l]) => pill('adv-set', 'lang', v, l, f.lang === v)).join('')}</div>
      <h3>Trier par</h3>
      <div class="pills">${ADV_SORTS.map(([v, l]) => pill('adv-set', 'sort', v, l, f.sort === v)).join('')}</div>
    </div>
    <div class="sheet-foot"><button type="button" class="btn primary" data-act="adv-apply">Voir les résultats</button></div>
  </div>`;
}
// Redessine seulement le contenu du panneau : le cadre reste en place (pas d'animation rejouée)
// et on garde l'endroit où on en était dedans.
function renderSheet() {
  const body = filtersEl.open && filtersEl.querySelector('.sheet-body');
  if (!body) return;
  const y = body.scrollTop;
  const tmp = document.createElement('div');
  tmp.innerHTML = sheetHTML();
  body.replaceChildren(...tmp.querySelector('.sheet-body').childNodes);
  body.scrollTop = y;
}
function loadSheetLists(kind) {
  Promise.allSettled([load(genresUrl(kind), DAY_MS), load(providersUrl(kind), DAY_MS)]).then(renderSheet);
}
function openFilters() {
  hideToast();
  ui.advDraft = structuredClone(ui.adv);
  filtersEl.innerHTML = sheetHTML();
  filtersEl.showModal();
  loadSheetLists(ui.advDraft.kind);
}
filtersEl.addEventListener('click', ev => { if (ev.target === filtersEl) filtersEl.close(); });

let personTimer;
function searchPeople(q) {
  clearTimeout(personTimer);
  const box = document.getElementById('advPeople');
  if (q.trim().length < 2) { if (box) box.innerHTML = ''; return; }
  personTimer = setTimeout(async () => {
    let r;
    try { r = await load(tmdbUrl('/search/person', { query: q.trim() })); }
    catch (e) { r = null; }
    const out = document.getElementById('advPeople');
    if (!out || document.getElementById('advPerson')?.value !== q) return;
    const people = (r?.results || []).slice(0, 6);
    const JOB = { Acting: 'Acteur, actrice', Directing: 'Réalisation', Writing: 'Scénario', Production: 'Production' };
    out.innerHTML = r ? (people.length ? people.map(p => `<button type="button" class="person-row" data-act="adv-person" data-id="${p.id}" data-name="${esc(p.name)}" data-photo="${esc(p.profile_path || '')}">
        <span class="person-ph">${p.profile_path ? `<img src="${IMG}w185${esc(p.profile_path)}" alt="" loading="lazy">` : esc(p.name.charAt(0))}</span>
        <span class="min0"><b>${esc(p.name)}</b><span class="muted small">${esc([JOB[p.known_for_department] || p.known_for_department, (p.known_for || []).slice(0, 2).map(x => x.title || x.name).join(', ')].filter(Boolean).join(' · '))}</span></span>
      </button>`).join('') : '<div class="muted small">Aucune personne trouvée.</div>') : '<div class="muted small">Recherche impossible pour l’instant.</div>';
  }, 300);
}

// Chargement : des formes grises qui scintillent à la place du contenu (le rond qui tourne reste pour les recherches).
const spinner = (txt = '') => txt ? `<div class="loading"><div class="spinner"></div>${esc(txt)}</div>`
  : `<div class="skel" role="status" aria-label="Chargement…">${'<div class="skel-row"><i class="sk-pic"></i><div class="sk-lines"><i></i><i class="short"></i></div></div>'.repeat(3)}</div>`;
const skelRail = () => `<div class="rail skel" role="status" aria-label="Chargement…">${'<i class="sk-poster"></i>'.repeat(4)}</div>`;
function errorBlock(msg) {
  return `<div class="empty"><b class="err">${esc(msg)}</b><button class="btn" data-act="retry">Réessayer</button></div>`;
}
const backBtn = () => `<button class="backbtn" data-act="back" aria-label="Retour">${ICON.back}</button>`;
const loadingView = () => `${backBtn()}<div class="pt-hero skel-hero" role="status" aria-label="Chargement…"><i class="sk-poster"></i><div class="sk-lines"><i></i><i></i><i class="short"></i></div></div>`;
const errorView = msg => `${backBtn()}<div class="pt-hero">${errorBlock(msg)}</div>`;

/* ================= Fiches : éléments communs ================= */
function hero(backdrop, posterPath, title, meta) {
  return `<div class="hero">
    <div class="hero-bg">${backdrop ? `<img src="${IMG}w780${esc(backdrop)}" alt="" onerror="this.remove()">` : ''}</div>
    ${backBtn()}
    <div class="hero-inner pad">${poster(posterPath, title)}
      <div class="min0"><h1>${esc(title)}</h1><div class="hero-meta">${meta}</div></div>
    </div>
  </div>`;
}

function overviewBlock(key, text) {
  if (!text) return '';
  const open = ui.expanded[key];
  return `<p class="overview ${open || text.length < 260 ? '' : 'clamp'}">${esc(text)}</p>
    ${text.length >= 260 ? `<button class="linkbtn" data-act="expand" data-key="${key}">${open ? 'Réduire' : 'Lire la suite'}</button>` : ''}`;
}

function genresBlock(d) {
  return d?.genres?.length ? `<div class="genres pad">${d.genres.map(g => `<span class="chip">${esc(g.name)}</span>`).join('')}</div>` : '';
}

// « Où regarder » en France, d'après JustWatch (via TMDB) : juste l'info, sans lien.
const PROVIDER_GROUPS = [[['flatrate'], 'Streaming'], [['free', 'ads'], 'Gratuit'], [['rent', 'buy'], 'Location ou achat']];
// Variantes d'une même plateforme (offre avec pub, chaîne vendue via Amazon/Apple…) : on garde la plateforme principale.
const PROVIDER_VARIANT = /\s+(standard with ads|with ads|amazon channel|apple tv channel|roku premium channel)$/i;
function providersBlock(kind, id) {
  const r = useData(tmdbUrl(`/${kind}/${id}/watch/providers`), 12 * 3600e3);
  if (r.loading || r.error) return '';
  const fr = r.data?.results?.FR;
  const seen = new Set();
  const rows = PROVIDER_GROUPS.map(([keys, label]) => {
    const list = keys.flatMap(k => fr?.[k] || [])
      .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
      .filter(p => {
        const name = p.provider_name.replace(PROVIDER_VARIANT, '').trim().toLowerCase();
        if (seen.has(name)) return false;   // déjà listée (plus haut ou sous une autre forme)
        seen.add(name); return true;
      });
    if (!list.length) return '';
    const shown = list.slice(0, 6), more = list.length - shown.length;
    return `<div class="prov-row"><span class="prov-label">${label}</span><div class="prov-list">${shown.map(p =>
      `<span class="prov">${p.logo_path ? `<img src="${IMG}w92${esc(p.logo_path)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span>${esc(p.provider_name.replace(PROVIDER_VARIANT, ''))}</span></span>`).join('')}${more > 0 ? `<span class="prov more">+${more}</span>` : ''}</div></div>`;
  }).join('');
  return `<section class="pad providers">
    <h2>Où regarder</h2>
    ${rows || '<p class="muted">Pas disponible en France pour l’instant.</p>'}
    <p class="fine">Source : JustWatch</p>
  </section>`;
}

// Panneau « Recommander à des amis ».
// Bouton « Conseiller » : met le titre dans les suggestions de tous les autres membres.
function recoBtn(kind, id, small = false) {
  const r = useData('/api/recos', 30e3);
  const on = !!r.data?.mine?.some(m => m.kind === kind && m.id === Number(id));
  const text = on ? 'Conseillé' : 'Conseiller';
  return `<button class="btn ${small ? 'small' : ''} ${on ? 'on' : ''}" data-act="reco-toggle" data-kind="${kind}" data-id="${id}" aria-pressed="${on}">${on ? ICON.check : ICON.send} ${text}</button>`;
}

// Avis : le mien (modifiable) et ceux des amis, plus ce que les amis ont vu.
// Réponses sous un avis : repliées par défaut, une petite flèche les déroule.
function repliesBlock(rv, kind, id, s, e, users) {
  const rk = `${rv.userId}:${kind}:${id}:${s}:${e}`;
  const replies = rv.replies || [];
  const open = ui.openReplies.has(rk);
  const toggle = `<button type="button" class="replies-toggle ${open ? 'open' : ''}" data-act="replies-toggle" data-rk="${rk}" aria-expanded="${open}">
    ${ICON.chevron}<span>${replies.length ? plural(replies.length, 'réponse', 'réponses') : 'Répondre'}</span></button>`;
  if (!open) return `<div class="replies">${toggle}</div>`;
  const who = uid => users[uid] || (uid === me.id ? me : null);
  const list = replies.map(r => {
    const u = who(r.userId);
    if (!u) return '';
    return `<div class="reply">${avatar(u, 'sm')}<div class="min0">
      <div class="reply-head"><b>${esc(u.name)}</b><span class="muted">${timeAgo(r.at)}</span>
        ${r.userId === me.id ? `<button type="button" class="linkbtn" data-act="reply-delete" data-rid="${r.id}">Effacer</button>` : ''}</div>
      <p>${esc(r.text)}</p></div></div>`;
  }).join('');
  const draft = ui.replyDrafts[rk] || '';
  return `<div class="replies">${toggle}
    <div class="reply-list">${list}
      <div class="reply-box">
        <textarea class="input" rows="1" maxlength="1000" data-reply="${rk}" placeholder="Ta réponse…" aria-label="Ta réponse">${esc(draft)}</textarea>
        <button type="button" class="btn small primary" data-act="reply-send" data-rk="${rk}" ${draft.trim() ? '' : 'disabled'}>Envoyer</button>
      </div>
    </div></div>`;
}

function reviewsSection(kind, id, s = 0, e = 0) {
  const url = `/api/title/${kind}/${id}` + (kind === 'ep' ? `?s=${s}&e=${e}` : '');
  const r = useData(url, 30e3);
  if (r.loading) return `<div class="pad"><h2>Avis</h2>${spinner()}</div>`;
  if (r.error) return `<div class="pad"><h2>Avis</h2><p class="err">${esc(r.error)}</p></div>`;
  const { mine, reviews, activity, users } = r.data;
  const dk = `${kind}:${id}:${s}:${e}`;
  const draft = ui.drafts[dk];

  let friendsLine = '';
  if (activity.length) {
    const label = a => {
      if (kind === 'tv') return a.archived ? 'a abandonné' : plural(a.watchedCount, 'épisode vu', 'épisodes vus');
      if (kind === 'movie') return a.status === 'watched' ? 'l’a vu' : 'veut le voir';
      return 'l’a vu';
    };
    friendsLine = `<div class="friends-act">${activity.map(a => users[a.userId] ? `<a class="fchip" href="#/user/${a.userId}">${avatar(users[a.userId], 'sm')}<span><b>${esc(users[a.userId].name)}</b> ${esc(label(a))}</span></a>` : '').join('')}</div>`;
  }

  let composer;
  if (mine && !draft) {
    composer = `<div class="review mine">
      <div class="review-head">${avatar(me, 'sm')}<b>Ton avis</b>${stars(mine.rating)}<span class="muted">${timeAgo(mine.at)}</span></div>
      ${mine.text ? `<p>${esc(mine.text)}</p>` : ''}
      <div class="row"><button class="btn small" data-act="review-edit" data-dk="${dk}" data-url="${esc(url)}">Modifier</button>
      <button class="btn small danger" data-act="review-delete" data-dk="${dk}" data-url="${esc(url)}">Supprimer</button></div>
      ${repliesBlock(mine, kind, id, s, e, users)}
    </div>`;
  } else {
    const d = draft || { rating: null, text: '' };
    composer = `<div class="composer">
      <div class="star-input" role="group" aria-label="Ta note">${[1, 2, 3, 4, 5].map(n =>
        `<button type="button" class="star-btn ${d.rating >= n ? 'on' : ''}" data-act="star" data-dk="${dk}" data-n="${n}" aria-label="${n} sur 5" aria-pressed="${d.rating === n}">★</button>`).join('')}</div>
      <textarea class="input" id="rv-${dk.replace(/:/g, '-')}" data-draft="${dk}" rows="2" maxlength="2000" placeholder="${kind === 'ep' ? 'Ton avis sur cet épisode…' : 'Ton avis, pour tes amis…'}">${esc(d.text)}</textarea>
      <div class="row"><button class="btn primary small" data-act="review-save" data-dk="${dk}" data-url="${esc(url)}" ${d.rating || d.text.trim() ? '' : 'disabled'}>Publier</button>
      ${draft && mine ? `<button class="btn small" data-act="review-cancel" data-dk="${dk}">Annuler</button>` : ''}</div>
    </div>`;
  }

  const list = reviews.map(rv => {
    const u = users[rv.userId];
    if (!u) return '';
    return `<div class="review">
      <div class="review-head"><a href="#/user/${u.id}" class="review-who">${avatar(u, 'sm')}<b>${esc(u.name)}</b></a>${stars(rv.rating)}<span class="muted">${timeAgo(rv.at)}</span></div>
      ${rv.text ? `<p>${esc(rv.text)}</p>` : ''}
      ${repliesBlock(rv, kind, id, s, e, users)}
    </div>`;
  }).join('');

  return `<div class="pad">
    ${friendsLine ? `<h2>Tes amis</h2>${friendsLine}` : ''}
    <h2>Avis <small>${reviews.length + (mine ? 1 : 0) || ''}</small></h2>
    ${composer}
    ${list || '<p class="muted gap-top">Aucun ami n’a encore donné son avis.</p>'}
  </div>`;
}

function similarRail(kind, id) {
  const r = useData(tmdbUrl(`/${kind}/${id}/recommendations`), 3600e3);
  if (r.data && !(r.data.results || []).length) return '';
  return `<div class="pad"><h2>Dans le même esprit</h2>${rail(r, kind)}</div>`;
}

/* ================= Fiche série ================= */
function viewTv(id) {
  const sh = state.shows[id];
  const r = useData(tmdbUrl(`/tv/${id}`));
  const d = r.data;
  if (!d && !sh) return r.error ? errorView(r.error) : loadingView();
  // Infos fraîches de TMDB pour l'affichage ; les coches viennent de mes données.
  const base = d ? { ...slimShow(d), watched: sh?.watched || {} } : sh;
  const meta = [base.year, d?.networks?.[0]?.name, STATUS_FR[base.status] || base.status].filter(Boolean).map(esc).join(' · ') + scoreLine(d);

  let actions;
  if (sh) {
    const armed = ui.confirm === 'untrack:' + id;
    actions = `<div class="actions pad">
      ${recoBtn('tv', id, true)}
      <button class="btn small" data-act="archive" data-id="${id}">${sh.archived ? 'Reprendre' : 'Abandonner'}</button>
      <button class="btn small danger ${armed ? 'armed' : ''}" data-act="untrack" data-id="${id}">${armed ? 'Tout effacer ?' : 'Retirer'}</button>
    </div>`;
  } else {
    actions = `<div class="actions pad">
      <button class="btn primary grow" data-act="track" data-id="${id}">${ICON.plus} Suivre</button>
      ${recoBtn('tv', id)}
    </div>`;
  }

  actions += quizBlock('tv', id);

  let prog = '';
  if (sh) {
    const p = progress(base);
    const pct = p.aired ? Math.round(p.watched / p.aired * 100) : 0;
    const nextTxt = p.next ? `Prochain : <b>${code(p.next.s, p.next.e)}</b>` : (base.next ? `Prochain épisode : ${esc(relDay(base.next.d)).toLowerCase()}` : 'À jour');
    prog = `<div class="progress pad">
      <div class="progress-row"><span><b>${p.watched}</b> / ${p.aired} épisodes vus</span><span>${nextTxt}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }

  // Toutes les saisons sont repliées à l'ouverture de la fiche ; on déplie celle qu'on veut.
  if (!ui.openSeasons[id]) ui.openSeasons[id] = new Set();
  const seasons = base.seasons.map(se => seasonBlock(base, !!sh, se)).join('');

  return `${hero(base.backdrop, base.poster, base.name, meta)}
    ${prog}${actions}${suggestedBy('tv', id)}${genresBlock(d)}${providersBlock('tv', id)}
    <div class="pad">${overviewBlock('tv' + id, d?.overview)}</div>
    <div class="pad"><h2>Saisons <small>${base.seasons.length}</small></h2>${seasons || '<p class="muted">Aucun épisode annoncé.</p>'}</div>
    ${reviewsSection('tv', id)}
    ${similarRail('tv', id)}`;
}

function seasonBlock(base, tracked, se) {
  const open = ui.openSeasons[base.id].has(se.n);
  let airedCount = 0, seenCount = 0;
  for (let e = 1; e <= se.c; e++) {
    if (isAired(base, se.n, e)) { airedCount++; if (base.watched[epKey(se.n, e)]) seenCount++; }
  }
  const done = airedCount > 0 && seenCount === airedCount;
  let eps = '';
  if (open) {
    const r = useData(tmdbUrl(`/tv/${base.id}/season/${se.n}`), SEASON_TTL);
    const list = r.data?.episodes?.length
      ? r.data.episodes.filter(x => x.episode_number <= se.c)
      : Array.from({ length: se.c }, (_, i) => ({ episode_number: i + 1 }));
    eps = `<ol class="eps">${r.loading ? `<li class="ep"><span class="ep-date">Chargement des épisodes…</span></li>` : ''}${list.map(x => {
      const e = x.episode_number;
      const aired = isAired(base, se.n, e);
      const seen = !!base.watched[epKey(se.n, e)];
      const bits = [];
      if (x.air_date) bits.push(aired || dayDiff(x.air_date) < 0 ? longDate(x.air_date) : 'Diffusion ' + relDay(x.air_date).toLowerCase());
      if (x.runtime) bits.push(x.runtime + ' min');
      return `<li class="ep ${aired ? '' : 'future'} ${seen ? 'seen' : ''}">
        <a class="ep-main" href="#/ep/${base.id}/${se.n}/${e}"><span class="ep-num">E${pad(e)}</span>
          <div class="min0"><div class="ep-title">${esc(x.name || 'Épisode ' + e)}</div>${bits.length ? `<div class="ep-date">${esc(bits.join(' · '))}</div>` : ''}</div></a>
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

/* ================= Fiche épisode ================= */
function viewEp(id, s, e) {
  const sh = state.shows[id];
  const showR = useData(tmdbUrl(`/tv/${id}`));
  const seasonR = useData(tmdbUrl(`/tv/${id}/season/${s}`), SEASON_TTL);
  const d = showR.data;
  if (!d && !sh) return showR.error ? errorView(showR.error) : loadingView();
  const base = d ? { ...slimShow(d), watched: sh?.watched || {} } : sh;
  const ep = seasonR.data?.episodes?.find(x => x.episode_number === e) || {};
  const aired = isAired(base, s, e);
  const seen = !!base.watched[epKey(s, e)];
  const img = ep.still_path ? `${IMG}w780${esc(ep.still_path)}` : base.backdrop ? `${IMG}w780${esc(base.backdrop)}` : '';
  const meta = [ep.air_date ? longDate(ep.air_date) : '', ep.runtime ? ep.runtime + ' min' : ''].filter(Boolean).join(' · ');

  const season = base.seasons.find(x => x.n === s);
  const prev = e > 1 ? [s, e - 1] : (() => { const ps = base.seasons.filter(x => x.n < s).pop(); return ps ? [ps.n, ps.c] : null; })();
  const next = season && e < season.c ? [s, e + 1] : (() => { const ns = base.seasons.find(x => x.n > s); return ns ? [ns.n, 1] : null; })();

  return `<div class="ephero">
      ${img ? `<img src="${img}" alt="" onerror="this.remove()">` : ''}
      ${backBtn()}
    </div>
    <div class="pad">
      <a class="ep-show" href="#/tv/${id}">${esc(base.name)}</a>
      <h1 class="ep-h1"><span class="code">${code(s, e)}</span> ${esc(ep.name || 'Épisode ' + e)}</h1>
      ${meta ? `<div class="hero-meta">${esc(meta)}</div>` : ''}
      <div class="actions">
        ${aired
          ? `<button class="btn grow ${seen ? 'primary' : ''}" data-act="ep" data-id="${id}" data-s="${s}" data-e="${e}" aria-pressed="${seen}">${ICON.check} ${seen ? 'Vu' : 'Marquer comme vu'}</button>`
          : `<span class="chip">${ep.air_date ? 'Diffusion ' + esc(relDay(ep.air_date).toLowerCase()) : 'Pas encore diffusé'}</span>`}
      </div>
      ${overviewBlock(`ep${id}-${s}-${e}`, ep.overview)}
      <div class="epnav">
        ${prev ? `<a class="btn small" href="#/ep/${id}/${prev[0]}/${prev[1]}">← ${code(prev[0], prev[1])}</a>` : '<span></span>'}
        ${next ? `<a class="btn small" href="#/ep/${id}/${next[0]}/${next[1]}">${code(next[0], next[1])} →</a>` : ''}
      </div>
    </div>
    ${aired ? reviewsSection('ep', id, s, e) : ''}`;
}

/* ================= Fiche film ================= */
function viewMovie(id) {
  const m = state.movies[id];
  const r = useData(tmdbUrl(`/movie/${id}`));
  const d = r.data;
  if (!d && !m) return r.error ? errorView(r.error) : loadingView();
  const title = d?.title || m.title;
  const runtime = d?.runtime || m?.runtime;
  const release = d?.release_date || '';
  const meta = [
    (release || m?.year || '').slice(0, 4),
    runtime ? fmtDuration(runtime) : '',
    dayDiff(release) > 0 ? 'Sortie le ' + longDate(release) : '',
  ].filter(Boolean).map(esc).join(' · ') + scoreLine(d);
  const inList = m?.status === 'watchlist', seen = m?.status === 'watched';
  return `${hero(d?.backdrop_path || m?.backdrop, d?.poster_path || m?.poster, title, meta)}
    <div class="actions pad">
      ${seen ? '' : `<button class="btn grow ${inList ? 'primary' : ''}" data-act="m-list" data-id="${id}" aria-pressed="${inList}">${inList ? ICON.check : ICON.bookmark} À voir</button>`}
      <button class="btn grow ${seen ? 'primary' : ''}" data-act="m-seen" data-id="${id}" aria-pressed="${seen}">${ICON.check} ${seen ? 'Vu' : 'J’ai vu'}</button>
      ${recoBtn('movie', id)}
    </div>
    ${quizBlock('movie', id)}
    ${seen && m.watchedAt ? `<div class="pad muted">Vu le ${new Date(m.watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>` : ''}
    ${suggestedBy('movie', id)}
    ${genresBlock(d)}
    ${providersBlock('movie', id)}
    <div class="pad">${overviewBlock('mv' + id, d?.overview)}</div>
    ${reviewsSection('movie', id)}
    ${similarRail('movie', id)}`;
}

/* ================= Amis ================= */
// En haut, les groupes ; dessous, le fil d'activité ou les membres du groupe choisi.
function viewAmis() {
  const r = useData('/api/groups', 30e3);
  const groups = r.data?.groups || [];
  if (r.data && ui.group !== 'all' && !groups.some(g => g.id === ui.group)) setGroup('all');
  const cur = groups.find(g => g.id === ui.group) || null;
  let body;
  if (r.loading) body = spinner();
  else if (r.error) body = errorBlock(r.error);
  else if (!groups.length) body = `<div class="empty"><b>Aucun groupe pour l’instant</b>
      <p>Crée un groupe pour tes potes, ta famille ou tes collègues, puis invite-les avec un lien. Tu verras ici ce qu’ils regardent.</p>
      <button class="btn primary" data-act="group-new">${ICON.plus} Créer un groupe</button></div>`;
  else body = `${tabs('amisTab', ui.amisTab, [['feed', 'Activité'], ['friends', 'Membres'], ['groups', 'Groupes'], ['games', `Jeux${badges.quiz || badges.duels ? '<i class="tabmark" aria-label="à jouer"></i>' : ''}`]])}
    ${ui.amisTab === 'friends' ? membersHTML(r.data, cur) : ui.amisTab === 'groups' ? groupsTabHTML(r.data) : ui.amisTab === 'games' ? gamesHTML(cur) : feedHTML(cur)}`;
  return `<div class="pad">
    <header class="top"><h1>Amis</h1></header>
    ${groups.length ? `<div class="gchips">
      <button class="gchip" data-act="group-pick" data-id="all" aria-pressed="${!cur}">Tous</button>
      ${groups.map(g => `<button class="gchip" data-act="group-pick" data-id="${g.id}" aria-pressed="${cur?.id === g.id}">${esc(g.emoji)} ${esc(g.name)}</button>`).join('')}
    </div>` : ''}
    ${body}
  </div>`;
}
// Onglet Groupes : tous mes groupes en cartes, avec de quoi inviter et les régler.
function groupsTabHTML({ groups, users }) {
  return `<button class="btn primary wide gap-top" data-act="group-new">${ICON.plus} Créer un groupe</button>
    <div class="gcards">${groups.map(g => {
      const others = g.members.filter(id => id !== me.id && users[id]);
      const boss = g.createdBy === me.id ? 'toi' : users[g.createdBy]?.name;
      return `<div class="gcard">
        <button class="gcard-main" data-act="group-open" data-id="${g.id}">
          <span class="gemoji">${esc(g.emoji)}</span>
          <span class="min0"><b>${esc(g.name)}</b><span class="muted small">${plural(g.members.length, 'membre', 'membres')}${boss ? ` · créé par ${esc(boss)}` : ''}</span></span>
          ${others.length ? `<span class="avs">${others.slice(0, 4).map(id => avatar(users[id], 'sm')).join('')}${others.length > 4 ? `<span class="av sm more">+${others.length - 4}</span>` : ''}</span>` : ''}
        </button>
        <div class="gcard-actions">
          <button class="btn small grow" data-act="invite" data-id="${g.id}">${ICON.send} Inviter</button>
          <button class="btn small danger" data-act="grp-leave" data-id="${g.id}">Quitter</button>
          <button class="btn small iconbtn" data-act="group-edit" data-id="${g.id}" aria-label="Réglages de ${esc(g.name)}">${ICON.gear}</button>
        </div>
      </div>`;
    }).join('')}</div>`;
}
function setGroup(id) { ui.group = id; LS.set('w2w.group', id); }

function membersHTML({ groups, users }, cur) {
  const meU = { ...me, ...(users[me.id] || {}) };
  if (!cur) {
    // Tous mes groupes : chaque personne une fois, avec les emojis des groupes qu'on partage.
    const ids = [...new Set(groups.flatMap(g => g.members))].filter(id => id !== me.id && users[id])
      .sort((a, b) => users[a].name.localeCompare(users[b].name, 'fr'));
    return `<button class="btn primary wide gap-top" data-act="invite">${ICON.send} Inviter avec un lien</button>
      <h2>Tes amis <small>${ids.length}</small></h2>
      ${ids.length ? `<div class="people">${ids.map(id => personRow(users[id],
        `<span class="gtags">${groups.filter(g => g.members.includes(id)).map(g => `<span title="${esc(g.name)}">${esc(g.emoji)}</span>`).join('')}</span>`, `#/user/${id}`)).join('')}</div>`
        : '<p class="muted">Personne pour l’instant : invite tes amis dans un de tes groupes.</p>'}
      <p class="muted small gap-top">Pour ajouter quelqu’un qui est déjà sur l’appli, choisis un groupe en haut.</p>`;
  }
  const boss = cur.createdBy === me.id;
  const ids = [me.id, ...cur.members.filter(id => id !== me.id && users[id])];
  return `<div class="ghead">
      <span class="gemoji">${esc(cur.emoji)}</span>
      <div class="min0"><b>${esc(cur.name)}</b><div class="muted small">${plural(cur.members.length, 'membre', 'membres')}</div></div>
      <button class="btn small iconbtn" data-act="group-edit" data-id="${cur.id}" aria-label="Réglages du groupe">${ICON.gear}</button>
    </div>
    <button class="btn primary wide" data-act="invite" data-id="${cur.id}">${ICON.send} Inviter dans ${esc(cur.name)}</button>
    <div class="people gap-top">${ids.map(id => {
      const u = id === me.id ? meU : users[id];
      const armed = ui.confirm === `gkick:${cur.id}:${id}`;
      const extra = (cur.createdBy === id ? '<span class="chip">Créateur</span>' : '')
        + (boss && id !== me.id ? `<button class="btn small danger ${armed ? 'armed' : ''}" data-act="group-kick" data-g="${cur.id}" data-u="${id}">${armed ? 'Sûr ?' : 'Retirer'}</button>` : '');
      return personRow(id === me.id ? { ...u, name: u.name + ' (toi)' } : u, extra, `#/user/${id}`);
    }).join('')}</div>
    <h2>Ajouter quelqu’un de l’appli</h2>
    <label class="searchbox">${ICON.search}<input id="memberQ" type="search" autocomplete="off" placeholder="Son pseudo ou son nom" aria-label="Chercher quelqu’un sur l’appli"></label>
    <div id="memberRes" class="people"></div>`;
}

// Recherche de membres de l'appli, affichée sur place pour garder le clavier ouvert.
let memberTimer;
function searchMembers(q) {
  clearTimeout(memberTimer);
  const out = document.getElementById('memberRes');
  if (q.trim().length < 2) { if (out) out.innerHTML = ''; return; }
  memberTimer = setTimeout(async () => {
    let r;
    try { r = await get('/api/users?q=' + encodeURIComponent(q.trim())); } catch (e) { r = null; }
    const box = document.getElementById('memberRes');
    const cur = mem.get('/api/groups')?.data?.groups.find(g => g.id === ui.group);
    if (!box || !cur || document.getElementById('memberQ')?.value !== q) return;
    box.innerHTML = !r ? '<p class="muted small">Recherche impossible pour l’instant.</p>'
      : r.users.length ? r.users.map(u => personRow(u, cur.members.includes(u.id) ? '<span class="muted small">Déjà dedans</span>'
        : `<button class="btn small primary" data-act="group-add" data-g="${cur.id}" data-u="${u.id}">Ajouter</button>`)).join('')
      : '<p class="muted small">Personne avec ce nom. Envoie-lui plutôt le lien d’invitation.</p>';
  }, 300);
}

/* ----- Panneau des groupes : création, réglages, choix d'un groupe ----- */
const GROUP_EMOJIS = ['🍿', '🎬', '🍕', '🎮', '🏠', '🏢', '🎓', '⚽', '🎸', '❤️', '🌴', '👪'];
const grpEl = document.getElementById('grp');
grpEl.addEventListener('click', ev => { if (ev.target === grpEl) grpEl.close(); });
const groupsData = () => load('/api/groups', 30e3);
function storeGroups(data) { mem.set('/api/groups', { t: Date.now(), data }); invalidate('/api/feed'); }

function openGroupForm(g) {
  ui.grpEmoji = g?.emoji || GROUP_EMOJIS[0];
  const boss = g && g.createdBy === me.id;
  grpEl.innerHTML = `<div class="askbox">
    <h2 id="grp-title">${g ? 'Réglages du groupe' : 'Nouveau groupe'}</h2>
    <input id="grpName" class="input" maxlength="30" placeholder="Nom du groupe (ex. Les colocs)" value="${esc(g?.name || '')}" aria-label="Nom du groupe">
    <div class="pills emojis">${GROUP_EMOJIS.map(e => `<button type="button" class="pill" data-act="grp-emoji" data-v="${e}" aria-pressed="${e === ui.grpEmoji}">${e}</button>`).join('')}</div>
    <button type="button" class="btn primary" data-act="grp-save" data-id="${g?.id || ''}">${g ? 'Enregistrer' : 'Créer le groupe'}</button>
    ${g ? `${boss ? `<button type="button" class="btn" data-act="grp-relink" data-id="${g.id}">Changer le lien d’invitation</button>
      <p class="muted small">L’ancien lien ne marchera plus. Les membres restent dans le groupe.</p>` : ''}
      <button type="button" class="btn danger" data-act="grp-leave" data-id="${g.id}">Quitter le groupe</button>` : ''}
  </div>`;
  grpEl.showModal();
  if (!g) setTimeout(() => document.getElementById('grpName')?.focus(), 50);
}

// Liste de groupes à choisir (pour inviter quelqu'un, ou ajouter un membre de l'appli).
function openGroupPicker(title, text, groups, act, extra = '') {
  grpEl.innerHTML = `<div class="askbox">
    <h2 id="grp-title">${esc(title)}</h2>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${groups.map(g => `<button type="button" class="btn gpick" data-act="${act}" data-id="${g.id}" data-g="${g.id}" ${extra}>
      <span class="gemoji">${esc(g.emoji)}</span><span class="min0">${esc(g.name)}</span><span class="muted small">${plural(g.members.length, 'membre', 'membres')}</span></button>`).join('')}
    <button type="button" class="btn" data-act="grp-close">Annuler</button>
  </div>`;
  grpEl.showModal();
}

async function shareInvite(g) {
  const url = `${location.origin}/#/join/${g.invite}`;
  const text = `Rejoins le groupe ${g.emoji} ${g.name} sur what2watch pour qu’on suive nos séries et films ensemble :`;
  if (navigator.share) {
    try { await navigator.share({ title: 'what2watch', text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast(`Lien d’invitation pour ${g.name} copié`); }
  catch (e) { await ask({ title: `Lien pour ${g.name}`, text: url, yes: 'OK' }); }
}

// Lien d'invitation (#/join/<code>) : gardé jusqu'à ce qu'on soit connecté.
function catchInvite() {
  const m = /^#\/join\/([\w-]{6,40})/.exec(location.hash);
  if (!m) return false;
  LS.set('w2w.invite', m[1]);
  if (!me) ui.authMode = 'register';
  history.replaceState(null, '', me ? '#/amis' : '#/collection');
  return true;
}
async function handleInvite() {
  const code = LS.get('w2w.invite');
  if (!code || !me) return;
  LS.del('w2w.invite');
  let g, mine;
  try { g = (await get(`/api/invite/${code}`)).group; mine = (await groupsData()).groups; }
  catch (e) { return toast(e.message); }
  if (location.hash !== '#/amis') location.hash = '#/amis';
  if (mine.some(x => x.id === g.id)) { setGroup(g.id); rerender(); return toast(`Tu fais déjà partie de ${g.emoji} ${g.name}`); }
  const yes = await ask({ title: `Rejoindre ${g.emoji} ${g.name} ?`, text: `Ce groupe a ${plural(g.count, 'membre', 'membres')}. Tu verras leur activité dans l’onglet Amis, et eux la tienne.`, yes: 'Rejoindre le groupe', no: 'Pas maintenant' });
  if (!yes) return;
  try {
    const r = await post(`/api/invite/${code}/join`);
    storeGroups(r); setGroup(r.id); rerender();
    toast(`Bienvenue dans ${g.emoji} ${g.name}`);
  } catch (e) { fail(e); }
}

function feedHTML(cur) {
  const r = useData('/api/feed' + (cur ? `?group=${cur.id}` : ''), 30e3);
  if (r.loading) return spinner();
  if (r.error) return errorBlock(r.error);
  const { items, users } = r.data;
  if (!items.length) return `<div class="empty"><b>Rien pour l’instant</b><p>Ce que les membres ${cur ? 'de ce groupe' : 'de tes groupes'} regardent et leurs avis apparaîtront ici.</p><button class="btn primary" data-act="invite" ${cur ? `data-id="${cur.id}"` : ''}>Inviter des amis</button></div>`;
  return `<div class="feed">${items.map(it => {
    const u = users[it.userId]; if (!u) return '';
    const t = it.title;
    let what, href;
    if (it.type === 'eps') {
      href = `#/tv/${t.id}`;
      what = it.n === 1
        ? `a vu <b>${code(it.first.s, it.first.e)}</b> de <b>${esc(t.name)}</b>`
        : `a vu <b>${it.n} épisodes</b> de <b>${esc(t.name)}</b> <span class="muted">(${code(it.first.s, it.first.e)} → ${code(it.last.s, it.last.e)})</span>`;
    } else if (it.type === 'quiz') {
      href = it.mode === 'free' ? `#/${it.kind}/${t.id}` : '#/amis';
      what = `a fait <b>${it.correct}/${it.total}</b> ${it.mode === 'free' ? `au quiz <b>${esc(t.name)}</b>` : 'au <b>quiz du jour</b>'} <span class="muted">· ${fmtPts(it.score)}</span>${it.correct === it.total ? ' 🔥' : ''}`;
    } else if (it.type === 'movie') {
      href = `#/movie/${t.id}`;
      what = `a vu le film <b>${esc(t.name)}</b>`;
    } else {
      href = it.kind === 'movie' ? `#/movie/${t.id}` : it.kind === 'ep' ? `#/ep/${t.id}/${it.s}/${it.e}` : `#/tv/${t.id}`;
      const target = it.kind === 'ep' ? `<b>${code(it.s, it.e)}</b> de <b>${esc(t.name)}</b>` : `<b>${esc(t.name)}</b>`;
      what = `a donné son avis sur ${target} ${stars(it.rating)}${it.text ? `<span class="quote">${esc(it.text)}</span>` : ''}`;
    }
    return `<article class="fitem">
      <a href="#/user/${u.id}">${avatar(u)}</a>
      <div class="min0"><a href="#/user/${u.id}" class="fname">${esc(u.name)}</a> <a href="${href}" class="fwhat">${what}</a>
        <div class="muted small">${timeAgo(it.at)}</div>${reactRow(it, users)}</div>
      ${it.type === 'quiz' && it.mode === 'daily' ? `<span class="fposter fquiz" aria-hidden="true">🎯</span>` : `<a href="${href}" class="fposter" tabindex="-1">${poster(t.poster, t.name, 'w154')}</a>`}
    </article>`;
  }).join('')}</div>`;
}

// Réactions emoji sous une activité du fil : une pastille par emoji, + pour en choisir un.
const REACTIONS = ['😂', '🔥', '😱', '❤️', '👏'];
function reactRow(it, users) {
  const rs = it.reactions || {}, k = esc(it.key);
  const chips = REACTIONS.filter(e => rs[e]?.length).map(e => {
    const who = rs[e].map(id => id === me.id ? 'toi' : users[id]?.name || '?').join(', ');
    return `<button type="button" class="rchip ${rs[e].includes(me.id) ? 'mine' : ''}" data-act="react" data-k="${k}" data-e="${e}" data-who="${esc(who)}" aria-label="${e} : ${esc(who)}">${e}<small>${rs[e].length}</small></button>`;
  }).join('');
  const open = ui.reactOpen === it.key;
  return `<div class="reacts">${chips}<button type="button" class="rchip radd ${open ? 'on' : ''}" data-act="react-pick" data-k="${k}" aria-label="Réagir" aria-expanded="${open}">🙂<small>+</small></button>${
    open ? `<div class="rpicker">${REACTIONS.map(e => `<button type="button" data-act="react" data-k="${k}" data-e="${e}">${e}</button>`).join('')}</div>` : ''}</div>`;
}
// Applique une réaction tout de suite sur le fil en mémoire (le serveur confirme ensuite).
function setFeedReactions(key, fn) {
  for (const [url, hit] of mem) {
    if (!url.startsWith('/api/feed') || !hit.data) continue;
    for (const it of hit.data.items) if (it.key === key) it.reactions = fn(it.reactions || {});
  }
}

/* ================= Jeux : quiz et classements ================= */
const fmtPts = n => `${Number(n).toLocaleString('fr-FR')} pts`;
const MEDALS = ['🥇', '🥈', '🥉'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function rankRows(rows, users, value) {
  if (!rows.length) return `<p class="muted gap-top">Personne n’a encore joué. Lance-toi !</p>`;
  return `<div class="ranks">${rows.map((r, i) => {
    const u = users[r.userId]; if (!u) return '';
    return `<a class="rank-row ${r.userId === me.id ? 'me' : ''}" href="#/user/${u.id}">
      <span class="rank-n">${MEDALS[i] || i + 1}</span>${avatar(u, 'sm')}
      <span class="grow min0"><b>${esc(r.userId === me.id ? 'Toi' : u.name)}</b>${value(r).sub ? `<span class="muted small"> · ${value(r).sub}</span>` : ''}</span>
      <b class="rank-pts">${value(r).main}</b></a>`;
  }).join('')}</div>`;
}

// Séries (au moins un épisode vu) et films vus, les plus récents d'abord : de quoi lancer un quiz libre.
function quizzableTitles() {
  const tv = Object.values(state.shows).filter(sh => Object.keys(sh.watched).length).map(sh => ({ kind: 'tv', id: sh.id, name: sh.name, poster: sh.poster, at: lastWatchedAt(sh) }));
  const mv = Object.values(state.movies).filter(m => m.status === 'watched').map(m => ({ kind: 'movie', id: m.id, name: m.title, poster: m.poster, at: m.watchedAt || 0 }));
  return [...tv, ...mv].sort((a, b) => b.at - a.at);
}

// Le quiz libre d'un titre n'est ouvert qu'une fois vu (au moins un épisode pour une série).
const hasSeen = (kind, id) => kind === 'tv' ? Object.keys(state.shows[id]?.watched || {}).length > 0 : state.movies[id]?.status === 'watched';

function gamesHTML(cur) {
  const r = useData('/api/games' + (cur ? `?group=${cur.id}` : ''), 20e3);
  if (r.loading) return spinner();
  if (r.error) return errorBlock(r.error);
  const { daily, today, monthRank, kings, users, month, challenges } = r.data;
  const dailyCard = daily.played
    ? `<div class="game-daily done">
        <div class="game-emoji">🎯</div>
        <div class="min0"><b>Quiz du jour</b><div class="muted small">Tu as fait <b>${daily.correct}/${daily.total}</b> · ${fmtPts(daily.score)}. Nouveau quiz demain !</div></div>
      </div>`
    : `<div class="game-daily">
        <div class="game-emoji">🎯</div>
        <div class="min0"><b>Quiz du jour</b><div class="muted small">10 questions sur les séries et films les plus regardés de la bande. Une seule tentative, les mêmes questions pour tout le monde !</div>
        <button class="btn primary small" data-act="quiz-start" data-mode="daily">${daily.started ? 'Reprendre' : 'Jouer'}</button></div>
      </div>`;
  const tab = ui.rankTab || 'today';
  const ranks = tab === 'today'
    ? rankRows(today, users, x => ({ main: fmtPts(x.score), sub: `${x.correct}/${x.total}` }))
    : rankRows(monthRank, users, x => ({ main: fmtPts(x.points), sub: plural(x.played, 'partie', 'parties') }));
  const titles = quizzableTitles();
  return `${duelsHTML(challenges, users)}${dailyCard}
    <h2>Classement</h2>
    ${seg('rankTab', tab, [['today', 'Aujourd’hui'], ['month', MONTHS[Number(month.slice(5)) - 1].replace(/^./, c => c.toUpperCase())]])}
    ${tab === 'month' ? `<p class="muted small gap-top">Points du quiz du jour + ton meilleur score sur chaque quiz libre du mois. Remise à zéro le 1ᵉʳ.</p>` : ''}
    ${ranks}
    ${kings.length ? `<h2>Qui connaît le mieux…</h2>
      <div class="kings">${kings.map(k => {
        const u = users[k.userId];
        const mine = k.userId === me.id;
        return `<div class="king">
          ${poster(k.title.poster, k.title.name, 'w154')}
          <span class="min0 grow"><b>${esc(k.title.name)}</b><span class="muted small">👑 ${esc(mine ? 'Toi' : u?.name || '?')} · ${k.correct}/${k.total} · ${fmtPts(k.score)}</span></span>
          ${mine
            ? `<button class="btn small" data-act="duel-pick" data-kind="${k.kind}" data-id="${k.title.id}" data-name="${esc(k.title.name)}">⚔️ Défier</button>`
            : hasSeen(k.kind, k.title.id)
              ? `<button class="btn small" data-act="quiz-start" data-mode="free" data-kind="${k.kind}" data-id="${k.title.id}">Le battre</button>`
              : `<button class="btn small primary" data-act="king-seen" data-kind="${k.kind}" data-id="${k.title.id}" data-name="${esc(k.title.name)}">👁️ J’ai vu</button>`}</div>`;
      }).join('')}</div>` : ''}
    <h2>Quiz libre</h2>
    ${titles.length
      ? `<p class="muted small">Choisis une série ou un film que tu as vu. Pas de spoiler : les questions portent seulement sur les épisodes que tu as vus.</p>
        <div class="rail quiz-rail">${titles.slice(0, 30).map(t => `<button class="qtile" data-act="quiz-start" data-mode="free" data-kind="${t.kind}" data-id="${t.id}">
          ${poster(t.poster, t.name, 'w154')}<span>${esc(t.name)}</span></button>`).join('')}</div>`
      : `<p class="muted">Coche des épisodes ou des films vus pour débloquer leurs quiz.</p>`}`;
}

// Défis reçus (à relever, puis résultats) et défis envoyés de la semaine.
function duelsHTML(ch, users) {
  if (!ch || (!ch.received.length && !ch.sent.length)) return '';
  const name = id => esc(users[id]?.name || '?');
  const rows = [];
  for (const c of ch.received) {
    const u = users[c.fromId];
    if (!c.done) rows.push(`<div class="duel open">${u ? avatar(u, 'sm') : ''}
      <span class="min0 grow"><b>${name(c.fromId)}</b> te défie au quiz <b>${esc(c.title.name)}</b><span class="muted small">Score à battre : ${c.correct}/${c.total} · ${fmtPts(c.score)}</span></span>
      <button class="btn small primary" data-act="quiz-start" data-mode="free" data-challenge="${c.id}">Relever</button></div>`);
    else {
      const won = c.reply.score > c.score;
      rows.push(`<div class="duel">${u ? avatar(u, 'sm') : ''}
        <span class="min0 grow">${won ? `🏆 Tu as battu <b>${name(c.fromId)}</b>` : c.reply.score === c.score ? `🤝 Égalité avec <b>${name(c.fromId)}</b>` : `😅 <b>${name(c.fromId)}</b> garde l’avantage`} sur <b>${esc(c.title.name)}</b>
        <span class="muted small">${fmtPts(c.reply.score)} contre ${fmtPts(c.score)}</span></span></div>`);
    }
  }
  // Défis lancés : repliés derrière une ligne de résumé, qu'on déplie d'un appui.
  const sent = [];
  for (const c of ch.sent) {
    const u = users[c.toId];
    const res = !c.done ? `<span class="muted small">En attente… ton score : ${fmtPts(c.score)}</span>`
      : c.reply.score === c.score ? `<span class="muted small">🤝 Égalité : ${fmtPts(c.score)} chacun</span>`
      : c.reply.score > c.score ? `<span class="muted small">😱 Ton score est battu : ${fmtPts(c.reply.score)} contre ${fmtPts(c.score)}</span>`
      : `<span class="muted small">😎 Pas mieux que toi : ${fmtPts(c.reply.score)} contre ${fmtPts(c.score)}</span>`;
    sent.push(`<div class="duel sent">${u ? avatar(u, 'sm') : ''}
      <span class="min0 grow">Tu as défié <b>${name(c.toId)}</b> sur <b>${esc(c.title.name)}</b>${res}</span></div>`);
  }
  if (sent.length) {
    const open = !!ui.expanded.duelsSent, waiting = ch.sent.filter(c => !c.done).length;
    rows.push(`<button type="button" class="duel duels-toggle ${open ? 'is-open' : ''}" data-act="expand" data-key="duelsSent" aria-expanded="${open}">
      <span class="game-emoji small">⚔️</span>
      <span class="min0 grow"><b>${sent.length > 1 ? `${sent.length} défis lancés` : '1 défi lancé'}</b>
        <span class="muted small">${[waiting && `${waiting} en attente`, sent.length - waiting && `${sent.length - waiting} relevé${sent.length - waiting > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</span></span>${ICON.chevron}</button>`);
    if (open) rows.push(`<div class="duels-sent">${sent.join('')}</div>`);
  }
  return `<h2>⚔️ Défis</h2><div class="duels">${rows.join('')}</div>`;
}

// Choisir les amis à défier (membres de mes groupes) ; renvoie leurs ids, ou [] si annulé.
async function pickFriends(title) {
  const g = await load('/api/groups', 60e3);
  const ids = [...new Set(g.groups.flatMap(x => x.members))].filter(id => id !== me.id && g.users[id])
    .sort((a, b) => g.users[a].name.localeCompare(g.users[b].name, 'fr'));
  hideToast();
  askEl.innerHTML = `<div class="askbox">
      <h2 id="ask-title">${esc(title)}</h2>
      ${ids.length ? `<p>Ils recevront ton score et une notification. À eux de faire mieux !</p>
        <div class="pick-list">${ids.map(id => `<button type="button" class="pick-mate" data-uid="${id}" aria-pressed="false">${avatar(g.users[id], 'sm')}<span class="grow">${esc(g.users[id].name)}</span><i></i></button>`).join('')}</div>
        <button type="button" class="btn primary" data-answer="yes" disabled>Envoyer le défi</button>`
      : `<p>Personne dans tes groupes pour l’instant. Invite des amis depuis l’onglet Groupes.</p>`}
      <button type="button" class="btn" data-answer="no">Annuler</button>
    </div>`;
  const send = askEl.querySelector('[data-answer="yes"]');
  const toggle = ev => {
    const b = ev.target.closest('.pick-mate'); if (!b) return;
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
    const n = askEl.querySelectorAll('.pick-mate[aria-pressed="true"]').length;
    send.disabled = !n; send.textContent = n > 1 ? `Défier ${n} amis` : 'Envoyer le défi';
  };
  askEl.addEventListener('click', toggle);
  askEl.returnValue = '';
  askEl.showModal();
  await new Promise(done => askEl.addEventListener('close', done, { once: true }));
  askEl.removeEventListener('click', toggle);
  return askEl.returnValue === 'yes' ? [...askEl.querySelectorAll('.pick-mate[aria-pressed="true"]')].map(b => Number(b.dataset.uid)) : [];
}
async function sendDuel(kind, id, name) {
  const to = await pickFriends(`Défier qui au quiz ${name} ?`);
  if (!to.length) return;
  try {
    const r = await post('/api/challenges', { kind, id: Number(id), to });
    invalidate('/api/games');
    toast(r.sent > 1 ? `Défi envoyé à ${r.sent} amis ⚔️` : 'Défi envoyé ⚔️');
    rerender();
  } catch (e) { fail(e); }
}

// Bloc « Quiz » sur la fiche d'un titre vu.
function quizBlock(kind, id) {
  const seen = kind === 'tv' ? Object.keys(state.shows[id]?.watched || {}).length : state.movies[id]?.status === 'watched';
  if (!seen) return '';
  const r = useData(`/api/games/title/${kind}/${id}`, 60e3);
  const k = r.data?.king, mine = r.data?.mine;
  const line = k
    ? `👑 ${k.userId === me.id ? 'Tu es le meilleur' : `<b>${esc(r.data.users[k.userId]?.name || '?')}</b> connaît le mieux`} · ${k.correct}/${k.total}${mine && k.userId !== me.id ? ` · ton record : ${mine.correct}/${mine.total}` : ''}`
    : 'Personne n’a encore joué. Sois le premier !';
  return `<div class="pad"><div class="quiz-block">
    <span class="game-emoji">🎯</span>
    <div class="min0 grow"><b>Quiz ${kind === 'tv' ? 'de la série' : 'du film'}</b><div class="muted small">${line}</div></div>
    <span class="quiz-block-btns">
      ${mine ? `<button class="btn small" data-act="duel-pick" data-kind="${kind}" data-id="${id}" data-name="${esc((kind === 'tv' ? state.shows[id]?.name : state.movies[id]?.title) || '')}">⚔️ Défier</button>` : ''}
      <button class="btn small primary" data-act="quiz-start" data-mode="free" data-kind="${kind}" data-id="${id}">Jouer</button>
    </span>
  </div></div>`;
}

// Écran de quiz (#/quiz) : état dans ui.quiz, chrono calculé depuis l'échéance (un nouvel affichage ne le relance pas).
let quizTimer = null;
async function startQuiz(body) {
  clearTimeout(quizTimer);
  ui.quiz = { loading: true, ...body };
  if (location.hash !== '#/quiz') location.hash = '#/quiz'; else render();
  try {
    const r = await post('/api/quiz/start', body);
    ui.quiz = { ...r, body: { ...body, kind: r.kind || body.kind, id: r.tid || body.id }, answers: [], q: null };
    await quizNext();
  } catch (e) { ui.quiz = null; history.back(); fail(e); }
}
async function quizNext() {
  const Q = ui.quiz; if (!Q) return;
  const r = await post(`/api/quiz/${Q.id}/next`);
  if (ui.quiz !== Q) return;
  Q.q = r.q; Q.i = r.i; Q.score = r.score; Q.title = r.title; Q.limit = r.limit; Q.deadline = Date.now() + r.left;
  Q.picked = null; Q.res = null; Q.enter = true;
  rerender();
  quizTimer = setTimeout(() => quizAnswer(-1), r.left + 50);
}
async function quizAnswer(c) {
  const Q = ui.quiz;
  if (!Q?.q || Q.picked !== null) return;
  clearTimeout(quizTimer);
  Q.picked = c;
  paintAnswer(Q);
  try {
    const r = await post(`/api/quiz/${Q.id}/answer`, { i: Q.i, c });
    if (ui.quiz !== Q) return;
    Q.res = r; Q.score = r.score; Q.answers[Q.i] = r.ok;
    paintAnswer(Q);
    if (r.ok) replay(document.querySelector('.quiz-gain'), 'pop-in');
    quizTimer = setTimeout(() => {
      if (ui.quiz !== Q) return;
      if (r.done) {
        Q.result = { ...r.result, correct: r.correct, score: r.score }; Q.q = null; rerender(); quizCelebrate(Q); invalidate('/api/games', '/api/feed');
        if (Q.body.mode === 'daily') { badges.quiz = 0; updateBadge(); }
        if (Q.body.challenge || Q.body.mode === 'daily') refreshMe();
      }
      else quizNext().catch(fail);
    }, 1300);
  } catch (e) { fail(e); }
}
// Met à jour les boutons, le chrono, les étapes et le score sans redessiner l'écran (pas de saut).
function paintAnswer(Q) {
  const box = main.querySelector('.quiz-choices');
  if (!box) return rerender();
  main.querySelector('.quiz-timer')?.classList.add('stop');
  main.querySelector('.quiz-img')?.classList.add('revealed');
  for (const b of box.querySelectorAll('.quiz-c')) {
    const i = Number(b.dataset.c);
    b.disabled = true;
    b.classList.remove('picked', 'right', 'wrong', 'dim');
    if (Q.res) b.classList.add(i === Q.res.a ? 'right' : i === Q.picked ? 'wrong' : 'dim');
    else if (i === Q.picked) b.classList.add('picked');
  }
  if (!Q.res) return;
  main.querySelector('.quiz-feedback').innerHTML = quizFeedback(Q);
  const step = main.querySelectorAll('.quiz-steps i')[Q.i];
  if (step) step.className = Q.res.ok ? 'ok' : 'ko';
  const sc = main.querySelector('.quiz-score');
  if (sc) sc.textContent = fmtPts(Q.score);
}
const quizFeedback = Q => Q.res ? (Q.res.ok ? `<span class="quiz-gain">+${Q.res.pts}</span> Bonne réponse !` : Q.picked === -1 ? '⏱️ Trop tard !' : 'Raté !') : '';
function quizCelebrate(Q) {
  if (Q.result.duel?.won) confetti(innerWidth / 2, innerHeight / 3, 50);
  else if (Q.result.correct === Q.total) { confetti(innerWidth / 2, innerHeight / 3, 60); setTimeout(() => confetti(innerWidth / 2, innerHeight / 3, 40), 400); }
  else if (Q.result.king || Q.result.rank === 1) confetti(innerWidth / 2, innerHeight / 3);
}

function viewQuiz() {
  const Q = ui.quiz;
  if (!Q) return `<div class="pad"><div class="empty"><b>Pas de partie en cours</b><p>Lance un quiz depuis l’onglet Amis → Jeux.</p><a class="btn primary" href="#/amis" data-act="go-games">Aller aux jeux</a></div></div>`;
  const steps = `<div class="quiz-steps">${Array.from({ length: Q.total || 10 }, (_, i) =>
    `<i class="${Q.answers?.[i] === true ? 'ok' : Q.answers?.[i] === false ? 'ko' : i === Q.i && Q.q ? 'cur' : ''}"></i>`).join('')}</div>`;
  const top = `<header class="quiz-top">
      <button class="iconbtn" data-act="quiz-quit" aria-label="Quitter le quiz">✕</button>
      <b class="min0 quiz-name">${esc(Q.title || 'Quiz')}</b>
      <span class="quiz-score">${fmtPts(Q.score || 0)}</span>
    </header>${steps}`;
  if (Q.result) {
    const R = Q.result, perfect = R.correct === Q.total;
    const msg = perfect ? 'Sans-faute ! 🔥' : R.correct >= Q.total * 0.7 ? 'Bien joué ! 👏' : R.correct >= Q.total * 0.4 ? 'Pas mal ! 🙂' : 'Aïe… revanche ? 😅';
    const extra = Q.body.mode === 'daily'
      ? `Tu es <b>${R.rank === 1 ? '1ᵉʳ 🥇' : R.rank + 'ᵉ'}</b> sur ${R.players} aujourd’hui.`
      : R.duel ? (R.duel.won ? `🏆 Défi relevé : tu as battu <b>${esc(R.duel.name)}</b> (${fmtPts(R.duel.score)}) !`
        : R.duel.tie ? `Égalité parfaite avec <b>${esc(R.duel.name)}</b> !` : `😅 <b>${esc(R.duel.name)}</b> garde l’avantage avec ${fmtPts(R.duel.score)}.`)
      : R.king ? '👑 Tu es le meilleur de ta bande sur ce quiz !' : R.record ? 'Nouveau record perso !' : R.prev ? `Ton record reste ${fmtPts(R.prev)}.` : '';
    return `<div class="pad quiz">${top}
      <div class="quiz-result">
        <div class="quiz-big">${R.correct}<small>/${Q.total}</small></div>
        <h2>${msg}</h2>
        <p class="quiz-total">${fmtPts(R.score)}</p>
        ${extra ? `<p class="muted">${extra}</p>` : ''}
        <div class="quiz-end">
          ${Q.body.mode === 'free' ? `<button class="btn primary" data-act="duel-pick" data-kind="${Q.body.kind}" data-id="${Q.body.id}" data-name="${esc(Q.title)}">⚔️ Défier un ami</button>
            ${Q.body.challenge ? '' : `<button class="btn" data-act="quiz-again">Rejouer</button>`}<a class="btn" href="#/${Q.body.kind}/${Q.body.id}">Voir la fiche</a>` : ''}
          <a class="btn ${Q.body.mode === 'daily' ? 'primary' : ''}" href="#/amis" data-act="go-games">Classement</a>
        </div>
      </div></div>`;
  }
  if (!Q.q) return `<div class="pad quiz">${top}${spinner('Préparation des questions…')}</div>`;
  const left = Math.max(0, Q.deadline - Date.now());
  // L'entrée glissée ne se joue qu'à l'arrivée d'une nouvelle question.
  const enter = Q.enter; Q.enter = false;
  const withImg = Q.q.c.some(c => c.img !== undefined);
  const answered = Q.res, a = Q.res?.a;
  return `<div class="pad quiz">${top}
    <div class="quiz-timer ${answered || Q.picked !== null ? 'stop' : ''}"><i style="--from:${(left / Q.limit).toFixed(3)};animation-duration:${left}ms"></i></div>
    <div class="quiz-body ${enter ? 'enter' : ''}">
      ${Q.q.img ? `<div class="quiz-img ${Q.q.imgKind} ${answered || Q.picked !== null ? 'revealed' : ''}" style="--from:${(left / Q.limit).toFixed(3)};--d:${left}ms"><img src="${IMG}${Q.q.imgKind === 'backdrop' ? 'w780' : 'w342'}${esc(Q.q.img)}" alt=""></div>` : ''}
      <h2 class="quiz-q">${esc(Q.q.t)}</h2>
      ${Q.q.x ? `<blockquote class="quiz-x">${esc(Q.q.x)}</blockquote>` : ''}
      <div class="quiz-choices ${withImg ? 'faces' : Q.q.c.length === 2 ? 'tf' : ''}">${Q.q.c.map((c, i) => {
        const cls = answered ? (i === a ? 'right' : i === Q.picked ? 'wrong' : 'dim') : i === Q.picked ? 'picked' : '';
        return `<button class="quiz-c ${cls}" data-act="quiz-pick" data-c="${i}" ${Q.picked !== null ? 'disabled' : ''}>
          ${withImg ? `<span class="quiz-face">${c.img ? `<img src="${IMG}w185${esc(c.img)}" alt="" loading="eager">` : esc(c.l.slice(0, 1))}</span>` : ''}<span>${esc(c.l)}</span></button>`;
      }).join('')}</div>
      <div class="quiz-feedback">${quizFeedback(Q)}</div>
    </div></div>`;
}

/* ================= Suggestions des amis ================= */
// Regroupe les recommandations reçues par titre : une affiche par titre, avec tous les amis qui l'ont conseillé.
function suggestionGroups(recos) {
  const groups = new Map();
  for (const rc of recos) {
    const key = rc.kind + ':' + rc.title.id;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { kind: rc.kind, title: rc.title, recos: [], unseen: false, at: 0 });
    g.recos.push(rc);
    g.unseen ||= !rc.seen;
    g.at = Math.max(g.at, rc.at);
  }
  return [...groups.values()].sort((a, b) => b.at - a.at);
}

function viewSuggestions() {
  const r = useData('/api/recos', 30e3);
  let body, counts = { tv: 0, movie: 0 };
  if (r.loading) body = spinner();
  else if (r.error) body = errorBlock(r.error);
  else {
    // Le serveur filtre déjà, mais les coches faites hors connexion ne lui sont peut-être pas encore parvenues.
    const groups = suggestionGroups(r.data.recos).filter(g => !alreadySeen(g.kind, g.title.id));
    for (const g of groups) counts[g.kind]++;
    const list = groups.filter(g => g.kind === ui.sugTab);
    const what = ui.sugTab === 'tv' ? 'série' : 'film';
    body = list.length
      ? `<div class="grid gap-top">${list.map(sugTile).join('')}</div>`
      : `<div class="empty"><b>Aucun ${what} conseillé</b><p>Quand un ami conseille un${ui.sugTab === 'tv' ? 'e' : ''} ${what}, son affiche apparaît ici. Toi aussi, appuie sur Conseiller sur une fiche : tous tes amis le verront.</p></div>`;
  }
  return `<div class="pad">
    <header class="top"><h1>Suggestions</h1></header>
    ${tabs('sugTab', ui.sugTab, [['tv', `Séries · ${counts.tv}`], ['movie', `Films · ${counts.movie}`]])}
    ${body}
  </div>`;
}

// Série commencée (au moins un épisode coché) ou film vu : inutile de le suggérer.
function alreadySeen(kind, id) {
  if (kind === 'tv') { const sh = state.shows[id]; return !!sh && Object.keys(sh.watched || {}).length > 0; }
  return state.movies[id]?.status === 'watched';
}

function sugTile(g) {
  const t = g.title;
  const froms = [...new Map(g.recos.map(rc => [rc.from?.id, rc.from])).values()].filter(Boolean);
  const names = froms.length === 1 ? froms[0].name : `${froms[0].name} +${froms.length - 1}`;
  const added = isAdded(g.kind, t.id);
  return `<a class="tile sug ${g.unseen ? 'unseen' : ''}" href="#/${g.kind}/${t.id}">
    <div class="rel">${poster(t.poster, t.name)}${added ? `<span class="inlist" title="Dans ta collection">${ICON.check}</span>` : tileAdd(g.kind, t.id)}${g.unseen ? '<span class="newtag">Nouveau</span>' : ''}
      <span class="avs onposter">${froms.slice(0, 4).map(u => avatar(u, 'sm')).join('')}${froms.length > 4 ? `<span class="av sm more">+${froms.length - 4}</span>` : ''}</span></div>
    <div class="tile-name">${esc(t.name)}</div>
    <div class="sug-from">${esc(names)}</div>
  </a>`;
}

// Sur une fiche : qui me l'a conseillé, avec leurs messages.
function suggestedBy(kind, id) {
  const r = useData('/api/recos', 30e3);
  const mine = (r.data?.recos || []).filter(rc => rc.kind === kind && rc.title.id === Number(id));
  if (!mine.length) return '';
  return `<section class="pad suggested">
    <h2>Conseillé par tes amis</h2>
    ${mine.map(rc => `<div class="reco-from">${avatar(rc.from, 'sm')}<div class="min0"><span><b>${esc(rc.from?.name)}</b> · ${timeAgo(rc.at)}</span>${rc.message ? `<p class="quote">${esc(rc.message)}</p>` : ''}</div></div>`).join('')}
    <button class="btn small" data-act="reco-hide" data-kind="${kind}" data-id="${id}">Retirer de mes suggestions</button>
  </section>`;
}

function personRow(u, actionsHtml, href) {
  const who = `${avatar(u)}<div class="min0"><b>${esc(u.name)}</b><div class="muted small">@${esc(u.username)}</div></div>`;
  return `<div class="person">${href ? `<a class="person-link" href="${href}">${who}</a>` : `<div class="person-link">${who}</div>`}<div class="row">${actionsHtml}</div></div>`;
}

function viewUser(id) {
  const r = useData(`/api/users/${id}`, 60e3);
  if (r.loading) return loadingView();
  if (r.error) return errorView(r.error);
  const { user: u, shows, movies, reviews } = r.data;
  let eps = 0, minutes = 0;
  const rows = shows.map(sh => {
    const aired = airedEpisodes(sh).length;
    eps += sh.watchedCount; minutes += sh.watchedCount * sh.runtime;
    return { sh, aired };
  }).sort((a, b) => b.sh.lastWatchedAt - a.sh.lastWatchedAt);
  const seen = movies.filter(m => m.status === 'watched').sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
  minutes += seen.reduce((t, m) => t + (m.runtime || 0), 0);
  const commonShows = shows.filter(s => state.shows[s.id]).length;
  const commonMovies = seen.filter(m => state.movies[m.id]?.status === 'watched').length;
  const isSelf = u.id === me.id;

  return `${backBtn()}
    <div class="pad uhead">
      ${avatar(u, 'lg')}
      <div class="min0"><h1>${esc(u.name)}</h1><div class="muted">@${esc(u.username)}</div></div>
    </div>
    ${isSelf ? '' : `<div class="pad"><button class="btn small" data-act="user-addgroup" data-id="${u.id}" data-name="${esc(u.name)}">${ICON.plus} Ajouter à un groupe</button></div>`}
    <div class="pad">
      <div class="stats">
        <div class="stat"><b>${eps.toLocaleString('fr-FR')}</b><span>épisodes vus</span></div>
        <div class="stat"><b>${fmtDuration(minutes)}</b><span>devant l’écran</span></div>
        <div class="stat"><b>${seen.length}</b><span>films vus</span></div>
        ${isSelf ? '' : `<div class="stat"><b>${commonShows + commonMovies}</b><span>en commun avec toi</span></div>`}
      </div>
      ${rows.length ? `<h2>Séries <small>${rows.length}</small></h2><div class="grid">${rows.slice(0, 24).map(({ sh, aired }) => showTile(sh, sh.watchedCount, aired)).join('')}</div>` : ''}
      ${seen.length ? `<h2>Films vus <small>${seen.length}</small></h2><div class="grid">${seen.slice(0, 24).map(movieTile).join('')}</div>` : ''}
      ${reviews.length ? `<h2>Avis</h2>${reviews.map(rv => {
        const href = rv.kind === 'movie' ? `#/movie/${rv.id}` : rv.kind === 'ep' ? `#/ep/${rv.id}/${rv.s}/${rv.e}` : `#/tv/${rv.id}`;
        return `<a class="review" href="${href}"><div class="review-head"><b>${esc(rv.title.name)}${rv.kind === 'ep' ? ' · ' + code(rv.s, rv.e) : ''}</b>${stars(rv.rating)}<span class="muted">${timeAgo(rv.at)}</span></div>${rv.text ? `<p>${esc(rv.text)}</p>` : ''}</a>`;
      }).join('')}` : ''}
      ${!rows.length && !seen.length && !reviews.length ? `<div class="empty"><p>${esc(u.name)} n’a encore rien ajouté.</p></div>` : ''}
    </div>`;
}

/* ================= Mon profil ================= */
// Profil de l'administrateur : un message affiché une seule fois aux membres déjà inscrits.
function adminHTML() {
  const r = useData('/api/admin/announcement', 30e3);
  const a = r.data?.announcement;
  const cur = r.loading ? spinner() : a ? `<div class="panel gap-top ann-cur">
      <div class="muted small">Message en cours · envoyé ${esc(new Date(a.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</div>
      <b>${esc(a.title)}</b>
      <p>${esc(a.text)}</p>
      <div class="row"><span class="muted small grow">Vu par ${a.seen}/${a.total}</span>
        <button class="btn small danger" data-act="ann-remove">${ui.confirm === 'ann-remove' ? 'Sûr ? Retirer' : 'Retirer'}</button></div>
    </div>` : '';
  return `<h2>Admin</h2>
    ${adminAccountsHTML()}
    <form class="panel" id="annForm">
      <p class="muted small">Ce message s’affiche une seule fois, à la prochaine ouverture de l’appli, chez tous les membres déjà inscrits. Un nouveau message remplace l’ancien.</p>
      <div class="field"><label for="ann-title">Titre</label><input class="input" id="ann-title" name="title" maxlength="80" required></div>
      <div class="field"><label for="ann-text">Message</label><textarea class="input" id="ann-text" name="text" maxlength="1000" rows="4" required></textarea></div>
      <div class="row"><button class="btn small primary" type="submit">Envoyer à tout le monde</button></div>
    </form>
    ${cur}`;
}

// Identifiants oubliés : les demandes reçues, puis tous les membres (avec leur adresse) pour un nouveau mot de passe.
function adminAccountsHTML() {
  const r = useData('/api/admin/accounts', 30e3);
  if (!r.data) return r.loading ? spinner() : '';
  const { requests, members } = r.data, byId = Object.fromEntries(members.map(m => [m.id, m]));
  const resetBtn = m => `<button class="btn small" data-act="admin-reset" data-id="${m.id}" data-name="${esc(m.name)}">🔑 Nouveau mot de passe</button>`;
  const who = m => `${avatar(m, 'sm')}<span class="min0 grow"><b>${esc(m.name)}</b> <span class="muted small">@${esc(m.username)}</span>
    <span class="muted small acc-mail">${m.email ? esc(m.email) : 'pas d’adresse mail'}</span></span>`;
  const reqs = requests.map(q => `<div class="panel acc-req">
      <div class="muted small">🔑 Demande du ${esc(new Date(q.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))} · <b>${esc(q.email)}</b></div>
      ${q.users.length ? q.users.map(id => `<div class="acc-row">${who(byId[id])}${resetBtn(byId[id])}</div>`).join('')
        : '<p class="muted small">Aucun compte avec cette adresse. Si tu sais de qui il s’agit, retrouve-le dans la liste des membres ci-dessous.</p>'}
      <div class="row"><button class="btn small" data-act="admin-dismiss" data-id="${q.id}">Ignorer la demande</button></div>
    </div>`).join('');
  const open = !!ui.expanded.adminMembers, noMail = members.filter(m => !m.email).length;
  return `${reqs}
    <button type="button" class="panel duels-toggle acc-toggle ${open ? 'is-open' : ''}" data-act="expand" data-key="adminMembers" aria-expanded="${open}">
      <span class="min0 grow"><b>👥 Membres et identifiants</b> <span class="muted small">${members.length} membres${noMail ? ` · ${noMail} sans adresse mail` : ''}</span></span>${ICON.chevron}</button>
    ${open ? `<div class="panel acc-list">${members.map(m => `<div class="acc-row">${who(m)}${resetBtn(m)}</div>`).join('')}</div>` : ''}`;
}

/* ----- notifications sur le téléphone ----- */
const NOTIF_TYPES = [
  ['episodes', '📺 Nouvel épisode', 'le matin, quand un épisode d’une série que tu suis sort'],
  ['recos', '💡 Conseils', 'quand un ami conseille une série ou un film'],
  ['replies', '💬 Réponses', 'quand quelqu’un répond à un de tes avis'],
  ['reactions', '😂 Réactions', 'quand quelqu’un réagit à ton activité'],
  ['games', '🏆 Jeux', 'quand quelqu’un bat ton score à un quiz'],
  ['quiz', '🎯 Quiz du jour', 'le matin, tant que tu n’as pas fait le quiz du jour'],
];
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function deviceSub() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.pushManager.getSubscription() || null;
}
// Ce téléphone est-il abonné ? (vérifié une fois, puis tenu à jour par les boutons)
function checkDeviceSub() {
  if (ui.pushOn !== undefined || !pushSupported()) return;
  ui.pushOn = null;
  deviceSub().then(sub => {
    ui.pushOn = !!sub;
    // On redonne l'abonnement au serveur (il a pu changer, ou un autre compte a été utilisé sur ce téléphone).
    if (sub) post('/api/push/subscribe', sub.toJSON()).catch(() => {});
    rerender();
  }, () => { ui.pushOn = false; rerender(); });
}

async function enablePush() {
  if (await Notification.requestPermission() !== 'granted') { rerender(); return false; }
  const { key } = await load('/api/push', 0);
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  await post('/api/push/subscribe', sub.toJSON());
  ui.pushOn = true; invalidate('/api/push');
  toast('Notifications activées 🔔');
  rerender();
  return true;
}
// Peut-on proposer les notifications ? (jamais demandées sur ce téléphone, pas encore abonné, pas repoussé récemment)
function canAskPush() {
  if (!me || !pushSupported() || Notification.permission !== 'default') return false;
  checkDeviceSub();
  return ui.pushOn === false;
}
const PUSH_LATER = 'sequence.pushLater';
// Encart pour ceux qui n'ont pas encore donné d'adresse mail (remplace celui des notifications tant qu'il est là).
const MAIL_BANNER_LATER = 'w2w.mailBannerLater';
function mailInviteHTML() {
  if (!me || me.email || Date.now() < (LS.get(MAIL_BANNER_LATER) || 0)) return '';
  return `<div class="push-invite mail-invite">
    <span class="push-bell" aria-hidden="true">📧</span>
    <div class="min0"><b>Ajoute ton adresse mail</b>
      <div class="muted small">Elle sert uniquement si tu perds ton pseudo ou ton mot de passe : l’administrateur pourra te retrouver et te redonner l’accès à ton compte. Personne d’autre ne la voit, et tu ne recevras aucun e-mail.</div>
      <form id="mailInviteForm" class="mail-invite-form" novalidate>
        <input class="input" name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" placeholder="ton@adresse.fr" aria-label="Adresse mail" required>
        ${ui.mailInviteMsg ? `<div class="err small">${esc(ui.mailInviteMsg)}</div>` : ''}
        <div class="row"><button class="btn small primary" type="submit">Enregistrer</button><button type="button" class="btn small" data-act="mail-later">Plus tard</button></div>
      </form>
    </div>
  </div>`;
}

function pushInviteHTML() {
  if (!canAskPush() || Date.now() < (LS.get(PUSH_LATER) || 0)) return '';
  return `<div class="push-invite">
    <span class="push-bell" aria-hidden="true">🔔</span>
    <div class="min0"><b>Ne rate plus aucun épisode</b>
      <div class="muted small">Active les notifications : on te prévient quand un nouvel épisode sort ou quand quelqu’un répond à tes avis.</div>
      <div class="row"><button class="btn small primary" data-act="push-invite-on">Activer</button><button class="btn small" data-act="push-later">Plus tard</button></div>
    </div>
  </div>`;
}

function notifHTML() {
  let body;
  if (!pushSupported()) {
    body = isIOS() && !isInstalled()
      ? `<p>Sur iPhone, les notifications marchent seulement avec l’appli installée : dans Safari, bouton Partager, puis <b>Sur l’écran d’accueil</b>. Ouvre ensuite what2watch depuis l’icône et reviens ici.</p>`
      : `<p class="muted">Ce navigateur ne sait pas recevoir de notifications.</p>`;
  } else if (Notification.permission === 'denied') {
    body = `<p>Les notifications sont bloquées pour what2watch. Autorise-les dans les réglages de ton téléphone (ou du navigateur), puis reviens ici.</p>`;
  } else {
    checkDeviceSub();
    if (ui.pushOn === null) body = spinner();
    else if (!ui.pushOn) {
      body = `<p>Reçois un petit message sur ce téléphone quand un épisode sort, qu’un ami te conseille un titre, ou qu’on réagit à ce que tu fais.</p>
        <div class="row"><button class="btn small primary" data-act="push-on">Activer les notifications</button></div>`;
    } else {
      const r = useData('/api/push', 60e3);
      const prefs = r.data?.prefs || {};
      body = `<div class="toggles">${NOTIF_TYPES.map(([k, label, hint]) =>
          `<button type="button" class="toggle" data-act="notif-pref" data-k="${k}" aria-pressed="${prefs[k] !== false}">
            <span class="min0"><b>${label}</b><span class="muted small">${hint}</span></span><i></i></button>`).join('')}</div>
        <div class="row gap-top"><button class="btn small" data-act="push-test">Envoyer un test</button><button class="btn small" data-act="push-off">Couper sur ce téléphone</button></div>`;
    }
  }
  return `<h2>Notifications</h2><div class="panel">${body}</div>`;
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

  const stats = `<div class="stats gap-top">
      <div class="stat wide"><b>${fmtDuration(tvMin + mvMin)}</b><span>passés devant l’écran</span></div>
      <div class="stat"><b>${eps.toLocaleString('fr-FR')}</b><span>épisodes vus</span></div>
      <div class="stat"><b>${fmtDuration(tvMin)}</b><span>de séries</span></div>
      <div class="stat"><b>${shows.length}</b><span>séries suivies · ${finished} terminées</span></div>
      <div class="stat"><b>${month}</b><span>épisodes ce mois-ci</span></div>
      <div class="stat"><b>${seen.length}</b><span>films vus</span></div>
      <div class="stat"><b>${fmtDuration(mvMin)}</b><span>de films</span></div>
    </div>
    ${queue.length ? `<p class="muted gap-top">${plural(queue.length, 'modification', 'modifications')} en attente d’envoi (pas de connexion au serveur).</p>` : ''}`;

  const settings = `<h2>Apparence</h2>
    ${seg('theme', ui.theme, [['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']])}
    <p class="muted small gap-top">Auto suit le réglage clair ou sombre de ton téléphone.</p>

    ${notifHTML()}

    <h2>Mon avatar</h2>
    <div class="panel">
      <div class="avpick">${AVATARS.map(([emoji, hue], i) =>
        `<button type="button" class="av emoji" style="--h:${hue}" data-act="avatar-preset" data-n="${i}" aria-pressed="${me.avatar === 'e' + i}" aria-label="Avatar ${emoji}">${emoji}</button>`).join('')}</div>
      <div class="row">
        <label class="btn small">${ICON.plus} Ma photo<input type="file" id="avatarFile" accept="image/*" hidden></label>
        ${me.avatar ? `<button type="button" class="btn small" data-act="avatar-clear">Revenir à mon initiale</button>` : ''}
      </div>
    </div>

    <h2>Mon compte</h2>
    <form class="panel" id="nameForm">
      <div class="field"><label for="acc-name">Nom affiché <span class="opt">(ton pseudo de connexion reste @${esc(me.username)})</span></label><input class="input" id="acc-name" name="name" maxlength="40" value="${esc(me.name)}"></div>
      <div class="row"><button class="btn small" type="submit">Enregistrer le nom</button></div>
    </form>
    <form class="panel gap-top" id="mailForm">
      <div class="field"><label for="acc-mail">Adresse mail</label><input class="input" id="acc-mail" name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" value="${esc(me.email || '')}" placeholder="ton@adresse.fr">
        <p class="muted small field-help">🔒 ${EMAIL_WHY}</p></div>
      <div class="row"><button class="btn small" type="submit">Enregistrer l’adresse</button></div>
    </form>
    <form class="panel gap-top" id="passForm">
      <div class="field"><label for="acc-cur">Mot de passe actuel</label><input class="input" id="acc-cur" name="current" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="acc-new">Nouveau mot de passe</label><input class="input" id="acc-new" name="next" type="password" autocomplete="new-password"></div>
      <div class="row"><button class="btn small" type="submit">Changer le mot de passe</button></div>
    </form>
    ${ui.accountMsg ? `<p class="${ui.accountMsg.startsWith('✓') ? 'ok' : 'err'} gap-top">${esc(ui.accountMsg)}</p>` : ''}

    <h2>Inviter des amis</h2>
    <div class="panel">
      <p>Pour que tes amis voient ton activité, invite-les dans un de tes groupes : onglet Amis, puis Groupes.</p>
      <div class="row"><a class="btn small" href="#/amis" data-act="go-groups">Mes groupes</a><button class="btn small" data-act="share-app">Partager l’adresse de l’appli</button></div>
    </div>
    ${me.admin ? adminHTML() : ''}
    <div class="row gap-top"><button class="btn danger" data-act="logout">Me déconnecter</button></div>`;

  return `<div class="pad">
    <header class="top"><h1>Profil</h1></header>
    ${installBlock()}
    <a class="person me-row" href="#/user/${me.id}"><div class="person-link">${avatar(me)}<div class="min0"><b>${esc(me.name)}</b><div class="muted small">@${esc(me.username)} · voir mon profil comme mes amis</div></div></div></a>
    ${tabs('profTab', ui.profTab, [['settings', 'Réglages'], ['stats', 'Statistiques']])}
    ${ui.profTab === 'stats' ? stats : settings}

    <div class="sig">${LOGO}<span class="wordmark">${WORDMARK}</span></div>
    <p class="fine">Données et images fournies par <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. Cette application utilise l’API TMDB sans être approuvée ni certifiée par TMDB.</p>
  </div>`;
}

/* ================= Routeur et rendu ================= */
const main = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const scrollMemo = {};
let navDepth = 0;
let deferredRender = false;

function route() {
  let [, name = 'collection', ...rest] = (location.hash || '#/collection').split('/');
  // Anciennes adresses (avant l'onglet Collection).
  if (name === 'series' || name === 'films') {
    ui.collTab = name === 'films' ? 'movie' : 'tv'; name = 'collection';
    history.replaceState(null, '', '#/collection');
  }
  if (name === 'amis' && rest[0] === 'jeux') {
    ui.amisTab = 'games'; rest = [];
    history.replaceState(null, '', '#/amis');
  }
  return { name, args: rest.map(Number) };
}

/* ================= Animations ================= */
// Toutes discrètes et courtes ; coupées si le téléphone demande de réduire les animations.
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Rejoue une animation CSS (classe) sur un élément.
function replay(el, cls) {
  if (!el || calm()) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}
// Comme replay, mais l'animation survit aux redessins des secondes suivantes (données rechargées) : elle reprend là où elle en était.
let flashes = [];
function flash(sel, cls, dur = 1000) {
  if (calm()) return;
  flashes.push({ sel, cls, t0: Date.now(), dur });
  for (const el of document.querySelectorAll(sel)) replay(el, cls);
}
function keepFlashes() {
  const now = Date.now();
  flashes = flashes.filter(f => now - f.t0 < f.dur);
  for (const f of flashes) for (const el of main.querySelectorAll(f.sel)) {
    el.style.setProperty('--ad', -(now - f.t0) + 'ms');
    el.classList.add(f.cls);
    el.addEventListener('animationend', () => el.classList.remove(f.cls), { once: true });
  }
}

// Arrivée d'une page : glisse depuis la droite (on avance), la gauche (on revient) ou fondu (onglet).
function pageIn(cls) {
  if (calm()) return;
  main.classList.remove('nav-push', 'nav-pop', 'nav-fade'); void main.offsetWidth;
  main.classList.add(cls);
}
main.addEventListener('animationend', ev => { if (ev.target === main) main.classList.remove('nav-push', 'nav-pop', 'nav-fade'); });

// Listes : les éléments arrivent en cascade la première fois qu'une liste s'affiche sur la page (pas à chaque mise à jour).
const LISTS = '.wlist, .grid, .feed, .gcards, .rlist, .people, .stats, .rail:not(.skel), .reply-list';
let seenLists = new Set(), seenRoute = '';
function cascadeLists() {
  if (seenRoute !== location.hash) { seenRoute = location.hash; seenLists = new Set(); }
  const count = {};
  for (const el of main.querySelectorAll(LISTS)) {
    const k = el.classList[0], sig = k + (count[k] = (count[k] || 0) + 1);
    if (seenLists.has(sig)) continue;
    seenLists.add(sig);
    if (!calm()) el.classList.add('cascade');
  }
}

// Barres de progression : avancent depuis leur ancienne valeur.
function growBars(before) {
  if (calm()) return;
  const now = main.querySelectorAll('.bar i');
  if (now.length !== before.length) return;
  now.forEach((b, i) => {
    if (before[i] && b.style.width !== before[i]) b.animate([{ width: before[i] }, { width: b.style.width }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

// Onglets de section : le trait glisse vers l'onglet choisi, le contenu arrive du bon côté.
function slideTabs(name, from) {
  const t = main.querySelector(`[data-tabs="${name}"]`);
  if (!t || calm()) return;
  const to = Number(t.style.getPropertyValue('--i'));
  if (from === to) return;
  t.style.setProperty('--i', from); void t.offsetWidth;
  t.classList.add('moving'); t.style.setProperty('--i', to);
  for (let n = t.nextElementSibling; n; n = n.nextElementSibling) replay(n, to > from ? 'from-right' : 'from-left');
}

// Un élément qui disparaît se replie au lieu de s'effacer d'un coup.
async function collapse(el) {
  if (!el || calm()) return;
  const h = el.offsetHeight;
  el.style.overflow = 'hidden';
  const a = el.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }],
    { duration: 240, easing: 'ease-in', fill: 'forwards' });
  // Écran en arrière-plan : l'animation peut rester figée, on n'attend pas plus longtemps qu'elle.
  await Promise.race([a.finished.catch(() => {}), new Promise(r => setTimeout(r, 300))]);
}

// Confettis qui jaillissent d'un point de l'écran.
function confetti(x, y, n = 28) {
  if (calm()) return;
  const colors = ['#FFB547', '#FF9A2A', '#FF4F8B', '#6B4BFF', '#3DD68C', '#4FB3FF'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};${i % 3 ? '' : 'border-radius:50%;'}`;
    document.body.append(p);
    const a = -Math.PI / 2 + (Math.random() - .5) * 2.4, v = 120 + Math.random() * 170, r = (Math.random() - .5) * 900;
    const dx = Math.cos(a) * v, dy = Math.sin(a) * v;
    p.animate([
      { transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${dx * .85}px,${dy * .85}px) rotate(${r / 2}deg)`, opacity: 1, offset: .4 },
      { transform: `translate(${dx}px,${dy + 300}px) rotate(${r}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.15,.7,.4,1)' }).finished.then(() => p.remove(), () => p.remove());
  }
}
function confettiFrom(sel) {
  const el = document.querySelector(sel), q = el?.getBoundingClientRect();
  if (q && q.bottom > 0 && q.top < innerHeight) confetti(q.left + q.width / 2, q.top + q.height / 2);
  else confetti(innerWidth / 2, innerHeight / 2);
}

// Saison finie, série finie ou rattrapée : on fête ça.
function doneState(id, s) {
  const sh = state.shows[id];
  if (!sh) return {};
  const p = progress(sh), se = sh.seasons.find(x => x.n === s);
  let season = false;
  if (se && isAired(sh, s, se.c)) { season = true; for (let e = 1; e <= se.c; e++) if (!sh.watched[epKey(s, e)]) { season = false; break; } }
  return { season, all: p.aired > 0 && !p.left, ended: sh.status === 'Ended' || sh.status === 'Canceled', name: sh.name };
}
function celebrate(before, after, s, sel) {
  if (after.all && !before.all) {
    confettiFrom(sel); setTimeout(() => confetti(innerWidth / 2, innerHeight * .4, 36), 250);
    toast(after.ended ? `${after.name} : série terminée ! 🏆` : `Tu es à jour sur ${after.name} ! 🎉`);
    return true;
  }
  if (after.season && !before.season) { confettiFrom(sel); toast(`Saison ${s} terminée ! 🎉`); return true; }
  return false;
}

// Ouverture de l'appli : l'intro de la vidéo (logo, nom, slogan) joue une fois. Un tap la passe.
// Pas après le rechargement d'une mise à jour.
let afterUpdate = false;
try { afterUpdate = sessionStorage.getItem('w2w.updated') === '1'; sessionStorage.removeItem('w2w.updated'); } catch (e) { /* stockage bloqué */ }
if (!calm() && !afterUpdate) {
  const sp = document.createElement('div');
  sp.id = 'splash';
  const pop = (txt, i, cls = '') => `<span class="sp-w ${cls}" style="--i:${i}">${txt}</span>`;
  sp.innerHTML = `<div class="sp-in">${LOGO}
      <div class="sp-name">${pop('what', 0)}${pop('2', 1, 'two')}${pop('watch', 2)}</div>
      <div class="sp-tag">${'Tes séries. Tes films. Tes potes.'.split(' ').map((w, i) => pop(w, i, i % 2 ? 'hl' : '')).join(' ')}</div>
    </div>`;
  document.body.append(sp);
  const end = () => { sp.classList.add('out'); setTimeout(() => sp.remove(), 450); };
  const timer = setTimeout(end, 2000);
  sp.addEventListener('click', () => { clearTimeout(timer); end(); }, { once: true });
}

function render() {
  if (!me) {
    main.innerHTML = viewAuth();
    tabbar.hidden = true;
    return;
  }
  const r = route();
  // Pendant un quiz, la barre du bas disparaît : tout l'écran sert aux réponses.
  tabbar.hidden = r.name === 'quiz';
  document.body.classList.toggle('focus-mode', r.name === 'quiz');
  // Sur Découvrir, on ne remplace que les résultats pour garder le clavier ouvert.
  if (r.name === 'decouvrir' && document.getElementById('q')) {
    document.getElementById('results').innerHTML = resultsHTML();
    document.getElementById('advBtn').outerHTML = advBtnHTML();
    cascadeLists();
    return;
  }
  const focusId = document.activeElement?.id;
  let html;
  switch (r.name) {
    case 'tv': html = viewTv(r.args[0]); break;
    case 'ep': html = viewEp(r.args[0], r.args[1], r.args[2]); break;
    case 'movie': html = viewMovie(r.args[0]); break;
    case 'suggestions': html = viewSuggestions(); break;
    case 'amis': html = viewAmis(); break;
    case 'user': html = viewUser(r.args[0]); break;
    case 'decouvrir': html = viewDiscover(); break;
    case 'profil': html = viewProfile(); break;
    case 'quiz': html = viewQuiz(); break;
    default: html = viewCollection();
  }
  main.innerHTML = html;
  cascadeLists();
  keepFlashes();
  if (focusId) document.getElementById(focusId)?.focus();
  const tab = { tv: 'collection', ep: 'collection', movie: 'collection', user: 'amis', quiz: 'amis' }[r.name] || r.name;
  for (const a of tabbar.querySelectorAll('a')) {
    const on = a.dataset.tab === tab;
    if (on && !a.classList.contains('active') && tabbar.querySelector('a.active')) replay(a.querySelector('svg'), 'bounce');
    a.classList.toggle('active', on);
  }
  fillTitles();
  // Arrivée depuis le crayon d'une affiche : dès que le champ d'avis est affiché, on s'y place.
  if (ui.goReview) {
    const t = document.getElementById(ui.goReview);
    if (t) {
      ui.goReview = null;
      setTimeout(() => { t.scrollIntoView({ block: 'center' }); t.focus({ preventScroll: true }); }, 0);
    }
  }
  // Les suggestions sont « vues » une fois la liste chargée, pour garder la mention Nouveau pendant cette visite.
  if (r.name === 'suggestions' && badges.recos && mem.has('/api/recos')) markRecosSeen();
}

// Ne redessine pas sous les doigts de quelqu'un qui écrit : on attend qu'il quitte le champ.
function rerender() {
  const a = document.activeElement;
  if (a && main.contains(a) && a.matches('textarea, input:not([type=search])')) { deferredRender = true; return; }
  const y = scrollY;
  // Garde la hauteur de la page pendant que les images se réaffichent, sinon le navigateur remonte en haut.
  main.style.minHeight = main.offsetHeight + 'px';
  const bars = [...main.querySelectorAll('.bar i')].map(b => b.style.width);
  render();
  scrollTo(0, y);
  growBars(bars);
  clearTimeout(rerender.release);
  rerender.release = setTimeout(() => { main.style.minHeight = ''; }, 800);
}
document.addEventListener('focusout', () => {
  if (!deferredRender) return;
  setTimeout(() => {
    const a = document.activeElement;
    if (a && main.contains(a) && a.matches('textarea, input:not([type=search])')) return;
    deferredRender = false; rerender();
  }, 0);
});

let currentHash = location.hash;
addEventListener('hashchange', () => {
  if (catchInvite()) { render(); handleInvite(); return; }
  scrollMemo[currentHash] = scrollY;
  // Plus profond (fiche, épisode) : glisse depuis la droite ; retour en arrière : depuis la gauche ; autre onglet : fondu.
  const part = h => h.split('/')[1] || 'collection';
  const depth = h => ({ tv: 1, movie: 1, user: 1, quiz: 1, ep: 2 })[part(h)] || 0;
  const tabOf = h => ({ tv: 'collection', ep: 'collection', movie: 'collection', user: 'amis', quiz: 'amis' })[part(h)] || part(h);
  let move = depth(location.hash) - depth(currentHash);
  if (move < 0 && !depth(location.hash) && tabOf(location.hash) !== tabOf(currentHash)) move = 0;
  // Fiche série ouverte : saisons repliées, sauf en revenant d'un de ses épisodes.
  const to = /^#\/tv\/(\d+)/.exec(location.hash);
  if (to && !currentHash.startsWith(`#/ep/${to[1]}/`)) delete ui.openSeasons[to[1]];
  currentHash = location.hash;
  navDepth++;
  ui.confirm = null;
  deferredRender = false;
  main.style.minHeight = '';   // nouvelle page : pas de hauteur gardée de la précédente
  main.innerHTML = '';
  render();
  pageIn(move > 0 ? 'nav-push' : move < 0 ? 'nav-pop' : 'nav-fade');
  const r = route();
  const detail = ['tv', 'ep', 'movie', 'user'].includes(r.name);
  scrollTo(0, detail ? 0 : (scrollMemo[location.hash] || 0));
});

function updateBadge() {
  const n = badges.recos || 0;
  const el = document.getElementById('sugBadge');
  if (n > (updateBadge.last || 0) && updateBadge.last !== undefined) replay(el, 'pop');
  updateBadge.last = n;
  el.textContent = n > 9 ? '9+' : String(n);
  el.hidden = !n;
  // Amis : défis à relever, plus le quiz du jour s'il n'est pas encore fait.
  const d = (badges.duels || 0) + (badges.quiz || 0), ad = document.getElementById('amisBadge');
  if (d > (updateBadge.lastDuels || 0) && updateBadge.lastDuels !== undefined) replay(ad, 'pop');
  updateBadge.lastDuels = d;
  ad.textContent = d > 9 ? '9+' : String(d);
  ad.hidden = !d;
}

// Défi reçu : une fenêtre à l'ouverture de l'appli, une seule fois par défi (la pastille reste jusqu'à ce qu'il soit relevé).
async function showDuels(list) {
  if (!me || !list?.length) return;
  const key = 'w2w.duelsShown.' + me.id, shown = new Set(LS.get(key) || []);
  const fresh = list.filter(c => !shown.has(c.id));
  if (!fresh.length || showDuels.busy) return;
  showDuels.busy = true;
  try {
    while (askEl.open) await new Promise(done => askEl.addEventListener('close', done, { once: true }));
    if (location.hash === '#/quiz') return;
    const c = fresh[0];
    for (const x of fresh) shown.add(x.id);
    LS.set(key, [...shown].slice(-50));
    const more = fresh.length - 1;
    const go = await ask({
      title: `⚔️ ${c.from} te défie !`,
      text: `Quiz ${c.title}\nScore à battre : ${c.correct}/${c.total} · ${fmtPts(c.score)}${more ? `\n\n+ ${more > 1 ? `${more} autres défis` : 'un autre défi'} t’attend${more > 1 ? 'ent' : ''} dans Amis → Jeux.` : ''}`,
      yes: 'Relever le défi', no: 'Plus tard',
    });
    if (go) startQuiz({ mode: 'free', challenge: c.id });
  } finally { showDuels.busy = false; }
}
async function markRecosSeen() {
  badges.recos = 0; updateBadge();
  try { await post('/api/recos/seen'); } catch (e) { /* sans gravité */ }
}

async function setPick(kind, id, on) {
  await post(on ? '/api/recos' : '/api/recos/remove', { kind, id: Number(id) });
  invalidate('/api/recos'); rerender();
}

// Demande s'il faut aussi cocher les épisodes non vus avant S{s}E{e} (toutes saisons confondues).
// Renvoie true si la question a été posée.
async function offerEarlier(id, sh, s, e, title, no) {
  const before = airedEpisodes(sh).filter(([a, b]) => (a < s || (a === s && b < e)) && !sh.watched[epKey(a, b)]);
  if (!before.length) return false;
  const n = before.length;
  const yes = await ask({
    title,
    text: n === 1
      ? `Marquer aussi l’épisode précédent (${code(...before[0])}) comme vu ?`
      : `Marquer aussi les ${n} épisodes précédents comme vus ? (de ${code(...before[0])} à ${code(...before[n - 1])})`,
    yes: n === 1 ? 'Oui, le marquer' : `Oui, marquer les ${n}`,
    no,
  });
  if (yes) { setEps(id, before, true); rerender(); toast(n === 1 ? 'Épisode précédent marqué comme vu' : `${n} épisodes marqués comme vus`); }
  return true;
}

async function saveAvatar(body, msg) {
  try {
    const r = await post('/api/me/avatar', body);
    me = { ...me, ...r.user }; LS.set('sequence.me', me);
    // Les listes d'amis, le fil et les suggestions contiennent les avatars : on les recharge.
    invalidate('/api/friends', '/api/groups', '/api/users/', '/api/feed', '/api/recos', '/api/title/');
    rerender(); toast(msg);
  } catch (e) { fail(e); }
}

/* ================= Recadrage de la photo de profil ================= */
// Ouvre l'écran de recadrage : on déplace la photo au doigt et on zoome (pincer, molette ou curseur).
// Renvoie l'image recadrée en carré de 256 px (JPEG), ou null si on annule.
const cropEl = document.getElementById('crop');
async function cropPhoto(file) {
  const img = await createImageBitmap(file);
  const V = 280;                                   // taille du cadre à l'écran (px CSS)
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cropEl.innerHTML = `<div class="askbox cropbox">
      <h2 id="crop-title">Recadre ta photo</h2>
      <p>Fais glisser pour placer ton visage, pince ou utilise le curseur pour zoomer.</p>
      <div class="cropview"><canvas width="${V * dpr}" height="${V * dpr}"></canvas></div>
      <input type="range" class="cropzoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
      <button type="button" class="btn primary" data-crop="ok">Utiliser cette photo</button>
      <button type="button" class="btn" data-crop="cancel">Annuler</button>
    </div>`;
  const canvas = cropEl.querySelector('canvas'), ctx = canvas.getContext('2d');
  const zoomInput = cropEl.querySelector('.cropzoom');
  const cover = V / Math.min(img.width, img.height);  // zoom 1 = la photo remplit juste le cadre
  let zoom = 1, x = 0, y = 0;                          // x, y : coin haut-gauche de la photo dans le cadre

  const clamp = () => {
    const w = img.width * cover * zoom, h = img.height * cover * zoom;
    x = Math.min(0, Math.max(V - w, x));
    y = Math.min(0, Math.max(V - h, y));
  };
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, V, V);
    ctx.drawImage(img, x, y, img.width * cover * zoom, img.height * cover * zoom);
  };
  // Zoome en gardant fixe le point (cx, cy) du cadre.
  const setZoom = (z, cx = V / 2, cy = V / 2) => {
    z = Math.min(4, Math.max(1, z));
    const k = z / zoom;
    x = cx - (cx - x) * k; y = cy - (cy - y) * k;
    zoom = z; zoomInput.value = z;
    clamp(); draw();
  };
  x = (V - img.width * cover) / 2; y = (V - img.height * cover) / 2;
  clamp(); draw();

  const pts = new Map();
  let pinch = null;
  const local = ev => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * V / r.width, (ev.clientY - r.top) * V / r.height]; };
  canvas.addEventListener('pointerdown', ev => { canvas.setPointerCapture(ev.pointerId); pts.set(ev.pointerId, local(ev)); pinch = null; });
  canvas.addEventListener('pointermove', ev => {
    if (!pts.has(ev.pointerId)) return;
    const prev = pts.get(ev.pointerId), cur = local(ev);
    pts.set(ev.pointerId, cur);
    if (pts.size === 1) { x += cur[0] - prev[0]; y += cur[1] - prev[1]; clamp(); draw(); return; }
    const [a, b] = [...pts.values()];
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) setZoom(pinch.zoom * dist / pinch.dist, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    else pinch = { dist, zoom };
  });
  const up = ev => { pts.delete(ev.pointerId); pinch = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', ev => { ev.preventDefault(); const [cx, cy] = local(ev); setZoom(zoom * Math.exp(-ev.deltaY / 400), cx, cy); }, { passive: false });
  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));

  cropEl.returnValue = '';
  cropEl.showModal();
  const ok = await new Promise(done => {
    cropEl.onclick = ev => {
      const b = ev.target.closest('[data-crop]');
      if (b) cropEl.close(b.dataset.crop); else if (ev.target === cropEl) cropEl.close();
    };
    cropEl.addEventListener('close', () => done(cropEl.returnValue === 'ok'), { once: true });
  });
  if (!ok) { img.close?.(); return null; }
  // Partie de la photo visible dans le cadre, en pixels de la photo d'origine.
  const k = cover * zoom, out = document.createElement('canvas');
  out.width = out.height = 256;
  out.getContext('2d').drawImage(img, -x / k, -y / k, V / k, V / k, 0, 0, 256, 256);
  img.close?.();
  return out.toDataURL('image/jpeg', 0.85);
}
document.addEventListener('change', async ev => {
  if (ev.target.id !== 'avatarFile') return;
  const file = ev.target.files?.[0];
  ev.target.value = '';   // pour pouvoir rechoisir la même photo ensuite
  if (!file) return;
  let photo;
  try { photo = await cropPhoto(file); }
  catch (e) { return toast('Impossible de lire cette image. Essaie une photo JPEG ou PNG.'); }
  if (photo) await saveAvatar({ photo }, 'Photo de profil enregistrée');
});

/* ================= Installation sur l'écran d'accueil ================= */
// Android et Chrome proposent l'installation eux-mêmes (en https seulement) ; sur iPhone, il faut passer par Safari.
let installPrompt = null;
addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installPrompt = ev; rerender(); });
addEventListener('appinstalled', () => { installPrompt = null; rerender(); toast('what2watch est installée sur ton écran d’accueil'); });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installBlock() {
  if (isInstalled()) return '';
  return `<div class="install">
    ${LOGO}
    <div class="min0"><b>Installe what2watch</b><div class="muted small">Pour l’ouvrir depuis ton écran d’accueil, comme une vraie appli.</div></div>
    <button class="btn small primary" data-act="install">Installer</button>
  </div>`;
}

async function installApp() {
  if (installPrompt) {
    const p = installPrompt; installPrompt = null;
    await p.prompt();
    rerender();
    return;
  }
  const text = isIOS()
    ? 'Dans Safari, touche le bouton Partager (le carré avec une flèche vers le haut), puis « Sur l’écran d’accueil » et « Ajouter ».'
    : 'Ouvre le menu de ton navigateur (⋮ en haut à droite dans Chrome), puis choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».';
  await ask({ title: 'Installer what2watch', text, yes: 'Compris' });
}

/* ================= Thème clair / sombre ================= */
// 'auto' suit le téléphone ; 'light' ou 'dark' l'impose (choix gardé sur cet appareil).
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  try { if (t === 'auto') localStorage.removeItem('w2w.theme'); else localStorage.setItem('w2w.theme', t); } catch (e) { /* stockage bloqué */ }
  LS.set('w2w.theme.ui', t);
  const dark = t === 'dark' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0F1116' : '#F3F4F7';
}
applyTheme(ui.theme);
// Changement de thème : le nouveau se répand en cercle depuis le bouton touché.
function switchTheme(v, el) {
  ui.theme = v;
  const go = () => { applyTheme(v); render(); };
  if (!document.startViewTransition || calm()) return go();
  const q = el.getBoundingClientRect(), root = document.documentElement.style;
  root.setProperty('--vt-x', q.left + q.width / 2 + 'px'); root.setProperty('--vt-y', q.top + q.height / 2 + 'px');
  document.startViewTransition(go);
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (ui.theme === 'auto') applyTheme('auto'); });

// Rangées qui défilent sur le côté : plus de fondu à droite une fois arrivé au bout.
document.addEventListener('scroll', ev => {
  const r = ev.target;
  if (r.classList?.contains('rail')) r.classList.toggle('end', r.scrollLeft + r.clientWidth >= r.scrollWidth - 4);
}, true);

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

/* ================= Question oui / non ================= */
const askEl = document.getElementById('ask');
// Affiche une question en bas de l'écran et renvoie true (oui) ou false (non, ou fermée).
function ask({ title, text, yes, no }) {
  hideToast();
  askEl.innerHTML = `<div class="askbox">
      <h2 id="ask-title">${esc(title)}</h2>
      <p>${esc(text)}</p>
      <button type="button" class="btn primary" data-answer="yes">${esc(yes)}</button>
      ${no ? `<button type="button" class="btn" data-answer="no">${esc(no)}</button>` : ''}
    </div>`;
  askEl.returnValue = '';
  askEl.showModal();
  return new Promise(done => askEl.addEventListener('close', () => done(askEl.returnValue === 'yes'), { once: true }));
}
// Un bouton donne la réponse ; toucher en dehors de la carte ferme la question (= non).
askEl.addEventListener('click', ev => {
  const b = ev.target.closest('[data-answer]');
  if (b) askEl.close(b.dataset.answer);
  else if (ev.target === askEl) askEl.close();
});

function armConfirm(key) {
  ui.confirm = key;
  setTimeout(() => { if (ui.confirm === key) { ui.confirm = null; rerender(); } }, 4000);
}
const fail = err => toast(err.message || 'Une erreur est survenue.');

/* ================= Actions ================= */
const actions = {
  seg({ name, v }, el) {
    if (name === 'theme') return switchTheme(v, el);
    if (name === 'rankTab') { ui.rankTab = v; return rerender(); }
    const from = Number(main.querySelector(`[data-tabs="${name}"]`)?.style.getPropertyValue('--i'));
    ui[name] = v;
    if (name === 'authMode') ui.authMsg = '';
    render(); scrollTo(0, 0);
    slideTabs(name, from);
  },

  back() { if (navDepth > 0) history.back(); else location.hash = '#/collection'; },

  retry() { errors.clear(); main.innerHTML = ''; render(); },

  expand({ key }) { ui.expanded[key] = !ui.expanded[key]; rerender(); },

  next({ id }) {
    const sh = state.shows[id];
    const n = progress(sh).next;
    if (!n) return;
    const before = doneState(id, n.s);
    setEps(id, [[n.s, n.e]], true); rerender();
    flash(`.checkbtn[data-id="${id}"]`, 'just');
    if (celebrate(before, doneState(id, n.s), n.s, `.checkbtn[data-id="${id}"]`)) return;
    toast(`${sh.name} · ${code(n.s, n.e)} vu`, { label: 'Annuler', run() { setEps(id, [[n.s, n.e]], false); rerender(); } });
  },

  async track({ id }) {
    try { const sh = await trackShow(id); rerender(); replay(main.querySelector('.progress'), 'glow'); toast(`${sh.name} ajoutée à tes séries`); }
    catch (e) { fail(e); }
  },

  untrack({ id }) {
    if (ui.confirm !== 'untrack:' + id) { armConfirm('untrack:' + id); rerender(); return; }
    const name = state.shows[id]?.name;
    commit({ op: 'show.untrack', id: Number(id) });
    ui.confirm = null; rerender();
    toast(`${name} retirée`);
  },

  archive({ id }) {
    const sh = state.shows[id];
    commit({ op: 'show.archive', id: Number(id), on: !sh.archived }); rerender();
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
    let sh;
    try { sh = await trackShow(id); } catch (err) { return fail(err); }
    const on = !sh.watched[epKey(s, e)];
    const sel = `.tick[data-act="ep"][data-s="${s}"][data-e="${e}"]`;
    let before = doneState(id, s);
    setEps(id, [[s, e]], on); rerender();
    if (!on) return;
    flash(sel, 'just');
    celebrate(before, doneState(id, s), s, sel);
    before = doneState(id, s);
    if (await offerEarlier(id, sh, s, e, `Tu as vu ${code(s, e)}`, `Non, juste ${code(s, e)}`)) celebrate(before, doneState(id, s), s, sel);
  },

  async ['season-all']({ id, n }) {
    n = Number(n);
    let sh;
    try { sh = await trackShow(id); } catch (err) { return fail(err); }
    const se = sh.seasons.find(x => x.n === n);
    if (!se) return;
    const list = [];
    for (let e = 1; e <= se.c; e++) if (isAired(sh, n, e)) list.push([n, e]);
    const allSeen = list.every(([a, b]) => sh.watched[epKey(a, b)]);
    const sel = `.tick[data-act="season-all"][data-n="${n}"]`;
    let before = doneState(id, n);
    setEps(id, list, !allSeen); rerender();
    if (allSeen) return toast(`Saison ${n} décochée`);
    flash(sel, 'just');
    const party = celebrate(before, doneState(id, n), n, sel);
    before = doneState(id, n);
    const earlier = await offerEarlier(id, sh, n, 1, `Saison ${n} vue`, `Non, juste la saison ${n}`);
    if (earlier) celebrate(before, doneState(id, n), n, sel);
    else if (!party) toast(`Saison ${n} marquée comme vue`);
  },

  // Le + s'ouvre sur deux choix : « À voir » ou « J'ai vu ».
  quickadd({ type, id }) {
    if (isAdded(type, Number(id))) { location.hash = `#/${type}/${id}`; return; }
    const k = `${type}:${id}`;
    ui.addOpen = ui.addOpen === k ? null : k;
    rerender();
  },
  noop() {},
  async ['quickadd-as']({ type, id, st }, el) {
    id = Number(id);
    for (const b of el.parentElement.querySelectorAll('button')) b.disabled = true;
    try {
      if (type === 'movie') {
        const m = await addMovie(id, st);
        toast(st === 'watched' ? `${m.title} marqué comme vu` : `${m.title} ajouté à ta liste « À voir »`);
      } else {
        const sh = await trackShow(id);
        if (st === 'watched') {
          // Tous les épisodes déjà sortis sont cochés ; « Annuler » les décoche (la série reste suivie).
          const list = airedEpisodes(sh).filter(([s, e]) => !sh.watched[epKey(s, e)]);
          setEps(id, list, true);
          toast(`${sh.name} marquée comme vue (${plural(list.length, 'épisode', 'épisodes')})`, { label: 'Annuler', run: () => { setEps(id, list, false); rerender(); } });
        } else toast(`${sh.name} ajoutée à tes séries à voir`);
      }
    } catch (e) { fail(e); }
    ui.addOpen = null;
    rerender();
  },

  async ['m-list']({ id }) {
    const m = state.movies[id];
    if (m?.status === 'watchlist') { commit({ op: 'movie.set', id: Number(id), status: null }); rerender(); toast('Retiré de ta liste'); return; }
    try { await addMovie(id, 'watchlist'); rerender(); flash(`[data-act="m-list"][data-id="${id}"]`, 'done'); toast('Ajouté à ta liste « À voir »'); } catch (e) { fail(e); }
  },

  async ['m-seen']({ id }) {
    const m = state.movies[id];
    if (m?.status === 'watched') {
      commit({ op: 'movie.set', id: Number(id), status: null }); rerender();
      toast('Film retiré des films vus');
      return;
    }
    try { await addMovie(id, 'watched'); rerender(); flash(`[data-act="m-seen"][data-id="${id}"]`, 'done'); toast('Film marqué comme vu'); } catch (e) { fail(e); }
  },

  /* ----- avis ----- */
  // Met à jour les étoiles sur place, sans redessiner la fiche (sinon la page saute sur téléphone).
  star({ dk, n }, el) {
    n = Number(n);
    const d = ui.drafts[dk] || (ui.drafts[dk] = { rating: null, text: '' });
    d.rating = d.rating === n ? null : n;
    const box = el.closest('.composer');
    for (const b of box.querySelectorAll('.star-btn')) {
      const k = Number(b.dataset.n);
      b.classList.toggle('on', d.rating >= k);
      b.setAttribute('aria-pressed', String(d.rating === k));
    }
    box.querySelector('[data-act="review-save"]').disabled = !(d.rating || d.text.trim());
    for (const b of box.querySelectorAll('.star-btn.on')) { b.style.animationDelay = (b.dataset.n - 1) * 45 + 'ms'; replay(b, 'pop'); }
  },
  /* ----- réponses aux avis ----- */
  ['quiz-start']({ mode, kind, id, challenge }, el) {
    el.disabled = true;
    startQuiz(mode === 'daily' ? { mode } : challenge ? { mode, challenge: Number(challenge) } : { mode, kind, id: Number(id) });
  },
  ['duel-pick']({ kind, id, name }) { sendDuel(kind, id, name); },
  // « Qui connaît le mieux » sur un titre pas encore vu : on le marque vu, puis la partie démarre.
  async ['king-seen']({ kind, id, name }, el) {
    const tv = kind === 'tv';
    if (!await ask({
      title: tv ? 'Tu as vu cette série ?' : 'Tu as vu ce film ?',
      text: tv ? `Tous les épisodes déjà sortis de « ${name} » seront cochés comme vus, puis le quiz se lance.` : `« ${name} » sera marqué comme vu, puis le quiz se lance.`,
      yes: 'Oui, marquer et jouer', no: 'Annuler',
    })) return;
    el.disabled = true;
    try {
      if (tv) {
        const sh = await trackShow(id);
        setEps(id, airedEpisodes(sh).filter(([s, e]) => !sh.watched[epKey(s, e)]), true);
      } else await addMovie(id, 'watched');
      await syncNow();
    } catch (e) { el.disabled = false; return fail(e); }
    startQuiz({ mode: 'free', kind, id: Number(id) });
  },
  ['quiz-pick']({ c }) { quizAnswer(Number(c)); },
  ['quiz-again']() { const { mode, kind, id } = ui.quiz.body; startQuiz({ mode, kind, id }); },
  async ['quiz-quit']() {
    const Q = ui.quiz;
    if (Q && !Q.result && Q.q && !await ask({ title: 'Quitter le quiz ?', text: Q.body.mode === 'daily' ? 'Le chrono continue : les questions non répondues compteront comme ratées.' : 'Ta partie s’arrête ici.', yes: 'Quitter', no: 'Continuer' })) return;
    clearTimeout(quizTimer); ui.quiz = null;
    ui.amisTab = 'games'; location.hash = '#/amis';
  },
  ['go-games']() { clearTimeout(quizTimer); ui.quiz = null; ui.amisTab = 'games'; location.hash = '#/amis'; },
  ['cal-jump']() {
    const line = document.querySelector('.nowline');
    if (line) scrollTo({ top: line.getBoundingClientRect().top + scrollY - 12, behavior: calm() ? 'auto' : 'smooth' });
  },
  ['react-pick']({ k }) { ui.reactOpen = ui.reactOpen === k ? null : k; rerender(); },
  async react({ k, e }) {
    if (pressedLong) return;
    ui.reactOpen = null;
    setFeedReactions(k, rs => {
      const out = {}, wasMine = rs[e]?.includes(me.id);
      for (const [x, ids] of Object.entries(rs)) { const left = ids.filter(id => id !== me.id); if (left.length) out[x] = left; }
      if (!wasMine) (out[e] ||= []).push(me.id);
      return out;
    });
    rerender();
    replay(document.querySelector(`.rchip.mine[data-k="${CSS.escape(k)}"][data-e="${e}"]`), 'pop-in');
    try {
      const r = await post('/api/reactions', { item: k, emoji: e });
      setFeedReactions(k, () => r.reactions);
    } catch (err) { invalidate('/api/feed'); fail(err); }
    rerender();
  },
  ['replies-toggle']({ rk }) {
    ui.openReplies.has(rk) ? ui.openReplies.delete(rk) : ui.openReplies.add(rk);
    rerender();
  },
  async ['reply-send']({ rk }, el) {
    const [author, kind, id, s, e] = rk.split(':');
    const text = (ui.replyDrafts[rk] || '').trim();
    if (!text) return;
    el.disabled = true;
    try {
      await post('/api/replies', { author: Number(author), kind, id: Number(id), s: Number(s), e: Number(e), text });
      ui.replyDrafts[rk] = '';
      document.activeElement?.blur();
      invalidate('/api/title/'); rerender();
      // La nouvelle réponse arrive une fois la fiche rechargée.
      const t0 = Date.now(), spot = () => {
        const list = main.querySelector(`[data-rk="${rk}"]`)?.closest('.replies')?.querySelectorAll('.reply');
        if (list?.length && Date.now() - t0 < 3000 && !main.querySelector('.skel')) replay(list[list.length - 1], 'pop-in');
        else if (Date.now() - t0 < 3000) setTimeout(spot, 120);
      };
      setTimeout(spot, 120);
    } catch (err) { el.disabled = false; fail(err); }
  },
  async ['reply-delete']({ rid }, el) {
    try {
      await collapse(el.closest('.reply'));
      await post(`/api/replies/${rid}/delete`); invalidate('/api/title/'); rerender(); toast('Réponse effacée');
    } catch (err) { rerender(); fail(err); }
  },

  // Depuis une affiche : ouvre la fiche directement sur le champ d'avis.
  ['review-open']({ kind, id }) {
    ui.goReview = `rv-${kind}-${id}-0-0`;
    location.hash = `#/${kind}/${id}`;
  },



  ['review-edit']({ dk, url }) {
    const mine = mem.get(url)?.data?.mine;
    ui.drafts[dk] = { rating: mine?.rating || null, text: mine?.text || '' };
    rerender();
  },
  ['review-cancel']({ dk }) { delete ui.drafts[dk]; rerender(); },
  async ['review-save']({ dk, url }, el) {
    const d = ui.drafts[dk] || { rating: null, text: '' };
    const [kind, id, s, e] = dk.split(':');
    el.disabled = true;
    try {
      const res = await post('/api/reviews', { kind, id: Number(id), s: Number(s), e: Number(e), rating: d.rating, text: d.text });
      const hit = mem.get(url);
      if (hit?.data) hit.data.mine = res.mine;
      delete ui.drafts[dk];
      invalidate('/api/feed', '/api/users/', '/api/reviews/mine');
      rerender();
      replay(main.querySelector(`[data-act="review-delete"][data-dk="${dk}"]`)?.closest('.review'), 'glow');
      if (canAskPush()) toast('Avis publié. Être prévenu des réponses ?', { label: 'Activer 🔔', run: () => enablePush().catch(fail) });
      else toast('Avis publié pour tes amis');
    } catch (err) { el.disabled = false; fail(err); }
  },
  async ['review-delete']({ dk, url }, el) {
    const [kind, id, s, e] = dk.split(':');
    try {
      await collapse(el.closest('.review'));
      await post('/api/reviews', { kind, id: Number(id), s: Number(s), e: Number(e), rating: null, text: '' });
      const hit = mem.get(url);
      if (hit?.data) hit.data.mine = null;
      invalidate('/api/feed', '/api/users/', '/api/reviews/mine');
      rerender();
      toast('Avis supprimé');
    } catch (err) { rerender(); fail(err); }
  },

  install() { installApp(); },

  /* ----- avatar ----- */
  async ['avatar-preset']({ n }) { await saveAvatar({ preset: Number(n) }, 'Avatar changé'); },
  async ['avatar-clear']() { await saveAvatar({}, 'Avatar retiré'); },

  /* ----- conseils ----- */
  async ['reco-toggle']({ kind, id }, el) {
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.disabled = true;
    try {
      await setPick(kind, id, on);
      if (on) flash(`[data-act="reco-toggle"][data-id="${id}"]`, 'done');
      toast(on ? 'Ajouté aux suggestions de tous tes amis' : 'Tu ne le conseilles plus',
        on ? { label: 'Annuler', run() { setPick(kind, id, false).catch(fail); } } : undefined);
    } catch (e) { el.disabled = false; fail(e); }
  },
  async ['reco-hide']({ kind, id }) {
    try { await post('/api/recos/hide', { kind, id: Number(id) }); invalidate('/api/recos'); rerender(); toast('Retiré de tes suggestions'); }
    catch (e) { fail(e); }
  },

  /* ----- groupes ----- */
  ['group-pick']({ id }) { setGroup(id === 'all' ? 'all' : Number(id)); if (ui.amisTab === 'groups') ui.amisTab = 'feed'; rerender(); },
  ['go-groups']() { ui.amisTab = 'groups'; location.hash = '#/amis'; },
  ['group-open']({ id }) { setGroup(Number(id)); ui.amisTab = 'friends'; scrollTo(0, 0); rerender(); },
  ['group-new']() { openGroupForm(null); },
  async ['group-edit']({ id }) { openGroupForm((await groupsData()).groups.find(g => g.id === Number(id))); },
  ['grp-close']() { grpEl.close(); },
  ['grp-emoji']({ v }) {
    ui.grpEmoji = v;
    for (const b of grpEl.querySelectorAll('[data-act="grp-emoji"]')) b.setAttribute('aria-pressed', b.dataset.v === v);
  },
  async ['grp-save']({ id }, btn) {
    const name = document.getElementById('grpName').value.trim();
    if (!name) { document.getElementById('grpName').focus(); return toast('Donne un nom au groupe'); }
    btn.disabled = true;
    try {
      const r = await post(id ? `/api/groups/${id}` : '/api/groups', { name, emoji: ui.grpEmoji });
      storeGroups(r);
      if (!id) { setGroup(r.id); ui.amisTab = 'friends'; }
      grpEl.close();
      if (location.hash !== '#/amis') location.hash = '#/amis'; else rerender();
      toast(id ? 'Groupe enregistré' : `Groupe ${ui.grpEmoji} ${name} créé : invite tes amis !`);
    } catch (e) { btn.disabled = false; fail(e); }
  },
  async ['grp-relink']({ id }) {
    grpEl.close();
    if (!await ask({ title: 'Changer le lien ?', text: 'L’ancien lien d’invitation ne marchera plus. Les membres actuels restent dans le groupe.', yes: 'Changer le lien', no: 'Annuler' })) return;
    try { storeGroups(await post(`/api/groups/${id}/relink`)); rerender(); toast('Nouveau lien prêt : touche « Inviter » pour l’envoyer'); }
    catch (e) { fail(e); }
  },
  async ['grp-leave']({ id }) {
    grpEl.close();
    const g = (await groupsData()).groups.find(x => x.id === Number(id));
    if (!g) return;
    const last = g.members.length === 1;
    if (!await ask({ title: `Quitter ${g.emoji} ${g.name} ?`, text: last ? 'Tu es le dernier membre : le groupe sera supprimé.' : 'Tu ne verras plus l’activité de ce groupe. Tu pourras revenir avec un lien d’invitation.', yes: 'Quitter le groupe', no: 'Rester' })) return;
    try {
      const res = await post(`/api/groups/${id}/leave`);
      await collapse(main.querySelector(`[data-act="grp-leave"][data-id="${id}"]`)?.closest('.gcard'));
      storeGroups(res); setGroup('all'); rerender(); toast(`Tu as quitté ${g.name}`);
    }
    catch (e) { fail(e); }
  },
  async ['group-kick']({ g, u }) {
    const key = `gkick:${g}:${u}`;
    if (ui.confirm !== key) { armConfirm(key); return rerender(); }
    ui.confirm = null;
    try { const res = await post(`/api/groups/${g}/remove`, { userId: Number(u) }); await collapse(main.querySelector(`[data-act="group-kick"][data-u="${u}"]`)?.closest('.person')); storeGroups(res); rerender(); }
    catch (e) { fail(e); }
  },
  async ['group-add']({ g, u }, btn) {
    btn.disabled = true;
    try {
      storeGroups(await post(`/api/groups/${g}/add`, { userId: Number(u) }));
      grpEl.close();
      const name = (await groupsData()).groups.find(x => x.id === Number(g))?.name;
      toast(`Ajouté à ${name}`);
      rerender();
    } catch (e) { btn.disabled = false; fail(e); }
  },
  async invite({ id }) {
    grpEl.close();
    let groups;
    try { groups = (await groupsData()).groups; } catch (e) { return fail(e); }
    const g = groups.find(x => x.id === Number(id));
    if (g) return shareInvite(g);
    if (!groups.length) return openGroupForm(null);
    if (groups.length === 1) return shareInvite(groups[0]);
    openGroupPicker('Inviter dans quel groupe ?', 'Le lien fera entrer ton ami directement dans ce groupe.', groups, 'invite');
  },
  async ['user-addgroup']({ id, name }) {
    let groups;
    try { groups = (await groupsData()).groups; } catch (e) { return fail(e); }
    const free = groups.filter(g => !g.members.includes(Number(id)));
    if (!groups.length) return openGroupForm(null);
    if (!free.length) return toast(`${name} est déjà dans tous tes groupes`);
    openGroupPicker(`Ajouter ${name} à…`, '', free, 'group-add', `data-u="${id}"`);
  },

  /* ----- recherche avancée ----- */
  ['adv-open']() { openFilters(); },
  ['adv-close']() { filtersEl.close(); },
  ['adv-set']({ k, v }) {
    const f = ui.advDraft;
    if (k === 'kind') {
      if (f.kind === v) return;
      // Les genres et plateformes ne sont pas les mêmes pour les films et les séries.
      Object.assign(f, { kind: v, genres: [], dur: '', providers: [] });
      loadSheetLists(v);
    } else if (k === 'period') {
      const [a, b] = v.split('-');
      const on = f.from === a && f.to === b;
      f.from = on ? '' : a; f.to = on ? '' : b;
    } else if (k === 'sort') f.sort = v;
    else f[k] = f[k] === v ? '' : v;
    renderSheet();
  },
  ['adv-toggle']({ k, v }) {
    const list = ui.advDraft[k], n = Number(v), i = list.indexOf(n);
    if (i < 0) list.push(n); else list.splice(i, 1);
    renderSheet();
  },
  ['adv-person']({ id, name, photo }) { ui.advDraft.person = { id: Number(id), name, photo: photo || null }; renderSheet(); },
  ['adv-noperson']() { ui.advDraft.person = null; renderSheet(); },
  ['adv-reset']() { ui.advDraft = { ...structuredClone(ADV_DEFAULT), kind: ui.advDraft.kind }; renderSheet(); },
  ['adv-apply']() {
    const f = ui.advDraft;
    if (f.from && f.to && Number(f.from) > Number(f.to)) [f.from, f.to] = [f.to, f.from];
    ui.adv = f; ui.advOn = true; ui.advPages = 1; ui.query = '';
    saveAdv();
    filtersEl.close();
    const q = document.getElementById('q');
    if (q) q.value = '';
    scrollTo(0, 0);
    render();
  },
  ['adv-drop']({ k, v }) {
    const f = ui.adv;
    if (k === 'genres' || k === 'providers') f[k] = f[k].filter(x => x !== Number(v));
    else if (k === 'years') f.from = f.to = '';
    else if (k === 'person') f.person = null;
    else if (k === 'rating') f.rating = 0;
    else if (k === 'sort') f.sort = 'popularity.desc';
    else f[k] = '';
    ui.advPages = 1; saveAdv(); render();
  },
  ['adv-clear']() {
    ui.advOn = false; ui.adv = { ...structuredClone(ADV_DEFAULT), kind: ui.adv.kind }; ui.advPages = 1;
    saveAdv(); render();
  },
  ['adv-more']() { ui.advPages++; render(); },

  /* ----- compte ----- */
  async ['push-on'](_, el) {
    el.disabled = true;
    try { await enablePush(); } catch (e) { fail(e); el.disabled = false; }
  },
  async ['push-invite-on'](_, el) {
    el.disabled = true;
    try {
      // Refusé : on ne redemande pas avant un mois.
      if (!await enablePush()) LS.set(PUSH_LATER, Date.now() + 30 * DAY_MS);
    } catch (e) { fail(e); el.disabled = false; }
  },
  ['push-later']() {
    LS.set(PUSH_LATER, Date.now() + 14 * DAY_MS);
    collapse(document.querySelector('.push-invite')).then(rerender);
  },
  async ['push-off']() {
    try {
      const sub = await deviceSub();
      if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      ui.pushOn = false; toast('Notifications coupées sur ce téléphone');
    } catch (e) { fail(e); }
    rerender();
  },
  async ['push-test'](_, el) {
    el.disabled = true;
    try { await post('/api/push/test'); toast('Envoyé : regarde tes notifications'); }
    catch (e) { fail(e); }
    el.disabled = false;
  },
  async ['notif-pref']({ k }, el) {
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', on);
    try { mem.set('/api/push', { t: Date.now(), data: { ...mem.get('/api/push')?.data, ...(await post('/api/push/prefs', { [k]: on })) } }); }
    catch (e) { el.setAttribute('aria-pressed', !on); fail(e); }
  },
  async logout() {
    // Ce téléphone ne doit plus recevoir les notifications de ce compte.
    try {
      const sub = pushSupported() && await deviceSub();
      if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    } catch { /* tant pis */ }
    ui.pushOn = undefined;
    try { await post('/api/logout'); } catch (e) { /* on déconnecte quand même ce téléphone */ }
    LS.del('sequence.state.' + me.id); LS.del('sequence.queue.' + me.id); LS.del('sequence.me');
    me = null; state = { shows: {}, movies: {} }; queue = [];
    mem.clear(); errors.clear();
    ui.authMsg = '';
    location.hash = '#/collection';
    render();
  },
  forgot() { ui.authMode = 'forgot'; ui.authMsg = ''; ui.forgotSent = false; render(); },
  ['mail-later']() {
    LS.set(MAIL_BANNER_LATER, Date.now() + 3 * DAY_MS);
    collapse(document.querySelector('.mail-invite')).then(rerender);
  },
  ['forgot-back']() { ui.authMode = 'login'; ui.authMsg = ''; render(); },
  async ['admin-reset']({ id, name }, el) {
    if (!await ask({ title: `Nouveau mot de passe pour ${name} ?`, text: 'Son mot de passe actuel ne marchera plus et ses appareils seront déconnectés. Tu verras le nouveau mot de passe provisoire pour le lui transmettre.', yes: 'Créer le mot de passe', no: 'Annuler' })) return;
    el.disabled = true;
    try {
      const r = await post('/api/admin/reset', { userId: Number(id) });
      invalidate('/api/admin/accounts'); rerender();
      await ask({ title: `Identifiants de ${r.name}`, text: `Pseudo : ${r.username}\nMot de passe provisoire : ${r.password}\n\nEnvoie-les-lui${r.email ? ` (${r.email})` : ''}. Il pourra changer le mot de passe dans Profil → Mon compte.`, yes: 'C’est noté' });
    } catch (e) { fail(e); el.disabled = false; }
  },
  async ['admin-dismiss']({ id }) {
    try { await post(`/api/admin/reset/${id}/dismiss`, {}); invalidate('/api/admin/accounts'); rerender(); } catch (e) { fail(e); }
  },
  async ['ann-remove']() {
    if (ui.confirm !== 'ann-remove') { armConfirm('ann-remove'); return rerender(); }
    ui.confirm = null;
    try { mem.set('/api/admin/announcement', { t: Date.now(), data: await post('/api/admin/announcement/remove', {}) }); toast('Message retiré'); }
    catch (e) { fail(e); }
    rerender();
  },
  async ['share-app']() {
    const url = location.origin;
    if (navigator.share) {
      try { await navigator.share({ title: 'what2watch', text: 'Rejoins-moi sur what2watch pour suivre nos séries et se conseiller des trucs à regarder :', url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('Adresse copiée'); }
    catch (e) { toast('Copie impossible : sélectionne l’adresse à la main.'); }
  },
};

/* ================= Événements ================= */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { ev.preventDefault(); fn({ ...el.dataset }, el); }
});

// Appui long sur une réaction : qui a réagi.
let pressTimer, pressedLong = false;
document.addEventListener('pointerdown', ev => {
  const chip = ev.target.closest('.rchip[data-who]');
  pressedLong = false;
  if (chip) pressTimer = setTimeout(() => { pressedLong = true; toast(`${chip.dataset.e} ${chip.dataset.who}`); }, 450);
});
for (const t of ['pointerup', 'pointercancel', 'pointermove']) document.addEventListener(t, ev => {
  if (t !== 'pointermove' || Math.abs(ev.movementX) + Math.abs(ev.movementY) > 6) clearTimeout(pressTimer);
});
document.addEventListener('contextmenu', ev => { if (ev.target.closest('.rchip')) ev.preventDefault(); });
// Quiz au doigt : la réponse part dès que le doigt se relève sur le bouton touché.
// Safari sur iPhone ne déclenche pas toujours le « clic » qui suit (appui appuyé, animations en cours).
let quizTouch = null;
document.addEventListener('pointerdown', ev => {
  quizTouch = ev.pointerType !== 'mouse' ? ev.target.closest('.quiz-c') : null;
});
document.addEventListener('pointerup', ev => {
  const b = quizTouch; quizTouch = null;
  if (b && !b.disabled && b === ev.target.closest('.quiz-c')) quizAnswer(Number(b.dataset.c));
});
document.addEventListener('pointercancel', () => { quizTouch = null; });
// Un appui ailleurs referme le choix d'emoji.
document.addEventListener('click', ev => {
  if (ui.reactOpen && !ev.target.closest('.reacts')) { ui.reactOpen = null; rerender(); }
  if (ui.addOpen && !ev.target.closest('[data-act^="quickadd"], .addchoice')) { ui.addOpen = null; rerender(); }
});

let searchTimer;
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'q') {
    ui.query = t.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 350);
    return;
  }
  if (t.id === 'advFrom' || t.id === 'advTo') {
    const f = ui.advDraft;
    f[t.id === 'advFrom' ? 'from' : 'to'] = /^\d{4}$/.test(t.value) ? t.value : '';
    for (const b of filtersEl.querySelectorAll('[data-k="period"]')) b.setAttribute('aria-pressed', b.dataset.v === `${f.from}-${f.to}`);
    return;
  }
  if (t.id === 'advRate') {
    ui.advDraft.rating = Number(t.value);
    document.getElementById('advRateTxt').textContent = ui.advDraft.rating ? `★ ${fmtScore(ui.advDraft.rating)}+` : 'Toutes';
    return;
  }
  if (t.id === 'advPerson') return searchPeople(t.value);
  if (t.id === 'memberQ') return searchMembers(t.value);
  const rk = t.dataset.reply;
  if (rk) {
    ui.replyDrafts[rk] = t.value;
    const btn = t.closest('.reply-box')?.querySelector('[data-act="reply-send"]');
    if (btn) btn.disabled = !t.value.trim();
    return;
  }
  const dk = t.dataset.draft;
  if (dk) {
    const d = ui.drafts[dk] || (ui.drafts[dk] = { rating: null, text: '' });
    const was = !!(d.rating || d.text.trim());
    d.text = t.value;
    // Active le bouton Publier sans redessiner (le clavier reste ouvert).
    if (was !== !!(d.rating || d.text.trim())) {
      const btn = t.closest('.composer')?.querySelector('[data-act="review-save"]');
      if (btn) btn.disabled = !(d.rating || d.text.trim());
    }
  }
});

document.addEventListener('keydown', ev => {
  if (ev.target.id === 'q' && ev.key === 'Enter') { ev.target.blur(); clearTimeout(searchTimer); render(); }
});

document.addEventListener('submit', async ev => {
  const f = ev.target;
  ev.preventDefault();
  if (f.id === 'authForm') return submitAuth(f);
  if (f.id === 'nameForm') {
    try {
      const r = await post('/api/me', { name: f.elements.name.value });
      me = r.user; LS.set('sequence.me', me);
      ui.accountMsg = '✓ Nom enregistré.';
    } catch (e) { ui.accountMsg = e.message; }
    document.activeElement?.blur(); rerender();
  }
  if (f.id === 'annForm') {
    const title = f.elements.title.value, text = f.elements.text.value;
    if (!await ask({ title: 'Envoyer ce message ?', text: 'Tous les membres déjà inscrits le verront une fois, à leur prochaine ouverture de l’appli.', yes: 'Envoyer', no: 'Annuler' })) return;
    try {
      const r = await post('/api/admin/announcement', { title, text });
      mem.set('/api/admin/announcement', { t: Date.now(), data: r });
      f.reset(); toast('Message envoyé');
    } catch (e) { fail(e); }
    document.activeElement?.blur(); rerender();
  }
  if (f.id === 'forgotForm') {
    ui.authMsg = '';
    try { await post('/api/forgot', { email: f.elements.email.value }); ui.forgotSent = true; }
    catch (e) { ui.authMsg = e.message; }
    const keep = f.elements.email.value;
    render();
    const inp = document.getElementById('fg-mail'); if (inp) inp.value = keep;
  }
  if (f.id === 'mailInviteForm') {
    const val = f.elements.email.value;
    try {
      const r = await post('/api/me/email', { email: val });
      if (!r.user.email) throw new Error('Entre ton adresse mail.');
      me = { ...me, email: r.user.email }; LS.set('sequence.me', me);
      ui.mailInviteMsg = '';
      document.activeElement?.blur();
      toast('✓ Adresse mail enregistrée, merci !');
      await collapse(f.closest('.mail-invite'));
      rerender();
    } catch (e) {
      ui.mailInviteMsg = e.message; rerender();
      const i = document.querySelector('#mailInviteForm input'); if (i) i.value = val;
    }
  }
  if (f.id === 'mailForm') {
    try {
      const r = await post('/api/me/email', { email: f.elements.email.value });
      me = { ...me, email: r.user.email }; LS.set('sequence.me', me);
      ui.accountMsg = r.user.email ? '✓ Adresse mail enregistrée.' : '✓ Adresse mail retirée.';
    } catch (e) { ui.accountMsg = e.message; }
    document.activeElement?.blur(); rerender();
  }
  if (f.id === 'passForm') {
    try {
      await post('/api/me/password', { current: f.elements.current.value, next: f.elements.next.value });
      ui.accountMsg = '✓ Mot de passe changé. Tes autres appareils sont déconnectés.';
    } catch (e) { ui.accountMsg = e.message; }
    document.activeElement?.blur(); rerender();
  }
});

// Revient sur l'appli : récupère ce qui a changé (autre téléphone, amis).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // L'appli reste souvent ouverte en arrière-plan sur le téléphone : on regarde s'il y a une nouvelle version.
  navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => {});
  if (!me) return;
  invalidate('/api/feed', '/api/recos', '/api/friends', '/api/groups', '/api/title/');
  refreshMe();
});
addEventListener('online', () => flushSoon(0));

/* ================= Démarrage ================= */
catchInvite();
if (me) { loadLocal(); refreshMe(); updateBadge(); setTimeout(handleInvite, 300); }
else {
  // Vérifie si une session existe déjà (cookie) avant d'afficher la connexion.
  get('/api/me').then(r => { me = r.user; badges = r.badges; LS.set('sequence.me', me); loadLocal(); render(); updateBadge(); pull(); handleInvite(); showAnnouncement(r.announcement).then(() => showDuels(r.duels)).then(askEmail); }, () => {});
}
render();
if ('serviceWorker' in navigator) {
  // Nouvelle version installée : on recharge une fois pour l'afficher en entier.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadingForUpdate) return;
    reloadingForUpdate = true;
    try { sessionStorage.setItem('w2w.updated', '1'); } catch (e) { /* stockage bloqué */ }
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', e => { if (typeof e.data?.go === 'string' && e.data.go.startsWith('#/')) location.hash = e.data.go; });
  navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(() => {});
}
var reloadingForUpdate = false;
