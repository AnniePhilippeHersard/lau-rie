// =====================================================================
//  Connexion du site à Supabase : les deux seules lignes à remplir
//  (voir le guide, étape 6). Laisser vide = mode démonstration.
// =====================================================================
// La clé « publishable / anon » est publique par conception : la sécurité repose
// sur les règles de la base (RLS) et sur les fonctions, pas sur le secret de cette clé.
// Ne jamais coller ici la clé « secret » ou « service_role ».
export const SUPABASE = {
  url: "",      // ex. "https://abcdefgh.supabase.co"
  anonKey: "",  // ex. "sb_publishable_…" ou la clé « anon public »
};

// Adresse publique du site, utilisée dans les liens et QR codes des galeries.
// Laisser vide : l'adresse actuelle du site est utilisée automatiquement.
export const SITE_URL = ""; // ex. "https://lau-rie.fr"
