/* ==========================================================================
   Grille tarifaire : émetteur, TVA, prestations, remises, conditions, mentions.
   Chaque enregistrement crée une nouvelle version ; les devis et factures
   existants gardent leurs prix. Import / export au format de data/grille.json.
   ========================================================================== */

import { agir, api, champ, confirmer, date, enTete, h, marquerModifie, notifier, rafraichir } from "../ui.js";
import { analyserNombre, formaterNombre } from "../lib/format.js";
import { questionsEnTexte, texteEnQuestions, themesDeQuestions } from "../lib/questions.js";

const A_COMPLETER = /COMPL[ÉE]TER/i;

// Identifiant lisible et unique, tiré du nom (« Page supplémentaire » → « opt-page-supplementaire »)
function identifiant(prefixe, nom, existants) {
  const base = `${prefixe ? `${prefixe}-` : ""}${nom}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "element";
  let id = base;
  for (let i = 2; existants.has(id); i++) id = `${base}-${i}`;
  existants.add(id);
  return id;
}

// Champ texte relié à une propriété de l'objet `cible`
function texte(cible, cle, attributs = {}) {
  const multiligne = attributs.rows;
  const el = h(multiligne ? "textarea" : "input", {
    type: multiligne ? undefined : "text",
    value: cible[cle] ?? "",
    ...attributs,
    onInput: (e) => {
      cible[cle] = e.target.value;
      marquerModifie();
      if (A_COMPLETER.test(e.target.value)) e.target.setAttribute("aria-invalid", "true");
      else e.target.removeAttribute("aria-invalid");
    },
  });
  if (A_COMPLETER.test(String(cible[cle] ?? ""))) el.setAttribute("aria-invalid", "true");
  return el;
}

// Champ nombre (saisie française) ; `facteur` 100 pour afficher 0.15 en « 15 »
function nombre(cible, cle, { facteur = 1, entier = false, ...attributs } = {}) {
  const valeur = cible[cle];
  return h("input", {
    type: "text",
    inputmode: "decimal",
    class: "nombre",
    value: valeur === undefined || valeur === null ? "" : formaterNombre(valeur * facteur, 4),
    ...attributs,
    onInput: (e) => {
      // Champ vidé : la propriété disparaît (le serveur signale les champs obligatoires)
      if (e.target.value.trim() === "") {
        delete cible[cle];
        e.target.removeAttribute("aria-invalid");
        marquerModifie();
        return;
      }
      const n = analyserNombre(e.target.value);
      const valide = Number.isFinite(n) && (!entier || Number.isInteger(n));
      e.target.setAttribute("aria-invalid", String(!valide));
      if (valide) cible[cle] = Math.round((n / facteur) * 1e6) / 1e6;
      marquerModifie();
    },
  });
}

function caseACocher(cible, cle, libelle) {
  return h(
    "label",
    { class: "choix" },
    h("input", {
      type: "checkbox",
      checked: Boolean(cible[cle]),
      onChange: (e) => {
        if (e.target.checked) cible[cle] = true;
        else delete cible[cle];
        marquerModifie();
      },
    }),
    libelle
  );
}

function boutonRetirer(libelle, action) {
  return h("button", { type: "button", class: "bouton-icone bouton-icone--danger", title: libelle, "aria-label": libelle, onClick: action }, "✕");
}

/**
 * Références vers des prestations ou des catégories retirées (incompatibilités,
 * « options de ») : supprimées, sinon la grille ne pourrait plus être enregistrée.
 */
function nettoyerReferences(g) {
  const prestations = new Set(g.categories.flatMap((c) => c.prestations.map((p) => p.id)).filter(Boolean));
  const categories = new Set(g.categories.map((c) => c.id).filter(Boolean));
  for (const c of g.categories) {
    if (c.options_de && !categories.has(c.options_de)) delete c.options_de;
    for (const p of c.prestations) {
      if (!p.incompatible_avec) continue;
      p.incompatible_avec = p.incompatible_avec.filter((id) => id !== p.id && prestations.has(id));
      if (!p.incompatible_avec.length) delete p.incompatible_avec;
    }
  }
}

/* ---------- Sections ---------- */

function sectionEmetteur(g) {
  const e = g.emetteur;
  return h(
    "section",
    { class: "carte", id: "emetteur" },
    h("h2", {}, "Émetteur"),
    h("p", { class: "discret" }, "Imprimé sur chaque devis et facture. Les champs « À COMPLÉTER » bloquent l'envoi des devis et l'émission des factures."),
    h("div", { class: "rangee" }, champ("Dénomination", texte(e, "denomination")), champ("Forme", texte(e, "forme")), champ("Capital", texte(e, "capital"))),
    champ("Siège", texte(e, "siege")),
    h("div", { class: "rangee" }, champ("SIREN", texte(e, "siren")), champ("RCS", texte(e, "rcs"), "Ex. : RCS Bordeaux 123 456 789")),
    h("div", { class: "rangee" }, champ("E-mail", texte(e, "email")), champ("IBAN", texte(e, "iban"))),
    champ("N° de TVA intracommunautaire", texte(e, "tva_intracom"), "Obligatoire seulement une fois assujetti à la TVA.")
  );
}

function sectionTva(g) {
  const t = g.tva;
  const regime = h(
    "select",
    { value: t.regime, onChange: (e) => { t.regime = e.target.value; marquerModifie(); } },
    h("option", { value: "franchise_en_base" }, "Franchise en base (pas de TVA facturée)"),
    h("option", { value: "assujetti" }, "Assujetti : TVA facturée")
  );
  return h(
    "section",
    { class: "carte", id: "tva" },
    h("h2", {}, "TVA"),
    h("p", { class: "discret" }, "Le régime s'applique aux devis envoyés et factures émises à partir de l'enregistrement. Les documents déjà émis ne changent pas."),
    h("div", { class: "rangee" }, champ("Régime", regime), champ("Taux si assujetti (%)", nombre(t, "taux_si_assujetti", { facteur: 100 }))),
    champ("Mention en franchise", texte(t, "mention_franchise")),
    champ("Seuil de franchise (€ HT encaissés par an)", nombre(t, "seuil_franchise"), "Alerte au tableau de bord à 80 % puis au dépassement.")
  );
}

function rangeePrestation(g, categorie, p, redessiner) {
  const enPourcentage = p.prix_pourcentage !== undefined;
  const typePrix = h(
    "select",
    {
      "aria-label": "Type de prix",
      value: enPourcentage ? "pourcentage" : "prix",
      onChange: (e) => {
        if (e.target.value === "pourcentage") {
          delete p.prix;
          p.prix_pourcentage = 0;
        } else {
          delete p.prix_pourcentage;
          p.prix = 0;
        }
        marquerModifie();
        redessiner();
      },
    },
    h("option", { value: "prix" }, "€ HT"),
    h("option", { value: "pourcentage" }, "% majoration")
  );
  return h(
    "tr",
    {},
    h("td", { "data-titre": "Prestation" }, texte(p, "nom", { "aria-label": "Nom", placeholder: "Nom" }), texte(p, "description", { "aria-label": "Description", placeholder: "Description (facultative)", class: "discret" }), h("span", { class: "ligne__ref" }, p.id || "nouvelle"), choixIncompatibilites(g, p)),
    h("td", { "data-titre": "Prix" }, h("div", { class: "avec-unite" }, enPourcentage ? nombre(p, "prix_pourcentage", { facteur: 100, "aria-label": "Pourcentage" }) : nombre(p, "prix", { "aria-label": "Prix HT" }), typePrix)),
    h("td", { "data-titre": "Unité" }, texte(p, "unite", { "aria-label": "Unité", list: "unites-grille" })),
    h(
      "td",
      { "data-titre": "Délai (jours)" },
      nombre(p, "delai_jours", { entier: true, "aria-label": "Délai en jours" }),
      // Livraison express : 2 divise par deux le délai suggéré dans les devis
      nombre(p, "divise_delai", { "aria-label": "Divise le délai d'exécution par", placeholder: "÷", title: "Divise le délai suggéré par (2 pour une livraison express)", class: "nombre grille__diviseur" })
    ),
    h("td", { "data-titre": "À partir de" }, caseACocher(p, "a_partir_de", "à partir de")),
    h(
      "td",
      { class: "ligne__actions" },
      boutonRetirer("Retirer la prestation", () => {
        categorie.prestations.splice(categorie.prestations.indexOf(p), 1);
        nettoyerReferences(g);
        marquerModifie();
        redessiner();
      })
    )
  );
}

// Questions, une par ligne, « ## Thème » pour regrouper ; la propriété disparaît si la liste est vide
function champQuestions(cible, cle, attributs = {}) {
  const texteInitial = questionsEnTexte(cible[cle] || []);
  return h("textarea", {
    rows: Math.max(4, texteInitial.split("\n").length + 1),
    value: texteInitial,
    ...attributs,
    onInput: (e) => {
      const questions = texteEnQuestions(e.target.value);
      if (questions.length) cible[cle] = questions;
      else delete cible[cle];
      marquerModifie();
    },
  });
}

/**
 * Incompatibilités d'une prestation, réciproques : cocher « Boutique en ligne »
 * sur « Paiement en ligne » l'inscrit des deux côtés.
 */
function choixIncompatibilites(g, p) {
  if (!p.id) return h("p", { class: "ligne__ref" }, "Incompatibilités : enregistrez d'abord cette prestation.");
  const autres = g.categories.flatMap((c) => c.prestations.filter((x) => x !== p && x.id).map((x) => ({ x, categorie: c.nom })));
  const lie = (x) => (p.incompatible_avec || []).includes(x.id) || (x.incompatible_avec || []).includes(p.id);
  const basculer = (cible, id, actif) => {
    const liste = new Set(cible.incompatible_avec || []);
    if (actif) liste.add(id);
    else liste.delete(id);
    if (liste.size) cible.incompatible_avec = [...liste];
    else delete cible.incompatible_avec;
  };
  const compte = () => `Incompatible avec (${autres.filter(({ x }) => lie(x)).length})`;
  const resume = h("summary", {}, compte());
  return h(
    "details",
    { class: "incompatibilites" },
    resume,
    h(
      "div",
      { class: "incompatibilites__liste" },
      autres.map(({ x, categorie }) =>
        h(
          "label",
          { class: "choix" },
          h("input", {
            type: "checkbox",
            checked: lie(x),
            onChange: (e) => {
              basculer(p, x.id, e.target.checked);
              basculer(x, p.id, e.target.checked);
              resume.textContent = compte();
              marquerModifie();
            },
          }),
          `${x.nom} `,
          h("span", { class: "discret" }, `(${categorie})`)
        )
      )
    )
  );
}

// Catégorie principale (un type de projet) ou options d'une autre catégorie
function choixRattachement(g, categorie, redessiner) {
  const parentes = g.categories.filter((c) => c !== categorie && !c.options_de && c.id);
  return h(
    "select",
    {
      value: categorie.options_de || "",
      onChange: (e) => {
        if (e.target.value) categorie.options_de = e.target.value;
        else delete categorie.options_de;
        marquerModifie();
        redessiner();
      },
    },
    h("option", { value: "" }, "Type de projet (catégorie principale)"),
    parentes.map((c) => h("option", { value: c.id }, `Options de « ${c.nom} »`))
  );
}

function sectionPrestations(g) {
  const conteneur = h("div");
  function redessiner() {
    conteneur.replaceChildren(
      ...g.categories.map((categorie) =>
        h(
          "div",
          { class: "categorie" },
          h(
            "div",
            { class: "categorie__entete" },
            champ("Catégorie", texte(categorie, "nom")),
            boutonRetirer("Retirer la catégorie", async () => {
              if (categorie.prestations.length && !(await confirmer({ titre: `Retirer « ${categorie.nom} » ?`, message: "Ses prestations disparaîtront de la grille (les documents existants ne changent pas).", bouton: "Retirer", danger: true }))) return;
              g.categories.splice(g.categories.indexOf(categorie), 1);
              nettoyerReferences(g);
              marquerModifie();
              redessiner();
            })
          ),
          h(
            "div",
            { class: "rangee" },
            h(
              "div",
              {},
              champ("Rôle dans les devis", choixRattachement(g, categorie, redessiner), "Une catégorie d'options s'affiche sous la catégorie qu'elle complète."),
              categorie.options_de ? null : caseACocher(categorie, "choix_unique", "Une seule formule à la fois (ex. : une page, 5 pages ou boutique)")
            ),
            h(
              "details",
              { class: "categorie__questions" },
              h("summary", {}, `Questions de cadrage (${themesDeQuestions(categorie.questions).flatMap((t) => t.questions).length})`),
              champ("Une question par ligne ; « ## Thème » pour regrouper", champQuestions(categorie, "questions"))
            )
          ),
          h(
            "div",
            { class: "tableau-defilant" },
            h(
              "table",
              { class: "tableau tableau--grille" },
              h("thead", {}, h("tr", {}, ["Prestation", "Prix", "Unité", "Délai (jours)", "", ""].map((t) => h("th", { scope: "col" }, t)))),
              h("tbody", {}, categorie.prestations.map((p) => rangeePrestation(g, categorie, p, redessiner)))
            )
          ),
          h(
            "button",
            {
              type: "button",
              class: "bouton bouton--discret",
              onClick: () => {
                categorie.prestations.push({ id: "", nom: "", description: "", prix: 0, unite: "forfait" });
                marquerModifie();
                redessiner();
              },
            },
            "+ Prestation"
          )
        )
      ),
      h(
        "button",
        {
          type: "button",
          class: "bouton",
          onClick: () => {
            g.categories.push({ id: "", nom: "Nouvelle catégorie", prestations: [] });
            marquerModifie();
            redessiner();
          },
        },
        "+ Catégorie"
      )
    );
  }
  redessiner();
  const unites = [...new Set(g.categories.flatMap((c) => c.prestations.map((p) => p.unite)))];
  return h(
    "section",
    { class: "carte", id: "prestations" },
    h("h2", {}, "Prestations"),
    h("p", { class: "discret" }, "Prix HT en euros. « À partir de » : prix indicatif, à ajuster dans chaque devis. Le délai sert à suggérer le délai d'exécution."),
    h("datalist", { id: "unites-grille" }, unites.map((u) => h("option", { value: u }))),
    conteneur
  );
}

function sectionRemises(g) {
  const conteneur = h("div");
  function redessiner() {
    conteneur.replaceChildren(
      ...g.remises.map((r) =>
        h(
          "div",
          { class: "rangee rangee--bas" },
          champ("Nom", texte(r, "nom")),
          champ("Remise (%)", nombre(r, "pourcentage", { facteur: 100 })),
          boutonRetirer("Retirer la remise", () => {
            g.remises.splice(g.remises.indexOf(r), 1);
            marquerModifie();
            redessiner();
          })
        )
      ),
      h("button", { type: "button", class: "bouton bouton--discret", onClick: () => { g.remises.push({ id: "", nom: "", pourcentage: 0 }); marquerModifie(); redessiner(); } }, "+ Remise")
    );
  }
  redessiner();
  return h("section", { class: "carte", id: "remises" }, h("h2", {}, "Remises"), conteneur);
}

function sectionConditions(g) {
  const c = g.conditions;
  const etapes = h("div");
  function redessiner() {
    etapes.replaceChildren(
      ...c.echeancier_forfait.map((e) =>
        h(
          "div",
          { class: "rangee rangee--bas" },
          champ("Étape", texte(e, "etape")),
          champ("Part (%)", nombre(e, "pourcentage", { facteur: 100 })),
          boutonRetirer("Retirer l'étape", () => {
            c.echeancier_forfait.splice(c.echeancier_forfait.indexOf(e), 1);
            marquerModifie();
            redessiner();
          })
        )
      ),
      h("button", { type: "button", class: "bouton bouton--discret", onClick: () => { c.echeancier_forfait.push({ etape: "", pourcentage: 0 }); marquerModifie(); redessiner(); } }, "+ Étape")
    );
  }
  redessiner();
  return h(
    "section",
    { class: "carte", id: "conditions" },
    h("h2", {}, "Conditions"),
    h(
      "div",
      { class: "rangee" },
      champ("Validité des devis (jours)", nombre(c, "validite_devis_jours", { entier: true })),
      champ("Délai de paiement (jours)", nombre(c, "delai_paiement_jours", { entier: true })),
      champ("Révisions incluses", nombre(c, "revisions_incluses", { entier: true }))
    ),
    h("h3", {}, "Échéancier des forfaits"),
    h("p", { class: "discret" }, "Le total doit faire 100 %. La première étape est l'acompte, la dernière le solde."),
    etapes,
    champ("Facturation en régie", texte(c, "echeancier_regie")),
    champ("Abonnements", texte(c, "abonnement", { rows: 2 })),
    h(
      "div",
      { class: "rangee" },
      champ("Début des abonnements", texte(c, "abonnement_debut"), "Sur le devis : « puis 29,00 € HT/mois à partir de la mise en ligne »."),
      champ("Engagement (mois)", nombre(c, "abonnement_engagement_mois", { entier: true }), "Vide : aucun engagement affiché.")
    ),
    champ("Propriété", texte(c, "propriete", { rows: 2 }))
  );
}

function listeEnTexte(cible, cle) {
  return h("textarea", {
    rows: Math.max(4, cible[cle].length + 1),
    value: cible[cle].join("\n"),
    onInput: (e) => {
      cible[cle] = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
      marquerModifie();
    },
  });
}

function sectionQuestions(g) {
  return h(
    "section",
    { class: "carte", id: "questions" },
    h("h2", {}, "Questions générales"),
    h("p", { class: "discret" }, "Posées pour tous les projets, dans le cadrage de chaque devis. Les questions propres à un type de projet se règlent dans sa catégorie, section Prestations."),
    champ("Une question par ligne ; « ## Thème » pour regrouper", champQuestions(g, "questions_generales"))
  );
}

function sectionMentions(g) {
  const m = g.mentions;
  const t = m.textes;
  return h(
    "section",
    { class: "carte", id: "mentions" },
    h("h2", {}, "Mentions"),
    h("h3", {}, "Textes imprimés sur les documents"),
    champ("Nature de l'opération", texte(t, "nature_operation")),
    champ("Pénalités de retard", texte(t, "penalites_retard", { rows: 3 })),
    champ("Indemnité forfaitaire (clients professionnels)", texte(t, "indemnite_recouvrement", { rows: 2 })),
    champ("Escompte", texte(t, "escompte")),
    champ("Titre du cadre de signature du devis", texte(t, "bon_pour_accord")),
    h("h3", {}, "Aide-mémoire des mentions obligatoires (une par ligne)"),
    h("div", { class: "rangee" }, champ("Devis", listeEnTexte(m, "devis")), champ("Factures", listeEnTexte(m, "facture")))
  );
}

/* ---------- Page ---------- */

function telecharger(contenu, nom) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(contenu, null, 2) + "\n"], { type: "application/json" }));
  const lien = h("a", { href: url, download: nom });
  document.body.append(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}

export async function pageGrille() {
  const [grille, historique] = await Promise.all([api("/grille"), api("/grille/historique")]);
  // Copie de travail : les propriétés inconnues de l'interface sont conservées telles quelles
  const g = structuredClone(grille.contenu);
  g.categories ??= [];
  g.remises ??= [];

  const erreurs = h("div", { role: "alert" });
  const enregistrer = h("button", { type: "submit", class: "bouton bouton--principal" }, "Enregistrer une nouvelle version");

  function completerIdentifiants() {
    const existants = new Set(g.categories.flatMap((c) => [c.id, ...c.prestations.map((p) => p.id)]).filter(Boolean));
    for (const c of g.categories) {
      if (!c.id) c.id = identifiant("", c.nom, existants);
      for (const p of c.prestations) if (!p.id) p.id = identifiant(c.id, p.nom, existants);
    }
    const remises = new Set(g.remises.map((r) => r.id).filter(Boolean));
    for (const r of g.remises) if (!r.id) r.id = identifiant("rem", r.nom, remises);
    // Champs facultatifs laissés vides
    for (const p of g.categories.flatMap((c) => c.prestations)) {
      if (p.description === "") delete p.description;
      if (p.delai_jours === undefined || p.delai_jours === null) delete p.delai_jours;
    }
  }

  const importer = h("input", {
    type: "file",
    accept: "application/json,.json",
    class: "invisible",
    onChange: async (e) => {
      const fichier = e.target.files[0];
      e.target.value = "";
      if (!fichier) return;
      try {
        const contenu = JSON.parse(await fichier.text());
        const ok = await confirmer({ titre: `Importer « ${fichier.name} » ?`, message: "Il deviendra la nouvelle version de la grille (les documents existants ne changent pas).", bouton: "Importer" });
        if (!ok) return;
        await api("/grille", { methode: "PUT", corps: { contenu } });
        notifier("Grille importée.");
        rafraichir();
      } catch (erreur) {
        afficherErreurs(erreur);
      }
    },
  });

  function afficherErreurs(erreur) {
    const details = Array.isArray(erreur.details) ? erreur.details : [];
    erreurs.replaceChildren(
      h("div", { class: "alerte alerte--danger" }, h("p", {}, erreur.message), details.length ? h("ul", {}, details.map((d) => h("li", {}, d))) : null)
    );
    erreurs.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const formulaire = h(
    "form",
    {
      class: "grille-tarifaire",
      novalidate: true,
      onSubmit: (e) => {
        e.preventDefault();
        agir(enregistrer, async () => {
          erreurs.replaceChildren();
          completerIdentifiants();
          nettoyerReferences(g);
          g.date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
          try {
            await api("/grille", { methode: "PUT", corps: { contenu: g } });
          } catch (erreur) {
            afficherErreurs(erreur);
            return;
          }
          marquerModifie(false);
          notifier("Nouvelle version de la grille enregistrée.");
          rafraichir();
        });
      },
    },
    erreurs,
    sectionEmetteur(g),
    sectionTva(g),
    sectionPrestations(g),
    sectionRemises(g),
    sectionConditions(g),
    sectionQuestions(g),
    sectionMentions(g),
    h("div", { class: "barre-enregistrement" }, enregistrer)
  );

  const importerFichier = h("button", { type: "button", class: "bouton bouton--principal" }, "Importer data/grille.json");
  importerFichier.addEventListener("click", () =>
    agir(importerFichier, async () => {
      const ok = await confirmer({
        titre: "Importer data/grille.json ?",
        message: [
          "Le fichier deviendra la nouvelle version de la grille. Les devis et factures existants ne changent pas.",
          "Les informations de l'émetteur déjà remplies ici (SIREN, IBAN…) sont gardées si le fichier les laisse « À COMPLÉTER ». Les autres modifications faites ici depuis le dernier import seront remplacées : téléchargez d'abord la grille actuelle si besoin.",
        ],
        bouton: "Importer",
      });
      if (!ok) return;
      await api("/grille/importer-fichier", { methode: "POST" });
      marquerModifie(false);
      notifier("Grille importée depuis data/grille.json.");
      rafraichir();
    })
  );

  return h(
    "div",
    { class: "page page--etroite" },
    enTete(
      "Grille tarifaire",
      h("button", { type: "button", class: "bouton", onClick: () => telecharger(grille.contenu, "grille.json") }, "Télécharger grille.json"),
      h("button", { type: "button", class: "bouton", onClick: () => importer.click() }, "Importer un fichier"),
      importer
    ),
    h(
      "p",
      { class: "discret" },
      `Version ${grille.id} du ${date(grille.cree_le.slice(0, 10))}. Chaque enregistrement crée une nouvelle version : les devis et factures déjà créés gardent leurs prix.`
    ),
    grille.fichier_a_importer
      ? h(
          "div",
          { class: "alerte alerte--attention" },
          h("p", {}, "Le fichier ", h("code", {}, "data/grille.json"), " a changé depuis son dernier import (nouvelles prestations, nouveaux prix…)."),
          h("p", {}, importerFichier)
        )
      : null,
    h(
      "nav",
      { class: "sommaire", "aria-label": "Sections de la grille" },
      [["emetteur", "Émetteur"], ["tva", "TVA"], ["prestations", "Prestations"], ["remises", "Remises"], ["conditions", "Conditions"], ["questions", "Questions"], ["mentions", "Mentions"]].map(([ancre, nom]) =>
        h("a", { href: `#/grille`, onClick: (e) => { e.preventDefault(); document.getElementById(ancre).scrollIntoView({ behavior: "smooth" }); } }, nom)
      )
    ),
    formulaire,
    historique.length > 1
      ? h(
          "details",
          { class: "carte historique" },
          h("summary", {}, `Versions précédentes (${historique.length - 1})`),
          h(
            "ul",
            {},
            historique.slice(1).map((v) =>
              h(
                "li",
                {},
                `Version ${v.id} du ${date(v.cree_le.slice(0, 10))} · `,
                h("button", { type: "button", class: "lien", onClick: async () => telecharger((await api(`/grille/${v.id}`)).contenu, `grille-v${v.id}.json`) }, "télécharger")
              )
            )
          )
        )
      : null
  );
}
