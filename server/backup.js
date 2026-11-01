'use strict';
// Sauvegarde de la base : copie propre (même pendant l'utilisation), on garde les 14 dernières.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const OUT = process.env.BACKUP_DIR || path.join(os.homedir(), 'Sauvegardes what2watch');
const KEEP = 14;

fs.mkdirSync(OUT, { recursive: true });
const d = new Date(), p2 = n => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}h${p2(d.getMinutes())}`;
const file = path.join(OUT, `what2watch-${stamp}.db`);
const db = new DatabaseSync(path.join(DATA, 'sequence.db'));
db.exec('PRAGMA busy_timeout = 10000');
if (fs.existsSync(file)) fs.rmSync(file);
db.prepare('VACUUM INTO ?').run(file);
db.close();

const old = fs.readdirSync(OUT).filter(f => /^what2watch-.*\.db$/.test(f)).sort();
for (const f of old.slice(0, Math.max(0, old.length - KEEP))) fs.rmSync(path.join(OUT, f));
console.log('Sauvegarde :', file);
