// Edge Function « gallery » : seule porte d'entrée des visiteurs vers les données privées.
//
//  POST { action: "open",    code }                                   -> galerie, photos (URL signées), rôle
//  POST { action: "select",  code, photo_ids[], notes?{id: texte} }   -> sélection des clients (mariés)
//  POST { action: "hide",    code, photo_id, hidden }                 -> masquer une photo aux invités (mariés)
//  POST { action: "review",  code, who, text, private }               -> avis des clients, relu avant publication
//  POST { action: "fav",     code, visitor, photo_ids[] }             -> cœurs d'un visiteur, comptés anonymement
//  POST { action: "contact", name, email, kind?, when?, message, website? } -> formulaire de contact du site
//
// Deux codes par galerie : celui des clients (« owner ») et celui de leurs invités (« guest »).
// Les invités ne voient pas les photos masquées, ne peuvent ni envoyer de sélection ni écrire d'avis.
// Le bucket « galleries » est privé : les visiteurs ne reçoivent que des URL signées (3 h).
// Anti force brute : 10 codes faux par adresse IP en 15 minutes, 5 messages de contact par heure.
// Déploiement : supabase functions deploy gallery --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
const URL_TTL = 60 * 60 * 3;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS_ALL = 200;           // plafond global (attaque répartie sur beaucoup d'adresses)
const MAX_CONTACTS = 5;
const MAX_CONTACTS_ALL = 40;
const CONTACT_WINDOW_MS = 60 * 60_000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Adresse du visiteur : celle posée par le proxy de Supabase (Cloudflare), jamais celle
// que le navigateur pourrait inventer en tête de X-Forwarded-For.
function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  if (cf) return cf.trim().slice(0, 64);
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (xff[xff.length - 1] ?? "inconnue").slice(0, 64);
}

const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max ? v.trim() : null;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405, headers);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requête invalide" }, 400, headers);
  }
  const ip = clientIp(req);

  try {
    if (body.action === "contact") {
      const r = await contact(body, ip);
      return json(r.body, r.status, headers);
    }

    const code = str(body.code, 64);
    if (!code) return json({ error: "Entrez le code reçu avec votre lien." }, 400, headers);

    // Trop d'échecs récents depuis cette adresse -> 429
    const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
    // Les deux compteurs et la recherche du code partent en même temps
    const [mine, all, found] = await Promise.all([
      supabase.from("access_attempts").select("id", { count: "exact", head: true })
        .eq("ip", ip).eq("success", false).eq("slug", "code").gte("created_at", since),
      supabase.from("access_attempts").select("id", { count: "exact", head: true })
        .eq("success", false).eq("slug", "code").gte("created_at", since),
      supabase.rpc("gallery_by_code", { p_code: code }),
    ]);
    if ((mine.count ?? 0) >= MAX_FAILS || (all.count ?? 0) >= MAX_FAILS_ALL) {
      return json({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429, headers);
    }
    const { data: rows, error } = found;
    if (error) throw error;
    const hit = (rows ?? [])[0] as { gallery_id: string; role: "owner" | "guest"; state: string } | undefined;
    await supabase.from("access_attempts").insert({ ip, slug: "code", success: Boolean(hit) });
    if (!hit) {
      return json({ error: "Ce code ne correspond à aucune galerie. Vérifiez-le ou demandez-le à votre photographe." }, 401, headers);
    }
    if (hit.state === "draft") {
      return json({ error: "Cette galerie n'est pas encore en ligne. Votre photographe vous préviendra dès qu'elle sera prête." }, 403, headers);
    }
    if (hit.state === "expired") {
      return json({ error: "Cette galerie est fermée. Écrivez à votre photographe si vous avez besoin de vos photos." }, 410, headers);
    }

    const owner = hit.role === "owner";
    const gid = hit.gallery_id;
    switch (body.action) {
      case "open":
        return json(await openGallery(gid, hit.role), 200, headers);
      case "select": {
        if (!owner) return json({ error: "Seuls les clients peuvent envoyer la sélection." }, 403, headers);
        const r = await saveSelection(gid, body);
        return json(r.body, r.status, headers);
      }
      case "hide": {
        if (!owner) return json({ error: "Action réservée aux clients." }, 403, headers);
        const pid = str(body.photo_id, 40);
        if (!pid || !UUID.test(pid)) return json({ error: "Photo inconnue" }, 400, headers);
        const { error: e } = await supabase.from("photos")
          .update({ hidden_from_guests: body.hidden === true }).eq("id", pid).eq("gallery_id", gid);
        if (e) throw e;
        return json({ ok: true }, 200, headers);
      }
      case "fav": {
        const r = await saveFavs(gid, hit.role, body);
        return json(r.body, r.status, headers);
      }
      case "review": {
        if (!owner) return json({ error: "Action réservée aux clients." }, 403, headers);
        const r = await saveReview(gid, body);
        return json(r.body, r.status, headers);
      }
      default:
        return json({ error: "Action inconnue" }, 400, headers);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Erreur serveur, réessayez dans un instant." }, 500, headers);
  }
});

async function openGallery(gid: string, role: "owner" | "guest") {
  const owner = role === "owner";
  const { data: g, error } = await supabase
    .from("galleries")
    .select("title, kind, client_name, event_date, allow_download, allow_selection, selection_limit, expires_at, cover_photo_id, delivery_url, delivery_expires_at, owner_code, guest_code, guest_hd, visits")
    .eq("id", gid).single();
  if (error) throw error;

  let q = supabase.from("photos")
    .select("id, filename, width, height, preview_path, collection, hidden_from_guests")
    .eq("gallery_id", gid);
  if (!owner) q = q.eq("hidden_from_guests", false);
  // Photos, dernière sélection, avis et compteur de visites : en parallèle
  const [{ data: photos, error: pErr }, sel, rev] = await Promise.all([
    q.order("position").order("created_at"),
    owner
      ? supabase.from("selections").select("photo_ids, notes, created_at").eq("gallery_id", gid)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    owner ? supabase.from("reviews").select("who, body, is_private, status").eq("gallery_id", gid).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("galleries").update({ visits: (g.visits ?? 0) + 1 }).eq("id", gid),
  ]);
  if (pErr) throw pErr;

  const list = photos ?? [];
  const paths = list.map((p) => p.preview_path);
  const bucket = supabase.storage.from("galleries");
  const [pv, dl] = paths.length
    ? await Promise.all([
      bucket.createSignedUrls(paths, URL_TTL),
      g.allow_download ? bucket.createSignedUrls(paths, URL_TTL, { download: true }) : Promise.resolve({ data: [] }),
    ])
    : [{ data: [] }, { data: [] }];
  const previews = pv.data ?? [], downloads = dl.data ?? [];
  const last = sel.data ?? null, review = rev.data ?? null;

  const coverIdx = Math.max(0, list.findIndex((p) => p.id === g.cover_photo_id));
  const hd = owner || g.guest_hd;
  return {
    role,
    gallery: {
      title: g.title,
      kind: g.kind,
      client_name: g.client_name,
      event_date: g.event_date,
      allow_download: g.allow_download,
      allow_selection: owner && g.allow_selection,
      selection_limit: owner ? g.selection_limit : null,
      expires_at: g.expires_at,
      cover: previews[coverIdx]?.signedUrl ?? null,
      delivery_url: hd ? g.delivery_url : null,
      delivery_expires_at: hd ? g.delivery_expires_at : null,
      hd_for_guests: g.guest_hd,
      // Les clients voient le code à transmettre à leurs invités
      guest_code: owner ? g.guest_code : null,
    },
    photos: list.map((p, i) => ({
      id: p.id,
      filename: p.filename,
      width: p.width,
      height: p.height,
      collection: p.collection,
      hidden: owner ? p.hidden_from_guests : false,
      preview: previews[i]?.signedUrl ?? null,
      download: downloads[i]?.signedUrl ?? null,
    })),
    last_selection: last,
    review,
  };
}

async function saveSelection(gid: string, body: Record<string, unknown>) {
  const ids = Array.isArray(body.photo_ids)
    ? [...new Set(body.photo_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)))]
    : [];
  if (!ids.length || ids.length > 5000) return { status: 400, body: { error: "Sélection vide" } };

  const { data: g } = await supabase.from("galleries")
    .select("title, client_name, allow_selection, selection_limit, notify").eq("id", gid).single();
  if (!g?.allow_selection) return { status: 403, body: { error: "La sélection n'est pas ouverte sur cette galerie." } };
  if (g.selection_limit && ids.length > g.selection_limit) {
    return { status: 400, body: { error: `Maximum ${g.selection_limit} photos.` } };
  }
  // Toutes les photos doivent appartenir à la galerie (par lots : l'URL reste courte)
  const counts = await Promise.all(Array.from({ length: Math.ceil(ids.length / 500) }, (_, k) =>
    supabase.from("photos").select("id", { count: "exact", head: true })
      .eq("gallery_id", gid).in("id", ids.slice(k * 500, k * 500 + 500))));
  if (counts.reduce((n, c) => n + (c.count ?? 0), 0) !== ids.length) return { status: 400, body: { error: "Sélection invalide" } };

  // Notes pour la retouche : seulement sur les photos choisies, 200 caractères chacune
  const notes: Record<string, string> = {};
  if (body.notes && typeof body.notes === "object") {
    for (const [k, v] of Object.entries(body.notes as Record<string, unknown>)) {
      const t = str(v, 200);
      if (t && ids.includes(k)) notes[k] = t;
    }
  }

  const { error } = await supabase.from("selections").insert({
    gallery_id: gid,
    client_name: (g.client_name || g.title).slice(0, 120),
    photo_ids: ids,
    notes: Object.keys(notes).length ? notes : null,
  });
  if (error) throw error;
  // Une nouvelle sélection repasse la galerie en « Sélection reçue »
  await supabase.from("galleries").update({ treated_at: null }).eq("id", gid);

  if (g.notify) {
    const n = Object.keys(notes).length;
    await notify(`Nouvelle sélection : ${g.title} (${ids.length} photos)`,
      `<p><strong>${esc(g.title)}</strong> a envoyé une sélection de <strong>${ids.length}</strong> photos` +
      (n ? `, dont ${n} avec une note pour la retouche` : "") + ".</p><p>Retrouvez-la dans votre espace photographe.</p>");
  }
  return { status: 200, body: { ok: true, count: ids.length } };
}

// Cœurs d'un visiteur (clients ou invités), comptés de façon anonyme pour la photographe.
// Le navigateur envoie la liste complète de ses favorites : elle remplace la précédente.
const VISITOR = /^[a-z0-9-]{16,64}$/;
async function saveFavs(gid: string, role: "owner" | "guest", body: Record<string, unknown>) {
  const visitor = str(body.visitor, 64)?.toLowerCase() ?? "";
  if (!VISITOR.test(visitor)) return { status: 400, body: { error: "Requête invalide" } };
  const ids = Array.isArray(body.photo_ids)
    ? [...new Set(body.photo_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)))]
    : [];
  if (ids.length > 5000) return { status: 400, body: { error: "Requête invalide" } };
  if (ids.length) {
    // Photos de cette galerie uniquement ; les invités ne peuvent pas aimer une photo masquée
    const counts = await Promise.all(Array.from({ length: Math.ceil(ids.length / 500) }, (_, k) => {
      let q = supabase.from("photos").select("id", { count: "exact", head: true })
        .eq("gallery_id", gid).in("id", ids.slice(k * 500, k * 500 + 500));
      if (role === "guest") q = q.eq("hidden_from_guests", false);
      return q;
    }));
    if (counts.reduce((n, c) => n + (c.count ?? 0), 0) !== ids.length) return { status: 400, body: { error: "Requête invalide" } };
  }
  const { error: dErr } = await supabase.from("photo_favs").delete().eq("gallery_id", gid).eq("visitor", visitor);
  if (dErr) throw dErr;
  if (ids.length) {
    const { error } = await supabase.from("photo_favs")
      .insert(ids.map((photo_id) => ({ gallery_id: gid, photo_id, visitor, role })));
    if (error) throw error;
  }
  return { status: 200, body: { ok: true } };
}

async function saveReview(gid: string, body: Record<string, unknown>) {
  const who = str(body.who, 120);
  const text = str(body.text, 600);
  const isPrivate = body.private === true;
  if (!who) return { status: 400, body: { error: "Indiquez vos prénoms." } };
  if (!text || text.length < 10) return { status: 400, body: { error: "Écrivez quelques mots, au moins une phrase." } };

  const { data: g } = await supabase.from("galleries").select("title, kind, event_date").eq("id", gid).single();
  const when = g?.event_date
    ? new Date(g.event_date + "T12:00:00Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" })
    : "";
  const ctx = g?.kind === "Mariage"
    ? `Mariés${when ? " en " + when : ""}`
    : `Séance ${(g?.kind || "photo").toLowerCase()}${when ? ", " + when : ""}`;
  const row = { who, body: text, ctx, is_private: isPrivate, status: "pending", updated_at: new Date().toISOString() };

  const { data: existing } = await supabase.from("reviews").select("id").eq("gallery_id", gid).maybeSingle();
  const { error } = existing
    ? await supabase.from("reviews").update(row).eq("id", existing.id)
    : await supabase.from("reviews").insert({ ...row, gallery_id: gid });
  if (error) throw error;

  await notify(`${isPrivate ? "Message" : "Avis"} de ${who} (${g?.title ?? "galerie"})`,
    `<blockquote>${esc(text)}</blockquote><p>${isPrivate ? "Message privé : il ne sera pas publié." : "À relire dans votre espace photographe, onglet Avis, avant publication."}</p>`);
  return { status: 200, body: { ok: true } };
}

async function contact(body: Record<string, unknown>, ip: string) {
  // Champ piège invisible : les robots le remplissent, les humains non
  if (str(body.website, 200)) return { status: 200, body: { ok: true } };
  const name = str(body.name, 120);
  const email = str(body.email, 200);
  const kind = str(body.kind ?? "", 40);
  const when = str(body.when ?? "", 120);
  const message = str(body.message ?? "", 3000);
  if (!name) return { status: 400, body: { error: "Indiquez votre prénom." } };
  if (!email || !EMAIL.test(email)) return { status: 400, body: { error: "Votre e-mail semble incomplet." } };
  if (!message || message.length < 5) return { status: 400, body: { error: "Écrivez quelques mots sur votre projet." } };

  const since = new Date(Date.now() - CONTACT_WINDOW_MS).toISOString();
  const { count } = await supabase.from("access_attempts").select("id", { count: "exact", head: true })
    .eq("ip", ip).eq("slug", "contact").gte("created_at", since);
  const { count: all } = await supabase.from("access_attempts").select("id", { count: "exact", head: true })
    .eq("slug", "contact").gte("created_at", since);
  if ((count ?? 0) >= MAX_CONTACTS || (all ?? 0) >= MAX_CONTACTS_ALL) {
    return { status: 429, body: { error: "Plusieurs messages viennent d'être envoyés. Réessayez dans une heure ou écrivez directement par e-mail." } };
  }
  await supabase.from("access_attempts").insert({ ip, slug: "contact", success: true });

  const { error } = await supabase.from("booking_requests").insert({
    name, email, kind: kind || null, service: kind || null, message: when ? `Date envisagée : ${when}\n\n${message}` : message,
  });
  if (error) throw error;

  await notify(`Nouveau message : ${name}${kind ? " (" + kind.toLowerCase() + ")" : ""}`,
    `<p><strong>${esc(name)}</strong> (${esc(email)})${kind ? ", séance " + esc(kind.toLowerCase()) : ""}${when ? ", " + esc(when) : ""}</p><blockquote>${esc(message).replace(/\n/g, "<br>")}</blockquote><p>Répondez directement à cet e-mail.</p>`,
    email);
  return { status: 200, body: { ok: true } };
}

// E-mail à la photographe via Resend (facultatif : RESEND_API_KEY, NOTIFY_EMAIL, NOTIFY_FROM)
async function notify(subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("NOTIFY_EMAIL");
  if (!key || !to) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("NOTIFY_FROM") ?? "lau.rie <onboarding@resend.dev>",
        to,
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (e) {
    console.error("notification", e);
  }
}
