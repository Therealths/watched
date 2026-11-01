'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'sequence.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pass TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,                 -- empreinte SHA-256 du jeton du cookie
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      seen_at INTEGER NOT NULL
    );
    -- Infos TMDB partagées (séries et films), rafraîchies par le serveur.
    CREATE TABLE IF NOT EXISTS titles (
      kind TEXT NOT NULL,                     -- 'tv' | 'movie'
      id INTEGER NOT NULL,
      meta TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS user_shows (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      show_id INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, show_id)
    );
    CREATE TABLE IF NOT EXISTS watched (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      show_id INTEGER NOT NULL,
      s INTEGER NOT NULL,
      e INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (user_id, show_id, s, e)
    );
    CREATE INDEX IF NOT EXISTS watched_by_time ON watched (user_id, at);
    CREATE TABLE IF NOT EXISTS user_movies (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      movie_id INTEGER NOT NULL,
      status TEXT NOT NULL,                   -- 'watchlist' | 'watched'
      added_at INTEGER NOT NULL,
      watched_at INTEGER,
      PRIMARY KEY (user_id, movie_id)
    );
    -- Avis : kind 'tv' | 'movie' | 'ep' (tid = id de la série, s/e = épisode).
    CREATE TABLE IF NOT EXISTS reviews (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      tid INTEGER NOT NULL,
      s INTEGER NOT NULL DEFAULT 0,
      e INTEGER NOT NULL DEFAULT 0,
      rating INTEGER,
      text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, tid, s, e)
    );
    CREATE INDEX IF NOT EXISTS reviews_by_title ON reviews (kind, tid, s, e);
    -- Amitiés : a a demandé b ; status 'pending' | 'accepted'.
    CREATE TABLE IF NOT EXISTS friends (
      a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (a, b)
    );
    CREATE TABLE IF NOT EXISTS recos (
      id INTEGER PRIMARY KEY,
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      tid INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS recos_to ON recos (to_id, created_at);
    -- Conseils : un membre met un titre en avant pour tous les autres membres (un seul conseil par titre et par membre).
    CREATE TABLE IF NOT EXISTS picks (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      tid INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, tid)
    );
    CREATE INDEX IF NOT EXISTS picks_by_time ON picks (created_at);
    -- Titres qu'un membre a retirés de ses suggestions.
    CREATE TABLE IF NOT EXISTS picks_hidden (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      tid INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, tid)
    );
    -- Dernière visite de l'onglet Suggestions (pour la pastille « nouveau »).
    CREATE TABLE IF NOT EXISTS picks_seen (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      at INTEGER NOT NULL
    );
    -- Reprend les anciennes recommandations envoyées à des amis précis.
    INSERT OR IGNORE INTO picks (user_id, kind, tid, message, created_at)
      SELECT from_id, kind, tid, message, MIN(created_at) FROM recos GROUP BY from_id, kind, tid;
    -- Réponses aux avis : un avis est repéré par son auteur et son titre (author_id, kind, tid, s, e).
    CREATE TABLE IF NOT EXISTS review_replies (
      id INTEGER PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      tid INTEGER NOT NULL,
      s INTEGER NOT NULL DEFAULT 0,
      e INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS replies_by_review ON review_replies (kind, tid, s, e, author_id, created_at);
    -- Groupes d'amis : chacun voit dans son fil l'activité des membres de ses groupes.
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      invite TEXT NOT NULL UNIQUE,            -- code du lien d'invitation (#/join/<code>)
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS group_members_by_user ON group_members (user_id);
    CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT);
    -- Annonces de l'administrateur : une fenêtre affichée une seule fois à chaque membre.
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS announcement_seen (
      ann_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (ann_id, user_id)
    );
    -- Réactions emoji sur le fil : item = clé de l'activité ('eps:<membre>:<série>:<jour>', 'movie:…', 'review:…').
    CREATE TABLE IF NOT EXISTS reactions (
      item TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (item, user_id)
    );
    -- Notifications : un abonnement par appareil, des réglages par membre, et un journal pour ne rien envoyer deux fois.
    CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS push_subs_by_user ON push_subs (user_id);
    CREATE TABLE IF NOT EXISTS notif_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      prefs TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notif_log (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    -- Photos de profil (petites images envoyées par l'appli, déjà réduites).
    CREATE TABLE IF NOT EXISTS avatar_photos (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      mime TEXT NOT NULL,
      data BLOB NOT NULL
    );
  `);
  // Avatar : null (initiale), 'e<n>' (avatar prédéfini n) ou 'p<horodatage>' (photo, l'horodatage sert de version).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'avatar'").get()) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  // Arrivée des groupes : tous les membres déjà inscrits forment un premier groupe, pour que leur fil ne change pas.
  if (!db.prepare("SELECT 1 FROM app_meta WHERE k = 'groups_init'").get()) {
    const first = db.prepare('SELECT MIN(id) id FROM users').get().id;
    if (first != null) {
      const now = Date.now();
      const { lastInsertRowid: gid } = db.prepare('INSERT INTO groups (name, emoji, invite, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('Les potes', '🍿', require('node:crypto').randomBytes(9).toString('base64url'), first, now);
      db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) SELECT ?, id, ? FROM users').run(gid, now);
    }
    db.prepare("INSERT INTO app_meta (k, v) VALUES ('groups_init', '1')").run();
  }
  return db;
}

module.exports = { openDb };
