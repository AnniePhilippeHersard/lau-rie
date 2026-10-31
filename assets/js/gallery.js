// Galerie client : accès par code, deux rôles (clients « owner », invités « guest »),
// favorites, notes pour la retouche, photos masquées aux invités, sélection, avis, partage, téléchargements.
import {
  $, esc, store, session, toast, copy, fdate, daysTo, makeImg, mergeSite, slotRef, qrSvg,
  initSheets, openSheet, closeSheets, initTypo, saveBlob, reduce,
} from "./core.js";
import { DEMO, callGallery, loadPublic, libraryOf, loadScript, galleryLink, siteBase } from "./api.js";

// Jamais affichée à l'intérieur d'une autre page (clickjacking)
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location = window.location.href; } catch { /* page tierce : on reste masqué */ }
  throw new Error("Affichage dans un cadre refusé");
}
document.documentElement.classList.add("js");
initTypo();
initSheets();

let SITE = mergeSite(null), img = makeImg({});
const publicReady = DEMO ? Promise.resolve() : loadPublic().then(({ content, portfolio }) => {
  SITE = mergeSite(content);
  img = makeImg(libraryOf(portfolio));
}).catch(() => {});
function fillSlots() {
  document.querySelectorAll("img[data-slot]").forEach((el) => {
    const d = img(slotRef(SITE, el.dataset.slot));
    if (d) { el.src = d.src; el.width = d.w; el.height = d.h; }
  });
}
publicReady.then(() => {
  fillSlots();
  // Pied de page : Instagram et e-mail de la photographe
  document.querySelectorAll(".foot [data-ig]").forEach((a) => { a.href = SITE.ig; });
  document.querySelectorAll(".foot [data-mail-only]").forEach((a) => { a.href = "mailto:" + SITE.mail; });
});
document.querySelectorAll("[data-top]").forEach((b) => b.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })));

// ------------------------------------------------------------------ état
let CODE = "", ROLE = "owner", G = null, P = [], LOCAL = null;
let col = "tout", onlyFav = false, favs = {}, NOTES = {};
const isOwner = () => ROLE === "owner";
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const favKey = () => "lr-favs-" + ROLE + "-" + hash(CODE);
const noteKey = () => "lr-notes-" + hash(CODE);
const canSee = (i) => isOwner() || !P[i].hidden;
const limitOf = () => (isOwner() ? Number(G.selection_limit) || 0 : 0);
function favCount() { let n = 0; for (let i = 0; i < P.length; i++) if (favs[P[i].id] && canSee(i)) n++; return n; }

// ------------------------------------------------------------------ « serveur » local : galerie d'exemple et mode démonstration
function localGallery(role) {
  const refs = [...new Set(SITE.stories.filter((s) => s.show !== false).flatMap((s) => s.photos))];
  const photos = refs.map((r, i) => {
    const d = img(r);
    return d ? { id: "ex-" + i, filename: "photo-" + String(i + 1).padStart(3, "0") + ".jpg", width: d.w, height: d.h, collection: null, hidden: false, preview: d.src, download: d.src } : null;
  }).filter(Boolean);
  return {
    role,
    gallery: {
      title: "Galerie d'exemple", kind: "Mariage", event_date: null, allow_download: true, allow_selection: role === "owner",
      selection_limit: role === "owner" ? 10 : null, expires_at: null, cover: photos[0] ? photos[0].preview : null,
      delivery_url: null, delivery_expires_at: null, guest_code: role === "owner" ? "EXEMPLE-INVITES" : null,
    },
    photos, last_selection: null, review: null,
  };
}
async function api(payload) {
  if (!LOCAL) return callGallery({ ...payload, code: CODE });
  if (payload.action === "select") return { ok: true, count: payload.photo_ids.length };
  return { ok: true };
}

// ------------------------------------------------------------------ accès
function showAccess(msg) {
  $("v-access").hidden = false;
  $("v-gallery").hidden = true;
  $("favbar").classList.remove("show");
  $("code-err").textContent = msg || "";
  document.title = "Votre galerie · lau.rie";
  if (msg) $("code").focus();
}
async function openWith(code, quiet) {
  const c = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!c) { showAccess("Entrez le code reçu avec votre lien."); return; }
  $("code-go").disabled = true;
  $("code-err").textContent = "";
  try {
    let data;
    if (DEMO) {
      // Sans Supabase : codes d'exemple uniquement
      if (c !== "LT-2026" && c !== "LT-INVITES") throw new Error("Mode démonstration : essayez le code LT-2026 (clients) ou LT-INVITES (invités).");
      await publicReady;
      data = localGallery(c === "LT-2026" ? "owner" : "guest");
      LOCAL = true;
    } else {
      data = await callGallery({ action: "open", code: c });
      LOCAL = false;
    }
    CODE = c;
    session.set("lr-gcode", c);
    load(data);
  } catch (e) {
    session.del("lr-gcode");
    if (quiet) showAccess(); else showAccess(e.message);
  } finally {
    $("code-go").disabled = false;
  }
}
async function openExample() {
  await publicReady;
  CODE = "EXEMPLE"; LOCAL = true;
  load(localGallery("owner"));
}
$("access-form").addEventListener("submit", (e) => { e.preventDefault(); openWith($("code").value); });

// ------------------------------------------------------------------ chargement d'une galerie
function load(data) {
  ROLE = data.role; G = data.gallery;
  P = data.photos.map((p) => ({ ...p, n: String(p.filename || "photo").replace(/\.[^.]+$/, "") }));
  favs = store.get(favKey(), null);
  NOTES = isOwner() ? store.get(noteKey(), null) : {};
  // Première visite sur cet appareil : on reprend la dernière sélection envoyée
  const last = data.last_selection;
  if (!favs) { favs = {}; if (last && isOwner()) last.photo_ids.forEach((id) => { favs[id] = true; }); }
  if (!NOTES) NOTES = (last && last.notes) || {};
  G.review = data.review;
  col = "tout"; onlyFav = false;

  $("v-access").hidden = true;
  $("v-gallery").hidden = false;
  document.title = G.title + " · lau.rie";
  $("h-gal").textContent = G.title;
  $("g-who").textContent = G.title;
  $("g-date").textContent = [G.kind, G.event_date ? fdate(G.event_date, { day: "numeric", month: "long", year: "numeric" }) : ""].filter(Boolean).join(", ");
  const cover = $("g-cover-img");
  if (G.cover) cover.src = G.cover; else cover.removeAttribute("src");
  const lim = limitOf();
  $("g-limit").hidden = !lim && !G.expires_at;
  $("g-limit").textContent = (lim ? "Choisissez jusqu'à " + lim + " photos préférées : touchez leur cœur. " : "") +
    (G.expires_at ? "Galerie en ligne jusqu'au " + fdate(G.expires_at, { day: "numeric", month: "long", year: "numeric" }) + "." : "");
  const cols = [...new Set(P.map((p) => p.collection).filter(Boolean))];
  $("cols").hidden = cols.length < 2;
  $("cols").innerHTML = cols.length < 2 ? "" : ["tout", ...cols].map((k) => '<button type="button" data-col="' + esc(k) + '" aria-pressed="' + (k === col) + '">' + (k === "tout" ? "Tout" : esc(k)) + "</button>").join("");
  $("b-rev").hidden = !isOwner();
  $("b-dl").hidden = !G.allow_download && !G.delivery_url;
  render();
  if (location.hash !== "#photos") window.scrollTo(0, 0);
  syncFavsSoon(3000); // favorites déjà sur cet appareil (ou reprises de la sélection)
}

// ------------------------------------------------------------------ grille
const HEART = '<svg viewBox="0 0 24 24" fill="FILL" stroke="currentColor" stroke-width="1.5"><path d="M12 20s-7-4.4-8.6-8.8C2.3 8 4.2 5 7.4 5c1.9 0 3.3 1 4.6 2.8C13.3 6 14.7 5 16.6 5c3.2 0 5.1 3 4 6.2C19 15.6 12 20 12 20z"/></svg>';
const DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2.1-2.6 3.4M6.6 7.6C4.6 8.9 3.2 10.8 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 004.2 4.2"/></svg>';
const NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z"/></svg>';
function toggleFav(i) {
  const id = P[i].id;
  if (!favs[id]) {
    const lim = limitOf();
    if (lim && favCount() >= lim) { toast("Vous avez choisi vos " + lim + " favorites. Retirez-en une pour en ajouter une autre."); return false; }
  }
  favs[id] = !favs[id];
  if (!favs[id]) delete favs[id];
  store.set(favKey(), favs);
  syncFavsSoon();
  return true;
}

// Cœurs comptés anonymement pour la photographe (« photos les plus aimées ») :
// un identifiant aléatoire par appareil, jamais de nom ni d'e-mail.
function visitorId() {
  let v = store.get("lr-visitor", null);
  if (typeof v !== "string" || !/^[a-z0-9-]{16,64}$/.test(v)) {
    v = (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("")).toLowerCase();
    store.set("lr-visitor", v);
  }
  return v;
}
let favTimer = null;
function syncFavsSoon(delay = 1500) {
  if (LOCAL) return;
  clearTimeout(favTimer);
  favTimer = setTimeout(syncFavs, delay);
}
async function syncFavs() {
  favTimer = null;
  const ids = P.filter((p) => favs[p.id]).map((p) => p.id);
  const sig = ids.slice().sort().join(","), key = favKey() + "-sent";
  if (store.get(key, null) === sig) return; // rien de nouveau
  try {
    await callGallery({ action: "fav", code: CODE, visitor: visitorId(), photo_ids: ids });
    store.set(key, sig);
  } catch { /* sans importance pour le visiteur : on réessaiera au prochain cœur */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && favTimer) syncFavs(); });
function heartBtn(i, f) {
  return '<button class="round" type="button" data-act="fav" data-i="' + i + '" aria-pressed="' + f + '" aria-label="' + (f ? "Retirer des" : "Ajouter aux") + " favorites, photo " + esc(P[i].n) + '">' + HEART.replace("FILL", f ? "currentColor" : "none") + "</button>";
}
function setHeart(a, f, i) {
  a.setAttribute("aria-pressed", String(f));
  a.setAttribute("aria-label", (f ? "Retirer des" : "Ajouter aux") + " favorites, photo " + P[i].n);
  a.innerHTML = HEART.replace("FILL", f ? "currentColor" : "none");
  a.classList.remove("pop"); void a.offsetWidth; a.classList.add("pop");
}
function list() { return P.map((p, i) => i).filter((i) => canSee(i) && (col === "tout" || P[i].collection === col) && (!onlyFav || favs[P[i].id])); }
const grid = $("grid");
function render() {
  const L = list();
  grid.innerHTML = L.map((i) => {
    const p = P[i], f = !!favs[p.id], w = p.width || 3, h = p.height || 2;
    const flags = (isOwner() && p.hidden ? '<span class="flag">' + EYE + "Masquée aux invités</span>" : "") + (isOwner() && NOTES[p.id] ? '<span class="flag">' + NOTE + "Note</span>" : "");
    return '<figure class="tile' + (f ? " fav" : "") + (isOwner() && p.hidden ? " hid" : "") + '" data-i="' + i + '">' + (flags ? '<span class="flags">' + flags + "</span>" : "") +
      '<button class="open" type="button" aria-label="Agrandir la photo ' + esc(p.n) + '"><div class="ph" style="aspect-ratio:' + w + " / " + h + '"><img alt="' + esc(p.n) + '" src="' + esc(p.preview) + '" width="' + w + '" height="' + h + '" loading="lazy" decoding="async"></div></button>' +
      '<div class="acts">' + heartBtn(i, f) + (G.allow_download ? '<button class="round" type="button" data-act="dl" aria-label="Télécharger ' + esc(p.n) + '">' + DL + "</button>" : "") + "</div></figure>";
  }).join("");
  $("empty").hidden = L.length > 0;
  sync();
}
function sync() {
  const n = favCount(), lim = limitOf();
  $("fav-n").textContent = n;
  $("b-favs").setAttribute("aria-pressed", String(onlyFav));
  $("favbar").classList.toggle("show", n > 0 && !$("v-gallery").hidden);
  $("favbar-t").textContent = lim ? n + " / " + lim + " favorites" : n + " favorite" + (n > 1 ? "s" : "");
  $("send").textContent = isOwner() && G.allow_selection ? "Envoyer ma sélection" : "Télécharger";
  const seen = P.filter((x, i) => canSee(i)).length;
  $("g-count").innerHTML = seen + ' photos<span class="g-role">' + (LOCAL && CODE === "EXEMPLE" ? "Galerie d'exemple" : isOwner() ? "Votre accès" : "Accès invité") + "</span>";
}
grid.addEventListener("click", (e) => {
  const t = e.target.closest(".tile");
  if (!t) return;
  const i = Number(t.dataset.i), a = e.target.closest("[data-act]");
  if (!a) { if (e.target.closest(".open")) openLb(i); return; }
  if (a.dataset.act === "fav") {
    if (!toggleFav(i)) return;
    const f = !!favs[P[i].id];
    t.classList.toggle("fav", f); setHeart(a, f, i);
    if (onlyFav && !f) render(); else sync();
  } else downloadOne(i);
});
$("cols").addEventListener("click", (e) => {
  const b = e.target.closest("[data-col]");
  if (!b) return;
  col = b.dataset.col; onlyFav = false;
  [...$("cols").children].forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  render();
});
$("b-favs").onclick = () => { onlyFav = !onlyFav; render(); };
$("empty-back").onclick = () => { onlyFav = false; render(); };

// ------------------------------------------------------------------ téléchargements
function downloadOne(i) {
  const p = P[i];
  if (!G.allow_download || !p.download) { toast("Le téléchargement n'est pas activé pour cette galerie."); return; }
  const a = document.createElement("a");
  a.href = p.download; a.download = p.filename || "photo.jpg"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
const hdOk = () => !!G.delivery_url && (!G.delivery_expires_at || daysTo(G.delivery_expires_at) >= 0);
function prepDl() {
  const hd = $("dl-form").querySelector("input[value=hd]"), web = $("dl-form").querySelector("input[value=web]");
  const ok = hdOk();
  hd.disabled = !ok; hd.closest(".opt").style.opacity = ok ? "" : "0.55";
  hd.closest(".opt").querySelector("small").textContent = ok ? "Toutes les photos retouchées, par le lien de votre photographe" : G.delivery_url ? "Lien expiré : demandez-en un nouveau à votre photographe" : "Pas encore disponible";
  web.disabled = !G.allow_download; web.closest(".opt").style.opacity = G.allow_download ? "" : "0.55";
  (ok ? hd : web).checked = true;
  syncDl();
  $("dl-all-n").textContent = P.filter((x, i) => canSee(i)).length + " photos";
  const n = favCount();
  $("dl-fav-n").textContent = n ? n + " photo" + (n > 1 ? "s" : "") : "Aucune pour l'instant";
  $("dl-note").textContent = "";
}
// En HD, le lien du photographe contient toutes les photos : le choix « lesquelles » n'a pas de sens
function syncDl() {
  const isHd = $("dl-form").q.value === "hd";
  $("dl-form").querySelector("fieldset").hidden = isHd;
  $("dl-form").querySelector("button[type=submit]").textContent = isHd ? "Ouvrir le lien HD" : "Télécharger";
}
$("dl-form").addEventListener("change", syncDl);
$("b-dl").onclick = () => { prepDl(); openSheet("s-dl"); };
$("dl-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget, what = f.what.value, q = f.q.value, note = $("dl-note");
  if (q === "hd") {
    if (!hdOk()) return;
    window.open(G.delivery_url, "_blank", "noopener");
    note.textContent = "Le lien de téléchargement HD s'ouvre dans un nouvel onglet. Enregistrez vos photos à deux endroits.";
    return;
  }
  const idx = P.map((p, i) => i).filter((i) => canSee(i) && (what === "all" || favs[P[i].id]));
  if (!idx.length) { note.textContent = "Vous n'avez pas encore de favorites. Choisissez « Toute la galerie » ou ajoutez des cœurs."; return; }
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    if (!window.JSZip) await loadScript(new URL("../vendor/jszip.min.js", import.meta.url).href);
    const zip = new window.JSZip();
    const used = {};
    for (let k = 0; k < idx.length; k++) {
      const p = P[idx[k]];
      note.textContent = "Préparation : " + (k + 1) + " / " + idx.length + " photos…";
      const blob = await (await fetch(p.download || p.preview)).blob();
      let name = (p.filename || "photo-" + (k + 1) + ".jpg").replace(/\.[^.]+$/, "") + "." + (blob.type.includes("webp") ? "webp" : "jpg");
      if (used[name]) name = name.replace(/(\.[^.]+)$/, "-" + k + "$1");
      used[name] = 1;
      zip.file(name, blob);
    }
    note.textContent = "Création de l'archive…";
    const out = await zip.generateAsync({ type: "blob" });
    saveBlob(out, (G.title || "galerie").replace(/[^\wÀ-ÿ-]+/g, "-") + (what === "fav" ? "-favorites" : "") + ".zip");
    note.textContent = "Archive téléchargée : " + idx.length + " photos en qualité web.";
  } catch (err) {
    note.textContent = "Le téléchargement a échoué. Réessayez, ou téléchargez les photos une par une.";
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------------ partage
$("b-share").onclick = async () => {
  if (!window.qrcode) { try { await loadScript(new URL("../vendor/qrcode.js", import.meta.url).href); } catch { /* sans QR */ } }
  const code = isOwner() ? G.guest_code : CODE;
  const link = LOCAL ? siteBase() + "/galerie.html#exemple" : galleryLink();
  $("share-link").value = link.replace(/^https?:\/\//, "");
  $("share-code").value = code || "";
  $("share-code").closest(".field").hidden = !code;
  $("share-txt").textContent = isOwner()
    ? (code ? "Vos invités voient toutes les photos, sauf celles que vous masquez. Leurs favorites restent séparées des vôtres." : "Pour partager avec vos proches, demandez à votre photographe un code pour vos invités.")
    : "Partagez la galerie avec d'autres proches : même lien, même code.";
  $("share-qr").innerHTML = !window.qrcode ? "" : code && !LOCAL ? qrSvg(galleryLink(code), "QR code de la galerie") : LOCAL ? qrSvg(link, "QR code de la galerie d'exemple") : "";
  $("share-qr").closest(".qr-share").hidden = !$("share-qr").innerHTML;
  $("share-note").textContent = "";
  openSheet("s-share");
};
$("copy-link").onclick = () => copy("https://" + $("share-link").value, $("share-note"), "Lien copié. Pensez à transmettre le code.");

// ------------------------------------------------------------------ envoi de la sélection
$("send").onclick = async () => {
  if (!isOwner() || !G.allow_selection) { prepDl(); openSheet("s-dl"); $("dl-form").querySelector("input[value=fav]").checked = true; return; }
  const ids = P.filter((p, i) => favs[p.id] && canSee(i)).map((p) => p.id);
  const notes = {};
  ids.forEach((id) => { if (NOTES[id]) notes[id] = NOTES[id]; });
  const btn = $("send");
  btn.disabled = true;
  try {
    await api({ action: "select", photo_ids: ids, notes });
    const n = ids.length, nn = Object.keys(notes).length;
    $("send-txt").textContent = LOCAL && CODE === "EXEMPLE"
      ? "C'est une galerie d'exemple : rien n'est envoyé. Dans votre vraie galerie, vos " + n + " favorites partent chez lau.rie en un geste."
      : "Vos " + n + " favorite" + (n > 1 ? "s" : "") + (nn ? " (dont " + nn + " avec une note)" : "") + " sont arrivées chez lau.rie. Vous pouvez encore modifier votre choix tant que la retouche n'a pas commencé.";
    openSheet("s-send");
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    btn.disabled = false;
  }
};

// ------------------------------------------------------------------ avis des clients, relu par la photographe avant publication
function fbCount() { $("fb-count").textContent = $("fb-text").value.length + " / 400"; }
function openFb() {
  const r = G.review;
  $("h-fb").textContent = r ? "Modifier votre avis" : "Votre avis";
  $("fb-text").value = r ? r.body : "";
  $("fb-who").value = r ? r.who : (G.client_name || "");
  $("fb-err").textContent = "";
  $("fb-form").querySelector('input[name=fbpub][value="' + (r && r.is_private ? "priv" : "pub") + '"]').checked = true;
  fbCount(); openSheet("s-fb");
}
$("fb-text").addEventListener("input", fbCount);
$("b-rev").onclick = openFb;
$("send-rev").onclick = () => { closeSheets(); openFb(); };
$("send-rev").hidden = false;
$("fb-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("fb-text").value.trim().replace(/^[«"\s]+|[»"\s]+$/g, ""), who = $("fb-who").value.trim();
  const priv = e.currentTarget.querySelector("input[name=fbpub]:checked").value === "priv";
  if (text.length < 10) { $("fb-err").textContent = "Écrivez quelques mots, au moins une phrase."; $("fb-text").focus(); return; }
  if (!who) { $("fb-err").textContent = "Indiquez vos prénoms."; $("fb-who").focus(); return; }
  try {
    await api({ action: "review", who, text, private: priv });
    G.review = { who, body: text, is_private: priv, status: "pending" };
    closeSheets();
    toast(LOCAL && CODE === "EXEMPLE" ? "Galerie d'exemple : rien n'est envoyé." : priv ? "Merci ! Votre message est bien arrivé chez Laurie." : "Merci ! Laurie relit votre avis avant de le publier.");
  } catch (err) {
    $("fb-err").textContent = err.message;
  }
});

// ------------------------------------------------------------------ visionneuse
const lb = $("lb");
let li = 0, LL = [];
function drawLb() {
  const p = P[LL[li]], f = !!favs[p.id];
  $("lb-img").src = p.preview; $("lb-img").alt = "Photo " + p.n;
  $("lb-n").textContent = (li + 1) + " / " + LL.length;
  $("lb-cap").textContent = p.n + (p.collection ? ", " + p.collection.toLowerCase() : "");
  $("lb-fav").setAttribute("aria-pressed", String(f));
  const note = isOwner() && NOTES[p.id];
  $("lb-note").textContent = note ? "Note : " + NOTES[p.id] : "";
  $("lb-note").className = "count" + (note ? " lb-notetext" : "");
  $("lb-noteb").hidden = $("lb-hide").hidden = !isOwner() || !G.allow_selection && !LOCAL;
  $("lb-hide").hidden = !isOwner();
  $("lb-dl").hidden = !G.allow_download;
  $("lb-hide").setAttribute("aria-pressed", String(!!p.hidden));
  $("lb-hide").querySelector(".lbl").textContent = p.hidden ? "Masquée" : "Masquer";
  $("lb-noteb").classList.toggle("on", !!NOTES[p.id]);
}
let lbFocus = null;
function openLb(i) { LL = list(); li = Math.max(0, LL.indexOf(i)); lbFocus = document.activeElement; lb.hidden = false; document.documentElement.style.overflow = "hidden"; drawLb(); $("lb-x").focus(); }
function closeLb() { lb.hidden = true; document.documentElement.style.overflow = ""; const y = window.scrollY; render(); window.scrollTo(0, y); if (lbFocus && document.body.contains(lbFocus)) lbFocus.focus(); }
$("lb-x").onclick = closeLb;
$("lb-prev").onclick = () => { li = (li + LL.length - 1) % LL.length; drawLb(); };
$("lb-next").onclick = () => { li = (li + 1) % LL.length; drawLb(); };
$("lb-fav").onclick = () => { if (toggleFav(LL[li])) { drawLb(); sync(); } };
$("lb-hide").onclick = async () => {
  const p = P[LL[li]], next = !p.hidden;
  try {
    await api({ action: "hide", photo_id: p.id, hidden: next });
    p.hidden = next;
    drawLb();
    toast(next ? "Photo masquée : vos invités ne la verront pas." : "Photo de nouveau visible pour vos invités.");
  } catch (e) { toast(e.message, 5000); }
};
let noteFor = null;
$("lb-noteb").onclick = () => {
  noteFor = P[LL[li]].id;
  $("note-for").textContent = "Photo " + P[LL[li]].n;
  $("nt-text").value = NOTES[noteFor] || "";
  $("nt-del").hidden = !NOTES[noteFor];
  openSheet("s-note");
  $("nt-text").focus();
};
function saveNotes() { store.set(noteKey(), NOTES); }
$("note-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("nt-text").value.trim();
  if (v) NOTES[noteFor] = v.slice(0, 200); else delete NOTES[noteFor];
  saveNotes(); closeSheets(); drawLb();
  toast(v ? "Note enregistrée. Elle partira avec votre sélection." : "Note supprimée.");
});
$("nt-del").onclick = () => { delete NOTES[noteFor]; saveNotes(); closeSheets(); drawLb(); toast("Note supprimée."); };
$("lb-dl").onclick = () => downloadOne(LL[li]);
lb.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLb();
  if (e.key === "ArrowLeft") $("lb-prev").click();
  if (e.key === "ArrowRight") $("lb-next").click();
});
let x0 = null;
lb.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
lb.addEventListener("pointerup", (e) => { if (x0 !== null && Math.abs(e.clientX - x0) > 60 && !e.target.closest("button")) $(e.clientX < x0 ? "lb-next" : "lb-prev").click(); x0 = null; });

// ------------------------------------------------------------------ navigation
function route() {
  const h = location.hash.replace("#", "");
  if (h.startsWith("k=")) {
    const code = decodeURIComponent(h.slice(2));
    history.replaceState(null, "", location.pathname + location.search); // le code ne reste pas dans la barre d'adresse
    openWith(code);
    return;
  }
  if (h === "exemple") { openExample(); return; }
  if (h === "acces") { session.del("lr-gcode"); G = null; showAccess(); return; }
  if (G) return; // #photos, #galerie : la galerie est déjà ouverte
  const saved = session.get("lr-gcode");
  if (saved) openWith(saved, true); else showAccess();
}
window.addEventListener("hashchange", route);
route();
if (reduce) document.documentElement.classList.add("reduce");
