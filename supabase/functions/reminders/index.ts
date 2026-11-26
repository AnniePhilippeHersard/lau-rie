// Edge Function « reminders » : rappel aux clients avant la fermeture de leur galerie.
//
// Appelée une fois par jour par Supabase Cron (Integrations → Cron) avec l'en-tête
//   x-cron-secret: <CRON_SECRET>
// Pour chaque galerie en ligne dont le rappel est activé et dont la date de fermeture
// approche (remind_days jours avant), envoie un e-mail aux clients puis note la date d'envoi.
//
// Secrets : CRON_SECRET, RESEND_API_KEY, REMIND_FROM (adresse d'un domaine vérifié chez Resend,
// ex. « lau.rie <bonjour@lau-rie.fr> »), SITE_URL (ex. https://lau-rie.fr).
// Déploiement : supabase functions deploy reminders --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const DEFAULT_SUBJ = "Votre galerie ferme le {date}";
const DEFAULT_BODY = "Bonjour {clients},\n\nVotre galerie reste en ligne jusqu'au {date}. Pensez à télécharger vos photos préférées en haute définition avant cette date.\n\nLien : {lien}\nCode : {code}\n\nUne question ? Répondez simplement à cet e-mail.\n\nÀ bientôt,\nlau.rie";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  const given = req.headers.get("x-cron-secret") ?? "";
  if (secret.length < 16 || !safeEqual(given, secret)) return json({ error: "Accès refusé" }, 401);

  const { data: settings } = await supabase.from("site_settings").select("content").eq("id", 1).maybeSingle();
  const c = (settings?.content ?? {}) as Record<string, string>;
  // Ménage, même sans e-mails branchés : aperçus des galeries fermées depuis longtemps
  const archived = await purgeOld(c);

  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("REMIND_FROM");
  if (!key || !from) return json({ error: "RESEND_API_KEY et REMIND_FROM sont nécessaires", archived }, 503);
  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
  const subjTpl = c.mailSubj || DEFAULT_SUBJ;
  const bodyTpl = c.mailBody || DEFAULT_BODY;

  const now = new Date();
  const { data: rows, error } = await supabase.from("galleries")
    .select("id, title, client_name, client_email, owner_code, expires_at, remind_days")
    .eq("status", "published").eq("remind", true).is("reminded_at", null)
    .not("client_email", "is", null).not("expires_at", "is", null)
    .gt("expires_at", now.toISOString());
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  const failed: string[] = [];
  for (const g of rows ?? []) {
    const exp = new Date(g.expires_at);
    const sendFrom = new Date(exp.getTime() - (g.remind_days ?? 30) * 864e5);
    if (now < sendFrom) continue;

    const date = exp.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
    const link = `${site}/galerie.html${g.owner_code ? "#k=" + encodeURIComponent(g.owner_code) : ""}`;
    const fill = (s: string) => s
      .replace(/\{clients\}/g, g.client_name || g.title)
      .replace(/\{date\}/g, date)
      .replace(/\{lien\}/g, link)
      .replace(/\{code\}/g, g.owner_code ?? "");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: g.client_email,
        subject: fill(subjTpl).replace(/[\r\n\t]+/g, " "),
        text: fill(bodyTpl),
        html: `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1B1A17">${esc(fill(bodyTpl)).replace(/\n/g, "<br>")}</div>`,
        ...(c.mail && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(c.mail) ? { reply_to: c.mail } : {}),
      }),
    });
    if (!res.ok) {
      failed.push(g.title);
      console.error("rappel", g.id, res.status, await res.text().catch(() => ""));
      continue;
    }
    await supabase.from("galleries").update({ reminded_at: now.toISOString() }).eq("id", g.id);
    sent++;
  }
  return json({ ok: true, sent, failed, archived });
});

// Galeries fermées depuis plus de « purgeMonths » mois (réglage de l'espace photographe,
// 3 par défaut, 0 = jamais) : aperçus et miniatures supprimés, la fiche reste (archived_at).
// La photographe peut rouvrir la galerie en réimportant le même dossier depuis Lightroom.
async function purgeOld(c: Record<string, unknown>) {
  const months = c.purgeMonths == null || c.purgeMonths === "" ? 3 : Number(c.purgeMonths);
  if (!Number.isFinite(months) || months <= 0) return 0;
  const limit = new Date();
  limit.setMonth(limit.getMonth() - months);
  const { data: gs, error } = await supabase.from("galleries").select("id")
    .is("archived_at", null).not("expires_at", "is", null).lt("expires_at", limit.toISOString()).limit(20);
  if (error) return 0; // 7e migration pas encore exécutée
  let n = 0;
  for (const g of gs ?? []) {
    const { data: ph, error: pe } = await supabase.from("photos").select("preview_path, thumb_path").eq("gallery_id", g.id);
    if (pe) continue;
    const files = (ph ?? []).flatMap((p) => [p.preview_path, p.thumb_path]).filter(Boolean) as string[];
    let ok = true;
    for (let i = 0; i < files.length && ok; i += 100) {
      const { error: re } = await supabase.storage.from("galleries").remove(files.slice(i, i + 100));
      if (re) { ok = false; console.error("ménage", g.id, re.message); }
    }
    if (!ok) continue;
    await supabase.from("galleries").update({ archived_at: new Date().toISOString() }).eq("id", g.id);
    n++;
  }
  return n;
}
