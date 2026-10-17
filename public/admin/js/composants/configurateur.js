/* ==========================================================================
   Configurateur de devis, en trois clics :
     1. le type de projet (tuiles : Sites web, Développement…, avec le prix
        d'appel) ; plusieurs types possibles (un site et un abonnement) ;
     2. la formule, en cartes avec leur prix (une page, 5 pages, boutique…) :
        une seule au choix si la catégorie a « choix_unique » dans la grille ;
     3. les options (catégorie avec « options_de »), avec leur quantité.
   Chaque choix ajoute la ligne au document au prix de la grille ; le retirer
   supprime la ligne. Le tableau des lignes reste modifiable (prix,
   description) et les deux restent synchronisés.
   ========================================================================== */

import { confirmer, h, notifier } from "../ui.js";
import { calculerDevis, calculerLignes } from "../lib/calcul.js";
import { carteIncompatibilites, conflitsAvec } from "../lib/incompatibilites.js";
import { analyserNombre, enCentimes, enPointsDeBase, formaterMontant, formaterNombre, formaterPourcentage } from "../lib/format.js";

export function categoriesPrincipales(grille) {
  return (grille.categories || []).filter((c) => !c.options_de);
}

// Types de projet des prestations d'un document (partagé avec la synthèse PDF du Worker)
export { typesDesRefs } from "../lib/questions.js";

function prestationsDuType(grille, type) {
  return (grille.categories || []).filter((c) => c.id === type || c.options_de === type).flatMap((c) => c.prestations || []);
}

function libellePrix(p) {
  if (p.prix_pourcentage !== undefined) return `+${formaterPourcentage(enPointsDeBase(p.prix_pourcentage))}`;
  return formaterMontant(enCentimes(p.prix));
}

function libelleUnite(p) {
  if (p.prix_pourcentage !== undefined) return "sur le total";
  return p.unite === "forfait" ? "forfait HT" : `HT / ${p.unite}`;
}

// Prix d'appel d'un type : la moins chère de ses prestations principales
function prixDAppel(categorie) {
  const prix = (categorie.prestations || []).filter((p) => p.prix !== undefined).map((p) => enCentimes(p.prix));
  return prix.length ? Math.min(...prix) : null;
}

/**
 * grille : contenu de la grille ; editeur : éditeur de lignes ;
 * typesInitiaux : types déjà choisis ; surTypes() : appelé quand les types changent.
 * Renvoie { element, types(), rafraichir() }.
 */
export function configurateur(grille, editeur, typesInitiaux, surTypes = () => {}, { devis = false } = {}) {
  const categories = grille.categories || [];
  const principales = categoriesPrincipales(grille);
  const choisis = new Set([...typesInitiaux].filter((id) => principales.some((c) => c.id === id)));
  const types = () => principales.map((c) => c.id).filter((id) => choisis.has(id));

  // Incompatibilités de la grille (« incompatible_avec »), dans les deux sens
  const prestations = new Map(categories.flatMap((c) => (c.prestations || []).map((p) => [p.id, p])));
  const incompatibles = carteIncompatibilites(grille);
  // Prestations déjà choisies qui empêchent celle-ci
  const conflits = (p) => conflitsAvec(incompatibles, p.id, editeur.refs());
  const noms = (refs) => refs.map((ref) => prestations.get(ref)?.nom || ref).join(", ");

  function avertissement(p, ligne) {
    const genants = ligne ? [] : conflits(p);
    return genants.length ? h("span", { class: "config__incompatible" }, `Incompatible avec ${noms(genants)} : la choisir ${genants.length > 1 ? "les" : "la"} retirera.`) : null;
  }

  const tuiles = h("div", { class: "config__types", role: "group", "aria-label": "Type de projet" });
  const panneaux = h("div", { class: "config__panneaux" });
  const total = h("p", { class: "config__total", "aria-live": "polite" });
  const element = h(
    "div",
    { class: "config" },
    h("p", { class: "config__etape" }, "Type de projet"),
    tuiles,
    panneaux,
    total
  );
  let signature = "";

  async function basculerType(categorie) {
    if (choisis.has(categorie.id)) {
      const ids = new Set(prestationsDuType(grille, categorie.id).map((p) => p.id));
      const cochees = editeur.refs().filter((ref) => ids.has(ref));
      if (cochees.length) {
        const ok = await confirmer({
          titre: `Retirer « ${categorie.nom} » ?`,
          message: `${cochees.length} prestation${cochees.length > 1 ? "s" : ""} de ce type ${cochees.length > 1 ? "seront retirées" : "sera retirée"} des lignes.`,
          bouton: "Retirer",
          danger: true,
        });
        if (!ok) return;
        cochees.forEach((ref) => editeur.retirerRef(ref));
      }
      choisis.delete(categorie.id);
    } else {
      choisis.add(categorie.id);
    }
    dessiner();
    surTypes();
  }

  function dessinerTuiles() {
    tuiles.replaceChildren(
      ...principales.map((categorie) => {
        const appel = prixDAppel(categorie);
        const nb = editeur.refs().filter((ref) => prestationsDuType(grille, categorie.id).some((p) => p.id === ref)).length;
        const nbPrestations = (categorie.prestations || []).length;
        // Prix d'appel seulement entre formules comparables (une page, 5 pages, boutique…)
        const sousTitre = categorie.choix_unique && appel !== null
          ? `dès ${formaterMontant(appel)} HT`
          : `${nbPrestations} prestation${nbPrestations > 1 ? "s" : ""}`;
        return h(
          "button",
          { type: "button", class: "tuile", "aria-pressed": String(choisis.has(categorie.id)), onClick: () => basculerType(categorie) },
          h("span", { class: "tuile__nom" }, categorie.nom),
          h("span", { class: "tuile__prix" }, sousTitre),
          nb ? h("span", { class: "tuile__compte" }, `${nb} choisi${nb > 1 ? "s" : ""}`) : null
        );
      })
    );
  }

  // Champ de quantité d'une prestation choisie (page, jour, langue…)
  function champQuantite(p, ligne) {
    return h(
      "span",
      { class: "config__quantite" },
      h("input", {
        type: "text",
        inputmode: "decimal",
        class: "nombre",
        "aria-label": `Quantité de « ${p.nom} » (${p.unite})`,
        dataset: { ref: p.id },
        value: formaterNombre(ligne.quantite),
        onClick: (e) => e.stopPropagation(),
        onInput: (e) => {
          const n = analyserNombre(e.target.value);
          const valide = Number.isFinite(n) && n > 0;
          e.target.setAttribute("aria-invalid", String(!valide));
          if (valide) editeur.definirQuantite(p.id, n);
        },
      }),
      h("span", {}, p.unite)
    );
  }

  function choisir(p, categorie, coche) {
    if (!coche) {
      editeur.retirerRef(p.id);
      return;
    }
    // Prestations incompatibles déjà choisies : retirées, en le signalant
    const genants = conflits(p);
    if (genants.length) {
      genants.forEach((ref) => editeur.retirerRef(ref));
      notifier(`${noms(genants)} retiré${genants.length > 1 ? "s" : ""} : incompatible avec « ${p.nom} ».`);
    }
    // Formule unique : la nouvelle remplace la précédente
    if (categorie.choix_unique) {
      for (const autre of categorie.prestations || []) if (autre.id !== p.id) editeur.retirerRef(autre.id);
    }
    editeur.ajouterPrestation(p);
  }

  // Carte de formule (catégorie principale)
  function carte(p, categorie) {
    const ligne = editeur.ligneDeRef(p.id);
    const id = `config-${p.id}`;
    const avecQuantite = ligne && p.prix_pourcentage === undefined && p.unite !== "forfait";
    const incompatible = !ligne && conflits(p).length > 0;
    return h(
      "div",
      { class: `formule${ligne ? " formule--choisie" : ""}${incompatible ? " formule--incompatible" : ""}` },
      h("input", { type: "checkbox", id, class: "formule__case", checked: Boolean(ligne), onChange: (e) => choisir(p, categorie, e.target.checked) }),
      h(
        "label",
        { for: id, class: "formule__corps" },
        h("span", { class: "formule__nom" }, p.nom),
        p.description ? h("span", { class: "formule__description" }, p.description) : null,
        h(
          "span",
          { class: "formule__prix" },
          p.a_partir_de ? h("span", { class: "formule__des" }, "à partir de ") : null,
          h("strong", {}, libellePrix(p)),
          h("span", { class: "formule__unite" }, ` ${libelleUnite(p)}`)
        ),
        avertissement(p, ligne)
      ),
      avecQuantite ? champQuantite(p, ligne) : null
    );
  }

  // Ligne d'option (catégorie « options_de »)
  function option(p, categorie) {
    const ligne = editeur.ligneDeRef(p.id);
    const id = `config-${p.id}`;
    const avecQuantite = ligne && p.prix_pourcentage === undefined && p.unite !== "forfait";
    const incompatible = !ligne && conflits(p).length > 0;
    return h(
      "div",
      { class: `config__element${ligne ? " config__element--coche" : ""}${incompatible ? " config__element--incompatible" : ""}` },
      h("input", { type: "checkbox", id, checked: Boolean(ligne), onChange: (e) => choisir(p, categorie, e.target.checked) }),
      h(
        "label",
        { for: id },
        h("span", { class: "config__nom" }, p.nom),
        p.description ? h("span", { class: "config__description" }, p.description) : null,
        avertissement(p, ligne)
      ),
      avecQuantite ? champQuantite(p, ligne) : h("span"),
      h("span", { class: "config__prix" }, `${p.a_partir_de ? "dès " : ""}${libellePrix(p)}${p.prix_pourcentage === undefined && p.unite !== "forfait" ? ` / ${p.unite}` : ""}`)
    );
  }

  function dessinerPanneaux() {
    panneaux.replaceChildren(
      ...types().map((type) => {
        const principale = categories.find((c) => c.id === type);
        const options = categories.filter((c) => c.options_de === type);
        return h(
          "section",
          { class: "config__panneau", "aria-label": principale.nom },
          h("p", { class: "config__etape" }, `${principale.nom} : ${principale.choix_unique ? "choisissez la formule" : "choisissez les prestations"}`),
          h("div", { class: "formules" }, (principale.prestations || []).map((p) => carte(p, principale))),
          options.map((o) => [
            h("p", { class: "config__etape" }, `${o.nom} : à cocher`),
            h("div", { class: "config__liste" }, (o.prestations || []).map((p) => option(p, o))),
          ])
        );
      })
    );
  }

  function dessinerTotal() {
    const { lignes, erreurs } = editeur.lire();
    if (!types().length) {
      total.replaceChildren(h("span", { class: "discret" }, "Cliquez sur le type de projet pour afficher les formules et leurs prix."));
      return;
    }
    if (erreurs.length) return;
    const nb = h("span", {}, `${lignes.length} ligne${lignes.length > 1 ? "s" : ""} · `);
    if (devis) {
      // Devis : forfait d'un côté, abonnements à part
      const calcul = calculerDevis({ lignes });
      const abonnement = calcul.recurrent.periodes.map((p) => ` + ${formaterMontant(p.total_ht)} HT/${p.unite}`).join("");
      total.replaceChildren(nb, h("span", {}, "forfait "), h("strong", {}, `${formaterMontant(calcul.sous_total)} HT`), abonnement ? h("strong", { class: "config__abonnement" }, abonnement) : null);
      return;
    }
    const somme = calculerLignes(lignes).reduce((s, l) => s + l.total, 0);
    total.replaceChildren(nb, h("span", {}, "sous-total "), h("strong", {}, `${formaterMontant(somme)} HT`));
  }

  function dessiner() {
    signature = `${types().join(",")}|${editeur.refs().join(",")}`;
    const focus = document.activeElement?.id;
    dessinerTuiles();
    dessinerPanneaux();
    dessinerTotal();
    if (focus) document.getElementById(focus)?.focus();
  }

  // Le tableau a changé : on redessine si des lignes de la grille ont été ajoutées
  // ou retirées, sinon on recopie seulement les quantités et le total
  editeur.observer(() => {
    if (`${types().join(",")}|${editeur.refs().join(",")}` !== signature) {
      dessiner();
      return;
    }
    for (const champ of element.querySelectorAll(".config__quantite input")) {
      if (champ === document.activeElement) continue;
      const ligne = editeur.ligneDeRef(champ.dataset.ref);
      if (ligne && Number.isFinite(ligne.quantite)) champ.value = formaterNombre(ligne.quantite);
    }
    dessinerTotal();
  });

  dessiner();
  return { element, types, rafraichir: dessiner };
}
