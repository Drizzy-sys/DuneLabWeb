# Dune Lab – site vitrine

Site statique (HTML, CSS, JavaScript natif) publié sur Cloudflare Workers, avec un petit Worker pour le formulaire de devis (vérification anti-robot Turnstile et envoi par email avec Resend). Aucune étape de build : les fichiers de `public/` sont publiés tels quels.

Le même Worker héberge un espace admin privé (`/admin`) pour les devis, factures et avoirs : voir [Espace admin](#espace-admin-devis-et-factures).

## Arborescence

```text
.
├── public/                    Fichiers du site, publiés tels quels
│   ├── _headers               En-têtes HTTP (sécurité, cache)
│   ├── _redirects             La racine renvoie vers /fr/
│   ├── 404.html               Page d'erreur (FR + EN)
│   ├── robots.txt, sitemap.xml
│   ├── favicon.svg, favicon.ico, apple-touch-icon.png
│   ├── fr/                    index.html, mentions-legales.html, politique-de-confidentialite.html
│   ├── en/                    index.html, legal-notice.html, privacy-policy.html
│   ├── admin/                 Interface de l'espace admin (servie seulement après Cloudflare Access)
│   └── assets/
│       ├── css/style.css      Thème : variables en tête de fichier (:root)
│       ├── js/main.js         Menu, animations, cartes projets, formulaire, Turnstile
│       ├── js/projects.js     Liste des réalisations (à éditer pour ajouter un projet)
│       ├── fonts/             Fraunces et Inter (Google Fonts, auto-hébergées) ; pdf/ : versions TTF pour les PDF
│       └── img/               Logo, images de partage, captures des projets
├── src/worker.js              Formulaire (Turnstile, Resend), aiguillage vers l'admin, sauvegarde nocturne
├── src/admin/                 Espace admin : accès, devis, factures, numérotation, PDF, exports
├── data/grille.json           Grille tarifaire initiale (prix, émetteur, TVA, conditions, mentions)
├── migrations/                Schéma de la base D1 (tables et verrous des factures émises)
├── scripts/                   Sauvegarde locale et restauration de la base
├── tests/                     Tests (npm test)
├── wrangler.jsonc             Configuration Cloudflare (emails, base D1, archives R2, Access)
├── package.json               Commandes npm (dev, deploy, test, db:local, db:distant, sauvegarde)
└── .dev.vars.example          Réglages locaux : clé de test Turnstile, emails simulés, admin local
```

Sur Cloudflare, les pages sont servies sans extension : `/fr/mentions-legales` affiche `mentions-legales.html`. Les liens, URL canoniques et le sitemap utilisent déjà ces adresses.

## Travailler en local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Le site s'ouvre sur <http://localhost:8787/fr/>. En local, Turnstile utilise la clé de test de Cloudflare (bandeau rouge « à des fins de test » normal) et aucun email n'est envoyé : son contenu s'affiche dans le terminal (`EMAIL_DRY_RUN=1`). Pour tester un vrai envoi par Resend en local, suivez les indications de `.dev.vars`.

## Avant la mise en ligne : à remplacer

1. **Nom de domaine** : rechercher-remplacer dans tout le projet (VS Code : `Ctrl+Maj+H`), dans cet ordre :
   - `www.example.com` → `www.votre-domaine.fr` ;
   - puis `example.com` → `votre-domaine.fr` (adresses email du site et de `wrangler.jsonc`).
2. **Adresses du formulaire** (`wrangler.jsonc`, section `vars`) : `MAIL_TO` reçoit les demandes, `MAIL_FROM` les envoie (adresse du domaine vérifié dans Resend, pas besoin de créer la boîte).
3. **Clé publique Turnstile** : `public/assets/js/main.js`, constante `TURNSTILE_SITEKEY`.
4. **Mentions légales** (FR et EN) : SIREN et numéro de TVA, surlignés en jaune. Vérifiez aussi sur le Kbis que l'immatriculation est bien « RCS Bordeaux ».
5. **Photo** : enregistrer `public/assets/img/leo-fanchon.webp` (544 × 680 px), puis remplacer le bloc `founder__placeholder` par la balise `<img>` indiquée en commentaire juste au-dessus (FR et EN).
6. **À vérifier** : le délai « 48 heures ouvrées » (FR) / « two working days » (EN), dans les pages d'accueil et `src/worker.js`.

## Mise en ligne sur Cloudflare

1. **Domaine** : dans Cloudflare, *Add a domain* (offre gratuite), puis dans l'espace client OVH, *Noms de domaine* → votre domaine → *Serveurs DNS* → *Modifier les serveurs DNS* : remplacer ceux d'OVH par les deux serveurs indiqués par Cloudflare. L'activation prend de quelques minutes à quelques heures.
2. **Messagerie** : choisir où arrivent les emails de `contact@votre-domaine.fr`. Soit une boîte OVH (enregistrements MX d'OVH à recopier dans le DNS Cloudflare), soit *Email Routing* de Cloudflare pour les transférer gratuitement vers une adresse existante.
3. **Resend (envoi des emails du formulaire)** : créer un compte sur resend.com, puis *Domains* → *Add Domain* avec votre domaine. Choisissez la région *Ireland (eu-west-1)* pour que les envois partent d'Europe. Ajoutez dans le DNS Cloudflare les enregistrements indiqués par Resend : DKIM, plus SPF et MX sur le sous-domaine `send`, ce qui ne touche pas à votre messagerie. Une fois le domaine vérifié, créez une clé API (*API Keys*, permission *Sending access*, limitée à ce domaine) et enregistrez-la comme secret du Worker : `npx wrangler secret put RESEND_API_KEY`.
4. **Turnstile** : *Turnstile* → *Add widget*, mode *Managed*, nom d'hôte = votre domaine. Reportez la clé publique dans `main.js` (point 3 ci-dessus). Pour la clé secrète : `npx wrangler secret put TURNSTILE_SECRET_KEY`, ou dans le tableau de bord, Worker → *Settings* → *Variables and Secrets*.
5. **Publication** : `npx wrangler login`, puis `npm run deploy`. Vous pouvez aussi relier le dépôt GitHub (*Workers & Pages* → *Create* → *Import a repository*, commande de déploiement `npx wrangler deploy`) pour publier automatiquement à chaque push.
6. **Adresse du site** : Worker `dunelab` → *Settings* → *Domains & Routes* → ajouter `www.votre-domaine.fr` et `votre-domaine.fr`. Pour renvoyer le domaine nu vers `www` : *Rules* → *Redirect Rules* → modèle « Redirect from root to WWW ».

## En attendant le nom de domaine : adresse provisoire workers.dev

Le Worker se publie tel quel à l'adresse gratuite `https://dunelab.<sous-domaine>.workers.dev`, sans nom de domaine. C'est la même installation que la définitive : le jour où le domaine arrive, il suffit de l'ajouter. Cette adresse n'est pas indexée par les moteurs de recherche (règle `noindex` dans `public/_headers`, limitée aux adresses `*.workers.dev`).

1. `npx wrangler login`. La première fois, Cloudflare demande de choisir le sous-domaine `workers.dev` du compte.
2. Base D1, archives R2 et `npm run db:distant` : étapes 2 et 3 de « Mise en ligne (une seule fois) » dans la section admin plus bas.
3. `npm run deploy`. L'adresse s'affiche à la fin. Le site est en ligne ; l'admin répond 404 tant qu'Access n'est pas réglé, ce qui est voulu.
4. **L'admin, sur un Worker à part.** Sur workers.dev, Access protège une adresse entière, pas un chemin. Le même code est donc publié une seconde fois sous le nom `dunelab-admin` (section `env.admin` de `wrangler.jsonc`). Ce Worker est entièrement derrière Access, pendant que `dunelab` reste public ; sur `dunelab`, `/admin` répond 404.
   - Création : *Workers & Pages* › *Create application* › *Import a repository*, même dépôt. Nom `dunelab-admin`, branche `master`, *Build command* `npm ci`, *Deploy command* `npx wrangler deploy --env admin`.
   - Protection : Worker `dunelab-admin` › *Settings* › *Domains & Routes* › ligne *workers.dev* › *Enable Cloudflare Access*. *Scope* : **All traffic**, politique limitée à votre adresse e-mail.
   - Reportez l'« Application Audience (AUD) Tag » dans `env.admin.vars.ACCESS_AUD` (`wrangler.jsonc`).
   - Votre adresse va dans un **secret** du Worker `dunelab-admin`, pas dans le dépôt (public) : *Settings* › *Variables and Secrets* › *Add* › type *Secret*, nom `ADMIN_EMAIL`.
   - L'admin est alors à `https://dunelab-admin.<sous-domaine>.workers.dev/admin/`. Ce montage peut rester après l'arrivée du domaine.
5. **Formulaire de contact** (facultatif d'ici là) :
   - Turnstile : créez un widget avec le nom d'hôte `dunelab.<sous-domaine>.workers.dev`.
   - Resend : sans domaine vérifié, il n'envoie qu'à l'adresse de votre compte Resend, depuis `onboarding@resend.dev`. Mettez ces deux adresses dans `MAIL_TO` et `MAIL_FROM`.

Quand le domaine est prêt : suivez « Mise en ligne sur Cloudflare » ci-dessous (DNS, *Domains & Routes*, Resend, Turnstile), étendez l'application Access aux chemins `admin` et `api/admin` du domaine, remplacez `example.com` partout, puis redéployez.

## Tester après la mise en ligne

- La racine du domaine ouvre `/fr/`, le sélecteur FR / EN bascule sur la page équivalente, une adresse inexistante affiche la page 404.
- Envoyer une demande depuis `/fr/#contact` et `/en/#contact`, vérifier la réception (et les spams). *Répondre* doit répondre à la personne qui a rempli le formulaire.
- En cas d'échec : onglet *Emails* de Resend, journaux du Worker (*Workers & Pages* → `dunelab` → *Logs*), ou `npx wrangler tail` pendant un envoi.
- Déclarer le site dans Google Search Console et soumettre `https://www.votre-domaine.fr/sitemap.xml`.

## Faire évoluer le site

- **Ajouter un projet** : copier un bloc dans `public/assets/js/projects.js`. Le mode d'emploi est en tête du fichier. Captures : WebP 1200 × 750 px dans `public/assets/img/projects/`.
- **Changer les couleurs ou les polices** : variables `:root` en tête de `public/assets/css/style.css`.
- **Après une modification de CSS ou de JS** : incrémenter `?v=1` (→ `?v=2`) dans les balises `<link>` / `<script>` des pages HTML pour que les navigateurs rechargent le fichier.

## Espace admin (devis et factures)

Espace privé sous `/admin` pour créer devis, factures et avoirs à partir de la grille tarifaire. Il n'est lié nulle part sur le site, n'est pas indexé (`X-Robots-Tag: noindex`) et volontairement absent de `robots.txt`, qui le signalerait.

- **Accès** : Cloudflare Access demande un code envoyé par e-mail. Le Worker vérifie ensuite le jeton signé d'Access sur chaque page et chaque appel d'API. Sans jeton valide, par exemple par l'adresse `*.workers.dev` qui contourne Access, l'admin répond par la page 404 du site.
- **Données** : base Cloudflare D1, hébergée dans l'UE. Les montants sont stockés en centimes, les lignes et le contexte (émetteur, client, TVA, mentions) en JSON structuré.
- **PDF** : générés par le Worker avec pdf-lib, aux couleurs du site, polices embarquées. Le PDF d'un devis envoyé ou d'une facture émise est archivé une seule fois dans R2, avec son empreinte SHA-256 enregistrée en base. Il est ensuite toujours servi depuis R2, jamais régénéré.
- **Numérotation** : `D-AAAA-NNN`, `F-AAAA-NNN` et `A-AAAA-NNN`. Le numéro de facture est attribué à l'émission, dans la même transaction D1 que l'incrément du compteur : pas de doublon, pas de trou, ordre chronologique.
- **Factures émises** : ni modification ni suppression. C'est vérifié par le code et par des triggers SQL dans la base elle-même. On corrige par un avoir :
  - *Annuler par un avoir* reprend exactement la facture (lignes, remise, acomptes déduits, avoirs déjà émis) et l'annule au centime près ;
  - *Avoir partiel* part d'une ligne libre à compléter.
- **Ordre de l'échéancier** : pas de facture de solde tant qu'un acompte est en brouillon, et plus d'acompte une fois le solde facturé. Une étape dont la facture a été annulée par avoir peut être refacturée.
- **Grille** : `data/grille.json` est la version initiale. Ensuite, la page *Grille tarifaire* enregistre chaque modification comme une nouvelle version (boutons pour télécharger et importer un `grille.json`). Un devis ou une facture garde les prix du moment où il a été fait.
- **Configurateur** : dans un devis, on clique sur le type de projet (tuiles), puis on choisit la formule et les options, chacune avec son prix. Dans la grille :
  - chaque catégorie est un type de projet ;
  - `choix_unique: true` n'autorise qu'une seule formule à la fois (une page, 5 pages ou boutique) ;
  - une catégorie avec `options_de` s'affiche sous la catégorie qu'elle complète, comme *Options de site* sous *Sites web*.
- **Modifier `data/grille.json`** : après un déploiement, si le fichier a changé depuis son dernier import, le tableau de bord le signale et *Grille tarifaire* propose de l'importer. Les informations de l'émetteur déjà remplies dans l'admin sont conservées.
- **Incompatibilités** : `incompatible_avec` sur une prestation, toujours réciproque. Exemples : une page et page supplémentaire, une page et blog, boutique et paiement en ligne. Dans le devis, une prestation incompatible avec un choix est grisée avec la raison ; la cocher retire l'autre en le signalant. Elles se règlent dans *Grille tarifaire*, sous chaque prestation (« Incompatible avec »).
- **Cadrage** : chaque devis garde les questions posées au client et ses réponses, plus des notes libres.
  - Les questions viennent de `questions_generales` et du champ `questions` de chaque catégorie de la grille. Pour un site : un thème « Projet et contenu » et un thème « Forme et identité visuelle » (impression, couleurs, typographie, photos, références, ton…).
  - Dans *Grille tarifaire*, une ligne « ## Thème » ouvre un thème.
  - Le cadrage n'apparaît jamais sur le PDF du devis, et reste modifiable après l'envoi.
- **Synthèse du projet** : un PDF généré à la demande depuis le cadrage du devis, avec les prestations retenues (sans les prix), les réponses par thème et les points restant à préciser.
  - La version *à partager* comporte un cadre « Validation du projet », à faire signer par le client.
  - La version *avec mes notes* ajoute les notes libres, sans le cadre.

### À compléter

| Quoi | Où |
| --- | --- |
| SIREN, RCS, e-mail, IBAN | `data/grille.json`, section `emetteur`, avant la première mise en ligne, ou plus tard dans l'admin : *Grille tarifaire › Émetteur*. Tant qu'ils contiennent « À COMPLÉTER », l'envoi des devis et l'émission des factures sont bloqués. |
| N° de TVA intracommunautaire | Même endroit, champ `tva_intracom`. Seulement le jour où vous passez assujetti à la TVA. |
| Identifiant de la base D1 | `wrangler.jsonc`, `database_id` (étape 2 ci-dessous). |
| Réglages Access | `wrangler.jsonc`, `ACCESS_TEAM_DOMAIN` et `ACCESS_AUD` ; l'adresse autorisée dans le secret `ADMIN_EMAIL` (étape 4 ci-dessous). |

Pénalités de retard : le texte par défaut retient « trois fois le taux d'intérêt légal ». Pour le changer, modifiez *Grille tarifaire › Mentions*.

### En local

```bash
npm install
npm run db:local        # crée ou met à jour les tables locales (après chaque nouvelle migration dans migrations/)
npm run dev
```

Puis ouvrez <http://localhost:8787/admin/>. Si l'admin semble ne pas changer après une mise à jour du code, arrêtez `npm run dev` (Ctrl+C), relancez `npm run db:local` puis `npm run dev`, et rechargez la page avec Ctrl+F5. En local, Access n'existe pas : `ADMIN_ACCES_LOCAL=1` (fichier `.dev.vars`) ouvre l'admin, uniquement sur `localhost`. La base et les archives locales sont dans `.wrangler/state/`. Les supprimer remet tout à zéro.

Tests : `npm test`. Ils couvrent le calcul des totaux, la numérotation, le blocage des factures émises, les mentions des PDF, la vérification Access, le CSV et la restauration des sauvegardes.

### Mise en ligne (une seule fois)

Après les étapes de [Mise en ligne sur Cloudflare](#mise-en-ligne-sur-cloudflare) (domaine, `npx wrangler login`) :

1. **Émetteur** : complétez SIREN, RCS, e-mail et IBAN dans `data/grille.json`.
2. **Base D1** : `npx wrangler d1 create dunelab-admin --jurisdiction eu`, puis reportez l'identifiant affiché dans `wrangler.jsonc` (`database_id`). Créez ensuite les tables avec `npm run db:distant`.
3. **Archives R2** :

   ```bash
   npx wrangler r2 bucket create dunelab-archives --jurisdiction eu
   # Verrous : factures, avoirs et sauvegardes mensuelles impossibles à supprimer ou remplacer pendant 11 ans
   # (10 ans de conservation légale, comptés à partir de la clôture de l'exercice)
   npx wrangler r2 bucket lock add dunelab-archives factures factures/ --retention-days 4018 -J eu
   npx wrangler r2 bucket lock add dunelab-archives avoirs avoirs/ --retention-days 4018 -J eu
   npx wrangler r2 bucket lock add dunelab-archives sauvegardes-mensuelles sauvegardes/mensuelles/ --retention-days 4018 -J eu
   # Sauvegardes quotidiennes effacées après 60 jours
   npx wrangler r2 bucket lifecycle add dunelab-archives sauvegardes-quotidiennes sauvegardes/quotidiennes/ --expire-days 60 -J eu
   ```

   Les verrous sont définitifs pour les fichiers concernés : n'émettez pas de factures d'essai en production, testez en local.
4. **Cloudflare Access** (offre gratuite) : tableau de bord Cloudflare › *Zero Trust*. La première fois, choisissez un nom d'équipe et l'offre *Free*.
   - *Access › Applications › Add an application › Self-hosted* : nom « Admin Dune Lab », durée de session 24 h. Ajoutez deux destinations : `www.votre-domaine.fr` avec le chemin `admin`, et `www.votre-domaine.fr` avec le chemin `api/admin`.
   - Politique : *Allow*, *Include › Emails* : votre adresse. Méthode de connexion : *One-time PIN* (code par e-mail). Pour aller plus loin, ajoutez à la politique *Require › Country* : France. Une connexion depuis l'étranger sera alors refusée, même avec un code valide.
   - Le code arrive dans votre boîte mail : protégez-la par la double authentification. C'est elle qui garde l'admin.
   - Reportez dans `wrangler.jsonc` : `ACCESS_TEAM_DOMAIN` = `https://<équipe>.cloudflareaccess.com` (*Settings › Custom Pages*, « Team domain ») et `ACCESS_AUD` = « Application Audience (AUD) Tag » (page de l'application). L'adresse autorisée, la même que dans la politique, va dans un **secret** du Worker nommé `ADMIN_EMAIL` (*Settings › Variables and Secrets*), jamais dans le dépôt.
5. **Publication** : `npm run deploy`.
6. **Vérification** : `https://www.votre-domaine.fr/admin/` demande le code puis affiche le tableau de bord. `https://dunelab.<compte>.workers.dev/admin/` doit afficher la page 404. Le lendemain, vérifiez que `sauvegardes/quotidiennes/` contient un fichier dans R2.

Une migration ajoutée plus tard dans `migrations/` s'applique avec `npm run db:distant` avant `npm run deploy`.

### Créer son premier devis

1. **Tableau de bord** : si un bandeau signale des informations à compléter, cliquez dessus (*Grille tarifaire › Émetteur*), complétez, puis *Enregistrer une nouvelle version*.
2. **Devis › Nouveau devis** :
   - choisissez le client, ou *+ Nouveau client* (particulier ou professionnel ; SIREN obligatoire pour un pro) ;
   - choisissez le *Type de projet*, par exemple *Sites web* (plusieurs types possibles, comme un site et un abonnement) ;
   - remplissez le *Cadrage du projet* pendant l'échange avec le client ;
   - cochez les prestations et les options, en réglant la quantité à côté de la case.

   Les lignes, les totaux et l'échéancier 30/40/30 se mettent à jour à chaque clic. Dans *Lignes du devis*, prix et descriptions restent modifiables, et *+ Ligne libre* ajoute une ligne hors grille. Choisissez une remise si besoin.
3. **Créer le devis** : il reçoit son numéro (`D-2026-001`). *Aperçu PDF* montre le document avec un filigrane « Brouillon ».
4. **Marquer comme envoyé** : le devis est daté du jour, figé, et son PDF définitif est archivé. Téléchargez-le avec *PDF du devis* et envoyez-le à votre client. Pour le modifier ensuite : *Dupliquer*.
5. **Quand le client signe** : *Accepté par le client*, puis *Facturer l'acompte*. Vérifiez le brouillon, *Émettre la facture*, téléchargez le PDF et envoyez-le. À réception du virement : *Enregistrer le paiement*. Même chose pour l'étape intermédiaire et le solde (qui déduit les acomptes).

### Abonnements dans un devis

Dans un devis, les lignes à l'unité « mois » ou « an » sont des abonnements :

- elles sortent du total du forfait, de l'échéancier 30/40/30, de la remise et de la base d'une majoration (livraison express) ;
- le devis affiche le total du forfait, puis « puis 29,00 € HT/mois à partir de la mise en ligne, engagement 12 mois ». Le début et l'engagement se règlent dans *Grille tarifaire › Conditions* ;
- une fois le devis accepté, *Facturer un mois d'abonnement* crée une facture par période. La première commence à la livraison : facture de solde, ou, hors forfait, première facture ponctuelle. Les suivantes sont comptées depuis cette date et ne se décalent pas (31/01, 28/02, 31/03…) ;
- le tableau de bord liste les abonnements dont la période suivante est à facturer ;
- ce sont des factures ordinaires : elles comptent dans le chiffre d'affaires encaissé et le suivi du seuil de franchise.

Abonnement sans devis, ou régie : *Factures › Nouvelle facture*, avec la période de prestation. Le mois suivant, *Dupliquer en brouillon* depuis la facture précédente.

### Sauvegardes et conservation

- **Automatique** : chaque nuit, le Worker exporte toute la base en JSON compressé dans R2 (`sauvegardes/`). D1 permet en plus de revenir à n'importe quel instant des 30 derniers jours : `npx wrangler d1 time-travel restore dunelab-admin --timestamp=2026-10-16T08:00:00Z`.
- **À la main** : *Tableau de bord › Sauvegarde complète (JSON)*, ou `npm run sauvegarde` (export SQL dans `sauvegardes/`, hors Git). Gardez régulièrement une copie hors de Cloudflare (disque, autre cloud).
- **Comptabilité** : *Export CSV* par année (factures et avoirs émis, avoirs en négatif).
- **Restaurer une sauvegarde JSON** dans une base neuve :

  ```bash
  node scripts/restaurer.js 2026-10-16.json.gz restauration.sql
  npx wrangler d1 create dunelab-admin-2 --jurisdiction eu    # reporter nom et identifiant dans wrangler.jsonc
  npm run db:distant
  npx wrangler d1 execute DB --remote --file restauration.sql
  npm run deploy
  ```

### Facturation électronique (septembre 2027)

Rien n'est à faire maintenant, mais la base est prête :

- les données sont structurées : lignes, quantités, unités, taux et catégorie de TVA, SIREN du client, nature « prestation de services » ;
- les PDF embarquent leurs polices, condition du format PDF/A-3 exigé par Factur-X.

La transmission passe par un **connecteur interchangeable** (`src/admin/connecteurs/`). Le réglage `FACTURATION_ELECTRONIQUE` de `wrangler.jsonc` choisit la plateforme, `aucun` par défaut.

À l'émission, le connecteur choisi reçoit la facture figée et son PDF archivé. Il produit le format attendu par sa plateforme (Factur-X, UBL ou CII) et renvoie le résultat, enregistré avec la facture et affiché sur sa page, avec un bouton de relance en cas d'échec. La facture reste émise même si la transmission échoue.

Pour brancher Qonto ou une autre plateforme : créer `src/admin/connecteurs/<nom>.js` sur le modèle d'`aucun.js` (le contrat est décrit dans `connecteurs/index.js`), l'inscrire dans `CONNECTEURS`, puis régler `FACTURATION_ELECTRONIQUE`.

### Offre « Outils de gestion » sur le site

La carte de service « Devis et factures en ligne » est prête mais masquée : elle est en commentaire dans `public/fr/index.html` et `public/en/index.html`, section Services. Le mode d'emploi pour l'activer est dans le commentaire : retirer les deux lignes du commentaire, passer la liste en `cards--4` (grille 2 × 2), et changer `?v=` de `style.css`.

Avant de l'activer, vérifiez qu'un vrai connecteur existe pour la plateforme agréée, puisque la carte annonce cette connexion.
