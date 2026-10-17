/* Devis : liste, édition du brouillon, suivi après envoi et facturation */

import {
  agir,
  aller,
  api,
  badgeStatut,
  champ,
  confirmer,
  date,
  enTete,
  h,
  lienApi,
  lienBouton,
  marquerModifie,
  montant,
  notifier,
  ouvrirApres,
  ouvrirDialogue,
  rafraichir,
  tableau,
  vide,
} from "../ui.js";
import { choixRemise, editeurLignes, recapitulatif, tableauLignesLecture, tauxTvaDeLaGrille } from "../composants/document.js";
import { configurateur, typesDesRefs } from "../composants/configurateur.js";
import { cadrageProjet } from "../composants/cadrage.js";
import { formulaireClient } from "./clients.js";
import { enPointsDeBase, formaterMontant, formaterPourcentage } from "../lib/format.js";
import { calculerEcheancier } from "../lib/calcul.js";
import { phraseAbonnement } from "../lib/abonnement.js";
import { MODES_DEVIS, STATUTS_FACTURE, TYPES_FACTURE } from "../lib/libelles.js";

export async function pageListeDevis() {
  const devis = await api("/devis");
  return h(
    "div",
    { class: "page" },
    enTete("Devis", lienBouton("Nouveau devis", "#/devis/nouveau", "bouton bouton--principal")),
    devis.length
      ? tableau(
          [
            { titre: "Numéro", valeur: (d) => d.numero },
            { titre: "Client", valeur: (d) => d.client_nom },
            { titre: "Objet", valeur: (d) => d.objet || "—" },
            { titre: "Date", valeur: (d) => date(d.date_devis) },
            {
              titre: "Montant TTC",
              classe: "nombre",
              valeur: (d) => [montant(d.montant_ttc), ...d.abonnement.map((p) => h("span", { class: "discret pile-ligne" }, `+ ${formaterMontant(p.total_ttc)}/${p.unite}`))],
            },
            { titre: "Statut", valeur: (d) => badgeStatut(d.statut_affiche, "devis") },
          ],
          devis,
          (d) => `#/devis/${d.id}`
        )
      : vide("Aucun devis pour l'instant. Commencez par « Nouveau devis ».")
  );
}

/** Liste des clients, avec création rapide dans une boîte de dialogue */
export function choixClient(clients, clientId, surChangement) {
  const select = h(
    "select",
    { required: true, value: clientId ? String(clientId) : "", onChange: surChangement },
    h("option", { value: "" }, "Choisir un client…"),
    clients.map((c) => h("option", { value: String(c.id) }, c.nom))
  );
  const nouveau = h(
    "button",
    {
      type: "button",
      class: "bouton bouton--discret",
      onClick: () => {
        const fermer = ouvrirDialogue(
          "Nouveau client",
          formulaireClient(null, (client) => {
            select.append(h("option", { value: String(client.id) }, client.nom));
            select.value = String(client.id);
            fermer();
            marquerModifie();
            surChangement();
          })
        );
      },
    },
    "+ Nouveau client"
  );
  return { element: h("div", { class: "avec-bouton" }, select, nouveau), select };
}

export async function pageDevis(id) {
  const [devis, grille, clients] = await Promise.all([
    id ? api(`/devis/${id}`) : Promise.resolve(null),
    api("/grille"),
    api("/clients"),
  ]);
  if (devis && devis.statut !== "brouillon") return vueDevisEnvoye(devis, grille.contenu);
  return editeurDevis(devis, grille, clients);
}

/* ---------- Brouillon ---------- */

function editeurDevis(devis, grille, clients) {
  const g = grille.contenu;
  const tva = tauxTvaDeLaGrille(g);
  const surChangement = () => {
    marquerModifie();
    majRecap();
  };

  const client = choixClient(clients, devis?.client_id, surChangement);
  const objet = h("input", { type: "text", maxlength: 300, value: devis?.objet || "", placeholder: "Ex. : Création du site vitrine" });
  const mode = h("select", { value: devis?.mode || "forfait", onChange: surChangement }, Object.entries(MODES_DEVIS).map(([v, t]) => h("option", { value: v }, t)));
  const delai = h("input", { type: "text", maxlength: 300, value: devis?.delai_execution || "", placeholder: "Ex. : 4 semaines après validation de la maquette" });
  const notes = h("textarea", { rows: 3, maxlength: 5000, value: devis?.notes || "", placeholder: "Tout ce qui est utile au projet : échanges, contraintes, idées…" });
  const lignes = editeurLignes(devis?.lignes || [], g, surChangement, { abonnements: true });
  const remise = choixRemise(devis?.remise || null, g, surChangement);
  // Type de projet → formules et options à cocher, et questions de cadrage du type
  const typesInitiaux = new Set([...(devis?.cadrage?.types || []), ...typesDesRefs(g, (devis?.lignes || []).map((l) => l.ref))]);
  const config = configurateur(
    g,
    lignes,
    typesInitiaux,
    () => {
      cadrage.rafraichir();
      marquerModifie();
    },
    { devis: true }
  );
  const cadrage = cadrageProjet(g, devis?.cadrage, config.types, () => marquerModifie());
  const recap = recapitulatif();
  const echeancier = h("div", { class: "recap-echeancier" });
  const suggestion = h("p", { class: "champ__aide" });

  function majRecap() {
    const { lignes: l, erreurs } = lignes.lire();
    const { remise: r, erreur } = remise.lire();
    if (erreurs.length || erreur) return;
    const calcul = recap.afficher({ lignes: l, remise: r, taux_tva: tva }, { mention: tva ? "" : g.tva.mention_franchise, devis: true, conditions: g.conditions });
    // Échéancier du forfait (les abonnements n'y entrent pas)
    if (mode.value === "forfait" && calcul.lignes.length) {
      const etapes = g.conditions.echeancier_forfait.map((e) => ({ etape: e.etape, pourcentage: enPointsDeBase(e.pourcentage) }));
      echeancier.replaceChildren(
        h("h3", {}, "Échéancier"),
        h(
          "ul",
          {},
          calculerEcheancier(calcul.total_ht, tva, etapes).map((e) =>
            h("li", {}, h("span", {}, `${e.etape} (${formaterPourcentage(e.pourcentage)})`), h("span", { class: "montant" }, formaterMontant(e.montant_ttc)))
          )
        )
      );
    } else {
      echeancier.replaceChildren(h("p", { class: "discret" }, mode.value === "regie" ? g.conditions.echeancier_regie : g.conditions.abonnement));
    }
    // Délai d'exécution suggéré d'après la grille (le plus long des prestations choisies)
    const prestations = (g.categories || []).flatMap((c) => c.prestations || []);
    const delais = l.map((x) => prestations.find((p) => p.id === x.ref)?.delai_jours).filter(Boolean);
    const express = l.some((x) => x.ref === "opt-urgence");
    if (delais.length) {
      const jours = Math.ceil(Math.max(...delais) / (express ? 2 : 1));
      suggestion.replaceChildren(
        `D'après la grille : ${jours} jours${express ? " (livraison express)" : ""}. `,
        h("button", { type: "button", class: "lien", onClick: () => { delai.value = `${jours} jours après validation du devis`; marquerModifie(); } }, "Utiliser")
      );
    } else {
      suggestion.replaceChildren();
    }
  }

  function donnees() {
    const { lignes: l, erreurs } = lignes.lire();
    const { remise: r, erreur } = remise.lire();
    const problemes = [...erreurs, ...(erreur ? [erreur] : [])];
    if (!client.select.value) problemes.unshift("Choisissez un client.");
    if (problemes.length) throw new Error(problemes.join(" "));
    return {
      client_id: Number(client.select.value),
      objet: objet.value,
      mode: mode.value,
      delai_execution: delai.value,
      lignes: l,
      remise: r,
      notes: notes.value,
      cadrage: cadrage.lire(),
    };
  }

  async function enregistrer() {
    const resultat = await api(devis ? `/devis/${devis.id}` : "/devis", { methode: devis ? "PUT" : "POST", corps: donnees() });
    marquerModifie(false);
    return resultat;
  }

  const boutonEnregistrer = h("button", { type: "submit", class: "bouton bouton--principal" }, devis ? "Enregistrer" : "Créer le devis");
  const actions = [boutonEnregistrer];
  if (devis) {
    const apercu = h("button", { type: "button", class: "bouton" }, "Aperçu PDF");
    apercu.addEventListener("click", () =>
      ouvrirApres(apercu, lienApi(`/devis/${devis.id}/pdf`), enregistrer)
    );
    const envoyer = h("button", { type: "button", class: "bouton" }, "Marquer comme envoyé");
    envoyer.addEventListener("click", () =>
      agir(envoyer, async () => {
        await enregistrer();
        const ok = await confirmer({
          titre: `Envoyer le devis ${devis.numero} ?`,
          message: [
            "Le devis sera daté d'aujourd'hui et figé : son PDF définitif est archivé, il ne pourra plus être modifié (seulement dupliqué).",
            "Téléchargez ensuite le PDF pour l'envoyer à votre client.",
          ],
          bouton: "Marquer comme envoyé",
        });
        if (!ok) return;
        await api(`/devis/${devis.id}/envoyer`, { methode: "POST" });
        notifier("Devis envoyé et archivé.");
        rafraichir();
      })
    );
    const dupliquer = boutonDupliquer(devis.id);
    const supprimer = h("button", { type: "button", class: "bouton bouton--danger" }, "Supprimer");
    supprimer.addEventListener("click", () =>
      agir(supprimer, async () => {
        const ok = await confirmer({ titre: `Supprimer le brouillon ${devis.numero} ?`, message: "Son numéro ne sera pas réutilisé.", bouton: "Supprimer", danger: true });
        if (!ok) return;
        await api(`/devis/${devis.id}`, { methode: "DELETE" });
        notifier("Brouillon supprimé.");
        aller("/devis");
      })
    );
    actions.push(apercu, envoyer, dupliquer, supprimer);
  }

  const formulaire = h(
    "form",
    {
      class: "editeur",
      novalidate: true,
      onInput: () => marquerModifie(),
      onSubmit: (e) => {
        e.preventDefault();
        agir(boutonEnregistrer, async () => {
          const resultat = await enregistrer();
          notifier(devis ? "Devis enregistré." : `Devis ${resultat.numero} créé.`);
          aller(`/devis/${resultat.id}`);
        });
      },
    },
    h(
      "div",
      { class: "editeur__principal" },
      h(
        "section",
        { class: "carte" },
        h("div", { class: "rangee" }, champ("Client", client.element), champ("Objet", objet))
      ),
      h(
        "section",
        { class: "carte" },
        h("h2", {}, "Prestations"),
        config.element,
        h(
          "details",
          { class: "lignes__detail", open: Boolean(devis) },
          h("summary", {}, "Lignes du devis : ajuster un prix, une description, ajouter une ligne libre"),
          lignes.element
        )
      ),
      h("section", { class: "carte" }, h("h2", {}, "Remise"), remise.element),
      h(
        "section",
        { class: "carte" },
        h("h2", {}, "Conditions"),
        h("div", { class: "rangee" }, champ("Facturation", mode), champ("Délai d'exécution", h("div", {}, delai, suggestion)))
      ),
      blocCadrage(cadrage, notes, devis?.id, enregistrer)
    ),
    h(
      "aside",
      { class: "editeur__cote" },
      h("section", { class: "carte carte--recap" }, h("h2", {}, "Montants"), recap.element, echeancier, h("div", { class: "actions actions--pile" }, actions))
    )
  );

  queueMicrotask(majRecap);
  return h(
    "div",
    { class: "page" },
    enTete(devis ? `Devis ${devis.numero}` : "Nouveau devis", devis ? badgeStatut("brouillon", "devis") : null),
    g.tva.regime === "franchise_en_base" ? null : h("p", { class: "discret" }, `TVA appliquée : ${formaterPourcentage(tva)}.`),
    formulaire
  );
}

/** Cadrage et notes internes, repliables. Jamais imprimés sur le PDF. */
/**
 * Cadrage et notes internes : jamais sur le PDF du devis, mais repris dans la
 * synthèse du projet. devisId et enregistrer : pour proposer la synthèse.
 */
function blocCadrage(cadrage, notes, devisId = null, enregistrer = null) {
  const synthese = (texte, avecNotes) => {
    const bouton = h("button", { type: "button", class: avecNotes ? "bouton" : "bouton bouton--principal" }, texte);
    bouton.addEventListener("click", () => ouvrirApres(bouton, lienApi(`/devis/${devisId}/synthese${avecNotes ? "?notes=1" : ""}`), enregistrer));
    return bouton;
  };
  return h(
    "details",
    { class: "carte carte--repliable", open: true },
    h("summary", {}, h("h2", {}, "Cadrage du projet"), cadrage.resume),
    h("p", { class: "discret" }, "Les questions à poser au client et ses réponses, gardées avec le devis. Rien de cette section n'apparaît sur le PDF du devis."),
    cadrage.element,
    h("div", { class: "cadrage__groupe" }, h("h3", {}, "Notes libres"), notes),
    h(
      "div",
      { class: "cadrage__groupe cadrage__synthese" },
      h("h3", {}, "Synthèse du projet"),
      devisId
        ? [
            h("p", { class: "discret" }, "Un PDF qui reprend les prestations retenues (sans les prix), les réponses par thème et les points restant à préciser. La version à partager comporte un cadre de validation pour le client ; la version interne ajoute vos notes libres."),
            h("div", { class: "actions" }, synthese("Synthèse à partager (PDF)", false), synthese("Synthèse avec mes notes (PDF)", true)),
          ]
        : h("p", { class: "discret" }, "Créez le devis pour obtenir la synthèse du projet.")
    )
  );
}

function boutonDupliquer(id) {
  const bouton = h("button", { type: "button", class: "bouton" }, "Dupliquer");
  bouton.addEventListener("click", () =>
    agir(bouton, async () => {
      const copie = await api(`/devis/${id}/dupliquer`, { methode: "POST" });
      notifier(`Copie créée : ${copie.numero}.`);
      aller(`/devis/${copie.id}`);
    })
  );
  return bouton;
}

/* ---------- Devis envoyé, accepté, refusé ---------- */

function boutonStatut(devis, statut, texte, classe = "bouton") {
  const bouton = h("button", { type: "button", class: classe }, texte);
  bouton.addEventListener("click", () =>
    agir(bouton, async () => {
      await api(`/devis/${devis.id}/statut`, { methode: "POST", corps: { statut } });
      notifier("Statut mis à jour.");
      rafraichir();
    })
  );
  return bouton;
}

function boutonFacturer(devis, rang, texte) {
  const bouton = h("button", { type: "button", class: "bouton bouton--principal" }, texte);
  bouton.addEventListener("click", () =>
    agir(bouton, async () => {
      try {
        const facture = await api(`/devis/${devis.id}/factures`, { methode: "POST", corps: { rang } });
        notifier("Brouillon de facture créé : vérifiez-le puis émettez-le.");
        aller(`/factures/${facture.id}`);
      } catch (erreur) {
        if (erreur.details?.facture_id) aller(`/factures/${erreur.details.facture_id}`);
        throw erreur;
      }
    })
  );
  return bouton;
}

function sectionFacturation(devis) {
  const lienFacture = (f) => h("a", { href: `#/factures/${f.id}` }, f.numero || "Brouillon");
  const ponctuelles = devis.factures.filter((f) => !f.periodicite);
  if (!devis.calcul.lignes.length) return null; // abonnement seul : voir sectionAbonnement
  if (devis.mode === "forfait") {
    return h(
      "section",
      { class: "carte" },
      h("h2", {}, "Facturation selon l'échéancier"),
      h(
        "div",
        { class: "tableau-defilant" },
        h(
          "table",
          { class: "tableau" },
          h("thead", {}, h("tr", {}, ["Étape", "Part", "Montant TTC", "Facture"].map((t, i) => h("th", { scope: "col", class: i === 1 || i === 2 ? "nombre" : "" }, t)))),
          h(
            "tbody",
            {},
            devis.echeancier.map((etape) => {
              const factures = devis.factures.filter((f) => f.etape === etape.rang);
              const libelle = { acompte: "Facturer l'acompte", intermediaire: "Facturer l'étape", solde: "Facturer le solde" }[etape.type];
              return h(
                "tr",
                {},
                h("td", { "data-titre": "Étape" }, etape.etape, h("span", { class: "discret" }, ` · ${TYPES_FACTURE[etape.type]}`)),
                h("td", { class: "nombre", "data-titre": "Part" }, formaterPourcentage(etape.pourcentage)),
                h("td", { class: "nombre", "data-titre": "Montant TTC" }, formaterMontant(etape.montant_ttc)),
                h(
                  "td",
                  { "data-titre": "Facture" },
                  factures.length
                    ? factures.map((f) => h("span", { class: "pile-ligne" }, lienFacture(f), " ", badgeStatut(f.statut === "brouillon" ? "brouillon" : f.statut === "payee" ? "payee" : "emise")))
                    : devis.statut === "accepte"
                      ? boutonFacturer(devis, etape.rang, libelle)
                      : "—"
                )
              );
            })
          )
        )
      ),
      h("p", { class: "discret" }, "La facture de solde reprend toute la prestation et déduit les acomptes déjà facturés.")
    );
  }
  return h(
    "section",
    { class: "carte" },
    h("h2", {}, "Facturation"),
    ponctuelles.length ? h("ul", {}, ponctuelles.map((f) => h("li", {}, lienFacture(f), ` · ${STATUTS_FACTURE[f.statut] || f.statut} · ${formaterMontant(f.montant_ttc)}`))) : vide("Aucune facture."),
    devis.statut === "accepte" ? boutonFacturer(devis, null, "Créer une facture depuis ce devis") : null
  );
}

/** Abonnements du devis : facturés à part, une facture par période à partir de la livraison */
function sectionAbonnement(devis) {
  const periodes = devis.calcul.recurrent.periodes;
  const factures = devis.factures.filter((f) => f.periodicite);
  const bouton = (periodicite) => {
    const b = h("button", { type: "button", class: "bouton bouton--principal" }, periodicite === "mois" ? "Facturer un mois d'abonnement" : "Facturer une année d'abonnement");
    b.addEventListener("click", () =>
      agir(b, async () => {
        // Forfait pas encore livré (aucune facture de solde émise) : on demande avant de démarrer
        const livre = !devis.calcul.lignes.length || devis.factures.some((f) => f.type === "solde" && f.statut !== "brouillon");
        if (!livre && !factures.length) {
          const ok = await confirmer({
            titre: "Le projet n'est pas encore livré",
            message: "Aucune facture de solde n'est émise : l'abonnement démarre normalement à la livraison. Le faire commencer aujourd'hui ?",
            bouton: "Commencer aujourd'hui",
          });
          if (!ok) return;
        }
        try {
          const facture = await api(`/devis/${devis.id}/abonnement`, { methode: "POST", corps: { periodicite } });
          notifier("Brouillon créé pour la période suivante : vérifiez les dates, puis émettez-le.");
          aller(`/factures/${facture.id}`);
        } catch (erreur) {
          if (erreur.details?.facture_id) aller(`/factures/${erreur.details.facture_id}`);
          throw erreur;
        }
      })
    );
    return b;
  };
  return h(
    "section",
    { class: "carte" },
    h("h2", {}, "Abonnement"),
    h("p", {}, `${phraseAbonnement(periodes, devis.contexte.conditions).replace(/^puis /, "")}.`.replace(/^./, (c) => c.toUpperCase())),
    factures.length
      ? h(
          "ul",
          {},
          factures.map((f) =>
            h("li", {}, h("a", { href: `#/factures/${f.id}` }, f.numero || "Brouillon"), ` · du ${date(f.prestation_debut)} au ${date(f.prestation_fin)} · `, badgeStatut(f.statut === "brouillon" ? "brouillon" : f.statut === "payee" ? "payee" : "emise"))
          )
        )
      : vide("Aucune période facturée."),
    devis.statut === "accepte" ? h("div", { class: "actions" }, periodes.map((p) => bouton(p.unite))) : null,
    h("p", { class: "discret" }, "La première période commence à la livraison (date de la facture de solde), les suivantes s'enchaînent. Ces factures comptent dans le chiffre d'affaires et le suivi du seuil de franchise.")
  );
}

/** Cadrage et notes d'un devis envoyé : enregistrés à part, le devis lui-même reste figé */
function suiviDevis(devis, g) {
  const types = [...new Set([...devis.cadrage.types, ...typesDesRefs(g, devis.lignes.map((l) => l.ref))])];
  const notes = h("textarea", { rows: 3, maxlength: 5000, value: devis.notes || "", placeholder: "Tout ce qui est utile au projet : échanges, contraintes, idées…" });
  const cadrage = cadrageProjet(g, devis.cadrage, () => types, () => marquerModifie());
  const bouton = h("button", { type: "submit", class: "bouton bouton--principal" }, "Enregistrer le cadrage et les notes");
  const enregistrer = async () => {
    await api(`/devis/${devis.id}/suivi`, { methode: "PUT", corps: { notes: notes.value, cadrage: cadrage.lire() } });
    marquerModifie(false);
  };
  return h(
    "form",
    {
      onInput: () => marquerModifie(),
      onSubmit: (e) => {
        e.preventDefault();
        agir(bouton, async () => {
          await api(`/devis/${devis.id}/suivi`, { methode: "PUT", corps: { notes: notes.value, cadrage: cadrage.lire() } });
          marquerModifie(false);
          notifier("Cadrage et notes enregistrés.");
        });
      },
    },
    blocCadrage(cadrage, notes, devis.id, enregistrer),
    h("div", { class: "actions actions--barre" }, bouton)
  );
}

function vueDevisEnvoye(devis, g) {
  const c = devis.contexte;
  const actions = [h("a", { class: "bouton bouton--principal", href: lienApi(`/devis/${devis.id}/pdf`), target: "_blank", rel: "noopener" }, "PDF du devis")];
  if (devis.statut === "envoye") {
    actions.push(boutonStatut(devis, "accepte", "Accepté par le client", "bouton"), boutonStatut(devis, "refuse", "Refusé", "bouton"));
  } else if (!devis.factures.length) {
    actions.push(boutonStatut(devis, "envoye", "Annuler la réponse", "bouton bouton--discret"));
  }
  actions.push(boutonDupliquer(devis.id));

  const recap = recapitulatif();
  recap.afficher({ lignes: devis.lignes, remise: devis.remise, taux_tva: devis.taux_tva }, { mention: c.tva.mention, devis: true, conditions: c.conditions });

  return h(
    "div",
    { class: "page" },
    enTete(`Devis ${devis.numero}`, badgeStatut(devis.statut_affiche, "devis")),
    h("div", { class: "actions actions--barre" }, actions),
    devis.statut_affiche === "expire"
      ? h("p", { class: "alerte alerte--attention" }, `Validité dépassée depuis le ${date(devis.date_fin_validite)}. Relancez le client, ou dupliquez le devis pour en émettre un nouveau.`)
      : null,
    h(
      "div",
      { class: "editeur" },
      h(
        "div",
        { class: "editeur__principal" },
        h(
          "section",
          { class: "carte" },
          h(
            "dl",
            { class: "details" },
            h("dt", {}, "Client"), h("dd", {}, h("a", { href: `#/clients/${devis.client_id}` }, c.client.nom)),
            h("dt", {}, "Objet"), h("dd", {}, devis.objet || "—"),
            h("dt", {}, "Date"), h("dd", {}, date(devis.date_devis)),
            h("dt", {}, "Valable jusqu'au"), h("dd", {}, date(devis.date_fin_validite)),
            h("dt", {}, "Facturation"), h("dd", {}, MODES_DEVIS[devis.mode]),
            h("dt", {}, "Délai d'exécution"), h("dd", {}, devis.delai_execution || "—"),
            devis.date_reponse ? [h("dt", {}, "Réponse le"), h("dd", {}, date(devis.date_reponse))] : null
          )
        ),
        h("section", { class: "carte" }, h("h2", {}, "Prestations"), tableauLignesLecture(devis.calcul)),
        devis.statut === "accepte" || devis.factures.length ? sectionFacturation(devis) : null,
        devis.calcul.recurrent.periodes.length && (devis.statut === "accepte" || devis.factures.length) ? sectionAbonnement(devis) : null,
        suiviDevis(devis, g)
      ),
      h("aside", { class: "editeur__cote" }, h("section", { class: "carte carte--recap" }, h("h2", {}, "Montants"), recap.element))
    ),
    devis.pdf_sha256 ? h("p", { class: "empreinte" }, `PDF archivé : ${devis.pdf_cle} · SHA-256 ${devis.pdf_sha256}`) : null
  );
}
