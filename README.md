# Dune Lab – site vitrine

Site statique (HTML, CSS, JavaScript natif) publié sur Cloudflare Workers, avec un petit Worker pour le formulaire de devis (vérification anti-robot Turnstile et envoi par email avec Resend). Aucune étape de build : les fichiers de `public/` sont publiés tels quels.

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
│   └── assets/
│       ├── css/style.css      Thème : variables en tête de fichier (:root)
│       ├── js/main.js         Menu, animations, cartes projets, formulaire, Turnstile
│       ├── js/projects.js     Liste des réalisations (à éditer pour ajouter un projet)
│       ├── fonts/             Fraunces et Inter (Google Fonts, auto-hébergées)
│       └── img/               Logo, images de partage, captures des projets
├── src/worker.js              Formulaire : vérifications, Turnstile, envoi via Resend
├── wrangler.jsonc             Configuration Cloudflare (adresses email du formulaire)
├── package.json               Commandes npm run dev / npm run deploy
└── .dev.vars.example          Réglages locaux : clé de test Turnstile, emails simulés
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

## Tester après la mise en ligne

- La racine du domaine ouvre `/fr/`, le sélecteur FR / EN bascule sur la page équivalente, une adresse inexistante affiche la page 404.
- Envoyer une demande depuis `/fr/#contact` et `/en/#contact`, vérifier la réception (et les spams). *Répondre* doit répondre à la personne qui a rempli le formulaire.
- En cas d'échec : onglet *Emails* de Resend, journaux du Worker (*Workers & Pages* → `dunelab` → *Logs*), ou `npx wrangler tail` pendant un envoi.
- Déclarer le site dans Google Search Console et soumettre `https://www.votre-domaine.fr/sitemap.xml`.

## Faire évoluer le site

- **Ajouter un projet** : copier un bloc dans `public/assets/js/projects.js`. Le mode d'emploi est en tête du fichier. Captures : WebP 1200 × 750 px dans `public/assets/img/projects/`.
- **Changer les couleurs ou les polices** : variables `:root` en tête de `public/assets/css/style.css`.
- **Après une modification de CSS ou de JS** : incrémenter `?v=1` (→ `?v=2`) dans les balises `<link>` / `<script>` des pages HTML pour que les navigateurs rechargent le fichier.
