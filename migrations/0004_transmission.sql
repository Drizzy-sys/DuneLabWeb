-- Facturation électronique : résultat de la transmission à la plateforme agréée
-- { connecteur, statut, reference, message, le } (voir src/admin/connecteurs/).
-- Hors du contenu de la facture : le trigger des factures émises le laisse modifiable.
ALTER TABLE factures ADD COLUMN transmission TEXT CHECK (transmission IS NULL OR json_valid(transmission));
