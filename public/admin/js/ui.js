/* ==========================================================================
   Outils d'interface : création d'éléments, appels à l'API, notifications,
   boîtes de dialogue. Le texte passe toujours par textContent (jamais
   innerHTML) : un nom de client ne peut pas injecter de code dans la page.
   ========================================================================== */

import { formaterDate, formaterMontant } from "./lib/format.js";
import { STATUTS_DEVIS, STATUTS_FACTURE } from "./lib/libelles.js";

/**
 * h("button", { class: "bouton", onClick: fn }, "Texte", autreElement)
 * Attributs : onXxx = écouteur, class, dataset, value/checked (propriétés), le reste en attribut.
 */
export function h(balise, attributs = {}, ...enfants) {
  const element = document.createElement(balise);
  const proprietes = {};
  for (const [nom, valeur] of Object.entries(attributs || {})) {
    if (valeur === null || valeur === undefined || valeur === false) continue;
    if (nom.startsWith("on") && typeof valeur === "function") element.addEventListener(nom.slice(2).toLowerCase(), valeur);
    else if (nom === "class") element.className = valeur;
    else if (nom === "dataset") Object.assign(element.dataset, valeur);
    else if (nom === "value" || nom === "checked" || nom === "selected") proprietes[nom] = valeur;
    else element.setAttribute(nom, valeur === true ? "" : String(valeur));
  }
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    element.append(enfant instanceof Node ? enfant : String(enfant));
  }
  // Après les enfants : la valeur d'un <select> doit correspondre à une option existante
  Object.assign(element, proprietes);
  return element;
}

/* ---------- API ---------- */

export class ErreurApi extends Error {
  constructor(message, statut, details) {
    super(message);
    this.statut = statut;
    this.details = details;
  }
}

const SESSION_EXPIREE = "Session expirée ou connexion perdue : rechargez la page pour vous reconnecter.";

export async function api(chemin, { methode = "GET", corps } = {}) {
  let reponse;
  try {
    reponse = await fetch(`/api/admin${chemin}`, {
      method: methode,
      headers: methode === "GET" ? {} : { "Content-Type": "application/json" },
      body: methode === "GET" ? undefined : JSON.stringify(corps ?? {}),
      credentials: "same-origin",
      // Session Access expirée : Access répond par une redirection vers sa page de connexion
      redirect: "manual",
    });
  } catch {
    throw new ErreurApi(SESSION_EXPIREE, 0);
  }
  if (reponse.type === "opaqueredirect" || reponse.status === 0) throw new ErreurApi(SESSION_EXPIREE, 0);
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const message = reponse.status === 404 && donnees.erreur === "Introuvable." ? SESSION_EXPIREE : donnees.erreur;
    throw new ErreurApi(message || `Erreur ${reponse.status}`, reponse.status, donnees.details);
  }
  return donnees;
}

/** Adresse d'un fichier de l'API (PDF, CSV), ouvert dans un nouvel onglet */
export function lienApi(chemin) {
  return `/api/admin${chemin}`;
}

/* ---------- Notifications ---------- */

export function notifier(message, type = "succes") {
  const zone = document.getElementById("notifications");
  const note = h("div", { class: `notification notification--${type}` }, message);
  zone.append(note);
  setTimeout(() => note.remove(), type === "erreur" ? 9000 : 4000);
}

/** Exécute une action en désactivant le bouton, et affiche l'erreur éventuelle */
export async function agir(bouton, action) {
  if (bouton) bouton.disabled = true;
  try {
    return await action();
  } catch (erreur) {
    afficherErreur(erreur);
    return undefined;
  } finally {
    if (bouton) bouton.disabled = false;
  }
}

/**
 * Enregistre puis ouvre un PDF dans un nouvel onglet. L'onglet est ouvert dès
 * le clic : ouvert après l'enregistrement, il serait bloqué par le navigateur.
 */
export async function ouvrirApres(bouton, adresse, action) {
  const onglet = window.open("about:blank", "_blank");
  const resultat = await agir(bouton, async () => {
    await action();
    return true;
  });
  if (!onglet) {
    if (resultat) window.location.href = adresse;
  } else if (resultat) {
    onglet.location.href = adresse;
  } else {
    onglet.close();
  }
}

export function afficherErreur(erreur) {
  const details = Array.isArray(erreur.details) ? erreur.details : [];
  notifier(details.length ? `${erreur.message} ${details.slice(0, 4).join(" ")}` : erreur.message, "erreur");
}

/* ---------- Boîtes de dialogue ---------- */

/** Demande une confirmation ; renvoie true si l'utilisateur valide */
export function confirmer({ titre, message, bouton = "Confirmer", danger = false }) {
  return new Promise((resoudre) => {
    const dialogue = h(
      "dialog",
      { class: "dialogue", "aria-labelledby": "dialogue-titre" },
      h("h2", { id: "dialogue-titre" }, titre),
      ...[].concat(message).map((m) => h("p", {}, m)),
      h(
        "div",
        { class: "actions" },
        h("button", { class: `bouton ${danger ? "bouton--danger" : "bouton--principal"}`, value: "oui", onClick: () => dialogue.close("oui") }, bouton),
        h("button", { class: "bouton", value: "non", onClick: () => dialogue.close("non") }, "Annuler")
      )
    );
    dialogue.addEventListener("close", () => {
      resoudre(dialogue.returnValue === "oui");
      dialogue.remove();
    });
    document.body.append(dialogue);
    dialogue.showModal();
  });
}

/** Ouvre un contenu dans une boîte de dialogue ; renvoie la fonction de fermeture */
export function ouvrirDialogue(titre, contenu) {
  const dialogue = h("dialog", { class: "dialogue dialogue--large", "aria-label": titre }, h("h2", {}, titre), contenu);
  dialogue.addEventListener("close", () => dialogue.remove());
  document.body.append(dialogue);
  dialogue.showModal();
  return () => dialogue.close();
}

/* ---------- Petits composants ---------- */

const CLASSES_STATUT = {
  brouillon: "neutre",
  envoye: "info",
  accepte: "succes",
  refuse: "neutre",
  expire: "alerte",
  emise: "info",
  emis: "info",
  en_retard: "danger",
  payee: "succes",
  rembourse: "succes",
  annulee: "neutre",
};

export function badgeStatut(statut, genre = "facture") {
  const libelle = (genre === "devis" ? STATUTS_DEVIS : STATUTS_FACTURE)[statut] || statut;
  return h("span", { class: `badge badge--${CLASSES_STATUT[statut] || "neutre"}` }, libelle);
}

export function montant(centimes) {
  return h("span", { class: "montant" }, formaterMontant(centimes));
}

export function date(iso) {
  return iso ? formaterDate(iso) : "—";
}

export function champ(libelle, controle, aide = null) {
  const id = controle.id || `champ-${Math.random().toString(36).slice(2, 9)}`;
  controle.id = id;
  return h(
    "div",
    { class: "champ" },
    h("label", { for: id }, libelle),
    controle,
    aide ? h("p", { class: "champ__aide" }, aide) : null
  );
}

export function enTete(titre, ...actions) {
  return h("div", { class: "entete-page" }, h("h1", {}, titre), h("div", { class: "actions" }, ...actions));
}

export function lienBouton(texte, href, classe = "bouton") {
  return h("a", { class: classe, href }, texte);
}

export function vide(message) {
  return h("p", { class: "vide" }, message);
}

/** Tableau cliquable : toute la ligne mène à `lien(element)` (le lien de la 1re colonne sert au clavier) */
export function tableau(colonnes, elements, lien) {
  const ouvrir = (element) => (evenement) => {
    if (evenement.target.closest("a, button, input, select, textarea")) return;
    location.hash = lien(element);
  };
  return h(
    "div",
    { class: "tableau-defilant" },
    h(
      "table",
      { class: `tableau${lien ? " tableau--cliquable" : ""}` },
      h("thead", {}, h("tr", {}, colonnes.map((c) => h("th", { class: c.classe || "", scope: "col" }, c.titre)))),
      h(
        "tbody",
        {},
        elements.map((element) =>
          h(
            "tr",
            { onClick: lien ? ouvrir(element) : null },
            colonnes.map((c, i) => {
              const contenu = c.valeur(element);
              return h(
                "td",
                { class: c.classe || "", "data-titre": c.titre },
                i === 0 && lien ? h("a", { href: lien(element) }, contenu) : contenu
              );
            })
          )
        )
      )
    )
  );
}

/* ---------- Navigation ---------- */

let rafraichirPage = () => location.reload();

export function definirRafraichissement(fonction) {
  rafraichirPage = fonction;
}

/** Réaffiche la page courante (après une action) */
export function rafraichir() {
  rafraichirPage();
}

/** Va à une adresse de l'admin (« /devis/12 ») */
export function aller(adresse) {
  marquerModifie(false);
  if (location.hash === `#${adresse}`) rafraichir();
  else location.hash = adresse;
}

/* ---------- Modifications non enregistrées ---------- */

let modifie = false;

export function marquerModifie(etat = true) {
  modifie = etat;
}

export function aDesModifications() {
  return modifie;
}

window.addEventListener("beforeunload", (evenement) => {
  if (modifie) evenement.preventDefault();
});
