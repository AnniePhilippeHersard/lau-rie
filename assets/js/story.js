// Page d'une séance : balisage et adresses partagés par le site (site.js)
// et par la création des pages pour Google (tools/pages-seo.mjs).
// Aucune dépendance au navigateur ni import : ce fichier tourne aussi dans Node.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// « Léa & Thomas » -> « lea-thomas »
export function slugify(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// Nom de la page : seance-lea-thomas-lt-7k2q (titre lisible + identifiant stable)
export function storyKey(s) {
  const t = slugify(s.title), id = slugify(s.id);
  return t && t !== id ? t + "-" + id : id;
}
export const storyFile = (s) => "seance-" + storyKey(s) + ".html";

// Retrouve une séance depuis une adresse, même si son titre a changé depuis
export function findStory(list, key) {
  key = String(key || "").toLowerCase();
  return list.find((s) => s.id === key || storyKey(s) === key) ||
    list.find((s) => key.endsWith("-" + slugify(s.id)));
}

export function storyTitle(s) {
  return s.title + ", " + String(s.kind || "séance").toLowerCase() + (s.place ? " à " + s.place : "") + " · lau.rie";
}
export function storyDesc(s) {
  const t = String(s.text || "").replace(/\s+/g, " ").trim();
  const head = [s.kind, s.place, s.when].filter(Boolean).join(", ");
  const d = (head ? head + ". " : "") + t;
  return d.length > 160 ? d.slice(0, 157).replace(/\s+\S*$/, "") + "…" : d;
}

// pics : [{ src, w, h, alt }] ; nx / nxImg : séance suivante et sa photo ; href(s) : lien vers une séance
export function storyHtml(s, pics, nx, nxImg, href, contactHref) {
  return '<header class="st-head"><div><h1 class="serif">' + esc(s.title) + '</h1><p class="st-meta">' + [s.kind, s.place, s.when].filter(Boolean).map(esc).join(" · ") + '</p></div><p class="st-lede">' + esc(s.text) + "</p></header>" +
    '<div class="st-grid">' + pics.map((d, i) => '<figure class="rv on"><div class="ph"><img src="' + esc(d.src) + '" width="' + d.w + '" height="' + d.h + '" alt="' + esc(d.alt || s.title + ", photo " + (i + 1)) + '"' + (i ? ' loading="lazy"' : "") + "></div></figure>").join("") + "</div>" +
    '<div class="st-end">' + (nx ? '<a class="st-next" href="' + esc(href(nx)) + '"><div class="ph">' + (nxImg ? '<img alt="" src="' + esc(nxImg.src) + '">' : "") + '</div><div><span>Séance suivante</span><b>' + esc(nx.title) + "</b></div></a>" : "") +
    '<div class="st-cta"><p>Une histoire à raconter ?</p><a class="btn" href="' + esc(contactHref || "#contact") + '">Parlons de votre séance</a></div></div>';
}
