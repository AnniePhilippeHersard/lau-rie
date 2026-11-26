// Site public : accueil, pages des séances (#seance-…), pages légales, contact.
import {
  $, esc, euro, srcAttrs, reduce, store, toast, makeImg, mergeSite, slotRef, usesDemoPhotos, REVIEWS_DEMO,
  makeLegal, setMeta, initTypo, EMAIL, DEMO_DIMS,
} from "./core.js";
import { DEMO, loadPublic, libraryOf, callGallery } from "./api.js";
import { storyHtml, storyFile, findStory, storyTitle, storyDesc, businessLd } from "./story.js";

// Page d'une séance créée pour Google (seance-….html) : la page n'affiche que cette séance
const PAGE = document.body.dataset.seance || "";
const HOME = PAGE ? "index.html" : "";

document.documentElement.classList.add("js");
let SITE = mergeSite(null);
let img = makeImg({});
let REVIEWS = DEMO ? REVIEWS_DEMO : [];
let legal = makeLegal(SITE);

// ------------------------------------------------------------------ en-tête flottant, profondeur des tirages
document.querySelector(".top").id = "top";
const topEl = document.querySelector("#v-home > .top");
let lastY = window.scrollY, ticking = false, mx = 0, my = 0;
const prints = [[".pA", 0.08], [".pB", 0.16], [".pC", 0.26]].map(([s, k]) => [document.querySelector(s), k]);
function parallax(y) {
  if (reduce || y > window.innerHeight * 1.3) return;
  prints.forEach(([el, k], i) => { if (el) el.style.translate = (mx * (i + 1) * 5).toFixed(1) + "px " + (-y * k + my * (i + 1) * 4).toFixed(1) + "px"; });
}
const stepsEl = $("steps"), stepEls = stepsEl ? [...stepsEl.children] : [];
function stepsProgress() {
  if (!stepsEl || !stepsEl.offsetParent) return;
  const r = stepsEl.getBoundingClientRect(), vh = window.innerHeight;
  const pr = reduce ? 1 : Math.max(0, Math.min(1, (vh * 0.8 - r.top) / (r.height + vh * 0.25)));
  stepsEl.style.setProperty("--p", pr.toFixed(3));
  stepEls.forEach((el, i) => el.classList.toggle("on", pr >= i / stepEls.length + 0.02));
}
function onScroll() {
  const y = window.scrollY;
  topEl.classList.toggle("solid", y > 24);
  const menuOpen = $("drawer").classList.contains("open");
  if (!menuOpen && !topEl.contains(document.activeElement) && y > lastY + 4 && y > 280) topEl.classList.add("away");
  else if (y < lastY - 4 || y <= 280) topEl.classList.remove("away");
  lastY = y; parallax(y); stepsProgress(); ticking = false;
}
window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
window.addEventListener("resize", stepsProgress);
topEl.addEventListener("focusin", () => topEl.classList.remove("away"));
if (!reduce && window.matchMedia && matchMedia("(pointer: fine)").matches) {
  document.querySelector(".hero").addEventListener("pointermove", (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2; my = (e.clientY / window.innerHeight - 0.5) * 2; parallax(window.scrollY);
  });
}

// ------------------------------------------------------------------ apparition au défilement
let io = null;
function reveal(root) {
  const els = (root || document).querySelectorAll(".rv:not(.on)");
  if (!io) {
    if ("IntersectionObserver" in window && !reduce) {
      io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("on"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    } else { els.forEach((el) => el.classList.add("on")); return; }
  }
  els.forEach((el) => io.observe(el));
}

// ------------------------------------------------------------------ le grand tirage change doucement de photo
let cyc = [], ci = 0, timer = null;
function cycStep() { if (cyc.length < 2) return; cyc[ci].classList.remove("on"); ci = (ci + 1) % cyc.length; cyc[ci].classList.add("on"); }
function play() { if (!reduce && !timer) timer = setInterval(cycStep, 5600); }
function stop() { clearInterval(timer); timer = null; }
document.addEventListener("visibilitychange", () => (document.hidden ? stop() : play()));

// ------------------------------------------------------------------ menu mobile
const drawer = $("drawer");
function menu(o) {
  drawer.classList.toggle("open", o); drawer.setAttribute("aria-hidden", String(!o)); $("menu-open").setAttribute("aria-expanded", String(o));
  if (o) $("menu-close").focus();
}
$("menu-open").onclick = () => menu(true);
$("menu-close").onclick = () => { menu(false); $("menu-open").focus(); };
drawer.addEventListener("click", (e) => { if (e.target.closest("a")) menu(false); });
drawer.addEventListener("keydown", (e) => { if (e.key === "Escape") { menu(false); $("menu-open").focus(); } });

// ------------------------------------------------------------------ photos de l'accueil
function putImg(el, ref) {
  const d = img(ref);
  if (!d) return;
  // srcset avant src : le navigateur ne télécharge que la bonne taille
  if (d.ss) { el.sizes = el.dataset.sizes || "(max-width: 760px) 100vw, 50vw"; el.srcset = d.ss; } else el.removeAttribute("srcset");
  el.src = d.src; el.width = d.w; el.height = d.h;
  el.style.objectPosition = d.pos || "";
  if (d.alt) el.alt = d.alt;
}
function fillSlots() {
  document.querySelectorAll("img[data-slot]").forEach((el) => putImg(el, slotRef(SITE, el.dataset.slot)));
  $("hero-cap").hidden = true;
  cyc = [...$("cycle").querySelectorAll("img")].filter((x) => x.getAttribute("src"));
  $("demo-credit").hidden = !usesDemoPhotos(SITE);
}

// ------------------------------------------------------------------ séances
const visibleStories = () => SITE.stories.filter((s) => s.show !== false && s.photos && s.photos.length);
// Vraie page pour les séances de la photographe ; les séances d'exemple restent dans l'accueil
const isDemoStory = (s) => s.demo || s.photos.some((r) => DEMO_DIMS[r]);
const storyHref = (s) => DEMO || isDemoStory(s) ? HOME + "#seance-" + s.id : storyFile(s);
function drawWorks() {
  const box = $("works");
  box.querySelectorAll(".work").forEach((a) => a.remove());
  const list = visibleStories().slice(0, 6), few = list.length < 6;
  // La composition en mosaïque est pensée pour 6 séances ; en dessous, une grille simple
  box.classList.toggle("few", few);
  box.style.setProperty("--c", String(list.length === 4 ? 2 : Math.min(list.length, 3) || 1));
  list.forEach((s, i) => {
    const d = img(s.photos[0]);
    const a = document.createElement("a");
    a.className = "work " + (few ? "" : "k" + [1, 2, 3, 4, 6, 5][i] + " ") + "rv";
    if (i % 2) a.style.setProperty("--d", "90ms");
    a.href = storyHref(s);
    a.dataset.story = s.id;
    a.innerHTML = '<div class="ph"><img loading="lazy" alt="Séance ' + esc(s.title) + ", " + esc(String(s.kind).toLowerCase()) + " à " + esc(s.place) + '"' +
      (d ? srcAttrs(d, "(max-width: 760px) 90vw, 34vw") + ' src="' + esc(d.src) + '" width="' + d.w + '" height="' + d.h + '"' + (d.pos ? ' style="object-position:' + esc(d.pos) + '"' : "") : "") + '></div><div class="cap"><b>' + esc(s.title) + "</b><span>" + esc(s.kind) + ", " + esc(s.place) + "</span></div>";
    box.appendChild(a);
  });
  $("seances").hidden = !visibleStories().length;
  reveal(box);
}
function showStory(key) {
  const list = visibleStories();
  const s = findStory(list, key);
  if (!s) return null;
  const k = list.indexOf(s), nx = list.length > 1 ? list[(k + 1) % list.length] : null;
  const pics = s.photos.map((r) => img(r)).filter(Boolean);
  const nxImg = nx ? img(nx.photos[0]) : null;
  $("st-body").innerHTML = storyHtml(s, pics, nx, nxImg, storyHref, HOME + "#contact");
  return s;
}

// ------------------------------------------------------------------ « Votre galerie privée » : on essaie sans quitter l'accueil
const HEART = '<svg viewBox="0 0 24 24" fill="FILL" stroke="currentColor" stroke-width="1.5"><path d="M12 20s-7-4.4-8.6-8.8C2.3 8 4.2 5 7.4 5c1.9 0 3.3 1 4.6 2.8C13.3 6 14.7 5 16.6 5c3.2 0 5.1 3 4 6.2C19 15.6 12 20 12 20z"/></svg>';
const RUN = ["run1", "run2", "run3"];
let exFavs = store.get("lr-ex-favs", {}) || {};
function setHeart(a, f, n) {
  a.setAttribute("aria-pressed", String(f));
  a.setAttribute("aria-label", (f ? "Retirer des" : "Ajouter aux") + " favorites, photo " + n);
  a.innerHTML = HEART.replace("FILL", f ? "currentColor" : "none");
  a.classList.remove("pop"); void a.offsetWidth; a.classList.add("pop");
}
function drawRun() {
  const ds = RUN.map((k) => img(slotRef(SITE, k)));
  $("run").style.setProperty("--cols", ds.map((d, i) => (d ? (d.w / d.h) * (i === 0 ? 2.2 : 1) : 1).toFixed(3) + "fr").join(" "));
  $("run").innerHTML = ds.map((d, i) => {
    const f = !!exFavs[i];
    return '<figure class="frame' + (i === 0 ? " lift" : "") + '" style="--r:' + (d ? d.w + " / " + d.h : "1") + '"><div class="ph">' + (d ? '<img alt="Photo ' + (i + 1) + ' de la galerie d\'exemple"' + srcAttrs(d, i === 0 ? "(max-width: 760px) 70vw, 40vw" : "(max-width: 760px) 40vw, 22vw") + ' src="' + esc(d.src) + '">' : "") + "</div>" +
      '<button class="round" type="button" data-act="fav" data-i="' + i + '" aria-pressed="' + f + '" aria-label="' + (f ? "Retirer des" : "Ajouter aux") + " favorites, photo " + (i + 1) + '">' + HEART.replace("FILL", f ? "currentColor" : "none") + "</button>" +
      '<figcaption class="cap">Photo ' + (i + 1) + "</figcaption></figure>";
  }).join("");
  tally();
}
function tally() {
  const n = Object.keys(exFavs).filter((k) => exFavs[k]).length;
  $("tally").classList.toggle("has", n > 0);
  $("tally-t").textContent = n ? n + " favorite" + (n > 1 ? "s" : "") + " dans votre sélection" : "";
}
$("run").addEventListener("click", (e) => {
  const a = e.target.closest("[data-act=fav]");
  if (!a) return;
  const i = Number(a.dataset.i);
  exFavs[i] = !exFavs[i];
  store.set("lr-ex-favs", exFavs);
  setHeart(a, exFavs[i], i + 1);
  tally();
});

// ------------------------------------------------------------------ tarifs : une pilule par formule
let prSel = 0;
function kindOf(name) { const n = String(name).toLowerCase(); return n.includes("mariage") ? "Mariage" : n.includes("famille") ? "Famille" : n.includes("portrait") ? "Portrait" : "Autre"; }
function priceImg(p) {
  const k = kindOf(p.name);
  const st = visibleStories().filter((s) => s.kind === k);
  const half = /demi/i.test(p.name);
  const s = st[half && st.length > 1 ? 1 : 0];
  return s ? img(s.photos[0]) : img(slotRef(SITE, "about"));
}
function drawPrice(anim) {
  const p = SITE.prices[prSel], el = $("pr-panel");
  if (!p) { el.innerHTML = ""; return; }
  el.setAttribute("aria-labelledby", "pr-" + prSel);
  const d = priceImg(p);
  el.innerHTML = '<div class="pr-txt"><h3>' + esc(p.name) + '</h3><span class="big">' + euro(p.price) + "</span><p>" + esc(p.detail) + '</p><a class="btn ghost sm go" href="#contact" data-kind="' + kindOf(p.name) + '">Parler de cette formule</a></div><div class="ph pr-ph">' + (d ? '<img alt="" loading="lazy" src="' + esc(d.src) + '">' : "") + "</div>";
  if (anim && !reduce) { el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap"); }
}
function pickPrice(i, focus) {
  prSel = (i + SITE.prices.length) % SITE.prices.length;
  document.querySelectorAll("#prices .pr").forEach((b, k) => { b.setAttribute("aria-selected", String(k === prSel)); b.tabIndex = k === prSel ? 0 : -1; if (k === prSel && focus) b.focus(); });
  drawPrice(true);
}
$("prices").addEventListener("click", (e) => { const b = e.target.closest(".pr"); if (b) pickPrice(Number(b.dataset.i), false); });
$("prices").addEventListener("keydown", (e) => {
  const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (k) { e.preventDefault(); pickPrice(prSel + k, true); }
  else if (e.key === "Home" || e.key === "End") { e.preventDefault(); pickPrice(e.key === "Home" ? 0 : SITE.prices.length - 1, true); }
});
$("pr-panel").addEventListener("click", (e) => {
  const a = e.target.closest("[data-kind]");
  if (!a) return;
  const r = document.querySelector('#contact input[name="kind"][value="' + a.dataset.kind + '"]');
  if (r) r.checked = true;
});
function drawPrices() {
  if (prSel >= SITE.prices.length) prSel = 0;
  $("prices").innerHTML = SITE.prices.map((p, i) =>
    '<button class="pr" type="button" role="tab" id="pr-' + i + '" aria-controls="pr-panel" aria-selected="' + (i === prSel) + '" tabindex="' + (i === prSel ? 0 : -1) + '" data-i="' + i + '"><span>' + esc(p.name) + '</span><span class="n">' + euro(p.price) + "</span></button>").join("");
  $("tarifs").hidden = !SITE.prices.length;
  drawPrice(false);
}

// ------------------------------------------------------------------ avis : un à la fois
let avI = 0, avBusy = false;
function drawReview(animate) {
  const L = REVIEWS;
  $("avis").hidden = !L.length;
  if (!L.length) return;
  avI = (avI + L.length) % L.length;
  const r = L[avI];
  const put = () => {
    const d = img(r.image_path, "tender");
    if (d) { const im = $("av-img"); if (d.ss) { im.sizes = "(max-width: 760px) 90vw, 40vw"; im.srcset = d.ss; } else im.removeAttribute("srcset"); im.src = d.src; $("av-img").width = d.w; $("av-img").height = d.h; $("av-img").style.objectPosition = d.pos || ""; }
    $("av-img").alt = "Photo de la séance de " + r.who;
    $("av-text").textContent = "« " + r.body + " »";
    $("av-who").innerHTML = "<b>" + esc(r.who) + "</b><span>" + esc(r.ctx || "") + "</span>";
    $("av-n").textContent = (avI + 1) + " / " + L.length;
    $("av-nav").hidden = L.length < 2;
    $("av-google").hidden = !SITE.gRead; if (SITE.gRead) $("av-glink").href = SITE.gRead;
  };
  if (!animate || reduce) { put(); return; }
  if (avBusy) return;
  avBusy = true;
  $("av-wrap").classList.add("av-out");
  setTimeout(() => { put(); $("av-wrap").classList.remove("av-out"); avBusy = false; }, 320);
}
const stepReview = (d) => { avI += d; drawReview(true); };
$("av-prev").onclick = () => stepReview(-1);
$("av-next").onclick = () => stepReview(1);
(() => {
  let x0 = null;
  const el = $("av-wrap");
  el.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") x0 = e.clientX; });
  el.addEventListener("pointerup", (e) => { if (x0 !== null && Math.abs(e.clientX - x0) > 50 && REVIEWS.length > 1) stepReview(e.clientX < x0 ? 1 : -1); x0 = null; });
})();

// ------------------------------------------------------------------ contact
$("ct-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget, note = $("ct-note"), btn = f.querySelector("button[type=submit]");
  const wed = f.kind.value === "Mariage";
  // Mariage : lieu, invités et formule arrivent en tête du message, prêts à lire pour Laurie
  const details = wed ? [["Lieu", f.place.value.trim()], ["Invités", f.guests.value], ["Formule", f.formula.value]].filter((x) => x[1]).map((x) => x[0] + " : " + x[1]) : [];
  const typed = f.msg.value.trim();
  const data = { kind: f.kind.value, name: f.name.value.trim(), email: f.email.value.trim(), when: f.when.value.trim(), message: (details.length ? details.join("\n") + (typed ? "\n\n" : "") : "") + typed, website: f.website.value };
  const bad = (el, msg) => { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "ct-note"); note.textContent = msg; el.focus(); };
  if (!data.name) return bad(f.name, "Indiquez votre prénom.");
  if (!EMAIL.test(data.email)) return bad(f.email, "Votre e-mail semble incomplet.");
  if (data.message.length < 5) return bad(f.msg, wed ? "Indiquez le lieu ou écrivez quelques mots sur votre mariage." : "Écrivez quelques mots sur votre projet.");
  if (DEMO) {
    // Sans Supabase : on prépare l'e-mail dans la messagerie du visiteur
    const subject = "Séance " + data.kind.toLowerCase() + (data.when ? ", " + data.when : "");
    const body = "Bonjour,\n\n" + data.message + "\n\nType de séance : " + data.kind + (data.when ? "\nDate envisagée : " + data.when : "") + "\n\n" + data.name;
    note.textContent = "Votre messagerie s'ouvre avec le message prêt.";
    window.location.href = "mailto:" + SITE.mail + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    return;
  }
  btn.disabled = true;
  note.textContent = "Envoi…";
  try {
    await callGallery({ action: "contact", ...data });
    f.reset(); contactKind();
    note.textContent = "Merci ! Votre message est bien arrivé. Je vous réponds sous deux jours.";
  } catch (err) {
    note.textContent = err.message + " Vous pouvez aussi écrire à " + SITE.mail + ".";
  } finally {
    btn.disabled = false;
  }
});

// Formulaire : questions propres au mariage seulement quand « Mariage » est choisi
function contactKind() {
  const f = $("ct-form"), wed = f.kind.value === "Mariage";
  $("ct-wed").hidden = !wed;
  $("ct-when-l").textContent = wed ? "Date du mariage" : "Date envisagée";
  f.when.placeholder = wed ? "Par exemple : samedi 19 juin 2027" : "Par exemple : un dimanche de septembre";
  f.msg.placeholder = wed ? "Ce qui compte pour vous, l'ambiance de la journée, vos questions" : "Le lieu, le nombre de personnes, ce qui compte pour vous";
}
function contactFormulas() {
  const sel = $("ct-formula"), keep = sel.value;
  const wedPrices = SITE.prices.filter((p) => /mariage/i.test(p.name));
  sel.innerHTML = '<option value="">Je ne sais pas encore</option>' + (wedPrices.length ? wedPrices : SITE.prices).map((p) => '<option value="' + esc(p.name + " (" + euro(p.price) + ")") + '">' + esc(p.name) + " · " + esc(euro(p.price)) + "</option>").join("");
  sel.value = keep;
}
$("ct-form").addEventListener("change", (e) => { if (e.target.name === "kind") contactKind(); });
contactKind();
$("ct-form").addEventListener("input", (e) => { if (e.target.getAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid"); });

// ------------------------------------------------------------------ référencement
function seo() {
  if (PAGE) return; // la page d'une séance a ses propres titre et description
  setMeta("name", "description", SITE.seoDesc);
  setMeta("property", "og:title", SITE.seoTitle);
  setMeta("property", "og:description", SITE.seoDesc);
  const canon = document.querySelector('link[rel="canonical"]');
  const ld = businessLd(SITE, canon ? canon.href : location.origin);
  $("ld").textContent = JSON.stringify(ld);
}

// ------------------------------------------------------------------ pages légales
let lgObs = null;
function showLegal(page) {
  const tmp = document.createElement("div");
  tmp.innerHTML = legal.legalHtml(page);
  const h1 = tmp.querySelector("h1"), upd = tmp.querySelector(".upd");
  $("lg-title").innerHTML = h1 ? h1.innerHTML : ""; if (h1) h1.remove();
  $("lg-upd").textContent = upd ? upd.textContent : ""; if (upd) upd.remove();
  if (page === "confidentialite") { const intro = tmp.querySelector("p"); if (intro && /moins de données/.test(intro.textContent)) intro.remove(); }
  $("lg-lede").textContent = legal.LG_LEDE[page] || "";
  $("lg-body").innerHTML = legal.lgBrief(page) + tmp.innerHTML;
  const hs = [...$("lg-body").querySelectorAll("h2")];
  hs.forEach((h, i) => { h.id = "lg-" + page + "-" + i; });
  $("lg-toc").innerHTML = hs.map((h) => '<li><a href="#' + h.id + '" data-toc="' + h.id + '">' + esc(h.textContent.replace(/^\d+\.\s*/, "")) + "</a></li>").join("");
  $("lg-tocd").open = !(window.matchMedia && matchMedia("(max-width: 900px)").matches);
  if (lgObs) lgObs.disconnect();
  if ("IntersectionObserver" in window) {
    lgObs = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) $("lg-toc").querySelectorAll("a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.toc === e.target.id)));
    }), { rootMargin: "0px 0px -70% 0px" });
    hs.forEach((h) => lgObs.observe(h));
  }
  document.querySelectorAll("[data-lg]").forEach((a) => { if (a.dataset.lg === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}
$("lg-toc").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-toc]");
  if (!a) return;
  e.preventDefault();
  const h = document.getElementById(a.dataset.toc);
  if (h) h.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  if (window.matchMedia && matchMedia("(max-width: 900px)").matches) $("lg-tocd").open = false;
});

// ------------------------------------------------------------------ textes
function applySite() {
  $("kicker").textContent = SITE.kicker || ""; $("kicker").hidden = !SITE.kicker;
  $("h1a").textContent = SITE.t1; $("h1b").textContent = SITE.t2; $("lede").textContent = SITE.lede;
  document.querySelectorAll("[data-mail]").forEach((a) => { a.href = "mailto:" + SITE.mail; a.textContent = SITE.mail; });
  document.querySelectorAll("[data-mail-only]").forEach((a) => { a.href = "mailto:" + SITE.mail; });
  document.querySelectorAll("[data-ig]").forEach((a) => { a.href = SITE.ig; });
  fillSlots(); drawWorks(); drawRun(); drawPrices(); drawReview(false); seo(); contactFormulas();
}

// ------------------------------------------------------------------ vues
const LEGAL = ["mentions-legales", "confidentialite", "conditions"];
const TITLES = { "mentions-legales": "Mentions légales", confidentialite: "Politique de confidentialité", conditions: "Conditions de prestation" };
function route() {
  const h = PAGE ? "seance-" + PAGE : decodeURIComponent(location.hash.replace("#", ""));
  const view = LEGAL.includes(h) ? "legal" : h.startsWith("seance-") ? "story" : "home";
  $("v-home").hidden = view !== "home";
  $("v-legal").hidden = view !== "legal";
  $("v-story").hidden = view !== "story";
  menu(false);
  if (view === "story") {
    const s = showStory(h.slice(7));
    if (!s) { location.replace(HOME + "#seances"); return; } // séance retirée ou lien erroné
    document.title = storyTitle(s);
    setMeta("name", "description", storyDesc(s));
    setMeta("property", "og:title", storyTitle(s));
    setMeta("property", "og:description", storyDesc(s));
    window.scrollTo(0, 0);
  } else if (view === "legal") {
    showLegal(h);
    document.title = TITLES[h] + " · lau.rie";
    window.scrollTo(0, 0);
  } else {
    document.title = SITE.seoTitle;
    stepsProgress();
    play();
  }
}
// ------------------------------------------------------------------ transition fluide accueil ↔ séance
// La photo cliquée s'agrandit jusqu'à devenir celle du haut de la séance (navigateurs récents ;
// ailleurs, ou si l'on préfère moins d'animations, la navigation reste instantanée).
const VT = "st-hero";
const quietVT = (vt) => { if (vt) ["ready", "finished", "updateCallbackDone"].forEach((k) => vt[k] && vt[k].catch(() => {})); };
function vtName(el) {
  document.querySelectorAll("[data-vt]").forEach((x) => { x.style.viewTransitionName = ""; x.removeAttribute("data-vt"); });
  if (el) { el.style.viewTransitionName = VT; el.dataset.vt = "1"; }
}
const cardImg = (pred) => { const a = [...document.querySelectorAll("#works a.work")].find(pred); return a ? a.querySelector("img") : null; };
let lastStory = null;
$("works").addEventListener("click", (e) => { const a = e.target.closest("a.work"); if (a) vtName(a.querySelector("img")); });
function routeVT() {
  const fromStory = !$("v-story").hidden ? lastStory : null;
  const run = () => {
    route();
    const h = decodeURIComponent(location.hash.replace("#", ""));
    if (h.startsWith("seance-")) { vtName(null); lastStory = h.slice(7); }
    else if (fromStory && !$("v-home").hidden) { vtName(cardImg((a) => a.dataset.story === fromStory || a.getAttribute("href").endsWith("#seance-" + fromStory))); lastStory = null; }
  };
  if (reduce || !document.startViewTransition) { run(); return; }
  const vt = document.startViewTransition(run), done = () => vtName(null);
  quietVT(vt); // transition interrompue : la page change quand même, sans animation
  vt.finished.then(done, done);
}
window.addEventListener("hashchange", routeVT);
// Vers une vraie page de séance (autre document) : même effet, si le navigateur le permet
window.addEventListener("pageswap", (e) => {
  quietVT(e.viewTransition); // page sans transition à l'arrivée : abandon silencieux
  const to = e.viewTransition && e.activation && e.activation.entry && e.activation.entry.url;
  if (to) vtName(cardImg((a) => a.href === to));
});
window.addEventListener("pagereveal", (e) => {
  if (!e.viewTransition) return;
  const done = () => vtName(null);
  quietVT(e.viewTransition);
  e.viewTransition.finished.then(done, done);
});
document.querySelectorAll("[data-top]").forEach((b) => b.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })));

initTypo();
// Aperçu demandé depuis l'espace photographe : le brouillon n'existe que dans ce navigateur (2 h)
const PREVIEW = (() => {
  if (!new URLSearchParams(location.search).has("apercu")) return null;
  try { const p = JSON.parse(localStorage.getItem("lr-preview") || "null"); return p && Date.now() - p.at < 2 * 36e5 ? p.content : null; } catch { return null; }
})();
function previewBanner() {
  const b = document.createElement("div");
  b.className = "preview-bar"; b.setAttribute("role", "status");
  b.innerHTML = "<span><b>Aperçu</b> : rien n'est encore enregistré. Les visiteurs voient toujours l'ancienne version.</span><button type=\"button\">Fermer l'aperçu</button>";
  b.querySelector("button").onclick = () => { try { localStorage.removeItem("lr-preview"); } catch { /* rien */ } window.close(); location.replace("index.html"); };
  document.body.appendChild(b);
}
function start() {
  if (PREVIEW) { SITE = mergeSite(PREVIEW); legal = makeLegal(SITE); previewBanner(); }
  applySite(); route(); reveal();
  { const h0 = decodeURIComponent(location.hash.replace("#", "")); if (h0.startsWith("seance-")) lastStory = h0.slice(7); }
}
if (DEMO) start();
else {
  // Le contenu enregistré par la photographe arrive avant le premier affichage
  // (pas de séance d'exemple qui apparaît une fraction de seconde).
  loadPublic().then(({ content, portfolio, reviews }) => {
    SITE = mergeSite(content);
    img = makeImg(libraryOf(portfolio));
    REVIEWS = reviews || [];
    legal = makeLegal(SITE);
    start();
  }).catch((e) => {
    console.warn("Contenu non chargé, textes par défaut affichés", e);
    start();
    toast("Le site n'a pas pu charger tout son contenu. Rechargez la page.");
  });
}
