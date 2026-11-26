// Sauvegarde mensuelle : toutes les tables de la base dans un fichier JSON (chiffré ensuite par la tâche GitHub).
// Usage : SUPABASE_SERVICE_ROLE_KEY=… node tools/sauvegarde.mjs sauvegarde.json
// La clé secrète ne vient que des « secrets » GitHub ; elle n'est jamais écrite dans le dépôt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || "sauvegarde.json";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const cfg = fs.readFileSync(path.join(ROOT, "assets/js/config.js"), "utf8");
const URL_ = ((cfg.match(/\burl\s*:\s*"([^"]*)"/) || [])[1] || "").trim().replace(/\/(rest|auth|storage|functions)\/v1\/?$/i, "").replace(/\/+$/, "");

if (!URL_ || !KEY) {
  console.log("::notice::Sauvegarde non faite : config.js vide ou secret SUPABASE_SERVICE_ROLE_KEY absent (guide, « Sauvegarde automatique »).");
  process.exit(0);
}
// Nouvelles clés « sb_secret_… » : en-tête apikey seul ; anciennes clés JWT : apikey + Authorization
const headers = KEY.startsWith("sb_secret_") ? { apikey: KEY } : { apikey: KEY, Authorization: "Bearer " + KEY };

async function all(table) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*&offset=${i}&limit=1000`, { headers: { ...headers, Accept: "application/json" } });
    if (res.status === 404) return null; // table pas encore créée (migration non faite)
    if (!res.ok) throw new Error(table + " : " + res.status + " " + (await res.text()).slice(0, 200));
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const TABLES = ["site_settings", "site_history", "galleries", "photos", "selections", "reviews", "booking_requests", "portfolio", "bookings", "photo_favs", "trash", "quotes", "admins"];
const data = { app: "lau.rie", format: 1, created_at: new Date().toISOString(), tables: {} };
for (const t of TABLES) {
  const rows = await all(t);
  if (rows) data.tables[t] = rows;
}
fs.writeFileSync(OUT, JSON.stringify(data));
console.log("Sauvegarde : " + Object.entries(data.tables).map(([t, r]) => t + " " + r.length).join(", "));
