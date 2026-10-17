/* ==========================================================================
   Éléments communs aux devis et aux factures : éditeur de lignes (prestations
   de la grille ou lignes libres), choix de la remise, récapitulatif des
   montants calculé en direct (le Worker recalcule à l'enregistrement).
   ========================================================================== */

import { h, marquerModifie } from "../ui.js";
import { calculerDevis, calculerDocument, calculerLignes, estLignePourcentage } from "../lib/calcul.js";
import { periodeDeLigne, phraseAbonnement } from "../lib/abonnement.js";
import {
  analyserMontant,
  analyserNombre,
  enCentimes,
  enPointsDeBase,
  formaterMontant,
  formaterNombre,
  formaterPourcentage,
} from "../lib/format.js";

/** Taux de TVA (points de base) que la grille appliquerait aujourd'hui */
export function tauxTvaDeLaGrille(grille) {
  return grille.tva.regime === "assujetti" ? enPointsDeBase(grille.tva.taux_si_assujetti) : 0;
}

/** Ligne de document copiée d'une prestation de la grille (le prix est figé dans le document) */
export function ligneDepuisPrestation(prestation) {
  const enPourcentage = prestation.prix_pourcentage !== undefined;
  return {
    ref: prestation.id,
    designation: prestation.nom,
    description: prestation.description || "",
    unite: prestation.unite,
    quantite: 1,
    prix_unitaire: enPourcentage ? null : enCentimes(prestation.prix),
    pourcentage: enPourcentage ? enPointsDeBase(prestation.prix_pourcentage) : null,
  };
}

// Montant en centimes affiché dans un champ de saisie : « 1 800 » ou « 12,50 »
function saisieMontant(centimes) {
  return formaterNombre(centimes / 100, 2).replace(/,(\d)$/, (tout, chiffre) => `,${chiffre}0`);
}

/* ---------- Éditeur de lignes ---------- */

/**
 * lignes : lignes initiales ; grille : contenu de la grille courante ;
 * surChangement() appelé à chaque modification.
 * Renvoie { element, lire, ajouterPrestation, retirerRef, ligneDeRef, definirQuantite, refs, observer } ;
 * lire() renvoie { lignes, erreurs }. Le configurateur à cases pilote l'éditeur par ces fonctions.
 */
export function editeurLignes(lignes, grille, surChangement, { abonnements = false } = {}) {
  const corps = h("tbody");
  const rangees = [];
  const observateurs = [];

  function lireRangee(r) {
    const quantite = analyserNombre(r.quantite.value);
    const valeur = r.pourcentage ? Math.round(analyserNombre(r.prix.value) * 100) : analyserMontant(r.prix.value);
    return {
      ref: r.ref,
      designation: r.designation.value.trim(),
      description: r.description.value.trim(),
      unite: r.unite.value.trim(),
      quantite: r.pourcentage ? 1 : quantite,
      prix_unitaire: r.pourcentage ? null : valeur,
      pourcentage: r.pourcentage ? valeur : null,
    };
  }

  function lire() {
    const erreurs = [];
    const resultat = rangees.map((r, i) => {
      const ligne = lireRangee(r);
      const quantiteValide = Number.isFinite(ligne.quantite) && ligne.quantite > 0;
      const prix = r.pourcentage ? ligne.pourcentage : ligne.prix_unitaire;
      const prixValide = Number.isFinite(prix) && prix >= 0;
      r.quantite.setAttribute("aria-invalid", String(!quantiteValide));
      r.prix.setAttribute("aria-invalid", String(!prixValide));
      r.designation.setAttribute("aria-invalid", String(ligne.designation === ""));
      if (!ligne.designation) erreurs.push(`Ligne ${i + 1} : désignation manquante.`);
      if (!quantiteValide) erreurs.push(`Ligne ${i + 1} : quantité invalide.`);
      if (!prixValide) erreurs.push(`Ligne ${i + 1} : prix invalide.`);
      return ligne;
    });
    return { lignes: resultat, erreurs };
  }

  // Total de chaque ligne ; dans un devis, une majoration ne porte pas sur les abonnements
  function totauxLignes(lues) {
    if (!abonnements) return calculerLignes(lues).map((l) => l.total);
    const ponctuelles = calculerLignes(lues.filter((l) => !periodeDeLigne(l)));
    const recurrentes = calculerLignes(lues.filter((l) => periodeDeLigne(l)));
    let i = 0;
    let j = 0;
    return lues.map((l) => (periodeDeLigne(l) ? recurrentes[j++].total : ponctuelles[i++].total));
  }

  function afficherTotaux(lues) {
    const totaux = totauxLignes(lues);
    rangees.forEach((r, i) => {
      const periode = abonnements ? periodeDeLigne(lues[i]) : null;
      r.total.textContent = `${formaterMontant(totaux[i])}${periode ? `/${periode}` : ""}`;
    });
  }

  // Totaux de chaque ligne, recalculés à chaque saisie
  function majTotaux() {
    const { lignes: lues, erreurs } = lire();
    if (erreurs.length) rangees.forEach((r) => (r.total.textContent = "—"));
    else afficherTotaux(lues);
    surChangement();
    observateurs.forEach((fonction) => fonction());
  }

  function ajouter(ligne) {
    const pourcentage = estLignePourcentage(ligne);
    const r = {
      ref: ligne.ref || null,
      pourcentage,
      designation: h("input", { type: "text", class: "ligne__designation", maxlength: 300, value: ligne.designation, "aria-label": "Désignation", placeholder: "Désignation" }),
      description: h("textarea", { class: "ligne__description", rows: 1, maxlength: 2000, value: ligne.description || "", "aria-label": "Description", placeholder: "Description (facultative)" }),
      quantite: h("input", { type: "text", inputmode: "decimal", class: "nombre", value: formaterNombre(ligne.quantite), "aria-label": "Quantité", disabled: pourcentage }),
      unite: h("input", { type: "text", maxlength: 30, value: ligne.unite || "", "aria-label": "Unité", list: "unites" }),
      prix: h("input", {
        type: "text",
        inputmode: "decimal",
        class: "nombre",
        "aria-label": pourcentage ? "Majoration en %" : "Prix unitaire HT en euros",
        value: pourcentage ? formaterNombre(ligne.pourcentage / 100, 2) : saisieMontant(ligne.prix_unitaire),
      }),
      total: h("td", { class: "nombre ligne__total", "data-titre": "Total HT" }),
    };
    const deplacer = (sens) => {
      const i = rangees.indexOf(r);
      const j = i + sens;
      if (j < 0 || j >= rangees.length) return;
      [rangees[i], rangees[j]] = [rangees[j], rangees[i]];
      corps.replaceChildren(...rangees.map((x) => x.tr));
      marquerModifie();
      majTotaux();
    };
    r.tr = h(
      "tr",
      { class: "ligne" },
      h("td", { "data-titre": "Désignation" }, r.designation, r.description, r.ref ? h("span", { class: "ligne__ref" }, `Grille : ${r.ref}`) : null),
      h("td", { "data-titre": "Qté" }, r.quantite),
      h("td", { "data-titre": "Unité" }, r.unite),
      h("td", { "data-titre": pourcentage ? "Majoration (%)" : "Prix unit. HT (€)" }, h("div", { class: "avec-unite" }, r.prix, h("span", {}, pourcentage ? "%" : "€"))),
      r.total,
      h(
        "td",
        { class: "ligne__actions" },
        h("button", { type: "button", class: "bouton-icone", title: "Monter", "aria-label": "Monter la ligne", onClick: () => deplacer(-1) }, "↑"),
        h("button", { type: "button", class: "bouton-icone", title: "Descendre", "aria-label": "Descendre la ligne", onClick: () => deplacer(1) }, "↓"),
        h(
          "button",
          {
            type: "button",
            class: "bouton-icone bouton-icone--danger",
            title: "Supprimer",
            "aria-label": "Supprimer la ligne",
            onClick: () => {
              rangees.splice(rangees.indexOf(r), 1);
              r.tr.remove();
              marquerModifie();
              majTotaux();
            },
          },
          "✕"
        )
      )
    );
    rangees.push(r);
    corps.append(r.tr);
  }

  lignes.forEach(ajouter);

  const unites = [...new Set((grille.categories || []).flatMap((c) => (c.prestations || []).map((p) => p.unite)))];

  const element = h(
    "div",
    { class: "lignes" },
    h(
      "div",
      { class: "tableau-defilant" },
      h(
        "table",
        { class: "tableau tableau--lignes", onInput: majTotaux },
        h(
          "thead",
          {},
          h("tr", {}, ["Désignation", "Qté", "Unité", "Prix unit. HT", "Total HT", ""].map((t, i) => h("th", { scope: "col", class: i === 1 || i >= 3 ? "nombre" : "" }, t)))
        ),
        corps
      )
    ),
    h("datalist", { id: "unites" }, unites.map((u) => h("option", { value: u }))),
    h(
      "div",
      { class: "lignes__ajout" },
      h(
        "button",
        {
          type: "button",
          class: "bouton",
          onClick: () => {
            ajouter({ ref: null, designation: "", description: "", unite: "forfait", quantite: 1, prix_unitaire: 0, pourcentage: null });
            marquerModifie();
            majTotaux();
            rangees.at(-1).designation.focus();
          },
        },
        "+ Ligne libre"
      )
    )
  );
  // Totaux initiaux, sans signaler de modification
  queueMicrotask(() => {
    const { lignes: lues, erreurs } = lire();
    if (!erreurs.length) afficherTotaux(lues);
  });

  const rangeeDeRef = (ref) => rangees.find((r) => r.ref === ref);
  return {
    element,
    lire,
    refs: () => rangees.map((r) => r.ref).filter(Boolean),
    ligneDeRef: (ref) => {
      const r = rangeeDeRef(ref);
      return r ? lireRangee(r) : null;
    },
    ajouterPrestation(prestation) {
      ajouter(ligneDepuisPrestation(prestation));
      marquerModifie();
      majTotaux();
    },
    retirerRef(ref) {
      const r = rangeeDeRef(ref);
      if (!r) return;
      rangees.splice(rangees.indexOf(r), 1);
      r.tr.remove();
      marquerModifie();
      majTotaux();
    },
    definirQuantite(ref, quantite) {
      const r = rangeeDeRef(ref);
      if (!r || r.pourcentage) return;
      r.quantite.value = formaterNombre(quantite);
      marquerModifie();
      majTotaux();
    },
    observer: (fonction) => observateurs.push(fonction),
  };
}

/* ---------- Remise ---------- */

/** Choix : aucune, une remise de la grille, ou manuelle (% ou €). Renvoie { element, lire() } */
export function choixRemise(remise, grille, surChangement) {
  const remisesGrille = grille.remises || [];
  const options = [
    h("option", { value: "aucune" }, "Aucune remise"),
    ...remisesGrille.map((r) => h("option", { value: `grille:${r.id}` }, `${r.nom} (${formaterPourcentage(enPointsDeBase(r.pourcentage))})`)),
    h("option", { value: "pourcentage" }, "Remise manuelle en %"),
    h("option", { value: "montant" }, "Remise manuelle en €"),
  ];
  let initial = "aucune";
  if (remise?.ref && remisesGrille.some((r) => r.id === remise.ref && enPointsDeBase(r.pourcentage) === remise.valeur)) initial = `grille:${remise.ref}`;
  else if (remise) initial = remise.type;

  const type = h("select", { "aria-label": "Remise", value: initial }, options);
  // Si la remise de la grille a changé depuis, on garde la remise du document en manuel
  if (type.value !== initial) type.value = "aucune";
  const valeur = h("input", {
    type: "text",
    inputmode: "decimal",
    class: "nombre",
    "aria-label": "Valeur de la remise",
    // % ou € : la valeur est stockée en centièmes dans les deux cas
    value: remise && !initial.startsWith("grille:") ? saisieMontant(remise.valeur).replace(/,00$/, "") : "",
  });
  const unite = h("span");
  const libelle = h("input", { type: "text", maxlength: 200, "aria-label": "Libellé de la remise", placeholder: "Libellé (ex. : Geste commercial)", value: remise && !initial.startsWith("grille:") ? remise.libelle : "" });
  const manuelle = h("div", { class: "remise__manuelle" }, h("div", { class: "avec-unite" }, valeur, unite), libelle);

  function maj() {
    const estManuelle = type.value === "pourcentage" || type.value === "montant";
    manuelle.hidden = !estManuelle;
    unite.textContent = type.value === "montant" ? "€" : "%";
  }

  function lire() {
    if (type.value === "aucune") return { remise: null };
    if (type.value.startsWith("grille:")) {
      const r = remisesGrille.find((x) => `grille:${x.id}` === type.value);
      return { remise: { type: "pourcentage", valeur: enPointsDeBase(r.pourcentage), libelle: r.nom, ref: r.id } };
    }
    const nombre = analyserNombre(valeur.value);
    const invalide = !Number.isFinite(nombre) || nombre < 0 || (type.value === "pourcentage" && nombre > 100);
    valeur.setAttribute("aria-invalid", String(invalide));
    if (invalide) return { remise: null, erreur: "Remise : valeur invalide." };
    const points = Math.round(nombre * 100); // % → points de base, € → centimes
    return { remise: points ? { type: type.value, valeur: points, libelle: libelle.value.trim() || "Remise" } : null };
  }

  const element = h(
    "div",
    {
      class: "remise",
      onInput: surChangement,
      onChange: () => {
        maj();
        surChangement();
      },
    },
    type,
    manuelle
  );
  maj();
  return { element, lire };
}

/* ---------- Récapitulatif des montants ---------- */

/**
 * afficher(document, options) ; options.devis : les abonnements sortent du
 * total et s'affichent dessous (« puis 29,00 € HT/mois… », options.conditions).
 */
export function recapitulatif() {
  const element = h("dl", { class: "recap" });
  function afficher({ lignes, remise, taux_tva, deductions = [] }, { titreFinal = "Total TTC", mention = "", devis = false, conditions = {}, libelleDeduction = "Déjà facturé" } = {}) {
    const c = devis ? calculerDevis({ lignes, remise, taux_tva }) : calculerDocument({ lignes, remise, taux_tva, deductions });
    const abonnement = phraseAbonnement(c.recurrent.periodes, conditions);
    const rangee = (terme, valeur, classe = "") => [h("dt", { class: classe }, terme), h("dd", { class: classe }, valeur)];
    element.replaceChildren(
      ...(c.remise ? rangee("Sous-total HT", formaterMontant(c.sous_total)) : []),
      ...(c.remise ? rangee(c.remise.libelle + (c.remise.type === "pourcentage" ? ` (${formaterPourcentage(c.remise.valeur)})` : ""), formaterMontant(-c.remise.montant)) : []),
      ...rangee("Total HT", formaterMontant(c.total_ht)),
      ...rangee(`TVA (${formaterPourcentage(c.taux_tva)})`, formaterMontant(c.total_tva)),
      ...(c.deductions.length ? rangee("Total TTC", formaterMontant(c.total_ttc)) : []),
      ...c.deductions.flatMap((d) => rangee(`${libelleDeduction} : ${d.numero}`, formaterMontant(-d.montant_ttc))),
      ...rangee(titreFinal, formaterMontant(c.montant_ttc), "recap__final"),
      ...(abonnement ? [h("dd", { class: "recap__abonnement" }, `${abonnement}.`)] : []),
      ...(mention ? [h("dd", { class: "recap__mention" }, mention)] : [])
    );
    return c;
  }
  return { element, afficher };
}

function rangeeLecture(l, suffixe = "") {
  return h(
    "tr",
    {},
    h("td", { "data-titre": "Désignation" }, h("strong", {}, l.designation), l.description ? h("span", { class: "ligne__lecture-description" }, l.description) : null),
    h("td", { class: "nombre", "data-titre": "Qté" }, formaterNombre(l.quantite)),
    h("td", { "data-titre": "Unité" }, l.unite),
    h("td", { class: "nombre", "data-titre": "Prix unit. HT" }, estLignePourcentage(l) ? `+${formaterPourcentage(l.pourcentage)}` : formaterMontant(l.prix_unitaire)),
    h("td", { class: "nombre", "data-titre": "Total HT" }, `${formaterMontant(l.total)}${suffixe}`)
  );
}

/** Tableau des lignes en lecture seule (document envoyé ou émis), abonnements à part */
export function tableauLignesLecture(calcul) {
  const abonnements = calcul.recurrent?.lignes || [];
  return h(
    "div",
    { class: "tableau-defilant" },
    h(
      "table",
      { class: "tableau" },
      h("thead", {}, h("tr", {}, ["Désignation", "Qté", "Unité", "Prix unit. HT", "Total HT"].map((t, i) => h("th", { scope: "col", class: i === 0 || i === 2 ? "" : "nombre" }, t)))),
      h(
        "tbody",
        {},
        calcul.lignes.map((l) => rangeeLecture(l)),
        abonnements.length ? h("tr", { class: "tableau__intertitre" }, h("td", { colspan: 5 }, "Abonnement : facturé à part, chaque période")) : null,
        abonnements.map((l) => rangeeLecture(l, `/${periodeDeLigne(l)}`))
      )
    )
  );
}
