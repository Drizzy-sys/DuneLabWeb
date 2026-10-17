-- Empreinte SHA-256 de data/grille.json pour les versions importées depuis ce
-- fichier : l'admin repère ainsi un fichier modifié depuis le dernier import
-- et propose de l'importer (src/admin/grille.js).
ALTER TABLE grilles ADD COLUMN empreinte_fichier TEXT;
