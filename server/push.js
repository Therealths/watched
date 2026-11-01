'use strict';
// Notifications sur le téléphone (Web Push), sans dépendance : chiffrement RFC 8291 et signature VAPID (RFC 8292).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const b64u = buf => Buffer.from(buf).toString('base64url');

// Clés du serveur, créées une fois et gardées avec les données (jamais dans le dépôt).
function loadKeys(dir) {
  const file = path.join(dir, 'vapid.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  fs.writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 });
  return jwk;
}

function initPush(dir, subject) {
  const jwk = loadKeys(dir);
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const jwts = new Map(); // audience -> { t, exp }

  function vapidToken(aud) {
    const hit = jwts.get(aud);
    if (hit && hit.exp - Date.now() > 3600e3) return hit.t;
    const exp = Date.now() + 12 * 3600e3;
    const unsigned = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' +
      b64u(JSON.stringify({ aud, exp: Math.floor(exp / 1000), sub: subject }));
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    const t = unsigned + '.' + b64u(sig);
    jwts.set(aud, { t, exp });
    return t;
  }

  function encrypt(sub, payload) {
    const uaPublic = Buffer.from(sub.p256dh, 'base64url'), auth = Buffer.from(sub.auth, 'base64url');
    const ecdh = crypto.createECDH('prime256v1');
    const asPublic = ecdh.generateKeys();
    const shared = ecdh.computeSecret(uaPublic);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth,
      Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
    const salt = crypto.randomBytes(16);
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
    const head = Buffer.alloc(21);
    salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPublic.length;
    return Buffer.concat([head, asPublic, body]);
  }

  // Envoie un message à un appareil. Renvoie 'gone' si l'abonnement n'existe plus (à effacer).
  async function sendOne(sub, data) {
    const url = new URL(sub.endpoint);
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: `vapid t=${vapidToken(url.origin)}, k=${b64u(publicRaw)}`,
        'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream',
        ttl: String(data.ttl || 86400), urgency: 'normal',
        ...(data.topic ? { topic: data.topic } : {}),
      },
      body: encrypt(sub, JSON.stringify(data)),
      signal: AbortSignal.timeout(15e3),
    });
    if (r.status === 404 || r.status === 410) return 'gone';
    if (!r.ok) throw new Error(`push ${r.status} ${(await r.text()).slice(0, 200)}`);
    return 'ok';
  }

  return { publicKey: b64u(publicRaw), sendOne };
}

module.exports = { initPush };
