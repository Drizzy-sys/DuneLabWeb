/* Aucun connecteur : les factures ne sont pas transmises (avant septembre 2027,
   ou en attendant le branchement d'une plateforme agréée). Sert de modèle. */

export default {
  nom: "aucun",
  libelle: "Aucune plateforme branchée",
  // Jamais appelé : l'émission ne transmet rien quand ce connecteur est choisi
  async transmettre() {
    return { statut: "non_transmise" };
  },
};
