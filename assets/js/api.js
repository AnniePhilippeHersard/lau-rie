// Accès aux données : Supabase si configuré, sinon mode démonstration.
import { SUPABASE, SITE_URL } from "./config.js";

export const DEMO = !SUPABASE.url || !SUPABASE.anonKey;

let clientPromise = null;
export function getClient() {
  if (DEMO) return Promise.resolve(null);
  if (!clientPromise) {
    // supabase-js 2.45.4 hébergé avec le site (build UMD -> window.supabase)
    clientPromise = (window.supabase ? Promise.resolve() : loadScript(new URL("../vendor/supabase.min.js", import.meta.url).href))
      .then(() => window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey));
  }
  return clientPromise;
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Chargement impossible : ${src}`));
    document.head.append(s);
  });
}

export function publicUrl(bucket, path) {
  return `${SUPABASE.url.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${String(path).split("/").map(encodeURIComponent).join("/")}`;
}

// Adresse de base du site (sans « / » final), pour les liens et QR codes
export function siteBase() {
  if (SITE_URL) return SITE_URL.replace(/\/$/, "");
  return location.href.split("#")[0].split("?")[0].replace(/\/[^/]*$/, "");
}
export const galleryLink = (code) => `${siteBase()}/galerie.html${code ? "#k=" + encodeURIComponent(code) : ""}`;

// ---------------------------------------------------------------- contenu public
// Textes (site_settings), bibliothèque de photos (portfolio) et avis publiés.
export async function loadPublic() {
  if (DEMO) return { content: null, portfolio: [], reviews: null };
  // Lecture directe de l'API REST (sans charger supabase-js, 110 Ko, sur les pages publiques).
  // Les règles RLS ne laissent passer que le contenu public.
  const [s, p, r] = await Promise.all([
    rest("site_settings?select=content&id=eq.1"),
    rest("portfolio?select=id,storage_path,width,height,caption,category&order=position.asc,created_at.desc"),
    rest("reviews?select=id,who,ctx,body,image_path&order=position.asc,created_at.desc"),
  ]);
  return {
    content: s[0]?.content ?? null,
    portfolio: p.map((x) => ({ ...x, url: publicUrl("portfolio", x.storage_path) })),
    reviews: r,
  };
}
async function rest(q) {
  const res = await fetch(`${SUPABASE.url.replace(/\/$/, "")}/rest/v1/${q}`, {
    headers: { apikey: SUPABASE.anonKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Contenu indisponible (" + res.status + ")");
  return res.json();
}
export function libraryOf(portfolio) {
  const lib = {};
  portfolio.forEach((p) => { lib[p.storage_path] = p; });
  return lib;
}

// ---------------------------------------------------------------- fonction « gallery »
export async function callGallery(payload) {
  const res = await fetch(`${SUPABASE.url.replace(/\/$/, "")}/functions/v1/gallery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE.anonKey },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Connexion impossible. Vérifiez votre réseau et réessayez.");
    err.status = res.status;
    throw err;
  }
  return data;
}
