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
    '<div class="st-grid">' + pics.map((d, i) => '<figure class="rv on"><div class="ph"><img src="' + esc(d.src) + '"' + (d.ss ? ' srcset="' + esc(d.ss) + '" sizes="' + (i ? "(max-width: 760px) 100vw, 50vw" : "(max-width: 760px) 100vw, 66vw") + '"' : "") + ' width="' + d.w + '" height="' + d.h + '"' + (d.pos ? ' style="object-position:' + esc(d.pos) + '"' : "") + ' alt="' + esc(d.alt || s.title + ", photo " + (i + 1)) + '"' + (i ? ' loading="lazy"' : "") + "></div></figure>").join("") + "</div>" +
    '<div class="st-end">' + (nx ? '<a class="st-next" href="' + esc(href(nx)) + '"><div class="ph">' + (nxImg ? '<img alt="" loading="lazy" src="' + esc(nxImg.src) + '"' + (nxImg.ss ? ' srcset="' + esc(nxImg.ss) + '" sizes="(max-width: 760px) 100vw, 33vw"' : "") + ">" : "") + '</div><div><span>Séance suivante</span><b>' + esc(nx.title) + "</b></div></a>" : "") +
    '<div class="st-cta"><p>Une histoire à raconter ?</p><a class="btn" href="' + esc(contactHref || "#contact") + '">Parlons de votre séance</a></div></div>';
}

// Fiche « entreprise » lue par Google et les assistants IA (schema.org), partagée par le site
// et par la création des pages. site : contenu du site (textes, tarifs, légal) ; base : adresse officielle.
export function businessLd(site, base) {
  const S = site || {}, L = S.legal || {}, root = String(base || "").replace(/\/+$/, "");
  const ps = (S.prices || []).map((x) => Number(x.price)).filter((n) => n > 0);
  const ig = S.ig && !/^https?:\/\/(www\.)?instagram\.com\/?$/i.test(S.ig) ? S.ig : null;
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": root + "/#lau-rie",
    name: "lau.rie",
    description: S.seoDesc || undefined,
    url: root + "/",
    email: S.mail || undefined,
    telephone: L.phone || undefined,
    image: root + "/partage.jpg",
    logo: root + "/icon-512.png",
    address: { "@type": "PostalAddress", addressLocality: S.city || "Nantes", addressRegion: "Pays de la Loire", addressCountry: "FR" },
    areaServed: String(S.area || "").split(/\s*,\s*/).filter(Boolean).map((name) => ({ "@type": "Place", name })),
    knowsAbout: ["Photographie de mariage", "Reportage de mariage", "Photographie de famille", "Portrait en lumière naturelle"],
    founder: L.owner ? { "@type": "Person", name: L.owner, jobTitle: "Photographe" } : undefined,
    priceRange: ps.length ? Math.min(...ps) + " € – " + Math.max(...ps) + " €" : undefined,
    currenciesAccepted: "EUR",
    hasOfferCatalog: (S.prices || []).length ? {
      "@type": "OfferCatalog", name: "Séances photo",
      itemListElement: S.prices.map((x) => ({ "@type": "Offer", name: x.name, description: x.detail || undefined, price: Number(x.price) || undefined, priceCurrency: "EUR", itemOffered: { "@type": "Service", name: "Séance photo " + String(x.name).toLowerCase() } })),
    } : undefined,
    sameAs: ig ? [ig] : undefined,
  };
}
