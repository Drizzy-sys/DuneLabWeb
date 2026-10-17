/* ==========================================================================
   Cadrage du projet : les questions à poser au client, avec ses réponses.
   Questions générales, puis celles de chaque type de projet choisi, rangées
   par thème (pour un site : projet et contenu, forme et identité visuelle).
   Elles se modifient dans la grille. On peut aussi ajouter ses propres
   questions au devis. Tout est enregistré dans le devis (colonne cadrage) :
   jamais sur le PDF du devis, mais repris dans la synthèse du projet.
   ========================================================================== */

import { h } from "../ui.js";
import { questionsDuDevis } from "../lib/questions.js";

let compteurIds = 0;

/**
 * cadrage : { types, questions: [{ question, reponse, theme, perso }] } enregistré ;
 * typesVisibles() : types de projet dont on affiche les questions.
 * Renvoie { element, resume, lire(), rafraichir() }.
 */
export function cadrageProjet(grille, cadrage, typesVisibles, surChangement) {
  // Réponses par question : on garde le texte de la question, pas sa position
  const reponses = new Map((cadrage?.questions || []).map((q) => [q.question, { ...q }]));
  const element = h("div", { class: "cadrage" });
  const resume = h("span", { class: "badge badge--neutre" });

  function majResume() {
    const affichees = [...element.querySelectorAll(".cadrage__question textarea")];
    const repondues = affichees.filter((zone) => zone.value.trim() !== "").length;
    resume.textContent = `${repondues} / ${affichees.length} réponses`;
  }

  function champQuestion(question, rubrique) {
    const entree = reponses.get(question);
    const id = `cadrage-${++compteurIds}`;
    const zone = h("textarea", {
      id,
      rows: 1,
      maxlength: 5000,
      value: entree?.reponse || "",
      onInput: (e) => {
        const actuelle = reponses.get(question) || { question, reponse: "" };
        reponses.set(question, { ...actuelle, reponse: e.target.value, theme: actuelle.theme || rubrique });
        bloc.classList.toggle("cadrage__question--repondue", e.target.value.trim() !== "");
        majResume();
        surChangement();
      },
    });
    const bloc = h(
      "div",
      { class: `cadrage__question${entree?.reponse?.trim() ? " cadrage__question--repondue" : ""}` },
      h("label", { for: id }, question),
      h(
        "div",
        { class: "avec-bouton" },
        zone,
        entree?.perso
          ? h(
              "button",
              {
                type: "button",
                class: "bouton-icone bouton-icone--danger",
                title: "Retirer la question",
                "aria-label": `Retirer la question « ${question} »`,
                onClick: () => {
                  reponses.delete(question);
                  dessiner();
                  surChangement();
                },
              },
              "✕"
            )
          : null
      )
    );
    return bloc;
  }

  function formulaireAjout() {
    const saisie = h("input", { type: "text", maxlength: 500, placeholder: "Une question propre à ce projet…", "aria-label": "Nouvelle question" });
    const ajouter = () => {
      const question = saisie.value.trim();
      if (!question) return;
      if (!reponses.has(question)) reponses.set(question, { question, reponse: "", perso: true, theme: "Questions ajoutées" });
      dessiner();
      surChangement();
      [...element.querySelectorAll("label")].find((l) => l.textContent === question)?.control?.focus();
    };
    saisie.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ajouter();
      }
    });
    return h("div", { class: "avec-bouton cadrage__ajout" }, saisie, h("button", { type: "button", class: "bouton", onClick: ajouter }, "+ Question"));
  }

  function dessiner() {
    const groupes = questionsDuDevis(grille, typesVisibles());
    const affichees = new Set(groupes.flatMap((g) => g.themes.flatMap((t) => t.questions)));
    // Questions ajoutées au devis, ou d'un type retiré, ou retirées de la grille depuis
    const autres = [...reponses.keys()].filter((q) => !affichees.has(q));
    element.replaceChildren(
      ...groupes.map((groupe) =>
        h(
          "div",
          { class: "cadrage__groupe" },
          h("h3", {}, groupe.titre),
          groupe.themes.map((theme) => {
            const rubrique = theme.theme ? `${groupe.titre} · ${theme.theme}` : groupe.titre;
            return [theme.theme ? h("h4", { class: "cadrage__theme" }, theme.theme) : null, theme.questions.map((q) => champQuestion(q, rubrique))];
          })
        )
      ),
      h("div", { class: "cadrage__groupe" }, h("h3", {}, "Questions ajoutées"), autres.map((q) => champQuestion(q, reponses.get(q)?.theme || "Questions ajoutées")), formulaireAjout())
    );
    majResume();
  }

  /** À enregistrer : types choisis, questions répondues et questions ajoutées à la main */
  function lire() {
    return {
      types: typesVisibles(),
      questions: [...reponses.values()]
        .filter((q) => q.perso || q.reponse.trim() !== "")
        .map((q) => ({ question: q.question, reponse: q.reponse, ...(q.theme ? { theme: q.theme } : {}), ...(q.perso ? { perso: true } : {}) })),
    };
  }

  dessiner();
  return { element, resume, lire, rafraichir: dessiner };
}
