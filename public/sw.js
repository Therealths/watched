// Garde l'appli disponible hors connexion. Change VERSION à chaque mise à jour des fichiers.
const VERSION = 'what2watch-v45';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

// Les fichiers de l'appli sont tous téléchargés d'un coup, frais (sans cache du navigateur), à chaque nouvelle version :
// ils restent toujours assortis entre eux.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Fichiers de l'appli : réponse immédiate depuis le cache de cette version. Ils ne changent qu'avec une nouvelle version
// (jamais un par un, sinon le style et le code pourraient ne plus aller ensemble).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Les données (/api) viennent toujours du serveur, jamais du cache.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(e.request);
    if (res.ok) cache.put(e.request, res.clone());
    return res;
  }));
});

// Notifications : affichées même appli fermée ; un appui ouvre la bonne page.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'what2watch', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'what2watch', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, data: { url: d.url || '#/' },
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', lang: 'fr',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(self.registration.scope);
  url.hash = (e.notification.data?.url || '#/').replace(/^#/, '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const win = list.find(c => c.url.startsWith(self.registration.scope));
    if (!win) return self.clients.openWindow(url.href);
    // Appli déjà ouverte : on la ramène devant et elle va elle-même à la bonne page (sans tout recharger).
    await win.focus();
    win.postMessage({ go: url.hash });
  }));
});
