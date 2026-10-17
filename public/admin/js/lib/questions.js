/* ==========================================================================
   Questions de cadrage de la grille, éventuellement rangées par thème.
   Dans la grille, une liste de questions mélange :
     - des questions seules : "Combien de pages ?"
     - des thèmes : { "theme": "Forme et identité visuelle", "questions": [...] }
   Partagé entre l'écran (cadrage) et le Worker (synthèse PDF).
   ========================================================================== */

/** [{ theme: null | "Forme…", questions: [...] }], dans l'ordre de la grille */
export function themesDeQuestions(liste = []) {
  const themes = [];
  let sansTheme = null;
  for (const element of liste) {
    if (typeof element === "string") {
      if (!sansTheme) {
        sansTheme = { theme: null, questions: [] };
        themes.push(sansTheme);
      }
      sansTheme.questions.push(element);
    } else if (element && typeof element === "object") {
      themes.push({ theme: element.theme, questions: [...(element.questions || [])] });
    }
  }
  return themes;
}

/** Types de projet (catégories principales) des prestations d'un document */
export function typesDesRefs(grille, refs) {
  const types = new Set();
  for (const categorie of grille.categories || []) {
    for (const p of categorie.prestations || []) {
      if (refs.includes(p.id)) types.add(categorie.options_de || categorie.id);
    }
  }
  return types;
}

/**
 * Questions à poser pour un devis : générales, puis celles de chaque type de
 * projet choisi (et de ses options). [{ titre, themes: [{ theme, questions }] }]
 */
export function questionsDuDevis(grille, types) {
  const categories = grille.categories || [];
  const groupes = [{ titre: "Général", themes: themesDeQuestions(grille.questions_generales) }];
  for (const type of types) {
    const principale = categories.find((c) => c.id === type);
    if (!principale) continue;
    const themes = categories.filter((c) => c.id === type || c.options_de === type).flatMap((c) => themesDeQuestions(c.questions));
    if (themes.length) groupes.push({ titre: principale.nom, themes });
  }
  // Une question n'apparaît qu'une fois, à sa première place
  const vues = new Set();
  for (const groupe of groupes) {
    for (const theme of groupe.themes) theme.questions = theme.questions.filter((q) => !vues.has(q) && vues.add(q));
    groupe.themes = groupe.themes.filter((t) => t.questions.length);
  }
  return groupes.filter((g) => g.themes.length);
}

/** Pour le champ d'édition de la grille : une question par ligne, « ## Thème » pour un titre */
export function questionsEnTexte(liste = []) {
  return themesDeQuestions(liste)
    .flatMap((t) => (t.theme ? [`## ${t.theme}`, ...t.questions] : t.questions))
    .join("\n");
}

export function texteEnQuestions(texte) {
  const liste = [];
  let theme = null;
  for (const brute of String(texte).split("\n")) {
    const ligne = brute.trim();
    if (!ligne) continue;
    if (ligne.startsWith("## ")) {
      theme = { theme: ligne.slice(3).trim(), questions: [] };
      liste.push(theme);
    } else if (theme) {
      theme.questions.push(ligne);
    } else {
      liste.push(ligne);
    }
  }
  return liste.filter((e) => typeof e === "string" || e.questions.length);
}
