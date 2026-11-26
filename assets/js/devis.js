// Devis : mise en page A4 aux couleurs de lau.rie, à enregistrer en PDF depuis le navigateur.
// Réservée aux administratrices (lecture protégée par les règles de la base) ; le contenu est
// celui figé à l'enregistrement du devis, informations de l'entreprise comprises.
import { $, esc } from "./core.js";
import { DEMO, getClient, siteBase } from "./api.js";

const money = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fd = (d) => {
  if (!d) return "";
  const x = new Date(String(d).length === 10 ? d + "T12:00:00" : d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
};
const br = (s) => esc(s).replace(/\n/g, "<br>");
const line = (...parts) => parts.filter((x) => x && String(x).trim()).map(br).join("<br>");

function fail(html) {
  $("dv-main").innerHTML = '<div class="dv-msg"><p>' + html + "</p></div>";
}

export function quoteTotals(d) {
  const total = (d.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0);
  const dep = Math.round(total * (Number(d.deposit) || 0)) / 100;
  return { total, dep, rest: total - dep };
}

function render(q) {
  const d = q.data || {}, S = d.seller || {}, C = d.client || {}, T = quoteTotals(d);
  const issued = d.issued || q.created_at, until = new Date(new Date(String(issued).slice(0, 10) + "T12:00:00").getTime() + (Number(d.validity) || 30) * 864e5);
  const site = (S.site || siteBase() || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  document.title = "Devis " + q.number + " · " + (C.name || "") + " · lau.rie";
  $("dv-main").innerHTML =
    '<article class="dv-sheet">' +
    '<header class="dv-head"><div class="dv-brand"><svg class="dv-logo" viewBox="0 0 3060 798" role="img" aria-label="lau.rie"><use href="#lr-logo"/></svg><p>Photographe · ' + esc(S.city || "Nantes") + "</p></div>" +
      '<div class="dv-title"><p class="dv-k">Devis</p><h1>' + esc(q.number) + "</h1><p>Établi le " + fd(issued) + "<br>Valable jusqu'au " + fd(until.toISOString()) + "</p></div></header>" +
    '<section class="dv-parties">' +
      '<div><h2>Photographe</h2><p><b>' + esc(S.owner || "lau.rie") + "</b><br>" + line(S.status, S.address) + (S.siret ? "<br>SIRET " + esc(S.siret) : "") + "<br>" + line([S.phone, S.mail].filter(Boolean).join(" · "), site) + "</p></div>" +
      '<div><h2>Client</h2><p><b>' + esc(C.name || "") + "</b>" + (C.address || C.email || C.phone ? "<br>" + line(C.address, C.email, C.phone) : "") + "</p></div>" +
    "</section>" +
    '<section class="dv-presta"><h2>Prestation</h2><dl>' +
      [["Séance", d.kind], ["Date", d.date ? fd(d.date) : d.dateText], ["Lieu", d.place], ["Livraison", d.delay ? "Galerie privée en ligne, sous " + d.delay : ""]]
        .filter((x) => x[1]).map((x) => "<div><dt>" + x[0] + "</dt><dd>" + esc(x[1]) + "</dd></div>").join("") +
    "</dl></section>" +
    '<table class="dv-lines"><thead><tr><th scope="col">Désignation</th><th scope="col" class="num">Qté</th><th scope="col" class="num">Prix unitaire</th><th scope="col" class="num">Montant</th></tr></thead><tbody>' +
      (d.lines || []).map((l) => "<tr><td><b>" + esc(l.label) + "</b>" + (l.detail ? "<span>" + br(l.detail) + "</span>" : "") + '</td><td class="num">' + esc(String(l.qty)) + '</td><td class="num">' + money(l.unit) + '</td><td class="num">' + money((Number(l.qty) || 0) * (Number(l.unit) || 0)) + "</td></tr>").join("") +
    "</tbody></table>" +
    '<div class="dv-tot"><p class="dv-big"><span>Total</span><b>' + money(T.total) + "</b></p>" + (S.vat ? '<p class="dv-vat">' + esc(S.vat) + "</p>" : "") +
      (T.dep ? "<p><span>Acompte à la réservation (" + esc(String(d.deposit)) + " %)</span><b>" + money(T.dep) + "</b></p><p><span>Solde, " + esc(d.balance || "le jour de la séance") + "</span><b>" + money(T.rest) + "</b></p>" : "") +
    "</div>" +
    (d.note ? '<section class="dv-note"><p>' + br(d.note) + "</p></section>" : "") +
    '<section class="dv-cond"><h2>Conditions</h2><ul>' +
      "<li>Devis gratuit, valable " + esc(String(d.validity || 30)) + " jours.</li>" +
      "<li>La date est réservée à réception de ce devis signé" + (T.dep ? " et de l'acompte" : "") + ".</li>" +
      (d.payment ? "<li>Règlement : " + esc(d.payment) + ".</li>" : "") +
      "<li>Les conditions de prestation complètes sont consultables sur " + esc(site || "le site") + " (Conditions de prestation) et font partie de ce devis.</li>" +
      (S.mediator ? "<li>Médiateur de la consommation : " + esc(S.mediator) + (S.mediatorUrl ? ", " + esc(S.mediatorUrl.replace(/^https?:\/\//, "")) : "") + ".</li>" : "") +
    "</ul></section>" +
    '<section class="dv-sign"><div><h2>Pour lau.rie</h2><p class="dv-who">' + esc(S.owner || "") + '</p></div><div class="dv-box"><h2>Pour le client</h2><p>Date, signature et mention manuscrite « Devis reçu avant l\'exécution de la prestation, bon pour accord ».</p></div></section>' +
    '<footer class="dv-foot">lau.rie · ' + esc([S.owner, S.siret ? "SIRET " + S.siret : "", site].filter(Boolean).join(" · ")) + "</footer>" +
    "</article>";
  $("dv-print").disabled = false;
}

async function main() {
  $("dv-print").addEventListener("click", () => window.print());
  const id = new URLSearchParams(location.search).get("id") || "";
  if (DEMO) return fail("Les devis ont besoin de Supabase (guide, étape 6).");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Devis introuvable.");
  const sb = await getClient();
  const { data: s } = await sb.auth.getSession();
  if (!s || !s.session) return fail('Connectez-vous d\'abord à l\'<a href="admin.html">espace photographe</a>, puis rouvrez le devis.');
  const { data: q, error } = await sb.from("quotes").select("*").eq("id", id).maybeSingle();
  if (error || !q) return fail("Devis introuvable, ou le 7e fichier SQL n'est pas encore exécuté.");
  render(q);
}
main().catch((e) => fail("Impossible d'afficher le devis : " + esc(e.message || e)));
