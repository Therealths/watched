'use strict';
// Langue : français par défaut, anglais si le membre l'a choisi dans son profil.
// La langue de la requête en cours est gardée ici, pour que chaque message (erreur, titre, notification) suive.
const { AsyncLocalStorage } = require('node:async_hooks');

const store = new AsyncLocalStorage();
const LANGS = ['fr', 'en'];
const cleanLang = v => (v === 'en' ? 'en' : 'fr');
const lang = () => store.getStore()?.lang || 'fr';
const withLang = (lg, fn) => store.run({ lang: cleanLang(lg) }, fn);
const tr = (fr, en) => (lang() === 'en' ? en : fr);
const locale = () => (lang() === 'en' ? 'en-US' : 'fr-FR');
const num = n => Number(n).toLocaleString(locale());

// Texte dans les deux langues (quiz du jour : les mêmes questions pour tout le monde).
const B = (fr, en) => ({ fr, en: en ?? fr });
const isB = v => v && typeof v === 'object' && !Array.isArray(v) && 'fr' in v && 'en' in v && Object.keys(v).length === 2;
// Choisit la langue dans un texte double (ou dans toutes les valeurs d'un objet / tableau).
function loc(v, lg = lang()) {
  if (isB(v)) return v[lg] ?? v.fr;
  if (Array.isArray(v)) return v.map(x => loc(x, lg));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, loc(x, lg)]));
  return v;
}

// Messages d'erreur du serveur, traduits au moment de les renvoyer.
const ERRORS = {
  'Abonnement invalide.': 'Invalid subscription.',
  'Activité introuvable.': 'Activity not found.',
  'Adresse mail invalide.': 'Invalid email address.',
  'Aucun appareil abonné.': 'No device subscribed.',
  'Avatar inconnu.': 'Unknown avatar.',
  'Ce lien d’invitation ne marche plus. Demande-en un nouveau.': 'This invite link no longer works. Ask for a new one.',
  'Ce pseudo est déjà pris.': 'This username is already taken.',
  'Cet avis n’existe plus.': 'This review no longer exists.',
  'Choisis au moins un ami.': 'Pick at least one friend.',
  'Connecte-toi pour continuer.': 'Sign in to continue.',
  'Défi introuvable.': 'Challenge not found.',
  'Donne un nom au groupe.': 'Give the group a name.',
  'Écris quelque chose avant d’envoyer.': 'Write something before sending.',
  'Groupe introuvable.': 'Group not found.',
  'Il faut un titre et un message.': 'A title and a message are required.',
  'Image invalide.': 'Invalid image.',
  'Image trop lourde.': 'Image is too large.',
  'Joue d’abord à ce quiz pour pouvoir défier tes amis.': 'Play this quiz first to challenge your friends.',
  'JSON attendu.': 'JSON expected.',
  'JSON invalide.': 'Invalid JSON.',
  'La note va de 1 à 5.': 'Ratings go from 1 to 5.',
  'Le mot de passe doit faire au moins 8 caractères.': 'Your password must be at least 8 characters.',
  'Le nom ne peut pas être vide.': 'The name can’t be empty.',
  'Le nouveau mot de passe doit faire au moins 8 caractères.': 'The new password must be at least 8 characters.',
  'Le service de notifications n’a pas répondu.': 'The notification service didn’t respond.',
  'Marque ce film comme vu avant de jouer à son quiz.': 'Mark this movie as watched before playing its quiz.',
  'Membre introuvable.': 'Member not found.',
  'Mot de passe actuel incorrect.': 'Current password is incorrect.',
  'Opération inconnue.': 'Unknown operation.',
  'Partie introuvable.': 'Game not found.',
  'Partie terminée.': 'Game over.',
  'Pas assez de séries et films regardés pour préparer le quiz du jour.': 'Not enough shows and movies watched yet to build the daily quiz.',
  'Pas assez d’infos sur ce titre pour en faire un quiz.': 'Not enough info on this title to make a quiz.',
  'Pas de photo.': 'No photo.',
  'Pseudo : 3 à 20 caractères, lettres minuscules, chiffres, point, tiret ou _.': 'Username: 3 to 20 characters, lowercase letters, digits, dot, dash or _.',
  'Pseudo ou mot de passe incorrect.': 'Wrong username or password.',
  'Question déjà passée.': 'Question already answered.',
  'Réaction invalide.': 'Invalid reaction.',
  'Regarde au moins un épisode avant de jouer à ce quiz.': 'Watch at least one episode before playing this quiz.',
  'Requête trop grosse.': 'Request too large.',
  'Réservé à l’administrateur.': 'Admin only.',
  'Ressource inconnue.': 'Unknown resource.',
  'Route inconnue.': 'Unknown route.',
  'Seul le créateur du groupe peut changer le lien.': 'Only the group’s creator can change the link.',
  'Seul le créateur du groupe peut retirer quelqu’un.': 'Only the group’s creator can remove someone.',
  'Statut de film invalide.': 'Invalid movie status.',
  'Trop de tentatives. Réessaie dans quelques minutes.': 'Too many attempts. Try again in a few minutes.',
  'Trop de tentatives. Réessaie dans une heure.': 'Too many attempts. Try again in an hour.',
  'Tu as déjà joué au quiz du jour. Reviens demain !': 'You’ve already played today’s quiz. Come back tomorrow!',
  'Tu as déjà relevé ce défi.': 'You’ve already taken this challenge.',
  'Tu fais déjà partie de 30 groupes.': 'You’re already in 30 groups.',
  'Type invalide.': 'Invalid type.',
  'Utilisateur introuvable.': 'User not found.',
  'Erreur du serveur.': 'Server error.',
  'Introuvable sur TMDB.': 'Not found on TMDB.',
  'TMDB ne répond pas.': 'TMDB isn’t responding.',
};
const ERROR_PATTERNS = [
  [/^Le nom « (.*) » est déjà pris par un autre membre\. .*$/s, m => `The name “${m[1]}” is already taken by another member. Pick another one (add your last name, an initial…).`],
  [/^Tu as déjà un groupe « (.*) »\. Choisis un autre nom\.$/s, m => `You already have a group called “${m[1]}”. Pick another name.`],
  [/^Valeur invalide : (.*)\.$/s, m => `Invalid value: ${m[1]}.`],
];
function errorText(msg, lg = lang()) {
  if (lg !== 'en') return msg;
  if (ERRORS[msg]) return ERRORS[msg];
  for (const [re, fn] of ERROR_PATTERNS) { const m = String(msg).match(re); if (m) return fn(m); }
  return msg;
}

module.exports = { LANGS, cleanLang, lang, withLang, tr, locale, num, B, isB, loc, errorText };
