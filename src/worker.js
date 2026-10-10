/* ==========================================================================
   Dune Lab — Worker Cloudflare
   --------------------------------------------------------------------------
   - Sert le site statique (dossier public/).
   - Traite le formulaire de demande de devis : POST /api/contact
       1. vérifie les champs et le champ piège anti-spam ;
       2. vérifie le jeton Cloudflare Turnstile ;
       3. envoie la demande par email (API Resend).
     Réponse JSON : { ok: true, message } ou { ok: false, message, errors }.

   Réglages : adresses email dans wrangler.jsonc (section « vars »),
   secrets TURNSTILE_SECRET_KEY et RESEND_API_KEY (voir README).
   ========================================================================== */

const TEXTS = {
  fr: {
    success: "Merci, votre demande a bien été envoyée. Je vous réponds sous 48 heures ouvrées.",
    invalid: "Certains champs sont à corriger : merci de vérifier le formulaire.",
    method: "Méthode non autorisée.",
    captcha: "La vérification anti-robot a échoué. Patientez quelques secondes, puis réessayez.",
    name: "Indiquez votre nom.",
    email: "Cette adresse email ne semble pas valide.",
    phone: "Ce numéro de téléphone ne semble pas valide.",
    type: "Choisissez un type de projet.",
    message: "Décrivez votre projet en quelques lignes.",
    consent: "Votre accord est nécessaire pour que je puisse traiter votre demande.",
  },
  en: {
    success: "Thank you, your request has been sent. I’ll get back to you within two working days.",
    invalid: "Some fields need your attention: please check the form.",
    method: "Method not allowed.",
    captcha: "The anti-bot check failed. Please wait a few seconds and try again.",
    name: "Please enter your name.",
    email: "This email address doesn’t look valid.",
    phone: "This phone number doesn’t look valid.",
    type: "Please choose a project type.",
    message: "Please describe your project in a few lines.",
    consent: "I need your consent to process your request.",
  },
};

// Libellés des types de projet, tels qu'ils apparaissent dans l'email reçu
const PROJECT_TYPES = {
  site: "Site ou boutique en ligne",
  app: "Application mobile",
  tool: "Outil sur mesure",
  other: "Autre projet",
};

// Plus strict que la version du navigateur : l'adresse est réutilisée dans l'en-tête Reply-To
const EMAIL_RE = /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]{2,}$/;
const PHONE_RE = /^[0-9+().\s-]{6,25}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact") return handleContact(request, env);
    return env.ASSETS.fetch(request);
  },
};

function json(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

// Lit un champ texte : supprime les caractères de contrôle et limite la longueur
function field(form, name, maxLength, multiline = false) {
  const value = form.get(name);
  if (typeof value !== "string") return "";
  let text = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!multiline) text = text.replace(/\s+/g, " ");
  return text.trim().slice(0, maxLength);
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function verifyTurnstile(token, ip, secret) {
  if (!token || !secret) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const outcome = await response.json();
    return outcome.success === true;
  } catch {
    return false;
  }
}

async function handleContact(request, env) {
  if (request.method !== "POST") {
    return json(405, { ok: false, message: TEXTS.fr.method }, { Allow: "POST" });
  }
  if (!sameOrigin(request)) {
    return json(403, { ok: false });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { ok: false });
  }

  const lang = form.get("lang") === "en" ? "en" : "fr";
  const t = TEXTS[lang];

  // Champ piège rempli : c'est un robot. On simule un succès sans rien envoyer.
  if (field(form, "website", 200) !== "") {
    return json(200, { ok: true, message: t.success });
  }

  const name = field(form, "name", 100);
  const email = field(form, "email", 254);
  const phone = field(form, "phone", 25);
  const company = field(form, "company", 120);
  const type = field(form, "project_type", 20);
  const message = field(form, "message", 5000, true);
  const consent = form.get("consent") === "1";

  const errors = {};
  if (name.length < 2) errors.name = t.name;
  if (!EMAIL_RE.test(email)) errors.email = t.email;
  if (phone && !PHONE_RE.test(phone)) errors.phone = t.phone;
  if (!Object.hasOwn(PROJECT_TYPES, type)) errors.project_type = t.type;
  if (message.length < 10) errors.message = t.message;
  if (!consent) errors.consent = t.consent;

  if (Object.keys(errors).length) {
    return json(422, { ok: false, message: t.invalid, errors });
  }

  const human = await verifyTurnstile(
    field(form, "cf-turnstile-response", 2048),
    request.headers.get("CF-Connecting-IP"),
    env.TURNSTILE_SECRET_KEY
  );
  if (!human) {
    return json(403, { ok: false, message: t.captcha, errors: { turnstile: t.captcha } });
  }

  const typeLabel = PROJECT_TYPES[type];
  const date = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date());

  const text = [
    `Nouvelle demande de devis reçue depuis le site (version ${lang.toUpperCase()}).`,
    "",
    `Nom : ${name}`,
    `Email : ${email}`,
    `Téléphone : ${phone || "–"}`,
    `Entreprise : ${company || "–"}`,
    `Type de projet : ${typeLabel}`,
    "",
    "Message :",
    message,
    "",
    "—",
    `Envoyée le ${date} (heure de Paris).`,
    "La personne a accepté la politique de confidentialité.",
    "Pour lui répondre, utilisez simplement « Répondre ».",
  ].join("\n");

  try {
    await sendEmail(env, {
      from: `Site Dune Lab <${env.MAIL_FROM}>`,
      to: [env.MAIL_TO],
      // « Répondre » écrit directement à la personne qui a rempli le formulaire
      reply_to: `"${name.replace(/["<>\\]/g, "")}" <${email}>`,
      subject: `Demande de devis – ${typeLabel} – ${name}`,
      text,
    });
  } catch (error) {
    console.error("Envoi du formulaire impossible :", error.message);
    // Sans message : la page affiche le sien, avec l'adresse email de contact
    return json(500, { ok: false });
  }

  return json(200, { ok: true, message: t.success });
}

// Envoi par l'API Resend : https://resend.com/docs/api-reference/emails/send-email
// En local, EMAIL_DRY_RUN=1 (fichier .dev.vars) affiche l'email dans le terminal sans l'envoyer.
async function sendEmail(env, email) {
  if (env.EMAIL_DRY_RUN === "1") {
    console.log(
      `[simulation, rien n'est envoyé]\nFrom: ${email.from}\nTo: ${email.to.join(", ")}\n` +
      `Reply-To: ${email.reply_to}\nSubject: ${email.subject}\n\n${email.text}`
    );
    return;
  }
  if (!env.RESEND_API_KEY) throw new Error("secret RESEND_API_KEY manquant");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(email),
  });
  if (!response.ok) {
    throw new Error(`Resend a répondu ${response.status} : ${await response.text()}`);
  }
}
