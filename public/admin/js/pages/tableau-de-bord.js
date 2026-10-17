/* Tableau de bord : encaissements, seuil de franchise, devis et factures à suivre */

import { api, badgeStatut, date, h, lienApi, lienBouton, montant, tableau, vide } from "../ui.js";
import { formaterMontant, formaterPourcentage } from "../lib/format.js";

function carteChiffreAffaires(t) {
  const carte = h(
    "section",
    { class: "carte carte--ca" },
    h("h2", {}, `Encaissé en ${t.annee}`),
    h("p", { class: "chiffre" }, formaterMontant(t.encaisse_ttc)),
    h("p", { class: "discret" }, "Factures payées moins avoirs remboursés, à la date du paiement.")
  );
  if (!t.franchise) {
    carte.append(h("p", { class: "discret" }, "Assujetti à la TVA : pas de seuil de franchise à surveiller."));
    return carte;
  }
  const { seuil, niveau, part } = t.franchise;
  const jauge = h("div", { class: `jauge jauge--${niveau}` }, h("div", { class: "jauge__remplissage" }));
  jauge.firstChild.style.width = `${Math.min(100, part * 100).toFixed(1)}%`;
  carte.append(
    h("p", { class: "jauge__legende" }, `${formaterPourcentage(Math.round(part * 10000))} du seuil de franchise de TVA (${formaterMontant(seuil)} HT)`),
    jauge
  );
  if (niveau === "alerte") {
    carte.append(
      h("p", { class: "alerte alerte--attention" }, `Attention : 80 % du seuil atteint. Au-delà de ${formaterMontant(seuil)}, la franchise de TVA prend fin : préparez le passage à la TVA (page Grille tarifaire, section TVA).`)
    );
  }
  if (niveau === "depasse") {
    carte.append(
      h("p", { class: "alerte alerte--danger" }, `Seuil de ${formaterMontant(seuil)} dépassé : vérifiez avec votre expert-comptable la date de fin de la franchise, puis passez la grille en « assujetti » pour facturer la TVA.`)
    );
  }
  return carte;
}

function carte(titre, contenu, action = null) {
  return h("section", { class: "carte" }, h("div", { class: "carte__entete" }, h("h2", {}, titre), action), contenu);
}

export async function pageTableauDeBord(annee) {
  const t = await api(`/tableau-de-bord${annee ? `?annee=${annee}` : ""}`);
  const choixAnnee = h(
    "select",
    { "aria-label": "Année", value: String(t.annee), onChange: async (e) => conteneur.replaceWith(await pageTableauDeBord(e.target.value)) },
    t.annees.map((a) => h("option", { value: String(a) }, String(a)))
  );

  const colonnesDevis = [
    { titre: "Devis", valeur: (d) => d.numero },
    { titre: "Client", valeur: (d) => d.client_nom },
    { titre: "Valable jusqu'au", valeur: (d) => date(d.date_fin_validite) },
    { titre: "Montant TTC", classe: "nombre", valeur: (d) => montant(d.montant_ttc) },
  ];
  const colonnesFactures = [
    { titre: "Facture", valeur: (f) => f.numero },
    { titre: "Client", valeur: (f) => f.client_nom },
    { titre: "Échéance", valeur: (f) => date(f.date_echeance) },
    { titre: "Reste dû", classe: "nombre", valeur: (f) => montant(f.reste_du) },
    { titre: "Statut", valeur: (f) => badgeStatut(f.statut_affiche) },
  ];

  const conteneur = h(
    "div",
    { class: "page" },
    h(
      "div",
      { class: "entete-page" },
      h("h1", {}, "Tableau de bord"),
      h("div", { class: "actions" }, choixAnnee, lienBouton("Nouveau devis", "#/devis/nouveau", "bouton bouton--principal"), lienBouton("Nouvelle facture", "#/factures/nouvelle"))
    ),
    t.emetteur_incomplet.length
      ? h(
          "div",
          { class: "alerte alerte--attention" },
          h("p", {}, h("strong", {}, "Informations à compléter : "), `${t.emetteur_incomplet.join(", ")}. `,
            "Tant qu'elles manquent, les devis ne peuvent pas être envoyés ni les factures émises. ",
            h("a", { href: "#/grille" }, "Les compléter dans Grille tarifaire › Émetteur"))
        )
      : null,
    t.grille_fichier_a_importer
      ? h(
          "div",
          { class: "alerte alerte--attention" },
          h("p", {}, "Le fichier ", h("code", {}, "data/grille.json"), " a changé depuis son dernier import. ", h("a", { href: "#/grille" }, "Voir et importer la nouvelle version de la grille"))
        )
      : null,
    h(
      "div",
      { class: "grille-cartes" },
      carteChiffreAffaires(t),
      carte(
        "Factures en retard",
        t.factures_en_retard.length ? tableau(colonnesFactures, t.factures_en_retard, (f) => `#/factures/${f.id}`) : vide("Aucune facture en retard.")
      ),
      t.abonnements_a_facturer.length
        ? carte(
            "Abonnements à facturer",
            tableau(
              [
                { titre: "Devis", valeur: (a) => a.devis_numero },
                { titre: "Client", valeur: (a) => a.client_nom },
                { titre: "Période", valeur: (a) => `${a.premiere ? "premier " : ""}${a.periodicite} à partir du ${date(a.depuis)}` },
                { titre: "Montant HT", classe: "nombre", valeur: (a) => montant(a.montant_ht) },
              ],
              t.abonnements_a_facturer,
              (a) => `#/devis/${a.devis_id}`
            )
          )
        : null,
      carte(
        "Factures à encaisser",
        t.factures_impayees.length ? tableau(colonnesFactures, t.factures_impayees, (f) => `#/factures/${f.id}`) : vide("Aucune facture en attente de paiement.")
      ),
      carte(
        "Devis en attente de réponse",
        t.devis_en_attente.length ? tableau(colonnesDevis, t.devis_en_attente, (d) => `#/devis/${d.id}`) : vide("Aucun devis en attente."),
        t.brouillons_devis ? h("a", { href: "#/devis" }, `${t.brouillons_devis} brouillon${t.brouillons_devis > 1 ? "s" : ""}`) : null
      ),
      t.devis_expires.length
        ? carte("Devis expirés à relancer", tableau(colonnesDevis, t.devis_expires, (d) => `#/devis/${d.id}`))
        : null,
      carte(
        "Exports et sauvegarde",
        h(
          "div",
          { class: "pile" },
          h("p", {}, "Factures et avoirs émis, pour votre comptabilité (s'ouvre dans Excel ou LibreOffice) :"),
          h("p", {}, h("a", { class: "bouton", href: lienApi(`/factures.csv?annee=${t.annee}`) }, `Export CSV ${t.annee}`)),
          h("p", {}, "Toutes les données (clients, grilles, devis, factures). Une copie est aussi faite chaque nuit dans R2 :"),
          h("p", {}, h("a", { class: "bouton", href: lienApi("/export.json") }, "Sauvegarde complète (JSON)"))
        )
      )
    )
  );
  return conteneur;
}

