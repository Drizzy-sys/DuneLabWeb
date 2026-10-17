/* Libellés affichés (écran, PDF, export CSV) */

export const STATUTS_DEVIS = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  accepte: "Accepté",
  refuse: "Refusé",
  expire: "Expiré",
};

export const STATUTS_FACTURE = {
  brouillon: "Brouillon",
  emise: "Émise",
  en_retard: "En retard",
  payee: "Payée",
  annulee: "Annulée par avoir",
  // Avoirs
  emis: "Émis",
  rembourse: "Remboursé",
};

export const TYPES_FACTURE = {
  standard: "Facture",
  acompte: "Facture d'acompte",
  intermediaire: "Facture intermédiaire",
  solde: "Facture de solde",
  avoir: "Avoir",
};

export const MODES_DEVIS = {
  forfait: "Forfait (échéancier)",
  regie: "Régie (temps passé)",
  abonnement: "Abonnement",
};

export const TYPES_CLIENT = {
  particulier: "Particulier",
  professionnel: "Professionnel",
};
