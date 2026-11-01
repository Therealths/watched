'use strict';
// Quiz : questions à choix multiples tirées des fiches TMDB (acteurs, personnages, épisodes, années…).
// Les bonnes réponses restent sur le serveur ; l'appli ne reçoit que la question et les choix.

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

const code = (s, e) => `S${String(s).padStart(2, '0')} E${String(e).padStart(2, '0')}`;
const dur = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
// « Épisode 5 », « Episode 5 » : pas un vrai titre.
const realEpName = n => n && !/^(é|e)pisode\s*\d+$/i.test(n.trim());

// Une question : 4 choix mélangés, l'index de la bonne réponse gardé à part.
function q(text, right, wrongs, extra = {}) {
  const others = uniq(wrongs.filter(w => (w.l ?? w) !== (right.l ?? right))).slice(0, 3);
  if (others.length < 3) return null;
  const choices = shuffle([right, ...others].map(c => typeof c === 'string' ? { l: c } : c));
  return { t: text, c: choices, a: choices.findIndex(c => c.l === (right.l ?? right)), ...extra };
}

// Distribution principale d'un titre (sans les « lui-même », voix off…).
function castOf(d, kind) {
  const raw = kind === 'tv'
    ? (d.aggregate_credits?.cast || []).map(c => ({ name: c.name, character: c.roles?.[0]?.character || '', photo: c.profile_path, n: c.total_episode_count || 0, order: c.order }))
    : (d.credits?.cast || []).map(c => ({ name: c.name, character: c.character || '', photo: c.profile_path, n: 99, order: c.order }));
  const seen = new Set();
  return raw
    .map(c => ({ ...c, character: c.character.replace(/\s*\((voice|voix|uncredited|non crédité)[^)]*\)/gi, '').split(' / ')[0].trim() }))
    .filter(c => c.character && !/^(self|lui-même|elle-même|himself|herself|narrat)/i.test(c.character) && !seen.has(c.character) && seen.add(c.character))
    .sort((a, b) => a.order - b.order)
    .slice(0, 8);
}

/* ----- les familles de questions (chacune renvoie une question ou null) ----- */
const gens = {
  actor(T) {
    if (T.cast.length < 4) return null;
    const c = pick(T.cast.slice(0, 6));
    return q(`Qui joue ${c.character} dans ${T.name} ?`, { l: c.name, img: c.photo },
      sample(T.cast.filter(x => x !== c), 3).map(x => ({ l: x.name, img: x.photo })), { who: c.name, kind: 'actor' });
  },
  character(T) {
    const withPhoto = T.cast.filter(c => c.photo);
    if (T.cast.length < 4 || !withPhoto.length) return null;
    const c = pick(withPhoto.slice(0, 6));
    return q(`Quel personnage joue ${c.name} dans ${T.name} ?`, c.character,
      sample(T.cast.filter(x => x !== c), 3).map(x => x.character), { img: c.photo, imgKind: 'profile', who: c.name, kind: 'character' });
  },
  face(T) {
    const withPhoto = T.cast.filter(c => c.photo);
    if (T.cast.length < 4 || !withPhoto.length) return null;
    const c = pick(withPhoto.slice(0, 8));
    return q(`Comment s’appelle ce personnage de ${T.name} ?`, c.character,
      sample(T.cast.filter(x => x !== c), 3).map(x => x.character), { img: c.photo, imgKind: 'profile', who: c.name, kind: 'face' });
  },
  year(T) {
    const y = Number(T.year);
    if (!y) return null;
    const offs = sample([-4, -3, -2, -1, 1, 2, 3], 3).filter(o => y + o <= new Date().getFullYear() + 1);
    if (offs.length < 3) offs.push(-5, -6);
    const r = q(T.kind === 'tv' ? `En quelle année a commencé ${T.name} ?` : `En quelle année est sorti ${T.name} ?`,
      String(y), offs.map(o => String(y + o)), { kind: 'year' });
    if (r) { const a = r.c[r.a].l; r.c.sort((x, b) => x.l - b.l); r.a = r.c.findIndex(c => c.l === a); }
    return r;
  },
  network(T) {
    const n = T.d.networks?.[0]?.name;
    if (T.kind !== 'tv' || !n) return null;
    return q(`Où a été diffusée ${T.name} à l’origine ?`, n, sample(NETWORKS, 6), { kind: 'network' });
  },
  creator(T) {
    const n = T.d.created_by?.[0]?.name;
    if (T.kind !== 'tv' || !n) return null;
    return q(`Qui a créé ${T.name} ?`, n, sample(CREATORS, 6), { kind: 'creator' });
  },
  director(T) {
    const n = T.d.credits?.crew?.find(c => c.job === 'Director')?.name;
    if (T.kind !== 'movie' || !n) return null;
    return q(`Qui a réalisé ${T.name} ?`, n, sample(DIRECTORS, 6), { kind: 'director' });
  },
  seasons(T) {
    const n = T.d.number_of_seasons;
    if (T.kind !== 'tv' || !(n >= 2)) return null;
    const wrong = sample([-3, -2, -1, 1, 2, 3].map(o => n + o).filter(x => x >= 1), 3);
    const r = q(`Combien de saisons compte ${T.name} pour l’instant ?`, String(n), wrong.map(String), { kind: 'seasons' });
    if (r) { const a = r.c[r.a].l; r.c.sort((x, b) => x.l - b.l); r.a = r.c.findIndex(c => c.l === a); }
    return r;
  },
  runtime(T) {
    const m = T.d.runtime;
    if (T.kind !== 'movie' || !(m > 40)) return null;
    const wrong = sample([-45, -30, -15, 15, 30, 45], 3).map(o => ({ l: dur(m + o), m: m + o }));
    const r = q(`Combien de temps dure ${T.name} ?`, { l: dur(m), m }, wrong, { kind: 'runtime' });
    if (r) { const a = r.c[r.a]; r.c.sort((x, y) => x.m - y.m); r.a = r.c.indexOf(a); for (const c of r.c) delete c.m; }
    return r;
  },
  image(T, pool) {
    const img = T.d.backdrop_path;
    const others = pool.filter(x => x.kind === T.kind && x.name !== T.name);
    if (!img || others.length < 3) return null;
    return q(T.kind === 'tv' ? 'De quelle série vient cette image ?' : 'De quel film vient cette image ?', T.name,
      sample(others, 3).map(x => x.name), { img, imgKind: 'backdrop', kind: 'image' });
  },
  episode(T) {
    const named = T.eps.filter(e => realEpName(e.name));
    if (named.length < 4) return null;
    const e = pick(named);
    const near = named.filter(x => x !== e && x.s === e.s);
    const wrongs = (near.length >= 3 ? sample(near, 3) : sample(named.filter(x => x !== e), 3)).map(x => x.name);
    return q(`Comment s’appelle l’épisode ${code(e.s, e.e)} de ${T.name} ?`, e.name, wrongs, { kind: 'episode', who: 'ep' + e.s + 'x' + e.e });
  },
  epSeason(T) {
    const named = T.eps.filter(e => realEpName(e.name));
    const seasons = uniq(T.eps.map(e => e.s)).sort((a, b) => a - b);
    if (named.length < 2 || seasons.length < 2) return null;
    const e = pick(named);
    const all = uniq([...seasons, ...[1, 2, 3, 4, 5, 6]]).filter(s => s !== e.s);
    const wrong = all.sort((a, b) => Math.abs(a - e.s) - Math.abs(b - e.s)).slice(0, 3);
    const r = q(`Dans quelle saison de ${T.name} se trouve l’épisode « ${e.name} » ?`, `Saison ${e.s}`, wrong.map(s => `Saison ${s}`), { kind: 'epSeason', who: 'ep' + e.s + 'x' + e.e });
    if (r) { const a = r.c[r.a].l; r.c.sort((x, b) => x.l.localeCompare(b.l, 'fr', { numeric: true })); r.a = r.c.findIndex(c => c.l === a); }
    return r;
  },
};

function createQuiz({ tmdb }) {
  // Toutes les infos utiles d'un titre (cache TMDB de 6 h), avec les épisodes déjà vus pour les séries.
  async function titleData(kind, id, watchedEps = []) {
    const d = await tmdb(`/${kind}/${id}`, { append_to_response: kind === 'tv' ? 'aggregate_credits' : 'credits' }, 6 * 3600e3);
    const T = { kind, id, d, name: d.name || d.title, year: (d.first_air_date || d.release_date || '').slice(0, 4), cast: castOf(d, kind), eps: [] };
    if (kind === 'tv' && watchedEps.length) {
      const seasons = uniq(watchedEps.map(w => w.s)).slice(-4);
      for (const s of seasons) {
        try {
          const sd = await tmdb(`/tv/${id}/season/${s}`, {}, 6 * 3600e3);
          for (const ep of sd.episodes || []) if (watchedEps.some(w => w.s === s && w.e === ep.episode_number)) T.eps.push({ s, e: ep.episode_number, name: ep.name });
        } catch { /* saison introuvable : on fait sans */ }
      }
    }
    return T;
  }

  const strip = x => { const { kind, who, ...rest } = x; return rest; };

  // Quiz libre sur un titre : 10 questions variées, sans spoiler (seulement les épisodes vus).
  async function freeQuiz(kind, id, watchedEps) {
    const T = await titleData(kind, id, watchedEps);
    const plan = kind === 'tv'
      ? ['actor', 'actor', 'actor', 'character', 'face', 'face', 'episode', 'episode', 'episode', 'epSeason', 'year', 'network', 'creator', 'seasons', 'character']
      : ['actor', 'actor', 'actor', 'character', 'character', 'face', 'face', 'year', 'director', 'runtime', 'actor', 'face'];
    // Chaque personne ou épisode ne sert qu'une fois, et jamais deux fois la même question.
    const out = [], usedWho = new Set(), usedText = new Set();
    for (let tries = 0; tries < 3 && out.length < 10; tries++) {
      for (const g of shuffle([...plan])) {
        if (out.length >= 10) break;
        const x = gens[g](T);
        if (!x || usedText.has(x.t) || (x.who && usedWho.has(x.who))) continue;
        if (x.who) usedWho.add(x.who);
        usedText.add(x.t); out.push(x);
      }
    }
    return { title: T.name, questions: shuffle(out).slice(0, 10).map(strip) };
  }

  // Quiz du jour : une question par titre, parmi les titres les plus regardés de l'appli.
  async function dailyQuiz(titles) {
    const pool = [];
    for (const t of titles) {
      try { pool.push(await titleData(t.kind, t.id)); } catch { /* titre indisponible */ }
      if (pool.length >= 16) break;
    }
    const kinds = ['image', 'actor', 'face', 'year', 'character', 'image', 'network', 'director', 'creator', 'seasons', 'runtime', 'face', 'actor', 'image'];
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
