// Prépare le dossier publié par GitHub Pages :
//   - une copie du site (sans les fichiers de travail) ;
//   - une vraie page par séance (seance-….html), lisible par Google sans JavaScript ;
//   - un sitemap.xml qui les liste.
// Lancé par .github/workflows/site.yml (chaque nuit et à chaque modification du dépôt).
// Usage : node tools/pages-seo.mjs [dossier de sortie, « _site » par défaut]
// Aucune dépendance : Node 18 ou plus.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(ROOT, process.argv[2] || "_site");
const SKIP = new Set([".git", ".github", "tools", "supabase", "skills-zip", "node_modules", path.basename(OUT)]);

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// story.js est partagé avec le site : chargé tel quel (il n'importe rien)
const story = await import("data:text/javascript;base64," + Buffer.from(read("assets/js/story.js")).toString("base64"));

// 1. Copie du site
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(ROOT)) {
  if (SKIP.has(f) || f.endsWith(".md") || f.endsWith(".zip") || (f.startsWith(".") && f !== ".nojekyll")) continue;
  fs.cpSync(path.join(ROOT, f), path.join(OUT, f), { recursive: true });
}

// 2. Réglages : config.js (Supabase) et adresse officielle du site (balise canonical de index.html)
const cfg = read("assets/js/config.js");
const pick = (k) => (cfg.match(new RegExp("\\b" + k + '\\s*:\\s*"([^"]*)"')) || [])[1] || "";
const SB = { url: pick("url").trim().replace(/\/(rest|auth|storage|functions)\/v1\/?$/i, "").replace(/\/+$/, ""), key: pick("anonKey") };
const INDEX = read("index.html");
const BASE = ((INDEX.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || "https://lau-rie.fr/").replace(/\/$/, "");

// Contenus par défaut du site (core.js) : simple objet de textes et de tarifs, lu sans exécuter le reste du fichier
const DEF = (() => {
  const m = read("assets/js/core.js").match(/export const SITE_DEF = (\{[\s\S]*?\n\});/);
  try { return m ? new Function("return " + m[1])() : {}; } catch { return {}; }
})();
const LEGAL_DEF = {};
const merge = (c) => ({ ...DEF, ...Object.fromEntries(Object.entries(c || {}).filter(([, v]) => v != null && v !== "")), legal: { ...LEGAL_DEF, ...((c && c.legal) || {}) } });

// Accueil : titre, description et fiche entreprise remplis avec le contenu enregistré (lisibles sans JavaScript)
function homepage(S, hero) {
  let h = INDEX;
  const setMeta = (attr, key, val) => { if (val) h = h.replace(new RegExp('<meta ' + attr + '="' + key + '" content="[^"]*">'), '<meta ' + attr + '="' + key + '" content="' + esc(val) + '">'); };
  if (S.seoTitle) h = h.replace(/<title>[^<]*<\/title>/, "<title>" + esc(S.seoTitle) + "</title>");
  setMeta("name", "description", S.seoDesc);
  setMeta("property", "og:title", S.seoTitle);
  setMeta("property", "og:description", S.seoDesc);
  if (S.kicker) h = h.replace(/(<p class="kicker" id="kicker">)[^<]*(<\/p>)/, (m, a, b) => a + esc(S.kicker) + b);
  if (S.lede) h = h.replace(/(<p class="lede" id="lede">)[^<]*(<\/p>)/, (m, a, b) => a + esc(S.lede) + b);
  h = h.replace(/(<script type="application\/ld\+json" id="ld">)[\s\S]*?(<\/script>)/, (m, a, b) => a + JSON.stringify(story.businessLd(S, BASE)).replace(/</g, "\\u003c") + b);
  // Grande photo de l'accueil : connue dès le HTML (chargement prioritaire), au lieu d'attendre le JavaScript
  if (hero && hero.src) {
    const src = esc(hero.src);
    const SIZES = "(max-width: 760px) 62vw, 30vw";
    const set = hero.ss ? ' srcset="' + esc(hero.ss) + '" sizes="' + SIZES + '"' : "";
    h = h.replace('<link rel="stylesheet" href="assets/css/lau.css">', '<link rel="preload" as="image" href="' + src + '"' + (hero.ss ? ' imagesrcset="' + esc(hero.ss) + '" imagesizes="' + SIZES + '"' : "") + ' fetchpriority="high">\n<link rel="stylesheet" href="assets/css/lau.css">');
    h = h.replace('<img class="on" data-slot="hero1" data-sizes="' + SIZES + '" alt="" fetchpriority="high">', '<img class="on" data-slot="hero1" data-sizes="' + SIZES + '" alt="" fetchpriority="high"' + set + ' src="' + src + '"' + (hero.pos ? ' style="object-position:' + esc(hero.pos) + '"' : "") + ">");
  }
  fs.writeFileSync(path.join(OUT, "index.html"), h);
}

// llms.txt : résumé en texte simple pour les assistants IA (ChatGPT, Perplexity, Gemini…)
function llms(S, pages) {
  const prices = (S.prices || []).map((p) => "- " + p.name + " : " + p.price + " €" + (p.detail ? " (" + p.detail + ")" : "")).join("\n");
  const txt = "# lau.rie\n\n> " + (S.seoDesc || "") + "\n\n" +
    "Photographe : " + ((S.legal && S.legal.owner) || "Laurie") + ". Basée à " + (S.city || "Nantes") + ". Zone : " + (S.area || "") + ".\n" +
    "Séances : mariages (reportage), familles, portraits, en lumière naturelle. Livraison dans une galerie privée en ligne, avec sélection des photos préférées et partage aux proches.\n\n" +
    (prices ? "## Tarifs\n\n" + prices + "\n\n" : "") +
    "## Pages\n\n- [Accueil](" + BASE + "/)\n- [Contact](" + BASE + "/index.html#contact)\n- [Tarifs](" + BASE + "/index.html#tarifs)\n" +
    pages.map((p) => "- [" + p.title + "](" + BASE + "/" + p.file + ")").join("\n") + (pages.length ? "\n" : "") +
    "\nContact : " + (S.mail || "") + "\n";
  fs.writeFileSync(path.join(OUT, "llms.txt"), txt);
}

function finish(S, pages, hero) {
  // Date de publication, lue par l'écran « Santé du site »
  fs.writeFileSync(path.join(OUT, "version.json"), JSON.stringify({ built_at: new Date().toISOString(), pages: pages.length }) + "\n");
  sitemap(pages.map((p) => p.file));
  homepage(S, hero);
  llms(S, pages);
}

function sitemap(files) {
  const urls = [BASE + "/", ...files.map((f) => BASE + "/" + f)];
  fs.writeFileSync(path.join(OUT, "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u, i) => "  <url><loc>" + esc(u) + "</loc>" + (i ? "<priority>0.7</priority>" : "<priority>1.0</priority>") + "</url>").join("\n") +
    "\n</urlset>\n");
}

if (!SB.url || !SB.key) {
  console.log("Supabase n'est pas encore branché (config.js vide) : site publié sans pages de séances.");
  finish(merge({}), []);
  process.exit(0);
}

// 3. Contenu public (les mêmes lectures que le site, avec la clé publique)
async function rest(q) {
  const res = await fetch(SB.url + "/rest/v1/" + q, { headers: { apikey: SB.key, Accept: "application/json" } });
  if (!res.ok) throw new Error("Supabase a répondu " + res.status + " pour " + q.split("?")[0] + (res.status === 404 ? " : table absente, les fichiers SQL ne sont pas tous exécutés" : res.status === 401 ? " : clé publique incorrecte dans config.js" : ""));
  return res.json();
}
let rows, portfolio;
try {
  [rows, portfolio] = await Promise.all([
    rest("site_settings?select=content&id=eq.1"),
    rest("portfolio?select=*"),
  ]);
} catch (e) {
  // Le site est publié quand même, sans pages de séances : elles s'ouvrent dans l'accueil
  // (404.html les y renvoie). Avertissement visible dans l'onglet Actions.
  console.log("::warning::Contenu Supabase illisible (" + e.message + ") : site publié sans pages de séances. Vérifiez l'étape 3 du guide (les fichiers SQL) et config.js.");
  finish(merge({}), []);
  process.exit(0);
}
const content = (rows[0] && rows[0].content) || {};
const publicUrl = (p) => SB.url + "/storage/v1/object/public/portfolio/" + String(p).split("/").map(encodeURIComponent).join("/");
const lib = {};
portfolio.forEach((p) => { lib[p.storage_path] = p; });
const DEMO = new Set(fs.readdirSync(path.join(ROOT, "assets/img/demo")).map((f) => f.replace(/\.webp$/, "")));
const ssOf = (p) => (p.thumb_path && p.thumb_width && p.thumb_width < (p.width || 1200) ? publicUrl(p.thumb_path) + " " + p.thumb_width + "w, " + publicUrl(p.storage_path) + " " + (p.width || 1200) + "w" : "");
const imgOf = (r) => lib[r] ? { src: publicUrl(r), ss: ssOf(lib[r]), w: lib[r].width || 1200, h: lib[r].height || 800, alt: lib[r].caption || "", pos: lib[r].focus_x != null ? lib[r].focus_x + "% " + lib[r].focus_y + "%" : "" }
  : DEMO.has(r) ? { src: "assets/img/demo/" + r + ".webp", w: 1200, h: 800 } : null;

// Mêmes règles que site.js : séances visibles ; les séances d'exemple n'ont pas de page
const stories = (Array.isArray(content.stories) ? content.stories : []).filter((s) => s && s.id && s.show !== false && Array.isArray(s.photos) && s.photos.length);
const isDemo = (s) => s.demo || s.photos.some((r) => DEMO.has(r));
const href = (s) => isDemo(s) ? "index.html#seance-" + s.id : story.storyFile(s);

// 4. Une page par séance, à partir de index.html
function setMeta(html, attr, key, val) {
  const re = new RegExp('<meta ' + attr + '="' + key + '" content="[^"]*">');
  return re.test(html) ? html.replace(re, '<meta ' + attr + '="' + key + '" content="' + esc(val) + '">') : html;
}
const files = [];
stories.forEach((s, k) => {
  if (isDemo(s)) return;
  const pics = s.photos.map(imgOf).filter(Boolean);
  if (!pics.length) return;
  const nx = stories.length > 1 ? stories[(k + 1) % stories.length] : null;
  const file = story.storyFile(s), url = BASE + "/" + file, title = story.storyTitle(s), desc = story.storyDesc(s);
  let h = INDEX;
  h = h.replace(/<title>[^<]*<\/title>/, "<title>" + esc(title) + "</title>");
  h = setMeta(h, "name", "description", desc);
  h = setMeta(h, "property", "og:title", title);
  h = setMeta(h, "property", "og:description", desc);
  h = setMeta(h, "property", "og:url", url);
  h = setMeta(h, "property", "og:type", "article");
  h = setMeta(h, "property", "og:image", pics[0].src);
  h = setMeta(h, "name", "twitter:image", pics[0].src);
  h = h.replace(/<meta property="og:image:(width|height)" content="[^"]*">\n?/g, "");
  h = h.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + esc(url) + '">');
  const ld = {
    "@context": "https://schema.org", "@type": "ImageGallery", name: s.title, description: desc, url,
    image: pics.slice(0, 6).map((p) => p.src),
    contentLocation: s.place ? { "@type": "Place", name: s.place } : undefined,
    author: { "@type": "ProfessionalService", "@id": BASE + "/#lau-rie", name: "lau.rie", url: BASE + "/" },
  };
  h = h.replace(/(<script type="application\/ld\+json" id="ld">)[\s\S]*?(<\/script>)/, (m, a, b) => a + JSON.stringify(ld).replace(/</g, "\\u003c") + b);
  h = h.replace("<body>", '<body data-seance="' + esc(story.storyKey(s)) + '">');
  // Liens internes : vers l'accueil (sauf les symboles SVG <use href="#…">)
  h = h.replace(/(<a\b[^>]*?\shref=")#/g, "$1index.html#");
  h = h.replace('<a class="skip" href="index.html#contenu">', '<a class="skip" href="#st-body">');
  h = h.replace('<div id="v-home">', '<div id="v-home" hidden>').replace('<div id="v-story" hidden>', '<div id="v-story">');
  const nxImg = nx ? imgOf(nx.photos[0]) : null;
  h = h.replace('<main class="wrap story" id="st-body"></main>',
    '<main class="wrap story" id="st-body" tabindex="-1">' + story.storyHtml(s, pics, nx, nxImg, href, "index.html#contact") + "</main>");
  fs.writeFileSync(path.join(OUT, file), h);
  files.push({ file, title: s.title + (s.place ? ", " + String(s.kind || "").toLowerCase() + " à " + s.place : "") });
});
finish(merge(content), files, imgOf((content.slots && content.slots.hero1) || "veil"));
console.log(files.length + " page(s) de séance créée(s) : " + (files.map((f) => f.file).join(", ") || "aucune"));
