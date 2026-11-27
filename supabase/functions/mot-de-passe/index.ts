// Edge Function « mot-de-passe » : e-mail « mot de passe oublié » de l'espace photographe,
// envoyé par Resend depuis l'adresse du site (et non par le service d'e-mail de Supabase).
//
//  POST { email } -> si l'adresse est celle d'une administratrice, lui envoie un lien
//                    https://<site>/admin.html#reset=<jeton> ; la réponse est toujours la même,
//                    que le compte existe ou non (rien à deviner de l'extérieur).
//
// Le lien ne pointe que vers l'adresse officielle du site : SITE_URL, sinon la première
// adresse de ALLOWED_ORIGINS. Jamais une adresse fournie par la requête.
// Secrets utilisés : RESEND_API_KEY, REMIND_FROM (ou NOTIFY_FROM), SITE_URL ou ALLOWED_ORIGINS.
// Limites : 5 demandes par heure et par adresse IP, 3 par heure et par e-mail.
// Déploiement : supabase functions deploy mot-de-passe --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 5, MAX_PER_EMAIL = 3;
const RESEND_URL = Deno.env.get("RESEND_API_URL") ?? "https://api.resend.com/emails"; // remplaçable pour les tests

function corsHeaders(origin: string): Record<string, string> {
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// Adresse du visiteur posée par le proxy de Supabase (comme la fonction gallery)
function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  if (cf) return cf.trim().slice(0, 64);
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (xff[xff.length - 1] ?? "inconnue").slice(0, 64);
}

// Adresse officielle du site, d'où part le lien de l'e-mail
function siteBase(): string {
  const env = (Deno.env.get("SITE_URL") ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[^\s/]+$/.test(env)) return env;
  const first = ALLOWED_ORIGINS.find((o) => /^https:\/\/[^\s/]+$/.test(o));
  return first ?? "";
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const OK = { ok: true, message: "Si ce compte existe, un e-mail vient d'être envoyé." };

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405, headers);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Requête invalide" }, 400, headers); }

  // Vérification de l'écran « Santé du site » : réglages présents, aucune donnée renvoyée
  if (body.action === "health") {
    return json({ ok: true, site: Boolean(siteBase()), mails: Boolean(Deno.env.get("RESEND_API_KEY") && (Deno.env.get("REMIND_FROM") ?? Deno.env.get("NOTIFY_FROM"))) }, 200, headers);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 200) return json({ error: "Entrez votre adresse e-mail complète." }, 400, headers);

  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("REMIND_FROM") ?? Deno.env.get("NOTIFY_FROM");
  const base = siteBase();
  // Réglage manquant : l'espace photographe repasse par l'e-mail de Supabase
  if (!key || !from || !base) return json({ error: "Envoi indisponible", fallback: true }, 503, headers);

  try {
    // Anti-abus : par adresse IP et par e-mail (l'e-mail n'est conservé que sous forme d'empreinte)
    const ip = clientIp(req);
    const tag = "reset:" + await sha(email);
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const [{ count: byIp }, { count: byMail }] = await Promise.all([
      supabase.from("access_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).like("slug", "reset:%").gte("created_at", since),
      supabase.from("access_attempts").select("id", { count: "exact", head: true }).eq("slug", tag).gte("created_at", since),
    ]);
    if ((byIp ?? 0) >= MAX_PER_IP || (byMail ?? 0) >= MAX_PER_EMAIL) {
      return json({ error: "Plusieurs demandes viennent d'être faites. Réessayez dans une heure." }, 429, headers);
    }
    await supabase.from("access_attempts").insert({ ip, slug: tag, success: true });

    // Lien de réinitialisation : seulement pour un compte administrateur
    const { data: link, error } = await supabase.auth.admin.generateLink({ type: "recovery", email });
    if (error || !link?.user || !link.properties?.hashed_token) return json(OK, 200, headers);
    const { data: admin } = await supabase.from("admins").select("user_id").eq("user_id", link.user.id).maybeSingle();
    if (!admin) return json(OK, 200, headers);

    const url = base + "/admin.html#reset=" + encodeURIComponent(link.properties.hashed_token);
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: email,
        subject: "Choisir un nouveau mot de passe",
        html: mailHtml(url),
        text: "Bonjour,\n\nVous avez demandé à changer le mot de passe de votre espace photographe lau.rie.\n\n" +
          "Ouvrez ce lien pour en choisir un nouveau (valable une heure, une seule fois) :\n" + url +
          "\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.\n\nlau.rie",
      }),
    });
    if (!res.ok) console.error("e-mail refusé", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return json(OK, 200, headers);
  } catch (e) {
    console.error("mot-de-passe", e);
    return json({ error: "Envoi impossible pour le moment. Réessayez dans quelques minutes.", fallback: true }, 500, headers);
  }
});

// E-mail aux couleurs du site (styles en ligne : seuls compris par toutes les messageries)
function mailHtml(url: string): string {
  const u = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#F2EFE9;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:#1B1A17">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FAF8F4;border-radius:6px">
<tr><td style="padding:36px 32px 8px;font-size:30px;line-height:1">lau.rie</td></tr>
<tr><td style="padding:16px 32px 0;font-size:24px;line-height:1.2">Choisir un nouveau <em>mot de passe</em></td></tr>
<tr><td style="padding:16px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1B1A17">Vous avez demandé à changer le mot de passe de votre espace photographe. Ce lien est valable une heure et ne fonctionne qu'une fois.</td></tr>
<tr><td style="padding:28px 32px"><a href="${u}" style="display:inline-block;background:#1B1A17;color:#F2EFE9;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;padding:14px 26px;border-radius:999px">Choisir mon mot de passe</a></td></tr>
<tr><td style="padding:0 32px 36px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#57534B">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.</td></tr>
</table></td></tr></table></body></html>`;
}
