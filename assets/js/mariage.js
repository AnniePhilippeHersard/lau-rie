// Page Mariage : les mariages et les formules viennent du contenu du site (espace photographe),
// comme l'accueil. Sans contenu (ou en démonstration), les séances et tarifs d'exemple s'affichent.
import { $, esc, euro, srcAttrs, makeImg, mergeSite, usesDemoPhotos, DEMO_DIMS } from "./core.js";
import { DEMO, loadPublic, libraryOf } from "./api.js";
import { storyFile } from "./story.js";

document.documentElement.classList.add("js");
let SITE = mergeSite(null);
let img = makeImg({});

// ------------------------------------------------------------------ en-tête et menu
const bar = document.querySelector("#v-home > .top"), drawer = $("drawer"), openBtn = $("menu-open");
const solid = () => bar.classList.toggle("solid", window.scrollY > 8);
window.addEventListener("scroll", solid, { passive: true });
solid();
function menu(o) {
  drawer.classList.toggle("open", o);
  drawer.setAttribute("aria-hidden", String(!o));
  openBtn.setAttribute("aria-expanded", String(o));
  document.body.style.overflow = o ? "hidden" : "";
  (o ? $("menu-close") : openBtn).focus();
}
openBtn.addEventListener("click", () => menu(true));
$("menu-close").addEventListener("click", () => menu(false));
drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => menu(false)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("open")) menu(false); });
document.querySelectorAll("[data-top]").forEach((b) => b.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" })));

// ------------------------------------------------------------------ contenu
const weddings = () => SITE.stories.filter((s) => s.show !== false && s.kind === "Mariage" && Array.isArray(s.photos) && s.photos.length);
const isDemoStory = (s) => s.demo || s.photos.some((r) => DEMO_DIMS[r]);
const storyHref = (s) => (DEMO || isDemoStory(s) ? "index.html#seance-" + s.id : storyFile(s));

function put(el, ref, sizes) {
  const d = ref && img(ref);
  if (!d) return;
  if (d.ss) { el.sizes = sizes; el.srcset = d.ss; }
  el.src = d.src; el.width = d.w; el.height = d.h;
  if (d.pos) el.style.objectPosition = d.pos;
}
function photo(ref, cls, alt, sizes) {
  const d = img(ref);
  if (!d) return "";
  return '<a class="wed-ph ' + cls + '" href="#"><img loading="lazy" alt="' + esc(alt) + '"' + srcAttrs(d, sizes) + ' src="' + esc(d.src) + '" width="' + d.w + '" height="' + d.h + '"' + (d.pos ? ' style="object-position:' + esc(d.pos) + '"' : "") + "></a>";
}

function drawHero(list) {
  // Trois photos qui ne reviennent pas plus bas dans la page (les trois premières de chaque mariage y sont)
  const shown = new Set(list.slice(0, 4).flatMap((s) => s.photos.slice(0, 3)));
  const pick = [...new Set(list.flatMap((s) => s.photos.slice(3)))];
  ["m-pose", "m-forest", "m-sunset", "m-beach"].forEach((k) => { if (!shown.has(k) && !pick.includes(k)) pick.push(k); });
  document.querySelectorAll("img[data-wed]").forEach((el) => { const i = +el.dataset.wed; put(el, pick[i], i ? "(max-width: 760px) 40vw, 18vw" : "(max-width: 760px) 62vw, 30vw"); });
}

function drawWeddings(list) {
  const box = $("weds");
  $("wed-list").hidden = !list.length;
  box.innerHTML = list.slice(0, 4).map((s, i) => {
    const href = storyHref(s);
    const meta = [s.place, s.when].filter(Boolean).map(esc).join(" · ");
    const alt = "Mariage " + s.title + (s.place ? ", " + s.place : "");
    return '<article class="wed' + (i % 2 ? " flip" : "") + '">' +
      '<div class="wed-txt"><h3><a href="' + esc(href) + '">' + esc(s.title) + "</a></h3>" + (meta ? '<p class="wed-meta">' + meta + "</p>" : "") +
      (s.text ? "<p>" + esc(s.text) + "</p>" : "") + '<a class="wed-more" href="' + esc(href) + '">Voir la séance</a></div>' +
      [["a", 0, "(max-width: 900px) 92vw, 60vw"], ["b", 1, "(max-width: 900px) 46vw, 30vw"], ["c", 2, "(max-width: 900px) 46vw, 30vw"]]
        .map(([c, k, sz]) => (s.photos[k] ? photo(s.photos[k], c, alt, sz).replace('href="#"', 'href="' + esc(href) + '"') : "")).join("") +
      "</article>";
  }).join("");
}

function drawForms() {
  const box = $("wed-forms");
  const list = SITE.prices.filter((p) => /mariage/i.test(p.name));
  if (!list.length) return; // on garde le texte de la page
  const inc = box.querySelector(".form-inc");
  box.querySelectorAll(".form-c").forEach((el) => el.remove());
  list.forEach((p) => {
    const d = document.createElement("div");
    d.className = "form-c";
    const name = String(p.name).replace(/^mariage\s*,?\s*/i, "") || p.name;
    d.innerHTML = "<h3>" + esc(name.charAt(0).toUpperCase() + name.slice(1)) + '</h3><p class="big">' + esc(euro(p.price)) + "</p>" + (p.detail ? "<p>" + esc(p.detail) + "</p>" : "") +
      '<a class="btn ghost" href="index.html#contact">Parler de cette formule</a>';
    box.insertBefore(d, inc);
  });
  if (inc) inc.querySelector("p").textContent = list.length > 1 ? "Dans tous les cas\u00a0:" : "Comprend\u00a0:";
}

function drawDelay() {
  const d = (SITE.legal && (SITE.legal.delayWed || SITE.legal.delay)) || "";
  if (!d) return;
  document.querySelectorAll("[data-delay]").forEach((el) => { el.textContent = d; });
  document.querySelectorAll("[data-delay-cap]").forEach((el) => { el.textContent = d.charAt(0).toUpperCase() + d.slice(1); });
}

function start() {
  const list = weddings();
  drawHero(list);
  drawWeddings(list);
  drawForms();
  drawDelay();
  $("demo-credit").hidden = !usesDemoPhotos(SITE);
}

loadPublic().then(({ content, portfolio }) => {
  SITE = mergeSite(content);
  img = makeImg(libraryOf(portfolio));
  start();
}).catch((e) => {
  console.warn("Contenu non chargé, textes par défaut affichés", e);
  start();
});
