-- ==========================================================================
-- Espace admin Dune Lab : clients, grille tarifaire, devis, factures, avoirs
-- --------------------------------------------------------------------------
-- Conventions :
--   - montants en centimes d'euro (entiers) : 180000 = 1 800,00 € ;
--   - taux et pourcentages en points de base : 2000 = 20 %, 3000 = 30 % ;
--   - dates au format AAAA-MM-JJ (jour calendaire à Paris) ;
--   - lignes, remise, deductions : JSON décrit dans public/admin/js/lib/calcul.js ;
--   - contexte : JSON décrit dans src/admin/grille.js (construireContexte).
-- Appliquer : npm run db:local (développement) ou npm run db:distant (production).
-- ==========================================================================

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('particulier', 'professionnel')),
  nom TEXT NOT NULL,
  siren TEXT NOT NULL DEFAULT '',
  adresse TEXT NOT NULL DEFAULT '',
  code_postal TEXT NOT NULL DEFAULT '',
  ville TEXT NOT NULL DEFAULT '',
  pays TEXT NOT NULL DEFAULT 'France',
  email TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  modifie_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Chaque enregistrement de la page « Grille tarifaire » crée une nouvelle version.
-- La version la plus récente fait foi ; data/grille.json sert de version initiale.
CREATE TABLE grilles (
  id INTEGER PRIMARY KEY,
  contenu TEXT NOT NULL CHECK (json_valid(contenu)),
  cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Dernier numéro attribué par série (D = devis, F = factures, A = avoirs) et par année
CREATE TABLE compteurs (
  serie TEXT NOT NULL CHECK (serie IN ('D', 'F', 'A')),
  annee INTEGER NOT NULL,
  dernier INTEGER NOT NULL CHECK (dernier > 0),
  PRIMARY KEY (serie, annee)
);

CREATE TABLE devis (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'envoye', 'accepte', 'refuse')),
  objet TEXT NOT NULL DEFAULT '',
  date_devis TEXT NOT NULL,
  validite_jours INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'forfait' CHECK (mode IN ('forfait', 'regie', 'abonnement')),
  delai_execution TEXT NOT NULL DEFAULT '',
  lignes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lignes)),
  remise TEXT CHECK (remise IS NULL OR json_valid(remise)),
  taux_tva INTEGER NOT NULL DEFAULT 0,
  montant_ht INTEGER NOT NULL DEFAULT 0,
  montant_tva INTEGER NOT NULL DEFAULT 0,
  montant_ttc INTEGER NOT NULL DEFAULT 0,
  -- Émetteur, client, TVA, conditions et mentions : copiés de la grille,
  -- figés quand le devis est envoyé
  contexte TEXT NOT NULL CHECK (json_valid(contexte)),
  date_envoi TEXT,
  date_reponse TEXT,
  pdf_cle TEXT,
  pdf_sha256 TEXT,
  notes TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  modifie_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX devis_client ON devis (client_id);

-- Factures (série F) et avoirs (série A).
-- Un brouillon n'a pas de numéro : il est attribué à l'émission, dans la même
-- transaction que l'incrément du compteur (voir src/admin/numerotation.js).
CREATE TABLE factures (
  id INTEGER PRIMARY KEY,
  serie TEXT NOT NULL CHECK (serie IN ('F', 'A')),
  numero TEXT UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('standard', 'acompte', 'intermediaire', 'solde', 'avoir')),
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'emise', 'payee')),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  devis_id INTEGER REFERENCES devis(id),
  -- Rang de l'étape dans l'échéancier du devis (0 = acompte, …)
  etape INTEGER,
  -- Avoir : facture corrigée
  facture_origine_id INTEGER REFERENCES factures(id),
  objet TEXT NOT NULL DEFAULT '',
  date_emission TEXT,
  prestation_debut TEXT,
  prestation_fin TEXT,
  date_echeance TEXT,
  lignes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lignes)),
  remise TEXT CHECK (remise IS NULL OR json_valid(remise)),
  -- Facture de solde : acomptes déjà facturés, déduits du total
  deductions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(deductions)),
  taux_tva INTEGER NOT NULL DEFAULT 0,
  -- Montant de ce document (après déduction des acomptes pour un solde)
  montant_ht INTEGER NOT NULL DEFAULT 0,
  montant_tva INTEGER NOT NULL DEFAULT 0,
  montant_ttc INTEGER NOT NULL DEFAULT 0,
  contexte TEXT NOT NULL CHECK (json_valid(contexte)),
  pdf_cle TEXT,
  pdf_sha256 TEXT,
  -- Paiement reçu (facture) ou remboursement effectué (avoir)
  date_paiement TEXT,
  montant_paye INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  modifie_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((statut = 'brouillon') = (numero IS NULL)),
  CHECK ((statut = 'brouillon') = (date_emission IS NULL)),
  CHECK ((serie = 'A') = (type = 'avoir')),
  CHECK (type <> 'avoir' OR facture_origine_id IS NOT NULL),
  CHECK ((statut = 'payee') = (date_paiement IS NOT NULL))
);

CREATE INDEX factures_client ON factures (client_id);
CREATE INDEX factures_devis ON factures (devis_id);
CREATE INDEX factures_origine ON factures (facture_origine_id);
CREATE INDEX factures_emission ON factures (serie, date_emission);

-- Une facture ou un avoir émis ne peut plus changer : seuls le paiement
-- (statut émise ↔ payée, date, montant), les notes internes et l'adresse du PDF
-- archivé (renseignée une seule fois) peuvent être mis à jour.
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

CREATE TRIGGER factures_emises_non_supprimables
BEFORE DELETE ON factures
WHEN OLD.statut <> 'brouillon'
BEGIN
  SELECT RAISE(ABORT, 'Facture émise : suppression interdite. Corrigez-la par un avoir.');
END;

-- À l'émission : numéro conforme à la série et à l'année, et ordre chronologique
-- (aucune facture de la même série émise à une date postérieure).
CREATE TRIGGER factures_numerotation_conforme
BEFORE UPDATE OF numero ON factures
WHEN OLD.numero IS NULL AND NEW.numero IS NOT NULL AND (
  NEW.numero NOT LIKE NEW.serie || '-' || substr(NEW.date_emission, 1, 4) || '-%'
  OR EXISTS (
    SELECT 1 FROM factures
    WHERE serie = NEW.serie AND numero IS NOT NULL AND date_emission > NEW.date_emission
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Numérotation non chronologique : émission refusée.');
END;
