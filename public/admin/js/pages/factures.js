/* Factures et avoirs : liste, brouillon, émission, paiement, avoir */

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
  rafraichir,
  tableau,
  vide,
} from "../ui.js";
import { choixRemise, editeurLignes, recapitulatif, tableauLignesLecture, tauxTvaDeLaGrille } from "../composants/document.js";
import { choixClient } from "./devis.js";
import { configurateur, typesDesRefs } from "../composants/configurateur.js";
import { analyserMontant, aujourdhui, formaterMontant } from "../lib/format.js";
import { TYPES_FACTURE } from "../lib/libelles.js";

export async function pageListeFactures(annee) {
  const anneeCourante = Number(aujourdhui().slice(0, 4));
  const choix = Number(annee || anneeCourante);
  const factures = await api(`/factures?annee=${choix}`);
  const annees = Array.from({ length: anneeCourante - 2025 }, (_, i) => anneeCourante - i);
  const page = h(
    "div",
    { class: "page" },
    enTete(
      "Factures",
      h(
        "select",
        { "aria-label": "Année", value: String(choix), onChange: async (e) => page.replaceWith(await pageListeFactures(e.target.value)) },
        annees.map((a) => h("option", { value: String(a) }, String(a)))
      ),
      h("a", { class: "bouton", href: lienApi(`/factures.csv?annee=${choix}`) }, `Export CSV ${choix}`),
      lienBouton("Nouvelle facture", "#/factures/nouvelle", "bouton bouton--principal")
    ),
    h("p", { class: "discret" }, "Pour facturer un devis accepté (acompte, solde), ouvrez le devis. Ici : abonnements, régie, prestations ponctuelles."),
    factures.length
      ? tableau(
          [
            { titre: "Numéro", valeur: (f) => f.numero || "Brouillon" },
            { titre: "Type", valeur: (f) => TYPES_FACTURE[f.type] },
            { titre: "Client", valeur: (f) => f.client_nom },
            { titre: "Émission", valeur: (f) => date(f.date_emission) },
            { titre: "Échéance", valeur: (f) => date(f.date_echeance) },
            { titre: "Montant TTC", classe: "nombre", valeur: (f) => montant(f.serie === "A" ? -f.montant_ttc : f.montant_ttc) },
            { titre: "Statut", valeur: (f) => badgeStatut(f.statut_affiche) },
          ],
          factures,
          (f) => `#/factures/${f.id}`
        )
      : vide(`Aucune facture en ${choix}.`)
  );
  return page;
}

export async function pageFacture(id) {
  const [facture, grille, clients] = await Promise.all([
    id ? api(`/factures/${id}`) : Promise.resolve(null),
    api("/grille"),
    api("/clients"),
  ]);
  if (facture && facture.statut !== "brouillon") return vueFactureEmise(facture);
  return editeurFacture(facture, grille, clients);
}

function titre(f) {
  if (!f) return "Nouvelle facture";
  const type = TYPES_FACTURE[f.type];
  return f.numero ? `${type} ${f.numero}` : `${type} (brouillon)`;
}

/* ---------- Brouillon ---------- */

function editeurFacture(facture, grille, clients) {
  const g = grille.contenu;
  const avoir = facture?.serie === "A";
  // Un avoir garde la TVA de la facture qu'il corrige
  const tva = avoir ? facture.taux_tva : tauxTvaDeLaGrille(g);
  const surChangement = () => {
    marquerModifie();
    majRecap();
  };

  const clientModifiable = !facture || facture.type === "standard";
  const client = choixClient(clients, facture?.client_id, surChangement);
  client.select.disabled = !clientModifiable;
  client.element.querySelector("button").hidden = !clientModifiable;
  const objet = h("input", { type: "text", maxlength: 300, value: facture?.objet || "", placeholder: "Ex. : Maintenance Sérénité, octobre 2026" });
  const debut = h("input", { type: "date", value: facture?.prestation_debut || "" });
  const fin = h("input", { type: "date", value: facture?.prestation_fin || "" });
  const notes = h("textarea", { rows: 3, maxlength: 5000, value: facture?.notes || "", placeholder: "Visibles uniquement ici, jamais sur le PDF" });
  const lignes = editeurLignes(facture?.lignes || [], g, surChangement);
  const remise = choixRemise(facture?.remise || null, g, surChangement);
  // Facture directe : type de prestation puis formules et options, comme pour un devis
  const config = configurateur(g, lignes, typesDesRefs(g, (facture?.lignes || []).map((l) => l.ref)), () => marquerModifie());
  const recap = recapitulatif();

  function majRecap() {
    const { lignes: l, erreurs } = lignes.lire();
    const { remise: r, erreur } = remise.lire();
    if (erreurs.length || erreur) return;
    recap.afficher(
      { lignes: l, remise: r, taux_tva: tva, deductions: facture?.deductions || [] },
      { titreFinal: avoir ? "Total de l'avoir TTC" : "Net à payer TTC", mention: tva ? "" : g.tva.mention_franchise, libelleDeduction: avoir ? "Déjà déduit" : "Déjà facturé" }
    );
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
      prestation_debut: debut.value || null,
      prestation_fin: fin.value || null,
      lignes: l,
      remise: r,
      notes: notes.value,
    };
  }

  async function enregistrer() {
    const resultat = await api(facture ? `/factures/${facture.id}` : "/factures", { methode: facture ? "PUT" : "POST", corps: donnees() });
    marquerModifie(false);
    return resultat;
  }

  const boutonEnregistrer = h("button", { type: "submit", class: "bouton bouton--principal" }, facture ? "Enregistrer le brouillon" : "Créer le brouillon");
  const actions = [boutonEnregistrer];
  if (facture) {
    const apercu = h("button", { type: "button", class: "bouton" }, "Aperçu PDF");
    apercu.addEventListener("click", () => ouvrirApres(apercu, lienApi(`/factures/${facture.id}/pdf`), enregistrer));

    const emettre = h("button", { type: "button", class: "bouton bouton--accent" }, avoir ? "Émettre l'avoir" : "Émettre la facture");
    emettre.addEventListener("click", () =>
      agir(emettre, async () => {
        await enregistrer();
        const ok = await confirmer({
          titre: avoir ? "Émettre cet avoir ?" : "Émettre cette facture ?",
          message: [
            `Elle recevra le prochain numéro de la série ${avoir ? "A" : "F"}, datée d'aujourd'hui, et son PDF sera archivé.`,
            "Une fois émise, elle ne pourra plus être modifiée ni supprimée : une erreur se corrigera par un avoir.",
          ],
          bouton: avoir ? "Émettre l'avoir" : "Émettre la facture",
        });
        if (!ok) return;
        const emise = await api(`/factures/${facture.id}/emettre`, { methode: "POST" });
        notifier(emise.avertissement || `${TYPES_FACTURE[emise.type]} ${emise.numero} émise.`, emise.avertissement ? "erreur" : "succes");
        rafraichir();
      })
    );

    const supprimer = h("button", { type: "button", class: "bouton bouton--danger" }, "Supprimer le brouillon");
    supprimer.addEventListener("click", () =>
      agir(supprimer, async () => {
        const ok = await confirmer({ titre: "Supprimer ce brouillon ?", message: "Il n'a pas encore de numéro : aucun trou dans la numérotation.", bouton: "Supprimer", danger: true });
        if (!ok) return;
        await api(`/factures/${facture.id}`, { methode: "DELETE" });
        notifier("Brouillon supprimé.");
        aller("/factures");
      })
    );
    actions.push(apercu, emettre, supprimer);
  }

  const references = [];
  if (facture?.devis_numero) references.push(h("p", {}, "Selon le devis ", h("a", { href: `#/devis/${facture.devis_id}` }, facture.devis_numero)));
  if (facture?.origine_numero) references.push(h("p", {}, "Avoir sur la facture ", h("a", { href: `#/factures/${facture.facture_origine_id}` }, facture.origine_numero)));

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
          notifier("Brouillon enregistré.");
          aller(`/factures/${resultat.id}`);
        });
      },
    },
    h(
      "div",
      { class: "editeur__principal" },
      h(
        "section",
        { class: "carte" },
        references,
        champ("Client", client.element, clientModifiable ? null : "Repris du devis ou de la facture d'origine."),
        champ("Objet", objet),
        h(
          "div",
          { class: "rangee" },
          champ("Date de la prestation, ou début de période", debut, "Vide : date d'émission."),
          champ("Fin de période (facultative)", fin, "Ex. : abonnement du 1er au 31.")
        )
      ),
      h(
        "section",
        { class: "carte" },
        h("h2", {}, avoir ? "Lignes de l'avoir" : "Prestations"),
        clientModifiable ? config.element : null,
        clientModifiable
          ? h("details", { class: "lignes__detail", open: Boolean(facture) }, h("summary", {}, "Lignes de la facture : ajuster un prix, une description, ajouter une ligne libre"), lignes.element)
          : lignes.element
      ),
      h("section", { class: "carte" }, h("h2", {}, "Remise"), remise.element),
      h("section", { class: "carte" }, champ("Notes internes", notes))
    ),
    h(
      "aside",
      { class: "editeur__cote" },
      h(
        "section",
        { class: "carte carte--recap" },
        h("h2", {}, "Montants"),
        recap.element,
        facture?.type === "solde" ? h("p", { class: "discret" }, "Les acomptes déduits sont recalculés à l'émission.") : null,
        h("div", { class: "actions actions--pile" }, actions)
      )
    )
  );
  queueMicrotask(majRecap);
  return h("div", { class: "page" }, enTete(titre(facture), facture ? badgeStatut("brouillon") : null), formulaire);
}

/* ---------- Facture ou avoir émis ---------- */

function sectionPaiement(f) {
  const avoir = f.serie === "A";
  if (f.statut === "payee") {
    const annuler = h("button", { type: "button", class: "bouton bouton--discret" }, "Annuler le paiement");
    annuler.addEventListener("click", () =>
      agir(annuler, async () => {
        if (!(await confirmer({ titre: "Annuler ce paiement ?", message: "À utiliser en cas d'erreur de saisie.", bouton: "Annuler le paiement", danger: true }))) return;
        await api(`/factures/${f.id}/paiement`, { methode: "DELETE" });
        notifier("Paiement annulé.");
        rafraichir();
      })
    );
    return h(
      "section",
      { class: "carte" },
      h("h2", {}, avoir ? "Remboursement" : "Paiement"),
      h("p", {}, `${avoir ? "Remboursé" : "Payée"} le ${date(f.date_paiement)} : ${formaterMontant(f.montant_paye)}.`),
      annuler
    );
  }
  if (!avoir && f.statut_affiche === "annulee") {
    return h("section", { class: "carte" }, h("h2", {}, "Paiement"), h("p", {}, "Facture entièrement annulée par avoir : rien à encaisser."));
  }
  const dateSaisie = h("input", { type: "date", required: true, value: aujourdhui(), max: aujourdhui(), min: f.date_emission });
  const aPayer = avoir ? f.montant_ttc : f.reste_du;
  const montantSaisi = h("input", { type: "text", inputmode: "decimal", class: "nombre", required: true, value: (aPayer / 100).toFixed(2).replace(".", ",") });
  const bouton = h("button", { type: "submit", class: "bouton bouton--principal" }, avoir ? "Enregistrer le remboursement" : "Enregistrer le paiement");
  return h(
    "section",
    { class: "carte" },
    h("h2", {}, avoir ? "Remboursement" : "Paiement"),
    avoir
      ? h("p", { class: "discret" }, "Si l'avoir est déduit d'une autre facture, ne rien saisir ici. S'il est remboursé au client, indiquez la date du virement.")
      : h("p", {}, `Reste dû : ${formaterMontant(f.reste_du)}${f.statut_affiche === "en_retard" ? `, en retard depuis le ${date(f.date_echeance)}` : `, échéance le ${date(f.date_echeance)}`}.`),
    h(
      "form",
      {
        class: "rangee rangee--bas",
        onSubmit: (e) => {
          e.preventDefault();
          agir(bouton, async () => {
            const centimes = analyserMontant(montantSaisi.value);
            if (!Number.isFinite(centimes) || centimes <= 0) throw new Error("Montant invalide.");
            await api(`/factures/${f.id}/paiement`, { methode: "POST", corps: { date_paiement: dateSaisie.value, montant: centimes } });
            notifier(avoir ? "Remboursement enregistré." : "Paiement enregistré.");
            rafraichir();
          });
        },
      },
      champ(avoir ? "Date du remboursement" : "Date de paiement", dateSaisie),
      champ("Montant (€)", montantSaisi),
      bouton
    )
  );
}

function sectionNotes(f) {
  const notes = h("textarea", { rows: 3, maxlength: 5000, value: f.notes || "" });
  const bouton = h("button", { type: "submit", class: "bouton" }, "Enregistrer la note");
  return h(
    "section",
    { class: "carte" },
    h(
      "form",
      {
        onSubmit: (e) => {
          e.preventDefault();
          agir(bouton, async () => {
            await api(`/factures/${f.id}/notes`, { methode: "PUT", corps: { notes: notes.value } });
            notifier("Note enregistrée.");
          });
        },
      },
      champ("Notes internes (relances, échanges…)", notes),
      bouton
    )
  );
}

// Facturation électronique : résultat de la transmission à la plateforme agréée
function transmissionElectronique(f) {
  const t = f.transmission;
  if (!t) return null;
  if (t.statut === "deposee") {
    return h("p", { class: "empreinte" }, `Facturation électronique : déposée le ${date(t.le.slice(0, 10))} (${t.connecteur}${t.reference ? `, réf. ${t.reference}` : ""}).`);
  }
  const relancer = h("button", { type: "button", class: "bouton" }, "Relancer la transmission");
  relancer.addEventListener("click", () =>
    agir(relancer, async () => {
      await api(`/factures/${f.id}/transmettre`, { methode: "POST" });
      notifier("Transmission relancée.");
      rafraichir();
    })
  );
  return h(
    "div",
    { class: "alerte alerte--danger" },
    h("p", {}, `Facturation électronique : transmission ${t.statut === "rejetee" ? "rejetée" : "en échec"} (${t.connecteur})${t.message ? ` : ${t.message}` : ""}.`),
    relancer
  );
}

function vueFactureEmise(f) {
  const avoir = f.serie === "A";
  const c = f.contexte;
  const actions = [h("a", { class: "bouton bouton--principal", href: lienApi(`/factures/${f.id}/pdf`), target: "_blank", rel: "noopener" }, "PDF")];
  if (!avoir) {
    if (f.statut_affiche !== "annulee") {
      // Avoir total : reprend exactement la facture ; partiel : une ligne libre à compléter
      const boutonAvoir = (texte, partiel) => {
        const bouton = h("button", { type: "button", class: "bouton" }, texte);
        bouton.addEventListener("click", () =>
          agir(bouton, async () => {
            try {
              const brouillon = await api(`/factures/${f.id}/avoir`, { methode: "POST", corps: { partiel } });
              notifier(partiel ? "Brouillon d'avoir partiel créé : indiquez le montant, puis émettez-le." : "Brouillon d'avoir créé pour tout le reste de la facture : vérifiez-le, puis émettez-le.");
              aller(`/factures/${brouillon.id}`);
            } catch (erreur) {
              if (erreur.details?.facture_id) aller(`/factures/${erreur.details.facture_id}`);
              throw erreur;
            }
          })
        );
        return bouton;
      };
      actions.push(boutonAvoir("Annuler par un avoir", false), boutonAvoir("Avoir partiel", true));
    }
    const dupliquer = h("button", { type: "button", class: "bouton" }, "Dupliquer en brouillon");
    dupliquer.addEventListener("click", () =>
      agir(dupliquer, async () => {
        const copie = await api(`/factures/${f.id}/dupliquer`, { methode: "POST" });
        notifier("Copie créée : pensez à mettre à jour la période.");
        aller(`/factures/${copie.id}`);
      })
    );
    actions.push(dupliquer);
  }

  const recap = recapitulatif();
  recap.afficher(
    { lignes: f.lignes, remise: f.remise, taux_tva: f.taux_tva, deductions: f.deductions },
    { titreFinal: avoir ? "Total de l'avoir TTC" : "Net à payer TTC", mention: c.tva.mention, libelleDeduction: avoir ? "Déjà déduit" : "Déjà facturé" }
  );
  const periode = f.prestation_fin && f.prestation_fin !== f.prestation_debut ? `du ${date(f.prestation_debut)} au ${date(f.prestation_fin)}` : date(f.prestation_debut);

  return h(
    "div",
    { class: "page" },
    enTete(titre(f), badgeStatut(f.statut_affiche)),
    h("div", { class: "actions actions--barre" }, actions),
    h("p", { class: "discret" }, avoir ? "Avoir émis : il ne peut plus être modifié ni supprimé." : "Facture émise : elle ne peut plus être modifiée ni supprimée. Une erreur se corrige par un avoir."),
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
            h("dt", {}, "Client"), h("dd", {}, h("a", { href: `#/clients/${f.client_id}` }, c.client.nom)),
            h("dt", {}, "Objet"), h("dd", {}, f.objet || "—"),
            h("dt", {}, "Émise le"), h("dd", {}, date(f.date_emission)),
            h("dt", {}, avoir ? "Date" : "Prestation"), h("dd", {}, periode),
            avoir ? null : [h("dt", {}, "Échéance"), h("dd", {}, date(f.date_echeance))],
            f.devis_numero ? [h("dt", {}, "Devis"), h("dd", {}, h("a", { href: `#/devis/${f.devis_id}` }, f.devis_numero))] : null,
            f.origine_numero ? [h("dt", {}, "Facture corrigée"), h("dd", {}, h("a", { href: `#/factures/${f.facture_origine_id}` }, f.origine_numero))] : null,
            f.avoirs.length
              ? [h("dt", {}, "Avoirs"), h("dd", {}, f.avoirs.map((a) => h("span", { class: "pile-ligne" }, h("a", { href: `#/factures/${a.id}` }, a.numero || "Brouillon"), ` · ${formaterMontant(a.montant_ttc)}`)))]
              : null
          )
        ),
        h("section", { class: "carte" }, h("h2", {}, avoir ? "Lignes de l'avoir" : "Prestations"), tableauLignesLecture(f.calcul)),
        sectionPaiement(f),
        sectionNotes(f)
      ),
      h("aside", { class: "editeur__cote" }, h("section", { class: "carte carte--recap" }, h("h2", {}, "Montants"), recap.element))
    ),
    transmissionElectronique(f),
    f.pdf_sha256 ? h("p", { class: "empreinte" }, `PDF archivé : ${f.pdf_cle} · SHA-256 ${f.pdf_sha256}`) : null
  );
}
