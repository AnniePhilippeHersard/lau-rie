// Outils et contenus partagés par les trois pages (site, galerie, espace photographe).
export const $ = (id) => document.getElementById(id);
export const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const euro = (n) => Number(n || 0).toLocaleString("fr-FR") + " €";
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Stockage du navigateur : tout est protégé (navigation privée, stockage bloqué…)
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
export const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* idem */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* idem */ } },
};

let toastT = null;
export function toast(msg, ms = 3600) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), ms);
}

export function copy(text, note, ok) {
  const done = () => { if (note) note.textContent = ok; };
  try { navigator.clipboard.writeText(text).then(done, () => { if (note) note.textContent = text; }); }
  catch { if (note) note.textContent = text; }
}

// Dates « AAAA-MM-JJ » ou ISO
const dayOf = (d) => new Date(String(d).slice(0, 10) + "T12:00:00");
export function fdate(d, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!d) return "Date à définir";
  const x = dayOf(d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("fr-FR", opts);
}
export function daysTo(d) {
  if (!d) return null;
  const x = dayOf(d), n = new Date();
  n.setHours(12, 0, 0, 0);
  return Math.round((x - n) / 864e5);
}
export function addDays(d, k) {
  const x = dayOf(d);
  x.setDate(x.getDate() + k);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}
export const ymd = (d) => (d ? String(d).slice(0, 10) : "");

// ---------------------------------------------------------------- images
// Photos d'exemple (Unsplash), affichées tant que la photographe n'a pas mis les siennes.
export const DEMO_DIMS = {"bouquet": [1484, 924], "bw-beach": [1000, 581], "church": [1000, 664], "couple-path": [1484, 986], "dance": [1484, 986], "dark-dress": [1000, 932], "family-dog": [850, 1000], "family-field": [707, 1000], "family-river": [746, 1000], "fence": [1000, 594], "kiss": [1484, 986], "portrait-field": [707, 1000], "stand": [1000, 664], "tender": [707, 1000], "touch": [707, 1000], "veil": [707, 1000], "window": [790, 983]};
export function demoImg(key) {
  const d = DEMO_DIMS[key];
  return d ? { src: new URL(`../img/demo/${key}.webp`, import.meta.url).href, w: d[0], h: d[1], demo: true } : null;
}
// Une « référence » de photo est soit une clé d'exemple, soit un chemin du portfolio.
export function makeImg(lib) {
  return (ref, fallback) => {
    if (ref && lib && lib[ref]) return { src: lib[ref].url, w: lib[ref].width || 1200, h: lib[ref].height || 800, alt: lib[ref].caption || "" };
    return demoImg(ref) || (fallback ? demoImg(fallback) : null);
  };
}

// ---------------------------------------------------------------- contenus par défaut
export const SITE_DEF = {
  t1: "Des histoires", t2: "à garder",
  lede: "Photographe de mariages, de familles et de portraits entre Saumur et Nantes. Chaque séance arrive dans une galerie privée, à feuilleter, choisir et partager.",
  mail: "bonjour@lau-rie.fr", ig: "https://www.instagram.com/",
  prices: [
    { name: "Portrait", detail: "Une heure, un lieu de votre choix, 25 photos retouchées.", price: 180 },
    { name: "Famille", detail: "Une heure et demie, chez vous ou en extérieur, 40 photos retouchées.", price: 260 },
    { name: "Mariage, demi-journée", detail: "La cérémonie et la séance couple : quatre heures, environ 250 photos.", price: 1200 },
    { name: "Mariage, journée", detail: "Des préparatifs à la première danse : dix heures, environ 500 photos.", price: 1900 },
  ],
  seoTitle: "lau.rie, photographe de mariage et de famille à Nantes",
  seoDesc: "Photographe entre Saumur et Nantes : mariages, familles et portraits en lumière naturelle, en Pays de la Loire et Centre-Val de Loire.",
  city: "Nantes", area: "Pays de la Loire, Centre-Val de Loire",
  mailSubj: "Votre galerie ferme le {date}",
  mailBody: "Bonjour {clients},\n\nVotre galerie reste en ligne jusqu'au {date}. Pensez à télécharger vos photos préférées en haute définition avant cette date.\n\nLien : {lien}\nCode : {code}\n\nUne question ? Répondez simplement à cet e-mail.\n\nÀ bientôt,\nlau.rie",
  // Réponses toutes prêtes aux demandes de contact ({prenom}, {formule}, {tarifs}, {site})
  replies: [
    { name: "Disponible", subj: "Votre séance {formule} avec lau.rie", body: "Bonjour {prenom},\n\nMerci pour votre message ! Bonne nouvelle : la date que vous m'indiquez est encore libre.\n\nJe vous propose un appel d'un quart d'heure pour faire connaissance et parler de ce que vous imaginez. Quels jours vous arrangent ?\n\nÀ très vite,\nLaurie" },
    { name: "Déjà réservée", subj: "Votre demande de séance", body: "Bonjour {prenom},\n\nMerci beaucoup pour votre message et pour votre confiance. Malheureusement, je suis déjà réservée à cette date.\n\nSi votre date peut bouger, ou pour une séance à un autre moment, je serais ravie d'en reparler.\n\nBelle journée,\nLaurie" },
    { name: "Tarifs et déroulé", subj: "Tarifs et déroulé d'une séance", body: "Bonjour {prenom},\n\nMerci pour votre message ! Voici mes formules :\n{tarifs}\n\nAprès la séance, vos photos arrivent dans une galerie privée en ligne : vous choisissez vos préférées et vous les partagez avec vos proches.\n\nDes exemples de séances : {site}\n\nÀ bientôt,\nLaurie" },
  ],
  // Photos de l'accueil : références du portfolio (ou photos d'exemple tant qu'elles sont vides)
  slots: {},
};
export const SLOT_DEF = {
  hero1: "veil", hero2: "touch", hero3: "tender", hero4: "dark-dress", hero5: "bouquet",
  run1: "veil", run2: "tender", run3: "dark-dress",
  about: "couple-path", contact: "portrait-field", access: "fence", login: "window",
};
export const SLOT_LABELS = {
  hero1: "Grand tirage, photo 1", hero2: "Grand tirage, photo 2", hero3: "Grand tirage, photo 3",
  hero4: "Petit tirage du haut", hero5: "Petit tirage du bas",
  run1: "Galerie d'exemple, photo 1", run2: "Galerie d'exemple, photo 2", run3: "Galerie d'exemple, photo 3",
  about: "À propos", contact: "Contact", access: "Page d'accès des clients", login: "Connexion de l'espace photographe",
};
export const LEGAL_DEF = {
  owner: "", status: "Entrepreneur individuel (micro-entreprise)", siret: "", address: "", phone: "",
  vat: "TVA non applicable, article 293 B du CGI", deposit: "30", delay: "trois à quatre semaines", delayWed: "trois à quatre semaines",
  host: "GitHub Inc. (GitHub Pages), 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis",
  mediator: "", mediatorUrl: "",
};
export const LEGAL_REQ = [["owner", "nom"], ["siret", "SIRET"], ["address", "adresse"], ["phone", "téléphone"], ["mediator", "médiateur"]];
// Séances d'exemple : à remplacer par les vraies depuis l'espace photographe
export const STORY_DEF = [
  { id: "lt", title: "Léa & Thomas", kind: "Mariage", place: "Saumur", when: "Juin 2026", text: "Une cérémonie dans un domaine de tuffeau au bord de la Loire, un vent qui soulevait les voiles et des invités qui dansaient pieds nus. Léa voulait des photos qui ressemblent à la journée : douces, vivantes, sans pose.", photos: ["kiss", "veil", "stand", "bouquet", "tender", "dance"], show: true, demo: true },
  { id: "fm", title: "Famille Moreau", kind: "Famille", place: "Pornic", when: "Septembre 2026", text: "Un dimanche de fin d'été au bord de la mer. Les enfants ont couru, le chien aussi ; on a surtout photographié ce qui se passait entre deux éclats de rire.", photos: ["family-dog", "family-field", "family-river"], show: true, demo: true },
  { id: "in", title: "Inès", kind: "Portrait", place: "Angers", when: "Octobre 2026", text: "Une heure dans les herbes hautes au bord de la Maine, à l'heure où la lumière devient dorée. Un portrait pour elle, sans artifice.", photos: ["portrait-field", "window", "dark-dress"], show: true, demo: true },
  { id: "lg", title: "Famille Le Goff", kind: "Famille", place: "Clisson", when: "Août 2026", text: "Les rochers au bord de la Sèvre, la lumière sous les arbres, et l'attente d'un deuxième enfant. Une séance lente, au rythme du plus petit.", photos: ["family-river", "family-field", "family-dog"], show: true, demo: true },
  { id: "cl", title: "Clémence", kind: "Portrait", place: "Nantes", when: "Mai 2026", text: "Chez elle, près de la fenêtre, avec la seule lumière du jour. On a pris le temps, et les images sont venues d'elles-mêmes.", photos: ["window", "portrait-field", "dark-dress"], show: true, demo: true },
  { id: "ah", title: "Anaïs & Hugo", kind: "Mariage", place: "Amboise", when: "Mai 2026", text: "Une sortie d'église sous les pétales, un dîner dans un jardin clos et une fin de soirée sur la piste. Une journée pleine, racontée du matin au soir.", photos: ["church", "fence", "touch", "bw-beach", "dance", "stand"], show: true, demo: true },
];
// Avis d'exemple : affichés uniquement en mode démonstration (jamais sur le vrai site)
export const REVIEWS_DEMO = [
  { who: "Léa & Thomas", ctx: "Mariés en juin 2026, à Saumur", body: "On a ouvert la galerie le soir même. Toute la famille a pu télécharger ses photos préférées.", image_path: "tender" },
  { who: "Sophie", ctx: "Séance famille à Pornic", body: "Les enfants ont oublié l'appareil au bout de cinq minutes. Les photos nous ressemblent, tout simplement.", image_path: "family-field" },
  { who: "Camille & Paul", ctx: "Mariés à Angers", body: "Choisir nos favorites sur le téléphone, dans le train du retour : c'était parfait.", image_path: "veil" },
];

// Contenu enregistré (table site_settings) + valeurs par défaut
export function mergeSite(content) {
  const c = content && typeof content === "object" ? content : {};
  const S = JSON.parse(JSON.stringify(SITE_DEF));
  Object.keys(c).forEach((k) => { if (c[k] != null && k !== "legal" && k !== "slots") S[k] = c[k]; });
  S.legal = { ...LEGAL_DEF, ...(c.legal || {}) };
  S.slots = { ...(c.slots || {}) };
  if (!Array.isArray(S.stories)) S.stories = JSON.parse(JSON.stringify(STORY_DEF));
  if (!Array.isArray(S.prices)) S.prices = JSON.parse(JSON.stringify(SITE_DEF.prices));
  return S;
}
export const slotRef = (S, k) => S.slots[k] || SLOT_DEF[k];
export const usesDemoPhotos = (S) => Object.keys(SLOT_DEF).some((k) => !S.slots[k]) || S.stories.some((s) => s.show !== false && (s.demo || s.photos.some((p) => DEMO_DIMS[p])));

export function fillTpl(s, g) {
  return String(s).replace(/\{clients\}/g, g.clients).replace(/\{date\}/g, g.date).replace(/\{lien\}/g, g.link).replace(/\{code\}/g, g.code);
}

// ---------------------------------------------------------------- QR code (qrcode-generator, chargé à part)
function qrMatrix(text) { const q = window.qrcode(0, "M"); q.addData(text); q.make(); return q; }
export function qrSvg(text, label) {
  const q = qrMatrix(text), n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
  return '<svg viewBox="-4 -4 ' + (n + 8) + " " + (n + 8) + '" role="img" aria-label="' + esc(label || "QR code") + '" shape-rendering="crispEdges"><rect x="-4" y="-4" width="' + (n + 8) + '" height="' + (n + 8) + '" fill="#fff"/><path d="' + d + '" fill="#1B1A17"/></svg>';
}
export function qrPaint(ctx, text, x, y, size) {
  const q = qrMatrix(text), n = q.getModuleCount(), m = size / (n + 8);
  ctx.fillStyle = "#fff"; ctx.fillRect(x, y, size, size); ctx.fillStyle = "#1B1A17";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(Math.floor(x + (c + 4) * m), Math.floor(y + (r + 4) * m), Math.ceil(m), Math.ceil(m));
}
export function logoImage() {
  const im = new Image();
  const p = document.querySelector("#lr-logo path");
  if (p) im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3060 798"><path fill="#1B1A17" fill-rule="evenodd" d="' + p.getAttribute("d") + '"/></svg>');
  return im;
}

// ---------------------------------------------------------------- balises
export function setMeta(attr, key, val) {
  let m = document.head.querySelector("meta[" + attr + '="' + key + '"]');
  if (!m) { m = document.createElement("meta"); m.setAttribute(attr, key); document.head.appendChild(m); }
  m.setAttribute("content", val);
}

// ---------------------------------------------------------------- fenêtres (sheets) et focus
let lastFocus = null;
export function openSheet(id) {
  lastFocus = document.activeElement;
  $(id).hidden = false;
  // Premier champ visible (un champ dans une partie masquée ne peut pas recevoir le focus)
  const vis = (el) => el.offsetParent !== null;
  const f = [...$(id).querySelectorAll("textarea, input:not([type=radio]):not([readonly])")].find(vis) ||
    [...$(id).querySelectorAll("input:checked, button")].find(vis);
  if (f) f.focus();
}
export function closeSheets() {
  document.querySelectorAll(".sheet").forEach((s) => { s.hidden = true; });
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}
export function initSheets() {
  document.querySelectorAll(".sheet").forEach((s) => {
    s.addEventListener("click", (e) => { if (e.target === s || e.target.closest("[data-close]")) closeSheets(); });
    s.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });
  });
  // Échap ferme la fenêtre ouverte, où que soit le focus
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && [...document.querySelectorAll(".sheet")].some((x) => !x.hidden)) closeSheets();
  });
  // Le focus reste dans la fenêtre ouverte
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const lb = $("lb"), drawer = $("drawer");
    const box = [...document.querySelectorAll(".sheet")].find((s) => !s.hidden) || (lb && !lb.hidden && lb) || (drawer && drawer.classList.contains("open") && drawer);
    if (!box) return;
    const f = [...box.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select, textarea")]
      .filter((el) => (el.offsetParent !== null || el.type === "radio") && !(el.type === "radio" && !el.checked));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

// ---------------------------------------------------------------- typographie française
const NB = " ";
export function frTypo(root) {
  if (!root || root.nodeType !== 1) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode;
      if (!p || /^(SCRIPT|STYLE|TEXTAREA|OPTION|CODE|PRE)$/.test(p.nodeName) || p.closest(".amp, [contenteditable], .a-code, .mailprev")) return NodeFilter.FILTER_REJECT;
      return /[«»:;!?&']/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const list = [];
  while (w.nextNode()) list.push(w.currentNode);
  list.forEach((n) => {
    const v = n.nodeValue
      .replace(/([A-Za-zÀ-ÿ0-9])'(?=[A-Za-zÀ-ÿ0-9])/g, "$1’")
      .replace(/([a-zà-ÿ])([;!?])(?=\s|$)/g, "$1" + NB + "$2")
      .replace(/«[   ]?/g, "«" + NB).replace(/[   ]?»/g, NB + "»")
      .replace(/[  ]([:;!?])/g, NB + "$1");
    if (v !== n.nodeValue) n.nodeValue = v;
    const host = n.parentNode && n.parentNode.closest("h1, h2, h3, .work .cap b, .g-tools .who .serif, .av-ttl");
    if (host && v.indexOf("&") > -1 && host.closest(".serif, .work, .g-tools")) {
      const frag = document.createDocumentFragment();
      v.split("&").forEach((part, i) => {
        if (i) { const s = document.createElement("span"); s.className = "amp"; s.textContent = "&"; frag.appendChild(s); }
        if (part) frag.appendChild(document.createTextNode(part));
      });
      n.parentNode.replaceChild(frag, n);
    }
  });
}
export function initTypo() {
  frTypo(document.body);
  if ("MutationObserver" in window) {
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType === 1) frTypo(n); else if (n.nodeType === 3 && n.parentNode) frTypo(n.parentNode);
    }))).observe(document.body, { childList: true, subtree: true });
  }
}

// ---------------------------------------------------------------- téléchargement d'un fichier généré
export function saveBlob(blob, name) {
  const a = document.createElement("a"), u = URL.createObjectURL(blob);
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

// ---------------------------------------------------------------- pages légales
// Remplies avec les informations saisies dans l'espace photographe (Réglages).
export function makeLegal(SITE) {
    var LG_UPDATED = "30 octobre 2026";
    function L(k, label) { var v = (SITE.legal[k] || "").trim(); return v ? esc(v) : '<mark class="todo">à compléter : ' + esc(label) + "</mark>"; }
    function legalHtml(page) {
      var who = L("owner", "nom et prénom"), mail = '<a href="mailto:' + esc(SITE.mail) + '">' + esc(SITE.mail) + "</a>";
      if (page === "mentions-legales") return '<h1 class="serif">Mentions <em>légales</em></h1><p class="upd">Mise à jour le ' + LG_UPDATED + "</p>" +
        "<h2>Éditeur du site</h2><dl>" +
          "<dt>Nom</dt><dd>" + who + "</dd><dt>Statut</dt><dd>" + L("status", "statut") + "</dd><dt>Nom commercial</dt><dd>lau.rie</dd>" +
          "<dt>SIRET</dt><dd>" + L("siret", "numéro SIRET") + "</dd><dt>Adresse</dt><dd>" + L("address", "adresse professionnelle") + "</dd>" +
          "<dt>E-mail</dt><dd>" + mail + "</dd><dt>Téléphone</dt><dd>" + L("phone", "téléphone") + "</dd><dt>TVA</dt><dd>" + L("vat", "mention TVA") + "</dd></dl>" +
        "<h2>Directrice de la publication</h2><p>" + who + ".</p>" +
        "<h2>Hébergement</h2><p>Le site est hébergé par " + L("host", "hébergeur") + ". Les galeries privées et l\'espace photographe reposent sur Supabase (base de données et stockage des aperçus), dans un centre de données situé dans l\'Union européenne.</p>" +
        "<h2>Propriété intellectuelle</h2><p>Toutes les photographies du site sont des œuvres protégées par le droit d\'auteur (article L111-1 du Code de la propriété intellectuelle). Leur reproduction, même partielle, est interdite sans l\'accord écrit de la photographe. Les personnes photographiées ont donné leur accord pour la publication de leurs images.</p>" +
        "<h2>Données personnelles</h2><p>Leur traitement est détaillé dans la <a href=\"#confidentialite\">politique de confidentialité</a>.</p>";
      if (page === "confidentialite") return '<h1 class="serif">Politique de <em>confidentialité</em></h1><p class="upd">Mise à jour le ' + LG_UPDATED + "</p>" +
        "<p>Ce site collecte le moins de données possible. Voici lesquelles, pourquoi et combien de temps.</p>" +
        "<h2>Responsable du traitement</h2><p>" + who + ", " + L("address", "adresse professionnelle") + ". Contact : " + mail + ".</p>" +
        "<h2>Quand vous écrivez</h2><p>Le formulaire de contact enregistre votre prénom, votre e-mail, le type de séance et votre message. Ils servent uniquement à vous répondre et à préparer un devis (mesures précontractuelles prises à votre demande). Ils sont conservés trois ans après notre dernier échange s\'il n\'y a pas de suite, puis supprimés.</p>" +
        "<h2>Votre galerie privée</h2><ul><li>Données : vos noms, votre e-mail, les photos de la séance, vos favorites et le code d\'accès.</li><li>Pourquoi : livrer vos photos, recevoir votre sélection et vous prévenir avant la fermeture de la galerie (exécution du contrat).</li><li>Combien de temps : pendant la durée de mise en ligne de la galerie (un an par défaut), puis suppression. Les factures sont gardées dix ans, comme la loi l\'impose.</li><li>Vos proches qui reçoivent le lien voient les photos ; leurs favorites restent dans leur propre navigateur.</li><li>Les cœurs (les vôtres et ceux de vos proches) sont aussi comptés de façon anonyme, pour indiquer à la photographe les photos les plus aimées : ils sont rattachés à un identifiant tiré au hasard par l\'appareil, jamais à un nom ou à un e-mail, et supprimés avec la galerie.</li></ul>" +
        "<h2>Sécurité</h2><p>Pour bloquer les tentatives de deviner un code et les envois automatiques de messages, l\'adresse IP est enregistrée lors de chaque essai de code et de chaque message, puis supprimée sous 24 heures (intérêt légitime : la sécurité du site).</p>" +
        "<h2>Prestataires</h2><ul><li>Supabase : base de données et aperçus des galeries, hébergés dans l\'Union européenne.</li><li>SwissTransfer (Infomaniak, Suisse) : transfert des fichiers haute définition. La Suisse est reconnue par l\'Union européenne comme protégeant les données de façon équivalente.</li><li>Resend : envoi des e-mails automatiques (rappels, notifications), aux États-Unis, encadré par les clauses contractuelles types de la Commission européenne.</li><li>GitHub : hébergement des pages du site, aux États-Unis.</li></ul><p>Aucune donnée n\'est vendue ni utilisée pour de la publicité.</p>" +
        "<h2>Cookies et stockage</h2><p>Aucun cookie publicitaire et aucune mesure d\'audience. Le site garde seulement dans votre navigateur vos favorites, vos notes pour la retouche, le code de votre galerie le temps de la visite, un identifiant tiré au hasard pour compter vos cœurs sans savoir qui vous êtes et, pour la photographe, sa session de connexion. Ces éléments sont indispensables au fonctionnement et ne demandent donc pas de consentement. Les polices de caractères sont hébergées sur le site lui-même.</p>" +
        "<h2>Vos droits</h2><p>Vous pouvez demander l\'accès à vos données, leur correction, leur suppression, leur portabilité, ou vous opposer à leur traitement, en écrivant à " + mail + ". Réponse sous un mois. Vous pouvez aussi saisir la CNIL (<a href=\"https://www.cnil.fr\" target=\"_blank\" rel=\"noopener\">cnil.fr</a>).</p>" +
        "<h2>Droit à l\'image</h2><p>Aucune photo de vous n\'est publiée dans le portfolio ou sur les réseaux sans votre accord écrit. Vous pouvez retirer cet accord à tout moment.</p>";
      var lst = SITE.prices.map(function (x) { return "<li>" + esc(x.name) + " : " + euro(x.price) + "</li>"; }).join("");
      return '<h1 class="serif">Conditions de <em>prestation</em></h1><p class="upd">Mise à jour le ' + LG_UPDATED + "</p>" +
        "<h2>1. Objet</h2><p>Ces conditions s\'appliquent aux séances photo (mariage, famille, portrait) réalisées par " + who + " (lau.rie) pour des particuliers. Elles sont jointes au devis et acceptées à sa signature.</p>" +
        "<h2>2. Tarifs</h2><p>Les prix sont indiqués en euros, toutes taxes comprises. " + L("vat", "mention TVA") + ".</p><ul>" + lst + "</ul><p>Les frais de déplacement sont compris dans le prix.</p>" +
        "<h2>3. Réservation et acompte</h2><p>La date est réservée à la signature du devis et au versement d\'un acompte de " + L("deposit", "pourcentage") + " %. Il s\'agit d\'un acompte : il engage les deux parties. Le solde est dû le jour de la séance, ou un mois avant pour un mariage.</p>" +
        "<h2>4. Droit de rétractation</h2><p>Si le contrat est conclu à distance ou en dehors d\'un lieu professionnel, vous disposez de quatorze jours pour vous rétracter, sans justification, en écrivant à " + mail + ". Si, à votre demande, la séance a lieu pendant ce délai, la part déjà réalisée reste due.</p>" +
        "<h2>5. Annulation et report</h2><p>Annulation par le client : l\'acompte reste acquis, sauf cas de force majeure. Annulation par la photographe : l\'intégralité des sommes versées est remboursée et elle vous aide à trouver un remplaçant. Un report à une autre date est proposé sans frais dans la mesure du possible.</p>" +
        "<h2>6. Livraison</h2><p>Les photos sont sélectionnées et retouchées par la photographe, puis livrées dans une galerie privée en ligne sous " + L("delay", "délai portrait et famille") + (SITE.legal.delayWed && SITE.legal.delayWed !== SITE.legal.delay ? " (" + L("delayWed", "délai mariage") + " pour un mariage)" : "") + ". La galerie reste en ligne un an ; pensez à télécharger vos fichiers et à les sauvegarder. Les fichiers bruts ne sont pas fournis.</p>" +
        "<h2>7. Droits d\'auteur et usage des photos</h2><p>La photographe reste l\'auteure des images. Vous pouvez les utiliser librement pour un usage privé et familial : impression, partage sur vos réseaux en citant lau.rie. Tout usage commercial demande un accord écrit. La photographe n\'utilise vos photos pour sa communication qu\'avec votre accord écrit.</p>" +
        "<h2>8. Responsabilité</h2><p>La photographe travaille avec du matériel en double pour limiter les risques. En cas de perte des fichiers ou d\'empêchement indépendant de sa volonté, sa responsabilité est limitée au remboursement des sommes versées.</p>" +
        "<h2>9. Données personnelles</h2><p>Voir la <a href=\"#confidentialite\">politique de confidentialité</a>.</p>" +
        "<h2>10. Litiges et médiation</h2><p>En cas de désaccord, écrivez d\'abord à " + mail + " pour trouver une solution à l\'amiable. À défaut, vous pouvez saisir gratuitement le médiateur de la consommation : " + L("mediator", "nom du médiateur") + (SITE.legal.mediatorUrl ? ' (<a href="' + esc(SITE.legal.mediatorUrl) + '" target="_blank" rel="noopener">' + esc(SITE.legal.mediatorUrl.replace(/^https?:\/\//, "")) + "</a>)" : "") + ". Le droit français s\'applique.</p>";
    }
    var LG_LEDE = {
      "mentions-legales": "Qui édite ce site, qui l'héberge, et à qui appartiennent les images.",
      "confidentialite": "Ce site collecte le moins de données possible. Voici lesquelles, pourquoi et combien de temps.",
      "conditions": "Les règles, écrites simplement, pour que tout soit clair avant votre séance."
    };
    function lgBrief(page) {
      var items = page === "confidentialite" ? ["Aucun cookie publicitaire, aucune mesure d'audience.", "Vos photos restent privées, protégées par un code.", "Vos données ne sont ni vendues ni partagées.", "Tout peut être supprimé sur simple e-mail."]
        : page === "conditions" ? ["Un acompte de " + (SITE.legal.deposit || "30") + " % bloque la date.", "Quatorze jours pour vous rétracter si le contrat est signé à distance.", "Une galerie privée en ligne pendant un an.", "Un usage privé libre de toutes vos photos."] : null;
      return items ? '<div class="lg-brief"><p class="bt">En bref</p><ul>' + items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "";
    }
  return { legalHtml, lgBrief, LG_LEDE };
}
