-- Factures d'abonnement issues d'un devis : une facture par période (mois ou an),
-- à partir de la livraison (voir src/admin/factures.js, creerFactureAbonnement).
ALTER TABLE factures ADD COLUMN periodicite TEXT CHECK (periodicite IS NULL OR periodicite IN ('mois', 'an'));

-- Le verrou des factures émises couvre aussi cette nouvelle colonne
DROP TRIGGER factures_emises_non_modifiables;

CREATE TRIGGER factures_emises_non_modifiables
BEFORE UPDATE ON factures
WHEN OLD.statut <> 'brouillon' AND (
  NEW.statut = 'brouillon'
  OR NEW.serie IS NOT OLD.serie
  OR NEW.numero IS NOT OLD.numero
  OR NEW.type IS NOT OLD.type
  OR NEW.client_id IS NOT OLD.client_id
  OR NEW.devis_id IS NOT OLD.devis_id
  OR NEW.etape IS NOT OLD.etape
  OR NEW.periodicite IS NOT OLD.periodicite
  OR NEW.facture_origine_id IS NOT OLD.facture_origine_id
  OR NEW.objet IS NOT OLD.objet
  OR NEW.date_emission IS NOT OLD.date_emission
  OR NEW.prestation_debut IS NOT OLD.prestation_debut
  OR NEW.prestation_fin IS NOT OLD.prestation_fin
  OR NEW.date_echeance IS NOT OLD.date_echeance
  OR NEW.lignes IS NOT OLD.lignes
  OR NEW.remise IS NOT OLD.remise
  OR NEW.deductions IS NOT OLD.deductions
  OR NEW.taux_tva IS NOT OLD.taux_tva
  OR NEW.montant_ht IS NOT OLD.montant_ht
  OR NEW.montant_tva IS NOT OLD.montant_tva
  OR NEW.montant_ttc IS NOT OLD.montant_ttc
  OR NEW.contexte IS NOT OLD.contexte
  OR NEW.cree_le IS NOT OLD.cree_le
  OR (OLD.pdf_cle IS NOT NULL AND NEW.pdf_cle IS NOT OLD.pdf_cle)
  OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS NOT OLD.pdf_sha256)
)
BEGIN
  SELECT RAISE(ABORT, 'Facture émise : modification interdite. Corrigez-la par un avoir.');
END;
