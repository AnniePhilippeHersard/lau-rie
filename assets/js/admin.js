// Espace photographe : tout se gère d'ici, sans toucher au code ni au tableau de bord Supabase.
import {
  $, esc, euro, toast, copy, fdate, daysTo, addDays, ymd, makeImg, mergeSite, slotRef, SLOT_DEF, SLOT_LABELS,
  LEGAL_REQ, usesDemoPhotos, fillTpl, qrSvg, qrPaint, logoImage, initSheets, openSheet, closeSheets, initTypo,
  saveBlob, EMAIL, DEMO_DIMS,
} from "./core.js";
import { DEMO, getClient, publicUrl, galleryLink, siteBase, libraryOf } from "./api.js";

// Jamais affichée à l'intérieur d'une autre page (clickjacking)
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location = window.location.href; } catch { /* page tierce : on reste masqué */ }
  throw new Error("Affichage dans un cadre refusé");
}
document.documentElement.classList.add("js");
initTypo();
initSheets();

let sb = null, user = null;
let tab = "accueil", openId = null;
let GAL = [], SEL = {}, REVS = [], REQS = [], PORT = [], SITE = mergeSite(null), img = makeImg({});
const COVERS = {};
const GCOLS = "id, slug, title, kind, client_name, client_email, event_date, allow_download, allow_selection, selection_limit, status, expires_at, cover_photo_id, delivery_url, delivery_expires_at, owner_code, guest_code, guest_hd, notify, remind, remind_days, reminded_at, visits, treated_at, created_at";
const ST = { draft: "Brouillon", live: "En ligne", sel: "Sélection reçue", done: "Livrée" };
const REQ_ST = { new: "Nouvelle", contacted: "Répondu", booked: "Réservée", declined: "Sans suite" };
const HEART = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="M12 20s-7-4.4-8.6-8.8C2.3 8 4.2 5 7.4 5c1.9 0 3.3 1 4.6 2.8C13.3 6 14.7 5 16.6 5c3.2 0 5.1 3 4 6.2C19 15.6 12 20 12 20z"/></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const noteA = (id, txt) => { const n = $(id); if (n) n.textContent = txt; };
const errMsg = (e) => (e && e.message ? e.message : String(e));

// =================================================================== connexion
function showLogin(msg) {
  $("a-login").hidden = false;
  $("a-app").hidden = true;
  $("a-login-err").textContent = msg || "";
  const d = img(slotRef(SITE, "login"));
  const im = document.querySelector("#a-login img[data-slot]");
  if (d && im) im.src = d.src;
}
async function boot() {
  if (DEMO) {
    showLogin();
    $("a-login-hint").textContent = "Le site n'est pas encore relié à Supabase : suivez le guide de mise en ligne (étape 6), puis revenez ici.";
    $("a-login-form").querySelector("button[type=submit]").disabled = true;
    return;
  }
  sb = await getClient();
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "PASSWORD_RECOVERY") { $("np-err").textContent = ""; openSheet("s-np"); }
    if (event === "SIGNED_OUT") showLogin();
    if (s) user = s.user;
  });
  const { data } = await sb.auth.getSession();
  if (data.session) await enter(data.session.user); else showLogin();
}
$("a-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const m = $("a-mail").value.trim(), p = $("a-pass").value;
  if (!EMAIL.test(m)) { $("a-login-err").textContent = "Entrez votre adresse e-mail complète."; return; }
  if (!p) { $("a-login-err").textContent = "Entrez votre mot de passe."; return; }
  $("a-login-err").textContent = "Connexion…";
  const { data, error } = await sb.auth.signInWithPassword({ email: m, password: p });
  if (error) { $("a-login-err").textContent = "E-mail ou mot de passe incorrect."; return; }
  await enter(data.user);
});
$("a-forgot").onclick = async () => {
  const m = $("a-mail").value.trim();
  if (!EMAIL.test(m)) { $("a-login-err").textContent = "Saisissez d'abord votre e-mail."; $("a-mail").focus(); return; }
  if (sb) await sb.auth.resetPasswordForEmail(m, { redirectTo: location.href.split("#")[0] });
  $("a-login-err").textContent = "Si ce compte existe, un e-mail vient d'être envoyé. Sinon, demandez un mot de passe provisoire à l'autre administratrice.";
};
$("np-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = $("np-1").value;
  if (p.length < 12) { $("np-err").textContent = "12 caractères minimum."; return; }
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) { $("np-err").textContent = error.message; return; }
  closeSheets(); toast("Mot de passe enregistré.");
});

async function enter(u) {
  user = u;
  const { data: ok, error } = await sb.rpc("is_admin");
  if (error || !ok) { await sb.auth.signOut(); showLogin("Ce compte n'a pas accès à l'espace photographe."); return; }
  $("a-login").hidden = true;
  $("a-app").hidden = false;
  $("a-who").textContent = u.email || "";
  $("a-ini").textContent = (u.email || "L").charAt(0).toUpperCase();
  tab = "accueil"; openId = null;
  $("a-main").innerHTML = '<p class="a-meta">Chargement…</p>';
  try { await loadAll(); } catch (e) { toast("Chargement incomplet : " + errMsg(e), 6000); }
  draw();
}

// =================================================================== données
async function loadAll() { await Promise.all([loadSite(), loadGalleries(), loadSelections(), loadReviews(), loadRequests()]); }
async function loadSite() {
  const [s, p] = await Promise.all([
    sb.from("site_settings").select("content").eq("id", 1).maybeSingle(),
    sb.from("portfolio").select("*").order("position").order("created_at", { ascending: false }),
  ]);
  if (p.error) throw p.error;
  SITE = mergeSite(s.data?.content);
  PORT = (p.data || []).map((x) => ({ ...x, url: publicUrl("portfolio", x.storage_path) }));
  img = makeImg(libraryOf(PORT));
  $("a-name").firstChild.textContent = SITE.legal.owner || "Espace photographe";
}
async function saveSite(note) {
  const content = JSON.parse(JSON.stringify(SITE));
  const { error } = await sb.from("site_settings").update({ content, updated_at: new Date().toISOString(), updated_by: user.id }).eq("id", 1);
  if (error) { toast("Enregistrement impossible : " + error.message, 6000); return false; }
  if (note) toast(note);
  return true;
}
async function loadGalleries() {
  const { data, error } = await sb.from("galleries")
    .select(GCOLS + ", photos:photos!photos_gallery_id_fkey(count), cover:photos!galleries_cover_fk(preview_path)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  GAL = data.map((g) => ({ ...g, nphotos: g.photos?.[0]?.count ?? 0 }));
  // Date d'envoi du lien (colonne ajoutée par la 4e migration : ignorée si elle n'est pas encore appliquée)
  const ls = await sb.from("galleries").select("id, link_sent_at");
  if (!ls.error) ls.data.forEach((r) => { const g = GAL.find((x) => x.id === r.id); if (g) g.link_sent_at = r.link_sent_at; });
  const paths = GAL.map((g) => g.cover?.preview_path).filter(Boolean);
  if (paths.length) {
    const { data: urls } = await sb.storage.from("galleries").createSignedUrls(paths, 3600);
    (urls || []).forEach((u, i) => { COVERS[paths[i]] = u.signedUrl; });
  }
}
async function loadSelections() {
  const { data, error } = await sb.from("selections").select("id, gallery_id, photo_ids, notes, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  SEL = {};
  data.forEach((s) => { if (!SEL[s.gallery_id]) SEL[s.gallery_id] = s; });
}
async function loadReviews() {
  const { data, error } = await sb.from("reviews").select("*").order("position").order("created_at", { ascending: false });
  if (error) throw error;
  REVS = data;
}
async function loadRequests() {
  const { data, error } = await sb.from("booking_requests").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  REQS = data;
}
const galById = (id) => GAL.find((g) => g.id === id);
function gStatus(g) {
  if (g.status !== "published") return "draft";
  const s = SEL[g.id];
  if (s && (!g.treated_at || s.created_at > g.treated_at)) return "sel";
  if (g.treated_at && g.delivery_url) return "done";
  return "live";
}
const pill = (s) => '<span class="pill ' + s + '">' + ST[s] + "</span>";
const thumbUrl = (u) => '<span class="a-th">' + (u ? '<img alt="" src="' + esc(u) + '">' : "") + "</span>";
// Pictogrammes des lignes sans photo (À faire, demandes, avis)
const ICO = {
  bubble: '<path d="M5 5h14v10H10l-4 4v-4H5z"/>',
  mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  draft: '<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  photo: '<path d="M4 6.5h16v12H4z"/><circle cx="9" cy="11" r="1.6"/><path d="M20 16l-5-5-7 7.5"/>',
  doc: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/>',
  insta: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6" fill="currentColor"/>',
};
const icoTile = (k) => '<span class="a-th a-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (ICO[k] || ICO.photo) + "</svg></span>";
const thumbRef = (ref) => { const d = ref ? img(ref) : null; return thumbUrl(d ? d.src : null); };
const coverUrl = (g) => (g.cover?.preview_path ? COVERS[g.cover.preview_path] : null);
const favN = (g) => (SEL[g.id] ? SEL[g.id].photo_ids.length : 0);
const selCount = () => GAL.filter((g) => gStatus(g) === "sel").length;
const newReqs = () => REQS.filter((r) => r.status === "new").length;
const pendingRevs = () => REVS.filter((r) => r.status === "pending");
const shown = (r) => r.status === "published" && !r.is_private;

// =================================================================== codes d'accès
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function rnd(n) { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => ALPHA[x % ALPHA.length]).join(""); }
function initials(name) {
  const w = String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().match(/[A-Z]+/g) || [];
  return (w.filter((x) => x.length > 1 || w.length === 1).map((x) => x[0]).join("").slice(0, 3)) || "LR";
}
const newCode = (name) => initials(name) + "-" + rnd(6);
const newGuestCode = (name) => initials(name) + "-INV-" + rnd(4);
const normCode = (c) => String(c || "").toUpperCase().replace(/\s+/g, "");
const validCode = (c) => /^[A-Z0-9-]{8,40}$/.test(c);

function remindInfo(g) {
  if (g.remind === false) return { txt: "Rappel désactivé.", warn: false };
  if (!g.client_email) return { txt: "Ajoutez l'e-mail des clients pour activer le rappel.", warn: true };
  if (!g.expires_at) return { txt: "Choisissez une date de fin pour programmer le rappel.", warn: true };
  if (g.reminded_at) return { txt: "Rappel envoyé le " + fdate(g.reminded_at) + " à " + g.client_email + ".", warn: false };
  const send = addDays(ymd(g.expires_at), -(g.remind_days || 30));
  return { txt: (daysTo(send) <= 0 ? "Rappel prévu au prochain passage quotidien" : "Rappel prévu le " + fdate(send)) + ", à " + g.client_email + ".", warn: false };
}
const mailVars = (g) => ({ clients: g.client_name || g.title, date: fdate(g.expires_at, { day: "numeric", month: "long", year: "numeric" }), link: galleryLink(g.owner_code), code: g.owner_code || "" });

// =================================================================== À faire
function todos() {
  const out = [], pr = pendingRevs();
  if (pr.length) out.push({ ico: "bubble", t: pr.length + " avis à relire", s: "De " + pr.map((r) => r.who).join(", ") + (pr.some((r) => r.is_private) ? ", dont un message privé" : ""), act: '<button class="btn sm" type="button" data-a="go" data-to="avis">Relire</button>' });
  const nr = newReqs();
  if (nr) out.push({ ico: "mail", t: nr + " nouvelle" + (nr > 1 ? "s" : "") + " demande" + (nr > 1 ? "s" : "") + " de contact", s: REQS.filter((r) => r.status === "new").map((r) => r.name + (r.kind ? " (" + r.kind.toLowerCase() + ")" : "")).join(", "), act: '<button class="btn sm" type="button" data-a="go" data-to="demandes">Répondre</button>' });
  GAL.forEach((g) => {
    if (gStatus(g) === "sel") {
      const s = SEL[g.id], nn = s.notes ? Object.keys(s.notes).length : 0, n = s.photo_ids.length;
      out.push({ url: coverUrl(g), t: "Sélection reçue : " + g.title, s: n + " favorite" + (n > 1 ? "s" : "") + (nn ? ", " + nn + " note" + (nn > 1 ? "s" : "") + " pour la retouche" : ""), act: '<button class="btn sm" type="button" data-a="go" data-to="selections">Voir</button>' });
    }
  });
  GAL.forEach((g) => {
    const d = daysTo(g.expires_at);
    if (g.status === "published" && d !== null && d >= 0 && d <= 60) out.push({ url: coverUrl(g), ico: "clock", t: "La galerie de " + g.title + " ferme dans " + d + " jour" + (d > 1 ? "s" : ""), s: remindInfo(g).txt, act: '<button class="btn ghost sm" type="button" data-a="open" data-id="' + g.id + '">Ouvrir</button>' });
    if (g.delivery_url && g.delivery_expires_at && daysTo(g.delivery_expires_at) < 0 && g.status === "published") out.push({ url: coverUrl(g), ico: "link", t: "Lien HD expiré : " + g.title, s: "Déposez à nouveau les photos sur SwissTransfer et collez le nouveau lien.", act: '<button class="btn ghost sm" type="button" data-a="open" data-id="' + g.id + '">Ouvrir</button>' });
  });
  GAL.forEach((g) => {
    if (g.status !== "published") out.push({ url: coverUrl(g), ico: "draft", t: g.title + " : galerie pas encore en ligne", s: g.nphotos ? g.nphotos + " photos prêtes" : "Aucune photo pour l'instant", act: '<button class="btn ghost sm" type="button" data-a="open" data-id="' + g.id + '">Ouvrir</button>' });
  });
  if (usesDemoPhotos(SITE)) out.push({ ico: "photo", t: "Photos et séances d'exemple encore sur le site", s: "Ajoutez vos photos dans Portfolio, puis remplacez les séances et les photos de l'accueil.", act: '<button class="btn ghost sm" type="button" data-a="go" data-to="portfolio">Remplacer</button>' });
  const miss = LEGAL_REQ.filter((x) => !(SITE.legal[x[0]] || "").trim());
  if (miss.length) out.push({ ico: "doc", t: "Pages légales : " + miss.length + " information" + (miss.length > 1 ? "s" : "") + " à compléter", s: miss.map((x) => x[1]).join(", "), act: '<button class="btn ghost sm" type="button" data-a="go" data-to="reglages">Compléter</button>' });
  if (!SITE.ig || /^https?:\/\/(www\.)?instagram\.com\/?$/i.test(SITE.ig)) out.push({ ico: "insta", t: "Lien Instagram à compléter", s: "Le pied de page du site pointe encore vers la page d'accueil d'Instagram.", act: '<button class="btn ghost sm" type="button" data-a="go" data-to="site">Compléter</button>' });
  if (!REVS.some(shown)) out.push({ ico: "bubble", t: "Aucun avis affiché sur l'accueil", s: "Vos clients peuvent en laisser un depuis leur galerie, ou ajoutez-en un vous-même.", act: '<button class="btn ghost sm" type="button" data-a="go" data-to="avis">Ajouter</button>' });
  return out;
}
function viewAccueil() {
  const L = todos(), live = GAL.filter((g) => g.status === "published").length;
  const favT = GAL.reduce((s, g) => s + favN(g), 0), vis = GAL.reduce((s, g) => s + (g.visits || 0), 0);
  return '<div class="a-top"><div><h1>À faire</h1><p class="a-sub">' + (L.length ? L.length + " point" + (L.length > 1 ? "s" : "") + " vous attendent." : "Tout est à jour.") + "</p></div></div>" +
    (L.length ? '<div class="a-tbl">' + L.map((x) =>
      '<div class="a-srow">' + (x.url ? thumbUrl(x.url) : icoTile(x.ico)) + '<div class="a-nm"><b>' + esc(x.t) + "</b><span>" + esc(x.s) + '</span></div><div class="a-acts">' + x.act + "</div></div>").join("") + "</div>"
      : '<div class="a-empty"><b>Rien à traiter</b><span class="a-meta">Les sélections reçues, les demandes, les avis et les galeries qui ferment apparaîtront ici.</span></div>') +
    '<dl class="a-kpi"><div><dt>Galeries en ligne</dt><dd>' + live + "</dd></div><div><dt>Favorites reçues</dt><dd>" + favT + "</dd></div><div><dt>Visites des galeries</dt><dd>" + vis + "</dd></div><div><dt>Avis affichés</dt><dd>" + REVS.filter(shown).length + "</dd></div></dl>";
}

// =================================================================== galeries
function viewGaleries() {
  const live = GAL.filter((g) => g.status === "published").length;
  return '<div class="a-top"><div><h1>Galeries</h1><p class="a-sub">' + GAL.length + " galerie" + (GAL.length > 1 ? "s" : "") + ", " + live + " en ligne" + (selCount() ? ", " + selCount() + " sélection à traiter" : "") + '</p></div><div class="a-acts"><button class="btn sm" type="button" data-a="new">Nouvelle galerie</button></div></div>' +
    (GAL.length ? '<div class="a-tbl"><div class="a-hr" aria-hidden="true"><span></span><span>Clients</span><span>Statut</span><span class="a-num">Photos</span><span class="a-num">Favorites</span><span>Code</span><span></span></div>' +
      GAL.map((g) => {
        const d = daysTo(g.expires_at);
        return '<button type="button" class="a-row" data-a="open" data-id="' + g.id + '">' + thumbUrl(coverUrl(g)) +
          '<span class="a-nm"><b>' + esc(g.title) + "</b><span>" + esc([g.kind, g.event_date ? fdate(g.event_date) : ""].filter(Boolean).join(", ")) + (d !== null && d >= 0 && d <= 60 ? ", ferme dans " + d + " jours" : "") + "</span></span>" + pill(gStatus(g)) +
          '<span class="a-num c-x">' + g.nphotos + '</span><span class="a-num c-x">' + favN(g) + '</span><span class="a-code c-x">' + esc(g.owner_code || "—") + '</span><span class="c-x">' + CHEV + "</span></button>";
      }).join("") + "</div>"
      : '<div class="a-empty"><b>Aucune galerie pour l\'instant</b><span class="a-meta">Après une séance, créez une galerie et importez les photos : vos clients les reçoivent avec un code.</span></div>');
}
let gPhotos = [], gUrls = {}, gShowAll = false;
let gFavs = [];
async function loadGalleryPhotos(g) {
  const [{ data, error }, fv] = await Promise.all([
    sb.from("photos").select("id, preview_path, filename, width, height, position, collection, hidden_from_guests").eq("gallery_id", g.id).order("position").order("created_at"),
    sb.rpc("fav_counts", { p_gallery: g.id }),
  ]);
  if (error) throw error;
  gFavs = fv.error ? [] : fv.data || []; // migration pas encore appliquée : on n'affiche rien
  gPhotos = data;
  gUrls = {};
  const paths = data.map((p) => p.preview_path);
  for (let i = 0; i < paths.length; i += 200) {
    const { data: urls } = await sb.storage.from("galleries").createSignedUrls(paths.slice(i, i + 200), 3600);
    (urls || []).forEach((u, k) => { gUrls[paths[i + k]] = u.signedUrl; });
  }
}
function shareCard(g) {
  const u = coverUrl(g);
  return '<div class="share-card" id="g-card">' + (u ? '<img alt="" src="' + esc(u) + '">' : '<img alt="" src="partage.jpg">') + "<div><b>" + esc(g.title) + " · lau.rie</b><span>" + (g.nphotos ? g.nphotos + " photos à découvrir. " : "") + "Ouvrez avec le code reçu de votre photographe.</span><small>" + esc(siteBase().replace(/^https?:\/\//, "")) + "</small></div></div>";
}
function photoGrid(g) {
  const sel = SEL[g.id], picked = new Set(sel ? sel.photo_ids : []), notes = (sel && sel.notes) || {};
  const list = gShowAll ? gPhotos : gPhotos.slice(0, 60);
  return (gPhotos.length ? '<div class="cs a-photos">' + list.map((p) =>
    '<figure data-pid="' + p.id + '"' + (p.id === g.cover_photo_id ? ' class="is-cover"' : "") + '><img alt="' + esc(p.filename) + '" loading="lazy" src="' + esc(gUrls[p.preview_path] || "") + '">' +
    (picked.has(p.id) ? '<span class="h" title="Choisie par les clients">' + HEART + "</span>" : "") +
    (p.hidden_from_guests ? '<span class="tag">Masquée</span>' : notes[p.id] ? '<span class="tag">Note</span>' : "") +
    '<span class="ops"><button type="button" data-a="cover" data-pid="' + p.id + '" aria-label="Choisir comme couverture : ' + esc(p.filename) + '">' + (p.id === g.cover_photo_id ? "Couverture" : "Couv.") + '</button><button type="button" data-a="delphoto" data-pid="' + p.id + '" aria-label="Supprimer ' + esc(p.filename) + '">×</button></span></figure>').join("") + "</div>" +
    (!gShowAll && gPhotos.length > 60 ? '<div><button class="btn ghost sm" type="button" data-a="showall">Afficher les ' + gPhotos.length + " photos</button></div>" : "")
    : '<p class="a-meta">Aucune photo pour l\'instant.</p>');
}
// Photos les plus aimées : cœurs des clients et des invités, comptés anonymement
function topLoved() {
  const byId = Object.fromEntries(gPhotos.map((p) => [p.id, p]));
  const top = gFavs.filter((f) => byId[f.photo_id]).slice(0, 12);
  if (!top.length) return "";
  const total = gFavs.reduce((n, f) => n + f.hearts, 0);
  return '<section class="a-set"><div class="a-lab"><h2>Les plus aimées</h2><p>Les cœurs des clients et de leurs invités, comptés sans savoir qui les a mis. Utile pour choisir les photos du portfolio, avec l\'accord des clients.</p></div><div class="a-panel">' +
    '<p class="a-meta">' + total + " cœur" + (total > 1 ? "s" : "") + " sur " + gFavs.length + " photo" + (gFavs.length > 1 ? "s" : "") + "</p>" +
    '<div class="a-loved">' + top.map((f, i) => {
      const p = byId[f.photo_id];
      return '<figure><img alt="' + esc(p.filename) + '" loading="lazy" src="' + esc(gUrls[p.preview_path] || "") + '"><figcaption><b>' + (i + 1) + ".</b> " + HEART + " " + f.hearts +
        (f.owners ? '<span class="a-meta"> · clients</span>' : "") + '<span class="a-fn">' + esc(p.filename.replace(/\.[^.]+$/, "")) + "</span></figcaption></figure>";
    }).join("") + "</div></div></section>";
}
function viewGallery(g) {
  const nf = favN(g), ri = remindInfo(g), dl = daysTo(g.expires_at), link = galleryLink(g.owner_code);
  return '<button type="button" class="a-back" data-a="back">← Galeries</button>' +
    '<div class="a-top"><div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><h1>' + esc(g.title) + "</h1>" + pill(gStatus(g)) + '</div><p class="a-sub">' + esc([g.kind, g.event_date ? fdate(g.event_date) : "", g.nphotos + " photos", (g.visits || 0) + " visites", g.link_sent_at ? "lien envoyé le " + fdate(g.link_sent_at) : ""].filter(Boolean).join(", ")) + (dl !== null && dl >= 0 && dl <= 60 ? ", ferme dans " + dl + " jours" : "") + "</p></div>" +
    '<div class="a-acts">' + (g.owner_code ? '<a class="btn ghost sm" target="_blank" rel="noopener" href="' + esc(link) + '">Voir comme les clients</a>' : "") + '<button class="btn ghost sm" type="button" data-a="msg">Copier le message</button><button class="btn sm" type="button" data-a="sendmail">Envoyer par e-mail</button></div></div>' +
    '<p class="a-note" id="a-note" aria-live="polite"></p>' +
    '<section class="a-set"><div class="a-lab"><h2>Séance</h2><p>Le nom affiché en haut de la galerie et dans les e-mails.</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="g-title">Nom des clients</label><input class="a-in" id="g-title" maxlength="160" value="' + esc(g.title) + '"></div>' +
      '<div class="ct-two"><div class="a-f"><label for="g-kind">Type</label><select class="a-in sel" id="g-kind">' + ["Mariage", "Famille", "Portrait", "Autre"].map((k) => "<option" + (k === g.kind ? " selected" : "") + ">" + k + "</option>").join("") + '</select></div>' +
      '<div class="a-f"><label for="g-date">Date de la séance</label><input class="a-in" id="g-date" type="date" value="' + esc(ymd(g.event_date)) + '"></div></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Accès</h2><p>Le lien et le code à transmettre. Les invités ont leur propre code : ils voient la galerie sans pouvoir envoyer de sélection.</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="g-link">Lien de la galerie</label><div class="a-join"><input class="a-in" id="g-link" readonly value="' + esc(galleryLink()) + '"><button type="button" data-a="copylink">Copier</button></div></div>' +
      '<div class="ct-two"><div class="a-f"><label for="g-code">Code des clients</label><div class="a-join"><input class="a-in a-code" id="g-code" maxlength="40" autocapitalize="characters" value="' + esc(g.owner_code || "") + '"><button type="button" data-a="regen">Nouveau</button></div></div>' +
      '<div class="a-f"><label for="g-exp">En ligne jusqu\'au</label><input class="a-in" id="g-exp" type="date" value="' + esc(ymd(g.expires_at)) + '"></div></div>' +
      '<div class="a-f"><label for="g-gcode">Code des invités</label><div class="a-join"><input class="a-in a-code" id="g-gcode" maxlength="40" autocapitalize="characters" placeholder="Laisser vide : pas d\'accès invités" value="' + esc(g.guest_code || "") + '"><button type="button" data-a="regen2">Nouveau</button></div></div>' +
      '<div class="a-f"><label for="g-email">E-mail des clients</label><input class="a-in" id="g-email" type="email" autocomplete="off" placeholder="prenom@exemple.fr" value="' + esc(g.client_email || "") + '"></div>' +
      '<label class="a-sw"><span>Galerie visible par les clients<small>Désactivée, le code affiche « pas encore en ligne ».</small></span><input type="checkbox" id="g-live"' + (g.status === "published" ? " checked" : "") + "></label>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>QR code et partage</h2><p>Le QR code ouvre directement la galerie des clients. La carte s\'imprime en 10 × 15 cm pour la glisser dans un remerciement.</p></div><div class="a-panel">' +
      (g.owner_code ? '<div class="qr-grid"><div class="qr-box">' + qrSvg(link, "QR code de la galerie " + g.title) + '</div>' +
      '<div class="qr-acts"><button class="btn sm" type="button" data-a="card">Créer la carte à imprimer</button><button class="btn ghost sm" type="button" data-a="qrpng">Télécharger le QR seul</button><span class="a-meta" id="card-note" aria-live="polite"></span><img class="card-prev" id="card-prev" alt="Aperçu de la carte à imprimer" hidden></div></div>' : '<p class="a-warn">Enregistrez d\'abord un code des clients.</p>') +
      '<div class="a-f"><span class="l">Aperçu quand le lien est envoyé par message</span>' + shareCard(g) + "</div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Sélection</h2><p>Les clients choisissent leurs photos préférées ; les invités ont leurs propres favorites, qui restent sur leur téléphone.</p></div><div class="a-panel">' +
      '<label class="a-sw"><span>Les clients peuvent envoyer une sélection</span><input type="checkbox" id="g-sel"' + (g.allow_selection ? " checked" : "") + "></label>" +
      '<div class="a-f"><label for="g-limit">Nombre maximum de favorites</label><input class="a-in" id="g-limit" type="number" min="0" max="5000" inputmode="numeric" value="' + (Number(g.selection_limit) || 0) + '" aria-describedby="g-limit-h" style="max-width:160px"><span class="a-meta" id="g-limit-h">0 = sans limite.</span></div>' +
      '<label class="a-sw"><span>M\'écrire quand une sélection arrive<small>Si les e-mails automatiques sont branchés (guide, étape 10).</small></span><input type="checkbox" id="g-notify"' + (g.notify !== false ? " checked" : "") + "></label>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Fichiers HD</h2><p>Les originaux ne passent pas par le site : déposez-les sur SwissTransfer et collez le lien. Vos clients le trouvent dans « Télécharger ».</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="g-hd">Lien SwissTransfer</label><input class="a-in" id="g-hd" type="url" inputmode="url" placeholder="https://www.swisstransfer.com/d/…" value="' + esc(g.delivery_url || "") + '"></div>' +
      '<div class="a-f"><label for="g-hdexp">Lien valable jusqu\'au</label><input class="a-in" id="g-hdexp" type="date" value="' + esc(ymd(g.delivery_expires_at)) + '" style="max-width:220px"></div>' +
      '<label class="a-sw"><span>Les invités voient aussi le lien HD</span><input type="checkbox" id="g-ghd"' + (g.guest_hd ? " checked" : "") + "></label>" +
      '<label class="a-sw"><span>Téléchargement des aperçus autorisé<small>Photos en qualité web, une par une ou en archive.</small></span><input type="checkbox" id="g-dl"' + (g.allow_download ? " checked" : "") + "></label>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Rappel avant fermeture</h2><p>Un e-mail automatique invite les clients à télécharger leurs photos avant la fermeture de la galerie.</p></div><div class="a-panel">' +
      '<label class="a-sw"><span>Envoyer un rappel aux clients</span><input type="checkbox" id="g-remind"' + (g.remind !== false ? " checked" : "") + "></label>" +
      '<div class="a-f"><label for="g-rdays">Quand</label><select class="a-in sel" id="g-rdays">' + [[30, "Un mois avant la fermeture"], [14, "Deux semaines avant"], [7, "Une semaine avant"]].map((o) => '<option value="' + o[0] + '"' + ((g.remind_days || 30) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div>" +
      '<p class="' + (ri.warn ? "a-warn" : "a-meta") + '" id="g-rinfo">' + esc(ri.txt) + "</p>" +
      '<div class="a-acts" style="justify-content:flex-start"><button class="btn ghost sm" type="button" data-a="mailprev" aria-expanded="false" aria-controls="g-mail">Voir l\'e-mail</button>' + (g.client_email ? '<a class="btn ghost sm" href="' + esc(remindMailto(g)) + '">L\'envoyer moi-même</a>' : "") + "</div>" +
      '<div class="mailprev" id="g-mail" hidden><b>' + esc(fillTpl(SITE.mailSubj, mailVars(g))) + "</b><pre>" + esc(fillTpl(SITE.mailBody, mailVars(g))) + '</pre><span class="a-meta">Le texte se modifie dans Réglages.</span></div>' +
    "</div></section>" +
    '<div class="a-save"><button class="btn" type="button" data-a="save">Enregistrer</button><span class="a-note" id="a-saved" aria-live="polite"></span></div>' +
    topLoved() +
    '<section class="a-set"><div class="a-lab"><h2>Photos</h2><p>Importez les JPEG exportés de Lightroom : le site en fait des aperçus légers (2 048 px). Les originaux restent sur votre ordinateur.</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="g-col">Collection (facultatif)</label><input class="a-in" id="g-col" maxlength="60" placeholder="Par exemple : Cérémonie"></div>' +
      '<label class="a-sw" style="align-self:end"><span>Ajouter « © lau.rie » sur les aperçus</span><input type="checkbox" id="g-wm"></label></div>' +
      '<label class="drop"><input type="file" multiple accept="image/jpeg,image/png,image/webp" data-a="files" aria-label="Ajouter des photos"><b>Ajouter des photos</b><span>Glissez-les ici ou touchez pour choisir</span></label>' +
      '<p class="a-meta" id="g-count" aria-live="polite">' + g.nphotos + " photos" + (nf ? ", " + nf + " favorite" + (nf > 1 ? "s" : "") + " choisie" + (nf > 1 ? "s" : "") + " par les clients" : "") + "</p>" +
      '<div id="g-photos">' + photoGrid(g) + "</div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Supprimer</h2><p>Supprime la galerie, ses aperçus et ses sélections. Les originaux sur votre ordinateur ne sont pas touchés.</p></div><div class="a-panel"><div><button class="btn ghost sm danger" type="button" data-a="delgal">Supprimer la galerie</button></div></div></section>';
}
function remindMailto(g) {
  const v = mailVars(g);
  return "mailto:" + encodeURIComponent(g.client_email) + "?subject=" + encodeURIComponent(fillTpl(SITE.mailSubj, v)) + "&body=" + encodeURIComponent(fillTpl(SITE.mailBody, v));
}
function mailMessage(g) {
  return clientMessage(g).replace(/^Bonjour,/, "Bonjour " + (g.client_name || g.title) + ",");
}
function clientMessage(g) {
  return "Bonjour,\n\nVos photos sont en ligne : " + galleryLink(g.owner_code) + "\nCode : " + g.owner_code +
    (g.guest_code ? "\nPour vos proches : même lien, avec le code " + g.guest_code + "." : "") +
    "\n\nTouchez le cœur des photos que vous préférez, puis envoyez votre sélection.\n\nÀ bientôt,\nlau.rie";
}

// Carte à imprimer : 10 × 15 cm à 300 dpi
const LOGO = logoImage();
function fitFont(ctx, text, weight, style, max, maxW) {
  let s = max;
  do { ctx.font = style + " " + weight + " " + s + 'px "Cormorant Garamond", Garamond, serif'; s -= 4; } while (ctx.measureText(text).width > maxW && s > 40);
  return s + 4;
}
function makeCard(g) {
  const W = 1200, H = 1800, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#F2EFE9"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#1B1A17"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  if (LOGO.complete && LOGO.naturalWidth) ctx.drawImage(LOGO, (W - 440) / 2, 92, 440, 440 * 798 / 3060);
  else { ctx.font = '500 60px "Cormorant Garamond", Garamond, serif'; ctx.fillText("lau.rie", W / 2, 170); }
  fitFont(ctx, g.title, 300, "italic", 120, W - 200); ctx.fillText(g.title, W / 2, 400);
  ctx.font = '400 42px "Jost", "Futura", sans-serif'; ctx.fillStyle = "#57534B"; ctx.fillText("Vos photos vous attendent", W / 2, 490);
  qrPaint(ctx, galleryLink(g.owner_code), (W - 760) / 2, 580, 760);
  ctx.fillStyle = "#1B1A17"; ctx.font = '400 40px "Jost", "Futura", sans-serif'; ctx.fillText("Scannez pour ouvrir votre galerie", W / 2, 1450);
  ctx.font = '500 56px "Jost", "Futura", sans-serif'; ctx.fillText("Code : " + g.owner_code, W / 2, 1545);
  ctx.font = '400 34px "Jost", "Futura", sans-serif'; ctx.fillStyle = "#57534B"; ctx.fillText(galleryLink().replace(/^https?:\/\//, ""), W / 2, 1625);
  return cv;
}
function downloadCanvas(cv, name, okTxt) {
  cv.toBlob((blob) => { if (!blob) { noteA("card-note", "Impossible de créer l'image."); return; } saveBlob(blob, name); noteA("card-note", okTxt); }, "image/png");
}

// Aperçus : redimensionnés dans le navigateur, seuls eux sont envoyés
async function makePreview(file, maxSide, watermark) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const r = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * r), h = Math.round(bmp.height * r);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  if (watermark) {
    const size = Math.max(14, Math.round(Math.min(w, h) * 0.035));
    ctx.font = `500 ${size}px "Jost", ui-sans-serif, sans-serif`;
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = size / 3;
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.fillText(watermark, w - size, h - size * 0.8);
  }
  let blob = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.82));
  if (!blob || blob.type !== "image/webp") blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  return { blob, width: w, height: h, ext: blob.type === "image/webp" ? "webp" : "jpg" };
}
const safeName = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-120) || "photo.jpg";
async function uploadGalleryFiles(g, files) {
  files = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (!files.length) { noteA("g-count", "Formats acceptés : JPEG, PNG, WebP."); return; }
  const coll = $("g-col").value.trim() || null, wm = $("g-wm").checked ? "© lau.rie" : null;
  let pos = gPhotos.length, done = 0;
  const failed = [];
  for (const file of files) {
    noteA("g-count", "Import : " + (done + 1) + " / " + files.length + "…");
    try {
      const pid = crypto.randomUUID();
      const prev = await makePreview(file, 2048, wm);
      const base = safeName(file.name).replace(/\.[^.]+$/, "") || "photo";
      const path = `${g.id}/${pid}/${base}.${prev.ext}`;
      const up = await sb.storage.from("galleries").upload(path, prev.blob, { contentType: prev.blob.type, upsert: false });
      if (up.error) throw up.error;
      const row = { id: pid, gallery_id: g.id, preview_path: path, filename: file.name.slice(0, 255), width: prev.width, height: prev.height, position: pos++, collection: coll };
      const { error } = await sb.from("photos").insert(row);
      if (error) { await sb.storage.from("galleries").remove([path]); throw error; }
      gPhotos.push({ ...row, hidden_from_guests: false });
      gUrls[path] = URL.createObjectURL(prev.blob);
      if (!g.cover_photo_id) {
        await sb.from("galleries").update({ cover_photo_id: pid }).eq("id", g.id);
        g.cover_photo_id = pid; g.cover = { preview_path: path }; COVERS[path] = gUrls[path];
      }
    } catch (e) {
      failed.push(file.name);
      console.error(e);
    }
    done++;
    g.nphotos = gPhotos.length;
  }
  $("g-photos").innerHTML = photoGrid(g);
  noteA("g-count", gPhotos.length + " photos. " + (files.length - failed.length) + " importée" + (files.length - failed.length > 1 ? "s" : "") + (failed.length ? ", " + failed.length + " en échec : " + failed.slice(0, 3).join(", ") : "") + ".");
}

// =================================================================== sélections
let selNames = {};
async function loadSelNames() {
  const ids = [...new Set(Object.values(SEL).flatMap((s) => s.photo_ids))];
  selNames = {};
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from("photos").select("id, filename").in("id", ids.slice(i, i + 300));
    (data || []).forEach((p) => { selNames[p.id] = p.filename; });
  }
}
const nameOf = (id) => String(selNames[id] || "?").replace(/\.[^.]+$/, "");
function viewSelections() {
  const list = GAL.filter((g) => SEL[g.id]);
  return '<div class="a-top"><div><h1>Sélections</h1><p class="a-sub">Les favorites envoyées par vos clients, à retoucher en priorité.</p></div></div>' +
    (list.length ? '<div class="a-tbl">' + list.map((g) => {
      const s = SEL[g.id], st = gStatus(g), n = s.photo_ids.length;
      const ks = s.notes ? Object.keys(s.notes) : [];
      return '<div class="a-srow">' + thumbUrl(coverUrl(g)) + '<div class="a-nm"><b>' + esc(g.title) + "</b><span>" + n + " favorite" + (n > 1 ? "s" : "") + " sur " + g.nphotos + ", reçue le " + fdate(s.created_at) + (st === "sel" ? "" : ", traitée") + "</span></div>" +
        '<div class="a-acts"><button class="btn ghost sm" type="button" data-a="nums" data-id="' + g.id + '">Copier les noms</button>' + (st === "sel" ? '<button class="btn sm" type="button" data-a="treat" data-id="' + g.id + '">Marquer comme traitée</button>' : pill(st)) + "</div>" +
        (ks.length ? '<ul class="a-notes" aria-label="Notes pour la retouche">' + ks.map((k) => "<li><b>" + esc(nameOf(k)) + "</b>" + esc(s.notes[k]) + "</li>").join("") + "</ul>" : "") + "</div>";
    }).join("") + '</div><p class="a-note" id="a-note" aria-live="polite"></p><p class="a-meta">Les noms se collent tels quels dans la recherche de Lightroom (filtre Texte, « Nom de fichier ») pour retrouver les photos.</p>'
      : '<div class="a-empty"><b>Aucune sélection pour l\'instant</b><span class="a-meta">Quand des clients envoient leurs favorites, elles arrivent ici.</span></div>');
}

// =================================================================== demandes
function viewDemandes() {
  return '<div class="a-top"><div><h1>Demandes</h1><p class="a-sub">Les messages envoyés depuis le formulaire de contact du site.</p></div></div>' +
    (REQS.length ? '<div class="a-tbl">' + REQS.map((r) =>
      '<div class="a-srow a-req">' + icoTile("mail") + '<div class="a-nm"><b>' + esc(r.name) + (r.kind ? " · " + esc(r.kind) : "") + '</b><span class="a-ex full">' + esc(r.message || "").replace(/\n/g, "<br>") + '</span><span class="a-meta">' + esc(r.email) + (r.phone ? ", " + esc(r.phone) : "") + ", reçue le " + fdate(r.created_at) + "</span></div>" +
      '<div class="a-acts" style="align-items:center"><button class="btn sm" type="button" data-a="reply" data-id="' + r.id + '">Répondre</button>' +
      '<select class="a-in sel" data-a="reqst" data-id="' + r.id + '" aria-label="Statut de la demande de ' + esc(r.name) + '">' + Object.entries(REQ_ST).map(([k, v]) => '<option value="' + k + '"' + (k === r.status ? " selected" : "") + ">" + v + "</option>").join("") + "</select>" +
      '<button class="btn ghost sm" type="button" data-a="delreq" data-id="' + r.id + '">Supprimer</button></div></div>').join("") + "</div>"
      : '<div class="a-empty"><b>Aucune demande pour l\'instant</b><span class="a-meta">Les messages du formulaire de contact arrivent ici.</span></div>') +
    '<p class="a-note" id="a-note" aria-live="polite"></p><p class="a-meta" style="margin-top:12px">Supprimez les demandes sans suite au bout de trois ans au plus tard (politique de confidentialité).</p>';
}

// =================================================================== portfolio : bibliothèque, séances, photos de l'accueil
function viewPortfolio() {
  const stories = SITE.stories;
  return '<div class="a-top"><div><h1>Portfolio</h1><p class="a-sub">Vos photos publiques, les séances montrées sur l\'accueil et les photos de chaque emplacement.</p></div><div class="a-acts"><a class="btn ghost sm" href="index.html#seances" target="_blank" rel="noopener">Voir l\'accueil</a></div></div>' +
    '<p class="a-note" id="a-note" aria-live="polite"></p>' +
    '<section class="a-set"><div class="a-lab"><h2>Bibliothèque</h2><p>Les photos que vous acceptez de montrer publiquement, avec l\'accord des personnes photographiées. Redimensionnées à 2 400 px.</p></div><div class="a-panel">' +
      '<label class="drop"><input type="file" multiple accept="image/jpeg,image/png,image/webp" data-a="pfiles" aria-label="Ajouter des photos au portfolio"><b>Ajouter des photos</b><span>Glissez-les ici ou touchez pour choisir</span></label>' +
      '<p class="a-meta" id="pf-count" aria-live="polite">' + PORT.length + " photo" + (PORT.length > 1 ? "s" : "") + "</p>" +
      (PORT.length ? '<div class="a-lib">' + PORT.map((p) => '<figure data-id="' + p.id + '"><img alt="" loading="lazy" src="' + esc(p.url) + '"><input class="a-in" data-a="caption" data-id="' + p.id + '" maxlength="200" placeholder="Description (pour Google)" aria-label="Description de la photo" value="' + esc(p.caption || "") + '"><button type="button" class="linkbtn" data-a="delpf" data-id="' + p.id + '">Supprimer</button></figure>').join("") + "</div>" : "") +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Séances</h2><p>Chacune a sa page, avec son texte et ses photos. Les six premières affichées apparaissent sur l\'accueil.</p></div><div class="a-panel">' +
      '<div class="a-tbl">' + stories.map((s, i) =>
        '<div class="a-srow a-stack">' + thumbRef(s.photos[0]) + '<div class="a-nm"><b>' + esc(s.title) + (s.demo ? ' <span class="pill draft">Exemple</span>' : "") + "</b><span>" + esc(s.kind) + ", " + esc(s.place) + " · " + s.photos.length + ' photos</span></div><div class="a-acts" style="align-items:center"><label class="a-sw"><span class="a-meta">Affichée</span><input type="checkbox" data-a="sshow" data-i="' + i + '"' + (s.show !== false ? " checked" : "") + "></label>" +
        (i > 0 ? '<button class="btn ghost sm" type="button" data-a="sup" data-i="' + i + '" aria-label="Monter ' + esc(s.title) + '">Monter</button>' : "") + (i < stories.length - 1 ? '<button class="btn ghost sm" type="button" data-a="sdown" data-i="' + i + '" aria-label="Descendre ' + esc(s.title) + '">Descendre</button>' : "") + '<button class="btn ghost sm" type="button" data-a="editstory" data-i="' + i + '">Modifier</button><button class="btn ghost sm" type="button" data-a="delstory" data-i="' + i + '">Supprimer</button></div></div>').join("") + "</div>" +
      '<div><button class="btn sm" type="button" data-a="newstory">Nouvelle séance</button></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Photos de l\'accueil</h2><p>Une photo par emplacement. Tant qu\'un emplacement est vide, une photo d\'exemple s\'affiche.</p></div><div class="a-panel">' +
      '<div class="a-slots">' + Object.keys(SLOT_DEF).map((k) => {
        const set = !!SITE.slots[k];
        return '<div class="a-slot">' + thumbRef(slotRef(SITE, k)) + '<span><b>' + esc(SLOT_LABELS[k]) + "</b><small>" + (set ? "Votre photo" : "Photo d'exemple") + '</small></span><button class="btn ghost sm" type="button" data-a="slot" data-k="' + k + '">Choisir</button></div>';
      }).join("") + "</div>" +
    "</div></section>";
}
let pickCb = null;
function openPick(title, sub, current, multi, cb) {
  if (!PORT.length) { toast("Ajoutez d'abord des photos dans la bibliothèque du portfolio.", 5000); return; }
  $("h-pick").textContent = title; $("pick-sub").textContent = sub; $("pick-err").textContent = "";
  const cur = new Set([].concat(current || []));
  $("pick-grid").className = "pick" + (multi ? " multi" : "");
  $("pick-grid").innerHTML = PORT.map((p) => '<label><input type="' + (multi ? "checkbox" : "radio") + '" name="pk" value="' + esc(p.storage_path) + '"' + (cur.has(p.storage_path) ? " checked" : "") + ' aria-label="' + esc(p.caption || "Photo") + '"><img alt="" loading="lazy" src="' + esc(p.url) + '"></label>').join("");
  pickCb = cb;
  openSheet("s-pick");
}
$("pick-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = [...$("pick-grid").querySelectorAll("input:checked")].map((x) => x.value);
  if (!v.length) { $("pick-err").textContent = "Choisissez une photo."; return; }
  closeSheets();
  if (pickCb) pickCb(v);
});
async function uploadPortfolio(files) {
  files = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (!files.length) return;
  let n = 0;
  for (const file of files) {
    noteA("pf-count", "Import : " + (n + 1) + " / " + files.length + "…");
    try {
      const prev = await makePreview(file, 2400, null);
      const path = `${crypto.randomUUID()}.${prev.ext}`;
      const { error: e1 } = await sb.storage.from("portfolio").upload(path, prev.blob, { contentType: prev.blob.type });
      if (e1) throw e1;
      const { data: row, error: e2 } = await sb.from("portfolio").insert({ storage_path: path, width: prev.width, height: prev.height, position: PORT.length }).select("*").single();
      if (e2) throw e2;
      PORT.push({ ...row, url: publicUrl("portfolio", path) });
    } catch (err) { toast(file.name + " : " + errMsg(err), 5000); }
    n++;
  }
  img = makeImg(libraryOf(PORT));
  draw();
  toast(n + " photo" + (n > 1 ? "s" : "") + " ajoutée" + (n > 1 ? "s" : "") + " à la bibliothèque.");
}
let storyEdit = -1, storyPhotos = [];
function drawStoryPhotos() {
  $("sy-pick").innerHTML = storyPhotos.map((r, i) => {
    const d = img(r);
    return '<label><input type="checkbox" checked value="' + esc(r) + '" aria-label="Photo ' + (i + 1) + '"><img alt="" src="' + esc(d ? d.src : "") + '"></label>';
  }).join("") + '<button type="button" class="btn ghost sm" id="sy-add">Choisir les photos</button>';
  $("sy-add").onclick = () => {
    const keep = [...$("sy-pick").querySelectorAll("input:checked")].map((x) => x.value).filter((r) => !DEMO_DIMS[r]);
    openPick("Photos de la séance", "La première sert de couverture. Les photos d'exemple sont remplacées par votre choix.", keep, true, (v) => { storyPhotos = v; openSheet("s-story"); drawStoryPhotos(); });
  };
}
function openStory(i) {
  storyEdit = i;
  const s = i >= 0 ? SITE.stories[i] : { title: "", kind: "Mariage", place: "", when: "", text: "", photos: [] };
  $("h-story").textContent = i >= 0 ? "Modifier la séance" : "Nouvelle séance";
  $("sy-title").value = s.title; $("sy-kind").value = s.kind; $("sy-place").value = s.place; $("sy-when").value = s.when; $("sy-text").value = s.text; $("sy-err").textContent = "";
  storyPhotos = s.photos.slice();
  drawStoryPhotos();
  openSheet("s-story");
}
$("story-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("sy-title").value.trim(), photos = [...$("sy-pick").querySelectorAll("input:checked")].map((x) => x.value);
  if (!title) { $("sy-err").textContent = "Donnez un titre à la séance."; return; }
  if (!photos.length) { $("sy-err").textContent = "Choisissez au moins une photo."; return; }
  const base = { title, kind: $("sy-kind").value, place: $("sy-place").value.trim(), when: $("sy-when").value.trim(), text: $("sy-text").value.trim(), photos };
  if (storyEdit >= 0) {
    const old = SITE.stories[storyEdit];
    SITE.stories[storyEdit] = { ...old, ...base, demo: photos.some((r) => DEMO_DIMS[r]) && old.demo };
  } else {
    const id = initials(title).toLowerCase() + "-" + rnd(4).toLowerCase();
    SITE.stories.push({ id, ...base, show: true });
  }
  if (await saveSite("Séance enregistrée.")) { closeSheets(); draw(); }
});

// =================================================================== avis
function viewAvis() {
  const idx = REVS.map((r, i) => i);
  const pend = idx.filter((i) => REVS[i].status === "pending"), pub = idx.filter((i) => REVS[i].status !== "pending" && !REVS[i].is_private), priv = idx.filter((i) => REVS[i].status !== "pending" && REVS[i].is_private);
  const nv = REVS.filter(shown).length;
  const ctx = (r) => (r.ctx ? '<span class="a-meta">' + esc(r.ctx) + "</span>" : "");
  let h = '<div class="a-top"><div><h1>Avis</h1><p class="a-sub">' + nv + " affiché" + (nv > 1 ? "s" : "") + " sur l'accueil" + (pend.length ? ", " + pend.length + " à relire" : "") + '.</p></div><div class="a-acts"><button class="btn sm" type="button" data-a="addrev">Ajouter un avis</button></div></div>';
  if (pend.length) h += '<h2 class="a-h2" id="a-pend">À relire</h2><div class="a-tbl">' + pend.map((i) => {
    const r = REVS[i];
    return '<div class="a-srow">' + thumbRef(r.image_path) + '<div class="a-nm"><b>' + esc(r.who) + '</b><span class="a-ex full">« ' + esc(r.body) + ' »</span><span class="a-meta">' + (r.is_private ? "Message privé, à ne pas publier" : "Accepte la publication sur le site") + ", reçu le " + fdate(r.updated_at || r.created_at, { day: "numeric", month: "long" }) + "</span></div>" +
      '<div class="a-acts" style="align-items:center">' + (r.is_private ? '<button class="btn sm" type="button" data-a="revread" data-i="' + i + '">Marquer comme lu</button>'
        : '<button class="btn sm" type="button" data-a="revok" data-i="' + i + '">Publier</button><button class="btn ghost sm" type="button" data-a="revno" data-i="' + i + '">Ne pas publier</button>') + "</div></div>";
  }).join("") + "</div>";
  h += (pend.length || priv.length ? '<h2 class="a-h2">Sur le site</h2>' : "") + (pub.length ? '<div class="a-tbl">' + pub.map((i, k) => {
    const r = REVS[i];
    return '<div class="a-srow">' + thumbRef(r.image_path) + '<div class="a-nm"><b>' + esc(r.who) + '</b><span class="a-ex">« ' + esc(r.body) + " »</span>" + ctx(r) + "</div>" +
      '<div class="a-acts" style="align-items:center"><label class="a-sw"><span class="a-meta">Affiché</span><input type="checkbox" data-a="revon" data-i="' + i + '"' + (r.status === "published" ? " checked" : "") + "></label>" +
      (k > 0 ? '<button class="btn ghost sm" type="button" data-a="revup" data-i="' + i + '" data-j="' + pub[k - 1] + '" aria-label="Monter l\'avis de ' + esc(r.who) + '">Monter</button>' : "") +
      '<button class="btn ghost sm" type="button" data-a="editrev" data-i="' + i + '">Modifier</button></div></div>';
  }).join("") + "</div>"
    : '<div class="a-empty"><b>Aucun avis pour l\'instant</b><span class="a-meta">Vos clients peuvent en laisser un depuis leur galerie, ou ajoutez-le vous-même avec leur accord.</span></div>');
  if (priv.length) h += '<h2 class="a-h2">Messages privés</h2><div class="a-tbl">' + priv.map((i) => {
    const r = REVS[i];
    return '<div class="a-srow">' + thumbRef(null) + '<div class="a-nm"><b>' + esc(r.who) + '</b><span class="a-ex full">« ' + esc(r.body) + ' »</span><span class="a-meta">Reçu le ' + fdate(r.updated_at || r.created_at, { day: "numeric", month: "long" }) + '</span></div><div class="a-acts" style="align-items:center"><button class="btn ghost sm" type="button" data-a="revdel" data-i="' + i + '">Supprimer</button></div></div>';
  }).join("") + "</div>";
  return h + '<p class="a-note" id="a-note" aria-live="polite"></p><p class="a-meta" style="margin-top:12px">Un avis écrit par un client n\'apparaît sur l\'accueil qu\'après votre accord. Pour un avis ajouté à la main, demandez toujours l\'accord du client.</p>';
}
let revEdit = -1, revImg = null;
function drawRevImg() {
  const d = revImg ? img(revImg) : null;
  $("r-pick").innerHTML = (d ? '<label><input type="radio" checked aria-label="Photo choisie"><img alt="" src="' + esc(d.src) + '"></label>' : "") + '<button type="button" class="btn ghost sm" id="r-choose">' + (d ? "Changer" : "Choisir une photo") + "</button>";
  $("r-choose").onclick = () => openPick("Photo de l'avis", "Une photo de leur séance, de préférence.", revImg, false, (v) => { revImg = v[0]; openSheet("s-rev"); drawRevImg(); });
}
function openRev(i) {
  revEdit = i;
  const r = i >= 0 ? REVS[i] : { who: "", ctx: "", body: "", image_path: null };
  $("h-rev").textContent = i >= 0 ? "Modifier l'avis" : "Nouvel avis";
  $("r-who").value = r.who; $("r-ctx").value = r.ctx || ""; $("r-text").value = r.body; $("r-err").textContent = "";
  $("r-del").hidden = i < 0;
  revImg = r.image_path;
  drawRevImg(); revCount(); openSheet("s-rev");
}
function revCount() { $("r-count").textContent = $("r-text").value.length + " / 600 caractères"; }
$("r-text").addEventListener("input", revCount);
$("rev-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const who = $("r-who").value.trim(), body = $("r-text").value.trim().replace(/^[«"\s]+|[»"\s]+$/g, "");
  if (!who || !body) { $("r-err").textContent = !who ? "Indiquez le nom des clients." : "Écrivez leur avis."; return; }
  const row = { who, ctx: $("r-ctx").value.trim() || null, body, image_path: revImg || null, updated_at: new Date().toISOString() };
  const q = revEdit >= 0 ? sb.from("reviews").update(row).eq("id", REVS[revEdit].id) : sb.from("reviews").insert({ ...row, status: "published", position: -1 });
  const { error } = await q;
  if (error) { $("r-err").textContent = error.message; return; }
  await loadReviews(); closeSheets(); draw(); noteA("a-note", "Avis enregistré.");
});
$("r-del").onclick = async () => {
  if (revEdit < 0 || !confirm("Supprimer cet avis ?")) return;
  await sb.from("reviews").delete().eq("id", REVS[revEdit].id);
  await loadReviews(); closeSheets(); draw(); noteA("a-note", "Avis supprimé.");
};

// =================================================================== site et Google
const serp = () => '<div class="serp" id="serp"><small>lau-rie.fr</small><b>' + esc(SITE.seoTitle) + "</b><span>" + esc(SITE.seoDesc) + "</span></div>";
const counter = (id, len, max) => '<span class="a-count' + (len > max ? " over" : "") + '" id="' + id + '">' + len + " / " + max + "</span>";
function viewSite() {
  return '<div class="a-top"><div><h1>Site et Google</h1><p class="a-sub">Ce que vous changez ici apparaît tout de suite sur le site.</p></div><div class="a-acts"><a class="btn ghost sm" href="index.html" target="_blank" rel="noopener">Voir le site</a></div></div>' +
    '<section class="a-set"><div class="a-lab"><h2>Accueil</h2><p>Le grand titre tient sur deux lignes : gardez chaque ligne courte.</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="s-t1">Titre, ligne 1</label><input class="a-in" id="s-t1" maxlength="18" value="' + esc(SITE.t1) + '"></div><div class="a-f"><label for="s-t2">Titre, ligne 2</label><input class="a-in" id="s-t2" maxlength="18" value="' + esc(SITE.t2) + '"></div></div>' +
      '<div class="a-f"><label for="s-lede">Phrase sous le titre</label><textarea class="a-in" id="s-lede" rows="3" maxlength="300">' + esc(SITE.lede) + "</textarea></div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Tarifs</h2><p>Une ligne par formule. Le prix s\'écrit en euros, sans le symbole.</p></div><div class="a-panel" id="s-prices">' +
      SITE.prices.map((p, i) => '<div class="a-3"><div class="a-f"><label for="p-n' + i + '">Formule</label><input class="a-in" id="p-n' + i + '" maxlength="40" value="' + esc(p.name) + '"></div><div class="a-f"><label for="p-d' + i + '">Ce qui est compris</label><textarea class="a-in a-short" id="p-d' + i + '" maxlength="200" rows="2">' + esc(p.detail) + '</textarea></div><div class="a-f"><label for="p-p' + i + '">Prix</label><div class="a-join"><input class="a-in" id="p-p' + i + '" inputmode="numeric" value="' + (p.price || "") + '"><button type="button" data-a="delprice" data-i="' + i + '" aria-label="Retirer la formule ' + esc(p.name) + '">×</button></div></div></div>').join("") +
      '<div><button class="btn ghost sm" type="button" data-a="addprice">Ajouter une formule</button></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Contact</h2><p>L\'adresse affichée sur le site et utilisée pour répondre aux clients.</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="s-mail">E-mail</label><input class="a-in" id="s-mail" type="email" value="' + esc(SITE.mail) + '"></div><div class="a-f"><label for="s-ig">Lien Instagram</label><input class="a-in" id="s-ig" type="url" value="' + esc(SITE.ig) + '"></div></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Google</h2><p>Le titre et la phrase que Google affiche. Citez votre métier et votre ville : c\'est ce que les gens tapent.</p></div><div class="a-panel">' +
      '<div class="a-f"><div style="display:flex;justify-content:space-between;gap:8px"><label for="s-seot">Titre dans Google</label>' + counter("c-seot", SITE.seoTitle.length, 60) + '</div><input class="a-in" id="s-seot" value="' + esc(SITE.seoTitle) + '" aria-describedby="c-seot"></div>' +
      '<div class="a-f"><div style="display:flex;justify-content:space-between;gap:8px"><label for="s-seod">Description</label>' + counter("c-seod", SITE.seoDesc.length, 160) + '</div><textarea class="a-in" id="s-seod" rows="3" aria-describedby="c-seod">' + esc(SITE.seoDesc) + "</textarea></div>" +
      '<div class="ct-two"><div class="a-f"><label for="s-city">Ville</label><input class="a-in" id="s-city" value="' + esc(SITE.city) + '"></div><div class="a-f"><label for="s-area">Zone couverte</label><input class="a-in" id="s-area" value="' + esc(SITE.area) + '"></div></div>' +
      '<div class="a-f"><span class="l">Aperçu dans les résultats de recherche</span>' + serp() + "</div>" +
      '<div class="a-f"><span class="l">Aperçu quand le site est partagé</span><div class="share-card big" id="site-card"><img alt="" src="partage.jpg"><div><b>' + esc(SITE.seoTitle) + "</b><span>" + esc(SITE.seoDesc) + "</span><small>lau-rie.fr</small></div></div></div>" +
    "</div></section>" +
    '<div class="a-save"><button class="btn" type="button" data-a="savesite">Enregistrer</button><span class="a-note" id="a-saved" aria-live="polite"></span></div>';
}
function readSiteForm() {
  SITE.t1 = $("s-t1").value.trim() || SITE.t1; SITE.t2 = $("s-t2").value.trim(); SITE.lede = $("s-lede").value.trim();
  SITE.prices = SITE.prices.map((p, i) => ({ name: $("p-n" + i).value.trim() || p.name, detail: $("p-d" + i).value.trim(), price: parseInt($("p-p" + i).value.replace(/\D/g, ""), 10) || 0 }));
  const m = $("s-mail").value.trim(); if (EMAIL.test(m)) SITE.mail = m;
  const ig = $("s-ig").value.trim(); if (/^https:\/\//.test(ig)) SITE.ig = ig;
  SITE.seoTitle = $("s-seot").value.trim() || SITE.seoTitle; SITE.seoDesc = $("s-seod").value.trim() || SITE.seoDesc;
  SITE.city = $("s-city").value.trim() || SITE.city; SITE.area = $("s-area").value.trim() || SITE.area;
}

// =================================================================== réglages
let ADMINS = [];
function viewReglages() {
  const L = SITE.legal;
  return '<div class="a-top"><div><h1>Réglages</h1><p class="a-sub">Informations légales, e-mail de rappel, équipe et mot de passe.</p></div></div>' +
    '<section class="a-set"><div class="a-lab"><h2>Informations légales</h2><p>Elles remplissent automatiquement les mentions légales, la politique de confidentialité et les conditions de prestation. Faites relire ces pages une fois (CCI ou juriste).</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="l-owner">Nom et prénom</label><input class="a-in" id="l-owner" autocomplete="name" value="' + esc(L.owner) + '"></div><div class="a-f"><label for="l-status">Statut</label><input class="a-in" id="l-status" value="' + esc(L.status) + '"></div></div>' +
      '<div class="ct-two"><div class="a-f"><label for="l-siret">SIRET</label><input class="a-in" id="l-siret" inputmode="numeric" placeholder="14 chiffres" value="' + esc(L.siret) + '"></div><div class="a-f"><label for="l-phone">Téléphone</label><input class="a-in" id="l-phone" type="tel" value="' + esc(L.phone) + '"></div></div>' +
      '<div class="a-f"><label for="l-address">Adresse professionnelle</label><input class="a-in" id="l-address" value="' + esc(L.address) + '"></div>' +
      '<div class="a-f"><label for="l-vat">Mention TVA</label><input class="a-in" id="l-vat" value="' + esc(L.vat) + '"></div>' +
      '<div class="ct-two"><div class="a-f"><label for="l-deposit">Acompte (%)</label><input class="a-in" id="l-deposit" inputmode="numeric" value="' + esc(L.deposit) + '"></div><div class="a-f"><label for="l-delay">Délai de livraison</label><input class="a-in" id="l-delay" value="' + esc(L.delay) + '"></div></div>' +
      '<div class="a-f"><label for="l-delaywed">Délai de livraison pour un mariage (si différent)</label><input class="a-in" id="l-delaywed" value="' + esc(L.delayWed) + '"></div>' +
      '<div class="ct-two"><div class="a-f"><label for="l-mediator">Médiateur de la consommation</label><input class="a-in" id="l-mediator" placeholder="Obligatoire pour vendre à des particuliers" value="' + esc(L.mediator) + '"></div><div class="a-f"><label for="l-medurl">Site du médiateur</label><input class="a-in" id="l-medurl" type="url" placeholder="https://" value="' + esc(L.mediatorUrl) + '"></div></div>' +
      '<div class="a-f"><label for="l-host">Hébergeur du site</label><input class="a-in" id="l-host" value="' + esc(L.host) + '"></div>' +
      '<div class="a-save" style="padding-top:4px"><button class="btn sm" type="button" data-a="savelegal">Enregistrer</button><a class="btn ghost sm" href="index.html#mentions-legales" target="_blank" rel="noopener">Voir les pages</a><span class="a-note" id="a-legal" aria-live="polite"></span></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Réponses aux demandes</h2><p>Des réponses toutes prêtes, à choisir en un clic dans Demandes. Les mots entre accolades sont remplacés : {prenom}, {formule}, {tarifs} (vos formules et leurs prix), {site}.</p></div><div class="a-panel">' +
      (SITE.replies || []).map((r, i) => '<div class="a-reply"><div class="a-f"><label for="rp-n' + i + '">Nom de la réponse</label><div class="a-join"><input class="a-in" id="rp-n' + i + '" maxlength="40" value="' + esc(r.name) + '"><button type="button" data-a="delreply" data-i="' + i + '" aria-label="Retirer la réponse ' + esc(r.name) + '">×</button></div></div>' +
        '<div class="a-f"><label for="rp-s' + i + '">Objet</label><input class="a-in" id="rp-s' + i + '" maxlength="120" value="' + esc(r.subj) + '"></div>' +
        '<div class="a-f"><label for="rp-b' + i + '">Message</label><textarea class="a-in" id="rp-b' + i + '" rows="7" maxlength="2000">' + esc(r.body) + "</textarea></div></div>").join("") +
      '<div class="a-save" style="padding-top:4px"><button class="btn sm" type="button" data-a="savereplies">Enregistrer les réponses</button><button class="btn ghost sm" type="button" data-a="addreply">Ajouter une réponse</button><span class="a-note" id="a-replies" aria-live="polite"></span></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>E-mail de rappel</h2><p>Envoyé avant la fermeture de chaque galerie. Les mots entre accolades sont remplacés automatiquement : {clients}, {date}, {lien}, {code}.</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="m-subj">Objet</label><input class="a-in" id="m-subj" value="' + esc(SITE.mailSubj) + '"></div>' +
      '<div class="a-f"><label for="m-body">Message</label><textarea class="a-in" id="m-body" rows="10">' + esc(SITE.mailBody) + "</textarea></div>" +
      '<div class="a-f"><span class="l">Aperçu</span><div class="mailprev" id="m-prev">' + mailPrev(SITE.mailSubj, SITE.mailBody) + "</div></div>" +
      '<div class="a-save" style="padding-top:4px"><button class="btn sm" type="button" data-a="savetpl">Enregistrer le modèle</button><span class="a-note" id="a-tpl" aria-live="polite"></span></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Équipe</h2><p>Les personnes qui gèrent le site avec vous ont les mêmes droits que vous. Gardez toujours deux comptes : si l\'une oublie son mot de passe, l\'autre lui en redonne un.</p></div><div class="a-panel">' +
      '<ul class="a-team" id="a-team">' + (ADMINS.length ? ADMINS.map((a) => "<li><span>" + esc(a.email) + "<br><small>" + (a.user_id === user.id ? "Vous" : a.last_sign_in_at ? "Dernière connexion le " + fdate(a.last_sign_in_at) : "Jamais connectée") + "</small></span>" + (a.user_id === user.id ? "" : '<span class="a-acts"><button class="btn ghost sm" type="button" data-a="resetpw" data-id="' + a.user_id + '" data-email="' + esc(a.email) + '">Nouveau mot de passe</button><button class="btn ghost sm" type="button" data-a="rmadmin" data-id="' + a.user_id + '" data-email="' + esc(a.email) + '">Retirer</button></span>') + "</li>").join("") : "<li><span>Chargement…</span></li>") + "</ul>" +
      '<div class="a-f"><label for="t-mail">Ajouter quelqu\'un</label><div class="a-join"><input class="a-in" id="t-mail" type="email" placeholder="prenom@exemple.fr"><button type="button" data-a="invite">Créer le compte</button></div></div><p class="a-note" id="a-note" aria-live="polite"></p>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Mon mot de passe</h2><p>Connectée en tant que ' + esc(user.email) + ".</p></div><div class=\"a-panel\">" +
      '<div class="a-f"><label for="mp-1">Nouveau mot de passe (12 caractères minimum)</label><input class="a-in" id="mp-1" type="password" minlength="12" autocomplete="new-password"></div>' +
      '<div class="a-f"><label for="mp-2">Confirmer</label><input class="a-in" id="mp-2" type="password" minlength="12" autocomplete="new-password"></div>' +
      '<div class="a-save" style="padding-top:4px"><button class="btn sm" type="button" data-a="mypw">Mettre à jour</button><span class="a-note" id="a-pw" aria-live="polite"></span></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Session</h2><p>Sur un appareil partagé, pensez à vous déconnecter.</p></div><div class="a-panel"><div><button class="btn ghost sm" type="button" data-a="logout">Se déconnecter</button></div></div></section>' +
    '<section class="a-set"><div class="a-lab"><h2>Aide</h2><p>Le guide pas à pas explique la mise en ligne et chaque écran.</p></div><div class="a-panel"><p class="a-meta" style="color:var(--ink)">Le guide est dans le dossier du site : GUIDE-MISE-EN-LIGNE.md. Il couvre la création d\'une galerie, l\'envoi du code, le lien SwissTransfer et les e-mails automatiques.</p></div></section>';
}
function mailPrev(subj, body) {
  const g = GAL.find((x) => x.expires_at) || { title: "Léa & Thomas", client_name: "Léa & Thomas", expires_at: addDays(ymd(new Date().toISOString()), 30), owner_code: "LT-7K4QX2" };
  return "<b>" + esc(fillTpl(subj, mailVars(g))) + "</b><pre>" + esc(fillTpl(body, mailVars(g))) + "</pre>";
}
async function loadAdmins() {
  const { data, error } = await sb.rpc("list_admins");
  if (error) { toast(error.message); return; }
  ADMINS = data || [];
  if (tab === "reglages") draw();
}
function strongPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* réponse sans détail */ }
    throw new Error(msg);
  }
  return data;
}
function showPassword(email, pw) {
  $("pw-mail").value = email; $("pw-val").value = pw;
  $("pw-copy").onclick = () => { copy(pw, null, ""); toast("Mot de passe copié."); };
  openSheet("s-pw");
}

// =================================================================== affichage
function navSync() {
  [...$("a-nav").children].forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  const n = selCount(); $("a-selcnt").hidden = !n; $("a-selcnt").textContent = n;
  const tn = todos().length; $("a-todocnt").hidden = !tn; $("a-todocnt").textContent = tn;
  const rn = newReqs(); $("a-reqcnt").hidden = !rn; $("a-reqcnt").textContent = rn;
}
function draw() {
  const g = openId && galById(openId);
  const html = tab === "accueil" ? viewAccueil() : tab === "galeries" ? (g ? viewGallery(g) : viewGaleries()) : tab === "selections" ? viewSelections()
    : tab === "demandes" ? viewDemandes() : tab === "portfolio" ? viewPortfolio() : tab === "site" ? viewSite() : tab === "avis" ? viewAvis() : viewReglages();
  $("a-main").innerHTML = html;
  navSync();
}
// Modifications non enregistrées : bandeau « Enregistrer » et alerte avant de quitter
const DIRTY = new Set();
const SAVE_OF = (id) => !id ? null : /^g-(?!link$)/.test(id) ? "save" : /^(s-|p-)/.test(id) ? "savesite" : /^l-/.test(id) ? "savelegal" : /^m-/.test(id) ? "savetpl" : /^rp-/.test(id) ? "savereplies" : null;
function dirtySync() {
  const bar = $("a-dirty"); if (!bar) return;
  bar.hidden = !DIRTY.size;
  document.body.classList.toggle("has-dirty", !!DIRTY.size);
}
function markDirty(act) { if (act) { DIRTY.add(act); dirtySync(); } }
function markClean(act) { DIRTY.delete(act); dirtySync(); }
function leaveOk() {
  if (!DIRTY.size) return true;
  if (!confirm("Des modifications ne sont pas enregistrées. Les abandonner ?")) return false;
  DIRTY.clear(); dirtySync(); return true;
}
window.addEventListener("beforeunload", (e) => { if (DIRTY.size) { e.preventDefault(); e.returnValue = ""; } });
$("a-dirty-save").addEventListener("click", () => {
  const act = [...DIRTY][0], btn = act && $("a-main").querySelector('[data-a="' + act + '"]');
  if (btn) btn.click(); else { DIRTY.clear(); dirtySync(); }
});

async function go(t, id) {
  if (!leaveOk()) return;
  tab = t; openId = id || null; gShowAll = false;
  if (t === "galeries" && openId) {
    $("a-main").innerHTML = '<p class="a-meta">Chargement de la galerie…</p>';
    try { await loadGalleryPhotos(galById(openId)); } catch (e) { toast(errMsg(e)); }
  }
  if (t === "selections") await loadSelNames();
  if (t === "reglages") loadAdmins();
  draw();
  window.scrollTo(0, 0);
}
$("a-nav").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) go(b.dataset.tab); });

// =================================================================== actions
$("a-main").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-a]");
  if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
  const a = b.dataset.a, g = openId && galById(openId);
  try {
    if (a === "regen" || a === "regen2") markDirty("save");
    if (a === "addprice" || a === "delprice") markDirty("savesite");
    if (a === "addreply" || a === "delreply") markDirty("savereplies");
    if (a === "open") await go("galeries", b.dataset.id);
    else if (a === "go") await go(b.dataset.to);
    else if (a === "back") await go("galeries");
    else if (a === "new") { $("n-err").textContent = ""; $("n-name").value = ""; $("n-date").value = ""; openSheet("s-new"); }
    else if (a === "copylink") copy($("g-link").value, $("a-note"), "Lien copié.");
    else if (a === "regen") { $("g-code").value = newCode($("g-title").value || g.title); noteA("a-note", "Nouveau code : " + $("g-code").value + ". Enregistrez pour l'appliquer."); }
    else if (a === "regen2") { $("g-gcode").value = newGuestCode($("g-title").value || g.title); noteA("a-note", "Nouveau code invités : " + $("g-gcode").value + ". Enregistrez pour l'appliquer."); }
    else if (a === "msg") { if (!g.owner_code) { noteA("a-note", "Enregistrez d'abord un code des clients."); return; } copy(clientMessage(g), $("a-note"), "Message copié, prêt à coller dans un e-mail ou un SMS."); }
    else if (a === "save") await saveGallery(g);
    else if (a === "sendmail") {
      if (DIRTY.has("save")) { noteA("a-note", "Enregistrez d'abord vos modifications."); return; }
      if (!g.client_email) { noteA("a-note", "Ajoutez l'e-mail des clients (section Accès), puis enregistrez."); $("g-email").focus(); return; }
      if (g.status !== "published") { noteA("a-note", "Cochez « Galerie visible par les clients » et enregistrez avant d'envoyer le lien."); return; }
      $("ml-to").textContent = g.client_email; $("ml-err").textContent = "";
      $("ml-subj").value = "Vos photos sont en ligne";
      $("ml-body").value = mailMessage(g);
      $("ml-again").hidden = !g.link_sent_at; $("ml-again").textContent = g.link_sent_at ? "Déjà envoyé le " + fdate(g.link_sent_at) + "." : "";
      openSheet("s-mail");
    }
    else if (a === "card") {
      noteA("card-note", "Préparation de la carte…");
      if (document.fonts && document.fonts.load) await Promise.all(['300 italic 120px "Cormorant Garamond"', '400 40px "Jost"', '500 56px "Jost"'].map((f) => document.fonts.load(f).catch(() => null)));
      const cv = makeCard(g);
      $("card-prev").src = cv.toDataURL("image/png"); $("card-prev").hidden = false;
      downloadCanvas(cv, "carte-galerie-" + initials(g.title).toLowerCase() + ".png", "Carte prête : 1 200 × 1 800 px, à imprimer en 10 × 15 cm.");
    }
    else if (a === "qrpng") { const cv = document.createElement("canvas"); cv.width = cv.height = 1000; qrPaint(cv.getContext("2d"), galleryLink(g.owner_code), 0, 0, 1000); downloadCanvas(cv, "qr-galerie-" + initials(g.title).toLowerCase() + ".png", "QR code téléchargé (1 000 × 1 000 px)."); }
    else if (a === "mailprev") { const mp = $("g-mail"); mp.hidden = !mp.hidden; b.setAttribute("aria-expanded", String(!mp.hidden)); b.textContent = mp.hidden ? "Voir l'e-mail" : "Masquer l'e-mail"; }
    else if (a === "showall") { gShowAll = true; $("g-photos").innerHTML = photoGrid(g); }
    else if (a === "cover") {
      const p = gPhotos.find((x) => x.id === b.dataset.pid);
      const { error } = await sb.from("galleries").update({ cover_photo_id: p.id }).eq("id", g.id);
      if (error) throw error;
      g.cover_photo_id = p.id; g.cover = { preview_path: p.preview_path }; COVERS[p.preview_path] = gUrls[p.preview_path];
      $("g-photos").innerHTML = photoGrid(g); $("g-card").outerHTML = shareCard(g); toast("Couverture changée.");
    }
    else if (a === "delphoto") {
      const p = gPhotos.find((x) => x.id === b.dataset.pid);
      if (!confirm("Supprimer la photo " + p.filename + " de la galerie ?")) return;
      const { error } = await sb.from("photos").delete().eq("id", p.id);
      if (error) throw error;
      await sb.storage.from("galleries").remove([p.preview_path]);
      gPhotos = gPhotos.filter((x) => x.id !== p.id); g.nphotos = gPhotos.length;
      if (g.cover_photo_id === p.id) { g.cover_photo_id = null; g.cover = null; }
      $("g-photos").innerHTML = photoGrid(g); noteA("g-count", gPhotos.length + " photos.");
    }
    else if (a === "delgal") {
      if (!confirm("Supprimer définitivement la galerie « " + g.title + " », ses " + g.nphotos + " aperçus et ses sélections ?")) return;
      const paths = gPhotos.map((p) => p.preview_path);
      await sb.from("galleries").update({ cover_photo_id: null }).eq("id", g.id);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from("galleries").remove(paths.slice(i, i + 100));
      const { error } = await sb.from("galleries").delete().eq("id", g.id);
      if (error) throw error;
      await loadGalleries(); await go("galeries"); toast("Galerie supprimée.");
    }
    else if (a === "nums") {
      const s = SEL[b.dataset.id], names = s.photo_ids.map(nameOf);
      copy(names.join(", "), $("a-note"), names.length + " noms copiés : " + names.slice(0, 5).join(", ") + (names.length > 5 ? "…" : ""));
    }
    else if (a === "treat") {
      const gt = galById(b.dataset.id), now = new Date().toISOString();
      const { error } = await sb.from("galleries").update({ treated_at: now }).eq("id", gt.id);
      if (error) throw error;
      gt.treated_at = now; draw();
    }
    else if (a === "delreq") {
      if (!confirm("Supprimer cette demande ?")) return;
      const { error } = await sb.from("booking_requests").delete().eq("id", b.dataset.id);
      if (error) throw error;
      REQS = REQS.filter((x) => x.id !== b.dataset.id); draw();
    }
    else if (a === "delpf") {
      const p = PORT.find((x) => x.id === b.dataset.id);
      const used = SITE.stories.some((s) => s.photos.includes(p.storage_path)) || Object.values(SITE.slots).includes(p.storage_path) || REVS.some((r) => r.image_path === p.storage_path);
      if (!confirm(used ? "Cette photo est utilisée sur le site (séance, accueil ou avis). La supprimer quand même ?" : "Supprimer cette photo du portfolio ?")) return;
      const { error } = await sb.from("portfolio").delete().eq("id", p.id);
      if (error) throw error;
      await sb.storage.from("portfolio").remove([p.storage_path]);
      PORT = PORT.filter((x) => x.id !== p.id);
      SITE.stories.forEach((s) => { s.photos = s.photos.filter((r) => r !== p.storage_path); });
      Object.keys(SITE.slots).forEach((k) => { if (SITE.slots[k] === p.storage_path) delete SITE.slots[k]; });
      img = makeImg(libraryOf(PORT));
      if (used) await saveSite();
      draw();
    }
    else if (a === "slot") {
      const k = b.dataset.k;
      openPick(SLOT_LABELS[k], "Photo affichée à cet emplacement de l'accueil.", SITE.slots[k], false, async (v) => { SITE.slots[k] = v[0]; if (await saveSite("Photo de l'accueil changée.")) draw(); });
    }
    else if (a === "newstory") openStory(-1);
    else if (a === "editstory") openStory(Number(b.dataset.i));
    else if (a === "delstory") {
      const i = Number(b.dataset.i);
      if (!confirm("Supprimer la séance « " + SITE.stories[i].title + " » du site ? Les photos restent dans la bibliothèque.")) return;
      SITE.stories.splice(i, 1);
      if (await saveSite("Séance supprimée.")) draw();
    }
    else if (a === "sup") { const i = Number(b.dataset.i), L = SITE.stories; [L[i - 1], L[i]] = [L[i], L[i - 1]]; if (await saveSite()) draw(); }
    else if (a === "sdown") { const i = Number(b.dataset.i), L = SITE.stories; [L[i + 1], L[i]] = [L[i], L[i + 1]]; if (await saveSite()) draw(); }
    else if (a === "addrev") openRev(-1);
    else if (a === "editrev") openRev(Number(b.dataset.i));
    else if (a === "revup") {
      const r1 = REVS[Number(b.dataset.i)], r2 = REVS[Number(b.dataset.j)];
      const list = REVS.filter((r) => r.status !== "pending" && !r.is_private);
      const i1 = list.indexOf(r1), i2 = list.indexOf(r2);
      [list[i1], list[i2]] = [list[i2], list[i1]];
      await Promise.all(list.map((r, k) => sb.from("reviews").update({ position: k }).eq("id", r.id)));
      await loadReviews(); draw();
    }
    else if (a === "revok" || a === "revno" || a === "revread") {
      const r = REVS[Number(b.dataset.i)];
      const { error } = await sb.from("reviews").update({ status: a === "revok" ? "published" : "hidden" }).eq("id", r.id);
      if (error) throw error;
      await loadReviews(); draw();
      noteA("a-note", a === "revok" ? "Avis publié sur l'accueil." : a === "revno" ? "Avis gardé, non affiché. Vous pourrez l'afficher plus tard." : "Message marqué comme lu.");
    }
    else if (a === "revdel") {
      if (!confirm("Supprimer ce message ?")) return;
      await sb.from("reviews").delete().eq("id", REVS[Number(b.dataset.i)].id);
      await loadReviews(); draw(); noteA("a-note", "Message supprimé.");
    }
    else if (a === "addprice") { readSiteForm(); SITE.prices.push({ name: "Nouvelle formule", detail: "", price: 0 }); draw(); noteA("a-saved", "Pensez à enregistrer."); }
    else if (a === "delprice") { readSiteForm(); SITE.prices.splice(Number(b.dataset.i), 1); draw(); noteA("a-saved", "Formule retirée. Pensez à enregistrer."); }
    else if (a === "savesite") { readSiteForm(); if (await saveSite()) { markClean("savesite"); draw(); noteA("a-saved", "Enregistré. Le site est à jour."); } }
    else if (a === "savelegal") {
      const sir = $("l-siret").value.replace(/\s/g, "");
      if (sir && !/^\d{14}$/.test(sir)) { noteA("a-legal", "Le SIRET compte 14 chiffres."); return; }
      const mu = $("l-medurl").value.trim();
      if (mu && !/^https:\/\//.test(mu)) { noteA("a-legal", "Le site du médiateur doit commencer par https://"); return; }
      SITE.legal = { owner: $("l-owner").value.trim(), status: $("l-status").value.trim(), siret: sir ? sir.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4") : "", address: $("l-address").value.trim(), phone: $("l-phone").value.trim(), vat: $("l-vat").value.trim(), deposit: $("l-deposit").value.replace(/[^\d]/g, ""), delay: $("l-delay").value.trim(), delayWed: $("l-delaywed").value.trim(), host: $("l-host").value.trim(), mediator: $("l-mediator").value.trim(), mediatorUrl: mu };
      if (await saveSite()) {
        markClean("savelegal");
        const miss = LEGAL_REQ.filter((x) => !SITE.legal[x[0]]).length;
        $("a-name").firstChild.textContent = SITE.legal.owner || "Espace photographe";
        noteA("a-legal", miss ? "Enregistré. Il reste " + miss + " information" + (miss > 1 ? "s" : "") + " à compléter." : "Enregistré. Les pages légales sont complètes.");
        navSync();
      }
    }
    else if (a === "addreply") { readReplies(); SITE.replies.push({ name: "Nouvelle réponse", subj: "", body: "Bonjour {prenom},\n\n\n\nÀ bientôt,\nLaurie" }); draw(); noteA("a-replies", "Pensez à enregistrer."); }
    else if (a === "delreply") { readReplies(); SITE.replies.splice(Number(b.dataset.i), 1); draw(); noteA("a-replies", "Réponse retirée. Pensez à enregistrer."); }
    else if (a === "savereplies") {
      readReplies();
      if (SITE.replies.some((r) => !r.body.trim())) { noteA("a-replies", "Chaque réponse a besoin d'un message."); return; }
      if (await saveSite()) { markClean("savereplies"); noteA("a-replies", "Réponses enregistrées."); }
    }
    else if (a === "reply") {
      const r = REQS.find((x) => x.id === b.dataset.id);
      replyTo = r; $("h-reply").textContent = "Répondre à " + r.name; $("rp-to").textContent = r.email; $("rp-err").textContent = "";
      $("rp-pick").innerHTML = [...(SITE.replies || []).map((x, i) => [String(i), x.name]), ["", "Message vide"]].map(([v, n], k) =>
        '<label class="opt"><input type="radio" name="rpick" value="' + v + '"' + (k === 0 ? " checked" : "") + "><span><b>" + esc(n) + "</b></span></label>").join("");
      fillReply();
      openSheet("s-reply");
    }
    else if (a === "savetpl") {
      const sj = $("m-subj").value.trim(), bd = $("m-body").value.trim();
      if (!sj || !bd) { noteA("a-tpl", "L'objet et le message ne peuvent pas être vides."); return; }
      SITE.mailSubj = sj; SITE.mailBody = bd;
      if (await saveSite()) { markClean("savetpl"); noteA("a-tpl", "Modèle enregistré."); }
    }
    else if (a === "invite") {
      const t = $("t-mail").value.trim();
      if (!EMAIL.test(t)) { noteA("a-note", "Entrez une adresse e-mail complète."); return; }
      const pw = strongPassword();
      await adminCall({ action: "create", email: t, password: pw });
      $("t-mail").value = "";
      await loadAdmins();
      showPassword(t, pw);
    }
    else if (a === "resetpw") {
      if (!confirm("Définir un mot de passe provisoire pour " + b.dataset.email + " ?")) return;
      const pw = strongPassword();
      await adminCall({ action: "reset_password", user_id: b.dataset.id, password: pw });
      showPassword(b.dataset.email, pw);
    }
    else if (a === "rmadmin") {
      if (!confirm("Retirer définitivement l'accès de " + b.dataset.email + " ?")) return;
      await adminCall({ action: "remove", user_id: b.dataset.id });
      await loadAdmins(); toast("Accès retiré.");
    }
    else if (a === "mypw") {
      const p1 = $("mp-1").value;
      if (p1.length < 12) { noteA("a-pw", "12 caractères minimum."); return; }
      if (p1 !== $("mp-2").value) { noteA("a-pw", "Les deux mots de passe ne correspondent pas."); return; }
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) { noteA("a-pw", error.message); return; }
      $("mp-1").value = $("mp-2").value = ""; noteA("a-pw", "Mot de passe mis à jour.");
    }
    else if (a === "logout") { if (!leaveOk()) return; await sb.auth.signOut(); showLogin(); }
  } catch (err) {
    toast(errMsg(err), 6000);
  }
});

async function saveGallery(g) {
  const hd = $("g-hd").value.trim();
  if (hd && !/^https:\/\//.test(hd)) { noteA("a-saved", "Le lien SwissTransfer doit commencer par https://"); return; }
  const em = $("g-email").value.trim();
  if (em && !EMAIL.test(em)) { noteA("a-saved", "L'e-mail des clients n'est pas complet."); return; }
  const oc = normCode($("g-code").value), gc = normCode($("g-gcode").value);
  if (!validCode(oc)) { noteA("a-saved", "Le code des clients doit faire au moins 8 caractères (lettres, chiffres, tirets)."); return; }
  if (gc && !validCode(gc)) { noteA("a-saved", "Le code des invités doit faire au moins 8 caractères (lettres, chiffres, tirets)."); return; }
  if (gc && gc === oc) { noteA("a-saved", "Le code des invités doit être différent de celui des clients."); return; }
  const title = $("g-title").value.trim();
  if (!title) { noteA("a-saved", "Indiquez le nom des clients."); return; }
  const exp = $("g-exp").value;
  const expIso = exp ? new Date(exp + "T23:59:00").toISOString() : null;
  const patch = {
    title, client_name: title, kind: $("g-kind").value, event_date: $("g-date").value || null,
    owner_code: oc, guest_code: gc || null, client_email: em || null, status: $("g-live").checked ? "published" : "draft",
    expires_at: expIso, allow_selection: $("g-sel").checked, selection_limit: Math.max(0, parseInt($("g-limit").value, 10) || 0) || null,
    notify: $("g-notify").checked, delivery_url: hd || null, delivery_expires_at: $("g-hdexp").value || null,
    guest_hd: $("g-ghd").checked, allow_download: $("g-dl").checked, remind: $("g-remind").checked, remind_days: Number($("g-rdays").value) || 30,
  };
  if (ymd(g.expires_at) !== exp || patch.remind_days !== g.remind_days || patch.client_email !== g.client_email) patch.reminded_at = null;
  noteA("a-saved", "Enregistrement…");
  const { error } = await sb.from("galleries").update(patch).eq("id", g.id);
  if (error) { noteA("a-saved", /déjà utilisé|duplicate|unique/i.test(error.message) ? "Ce code est déjà utilisé par une autre galerie : cliquez sur « Nouveau »." : error.message); return; }
  Object.assign(g, patch);
  markClean("save");
  draw();
  noteA("a-saved", "Enregistré.");
}

$("a-main").addEventListener("input", (e) => {
  const id = e.target.id;
  markDirty(SAVE_OF(id));
  if (id === "s-seot" || id === "s-seod") {
    const tt = $("s-seot").value, dd = $("s-seod").value;
    $("c-seot").textContent = tt.length + " / 60"; $("c-seot").classList.toggle("over", tt.length > 60);
    $("c-seod").textContent = dd.length + " / 160"; $("c-seod").classList.toggle("over", dd.length > 160);
    $("serp").innerHTML = "<small>lau-rie.fr</small><b>" + esc(tt) + "</b><span>" + esc(dd) + "</span>";
    const sc = $("site-card").querySelector("div"); sc.querySelector("b").textContent = tt; sc.querySelector("span").textContent = dd;
  }
  if (id === "m-subj" || id === "m-body") $("m-prev").innerHTML = mailPrev($("m-subj").value, $("m-body").value);
});
$("a-main").addEventListener("change", async (e) => {
  const el = e.target;
  if (el.type !== "file") markDirty(SAVE_OF(el.id));
  try {
    if (["g-remind", "g-rdays", "g-exp", "g-email"].includes(el.id)) {
      const info = remindInfo({ client_email: $("g-email").value.trim(), expires_at: $("g-exp").value, remind: $("g-remind").checked, remind_days: Number($("g-rdays").value), reminded_at: null });
      $("g-rinfo").textContent = info.txt; $("g-rinfo").className = info.warn ? "a-warn" : "a-meta";
    }
    if (el.dataset.a === "files") { const files = [...(el.files || [])]; el.value = ""; await uploadGalleryFiles(galById(openId), files); }
    if (el.dataset.a === "pfiles") { const files = [...(el.files || [])]; el.value = ""; await uploadPortfolio(files); }
    if (el.dataset.a === "caption") {
      const { error } = await sb.from("portfolio").update({ caption: el.value.trim() || null }).eq("id", el.dataset.id);
      if (error) throw error;
      PORT.find((p) => p.id === el.dataset.id).caption = el.value.trim() || null;
      toast("Description enregistrée.");
    }
    if (el.dataset.a === "sshow") { SITE.stories[Number(el.dataset.i)].show = el.checked; await saveSite(el.checked ? "Séance affichée." : "Séance masquée."); }
    if (el.dataset.a === "revon") {
      const r = REVS[Number(el.dataset.i)];
      const { error } = await sb.from("reviews").update({ status: el.checked ? "published" : "hidden" }).eq("id", r.id);
      if (error) throw error;
      r.status = el.checked ? "published" : "hidden"; draw();
    }
    if (el.dataset.a === "reqst") {
      const { error } = await sb.from("booking_requests").update({ status: el.value }).eq("id", el.dataset.id);
      if (error) throw error;
      REQS.find((x) => x.id === el.dataset.id).status = el.value; navSync();
    }
  } catch (err) { toast(errMsg(err), 6000); }
});
// Glisser-déposer sur les zones d'import
$("a-main").addEventListener("dragover", (e) => { if (e.target.closest(".drop")) { e.preventDefault(); e.target.closest(".drop").classList.add("over"); } });
$("a-main").addEventListener("dragleave", (e) => { const d = e.target.closest(".drop"); if (d) d.classList.remove("over"); });
$("a-main").addEventListener("drop", async (e) => {
  const d = e.target.closest(".drop");
  if (!d) return;
  e.preventDefault(); d.classList.remove("over");
  const files = [...e.dataTransfer.files], inp = d.querySelector("input[type=file]");
  if (inp.dataset.a === "files") await uploadGalleryFiles(galById(openId), files); else await uploadPortfolio(files);
});

// =================================================================== réponses toutes prêtes
let replyTo = null;
function readReplies() {
  SITE.replies = (SITE.replies || []).map((r, i) => ({ name: $("rp-n" + i).value.trim() || r.name, subj: $("rp-s" + i).value.trim(), body: $("rp-b" + i).value.replace(/\s+$/, "") }));
}
function replyVars(r) {
  const prenom = String(r.name || "").trim().split(/\s+/)[0] || "";
  const tarifs = (SITE.prices || []).map((p) => "– " + p.name + " : " + euro(p.price) + (p.detail ? " (" + p.detail.replace(/\.$/, "") + ")" : "")).join("\n");
  return { prenom, formule: r.kind ? r.kind.toLowerCase() : "photo", tarifs, site: siteBase() + "/" };
}
const fillVars = (t, v) => String(t || "").replace(/\{(prenom|formule|tarifs|site)\}/g, (m, k) => v[k]);
function fillReply() {
  const pick = document.querySelector('input[name="rpick"]:checked'), r = replyTo, v = replyVars(r);
  const t = pick && pick.value !== "" ? SITE.replies[Number(pick.value)] : { subj: "Votre demande de séance", body: "Bonjour " + v.prenom + ",\n\n\n\nÀ bientôt,\nLaurie" };
  $("rp-subj").value = fillVars(t.subj || "Votre demande de séance", v);
  $("rp-body").value = fillVars(t.body, v);
}
$("rp-pick").addEventListener("change", fillReply);
async function markContacted() {
  const r = replyTo;
  if (r && r.status === "new") { await sb.from("booking_requests").update({ status: "contacted" }).eq("id", r.id); r.status = "contacted"; if (tab === "demandes") draw(); else navSync(); }
}
$("rp-copy").addEventListener("click", async () => {
  copy($("rp-body").value, $("rp-err"), "Message copié : collez-le dans votre messagerie (objet : « " + $("rp-subj").value + " »).");
  await markContacted();
});
$("reply-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = "mailto:" + encodeURIComponent(replyTo.email) + "?subject=" + encodeURIComponent($("rp-subj").value) + "&body=" + encodeURIComponent($("rp-body").value);
  await markContacted();
  closeSheets();
  window.location.href = url;
});

$("mail-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = openId && galById(openId); if (!g) return;
  const btn = e.submitter || $("mail-form").querySelector("[type=submit]");
  btn.disabled = true; $("ml-err").textContent = "Envoi…";
  try {
    const r = await adminCall({ action: "send_gallery", gallery_id: g.id, subject: $("ml-subj").value, text: $("ml-body").value });
    g.link_sent_at = r.sent_at; closeSheets(); draw(); toast("E-mail envoyé à " + r.to + ".");
  } catch (err) { $("ml-err").textContent = err.message; }
  finally { btn.disabled = false; }
});
$("new-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("n-name").value.trim();
  if (!name) { $("n-err").textContent = "Entrez le nom des clients."; return; }
  const date = $("n-date").value;
  const row = {
    title: name, client_name: name, kind: $("n-kind").value, event_date: date || null, status: "draft",
    owner_code: newCode(name), guest_code: newGuestCode(name), allow_download: true, allow_selection: true,
    expires_at: new Date((date ? addDays(date, 365) : addDays(ymd(new Date().toISOString()), 365)) + "T23:59:00").toISOString(),
  };
  const { data, error } = await sb.from("galleries").insert(row).select("id").single();
  if (error) { $("n-err").textContent = error.message; return; }
  closeSheets();
  await loadGalleries();
  await go("galeries", data.id);
});

boot().catch((e) => showLogin("Connexion impossible : " + errMsg(e)));
