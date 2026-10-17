/* Clients : liste et fiche (particulier ou professionnel) */

import { agir, aller, api, badgeStatut, champ, confirmer, date, enTete, h, lienBouton, marquerModifie, montant, notifier, tableau, vide } from "../ui.js";
import { TYPES_CLIENT } from "../lib/libelles.js";

export async function pageClients() {
  const clients = await api("/clients");
  return h(
    "div",
    { class: "page" },
    enTete("Clients", lienBouton("Nouveau client", "#/clients/nouveau", "bouton bouton--principal")),
    clients.length
      ? tableau(
          [
            { titre: "Nom", valeur: (c) => c.nom },
            { titre: "Type", valeur: (c) => TYPES_CLIENT[c.type] },
            { titre: "SIREN", valeur: (c) => c.siren || "—" },
            { titre: "Ville", valeur: (c) => c.ville },
            { titre: "E-mail", valeur: (c) => c.email || "—" },
            { titre: "Documents", classe: "nombre", valeur: (c) => `${c.nb_devis} devis, ${c.nb_factures} fact.` },
            { titre: "", classe: "nombre", valeur: (c) => h("a", { href: `#/clients/${c.id}`, "aria-label": `Modifier ${c.nom}` }, "Modifier") },
          ],
          clients,
          (c) => `#/clients/${c.id}`
        )
      : vide("Aucun client pour l'instant.")
  );
}

/**
 * Formulaire de fiche client, utilisé par la page client et par la création
 * rapide depuis un devis ou une facture. surEnregistrement(client) après succès.
 */
export function formulaireClient(client, surEnregistrement) {
  const c = client || { type: "professionnel", nom: "", siren: "", adresse: "", code_postal: "", ville: "", pays: "France", email: "" };
  const radio = (valeur) =>
    h("label", { class: "choix" }, h("input", { type: "radio", name: "type-client", value: valeur, checked: c.type === valeur, onChange: majType }), TYPES_CLIENT[valeur]);
  const champs = {
    nom: h("input", { type: "text", required: true, maxlength: 200, autocomplete: "off", value: c.nom }),
    siren: h("input", { type: "text", inputmode: "numeric", maxlength: 11, pattern: "[0-9 ]{9,11}", value: c.siren }),
    adresse: h("textarea", { rows: 2, required: true, maxlength: 500, value: c.adresse }),
    code_postal: h("input", { type: "text", required: true, maxlength: 20, autocomplete: "off", value: c.code_postal }),
    ville: h("input", { type: "text", required: true, maxlength: 120, value: c.ville }),
    pays: h("input", { type: "text", maxlength: 80, value: c.pays }),
    email: h("input", { type: "email", maxlength: 254, value: c.email }),
  };
  const blocSiren = champ("SIREN", champs.siren, "9 chiffres, sur le Kbis ou annuaire-entreprises.data.gouv.fr");

  function typeChoisi() {
    return formulaire.querySelector("input[name=type-client]:checked")?.value;
  }
  function majType() {
    blocSiren.hidden = typeChoisi() !== "professionnel";
    champs.siren.required = !blocSiren.hidden;
  }

  const bouton = h("button", { class: "bouton bouton--principal", type: "submit" }, client ? "Enregistrer" : "Créer le client");
  const formulaire = h(
    "form",
    {
      class: "formulaire",
      onInput: () => marquerModifie(),
      onSubmit: (evenement) => {
        evenement.preventDefault();
        agir(bouton, async () => {
          const donnees = Object.fromEntries(Object.entries(champs).map(([cle, el]) => [cle, el.value]));
          donnees.type = typeChoisi();
          const enregistre = await api(client ? `/clients/${client.id}` : "/clients", { methode: client ? "PUT" : "POST", corps: donnees });
          marquerModifie(false);
          notifier(client ? "Client enregistré." : "Client créé.");
          surEnregistrement(enregistre);
        });
      },
    },
    h("fieldset", { class: "choix-groupe" }, h("legend", {}, "Type de client"), radio("professionnel"), radio("particulier")),
    champ("Nom ou raison sociale", champs.nom),
    blocSiren,
    champ("Adresse", champs.adresse),
    h("div", { class: "rangee" }, champ("Code postal", champs.code_postal), champ("Ville", champs.ville)),
    h("div", { class: "rangee" }, champ("Pays", champs.pays), champ("E-mail", champs.email)),
    h("div", { class: "actions" }, bouton)
  );
  majType();
  return formulaire;
}

// Devis et factures du client, sur sa fiche
function documentsDuClient(devis, factures) {
  if (!devis.length && !factures.length) return null;
  return h(
    "section",
    { class: "carte" },
    h("h2", {}, "Documents"),
    devis.length
      ? tableau(
          [
            { titre: "Devis", valeur: (d) => d.numero },
            { titre: "Objet", valeur: (d) => d.objet || "—" },
            { titre: "Montant TTC", classe: "nombre", valeur: (d) => montant(d.montant_ttc) },
            { titre: "Statut", valeur: (d) => badgeStatut(d.statut_affiche, "devis") },
          ],
          devis,
          (d) => `#/devis/${d.id}`
        )
      : null,
    factures.length
      ? tableau(
          [
            { titre: "Facture", valeur: (f) => f.numero || "Brouillon" },
            { titre: "Émission", valeur: (f) => date(f.date_emission) },
            { titre: "Montant TTC", classe: "nombre", valeur: (f) => montant(f.serie === "A" ? -f.montant_ttc : f.montant_ttc) },
            { titre: "Statut", valeur: (f) => badgeStatut(f.statut_affiche) },
          ],
          factures,
          (f) => `#/factures/${f.id}`
        )
      : null
  );
}

export async function pageClient(id) {
  const [client, tousDevis, toutesFactures] = id
    ? await Promise.all([api(`/clients/${id}`), api("/devis"), api("/factures")])
    : [null, [], []];
  const supprimer = h("button", { class: "bouton bouton--danger", type: "button" }, "Supprimer");
  supprimer.addEventListener("click", () =>
    agir(supprimer, async () => {
      const ok = await confirmer({ titre: "Supprimer ce client ?", message: "Possible uniquement s'il n'a ni devis ni facture.", bouton: "Supprimer", danger: true });
      if (!ok) return;
      await api(`/clients/${id}`, { methode: "DELETE" });
      notifier("Client supprimé.");
      aller("/clients");
    })
  );
  return h(
    "div",
    { class: "page page--etroite" },
    enTete(client ? client.nom : "Nouveau client", client ? supprimer : null),
    client
      ? h(
          "p",
          { class: "discret" },
          "Vos modifications s'appliquent aux brouillons dès leur prochain enregistrement. Les devis envoyés et les factures émises gardent les coordonnées en vigueur à leur émission : une facture émise ne change plus."
        )
      : null,
    h("section", { class: "carte" }, formulaireClient(client, (enregistre) => aller(`/clients/${enregistre.id}`))),
    client
      ? documentsDuClient(
          tousDevis.filter((d) => d.client_id === client.id),
          toutesFactures.filter((f) => f.client_id === client.id)
        )
      : null
  );
}
