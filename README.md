# lau.rie — site de photographe, galeries clients privées, espace photographe

Site de Laurie, photographe de mariages, de familles et de portraits entre Saumur et Nantes :

- un **site vitrine** (séances, tarifs, avis, contact, pages légales) ;
- des **galeries privées** à deux accès : les clients choisissent leurs favorites, ajoutent des notes pour la retouche, masquent des photos à leurs invités, envoient leur sélection et laissent un avis ; les invités ont leur propre code ;
- un **espace photographe** où tout se gère sans code : galeries, imports, sélections, demandes de contact, portfolio et séances, photos de l'accueil, avis, textes, tarifs, Google, informations légales, équipe.

Front 100 % statique (HTML, CSS, JavaScript sans framework ni build), hébergé sur GitHub Pages. Back : **Supabase** (Postgres + RLS, Auth, Storage, trois Edge Functions). E-mails : **Resend** (facultatif).

> Mise en ligne pas à pas, sans terminal : **[GUIDE-MISE-EN-LIGNE.md](GUIDE-MISE-EN-LIGNE.md)**.

## Pages

| Page | Rôle |
| --- | --- |
| `index.html` | Accueil, pages des séances (`#seance-…`), pages légales (`#mentions-legales`, `#confidentialite`, `#conditions`), formulaire de contact |
| `galerie.html` | Accès par code (`#k=CODE` dans un lien direct, retiré aussitôt de la barre d'adresse), galerie des clients ou des invités, galerie d'exemple (`#exemple`) |
| `admin.html` | Espace photographe (connexion Supabase Auth) |
| `seance-….html` | Une page par séance, créée à la publication (voir plus bas) ; absente du dépôt |
| `404.html` | Page introuvable ; renvoie aussi une ancienne adresse de séance vers l'accueil |

## Code

| Fichier | Rôle |
| --- | --- |
| `assets/js/config.js` | Les deux seules valeurs à remplir : URL et clé publique Supabase (+ `SITE_URL` facultatif) |
| `assets/js/core.js` | Outils partagés, textes par défaut, pages légales, typographie française, QR codes |
| `assets/js/api.js` | Client Supabase, contenu public, appel de la fonction `gallery` |
| `assets/js/site.js` · `gallery.js` · `admin.js` | Une page chacun |
| `assets/css/lau.css` | Styles (polices Cormorant Garamond et Jost hébergées dans `assets/fonts`, licence OFL) |
| `assets/vendor/` | supabase-js 2.45.4, JSZip 3.10.1, qrcode-generator 1.4.4 (aucun CDN) |
| `assets/img/demo/` | Photos d'exemple (Unsplash), affichées tant que la photographe n'a pas choisi les siennes ; l'écran « À faire » le signale |
| `supabase/migrations/` | Schéma, à exécuter dans l'ordre |
| `supabase/functions/gallery` | Seule porte d'entrée des visiteurs : ouverture d'une galerie, sélection, cœurs anonymes, photo masquée, avis, contact |
| `supabase/functions/admin-users` | Création de comptes, mots de passe provisoires, retrait d'accès, envoi du lien d'une galerie aux clients (administratrices seulement) |
| `supabase/functions/reminders` | Rappels avant fermeture, appelée chaque jour par `pg_cron` + `pg_net` |
| `assets/js/story.js` | Balisage et adresses d'une séance, partagés par le site et par `tools/pages-seo.mjs` |
| `tools/pages-seo.mjs` | Prépare la publication : copie du site, une page HTML par séance (titre, description, canonical, Open Graph, JSON-LD), `sitemap.xml` |
| `.github/workflows/site.yml` | Publication GitHub Pages : à chaque push sur `main`, chaque nuit et à la demande |

Sans configuration Supabase, le site tourne en **mode démonstration** : contenus d'exemple, galerie `LT-2026` / `LT-INVITES`, contact par la messagerie du visiteur.

## Données

- **Contenu du site** : une ligne `site_settings.content` (JSON) : textes, tarifs, SEO, informations légales, modèles d'e-mail et réponses aux demandes (`replies`, publics comme le reste du contenu : n'y mettez rien de confidentiel), séances (`stories`) et photos de l'accueil (`slots`). Les photos publiques sont dans le bucket public `portfolio` (table `portfolio`).
- **Galeries** : `galleries` (deux codes, limite de sélection, lien HD externe, rappel, visites), `photos` (aperçus dans le bucket privé `galleries`, collection, masquée aux invités), `selections` (photos + notes pour la retouche), `reviews` (avis en attente, publiés, masqués ou privés), `booking_requests` (formulaire de contact), `photo_favs` (cœurs des visiteurs, rattachés à un identifiant aléatoire de l'appareil ; lus par `fav_counts()`, administratrices seulement).
- **Fichiers HD** : jamais sur le site. L'import ne téléverse que des aperçus (2 048 px, WebP), générés dans le navigateur ; les originaux restent chez la photographe et sont livrés par SwissTransfer (lien collé dans la galerie).

## Sécurité

- **RLS partout.** Le public ne lit que le contenu du site, le portfolio et les avis publiés. Tout le reste est réservé aux administratrices (`is_admin()`), ou passe par une Edge Function qui utilise la clé `service_role` côté serveur.
- **Accès par code** : `gallery_by_code()` (exécutable par `service_role` seulement) renvoie la galerie, le rôle (clients ou invités) et l'état (brouillon, fermée). Codes uniques sur toutes les galeries (déclencheur), 8 caractères minimum ; ceux créés par l'admin ont 30 bits d'aléa (`LT-7K4QX2`).
- **Anti force brute** : 10 codes faux par IP en 15 minutes → 429, plus un plafond global de 200 échecs (attaque répartie). Formulaire de contact : 5 messages par IP et 40 au total par heure, avec champ piège. L'IP vient de `cf-connecting-ip` (posé par le proxy), jamais du début de `X-Forwarded-For` que le visiteur peut inventer. Les IP sont purgées après 24 h (`pg_cron`).
- **En-têtes dans les pages** : Content-Security-Policy (scripts du site uniquement, connexions vers le site et `*.supabase.co`), `referrer` (aucun sur la galerie et l'admin), et refus d'affichage dans un cadre (clickjacking) pour la galerie et l'admin.
- **Pages publiques légères** : l'accueil et la galerie lisent le contenu public par l'API REST, sans charger supabase-js ; la bibliothèque QR n'est chargée qu'au moment du partage.
- **Rôles appliqués côté serveur** : les invités ne reçoivent jamais les photos masquées ni le lien HD (sauf si autorisé), et ne peuvent ni envoyer de sélection, ni masquer, ni écrire d'avis.
- Les aperçus privés ne circulent que par URL signées (3 h). Un avis « privé » ne peut pas être publié (contrainte en base).
- `reminders` exige l'en-tête `x-cron-secret` (comparaison à temps constant).
- Envoi du lien d'une galerie : le destinataire est lu en base (`client_email`), jamais pris dans la requête ; galerie en ligne obligatoire.
- Cœurs : écrits seulement par la fonction `gallery` après vérification du code ; un invité ne peut pas aimer une photo masquée ; aucune lecture publique.

## Mise en route (version courte, avec la CLI Supabase)

```sh
supabase link --project-ref <ref>
supabase db push                                   # les quatre migrations
supabase functions deploy gallery --no-verify-jwt
supabase functions deploy admin-users --no-verify-jwt
supabase functions deploy reminders --no-verify-jwt
supabase secrets set ALLOWED_ORIGINS=https://lau-rie.fr,https://www.lau-rie.fr
# facultatif : e-mails (Resend)
supabase secrets set RESEND_API_KEY=re_xxx NOTIFY_EMAIL=vous@domaine.fr NOTIFY_FROM="lau.rie <bonjour@lau-rie.fr>"
supabase secrets set REMIND_FROM="lau.rie <bonjour@lau-rie.fr>" SITE_URL=https://lau-rie.fr CRON_SECRET=<aléatoire>
```

Publication : **Settings → Pages → Source : GitHub Actions**, puis **Actions → Publier le site → Run workflow**.

Puis : premier compte admin (Authentication → Users, puis `insert into public.admins …`), inscriptions publiques désactivées, `assets/js/config.js` rempli, GitHub Pages activé, tâche quotidienne `reminders` (voir le guide, étape 10.2). Le détail est dans le guide.

## Aperçu en local

```sh
python3 -m http.server 8000
```

puis http://localhost:8000 (mode démonstration tant que `config.js` est vide).

## Limites

- Plan gratuit Supabase : 1 Go (environ 2 000 à 3 000 aperçus), pause après 7 jours sans activité.
- Les liens SwissTransfer expirent au bout de 30 jours maximum : ce n'est pas un archivage.
- Formats acceptés à l'import : JPEG, PNG, WebP (pas de RAW ni HEIC).
- Les séances ont chacune leur page (`seance-titre-id.html`), lisible sans JavaScript et listée dans `sitemap.xml`. Une séance ajoutée depuis l'espace photographe s'affiche tout de suite sur le site ; sa page séparée est créée à la publication suivante (la nuit, ou **Run workflow**). D'ici là, son adresse est redirigée vers l'accueil par `404.html`. Les séances d'exemple n'ont pas de page.
- Les pages légales restent des ancres de `index.html` (aucun intérêt à les référencer).
- GitHub suspend les tâches planifiées d'un dépôt public après 60 jours sans activité : il faut alors réactiver le workflow (le site reste en ligne).
