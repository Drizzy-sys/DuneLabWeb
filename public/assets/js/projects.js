/* ==========================================================================
   Dune Lab — liste des réalisations
   --------------------------------------------------------------------------
   Ce fichier alimente la section « Réalisations » des versions FR et EN.

   Ajouter un projet : copier un bloc { … }, le coller dans la liste et
   adapter les champs. L'ordre de la liste est l'ordre d'affichage.
   Si le nombre de projets est impair, le premier s'affiche en grand.

   Champs :
   - name        : nom du projet
   - kind        : "site" ou "app" (sert au texte alternatif de l'image)
   - type        : type de projet affiché au-dessus du nom, en FR et en EN
   - description : une ligne de description, en FR et en EN
   - url         : adresse du site en ligne (ou "" s'il n'y en a pas)
   - stores      : pour une application, liens App Store et Google Play
                   ("" tant que le lien n'existe pas : le bouton s'affiche
                   alors grisé avec la mention « bientôt disponible »)
   - image       : capture d'écran depuis la racine du site, ou "" pour un
                   visuel provisoire. Format conseillé : WebP 1200 × 750 px
                   (ratio 16:10), à placer dans assets/img/projects/
   ========================================================================== */

window.DUNE_LAB_PROJECTS = [
  {
    name: "Pearl MDA Concept",
    kind: "site",
    type: { fr: "Site vitrine", en: "Business website" },
    description: {
      fr: "Site en trois langues pour une entreprise de home staging, de rénovation et de décoration, du Bassin d’Arcachon à Lisbonne.",
      en: "Three-language website for a home staging, renovation and interior design company working from the Arcachon Bay to Lisbon."
    },
    url: "https://pearlmdaconcept.com",
    image: "assets/img/projects/pearl-mda-concept.webp"
  },
  {
    name: "Alice Pellerin Studio",
    kind: "site",
    type: { fr: "Portfolio et boutique en ligne", en: "Portfolio and online shop" },
    description: {
      fr: "Portfolio et boutique de tirages d’art d’une photographe documentaire franco-portugaise, directrice créative et photojournaliste.",
      en: "Portfolio and fine-art print shop for a French-Portuguese documentary photographer, creative director and photojournalist."
    },
    url: "https://alicepellerinstudio.com",
    image: "assets/img/projects/alice-pellerin-studio.webp"
  },
  {
    name: "Kahwa Café",
    kind: "site",
    type: { fr: "Site vitrine", en: "Business website" },
    description: {
      fr: "Site d’un café de spécialité indépendant (et de ses cookies), avec deux adresses entre Hossegor et Seignosse.",
      en: "Website for an independent specialty coffee shop (and its cookies), with two locations between Hossegor and Seignosse."
    },
    url: "https://kahwacafe.fr",
    image: "assets/img/projects/kahwa-cafe.webp"
  },
  {
    name: "Sulnour Algarve",
    kind: "site",
    type: { fr: "Site vitrine", en: "Business website" },
    description: {
      fr: "Site d’une société de formation comportementale qui accompagne les dirigeants de PME en Algarve, au Portugal.",
      en: "Website for a behavioural training company that helps SME leaders in the Algarve, Portugal."
    },
    url: "https://www.sulnouralgarve.com",
    image: "assets/img/projects/sul-nour-algarve.webp"
  },
  {
    name: "ParaLens Gallery",
    kind: "app",
    type: { fr: "Application mobile", en: "Mobile app" },
    description: {
      fr: "La photographie présentée comme une exposition : une application de galerie pour iOS et Android, avec expositions, portfolios d’artistes et découverte par thèmes.",
      en: "Photography presented like an exhibition: a gallery app for iOS and Android with curated shows, artist portfolios and discovery by theme."
    },
    url: "",
    stores: {
      appStore: "https://apps.apple.com/app/paralens-gallery/id6767079638",
      googlePlay: "https://play.google.com/store/apps/details?id=com.lafanch.paralens"
    },
    image: "assets/img/projects/paralens-gallery.webp"
  }
];
