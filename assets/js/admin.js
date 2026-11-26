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
async function loadAll() {
  await Promise.all([loadSite(), loadGalleries(), loadSelections(), loadReviews(), loadRequests(), loadBookings(), loadTrash(), loadStorage()]);
  purgeTrash().catch(() => {});
}
async function loadSite() {
  const [s, p] = await Promise.all([
    sb.from("site_settings").select("content").eq("id", 1).maybeSingle(),
    sb.from("portfolio").select("*").order("position").order("created_at", { ascending: false }),
  ]);
  if (p.error) throw p.error;
  SITE = mergeSite(s.data?.content);
  PORT = (p.data || []).map(withPfUrls);
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
  let ls = await sb.from("galleries").select("id, link_sent_at, archived_at");
  if (ls.error) ls = await sb.from("galleries").select("id, link_sent_at");
  if (!ls.error) ls.data.forEach((r) => { const g = GAL.find((x) => x.id === r.id); if (g) { g.link_sent_at = r.link_sent_at; g.archived_at = r.archived_at || null; } });
  // Miniature de chaque couverture (7e migration), pour une liste légère
  const cids = GAL.map((g) => g.cover_photo_id).filter(Boolean);
  if (cids.length && THUMB_COL) {
    const th = await sb.from("photos").select("id, thumb_path").in("id", cids);
    if (th.error) { if (noThumbCol(th.error)) THUMB_COL = false; }
    else th.data.forEach((r) => GAL.forEach((g) => { if (g.cover_photo_id === r.id && g.cover && r.thumb_path) g.cover.thumb_path = r.thumb_path; }));
  }
  const paths = GAL.filter((g) => !g.archived_at).map((g) => gKey(g.cover)).filter(Boolean);
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
  disk: '<ellipse cx="12" cy="6.5" rx="7" ry="2.5"/><path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  doc: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/>',
  cal: '<path d="M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4"/>',
  insta: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6" fill="currentColor"/>',
};
const icoTile = (k) => '<span class="a-th a-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (ICO[k] || ICO.photo) + "</svg></span>";
const thumbRef = (ref) => { const d = ref ? img(ref) : null; return thumbUrl(d ? d.src : null); };
const coverUrl = (g) => (g.cover && !g.archived_at ? COVERS[gKey(g.cover)] || null : null);
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
      out.push({ url: coverUrl(g), t: "Sélection reçue : " + g.title, s: n + " favorite" + (n > 1 ? "s" : "") + (nn ? ", " + nn + " note" + (nn > 1 ? "s" : "") + " pour la retouche" : ""), act: '<button class="btn sm" type="button" data-a="open" data-id="' + g.id + '">Voir</button>' });
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
  if (AG) {
    const t = todayYmd(), in7 = addDays(t, 7), back30 = addDays(t, -30);
    AG.filter((b) => b.day >= t && b.day <= in7).forEach((b) => out.push({ ico: "cal", t: (b.day === t ? "Aujourd'hui" : b.day === addDays(t, 1) ? "Demain" : dayLabel(b.day)) + " : " + b.title, s: [b.kind, b.place, b.start_time ? "à " + b.start_time : ""].filter(Boolean).join(" · "), act: '<button class="btn ghost sm" type="button" data-a="bookedit" data-id="' + b.id + '">Voir</button>' }));
    AG.filter((b) => b.day < t && b.day >= back30 && !b.gallery_id).forEach((b) => out.push({ ico: "cal", t: "Galerie à préparer : " + b.title, s: "Séance du " + dayLabel(b.day, true) + ".", act: '<button class="btn sm" type="button" data-a="bookgal" data-id="' + b.id + '">Créer la galerie</button>' }));
  }
  const ba = backupAge();
  if (ba === null || ba > 31) out.push({ ico: "doc", t: ba === null ? "Faire une première sauvegarde" : "Sauvegarde du mois", s: ba === null ? "Un fichier avec toutes vos données, à garder sur votre ordinateur." : "La dernière date de " + ba + " jours.", act: '<button class="btn ghost sm" type="button" data-a="backup">Télécharger</button>' });
  const sp = storePct();
  if (sp !== null && sp >= 80) out.push({ ico: "disk", t: "Espace de stockage " + (sp >= 95 ? "plein" : "presque plein") + " (" + sp + " %)", s: "Allégez les galeries fermées pour pouvoir importer de nouvelles photos.", act: '<button class="btn sm" type="button" data-a="go" data-to="compte">Voir</button>' });
  if (usesDemoPhotos(SITE)) out.push({ ico: "photo", t: "Photos et séances d'exemple encore sur le site", s: "Ajoutez vos photos dans Photos du site, puis remplacez les séances et les photos de l'accueil.", act: '<button class="btn ghost sm" type="button" data-a="go" data-to="portfolio">Remplacer</button>' });
  const miss = LEGAL_REQ.filter((x) => !(SITE.legal[x[0]] || "").trim());
  if (miss.length) out.push({ ico: "doc", t: "Pages légales : " + miss.length + " information" + (miss.length > 1 ? "s" : "") + " à compléter", s: miss.map((x) => x[1]).join(", "), act: '<button class="btn ghost sm" type="button" data-a="go" data-to="reglages">Compléter</button>' });
  if (!SITE.ig || /^https?:\/\/(www\.)?instagram\.com\/?$/i.test(SITE.ig)) out.push({ ico: "insta", t: "Lien Instagram à compléter", s: "Le pied de page du site pointe encore vers la page d'accueil d'Instagram.", act: '<button class="btn ghost sm" type="button" data-a="go" data-to="site">Compléter</button>' });
  if (!REVS.some(shown)) out.push({ ico: "bubble", t: "Aucun avis affiché sur l'accueil", s: "Vos clients peuvent en laisser un depuis leur galerie, ou ajoutez-en un vous-même.", act: '<button class="btn ghost sm" type="button" data-a="go" data-to="avis">Ajouter</button>' });
  return out;
}
function viewAccueil() {
  const L = todos(), live = GAL.filter((g) => g.status === "published").length;
  const favT = GAL.reduce((s, g) => s + favN(g), 0), vis = GAL.reduce((s, g) => s + (g.visits || 0), 0);
  return '<div class="a-top"><div><h1>À faire</h1><p class="a-sub">' + (L.length ? L.length + " point" + (L.length > 1 ? "s" : "") + " vous attendent." : "Tout est à jour.") + '</p></div><div class="a-acts"><button class="btn ghost sm" type="button" data-a="go" data-to="sante">Santé du site</button></div></div>' +
    (L.length ? '<div class="a-tbl">' + L.map((x) =>
      '<div class="a-srow">' + (x.url ? thumbUrl(x.url) : icoTile(x.ico)) + '<div class="a-nm"><b>' + esc(x.t) + "</b><span>" + esc(x.s) + '</span></div><div class="a-acts">' + x.act + "</div></div>").join("") + "</div>"
      : '<div class="a-empty"><b>Rien à traiter</b><span class="a-meta">Les sélections reçues, les demandes, les avis et les galeries qui ferment apparaîtront ici.</span></div>') +
    '<dl class="a-kpi"><div><dt>Galeries en ligne</dt><dd>' + live + "</dd></div><div><dt>Favorites reçues</dt><dd>" + favT + "</dd></div><div><dt>Visites des galeries</dt><dd>" + vis + "</dd></div><div><dt>Avis affichés</dt><dd>" + REVS.filter(shown).length + "</dd></div></dl>";
}

// =================================================================== galeries
function viewGaleries() {
  const live = GAL.filter((g) => g.status === "published").length;
  return '<div class="a-top"><div><h1>Galeries</h1><p class="a-sub">' + GAL.length + " galerie" + (GAL.length > 1 ? "s" : "") + ", " + live + " en ligne" + (selCount() ? ", " + selCount() + " sélection à traiter" : "") + '</p></div><div class="a-acts">' + (TRASH && TRASH.length ? '<button class="btn ghost sm" type="button" data-a="go" data-to="corbeille">Corbeille (' + TRASH.length + ")</button>" : "") + '<button class="btn sm" type="button" data-a="new">Nouvelle galerie</button></div></div>' +
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
    sb.from("photos").select("*").eq("gallery_id", g.id).order("position").order("created_at"),
    sb.rpc("fav_counts", { p_gallery: g.id }),
  ]);
  if (error) throw error;
  gFavs = fv.error ? [] : fv.data || []; // migration pas encore appliquée : on n'affiche rien
  gPhotos = data;
  gUrls = {};
  if (g.archived_at) return; // aperçus supprimés : rien à afficher
  const paths = data.map(gKey);
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
  if (g.archived_at) return '<p class="a-warn">Galerie archivée le ' + fdate(g.archived_at) + " : ses aperçus ont été supprimés pour libérer de l'espace. La sélection, les notes et les noms de fichiers sont gardés. Pour la rouvrir, prolongez la date « En ligne jusqu'au », enregistrez, puis réimportez le même dossier depuis Lightroom : chaque photo retrouve sa place.</p>";
  const sel = SEL[g.id], picked = new Set(sel ? sel.photo_ids : []), notes = (sel && sel.notes) || {};
  const list = gShowAll ? gPhotos : gPhotos.slice(0, 60);
  return (gPhotos.length ? '<div class="cs a-photos" data-sort="photos">' + list.map((p) =>
    '<figure data-sortid="' + p.id + '" data-pid="' + p.id + '"' + (p.id === g.cover_photo_id ? ' class="is-cover"' : "") + '><img alt="' + esc(p.filename) + '" loading="lazy" src="' + esc(gUrls[gKey(p)] || "") + '">' +
    (picked.has(p.id) ? '<span class="h" title="Choisie par les clients">' + HEART + "</span>" : "") +
    (p.hidden_from_guests ? '<span class="tag">Masquée</span>' : notes[p.id] ? '<span class="tag">Note</span>' : "") +
    '<span class="ops"><button type="button" data-a="cover" data-pid="' + p.id + '" aria-label="Choisir comme couverture : ' + esc(p.filename) + '">' + (p.id === g.cover_photo_id ? "Couverture" : "Couv.") + '</button><button type="button" data-a="focusph" data-pid="' + p.id + '" aria-label="Point important : ' + esc(p.filename) + '" title="Point important">◎</button><button type="button" data-a="delphoto" data-pid="' + p.id + '" aria-label="Supprimer ' + esc(p.filename) + '">×</button></span>' + dragBtn(p.filename) + '</figure>').join("") + "</div>" +
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
      return '<figure><img alt="' + esc(p.filename) + '" loading="lazy" src="' + esc(gUrls[gKey(p)] || "") + '"><figcaption><b>' + (i + 1) + ".</b> " + HEART + " " + f.hearts +
        (f.owners ? '<span class="a-meta"> · clients</span>' : "") + '<span class="a-fn">' + esc(p.filename.replace(/\.[^.]+$/, "")) + "</span></figcaption></figure>";
    }).join("") + "</div></div></section>";
}
let moreOpen = false;
function viewGallery(g) {
  const nf = favN(g), ri = remindInfo(g), dl = daysTo(g.expires_at), link = galleryLink(g.owner_code);
  return '<button type="button" class="a-back" data-a="back">← Galeries</button>' +
    '<div class="a-top"><div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><h1>' + esc(g.title) + "</h1>" + pill(gStatus(g)) + '</div><p class="a-sub">' + esc([g.kind, g.event_date ? fdate(g.event_date) : "", g.nphotos + " photos", (g.visits || 0) + " visites", g.link_sent_at ? "lien envoyé le " + fdate(g.link_sent_at) : ""].filter(Boolean).join(", ")) + (dl !== null && dl >= 0 && dl <= 60 ? ", ferme dans " + dl + " jours" : "") + "</p></div>" +
    '<div class="a-acts">' + (g.owner_code ? '<a class="btn ghost sm" target="_blank" rel="noopener" href="' + esc(link) + '">Voir comme les clients</a>' : "") + '<button class="btn ghost sm" type="button" data-a="msg">Copier le message</button><button class="btn ghost sm" type="button" data-a="dupgal">Dupliquer</button><button class="btn sm" type="button" data-a="sendmail">Envoyer par e-mail</button></div></div>' +
    '<p class="a-note" id="a-note" aria-live="polite"></p>' + selPanel(g) +
    '<section class="a-set"><div class="a-lab"><h2>Séance</h2><p>Le nom affiché en haut de la galerie et dans les e-mails.</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="g-title">Nom des clients ' + hlp("Le nom affiché en haut de la galerie et dans les e-mails, par exemple « Julie & Marc ».") + '</label><input class="a-in" id="g-title" maxlength="160" value="' + esc(g.title) + '"></div>' +
      '<div class="ct-two"><div class="a-f"><label for="g-kind">Type</label><select class="a-in sel" id="g-kind">' + ["Mariage", "Famille", "Portrait", "Autre"].map((k) => "<option" + (k === g.kind ? " selected" : "") + ">" + k + "</option>").join("") + '</select></div>' +
      '<div class="a-f"><label for="g-date">Date de la séance</label><input class="a-in" id="g-date" type="date" value="' + esc(ymd(g.event_date)) + '"></div></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Accès</h2><p>Le lien et le code à transmettre. Les invités ont leur propre code : ils voient la galerie sans pouvoir envoyer de sélection.</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="g-link">Lien de la galerie</label><div class="a-join"><input class="a-in" id="g-link" readonly value="' + esc(galleryLink()) + '"><button type="button" data-a="copylink">Copier</button></div></div>' +
      '<div class="ct-two"><div class="a-f"><label for="g-code">Code des clients ' + hlp("Le code à donner aux mariés ou à la famille : avec lui, ils choisissent leurs photos préférées et envoient leur sélection. « Nouveau » en crée un autre, l'ancien ne marche alors plus.") + '</label><div class="a-join"><input class="a-in a-code" id="g-code" maxlength="40" autocapitalize="characters" value="' + esc(g.owner_code || "") + '"><button type="button" data-a="regen">Nouveau</button></div></div>' +
      '<div class="a-f"><label for="g-exp">En ligne jusqu\'au ' + hlp("Après cette date, la galerie se ferme. Un rappel part aux clients avant (réglage plus bas).") + '</label><input class="a-in" id="g-exp" type="date" value="' + esc(ymd(g.expires_at)) + '"></div></div>' +
      '<div class="a-f"><label for="g-gcode">Code des invités ' + hlp("Un second code pour les proches : ils voient les photos, sauf celles que les clients ont masquées, mais n'envoient pas de sélection.") + '</label><div class="a-join"><input class="a-in a-code" id="g-gcode" maxlength="40" autocapitalize="characters" placeholder="Laisser vide : pas d\'accès invités" value="' + esc(g.guest_code || "") + '"><button type="button" data-a="regen2">Nouveau</button></div></div>' +
      '<div class="a-f"><label for="g-email">E-mail des clients ' + hlp("Sert au bouton « Envoyer par e-mail » et au rappel avant la fermeture. Il n'est jamais affiché sur le site.") + '</label><input class="a-in" id="g-email" type="email" autocomplete="off" placeholder="prenom@exemple.fr" value="' + esc(g.client_email || "") + '"></div>' +
      '<label class="a-sw"><span>Galerie visible par les clients<small>Désactivée, le code affiche « pas encore en ligne ».</small></span><input type="checkbox" id="g-live"' + (g.status === "published" ? " checked" : "") + "></label>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Fichiers HD</h2><p>Les originaux ne passent pas par le site : déposez-les sur SwissTransfer et collez le lien. Vos clients le trouvent dans « Télécharger ».</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="g-hd">Lien SwissTransfer ' + hlp("Déposez les fichiers HD sur swisstransfer.com, puis collez ici le lien reçu. Les clients le trouvent dans « Télécharger ».") + '</label><input class="a-in" id="g-hd" type="url" inputmode="url" placeholder="https://www.swisstransfer.com/d/…" value="' + esc(g.delivery_url || "") + '"></div>' +
      '<div class="a-f"><label for="g-hdexp">Lien valable jusqu\'au</label><input class="a-in" id="g-hdexp" type="date" value="' + esc(ymd(g.delivery_expires_at)) + '" style="max-width:220px"></div>' +
      '<label class="a-sw"><span>Les invités voient aussi le lien HD</span><input type="checkbox" id="g-ghd"' + (g.guest_hd ? " checked" : "") + "></label>" +
      '<label class="a-sw"><span>Téléchargement des aperçus autorisé<small>Photos en qualité web, une par une ou en archive.</small></span><input type="checkbox" id="g-dl"' + (g.allow_download ? " checked" : "") + "></label>" +
    "</div></section>" +
    '<details class="a-more" id="g-more"' + (moreOpen ? " open" : "") + '><summary>Plus d\'options<span>QR code et carte à imprimer, sélection des clients, rappel avant fermeture</span></summary>' +
    '<section class="a-set"><div class="a-lab"><h2>QR code et partage</h2><p>Le QR code ouvre directement la galerie des clients. La carte s\'imprime en 10 × 15 cm pour la glisser dans un remerciement.</p></div><div class="a-panel">' +
      (g.owner_code ? '<div class="qr-grid"><div class="qr-box">' + qrSvg(link, "QR code de la galerie " + g.title) + '</div>' +
      '<div class="qr-acts"><button class="btn sm" type="button" data-a="card">Créer la carte à imprimer</button><button class="btn ghost sm" type="button" data-a="qrpng">Télécharger le QR seul</button><span class="a-meta" id="card-note" aria-live="polite"></span><img class="card-prev" id="card-prev" alt="Aperçu de la carte à imprimer" hidden></div></div>' : '<p class="a-warn">Enregistrez d\'abord un code des clients.</p>') +
      '<div class="a-f"><span class="l">Aperçu quand le lien est envoyé par message</span>' + shareCard(g) + "</div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Sélection</h2><p>Les clients choisissent leurs photos préférées ; les invités ont leurs propres favorites, qui restent sur leur téléphone.</p></div><div class="a-panel">' +
      '<label class="a-sw"><span>Les clients peuvent envoyer une sélection</span><input type="checkbox" id="g-sel"' + (g.allow_selection ? " checked" : "") + "></label>" +
      '<div class="a-f"><label for="g-limit">Nombre maximum de favorites ' + hlp("Combien de photos les clients peuvent choisir. 0 = autant qu'ils veulent.") + '</label><input class="a-in" id="g-limit" type="number" min="0" max="5000" inputmode="numeric" value="' + (Number(g.selection_limit) || 0) + '" aria-describedby="g-limit-h" style="max-width:160px"><span class="a-meta" id="g-limit-h">0 = sans limite.</span></div>' +
      '<label class="a-sw"><span>M\'écrire quand une sélection arrive<small>Si les e-mails automatiques sont branchés (guide, étape 10).</small></span><input type="checkbox" id="g-notify"' + (g.notify !== false ? " checked" : "") + "></label>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Rappel avant fermeture</h2><p>Un e-mail automatique invite les clients à télécharger leurs photos avant la fermeture de la galerie.</p></div><div class="a-panel">' +
      '<label class="a-sw"><span>Envoyer un rappel aux clients</span><input type="checkbox" id="g-remind"' + (g.remind !== false ? " checked" : "") + "></label>" +
      '<div class="a-f"><label for="g-rdays">Quand</label><select class="a-in sel" id="g-rdays">' + [[30, "Un mois avant la fermeture"], [14, "Deux semaines avant"], [7, "Une semaine avant"]].map((o) => '<option value="' + o[0] + '"' + ((g.remind_days || 30) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div>" +
      '<p class="' + (ri.warn ? "a-warn" : "a-meta") + '" id="g-rinfo">' + esc(ri.txt) + "</p>" +
      '<div class="a-acts" style="justify-content:flex-start"><button class="btn ghost sm" type="button" data-a="mailprev" aria-expanded="false" aria-controls="g-mail">Voir l\'e-mail</button>' + (g.client_email ? '<a class="btn ghost sm" href="' + esc(remindMailto(g)) + '">L\'envoyer moi-même</a>' : "") + "</div>" +
      '<div class="mailprev" id="g-mail" hidden><b>' + esc(fillTpl(SITE.mailSubj, mailVars(g))) + "</b><pre>" + esc(fillTpl(SITE.mailBody, mailVars(g))) + '</pre><span class="a-meta">Le texte se modifie dans Mon entreprise.</span></div>' +
    "</div></section>" +
    "</details>" +
    '<div class="a-save"><button class="btn" type="button" data-a="save">Enregistrer</button><span class="a-note" id="a-saved" aria-live="polite"></span></div>' +
    topLoved() +
    '<section class="a-set"><div class="a-lab"><h2>Photos</h2><p>Importez les JPEG exportés de Lightroom : le site en fait des aperçus légers (2 048 px). Les originaux restent sur votre ordinateur.</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="g-col">Collection (facultatif) ' + hlp("Pour ranger les photos par moment : Préparatifs, Cérémonie, Soirée… Écrivez le nom avant d'importer les photos de ce moment.") + '</label><input class="a-in" id="g-col" maxlength="60" placeholder="Par exemple : Cérémonie"></div>' +
      '<label class="a-sw" style="align-self:end"><span>Ajouter « © lau.rie » sur les aperçus</span><input type="checkbox" id="g-wm"></label></div>' +
      '<label class="drop"><input type="file" multiple accept="image/jpeg,image/png,image/webp" data-a="files" aria-label="Ajouter des photos"><b>Ajouter des photos</b><span>Glissez ici les photos ou le dossier exporté de Lightroom, ou touchez pour choisir</span></label>' +
      '<p class="a-meta"><label class="linkbtn" style="cursor:pointer">Choisir un dossier entier<input type="file" webkitdirectory multiple data-a="files" hidden></label> · Si la connexion coupe, relancez le même import : les photos déjà envoyées sont ignorées.</p>' +
      (THUMB_COL && !g.archived_at && gPhotos.some((p) => !p.thumb_path) ? '<div class="a-light" id="g-thumbs-btn"><p class="a-meta">Cette galerie charge encore les grandes photos dans la grille. Créez des miniatures : elle s\'ouvrira plus vite chez vos clients et consommera environ 6 fois moins de données.</p><button class="btn sm" type="button" data-a="mkthumbs">Alléger la galerie</button></div>' : "") +
      '<p class="a-meta" id="g-thumbs" aria-live="polite"></p>' +
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
// Miniatures (7e migration) : la grille des galeries charge une image de 800 px (≈ 60 Ko)
// au lieu de l'aperçu 2 048 px (≈ 350 Ko) ; le plein écran garde l'aperçu.
const THUMB = 800, CACHE = "31536000"; // fichiers jamais réécrits : cache long
let THUMB_COL = true; // passe à false si la 7e migration n'est pas encore exécutée
const gKey = (p) => (p && (p.thumb_path || p.preview_path)) || "";
const photoFiles = (p) => [p.preview_path, p.thumb_path].filter(Boolean);
const noThumbCol = (e) => /thumb_path|thumb_width|archived_at/.test((e && e.message) || "");
// Plusieurs tailles à partir d'un seul décodage de l'image
async function makeVariants(src, specs) {
  const bmp = await createImageBitmap(src, { imageOrientation: "from-image" });
  try {
    const out = [];
    for (const sp of specs) out.push(await drawVariant(bmp, sp.max, sp.wm, sp.q));
    return out;
  } finally { bmp.close?.(); }
}
async function makePreview(file, maxSide, watermark) { return (await makeVariants(file, [{ max: maxSide, wm: watermark }]))[0]; }
async function drawVariant(bmp, maxSide, watermark, q = 0.82) {
  const r = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * r), h = Math.round(bmp.height * r);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  if (watermark) {
    const size = Math.max(14, Math.round(Math.min(w, h) * 0.035));
    ctx.font = `500 ${size}px "Jost", ui-sans-serif, sans-serif`;
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = size / 3;
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.fillText(watermark, w - size, h - size * 0.8);
  }
  let blob = await new Promise((res) => canvas.toBlob(res, "image/webp", q));
  if (!blob || blob.type !== "image/webp") blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", Math.min(0.9, q + 0.03)));
  canvas.width = canvas.height = 0; // libère la mémoire tout de suite (gros imports)
  return { blob, width: w, height: h, ext: blob.type === "image/webp" ? "webp" : "jpg" };
}
const safeName = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-120) || "photo.jpg";
// Import depuis Lightroom : ordre des noms de fichiers, photos déjà présentes ignorées (on peut relancer
// le même import après une coupure), 3 envois en parallèle, réessais automatiques si le réseau coupe
let IMPORTING = 0;
const natural = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, tries = 4) {
  let last;
  for (let k = 0; k < tries; k++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!navigator.onLine) await new Promise((r) => window.addEventListener("online", r, { once: true }));
      else await sleep(1500 * (k + 1) * (k + 1));
    }
  }
  throw last;
}
const isPhoto = (f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
function importNote(html) { const n = $("g-count"); if (n) n.innerHTML = html; }
function minutes(ms) { const m = Math.round(ms / 60000); return m < 1 ? "moins d'une minute" : m === 1 ? "environ 1 minute" : "environ " + m + " minutes"; }
async function uploadGalleryFiles(g, files) {
  const ok = files.filter(isPhoto), refused = files.length - ok.length;
  if (!ok.length) { importNote(files.length ? "Formats acceptés : JPEG, PNG, WebP. Exportez depuis Lightroom en JPEG." : "Aucune photo dans ce dossier."); return; }
  // Galerie archivée : une photo au même nom reprend sa place (sélection, notes et ordre gardés)
  const archived = !!g.archived_at, byName = new Map(gPhotos.map((p) => [String(p.filename).toLowerCase(), p]));
  const have = archived ? new Set() : new Set(byName.keys());
  const todo = ok.filter((f) => !have.has(f.name.slice(0, 255).toLowerCase())).sort((a, b) => natural.compare(a.name, b.name));
  const skipped = ok.length - todo.length;
  if (!todo.length) { importNote("Ces " + ok.length + " photos sont déjà dans la galerie."); return; }
  const coll = $("g-col").value.trim() || null, wm = $("g-wm").checked ? "© lau.rie" : null;
  let pos = gPhotos.reduce((m, p) => Math.max(m, (p.position ?? -1) + 1), 0);
  const queue = todo.map((file) => ({ file, pos: pos++, old: archived ? byName.get(file.name.slice(0, 255).toLowerCase()) : null }));
  const failed = [], t0 = Date.now();
  let done = 0;
  const show = () => {
    const left = todo.length - done, eta = done ? " · " + minutes(((Date.now() - t0) / done) * left) + " restantes" : "";
    importNote('<progress max="' + todo.length + '" value="' + done + '" style="width:100%;max-width:320px;display:block;margin-bottom:6px"></progress>Import : ' + done + " / " + todo.length + (left ? eta : "") + ". Gardez cette page ouverte.");
  };
  const one = async ({ file, pos, old }) => {
    const pid = old ? old.id : crypto.randomUUID();
    const [prev, th] = await makeVariants(file, [{ max: 2048, wm }, { max: THUMB, wm, q: 0.74 }]);
    const base = safeName(file.name).replace(/\.[^.]+$/, "") || "photo";
    const path = `${g.id}/${pid}/${base}.${prev.ext}`, tpath = `${g.id}/${pid}/t_${base}.${th.ext}`;
    const put = (p, blob) => withRetry(async () => {
      const up = await sb.storage.from("galleries").upload(p, blob, { contentType: blob.type, upsert: true, cacheControl: CACHE });
      if (up.error) throw up.error;
    });
    await put(path, prev.blob);
    if (THUMB_COL) await put(tpath, th.blob);
    const row = { id: pid, gallery_id: g.id, preview_path: path, filename: file.name.slice(0, 255), width: prev.width, height: prev.height, position: pos, collection: coll };
    if (THUMB_COL) row.thumb_path = tpath;
    if (old) {
      const upd = { preview_path: path, width: prev.width, height: prev.height, ...(row.thumb_path ? { thumb_path: tpath } : {}) };
      await withRetry(async () => { const { error } = await sb.from("photos").update(upd).eq("id", pid); if (error) throw error; });
      Object.assign(old, upd);
      return;
    }
    const ins = async () => {
      const { error } = await sb.from("photos").insert(row);
      if (error && noThumbCol(error) && row.thumb_path) { THUMB_COL = false; delete row.thumb_path; await sb.storage.from("galleries").remove([tpath]); return ins(); }
      if (error && !/duplicate|unique/i.test(error.message)) throw error;
    };
    try { await withRetry(ins); } catch (e) { await sb.storage.from("galleries").remove(photoFiles(row)); throw e; }
    gPhotos.push({ ...row, hidden_from_guests: false });
    gUrls[gKey(row)] = URL.createObjectURL((row.thumb_path ? th : prev).blob);
    if (!g.cover_photo_id) {
      g.cover_photo_id = pid; g.cover = { preview_path: path, thumb_path: row.thumb_path }; COVERS[gKey(g.cover)] = gUrls[gKey(row)];
      await sb.from("galleries").update({ cover_photo_id: pid }).eq("id", g.id);
    }
  };
  IMPORTING++;
  show();
  try {
    await Promise.all([0, 1, 2].map(async () => {
      while (queue.length) {
        const job = queue.shift();
        try { await one(job); } catch (e) { failed.push(job.file.name); console.error(e); }
        done++; g.nphotos = gPhotos.length; show();
      }
    }));
  } finally { IMPORTING--; }
  if (archived) {
    const { error } = await sb.from("galleries").update({ archived_at: null }).eq("id", g.id);
    if (!error) { g.archived_at = null; await go("galeries", g.id); toast("Galerie rouverte : " + (todo.length - failed.length) + " photos réimportées."); return; }
  }
  gPhotos.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  $("g-photos").innerHTML = photoGrid(g);
  const n = todo.length - failed.length;
  importNote(gPhotos.length + " photos. " + n + " importée" + (n > 1 ? "s" : "") +
    (skipped ? ", " + skipped + " déjà présente" + (skipped > 1 ? "s" : "") + " ignorée" + (skipped > 1 ? "s" : "") : "") +
    (refused ? ", " + refused + " fichier" + (refused > 1 ? "s" : "") + " non photo ignoré" + (refused > 1 ? "s" : "") : "") +
    (failed.length ? '. <b class="a-warn">' + failed.length + " en échec</b> (" + esc(failed.slice(0, 3).join(", ")) + (failed.length > 3 ? "…" : "") + ") : relancez le même import, seules les photos manquantes seront envoyées." : "."));
}

// Glisser un dossier entier depuis le Finder ou l'Explorateur
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.some((e) => e.isDirectory)) return [...dt.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const e of batch) await walk(e); } while (batch.length);
    }
  };
  for (const e of entries) await walk(e);
  return out;
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
function selPanel(g) {
  const s = SEL[g.id];
  if (!s) return "";
  const st = gStatus(g), n = s.photo_ids.length, ks = s.notes ? Object.keys(s.notes) : [];
  return '<section class="a-selbox' + (st === "sel" ? " new" : "") + '" aria-label="Sélection des clients"><div class="a-selhd"><div><h2>' + HEART + " Sélection reçue</h2><p>" + n + " favorite" + (n > 1 ? "s" : "") + " sur " + g.nphotos + ", reçue le " + fdate(s.created_at) + (st === "sel" ? "" : ", traitée") + "</p></div>" +
    '<div class="a-acts"><button class="btn ghost sm" type="button" data-a="nums" data-id="' + g.id + '">Copier les noms</button>' + (st === "sel" ? '<button class="btn sm" type="button" data-a="treat" data-id="' + g.id + '">Marquer comme traitée</button>' : pill(st)) + "</div></div>" +
    (ks.length ? '<ul class="a-notes" aria-label="Notes pour la retouche">' + ks.map((k) => "<li><b>" + esc(nameOf(k)) + "</b>" + esc(s.notes[k]) + "</li>").join("") + "</ul>" : "") +
    '<p class="a-meta">Les noms se collent tels quels dans la recherche de Lightroom (filtre Texte, « Nom de fichier »).</p></section>';
}


// =================================================================== devis
// Un devis par demande (ou libre), numéroté D-2026-001, imprimé en PDF depuis devis.html
const Q_ST = { draft: "Brouillon", sent: "Envoyé", accepted: "Accepté", declined: "Refusé" };
let QUOTES = null, QE = null;
async function loadQuotes() {
  const { data, error } = await sb.from("quotes").select("*").order("created_at", { ascending: false });
  QUOTES = error ? null : data || [];
}
const qMoney = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
function qTotals(d) {
  const total = (d.lines || []).reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0);
  const dep = Math.round(total * (Number(d.deposit) || 0)) / 100;
  return { total, dep, rest: total - dep };
}
function newQuote(r) {
  const msg = (r && r.message) || "", kind = (r && r.kind) || "";
  const pick = (re) => { const m = msg.match(re); return m ? m[1].trim() : ""; };
  const formula = pick(/^Formule : (.+?)(?: \([^)]*\))?$/m);
  const price = SITE.prices.find((p) => p.name === formula) || (kind ? SITE.prices.find((p) => p.name.toLowerCase().startsWith(kind.toLowerCase())) : null);
  const when = pick(/^Date envisagée : (.+)$/m), iso = /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : "";
  const wed = /mariage/i.test(kind || (price && price.name) || "");
  return {
    id: null, number: null, status: "draft", request_id: r ? r.id : null,
    data: {
      client: { name: (r && r.name) || "", email: (r && r.email) || "", phone: (r && r.phone) || "", address: "" },
      kind: kind || (wed ? "Mariage" : ""), dateText: iso ? fdate(iso, { day: "numeric", month: "long", year: "numeric" }) : when, place: pick(/^Lieu : (.+)$/m),
      delay: (wed ? SITE.legal.delayWed : "") || SITE.legal.delay || "",
      lines: price ? [{ label: price.name, detail: price.detail || "", qty: 1, unit: Number(price.price) || 0 }] : [{ label: "", detail: "", qty: 1, unit: 0 }],
      deposit: Number(SITE.legal.deposit) || 0, balance: "le jour de la séance", payment: "virement bancaire", validity: 30, note: "",
    },
  };
}
function sellerSnapshot() {
  const L = SITE.legal;
  return { owner: L.owner, status: L.status, address: L.address, siret: L.siret, phone: L.phone, mail: SITE.mail, vat: L.vat, mediator: L.mediator, mediatorUrl: L.mediatorUrl, city: SITE.city, site: siteBase() };
}
const qv = (id) => { const el = $(id); return el ? el.value : ""; };
function readQuote() {
  if (!QE || !$("q-name")) return;
  const d = QE.data;
  d.client = { name: qv("q-name").trim(), email: qv("q-email").trim(), phone: qv("q-phone").trim(), address: qv("q-address").trim() };
  d.kind = qv("q-kind"); d.dateText = qv("q-date").trim(); d.place = qv("q-place").trim(); d.delay = qv("q-delay").trim();
  d.lines = d.lines.map((l, i) => ({ label: qv("q-l" + i + "-label").trim(), detail: qv("q-l" + i + "-detail").trim(), qty: Math.max(0, Number(qv("q-l" + i + "-qty").replace(",", ".")) || 0), unit: Math.max(0, Number(qv("q-l" + i + "-unit").replace(",", ".")) || 0) }));
  d.deposit = Math.min(100, Math.max(0, Number(qv("q-deposit")) || 0)); d.balance = qv("q-balance").trim(); d.payment = qv("q-payment").trim();
  d.validity = Number(qv("q-validity")) || 30; d.note = qv("q-note").trim();
  QE.status = qv("q-status") || "draft";
}
function qLive() {
  if (!QE) return;
  readQuote();
  QE.data.lines.forEach((l, i) => { const el = $("q-l" + i + "-amt"); if (el) el.textContent = qMoney(l.qty * l.unit); });
  const T = qTotals(QE.data), el = $("q-tot");
  if (el) el.innerHTML = "Total <b>" + qMoney(T.total) + "</b>" + (T.dep ? " · acompte " + qMoney(T.dep) + " · solde " + qMoney(T.rest) : "");
}
const qLink = (q) => '<a class="btn ghost sm" href="devis.html?id=' + esc(q.id) + '" target="_blank" rel="noopener">Voir et télécharger (PDF)</a>';
function viewQuote() {
  const q = QE, d = q.data, T = qTotals(d), L = SITE.legal;
  const miss = [["owner", "nom"], ["siret", "SIRET"], ["address", "adresse"]].filter((x) => !(L[x[0]] || "").trim());
  const f = (id, label, val, extra) => '<div class="a-f"><label for="' + id + '">' + label + '</label><input class="a-in" id="' + id + '" value="' + esc(val || "") + '"' + (extra || "") + "></div>";
  return '<button type="button" class="a-back" data-a="go" data-to="demandes">← Demandes</button>' +
    '<div class="a-top"><div><h1>' + (q.number ? "Devis " + esc(q.number) : "Nouveau devis") + '</h1><p class="a-sub">' + (d.client.name ? "Pour " + esc(d.client.name) + ". " : "") + "Le PDF reprend la mise en page et les couleurs du site.</p></div>" +
      '<div class="a-acts">' + (q.id ? qLink(q) : "") + "</div></div>" +
    (miss.length ? '<p class="a-warn">Obligatoire sur un devis, à compléter dans Mon entreprise : ' + miss.map((x) => x[1]).join(", ") + ".</p>" : "") +
    '<p class="a-note" id="a-note" aria-live="polite"></p>' +
    '<section class="a-set"><div class="a-lab"><h2>Client</h2><p>Nom et adresse figurent sur le devis. L\'adresse est conseillée pour un particulier.</p></div><div class="a-panel">' +
      f("q-name", "Nom", d.client.name, ' maxlength="160" autocomplete="off"') +
      '<div class="ct-two">' + f("q-email", "E-mail", d.client.email, ' type="email" autocomplete="off"') + f("q-phone", "Téléphone", d.client.phone, ' type="tel" autocomplete="off"') + "</div>" +
      '<div class="a-f"><label for="q-address">Adresse</label><textarea class="a-in" id="q-address" rows="2" maxlength="300">' + esc(d.client.address) + "</textarea></div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Prestation</h2><p>Repris de la demande quand c\'est possible.</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="q-kind">Séance</label><select class="a-in sel" id="q-kind">' + ["", "Mariage", "Famille", "Portrait", "Autre"].map((k) => '<option value="' + k + '"' + (k === d.kind ? " selected" : "") + ">" + (k || "—") + "</option>").join("") + "</select></div>" +
      f("q-date", "Date", d.dateText, ' maxlength="80" placeholder="Par exemple : 12 juin 2027"') + "</div>" +
      '<div class="ct-two">' + f("q-place", "Lieu", d.place, ' maxlength="160"') + f("q-delay", "Délai de livraison", d.delay, ' maxlength="80"') + "</div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Détail</h2><p>Une ligne par formule ou option. Les prix sont TTC (TVA non applicable en micro-entreprise).</p></div><div class="a-panel">' +
      d.lines.map((l, i) => '<div class="a-qline"><div class="a-f"><label for="q-l' + i + '-label">Désignation</label><div class="a-join"><input class="a-in" id="q-l' + i + '-label" maxlength="120" value="' + esc(l.label) + '"><button type="button" data-a="qdel" data-i="' + i + '" aria-label="Retirer la ligne ' + (i + 1) + '">×</button></div></div>' +
        '<div class="a-f"><label for="q-l' + i + '-detail">Détail (facultatif)</label><textarea class="a-in" id="q-l' + i + '-detail" rows="2" maxlength="400">' + esc(l.detail) + "</textarea></div>" +
        '<div class="a-qnum"><div class="a-f"><label for="q-l' + i + '-qty">Quantité</label><input class="a-in" id="q-l' + i + '-qty" inputmode="decimal" value="' + esc(String(l.qty)) + '"></div>' +
        '<div class="a-f"><label for="q-l' + i + '-unit">Prix unitaire (€)</label><input class="a-in" id="q-l' + i + '-unit" inputmode="decimal" value="' + esc(String(l.unit)) + '"></div>' +
        '<p class="a-qamt">Montant<b id="q-l' + i + '-amt">' + qMoney(l.qty * l.unit) + "</b></p></div></div>").join("") +
      '<div class="a-qadd"><div class="a-join"><select class="a-in sel" id="q-pick" aria-label="Formule à ajouter">' + SITE.prices.map((p, i) => '<option value="' + i + '">' + esc(p.name) + " · " + esc(euro(p.price)) + "</option>").join("") + '</select><button type="button" data-a="qaddprice">Ajouter la formule</button></div>' +
        '<button class="btn ghost sm" type="button" data-a="qaddline">Ajouter une ligne libre</button></div>' +
      '<p class="a-qtot" id="q-tot" aria-live="polite">Total <b>' + qMoney(T.total) + "</b>" + (T.dep ? " · acompte " + qMoney(T.dep) + " · solde " + qMoney(T.rest) : "") + "</p>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Paiement et validité</h2><p>L\'acompte vient de Mon entreprise ; vous pouvez l\'ajuster pour ce devis.</p></div><div class="a-panel">' +
      '<div class="ct-two">' + f("q-deposit", "Acompte (%)", String(d.deposit), ' inputmode="numeric" maxlength="3"') +
      '<div class="a-f"><label for="q-validity">Devis valable</label><select class="a-in sel" id="q-validity">' + [15, 30, 60, 90].map((n) => '<option value="' + n + '"' + (Number(d.validity) === n ? " selected" : "") + ">" + n + " jours</option>").join("") + "</select></div></div>" +
      '<div class="ct-two">' + f("q-balance", "Solde payable", d.balance, ' maxlength="80" placeholder="le jour de la séance"') + f("q-payment", "Moyens de paiement", d.payment, ' maxlength="120" placeholder="virement bancaire"') + "</div>" +
      '<div class="a-f"><label for="q-note">Message sur le devis (facultatif)</label><textarea class="a-in" id="q-note" rows="3" maxlength="800" placeholder="Par exemple : merci pour votre confiance, j\'ai hâte de vous rencontrer.">' + esc(d.note) + "</textarea></div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Suivi</h2><p>Pour vous y retrouver dans Demandes.</p></div><div class="a-panel">' +
      '<div class="a-f"><label for="q-status">Statut</label><select class="a-in sel" id="q-status" style="max-width:240px">' + Object.entries(Q_ST).map(([k, v]) => '<option value="' + k + '"' + (k === q.status ? " selected" : "") + ">" + v + "</option>").join("") + "</select></div>" +
      (q.id ? '<div><button class="btn ghost sm danger" type="button" data-a="qremove">Supprimer ce devis</button></div>' : "") +
    "</div></section>" +
    '<div class="a-save"><button class="btn" type="button" data-a="qsave">Enregistrer le devis</button>' + (q.id ? qLink(q) : "") + '<span class="a-note" id="a-qsaved" aria-live="polite"></span></div>';
}
async function nextNumber(k) {
  const y = new Date().getFullYear(), pre = "D-" + y + "-";
  const { data } = await sb.from("quotes").select("number");
  const max = (data || []).map((r) => r.number).filter((n) => n && n.startsWith(pre)).reduce((m, n) => Math.max(m, Number(n.slice(pre.length)) || 0), 0);
  return pre + String(max + 1 + k).padStart(3, "0");
}
async function saveQuote() {
  readQuote();
  const d = QE.data;
  if (!d.client.name) { noteA("a-qsaved", "Indiquez le nom du client."); $("q-name").focus(); return; }
  d.lines = d.lines.filter((l) => l.label);
  if (!d.lines.length) { d.lines = [{ label: "", detail: "", qty: 1, unit: 0 }]; draw(); noteA("a-qsaved", "Ajoutez au moins une ligne avec une désignation."); return; }
  if (QE.status === "draft" || !d.seller) d.seller = sellerSnapshot(); // figé une fois le devis envoyé
  d.issued = d.issued || ymd(new Date().toISOString());
  const rec = { client_name: d.client.name.slice(0, 160), total: Math.round(qTotals(d).total * 100) / 100, status: QE.status, data: d, request_id: QE.request_id || null };
  if (QE.id) {
    const { error } = await sb.from("quotes").update(rec).eq("id", QE.id);
    if (error) throw error;
  } else {
    for (let k = 0; k < 5; k++) {
      rec.number = await nextNumber(k);
      const { data, error } = await sb.from("quotes").insert(rec).select("*").single();
      if (!error) { QE.id = data.id; QE.number = data.number; break; }
      if (!/duplicate|unique/i.test(error.message) || k === 4) throw error;
    }
  }
  markClean("qsave");
  await loadQuotes();
  draw();
  noteA("a-qsaved", "Devis " + QE.number + " enregistré. Ouvrez-le pour le télécharger en PDF.");
}
function quoteChips(rid) {
  if (!QUOTES) return "";
  const L = QUOTES.filter((q) => q.request_id === rid);
  return L.length ? '<span class="a-qchips">' + L.map((q) => '<button type="button" class="a-qchip" data-a="openquote" data-id="' + q.id + '">' + esc(q.number) + " · " + esc(qMoney(q.total)) + " · " + Q_ST[q.status] + "</button>").join("") + "</span>" : "";
}

// =================================================================== demandes
function viewDemandes() {
  return '<div class="a-top"><div><h1>Demandes</h1><p class="a-sub">Les messages envoyés depuis le formulaire de contact du site.</p></div>' + (QUOTES !== null ? '<div class="a-acts"><button class="btn ghost sm" type="button" data-a="quote">Nouveau devis</button></div>' : "") + "</div>" +
    (REQS.length ? '<div class="a-tbl">' + REQS.map((r) =>
      '<div class="a-srow a-req">' + icoTile("mail") + '<div class="a-nm"><b>' + esc(r.name) + (r.kind ? " · " + esc(r.kind) : "") + '</b><span class="a-ex full">' + esc(r.message || "").replace(/\n/g, "<br>") + '</span><span class="a-meta">' + esc(r.email) + (r.phone ? ", " + esc(r.phone) : "") + ", reçue le " + fdate(r.created_at) + "</span>" + quoteChips(r.id) + "</div>" +
      '<div class="a-acts" style="align-items:center"><button class="btn sm" type="button" data-a="reply" data-id="' + r.id + '">Répondre</button>' + (QUOTES !== null ? '<button class="btn ghost sm" type="button" data-a="quote" data-id="' + r.id + '">Faire un devis</button>' : "") + (AG !== null ? '<button class="btn ghost sm" type="button" data-a="reqbook" data-id="' + r.id + '">Ajouter à l\'agenda</button>' : "") + '' +
      '<select class="a-in sel" data-a="reqst" data-id="' + r.id + '" aria-label="Statut de la demande de ' + esc(r.name) + '">' + Object.entries(REQ_ST).map(([k, v]) => '<option value="' + k + '"' + (k === r.status ? " selected" : "") + ">" + v + "</option>").join("") + "</select>" +
      '<button class="btn ghost sm" type="button" data-a="delreq" data-id="' + r.id + '">Supprimer</button></div></div>').join("") + "</div>"
      : '<div class="a-empty"><b>Aucune demande pour l\'instant</b><span class="a-meta">Les messages du formulaire de contact arrivent ici.</span></div>') +
    (QUOTES && QUOTES.length ? '<section class="a-set"><div class="a-lab"><h2>Devis</h2><p>Les ' + QUOTES.length + " derniers devis, du plus récent au plus ancien.</p></div><div class=\"a-panel\"><ul class=\"a-team\">" + QUOTES.slice(0, 30).map((q) => "<li><span>" + esc(q.number) + " · " + esc(q.client_name) + "<br><small>" + esc(qMoney(q.total)) + " · " + Q_ST[q.status] + " · " + fdate(q.created_at) + '</small></span><button class="btn ghost sm" type="button" data-a="openquote" data-id="' + q.id + '">Ouvrir</button></li>').join("") + "</ul></div></section>" : "") +
    '<p class="a-note" id="a-note" aria-live="polite"></p><p class="a-meta" style="margin-top:12px">Supprimez les demandes sans suite au bout de trois ans au plus tard (politique de confidentialité).</p>';
}

// =================================================================== portfolio : bibliothèque, séances, photos de l'accueil
function viewPortfolio() {
  const stories = SITE.stories;
  return '<div class="a-top"><div><h1>Photos du site</h1><p class="a-sub">Vos photos publiques, les séances montrées sur l\'accueil et les photos de chaque emplacement.</p></div><div class="a-acts"><a class="btn ghost sm" href="index.html#seances" target="_blank" rel="noopener">Voir l\'accueil</a></div></div>' +
    '<p class="a-note" id="a-note" aria-live="polite"></p>' +
    '<section class="a-set"><div class="a-lab"><h2>Bibliothèque</h2><p>Les photos que vous acceptez de montrer publiquement, avec l\'accord des personnes photographiées. Redimensionnées à 2 400 px.</p></div><div class="a-panel">' +
      '<label class="drop"><input type="file" multiple accept="image/jpeg,image/png,image/webp" data-a="pfiles" aria-label="Ajouter des photos au portfolio"><b>Ajouter des photos</b><span>Glissez-les ici ou touchez pour choisir</span></label>' +
      '<p class="a-meta" id="pf-count" aria-live="polite">' + PORT.length + " photo" + (PORT.length > 1 ? "s" : "") + "</p>" +
      (THUMB_COL && PORT.some((p) => !p.thumb_path && (p.width || 0) > PF_THUMB) ? '<div class="a-light" id="pf-thumbs-btn"><p class="a-meta">' + PORT.filter((p) => !p.thumb_path && (p.width || 0) > PF_THUMB).length + " photo(s) sans vignette : sur téléphone, le site charge encore la grande version. Créez les vignettes pour un accueil plus rapide.</p><button class=\"btn sm\" type=\"button\" data-a=\"pfthumbs\">Créer les vignettes</button></div>" : "") +
      (PORT.length ? '<div class="a-lib" data-sort="portfolio">' + PORT.map((p) => '<figure data-sortid="' + p.id + '" data-id="' + p.id + '">' + dragBtn("la photo") + '<img alt="" loading="lazy" src="' + esc(p.thumb || p.url) + '" style="object-position:' + posOf(p.focus_x, p.focus_y) + '"><input class="a-in" data-a="caption" data-id="' + p.id + '" maxlength="200" placeholder="Description (pour Google)" aria-label="Description de la photo" value="' + esc(p.caption || "") + '"><span class="a-lib-acts"><button type="button" class="linkbtn" data-a="focuspf" data-id="' + p.id + '">Point important</button><button type="button" class="linkbtn" data-a="delpf" data-id="' + p.id + '">Supprimer</button></span></figure>').join("") + "</div>" : "") +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Séances</h2><p>Chacune a sa page, avec son texte et ses photos. Les six premières affichées apparaissent sur l\'accueil.</p></div><div class="a-panel">' +
      '<div class="a-tbl" data-sort="stories">' + stories.map((s, i) =>
        '<div class="a-srow a-stack a-sortrow" data-sortid="' + i + '">' + dragBtn(s.title) + thumbRef(s.photos[0]) + '<div class="a-nm"><b>' + esc(s.title) + (s.demo ? ' <span class="pill draft">Exemple</span>' : "") + "</b><span>" + esc(s.kind) + ", " + esc(s.place) + " · " + s.photos.length + ' photos</span></div><div class="a-acts" style="align-items:center"><label class="a-sw"><span class="a-meta">Affichée</span><input type="checkbox" data-a="sshow" data-i="' + i + '"' + (s.show !== false ? " checked" : "") + "></label>" +
        '<button class="btn ghost sm" type="button" data-a="editstory" data-i="' + i + '">Modifier</button><button class="btn ghost sm" type="button" data-a="delstory" data-i="' + i + '">Supprimer</button></div></div>').join("") + "</div>" +
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
// Photos du site : grande (2 400 px) + vignette (1 000 px) pour les petits emplacements et les téléphones
const PF_THUMB = 1000;
const withPfUrls = (x) => ({ ...x, url: publicUrl("portfolio", x.storage_path), thumb: x.thumb_path ? publicUrl("portfolio", x.thumb_path) : null });
const pfThumbPath = (path, ext) => path.replace(/([^/]+)\.[^./]+$/, "t-$1") + "." + ext;
async function uploadPortfolio(files) {
  files = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (!files.length) return;
  let n = 0;
  for (const file of files) {
    noteA("pf-count", "Import : " + (n + 1) + " / " + files.length + "…");
    try {
      const [prev, th] = await makeVariants(file, [{ max: 2400 }, { max: PF_THUMB, q: 0.78 }]);
      const path = `${crypto.randomUUID()}.${prev.ext}`, tpath = pfThumbPath(path, th.ext);
      const { error: e1 } = await sb.storage.from("portfolio").upload(path, prev.blob, { contentType: prev.blob.type, cacheControl: CACHE });
      if (e1) throw e1;
      const rec = { storage_path: path, width: prev.width, height: prev.height, position: PORT.length };
      if (THUMB_COL && th.width < prev.width) {
        const { error: et } = await sb.storage.from("portfolio").upload(tpath, th.blob, { contentType: th.blob.type, cacheControl: CACHE });
        if (!et) Object.assign(rec, { thumb_path: tpath, thumb_width: th.width });
      }
      let ins = await sb.from("portfolio").insert(rec).select("*").single();
      if (ins.error && noThumbCol(ins.error)) {
        THUMB_COL = false; await sb.storage.from("portfolio").remove([tpath]);
        delete rec.thumb_path; delete rec.thumb_width;
        ins = await sb.from("portfolio").insert(rec).select("*").single();
      }
      if (ins.error) throw ins.error;
      PORT.push(withPfUrls(ins.data));
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
  return '<div class="a-top"><div><h1>Textes et tarifs</h1><p class="a-sub">Ce que vous changez ici apparaît tout de suite sur le site.</p></div><div class="a-acts">' + (HIST && HIST.length ? '<button class="btn ghost sm" type="button" data-a="histrest" data-id="' + HIST[0].id + '">Annuler la dernière modification</button>' : "") + '<button class="btn ghost sm" type="button" data-a="preview">Aperçu avant d\'enregistrer</button><a class="btn ghost sm" href="index.html" target="_blank" rel="noopener">Voir le site</a></div></div>' +
    '<section class="a-set"><div class="a-lab"><h2>Accueil</h2><p>Le grand titre tient sur deux lignes : gardez chaque ligne courte.</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="s-t1">Titre, ligne 1</label><input class="a-in" id="s-t1" maxlength="18" value="' + esc(SITE.t1) + '"></div><div class="a-f"><label for="s-t2">Titre, ligne 2</label><input class="a-in" id="s-t2" maxlength="18" value="' + esc(SITE.t2) + '"></div></div>' +
      '<div class="a-f"><label for="s-kick">Ligne au-dessus du titre</label><input class="a-in" id="s-kick" maxlength="80" value="' + esc(SITE.kicker || "") + '" aria-describedby="s-kick-h"><span class="a-meta" id="s-kick-h">Votre métier et vos villes, en petites capitales. Google la lit : gardez « photographe mariage » et les villes.</span></div>' +
      '<div class="a-f"><label for="s-lede">Phrase sous le titre</label><textarea class="a-in" id="s-lede" rows="3" maxlength="300">' + esc(SITE.lede) + "</textarea></div>" +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Tarifs</h2><p>Une ligne par formule. Le prix s\'écrit en euros, sans le symbole.</p></div><div class="a-panel" id="s-prices">' +
      SITE.prices.map((p, i) => '<div class="a-3"><div class="a-f"><label for="p-n' + i + '">Formule</label><input class="a-in" id="p-n' + i + '" maxlength="40" value="' + esc(p.name) + '"></div><div class="a-f"><label for="p-d' + i + '">Ce qui est compris</label><textarea class="a-in a-short" id="p-d' + i + '" maxlength="200" rows="2">' + esc(p.detail) + '</textarea></div><div class="a-f"><label for="p-p' + i + '">Prix</label><div class="a-join"><input class="a-in" id="p-p' + i + '" inputmode="numeric" value="' + (p.price || "") + '"><button type="button" data-a="delprice" data-i="' + i + '" aria-label="Retirer la formule ' + esc(p.name) + '">×</button></div></div></div>').join("") +
      '<div><button class="btn ghost sm" type="button" data-a="addprice">Ajouter une formule</button></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Contact</h2><p>L\'adresse affichée sur le site et utilisée pour répondre aux clients.</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="s-mail">E-mail</label><input class="a-in" id="s-mail" type="email" value="' + esc(SITE.mail) + '"></div><div class="a-f"><label for="s-ig">Lien Instagram</label><input class="a-in" id="s-ig" type="url" value="' + esc(SITE.ig) + '"></div></div>' +
      '<div class="a-f"><label for="s-gwrite">Lien pour laisser un avis Google</label><input class="a-in" id="s-gwrite" type="url" placeholder="https://g.page/r/…/review" value="' + esc(SITE.gWrite || "") + '" aria-describedby="s-gwrite-h"><span class="a-meta" id="s-gwrite-h">Fiche Google Business → « Demander des avis » → copier le lien. Proposé à vos clients dans leur galerie.</span></div>' +
      '<div class="a-f"><label for="s-gread">Lien de vos avis Google</label><input class="a-in" id="s-gread" type="url" placeholder="https://maps.app.goo.gl/…" value="' + esc(SITE.gRead || "") + '" aria-describedby="s-gread-h"><span class="a-meta" id="s-gread-h">Le lien « Partager » de votre fiche sur Google Maps. Affiché sous les avis de l\'accueil.</span></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Google</h2><p>Le titre et la phrase que Google affiche. Citez votre métier et votre ville : c\'est ce que les gens tapent.</p></div><div class="a-panel">' +
      '<div class="a-f"><div style="display:flex;justify-content:space-between;gap:8px"><label for="s-seot">Titre dans Google ' + hlp("Le titre bleu affiché dans les résultats de Google. Gardez « photographe mariage » et vos villes : c'est ce que les gens tapent.") + '</label>' + counter("c-seot", SITE.seoTitle.length, 60) + '</div><input class="a-in" id="s-seot" value="' + esc(SITE.seoTitle) + '" aria-describedby="c-seot"></div>' +
      '<div class="a-f"><div style="display:flex;justify-content:space-between;gap:8px"><label for="s-seod">Description</label>' + counter("c-seod", SITE.seoDesc.length, 160) + '</div><textarea class="a-in" id="s-seod" rows="3" aria-describedby="c-seod">' + esc(SITE.seoDesc) + "</textarea></div>" +
      '<div class="ct-two"><div class="a-f"><label for="s-city">Ville</label><input class="a-in" id="s-city" value="' + esc(SITE.city) + '"></div><div class="a-f"><label for="s-area">Zone couverte ' + hlp("Vos villes et départements, séparés par des virgules. Google s'en sert pour vous montrer aux personnes qui cherchent près de chez elles.") + '</label><input class="a-in" id="s-area" value="' + esc(SITE.area) + '"></div></div>' +
      '<div class="a-f"><span class="l">Aperçu dans les résultats de recherche</span>' + serp() + "</div>" +
      '<div class="a-f"><span class="l">Aperçu quand le site est partagé</span><div class="share-card big" id="site-card"><img alt="" src="partage.jpg"><div><b>' + esc(SITE.seoTitle) + "</b><span>" + esc(SITE.seoDesc) + "</span><small>lau-rie.fr</small></div></div></div>" +
    "</div></section>" +
    '<div class="a-save"><button class="btn" type="button" data-a="savesite">Enregistrer</button><span class="a-note" id="a-saved" aria-live="polite"></span></div>';
}
function readSiteForm() {
  SITE.t1 = $("s-t1").value.trim() || SITE.t1; SITE.t2 = $("s-t2").value.trim(); SITE.lede = $("s-lede").value.trim(); SITE.kicker = $("s-kick").value.trim();
  SITE.prices = SITE.prices.map((p, i) => ({ name: $("p-n" + i).value.trim() || p.name, detail: $("p-d" + i).value.trim(), price: parseInt($("p-p" + i).value.replace(/\D/g, ""), 10) || 0 }));
  const m = $("s-mail").value.trim(); if (EMAIL.test(m)) SITE.mail = m;
  const ig = $("s-ig").value.trim(); if (/^https:\/\//.test(ig)) SITE.ig = ig;
  const gw = $("s-gwrite").value.trim(), gr = $("s-gread").value.trim();
  SITE.gWrite = /^https:\/\//.test(gw) ? gw : ""; SITE.gRead = /^https:\/\//.test(gr) ? gr : "";
  SITE.seoTitle = $("s-seot").value.trim() || SITE.seoTitle; SITE.seoDesc = $("s-seod").value.trim() || SITE.seoDesc;
  SITE.city = $("s-city").value.trim() || SITE.city; SITE.area = $("s-area").value.trim() || SITE.area;
}

// =================================================================== réglages
let ADMINS = [];
let dupFrom = null;
function viewReglages() {
  const L = SITE.legal;
  return '<div class="a-top"><div><h1>Mon entreprise</h1><p class="a-sub">Informations légales, réponses toutes prêtes et e-mail de rappel.</p></div></div>' +
    '<section class="a-set"><div class="a-lab"><h2>Informations légales</h2><p>Elles remplissent automatiquement les mentions légales, la politique de confidentialité et les conditions de prestation. Faites relire ces pages une fois (CCI ou juriste).</p></div><div class="a-panel">' +
      '<div class="ct-two"><div class="a-f"><label for="l-owner">Nom et prénom</label><input class="a-in" id="l-owner" autocomplete="name" value="' + esc(L.owner) + '"></div><div class="a-f"><label for="l-status">Statut</label><input class="a-in" id="l-status" value="' + esc(L.status) + '"></div></div>' +
      '<div class="ct-two"><div class="a-f"><label for="l-siret">SIRET</label><input class="a-in" id="l-siret" inputmode="numeric" placeholder="14 chiffres" value="' + esc(L.siret) + '"></div><div class="a-f"><label for="l-phone">Téléphone</label><input class="a-in" id="l-phone" type="tel" value="' + esc(L.phone) + '"></div></div>' +
      '<div class="a-f"><label for="l-address">Adresse professionnelle</label><input class="a-in" id="l-address" value="' + esc(L.address) + '"></div>' +
      '<div class="a-f"><label for="l-vat">Mention TVA ' + hlp("En micro-entreprise sans TVA, laissez « TVA non applicable, article 293 B du CGI ».") + '</label><input class="a-in" id="l-vat" value="' + esc(L.vat) + '"></div>' +
      '<div class="ct-two"><div class="a-f"><label for="l-deposit">Acompte (%)</label><input class="a-in" id="l-deposit" inputmode="numeric" value="' + esc(L.deposit) + '"></div><div class="a-f"><label for="l-delay">Délai de livraison</label><input class="a-in" id="l-delay" value="' + esc(L.delay) + '"></div></div>' +
      '<div class="a-f"><label for="l-delaywed">Délai de livraison pour un mariage (si différent)</label><input class="a-in" id="l-delaywed" value="' + esc(L.delayWed) + '"></div>' +
      '<div class="ct-two"><div class="a-f"><label for="l-mediator">Médiateur de la consommation ' + hlp("Obligatoire pour vendre aux particuliers : un organisme qui aide à régler un litige avec un client. Liste officielle sur economie.gouv.fr/mediation-conso.") + '</label><input class="a-in" id="l-mediator" placeholder="Obligatoire pour vendre à des particuliers" value="' + esc(L.mediator) + '"></div><div class="a-f"><label for="l-medurl">Site du médiateur</label><input class="a-in" id="l-medurl" type="url" placeholder="https://" value="' + esc(L.mediatorUrl) + '"></div></div>' +
      '<div class="a-f"><label for="l-host">Hébergeur du site ' + hlp("Obligation légale : l'entreprise qui héberge les pages du site. Laissez GitHub tel quel.") + '</label><input class="a-in" id="l-host" value="' + esc(L.host) + '"></div>' +
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
    "</div></section>";
}
function viewCompte() {
  return '<div class="a-top"><div><h1>Compte et sécurité</h1><p class="a-sub">Équipe, mot de passe, sauvegarde et historique des modifications.</p></div></div>' +
    '<section class="a-set"><div class="a-lab"><h2>Équipe</h2><p>Les personnes qui gèrent le site avec vous ont les mêmes droits que vous. Gardez toujours deux comptes : si l\'une oublie son mot de passe, l\'autre lui en redonne un.</p></div><div class="a-panel">' +
      '<ul class="a-team" id="a-team">' + (ADMINS.length ? ADMINS.map((a) => "<li><span>" + esc(a.email) + "<br><small>" + (a.user_id === user.id ? "Vous" : a.last_sign_in_at ? "Dernière connexion le " + fdate(a.last_sign_in_at) : "Jamais connectée") + "</small></span>" + (a.user_id === user.id ? "" : '<span class="a-acts"><button class="btn ghost sm" type="button" data-a="resetpw" data-id="' + a.user_id + '" data-email="' + esc(a.email) + '">Nouveau mot de passe</button><button class="btn ghost sm" type="button" data-a="rmadmin" data-id="' + a.user_id + '" data-email="' + esc(a.email) + '">Retirer</button></span>') + "</li>").join("") : "<li><span>Chargement…</span></li>") + "</ul>" +
      '<div class="a-f"><label for="t-mail">Ajouter quelqu\'un</label><div class="a-join"><input class="a-in" id="t-mail" type="email" placeholder="prenom@exemple.fr"><button type="button" data-a="invite">Créer le compte</button></div></div><p class="a-note" id="a-note" aria-live="polite"></p>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Mon mot de passe</h2><p>Connectée en tant que ' + esc(user.email) + ".</p></div><div class=\"a-panel\">" +
      '<div class="a-f"><label for="mp-1">Nouveau mot de passe (12 caractères minimum)</label><input class="a-in" id="mp-1" type="password" minlength="12" autocomplete="new-password"></div>' +
      '<div class="a-f"><label for="mp-2">Confirmer</label><input class="a-in" id="mp-2" type="password" minlength="12" autocomplete="new-password"></div>' +
      '<div class="a-save" style="padding-top:4px"><button class="btn sm" type="button" data-a="mypw">Mettre à jour</button><span class="a-note" id="a-pw" aria-live="polite"></span></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Sauvegarde</h2><p>Un fichier avec toutes vos données : galeries, clients, sélections, demandes, avis, agenda et textes du site. Gardez-le sur votre ordinateur ou un disque externe. Les photos n\'y sont pas : vos originaux sont chez vous.</p></div><div class="a-panel">' +
      '<p class="a-meta">' + (backupAge() === null ? "Aucune sauvegarde pour l'instant." : "Dernière sauvegarde " + agoTxt(backupAge()) + ".") + "</p>" +
      '<div class="a-save" style="padding-top:4px"><button class="btn sm" type="button" data-a="backup">Télécharger une sauvegarde</button><span class="a-note" id="a-backup" aria-live="polite"></span></div>' +
    "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Espace de stockage</h2><p>Vos aperçus de galeries et les photos du site. Les originaux restent sur votre ordinateur : supprimer un aperçu ne fait rien perdre.</p></div><div class="a-panel">' + storageHtml() + "</div></section>" +
    '<section class="a-set"><div class="a-lab"><h2>Historique du site</h2><p>Chaque enregistrement des textes, tarifs ou réglages du site garde la version précédente (les 30 dernières). Vous pouvez la regarder ou y revenir.</p></div><div class="a-panel">' + historyHtml() + "</div></section>" +
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
  if (tab === "compte") draw();
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
  const html = tab === "accueil" ? viewAccueil() : tab === "agenda" ? viewAgenda() : tab === "sante" ? viewSante() : tab === "corbeille" ? viewCorbeille() : tab === "galeries" ? (g ? viewGallery(g) : viewGaleries()) : tab === "compte" ? viewCompte() : tab === "devis" && QE ? viewQuote()
    : tab === "demandes" ? viewDemandes() : tab === "portfolio" ? viewPortfolio() : tab === "site" ? viewSite() : tab === "avis" ? viewAvis() : viewReglages();
  const mo = $("g-more"); if (mo) moreOpen = mo.open;
  $("a-main").innerHTML = html;
  navSync();
}
// Modifications non enregistrées : bandeau « Enregistrer » et alerte avant de quitter
const DIRTY = new Set();
const SAVE_OF = (id) => !id ? null : /^g-(?!link$)/.test(id) ? "save" : /^(s-|p-)/.test(id) ? "savesite" : /^l-/.test(id) ? "savelegal" : /^m-/.test(id) ? "savetpl" : /^rp-/.test(id) ? "savereplies" : /^st-/.test(id) ? "savestore" : /^q-(?!pick$)/.test(id) ? "qsave" : null;
function dirtySync() {
  const bar = $("a-dirty"); if (!bar) return;
  bar.hidden = !DIRTY.size;
  document.body.classList.toggle("has-dirty", !!DIRTY.size);
}
function markDirty(act) { if (act) { DIRTY.add(act); dirtySync(); } }
function markClean(act) { DIRTY.delete(act); dirtySync(); }
function leaveOk() {
  if (IMPORTING && !confirm("Un import de photos est en cours. Quitter cette page l'interrompt. Continuer ?")) return false;
  if (!DIRTY.size) return true;
  if (!confirm("Des modifications ne sont pas enregistrées. Les abandonner ?")) return false;
  DIRTY.clear(); dirtySync(); return true;
}
window.addEventListener("beforeunload", (e) => { if (DIRTY.size || IMPORTING) { e.preventDefault(); e.returnValue = ""; } });
$("a-dirty-save").addEventListener("click", () => {
  const act = [...DIRTY][0], btn = act && $("a-main").querySelector('[data-a="' + act + '"]');
  if (btn) btn.click(); else { DIRTY.clear(); dirtySync(); }
});

async function go(t, id) {
  if (!leaveOk()) return;
  tab = t; openId = id || null; gShowAll = false; moreOpen = false;
  if (t === "galeries" && openId) {
    $("a-main").innerHTML = '<p class="a-meta">Chargement de la galerie…</p>';
    try { await loadGalleryPhotos(galById(openId)); } catch (e) { toast(errMsg(e)); }
  }
  if (t === "selections") t = tab = "galeries"; // ancien onglet : les sélections sont dans chaque galerie
  if (t === "galeries" && openId && SEL[openId]) await loadSelNames();
  if (t === "demandes" || t === "devis") await loadQuotes();
  if (t === "devis" && !QE) t = tab = "demandes";
  if (t === "compte") { loadAdmins(); await Promise.all([loadHistory(), loadStorage()]); }
  if (t === "site") await loadHistory();
  if (t === "corbeille") await loadTrash();
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
    else if (a === "booknew") openBook(null, b.dataset.day ? { day: b.dataset.day } : null);
    else if (a === "bookedit") openBook(AG.find((x) => x.id === b.dataset.id));
    else if (a === "bookgal") await galleryFromBooking(AG.find((x) => x.id === b.dataset.id));
    else if (a === "bookics") { const bk = AG.find((x) => x.id === b.dataset.id); downloadIcs([bk], "seance-" + bk.day + ".ics"); }
    else if (a === "bookicsall") downloadIcs(AG.filter((x) => x.day >= todayYmd()), "agenda-lau-rie.ics");
    else if (a === "agprev" || a === "agnext") { const [y, m] = agMonth.split("-").map(Number), d = new Date(y, m - 1 + (a === "agnext" ? 1 : -1), 1); agMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); draw(); }
    else if (a === "reqbook") { const r = REQS.find((x) => x.id === b.dataset.id); openBook(null, { title: r.name, kind: r.kind || "Mariage", client_email: r.email, notes: r.message || "", request_id: r.id }); }
    else if (a === "go") await go(b.dataset.to);
    else if (a === "back") await go("galeries");
    else if (a === "new") { dupFrom = null; $("h-new").textContent = "Nouvelle galerie"; $("n-err").textContent = ""; $("n-name").value = ""; $("n-date").value = ""; openSheet("s-new"); }
    else if (a === "dupgal") { dupFrom = g; $("h-new").textContent = "Nouvelle galerie avec les réglages de « " + g.title + " »"; $("n-err").textContent = ""; $("n-name").value = ""; $("n-date").value = ""; $("n-kind").value = g.kind || "Mariage"; openSheet("s-new"); }
    else if (a === "backup") await makeBackup();
    else if (a === "preview") { if ($("s-t1")) readSiteForm(); openPreview(SITE); }
    else if (a === "histprev") await previewVersion(Number(b.dataset.id));
    else if (a === "histrest") { if (confirm("Revenir à cette version du site ? Les textes, tarifs et réglages actuels seront remplacés (et gardés dans l'historique).")) await restoreVersion(Number(b.dataset.id)); }
    else if (a === "trashrest") await restoreTrash(b.dataset.id);
    else if (a === "trashdel") { const t = TRASH.find((x) => x.id === b.dataset.id); if (confirm("Supprimer définitivement « " + t.label + " » ? Ce n'est plus récupérable.")) { await destroyTrash(t); draw(); } }
    else if (a === "focuspf") { const p = PORT.find((x) => x.id === b.dataset.id); openFocus("portfolio", p, p.url); }
    else if (a === "focusph") { const p = gPhotos.find((x) => x.id === b.dataset.pid); openFocus("photos", p, gUrls[gKey(p)]); }
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
      g.cover_photo_id = p.id; g.cover = { preview_path: p.preview_path, thumb_path: p.thumb_path }; COVERS[gKey(p)] = gUrls[gKey(p)];
      $("g-photos").innerHTML = photoGrid(g); $("g-card").outerHTML = shareCard(g); toast("Couverture changée.");
    }
    else if (a === "delphoto") {
      const p = gPhotos.find((x) => x.id === b.dataset.pid);
      if (TRASH !== null) {
        await trashPhoto(g, p); await loadTrash();
      } else {
        if (!confirm("Supprimer la photo " + p.filename + " de la galerie ?")) return;
        const { error } = await sb.from("photos").delete().eq("id", p.id);
        if (error) throw error;
        await sb.storage.from("galleries").remove(photoFiles(p));
      }
      gPhotos = gPhotos.filter((x) => x.id !== p.id); g.nphotos = gPhotos.length;
      if (g.cover_photo_id === p.id) { g.cover_photo_id = null; g.cover = null; }
      $("g-photos").innerHTML = photoGrid(g); noteA("g-count", gPhotos.length + " photos." + (TRASH !== null ? " Photo mise à la corbeille (30 jours pour la restaurer)." : ""));
    }
    else if (a === "delgal") {
      if (TRASH !== null) {
        if (!confirm("Mettre la galerie « " + g.title + " » à la corbeille ? Les clients n'y ont plus accès. Vous pourrez la restaurer pendant 30 jours (Galeries → Corbeille).")) return;
        await trashGallery(g);
      } else {
        if (!confirm("Supprimer définitivement la galerie « " + g.title + " », ses " + g.nphotos + " aperçus et ses sélections ?")) return;
        const paths = gPhotos.flatMap(photoFiles);
        await sb.from("galleries").update({ cover_photo_id: null }).eq("id", g.id);
        for (let i = 0; i < paths.length; i += 100) await sb.storage.from("galleries").remove(paths.slice(i, i + 100));
        const { error } = await sb.from("galleries").delete().eq("id", g.id);
        if (error) throw error;
      }
      await Promise.all([loadGalleries(), loadTrash()]); await go("galeries"); toast(TRASH !== null ? "Galerie mise à la corbeille." : "Galerie supprimée.");
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
      await sb.storage.from("portfolio").remove([p.storage_path, p.thumb_path].filter(Boolean));
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
    else if (a === "quote") { if (!leaveOk()) return; const r = REQS.find((x) => x.id === b.dataset.id); QE = newQuote(r || null); await go("devis"); markDirty("qsave"); }
    else if (a === "openquote") { if (!leaveOk()) return; await loadQuotes(); const q = (QUOTES || []).find((x) => x.id === b.dataset.id); if (!q) return; QE = { id: q.id, number: q.number, status: q.status, request_id: q.request_id, data: JSON.parse(JSON.stringify(q.data || {})) }; QE.data.lines = QE.data.lines || []; QE.data.client = QE.data.client || {}; await go("devis"); }
    else if (a === "qsave") await saveQuote();
    else if (a === "qaddline") { readQuote(); QE.data.lines.push({ label: "", detail: "", qty: 1, unit: 0 }); draw(); markDirty("qsave"); $("q-l" + (QE.data.lines.length - 1) + "-label").focus(); }
    else if (a === "qaddprice") { readQuote(); const p = SITE.prices[Number($("q-pick").value)]; if (!p) return; QE.data.lines = QE.data.lines.filter((l) => l.label || l.unit); QE.data.lines.push({ label: p.name, detail: p.detail || "", qty: 1, unit: Number(p.price) || 0 }); draw(); markDirty("qsave"); }
    else if (a === "qdel") { readQuote(); QE.data.lines.splice(Number(b.dataset.i), 1); if (!QE.data.lines.length) QE.data.lines.push({ label: "", detail: "", qty: 1, unit: 0 }); draw(); markDirty("qsave"); }
    else if (a === "qremove") {
      if (!confirm("Supprimer le devis " + QE.number + " ? Son numéro ne sera pas réutilisé.")) return;
      const { error } = await sb.from("quotes").delete().eq("id", QE.id);
      if (error) throw error;
      markClean("qsave"); QE = null; await go("demandes"); toast("Devis supprimé.");
    }
    else if (a === "savestore") {
      SITE.storageQuotaMb = Number($("st-quota").value) || 1024;
      SITE.purgeMonths = Number($("st-purge").value);
      if (await saveSite()) { markClean("savestore"); noteA("a-store", "Réglages enregistrés."); }
    }
    else if (a === "archive") {
      const gt = galById(b.dataset.id);
      if (!confirm("Supprimer les aperçus de « " + gt.title + " » (" + mo((STORE && STORE.folders[gt.id]) || 0) + ") ? La galerie reste fermée ; vous pourrez la rouvrir en réimportant les photos depuis Lightroom.")) return;
      await archiveGallery(gt); await loadStorage(); draw(); toast("Galerie allégée.");
    }
    else if (a === "pfthumbs") { b.disabled = true; await makePfThumbs(); }
    else if (a === "mkthumbs") { b.disabled = true; await makeThumbs(g); }
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
  if (/^q-l\d+-(qty|unit)$|^q-deposit$/.test(id)) qLive();
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
  const inp = d.querySelector("input[type=file]");
  const files = await filesFromDrop(e.dataTransfer);
  if (inp.dataset.a === "files") await uploadGalleryFiles(galById(openId), files); else await uploadPortfolio(files);
});



// =================================================================== outils : aide, sauvegarde, historique, corbeille, santé, aperçu, tri, point important
// --- Aide : petit « ? » à côté d'un réglage
const hlp = (t) => '<button type="button" class="a-help" data-help="' + esc(t) + '" aria-label="Aide : ' + esc(t) + '">?</button>';
const POP = document.createElement("div");
POP.className = "a-pop"; POP.setAttribute("role", "tooltip"); POP.hidden = true; document.body.appendChild(POP);
document.addEventListener("click", (e) => {
  const h = e.target.closest(".a-help");
  if (!h) { POP.hidden = true; return; }
  e.preventDefault(); e.stopPropagation();
  if (!POP.hidden && POP.dataset.for === h.dataset.help) { POP.hidden = true; return; }
  POP.textContent = h.dataset.help; POP.dataset.for = h.dataset.help; POP.hidden = false;
  const r = h.getBoundingClientRect(), w = Math.min(320, innerWidth - 24);
  POP.style.width = w + "px";
  POP.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + "px";
  POP.style.top = (r.bottom + scrollY + 8) + "px";
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") POP.hidden = true; });

// --- Sauvegarde : un fichier avec toutes les données, à garder chez soi
async function fetchAll(table, cols) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(i, i + 999);
    if (error) return i === 0 ? null : out;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function makeBackup() {
  noteA("a-backup", "Préparation de la sauvegarde…");
  const site = await sb.from("site_settings").select("content").eq("id", 1).maybeSingle();
  const tables = {};
  const list = [["galleries", GCOLS], ["photos", "*"], ["selections", "*"], ["reviews", "*"], ["booking_requests", "*"], ["portfolio", "*"], ["bookings", "*"], ["photo_favs", "*"], ["trash", "*"], ["quotes", "*"]];
  for (const [t, c] of list) { const rows = await fetchAll(t, c); if (rows) tables[t] = rows; }
  const now = new Date().toISOString();
  const data = { app: "lau.rie", format: 1, created_at: now, site: site.data ? site.data.content : null, tables };
  saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), "sauvegarde-lau-rie-" + now.slice(0, 10) + ".json");
  SITE.backupAt = now; await saveSite();
  const n = Object.values(tables).reduce((s, r) => s + r.length, 0);
  noteA("a-backup", "Sauvegarde téléchargée (" + n + " éléments). Rangez le fichier sur votre ordinateur ou un disque externe.");
  navSync();
}
const backupAge = () => (SITE.backupAt ? Math.floor((Date.now() - new Date(SITE.backupAt)) / 864e5) : null);
const agoTxt = (d) => (d === 0 ? "aujourd'hui" : d === 1 ? "hier" : "il y a " + d + " jours");

// --- Historique des textes du site (annuler)
let HIST = null;
async function loadHistory() {
  const { data, error } = await sb.from("site_history").select("id, saved_at").order("id", { ascending: false }).limit(30);
  HIST = error ? null : data || [];
}
async function restoreVersion(id) {
  const { data, error } = await sb.from("site_history").select("content").eq("id", id).single();
  if (error) throw error;
  SITE = mergeSite(data.content);
  img = makeImg(libraryOf(PORT));
  if (await saveSite("Version restaurée. Le site est revenu à cet état.")) { DIRTY.delete("savesite"); DIRTY.delete("savelegal"); DIRTY.delete("savetpl"); DIRTY.delete("savereplies"); dirtySync(); await loadHistory(); draw(); }
}
async function previewVersion(id) {
  const { data, error } = await sb.from("site_history").select("content").eq("id", id).single();
  if (error) throw error;
  openPreview(mergeSite(data.content));
}
// =================================================================== espace de stockage
let STORE = null; // { total, buckets: {galleries, portfolio, …}, folders: {id de galerie: octets} }
async function loadStorage() {
  const { data, error } = await sb.rpc("storage_usage");
  if (error) { STORE = null; return; }
  const st = { total: 0, buckets: {}, folders: {} };
  (data || []).forEach((r) => {
    const b = Number(r.bytes) || 0;
    st.total += b; st.buckets[r.bucket] = (st.buckets[r.bucket] || 0) + b;
    if (r.folder) st.folders[r.folder] = (st.folders[r.folder] || 0) + b;
  });
  STORE = st;
}
const quotaBytes = () => (Number(SITE.storageQuotaMb) || 1024) * 1048576;
const purgeMonths = () => (SITE.purgeMonths == null || SITE.purgeMonths === "" ? 3 : Number(SITE.purgeMonths));
const storePct = () => (STORE ? Math.min(100, Math.round((STORE.total / quotaBytes()) * 100)) : null);
const mo = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1).replace(/\.0$/, "").replace(".", ",") + " Go" : Math.max(b ? 1 : 0, Math.round(b / 1048576)) + " Mo");
const closedGals = () => GAL.filter((g) => !g.archived_at && g.expires_at && new Date(g.expires_at) < new Date());
function storageHtml() {
  if (STORE === null) return '<p class="a-meta">Exécutez le 7e fichier SQL (…_miniatures_stockage_devis.sql) pour suivre l\'espace utilisé.</p>';
  const p = storePct(), cl = closedGals(), pm = purgeMonths();
  const other = STORE.total - (STORE.buckets.galleries || 0) - (STORE.buckets.portfolio || 0);
  return '<div class="a-gauge' + (p >= 95 ? " full" : p >= 80 ? " warn" : "") + '"><div class="a-bar" role="img" aria-label="Espace utilisé : ' + p + ' %"><i style="width:' + p + '%"></i></div>' +
      "<p><b>" + mo(STORE.total) + "</b> utilisés sur " + mo(quotaBytes()) + " (" + p + " %)</p></div>" +
    '<p class="a-meta">Galeries : ' + mo(STORE.buckets.galleries || 0) + " · Photos du site : " + mo(STORE.buckets.portfolio || 0) + (other > 1048576 ? " · Autres : " + mo(other) : "") + "</p>" +
    '<div class="ct-two"><div class="a-f"><label for="st-quota">Limite de mon offre ' + hlp("L'offre gratuite de Supabase compte environ 1 Go de fichiers. Si vous passez à une offre payante, choisissez la nouvelle limite.") + '</label><select class="a-in sel" id="st-quota">' +
      [[1024, "1 Go (offre gratuite)"], [102400, "100 Go (offre Pro)"]].map((o) => '<option value="' + o[0] + '"' + ((Number(SITE.storageQuotaMb) || 1024) === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div>" +
    '<div class="a-f"><label for="st-purge">Alléger les galeries fermées depuis ' + hlp("Chaque nuit, les aperçus des galeries fermées depuis ce délai sont supprimés. La fiche, les noms de fichiers et la sélection restent : pour rouvrir, prolongez la date et réimportez le même dossier depuis Lightroom.") + '</label><select class="a-in sel" id="st-purge">' +
      [[1, "1 mois"], [3, "3 mois"], [6, "6 mois"], [12, "1 an"], [0, "Jamais"]].map((o) => '<option value="' + o[0] + '"' + (pm === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div></div>" +
    '<div class="a-save" style="padding-top:4px"><button class="btn sm" type="button" data-a="savestore">Enregistrer</button><span class="a-note" id="a-store" aria-live="polite"></span></div>' +
    (cl.length ? '<div class="a-f"><span class="l">Galeries fermées, à alléger dès maintenant</span><ul class="a-team">' + cl.map((g) => "<li><span>" + esc(g.title) + "<br><small>Fermée le " + fdate(g.expires_at) + " · " + mo(STORE.folders[g.id] || 0) + "</small></span>" +
      '<button class="btn ghost sm" type="button" data-a="archive" data-id="' + g.id + '">Supprimer les aperçus</button></li>').join("") + "</ul></div>" : "");
}
// Supprime aperçus et miniatures d'une galerie fermée ; la fiche reste (réimport possible)
async function archiveGallery(g) {
  let r = await sb.from("photos").select("preview_path, thumb_path").eq("gallery_id", g.id);
  if (r.error) r = await sb.from("photos").select("preview_path").eq("gallery_id", g.id);
  if (r.error) throw r.error;
  const files = r.data.flatMap(photoFiles);
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await sb.storage.from("galleries").remove(files.slice(i, i + 100));
    if (error) throw error;
  }
  const now = new Date().toISOString();
  const { error } = await sb.from("galleries").update({ archived_at: now }).eq("id", g.id);
  if (error) throw error;
  g.archived_at = now;
}
// Vignettes des photos du site importées avant la 7e migration
async function makePfThumbs() {
  const todo = PORT.filter((p) => !p.thumb_path && (p.width || 0) > PF_THUMB);
  let done = 0, failed = 0;
  for (const p of todo) {
    noteA("pf-count", "Vignettes : " + done + " / " + todo.length + "…");
    try {
      const res = await fetch(p.url);
      if (!res.ok) throw new Error("photo introuvable");
      const [th] = await makeVariants(await res.blob(), [{ max: PF_THUMB, q: 0.78 }]);
      const tpath = pfThumbPath(p.storage_path, th.ext);
      const up = await sb.storage.from("portfolio").upload(tpath, th.blob, { contentType: th.blob.type, upsert: true, cacheControl: CACHE });
      if (up.error) throw up.error;
      const { error } = await sb.from("portfolio").update({ thumb_path: tpath, thumb_width: th.width }).eq("id", p.id);
      if (error) { if (noThumbCol(error)) { THUMB_COL = false; break; } throw error; }
      Object.assign(p, withPfUrls({ ...p, thumb_path: tpath, thumb_width: th.width }));
    } catch (e) { failed++; console.error(e); }
    done++;
  }
  img = makeImg(libraryOf(PORT));
  draw();
  noteA("pf-count", !THUMB_COL ? "Exécutez d'abord le 7e fichier SQL dans Supabase." : failed ? (done - failed) + " vignettes créées, " + failed + " en échec : relancez." : done + " vignettes créées : le site est plus léger sur téléphone.");
}
// Miniatures des photos importées avant la 7e migration, créées à partir des aperçus
async function makeThumbs(g) {
  const todo = gPhotos.filter((p) => !p.thumb_path);
  if (!todo.length) return;
  const q = [...todo];
  let done = 0, failed = 0;
  const note = () => noteA("g-thumbs", "Miniatures : " + done + " / " + todo.length + "… Gardez cette page ouverte.");
  IMPORTING++; note();
  try {
    await Promise.all([0, 1, 2].map(async () => {
      while (q.length && THUMB_COL) {
        const p = q.shift();
        try {
          const { data: su, error: se } = await sb.storage.from("galleries").createSignedUrl(p.preview_path, 600);
          if (se) throw se;
          const res = await fetch(su.signedUrl);
          if (!res.ok) throw new Error("aperçu introuvable");
          const [th] = await makeVariants(await res.blob(), [{ max: THUMB, q: 0.74 }]);
          const tpath = p.preview_path.replace(/([^/]+)$/, "t_$1").replace(/\.[^./]+$/, "." + th.ext);
          await withRetry(async () => {
            const up = await sb.storage.from("galleries").upload(tpath, th.blob, { contentType: th.blob.type, upsert: true, cacheControl: CACHE });
            if (up.error) throw up.error;
          });
          const { error } = await sb.from("photos").update({ thumb_path: tpath }).eq("id", p.id);
          if (error) { if (noThumbCol(error)) THUMB_COL = false; throw error; }
          p.thumb_path = tpath; gUrls[tpath] = URL.createObjectURL(th.blob);
        } catch (e) { failed++; console.error(e); }
        done++; note();
      }
    }));
  } finally { IMPORTING--; }
  if (g.cover) { const c = gPhotos.find((p) => p.id === g.cover_photo_id); if (c && c.thumb_path) { g.cover.thumb_path = c.thumb_path; COVERS[c.thumb_path] = gUrls[c.thumb_path]; } }
  $("g-photos").innerHTML = photoGrid(g);
  noteA("g-thumbs", !THUMB_COL ? "Exécutez d'abord le 7e fichier SQL dans Supabase." : failed ? (done - failed) + " miniatures créées, " + failed + " en échec : relancez." : "Galerie allégée : " + done + " miniatures créées.");
  if (!failed && THUMB_COL) { const bx = $("g-thumbs-btn"); if (bx) bx.remove(); }
}

function historyHtml() {
  if (HIST === null) return '<p class="a-meta">Pour garder l\'historique, exécutez le 6e fichier SQL (…_agenda_historique_corbeille.sql) dans Supabase.</p>';
  if (!HIST.length) return '<p class="a-meta">Aucune version précédente pour l\'instant : elles apparaîtront ici à chaque enregistrement.</p>';
  return '<div class="a-tbl">' + HIST.map((h) => '<div class="a-srow a-hist"><div class="a-nm"><b>' + esc(new Date(h.saved_at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })) + '</b><span>Version enregistrée avant ce moment</span></div><div class="a-acts"><button class="btn ghost sm" type="button" data-a="histprev" data-id="' + h.id + '">Aperçu</button><button class="btn ghost sm" type="button" data-a="histrest" data-id="' + h.id + '">Restaurer</button></div></div>').join("") + "</div>";
}

// --- Aperçu du site avant d'enregistrer (ouvre l'accueil avec le brouillon, dans ce navigateur seulement)
function openPreview(content) {
  try { localStorage.setItem("lr-preview", JSON.stringify({ at: Date.now(), content })); } catch { toast("Aperçu impossible dans ce navigateur (navigation privée ?)."); return; }
  window.open("index.html?apercu=1", "_blank", "noopener");
}

// --- Corbeille : 30 jours pour changer d'avis
let TRASH = null;
async function loadTrash() {
  const { data, error } = await sb.from("trash").select("id, kind, label, gallery_id, files, deleted_at").order("deleted_at", { ascending: false });
  TRASH = error ? null : data || [];
}
const trashLeft = (t) => Math.max(0, 30 - Math.floor((Date.now() - new Date(t.deleted_at)) / 864e5));
async function purgeTrash() {
  if (!TRASH) return;
  for (const t of TRASH.filter((x) => trashLeft(x) <= 0)) await destroyTrash(t);
}
async function destroyTrash(t) {
  for (let i = 0; i < (t.files || []).length; i += 100) await sb.storage.from("galleries").remove(t.files.slice(i, i + 100));
  await sb.from("trash").delete().eq("id", t.id);
  TRASH = TRASH.filter((x) => x.id !== t.id);
}
const GAL_KEEP = GCOLS.split(",").map((x) => x.trim()).concat(["link_sent_at"]);
async function trashGallery(g) {
  const sels = await fetchAll("selections", "*") || [];
  const revs = REVS.filter((r) => r.gallery_id === g.id).map((r) => r.id);
  const gal = Object.fromEntries(GAL_KEEP.filter((k) => k in g).map((k) => [k, g[k]]));
  const payload = { gallery: gal, photos: gPhotos, selections: sels.filter((s) => s.gallery_id === g.id), reviews: revs };
  const { error } = await sb.from("trash").insert({ kind: "gallery", label: g.title, gallery_id: g.id, payload, files: gPhotos.flatMap(photoFiles) });
  if (error) throw error;
  await sb.from("galleries").update({ cover_photo_id: null }).eq("id", g.id);
  const { error: e2 } = await sb.from("galleries").delete().eq("id", g.id);
  if (e2) throw e2;
}
async function trashPhoto(g, p) {
  const { error } = await sb.from("trash").insert({ kind: "photo", label: p.filename + " (" + g.title + ")", gallery_id: g.id, payload: { photo: p }, files: photoFiles(p) });
  if (error) throw error;
  if (g.cover_photo_id === p.id) await sb.from("galleries").update({ cover_photo_id: null }).eq("id", g.id);
  const { error: e2 } = await sb.from("photos").delete().eq("id", p.id);
  if (e2) throw e2;
}
async function restoreTrash(id) {
  const { data: t, error } = await sb.from("trash").select("*").eq("id", id).single();
  if (error) throw error;
  if (t.kind === "photo") {
    if (!galById(t.gallery_id)) { toast("Restaurez d'abord la galerie « " + t.label.replace(/^.*\((.*)\)$/, "$1") + " »."); return; }
    const p = { ...t.payload.photo }; delete p.created_at;
    const { error: e } = await sb.from("photos").insert(p);
    if (e) throw e;
  } else {
    const gal = { ...t.payload.gallery, cover_photo_id: null }, cover = t.payload.gallery.cover_photo_id;
    const { error: e } = await sb.from("galleries").insert(gal);
    if (e) { toast(/code|utilis|duplicate|unique/i.test(e.message) ? "Restauration impossible : un de ses codes est maintenant utilisé par une autre galerie." : errMsg(e), 7000); return; }
    const ph = t.payload.photos || [];
    for (let i = 0; i < ph.length; i += 200) { const { error: e3 } = await sb.from("photos").insert(ph.slice(i, i + 200)); if (e3) throw e3; }
    if ((t.payload.selections || []).length) await sb.from("selections").insert(t.payload.selections);
    for (const rid of t.payload.reviews || []) await sb.from("reviews").update({ gallery_id: gal.id }).eq("id", rid);
    if (cover && ph.some((p) => p.id === cover)) await sb.from("galleries").update({ cover_photo_id: cover }).eq("id", gal.id);
  }
  await sb.from("trash").delete().eq("id", t.id);
  await Promise.all([loadTrash(), loadGalleries(), loadReviews(), loadSelections()]);
  draw(); toast("Restauré.");
}
function viewCorbeille() {
  if (TRASH === null) return '<button type="button" class="a-back" data-a="go" data-to="galeries">← Galeries</button><div class="a-top"><div><h1>Corbeille</h1></div></div><p class="a-meta">Exécutez le 6e fichier SQL dans Supabase pour activer la corbeille.</p>';
  return '<button type="button" class="a-back" data-a="go" data-to="galeries">← Galeries</button>' +
    '<div class="a-top"><div><h1>Corbeille</h1><p class="a-sub">Les galeries et photos supprimées restent ici 30 jours, puis disparaissent pour de bon.</p></div></div>' +
    (TRASH.length ? '<div class="a-tbl">' + TRASH.map((t) => '<div class="a-srow">' + icoTile(t.kind === "gallery" ? "photo" : "doc") + '<div class="a-nm"><b>' + esc(t.label) + "</b><span>" + (t.kind === "gallery" ? "Galerie, " + (t.files || []).length + " photos" : "Photo") + " · supprimée le " + fdate(t.deleted_at) + " · encore " + trashLeft(t) + " jour" + (trashLeft(t) > 1 ? "s" : "") + '</span></div><div class="a-acts"><button class="btn sm" type="button" data-a="trashrest" data-id="' + t.id + '">Restaurer</button><button class="btn ghost sm" type="button" data-a="trashdel" data-id="' + t.id + '">Supprimer définitivement</button></div></div>').join("") + "</div>"
      : '<div class="a-empty"><b>La corbeille est vide</b><span class="a-meta">Une galerie ou une photo supprimée arrive ici et peut être restaurée pendant 30 jours.</span></div>');
}

// --- Santé du site : un voyant par élément, et quoi faire s'il n'est pas vert
const HEALTH = [
  ["Base de données", async () => { const { error } = await sb.from("site_settings").select("id").limit(1); return error ? ["bad", "La base ne répond pas : " + errMsg(error) + ". Si le projet Supabase est en pause : supabase.com → Restore project."] : ["ok", "Elle répond normalement."]; }],
  ["Mises à jour de la base", async () => {
    const probe = async (t, c) => !(await sb.from(t).select(c).limit(1)).error;
    const steps = [["reviews", "id", 3, "…_lau_rie.sql"], ["photo_favs", "photo_id", 4, "…_envoi_favorites.sql"], ["bookings", "id", 6, "…_agenda_historique_corbeille.sql"], ["quotes", "id", 7, "…_miniatures_stockage_devis.sql"]];
    for (const [t, c, n, f] of steps) if (!(await probe(t, c))) return ["bad", "Il manque le fichier SQL n°" + n + " (" + f + ") : Supabase → SQL Editor, collez-le puis Run (guide, étape 3)."];
    return ["ok", "Tous les fichiers SQL sont passés."];
  }],
  ["Fonctions du site", async () => {
    try { const r = await callGalleryFn({ action: "health" }); return r && r.ok ? ["ok", "La galerie et le formulaire de contact répondent."] : ["warn", "La fonction « gallery » répond mais doit être mise à jour : redéployez-la (guide, étape 4)."]; }
    catch (e) { return /code/i.test(errMsg(e)) ? ["warn", "La fonction « gallery » est d'une ancienne version : redéployez-la (guide, étape 4)."] : ["bad", "La fonction « gallery » ne répond pas : " + errMsg(e) + ". Vérifiez l'étape 4 du guide et le secret ALLOWED_ORIGINS."]; }
  }],
  ["E-mails automatiques", async () => {
    try {
      const h = await adminCall({ action: "health" });
      if (!h.resend) return ["warn", "Pas encore branchés : vous ne recevez pas d'e-mail pour les sélections et les demandes (guide, étape 10)."];
      if (!h.from) return ["warn", "Les notifications marchent, mais les e-mails aux clients (rappels, envoi de galerie) attendent votre nom de domaine (guide, étape 10.2)."];
      return [h.cron ? "ok" : "warn", h.cron ? "Branchés : notifications, rappels et envoi des galeries." : "Branchés, mais la tâche des rappels quotidiens manque (secret CRON_SECRET, guide étape 10.2)."];
    } catch (e) { return /inconnue/i.test(errMsg(e)) ? ["warn", "La fonction « admin-users » est d'une ancienne version : redéployez-la (guide, étape 4)."] : ["warn", "Vérification impossible : " + errMsg(e)]; }
  }],
  ["Nom de domaine", async () => /github\.io$/.test(location.hostname) ? ["warn", "Le site est encore à son adresse provisoire (" + location.hostname + "). Branchez lau-rie.fr (guide, étape 11)."] : /^(localhost|127\.)/.test(location.hostname) ? ["warn", "Page ouverte en local."] : ["ok", "Le site répond sur " + location.hostname + "."]],
  ["Publication automatique", async () => {
    try {
      const r = await fetch("version.json", { cache: "no-store" });
      if (!r.ok) return ["warn", "Publication sans GitHub Actions : les pages séparées des séances ne sont pas créées (guide, étape 7)."];
      const v = await r.json(), h = Math.round((Date.now() - new Date(v.built_at)) / 36e5);
      return h > 72 ? ["warn", "Dernière publication il y a " + Math.round(h / 24) + " jours : la publication de nuit est arrêtée. GitHub → Actions → Publier le site → Enable workflow."] : ["ok", "Dernière publication il y a " + (h < 1 ? "moins d'une heure" : h + " h") + "."];
    } catch { return ["warn", "Impossible de lire la date de publication."]; }
  }],
  ["Espace de stockage", async () => {
    await loadStorage();
    if (STORE === null) return ["warn", "Exécutez le 7e fichier SQL (…_miniatures_stockage_devis.sql) pour suivre l'espace utilisé."];
    const p = storePct();
    return [p >= 95 ? "bad" : p >= 80 ? "warn" : "ok", mo(STORE.total) + " utilisés sur " + mo(quotaBytes()) + " (" + p + " %)" + (p >= 80 ? " : Compte et sécurité → Espace de stockage." : ".")];
  }],
  ["Miniatures des galeries", async () => {
    const { count, error } = await sb.from("photos").select("id", { count: "exact", head: true }).is("thumb_path", null);
    if (error) return ["warn", "Exécutez le 7e fichier SQL pour alléger les galeries."];
    return count ? ["warn", count + " photo" + (count > 1 ? "s" : "") + " sans miniature : ouvrez chaque galerie concernée → « Alléger la galerie »."] : ["ok", "Toutes les galeries chargent des miniatures légères."];
  }],
  ["Sauvegarde", async () => { const a = backupAge(); return a === null ? ["warn", "Jamais faite : Compte et sécurité → Sauvegarde → Télécharger."] : a > 31 ? ["warn", "Dernière sauvegarde " + agoTxt(a) + " : faites-en une nouvelle (Compte et sécurité → Sauvegarde)."] : ["ok", "Dernière sauvegarde " + agoTxt(a) + "."]; }],
  ["Espace pour les photos", async () => {
    const { count } = await sb.from("photos").select("id", { count: "exact", head: true });
    const n = (count || 0) + PORT.length, pct = Math.round((n / 2500) * 100);
    return [pct > 85 ? "bad" : pct > 65 ? "warn" : "ok", n + " aperçus en ligne, environ " + pct + " % de l'espace gratuit." + (pct > 65 ? " Supprimez les galeries fermées pour faire de la place." : "")];
  }],
  ["Pages légales", async () => { const miss = LEGAL_REQ.filter((x) => !(SITE.legal[x[0]] || "").trim()); return miss.length ? ["warn", "À compléter : " + miss.map((x) => x[1]).join(", ") + " (Mon entreprise)."] : ["ok", "Complètes."]; }],
  ["Liens Instagram et Google", async () => {
    const ig = SITE.ig && !/^https?:\/\/(www\.)?instagram\.com\/?$/i.test(SITE.ig);
    return ig && SITE.gWrite ? ["ok", "Instagram et avis Google sont reliés."] : ["warn", (!ig ? "Lien Instagram à compléter. " : "") + (!SITE.gWrite ? "Lien d'avis Google à coller (Textes et tarifs → Contact)." : "")];
  }],
];
function viewSante() {
  setTimeout(runHealth, 0);
  return '<button type="button" class="a-back" data-a="go" data-to="accueil">← À faire</button><div class="a-top"><div><h1>Santé du site</h1><p class="a-sub">Vert : tout va bien. Orange : à faire quand vous avez un moment. Rouge : à régler vite.</p></div><div class="a-acts"><button class="btn ghost sm" type="button" data-a="go" data-to="sante">Vérifier à nouveau</button></div></div>' +
    '<div class="a-tbl" id="sante">' + HEALTH.map(([t], i) => '<div class="a-srow a-health" id="h' + i + '"><span class="a-dot wait" aria-hidden="true"></span><div class="a-nm"><b>' + esc(t) + '</b><span>Vérification…</span></div></div>').join("") + "</div>";
}
async function runHealth() {
  await Promise.all(HEALTH.map(async ([t, fn], i) => {
    let r; try { r = await fn(); } catch (e) { r = ["warn", "Vérification impossible : " + errMsg(e)]; }
    const row = $("h" + i); if (!row) return;
    row.querySelector(".a-dot").className = "a-dot " + r[0];
    row.querySelector(".a-nm span").textContent = r[1];
    row.querySelector(".a-dot").setAttribute("aria-label", r[0] === "ok" ? "OK" : r[0] === "warn" ? "À faire" : "Problème");
  }));
}
async function callGalleryFn(body) {
  const { data, error } = await sb.functions.invoke("gallery", { body });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch { /* sans détail */ } throw new Error(m); }
  return data;
}

// --- Tri par glisser-déposer (souris, doigt, ou flèches du clavier sur la poignée)
let sortTimer = null;
function sortItems(box) { return [...box.querySelectorAll(":scope > [data-sortid]")]; }
$("a-main").addEventListener("pointerdown", (e) => {
  const h = e.target.closest(".drag"), box = h && h.closest("[data-sort]");
  if (!box) return;
  const item = h.closest("[data-sortid]");
  e.preventDefault(); h.setPointerCapture(e.pointerId); item.classList.add("dragging");
  const move = (ev) => {
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-sortid]");
    if (over && over !== item && over.parentNode === box) {
      const r = over.getBoundingClientRect(), row = r.width > box.clientWidth * 0.6;
      const after = row ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
      box.insertBefore(item, after ? over.nextSibling : over);
    }
    if (ev.clientY < 70) scrollBy(0, -14); else if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
  };
  const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); item.classList.remove("dragging"); sortDone(box); };
  h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
});
$("a-main").addEventListener("keydown", (e) => {
  const h = e.target.closest(".drag"), box = h && h.closest("[data-sort]");
  if (!box) return;
  const item = h.closest("[data-sortid]"), prev = item.previousElementSibling, next = item.nextElementSibling;
  if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && prev && prev.dataset.sortid) box.insertBefore(item, prev);
  else if ((e.key === "ArrowDown" || e.key === "ArrowRight") && next && next.dataset.sortid) box.insertBefore(next, item);
  else return;
  e.preventDefault(); h.focus(); clearTimeout(sortTimer); sortTimer = setTimeout(() => sortDone(box), 700);
});
async function sortDone(box) {
  const ids = sortItems(box).map((x) => x.dataset.sortid), kind = box.dataset.sort;
  try {
    if (kind === "photos") {
      const g = galById(openId), shown = new Set(ids), order = ids.concat(gPhotos.filter((p) => !shown.has(p.id)).map((p) => p.id));
      const { error } = await sb.rpc("reorder_photos", { p_gallery: g.id, p_ids: order });
      if (error) throw error;
      const byId = Object.fromEntries(gPhotos.map((p) => [p.id, p]));
      gPhotos = order.map((id, i) => ({ ...byId[id], position: i }));
      toast("Ordre des photos enregistré.");
    } else if (kind === "portfolio") {
      const { error } = await sb.rpc("reorder_portfolio", { p_ids: ids });
      if (error) throw error;
      const byId = Object.fromEntries(PORT.map((p) => [p.id, p]));
      PORT = ids.map((id, i) => ({ ...byId[id], position: i }));
      toast("Ordre du portfolio enregistré.");
    } else if (kind === "stories") {
      SITE.stories = ids.map((i) => SITE.stories[Number(i)]);
      if (await saveSite("Ordre des séances enregistré.")) draw();
    }
  } catch (err) {
    toast(/reorder_|function|schema/i.test(errMsg(err)) ? "Pour ranger par glisser-déposer, exécutez le 6e fichier SQL dans Supabase." : errMsg(err), 7000);
    draw();
  }
}
const dragBtn = (label) => '<button type="button" class="drag" aria-label="Déplacer ' + esc(label) + ' : glissez, ou utilisez les flèches du clavier"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></button>';

// --- Point important d'une photo (pour que le recadrage ne coupe pas l'essentiel)
let fxEdit = null;
const posOf = (x, y) => (x == null || y == null ? "50% 50%" : x + "% " + y + "%");
function openFocus(table, row, url) {
  fxEdit = { table, row, x: row.focus_x ?? 50, y: row.focus_y ?? 50 };
  ["fx-img", "fx-p1", "fx-p2", "fx-p3"].forEach((id) => { $(id).src = url; });
  $("fx-err").textContent = ""; drawFocus(); openSheet("s-focus");
}
function drawFocus() {
  $("fx-dot").style.left = fxEdit.x + "%"; $("fx-dot").style.top = fxEdit.y + "%";
  ["fx-p1", "fx-p2", "fx-p3"].forEach((id) => { $(id).style.objectPosition = posOf(fxEdit.x, fxEdit.y); });
}
$("fx-wrap").addEventListener("click", (e) => {
  const r = $("fx-img").getBoundingClientRect();
  fxEdit.x = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100);
  fxEdit.y = Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 100);
  drawFocus();
});
$("fx-reset").addEventListener("click", () => { fxEdit.x = 50; fxEdit.y = 50; drawFocus(); });
$("fx-save").addEventListener("click", async () => {
  const { error } = await sb.from(fxEdit.table).update({ focus_x: fxEdit.x, focus_y: fxEdit.y }).eq("id", fxEdit.row.id);
  if (error) { $("fx-err").textContent = /focus/i.test(error.message) ? "Exécutez d'abord le 6e fichier SQL dans Supabase." : error.message; return; }
  fxEdit.row.focus_x = fxEdit.x; fxEdit.row.focus_y = fxEdit.y;
  closeSheets(); toast("Point important enregistré.");
  if (fxEdit.table === "portfolio") img = makeImg(libraryOf(PORT));
});

// =================================================================== agenda des séances
// AG = null : la 6e migration n'est pas encore faite (l'onglet l'explique)
let AG = [], agMonth = null, bookEdit = null;
async function loadBookings() {
  const { data, error } = await sb.from("bookings").select("*").order("day").order("start_time");
  AG = error ? null : data || [];
}
const todayYmd = () => ymd(new Date().toISOString());
const dayLabel = (d, long) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", long ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { weekday: "short", day: "numeric", month: "short" });
function bookRow(b) {
  const g = b.gallery_id && galById(b.gallery_id);
  return '<div class="a-srow a-stack">' + icoTile("cal") +
    '<div class="a-nm"><b>' + esc(b.title) + '</b><span>' + esc(dayLabel(b.day, true) + (b.start_time ? " à " + b.start_time.replace(":", " h ") : "")) + "</span>" +
    '<span class="a-meta">' + esc([b.kind, b.place].filter(Boolean).join(" · ")) + "</span></div>" +
    '<div class="a-acts"><button class="btn ghost sm" type="button" data-a="bookedit" data-id="' + b.id + '">Modifier</button>' +
    (g ? '<button class="btn ghost sm" type="button" data-a="open" data-id="' + g.id + '">Voir la galerie</button>' : '<button class="btn sm" type="button" data-a="bookgal" data-id="' + b.id + '">Créer la galerie</button>') +
    '<button class="btn ghost sm" type="button" data-a="bookics" data-id="' + b.id + '">Ajouter à mon calendrier</button></div></div>';
}
function monthGrid() {
  const [y, m] = agMonth.split("-").map(Number), first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7, today = todayYmd(), cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="ag-c ag-empty"></div>');
  for (let d = 1; d <= days; d++) {
    const key = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"), L = AG.filter((b) => b.day === key);
    cells.push('<div class="ag-c' + (key === today ? " ag-today" : "") + (L.length ? " ag-busy" : "") + '"><span class="ag-d">' + d + "</span>" +
      L.map((b) => '<button type="button" class="ag-ev" data-a="bookedit" data-id="' + b.id + '">' + esc((b.start_time ? b.start_time + " " : "") + b.title) + "</button>").join("") +
      (L.length ? "" : '<button type="button" class="ag-add" data-a="booknew" data-day="' + key + '" aria-label="Ajouter une séance le ' + d + '">+</button>') + "</div>");
  }
  const title = first.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return '<div class="ag-head"><button class="btn ghost sm" type="button" data-a="agprev" aria-label="Mois précédent">‹</button><h2 class="serif">' + esc(title.charAt(0).toUpperCase() + title.slice(1)) + '</h2><button class="btn ghost sm" type="button" data-a="agnext" aria-label="Mois suivant">›</button></div>' +
    '<div class="ag-grid"><span>lun.</span><span>mar.</span><span>mer.</span><span>jeu.</span><span>ven.</span><span>sam.</span><span>dim.</span>' + cells.join("") + "</div>";
}
function viewAgenda() {
  if (AG === null) return '<div class="a-top"><div><h1>Agenda</h1><p class="a-sub">Vos séances à venir.</p></div></div><div class="a-empty"><b>Encore une petite étape</b><span class="a-meta">Pour activer l\'agenda, exécutez le 6e fichier SQL (…_agenda_historique_corbeille.sql) dans Supabase, comme à l\'étape 3 du guide, puis rechargez cette page.</span></div>';
  agMonth = agMonth || todayYmd().slice(0, 7);
  const t = todayYmd(), next = AG.filter((b) => b.day >= t), past = AG.filter((b) => b.day < t).reverse();
  return '<div class="a-top"><div><h1>Agenda</h1><p class="a-sub">' + (next.length ? next.length + " séance" + (next.length > 1 ? "s" : "") + " à venir." : "Aucune séance à venir.") + '</p></div><div class="a-acts">' +
    (AG.length ? '<button class="btn ghost sm" type="button" data-a="bookicsall">Tout ajouter à mon calendrier</button>' : "") + '<button class="btn sm" type="button" data-a="booknew">Nouvelle séance</button></div></div>' +
    '<section class="ag">' + monthGrid() + "</section>" +
    '<h2 class="a-h2 serif">À venir</h2>' + (next.length ? '<div class="a-tbl">' + next.map(bookRow).join("") + "</div>" : '<p class="a-meta">Ajoutez une séance avec « Nouvelle séance », ou depuis une demande de contact.</p>') +
    (past.length ? '<details class="ag-past"><summary>Séances passées (' + past.length + ")</summary><div class=\"a-tbl\">" + past.slice(0, 50).map(bookRow).join("") + "</div></details>" : "");
}
function openBook(b, preset) {
  bookEdit = b ? b.id : null;
  const v = b || preset || {};
  $("h-book").textContent = b ? "Modifier la séance" : "Nouvelle séance";
  $("bk-day").value = v.day || ""; $("bk-time").value = v.start_time || ""; $("bk-title").value = v.title || "";
  $("bk-kind").value = v.kind || "Mariage"; $("bk-place").value = v.place || ""; $("bk-mail").value = v.client_email || ""; $("bk-notes").value = v.notes || "";
  $("bk-err").textContent = ""; $("bk-del").hidden = !b;
  bookPreset = preset && preset.request_id ? preset.request_id : null;
  openSheet("s-book");
}
let bookPreset = null;
$("book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const row = { day: $("bk-day").value, start_time: $("bk-time").value || null, title: $("bk-title").value.trim(), kind: $("bk-kind").value,
    place: $("bk-place").value.trim() || null, client_email: $("bk-mail").value.trim() || null, notes: $("bk-notes").value.trim() || null };
  if (!row.day) { $("bk-err").textContent = "Choisissez la date."; return; }
  if (!row.title) { $("bk-err").textContent = "Indiquez le nom des clients."; return; }
  if (row.client_email && !EMAIL.test(row.client_email)) { $("bk-err").textContent = "L'e-mail n'est pas complet."; return; }
  if (!bookEdit && bookPreset) row.request_id = bookPreset;
  const q = bookEdit ? sb.from("bookings").update(row).eq("id", bookEdit) : sb.from("bookings").insert(row);
  const { error } = await q;
  if (error) { $("bk-err").textContent = errMsg(error); return; }
  if (!bookEdit && bookPreset) { const r = REQS.find((x) => x.id === bookPreset); if (r && r.status !== "booked") { await sb.from("booking_requests").update({ status: "booked" }).eq("id", r.id); r.status = "booked"; } }
  closeSheets(); await loadBookings(); agMonth = row.day.slice(0, 7); await go("agenda"); toast("Séance enregistrée.");
});
$("bk-del").addEventListener("click", async () => {
  if (!bookEdit || !confirm("Supprimer cette séance de l'agenda ? La galerie éventuelle n'est pas touchée.")) return;
  const { error } = await sb.from("bookings").delete().eq("id", bookEdit);
  if (error) { $("bk-err").textContent = errMsg(error); return; }
  closeSheets(); await loadBookings(); draw(); toast("Séance retirée de l'agenda.");
});
// Fichier .ics : s'ouvre dans le calendrier du téléphone ou de l'ordinateur
function icsOf(list) {
  const z = (s) => String(s || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\r\n|[\r\n\u2028\u2029]/g, "\\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev = list.map((b) => {
    const d = b.day.replace(/-/g, "");
    let when;
    if (b.start_time) { const [h, mi] = b.start_time.split(":").map(Number), end = new Date(2000, 0, 1, h + 2, mi); when = "DTSTART;TZID=Europe/Paris:" + d + "T" + b.start_time.replace(":", "") + "00\r\nDTEND;TZID=Europe/Paris:" + d + "T" + String(end.getHours()).padStart(2, "0") + String(end.getMinutes()).padStart(2, "0") + "00"; }
    else { const n = new Date(b.day + "T12:00:00"); n.setDate(n.getDate() + 1); when = "DTSTART;VALUE=DATE:" + d + "\r\nDTEND;VALUE=DATE:" + ymd(n.toISOString()).replace(/-/g, ""); }
    return "BEGIN:VEVENT\r\nUID:" + b.id + "@lau-rie\r\nDTSTAMP:" + stamp + "\r\n" + when + "\r\nSUMMARY:" + z("Séance " + String(b.kind || "").toLowerCase() + " · " + b.title) + (b.place ? "\r\nLOCATION:" + z(b.place) : "") + (b.notes ? "\r\nDESCRIPTION:" + z(b.notes) : "") + "\r\nEND:VEVENT";
  });
  return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//lau.rie//agenda//FR\r\nCALSCALE:GREGORIAN\r\n" + ev.join("\r\n") + "\r\nEND:VCALENDAR\r\n";
}
function downloadIcs(list, name) { saveBlob(new Blob([icsOf(list)], { type: "text/calendar" }), name); }
async function galleryFromBooking(b) {
  const row = {
    title: b.title, client_name: b.title, kind: b.kind || "Mariage", event_date: b.day, status: "draft", client_email: b.client_email || null,
    owner_code: newCode(b.title), guest_code: newGuestCode(b.title), allow_download: true, allow_selection: true,
    expires_at: new Date(addDays(b.day, 365) + "T23:59:00").toISOString(),
  };
  const { data, error } = await sb.from("galleries").insert(row).select("id").single();
  if (error) throw error;
  await sb.from("bookings").update({ gallery_id: data.id }).eq("id", b.id);
  await loadGalleries(); await loadBookings(); await go("galeries", data.id); toast("Galerie créée pour " + b.title + ".");
}

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
  if (dupFrom) {
    const src = dupFrom, days = src.expires_at && src.created_at ? Math.max(30, Math.round((new Date(src.expires_at) - new Date(src.created_at)) / 864e5)) : 365;
    Object.assign(row, { allow_download: src.allow_download, allow_selection: src.allow_selection, selection_limit: src.selection_limit, notify: src.notify, remind: src.remind, remind_days: src.remind_days, guest_hd: src.guest_hd,
      expires_at: new Date(addDays(date || ymd(new Date().toISOString()), days) + "T23:59:00").toISOString() });
  }
  const { data, error } = await sb.from("galleries").insert(row).select("id").single();
  if (error) { $("n-err").textContent = error.message; return; }
  dupFrom = null;
  closeSheets();
  await loadGalleries();
  await go("galeries", data.id);
});

boot().catch((e) => showLogin("Connexion impossible : " + errMsg(e)));
