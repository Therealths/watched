'use strict';
// Serveur what2watch : sert l'appli, stocke les comptes et les données, relaie TMDB.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb } = require('./db');
const { initPush } = require('./push');
const { createQuiz } = require('./quiz');
const { cleanLang, lang, withLang, tr, num, loc, errorText } = require('./i18n');

const ROOT = path.resolve(__dirname, '..');
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TMDB_KEY = (process.env.TMDB_KEY || '').trim();
const TMDB_BASE = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const db = openDb(DATA_DIR);
const push = initPush(DATA_DIR, process.env.PUSH_SUBJECT || 'mailto:what2watch@users.noreply.github.com');

const DAY = 86400e3;
const SESSION_MAX_AGE = 365 * DAY;
const META_MAX_AGE = 6 * 3600e3;

if (!TMDB_KEY) console.warn('⚠ TMDB_KEY absent du fichier .env : la recherche et les fiches ne marcheront pas.');

function loadEnv(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/* ================= TMDB ================= */
const tmdbCache = new Map(); // url -> { t, data }

async function tmdb(p, params = {}, maxAge = 10 * 60e3) {
  const url = new URL(TMDB_BASE + p);
  url.searchParams.set('language', 'fr-FR');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (TMDB_KEY.length > 40) headers.authorization = 'Bearer ' + TMDB_KEY;
  else url.searchParams.set('api_key', TMDB_KEY);
  const key = url.toString();
  const hit = tmdbCache.get(key);
  if (hit && Date.now() - hit.t < maxAge) return hit.data;
  const r = await fetch(url, { headers });
  if (!r.ok) throw httpError(r.status === 404 ? 404 : 502, r.status === 404 ? 'Introuvable sur TMDB.' : 'TMDB ne répond pas.');
  const data = await r.json();
  tmdbCache.set(key, { t: Date.now(), data });
  if (tmdbCache.size > 2000) tmdbCache.delete(tmdbCache.keys().next().value);
  return data;
}

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
    id: d.id, title: d.title,
    poster: d.poster_path || null, backdrop: d.backdrop_path || null,
    year: (d.release_date || '').slice(0, 4), runtime: d.runtime || 0,
    release: frRelease(d) || d.release_date || null,
  };
}
// Date de sortie en France (cinéma, sinon numérique), d'après release_dates si TMDB l'a fourni.
function frRelease(d) {
  const fr = d.release_dates?.results?.find(r => r.iso_3166_1 === 'FR')?.release_dates || [];
  const pick = fr.find(r => r.type === 3) || fr.find(r => r.type === 2) || fr.find(r => r.type === 4) || fr[0];
  return pick?.release_date?.slice(0, 10) || null;
}

const getTitle = db.prepare('SELECT meta, updated_at FROM titles WHERE kind = ? AND id = ?');
const putTitle = db.prepare(`INSERT INTO titles (kind, id, meta, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (kind, id) DO UPDATE SET meta = excluded.meta, updated_at = excluded.updated_at`);

async function ensureTitle(kind, id, maxAge = Infinity) {
  const row = getTitle.get(kind, id);
  if (row && Date.now() - row.updated_at < maxAge) return JSON.parse(row.meta);
  try {
    const d = await tmdb(`/${kind}/${id}`, kind === 'movie' ? { append_to_response: 'release_dates' } : {}, 0);
    const meta = kind === 'tv' ? slimShow(d) : slimMovie(d);
    meta.en = await englishNames(kind, id).catch(() => row && JSON.parse(row.meta).en) || null;
    putTitle.run(kind, id, JSON.stringify(meta), Date.now());
    return meta;
  } catch (e) {
    if (row) return JSON.parse(row.meta);
    throw e;
  }
}

// Noms en anglais (titre, prochain et dernier épisode), pour les membres qui ont choisi l'anglais.
async function englishNames(kind, id) {
  const d = await tmdb(`/${kind}/${id}`, { language: 'en-US' }, 0);
  return kind === 'tv' ? { name: d.name, last: d.last_episode_to_air?.name || '', next: d.next_episode_to_air?.name || '' } : { title: d.title };
}
// Fiche dans la langue de la requête en cours.
function locMeta(m) {
  if (!m) return m;
  const { en, ...rest } = m;
  if (lang() !== 'en' || !en) return rest;
  if (rest.title !== undefined && en.title) rest.title = en.title;
  if (rest.name !== undefined && en.name) rest.name = en.name;
  if (rest.last && en.last) rest.last = { ...rest.last, name: en.last };
  if (rest.next && en.next) rest.next = { ...rest.next, name: en.next };
  return rest;
}
// Titres enregistrés avant l'arrivée de l'anglais : on va chercher leurs noms anglais, doucement.
async function backfillEnglish() {
  for (const r of db.prepare('SELECT kind, id, meta FROM titles').all()) {
    const m = JSON.parse(r.meta);
    if ('en' in m) continue;
    try { m.en = await englishNames(r.kind, r.id); } catch { continue; }
    db.prepare('UPDATE titles SET meta = ? WHERE kind = ? AND id = ?').run(JSON.stringify(m), r.kind, r.id);
    await new Promise(res => setTimeout(res, 250));
  }
}

// Remet à jour les séries suivies (nouveaux épisodes, dates de diffusion).
async function refreshTitles() {
  const rows = db.prepare(`SELECT DISTINCT us.show_id id FROM user_shows us
    LEFT JOIN titles t ON t.kind = 'tv' AND t.id = us.show_id
    WHERE us.archived = 0 AND (t.updated_at IS NULL OR t.updated_at < ?)`).all(Date.now() - META_MAX_AGE);
  for (const { id } of rows) {
    try { await ensureTitle('tv', id, 0); } catch { /* prochain passage */ }
    await new Promise(r => setTimeout(r, 300));
  }
  // Films « à voir » pas encore sortis (ou sans date connue) : leur date de sortie peut changer.
  const today = new Date().toISOString().slice(0, 10);
  const movies = db.prepare(`SELECT DISTINCT um.movie_id id, t.meta FROM user_movies um
    LEFT JOIN titles t ON t.kind = 'movie' AND t.id = um.movie_id
    WHERE um.status = 'watchlist' AND (t.updated_at IS NULL OR t.updated_at < ?)`).all(Date.now() - META_MAX_AGE);
  for (const { id, meta } of movies) {
    const m = meta ? JSON.parse(meta) : null;
    if (m && 'release' in m && m.release && m.release < today) continue;
    try { await ensureTitle('movie', id, 0); } catch { /* prochain passage */ }
    await new Promise(r => setTimeout(r, 300));
  }
  await sendEpisodeAlerts();
}

/* ================= Comptes et sessions ================= */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, seen_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now);
  setCookie(res, req, token, SESSION_MAX_AGE / 1000);
}
function setCookie(res, req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
function readSid(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? m[1] : null;
}
function sessionUser(req) {
  const sid = readSid(req);
  if (!sid) return null;
  const row = db.prepare(`SELECT s.token, s.seen_at, u.id, u.username, u.name, u.avatar, u.email, u.created_at, u.lang FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(sha256(sid));
  if (!row) return null;
  if (Date.now() - row.seen_at > SESSION_MAX_AGE) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(row.token);
    return null;
  }
  if (Date.now() - row.seen_at > DAY) db.prepare('UPDATE sessions SET seen_at = ? WHERE token = ?').run(Date.now(), row.token);
  return { id: row.id, username: row.username, name: row.name, avatar: row.avatar, email: row.email, created_at: row.created_at, lang: row.lang || 'fr', token: row.token };
}

// Limite les tentatives (connexion, inscription) par adresse IP.
const attempts = new Map();
function rateLimit(key, max, windowMs, msg = 'Trop de tentatives. Réessaie dans quelques minutes.') {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) throw httpError(429, msg);
  list.push(now);
  attempts.set(key, list);
}
// Derrière Tailscale Funnel, toutes les requêtes arrivent de 127.0.0.1 : la vraie adresse du visiteur est
// la dernière de X-Forwarded-For (ajoutée par le proxy). Sans ça, tout le monde partagerait la même limite d'essais.
function clientIp(req) {
  const ra = req.socket.remoteAddress || '';
  if (!/^(127\.|::1$|::ffff:127\.)/.test(ra)) return ra;
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return fwd.at(-1) || req.headers['cf-connecting-ip'] || ra;
}

/* ================= Membres ================= */
// Avis, suggestions et fiches : tout le monde voit tout le monde.
const FRIEND_IDS_SQL = `SELECT id FROM users WHERE id != :u`;
// Fil d'activité : seulement les membres de mes groupes (ou d'un seul groupe, :g).
const GROUP_MATES_SQL = `SELECT b.user_id FROM group_members a JOIN group_members b ON b.group_id = a.group_id
  WHERE a.user_id = :u AND b.user_id != :u`;
const ONE_GROUP_SQL = `SELECT user_id FROM group_members WHERE group_id = :g AND user_id != :u`;
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatar || null });
// L'administrateur est le premier inscrit (le créateur de l'appli).
const isAdmin = u => u.id === db.prepare('SELECT MIN(id) id FROM users').get().id;

function usersById(ids) {
  const out = {};
  const stmt = db.prepare('SELECT id, username, name, avatar FROM users WHERE id = ?');
  for (const id of new Set(ids)) { const u = stmt.get(id); if (u) out[id] = publicUser(u); }
  return out;
}
function titleMeta(kind, id) {
  const row = getTitle.get(kind === 'ep' ? 'tv' : kind, id);
  return row ? locMeta(JSON.parse(row.meta)) : null;
}
function brief(kind, id) {
  const m = titleMeta(kind, id);
  return m ? { id: m.id, name: m.name || m.title, poster: m.poster, year: m.year } : { id, name: '', poster: null };
}

/* ================= Données d'un utilisateur ================= */
function userState(uid) {
  const shows = {};
  for (const r of db.prepare(`SELECT us.show_id, us.added_at, us.archived, t.meta, t.updated_at FROM user_shows us
      JOIN titles t ON t.kind = 'tv' AND t.id = us.show_id WHERE us.user_id = ?`).all(uid)) {
    shows[r.show_id] = { ...locMeta(JSON.parse(r.meta)), addedAt: r.added_at, archived: !!r.archived, updatedAt: r.updated_at, watched: {} };
  }
  for (const w of db.prepare('SELECT show_id, s, e, at FROM watched WHERE user_id = ?').all(uid)) {
    if (shows[w.show_id]) shows[w.show_id].watched[w.s + 'x' + w.e] = w.at;
  }
  const movies = {};
  for (const r of db.prepare(`SELECT um.*, t.meta FROM user_movies um
      JOIN titles t ON t.kind = 'movie' AND t.id = um.movie_id WHERE um.user_id = ?`).all(uid)) {
    movies[r.movie_id] = { ...locMeta(JSON.parse(r.meta)), status: r.status, addedAt: r.added_at, watchedAt: r.watched_at };
  }
  return { shows, movies };
}

const int = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1e9) throw httpError(400, `Valeur invalide : ${name}.`);
  return n;
};
const stamp = v => (Number.isFinite(v) && v > 0 && v <= Date.now() + DAY) ? Math.round(v) : Date.now();

// Applique une modification envoyée par l'appli (aussi celles faites hors connexion).
async function applyOp(uid, op) {
  const id = int(op.id, 'id');
  switch (op.op) {
    case 'show.track': {
      await ensureTitle('tv', id, META_MAX_AGE);
      db.prepare('INSERT OR IGNORE INTO user_shows (user_id, show_id, added_at) VALUES (?, ?, ?)').run(uid, id, stamp(op.at));
      break;
    }
    case 'show.untrack':
      db.prepare('DELETE FROM user_shows WHERE user_id = ? AND show_id = ?').run(uid, id);
      db.prepare('DELETE FROM watched WHERE user_id = ? AND show_id = ?').run(uid, id);
      break;
    case 'show.archive':
      db.prepare('UPDATE user_shows SET archived = ? WHERE user_id = ? AND show_id = ?').run(op.on ? 1 : 0, uid, id);
      break;
    case 'eps': {
      const list = Array.isArray(op.list) ? op.list.slice(0, 5000) : [];
      if (op.on) await applyOp(uid, { op: 'show.track', id, at: op.at });
      const ins = db.prepare('INSERT OR IGNORE INTO watched (user_id, show_id, s, e, at) VALUES (?, ?, ?, ?, ?)');
      const del = db.prepare('DELETE FROM watched WHERE user_id = ? AND show_id = ? AND s = ? AND e = ?');
      const at = stamp(op.at);
      db.exec('BEGIN');
      try {
        for (const [s, e] of list) {
          if (op.on) ins.run(uid, id, int(s, 's'), int(e, 'e'), at);
          else del.run(uid, id, int(s, 's'), int(e, 'e'));
        }
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      break;
    }
    case 'movie.set': {
      if (op.status === null) {
        db.prepare('DELETE FROM user_movies WHERE user_id = ? AND movie_id = ?').run(uid, id);
        break;
      }
      if (op.status !== 'watchlist' && op.status !== 'watched') throw httpError(400, 'Statut de film invalide.');
      await ensureTitle('movie', id, META_MAX_AGE);
      const at = stamp(op.at);
      db.prepare(`INSERT INTO user_movies (user_id, movie_id, status, added_at, watched_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id, movie_id) DO UPDATE SET status = excluded.status,
          watched_at = CASE WHEN excluded.status = 'watched' THEN COALESCE(user_movies.watched_at, excluded.watched_at) ELSE NULL END`)
        .run(uid, id, op.status, at, op.status === 'watched' ? at : null);
      break;
    }
    default:
      throw httpError(400, 'Opération inconnue.');
  }
}

/* ================= Routes ================= */
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, auth: opts.auth !== false });

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

const USERNAME_RE = /^[a-z0-9_.-]{3,20}$/;
// Dit précisément ce qui ne va pas dans un pseudo (déjà mis en minuscules), ou null s'il est bon.
function usernameProblem(u) {
  if (!u) return tr('Choisis un pseudo.', 'Choose a username.');
  if (/\s/.test(u)) return tr('Pas d’espace dans le pseudo (tu peux mettre un point ou un _ à la place).', 'No spaces in the username (use a dot or _ instead).');
  if (/[\u00C0-\u024F]/.test(u)) return tr('Pas d’accent dans le pseudo (é → e, ç → c…).', 'No accents in the username (é → e, ç → c…).');
  const bad = [...u].find(c => !/[a-z0-9_.-]/.test(c));
  if (bad) return tr(`Caractère « ${bad} » non autorisé dans le pseudo : seulement lettres, chiffres, point, tiret ou _.`, `The character “${bad}” isn’t allowed in a username: only letters, digits, dot, dash or _.`);
  if (u.length < 3) return tr('Le pseudo doit faire au moins 3 caractères.', 'The username must be at least 3 characters.');
  if (u.length > 20) return tr(`Le pseudo doit faire 20 caractères maximum (il en a ${u.length}).`, `The username must be 20 characters at most (it has ${u.length}).`);
  return null;
}
// Deux membres ne peuvent pas avoir le même nom affiché (sans tenir compte des majuscules, accents et espaces).
const nameKey = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function checkNameFree(name, exceptId = 0) {
  const key = nameKey(name);
  const taken = db.prepare('SELECT name FROM users WHERE id != ?').all(exceptId).some(u => nameKey(u.name) === key);
  if (taken) throw httpError(409, `Le nom « ${name} » est déjà pris par un autre membre. Choisis-en un autre (ajoute ton nom de famille, une initiale…).`);
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
function cleanEmail(v, required) {
  const email = String(v || '').trim().toLowerCase();
  if (!email && !required) return null;
  if (email.length > 120 || !EMAIL_RE.test(email)) throw httpError(400, 'Adresse mail invalide.');
  return email;
}

route('POST', /^\/api\/register$/, async ({ req, res, body }) => {
  rateLimit('reg:' + clientIp(req), 10, 3600e3, 'Trop de tentatives. Réessaie dans une heure.');
  const username = String(body.username || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 40) || username;
  const password = String(body.password || '');
  const email = String(body.email || '').trim().toLowerCase();
  // Tous les problèmes d'un coup, chacun sous son champ.
  const fields = {};
  const userErr = usernameProblem(username);
  if (userErr) fields.username = userErr;
  else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fields.username = tr('Ce pseudo est déjà pris. Choisis-en un autre.', 'This username is already taken. Pick another one.');
  if (!userErr || body.name) { try { checkNameFree(name); } catch (e) { fields[body.name ? 'name' : 'username'] ??= errorText(e.message); } }
  if (!email) fields.email = tr('Indique ton adresse mail.', 'Enter your email address.');
  else if (email.length > 120 || !EMAIL_RE.test(email)) fields.email = tr('Adresse mail invalide (exemple : prenom@gmail.com).', 'Invalid email address (example: name@gmail.com).');
  if (!password) fields.password = tr('Choisis un mot de passe.', 'Choose a password.');
  else if (password.length < 8) fields.password = tr(`Le mot de passe doit faire au moins 8 caractères (il en a ${password.length}).`, `Your password must be at least 8 characters (it has ${password.length}).`);
  if (Object.keys(fields).length) { const e = httpError(400, Object.values(fields)[0]); e.fields = fields; throw e; }
  const lg = cleanLang(body.lang);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (username, name, pass, email, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(username, name, hashPassword(password), email, lg, Date.now());
  // Inscription depuis un lien d'invitation : on entre directement dans le groupe.
  const g = body.invite && groupByInvite(String(body.invite));
  if (g) joinGroup(g.id, Number(lastInsertRowid));
  createSession(res, req, Number(lastInsertRowid));
  return { user: { id: Number(lastInsertRowid), username, name, email, lang: lg } };
}, { auth: false });

route('POST', /^\/api\/login$/, async ({ req, res, body }) => {
  const username = String(body.username || '').trim().toLowerCase();
  rateLimit('login:' + clientIp(req), 20, 15 * 60e3);
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !checkPassword(String(body.password || ''), u.pass)) throw httpError(401, 'Pseudo ou mot de passe incorrect.');
  createSession(res, req, u.id);
  return { user: { ...publicUser(u), email: u.email || null, lang: u.lang } };
}, { auth: false });

// Pseudo ou mot de passe oublié : la demande arrive chez l'administrateur, qui donne un mot de passe provisoire.
// Même réponse que l'adresse soit connue ou non (on ne révèle pas qui est inscrit).
route('POST', /^\/api\/forgot$/, async ({ req, body }) => {
  rateLimit('forgot:' + clientIp(req), 5, 3600e3);
  const email = cleanEmail(body.email, true);
  if (!db.prepare('SELECT 1 FROM reset_requests WHERE email = ? AND done_at IS NULL').get(email)) {
    db.prepare('INSERT INTO reset_requests (email, at) VALUES (?, ?)').run(email, Date.now());
    const admin = db.prepare('SELECT MIN(id) id FROM users').get().id;
    notify(admin, null, null, () => ({ title: tr('🔑 Identifiants oubliés', '🔑 Forgotten login'), body: tr(`Quelqu’un (${email}) demande de l’aide pour se reconnecter.`, `Someone (${email}) needs help signing back in.`), url: '#/profil', tag: 'forgot' }));
  }
  return { ok: true };
}, { auth: false });

route('POST', /^\/api\/logout$/, async ({ req, res, user }) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
  setCookie(res, req, '', 0);
  return { ok: true };
});

route('GET', /^\/api\/me$/, async ({ user }) => {
  const seenAt = db.prepare('SELECT at FROM picks_seen WHERE user_id = ?').get(user.id)?.at || 0;
  const recos = db.prepare(`SELECT COUNT(*) n FROM (${PICKS_FOR_SQL}) WHERE at > ?`).get({ u: user.id }, seenAt).n;
  // Annonce en cours, pas encore vue, et envoyée après l'inscription de ce membre.
  const admin = isAdmin(user);
  const ann = !admin && db.prepare(`SELECT id, title, text FROM announcements a WHERE active = 1 AND created_at > ?
    AND NOT EXISTS (SELECT 1 FROM announcement_seen WHERE ann_id = a.id AND user_id = ?)`).get(user.created_at, user.id);
  // Défis reçus pas encore relevés (pastille sur Amis et fenêtre à l'ouverture, même sans notifications).
  const duels = db.prepare(`SELECT c.id, c.from_id, u.name, c.kind, c.tid, c.score, c.correct, c.total FROM quiz_challenges c
    JOIN users u ON u.id = c.from_id WHERE c.to_id = ? AND c.done_at IS NULL ORDER BY c.created_at DESC LIMIT 10`).all(user.id)
    .map(c => ({ id: c.id, from: c.name, title: brief(c.kind, c.tid).name, score: c.score, correct: c.correct, total: c.total }));
  return { user: { ...publicUser(user), email: user.email || null, lang: user.lang, admin: admin || undefined },
    badges: { requests: 0, recos, duels: duels.length, quiz: playedDaily(user.id, localDay()) ? 0 : 1 }, announcement: ann || null, duels };
});

route('POST', /^\/api\/announcement\/(\d+)\/seen$/, async ({ user, match }) => {
  db.prepare('INSERT OR IGNORE INTO announcement_seen (ann_id, user_id) SELECT id, ? FROM announcements WHERE id = ?').run(user.id, Number(match[1]));
  return { ok: true };
});

/* ----- administration ----- */
function adminOnly(user) { if (!isAdmin(user)) throw httpError(403, 'Réservé à l’administrateur.'); }
function currentAnnouncement() {
  const a = db.prepare('SELECT id, title, text, created_at FROM announcements WHERE active = 1').get();
  if (!a) return { announcement: null };
  // Les destinataires : membres inscrits avant l'envoi, sauf l'administrateur lui-même.
  const total = db.prepare('SELECT COUNT(*) n FROM users WHERE created_at < ? AND id <> (SELECT MIN(id) FROM users)').get(a.created_at).n;
  const seen = db.prepare('SELECT COUNT(*) n FROM announcement_seen s JOIN users u ON u.id = s.user_id WHERE ann_id = ? AND u.id <> (SELECT MIN(id) FROM users)').get(a.id).n;
  return { announcement: { ...a, total, seen } };
}
route('GET', /^\/api\/admin\/announcement$/, async ({ user }) => { adminOnly(user); return currentAnnouncement(); });
route('POST', /^\/api\/admin\/announcement$/, async ({ user, body }) => {
  adminOnly(user);
  const title = String(body.title || '').trim().slice(0, 80), text = String(body.text || '').trim().slice(0, 1000);
  if (!title || !text) throw httpError(400, 'Il faut un titre et un message.');
  db.prepare('UPDATE announcements SET active = 0').run();
  db.prepare('INSERT INTO announcements (title, text, created_at) VALUES (?, ?, ?)').run(title, text, Date.now());
  return currentAnnouncement();
});
// Identifiants oubliés : demandes en attente (avec les comptes liés à l'adresse) et tous les membres.
route('GET', /^\/api\/admin\/accounts$/, async ({ user }) => {
  adminOnly(user);
  const members = db.prepare('SELECT id, username, name, email, avatar FROM users ORDER BY name COLLATE NOCASE').all();
  const requests = db.prepare('SELECT id, email, at FROM reset_requests WHERE done_at IS NULL ORDER BY at DESC').all()
    .map(r => ({ ...r, users: members.filter(m => m.email === r.email).map(m => m.id) }));
  return { requests, members };
});
route('POST', /^\/api\/admin\/reset$/, async ({ user, body }) => {
  adminOnly(user);
  const target = db.prepare('SELECT id, username, name, email FROM users WHERE id = ?').get(int(body.userId, 'userId'));
  if (!target) throw httpError(404, 'Membre introuvable.');
  // Mot de passe provisoire facile à dicter : sans 0/O ni 1/l.
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const temp = Array.from(crypto.randomBytes(10), b => abc[b % abc.length]).join('');
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(temp), target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  if (target.email) db.prepare('UPDATE reset_requests SET done_at = ? WHERE email = ? AND done_at IS NULL').run(Date.now(), target.email);
  return { username: target.username, name: target.name, email: target.email, password: temp };
});
route('POST', /^\/api\/admin\/reset\/(\d+)\/dismiss$/, async ({ user, match }) => {
  adminOnly(user);
  db.prepare('UPDATE reset_requests SET done_at = ? WHERE id = ?').run(Date.now(), Number(match[1]));
  return { ok: true };
});
route('POST', /^\/api\/admin\/announcement\/remove$/, async ({ user }) => {
  adminOnly(user);
  db.prepare('UPDATE announcements SET active = 0').run();
  return { announcement: null };
});

route('POST', /^\/api\/me\/lang$/, async ({ user, body }) => {
  const lg = cleanLang(body.lang);
  db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lg, user.id);
  return { lang: lg };
});

route('POST', /^\/api\/me$/, async ({ user, body }) => {
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) throw httpError(400, 'Le nom ne peut pas être vide.');
  checkNameFree(name, user.id);
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
  return { user: { ...publicUser(user), email: user.email || null, lang: user.lang, name } };
});

route('POST', /^\/api\/me\/email$/, async ({ user, body }) => {
  const email = cleanEmail(body.email, false);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
  return { user: { ...publicUser(user), email } };
});

/* ----- avatar ----- */
const AVATAR_PRESETS = 16;   // doit correspondre à la liste AVATARS de l'appli
const PHOTO_MAX = 400e3;
// Reconnaît le format par les premiers octets plutôt que par ce que l'appli annonce.
function imageMime(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

route('POST', /^\/api\/me\/avatar$/, async ({ user, body }) => {
  let avatar = null;
  if (body.preset != null) {
    const n = int(body.preset, 'preset');
    if (n >= AVATAR_PRESETS) throw httpError(400, 'Avatar inconnu.');
    avatar = 'e' + n;
    db.prepare('DELETE FROM avatar_photos WHERE user_id = ?').run(user.id);
  } else if (body.photo != null) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.photo));
    if (!m) throw httpError(400, 'Image invalide.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > PHOTO_MAX) throw httpError(413, 'Image trop lourde.');
    const mime = imageMime(buf);
    if (!mime) throw httpError(400, 'Image invalide.');
    db.prepare('INSERT INTO avatar_photos (user_id, mime, data) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data')
      .run(user.id, mime, buf);
    avatar = 'p' + Date.now();
  } else {
    db.prepare('DELETE FROM avatar_photos WHERE user_id = ?').run(user.id);
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, user.id);
  return { user: { ...publicUser(user), avatar } };
});

// Photo de profil d'un membre (réservée aux membres connectés). L'adresse change à chaque nouvelle photo, d'où le long cache.
route('GET', /^\/api\/avatar\/(\d+)$/, async ({ res, match }) => {
  const row = db.prepare('SELECT mime, data FROM avatar_photos WHERE user_id = ?').get(Number(match[1]));
  if (!row) throw httpError(404, 'Pas de photo.');
  res.writeHead(200, { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable', 'content-length': row.data.length });
  res.end(Buffer.from(row.data));
});

route('POST', /^\/api\/me\/password$/, async ({ user, body }) => {
  const u = db.prepare('SELECT pass FROM users WHERE id = ?').get(user.id);
  if (!checkPassword(String(body.current || ''), u.pass)) throw httpError(400, 'Mot de passe actuel incorrect.');
  const next = String(body.next || '');
  if (next.length < 8) throw httpError(400, 'Le nouveau mot de passe doit faire au moins 8 caractères.');
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(next), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, user.token);
  return { ok: true };
});

route('GET', /^\/api\/state$/, async ({ user }) => userState(user.id));

route('POST', /^\/api\/sync$/, async ({ user, body }) => {
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : [];
  const failed = [];
  for (const op of ops) {
    try { await applyOp(user.id, op); }
    catch (e) { if (e.status === 400) failed.push(op); else throw e; }  // erreur réseau TMDB : l'appli réessaiera
  }
  return { ...userState(user.id), failed: failed.length };
});

// Relais TMDB : la clé reste sur le serveur.
const TMDB_PATHS = /^\/(search\/(multi|person)|trending\/(tv|movie)\/week|tv\/\d+|tv\/\d+\/season\/\d+|tv\/\d+\/season\/\d+\/episode\/\d+|movie\/\d+|(tv|movie)\/\d+\/(recommendations|watch\/providers)|discover\/(tv|movie)|genre\/(tv|movie)\/list|watch\/providers\/(tv|movie)|person\/\d+\/tv_credits)$/;
// Filtres de la recherche avancée (Découvrir), transmis tels quels à TMDB.
const TMDB_PARAMS = ['query', 'page', 'include_adult', 'sort_by', 'with_genres', 'without_genres', 'with_people', 'with_original_language',
  'with_watch_providers', 'watch_region', 'vote_average.gte', 'vote_count.gte', 'with_runtime.gte', 'with_runtime.lte',
  'primary_release_date.gte', 'primary_release_date.lte', 'first_air_date.gte', 'first_air_date.lte'];
route('GET', /^\/api\/tmdb(\/.*)$/, async ({ match, url }) => {
  const p = match[1];
  if (!TMDB_PATHS.test(p)) throw httpError(404, 'Ressource inconnue.');
  const params = {};
  for (const k of TMDB_PARAMS) if (url.searchParams.has(k)) params[k] = url.searchParams.get(k).slice(0, 100);
  if (lang() === 'en') params.language = 'en-US';
  return tmdb(p, params);
});

/* ----- membres ----- */
route('GET', /^\/api\/friends$/, async ({ user }) => {
  const rows = db.prepare('SELECT id, username, name, avatar FROM users WHERE id != ? ORDER BY name COLLATE NOCASE').all(user.id);
  return { friends: rows.map(publicUser) };
});
// Chercher quelqu'un de l'appli par son pseudo ou son nom (pour l'ajouter à un groupe).
route('GET', /^\/api\/users$/, async ({ user, url }) => {
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase().replace(/[%_\\]/g, '').slice(0, 40);
  if (q.length < 2) return { users: [] };
  const rows = db.prepare(`SELECT id, username, name, avatar FROM users WHERE id != ? AND (username LIKE ? OR lower(name) LIKE ?)
    ORDER BY name COLLATE NOCASE LIMIT 10`).all(user.id, q + '%', '%' + q + '%');
  return { users: rows.map(publicUser) };
});

/* ----- groupes ----- */
const GROUP_EMOJIS = ['🍿', '🎬', '🍕', '🎮', '🏠', '🏢', '🎓', '⚽', '🎸', '❤️', '🌴', '👪'];
const newInvite = () => crypto.randomBytes(9).toString('base64url');
const groupByInvite = code => db.prepare('SELECT * FROM groups WHERE invite = ?').get(code);
const isMember = (gid, uid) => !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, uid);
const joinGroup = (gid, uid) => db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(gid, uid, Date.now());
function myGroup(gid, user) {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g || !isMember(gid, user.id)) throw httpError(404, 'Groupe introuvable.');
  return g;
}
// Pas deux groupes du même nom parmi ceux dont on fait partie (majuscules, accents et espaces ignorés).
function groupFields(body, uid, exceptId = 0) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!name) throw httpError(400, 'Donne un nom au groupe.');
  const mine = db.prepare(`SELECT g.id, g.name FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? AND g.id != ?`).all(uid, exceptId);
  if (mine.some(g => nameKey(g.name) === nameKey(name))) throw httpError(409, `Tu as déjà un groupe « ${name} ». Choisis un autre nom.`);
  const emoji = GROUP_EMOJIS.includes(body.emoji) ? body.emoji : GROUP_EMOJIS[0];
  return { name, emoji };
}
function groupsOf(uid) {
  const groups = db.prepare(`SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?
    ORDER BY g.created_at`).all(uid);
  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at');
  const out = groups.map(g => ({ id: g.id, name: g.name, emoji: g.emoji, invite: g.invite, createdBy: g.created_by,
    members: members.all(g.id).map(r => r.user_id) }));
  return { groups: out, users: usersById(out.flatMap(g => g.members)) };
}
// Quand le créateur part, le membre le plus ancien prend sa place ; un groupe vide disparaît.
function leaveGroup(gid, uid) {
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(gid, uid);
  const next = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at LIMIT 1').get(gid);
  if (!next) db.prepare('DELETE FROM groups WHERE id = ?').run(gid);
  else db.prepare('UPDATE groups SET created_by = ? WHERE id = ? AND (created_by IS NULL OR created_by = ?)').run(next.user_id, gid, uid);
}

route('GET', /^\/api\/groups$/, async ({ user }) => groupsOf(user.id));
route('POST', /^\/api\/groups$/, async ({ user, body }) => {
  const { name, emoji } = groupFields(body, user.id);
  if (db.prepare('SELECT COUNT(*) n FROM group_members WHERE user_id = ?').get(user.id).n >= 30) throw httpError(400, 'Tu fais déjà partie de 30 groupes.');
  const { lastInsertRowid } = db.prepare('INSERT INTO groups (name, emoji, invite, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, emoji, newInvite(), user.id, Date.now());
  joinGroup(Number(lastInsertRowid), user.id);
  return { id: Number(lastInsertRowid), ...groupsOf(user.id) };
});
route('POST', /^\/api\/groups\/(\d+)$/, async ({ user, match, body }) => {
  const g = myGroup(Number(match[1]), user);
  const { name, emoji } = groupFields(body, user.id, g.id);
  db.prepare('UPDATE groups SET name = ?, emoji = ? WHERE id = ?').run(name, emoji, g.id);
  return groupsOf(user.id);
});
route('POST', /^\/api\/groups\/(\d+)\/leave$/, async ({ user, match }) => {
  leaveGroup(myGroup(Number(match[1]), user).id, user.id);
  return groupsOf(user.id);
});
// N'importe quel membre peut ajouter quelqu'un de l'appli dans un groupe dont il fait partie.
route('POST', /^\/api\/groups\/(\d+)\/add$/, async ({ user, match, body }) => {
  const g = myGroup(Number(match[1]), user);
  const uid = Number(body.userId);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) throw httpError(404, 'Utilisateur introuvable.');
  joinGroup(g.id, uid);
  return groupsOf(user.id);
});
// Seul le créateur retire un membre ou change le lien d'invitation.
route('POST', /^\/api\/groups\/(\d+)\/remove$/, async ({ user, match, body }) => {
  const g = myGroup(Number(match[1]), user);
  if (g.created_by !== user.id) throw httpError(403, 'Seul le créateur du groupe peut retirer quelqu’un.');
  const uid = Number(body.userId);
  if (uid !== user.id) leaveGroup(g.id, uid);
  return groupsOf(user.id);
});
route('POST', /^\/api\/groups\/(\d+)\/relink$/, async ({ user, match }) => {
  const g = myGroup(Number(match[1]), user);
  if (g.created_by !== user.id) throw httpError(403, 'Seul le créateur du groupe peut changer le lien.');
  db.prepare('UPDATE groups SET invite = ? WHERE id = ?').run(newInvite(), g.id);
  return groupsOf(user.id);
});
// Lien d'invitation : visible sans compte, pour afficher « Tu es invité dans… » sur l'écran d'inscription.
route('GET', /^\/api\/invite\/([\w-]{6,40})$/, async ({ req, match }) => {
  rateLimit('inv:' + clientIp(req), 60, 15 * 60e3);
  const g = groupByInvite(match[1]);
  if (!g) throw httpError(404, 'Ce lien d’invitation ne marche plus. Demande-en un nouveau.');
  const n = db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ?').get(g.id).n;
  return { group: { id: g.id, name: g.name, emoji: g.emoji, count: n } };
}, { auth: false });
route('POST', /^\/api\/invite\/([\w-]{6,40})\/join$/, async ({ user, match }) => {
  const g = groupByInvite(match[1]);
  if (!g) throw httpError(404, 'Ce lien d’invitation ne marche plus. Demande-en un nouveau.');
  joinGroup(g.id, user.id);
  return { id: g.id, ...groupsOf(user.id) };
});

route('GET', /^\/api\/users\/(\d+)$/, async ({ user, match }) => {
  const id = Number(match[1]);
  const u = db.prepare('SELECT id, username, name, avatar FROM users WHERE id = ?').get(id);
  if (!u) throw httpError(404, 'Utilisateur introuvable.');
  const st = userState(id);
  const shows = Object.values(st.shows).map(({ watched, ...meta }) => ({
    ...meta, watchedCount: Object.keys(watched).length, lastWatchedAt: Math.max(0, ...Object.values(watched)),
  }));
  const reviews = db.prepare(`SELECT * FROM reviews WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30`).all(id)
    .map(r => ({ ...reviewOut(r), title: brief(r.kind, r.tid) }));
  return { user: publicUser(u), relation: id === user.id ? 'self' : 'friend', shows, movies: Object.values(st.movies), reviews };
});

/* ----- avis ----- */
function reviewOut(r) {
  return { userId: r.user_id, kind: r.kind, id: r.tid, s: r.s, e: r.e, rating: r.rating, text: r.text, at: r.updated_at };
}
function parseTitle(match, url) {
  const kind = match[1], id = Number(match[2]);
  const s = kind === 'ep' ? int(url.searchParams.get('s'), 's') : 0;
  const e = kind === 'ep' ? int(url.searchParams.get('e'), 'e') : 0;
  return { kind, id, s, e };
}

// Tout ce que les amis disent et font autour d'une série, d'un film ou d'un épisode.
route('GET', /^\/api\/title\/(tv|movie|ep)\/(\d+)$/, async ({ user, match, url }) => {
  const { kind, id, s, e } = parseTitle(match, url);
  const mine = db.prepare('SELECT * FROM reviews WHERE user_id = ? AND kind = ? AND tid = ? AND s = ? AND e = ?').get(user.id, kind, id, s, e);
  const others = db.prepare(`SELECT * FROM reviews WHERE kind = ? AND tid = ? AND s = ? AND e = ?
    AND user_id IN (${FRIEND_IDS_SQL}) ORDER BY updated_at DESC`).all({ u: user.id }, kind, id, s, e);
  let activity = [];
  if (kind === 'tv') {
    activity = db.prepare(`SELECT us.user_id, us.archived, (SELECT COUNT(*) FROM watched w WHERE w.user_id = us.user_id AND w.show_id = us.show_id) n
      FROM user_shows us WHERE us.show_id = ? AND us.user_id IN (${FRIEND_IDS_SQL})`).all({ u: user.id }, id)
      .map(r => ({ userId: r.user_id, watchedCount: r.n, archived: !!r.archived }));
  } else if (kind === 'movie') {
    activity = db.prepare(`SELECT user_id, status, watched_at FROM user_movies WHERE movie_id = ? AND user_id IN (${FRIEND_IDS_SQL})`)
      .all({ u: user.id }, id).map(r => ({ userId: r.user_id, status: r.status, at: r.watched_at }));
  } else {
    activity = db.prepare(`SELECT user_id, at FROM watched WHERE show_id = ? AND s = ? AND e = ? AND user_id IN (${FRIEND_IDS_SQL})`)
      .all({ u: user.id }, id, s, e).map(r => ({ userId: r.user_id, at: r.at }));
  }
  // Réponses à tous les avis de ce titre, rangées par auteur de l'avis.
  const replyRows = db.prepare('SELECT * FROM review_replies WHERE kind = ? AND tid = ? AND s = ? AND e = ? ORDER BY created_at')
    .all(kind, id, s, e);
  const replies = {};
  for (const r of replyRows) (replies[r.author_id] ||= []).push({ id: r.id, userId: r.user_id, text: r.text, at: r.created_at });
  const withReplies = r => ({ ...reviewOut(r), replies: replies[r.user_id] || [] });
  const users = usersById([...others.map(r => r.user_id), ...activity.map(a => a.userId), ...replyRows.map(r => r.user_id)]);
  return { mine: mine ? withReplies(mine) : null, reviews: others.map(withReplies), activity, users };
});

/* ----- réponses aux avis ----- */
route('POST', /^\/api\/replies$/, async ({ user, body }) => {
  const kind = body.kind;
  if (!['tv', 'movie', 'ep'].includes(kind)) throw httpError(400, 'Type invalide.');
  const author = int(body.author, 'author'), id = int(body.id, 'id');
  const s = kind === 'ep' ? int(body.s, 's') : 0, e = kind === 'ep' ? int(body.e, 'e') : 0;
  const text = String(body.text || '').trim().slice(0, 1000);
  if (!text) throw httpError(400, 'Écris quelque chose avant d’envoyer.');
  if (!db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND kind = ? AND tid = ? AND s = ? AND e = ?').get(author, kind, id, s, e)) {
    throw httpError(404, 'Cet avis n’existe plus.');
  }
  rateLimit('reply:' + user.id, 60, 3600e3);
  const { lastInsertRowid } = db.prepare('INSERT INTO review_replies (author_id, kind, tid, s, e, user_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(author, kind, id, s, e, user.id, text, Date.now());
  if (author !== user.id) {
    notify(author, 'replies', `reply:${lastInsertRowid}`, () => {
      const t = brief(kind === 'movie' ? 'movie' : 'tv', id);
      return {
        title: tr(`💬 ${user.name} a répondu à ton avis sur ${kind === 'ep' ? `S${s}E${e} de ` : ''}${t.name}`,
          `💬 ${user.name} replied to your review of ${kind === 'ep' ? `S${s}E${e} of ` : ''}${t.name}`),
        body: text, url: kind === 'ep' ? `#/ep/${id}/${s}/${e}` : `#/${kind}/${id}`, tag: `reply-${kind}-${id}-${s}-${e}`,
      };
    });
  }
  return { id: Number(lastInsertRowid) };
});

// On ne peut effacer que ses propres réponses.
route('POST', /^\/api\/replies\/(\d+)\/delete$/, async ({ user, match }) => {
  db.prepare('DELETE FROM review_replies WHERE id = ? AND user_id = ?').run(Number(match[1]), user.id);
  return { ok: true };
});

// Séries et films sur lesquels j'ai déjà donné mon avis (pour le petit bouton « avis » des affiches).
route('GET', /^\/api\/reviews\/mine$/, async ({ user }) => ({
  items: db.prepare("SELECT kind, tid FROM reviews WHERE user_id = ? AND kind IN ('tv', 'movie')").all(user.id).map(r => r.kind + ':' + r.tid),
}));

route('POST', /^\/api\/reviews$/, async ({ user, body }) => {
  const kind = body.kind;
  if (!['tv', 'movie', 'ep'].includes(kind)) throw httpError(400, 'Type invalide.');
  const id = int(body.id, 'id');
  const s = kind === 'ep' ? int(body.s, 's') : 0, e = kind === 'ep' ? int(body.e, 'e') : 0;
  const rating = body.rating == null ? null : int(body.rating, 'note');
  if (rating !== null && (rating < 1 || rating > 5)) throw httpError(400, 'La note va de 1 à 5.');
  const text = String(body.text || '').trim().slice(0, 2000);
  if (rating === null && !text) {
    db.prepare('DELETE FROM reviews WHERE user_id = ? AND kind = ? AND tid = ? AND s = ? AND e = ?').run(user.id, kind, id, s, e);
    db.prepare('DELETE FROM review_replies WHERE author_id = ? AND kind = ? AND tid = ? AND s = ? AND e = ?').run(user.id, kind, id, s, e);
    return { mine: null };
  }
  await ensureTitle(kind === 'movie' ? 'movie' : 'tv', id, META_MAX_AGE);
  const now = Date.now();
  db.prepare(`INSERT INTO reviews (user_id, kind, tid, s, e, rating, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, kind, tid, s, e) DO UPDATE SET rating = excluded.rating, text = excluded.text, updated_at = excluded.updated_at`)
    .run(user.id, kind, id, s, e, rating, text, now, now);
  return { mine: reviewOut(db.prepare('SELECT * FROM reviews WHERE user_id = ? AND kind = ? AND tid = ? AND s = ? AND e = ?').get(user.id, kind, id, s, e)) };
});

/* ----- conseils (mis en avant pour tous les membres) ----- */
// Conseils des autres membres, sauf ceux que l'utilisateur a retirés de ses suggestions.
const PICKS_FOR_SQL = `SELECT p.user_id, p.kind, p.tid, p.message, p.created_at at FROM picks p
  WHERE p.user_id != :u
    AND NOT EXISTS (SELECT 1 FROM picks_hidden h WHERE h.user_id = :u AND h.kind = p.kind AND h.tid = p.tid)
    -- Pas de suggestion pour une série déjà commencée (au moins un épisode vu) ni pour un film déjà vu.
    AND NOT (p.kind = 'tv' AND EXISTS (SELECT 1 FROM watched w WHERE w.user_id = :u AND w.show_id = p.tid))
    AND NOT (p.kind = 'movie' AND EXISTS (SELECT 1 FROM user_movies m WHERE m.user_id = :u AND m.movie_id = p.tid AND m.status = 'watched'))`;

function pickBody(body) {
  if (!['tv', 'movie'].includes(body.kind)) throw httpError(400, 'Type invalide.');
  return { kind: body.kind, id: int(body.id, 'id') };
}

route('POST', /^\/api\/recos$/, async ({ user, body }) => {
  const { kind, id } = pickBody(body);
  await ensureTitle(kind, id, META_MAX_AGE);
  const message = String(body.message || '').trim().slice(0, 500);
  const isNew = !db.prepare('SELECT 1 FROM picks WHERE user_id = ? AND kind = ? AND tid = ?').get(user.id, kind, id);
  db.prepare(`INSERT INTO picks (user_id, kind, tid, message, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, kind, tid) DO UPDATE SET message = excluded.message`).run(user.id, kind, id, message, Date.now());
  if (isNew) {
    for (const { user_id } of db.prepare(GROUP_MATES_SQL).all({ u: user.id })) {
      notify(user_id, 'recos', `pick:${user.id}:${kind}:${id}`, () => ({
        title: tr(`💡 ${user.name} te conseille ${brief(kind, id).name}`, `💡 ${user.name} recommends ${brief(kind, id).name}`),
        body: message || (kind === 'tv' ? tr('Une série à découvrir.', 'A show to check out.') : tr('Un film à découvrir.', 'A movie to check out.')),
        url: `#/${kind}/${id}`, tag: `pick-${kind}-${id}`,
      }));
    }
  }
  return { on: true };
});

route('POST', /^\/api\/recos\/remove$/, async ({ user, body }) => {
  const { kind, id } = pickBody(body);
  db.prepare('DELETE FROM picks WHERE user_id = ? AND kind = ? AND tid = ?').run(user.id, kind, id);
  return { on: false };
});

route('GET', /^\/api\/recos$/, async ({ user }) => {
  const seenAt = db.prepare('SELECT at FROM picks_seen WHERE user_id = ?').get(user.id)?.at || 0;
  const rows = db.prepare(`${PICKS_FOR_SQL} ORDER BY at DESC LIMIT 200`).all({ u: user.id });
  const users = usersById(rows.map(r => r.user_id));
  const mine = db.prepare('SELECT kind, tid id, message FROM picks WHERE user_id = ?').all(user.id);
  return {
    recos: rows.map(r => ({ from: users[r.user_id], kind: r.kind, title: brief(r.kind, r.tid), message: r.message, at: r.at, seen: r.at <= seenAt })),
    mine,
  };
});

route('POST', /^\/api\/recos\/seen$/, async ({ user }) => {
  db.prepare('INSERT INTO picks_seen (user_id, at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET at = excluded.at').run(user.id, Date.now());
  return { ok: true };
});

route('POST', /^\/api\/recos\/hide$/, async ({ user, body }) => {
  const { kind, id } = pickBody(body);
  db.prepare('INSERT OR IGNORE INTO picks_hidden (user_id, kind, tid) VALUES (?, ?, ?)').run(user.id, kind, id);
  return { ok: true };
});

/* ----- fil d'activité des amis ----- */
route('GET', /^\/api\/feed$/, async ({ user, url }) => {
  const gid = Number(url.searchParams.get('group')) || 0;
  if (gid) myGroup(gid, user);
  const p = gid ? { u: user.id, g: gid } : { u: user.id };
  const MATES = gid ? ONE_GROUP_SQL : GROUP_MATES_SQL;
  const eps = db.prepare(`SELECT user_id, show_id, date(at / 1000, 'unixepoch', 'localtime') day, COUNT(*) n,
      MIN(s * 10000 + e) first, MAX(s * 10000 + e) last, MAX(at) at
    FROM watched WHERE user_id IN (${MATES})
    GROUP BY user_id, show_id, day ORDER BY at DESC LIMIT 80`).all(p);
  const movies = db.prepare(`SELECT user_id, movie_id, watched_at at FROM user_movies
    WHERE status = 'watched' AND user_id IN (${MATES}) ORDER BY watched_at DESC LIMIT 40`).all(p);
  const reviews = db.prepare(`SELECT * FROM reviews WHERE user_id IN (${MATES}) ORDER BY updated_at DESC LIMIT 40`).all(p);
  const items = [
    ...eps.map(r => ({ type: 'eps', key: `eps:${r.user_id}:${r.show_id}:${r.day}`, userId: r.user_id, title: brief('tv', r.show_id), n: r.n,
      first: { s: Math.floor(r.first / 10000), e: r.first % 10000 }, last: { s: Math.floor(r.last / 10000), e: r.last % 10000 }, at: r.at })),
    ...movies.map(r => ({ type: 'movie', key: `movie:${r.user_id}:${r.movie_id}`, userId: r.user_id, title: brief('movie', r.movie_id), at: r.at })),
    ...reviews.map(r => ({ type: 'review', key: `review:${r.user_id}:${r.kind}:${r.tid}:${r.s}:${r.e}`, userId: r.user_id, ...reviewOut(r), title: brief(r.kind, r.tid) })),
    ...bestRuns(db.prepare(`SELECT * FROM quiz_runs WHERE finished_at IS NOT NULL AND user_id IN (${MATES}) ORDER BY finished_at DESC LIMIT 150`).all(p)).slice(0, 30)
      .map(r => ({ type: 'quiz', key: `quiz:${r.user_id}:${r.id}`, userId: r.user_id, mode: r.mode, correct: r.correct, total: r.total, score: r.score,
        kind: r.kind, title: r.mode === 'free' ? brief(r.kind, r.tid) : { id: 0, name: 'Quiz du jour', poster: null }, at: r.finished_at })),
  ].sort((a, b) => b.at - a.at).slice(0, 80);
  const reacts = db.prepare('SELECT emoji, user_id FROM reactions WHERE item = ? ORDER BY at');
  const ids = items.map(i => i.userId);
  for (const it of items) {
    it.reactions = {};
    for (const r of reacts.all(it.key)) { (it.reactions[r.emoji] ||= []).push(r.user_id); ids.push(r.user_id); }
  }
  return { items, users: usersById(ids) };
});

// Fil : un même quiz rejoué plusieurs fois par quelqu'un n'apparaît qu'une fois, avec son meilleur score.
function bestRuns(runs) {
  const best = new Map();
  for (const r of runs) {
    const k = r.mode === 'daily' ? `d:${r.id}` : `${r.user_id}:${r.kind}:${r.tid}`, b = best.get(k);
    if (!b || r.score > b.score) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => b.finished_at - a.finished_at);
}

/* ----- réactions emoji sur le fil ----- */
const REACTIONS = ['😂', '🔥', '😱', '❤️', '👏'];
const REACT_KEY_RE = /^(eps:\d+:\d+:\d{4}-\d\d-\d\d|movie:\d+:\d+|review:\d+:(tv|movie|ep):\d+:\d+:\d+|quiz:\d+:\d+)$/;
// Même emoji = on retire ; autre emoji = on remplace. Une seule réaction par membre et par activité.
route('POST', /^\/api\/reactions$/, async ({ user, body }) => {
  const item = String(body.item || ''), emoji = String(body.emoji || '');
  if (!REACT_KEY_RE.test(item) || !REACTIONS.includes(emoji)) throw httpError(400, 'Réaction invalide.');
  const owner = Number(item.split(':')[1]);
  if (owner !== user.id && !db.prepare(`SELECT 1 FROM (${GROUP_MATES_SQL}) WHERE user_id = :o`).get({ u: user.id, o: owner }))
    throw httpError(404, 'Activité introuvable.');
  const [type, , a, b, c, d] = item.split(':');
  const exists = type === 'eps'
    ? db.prepare(`SELECT 1 FROM watched WHERE user_id = ? AND show_id = ? AND date(at / 1000, 'unixepoch', 'localtime') = ? LIMIT 1`).get(owner, Number(a), b)
    : type === 'movie' ? db.prepare(`SELECT 1 FROM user_movies WHERE user_id = ? AND movie_id = ? AND status = 'watched'`).get(owner, Number(a))
    : type === 'quiz' ? db.prepare('SELECT 1 FROM quiz_runs WHERE user_id = ? AND id = ? AND finished_at IS NOT NULL').get(owner, Number(a))
    : db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND kind = ? AND tid = ? AND s = ? AND e = ?').get(owner, a, Number(b), Number(c), Number(d));
  if (!exists) throw httpError(404, 'Activité introuvable.');
  const cur = db.prepare('SELECT emoji FROM reactions WHERE item = ? AND user_id = ?').get(item, user.id);
  if (cur?.emoji === emoji) db.prepare('DELETE FROM reactions WHERE item = ? AND user_id = ?').run(item, user.id);
  else {
    db.prepare('INSERT OR REPLACE INTO reactions (item, owner_id, user_id, emoji, at) VALUES (?, ?, ?, ?, ?)').run(item, owner, user.id, emoji, Date.now());
    if (owner !== user.id && !cur) notifyReaction(owner, user, emoji, item);
  }
  const users = {};
  for (const r of db.prepare('SELECT emoji, user_id FROM reactions WHERE item = ? ORDER BY at').all(item)) (users[r.emoji] ||= []).push(r.user_id);
  return { reactions: users };
});

/* ----- notifications sur le téléphone ----- */
const NOTIF_KINDS = ['episodes', 'recos', 'replies', 'reactions', 'games', 'quiz'];
function notifPrefs(uid) {
  const row = db.prepare('SELECT prefs FROM notif_prefs WHERE user_id = ?').get(uid);
  const p = row ? JSON.parse(row.prefs) : {};
  return Object.fromEntries(NOTIF_KINDS.map(k => [k, p[k] !== false]));
}
// Envoie à tous les appareils du membre, si ce type est activé et pas déjà envoyé (clé unique).
// Le message peut être une fonction : elle est alors écrite dans la langue du membre qui le reçoit.
function notify(uid, kind, key, msg) {
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(uid);
  if (!subs.length || (kind && !notifPrefs(uid)[kind])) return;
  if (key && !db.prepare('INSERT OR IGNORE INTO notif_log (user_id, key, at) VALUES (?, ?, ?)').run(uid, key, Date.now()).changes) return;
  if (typeof msg === 'function') msg = withLang(db.prepare('SELECT lang FROM users WHERE id = ?').get(uid)?.lang, msg);
  for (const sub of subs) {
    push.sendOne(sub, msg).then(r => {
      if (r === 'gone') db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint);
    }, err => console.warn('Notification non envoyée :', err.message));
  }
}

function notifyReaction(owner, user, emoji, item) {
  const [type, , a, b, c, d] = item.split(':');
  notify(owner, 'reactions', `react:${item}:${user.id}`, () => {
    let what;
    if (type === 'eps') what = tr(`À ce que tu as regardé (${brief('tv', Number(a)).name})`, `To what you watched (${brief('tv', Number(a)).name})`);
    else if (type === 'movie') what = tr(`À ton film vu (${brief('movie', Number(a)).name})`, `To the movie you watched (${brief('movie', Number(a)).name})`);
    else if (type === 'quiz') what = tr('À ton score au quiz', 'To your quiz score');
    else {
      const t = brief(a === 'movie' ? 'movie' : 'tv', Number(b)).name;
      what = tr(`À ton avis sur ${a === 'ep' ? `S${c}E${d} de ` : ''}${t}`, `To your review of ${a === 'ep' ? `S${c}E${d} of ` : ''}${t}`);
    }
    return { title: tr(`${emoji} ${user.name} a réagi`, `${emoji} ${user.name} reacted`), body: what, url: '#/amis', tag: 'react' };
  });
}

// Nouveaux épisodes du jour pour les séries suivies : un seul message le matin (à partir de 9 h).
const localDay = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
const playedDaily = (uid, day) => !!db.prepare(`SELECT 1 FROM quiz_runs WHERE user_id = ? AND day = ? AND mode = 'daily' AND finished_at IS NOT NULL`).get(uid, day);

// Quiz du jour : un rappel entre 10 h et 21 h pour ceux qui n'y ont pas encore joué (une fois par jour).
function sendQuizAlerts() {
  const h = new Date().getHours();
  if (h < 10 || h >= 21) return;
  const day = localDay();
  for (const { user_id } of db.prepare('SELECT DISTINCT user_id FROM push_subs').all()) {
    if (playedDaily(user_id, day)) continue;
    const mates = db.prepare(GROUP_MATES_SQL).all({ u: user_id }).map(r => Number(r.user_id));
    const lead = mates.length && db.prepare(`SELECT u.name, r.score FROM quiz_runs r JOIN users u ON u.id = r.user_id
      WHERE r.mode = 'daily' AND r.day = ? AND r.finished_at IS NOT NULL AND r.user_id IN (${mates.join(',')}) ORDER BY r.score DESC LIMIT 1`).get(day);
    notify(user_id, 'quiz', `quiz:${day}`, () => ({
      title: tr('🎯 Le quiz du jour est prêt', '🎯 Today’s quiz is ready'),
      body: lead ? tr(`${lead.name} mène avec ${num(lead.score)} pts. À toi de jouer !`, `${lead.name} leads with ${num(lead.score)} pts. Your turn!`)
        : tr('10 questions sur les séries et films de la bande. Sois le premier à jouer !', '10 questions on the shows and movies your crew watches. Be the first to play!'),
      url: '#/amis/jeux', tag: 'quiz',
    }));
  }
}
setInterval(sendQuizAlerts, 10 * 60e3);
setTimeout(sendQuizAlerts, 30e3);

async function sendEpisodeAlerts() {
  if (new Date().getHours() < 9) return;
  const today = localDay();
  const users = db.prepare('SELECT DISTINCT user_id FROM push_subs').all();
  for (const { user_id } of users) {
    if (!notifPrefs(user_id).episodes) continue;
    const eps = [];
    for (const r of db.prepare(`SELECT t.meta FROM user_shows us JOIN titles t ON t.kind = 'tv' AND t.id = us.show_id
        WHERE us.user_id = ? AND us.archived = 0`).all(user_id)) {
      const m = JSON.parse(r.meta);
      for (const ep of [m.last, m.next]) if (ep?.d === today && !eps.some(x => x.m.id === m.id && x.ep.e === ep.e)) eps.push({ m, ep });
    }
    const fresh = eps.filter(({ m, ep }) => !db.prepare('SELECT 1 FROM notif_log WHERE user_id = ? AND key = ?').get(user_id, `ep:${m.id}:${ep.s}:${ep.e}`));
    if (!fresh.length) continue;
    for (const { m, ep } of fresh) db.prepare('INSERT OR IGNORE INTO notif_log (user_id, key, at) VALUES (?, ?, ?)').run(user_id, `ep:${m.id}:${ep.s}:${ep.e}`, Date.now());
    const one = fresh.length === 1 ? fresh[0] : null;
    notify(user_id, null, null, () => {
      const list = fresh.map(x => ({ ...x, m: locMeta(x.m) }));
      const o = one && list[0], epName = o && (o.m.last?.e === o.ep.e && o.m.last?.s === o.ep.s ? o.m.last.name : o.m.next?.e === o.ep.e && o.m.next?.s === o.ep.s ? o.m.next.name : o.ep.name);
      return o
        ? { title: tr(`📺 Nouvel épisode de ${o.m.name}`, `📺 New episode of ${o.m.name}`), body: tr(`S${o.ep.s}E${o.ep.e}${epName ? ' · ' + epName : ''} sort aujourd’hui.`, `S${o.ep.s}E${o.ep.e}${epName ? ' · ' + epName : ''} comes out today.`),
            url: `#/ep/${o.m.id}/${o.ep.s}/${o.ep.e}`, tag: 'episodes' }
        : { title: tr(`📺 ${list.length} nouveaux épisodes aujourd’hui`, `📺 ${list.length} new episodes today`), body: list.map(x => x.m.name).join(', '), url: '#/collection', tag: 'episodes' };
    });
  }
  db.prepare('DELETE FROM notif_log WHERE at < ?').run(Date.now() - 60 * DAY);
}

route('GET', /^\/api\/push$/, async ({ user }) => ({
  key: push.publicKey, prefs: notifPrefs(user.id),
  devices: db.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?').get(user.id).n,
}));
route('POST', /^\/api\/push\/subscribe$/, async ({ user, body }) => {
  const endpoint = String(body.endpoint || ''), p256dh = String(body.keys?.p256dh || ''), auth = String(body.keys?.auth || '');
  if (!/^https:\/\/\S{10,1000}$/.test(endpoint) || !/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,30}$/.test(auth))
    throw httpError(400, 'Abonnement invalide.');
  rateLimit('pushsub:' + user.id, 20, 3600e3);
  // Un appareil ne reçoit que les notifications du dernier compte connecté dessus.
  db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(endpoint, user.id, p256dh, auth, Date.now());
  return { ok: true };
});
route('POST', /^\/api\/push\/unsubscribe$/, async ({ user, body }) => {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(String(body.endpoint || ''), user.id);
  return { ok: true };
});
route('POST', /^\/api\/push\/prefs$/, async ({ user, body }) => {
  const prefs = { ...notifPrefs(user.id) };
  for (const k of NOTIF_KINDS) if (typeof body[k] === 'boolean') prefs[k] = body[k];
  db.prepare('INSERT OR REPLACE INTO notif_prefs (user_id, prefs) VALUES (?, ?)').run(user.id, JSON.stringify(prefs));
  return { prefs };
});
route('POST', /^\/api\/push\/test$/, async ({ user }) => {
  rateLimit('pushtest:' + user.id, 10, 3600e3);
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(user.id);
  if (!subs.length) throw httpError(400, 'Aucun appareil abonné.');
  const out = await Promise.allSettled(subs.map(sub => push.sendOne(sub, { title: tr('🍿 Ça marche !', '🍿 It works!'), body: tr('Tu recevras tes notifications what2watch ici.', 'You’ll get your what2watch notifications here.'), url: '#/profil', tag: 'test' })
    .then(r => { if (r === 'gone') db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint); return r; })));
  if (!out.some(r => r.status === 'fulfilled' && r.value === 'ok')) throw httpError(502, 'Le service de notifications n’a pas répondu.');
  return { ok: true };
});

/* ----- jeux : quiz et classements ----- */
const quiz = createQuiz({ tmdb });
const QUIZ_LIMIT = 15e3, QUIZ_GRACE = 3e3;
const runQuestions = run => JSON.parse(run.mode === 'daily' ? db.prepare('SELECT questions FROM quiz_daily WHERE day = ?').get(run.day).questions : run.questions);
const quizTitle = run => run.mode === 'daily' ? tr('Quiz du jour', 'Daily quiz') : brief(run.kind, run.tid).name;
// Titres les plus regardés de l'appli (pour le quiz du jour).
function popularTitles() {
  return db.prepare(`SELECT 'tv' kind, show_id id, COUNT(DISTINCT user_id) n FROM watched GROUP BY show_id
    UNION ALL SELECT 'movie', movie_id, COUNT(*) FROM user_movies WHERE status = 'watched' GROUP BY movie_id
    ORDER BY n DESC LIMIT 25`).all();
}
let dailyBuilding = null;
async function ensureDaily(day) {
  if (db.prepare('SELECT 1 FROM quiz_daily WHERE day = ?').get(day)) return;
  dailyBuilding ||= quiz.dailyQuiz(popularTitles()).then(qs => {
    if (qs.length < 5) throw httpError(503, 'Pas assez de séries et films regardés pour préparer le quiz du jour.');
    db.prepare('INSERT OR IGNORE INTO quiz_daily (day, questions, created_at) VALUES (?, ?, ?)').run(day, JSON.stringify(qs), Date.now());
  }).finally(() => { dailyBuilding = null; });
  await dailyBuilding;
}
function myRun(id, user) {
  const run = db.prepare('SELECT * FROM quiz_runs WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!run) throw httpError(404, 'Partie introuvable.');
  return run;
}

route('POST', /^\/api\/quiz\/start$/, async ({ user, body }) => {
  const day = localDay();
  if (body.mode === 'daily') {
    const done = db.prepare(`SELECT * FROM quiz_runs WHERE user_id = ? AND day = ? AND mode = 'daily'`).get(user.id, day);
    if (done?.finished_at) throw httpError(409, 'Tu as déjà joué au quiz du jour. Reviens demain !');
    if (done) return { id: done.id, total: done.total, title: tr('Quiz du jour', 'Daily quiz') };
    await ensureDaily(day);
    const total = JSON.parse(db.prepare('SELECT questions FROM quiz_daily WHERE day = ?').get(day).questions).length;
    const { lastInsertRowid } = db.prepare(`INSERT INTO quiz_runs (user_id, mode, day, total, created_at) VALUES (?, 'daily', ?, ?, ?)`).run(user.id, day, total, Date.now());
    return { id: Number(lastInsertRowid), total, title: tr('Quiz du jour', 'Daily quiz') };
  }
  let kind = body.kind === 'movie' ? 'movie' : body.kind === 'tv' ? 'tv' : null;
  let id = body.id == null ? 0 : int(body.id, 'id');
  // Relever un défi : le titre est celui du défi, même si on ne l'a pas (encore) vu.
  const ch = body.challenge ? db.prepare('SELECT * FROM quiz_challenges WHERE id = ? AND to_id = ?').get(int(body.challenge, 'challenge'), user.id) : null;
  if (body.challenge && !ch) throw httpError(404, 'Défi introuvable.');
  if (ch?.done_at) throw httpError(409, 'Tu as déjà relevé ce défi.');
  if (ch) { kind = ch.kind; id = ch.tid; }
  if (!kind) throw httpError(400, 'Type invalide.');
  // Quiz libre : seulement sur ce qu'on a vu (sauf pour relever un défi).
  if (kind === 'tv') {
    if (!ch && !db.prepare('SELECT 1 FROM watched WHERE user_id = ? AND show_id = ?').get(user.id, id)) throw httpError(403, 'Regarde au moins un épisode avant de jouer à ce quiz.');
  } else if (!ch && !db.prepare(`SELECT 1 FROM user_movies WHERE user_id = ? AND movie_id = ? AND status = 'watched'`).get(user.id, id)) {
    throw httpError(403, 'Marque ce film comme vu avant de jouer à son quiz.');
  }
  rateLimit('quiz:' + user.id, 60, 3600e3);
  await ensureTitle(kind, id, META_MAX_AGE);
  const { title, questions } = await quiz.freeQuiz(kind, id);
  if (questions.length < 5) throw httpError(422, 'Pas assez d’infos sur ce titre pour en faire un quiz.');
  const { lastInsertRowid } = db.prepare(`INSERT INTO quiz_runs (user_id, mode, day, kind, tid, questions, total, created_at) VALUES (?, 'free', ?, ?, ?, ?, ?, ?)`)
    .run(user.id, day, kind, id, JSON.stringify(questions), questions.length, Date.now());
  if (ch) db.prepare('UPDATE quiz_challenges SET reply_run = ? WHERE id = ?').run(Number(lastInsertRowid), ch.id);
  return { id: Number(lastInsertRowid), total: questions.length, title: loc(title), kind, tid: id };
});

// Question en cours : le chrono démarre côté serveur à la première demande (recharger la page ne le remet pas à zéro).
route('POST', /^\/api\/quiz\/(\d+)\/next$/, async ({ user, match }) => {
  const run = myRun(Number(match[1]), user);
  if (run.finished_at) throw httpError(409, 'Partie terminée.');
  const answers = JSON.parse(run.answers), i = answers.length;
  const qx = runQuestions(run)[i];
  let served = run.served_at;
  if (!served) { served = Date.now(); db.prepare('UPDATE quiz_runs SET served_at = ? WHERE id = ?').run(served, run.id); }
  return { i, total: run.total, score: run.score, title: quizTitle(run), q: loc({ t: qx.t, x: qx.x || null, img: qx.img || null, imgKind: qx.imgKind || null, c: qx.c }),
    limit: QUIZ_LIMIT, left: Math.max(0, QUIZ_LIMIT - (Date.now() - served)) };
});

route('POST', /^\/api\/quiz\/(\d+)\/answer$/, async ({ user, match, body }) => {
  const run = myRun(Number(match[1]), user);
  if (run.finished_at) throw httpError(409, 'Partie terminée.');
  const answers = JSON.parse(run.answers), i = answers.length;
  if (Number(body.i) !== i || !run.served_at) throw httpError(409, 'Question déjà passée.');
  const qs = runQuestions(run), qx = qs[i];
  const ms = Date.now() - run.served_at;
  const choice = Number.isInteger(body.c) ? body.c : -1;
  const ok = choice === qx.a && ms <= QUIZ_LIMIT + QUIZ_GRACE;
  // 100 points par bonne réponse, jusqu'à 50 de plus si on répond vite.
  const pts = ok ? 100 + Math.round(50 * Math.max(0, QUIZ_LIMIT - ms) / QUIZ_LIMIT) : 0;
  answers.push({ c: choice, ok, pts });
  const score = run.score + pts, correct = run.correct + (ok ? 1 : 0), done = answers.length >= qs.length;
  db.prepare('UPDATE quiz_runs SET answers = ?, score = ?, correct = ?, served_at = NULL, finished_at = ? WHERE id = ?')
    .run(JSON.stringify(answers), score, correct, done ? Date.now() : null, run.id);
  const out = { ok, a: qx.a, pts, score, correct, done };
  if (done) out.result = finishRun({ ...run, score, correct }, user);
  return out;
});

// Fin de partie : rang du jour ou meilleur score sur ce titre ; on prévient celui qu'on vient de détrôner.
function finishRun(run, user) {
  const mates = db.prepare(GROUP_MATES_SQL).all({ u: user.id }).map(r => r.user_id);
  const circle = [user.id, ...mates];
  const inCircle = `user_id IN (${circle.map(Number).join(',')})`;
  if (run.mode === 'daily') {
    const rows = db.prepare(`SELECT user_id, score FROM quiz_runs WHERE mode = 'daily' AND day = ? AND finished_at IS NOT NULL AND ${inCircle} ORDER BY score DESC`).all(run.day);
    return { rank: rows.findIndex(r => r.user_id === user.id) + 1, players: rows.length };
  }
  const ch = db.prepare('SELECT * FROM quiz_challenges WHERE reply_run = ? AND done_at IS NULL').get(run.id);
  let duel = null;
  if (ch) {
    db.prepare('UPDATE quiz_challenges SET reply_score = ?, reply_correct = ?, reply_total = ?, done_at = ? WHERE id = ?').run(run.score, run.correct, run.total, Date.now(), ch.id);
    const won = run.score > ch.score;
    const from = db.prepare('SELECT name FROM users WHERE id = ?').get(ch.from_id);
    duel = { won, tie: run.score === ch.score, name: from?.name || '?', score: ch.score, correct: ch.correct, total: ch.total };
    notify(ch.from_id, 'games', `duel:${ch.id}`, () => ({
      title: won ? tr(`😱 ${user.name} a relevé ton défi !`, `😱 ${user.name} beat your challenge!`) : run.score === ch.score ? tr(`🤝 Égalité avec ${user.name} !`, `🤝 It’s a tie with ${user.name}!`) : tr(`😎 ${user.name} n’a pas battu ton score`, `😎 ${user.name} didn’t beat your score`),
      body: tr(`Quiz ${brief(ch.kind, ch.tid).name} : ${run.correct}/${run.total} · ${run.score} pts (toi : ${ch.score} pts).`, `${brief(ch.kind, ch.tid).name} quiz: ${run.correct}/${run.total} · ${run.score} pts (you: ${ch.score} pts).`),
      url: '#/amis/jeux', tag: `duel-${ch.id}`,
    }));
  }
  const best = db.prepare(`SELECT user_id, MAX(score) score, correct FROM quiz_runs WHERE mode = 'free' AND kind = ? AND tid = ? AND finished_at IS NOT NULL AND id != ? AND ${inCircle}
    GROUP BY user_id ORDER BY score DESC`).all(run.kind, run.tid, run.id);
  const king = best[0];
  const myPrev = best.find(b => b.user_id === user.id)?.score || 0;
  if (king && king.user_id !== user.id && run.score > king.score) {
    notify(king.user_id, 'games', `beat:${run.id}`, () => ({
      title: tr(`🏆 ${user.name} a battu ton score au quiz ${brief(run.kind, run.tid).name}`, `🏆 ${user.name} beat your score on the ${brief(run.kind, run.tid).name} quiz`),
      body: tr(`${run.correct}/${run.total} · ${run.score} points. À toi de reprendre ta place !`, `${run.correct}/${run.total} · ${run.score} points. Go take your spot back!`), url: `#/${run.kind}/${run.tid}`, tag: `beat-${run.kind}-${run.tid}`,
    }));
  }
  return { king: !king || run.score > king.score, record: run.score > myPrev, prev: myPrev || null, duel };
}

// Défier des amis avec son meilleur score sur un titre.
route('POST', /^\/api\/challenges$/, async ({ user, body }) => {
  const kind = body.kind === 'movie' ? 'movie' : 'tv', id = int(body.id, 'id');
  const best = db.prepare(`SELECT * FROM quiz_runs WHERE user_id = ? AND mode = 'free' AND kind = ? AND tid = ? AND finished_at IS NOT NULL ORDER BY score DESC LIMIT 1`).get(user.id, kind, id);
  if (!best) throw httpError(400, 'Joue d’abord à ce quiz pour pouvoir défier tes amis.');
  const mates = new Set(db.prepare(GROUP_MATES_SQL).all({ u: user.id }).map(r => r.user_id));
  const to = [...new Set((Array.isArray(body.to) ? body.to : []).map(Number))].filter(x => mates.has(x)).slice(0, 30);
  if (!to.length) throw httpError(400, 'Choisis au moins un ami.');
  rateLimit('duel:' + user.id, 60, 3600e3);
  for (const uid of to) {
    // Un seul défi en cours par ami et par titre : le nouveau remplace l'ancien.
    db.prepare('DELETE FROM quiz_challenges WHERE from_id = ? AND to_id = ? AND kind = ? AND tid = ? AND done_at IS NULL').run(user.id, uid, kind, id);
    const { lastInsertRowid } = db.prepare(`INSERT INTO quiz_challenges (from_id, to_id, kind, tid, score, correct, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, uid, kind, id, best.score, best.correct, best.total, Date.now());
    notify(uid, 'games', `chal:${lastInsertRowid}`, () => ({
      title: tr(`⚔️ ${user.name} te défie au quiz ${brief(kind, id).name}`, `⚔️ ${user.name} challenges you on the ${brief(kind, id).name} quiz`),
      body: tr(`${best.correct}/${best.total} · ${best.score} pts. À toi de faire mieux !`, `${best.correct}/${best.total} · ${best.score} pts. Can you do better?`), url: '#/amis/jeux', tag: `chal-${kind}-${id}`,
    }));
  }
  return { sent: to.length };
});

function challengesFor(user) {
  const out = c => ({ id: c.id, fromId: c.from_id, toId: c.to_id, kind: c.kind, title: brief(c.kind, c.tid), score: c.score, correct: c.correct, total: c.total,
    at: c.created_at, done: !!c.done_at, reply: c.done_at ? { score: c.reply_score, correct: c.reply_correct, total: c.reply_total } : null });
  const week = Date.now() - 7 * DAY;
  // Un même quiz entre deux mêmes personnes ne compte qu'une fois : le défi en cours s'il y en a un, sinon le meilleur résultat.
  const once = rows => {
    const best = new Map();
    for (const c of rows) {
      const k = `${c.from_id}:${c.to_id}:${c.kind}:${c.tid}`, b = best.get(k);
      if (!b || (!c.done_at && b.done_at) || (c.done_at && b.done_at && c.reply_score > b.reply_score)) best.set(k, c);
    }
    return [...best.values()];
  };
  return {
    received: once(db.prepare('SELECT * FROM quiz_challenges WHERE to_id = ? AND (done_at IS NULL OR done_at > ?) ORDER BY created_at DESC LIMIT 60').all(user.id, week))
      .sort((a, b) => !!a.done_at - !!b.done_at || b.created_at - a.created_at).slice(0, 20).map(out),
    sent: once(db.prepare('SELECT * FROM quiz_challenges WHERE from_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 60').all(user.id, week)).slice(0, 20).map(out),
  };
}

// Onglet Jeux : quiz du jour, classements (du jour, du mois) et « qui connaît le mieux… ».
route('GET', /^\/api\/games$/, async ({ user, url }) => {
  const gid = Number(url.searchParams.get('group')) || 0;
  if (gid) myGroup(gid, user);
  const ids = [user.id, ...db.prepare(gid ? ONE_GROUP_SQL : GROUP_MATES_SQL).all(gid ? { u: user.id, g: gid } : { u: user.id }).map(r => r.user_id)];
  const inCircle = `user_id IN (${ids.map(Number).join(',')})`;
  const day = localDay(), month = day.slice(0, 7);
  const mine = db.prepare(`SELECT correct, total, score, finished_at FROM quiz_runs WHERE user_id = ? AND day = ? AND mode = 'daily'`).get(user.id, day);
  const today = db.prepare(`SELECT user_id userId, correct, total, score FROM quiz_runs WHERE mode = 'daily' AND day = ? AND finished_at IS NOT NULL AND ${inCircle} ORDER BY score DESC`).all(day);
  // Mois : quiz du jour + meilleur score de chaque quiz libre (rejouer ne fait pas gonfler les points).
  const pts = new Map();
  const add = (uid, n, played) => { const p = pts.get(uid) || { userId: uid, points: 0, played: 0 }; p.points += n; p.played += played; pts.set(uid, p); };
  for (const r of db.prepare(`SELECT user_id, score FROM quiz_runs WHERE mode = 'daily' AND finished_at IS NOT NULL AND substr(day, 1, 7) = ? AND ${inCircle}`).all(month)) add(r.user_id, r.score, 1);
  for (const r of db.prepare(`SELECT user_id, MAX(score) score, COUNT(*) n FROM quiz_runs WHERE mode = 'free' AND finished_at IS NOT NULL AND substr(day, 1, 7) = ? AND ${inCircle} GROUP BY user_id, kind, tid`).all(month)) add(r.user_id, r.score, r.n);
  const monthRank = [...pts.values()].sort((a, b) => b.points - a.points);
  // Meilleur joueur par titre (tous les temps), titres joués le plus récemment d'abord.
  const kings = [];
  for (const t of db.prepare(`SELECT kind, tid, MAX(finished_at) at FROM quiz_runs WHERE mode = 'free' AND finished_at IS NOT NULL AND ${inCircle} GROUP BY kind, tid ORDER BY at DESC LIMIT 20`).all()) {
    const best = db.prepare(`SELECT user_id userId, correct, total, score FROM quiz_runs WHERE mode = 'free' AND kind = ? AND tid = ? AND finished_at IS NOT NULL AND ${inCircle} ORDER BY score DESC, finished_at LIMIT 1`).get(t.kind, t.tid);
    kings.push({ kind: t.kind, title: brief(t.kind, t.tid), ...best });
  }
  const challenges = challengesFor(user);
  return {
    challenges, day, month, daily: { played: !!mine?.finished_at, started: !!mine && !mine.finished_at, ...(mine?.finished_at ? { correct: mine.correct, total: mine.total, score: mine.score } : {}) },
    today, monthRank, kings,
    users: usersById([...ids, ...kings.map(k => k.userId), ...challenges.received.map(c => c.fromId), ...challenges.sent.map(c => c.toId)]),
  };
});

// Sur la fiche d'un titre : le meilleur du cercle et mon record.
route('GET', /^\/api\/games\/title\/(tv|movie)\/(\d+)$/, async ({ user, match }) => {
  const [, kind, id] = match;
  const ids = [user.id, ...db.prepare(GROUP_MATES_SQL).all({ u: user.id }).map(r => r.user_id)];
  const inCircle = `user_id IN (${ids.map(Number).join(',')})`;
  const king = db.prepare(`SELECT user_id userId, correct, total, score FROM quiz_runs WHERE mode = 'free' AND kind = ? AND tid = ? AND finished_at IS NOT NULL AND ${inCircle} ORDER BY score DESC, finished_at LIMIT 1`).get(kind, Number(id));
  const mine = db.prepare(`SELECT correct, total, score FROM quiz_runs WHERE mode = 'free' AND kind = ? AND tid = ? AND finished_at IS NOT NULL AND user_id = ? ORDER BY score DESC LIMIT 1`).get(kind, Number(id), user.id);
  return { king: king || null, mine: mine || null, users: king ? usersById([king.userId]) : {} };
});

/* ================= Serveur HTTP ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { reject(httpError(413, 'Requête trop grosse.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(httpError(400, 'JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
    const ext = path.extname(file);
    const cache = ext === '.png' ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': cache });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  }
  try {
    const r = routes.find(r => r.method === req.method && r.pattern.test(url.pathname));
    if (!r) throw httpError(404, 'Route inconnue.');
    // Les écritures exigent du JSON : bloque les formulaires envoyés depuis d'autres sites.
    if (req.method === 'POST' && !(req.headers['content-type'] || '').startsWith('application/json')) throw httpError(415, 'JSON attendu.');
    const user = sessionUser(req);
    // Langue de l'appli qui demande (elle l'envoie à chaque requête), sinon celle du profil.
    const lg = req.headers['x-lang'] ? cleanLang(req.headers['x-lang']) : user?.lang || 'fr';
    await withLang(lg, async () => {
      if (r.auth && !user) throw httpError(401, 'Connecte-toi pour continuer.');
      const body = req.method === 'POST' ? await readBody(req) : {};
      const data = await r.handler({ req, res, url, body, user, match: url.pathname.match(r.pattern) });
      if (!res.writableEnded) send(res, 200, data);   // certaines routes (images) répondent elles-mêmes
    });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    const lg = req.headers['x-lang'] ? cleanLang(req.headers['x-lang']) : 'fr';
    send(res, status, { error: errorText(status === 500 ? 'Erreur du serveur.' : e.message, lg), ...(e.fields && { fields: e.fields }) });
  }
});

server.listen(PORT, HOST, () => console.log(`what2watch en marche sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

setTimeout(refreshTitles, 10e3);
setTimeout(() => backfillEnglish().catch(e => console.warn('Noms anglais :', e.message)), 60e3);
setInterval(refreshTitles, 3600e3);
setInterval(() => db.prepare('DELETE FROM sessions WHERE seen_at < ?').run(Date.now() - SESSION_MAX_AGE), DAY);
