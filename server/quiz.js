'use strict';
// Quiz : questions à choix multiples (ou vrai/faux) tirées des fiches TMDB (acteurs, personnages, années, affiches…).
// Les bonnes réponses restent sur le serveur ; l'appli ne reçoit que la question et les choix.
// Chaque texte est écrit en français et en anglais (B) : le serveur envoie la langue de celui qui joue.
const { B, isB } = require('./i18n');

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const sample = (a, n) => shuffle([...a]).slice(0, n);
const uniq = a => [...new Set(a)];

const NETWORKS = ['Netflix', 'HBO', 'Canal+', 'Disney+', 'Apple TV+', 'Prime Video', 'AMC', 'FX', 'TF1', 'France 2', 'ABC', 'NBC',
  'CBS', 'FOX', 'Showtime', 'BBC One', 'Hulu', 'Arte', 'M6', 'Paramount+', 'Starz', 'The CW', 'Adult Swim', 'Comedy Central'];
const DIRECTORS = ['Christopher Nolan', 'Steven Spielberg', 'Quentin Tarantino', 'Martin Scorsese', 'Denis Villeneuve', 'Ridley Scott',
  'James Cameron', 'David Fincher', 'Wes Anderson', 'Greta Gerwig', 'Luc Besson', 'Jean-Pierre Jeunet', 'Bong Joon-ho',
  'Guillermo del Toro', 'Peter Jackson', 'Tim Burton', 'Clint Eastwood', 'Jordan Peele', 'Sofia Coppola', 'Hayao Miyazaki',
  'Taika Waititi', 'Damien Chazelle', 'Sam Mendes', 'Zack Snyder', 'James Gunn', 'Michael Bay', 'Guy Ritchie', 'Jacques Audiard',
  'Céline Sciamma', 'Robert Zemeckis', 'George Lucas', 'Jon Favreau', 'Ari Aster', 'Edgar Wright', 'Matthew Vaughn'];
const CREATORS = ['Vince Gilligan', 'Dan Harmon', 'Shonda Rhimes', 'David Benioff', 'Ryan Murphy', 'Phoebe Waller-Bridge', 'Noah Hawley',
  'Damon Lindelof', 'Matt Groening', 'Steven Knight', 'Jesse Armstrong', 'Mike White', 'Craig Mazin', 'Christopher Storer',
  'Dan Erickson', 'Charlie Brooker', 'Greg Daniels', 'Larry David', 'Matthew Weiner', 'David Simon', 'Aaron Sorkin', 'Matt Duffer',
  'Jenji Kohan', 'Alan Ball', 'Eric Kripke', 'Seth MacFarlane', 'Chuck Lorre', 'Bill Lawrence', 'Michael Schur', 'Baran bo Odar'];

const COUNTRIES = ['US', 'GB', 'FR', 'CA', 'ES', 'DE', 'KR', 'JP', 'IT', 'DK', 'SE', 'AU', 'BE', 'MX', 'IN', 'NO', 'BR', 'IE'];
// Genres TMDB : [français, anglais].
const GENRES = {
  movie: [['Action', 'Action'], ['Aventure', 'Adventure'], ['Animation', 'Animation'], ['Comédie', 'Comedy'], ['Crime', 'Crime'],
    ['Documentaire', 'Documentary'], ['Drame', 'Drama'], ['Familial', 'Family'], ['Fantastique', 'Fantasy'], ['Histoire', 'History'],
    ['Horreur', 'Horror'], ['Musique', 'Music'], ['Mystère', 'Mystery'], ['Romance', 'Romance'], ['Science-Fiction', 'Science Fiction'],
    ['Thriller', 'Thriller'], ['Guerre', 'War'], ['Western', 'Western']],
  tv: [['Action & Adventure', 'Action & Adventure'], ['Animation', 'Animation'], ['Comédie', 'Comedy'], ['Crime', 'Crime'],
    ['Documentaire', 'Documentary'], ['Drame', 'Drama'], ['Familial', 'Family'], ['Kids', 'Kids'], ['Mystère', 'Mystery'],
    ['Science-Fiction & Fantastique', 'Sci-Fi & Fantasy'], ['War & Politics', 'War & Politics'], ['Western', 'Western'], ['Soap', 'Soap'], ['Reality', 'Reality']],
};
const regionNames = lg => { const dn = new Intl.DisplayNames(lg, { type: 'region' }); return c => { try { return dn.of(c); } catch { return c; } }; };
const countryFr = regionNames('fr'), countryEn = regionNames('en');
const countryName = c => B(countryFr(c), countryEn(c));
const money = n => B(n >= 1e9 ? `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} milliard${n >= 2e9 ? 's' : ''} $`
  : `${Math.round(n / 1e6).toLocaleString('fr-FR')} millions $`,
  n >= 1e9 ? `$${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })} billion` : `$${Math.round(n / 1e6).toLocaleString('en-US')} million`);
const ordinalEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
// Les choix chiffrés s'affichent dans l'ordre croissant.
const sortChoices = (r, val) => { if (r) { const a = r.c[r.a]; r.c.sort((x, y) => val(x) - val(y)); r.a = r.c.indexOf(a); } return r; };
const famous = t => (t.vote_count || 0) >= 150;
// Vrai ou faux : deux boutons, l'affirmation est vraie une fois sur deux.
const tf = (text, truth, extra) => ({ t: text, c: [{ l: B('Vrai', 'True') }, { l: B('Faux', 'False') }], a: truth ? 0 : 1, tf: 1, ...extra });

const dur = m => m >= 60 ? B(`${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`, `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`) : `${m} min`;

// Une question : 4 choix mélangés, l'index de la bonne réponse gardé à part (les choix se comparent sur leur texte français).
const key = c => { const l = c?.l ?? c; return isB(l) ? l.fr : l; };
function q(text, right, wrongs, extra = {}) {
  const seen = new Set([key(right)]);
  const others = wrongs.filter(w => !seen.has(key(w)) && seen.add(key(w))).slice(0, 3);
  if (others.length < 3) return null;
  const choices = shuffle([right, ...others].map(c => typeof c === 'string' || isB(c) ? { l: c } : c));
  return { t: text, c: choices, a: choices.findIndex(c => key(c) === key(right)), ...extra };
}

// Distribution principale d'un titre (sans les « lui-même », voix off…).
function castOf(d, kind) {
  const raw = kind === 'tv'
    ? (d.aggregate_credits?.cast || []).map(c => ({ pid: c.id, name: c.name, character: c.roles?.[0]?.character || '', photo: c.profile_path, n: c.total_episode_count || 0, order: c.order }))
    : (d.credits?.cast || []).map(c => ({ pid: c.id, name: c.name, character: c.character || '', photo: c.profile_path, n: 99, order: c.order }));
  const seen = new Set();
  return raw
    .map(c => ({ ...c, character: c.character.replace(/\s*\((voice|voix|uncredited|non crédité)[^)]*\)/gi, '').split(' / ')[0].trim() }))
    .filter(c => c.character && !/^(self|lui-même|elle-même|himself|herself|narrat)/i.test(c.character) && !seen.has(c.character) && seen.add(c.character))
    .sort((a, b) => a.order - b.order)
    .slice(0, 8);
}

/* ----- les familles de questions (chacune renvoie une question ou null) ----- */
// T.name : nom français (sert aux comparaisons) ; T.nm : nom dans les deux langues (sert aux textes).
const gens = {
  face(T) {
    const withPhoto = T.cast.filter(c => c.photo);
    if (T.cast.length < 4 || !withPhoto.length) return null;
    const c = pick(withPhoto.slice(0, 8));
    return q(B(`Qui est ce personnage de ${T.nm.fr} ?`, `Who is this character from ${T.nm.en}?`), c.character,
      sample(T.cast.filter(x => x !== c), 3).map(x => x.character), { img: c.photo, imgKind: 'profile', who: c.name, kind: 'face' });
  },
  year(T) {
    const y = Number(T.year);
    if (!y) return null;
    const offs = sample([-4, -3, -2, -1, 1, 2, 3], 3).filter(o => y + o <= new Date().getFullYear() + 1);
    if (offs.length < 3) offs.push(-5, -6);
    const r = q(T.kind === 'tv' ? B(`En quelle année a commencé ${T.nm.fr} ?`, `What year did ${T.nm.en} start?`) : B(`En quelle année est sorti ${T.nm.fr} ?`, `What year did ${T.nm.en} come out?`),
      String(y), offs.map(o => String(y + o)), { kind: 'year', who: '@year' });
    if (r) { const a = r.c[r.a].l; r.c.sort((x, b) => x.l - b.l); r.a = r.c.findIndex(c => c.l === a); }
    return r;
  },
  network(T) {
    const n = T.d.networks?.[0]?.name;
    if (T.kind !== 'tv' || !n) return null;
    return q(B(`Où a été diffusée ${T.nm.fr} à l’origine ?`, `Where did ${T.nm.en} originally air?`), n, sample(NETWORKS, 6), { kind: 'network', who: '@network' });
  },
  creator(T) {
    const n = T.d.created_by?.[0]?.name;
    if (T.kind !== 'tv' || !n) return null;
    return q(B(`Qui a créé ${T.nm.fr} ?`, `Who created ${T.nm.en}?`), n, sample(CREATORS, 6), { kind: 'creator' });
  },
  director(T) {
    const n = T.d.credits?.crew?.find(c => c.job === 'Director')?.name;
    if (T.kind !== 'movie' || !n) return null;
    return q(B(`Qui a réalisé ${T.nm.fr} ?`, `Who directed ${T.nm.en}?`), n, sample(DIRECTORS, 6), { kind: 'director', who: '@director' });
  },
  seasons(T) {
    const n = T.d.number_of_seasons;
    if (T.kind !== 'tv' || !(n >= 2)) return null;
    const wrong = sample([-3, -2, -1, 1, 2, 3].map(o => n + o).filter(x => x >= 1), 3);
    const r = q(B(`Combien de saisons compte ${T.nm.fr} pour l’instant ?`, `How many seasons does ${T.nm.en} have so far?`), String(n), wrong.map(String), { kind: 'seasons' });
    if (r) { const a = r.c[r.a].l; r.c.sort((x, b) => x.l - b.l); r.a = r.c.findIndex(c => c.l === a); }
    return r;
  },
  runtime(T) {
    const m = T.d.runtime;
    if (T.kind !== 'movie' || !(m > 40)) return null;
    const wrong = sample([-45, -30, -15, 15, 30, 45], 3).map(o => ({ l: dur(m + o), m: m + o }));
    const r = q(B(`Combien de temps dure ${T.nm.fr} ?`, `How long is ${T.nm.en}?`), { l: dur(m), m }, wrong, { kind: 'runtime' });
    if (r) { const a = r.c[r.a]; r.c.sort((x, y) => x.m - y.m); r.a = r.c.indexOf(a); for (const c of r.c) delete c.m; }
    return r;
  },
  image(T, pool) {
    const img = T.d.backdrop_path;
    const others = pool.filter(x => x.kind === T.kind && x.name !== T.name);
    if (!img || others.length < 3) return null;
    return q(T.kind === 'tv' ? B('De quelle série vient cette image ?', 'Which show is this image from?') : B('De quel film vient cette image ?', 'Which movie is this image from?'), T.nm,
      sample(others, 3).map(x => x.nm), { img, imgKind: 'backdrop', kind: 'image' });
  },
  // Résumé sans le nom du titre (quiz du jour : les autres titres servent de mauvaises réponses).
  synopsis(T, pool) {
    const others = (pool || []).filter(x => x.kind === T.kind && x.name !== T.name);
    const names = uniq([T.nm.fr, T.nm.en, T.d.original_name, T.d.original_title].filter(Boolean));
    const hide = o => {
      o = (o || '').trim();
      for (const w of names) o = o.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '…');
      return o.length > 300 ? o.slice(0, 300).replace(/\s+\S*$/, '') + '…' : o;
    };
    const fr = hide(T.d.overview), en = hide(T.dEn?.overview);
    if (fr.length < 60 || others.length < 3) return null;
    return q(T.kind === 'tv' ? B('De quelle série parle ce résumé ?', 'Which show is this summary about?') : B('De quel film parle ce résumé ?', 'Which movie is this summary about?'), T.nm,
      sample(others, 3).map(x => x.nm), { x: B(fr, en.length >= 60 ? en : fr), kind: 'synopsis' });
  },
  // Affiche floue qui se dévoile avec le temps (plus on répond tôt, plus on gagne).
  poster(T, pool) {
    const img = T.d.poster_path;
    const others = (pool || []).filter(x => x.kind === T.kind && x.name !== T.name);
    if (!img || others.length < 3) return null;
    return q(T.kind === 'tv' ? B('Quelle série se cache derrière cette affiche ?', 'Which show is hiding behind this poster?') : B('Quel film se cache derrière cette affiche ?', 'Which movie is hiding behind this poster?'), T.nm,
      sample(others, 3).map(x => x.nm), { img, imgKind: 'reveal', kind: 'poster' });
  },
  tagline(T, pool) {
    const tl = (T.d.tagline || '').trim();
    let en = (T.dEn?.tagline || '').trim();
    if (en.length < 8 || en.toLowerCase().includes(T.nm.en.toLowerCase())) en = tl;
    const others = (pool || []).filter(x => x.kind === 'movie' && x.name !== T.name);
    if (T.kind !== 'movie' || tl.length < 8 || others.length < 3 || tl.toLowerCase().includes(T.name.toLowerCase())) return null;
    return q(B('Quel film a ce slogan ?', 'Which movie has this tagline?'), T.nm, sample(others, 3).map(x => x.nm), { x: B(`« ${tl} »`, `“${en}”`), kind: 'tagline' });
  },
  // L'intrus : un acteur d'un titre voisin, jamais crédité dans celui-ci.
  intruder(T, pool) {
    const outs = (pool ? pool.filter(x => x !== T).flatMap(x => x.cast) : T.near).filter(c => c.photo && !T.allNames.has(c.name));
    const ins = T.cast.filter(c => c.photo);
    if (ins.length < 3 || !outs.length) return null;
    const o = pick(outs.slice(0, 12));
    return q(B(`Lequel de ces acteurs ne joue pas dans ${T.nm.fr} ?`, `Which of these actors is not in ${T.nm.en}?`), { l: o.name, img: o.photo },
      sample(ins, 3).map(c => ({ l: c.name, img: c.photo })), { kind: 'intruder' });
  },
  // Un autre rôle connu d'un acteur (quiz d'un titre : sa filmographie est chargée à l'avance).
  otherRole(T) {
    const r = T.roles?.length ? T.roles.shift() : null;
    const wrongPool = T.recs.filter(x => !r?.titles.has(x.name)).map(x => x.nm);
    if (!r || !r.known.length || wrongPool.length < 3) return null;
    const right = pick(r.known.slice(0, 4));
    return q(B(`Dans quel autre titre a joué ${r.actor.name} ?`, `What else has ${r.actor.name} been in?`), right, sample(wrongPool, 3),
      { img: r.actor.photo, imgKind: 'profile', who: r.actor.name, kind: 'otherRole' });
  },
  saga(T) {
    const c = T.collection;
    const enTitle = id => T.collectionEn?.parts?.find(p => p.id === id)?.title;
    const parts = (c?.parts || []).filter(p => p.release_date && p.release_date <= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.release_date.localeCompare(b.release_date)).map(p => ({ ...p, nm: B(p.title, enTitle(p.id) || p.title) }));
    if (T.kind !== 'movie' || parts.length < 2) return null;
    const clean = n => n.replace(/\s*[-–:]?\s*(la )?(saga|collection)\s*$/i, '').replace(/^(la )?(saga|collection)\s*/i, '').trim() || n;
    const saga = clean(c.name), sagaEn = T.collectionEn?.name ? clean(T.collectionEn.name) : saga;
    if (parts.length >= 4) {
      const n = Math.floor(Math.random() * Math.min(parts.length, 4));
      const label = n === 0 ? 'Quel est le premier film' : `Quel est le ${n + 1}ᵉ film`;
      const labelEn = n === 0 ? 'Which is the first movie' : `Which is the ${ordinalEn(n + 1)} movie`;
      return q(B(`${label} de la saga ${saga} ?`, `${labelEn} in the ${sagaEn} saga?`), parts[n].nm, sample(parts.filter((_, i) => i !== n), 3).map(p => p.nm), { kind: 'saga' });
    }
    const n = parts.length;
    return sortChoices(q(B(`Combien de films compte la saga ${saga} ?`, `How many movies are in the ${sagaEn} saga?`), String(n), sample([n - 1, n + 1, n + 2, n + 3, n + 4].filter(x => x >= 1), 3).map(String), { kind: 'saga' }), x => Number(x.l));
  },
  episodes(T) {
    const n = T.d.number_of_episodes;
    if (T.kind !== 'tv' || !(n >= 8)) return null;
    const wrong = uniq([.5, .7, 1.4, 1.8, 2.3].map(f => Math.max(2, Math.round(n * f)))).filter(x => x !== n);
    return sortChoices(q(B(`Combien d’épisodes compte ${T.nm.fr} en tout ?`, `How many episodes does ${T.nm.en} have in total?`), String(n), sample(wrong, 3).map(String), { kind: 'episodes' }), x => Number(x.l));
  },
  // Le mieux noté parmi 4 titres connus (écarts d'au moins 0,3 point pour que ce soit jouable).
  rating(T, pool) {
    const cands = [T, ...(pool ? pool.filter(x => x.kind === T.kind) : T.recs)]
      .map(x => ({ name: x.name, nm: x.nm, v: x.d ? x.d.vote_average : x.vote_average, n: x.d ? x.d.vote_count : x.vote_count }))
      .filter(x => x.v && x.n >= 150);
    const picked = [];
    for (const c of shuffle(cands)) if (!picked.some(p => p.name === c.name || Math.abs(p.v - c.v) < .3) && picked.push(c) >= 4) break;
    if (picked.length < 4 || !picked.some(p => p.name === T.name)) return null;
    const best = picked.reduce((a, b) => (b.v > a.v ? b : a));
    return q(T.kind === 'tv' ? B('Laquelle de ces séries a la meilleure note sur TMDB ?', 'Which of these shows is rated highest on TMDB?') : B('Lequel de ces films a la meilleure note sur TMDB ?', 'Which of these movies is rated highest on TMDB?'),
      best.nm, picked.filter(p => p !== best).map(p => p.nm), { kind: 'rating' });
  },
  boxoffice(T) {
    const n = T.d.revenue;
    if (T.kind !== 'movie' || !(n >= 5e6)) return null;
    const vals = [.25, .5, 2, 3.5].map(f => n * f);
    const r = q(B(`Combien a rapporté ${T.nm.fr} au box-office mondial ?`, `How much did ${T.nm.en} make at the worldwide box office?`), { l: money(n), v: n },
      sample(vals, 3).map(v => ({ l: money(v), v })), { kind: 'boxoffice' });
    sortChoices(r, x => x.v);
    if (r) for (const c of r.c) delete c.v;
    return r;
  },
  country(T) {
    const code = T.kind === 'tv' ? T.d.origin_country?.[0] : T.d.production_countries?.[0]?.iso_3166_1;
    if (!code) return null;
    const all = new Set([...(T.d.origin_country || []), ...(T.d.production_countries || []).map(c => c.iso_3166_1)]);
    return q(B(`De quel pays vient ${T.nm.fr} ?`, `What country is ${T.nm.en} from?`), countryName(code), sample(COUNTRIES.filter(c => !all.has(c)), 3).map(countryName), { kind: 'country' });
  },
  genre(T) {
    const enOf = id => T.dEn?.genres?.find(g => g.id === id)?.name;
    const mine = (T.d.genres || []).map(g => B(g.name, enOf(g.id) || g.name));
    if (!mine.length) return null;
    const own = new Set(mine.map(g => g.fr));
    return q(B(`Lequel de ces genres correspond à ${T.nm.fr} ?`, `Which of these genres fits ${T.nm.en}?`), pick(mine),
      sample(GENRES[T.kind].filter(([fr]) => !own.has(fr)), 3).map(([fr, en]) => B(fr, en)), { kind: 'genre' });
  },
  // Vrai ou faux : une affirmation sur l'année, la chaîne ou le réalisateur.
  tf(T) {
    const truth = Math.random() < .5, opts = [];
    const y = Number(T.year);
    if (y) opts.push(() => { const yy = truth ? y : y + pick([-3, -2, -1, 1, 2]); return tf(B(`Vrai ou faux : ${T.nm.fr} ${T.kind === 'tv' ? 'a commencé' : 'est sorti'} en ${yy}.`, `True or false: ${T.nm.en} ${T.kind === 'tv' ? 'started' : 'came out'} in ${yy}.`), truth, { who: '@year' }); });
    const net = T.d.networks?.[0]?.name;
    if (T.kind === 'tv' && net) opts.push(() => { const n = truth ? net : pick(NETWORKS.filter(x => x !== net)); return tf(B(`Vrai ou faux : ${T.nm.fr} a d’abord été diffusée sur ${n}.`, `True or false: ${T.nm.en} first aired on ${n}.`), truth, { who: '@network' }); });
    const dir = T.d.credits?.crew?.find(c => c.job === 'Director')?.name;
    if (T.kind === 'movie' && dir) opts.push(() => { const n = truth ? dir : pick(DIRECTORS.filter(x => x !== dir)); return tf(B(`Vrai ou faux : ${T.nm.fr} a été réalisé par ${n}.`, `True or false: ${T.nm.en} was directed by ${n}.`), truth, { who: '@director' }); });
    if (!opts.length) return null;
    return { ...pick(opts)(), kind: 'tf' };
  },
};

function createQuiz({ tmdb }) {
  // Toutes les infos utiles d'un titre (cache TMDB de 6 h). « deep » : quiz d'un titre, on charge aussi
  // la saga, la filmographie de deux acteurs et le casting d'un titre voisin (pour l'intrus).
  async function titleData(kind, id, deep = false) {
    const [d, dEn] = await Promise.all([
      tmdb(`/${kind}/${id}`, { append_to_response: (kind === 'tv' ? 'aggregate_credits' : 'credits') + ',recommendations' }, 6 * 3600e3),
      tmdb(`/${kind}/${id}`, { append_to_response: 'recommendations', language: 'en-US' }, 6 * 3600e3).catch(() => null),
    ]);
    const all = kind === 'tv' ? d.aggregate_credits?.cast || [] : d.credits?.cast || [];
    const name = d.name || d.title;
    const recEn = new Map((dEn?.recommendations?.results || []).map(r => [r.id, r.name || r.title]));
    const T = { kind, id, d, dEn, name, nm: B(name, dEn?.name || dEn?.title || name), year: (d.first_air_date || d.release_date || '').slice(0, 4), cast: castOf(d, kind),
      allNames: new Set(all.map(c => c.name)),
      recs: (d.recommendations?.results || []).filter(famous).map(r => ({ name: r.name || r.title, nm: B(r.name || r.title, recEn.get(r.id) || r.name || r.title), vote_average: r.vote_average, vote_count: r.vote_count })),
      near: [], roles: [] };
    if (!deep) return T;
    const tasks = [];
    if (kind === 'movie' && d.belongs_to_collection?.id)
      tasks.push(tmdb(`/collection/${d.belongs_to_collection.id}`, {}, 6 * 3600e3).then(c => { T.collection = c; }),
        tmdb(`/collection/${d.belongs_to_collection.id}`, { language: 'en-US' }, 6 * 3600e3).then(c => { T.collectionEn = c; }));
    const nb = (d.recommendations?.results || [])[0];
    if (nb) tasks.push(tmdb(`/${kind}/${nb.id}`, { append_to_response: kind === 'tv' ? 'aggregate_credits' : 'credits' }, 6 * 3600e3)
      .then(x => { T.near = castOf(x, kind); }));
    for (const actor of sample(T.cast.filter(c => c.pid && c.photo).slice(0, 6), 2)) {
      tasks.push(Promise.all([tmdb(`/person/${actor.pid}/combined_credits`, {}, 6 * 3600e3),
        tmdb(`/person/${actor.pid}/combined_credits`, { language: 'en-US' }, 6 * 3600e3).catch(() => null)]).then(([cr, crEn]) => {
        const en = new Map((crEn?.cast || []).map(x => [x.media_type + x.id, x.name || x.title]));
        const roles = (cr.cast || []).filter(x => !(x.media_type === kind && x.id === id) && !(x.genre_ids || []).some(g => [10767, 10763, 99].includes(g))
          && !/^(self|lui-même|elle-même|himself|herself)/i.test(x.character || ''));
        const titles = new Set(roles.map(x => x.name || x.title));
        const known = [], seen = new Set();
        for (const x of roles.filter(x => x.media_type === kind && famous(x)).sort((a, b) => b.vote_count - a.vote_count)) {
          const fr = x.name || x.title;
          if (!seen.has(fr) && seen.add(fr)) known.push(B(fr, en.get(x.media_type + x.id) || fr));
        }
        T.roles.push({ actor, titles, known });
      }));
    }
    await Promise.allSettled(tasks);
    return T;
  }

  const strip = x => { const { kind, who, ...rest } = x; return rest; };

  // Quiz libre sur un titre : 10 questions variées (pas de titres d'épisodes, impossibles à retenir).
  async function freeQuiz(kind, id) {
    const T = await titleData(kind, id, true);
    const plan = kind === 'tv'
      ? ['face', 'face', 'face', 'face', 'year', 'network', 'creator', 'seasons', 'episodes', 'intruder', 'otherRole', 'otherRole',
        'rating', 'country', 'genre', 'tf', 'tf', 'face']
      : ['face', 'face', 'face', 'face', 'year', 'director', 'runtime', 'saga', 'boxoffice', 'intruder', 'otherRole', 'otherRole',
        'rating', 'country', 'genre', 'tf', 'tf', 'face'];
    // Chaque personne (ou info : année, chaîne, réalisateur) ne sert qu'une fois, et jamais deux fois la même question.
    const out = [], usedWho = new Set(), usedText = new Set();
    for (let tries = 0; tries < 3 && out.length < 10; tries++) {
      for (const g of shuffle([...plan])) {
        if (out.length >= 10) break;
        const x = gens[g](T);
        const key = x && JSON.stringify(x.t) + (x.img || '');
        if (!x || usedText.has(key) || (x.who && usedWho.has(x.who))) continue;
        if (x.who) usedWho.add(x.who);
        usedText.add(key); out.push(x);
      }
    }
    return { title: T.nm, questions: shuffle(out).slice(0, 10).map(strip) };
  }

  // Quiz du jour : une question par titre, parmi les titres les plus regardés de l'appli.
  async function dailyQuiz(titles) {
    const pool = [];
    for (const t of titles) {
      try { pool.push(await titleData(t.kind, t.id)); } catch { /* titre indisponible */ }
      if (pool.length >= 16) break;
    }
    const kinds = ['image', 'poster', 'synopsis', 'face', 'tagline', 'year', 'intruder', 'rating', 'face', 'tf', 'network',
      'boxoffice', 'director', 'creator', 'episodes', 'seasons', 'country', 'runtime', 'genre', 'image', 'poster', 'synopsis'];
    const out = [];
    let k = 0;
    for (const T of shuffle([...pool])) {
      if (out.length >= 10) break;
      for (let i = 0; i < kinds.length; i++) {
        const x = gens[kinds[(k + i) % kinds.length]](T, pool);
        if (x) { out.push(strip(x)); k += i + 1; break; }
      }
    }
    return out;
  }

  return { freeQuiz, dailyQuiz };
}

module.exports = { createQuiz };
