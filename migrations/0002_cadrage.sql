-- Cadrage du projet, rattaché au devis : types de projet choisis et réponses
-- aux questions à poser au client (voir src/admin/validation.js, cadrage).
-- Interne, jamais imprimé sur le PDF, modifiable même après l'envoi.
ALTER TABLE devis ADD COLUMN cadrage TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cadrage));
