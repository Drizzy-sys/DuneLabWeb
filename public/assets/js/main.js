/* ==========================================================================
   Dune Lab — scripts du site (JavaScript natif, sans dépendance)
   Les textes affichés par ce script sont lus dans le HTML (attributs data-*),
   ce qui permet de garder une seule version du script pour FR et EN.
   ========================================================================== */

(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(selector, scope) { return (scope || doc).querySelector(selector); }
  function $$(selector, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(selector)); }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- En-tête : filet sous l'en-tête dès que la page défile ---------- */

  function initHeader() {
    var header = $("[data-header]");
    if (!header) return;
    var ticking = false;

    function update() {
      header.classList.toggle("is-scrolled", window.scrollY > 4);
      ticking = false;
    }

    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }

  /* ---------- Menu mobile ---------- */

  function initNav() {
    var toggle = $("[data-nav-toggle]");
    var nav = $("[data-nav]");
    if (!toggle || !nav) return;

    var desktop = window.matchMedia("(min-width: 60rem)");
    var background = [$("main"), $(".site-footer")].filter(Boolean);

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
      root.classList.toggle("menu-open", open);
      // Le reste de la page devient inactif tant que le menu est ouvert
      background.forEach(function (el) { el.inert = open; });
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a") && !desktop.matches) setOpen(false);
    });

    doc.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    desktop.addEventListener("change", function (event) {
      if (event.matches) setOpen(false);
    });
  }

  /* ---------- Lien actif dans la navigation selon la section visible ---------- */

  function initActiveLink() {
    if (!("IntersectionObserver" in window)) return;
    var links = $$('.site-nav__list a[href^="#"]');
    if (!links.length) return;

    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove("is-active"); });
        var link = byId[entry.target.id];
        if (link) link.classList.add("is-active");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });

    $$("main section[id]").forEach(function (section) { observer.observe(section); });
  }

  /* ---------- Réalisations (données : assets/js/projects.js) ---------- */

  var ICON_EXTERNAL = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 11 11 5M6.5 5H11v4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var DUNE_LINE = '<svg viewBox="0 0 96 16" aria-hidden="true" focusable="false"><path d="M2 13H38C50 13 61 4 70 4C76 4 81 8 94 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function initProjects() {
    var grid = $("[data-projects]");
    var projects = window.DUNE_LAB_PROJECTS;
    if (!grid || !Array.isArray(projects)) return;

    var lang = (root.lang || "fr").slice(0, 2) === "en" ? "en" : "fr";
    var labels = grid.dataset;
    var base = labels.root || "";

    function local(value) {
      if (value && typeof value === "object") return value[lang] || value.fr || "";
      return value || "";
    }

    function externalLink(href, text, name, className) {
      return '<a class="' + className + '" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
        escapeHtml(text) + '<span class="visually-hidden"> ' + escapeHtml(name) + " " + escapeHtml(labels.labelNewTab) + "</span>" +
        ICON_EXTERNAL + "</a>";
    }

    function storeButton(href, store, name) {
      if (href) return externalLink(href, store, name, "btn btn--secondary btn--small");
      return '<span class="btn btn--secondary btn--small is-disabled" title="' + escapeHtml(labels.labelSoon) + '">' +
        escapeHtml(store) + '<span class="visually-hidden"> (' + escapeHtml(labels.labelSoon) + ")</span></span>";
    }

    grid.innerHTML = projects.map(function (p) {
      var name = p.name || "";
      var altTemplate = p.kind === "app" ? labels.labelAltApp : labels.labelAltSite;
      var media = p.image
        ? '<img src="' + escapeHtml(base + p.image) + '" width="' + (p.width || 1200) + '" height="' + (p.height || 750) +
          '" loading="lazy" decoding="async" alt="' + escapeHtml((altTemplate || "{name}").replace("{name}", name)) + '">'
        : '<div class="project__placeholder" aria-hidden="true"><span>' + escapeHtml(name) + "</span>" + DUNE_LINE + "</div>";

      var links = "";
      if (p.url) links += externalLink(p.url, labels.labelVisit, name, "link-arrow project__link");
      if (p.stores) {
        links += storeButton(p.stores.appStore, "App Store", name);
        links += storeButton(p.stores.googlePlay, "Google Play", name);
      }

      // Carte entièrement cliquable s'il n'y a qu'un lien vers un site
      var linked = p.url && !p.stores;

      return '<article class="project' + (linked ? " project--link" : "") + '">' +
        '<div class="project__media">' + media + "</div>" +
        '<div class="project__body">' +
          '<p class="project__type">' + escapeHtml(local(p.type)) + "</p>" +
          '<h3 class="project__title">' + escapeHtml(name) + "</h3>" +
          '<p class="project__desc">' + escapeHtml(local(p.description)) + "</p>" +
          (links ? '<div class="project__links">' + links + "</div>" : "") +
        "</div></article>";
    }).join("");
  }

  /* ---------- Apparition discrète au défilement ---------- */

  function initReveal() {
    if (reduceMotion || !("IntersectionObserver" in window)) return;

    // Les enfants d'un groupe apparaissent légèrement décalés les uns des autres
    $$("[data-reveal-group]").forEach(function (group) {
      Array.prototype.forEach.call(group.children, function (child, index) {
        child.setAttribute("data-reveal", "");
        child.style.transitionDelay = Math.min(index, 4) * 80 + "ms";
      });
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6% 0px" });

    var viewport = window.innerHeight;
    $$("[data-reveal]").forEach(function (el) {
      // Les éléments déjà visibles au chargement ne sont pas animés
      if (el.getBoundingClientRect().top < viewport) return;
      el.classList.add("reveal");
      observer.observe(el);
    });
  }

  /* ---------- Protection anti-robot : Cloudflare Turnstile ---------- */

  // Clé publique (« site key ») du widget : tableau de bord Cloudflare > Turnstile. À COMPLÉTER.
  var TURNSTILE_SITEKEY = "A-COMPLETER";
  // Clé de test fournie par Cloudflare (toujours valide), utilisée automatiquement en local
  var TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";
  var TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=duneLabTurnstileReady";

  // Le widget n'est chargé qu'à l'approche du formulaire : tant que le visiteur
  // ne descend pas jusqu'au contact, rien n'est demandé à Cloudflare.
  function initTurnstile(form, onChange) {
    var box = $("[data-turnstile]", form);
    if (!box) return null;

    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    var widgetId = null;
    var requested = false;

    window.duneLabTurnstileReady = function () {
      widgetId = window.turnstile.render(box, {
        sitekey: local ? TURNSTILE_TEST_SITEKEY : TURNSTILE_SITEKEY,
        language: (root.lang || "fr").slice(0, 2),
        theme: "light",
        // Le format « flexible » demande 300 px de large : format compact sur très petit écran
        size: box.clientWidth < 300 ? "compact" : "flexible",
        callback: function () { onChange(true); },
        "expired-callback": function () { onChange(false); },
        "error-callback": function () { onChange(false); }
      });
    };

    function load() {
      if (requested) return;
      requested = true;
      var script = doc.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      doc.head.appendChild(script);
    }

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (entry) { return entry.isIntersecting; })) {
          observer.disconnect();
          load();
        }
      }, { rootMargin: "600px 0px" });
      observer.observe(form);
    } else {
      load();
    }
    form.addEventListener("focusin", load);

    return {
      load: load,
      token: function () {
        return widgetId !== null && window.turnstile ? window.turnstile.getResponse(widgetId) || "" : "";
      },
      // Un jeton ne sert qu'une fois : nouveau jeton après chaque envoi
      reset: function () {
        if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
      }
    };
  }

  /* ---------- Formulaire de demande de devis ---------- */

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE_RE = /^[0-9+().\s-]{6,25}$/;

  // Chaque règle renvoie "" si le champ est valide, sinon le type d'erreur
  var RULES = {
    name: function (v) { return v.length >= 2 ? "" : "required"; },
    email: function (v) { return !v ? "required" : EMAIL_RE.test(v) ? "" : "invalid"; },
    phone: function (v) { return !v || PHONE_RE.test(v) ? "" : "invalid"; },
    project_type: function (v) { return v ? "" : "required"; },
    message: function (v) { return !v ? "required" : v.length < 10 ? "short" : ""; },
    consent: function (v) { return v ? "" : "required"; }
  };

  function initContactForm() {
    var form = $("[data-contact-form]");
    if (!form) return;

    var status = $("[data-form-status]", form);
    var submit = $('[type="submit"]', form);
    var messages = form.dataset;

    function getValue(name) {
      var control = form.elements[name];
      if (!control) return "";
      if (control.type === "checkbox") return control.checked ? "1" : "";
      return (control.value || "").trim();
    }

    function getBox(name) { return $('[data-field="' + name + '"]', form); }

    function getControls(name) {
      var control = form.elements[name];
      if (!control) return [];
      return control.length && !control.tagName ? Array.prototype.slice.call(control) : [control];
    }

    // Affiche (ou efface) l'erreur d'un champ. text : message direct (renvoyé par le serveur)
    function setError(name, code, text) {
      var box = getBox(name);
      if (!box) return;
      var error = $(".field__error", box);
      var key = code ? "error" + code.charAt(0).toUpperCase() + code.slice(1) : "";
      var message = text || (code ? box.dataset[key] || box.dataset.errorRequired : "");

      error.textContent = message;
      error.hidden = !message;
      getControls(name).forEach(function (control) {
        if (message) control.setAttribute("aria-invalid", "true");
        else control.removeAttribute("aria-invalid");
      });
      if (box.tagName === "FIELDSET") {
        if (message) box.setAttribute("aria-invalid", "true");
        else box.removeAttribute("aria-invalid");
      }
    }

    function validate(name) {
      var code = RULES[name](getValue(name));
      setError(name, code);
      return !code;
    }

    function focusField(name) {
      var controls = getControls(name);
      if (controls[0]) controls[0].focus();
    }

    function setStatus(type, text) {
      status.className = "form__status" + (type ? " is-" + type : "");
      status.textContent = text || "";
    }

    function setBusy(busy) {
      submit.disabled = busy;
      form.setAttribute("aria-busy", String(busy));
    }

    var captcha = initTurnstile(form, function (passed) {
      if (passed) setError("turnstile", "");
    });

    // Validation au fil de la saisie : à la sortie d'un champ modifié,
    // puis en direct pour faire disparaître une erreur dès qu'elle est corrigée
    Object.keys(RULES).forEach(function (name) {
      getControls(name).forEach(function (control) {
        control.addEventListener("change", function () { validate(name); });
        control.addEventListener("blur", function () {
          var choice = control.type === "radio" || control.type === "checkbox";
          if (!choice && control.value.trim() !== "") validate(name);
        });
        control.addEventListener("input", function () {
          if (control.getAttribute("aria-invalid") === "true") validate(name);
        });
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var invalid = Object.keys(RULES).filter(function (name) { return !validate(name); });
      if (invalid.length) {
        setStatus("error", messages.msgInvalid);
        focusField(invalid[0]);
        return;
      }

      // Vérification anti-robot pas encore terminée
      if (captcha && !captcha.token()) {
        captcha.load();
        setError("turnstile", "required");
        setStatus("error", getBox("turnstile").dataset.errorRequired);
        return;
      }

      setBusy(true);
      setStatus("pending", messages.msgSending);

      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      })
        .then(function (response) {
          return response.json()
            .catch(function () { return {}; })
            .then(function (data) { return { ok: response.ok, data: data }; });
        })
        .then(function (result) {
          var data = result.data || {};
          if (result.ok && data.ok) {
            form.reset();
            setStatus("success", data.message || messages.msgSuccess);
            return;
          }
          if (data.errors && typeof data.errors === "object") {
            var names = Object.keys(data.errors);
            names.forEach(function (name) { setError(name, "invalid", data.errors[name]); });
            if (names[0]) focusField(names[0]);
          }
          setStatus("error", data.message || messages.msgError);
        })
        .catch(function () {
          setStatus("error", messages.msgError);
        })
        .then(function () {
          setBusy(false);
          if (captcha) captcha.reset();
          status.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
        });
    });
  }

  /* ---------- Année du copyright ---------- */

  function initYear() {
    var year = String(new Date().getFullYear());
    $$("[data-year]").forEach(function (el) { el.textContent = year; });
  }

  initHeader();
  initNav();
  initActiveLink();
  initProjects();
  initReveal();
  initContactForm();
  initYear();
})();
