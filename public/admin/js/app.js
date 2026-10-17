/* Espace admin : navigation entre les pages (adresses #/devis, #/factures/12…) */

import { aDesModifications, definirRafraichissement, h, marquerModifie } from "./ui.js";
import { pageTableauDeBord } from "./pages/tableau-de-bord.js";
import { pageClients, pageClient } from "./pages/clients.js";
import { pageListeDevis, pageDevis } from "./pages/devis.js";
import { pageListeFactures, pageFacture } from "./pages/factures.js";
import { pageGrille } from "./pages/grille.js";

// [adresse, section du menu, page]
const ROUTES = [
  [/^\/?$/, "tableau", () => pageTableauDeBord()],
  [/^\/devis$/, "devis", () => pageListeDevis()],
  [/^\/devis\/nouveau$/, "devis", () => pageDevis(null)],
  [/^\/devis\/(\d+)$/, "devis", (m) => pageDevis(Number(m[1]))],
  [/^\/factures$/, "factures", () => pageListeFactures()],
  [/^\/factures\/nouvelle$/, "factures", () => pageFacture(null)],
  [/^\/factures\/(\d+)$/, "factures", (m) => pageFacture(Number(m[1]))],
  [/^\/clients$/, "clients", () => pageClients()],
  [/^\/clients\/nouveau$/, "clients", () => pageClient(null)],
  [/^\/clients\/(\d+)$/, "clients", (m) => pageClient(Number(m[1]))],
  [/^\/grille$/, "grille", () => pageGrille()],
];

let adresseAffichee = null;

async function afficher() {
  const adresse = location.hash.replace(/^#/, "").split("?")[0] || "/";
  if (adresse === adresseAffichee) return;

  // Modifications non enregistrées : on demande avant de quitter la page
  if (aDesModifications() && adresseAffichee !== null) {
    if (!window.confirm("Des modifications ne sont pas enregistrées. Quitter quand même ?")) {
      history.replaceState(null, "", `#${adresseAffichee}`);
      return;
    }
  }
  marquerModifie(false);
  adresseAffichee = adresse;

  const contenu = document.getElementById("contenu");
  let section = null;
  let page;
  for (const [motif, nom, construire] of ROUTES) {
    const correspondance = adresse.match(motif);
    if (correspondance) {
      section = nom;
      page = construire(correspondance);
      break;
    }
  }
  for (const lien of document.querySelectorAll(".barre__nav a")) {
    if (lien.dataset.section === section) lien.setAttribute("aria-current", "page");
    else lien.removeAttribute("aria-current");
  }

  contenu.replaceChildren(h("p", { class: "chargement" }, "Chargement…"));
  try {
    const vue = page ? await page : h("div", {}, h("h1", {}, "Page introuvable"), h("p", {}, h("a", { href: "#/" }, "Retour au tableau de bord")));
    if (adresseAffichee !== adresse) return; // une autre page a été demandée entre-temps
    contenu.replaceChildren(vue);
    const titre = contenu.querySelector("h1");
    document.title = `${titre ? titre.textContent : "Admin"} · Dune Lab`;
    window.scrollTo(0, 0);
    contenu.focus({ preventScroll: true });
  } catch (erreur) {
    contenu.replaceChildren(
      h("div", { class: "alerte alerte--danger" }, h("p", {}, erreur.message), h("p", {}, h("a", { href: "#/" }, "Retour au tableau de bord")))
    );
  }
}

definirRafraichissement(() => {
  adresseAffichee = null;
  afficher();
});
window.addEventListener("hashchange", afficher);
afficher();
