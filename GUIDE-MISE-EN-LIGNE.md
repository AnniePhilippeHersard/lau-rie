# Mettre lau.rie en ligne, pas à pas

Ce guide installe le site **sur tes propres comptes**. Tu en es propriétaire : personne d'autre n'a besoin d'intervenir ensuite, et tout se gère depuis ton espace photographe.

- **Durée** : environ 1 h pour les étapes 0 à 9, à faire une seule fois. Les étapes 10 à 12 (e-mails automatiques, nom de domaine, Google) peuvent attendre.
- **Matériel** : un ordinateur (pas un téléphone), Chrome ou Firefox, et le fichier **`lau-rie-site.zip`**.
- **Coût** : 0 € pour le site. Compte environ 10 €/an pour le nom de domaine `lau-rie.fr` (facultatif mais conseillé).

| Service | À quoi il sert | Prix |
| --- | --- | --- |
| **GitHub** | Héberge les pages du site (ce que voient tes visiteurs) | Gratuit |
| **Supabase** | Garde tes données : galeries, aperçus des photos, sélections, avis, messages, textes du site, comptes de connexion | Gratuit (formule Free) |
| **Resend** (étape 10) | Envoie les e-mails automatiques : rappel avant fermeture, alerte quand une sélection ou un message arrive | Gratuit jusqu'à 3 000 e-mails par mois |
| **SwissTransfer** | Envoie les fichiers HD à tes clients (rien à installer) | Gratuit jusqu'à 50 Go par envoi |

> 💡 Les écrans de GitHub et Supabase changent parfois de mise en page. Si un bouton n'a pas exactement le même nom, cherche le plus proche : le principe reste le même.

> 🔐 Prépare un endroit sûr pour tes mots de passe (un gestionnaire de mots de passe, ou au pire un carnet). Tu vas en créer trois : GitHub, la base Supabase, ton espace photographe.

---

## Étape 0 — Décompresser le fichier

1. Double-clique sur `lau-rie-site.zip`. Un dossier `lau-rie-site` apparaît.
2. Garde-le ouvert dans une fenêtre, tu en as besoin à l'étape 1.

---

## Étape 1 — GitHub : créer le compte et y déposer le site

### 1.1 Créer le compte
1. Va sur **https://github.com/signup**.
2. Saisis ton e-mail, un mot de passe et un **nom d'utilisateur**. Il apparaîtra dans l'adresse provisoire du site (`ton-pseudo.github.io`), choisis quelque chose de pro, par exemple `laurie-photo`.
3. Valide le code reçu par e-mail.

### 1.2 Créer l'espace du site (le « dépôt »)
1. En haut à droite, clique sur **+** → **New repository**.
2. **Repository name** : `site` (sans espace ni accent).
3. Coche **Public**. *Obligatoire pour l'hébergement gratuit. Le code est visible, mais il ne contient aucun secret : tes photos privées et tes données sont protégées dans Supabase.*
4. Coche **Add a README file**, puis **Create repository**.

### 1.3 Déposer les fichiers
1. Dans ton dépôt : **Add file** → **Upload files**.
2. Ouvre le dossier `lau-rie-site`. **Sur Mac**, appuie d'abord sur **Cmd + Maj + .** (point) dans le Finder : le dossier caché `.github` apparaît (il sert à publier le site). Puis **sélectionne tout son contenu** (ce qu'il y a dedans, pas le dossier lui-même) et glisse-le dans la page GitHub.
3. Attends que la liste des fichiers s'affiche, puis clique sur **Commit changes** en bas.

✅ Tu dois voir dans ton dépôt : le dossier `.github`, `index.html`, `galerie.html`, `admin.html`, les dossiers `assets`, `supabase` et `tools`, et les icônes (`favicon.svg`, `icon-512.png`…). *Si `.github` manque, recommence le dépôt avec les fichiers cachés visibles.*

---

## Étape 2 — Supabase : créer le projet

1. Va sur **https://supabase.com** → **Start your project** → **Continue with GitHub** (avec le compte de l'étape 1).
2. Si on te demande une **organisation** : ton nom, type **Personal**, plan **Free**.
3. **New project** :
   - **Name** : `lau-rie`
   - **Database password** : **Generate a password**, puis **copie-le dans ton endroit sûr**. Tu n'en auras presque jamais besoin, mais il est impossible à récupérer.
   - **Region** : **West EU (Paris)**. *Tes données restent en France : c'est ce qu'annoncent tes pages légales.*
4. **Create new project**, puis attends 1 à 2 minutes.

---

## Étape 3 — Créer la base de données

Tu vas coller quatre « recettes » qui créent les tables et les règles de sécurité, **dans l'ordre**.

1. Dans un autre onglet, ouvre ton dépôt GitHub → dossier **`supabase`** → **`migrations`**. Il contient quatre fichiers, du plus ancien au plus récent :
   1. `…_init.sql`
   2. `…_site_settings.sql`
   3. `…_lau_rie.sql`
   4. `…_envoi_favorites.sql`
2. Clique sur le **premier**, puis sur l'icône **Copy raw file** (deux petits carrés, en haut à droite du contenu).
3. Dans Supabase, menu de gauche : **SQL Editor** → **New query** (ou **+**).
4. Colle (Ctrl+V / Cmd+V) puis **Run** (en bas à droite). ✅ Message **Success. No rows returned**.
5. Recommence avec le **deuxième**, le **troisième** puis le **quatrième** fichier : nouvelle requête, coller, **Run**.

> ℹ️ **Site déjà en ligne avant cette version ?** Exécute seulement le quatrième fichier (`…_envoi_favorites.sql`), puis redéploie les fonctions `gallery` et `admin-users` (étape 4). Tant qu'il n'est pas exécuté, le site marche normalement, sans « Les plus aimées » ni date d'envoi du lien.

> ℹ️ Avec le troisième fichier, une ligne jaune « pg_cron indisponible » peut apparaître : ce n'est pas une erreur. Le site fonctionne, seule la purge automatique des adresses IP n'est pas programmée (voir « Bon à savoir »).

> ⚠️ Une erreur rouge « already exists » veut dire que ce fichier a déjà été exécuté : passe au suivant.

---

## Étape 4 — Installer les trois fonctions

Ce sont de petits programmes qui tournent chez Supabase : `gallery` ouvre les galeries à tes clients et reçoit le formulaire de contact, `admin-users` gère les comptes de l'espace photographe, `reminders` envoie les rappels avant fermeture.

Pour **chacune** des trois :

1. Sur GitHub, ouvre `supabase` → `functions` → le dossier de la fonction → **`index.ts`** → **Copy raw file**.
2. Dans Supabase : **Edge Functions** → **Deploy a new function** → **Via Editor**.
3. Efface le code d'exemple, colle le tien.
4. Nom de la fonction : **exactement** `gallery`, `admin-users` ou `reminders`.
5. **Deploy function**.
6. Une fois déployée, ouvre ses **Details** (ou **Settings**) et **désactive Verify JWT** (ou **Enforce JWT Verification**), puis enregistre.
   *C'est normal : tes clients n'ont pas de compte. Chaque fonction vérifie elle-même le code de la galerie, la connexion de l'administratrice ou le secret des rappels.*

✅ Dans **Edge Functions**, tu vois `gallery`, `admin-users` et `reminders`.

---

## Étape 5 — Créer ton compte de l'espace photographe

### 5.1 Créer le compte
1. Menu de gauche : **Authentication** → **Users** → **Add user** → **Create new user**.
2. Ton e-mail + un mot de passe solide (12 caractères minimum). Coche **Auto Confirm User**. **Create user**.

### 5.2 Lui donner les droits
1. **SQL Editor** → **New query**, colle cette ligne en **remplaçant l'e-mail par le tien** (garde les apostrophes) :
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'ton-email@exemple.fr' returning user_id;
   ```
2. **Run**. ✅ Une ligne s'affiche avec un long identifiant. Si tu vois « No rows returned », l'e-mail ne correspond pas exactement à celui de l'étape 5.1 : corrige et relance.

### 5.3 Fermer les inscriptions
Pour que personne ne puisse se créer un compte tout seul : **Authentication** → **Sign In / Providers** (ou **Providers** → **Email**) → désactive **Allow new users to sign up** → **Save**.

---

## Étape 6 — Relier le site à Supabase

1. Dans Supabase : **Project Settings** (roue crantée en bas à gauche) → **API Keys** (ou **API**). Tu vas copier deux valeurs :
   - la **Project URL** (du type `https://abcdefgh.supabase.co`), parfois affichée dans **Project Settings → Data API** ou sur l'accueil du projet ;
   - la **clé publique** : **Publishable key** (commence par `sb_publishable_`) *ou*, dans **Legacy API keys**, la clé **anon public**.
   > ⚠️ Ne copie **jamais** la clé `secret` ou `service_role` : elle donne tous les droits.
2. Sur GitHub, ouvre `assets` → `js` → **`config.js`** → crayon ✏️ (**Edit this file**).
3. Remplis les deux lignes **entre les guillemets** :
   ```js
   url: "https://abcdefgh.supabase.co",
   anonKey: "sb_publishable_xxxxxxxxxxxx",
   ```
4. **Commit changes…** → **Commit changes**.

---

## Étape 7 — Mettre le site en ligne

1. Dans ton dépôt GitHub : **Settings** → **Pages** (menu de gauche).
2. **Source** : choisis **GitHub Actions** (pas « Deploy from a branch »). Rien d'autre à régler sur cette page.
3. Onglet **Actions** du dépôt → **Publier le site** (à gauche) → **Run workflow** → **Run workflow**. Une ligne jaune apparaît, puis une coche verte au bout d'une minute environ.
4. Retourne dans **Settings** → **Pages** : l'adresse s'affiche en haut, du type **`https://laurie-photo.github.io/site/`**. Note-la.

*Ensuite, tout est automatique : le site est republié à chaque modification du dépôt, et chaque nuit pour créer la page Google des séances que tu ajoutes depuis l'espace photographe (elles s'affichent sur le site tout de suite ; leur page séparée pour Google arrive la nuit suivante). Pour la créer sans attendre : **Actions** → **Publier le site** → **Run workflow**.*

✅ Ouvre cette adresse : le site s'affiche, avec les séances et photos d'exemple. C'est normal, tu les remplaces à l'étape 9.

---

## Étape 8 — Deux réglages de sécurité dans Supabase

### 8.1 Adresse du site
**Authentication** → **URL Configuration** → **Site URL** : colle l'adresse de l'étape 7 → **Save**.

### 8.2 N'autoriser que ton site à appeler les fonctions
**Edge Functions** → **Secrets** → **Add new secret** :
- **Name** : `ALLOWED_ORIGINS`
- **Value** : l'adresse du site **sans rien après le `.io`**, par exemple `https://laurie-photo.github.io` (ni `/site/`, ni `/` final).

→ **Save**.

---

## Étape 9 — Première connexion et contenu du site

1. Va sur **l'adresse du site + `admin.html`**, par exemple `https://laurie-photo.github.io/site/admin.html`, et ajoute-la à tes favoris. *Le lien « Espace photographe » en bas du site y mène aussi.*
2. Connecte-toi avec l'e-mail et le mot de passe de l'étape 5.
3. L'écran **À faire** liste ce qu'il reste à compléter. Dans l'ordre :
   1. **Réglages → Informations légales** : nom, statut, SIRET, adresse, téléphone, médiateur (voir étape 14). Ces informations remplissent toutes seules les mentions légales, la confidentialité et les conditions de prestation.
   2. **Portfolio → Bibliothèque** : ajoute tes plus belles photos, **seulement celles dont les personnes ont donné leur accord écrit**. Donne une courte description à chacune (elle aide Google et les personnes malvoyantes).
   3. **Portfolio → Séances** : crée tes vraies séances (titre, lieu, texte, photos). Décoche **Affichée** sur les séances d'exemple, ou supprime-les.
   4. **Portfolio → Photos de l'accueil** : choisis une photo pour chaque emplacement (le grand tirage, les petits, « À propos », « Contact »…).
   5. **Site et Google** : vérifie l'accroche, les tarifs, ton e-mail, ton Instagram.
   6. **Réglages → Équipe** : ajoute une **deuxième personne de confiance**. Si un jour tu oublies ton mot de passe, elle t'en redonne un en deux clics (et inversement).

> ⚠️ Tant que l'écran **À faire** affiche « Photos et séances d'exemple encore sur le site », ne communique pas l'adresse : les photos d'exemple (Unsplash) ne sont pas les tiennes.

---

## Étape 10 — E-mails automatiques (conseillé)

Sans cette étape, tout fonctionne, mais tu dois penser à regarder l'écran **À faire** : aucun e-mail ne te prévient d'une sélection ou d'un message, et les rappels avant fermeture se font à la main (bouton **L'envoyer moi-même** dans chaque galerie).

### 10.1 Alertes pour toi (10 minutes)
1. Crée un compte sur **https://resend.com** avec **ton e-mail**.
2. **API Keys** → **Create API Key** (permission **Sending access**) → copie la clé (`re_…`).
3. Dans Supabase, **Edge Functions** → **Secrets**, ajoute :
   - `RESEND_API_KEY` = la clé `re_…`
   - `NOTIFY_EMAIL` = ton e-mail (le même que ton compte Resend)

✅ Tu reçois désormais un e-mail à chaque sélection, chaque avis et chaque message du formulaire de contact. Réponds directement à l'e-mail de contact : la réponse part vers le client.

### 10.2 Rappels aux clients (après l'étape 11, il faut ton nom de domaine)
Pour écrire à tes clients (rappels, et bouton **Envoyer par e-mail** d'une galerie), Resend doit vérifier que l'adresse d'envoi t'appartient.

1. Resend → **Domains** → **Add domain** → `lau-rie.fr`. Resend affiche 3 ou 4 lignes « DNS » à recopier chez ton registrar (OVH, Gandi…), dans la zone DNS du domaine. Attends que Resend affiche **Verified** (de quelques minutes à quelques heures).
2. Supabase → **Edge Functions** → **Secrets**, ajoute :
   - `REMIND_FROM` = `lau.rie <bonjour@lau-rie.fr>`
   - `NOTIFY_FROM` = `lau.rie <bonjour@lau-rie.fr>`
   - `SITE_URL` = `https://lau-rie.fr`
   - `CRON_SECRET` = une longue suite de lettres et chiffres inventée (au moins 16 caractères, par exemple générée par ton gestionnaire de mots de passe). **Note-la.**
3. **Database** → **Extensions** : active **pg_cron** et **pg_net** s'ils ne le sont pas.
4. **SQL Editor** → **New query**, colle ceci en remplaçant **les deux valeurs en majuscules** (l'identifiant du projet est le début de ta Project URL, avant `.supabase.co`) :
   ```sql
   select cron.schedule('rappels-galeries', '17 8 * * *', $$
     select net.http_post(
       url := 'https://IDENTIFIANT-DU-PROJET.supabase.co/functions/v1/reminders',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'TON-CRON-SECRET'),
       body := '{}'::jsonb
     );
   $$);
   ```
5. **Run**. ✅ Un numéro s'affiche. Chaque matin, la fonction écrit aux clients dont la galerie ferme bientôt (un mois avant par défaut, réglable galerie par galerie).

Le texte du rappel se modifie dans **Réglages → E-mail de rappel**.

✅ Le bouton **Envoyer par e-mail** d'une galerie fonctionne aussi à partir de maintenant : il écrit à l'adresse **E-mail des clients** de la galerie, avec un message que tu relis avant l'envoi. Les réponses des clients arrivent sur l'e-mail du site (**Site et Google → Contact**).

---

## Étape 11 — Ton nom de domaine `lau-rie.fr`

1. Achète `lau-rie.fr` chez un registrar français (OVH, Gandi, Infomaniak…), environ 10 €/an.
2. Dans la **zone DNS** du domaine, ajoute :
   - quatre lignes de type **A** pour `lau-rie.fr` vers `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` ;
   - une ligne **CNAME** pour `www` vers `laurie-photo.github.io` (ton pseudo GitHub).
   *Supprime les anciennes lignes A ou CNAME « parking » du registrar si elles existent.*
3. GitHub → ton dépôt → **Settings** → **Pages** → **Custom domain** : `lau-rie.fr` → **Save**. Quand la vérification est passée (quelques minutes à quelques heures), coche **Enforce HTTPS**.
4. Mets l'adresse à jour à deux endroits dans Supabase :
   - **Authentication** → **URL Configuration** → **Site URL** = `https://lau-rie.fr`
   - **Edge Functions** → **Secrets** → `ALLOWED_ORIGINS` = `https://lau-rie.fr,https://www.lau-rie.fr`
5. Dans GitHub, `assets/js/config.js` : mets `SITE_URL` à `"https://lau-rie.fr"` (les liens et QR codes des galeries l'utilisent).

> Si tu choisis un autre nom que `lau-rie.fr`, remplace aussi `lau-rie.fr` dans `index.html`, `robots.txt` et `sitemap.xml` (crayon ✏️ sur GitHub, puis **Commit changes**).

---

## Étape 12 — Être trouvée sur Google

1. **Google Search Console** (https://search.google.com/search-console) → **Ajouter une propriété** → **Domaine** → `lau-rie.fr`. Google donne une ligne **TXT** à ajouter dans la zone DNS (comme à l'étape 11), puis **Valider**.
2. Menu **Sitemaps** → saisis `sitemap.xml` → **Envoyer**.
3. Conseillé : crée ta fiche **Google Business Profile** (https://business.google.com) en « zone desservie » (Nantes, Saumur, Angers…) sans afficher ton adresse personnelle. C'est elle qui apparaît sur Google Maps et dans « photographe mariage Nantes ».

Les galeries privées et l'espace photographe sont exclus de Google automatiquement.

---

## Étape 13 — Faire un essai complet

Avant d'envoyer une vraie galerie, joue la cliente :

1. **Galeries** → **Nouvelle galerie** (« Test », type, date). Un **code des clients** et un **code des invités** sont créés.
2. Mets ton propre e-mail dans **E-mail des clients**, importe 5 photos, coche **Galerie visible par les clients**, **Enregistrer**.
3. **Copier le message**, colle-le dans un SMS pour toi, ouvre le lien **sur ton téléphone** :
   - coche 2 ou 3 cœurs, ajoute une note sur une photo, masque une photo, **Envoyer ma sélection**, puis **Laisser un avis** ;
   - ouvre le lien sur un autre appareil avec le **code des invités** : la photo masquée n'apparaît pas.
4. Retourne dans l'espace photographe : **À faire** affiche la sélection reçue et l'avis à relire. ✅
5. Envoie-toi un message depuis le formulaire **Contact** du site : il arrive dans **Demandes**. ✅
6. Supprime la galerie Test (tout en bas de la galerie).

---

## Étape 14 — Les obligations légales (à faire avant la première séance vendue)

- [ ] **SIRET et statut** saisis dans **Réglages → Informations légales**.
- [ ] **Médiateur de la consommation** : obligatoire dès qu'on vend à des particuliers. Adhère à un médiateur agréé (liste officielle sur https://www.economie.gouv.fr/mediation-conso), puis saisis son nom et son site dans les Réglages. Compte quelques dizaines d'euros par an selon l'organisme.
- [ ] **Relecture** des trois pages (mentions légales, confidentialité, conditions de prestation) par la CCI, la Chambre des métiers ou un juriste. Elles sont rédigées pour une micro-entreprise de photographie, mais une relecture une fois pour toutes est prudente.
- [ ] **Devis** : joins-y les conditions de prestation (lien `…/index.html#conditions`) et fais-les accepter à la signature.
- [ ] **Droit à l'image** : ne publie dans le portfolio que les photos pour lesquelles tu as un accord écrit.
- [ ] **Demandes sans suite** : supprime-les au plus tard trois ans après le dernier échange (**Demandes** → **Supprimer**), comme l'annonce la politique de confidentialité.

---

## Au quotidien

1. **Après une séance** : **Galeries** → **Nouvelle galerie**. Les codes sont créés tout seuls.
2. **Importer** les JPEG exportés de Lightroom. Le site fait des aperçus légers ; tes originaux ne quittent pas ton ordinateur. Option : « © lau.rie » sur les aperçus.
3. **Mettre en ligne** (Galerie visible), puis **Envoyer par e-mail** (après l'étape 10.2), **Copier le message** pour un SMS, ou **Créer la carte à imprimer** (QR code, 10 × 15 cm).
4. Les clients choisissent leurs favorites (limite réglable), ajoutent des notes, partagent avec leurs proches grâce au code des invités.
5. **Sélections** : **Copier les noms**, colle-les dans la recherche de Lightroom pour retrouver les photos. Retouche, puis **Marquer comme traitée**.
6. **Livraison HD** : dépose les fichiers retouchés sur **https://www.swisstransfer.com** (lien valable 30 jours maximum), colle le lien dans **Fichiers HD** avec sa date d'expiration, **Enregistrer**. Les clients le trouvent dans **Télécharger**.
7. **Les plus aimées** : dans chaque galerie, les photos qui ont reçu le plus de cœurs (clients et invités, comptés sans savoir qui). Pratique pour choisir les photos du portfolio, avec l'accord des clients.
8. **Demandes** : **Répondre** propose des réponses toutes prêtes (disponible, déjà réservée, tarifs) avec le prénom et tes formules déjà remplis. **Ouvrir dans ma messagerie**, ou **Copier le message** si tu écris depuis Gmail dans le navigateur. Les textes se modifient dans **Réglages → Réponses aux demandes**.
9. **Avis** : quand un client en laisse un, il attend ta relecture dans **Avis** (**Publier** ou **Ne pas publier**). Les messages « juste pour Laurie » ne sont jamais publiés.
10. **Fin de galerie** : un rappel part avant la fermeture (étape 10). Après la date, le code ne fonctionne plus. Supprime les vieilles galeries pour garder de la place.

---

## Bon à savoir

- **Modifications non enregistrées** : un bandeau noir « Enregistrer » apparaît en bas dès que tu modifies un champ ; si tu changes d'onglet sans enregistrer, le site te demande confirmation.
- **Pause automatique** : un projet Supabase gratuit se met en pause après **7 jours sans aucune activité** (tu reçois un e-mail avant). Le site public reste visible, mais les galeries, le contact et l'espace photographe ne répondent plus : va sur supabase.com et clique sur **Restore project**. Avec des visites régulières, ça n'arrive pas.
- **Espace** : la formule gratuite (1 Go) contient environ 2 000 à 3 000 aperçus de galerie. Supprime les galeries livrées et fermées. Les fichiers HD ne passent jamais par le site.
- **Purge des adresses IP** : pour bloquer ceux qui essaient de deviner les codes, le site note l'adresse IP de chaque essai. Elle est effacée chaque nuit si `pg_cron` est activé (**Database → Extensions → pg_cron**, puis relance le 3e fichier de l'étape 3).
- **Mot de passe oublié** : demande à l'autre administratrice un mot de passe provisoire (**Réglages → Équipe → Nouveau mot de passe**). Le lien « Mot de passe oublié » par e-mail ne fonctionne bien qu'avec un service d'envoi branché (Supabase → **Authentication** → **Emails** → **SMTP Settings**, avec Resend : hôte `smtp.resend.com`, port `465`, utilisateur `resend`, mot de passe = ta clé API, expéditeur sur ton domaine vérifié).
- **Mode démonstration** : tant que `config.js` est vide, le site affiche les exemples, la galerie d'exemple s'ouvre avec le code `LT-2026` (clients) ou `LT-INVITES` (invités), et l'espace photographe explique qu'il faut relier Supabase.
- **Donner accès à la personne qui t'aide** : GitHub → ton dépôt → **Settings** → **Collaborators** → **Add people**. Pour Supabase (si nécessaire) : **Organization settings** → **Team** → **Invite**, rôle **Developer**. Tu restes propriétaire de tout et tu peux retirer l'accès quand tu veux.

---

## En cas de souci

| Ce que tu vois | Cause probable | Solution |
| --- | --- | --- |
| L'espace photographe dit « pas encore relié à Supabase » | `config.js` vide ou mal rempli | Étape 6 : vérifier les guillemets et les virgules |
| « Ce compte n'a pas accès à l'espace photographe » | Étape 5.2 pas faite ou e-mail différent | Relancer la requête avec l'e-mail exact |
| « E-mail ou mot de passe incorrect » | Mauvais mot de passe | Mot de passe provisoire par l'autre administratrice |
| Le client voit « Ce code ne correspond à aucune galerie » | Faute de frappe ou code changé | Vérifier le code dans la galerie (les espaces et minuscules ne comptent pas) |
| Le client voit « pas encore en ligne » | Galerie en brouillon | Cocher **Galerie visible par les clients**, **Enregistrer** |
| Le client voit « Cette galerie est fermée » | Date « En ligne jusqu'au » dépassée | Repousser la date, **Enregistrer** |
| « Connexion impossible » sur la galerie ou le contact | Fonction `gallery` absente, mal nommée, ou `ALLOWED_ORIGINS` différent de l'adresse du site | Étapes 4 et 8.2 (adresse sans `/` final) |
| « Trop de tentatives » | 10 codes faux en 15 minutes depuis la même connexion | Attendre 15 minutes |
| Ajouter une administratrice affiche une erreur | Fonction `admin-users` absente ou Verify JWT activé | Étape 4 |
| Pas d'e-mail de sélection ou de contact | Étape 10.1 pas faite, ou `NOTIFY_EMAIL` différent de ton compte Resend | Étape 10.1 |
| Les rappels ne partent pas | Domaine pas vérifié chez Resend, secret ou tâche planifiée manquants | Étape 10.2 ; en attendant, bouton **L'envoyer moi-même** |
| Plus rien ne marche d'un coup | Projet Supabase en pause | supabase.com → **Restore project** |
| Le site n'a pas changé après une modification sur GitHub | Délai de publication, ou publication en échec | Onglet **Actions** : attendre la coche verte, puis recharger (Ctrl+Maj+R). Croix rouge : ouvrir la ligne pour lire l'erreur (souvent un projet Supabase en pause) |
| E-mail de GitHub « scheduled workflow disabled » | Aucune modification du dépôt pendant 60 jours | **Actions** → **Publier le site** → **Enable workflow**. Le site reste en ligne en attendant |
| Le site affiche « 404 » partout après la mise en ligne | Source de Pages restée sur « Deploy from a branch » ou dossier `.github` manquant | Étape 7, puis étape 1.3 |
