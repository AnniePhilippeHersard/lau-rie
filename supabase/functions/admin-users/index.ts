// Edge Function « admin-users » : gestion des comptes administrateurs depuis l'admin,
// sans passer par le tableau de bord Supabase ni par l'envoi d'emails.
//
//  POST { action: "create",         email, password }   -> crée le compte et le rend admin
//  POST { action: "reset_password", user_id, password } -> définit un mot de passe provisoire
//  POST { action: "remove",         user_id }           -> retire et supprime le compte
//  POST { action: "send_gallery",   gallery_id, subject, text } -> envoie le lien de la galerie aux clients
//       (Resend : RESEND_API_KEY et REMIND_FROM, ou à défaut NOTIFY_FROM ; destinataire = e-mail enregistré)
//
// L'appelant doit être connecté ET admin (JWT vérifié, puis table public.admins).
// Déploiement : supabase functions deploy admin-users --no-verify-jwt
// (le jeton est vérifié ci-dessous via auth.getUser, compatible clés legacy et nouvelles clés)

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function corsHeaders(origin: string): Record<string, string> {
  const allow = ALLOWED_ORIGINS.includes("*")
    ? "*"
    : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const validPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 12 && p.length <= 128;

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405, headers);

  // 1. Identifier l'appelant à partir de son jeton de session
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Session expirée, reconnectez-vous." }, 401, headers);
  const { data: auth, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !auth.user) return json({ error: "Session expirée, reconnectez-vous." }, 401, headers);
  const caller = auth.user;

  // 2. Vérifier qu'il est administrateur
  const { data: isAdmin } = await supabase.from("admins").select("user_id").eq("user_id", caller.id).maybeSingle();
  if (!isAdmin) return json({ error: "Accès réservé aux administrateurs" }, 403, headers);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requête invalide" }, 400, headers);
  }

  try {
    switch (body.action) {
      case "create": {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!EMAIL.test(email) || email.length > 200) return json({ error: "Email invalide" }, 400, headers);
        if (!validPassword(body.password)) return json({ error: "Mot de passe : 12 caractères minimum" }, 400, headers);

        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: body.password,
          email_confirm: true, // pas d'email de confirmation à envoyer
        });
        if (error) {
          const exists = /already|registered|exists/i.test(error.message);
          return json({ error: exists ? "Un compte existe déjà avec cet email" : error.message }, 400, headers);
        }
        const { error: insErr } = await supabase.from("admins").insert({ user_id: data.user.id });
        if (insErr) {
          await supabase.auth.admin.deleteUser(data.user.id);
          throw insErr;
        }
        return json({ ok: true, user_id: data.user.id }, 200, headers);
      }

      case "reset_password": {
        const id = String(body.user_id ?? "");
        if (!UUID.test(id)) return json({ error: "Compte invalide" }, 400, headers);
        if (!validPassword(body.password)) return json({ error: "Mot de passe : 12 caractères minimum" }, 400, headers);
        const { data: target } = await supabase.from("admins").select("user_id").eq("user_id", id).maybeSingle();
        if (!target) return json({ error: "Ce compte n'est pas administrateur" }, 404, headers);
        const { error } = await supabase.auth.admin.updateUserById(id, { password: body.password });
        if (error) throw error;
        return json({ ok: true }, 200, headers);
      }

      case "remove": {
        const id = String(body.user_id ?? "");
        if (!UUID.test(id)) return json({ error: "Compte invalide" }, 400, headers);
        if (id === caller.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte" }, 400, headers);
        const { count } = await supabase.from("admins").select("user_id", { count: "exact", head: true });
        if ((count ?? 0) <= 1) return json({ error: "Il doit rester au moins un administrateur" }, 400, headers);
        const { data: target } = await supabase.from("admins").select("user_id").eq("user_id", id).maybeSingle();
        if (!target) return json({ error: "Ce compte n'est pas administrateur" }, 404, headers);
        await supabase.from("admins").delete().eq("user_id", id);
        const { error } = await supabase.auth.admin.deleteUser(id);
        if (error) throw error;
        return json({ ok: true }, 200, headers);
      }

      case "send_gallery": {
        const id = String(body.gallery_id ?? "");
        if (!UUID.test(id)) return json({ error: "Galerie invalide" }, 400, headers);
        const subject = typeof body.subject === "string" ? body.subject.trim() : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!subject || subject.length > 200) return json({ error: "Objet : entre 1 et 200 caractères." }, 400, headers);
        if (!text || text.length > 5000) return json({ error: "Message : entre 1 et 5 000 caractères." }, 400, headers);
        const key = Deno.env.get("RESEND_API_KEY");
        const from = Deno.env.get("REMIND_FROM") ?? Deno.env.get("NOTIFY_FROM");
        if (!key || !from) {
          return json({ error: "Les e-mails automatiques ne sont pas encore branchés (guide, étape 10). En attendant, utilisez « Copier le message »." }, 503, headers);
        }
        // Le destinataire vient de la base, jamais de la requête : pas d'envoi vers une adresse arbitraire
        const { data: g } = await supabase.from("galleries").select("client_email, status").eq("id", id).maybeSingle();
        if (!g) return json({ error: "Galerie introuvable" }, 404, headers);
        if (!g.client_email || !EMAIL.test(g.client_email)) return json({ error: "Ajoutez l'e-mail des clients, puis enregistrez." }, 400, headers);
        if (g.status !== "published") return json({ error: "Mettez d'abord la galerie en ligne (« Galerie visible par les clients »), puis enregistrez." }, 400, headers);
        const { data: st } = await supabase.from("site_settings").select("content").eq("id", 1).maybeSingle();
        const replyTo = (st?.content as { mail?: string } | null)?.mail;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: g.client_email,
            subject,
            text,
            html: `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1B1A17">${esc(text).replace(/\n/g, "<br>")}</div>`,
            ...(replyTo && EMAIL.test(replyTo) ? { reply_to: replyTo } : {}),
          }),
        });
        if (!res.ok) {
          console.error("envoi galerie", id, res.status, await res.text().catch(() => ""));
          return json({ error: "Le service d'envoi a refusé l'e-mail (" + res.status + "). Vérifiez le domaine chez Resend, ou utilisez « Copier le message »." }, 502, headers);
        }
        const sent = new Date().toISOString();
        await supabase.from("galleries").update({ link_sent_at: sent }).eq("id", id);
        return json({ ok: true, to: g.client_email, sent_at: sent }, 200, headers);
      }

      default:
        return json({ error: "Action inconnue" }, 400, headers);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Erreur serveur" }, 500, headers);
  }
});
