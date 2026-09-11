/* =========================================================================
   Ruilhub — UI laag
   ========================================================================= */
(function () {
  "use strict";

  var S = window.Store;
  var PORTAL = "HubConnect";
  var APP = "RuilHub";
  var state = {
    module: null,
    view: "shifts", board: "shifts", filter: "open", q: "",
    beheerTab: "team", teamQ: "",
    statSort: "shiftsOvergenomen",
    logQ: "", logType: "all"
  };
  var authScreen = "landing";
  var regInvite = null; // gevalideerde uitnodigingscode tijdens het registratieflow (stap 1 -> stap 2)

  /* ---------- helpers ---------- */
  function el(id) { return document.getElementById(id); }
  // Wachtwoord tonen/verbergen (oogje) — één globale delegatie voor alle wachtwoordvelden.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".pw-eye") : null;
    if (!btn) return;
    var inp = btn.parentNode.querySelector("input");
    if (!inp) return;
    var show = inp.type === "password";
    inp.type = show ? "text" : "password";
    btn.classList.toggle("on", show);
  });
  // Wachtwoordveld met oogje. extra = losse attributen (bv. ' required').
  function pwInput(name, placeholder, extra) {
    return '<div class="pw-wrap"><input type="password" name="' + name + '"' +
      (placeholder ? ' placeholder="' + placeholder + '"' : "") + (extra || "") + ">" +
      '<button type="button" class="pw-eye" tabindex="-1" aria-label="Toon wachtwoord">' + svg("eye", "icon-sm") + "</button></div>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function initials(u) { return ((u.voornaam[0] || "") + (u.achternaam[0] || "")).toUpperCase(); }
  function fullName(u) { return u ? esc(u.voornaam + " " + u.achternaam) : "Onbekend"; }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-"); if (p.length !== 3) return iso;
    var d = new Date(iso + "T00:00:00");
    var days = ["zo", "ma", "di", "wo", "do", "vr", "za"];
    var mon = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    return days[d.getDay()] + " " + parseInt(p[2], 10) + " " + mon[d.getMonth()] + " " + p[0];
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    return ("0" + d.getDate()).slice(-2) + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + d.getFullYear() +
      " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function fmtClock(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function mondayOf(d) { d = new Date(d); var dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d; }
  function isoWeek(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dn = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dn + 3);
    var first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }

  /* ---------- iconen ---------- */
  var P = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    droplet: '<path d="M12 2.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    thermo: '<path d="M14 14.9V5a2 2 0 1 0-4 0v9.9a4 4 0 1 0 4 0z"/><path d="M12 9.5v5"/>',
    scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M3 12h18"/>',
    van: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    vanFast: '<path d="M8 7h9v9H8z"/><path d="M17 10h2.5l2.5 3v3h-5z"/><circle cx="11.5" cy="18" r="1.6"/><circle cx="19" cy="18" r="1.6"/><path d="M2 9h4M1 12h5M2 15h4"/>',
    devices: '<rect x="2" y="4.5" width="13" height="9.5" rx="1.5"/><path d="M5 18h6M8 14v4"/><rect x="15.5" y="9" width="6.5" height="12" rx="1.5"/><path d="M17.8 18.5h1.9"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    tag: '<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    fridge: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 9h14M8 5v2M8 12v4"/>',
    snow: '<path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1M12 2l-2 2M12 2l2 2M12 22l-2-2M12 22l2-2M2 12l2-2M2 12l2 2M22 12l-2-2M22 12l-2 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5a3.5 3.5 0 0 1 0 7M22 20a6 6 0 0 0-5-5.9"/>',
    userPlus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M22 11h-6"/>',
    userCog: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 11 0"/><circle cx="18.5" cy="16.5" r="2.2"/><path d="M18.5 13.4v1M18.5 18.6v1M21.2 15l-.9.5M16.7 17.5l-.9.5M21.2 18l-.9-.5M16.7 15.5l-.9-.5"/>',
    swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-1"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>',
    chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
    settings: '<path d="M10.68 4.52 L10.23 1.95 L13.77 1.95 L13.32 4.52 L16.36 5.77 L17.85 3.64 L20.36 6.15 L18.23 7.64 L19.48 10.68 L22.05 10.23 L22.05 13.77 L19.48 13.32 L18.23 16.36 L20.36 17.85 L17.85 20.36 L16.36 18.23 L13.32 19.48 L13.77 22.05 L10.23 22.05 L10.68 19.48 L7.64 18.23 L6.15 20.36 L3.64 17.85 L5.77 16.36 L4.52 13.32 L1.95 13.77 L1.95 10.23 L4.52 10.68 L5.77 7.64 L3.64 6.15 L6.15 3.64 L7.64 5.77 Z"/><circle cx="12" cy="12" r="3.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5 21 2M16 7l3 3M14 9l2 2"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M9 14l-1.5 7L12 19l4.5 2L15 14"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    cap: '<path d="M22 9 12 4 2 9l10 5 10-5z"/><path d="M6 11v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
    star: '<path d="m12 3 2.7 5.5 6 .9-4.4 4.2 1 6L12 17l-5.3 2.6 1-6L3.3 9.4l6-.9z"/>',
    lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M4.9 4.9 9.5 9.5M14.5 14.5l4.6 4.6M19.1 4.9 14.5 9.5M9.5 14.5l-4.6 4.6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M5 21h14"/>',
    clipboardList: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h4"/><circle cx="7" cy="11" r=".4"/>',
    layers4: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9.5h16M4 14h16"/>',
    layers5: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 8h16M4 12h16M4 16h16"/>',
    exchange: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
    alertTri: '<path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'
  };
  function svg(name, cls) { return '<svg class="icon ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true">' + P[name] + "</svg>"; }

  /* ---------- Jumbo logo (huisstijl wordmark) ---------- */
  function logo(h) {
    h = h || 36;
    return '<img class="logo-mark" src="img/jumbo-logo.svg?v=30" alt="Jumbo" style="height:' + h + 'px" />';
  }

  /* ---------- footer met copyright-jaar ---------- */
  function copyrightLine() { return "&copy; " + new Date().getFullYear() + " HubConnect &middot; Jumbo Bezorgservice"; }
  function authFoot() { return '<p class="auth-foot">' + copyrightLine() + "</p>"; }

  /* ---------- knop in laad-stand (spinner i.p.v. tekst, tijdens een async actie) ---------- */
  function setBtnLoading(btn, loading) {
    if (!btn) return;
    if (loading) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner spinner-btn"></span>'; btn.disabled = true; }
    else { if (btn.dataset.label) btn.innerHTML = btn.dataset.label; btn.disabled = false; }
  }

  /* ---------- toast ---------- */
  function toast(msg, type) {
    var root = el("toast-root");
    var t = document.createElement("div");
    t.className = "toast " + (type || "");
    t.innerHTML = svg(type === "err" ? "xCircle" : "checkCircle") + "<span>" + esc(msg) + "</span>";
    root.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; t.style.transition = ".3s"; }, 2800);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3150);
  }

  /* ---------- modal ---------- */
  function openModal(opts) {
    var root = el("modal-root");
    var ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' + svg(opts.icon || "info") + "<h3>" + esc(opts.title) + "</h3>" +
          (opts.noClose ? "" : '<button class="close" data-close>' + svg("x", "icon-sm") + "</button>") + "</div>" +
        '<div class="modal-body">' + opts.body + "</div>" +
        (opts.foot ? '<div class="modal-foot">' + opts.foot + "</div>" : "") +
      "</div>";
    root.appendChild(ov);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    if (!opts.noClose) ov.addEventListener("click", function (e) { if (e.target === ov || e.target.closest("[data-close]")) close(); });
    if (opts.onMount) opts.onMount(ov, close);
    return { overlay: ov, close: close };
  }

  var reRender = null; // welke render-functie het huidige scherm opnieuw tekent (ruilhub of los menu-item)
  function act(fn, okMsg) { try { fn(); toast(okMsg, "ok"); (reRender || renderApp)(); } catch (e) { toast(e.message, "err"); } }
  // Async-variant: fn geeft een Promise. Toont toast + hertekent bij succes, foutmelding bij falen.
  function actP(fn, okMsg) {
    Promise.resolve().then(fn).then(function () { if (okMsg) toast(okMsg, "ok"); (reRender || renderApp)(); })
      .catch(function (e) { toast(e && e.message ? e.message : "Er ging iets mis.", "err"); });
  }

  /* ---------- zachte tabblad-overgang ----------
     Laat inhoud die bij een tabwissel verschijnt zacht infaden. We animeren
     alleen wanneer de tab-sleutel verandert (niet bij een re-render na een actie,
     want dan zou de inhoud bij elke klik flikkeren). */
  var _tabKey = null;
  function animateTab(container, key) {
    if (!container) return;
    var changed = key !== _tabKey;
    _tabKey = key;
    container.classList.remove("tab-anim");   // altijd opschonen (voorkomt een blijvende class)
    if (!changed) return;                     // zelfde tab → geen animatie (geen flikker bij acties)
    void container.offsetWidth;               // forceer reflow zodat de animatie opnieuw start
    container.classList.add("tab-anim");
  }

  /* ===================================================================
     LANDING
     =================================================================== */
  // HubConnect-beeldmerk: geel afgerond vierkant met hub-en-spaken (kern + zes nodes).
  // Detail: de kern en elke node hebben een open verbindingspunt waar de gradient
  // doorheen schijnt — leest als knooppunten in een netwerk.
  function hubMark(h) {
    h = h || 40;
    var c = 48, R = 26, nodes = "", lines = "", ports = "";
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (i * 60 - 90);
      var x = Math.round((c + R * Math.cos(a)) * 10) / 10, y = Math.round((c + R * Math.sin(a)) * 10) / 10;
      lines += '<line x1="48" y1="48" x2="' + x + '" y2="' + y + '"/>';
      nodes += '<circle cx="' + x + '" cy="' + y + '" r="6.2"/>';
      ports += '<circle cx="' + x + '" cy="' + y + '" r="2.4"/>';
    }
    return '<svg class="hc-mark" width="' + h + '" height="' + h + '" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="HubConnect">' +
      '<defs><linearGradient id="hcg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="96" y2="96"><stop offset="0" stop-color="#ffd23e"/><stop offset="1" stop-color="#f2b600"/></linearGradient></defs>' +
      '<rect width="96" height="96" rx="24" fill="url(#hcg)"/>' +
      '<g stroke="#1d1d1b" stroke-width="4.4" stroke-linecap="round">' + lines + "</g>" +
      '<g fill="#1d1d1b">' + nodes + '<circle cx="48" cy="48" r="9.6"/></g>' +
      '<g fill="url(#hcg)">' + ports + '<circle cx="48" cy="48" r="4"/></g>' +
      "</svg>";
  }

  /* ---- Licht/donker-thema — keuze staat per gebruiker in het profiel ----
     Landing & login zijn altijd donker (zie render()). Standaard: donker. */
  function userTheme(u) {
    u = u || S.currentUser();
    var t = null; try { t = localStorage.getItem("hc-theme:" + (u && u.id)); } catch (e) {}
    return t === "light" ? "light" : "dark";
  }
  function applyUserTheme(u) { document.documentElement.setAttribute("data-theme", userTheme(u)); }
  function setUserTheme(t) {
    var u = S.currentUser(); if (!u) return;
    try { localStorage.setItem("hc-theme:" + u.id, t); } catch (e) {}
    document.documentElement.setAttribute("data-theme", t);
  }
  function sunIcon() { return '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/></svg>'; }
  function moonIcon() { return '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>'; }
  // themakeuze in het profiel; live toepassen
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-set-theme]") : null;
    if (!t) return;
    e.preventDefault();
    setUserTheme(t.getAttribute("data-set-theme"));
    var seg = t.parentNode;
    if (seg) seg.querySelectorAll("[data-set-theme]").forEach(function (b) { b.classList.toggle("active", b === t); });
  });

  /* ---- Landing-showcase: stylized dark mockups voor het scroll-toneel ---- */
  function mkDash() {
    function card(cls, ring) {
      return '<div class="mk-card mk-' + cls + '">' +
        (ring != null ? '<div class="mk-ring mk-' + cls + '" style="--mp:' + ring + '"><span></span></div>' : '<span class="mk-ico"></span>') +
        '<div class="mk-tx"><b></b><i></i></div></div>';
    }
    return '<div class="mk mk-dash">' +
      '<div class="mk-bar"><span class="mk-jumbo">JUMBO</span><span class="mk-sub">Senior Dashboard</span><span class="mk-live"><i></i>Live</span></div>' +
      '<div class="mk-seg"><span class="on">AM</span><span>PM</span></div>' +
      '<div class="mk-grid">' + card("o", 68) + card("g", 82) + card("b", 45) + card("p", null) + "</div></div>";
  }
  function mkMenu(mobile) {
    var mods = [["exchange", "y"], ["chart", "d"], ["inbox", "o"], ["shield", "g"], ["award", "p"], ["van", "b"]];
    var tiles = mods.map(function (m) { return '<div class="mk-tile mk-' + m[1] + '"><span class="mk-ic">' + svg(m[0], "icon-sm") + "</span><b></b><i></i></div>"; }).join("");
    return '<div class="mk mk-menu' + (mobile ? " mk-mob" : "") + '">' +
      '<div class="mk-bar"><span class="mk-jumbo">JUMBO</span><span class="mk-sub">HubConnect</span><span class="mk-ava"></span></div>' +
      '<div class="mk-hello"><b></b><i></i></div>' +
      '<div class="mk-tiles">' + tiles + "</div></div>";
  }
  function bindLandingShowcase() {
    var stage = document.querySelector(".lp-stage"); if (!stage) return;
    var laptop = stage.querySelector(".lp-laptop"), phone = stage.querySelector(".lp-phone");
    var caps = stage.querySelectorAll(".lp-cap");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function setCap(i, o) { if (caps[i]) caps[i].style.opacity = String(clamp(o, 0, 1)); }
    if (reduce) {
      laptop.style.transform = "translate(-50%,-50%) scale(1)";
      laptop.style.opacity = "1"; phone.style.opacity = "0";
      setCap(0, 1); return;
    }
    function update() {
      var rect = stage.getBoundingClientRect();
      var range = Math.max(1, stage.offsetHeight - window.innerHeight);
      var p = clamp(-rect.top / range, 0, 1);
      var pa = clamp(p / 0.34, 0, 1);          // laptop draait naar voren (geen inzoomen)
      var pc = clamp((p - 0.38) / 0.46, 0, 1); // morpht direct naar de telefoon
      var lscale = lerp(0.85, 1, ease(pa)) * lerp(1, 0.5, ease(pc)); // krimpt richting telefoon-formaat
      // zachte blur tijdens de crossfade zelf (piekt halverwege) — verbergt dat het twee losse
      // vormen zijn die wisselen, zodat het als één doorlopende transformatie oogt.
      var blur = Math.sin(pc * Math.PI) * 5;
      laptop.style.transform = "translate(-50%,-50%) rotateX(" + lerp(24, 0, ease(pa)) + "deg) rotateY(" + lerp(-15, 0, ease(pa)) + "deg) scale(" + lscale + ")";
      laptop.style.opacity = String(1 - ease(pc));
      laptop.style.filter = pc > 0 && pc < 1 ? "blur(" + blur.toFixed(1) + "px)" : "";
      phone.style.opacity = String(ease(pc));
      phone.style.transform = "translate(-50%,-50%) scale(" + lerp(0.55, 1, ease(pc)) + ")";
      phone.style.filter = pc > 0 && pc < 1 ? "blur(" + blur.toFixed(1) + "px)" : "";
      setCap(0, 1 - clamp((p - 0.34) / 0.08, 0, 1));
      setCap(1, clamp((p - 0.46) / 0.08, 0, 1));
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  function renderLanding() {
    var loggedIn = !!S.currentUser();
    var cta = loggedIn ? "Verder naar de hub" : "Inloggen";

    var vals = [
      { icon: "clock", title: "Realtime",           desc: "Wat er in de hub gebeurt, zie je meteen. Geen appjes meer heen en weer." },
      { icon: "devices", title: "Perfect voor mobiel en desktop", desc: "Voor de taken v&oacute;&oacute;r en na de rit — grote knoppen, snelle acties." },
      { icon: "grid",  title: "Alles op &eacute;&eacute;n plek", desc: "Ruilen, plannen, laden en controleren. Alles bij elkaar." }
    ];
    var valCards = vals.map(function (v, i) {
      return '<div class="l3-val reveal" style="--d:' + (i * 90) + 'ms">' +
        '<span class="l3-val-ico">' + svg(v.icon, "icon-lg") + "</span>" +
        "<h3>" + v.title + "</h3><p>" + v.desc + "</p></div>";
    }).join("");
    var chevron = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

    el("app").innerHTML =
      '<div class="l3">' +
        '<header class="l3-nav" id="l3Nav"><div class="l3-nav-in">' +
          hubMark(28) +
          '<span class="l3-nav-name">HubConnect</span>' +
          '<div class="grow"></div>' +
          '<button class="btn btn-dark btn-sm" data-go="login">' + cta + "</button>" +
        "</div></header>" +

        '<section class="l3-hero">' +
          '<div class="l3-glow" aria-hidden="true"></div>' +
          '<div class="l3-mark rise">' + hubMark(104) + "</div>" +
          '<h1 class="rise d1">HubConnect.</h1>' +
          '<p class="l3-tag rise d2">Alles voor je hub. Op &eacute;&eacute;n plek.</p>' +
          '<div class="l3-act rise d3"><button class="btn btn-dark btn-lg" data-go="login">' + svg("arrowRight") + cta + "</button></div>" +
          '<p class="l3-kicker rise d4">Jumbo Bezorgservice</p>' +
          '<div class="l3-scroll" aria-hidden="true">' + chevron + "</div>" +
        "</section>" +

        '<section class="l3-sec l3-intro">' +
          '<div class="l3-sec-in">' +
            '<h2 class="l3-h2 reveal">Je hele shift, in &eacute;&eacute;n app.</h2>' +
            '<p class="l3-sub reveal" style="--d:60ms">Van het Senior Dashboard tot het menu — op je laptop &eacute;n je telefoon. Scroll maar mee.</p>' +
          "</div>" +
        "</section>" +

        '<section class="lp-stage"><div class="lp-sticky">' +
          '<div class="lp-laptop">' +
            '<div class="lp-lid"><div class="lp-screen">' +
              '<div class="lp-scr lp-scr-dash">' + mkDash() + "</div>" +
            "</div></div>" +
            '<div class="lp-base"><span class="lp-notch2"></span></div>' +
          "</div>" +
          '<div class="lp-phone"><span class="lp-island"></span><div class="lp-phone-screen">' + mkMenu(true) + "</div></div>" +
          '<div class="lp-caption">' +
            '<span class="lp-cap" data-cap="0">Je Senior Dashboard — realtime.</span>' +
            '<span class="lp-cap" data-cap="1">Alles vanuit &eacute;&eacute;n menu — ook op je telefoon.</span>' +
          "</div>" +
        "</div></section>" +

        '<section class="l3-sec l3-vals-sec">' +
          '<div class="l3-sec-in">' +
            '<h2 class="l3-h2 reveal">Gemaakt voor de werkvloer.</h2>' +
            '<div class="l3-vals">' + valCards + "</div>" +
          "</div>" +
        "</section>" +

        '<section class="l3-sec l3-cta">' +
          '<div class="l3-sec-in">' +
            '<h2 class="l3-h2 reveal">Klaar voor je shift?</h2>' +
            '<p class="l3-cta-sub reveal" style="--d:60ms">Log in en ga aan de slag.</p>' +
            '<div class="l3-cta-act reveal" style="--d:120ms"><button class="btn btn-dark btn-lg" data-go="login">' + svg("arrowRight") + cta + "</button></div>" +
          "</div>" +
        "</section>" +

        '<footer class="l3-foot">' + copyrightLine() + "</footer>" +
      "</div>";

    document.querySelectorAll("[data-go=login]").forEach(function (b) { b.addEventListener("click", function () {
      if (S.currentUser()) { state.showLanding = false; state.module = null; render(); } // al ingelogd → direct de hub in
      else { authScreen = "login"; render(); }
    }); });
    // entree-animatie + nav-schaduw bij scrollen
    var root = document.querySelector(".l3");
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add("ready"); }); });
    var nav = el("l3Nav");
    var onS = function () { nav.classList.toggle("scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onS, { passive: true }); onS();
    // scroll-reveal van de secties
    var revs = root.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { revs.forEach(function (n) { n.classList.add("in"); }); }
    else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
      revs.forEach(function (n) { io.observe(n); });
    }
    bindLandingShowcase();
  }

  /* ===================================================================
     LOGIN
     =================================================================== */
  // Bovenaan de login/registreer-kaart: segmented control met een pill die
  // meeschuift naar het actieve tabblad.
  var AUTH_STEPS = ["login", "register-code", "register-form"];   // volgorde bepaalt de schuifrichting
  var AUTH_PILL_RIGHT = "translateX(calc(100% + 6px))";           // moet gelijk zijn aan de CSS-regel
  function authTab(screen) { return screen === "login" ? "login" : "register"; }

  function authModeSeg(active) {
    return '<div class="auth-tabs" data-authactive="' + active + '">' +
      '<span class="auth-pill" aria-hidden="true"></span>' +
      '<button type="button" class="' + (active === "login" ? "active" : "") + '" data-authtab="login">Inloggen</button>' +
      '<button type="button" class="' + (active === "register" ? "active" : "") + '" data-authtab="register">Registreren</button>' +
      "</div>";
  }
  function bindAuthModeSeg() {
    document.querySelectorAll("[data-authtab]").forEach(function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-authtab");
        if (m === "login" && authScreen !== "login") { regInvite = null; switchAuthScreen("login"); }
        if (m === "register" && authScreen !== "register-code" && authScreen !== "register-form") { regInvite = null; switchAuthScreen("register-code"); }
      });
    });
  }

  /* Overgang tussen de auth-schermen. De kaart zelf blijft staan (logo, gele kop,
     tabs); alléén de titeltekst en het formulier wisselen. De oude laag wordt als
     "ghost" op zijn plek bewaard en schuift met een zachte blur weg, de nieuwe komt
     uit de andere richting binnen, en de kaart morpht ondertussen naar zijn nieuwe
     hoogte. Richting volgt AUTH_STEPS: vooruit = naar links weg, van rechts binnen. */
  function switchAuthScreen(next) {
    var card = el("app").querySelector(".auth-card");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!card || next === authScreen || reduce) { authScreen = next; render(); return; }

    var dir = AUTH_STEPS.indexOf(next) > AUTH_STEPS.indexOf(authScreen) ? 1 : -1;
    var prevTab = authTab(authScreen);
    var h0 = card.getBoundingClientRect().height;
    // Momentopname van de wisselende lagen, mét hun plek binnen kop/body.
    var snap = [];
    [".auth-title", ".auth-pane"].forEach(function (sel) {
      var n = card.querySelector(sel);
      if (!n) return;
      var pr = n.parentNode.getBoundingClientRect(), r = n.getBoundingClientRect();
      snap.push({ sel: sel, clone: n.cloneNode(true), top: r.top - pr.top, left: r.left - pr.left, w: r.width, h: r.height });
    });

    authScreen = next;
    render();

    var card2 = el("app").querySelector(".auth-card");
    if (!card2) return;
    var h1 = card2.getBoundingClientRect().height;

    // Ghosts in dezelfde ouder hangen, zodat alle (dark-mode-)stijlregels blijven kloppen.
    var ghosts = [];
    snap.forEach(function (s) {
      var host = card2.querySelector(s.sel === ".auth-title" ? ".auth-head" : ".auth-body");
      if (!host) return;
      var g = s.clone;
      g.classList.add("auth-ghost");
      g.setAttribute("aria-hidden", "true");
      g.style.top = s.top + "px"; g.style.left = s.left + "px";
      g.style.width = s.w + "px"; g.style.height = s.h + "px";
      host.appendChild(g); ghosts.push(g);
    });

    card2.style.setProperty("--adir", dir);
    card2.style.height = h0 + "px";
    card2.classList.add("auth-swap");
    void card2.offsetHeight;                       // reflow: startwaarden vastleggen
    card2.style.height = h1 + "px";
    card2.classList.add("auth-swap-in");
    ghosts.forEach(function (g) { g.classList.add("auth-ghost-out"); });

    // De pill start op de oude helft en schuift mee (het element is vers gerenderd).
    var pill = card2.querySelector(".auth-pill");
    if (pill && prevTab !== authTab(next)) {
      pill.style.transition = "none";
      pill.style.transform = prevTab === "register" ? AUTH_PILL_RIGHT : "translateX(0)";
      void pill.offsetWidth;
      pill.style.transition = ""; pill.style.transform = "";
    }

    setTimeout(function () {
      ghosts.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
      card2.style.height = "";
      card2.classList.remove("auth-swap", "auth-swap-in");
      card2.style.removeProperty("--adir");
    }, 480);
  }

  function renderLogin() {
    el("app").innerHTML =
      '<div class="auth-wrap"><div class="auth-col"><div class="auth-card">' +
        '<div class="auth-head">' +
          '<button class="auth-back" data-back>' + svg("arrowLeft", "icon-sm") + " Terug</button>" +
          logo(38) + '<div class="auth-title"><h1>Inloggen</h1><p>Welkom terug bij ' + PORTAL + "</p></div></div>" +
        '<div class="auth-body">' +
          authModeSeg("login") +
          '<div class="auth-pane">' +
          '<form id="loginForm" autocomplete="on">' +
            '<div class="field"><label>E-mailadres of HR-nummer</label>' +
              '<input type="text" name="identifier" autocomplete="username" placeholder="naam@jumbo.com of HR-nummer" required></div>' +
            '<div class="field"><label>Wachtwoord</label>' +
              pwInput("password", "Wachtwoord", " required") + "</div>" +
            '<div id="authMsg"></div>' +
            '<button class="btn btn-primary btn-block" type="submit">' + svg("arrowRight") + "Inloggen</button>" +
          "</form>" +
          "</div>" +
        "</div>" +
      "</div>" + authFoot() + "</div></div>";

    el("app").querySelector("[data-back]").addEventListener("click", function () { authScreen = "landing"; render(); });
    bindAuthModeSeg();
    el("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('button[type="submit"]');
      setBtnLoading(btn, true);
      S.login(f.identifier.value, f.password.value)
        .then(function () { resetNav(); render(); })
        .catch(function (err) { setBtnLoading(btn, false); var m = el("authMsg"); if (m) m.innerHTML = '<div class="alert alert-error">' + esc(err.message) + "</div>"; });
    });
  }

  /* ===================================================================
     REGISTREREN MET UITNODIGINGSCODE
     =================================================================== */
  function renderRegisterCode() {
    el("app").innerHTML =
      '<div class="auth-wrap"><div class="auth-col"><div class="auth-card">' +
        '<div class="auth-head">' +
          '<button class="auth-back" data-back>' + svg("arrowLeft", "icon-sm") + " Terug</button>" +
          logo(38) + '<div class="auth-title"><h1>Account registreren</h1><p>Vraag een uitnodigingscode aan bij je leidinggevende en vul die hier in.</p></div></div>' +
        '<div class="auth-body">' +
          authModeSeg("register") +
          '<div class="auth-pane">' +
          '<form id="codeForm">' +
            '<div class="field"><label>Uitnodigingscode</label>' +
              '<input name="code" placeholder="XXXX-XXXX" required style="text-transform:uppercase;letter-spacing:2px;text-align:center;font-weight:700"></div>' +
            '<div id="codeMsg"></div>' +
            '<button class="btn btn-primary btn-block" type="submit">' + svg("arrowRight") + "Doorgaan</button>" +
          "</form>" +
          "</div>" +
        "</div>" +
      "</div>" + authFoot() + "</div></div>";

    el("app").querySelector("[data-back]").addEventListener("click", function () { switchAuthScreen("login"); });
    bindAuthModeSeg();
    el("codeForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var code = (f.code.value || "").trim().toUpperCase();
      if (!code) { el("codeMsg").innerHTML = '<div class="alert alert-error">Vul een code in.</div>'; return; }
      // De code wordt server-side gevalideerd bij het aanmaken van het account.
      regInvite = { code: code }; switchAuthScreen("register-form");
    });
  }

  function renderRegisterForm() {
    if (!regInvite) { authScreen = "register-code"; render(); return; }
    el("app").innerHTML =
      '<div class="auth-wrap"><div class="auth-col"><div class="auth-card">' +
        '<div class="auth-head">' +
          '<button class="auth-back" data-back>' + svg("arrowLeft", "icon-sm") + " Terug</button>" +
          logo(38) + '<div class="auth-title"><h1>Jouw gegevens</h1><p>Je start als Bezorger</p></div></div>' +
        '<div class="auth-body">' +
          authModeSeg("register") +
          '<div class="auth-pane">' +
          '<form id="regForm" autocomplete="on">' +
            '<div class="row2"><div class="field"><label>Voornaam</label><input name="voornaam" required></div>' +
              '<div class="field"><label>Achternaam</label><input name="achternaam" required></div></div>' +
            '<div class="field"><label>HR-nummer</label><input name="num" inputmode="numeric" placeholder="1234567" required></div>' +
            '<div class="field"><label>E-mailadres</label><input type="email" name="email" placeholder="naam@jumbo.com" required></div>' +
            '<div class="field"><label>Wachtwoord</label>' + pwInput("p1", "Min. 4 tekens", " required") + "</div>" +
            '<div class="field"><label>Herhaal wachtwoord</label>' + pwInput("p2", "", " required") + "</div>" +
            '<div id="regMsg"></div>' +
            '<button class="btn btn-primary btn-block" type="submit">' + svg("check") + "Account aanmaken</button>" +
          "</form>" +
          "</div>" +
        "</div>" +
      "</div>" + authFoot() + "</div></div>";

    el("app").querySelector("[data-back]").addEventListener("click", function () { regInvite = null; switchAuthScreen("register-code"); });
    bindAuthModeSeg();
    el("regForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('button[type="submit"]');
      if (f.p1.value !== f.p2.value) { el("regMsg").innerHTML = '<div class="alert alert-error">De wachtwoorden komen niet overeen.</div>'; return; }
      setBtnLoading(btn, true);
      S.registerWithCode(regInvite.code, { voornaam: f.voornaam.value, achternaam: f.achternaam.value, personeelsnummer: f.num.value, email: f.email.value, wachtwoord: f.p1.value })
        .then(function () { regInvite = null; resetNav(); toast("Welkom! Je account is aangemaakt.", "ok"); render(); })
        .catch(function (err) { setBtnLoading(btn, false); var m = el("regMsg"); if (m) m.innerHTML = '<div class="alert alert-error">' + esc(err.message) + "</div>"; });
    });
  }

  /* ===================================================================
     FORCE PASSWORD (na eenmalige code)
     =================================================================== */
  function renderForcePassword(u) {
    el("app").innerHTML =
      '<div class="auth-wrap"><div class="auth-col"><div class="auth-card">' +
        '<div class="auth-head">' + logo(38) + "<h1>Stel je wachtwoord in</h1><p>Welkom " + esc(u.voornaam) + "! Kies een eigen wachtwoord.</p></div>" +
        '<div class="auth-body">' +
          '<div class="alert alert-info">Je logde in met een eenmalige code. Stel nu een persoonlijk wachtwoord in om verder te gaan.</div>' +
          '<form id="pwForm">' +
            '<div class="field"><label>Nieuw wachtwoord</label>' + pwInput("p1", "Min. 4 tekens", " required") + "</div>" +
            '<div class="field"><label>Herhaal wachtwoord</label>' + pwInput("p2", "", " required") + "</div>" +
            '<div id="pwMsg"></div>' +
            '<button class="btn btn-primary btn-block" type="submit">' + svg("check") + "Opslaan en doorgaan</button>" +
          "</form>" +
        "</div></div>" + authFoot() + "</div></div>";
    el("pwForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('button[type="submit"]');
      if (f.p1.value !== f.p2.value) { el("pwMsg").innerHTML = '<div class="alert alert-error">De wachtwoorden komen niet overeen.</div>'; return; }
      setBtnLoading(btn, true);
      S.setInitialPassword(f.p1.value)
        .then(function () { resetNav(); toast("Wachtwoord ingesteld.", "ok"); render(); })
        .catch(function (err) { setBtnLoading(btn, false); var m = el("pwMsg"); if (m) m.innerHTML = '<div class="alert alert-error">' + esc(err.message) + "</div>"; });
    });
  }

  /* ===================================================================
     APP SHELL
     =================================================================== */
  function navItems(u) {
    var items = [
      { id: "shifts", label: "Ruilbord", icon: "swap" },
      { id: "mine", label: "Mijn ruilverzoeken", icon: "clipboard", count: myNewDecisions(u).length }
    ];
    if (S.can.isApprover(u)) items.push({ id: "approvals", label: "Goedkeuren", icon: "checkCircle", count: S.pendingCount(u) });
    if (S.can.seeStats(u)) items.push({ id: "stats", label: "Statistieken", icon: "chart" });
    if (S.can.seeLog(u)) items.push({ id: "log", label: "Historie", icon: "history" });
    return items;
  }

  function renderApp() {
    reRender = renderApp;
    var u = S.currentUser();
    var hub = S.hubById(u.hubId);
    var items = navItems(u);
    if (!items.some(function (i) { return i.id === state.view; })) state.view = "shifts";

    var nav = items.map(function (i) {
      return '<button class="nav-btn ' + (state.view === i.id ? "active" : "") + '" data-nav="' + i.id + '">' +
        svg(i.icon, "icon-sm") + "<span>" + i.label + "</span>" +
        (i.count ? '<span class="badge-count">' + i.count + "</span>" : "") + "</button>";
    }).join("");

    el("app").innerHTML =
      '<header class="app-header"><div class="app-header-inner">' +
        '<button class="btn btn-icon portal-btn" data-portal title="Naar de Hub">' + svg("grid", "icon-sm") + "</button>" +
        '<div class="brand" data-home role="button" title="Naar de voorpagina"><span class="logo-badge">' + logo(40) + "</span>" +
          '<div><div class="app-name">' + APP + '</div><div class="app-sub">Shifts &amp; taken ruilen</div></div></div>' +
        '<div class="header-spacer"></div>' +
        '<div class="user-chip">' +
          '<div style="text-align:right"><div class="u-name">' + fullName(u) + "</div>" +
            '<div class="u-meta">' + esc(S.roleMeta(u.rol).label) + " · HUB " + esc(hub ? hub.naam : "?") + "</div></div>" +
          '<button class="avatar-btn" data-profile title="Profiel"><span class="avatar">' + initials(u) + "</span>" +
            '<span class="avatar-gear">' + svg("settings", "icon-sm") + "</span></button>" +
          '<button class="btn btn-icon btn-ghost" data-logout title="Uitloggen" style="background:rgba(255,255,255,.5)">' + svg("logout", "icon-sm") + "</button>" +
        "</div>" +
      "</div></header>" +
      '<nav class="app-nav"><div class="app-nav-inner">' + nav + "</div></nav>" +
      '<main id="main"></main>';

    document.querySelectorAll("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () { state.view = b.getAttribute("data-nav"); renderMain(); });
    });
    el("app").querySelector("[data-logout]").addEventListener("click", function () { S.logout().then(function () { resetNav(); authScreen = "landing"; render(); }); });
    el("app").querySelector("[data-profile]").addEventListener("click", openProfile);
    var pb = el("app").querySelector("[data-portal]"); if (pb) pb.addEventListener("click", gotoPortal);
    var hm = el("app").querySelector("[data-home]"); if (hm) hm.addEventListener("click", gotoLanding);
    renderMain();
  }

  function renderMain() {
    document.querySelectorAll("[data-nav]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-nav") === state.view); });
    var m = el("main");
    switch (state.view) {
      case "shifts": m.innerHTML = viewBoard(); bindBoard(); break;
      case "mine": m.innerHTML = viewMine(); bindMine(); markDecisionsSeen(); break;
      case "approvals": m.innerHTML = viewApprovals(); bindApprovals(); break;
      case "stats": m.innerHTML = viewStats(); bindStats(); break;
      case "beheer": m.innerHTML = viewBeheer(); bindBeheer(); break;
      case "log": m.innerHTML = viewLog(); bindLog(); break;
    }
    animateTab(m, "main:" + state.view +
      (state.view === "shifts" ? ":" + state.board : "") +
      (state.view === "beheer" ? ":" + state.beheerTab : ""));
  }

  /* ---------- gedeelde badges ---------- */
  function dagdeelBadge(d) {
    return d === "AM" ? '<span class="badge am">' + svg("sun", "icon-sm") + "AM</span>"
                      : '<span class="badge pm">' + svg("moon", "icon-sm") + "PM</span>";
  }
  function busBadge(t) {
    if (t === "N2") return '<span class="badge n2">' + svg("bolt", "icon-sm") + "N2</span>";
    if (t === "diesel") return '<span class="badge diesel">' + svg("droplet", "icon-sm") + "Diesel</span>";
    return "";
  }
  function reasonBadge(r) { return r ? '<span class="badge reason">' + svg("info", "icon-sm") + esc(r) + "</span>" : ""; }
  function taskBadge(t) {
    if (!t) return "";
    var cls = t === S.TASK_JBT ? "jbt" : (t === S.TASK_BINNENDIENST ? "bd" : "task");
    return '<span class="badge ' + cls + '">' + svg(t === S.TASK_JBT ? "cap" : "tag", "icon-sm") + esc(t) + "</span>";
  }
  function statusBadge(s) {
    var map = { "open": ["st-open", "Open"], "in-afwachting": ["st-afwachting", "In afwachting"], "goedgekeurd": ["st-goedgekeurd", "Goedgekeurd"], "afgekeurd": ["st-afgekeurd", "Afgekeurd"], "ingetrokken": ["st-ingetrokken", "Ingetrokken"] };
    var m = map[s] || ["", s];
    return '<span class="badge ' + m[0] + '">' + esc(m[1]) + "</span>";
  }
  function emptyState(icon, title, sub) { return '<div class="empty">' + svg(icon) + "<h3>" + esc(title) + "</h3><p>" + esc(sub) + "</p></div>"; }
  function panel(icon, title, inner, extra) {
    return '<div class="panel"><div class="panel-head">' + svg(icon) + "<h3>" + esc(title) + "</h3>" + (extra || "") + "</div>" +
      '<div class="panel-body">' + inner + "</div></div>";
  }
  function tableScroll(inner, grid) { return '<div class="table-scroll"><table class="table' + (grid ? " table-grid" : "") + '">' + inner + "</table></div>"; }
  function matchesQ(text) { return !state.q || text.toLowerCase().indexOf(state.q.toLowerCase()) !== -1; }

  /* ===================================================================
     RUILBORD
     =================================================================== */
  // Dag/week-bereik voor het bord.
  function rangeLabel() {
    var d = new Date(state.boardRef + "T00:00:00");
    if (state.boardRange === "dag") {
      var dn = ["zo", "ma", "di", "wo", "do", "vr", "za"][d.getDay()];
      return dn + " " + d.getDate() + "-" + (d.getMonth() + 1) + "-" + d.getFullYear();
    }
    var mon = mondayOf(d), sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return "Week " + isoWeek(mon) + " · " + mon.getDate() + "-" + (mon.getMonth() + 1) + " t/m " + sun.getDate() + "-" + (sun.getMonth() + 1);
  }
  function rangeKeep(datum) {
    if (!datum) return true;
    if (state.boardRange === "dag") return datum === state.boardRef;
    var mon = mondayOf(new Date(state.boardRef + "T00:00:00"));
    var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return datum >= ymd(mon) && datum <= ymd(sun);
  }

  // Meldingen voor de aanbieder: goedgekeurde/afgewezen eigen verzoeken.
  function myDecisions(u) {
    var out = [];
    function add(list, kind) { (list || []).forEach(function (x) {
      if (!x.besluitOp || (x.status !== "goedgekeurd" && x.status !== "afgekeurd")) return;
      // betrokken = aanbieder, huidige overnemer (goedgekeurd) of de overnemer wiens overname is afgekeurd
      var involved = x.aanbiederId === u.id || x.overnemerId === u.id || (x.status === "afgekeurd" && x.lastOvernemerId === u.id);
      if (involved) out.push({ kind: kind, it: x, asOvernemer: x.aanbiederId !== u.id });
    }); }
    add(S.db.shifts, "shift"); add(S.db.taskOffers, "task"); add(S.db.backups, "backup"); add(S.db.callouts, "callout");
    out.sort(function (a, b) { return (b.it.besluitOp || "").localeCompare(a.it.besluitOp || ""); });
    return out;
  }
  function notifSeenKey(u) { return "ruilhub_notifseen_" + u.id; }
  function getNotifSeen(u) { try { return localStorage.getItem(notifSeenKey(u)) || ""; } catch (e) { return ""; } }
  function setNotifSeen(u, ts) { try { localStorage.setItem(notifSeenKey(u), ts); } catch (e) {} }
  function myNewDecisions(u) {
    var grens = new Date(Date.now() - 14 * 864e5).toISOString(); // alleen recente (14 dagen) meldingen
    var seen = getNotifSeen(u);
    return myDecisions(u).filter(function (d) { var t = d.it.besluitOp || ""; return t > seen && t > grens; });
  }
  function markDecisionsSeen() {
    var u = S.currentUser(); if (!u) return;
    var ds = myDecisions(u);
    if (ds.length && ds[0].it.besluitOp > getNotifSeen(u)) { setNotifSeen(u, ds[0].it.besluitOp); document.querySelectorAll('[data-nav="mine"] .badge-count').forEach(function (n) { n.remove(); }); }
  }
  function notifBanner(u) {
    var nd = myNewDecisions(u);
    if (!nd.length) return "";
    var rows = nd.slice(0, 6).map(function (d) {
      var it = d.it, ok = it.status === "goedgekeurd";
      var wat = d.kind === "shift" ? "Je shift" : d.kind === "task" ? "Je taak" : d.kind === "backup" ? "Je back-up" : "Je oproep";
      var wanneer = fmtDate(it.datum) + " · " + it.dagdeel;
      return '<div class="notif-row ' + (ok ? "ok" : "no") + '">' + svg(ok ? "checkCircle" : "x", "icon-sm") +
        "<span>" + wat + " van <b>" + esc(wanneer) + "</b> is " + (ok ? "goedgekeurd" : "afgewezen") +
        (!ok && it.reden ? ' <span class="notif-reden">— ' + esc(it.reden) + "</span>" : "") + "</span></div>";
    }).join("");
    return '<div class="notif-banner"><div class="notif-head">' + svg("info", "icon-sm") + "<b>Nieuw voor jou</b><div class=\"grow\"></div>" +
      '<button class="btn btn-ghost btn-sm" data-notifseen>Gezien</button></div>' + rows + "</div>";
  }

  // Match tussen een oproep (shift gezocht) en een aangeboden shift op dezelfde dag/dagdeel binnen de hub.
  function shiftCalloutMatches(u) {
    var openShifts = S.shiftsForHub(u.hubId).filter(function (s) { return s.status === "open"; });
    var openCallouts = S.calloutsForHub(u.hubId).filter(function (c) { return c.status === "open"; });
    var asSearcher = [], asOfferer = [];
    // Ik zoek (mijn oproep) en er staat een shift die ik kan overnemen.
    openCallouts.filter(function (c) { return c.aanbiederId === u.id; }).forEach(function (c) {
      openShifts.forEach(function (s) {
        if (s.datum === c.datum && s.dagdeel === c.dagdeel && s.aanbiederId !== u.id && S.can.claimShift(u, s)) asSearcher.push({ callout: c, shift: s });
      });
    });
    // Ik bied aan (mijn shift) en iemand zoekt een shift op die dag/dagdeel.
    openShifts.filter(function (s) { return s.aanbiederId === u.id; }).forEach(function (s) {
      openCallouts.forEach(function (c) {
        if (c.datum === s.datum && c.dagdeel === s.dagdeel && c.aanbiederId !== u.id && S.can.claimShift(S.userById(c.aanbiederId), s)) asOfferer.push({ shift: s, callout: c });
      });
    });
    return { asSearcher: asSearcher, asOfferer: asOfferer };
  }
  function matchBanner(u) {
    var m = shiftCalloutMatches(u);
    if (!m.asSearcher.length && !m.asOfferer.length) return "";
    var rows = "";
    m.asSearcher.forEach(function (x) {
      var ab = S.userById(x.shift.aanbiederId);
      rows += '<div class="notif-row ok">' + svg("swap", "icon-sm") + "<span>Er staat een shift op <b>" + esc(fmtDate(x.shift.datum) + " · " + x.shift.dagdeel) + "</b> van " + fullName(ab) + " die je zoekt. </span>" +
        '<button class="btn btn-primary btn-sm" data-matchclaim="' + x.shift.id + "|" + x.callout.id + '">' + svg("check", "icon-sm") + "Overnemen</button></div>";
    });
    m.asOfferer.forEach(function (x) {
      var zoeker = S.userById(x.callout.aanbiederId);
      rows += '<div class="notif-row ok">' + svg("search", "icon-sm") + "<span><b>" + fullName(zoeker) + "</b> zoekt een shift op <b>" + esc(fmtDate(x.shift.datum) + " · " + x.shift.dagdeel) + "</b> — die jij aanbiedt. </span>" +
        '<button class="btn btn-dark btn-sm" data-matchgive="' + x.shift.id + "|" + x.callout.aanbiederId + '">' + svg("swap", "icon-sm") + "Aan " + esc(zoeker.voornaam) + " geven</button></div>";
    });
    return '<div class="notif-banner match-banner"><div class="notif-head">' + svg("swap", "icon-sm") + "<b>Match — shift &amp; zoekopdracht</b></div>" + rows + "</div>";
  }

  function viewBoard() {
    var u = S.currentUser();
    var hub = S.hubById(u.hubId);
    if (!state.boardRange) state.boardRange = "week";
    if (!state.boardRef) state.boardRef = ymd(new Date());
    return '' +
      notifBanner(u) +
      matchBanner(u) +
      '<div class="page-head"><div><h2>Ruilbord</h2><p>Binnen HUB ' + esc(hub ? hub.naam : "?") + " — wie eerst aanbiedt, gaat voor.</p></div>" +
        '<div class="grow"></div>' +
        '<button class="btn btn-primary" data-offer="shift">' + svg("plus") + "Shift aanbieden</button>" +
        '<button class="btn btn-outline" data-offer="callout">' + svg("search", "icon-sm") + "Shift gezocht</button>" +
        '<button class="btn btn-outline" data-offer="backup">' + svg("lifebuoy", "icon-sm") + "Back-up</button>" +
      "</div>" +
      '<div class="board-controls">' +
        '<div class="bc-group"><span class="bc-lbl">Weergave</span><div class="bc-row">' +
          '<div class="seg"><button data-brange="dag" class="' + (state.boardRange === "dag" ? "active" : "") + '">' + svg("sun", "icon-sm") + "Per dag</button>" +
            '<button data-brange="week" class="' + (state.boardRange === "week" ? "active" : "") + '">' + svg("calendar", "icon-sm") + "Per week</button></div>" +
          '<div class="seg"><button data-bnav="-1" title="Vorige">' + svg("arrowLeft", "icon-sm") + "</button>" +
            '<button class="active" style="cursor:default;text-transform:capitalize">' + esc(rangeLabel()) + "</button>" +
            '<button data-bnav="1" title="Volgende">' + svg("arrowRight", "icon-sm") + "</button></div>" +
          '<button class="btn btn-ghost btn-sm" data-bnav="today">Vandaag</button>' +
        "</div></div>" +
        '<div class="bc-group"><span class="bc-lbl">Soort</span><div class="bc-row">' +
          '<div class="seg seg-type">' +
            '<button data-board="alles" class="' + (state.board === "alles" ? "active" : "") + '">Alles</button>' +
            '<button data-board="shifts" class="bt-shift ' + (state.board === "shifts" ? "active" : "") + '">' + svg("swap", "icon-sm") + "Shifts</button>" +
            '<button data-board="callout" class="bt-callout ' + (state.board === "callout" ? "active" : "") + '">' + svg("search", "icon-sm") + "Oproepen</button>" +
            '<button data-board="backup" class="bt-backup ' + (state.board === "backup" ? "active" : "") + '">' + svg("lifebuoy", "icon-sm") + "Back-up</button>" +
          "</div></div></div>" +
        '<div class="bc-group"><span class="bc-lbl">Status</span><div class="bc-row">' +
          '<div class="seg"><button data-filter="open" class="' + (state.filter === "open" ? "active" : "") + '">Open</button>' +
            '<button data-filter="all" class="' + (state.filter === "all" ? "active" : "") + '">Alle statussen</button></div>' +
        "</div></div>" +
        '<div class="bc-group bc-search"><span class="bc-lbl">Zoeken</span>' +
          '<div class="search">' + svg("search", "icon-sm") + '<input id="boardSearch" placeholder="Naam, datum of taak…" value="' + esc(state.q) + '"></div></div>' +
      "</div>" +
      '<div id="boardGrid">' + boardContent() + "</div>";
  }

  // groepeer items per dag, daarbinnen AM/PM
  function groupRender(items, cardOf) {
    var byDay = {}, order = [];
    items.forEach(function (it) { if (!byDay[it.datum]) { byDay[it.datum] = []; order.push(it.datum); } byDay[it.datum].push(it); });
    order.sort();
    return order.map(function (day) {
      var arr = byDay[day];
      var am = arr.filter(function (i) { return i.dagdeel === "AM"; });
      var pm = arr.filter(function (i) { return i.dagdeel === "PM"; });
      function sect(label, ico, list, cls) {
        if (!list.length) return "";
        return '<div class="day-part ' + cls + '"><div class="day-part-h">' + svg(ico, "icon-sm") + label + ' <span class="cnt">' + list.length + "</span></div>" +
          '<div class="grid">' + list.map(cardOf).join("") + "</div></div>";
      }
      return '<div class="day-block"><div class="day-head">' + svg("calendar", "icon-sm") + "<span>" + esc(fmtDate(day)) + "</span></div>" +
        sect("AM · ochtend", "sun", am, "pt-am") + sect("PM · middag", "moon", pm, "pt-pm") + "</div>";
    }).join("");
  }

  function statusKeep(s) { return state.filter === "open" ? (s === "open") : (s !== "ingetrokken"); }

  function boardContent() {
    if (state.board === "tasks") state.board = "alles"; // taak-aanbieden vervallen
    if (state.board === "shifts") return boardShifts();
    if (state.board === "callout") return boardCallout();
    if (state.board === "backup") return boardBackup();
    return boardAlles();
  }

  function boardAlles() {
    var u = S.currentUser();
    var items = [];
    S.shiftsForHub(u.hubId).forEach(function (s) { if (S.visibleTask(u, s.taak) && rangeKeep(s.datum) && statusKeep(s.status) && matchesQ(qstr(s.aanbiederId, s.datum, s.dagdeel, s.taak))) { s._type = "shift"; items.push(s); } });
    S.calloutsForHub(u.hubId).forEach(function (c) { if (rangeKeep(c.datum) && statusKeep(c.status) && matchesQ(qstr(c.aanbiederId, c.datum, c.dagdeel, ""))) { c._type = "callout"; items.push(c); } });
    S.backupsForHub(u.hubId).forEach(function (b) { if (rangeKeep(b.datum) && statusKeep(b.status) && matchesQ(qstr(b.aanbiederId, b.datum, b.dagdeel, b.ritOmschrijving || ""))) { b._type = "backup"; items.push(b); } });
    if (!items.length) return emptyState("inbox", "Niets op het bord", "Er staan nu geen verzoeken binnen je hub.");
    return groupRender(items, function (it) {
      return it._type === "shift" ? shiftCard(it) : it._type === "task" ? taskCard(it) : it._type === "callout" ? calloutCard(it) : backupCard(it);
    });
  }
  function qstr(uid, datum, dagdeel, taak) { var ab = S.userById(uid); return (ab ? ab.voornaam + " " + ab.achternaam : "") + " " + fmtDate(datum) + " " + dagdeel + " " + (taak || ""); }

  function boardShifts() {
    var u = S.currentUser();
    var list = S.shiftsForHub(u.hubId).filter(function (s) {
      return S.visibleTask(u, s.taak) && rangeKeep(s.datum) && statusKeep(s.status) && matchesQ(qstr(s.aanbiederId, s.datum, s.dagdeel, s.taak));
    });
    list.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); // FCFS oudste eerst
    if (!list.length) return emptyState("inbox", "Geen shifts", "Er staan nu geen shifts op het bord. Bied er zelf één aan met de knop rechtsboven.");
    return groupRender(list, shiftCard);
  }

  // Kleurenlint bovenin elke kaart zodat het type (shift / oproep / back-up) in één oogopslag te zien is.
  function cardRibbon(type) {
    var m = { shift: ["swap", "Aangeboden shift", "rib-shift"], callout: ["search", "Shift gezocht", "rib-callout"], backup: ["lifebuoy", "Back-up", "rib-backup"] }[type];
    return '<div class="card-ribbon ' + m[2] + '">' + svg(m[0], "icon-sm") + m[1] + "</div>";
  }
  function shiftCard(s) {
    var u = S.currentUser();
    var ab = S.userById(s.aanbiederId);
    var mine = s.aanbiederId === u.id;
    var accent = s.busType === "N2" ? "accent-n2" : (s.busType === "diesel" ? "accent-diesel" : "");
    if (s.status === "in-afwachting") accent = "pending";

    var rows = '<div class="card-rows">' +
      '<div class="crow">' + svg("calendar", "icon-sm") + "<strong>" + esc(fmtDate(s.datum)) + "</strong></div>" +
      (s.starttijd ? '<div class="crow">' + svg("clock", "icon-sm") + "Starttijd <strong>" + esc(s.starttijd) + "</strong></div>"
        : '<div class="crow">' + svg("clock", "icon-sm") + '<span style="color:var(--muted)">Starttijd nog niet bekend</span></div>') +
      '<div class="crow tiny">' + svg("history", "icon-sm") + "Geplaatst " + esc(fmtDateTime(s.createdAt)) + "</div>" +
      "</div>";
    var badges = '<div class="badges">' + dagdeelBadge(s.dagdeel) + busBadge(s.busType) + taskBadge(s.taak) + reasonBadge(s.aanbiedReden) + (state.filter === "all" ? statusBadge(s.status) : "") + "</div>";

    var foot = "";
    if (s.status === "open") {
      if (mine) {
        foot = '<button class="btn btn-ghost btn-sm" data-editshift="' + s.id + '">' + svg("pencil", "icon-sm") + "Aanpassen</button>" +
               '<button class="btn btn-red btn-sm" data-withdrawshift="' + s.id + '">' + svg("trash", "icon-sm") + "Intrekken</button>";
      } else if (S.can.claimShift(u, s)) {
        foot = '<button class="btn btn-primary btn-block" data-claimshift="' + s.id + '">' + svg("check") + "Overnemen</button>";
      } else {
        var reason = "Je kunt deze shift niet overnemen.";
        if (s.busType === "N2" && !u.n2) reason = "Je hebt geen N2-rijbevoegdheid.";
        else if (s.taak && !S.canDoTask(u, s.taak)) reason = "Je mag de taak '" + s.taak + "' niet uitvoeren.";
        foot = '<div class="locked-note warn">' + svg("lock", "icon-sm") + esc(reason) + "</div>";
      }
    } else if (s.status === "in-afwachting") {
      foot = '<div class="locked-note">' + svg("clock", "icon-sm") + "Wacht op goedkeuring — door " + fullName(S.userById(s.overnemerId)) + "</div>";
    }

    return '<div class="card ' + accent + '">' + cardRibbon("shift") +
      '<div class="card-top"><div class="avatar">' + initials(ab) + "</div>" +
        '<div class="who"><div class="nm clickname" data-uid="' + ab.id + '">' + fullName(ab) + (mine ? " (jij)" : "") + "</div><div class=\"rl\">" + esc(S.roleMeta(ab.rol).label) + "</div></div></div>" +
      rows + badges + (foot ? '<div class="card-foot">' + foot + "</div>" : "") + "</div>";
  }

  function boardTasks() {
    var u = S.currentUser();
    var list = S.taskOffersForHub(u.hubId).filter(function (t) {
      return S.visibleTask(u, t.taak) && rangeKeep(t.datum) && statusKeep(t.status) && matchesQ(qstr(t.aanbiederId, t.datum, t.dagdeel, t.taak));
    });
    if (!list.length) return emptyState("tag", "Geen losse taken", "Heb je een taak voor of na je rit (zoals LC of schadecontrole)? Bied 'm aan zodat een collega extra uren kan draaien.");
    return groupRender(list, taskCard);
  }
  function taskCard(t) {
    var u = S.currentUser();
    var ab = S.userById(t.aanbiederId);
    var mine = t.aanbiederId === u.id;
    var rows = '<div class="card-rows">' +
      '<div class="crow">' + svg("calendar", "icon-sm") + "<strong>" + esc(fmtDate(t.datum)) + "</strong></div>" +
      (t.starttijd ? '<div class="crow">' + svg("clock", "icon-sm") + "Tijd <strong>" + esc(t.starttijd) + "</strong></div>" : "") +
      '<div class="crow tiny">' + svg("history", "icon-sm") + "Geplaatst " + esc(fmtDateTime(t.createdAt)) + "</div></div>";
    var badges = '<div class="badges">' + dagdeelBadge(t.dagdeel) + taskBadge(t.taak) + reasonBadge(t.aanbiedReden) + (state.filter === "all" ? statusBadge(t.status) : "") + "</div>";
    var foot = "";
    if (t.status === "open") {
      if (mine) foot = '<button class="btn btn-red btn-sm btn-block" data-withdrawtask="' + t.id + '">' + svg("trash", "icon-sm") + "Intrekken</button>";
      else if (S.can.claimTask(u, t)) foot = '<button class="btn btn-dark btn-block" data-claimtask="' + t.id + '">' + svg("check") + "Taak overnemen</button>";
      else foot = '<div class="locked-note warn">' + svg("lock", "icon-sm") + "Je mag de taak '" + esc(t.taak) + "' niet uitvoeren.</div>";
    } else if (t.status === "in-afwachting") {
      foot = '<div class="locked-note">' + svg("clock", "icon-sm") + "Wacht op goedkeuring — door " + fullName(S.userById(t.overnemerId)) + "</div>";
    }
    return '<div class="card ' + (t.status === "in-afwachting" ? "pending" : "") + '">' +
      '<div class="card-top"><div class="avatar">' + initials(ab) + "</div>" +
        '<div class="who"><div class="nm clickname" data-uid="' + ab.id + '">' + fullName(ab) + (mine ? " (jij)" : "") + "</div><div class=\"rl\">" + esc(S.roleMeta(ab.rol).label) + "</div></div></div>" +
      rows + badges + (foot ? '<div class="card-foot">' + foot + "</div>" : "") + "</div>";
  }

  function boardBackup() {
    var u = S.currentUser();
    var list = S.backupsForHub(u.hubId).filter(function (b) {
      return rangeKeep(b.datum) && statusKeep(b.status) && matchesQ(qstr(b.aanbiederId, b.datum, b.dagdeel, b.ritOmschrijving || ""));
    });
    if (!list.length) return emptyState("lifebuoy", "Geen back-up verzoeken", "Wil je rijden terwijl je op back-up staat, of juist je rit weggeven om back-up te staan? Gebruik de knop 'Back-up'.");
    return groupRender(list, backupCard);
  }
  function backupCard(b) {
    var u = S.currentUser();
    var ab = S.userById(b.aanbiederId);
    var mine = b.aanbiederId === u.id;
    var wantsDrive = b.direction !== "backup"; // "rijden"
    var line = wantsDrive ? "Staat op back-up, wil graag rijden" : "Geeft rit weg, wil back-up staan";
    var ritLine = (b.ritOmschrijving && !wantsDrive) ? '<div class="crow">' + svg("van", "icon-sm") + "Rit: <strong>" + esc(b.ritOmschrijving) + (b.ritTijd ? " · " + esc(b.ritTijd) : "") + "</strong></div>" : "";
    var rows = '<div class="card-rows">' +
      '<div class="crow">' + svg("calendar", "icon-sm") + "<strong>" + esc(fmtDate(b.datum)) + "</strong></div>" +
      '<div class="crow">' + svg("lifebuoy", "icon-sm") + esc(line) + "</div>" + ritLine +
      (b.toelichting ? '<div class="crow tiny">' + svg("info", "icon-sm") + esc(b.toelichting) + "</div>" : "") +
      '<div class="crow tiny">' + svg("history", "icon-sm") + "Geplaatst " + esc(fmtDateTime(b.createdAt)) + "</div></div>";
    var badges = '<div class="badges">' + dagdeelBadge(b.dagdeel) + '<span class="badge ' + (wantsDrive ? "task" : "n2") + '">' + (wantsDrive ? "wil rijden" : "geeft rit") + "</span>" + (state.filter === "all" ? statusBadge(b.status) : "") + "</div>";
    var foot = "";
    if (b.status === "open") {
      if (mine) foot = '<button class="btn btn-red btn-sm btn-block" data-withdrawbackup="' + b.id + '">' + svg("trash", "icon-sm") + "Intrekken</button>";
      else if (S.can.claimBackup(u, b)) foot = '<button class="btn btn-dark btn-block" data-claimbackup="' + b.id + '">' + svg("swap", "icon-sm") + (wantsDrive ? "Ik geef mijn rit op" : "Ik neem de rit over") + "</button>";
    } else if (b.status === "in-afwachting") {
      foot = '<div class="locked-note">' + svg("clock", "icon-sm") + "Wacht op goedkeuring — " + fullName(S.userById(b.overnemerId)) + "</div>";
    }
    return '<div class="card ' + (b.status === "in-afwachting" ? "pending" : "") + '">' + cardRibbon("backup") +
      '<div class="card-top"><div class="avatar alt">' + initials(ab) + "</div>" +
        '<div class="who"><div class="nm clickname" data-uid="' + ab.id + '">' + fullName(ab) + (mine ? " (jij)" : "") + "</div><div class=\"rl\">" + esc(S.roleMeta(ab.rol).label) + "</div></div></div>" +
      rows + badges + (foot ? '<div class="card-foot">' + foot + "</div>" : "") + "</div>";
  }

  function boardCallout() {
    var u = S.currentUser();
    var list = S.calloutsForHub(u.hubId).filter(function (c) {
      return rangeKeep(c.datum) && statusKeep(c.status) && matchesQ(qstr(c.aanbiederId, c.datum, c.dagdeel, ""));
    });
    if (!list.length) return emptyState("search", "Geen oproepen", "Zoek je zelf een shift? Plaats een oproep met de knop 'Shift gezocht'.");
    return groupRender(list, calloutCard);
  }
  function calloutCard(c) {
    var u = S.currentUser();
    var ab = S.userById(c.aanbiederId);
    var mine = c.aanbiederId === u.id;
    var rows = '<div class="card-rows">' +
      '<div class="crow">' + svg("calendar", "icon-sm") + "<strong>" + esc(fmtDate(c.datum)) + "</strong></div>" +
      '<div class="crow">' + svg("search", "icon-sm") + "Zoekt een shift" + "</div>" +
      (c.toelichting ? '<div class="crow tiny">' + svg("info", "icon-sm") + esc(c.toelichting) + "</div>" : "") +
      '<div class="crow tiny">' + svg("history", "icon-sm") + "Geplaatst " + esc(fmtDateTime(c.createdAt)) + "</div></div>";
    var badges = '<div class="badges">' + dagdeelBadge(c.dagdeel) + '<span class="badge reason">' + svg("search", "icon-sm") + "Oproep</span>" + (state.filter === "all" ? statusBadge(c.status) : "") + "</div>";
    var foot = "";
    if (c.status === "open") {
      if (mine) foot = '<button class="btn btn-red btn-sm btn-block" data-withdrawcallout="' + c.id + '">' + svg("trash", "icon-sm") + "Intrekken</button>";
      else foot = '<button class="btn btn-dark btn-block" data-claimcallout="' + c.id + '">' + svg("check") + "Ik geef jou mijn shift</button>";
    } else if (c.status === "in-afwachting") {
      foot = '<div class="locked-note">' + svg("clock", "icon-sm") + "Wacht op goedkeuring — " + fullName(S.userById(c.overnemerId)) + " geeft shift</div>";
    }
    return '<div class="card ' + (c.status === "in-afwachting" ? "pending" : "") + '">' + cardRibbon("callout") +
      '<div class="card-top"><div class="avatar">' + initials(ab) + "</div>" +
        '<div class="who"><div class="nm clickname" data-uid="' + ab.id + '">' + fullName(ab) + (mine ? " (jij)" : "") + "</div><div class=\"rl\">" + esc(S.roleMeta(ab.rol).label) + "</div></div></div>" +
      rows + badges + (foot ? '<div class="card-foot">' + foot + "</div>" : "") + "</div>";
  }

  function bindBoard() {
    document.querySelectorAll("[data-board]").forEach(function (b) { b.addEventListener("click", function () { state.board = b.getAttribute("data-board"); renderMain(); }); });
    document.querySelectorAll("[data-filter]").forEach(function (b) { b.addEventListener("click", function () { state.filter = b.getAttribute("data-filter"); renderMain(); }); });
    document.querySelectorAll("[data-brange]").forEach(function (b) { b.addEventListener("click", function () { state.boardRange = b.getAttribute("data-brange"); renderMain(); }); });
    document.querySelectorAll("[data-bnav]").forEach(function (b) { b.addEventListener("click", function () {
      var v = b.getAttribute("data-bnav");
      if (v === "today") { state.boardRef = ymd(new Date()); }
      else { var step = (state.boardRange === "dag" ? 1 : 7) * parseInt(v, 10); var d = new Date(state.boardRef + "T00:00:00"); d.setDate(d.getDate() + step); state.boardRef = ymd(d); }
      renderMain();
    }); });
    var nseen = document.querySelector("[data-notifseen]");
    if (nseen) nseen.addEventListener("click", function () { var u = S.currentUser(); var ds = myDecisions(u); setNotifSeen(u, ds.length ? ds[0].it.besluitOp : new Date().toISOString()); renderApp(); });
    document.querySelectorAll("[data-matchclaim]").forEach(function (b) { b.addEventListener("click", function () { var p = b.getAttribute("data-matchclaim").split("|"); act(function () { S.claimShift(p[0]); S.withdrawCallout(p[1]); }, "Shift overgenomen — wacht op goedkeuring."); }); });
    document.querySelectorAll("[data-matchgive]").forEach(function (b) { b.addEventListener("click", function () { var p = b.getAttribute("data-matchgive").split("|"); act(function () { S.giveShiftTo(p[0], p[1]); }, "Shift aangeboden aan collega — wacht op goedkeuring."); }); });
    var s = el("boardSearch");
    if (s) s.addEventListener("input", function () { state.q = s.value; el("boardGrid").innerHTML = boardContent(); bindBoardActions(); });
    document.querySelectorAll("[data-offer]").forEach(function (b) { b.addEventListener("click", function () { openOfferModal(b.getAttribute("data-offer")); }); });
    bindBoardActions();
  }
  function bindBoardActions() {
    function on(attr, fn, msg) { document.querySelectorAll("[" + attr + "]").forEach(function (b) { b.addEventListener("click", function () { act(function () { fn(b.getAttribute(attr)); }, msg); }); }); }
    document.querySelectorAll("[data-claimshift]").forEach(function (b) { b.addEventListener("click", function () { tryClaimShift(b.getAttribute("data-claimshift")); }); });
    on("data-withdrawshift", S.withdrawShift, "Shift ingetrokken.");
    on("data-claimtask", S.claimTask, "Taak overgenomen — wacht op goedkeuring.");
    on("data-withdrawtask", S.withdrawTask, "Taak ingetrokken.");
    on("data-withdrawbackup", S.withdrawBackup, "Verzoek ingetrokken.");
    on("data-claimcallout", S.claimCallout, "Je geeft je shift — wacht op goedkeuring.");
    on("data-withdrawcallout", S.withdrawCallout, "Oproep ingetrokken.");
    document.querySelectorAll("[data-claimbackup]").forEach(function (b) { b.addEventListener("click", function () { openClaimBackupModal(b.getAttribute("data-claimbackup")); }); });
    document.querySelectorAll("[data-editshift]").forEach(function (b) { b.addEventListener("click", function () { openOfferModal("shift", b.getAttribute("data-editshift")); }); });
    document.querySelectorAll(".clickname").forEach(function (n) { n.addEventListener("click", function () { openUserDetail(n.getAttribute("data-uid")); }); });
  }

  // FCFS: bij een shift zonder starttijd waarschuwen als er een eerder geplaatste open shift is
  function tryClaimShift(id) {
    var u = S.currentUser();
    var s = S.db.shifts.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var earlier = null;
    if (!s.starttijd) {
      earlier = S.db.shifts.filter(function (o) {
        return o.id !== s.id && o.hubId === s.hubId && o.status === "open" && o.datum === s.datum && o.dagdeel === s.dagdeel && !o.starttijd && (o.seq || 0) < (s.seq || 0);
      }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); })[0];
    }
    if (!earlier) { act(function () { S.claimShift(id); }, "Shift overgenomen — wacht op goedkeuring."); return; }
    var ab = S.userById(earlier.aanbiederId);
    openModal({
      title: "Er staat een eerdere shift open", icon: "alert",
      body: '<div class="fifo-alert" style="margin-bottom:4px">' + svg("alert", "icon-sm") +
        "<div><b>" + fullName(ab) + "</b> bood al eerder een shift aan voor <b>" + esc(fmtDate(earlier.datum)) + " " + earlier.dagdeel +
        "</b> (geplaatst " + esc(fmtDateTime(earlier.createdAt)) + "). Wie het eerst aanbiedt, gaat normaal voor.</div></div>",
      foot: '<button class="btn btn-primary" id="fifoFirst">' + svg("check") + "Neem de eerste shift</button>" +
        '<button class="btn btn-ghost" id="fifoThis">Toch deze overnemen</button>',
      onMount: function (ov, close) {
        ov.querySelector("#fifoFirst").addEventListener("click", function () { close(); act(function () { S.claimShift(earlier.id); }, "Eerste shift overgenomen — wacht op goedkeuring."); });
        ov.querySelector("#fifoThis").addEventListener("click", function () { close(); act(function () { S.claimShift(id); }, "Shift overgenomen — wacht op goedkeuring."); });
      }
    });
  }

  /* ---------- tijd-kiezer ---------- */
  function hoursFor(dagdeel) { var w = S.WINDOW[dagdeel]; var a = []; for (var h = Math.floor(w.min / 60); h <= Math.floor(w.max / 60); h++) a.push(h); return a; }
  function hourOptions(dagdeel, sel) {
    return '<option value="">uur</option>' + hoursFor(dagdeel).map(function (h) {
      var v = ("0" + h).slice(-2); return '<option value="' + v + '"' + (sel === v ? " selected" : "") + ">" + v + "</option>";
    }).join("");
  }
  function minuteOptions(sel) {
    var o = '<option value="">min</option>'; for (var m = 0; m < 60; m++) { var v = ("0" + m).slice(-2); o += '<option value="' + v + '"' + (sel === v ? " selected" : "") + ">" + v + "</option>"; } return o;
  }

  /* ---------- eigen datumkiezer ---------- */
  function dateField(name, value, label) {
    return '<div class="field"><label>' + (label || "Datum") + "</label>" +
      '<div class="datepick" data-datepick>' +
        '<input type="hidden" name="' + name + '" value="' + esc(value || "") + '">' +
        '<button type="button" class="datepick-btn">' + svg("calendar", "icon-sm") +
          '<span class="dp-label' + (value ? "" : " ph") + '">' + (value ? esc(fmtDate(value)) : "Kies een datum") + "</span></button>" +
        '<div class="datepick-pop" hidden></div>' +
      "</div></div>";
  }
  function calendarHTML(view, selected) {
    var y = view.getFullYear(), m = view.getMonth();
    var months = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
    var startDow = (new Date(y, m, 1).getDay() + 6) % 7;
    var days = new Date(y, m + 1, 0).getDate();
    var today = new Date(); var todayStr = today.getFullYear() + "-" + ("0" + (today.getMonth() + 1)).slice(-2) + "-" + ("0" + today.getDate()).slice(-2);
    var cells = "";
    for (var i = 0; i < startDow; i++) cells += '<span class="dp-cell empty"></span>';
    for (var d = 1; d <= days; d++) {
      var ds = y + "-" + ("0" + (m + 1)).slice(-2) + "-" + ("0" + d).slice(-2);
      cells += '<button type="button" class="dp-cell' + (ds === selected ? " sel" : "") + (ds === todayStr ? " today" : "") + '" data-day="' + ds + '">' + d + "</button>";
    }
    return '<div class="dp-head"><button type="button" class="dp-nav" data-pm>' + svg("arrowLeft", "icon-sm") + "</button>" +
      '<span class="dp-title">' + months[m] + " " + y + "</span>" +
      '<button type="button" class="dp-nav" data-nm>' + svg("arrowRight", "icon-sm") + "</button></div>" +
      '<div class="dp-week"><span>ma</span><span>di</span><span>wo</span><span>do</span><span>vr</span><span>za</span><span>zo</span></div>' +
      '<div class="dp-grid">' + cells + "</div>";
  }
  function bindDateFields(ov, onPick) {
    var fields = [].slice.call(ov.querySelectorAll("[data-datepick]"));
    fields.forEach(function (dp) {
      var input = dp.querySelector("input"), btn = dp.querySelector(".datepick-btn"), pop = dp.querySelector(".datepick-pop"), label = dp.querySelector(".dp-label");
      var view = input.value ? new Date(input.value + "T00:00:00") : new Date();
      function draw() {
        pop.innerHTML = calendarHTML(view, input.value);
        pop.querySelector("[data-pm]").onclick = function () { view.setMonth(view.getMonth() - 1); draw(); };
        pop.querySelector("[data-nm]").onclick = function () { view.setMonth(view.getMonth() + 1); draw(); };
        pop.querySelectorAll("[data-day]").forEach(function (b) {
          b.onclick = function () { input.value = b.getAttribute("data-day"); label.textContent = fmtDate(input.value); label.classList.remove("ph"); pop.hidden = true; if (onPick) onPick(input.value, ov); };
        });
      }
      btn.onclick = function (e) {
        e.stopPropagation();
        var willOpen = pop.hidden;
        fields.forEach(function (o) { o.querySelector(".datepick-pop").hidden = true; });
        if (willOpen) { view = input.value ? new Date(input.value + "T00:00:00") : new Date(); draw(); pop.hidden = false; }
      };
      pop.onclick = function (e) { e.stopPropagation(); };
    });
  }
  // Zondag heeft geen PM-shift: verberg PM en zet selectie op AM.
  function applySundayRule(ov) {
    var inp = ov.querySelector("[data-datepick] input"); var pm = ov.querySelector(".choice.dd-pm");
    if (!inp || !pm) return;
    var sun = inp.value && S.isSunday(inp.value);
    pm.style.display = sun ? "none" : "";
    if (sun) { var pmr = pm.querySelector("input"); if (pmr && pmr.checked) { pm.classList.remove("sel"); var am = ov.querySelector(".choice.dd-am input"); if (am) { am.checked = true; am.closest(".choice").classList.add("sel"); } } }
  }

  /* ---------- aanbied/aanpas modal ---------- */
  function openOfferModal(kind, editId) {
    var u = S.currentUser();
    if (kind === "backup") return openBackupModal();
    if (kind === "callout") return openCalloutModal();
    var existing = editId ? S.db.shifts.filter(function (s) { return s.id === editId; })[0] : null;
    var isShift = kind === "shift";
    var d = existing || {};
    var bekend = existing ? existing.shiftsBekend : false;
    var dagdeel = d.dagdeel || "AM";
    var curH = d.starttijd ? d.starttijd.split(":")[0] : "";
    var curM = d.starttijd ? d.starttijd.split(":")[1] : "";
    var av = S.availableTasks(u);
    var taskOpts = av.map(function (t) { return '<option value="' + esc(t) + '"' + (d.taak === t ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");

    var dagdeelBlock = '<div class="field"><label>Dagdeel</label><div class="choice-grid">' +
      '<label class="choice dd-am ' + (dagdeel === "AM" ? "sel" : "") + '"><input type="radio" name="dagdeel" value="AM" ' + (dagdeel === "AM" ? "checked" : "") + ' hidden><span class="dd-ico">' + svg("sun", "icon-lg") + '</span><span class="ch-t">AM</span><span class="ch-s">ochtend</span></label>' +
      '<label class="choice dd-pm ' + (dagdeel === "PM" ? "sel" : "") + '"><input type="radio" name="dagdeel" value="PM" ' + (dagdeel === "PM" ? "checked" : "") + ' hidden><span class="dd-ico">' + svg("moon", "icon-lg") + '</span><span class="ch-t">PM</span><span class="ch-s">middag</span></label>' +
      "</div></div>";

    var timeBlock = '<div class="field"><label>Starttijd</label><div class="timepick">' +
      '<select name="uur" id="selUur">' + hourOptions(dagdeel, curH) + "</select><span class=\"colon\">:</span>" +
      '<select name="minuut">' + minuteOptions(curM) + "</select></div>" +
      '<div class="hint">AM: 05:00-15:00 &middot; PM: 13:00-23:00</div></div>';

    var reasonField = '<div class="field"><label>Reden (optioneel)</label><select name="aanbiedReden"><option value="">— Geen reden —</option>' +
      S.REASONS.map(function (r) { return '<option value="' + esc(r) + '"' + (d.aanbiedReden === r ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("") + "</select></div>";

    var body = '<form id="offerForm">' +
      dateField("datum", d.datum) +
      dagdeelBlock;

    if (isShift) {
      body += '<div class="field toggle-row"><div><label style="margin:0">Zijn de shifts al bekend?</label>' +
        '<div class="hint">Pas dan kun je starttijd, bus en taak invullen.</div></div>' +
        '<label class="toggle"><input type="checkbox" id="bekendToggle" ' + (bekend ? "checked" : "") + '><span class="track"></span></label></div>' +
        '<div id="bekendFields" style="' + (bekend ? "" : "display:none") + '">' + timeBlock +
          '<div class="field"><label>Welke bus rijd je?</label><div class="choice-grid">' +
            '<label class="choice ' + (d.busType === "diesel" ? "sel" : "") + '"><input type="radio" name="busType" value="diesel" ' + (d.busType === "diesel" ? "checked" : "") + ' hidden>' + svg("van", "icon-lg") + '<span class="ch-t">Volkswagen</span><span class="ch-s">diesel</span></label>' +
            '<label class="choice ' + (d.busType === "N2" ? "sel" : "") + '"><input type="radio" name="busType" value="N2" ' + (d.busType === "N2" ? "checked" : "") + ' hidden>' + svg("bolt", "icon-lg") + '<span class="ch-t">N2</span><span class="ch-s">elektrisch</span></label>' +
          "</div></div>" +
          '<div class="field"><label>Taak voor/na je rit (optioneel)</label><select name="taak"><option value="">— Geen taak —</option>' + taskOpts + "</select>" +
            (av.length ? "" : '<div class="hint">Je hebt nog geen taken die je mag uitvoeren.</div>') + "</div>" +
        "</div>";
      body += reasonField;
    } else {
      if (!av.length) body += '<div class="alert alert-info">Je hebt nog geen taken die je mag uitvoeren. Vraag je teamleider om taken toe te wijzen.</div>';
      body += '<div class="field"><label>Welke taak bied je aan?</label><select name="taak" required><option value="">— Kies een taak —</option>' + taskOpts + "</select></div>" + timeBlock + reasonField;
    }
    body += "</form>";

    var foot = '<button class="btn btn-ghost" data-close>Annuleren</button>' +
      '<button class="btn btn-primary" id="offerSubmit">' + svg("check") + (editId ? "Opslaan" : (isShift ? "Shift plaatsen" : "Taak plaatsen")) + "</button>";

    openModal({
      title: editId ? "Shift aanpassen" : (isShift ? "Shift aanbieden" : "Taak aanbieden"),
      icon: isShift ? "swap" : "tag", body: body, foot: foot,
      onMount: function (ov, close) {
        bindDateFields(ov, function () { applySundayRule(ov); }); applySundayRule(ov);
        ov.querySelectorAll(".choice input").forEach(function (inp) {
          inp.addEventListener("change", function () {
            ov.querySelectorAll('.choice input[name="' + inp.name + '"]').forEach(function (x) { x.closest(".choice").classList.toggle("sel", x.checked); });
            if (inp.name === "dagdeel") { var su = ov.querySelector("#selUur"); if (su) su.innerHTML = hourOptions(inp.value, ""); }
          });
        });
        var tog = ov.querySelector("#bekendToggle");
        if (tog) tog.addEventListener("change", function () { ov.querySelector("#bekendFields").style.display = tog.checked ? "" : "none"; });
        ov.querySelector("#offerSubmit").addEventListener("click", function () {
          var f = ov.querySelector("#offerForm");
          var hh = f.uur ? f.uur.value : "", mm = f.minuut ? f.minuut.value : "";
          var data = {
            datum: f.datum.value,
            dagdeel: (f.querySelector('input[name="dagdeel"]:checked') || {}).value,
            starttijd: (hh && mm) ? (hh + ":" + mm) : "",
            taak: f.taak ? f.taak.value : "",
            aanbiedReden: f.aanbiedReden ? f.aanbiedReden.value : ""
          };
          try {
            if (isShift) {
              data.shiftsBekend = tog ? tog.checked : false;
              data.busType = (f.querySelector('input[name="busType"]:checked') || {}).value || "";
              if (editId) { S.editShift(editId, data); toast("Shift bijgewerkt.", "ok"); }
              else { S.offerShift(data); toast("Shift geplaatst.", "ok"); }
            } else { S.offerTask(data); toast("Taak geplaatst.", "ok"); }
            close(); renderApp();
          } catch (e) { toast(e.message, "err"); }
        });
      }
    });
  }

  function dagdeelChoiceBlock() {
    return '<div class="field"><label>Dagdeel</label><div class="choice-grid">' +
      '<label class="choice dd-am sel"><input type="radio" name="dagdeel" value="AM" checked hidden><span class="dd-ico">' + svg("sun", "icon-lg") + '</span><span class="ch-t">AM</span><span class="ch-s">ochtend</span></label>' +
      '<label class="choice dd-pm"><input type="radio" name="dagdeel" value="PM" hidden><span class="dd-ico">' + svg("moon", "icon-lg") + '</span><span class="ch-t">PM</span><span class="ch-s">middag</span></label>' +
      "</div></div>";
  }
  function bindChoices(ov) {
    ov.querySelectorAll(".choice input").forEach(function (inp) {
      inp.addEventListener("change", function () { ov.querySelectorAll('.choice input[name="' + inp.name + '"]').forEach(function (x) { x.closest(".choice").classList.toggle("sel", x.checked); }); });
    });
  }

  function openBackupModal() {
    // Back-up kan alleen voor de eerstvolgende dienst: morgenvroeg (AM) of vandaagmiddag (PM).
    var tm = new Date(); tm.setDate(tm.getDate() + 1);
    var body = '<form id="buForm">' +
      '<div class="field"><label>Wat wil je?</label><div class="choice-grid">' +
        '<label class="choice bu-dir sel"><input type="radio" name="direction" value="rijden" checked hidden>' + svg("van", "icon-lg") + '<span class="ch-t">Ik wil rijden</span><span class="ch-s">sta op back-up</span></label>' +
        '<label class="choice bu-dir"><input type="radio" name="direction" value="backup" hidden>' + svg("lifebuoy", "icon-lg") + '<span class="ch-t">Ik geef mijn rit</span><span class="ch-s">wil back-up staan</span></label>' +
      "</div></div>" +
      '<div class="field"><label>Voor welke dienst?</label><div class="choice-grid">' +
        '<label class="choice bu-when sel"><input type="radio" name="buwhen" value="tomAM" checked hidden>' + svg("sun", "icon-lg") + '<span class="ch-t">Morgenvroeg</span><span class="ch-s">AM · ' + esc(fmtDate(ymd(tm))) + "</span></label>" +
        '<label class="choice bu-when"><input type="radio" name="buwhen" value="todayPM" hidden>' + svg("moon", "icon-lg") + '<span class="ch-t">Vandaagmiddag</span><span class="ch-s">PM · ' + esc(fmtDate(ymd(new Date()))) + "</span></label>" +
      "</div></div>" +
      '<div id="ritFields" style="display:none">' +
        '<div class="field"><label>Wat voor rit geef je weg?</label><input name="ritOmschrijving" placeholder="Bijv. vroege rit, 2e rit, vak 12"></div>' +
        '<div class="field"><label>Hoe laat (optioneel)</label><input type="time" name="ritTijd"></div>' +
      "</div>" +
      '<div class="field"><label>Toelichting (optioneel)</label><textarea name="toelichting" rows="2" placeholder="Bijv. wil graag extra uren draaien"></textarea></div>' +
      "</form>";
    openModal({
      title: "Back-up regelen", icon: "lifebuoy", body: body,
      foot: '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-primary" id="buSubmit">' + svg("check") + "Plaatsen</button>",
      onMount: function (ov, close) {
        bindChoices(ov);
        ov.querySelectorAll('input[name="direction"]').forEach(function (r) {
          r.addEventListener("change", function () { ov.querySelector("#ritFields").style.display = (ov.querySelector('input[name="direction"]:checked').value === "backup") ? "" : "none"; });
        });
        ov.querySelector("#buSubmit").addEventListener("click", function () {
          var f = ov.querySelector("#buForm");
          var when = (f.querySelector('input[name="buwhen"]:checked') || {}).value;
          var t = new Date(), datum, dagdeel;
          if (when === "todayPM") { datum = ymd(t); dagdeel = "PM"; }
          else { var d = new Date(t); d.setDate(d.getDate() + 1); datum = ymd(d); dagdeel = "AM"; }
          try {
            S.offerBackup({
              direction: (f.querySelector('input[name="direction"]:checked') || {}).value,
              datum: datum, dagdeel: dagdeel,
              ritOmschrijving: f.ritOmschrijving.value, ritTijd: f.ritTijd.value, toelichting: f.toelichting.value
            });
            toast("Back-up verzoek geplaatst.", "ok"); close(); renderApp();
          } catch (e) { toast(e.message, "err"); }
        });
      }
    });
  }

  function openCalloutModal() {
    var body = '<form id="coForm">' +
      dateField("datum") + dagdeelChoiceBlock() +
      '<div class="field"><label>Toelichting (optioneel)</label><textarea name="toelichting" rows="2" placeholder="Bijv. ik wil graag extra werken"></textarea></div>' +
      "</form>";
    openModal({
      title: "Oproep: shift gezocht", icon: "search", body: body,
      foot: '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-primary" id="coSubmit">' + svg("check") + "Oproep plaatsen</button>",
      onMount: function (ov, close) {
        bindDateFields(ov, function () { applySundayRule(ov); }); bindChoices(ov); applySundayRule(ov);
        ov.querySelector("#coSubmit").addEventListener("click", function () {
          var f = ov.querySelector("#coForm");
          try { S.offerCallout({ datum: f.datum.value, dagdeel: (f.querySelector('input[name="dagdeel"]:checked') || {}).value, toelichting: f.toelichting.value }); toast("Oproep geplaatst.", "ok"); close(); renderApp(); }
          catch (e) { toast(e.message, "err"); }
        });
      }
    });
  }

  function openClaimBackupModal(id) {
    var b = S.db.backups.filter(function (x) { return x.id === id; })[0];
    if (b && b.direction === "backup") { act(function () { S.claimBackup(id); }, "Rit overgenomen — wacht op goedkeuring."); return; }
    // richting "rijden": jij geeft je rit op -> ritdetails invullen
    openModal({
      title: "Mijn rit opgeven", icon: "van",
      body: '<div class="hint" style="margin-bottom:10px">Je geeft je rit aan een collega die op back-up staat. Vul in wat voor rit het is, zodat de beoordelaar het snapt.</div>' +
        '<form id="cbForm"><div class="field"><label>Wat voor rit?</label><input name="ritOmschrijving" placeholder="Bijv. vroege rit, 2e rit, vak 12" required></div>' +
        '<div class="field"><label>Hoe laat (optioneel)</label><input type="time" name="ritTijd"></div></form>',
      foot: '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-primary" id="cbOk">' + svg("check") + "Rit opgeven</button>",
      onMount: function (ov, close) {
        ov.querySelector("#cbOk").addEventListener("click", function () {
          var f = ov.querySelector("#cbForm");
          try { S.claimBackup(id, { ritOmschrijving: f.ritOmschrijving.value, ritTijd: f.ritTijd.value }); toast("Rit opgegeven — wacht op goedkeuring.", "ok"); close(); renderApp(); }
          catch (e) { toast(e.message, "err"); }
        });
      }
    });
  }

  /* ---- Herbruikbare week/totaal-balk (Goedkeuren, Statistieken, Historie) ---- */
  function weekBounds(refYmd) {
    var mon = mondayOf(new Date(refYmd + "T00:00:00")), sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { monS: ymd(mon), sunS: ymd(sun), mon: mon, sun: sun,
      label: "Week " + isoWeek(mon) + " · " + mon.getDate() + "-" + (mon.getMonth() + 1) + " t/m " + sun.getDate() + "-" + (sun.getMonth() + 1) };
  }
  function weekBar(pre, refYmd, rangeVal) {
    var isWeek = rangeVal !== "all", b = weekBounds(refYmd);
    return '<div class="board-range week-bar" style="margin-bottom:14px">' +
      '<div class="seg"><button data-' + pre + 'range="week" class="' + (isWeek ? "active" : "") + '">' + svg("calendar", "icon-sm") + "Per week</button>" +
        '<button data-' + pre + 'range="all" class="' + (!isWeek ? "active" : "") + '">Totaal</button></div>' +
      (isWeek ? '<div class="week-nav-group"><div class="seg"><button data-' + pre + 'week="-1" title="Vorige">' + svg("arrowLeft", "icon-sm") + "</button>" +
        '<button class="active" style="cursor:default;text-transform:capitalize">' + svg("calendar", "icon-sm") + esc(b.label) + "</button>" +
        '<button data-' + pre + 'week="1" title="Volgende">' + svg("arrowRight", "icon-sm") + "</button></div>" +
        '<button class="btn btn-ghost btn-sm" data-' + pre + 'week="0">Deze week</button></div>' : "") +
      "</div>";
  }
  function bindWeekBar(pre, refKey, rangeKey) {
    document.querySelectorAll("[data-" + pre + "range]").forEach(function (b) { b.addEventListener("click", function () { state[rangeKey] = b.getAttribute("data-" + pre + "range"); renderMain(); }); });
    document.querySelectorAll("[data-" + pre + "week]").forEach(function (b) { b.addEventListener("click", function () {
      var v = parseInt(b.getAttribute("data-" + pre + "week"), 10);
      if (v === 0) state[refKey] = ymd(new Date());
      else { var d = new Date(state[refKey] + "T00:00:00"); d.setDate(d.getDate() + v * 7); state[refKey] = ymd(d); }
      renderMain();
    }); });
  }

  /* ===================================================================
     MIJN RUILVERZOEKEN
     =================================================================== */
  function viewMine() {
    var u = S.currentUser();
    if (!state.mineRef) state.mineRef = ymd(new Date());
    var mon = mondayOf(new Date(state.mineRef + "T00:00:00"));
    var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    var monS = ymd(mon), sunS = ymd(sun);
    // datums oplopend (maandag → zondag), daarbinnen AM vóór PM
    function mineList(arr) {
      return arr.filter(function (x) { return (x.aanbiederId === u.id || x.overnemerId === u.id || (x.status === "afgekeurd" && x.lastOvernemerId === u.id)) && x.datum >= monS && x.datum <= sunS; })
        .sort(function (a, b) { return a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (a.dagdeel < b.dagdeel ? -1 : a.dagdeel > b.dagdeel ? 1 : 0); });
    }
    var myShifts = mineList(S.db.shifts);
    var myBackups = mineList(S.db.backups);
    var myCallouts = mineList(S.db.callouts);

    function statusCell(item, kind) {
      var reden = (item.status === "afgekeurd" && item.reden) ? '<div class="st-reden">' + svg("info", "icon-sm") + "<span>" + esc(item.reden) + "</span></div>" : "";
      var acts = "";
      if (item.aanbiederId === u.id && item.status === "afgekeurd") {
        acts = '<div class="mine-acts">' +
          '<button class="btn btn-sm btn-primary" data-repost="' + kind + ":" + item.id + '">' + svg("refresh", "icon-sm") + "Weer op het bord</button>" +
          '<button class="btn btn-sm btn-ghost" data-drop="' + kind + ":" + item.id + '">Laat maar</button></div>';
      }
      return '<td data-th="Status"><div class="st-cell">' + statusBadge(item.status) + reden + acts + "</div></td>";
    }
    function row(item, kind) {
      var mineOffer = item.aanbiederId === u.id;
      var details = kind === "backup" ? '<span class="cellsub">' + (item.direction === "backup" ? "rit weggeven" : "back-up rijden") + "</span>"
        : kind === "callout" ? '<span class="cellsub">shift gezocht</span>'
        : (busBadge(item.busType) + " " + taskBadge(item.taak));
      var rol = (kind === "backup" || kind === "callout") ? (mineOffer ? "Verzoek" : "Reactie") : (mineOffer ? "Aangeboden" : "Overgenomen");
      return "<tr><td><div class=\"cellname\">" + esc(fmtDate(item.datum)) + "</div><div class=\"cellsub\">" + (mineOffer ? "Door jou" : "Met " + fullName(S.userById(item.aanbiederId))) + "</div></td>" +
        '<td data-th="Dagdeel">' + dagdeelBadge(item.dagdeel) + '</td><td data-th="Details">' + details + '</td><td data-th="Soort"><span class="cellsub">' + rol + "</span></td>" +
        statusCell(item, kind) + "</tr>";
    }
    function tbl(list, kind, empty) {
      return list.length ? list.map(function (i) { return row(i, kind); }).join("") : '<tr><td colspan="5"><div class="cellsub" style="padding:8px 0">' + empty + "</div></td></tr>";
    }
    var head = "<thead><tr><th>Datum</th><th>Dagdeel</th><th>Details</th><th>Soort</th><th>Status</th></tr></thead>";
    var weekLabel = "Week " + isoWeek(mon) + " · " + mon.getDate() + "-" + (mon.getMonth() + 1) + " t/m " + sun.getDate() + "-" + (sun.getMonth() + 1);
    var nav = '<div class="board-range" style="margin-bottom:14px"><div class="seg">' +
        '<button data-mineweek="-1" title="Vorige week">' + svg("arrowLeft", "icon-sm") + "</button>" +
        '<button class="active" style="cursor:default">' + svg("calendar", "icon-sm") + esc(weekLabel) + "</button>" +
        '<button data-mineweek="1" title="Volgende week">' + svg("arrowRight", "icon-sm") + "</button></div>" +
        '<button class="btn btn-ghost btn-sm" data-mineweek="0">Deze week</button></div>';
    return '<div class="page-head"><div><h2>Mijn ruilverzoeken</h2><p>Wat jij hebt aangeboden of overgenomen — per week, op datum.</p></div></div>' +
      nav +
      panel("swap", "Shifts", tableScroll(head + "<tbody>" + tbl(myShifts, "shift", "Geen shiftruilingen deze week.") + "</tbody>")) +
      panel("lifebuoy", "Back-up", tableScroll(head + "<tbody>" + tbl(myBackups, "backup", "Geen back-up verzoeken deze week.") + "</tbody>")) +
      panel("search", "Oproepen", tableScroll(head + "<tbody>" + tbl(myCallouts, "callout", "Geen oproepen deze week.") + "</tbody>"));
  }
  function bindMine() {
    document.querySelectorAll("[data-mineweek]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = parseInt(b.getAttribute("data-mineweek"), 10);
        if (v === 0) state.mineRef = ymd(new Date());
        else { var d = new Date(state.mineRef + "T00:00:00"); d.setDate(d.getDate() + v * 7); state.mineRef = ymd(d); }
        renderMain();
      });
    });
    document.querySelectorAll("[data-repost]").forEach(function (b) {
      b.addEventListener("click", function () { var p = b.getAttribute("data-repost").split(":"); act(function () { S.repostRequest(p[0], p[1]); }, "Terug op het bord."); });
    });
    document.querySelectorAll("[data-drop]").forEach(function (b) {
      b.addEventListener("click", function () { var p = b.getAttribute("data-drop").split(":"); act(function () { S.dropRequest(p[0], p[1]); }, "Verzoek gesloten."); });
    });
  }

  /* ===================================================================
     GOEDKEUREN
     =================================================================== */
  function viewApprovals() {
    var u = S.currentUser();
    if (!state.apprRef) state.apprRef = ymd(new Date());
    if (!state.apprRange) state.apprRange = "week";
    var wb = weekBounds(state.apprRef);
    function inWk(x) { return state.apprRange !== "week" || (x.datum >= wb.monS && x.datum <= wb.sunS); }
    var p = S.pendingForApprover(u);
    var cards = [];
    p.shifts.filter(inWk).forEach(function (s) { cards.push(approvalShift(s)); });
    p.tasks.filter(inWk).forEach(function (t) { cards.push(approvalSimple(t, "task")); });
    p.backups.filter(inWk).forEach(function (b) { cards.push(approvalSimple(b, "backup")); });
    p.callouts.filter(inWk).forEach(function (c) { cards.push(approvalSimple(c, "callout")); });
    var body = cards.length ? '<div class="grid">' + cards.join("") + "</div>" : emptyState("checkCircle", "Niets te beoordelen", state.apprRange === "week" ? "Geen ruilingen in afwachting deze week." : "Er staan geen ruilingen in afwachting van jouw goedkeuring.");
    return '<div class="page-head"><div><h2>Goedkeuren</h2><p>Beoordeel openstaande ruilingen binnen jouw hub.</p></div></div>' +
      weekBar("appr", state.apprRef, state.apprRange) + body;
  }

  // Compacte overgenomen/weggegeven-telling naast een naam (zelfde groen/rood als Statistieken).
  function miniStats(user) {
    if (!user) return "";
    var st = user.stats || {};
    return '<span class="mini-stats">' +
      '<span class="hcol up" title="Overgenomen">' + svg("arrowDown", "icon-sm") + (st.shiftsOvergenomen || 0) + "</span>" +
      '<span class="hcol down" title="Weggegeven">' + svg("arrowUp", "icon-sm") + (st.shiftsAangeboden || 0) + "</span>" +
      "</span>";
  }
  function approvalShift(s) {
    var ab = S.userById(s.aanbiederId), ov = S.userById(s.overnemerId);
    var alert = "";
    if (s.fifoWarning) {
      alert = '<div class="fifo-alert">' + svg("alert", "icon-sm") + "<div><b>Let op — volgorde.</b> Er stond een eerder aangeboden shift open van <b>" + esc(s.fifoSkippedBy) +
        "</b> (geplaatst " + esc(fmtDateTime(s.fifoSkippedAt)) + "). Deze shift is later geplaatst (" + esc(fmtDateTime(s.createdAt)) + ").</div></div>";
    }
    var badges = '<div class="badges">' + dagdeelBadge(s.dagdeel) + busBadge(s.busType) + taskBadge(s.taak) +
      (s.shiftsBekend ? '<span class="badge st-goedgekeurd">Shifts bekend</span>' : '<span class="badge st-ingetrokken">Vooraf geplaatst</span>') + "</div>";
    return '<div class="card pending">' +
      '<div class="card-rows">' +
        '<div class="crow">' + svg("calendar", "icon-sm") + "<strong>" + esc(fmtDate(s.datum)) + "</strong>" + (s.starttijd ? " · " + esc(s.starttijd) : "") + "</div>" +
        '<div class="crow">' + svg("user", "icon-sm") + "Geeft weg: <strong>" + fullName(ab) + "</strong>" + miniStats(ab) + "</div>" +
        '<div class="crow">' + svg("arrowRight", "icon-sm") + "Neemt over: <strong>" + fullName(ov) + "</strong>" + miniStats(ov) + "</div>" +
        '<div class="crow tiny">' + svg("history", "icon-sm") + "Aangeboden " + esc(fmtDateTime(s.createdAt)) + "</div>" +
      "</div>" + badges + alert +
      '<div class="card-foot">' +
        '<button class="btn btn-green" data-approve="shift:' + s.id + '">' + svg("check") + "Goedkeuren</button>" +
        '<button class="btn btn-red" data-reject="shift:' + s.id + '">' + svg("x") + "Afkeuren</button></div></div>";
  }
  function approvalSimple(item, kind) {
    var ab = S.userById(item.aanbiederId), ov = S.userById(item.overnemerId);
    var line, line2, ritLine = "";
    if (kind === "task") {
      line = svg("user", "icon-sm") + "Taak van: <strong>" + fullName(ab) + "</strong>" + miniStats(ab);
      line2 = "Neemt over: <strong>" + fullName(ov) + "</strong>" + miniStats(ov);
    } else if (kind === "callout") {
      line = svg("search", "icon-sm") + "Oproep van: <strong>" + fullName(ab) + "</strong>" + miniStats(ab) + " (zoekt shift)";
      line2 = "Geeft zijn shift: <strong>" + fullName(ov) + "</strong>" + miniStats(ov);
    } else { // backup
      var wantsDrive = item.direction !== "backup";
      line = svg("lifebuoy", "icon-sm") + (wantsDrive ? "Back-up: <strong>" + fullName(ab) + "</strong>" + miniStats(ab) + " wil rijden" : "<strong>" + fullName(ab) + "</strong>" + miniStats(ab) + " geeft rit, wil back-up");
      line2 = (wantsDrive ? "Geeft rit op: <strong>" + fullName(ov) + "</strong>" : "Neemt rit over: <strong>" + fullName(ov) + "</strong>") + miniStats(ov);
      if (item.ritOmschrijving) ritLine = '<div class="crow">' + svg("van", "icon-sm") + "Rit: <strong>" + esc(item.ritOmschrijving) + (item.ritTijd ? " · " + esc(item.ritTijd) : "") + "</strong></div>";
    }
    var badges = '<div class="badges">' + dagdeelBadge(item.dagdeel) + (kind === "task" ? taskBadge(item.taak) : "") + "</div>";
    return '<div class="card pending">' +
      '<div class="card-rows">' +
        '<div class="crow">' + svg("calendar", "icon-sm") + "<strong>" + esc(fmtDate(item.datum)) + "</strong>" + (item.starttijd ? " · " + esc(item.starttijd) : "") + "</div>" +
        '<div class="crow">' + line + "</div>" + ritLine + "<div class=\"crow\">" + svg("arrowRight", "icon-sm") + line2 + "</div>" +
        '<div class="crow tiny">' + svg("history", "icon-sm") + "Aangeboden " + esc(fmtDateTime(item.createdAt)) + "</div>" +
      "</div>" + badges +
      '<div class="card-foot">' +
        '<button class="btn btn-green" data-approve="' + kind + ":" + item.id + '">' + svg("check") + "Goedkeuren</button>" +
        '<button class="btn btn-red" data-reject="' + kind + ":" + item.id + '">' + svg("x") + "Afkeuren</button></div></div>";
  }

  function bindApprovals() {
    bindWeekBar("appr", "apprRef", "apprRange");
    document.querySelectorAll("[data-approve]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-approve").split(":");
        act(function () { decide(p[0], p[1], true, ""); }, "Ruiling goedgekeurd.");
      });
    });
    document.querySelectorAll("[data-reject]").forEach(function (b) {
      b.addEventListener("click", function () { var p = b.getAttribute("data-reject").split(":"); openRejectModal(p[0], p[1]); });
    });
  }
  function decide(kind, id, ok, reden) {
    if (kind === "task") S.decideTask(id, ok, reden);
    else if (kind === "backup") S.decideBackup(id, ok, reden);
    else if (kind === "callout") S.decideCallout(id, ok, reden);
    else S.decideShift(id, ok, reden);
  }
  function openRejectModal(kind, id) {
    openModal({
      title: "Ruiling afkeuren", icon: "xCircle",
      body: '<div class="field"><label>Reden <span style="color:var(--red)">*</span> (verplicht)</label><textarea id="rejReason" rows="3" placeholder="Bijv. te weinig bezetting…"></textarea></div>' +
        '<div class="hint">De aanbieder ziet deze reden en kiest zelf of de shift weer op het bord komt. Het besluit komt in de historie.</div>',
      foot: '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-red" id="rejConfirm">' + svg("x") + "Afkeuren</button>",
      onMount: function (ov, close) {
        ov.querySelector("#rejConfirm").addEventListener("click", function () {
          var reden = ov.querySelector("#rejReason").value.trim();
          if (!reden) { toast("Geef verplicht een reden op bij afkeuren.", "err"); ov.querySelector("#rejReason").focus(); return; }
          try { decide(kind, id, false, reden); toast("Ruiling afgekeurd.", "ok"); close(); renderApp(); }
          catch (e) { toast(e.message, "err"); }
        });
      }
    });
  }

  /* ===================================================================
     STATISTIEKEN
     =================================================================== */
  function viewStats() {
    var u = S.currentUser();
    if (state.statSort !== "shiftsOvergenomen" && state.statSort !== "shiftsAangeboden") state.statSort = "shiftsOvergenomen";
    if (!state.statRef) state.statRef = ymd(new Date());
    if (!state.statRange) state.statRange = "all";
    var wb = weekBounds(state.statRef);
    var wk = {};   // per-week telling uit de log (alleen goedgekeurde shiftwissels)
    if (state.statRange === "week") {
      S.logsForHub(u.hubId).forEach(function (l) {
        if (l.type !== "shiftwissel" || l.actie !== "goedgekeurd") return;
        var dd = (l.details && l.details.datum) || ""; if (dd < wb.monS || dd > wb.sunS) return;
        if (l.overnemerId) (wk[l.overnemerId] = wk[l.overnemerId] || { over: 0, weg: 0 }).over++;
        if (l.aanbiederId) (wk[l.aanbiederId] = wk[l.aanbiederId] || { over: 0, weg: 0 }).weg++;
      });
    }
    function statOf(x) { if (state.statRange === "week") return wk[x.id] || { over: 0, weg: 0 }; return { over: x.stats.shiftsOvergenomen, weg: x.stats.shiftsAangeboden }; }
    var users = S.usersForHub(u.hubId);
    if (state.statQ) {
      var q = state.statQ.toLowerCase();
      users = users.filter(function (x) { return (x.voornaam + " " + x.achternaam + " " + esc(x.email)).toLowerCase().indexOf(q) !== -1; });
    }
    var sf = state.statSort === "shiftsAangeboden" ? "weg" : "over";
    var sorted = users.slice().sort(function (a, b) { return statOf(b)[sf] - statOf(a)[sf]; });
    var rows = sorted.map(function (x) { var st = statOf(x);
      return "<tr><td><div class=\"cellname\">" + fullName(x) + "</div><div class=\"cellsub\">" + esc(S.roleMeta(x.rol).label) + "</div></td>" +
        '<td class="num up grp-start">' + st.over + "</td><td class=\"num down\">" + st.weg + "</td></tr>";
    }).join("");

    var sortSel = '<select class="pill-select" id="statSort">' +
      '<option value="shiftsOvergenomen"' + (state.statSort === "shiftsOvergenomen" ? " selected" : "") + ">Meeste overgenomen</option>" +
      '<option value="shiftsAangeboden"' + (state.statSort === "shiftsAangeboden" ? " selected" : "") + ">Meeste weggegeven</option></select>";

    // Overgenomen = groen, pijl omlaag · Weggegeven = rood, pijl omhoog
    var overH = '<span class="hcol up">' + svg("arrowDown", "icon-sm") + "Overgenomen</span>";
    var wegH = '<span class="hcol down">' + svg("arrowUp", "icon-sm") + "Weggegeven</span>";
    var search = '<div class="search"><span style="display:flex">' + svg("search", "icon-sm") + '</span><input id="statSearch" placeholder="Zoek medewerker…" value="' + esc(state.statQ || "") + '"></div>';
    return '<div class="page-head"><div><h2>Statistieken</h2><p>Telt alleen goedgekeurde ruilingen.</p></div></div>' +
      weekBar("stat", state.statRef, state.statRange) +
      '<div class="toolbar">' + search + '<div class="grow"></div><span class="cellsub" style="margin-right:8px">Sorteer:</span>' + sortSel + "</div>" +
      panel("users", "Per medewerker", tableScroll(
        "<thead><tr><th>Medewerker</th>" +
        '<th class="grp-start">' + overH + "</th><th>" + wegH + "</th></tr></thead><tbody>" +
        (rows || '<tr><td colspan="3"><div class="cellsub" style="padding:8px 0">Geen medewerkers gevonden.</div></td></tr>') + "</tbody>", true));
  }
  function bindStats() {
    bindWeekBar("stat", "statRef", "statRange");
    var s = el("statSort");
    if (s) s.addEventListener("change", function () { state.statSort = s.value; renderMain(); });
    var qs = el("statSearch");
    if (qs) qs.addEventListener("input", function () { state.statQ = qs.value; renderMain(); var n = el("statSearch"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
  }

  /* ===================================================================
     BEHEREN
     =================================================================== */
  function viewBeheer(embedded) {
    var u = S.currentUser();
    var tabs = [{ id: "team", label: "Medewerkers" }, { id: "hubs", label: "Hubs" }, { id: "tasks", label: "Taken" }];
    if (S.can.resetData(u)) tabs.push({ id: "data", label: "Gegevens" });
    if (!tabs.some(function (t) { return t.id === state.beheerTab; })) state.beheerTab = "team";

    var seg = '<div class="seg" style="margin-bottom:18px">' + tabs.map(function (t) {
      return '<button data-btab="' + t.id + '" class="' + (state.beheerTab === t.id ? "active" : "") + '">' + t.label + "</button>";
    }).join("") + "</div>";

    var body = state.beheerTab === "team" ? beheerTeam() : (state.beheerTab === "hubs" ? beheerHubs() : (state.beheerTab === "tasks" ? beheerTasks() : beheerData()));
    var head = embedded ? "" : '<div class="page-head"><div><h2>Beheren</h2><p>Medewerkers, functies, taken en hubs.</p></div></div>';
    return head + seg + body;
  }

  // Personeelsbeheer als los menu-item (onder "Planning"). Hergebruikt de beheer-view.
  // Functies die deze gebruiker mag toekennen: nooit boven het eigen niveau (beheerder: alles).
  function assignableRoles(u) { return S.ROLES.filter(function (r) { return S.isAdmin(u) || r.level <= S.level(u); }); }
  function renderPersoneelsbeheer() {
    reRender = renderPersoneelsbeheer;
    el("app").innerHTML = moduleShell("Personeelsbeheer", viewBeheer(true), { noShift: true });
    bindModuleHeader();
    bindBeheer();
    animateTab(el("app").querySelector("main"), "beheer:" + state.beheerTab);
  }

  function beheerTeam() {
    var u = S.currentUser();
    var canEdit = S.can.editTeam(u), canRoles = S.can.editRoles(u), showHub = false; // personeel is altijd per hub (hub-kolom niet nodig)
    var users = S.manageableUsers(u).slice().filter(function (x) {
      if (!state.teamQ) return true;
      var hub = S.hubById(x.hubId);
      return (x.voornaam + " " + x.achternaam + " " + x.email + " " + (hub ? hub.naam : "")).toLowerCase().indexOf(state.teamQ.toLowerCase()) !== -1;
    }).sort(function (a, b) { return S.level(b) - S.level(a) || a.voornaam.localeCompare(b.voornaam); });

    function roleOpts(sel) { return assignableRoles(u).map(function (r) { return '<option value="' + r.id + '"' + (sel === r.id ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join(""); }

    var rows = users.map(function (x) {
      var hub = S.hubById(x.hubId);
      var isSelf = x.id === u.id;
      // niemand wijzigt zijn eigen functie
      var roleCell = (canRoles && !isSelf) ? '<select class="pill-select role-select" data-role="' + x.id + '">' + roleOpts(x.rol) + "</select>" : '<span class="badge role">' + esc(S.roleMeta(x.rol).label) + "</span>";
      // iedereen heeft diesel; N2 is een extra bevoegdheid
      // N2-bevoegdheid: bliksem groen+gevuld = mag N2 rijden, grijs+leeg = niet.
      var boltSvg = '<svg class="icon" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';
      var n2Cell = canEdit
        ? '<button class="n2-bolt' + (x.n2 ? " on" : "") + '" data-n2="' + x.id + '" data-n2v="' + (x.n2 ? "1" : "0") + '" title="N2-bevoegdheid aan/uit">' + boltSvg + "</button>"
        : '<span class="n2-bolt' + (x.n2 ? " on" : "") + '" title="' + (x.n2 ? "Mag N2 rijden" : "Alleen diesel") + '">' + boltSvg + "</span>";
      var jbtCell = canEdit
        ? '<span class="chip jbt-chip ' + (x.jbtTrainer ? "on" : "") + '" data-jbt="' + x.id + '">' + svg("cap", "icon-sm") + "JBT-trainer</span>"
        : (x.jbtTrainer ? '<span class="badge jbt">' + svg("cap", "icon-sm") + "JBT-trainer</span>" : '<span class="cellsub">—</span>');
      var taskChips = S.assignableTasks(x).map(function (t) {
        var on = x.taken.indexOf(t) !== -1;
        var sr = S.taskType(t) === "senior" ? " task-senior" : "";
        if (canEdit) return '<span class="chip' + sr + " " + (on ? "on" : "") + '" data-utask="' + x.id + "|" + esc(t) + '">' + esc(t) + "</span>";
        return on ? '<span class="chip on' + sr + '">' + esc(t) + "</span>" : "";
      }).join("");
      // Teamleider/locatiemanager hebben geen bus/JBT/taken-opties nodig.
      if (S.level(x) >= 4) { n2Cell = '<span class="cellsub">—</span>'; jbtCell = '<span class="cellsub">—</span>'; taskChips = ""; }
      // Locatie-manager: manager thuisbezorging/beheerder koppelt hier extra hubs (de eigen hub staat vast).
      if (S.level(x) === 5 && S.overHubs(u)) {
        // Dropdown met vinkjes: eigen hub staat vast aangevinkt, de rest is aan/uit te zetten.
        var extra = x.hubIds || [], hubsAll = S.db.hubs.slice().sort(function (a, b) { return a.naam.localeCompare(b.naam); });
        var nSel = 1 + extra.filter(function (id) { return id !== x.hubId && S.hubById(id); }).length;
        var open = state.hubDropOpen === x.id;
        taskChips = '<div class="hubdrop' + (open ? " open" : "") + '" data-hubdrop="' + x.id + '">' +
          '<button type="button" class="btn btn-sm hubdrop-btn" data-hubdroptoggle="' + x.id + '">' + svg("building", "icon-sm") + "Hubs (" + nSel + ")" + svg("chevronDown", "icon-sm") + "</button>" +
          '<div class="hubdrop-menu">' + hubsAll.map(function (h) {
            var own = h.id === x.hubId, on = own || extra.indexOf(h.id) !== -1;
            return '<label class="hubdrop-item' + (own ? " own" : "") + '"><input type="checkbox"' + (on ? " checked" : "") + (own ? " disabled" : "") + ' data-uhubs="' + x.id + "|" + h.id + '"> ' + esc(h.naam) + (own ? ' <span class="cellsub">(eigen hub)</span>' : "") + "</label>";
          }).join("") + "</div></div>";
      } else if (S.level(x) >= 6) {
        taskChips = '<span class="cellsub">Alle hubs</span>';
      }
      var acct = "";
      if (x.mustSetPassword && x.otp) {
        acct = '<div class="otp-line">' + svg("key", "icon-sm") + "Eenmalige code: <code>" + esc(x.otp) + "</code>" +
          (canEdit ? ' <button class="link-btn" data-regen="' + x.id + '">' + svg("refresh", "icon-sm") + "nieuw</button>" : "") + "</div>";
      } else if (canEdit) {
        acct = '<button class="link-btn" data-regen="' + x.id + '">' + svg("key", "icon-sm") + "Reset wachtwoord</button>";
      }
      if (x.reviewed === false) {
        acct += '<div class="otp-line" style="color:var(--red)">' + svg("alertTri", "icon-sm") + "Nieuw geregistreerd" +
          (canEdit ? ' <button class="link-btn" data-review="' + x.id + '">' + svg("check", "icon-sm") + "gecontroleerd</button>" : "") + "</div>";
      }
      var delBtn = (canEdit && x.id !== u.id && !x.hidden && S.level(x) < S.level(u))
        ? '<div><button class="link-btn danger" data-deluser="' + x.id + '">' + svg("trash", "icon-sm") + "Verwijderen</button></div>"
        : "";
      var editBtn = S.isAdmin(u) ? '<div><button class="link-btn" data-edituser="' + x.id + '">' + svg("pencil", "icon-sm") + "Gegevens bewerken</button></div>" : "";

      return "<tr><td><div class=\"cellname\">" + fullName(x) + (x.id === u.id ? " (jij)" : "") + "</div><div class=\"cellsub\">" + esc(x.email) + "</div>" +
        (showHub ? '<div class="cellsub">HUB ' + esc(hub ? hub.naam : "?") + "</div>" : "") + editBtn + acct + delBtn + "</td>" +
        '<td data-th="Functie">' + roleCell + '</td><td data-th="N2">' + n2Cell + '</td><td data-th="JBT">' + jbtCell + "</td>" +
        '<td data-th="Taken"><div class="chips">' + (taskChips || '<span class="cellsub">—</span>') + "</div></td></tr>";
    }).join("");

    var addBtn = canEdit ? '<button class="btn btn-dark btn-sm" id="addUser">' + svg("userPlus", "icon-sm") + "Uitnodigingscode maken</button>" : "";
    var search = '<div class="search"><span style="display:flex">' + svg("search", "icon-sm") + '</span><input id="teamSearch" placeholder="Zoek medewerker…" value="' + esc(state.teamQ) + '"></div>';

    var openCodes = canEdit ? S.activeInviteCodes(u) : [];
    var codesPanel = "";
    if (openCodes.length) {
      var codeRows = openCodes.map(function (i) {
        var h = S.hubById(i.hubId);
        return "<tr><td class=\"cellname\"><code>" + esc(i.code) + "</code></td>" +
          '<td data-th="Hub" class="cellsub">HUB ' + esc(h ? h.naam : "?") + "</td>" +
          '<td data-th="Geldig tot" class="cellsub">' + fmtDate(i.expiresAt.slice(0, 10)) + "</td>" +
          '<td data-th="" style="text-align:right"><button class="btn btn-ghost btn-sm" data-revokecode="' + esc(i.code) + '">' + svg("trash", "icon-sm") + "Intrekken</button></td></tr>";
      }).join("");
      codesPanel = panel("key", "Openstaande uitnodigingscodes", tableScroll(
        "<thead><tr><th>Code</th><th>Hub</th><th>Geldig tot</th><th></th></tr></thead><tbody>" + codeRows + "</tbody>"));
    }

    return '<div class="toolbar">' + search + '<div class="grow"></div>' + addBtn + "</div>" + codesPanel +
      panel("users", "Medewerkers" + (showHub ? " (alle hubs)" : ""), tableScroll(
        "<thead><tr><th>Medewerker</th><th>Functie</th><th>N2</th><th>JBT</th><th>Taken</th></tr></thead><tbody>" +
        (rows || '<tr><td colspan="5"><div class="cellsub" style="padding:8px 0">Geen medewerkers gevonden.</div></td></tr>') + "</tbody>"));
  }

  function beheerHubs() {
    var u = S.currentUser();
    var canEdit = S.can.editHubs(u);
    var hubs = S.db.hubs.slice().sort(function (a, b) { return a.naam.localeCompare(b.naam); });
    var rows = hubs.map(function (h) {
      var count = S.usersForHub(h.id).length;
      return "<tr><td class=\"cellname\">HUB " + esc(h.naam) + '</td><td class="cellsub" data-th="Medewerkers">' + count + " medewerker" + (count === 1 ? "" : "s") + "</td>" +
        (canEdit ? '<td data-th="" style="text-align:right"><button class="btn btn-ghost btn-sm" data-delhub="' + h.id + '">' + svg("trash", "icon-sm") + "Verwijderen</button></td>" : "<td></td>") + "</tr>";
    }).join("");
    var extra = canEdit ? '<div style="flex:1"></div><div class="add-inline"><input id="newHub" placeholder="Nieuwe hubnaam"><button class="btn btn-dark btn-sm" id="addHub">' + svg("plus", "icon-sm") + "Toevoegen</button></div>"
      : '<div style="flex:1"></div><span class="locked-note" style="margin:0">' + svg("lock", "icon-sm") + "Alleen-lezen</span>";
    return panel("building", "Hubs", tableScroll("<tbody>" + rows + "</tbody>"), extra);
  }

  function beheerTasks() {
    var u = S.currentUser();
    var canEdit = S.can.editCatalog(u);
    var cat = S.db.taskCatalog.slice().sort(function (a, b) { return a.localeCompare(b); });
    var rows = cat.map(function (t) {
      var senior = S.taskType(t) === "senior";
      var typeCell = canEdit
        ? '<div class="seg mini type-seg"><button class="' + (!senior ? "active" : "") + '" data-tasktype="' + esc(t) + '|bezorger">Bezorger</button>' +
          '<button class="' + (senior ? "active sr" : "") + '" data-tasktype="' + esc(t) + '|senior">Senior</button></div>'
        : '<span class="badge ' + (senior ? "bd" : "task") + '">' + (senior ? "Senior-taak" : "Bezorger-taak") + "</span>";
      return "<tr><td class=\"cellname\">" + esc(t) + '</td><td data-th="Type">' + typeCell + "</td>" +
        (canEdit ? '<td data-th="" style="text-align:right"><button class="btn btn-ghost btn-sm" data-deltask="' + esc(t) + '">' + svg("trash", "icon-sm") + "Verwijderen</button></td>" : "<td></td>") + "</tr>";
    }).join("");
    var special = "<tr><td class=\"cellname\">" + esc(S.TASK_JBT) + '</td><td data-th="Type"><span class="badge jbt">' + svg("cap", "icon-sm") + "Alleen JBT-trainers</span></td><td></td></tr>";
    var extra = canEdit
      ? '<div style="flex:1"></div><div class="add-inline"><input id="newTask" placeholder="Nieuwe taak">' +
        '<select id="newTaskType" class="pill-select"><option value="bezorger">Bezorger-taak</option><option value="senior">Senior-taak</option></select>' +
        '<button class="btn btn-dark btn-sm" id="addTask">' + svg("plus", "icon-sm") + "Toevoegen</button></div>"
      : '<div style="flex:1"></div><span class="locked-note" style="margin:0">' + svg("lock", "icon-sm") + "Alleen-lezen</span>";
    return panel("tag", "Takenlijst", tableScroll("<thead><tr><th>Taak</th><th>Type</th><th></th></tr></thead><tbody>" + (rows || "") + special + "</tbody>"), extra);
  }

  function beheerData() {
    return '<div class="panel"><div class="panel-head">' + svg("shield") + "<h3>Gegevens</h3></div>" +
      '<div style="padding:18px"><p style="margin:0 0 14px;color:var(--ink-soft);font-weight:600">Alle gegevens staan centraal in de database op de server en worden realtime gedeeld met alle apparaten.</p>' +
      '<button class="btn btn-red" id="resetData">' + svg("trash", "icon-sm") + "Alle gegevens wissen &amp; opnieuw beginnen</button></div></div>";
  }

  var lastCodesJson = null; // voorkomt een hertekende-lus bij het ophalen van open codes
  function bindBeheer() {
    // Open uitnodigingscodes komen van de server (niet uit de gedeelde staat); haal ze op en herteken één keer.
    if (state.beheerTab === "team" && S.can.editTeam(S.currentUser())) {
      S.fetchInviteCodes().then(function (list) {
        var j = JSON.stringify(list || []);
        if (j !== lastCodesJson) { lastCodesJson = j; (reRender || renderMain)(); }
      });
    }
    document.querySelectorAll("[data-btab]").forEach(function (b) { b.addEventListener("click", function () { state.beheerTab = b.getAttribute("data-btab"); lastCodesJson = null; (reRender || renderMain)(); }); });
    var ts = el("teamSearch");
    if (ts) ts.addEventListener("input", function () { state.teamQ = ts.value; (reRender || renderMain)(); var n = el("teamSearch"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
    document.querySelectorAll("[data-role]").forEach(function (s) { s.addEventListener("change", function () { act(function () { S.setUserRole(s.getAttribute("data-role"), s.value); }, "Functie bijgewerkt."); }); });
    document.querySelectorAll("button[data-n2]").forEach(function (b) { b.addEventListener("click", function () { act(function () { S.setUserN2(b.getAttribute("data-n2"), b.getAttribute("data-n2v") !== "1"); }, "N2-bevoegdheid bijgewerkt."); }); });
    document.querySelectorAll("[data-tasktype]").forEach(function (b) { b.addEventListener("click", function () { var p = b.getAttribute("data-tasktype").split("|"); act(function () { S.setTaskType(p[0], p[1]); }, "Taaktype bijgewerkt."); }); });
    document.querySelectorAll("[data-jbt]").forEach(function (c) { c.addEventListener("click", function () { var id = c.getAttribute("data-jbt"); var t = S.userById(id); act(function () { S.setUserJbt(id, !t.jbtTrainer); }, "JBT-trainer bijgewerkt."); }); });
    document.querySelectorAll("[data-hubdroptoggle]").forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); var id = b.getAttribute("data-hubdroptoggle"); state.hubDropOpen = state.hubDropOpen === id ? null : id; reRender(); });
    });
    document.querySelectorAll(".hubdrop-menu").forEach(function (m) { m.addEventListener("click", function (ev) { ev.stopPropagation(); }); });
    if (state.hubDropOpen) document.addEventListener("click", function closeHubDrop() { document.removeEventListener("click", closeHubDrop); if (state.hubDropOpen) { state.hubDropOpen = null; reRender(); } });
    document.querySelectorAll("[data-uhubs]").forEach(function (c) {
      c.addEventListener("change", function () {
        var p = c.getAttribute("data-uhubs").split("|"), t = S.userById(p[0]); if (!t) return;
        var cur = (t.hubIds || []).slice(), i = cur.indexOf(p[1]);
        if (c.checked && i === -1) cur.push(p[1]); else if (!c.checked && i !== -1) cur.splice(i, 1);
        try { S.setUserHubs(p[0], cur); reRender(); } catch (e) { toast(e.message, "err"); }
      });
    });
    document.querySelectorAll("[data-utask]").forEach(function (c) { c.addEventListener("click", function () { var p = c.getAttribute("data-utask").split("|"); act(function () { S.toggleUserTask(p[0], p[1]); }, "Taken bijgewerkt."); }); });
    document.querySelectorAll("[data-regen]").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-regen"); S.regenerateOtp(id).then(function (otp) { showOtpModal(S.userById(id), otp); (reRender || renderApp)(); }).catch(function (e) { toast(e.message, "err"); }); }); });
    document.querySelectorAll("[data-review]").forEach(function (b) { b.addEventListener("click", function () { act(function () { S.markUserReviewed(b.getAttribute("data-review")); }, "Account gecontroleerd."); }); });
    document.querySelectorAll("[data-revokecode]").forEach(function (b) { b.addEventListener("click", function () { var code = b.getAttribute("data-revokecode"); S.revokeInviteCode(code).then(function () { return S.fetchInviteCodes(); }).then(function () { toast("Code ingetrokken.", "ok"); (reRender || renderApp)(); }).catch(function (e) { toast(e.message, "err"); }); }); });
    document.querySelectorAll("[data-edituser]").forEach(function (b) { b.addEventListener("click", function () { var t = S.userById(b.getAttribute("data-edituser")); if (t) openEditUserInfo(t); }); });
    document.querySelectorAll("[data-deluser]").forEach(function (b) { b.addEventListener("click", function () {
      var id = b.getAttribute("data-deluser"); var t = S.userById(id); if (!t) return;
      openModal({ title: "Medewerker verwijderen?", icon: "trash",
        body: '<p style="margin:0;color:var(--ink-soft);font-weight:600">Weet je zeker dat je <b>' + fullName(t) + "</b> wilt verwijderen? Het account en de openstaande ruilverzoeken van deze persoon worden verwijderd. Dit kan niet ongedaan worden gemaakt.</p>",
        foot: '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-red" id="cdu">' + svg("trash", "icon-sm") + "Verwijderen</button>",
        onMount: function (ov, close) { ov.querySelector("#cdu").addEventListener("click", function () { try { S.removeUser(id); close(); (reRender || renderApp)(); toast("Medewerker verwijderd.", "ok"); } catch (e) { toast(e.message, "err"); } }); } });
    }); });
    var ah = el("addHub"); if (ah) ah.addEventListener("click", function () { act(function () { S.addHub(el("newHub").value); }, "Hub toegevoegd."); });
    document.querySelectorAll("[data-delhub]").forEach(function (b) { b.addEventListener("click", function () { act(function () { S.removeHub(b.getAttribute("data-delhub")); }, "Hub verwijderd."); }); });
    var at = el("addTask"); if (at) at.addEventListener("click", function () { var ty = el("newTaskType") ? el("newTaskType").value : "bezorger"; act(function () { S.addCatalogTask(el("newTask").value, ty); }, "Taak toegevoegd."); });
    document.querySelectorAll("[data-deltask]").forEach(function (b) { b.addEventListener("click", function () { act(function () { S.removeCatalogTask(b.getAttribute("data-deltask")); }, "Taak verwijderd."); }); });
    var au = el("addUser"); if (au) au.addEventListener("click", openAddUser);
    var rd = el("resetData"); if (rd) rd.addEventListener("click", function () {
      openModal({ title: "Weet je het zeker?", icon: "trash",
        body: '<p style="margin:0;color:var(--ink-soft);font-weight:600">Alle accounts, ruilingen en de historie in de database worden gewist en alleen de basisgegevens (hubs + takenlijst) worden opnieuw aangemaakt. Dit kan niet ongedaan worden gemaakt.</p>',
        foot: '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-red" id="cr">' + svg("trash", "icon-sm") + "Wissen</button>",
        onMount: function (ov, close) { ov.querySelector("#cr").addEventListener("click", function () { S.resetDemo().then(function () { close(); authScreen = "landing"; render(); toast("Gegevens gewist.", "ok"); }).catch(function (e) { toast(e.message, "err"); }); }); } });
    });
  }

  // Teamleider+ geeft alleen een code uit; de medewerker registreert zichzelf (voor-/achternaam, personeelsnr, e-mail, wachtwoord) op de inlogpagina.
  function openAddUser() {
    S.createInviteCode().then(function (inv) { showInviteModal(inv); return S.fetchInviteCodes(); }).then(function () { (reRender || renderApp)(); }).catch(function (e) { toast(e.message, "err"); });
  }
  function showInviteModal(inv) {
    var hub = S.hubById(inv.hubId);
    openModal({
      title: "Uitnodigingscode klaar", icon: "key",
      body: '<p style="margin:0 0 14px;color:var(--ink-soft);font-weight:600">Geef deze code aan de nieuwe medewerker. Die vult op de inlogpagina via "Registreren" zelf zijn/haar gegevens in en start als Bezorger bij HUB ' + esc(hub ? hub.naam : "?") + ".</p>" +
        '<div class="otp-big">' + esc(inv.code) + "</div>" +
        '<div class="hint" style="text-align:center;margin-top:10px">Geldig tot ' + fmtDate(inv.expiresAt.slice(0, 10)) + ", eenmalig te gebruiken.</div>",
      foot: '<button class="btn btn-primary btn-block" data-close>' + svg("check") + "Begrepen</button>"
    });
  }
  // Naam, HR-nummer en e-mailadres van een medewerker aanpassen (teamleider+, Personeelsbeheer).
  function openEditUserInfo(x) {
    openModal({
      title: "Gegevens bewerken", icon: "pencil",
      body: '<form id="editInfoForm">' +
        '<div class="field"><label>Voornaam</label><input name="voornaam" value="' + esc(x.voornaam) + '" required></div>' +
        '<div class="field"><label>Achternaam</label><input name="achternaam" value="' + esc(x.achternaam) + '" required></div>' +
        '<div class="field"><label>HR-nummer</label><input name="personeelsnummer" value="' + esc(x.personeelsnummer) + '" required></div>' +
        '<div class="field"><label>E-mailadres</label><input type="email" name="email" value="' + esc(x.email) + '" required></div>' +
        '<div id="editInfoMsg"></div>' +
      "</form>",
      foot: '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-primary" id="editInfoSave">' + svg("check", "icon-sm") + "Opslaan</button>",
      onMount: function (ov, close) {
        ov.querySelector("#editInfoSave").addEventListener("click", function () {
          var f = ov.querySelector("#editInfoForm");
          var msg = ov.querySelector("#editInfoMsg");
          try {
            S.updateUserInfo(x.id, { voornaam: f.voornaam.value, achternaam: f.achternaam.value, personeelsnummer: f.personeelsnummer.value, email: f.email.value });
            toast("Gegevens opgeslagen.", "ok"); close(); (reRender || renderApp)();
          } catch (e) { msg.innerHTML = '<div class="alert alert-error">' + esc(e.message) + "</div>"; }
        });
      }
    });
  }
  function showOtpModal(user, otp) {
    openModal({
      title: "Account klaar", icon: "key",
      body: '<p style="margin:0 0 14px;color:var(--ink-soft);font-weight:600">Geef deze eenmalige code aan <b>' + fullName(user) + "</b>. Bij de eerste keer inloggen stelt de medewerker zelf een wachtwoord in.</p>" +
        '<div class="otp-big">' + esc(otp) + "</div>" +
        '<div class="hint" style="text-align:center;margin-top:10px">Inloggen met <code>' + esc(user.email) + "</code> + deze code.</div>",
      foot: '<button class="btn btn-primary btn-block" data-close>' + svg("check") + "Begrepen</button>"
    });
  }

  /* ===================================================================
     HISTORIE (logboek)
     =================================================================== */
  function viewLog() {
    var u = S.currentUser();
    if (!state.logRef) state.logRef = ymd(new Date());
    if (!state.logRange) state.logRange = "week";
    if (state.logType === "taakwissel") state.logType = "all"; // taak-aanbieden vervallen
    var wb = weekBounds(state.logRef);
    var logs = S.logsForHub(u.hubId).filter(function (l) {
      if (state.logRange === "week") { var dd = (l.details && l.details.datum) || ""; if (dd < wb.monS || dd > wb.sunS) return false; }
      if (state.logType !== "all" && l.type !== state.logType) return false;
      if (!state.logQ) return true;
      var ab = S.userById(l.aanbiederId), ov = S.userById(l.overnemerId), by = S.userById(l.doorId);
      var hay = (ab ? ab.voornaam + " " + ab.achternaam : "") + " " + (ov ? ov.voornaam + " " + ov.achternaam : "") + " " + (by ? by.voornaam + " " + by.achternaam : "") + " " + fmtDate(l.details.datum) + " " + (l.details.taak || "");
      return hay.toLowerCase().indexOf(state.logQ.toLowerCase()) !== -1;
    });
    function logItem(l) {
      var ok = l.actie === "goedgekeurd";
      var ab = S.userById(l.aanbiederId), ov = S.userById(l.overnemerId), by = S.userById(l.doorId);
      var d = l.details || {};
      var label = l.type === "shiftwissel" ? "Shiftwissel" : (l.type === "taakwissel" ? "Taakwissel" : (l.type === "oproep" ? "Oproep" : "Back-up"));
      var what = label + " — " + (d.dagdeel || "") + (d.starttijd ? " " + d.starttijd : "") + (d.taak ? " · " + d.taak : "") + (d.busType ? " · " + d.busType : "");
      var undo = S.can.isApprover(u) ? ' · <button class="link-btn" data-undolog="' + l.id + '">' + svg("refresh", "icon-sm") + "Herzien</button>" : "";
      return '<div class="log-item"><div class="log-dot ' + (ok ? "ok" : "no") + '">' + svg(ok ? "check" : "x", "icon-sm") + "</div>" +
        '<div class="log-body"><div class="l-title">' + esc(what) + ' — <span style="color:' + (ok ? "var(--green)" : "var(--red)") + '">' + (ok ? "Goedgekeurd" : "Afgekeurd") + "</span></div>" +
          '<div class="l-desc">' + fullName(ab) + " " + inlineArrow() + " " + fullName(ov) + (l.reden ? " — <em>" + esc(l.reden) + "</em>" : "") + "</div>" +
          '<div class="l-meta">Beoordeeld door ' + fullName(by) + " · " + fmtDateTime(l.timestamp) + undo + "</div></div></div>";
    }
    // groeperen per dag (van de ruiling)
    var byDay = {}, order = [];
    logs.forEach(function (l) { var d = (l.details && l.details.datum) || "—"; if (!byDay[d]) { byDay[d] = []; order.push(d); } byDay[d].push(l); });
    order.sort(function (a, b) { return a < b ? 1 : -1; }); // nieuwste dag eerst
    var inner = logs.length ? order.map(function (day) {
      return '<div class="log-day"><div class="log-day-h">' + svg("calendar", "icon-sm") + (day === "—" ? "Onbekend" : esc(fmtDate(day))) + "</div>" + byDay[day].map(logItem).join("") + "</div>";
    }).join("") : emptyState("history", "Niets gevonden", "Er zijn geen beslissingen die aan je zoekopdracht voldoen.");

    var typeSeg = '<div class="seg mini">' +
      '<button data-ltype="all" class="' + (state.logType === "all" ? "active" : "") + '">Alles</button>' +
      '<button data-ltype="shiftwissel" class="' + (state.logType === "shiftwissel" ? "active" : "") + '">Shifts</button>' +
      '<button data-ltype="oproep" class="' + (state.logType === "oproep" ? "active" : "") + '">Oproepen</button>' +
      '<button data-ltype="backup" class="' + (state.logType === "backup" ? "active" : "") + '">Back-up</button></div>';

    return '<div class="page-head"><div><h2>Historie</h2><p>Alle goed- en afkeuringen binnen jouw hub.</p></div></div>' +
      weekBar("log", state.logRef, state.logRange) +
      '<div class="toolbar">' + typeSeg + '<div class="grow"></div><div class="search">' + svg("search", "icon-sm") + '<input id="logSearch" placeholder="Zoek op naam, datum of taak…" value="' + esc(state.logQ) + '"></div></div>' +
      '<div class="panel"><div>' + inner + "</div></div>";
  }
  function inlineArrow() { return '<svg class="icon icon-sm" style="display:inline;vertical-align:-3px;color:var(--muted)" viewBox="0 0 24 24">' + P.arrowRight + "</svg>"; }
  function bindLog() {
    bindWeekBar("log", "logRef", "logRange");
    document.querySelectorAll("[data-undolog]").forEach(function (b) { b.addEventListener("click", function () { act(function () { S.undoDecision(b.getAttribute("data-undolog")); }, "Beslissing herzien — staat weer bij Goedkeuren."); }); });
    document.querySelectorAll("[data-ltype]").forEach(function (b) { b.addEventListener("click", function () { state.logType = b.getAttribute("data-ltype"); renderMain(); }); });
    var s = el("logSearch"); if (s) s.addEventListener("input", function () { state.logQ = s.value; var m = el("main"); m.innerHTML = viewLog(); bindLog(); var n = el("logSearch"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
  }

  /* ===================================================================
     MEDEWERKERDETAIL (klik op naam)
     =================================================================== */
  function udStat(dir, val, lab) {
    return '<div class="stat-card"><div class="s-ico ' + dir + '">' + svg(dir === "up" ? "arrowUp" : "arrowDown") + '</div><div class="s-val">' + val + '</div><div class="s-lab">' + esc(lab) + "</div></div>";
  }
  function openUserDetail(uid) {
    function body() {
      var me = S.currentUser(); var t = S.userById(uid); if (!t) return "";
      var canTeam = S.can.editTeam(me); var canRoles = S.can.editRoles(me) && t.id !== me.id;
      var seeStats = S.level(me) >= 4 || t.id === me.id;
      var hub = S.hubById(t.hubId);
      var head = '<div class="prof-head"><div class="avatar lg">' + initials(t) + '</div><div><div class="prof-name">' + fullName(t) +
        '</div><div class="cellsub">' + esc(S.roleMeta(t.rol).label) + " · HUB " + esc(hub ? hub.naam : "?") + "</div></div></div>";
      var stats = seeStats ? '<div class="prof-divider">Statistieken</div><div class="stat-grid ud-stats">' +
        udStat("up", t.stats.shiftsOvergenomen, "Shifts overgenomen") + udStat("down", t.stats.shiftsAangeboden, "Shifts weggegeven") +
        udStat("up", t.stats.takenOvergenomen, "Taken overgenomen") + udStat("down", t.stats.takenAangeboden, "Taken weggegeven") + "</div>" : "";
      var edit = "";
      if (canTeam) {
        edit += '<div class="prof-divider">Beheer</div>';
        edit += '<div class="ud-row"><span>Functie</span>' + (canRoles
          ? '<select class="pill-select" data-udrole>' + assignableRoles(S.currentUser()).map(function (r) { return '<option value="' + r.id + '"' + (t.rol === r.id ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + "</select>"
          : '<span class="badge role">' + esc(S.roleMeta(t.rol).label) + "</span>") + "</div>";
        edit += '<div class="ud-row"><span>N2-bevoegdheid</span><label class="toggle"><input type="checkbox" data-udn2 ' + (t.n2 ? "checked" : "") + '><span class="track"></span></label></div>';
        edit += '<div class="ud-row"><span>JBT-trainer</span><label class="toggle"><input type="checkbox" data-udjbt ' + (t.jbtTrainer ? "checked" : "") + '><span class="track"></span></label></div>';
        edit += '<div class="ud-tasks"><div class="ud-tasks-l">Taken (mag uitvoeren)</div><div class="chips">' +
          S.assignableTasks(t).map(function (tk) { var on = t.taken.indexOf(tk) !== -1; var sr = S.taskType(tk) === "senior" ? " task-senior" : ""; return '<span class="chip' + sr + (on ? " on" : "") + '" data-udtask="' + esc(tk) + '">' + esc(tk) + "</span>"; }).join("") + "</div></div>";
      }
      return head + stats + edit;
    }
    function bind(ov) {
      function rr() { ov.querySelector(".modal-body").innerHTML = body(); bind(ov); renderApp(); }
      var role = ov.querySelector("[data-udrole]"); if (role) role.addEventListener("change", function () { try { S.setUserRole(uid, role.value); toast("Functie bijgewerkt.", "ok"); rr(); } catch (e) { toast(e.message, "err"); } });
      var n2 = ov.querySelector("[data-udn2]"); if (n2) n2.addEventListener("change", function () { try { S.setUserN2(uid, n2.checked); toast("N2 bijgewerkt.", "ok"); rr(); } catch (e) { toast(e.message, "err"); } });
      var jbt = ov.querySelector("[data-udjbt]"); if (jbt) jbt.addEventListener("change", function () { try { S.setUserJbt(uid, jbt.checked); toast("JBT bijgewerkt.", "ok"); rr(); } catch (e) { toast(e.message, "err"); } });
      ov.querySelectorAll("[data-udtask]").forEach(function (c) { c.addEventListener("click", function () { try { S.toggleUserTask(uid, c.getAttribute("data-udtask")); rr(); } catch (e) { toast(e.message, "err"); } }); });
    }
    openModal({ title: "Medewerker", icon: "user", body: body(), onMount: function (ov) { bind(ov); } });
  }

  /* ===================================================================
     PROFIEL
     =================================================================== */
  function openProfile() {
    var u = S.currentUser();
    var hub = S.hubById(u.hubId);
    function locked(label, val) {
      return '<div class="prof-row"><div class="prof-l">' + esc(label) + "</div><div class=\"prof-v\">" + esc(val) + svg("lock", "icon-sm") + "</div></div>";
    }
    var body =
      '<div class="prof-head"><div class="avatar lg">' + initials(u) + "</div><div><div class=\"prof-name\">" + fullName(u) + "</div><div class=\"cellsub\">" + esc(S.roleMeta(u.rol).label) + "</div></div></div>" +
      '<div class="prof-divider">Mijn gegevens</div>' +
      '<form id="infoForm">' +
        '<div class="field"><label>Voornaam</label><input name="voornaam" value="' + esc(u.voornaam) + '" required></div>' +
        '<div class="field"><label>Achternaam</label><input name="achternaam" value="' + esc(u.achternaam) + '" required></div>' +
        '<div class="field"><label>E-mailadres</label><input type="email" name="email" value="' + esc(u.email) + '" required></div>' +
        '<div id="infoMsg"></div>' +
      "</form>" +
      '<div style="display:flex;justify-content:flex-end;margin:-6px 0 16px">' +
        '<button class="btn btn-dark btn-sm" id="infoSave">' + svg("check", "icon-sm") + "Gegevens opslaan</button></div>" +
      '<div class="prof-info">' +
        locked("HR-nummer", u.personeelsnummer) +
        locked("Hub", "HUB " + (hub ? hub.naam : "?")) +
        locked("Functie", S.roleMeta(u.rol).label) +
        locked("Bus", u.n2 ? "Diesel + N2" : "Alleen diesel") +
        (u.jbtTrainer ? locked("JBT-trainer", "Ja") : "") +
      "</div>" +
      '<div class="prof-divider">Weergave</div>' +
      '<div class="seg theme-seg">' +
        '<button data-set-theme="light"' + (userTheme(u) === "light" ? ' class="active"' : "") + ">" + sunIcon() + " Licht</button>" +
        '<button data-set-theme="dark"' + (userTheme(u) === "dark" ? ' class="active"' : "") + ">" + moonIcon() + " Donker</button>" +
      "</div>" +
      '<div class="prof-divider">Wachtwoord wijzigen</div>' +
      '<form id="cpForm">' +
        '<div class="field"><label>Huidig wachtwoord</label>' + pwInput("old", "", " required") + "</div>" +
        '<div class="field"><label>Nieuw wachtwoord</label>' + pwInput("n1", "Min. 4 tekens", " required") + "</div>" +
        '<div class="field"><label>Herhaal nieuw wachtwoord</label>' + pwInput("n2", "", " required") + "</div>" +
        '<div id="cpMsg"></div>' +
      "</form>";
    openModal({
      title: "Mijn profiel", icon: "userCog", body: body,
      foot: '<button class="btn btn-ghost" data-close>Sluiten</button><button class="btn btn-primary" id="cpSave">' + svg("key", "icon-sm") + "Wachtwoord opslaan</button>",
      onMount: function (ov, close) {
        ov.querySelector("#infoSave").addEventListener("click", function () {
          var f = ov.querySelector("#infoForm");
          var msg = ov.querySelector("#infoMsg");
          try {
            S.updateUserInfo(u.id, { voornaam: f.voornaam.value, achternaam: f.achternaam.value, email: f.email.value });
            toast("Gegevens opgeslagen.", "ok"); close(); render();
          } catch (e) { msg.innerHTML = '<div class="alert alert-error">' + esc(e.message) + "</div>"; }
        });
        ov.querySelector("#cpSave").addEventListener("click", function () {
          var f = ov.querySelector("#cpForm");
          var msg = ov.querySelector("#cpMsg");
          if (f.n1.value !== f.n2.value) { msg.innerHTML = '<div class="alert alert-error">De nieuwe wachtwoorden komen niet overeen.</div>'; return; }
          S.changeOwnPassword(f.old.value, f.n1.value)
            .then(function () { toast("Wachtwoord gewijzigd.", "ok"); close(); })
            .catch(function (e) { msg.innerHTML = '<div class="alert alert-error">' + esc(e.message) + "</div>"; });
        });
      }
    });
  }

  /* ===================================================================
     ROOT
     =================================================================== */
  function render() {
    var u = S.currentUser();
    el("app").classList.remove("dash-page"); // renderDashboard zet 'm zelf weer aan op het overzicht
    if (u) {
      if (u.mustSetPassword) { applyUserTheme(u); renderForcePassword(u); }
      else if (state.showLanding) { document.documentElement.setAttribute("data-theme", "dark"); renderLanding(); }   // voorpagina: altijd donker
      else if (!state.module) { applyUserTheme(u); renderPortal(); }
      else if (state.module === "ruilhub") { applyUserTheme(u); renderApp(); }
      else { applyUserTheme(u); renderModulePage(); }
    } else {
      document.documentElement.setAttribute("data-theme", "dark");   // landing & login: altijd donker
      if (authScreen === "login") renderLogin();
      else if (authScreen === "register-code") renderRegisterCode();
      else if (authScreen === "register-form") renderRegisterForm();
      else renderLanding();
    }
  }

  /* ===================================================================
     PORTAAL (keuzemenu)
     =================================================================== */
  function portalModules(u) {
    var senior = S.level(u) >= 3;
    function hasTask(n) { return u.taken && u.taken.indexOf(n) !== -1; }
    var m = [{ id: "ruilhub", name: "RuilHub", icon: "exchange", color: "yellow", group: "Planning", desc: "Shifts en taken ruilen binnen je hub." }];
    // Takenplanning tijdelijk verborgen (op verzoek volledig eruit).
    if (S.can.seeBeheer(u)) m.push({ id: "personeelsbeheer", name: "Personeelsbeheer", icon: "userCog", color: "teal", group: "Beheer", desc: "Medewerkers, functies, taken en hubs." });
    if (S.can.seeBussenbeheer(u)) m.push({ id: "bussenbeheer", name: "Bussenbeheer", icon: "van", color: "gray", group: "Beheer", desc: "Bussen per shift, met focus op probleembussen." });
    if (S.tempCanArchive(u)) m.push({ id: "temparchief", name: "Temperatuurarchief", icon: "thermo", color: "red", group: "Beheer", desc: "Dagoverzicht van alle temperatuurcontroles (RF 11 HUB)." });
    // Proces-volgorde: Senior Dashboard, Laadproces, Schadecontrole, Kwaliteit.
    if (senior) m.push({ id: "dashboard", name: "Senior Dashboard", icon: "chart", color: "dark", group: "Proces", desc: "Realtime overzicht van de shift." });
    // Bezorgers zien een procesmodule zodra ze de bijbehorende taak toegewezen krijgen (personeelsbeheer).
    if (senior || hasTask("LC") || hasTask("Laden")) m.push({ id: "lc", name: "Laadproces", icon: "inbox", color: "orange", group: "Proces", desc: "Ritten koppelen aan bussen & trolleys." });
    if (senior || hasTask("Schadecontrole")) m.push({ id: "schadecontrole", name: "Schadecontrole", icon: "shield", color: "green", group: "Proces", desc: "Bussen controleren & afvinken." });
    if (senior || hasTask("Kwaliteit")) m.push({ id: "kwaliteit", name: "Kwaliteit", icon: "award", color: "purple", group: "Proces", desc: "Emballage tellen per vak." });
    if (senior || hasTask("Buswassing")) m.push({ id: "buswassing", name: "Buswassing", icon: "droplet", color: "blue", group: "Proces", desc: "Bussen afvinken die gewassen moeten worden." });
    return m;
  }

  function portalHeader(u, showBack) {
    var hub = S.hubById(u.hubId);
    return '<header class="app-header portal-header"><div class="app-header-inner">' +
      (showBack ? '<button class="btn btn-icon portal-btn" data-portal title="Naar het menu">' + svg("grid", "icon-sm") + "</button>" : "") +
      '<div class="brand" data-home role="button" title="Naar de voorpagina"><span class="logo-badge">' + logo(40) + "</span>" +
        '<div><div class="app-name">' + PORTAL + '</div><div class="app-sub">Bezorgservice · HUB ' + esc(hub ? hub.naam : "?") + "</div></div></div>" +
      '<div class="header-spacer"></div>' +
      '<div class="user-chip">' +
        '<div style="text-align:right"><div class="u-name">' + fullName(u) + "</div>" +
          '<div class="u-meta">' + esc(S.roleMeta(u.rol).label) + "</div></div>" +
        '<button class="avatar-btn" data-profile title="Profiel"><span class="avatar">' + initials(u) + "</span>" +
          '<span class="avatar-gear">' + svg("settings", "icon-sm") + "</span></button>" +
        '<button class="btn btn-icon btn-ghost" data-logout title="Uitloggen" style="background:rgba(255,255,255,.5)">' + svg("logout", "icon-sm") + "</button>" +
      "</div></div></header>";
  }

  function renderPortal() {
    var u = S.currentUser();
    var mods = portalModules(u);
    function tileHTML(m) {
      return '<button class="tile tile-' + m.color + '" data-module="' + m.id + '">' +
        '<span class="tile-ico">' + svg(m.icon, "icon-lg") + "</span>" +
        '<span class="tile-name">' + esc(m.name) + "</span></button>"; // geen uitlegregel onder de naam (op verzoek)
    }
    var sections = ["Planning", "Proces", "Beheer"].map(function (g) {
      var gm = mods.filter(function (m) { return (m.group || "Proces") === g; });
      if (!gm.length) return "";
      return '<section class="portal-group"><h3 class="portal-group-title">' + esc(g) + "</h3>" +
        '<div class="tile-grid">' + gm.map(tileHTML).join("") + "</div></section>";
    }).join("");
    var pending = S.can.seeBeheer(u) ? S.pendingReviewUsers(u) : [];
    var pendingBanner = pending.length
      ? '<div class="alert alert-info" style="display:flex;align-items:center;gap:10px;margin-bottom:18px">' +
          svg("alertTri", "icon-sm") + '<div style="flex:1">' + pending.length + " nieuw" + (pending.length === 1 ? " account" : "e accounts") +
          " via een uitnodigingscode geregistreerd — controleer of de gegevens kloppen.</div>" +
          '<button class="btn btn-dark btn-sm" data-goto-beheer>' + svg("userCog", "icon-sm") + "Bekijken</button></div>"
      : "";
    // Manager Thuisbezorging (en beheerder) kiest hier de hub die de app toont; onthouden per gebruiker.
    var hubPicker = "";
    if (S.canSwitchHub(u)) {
      var hubs = S.hubsFor(S.userById(u.id)); // manager/beheerder: alle hubs; locatie-manager: eigen + gekoppelde hubs
      hubPicker = '<div class="portal-hubpick"><label for="portalHub">' + svg("building", "icon-sm") + "Hub</label>" +
        '<select id="portalHub" class="lc-in">' + hubs.map(function (h) { return '<option value="' + h.id + '"' + (h.id === u.hubId ? " selected" : "") + ">" + esc(h.naam) + "</option>"; }).join("") + "</select></div>";
    }
    el("app").innerHTML = portalHeader(u) +
      '<main class="portal-main">' +
        '<div class="portal-welcome"><h2>Hallo ' + esc(u.voornaam) + ",</h2><p>Waar wil je mee aan de slag?</p></div>" +
        hubPicker +
        pendingBanner +
        sections +
      "</main>";
    el("app").querySelector("[data-logout]").addEventListener("click", function () { S.logout().then(function () { resetNav(); authScreen = "landing"; render(); }); });
    el("app").querySelector("[data-profile]").addEventListener("click", openProfile);
    var hm = el("app").querySelector("[data-home]"); if (hm) hm.addEventListener("click", gotoLanding);
    var gb = el("app").querySelector("[data-goto-beheer]"); if (gb) gb.addEventListener("click", function () { state.module = "personeelsbeheer"; render(); });
    var hp = el("portalHub"); if (hp) hp.addEventListener("change", function () { try { S.setViewHub(hp.value); render(); } catch (e) { toast(e.message, "err"); } });
    document.querySelectorAll("[data-module]").forEach(function (b) {
      b.addEventListener("click", function () { state.module = b.getAttribute("data-module"); state.view = "shifts"; state.viewOnly = false; render(); });
    });
  }

  // Navigatiestatus terug naar het menu (bij in-/uitloggen zodat niemand op een vorige pagina belandt).
  function resetNav() { state.module = null; state.showLanding = false; state.viewOnly = false; state.view = "shifts"; }
  function gotoPortal() { state.module = null; state.viewOnly = false; state.showLanding = false; render(); }
  function gotoLanding() { state.showLanding = true; render(); } // logo-klik: naar de voorpagina (blijft ingelogd)

  /* ===================================================================
     MODULE-PAGINA (operationeel — in aanbouw)
     =================================================================== */
  function renderModulePage() {
    if (state.module === "takenplanning") return renderPlanning();
    if (state.module === "personeelsbeheer") return renderPersoneelsbeheer();
    if (state.module === "dashboard") return renderDashboard();
    if (state.module === "schadecontrole") return renderSchade();
    if (state.module === "kwaliteit") return renderKwaliteit();
    if (state.module === "lc") return renderLC();
    if (state.module === "bussenbeheer") return renderBussenbeheer();
    if (state.module === "buswassing") return renderBuswassing();
    if (state.module === "temparchief") return renderTempArchief();
    var u = S.currentUser();
    var info = {
      takenplanning: { name: "Takenplanning", icon: "clipboardList", desc: "Hier maak je straks het weekrooster (medewerkers × dagen, AM/PM en taken) en download je het als afbeelding voor de groepsapp." },
      schadecontrole: { name: "Schadecontrole", icon: "shield", desc: "Hier komt de schadecontrole: bussen importeren uit de planning (busnummer + kenteken) en per bus afvinken (schadecontrole, tolkrol, kabeltjes, doekjes). De binnendienst volgt de voortgang live." },
      kwaliteit: { name: "Kwaliteit", icon: "award", desc: "Hier komt de kwaliteitsmodule: emballage/kratten tellen per vak, met live overzicht voor de binnendienst." },
      lc: { name: "Laadproces", icon: "inbox", desc: "Hier komt het laadproces: vakken (1–40) koppelen aan bussen en ritnummers, importeren in de ochtend en handmatig invullen in de middag." }
    }[state.module] || { name: "Module", icon: "grid", desc: "" };

    el("app").innerHTML = portalHeader(u, true) +
      '<main><div class="page-head" style="margin-top:6px"><div><h2>' + esc(info.name) + "</h2></div></div>" +
      '<div class="panel" style="padding:30px;text-align:center">' +
        '<div class="empty" style="padding:30px 10px">' + svg(info.icon) + "<h3>" + esc(info.name) + " — in aanbouw</h3><p style=\"max-width:520px;margin:0 auto\">" + esc(info.desc) + "</p>" +
        '<div style="margin-top:18px"><span class="badge st-afwachting">Volgende fase</span></div></div></div></main>';
    el("app").querySelector("[data-logout]").addEventListener("click", function () { S.logout().then(function () { resetNav(); authScreen = "landing"; render(); }); });
    el("app").querySelector("[data-profile]").addEventListener("click", openProfile);
    el("app").querySelector("[data-portal]").addEventListener("click", gotoPortal);
    var hm2 = el("app").querySelector("[data-home]"); if (hm2) hm2.addEventListener("click", gotoLanding);
  }

  /* ===================================================================
     TAKENPLANNING
     =================================================================== */
  var DAYNAMES = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
  function planDagdelen(di) { return di === 6 ? ["AM"] : ["AM", "PM"]; } // zondag (index 6) alleen AM
  function renderPlanning() {
    var u = S.currentUser();
    var canEdit = S.can.planning(u);
    if (!state.planWeek) state.planWeek = ymd(mondayOf(new Date()));
    var mon = new Date(state.planWeek + "T00:00:00");
    var plan = S.planningFor(u.hubId, state.planWeek);
    var days = []; for (var i = 0; i < 7; i++) { var dd = new Date(mon); dd.setDate(mon.getDate() + i); days.push(dd); }
    var req = ["Schadecontrole", "LC", "Kwaliteit"].filter(function (t) { return S.db.taskCatalog.indexOf(t) !== -1; });

    function cellHTML(key, di, dagdeel) {
      var c = plan.cells[key + "__" + di + "__" + dagdeel];
      var txt = c ? (c.taak || "✓") : "";
      return '<td class="plan-cell ' + (dagdeel === "AM" ? "c-am" : "c-pm") + (c ? " on" : "") + '">' +
        '<button type="button" data-cell="' + plan.id + "|" + key + "|" + di + "|" + dagdeel + '">' + esc(txt) + "</button></td>";
    }
    var thead = "<thead><tr><th class=\"pl-name\" rowspan=\"2\">Naam</th>" +
      days.map(function (d, i) { return '<th class="pl-day" colspan="' + planDagdelen(i).length + '">' + DAYNAMES[i] + ' <span class="pl-date">' + d.getDate() + "-" + (d.getMonth() + 1) + "</span></th>"; }).join("") +
      "</tr><tr>" + days.map(function (d, i) { return planDagdelen(i).map(function (dd) { return '<th class="pl-h-' + dd.toLowerCase() + '">' + dd + "</th>"; }).join(""); }).join("") + "</tr></thead>";
    var totalCols = 1 + days.reduce(function (a, d, i) { return a + planDagdelen(i).length; }, 0);
    var tbody = "<tbody>" + (plan.rows.length ? plan.rows.map(function (r) {
      var cells = ""; for (var di = 0; di < 7; di++) planDagdelen(di).forEach(function (dd) { cells += cellHTML(r.key, di, dd); });
      return "<tr><td class=\"pl-name\">" + esc(r.naam) + (canEdit ? ' <button class="pl-x" data-delrow="' + plan.id + "|" + r.key + '" title="Rij verwijderen">' + svg("x", "icon-sm") + "</button>" : "") + "</td>" + cells + "</tr>";
    }).join("") : '<tr><td colspan="' + totalCols + '"><div class="cellsub" style="padding:10px">Nog geen medewerkers in deze planning.</div></td></tr>') + "</tbody>";

    // dekkingsstrip: zijn de belangrijke taken per dag ingevuld?
    function dayCov(di) {
      var present = {}; req.forEach(function (t) { present[t] = false; });
      planDagdelen(di).forEach(function (dd) { plan.rows.forEach(function (r) { var c = plan.cells[r.key + "__" + di + "__" + dd]; if (c && c.taak && present.hasOwnProperty(c.taak)) present[c.taak] = true; }); });
      var miss = req.filter(function (t) { return !present[t]; });
      return { cov: req.length - miss.length, total: req.length, miss: miss };
    }
    var covStrip = req.length ? '<div class="cov-strip">' + days.map(function (d, i) {
      var cv = dayCov(i), full = cv.cov === cv.total;
      return '<span class="cov-chip ' + (full ? "ok" : "warn") + '" title="' + (full ? "Alle taken ingevuld" : "Mist: " + cv.miss.join(", ")) + '">' + (full ? svg("check", "icon-sm") : svg("alertTri", "icon-sm")) + DAYNAMES[i] + " " + (full ? "" : cv.cov + "/" + cv.total) + "</span>";
    }).join("") + "</div>" : "";

    var weekLabel = "Week " + isoWeek(mon);
    var toolbar = '<div class="toolbar">' +
      '<div class="seg"><button data-week="-1">' + svg("arrowLeft", "icon-sm") + "</button>" +
        '<button class="active" style="cursor:default">' + esc(weekLabel) + "</button>" +
        '<button data-week="1">' + svg("arrowRight", "icon-sm") + "</button></div>" +
      '<div class="grow"></div>' +
      (canEdit ? '<div class="add-inline"><input id="plNewRow" placeholder="Naam toevoegen"><button class="btn btn-dark btn-sm" id="plAddRow">' + svg("plus", "icon-sm") + "Rij</button></div>" : "") +
      '<button class="btn btn-primary btn-sm" id="plDownload">' + svg("download", "icon-sm") + "Afbeelding</button>" +
      "</div>";

    el("app").innerHTML = portalHeader(u, true) +
      '<main><div class="page-head" style="margin-top:6px"><div><h2>Takenplanning</h2></div></div>' +
      toolbar + covStrip +
      '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table table-grid plan-table">' + thead + tbody + "</table></div></div></main>";

    bindModuleHeader();
    document.querySelectorAll("[data-week]").forEach(function (b) {
      b.addEventListener("click", function () { var m = new Date(state.planWeek + "T00:00:00"); m.setDate(m.getDate() + 7 * parseInt(b.getAttribute("data-week"), 10)); state.planWeek = ymd(m); renderPlanning(); });
    });
    if (canEdit) {
      document.querySelectorAll("[data-cell]").forEach(function (b) { b.addEventListener("click", function () { openPlanCell(b.getAttribute("data-cell")); }); });
      document.querySelectorAll("[data-delrow]").forEach(function (b) { b.addEventListener("click", function () { var p = b.getAttribute("data-delrow").split("|"); try { S.removePlanRow(p[0], p[1]); toast("Rij verwijderd.", "ok"); renderPlanning(); } catch (e) { toast(e.message, "err"); } }); });
      var ar = el("plAddRow"); if (ar) ar.addEventListener("click", function () { try { S.addPlanRow(plan.id, el("plNewRow").value); renderPlanning(); } catch (e) { toast(e.message, "err"); } });
    }
    el("plDownload").addEventListener("click", function () { downloadPlanningPNG(plan); });
  }

  function openPlanCell(spec) {
    var p = spec.split("|"); var planId = p[0], key = p[1], di = p[2], dagdeel = p[3];
    var plan = S.planById(planId); if (!plan) return;
    var c = plan.cells[key + "__" + di + "__" + dagdeel] || null;
    var row = plan.rows.filter(function (r) { return r.key === key; })[0] || {};
    var taskOpts = '<option value="">Werkt — geen taak</option>' + S.db.taskCatalog.slice().sort(function (a, b) { return a.localeCompare(b); })
      .concat([S.TASK_JBT]).map(function (t) { return '<option value="' + esc(t) + '"' + (c && c.taak === t ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
    openModal({
      title: esc(row.naam) + " — " + DAYNAMES[di] + " " + dagdeel, icon: dagdeel === "AM" ? "sun" : "moon",
      body: '<form id="pcForm"><div class="field"><label>Taak</label><select name="taak">' + taskOpts + "</select></div></form>",
      foot: (c ? '<button class="btn btn-red" id="pcDel">' + svg("trash", "icon-sm") + "Verwijderen</button>" : '<button class="btn btn-ghost" data-close>Annuleren</button>') +
        '<button class="btn btn-primary" id="pcSave">' + svg("check") + "Opslaan</button>",
      onMount: function (ov, close) {
        ov.querySelector("#pcSave").addEventListener("click", function () {
          var f = ov.querySelector("#pcForm");
          try { S.setPlanCell(planId, key, di, dagdeel, { taak: f.taak.value }); close(); renderPlanning(); } catch (e) { toast(e.message, "err"); }
        });
        var del = ov.querySelector("#pcDel"); if (del) del.addEventListener("click", function () { try { S.setPlanCell(planId, key, di, dagdeel, null); close(); renderPlanning(); } catch (e) { toast(e.message, "err"); } });
      }
    });
  }

  function downloadPlanningPNG(plan) {
    var u = S.currentUser(); var hub = S.hubById(u.hubId);
    var mon = new Date(plan.weekStart + "T00:00:00");
    var days = []; for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setDate(mon.getDate() + i); days.push(d); }
    // kolommen: Ma-Za AM+PM, Zo alleen AM
    var colsArr = []; for (var di = 0; di < 7; di++) planDagdelen(di).forEach(function (dd) { colsArr.push({ di: di, dd: dd }); });
    var nameW = 170, cellW = 62, rowH = 28, headH = 44, titleH = 50, cols = colsArr.length;
    var W = nameW + cols * cellW, H = titleH + headH + plan.rows.length * rowH;
    var sc = 2, cv = document.createElement("canvas"); cv.width = W * sc; cv.height = H * sc;
    var ctx = cv.getContext("2d"); ctx.scale(sc, sc);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#febe10"; ctx.fillRect(0, 0, W, titleH);
    ctx.fillStyle = "#1d1d1b"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.font = "900 18px Arial"; ctx.fillText("Takenplanning  ·  Week " + isoWeek(mon) + "  ·  HUB " + (hub ? hub.naam : ""), 14, titleH / 2);
    var y0 = titleH;
    // dag-headers (gegroepeerd) + AM/PM
    ctx.textAlign = "center";
    for (var ci = 0; ci < colsArr.length; ci++) {
      var cx0 = nameW + ci * cellW, col = colsArr[ci];
      if (col.dd === "AM") { // dagnaam boven de AM-kolom (over breedte van de dag)
        var span = planDagdelen(col.di).length;
        ctx.fillStyle = "#1d1d1b"; ctx.font = "800 12px Arial";
        ctx.fillText(DAYNAMES[col.di] + " " + days[col.di].getDate() + "-" + (days[col.di].getMonth() + 1), cx0 + (span * cellW) / 2, y0 + 15);
      }
      ctx.font = "700 11px Arial"; ctx.fillStyle = col.dd === "AM" ? "#3a6ea5" : "#c47a16";
      ctx.fillText(col.dd, cx0 + cellW / 2, y0 + 33);
    }
    ctx.fillStyle = "#1d1d1b"; ctx.font = "800 13px Arial"; ctx.textAlign = "left"; ctx.fillText("Naam", 12, y0 + headH / 2);
    var y = y0 + headH;
    plan.rows.forEach(function (r, ri) {
      var ry = y + ri * rowH;
      ctx.fillStyle = ri % 2 ? "#faf9f4" : "#fff"; ctx.fillRect(0, ry, W, rowH);
      ctx.fillStyle = "#1d1d1b"; ctx.font = "700 12px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(r.naam.length > 22 ? r.naam.slice(0, 21) + "…" : r.naam, 12, ry + rowH / 2);
      colsArr.forEach(function (col, ci) {
        var cx = nameW + ci * cellW;
        var cell = plan.cells[r.key + "__" + col.di + "__" + col.dd];
        if (cell) {
          ctx.fillStyle = col.dd === "AM" ? "#bfe0ff" : "#ffdca8"; ctx.fillRect(cx + 1, ry + 1, cellW - 2, rowH - 2);
          var txt = cell.taak || "✓";
          ctx.fillStyle = "#1d1d1b"; ctx.font = "700 10px Arial"; ctx.textAlign = "center";
          ctx.fillText(txt.length > 11 ? txt.slice(0, 10) + "…" : txt, cx + cellW / 2, ry + rowH / 2);
        }
      });
    });
    ctx.strokeStyle = "#e1e1dc"; ctx.lineWidth = 1;
    for (var gx = 0; gx <= cols; gx++) { var lx = nameW + gx * cellW; ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y + plan.rows.length * rowH); ctx.stroke(); }
    for (var gy = 0; gy <= plan.rows.length; gy++) { var ly = y + gy * rowH; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    cv.toBlob(function (blob) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "takenplanning-week" + isoWeek(mon) + ".png"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
    toast("Afbeelding gedownload.", "ok");
  }

  /* ===================================================================
     OPERATIONELE MODULES (prototype, live tussen tabbladen)
     =================================================================== */
  // Live-indicator: groene pill (oude stijl/plek) met pulserende bol i.p.v. draaiend icoontje.
  function liveBadge() { return '<span class="live-badge"><span class="live-dot"></span>Live</span>'; }
  function moduleShell(title, content, opts) {
    opts = opts || {};
    var vo = state.viewOnly;
    // Live-badge op de oude plek (in de page-head); in view-only de context-badge.
    var badge = vo
      ? '<span class="live-badge vo-badge">' + svg("shield", "icon-sm") + (S.isSetup(S.currentUser()) ? "Binnendienst" : "Alleen bekijken") + "</span>"
      : liveBadge();
    // 'Terug naar dashboard' staat bovenaan de pagina als losse gele knop (geen balk).
    var voBack = vo ? '<button class="btn btn-sm vo-back" data-voback>' + svg("arrowLeft", "icon-sm") + "Terug naar dashboard</button>" : "";
    // Vanuit 'Bekijk voortgang' op het dashboard heet de pagina "Voortgang <module>".
    var heading = vo ? "Voortgang " + title.charAt(0).toLowerCase() + title.slice(1) : title;
    return portalHeader(S.currentUser(), true) +
      "<main>" + voBack + '<div class="page-head" style="margin-top:6px"><div><h2>' + esc(heading) + "</h2></div>" +
      '<div class="grow"></div>' + badge + "</div>" +
      (opts.noShift ? "" : shiftBar()) + content + "</main>";
  }
  function bindModuleHeader(rerender) {
    el("app").querySelector("[data-logout]").addEventListener("click", function () { S.logout().then(function () { resetNav(); authScreen = "landing"; render(); }); });
    el("app").querySelector("[data-profile]").addEventListener("click", openProfile);
    el("app").querySelector("[data-portal]").addEventListener("click", gotoPortal);
    var hm = el("app").querySelector("[data-home]"); if (hm) hm.addEventListener("click", gotoLanding);
    var vb = el("app").querySelector("[data-voback]"); if (vb) vb.addEventListener("click", function () { state.viewOnly = false; state.module = "dashboard"; render(); });
    if (rerender) bindShiftBar(rerender);
  }
  function ensureShiftState() {
    if (!state.opDate) state.opDate = ymd(new Date());
    if (!state.opShift) state.opShift = "AM";
    if (S.isSunday(state.opDate)) state.opShift = "AM";
  }
  function shiftBar() {
    ensureShiftState();
    var dd = new Date(state.opDate + "T00:00:00");
    var dn = ["zo", "ma", "di", "wo", "do", "vr", "za"][dd.getDay()];
    var lbl = dn + " " + dd.getDate() + "-" + (dd.getMonth() + 1) + "-" + dd.getFullYear();
    var sun = S.isSunday(state.opDate);
    return '<div class="shiftbar"><div class="seg opdate-seg"><button data-opday="-1">' + svg("arrowLeft", "icon-sm") + "</button>" +
      '<button class="active" data-opdate style="text-transform:capitalize" title="Kies een datum">' + svg("calendar", "icon-sm") + esc(lbl) + "</button>" +
      '<button data-opday="1">' + svg("arrowRight", "icon-sm") + "</button>" +
      '<div class="datepick-pop opdate-pop" hidden></div></div>' +
      '<div class="seg"><button data-opshift="AM" class="am-btn ' + (state.opShift === "AM" ? "active" : "") + '">' + svg("sun", "icon-sm") + "AM</button>" +
      (sun ? "" : '<button data-opshift="PM" class="pm-btn ' + (state.opShift === "PM" ? "active" : "") + '">' + svg("moon", "icon-sm") + "PM</button>") + "</div></div>";
  }
  function bindShiftBar(rer) {
    document.querySelectorAll("[data-opday]").forEach(function (b) { b.addEventListener("click", function () { var m = new Date(state.opDate + "T00:00:00"); m.setDate(m.getDate() + parseInt(b.getAttribute("data-opday"), 10)); state.opDate = ymd(m); ensureShiftState(); rer(); }); });
    // Klik op de datum: dezelfde kalender als in RuilHub, direct een dag kiezen.
    var dbtn = document.querySelector("[data-opdate]"), pop = document.querySelector(".opdate-pop");
    if (dbtn && pop) {
      var view = new Date(state.opDate + "T00:00:00");
      function draw() {
        pop.innerHTML = calendarHTML(view, state.opDate);
        pop.querySelector("[data-pm]").onclick = function () { view.setMonth(view.getMonth() - 1); draw(); };
        pop.querySelector("[data-nm]").onclick = function () { view.setMonth(view.getMonth() + 1); draw(); };
        pop.querySelectorAll("[data-day]").forEach(function (d) { d.onclick = function () { state.opDate = d.getAttribute("data-day"); ensureShiftState(); rer(); }; });
      }
      dbtn.addEventListener("click", function (e) { e.stopPropagation(); if (pop.hidden) { view = new Date(state.opDate + "T00:00:00"); draw(); pop.hidden = false; } else pop.hidden = true; });
      pop.addEventListener("click", function (e) { e.stopPropagation(); });
      document.addEventListener("click", function close() { if (!document.body.contains(pop)) { document.removeEventListener("click", close); return; } pop.hidden = true; });
    }
    document.querySelectorAll("[data-opshift]").forEach(function (b) { b.addEventListener("click", function () { state.opShift = b.getAttribute("data-opshift"); state.opShiftUserSet = true; rer(); }); });
  }
  // Zet bij het (opnieuw) openen van een taakmodule de shift-kiezer op de juiste shift voor die taak,
  // op basis van de klok en de tijdvensters — tot de gebruiker zelf een shift kiest (opShiftUserSet).
  function autoShift(moduleKey) {
    if (!state.opDate) state.opDate = ymd(new Date());
    if (!state.opShiftUserSet) state.opShift = S.defaultDagdeelFor(moduleKey);
  }
  // Docks toewijzen/tonen hoort bij de PM-shift; op zondag is er geen PM, dus dan bij AM.
  function dockShift(c) { return c.dd === "PM" || S.isSunday(c.d); }
  // Mag de taakuitvoerder deze shift nu nog bewerken? (binnendienst/senior+ mag altijd.)
  function opWindowOK(u, moduleKey, c) { return S.isSetup(u) || S.withinShiftWindow(moduleKey, c.d, c.dd); }
  // Melding wanneer je wél de dienst hebt maar buiten het tijdvenster valt → alleen-lezen.
  function windowLockNote(u, moduleKey, c) {
    if (state.viewOnly || S.isSetup(u)) return "";
    if (!S.canOpShift(u, c.h, c.d, c.dd, moduleKey)) return "";
    if (S.withinShiftWindow(moduleKey, c.d, c.dd)) return "";
    return '<div class="alert" style="margin-bottom:12px">' + svg("lock", "icon-sm") + " Buiten de tijd van deze " + c.dd + "-shift — je kunt nu alleen bekijken, niet meer aanpassen.</div>";
  }
  function opProgress(done, total, label) {
    var pct = total ? Math.round(done / total * 100) : 0;
    return '<div class="op-progress"><div class="op-bar"><span style="width:' + pct + '%"></span></div><div class="op-pct">' + done + " / " + total + " " + esc(label) + " (" + pct + "%)</div></div>";
  }
  function layerLabel(n) { return '<span class="layer-tag">' + svg(n === 5 ? "layers5" : "layers4", "icon-sm") + n + "-laags</span>"; }
  function ctx() { ensureShiftState(); var u = S.currentUser(); return { u: u, h: u.hubId, d: state.opDate, dd: state.opShift }; }

  // Sorteer bussen op busnummer: numeriek oplopend, niet-numerieke achteraan (alfabetisch).
  function byBusNr(a, b) {
    var na = parseInt(a.bus, 10), nb = parseInt(b.bus, 10);
    var an = isNaN(na), bn = isNaN(nb);
    if (an && bn) return (a.bus || "").localeCompare(b.bus || "");
    if (an) return 1;
    if (bn) return -1;
    return na - nb;
  }

  /* ---------- Schadecontrole (alleen afvinken) ---------- */
  function renderSchade() {
    autoShift("schadecontrole");
    var c = ctx(), u = c.u;
    var s = S.getSchade(c.h, c.d, c.dd);
    var dashView = state.viewOnly, isBinnen = S.isSetup(u);
    var showTimes = dashView && isBinnen; // afvinktijden alleen voor de binnendienst in de dashboard-weergave
    var canEdit = dashView ? isBinnen : (opWindowOK(u, "schadecontrole", c) && S.canOpShift(u, c.h, c.d, c.dd, "schadecontrole", "Schadecontrole"));
    var st = S.schadeStats(c.h, c.d, c.dd), spSt = S.steekproefStats(c.h, c.d, c.dd);

    function chkCell(b) {
      var timeCell = (showTimes && b.gecontroleerd && b.gecontroleerdAt) ? '<div class="chk-time">' + fmtClock(b.gecontroleerdAt) + "</div>" : "";
      return '<td class="sc-chk" data-th="Gecontroleerd"><label class="chk-box ' + (b.gecontroleerd ? "on" : "") + (canEdit ? "" : " ro") + '">' +
        '<input type="checkbox" ' + (b.gecontroleerd ? "checked" : "") + (canEdit ? "" : " disabled") + ' data-scchk="' + b.id + '">' + svg("check", "icon-sm") + "</label>" + timeCell + "</td>";
    }
    function mistCell(b) {
      var items = [["mist_tolkrol", "Tolkrol"], ["mist_kabels", "Kabels"], ["mist_doekjes", "Doekjes"]];
      return '<td data-th="Ontbreekt"><div class="chips">' + items.map(function (it) {
        var on = b[it[0]];
        if (!canEdit) return on ? '<span class="badge st-afgekeurd">' + esc(it[1]) + " mist</span>" : "";
        return '<span class="chip mist-chip ' + (on ? "on" : "") + '" data-scmist="' + b.id + "|" + it[0] + '">' + esc(it[1]) + "</span>";
      }).join("") + "</div></td>";
    }
    function spCell(b) {
      var done = S.steekproefDone(b);
      // Er hoeven maar 5 steekproeven: zodra 5 gedaan zijn worden de overige knopjes grijs met een streepje.
      if (!done && spSt.done >= 5) {
        return '<td data-th="Steekproef"><button class="btn btn-sm sc-sp-btn cap" disabled><span class="sp-dash">–</span>Steekproef</button></td>';
      }
      return '<td data-th="Steekproef"><button class="btn btn-sm sc-sp-btn' + (done ? " done" : "") + '" data-spbus="' + b.id + '"' + (canEdit ? "" : " disabled") + ">" +
        svg(done ? "check" : "clipboard", "icon-sm") + "Steekproef</button></td>";
    }
    var busSorted = s.buses.slice().sort(byBusNr); // altijd laagste busnummer bovenaan
    var showDock = dockShift(c);                    // docks horen bij de PM-shift (en zondag AM, want dan is er geen PM)
    var rows = busSorted.length ? busSorted.map(function (b) {
      var dockCell = b.dock ? '<span class="badge dock">' + svg("building", "icon-sm") + "Dock " + esc(b.dock) + "</span>" : '<span class="cellsub">—</span>';
      var opmNote = b.opmerking ? '<div class="bus-opm">' + svg("alertTri", "icon-sm") + esc(b.opmerking) + "</div>" : "";
      var wasNote = b.wassen ? '<span class="badge was">' + svg("droplet", "icon-sm") + (b.wasStatus === "gewassen" ? "Gewassen" : b.wasStatus === "niet" ? "Niet gewassen" : "Naar wasstraat") + "</span>" : "";
      var rit2Note = b.tweedeRit ? '<span class="badge rit2">' + svg("refresh", "icon-sm") + "2e rit</span>" : "";
      return "<tr class=\"" + (b.gecontroleerd ? "sc-done" : "") + "\"><td><div class=\"cellname\">Bus " + esc(b.bus || "?") + "</div><div class=\"cellsub\">" + esc(b.naam || "") + (b.kenteken ? " · " + esc(b.kenteken) : "") + "</div>" + rit2Note + wasNote + opmNote + "</td>" +
        chkCell(b) + mistCell(b) + spCell(b) + (showDock ? '<td data-th="Dock">' + dockCell + "</td>" : "") + "</tr>";
    }).join("") : '<tr><td colspan="' + (showDock ? 5 : 4) + '"><div class="cellsub" style="padding:14px">Er is nog geen schadecontrolelijst klaargezet.</div></td></tr>';
    var table = '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table sc-table">' +
      "<thead><tr><th>Bus</th><th>Gecontroleerd</th><th>Ontbreekt</th><th>Steekproef</th>" + (showDock ? "<th>Dock</th>" : "") + "</tr></thead><tbody>" + rows + "</tbody></table></div></div>";

    // Steekproeven controleren doet de binnendienst via het senior-dashboard (niet hier).
    el("app").innerHTML = moduleShell("Schadecontrole",
      windowLockNote(u, "schadecontrole", c) +
      opProgress(st.done, st.total, "bussen gecontroleerd") +
      opProgress(spSt.done, spSt.total, "steekproeven gedaan") + table);
    bindModuleHeader(renderSchade);
    document.querySelectorAll("[data-scchk]").forEach(function (cb) { cb.addEventListener("change", function () { try { S.schadeToggle(c.h, c.d, c.dd, cb.getAttribute("data-scchk"), "gecontroleerd"); renderSchade(); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-scmist]").forEach(function (ch) { ch.addEventListener("click", function () { var p = ch.getAttribute("data-scmist").split("|"); try { S.schadeToggle(c.h, c.d, c.dd, p[0], p[1]); renderSchade(); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-spbus]").forEach(function (b) { b.addEventListener("click", function () { openSteekproef(c, b.getAttribute("data-spbus")); }); });
  }

  // Steekproef-modal per bus (zelfde velden als voorheen: naam, hr, rit, kratten).
  function openSteekproef(c, busId) {
    var b = S.getSchade(c.h, c.d, c.dd).buses.filter(function (x) { return x.id === busId; })[0]; if (!b) return;
    var canEdit = S.canOpShift(S.currentUser(), c.h, c.d, c.dd, "schadecontrole", "Schadecontrole");
    var sp = b.steekproef || { naam: "", hr: "", rit: "", kratten: "" };
    function fld(label, name, val, extra) { return '<div class="field"><label>' + label + "</label><input name=\"" + name + "\"" + (extra || "") + ' value="' + esc(val == null ? "" : val) + '"' + (canEdit ? "" : " disabled") + "></div>"; }
    var body = '<form id="spForm">' +
      fld("Naam bezorger", "naam", sp.naam) +
      fld("hr-nummer", "hr", sp.hr, ' inputmode="numeric" pattern="[0-9]*"') +
      fld("Ritnummer (optioneel)", "rit", sp.rit, ' inputmode="numeric" pattern="[0-9]*"') +
      fld("Kratten in de bus", "kratten", sp.kratten, ' type="number" inputmode="numeric" min="0"') +
      "</form>";
    openModal({
      title: "Steekproef · Bus " + esc(b.bus || "?"), icon: "clipboard", body: body,
      foot: canEdit ? '<button class="btn btn-ghost" data-close>Annuleren</button><button class="btn btn-primary" id="spSave">' + svg("check") + "Opslaan</button>"
                    : '<button class="btn btn-ghost" data-close>Sluiten</button>',
      onMount: function (ov, close) {
        var sv = ov.querySelector("#spSave");
        if (sv) sv.addEventListener("click", function () {
          var f = ov.querySelector("#spForm");
          try { S.setBusSteekproef(c.h, c.d, c.dd, busId, { naam: f.naam.value, hr: f.hr.value, rit: f.rit.value, kratten: f.kratten.value }); close(); renderSchade(); } catch (e) { toast(e.message, "err"); }
        });
      }
    });
  }

  /* ---------- Buswassing ----------
     Werkt per DAG, niet per shift: de lijst bundelt de bussen die de senior in de AM- én
     PM-lijst heeft aangemerkt. Daarom een datumbalk zonder AM/PM-schakelaar. */
  function dayBar() {
    ensureShiftState();
    var d = new Date(state.opDate + "T00:00:00");
    var dn = ["zo", "ma", "di", "wo", "do", "vr", "za"][d.getDay()];
    var lbl = dn + " " + d.getDate() + "-" + (d.getMonth() + 1) + "-" + d.getFullYear();
    return '<div class="shiftbar"><div class="seg opdate-seg"><button data-opday="-1">' + svg("arrowLeft", "icon-sm") + "</button>" +
      '<button class="active" data-opdate style="text-transform:capitalize" title="Kies een datum">' + svg("calendar", "icon-sm") + esc(lbl) + "</button>" +
      '<button data-opday="1">' + svg("arrowRight", "icon-sm") + "</button>" +
      '<div class="datepick-pop opdate-pop" hidden></div></div></div>';
  }
  function renderBuswassing() {
    var c = ctx(), u = c.u;
    var lijst = S.wasLijst(c.h, c.d).sort(function (a, b) { return byBusNr(a.bus, b.bus); });
    var st = S.wasStats(c.h, c.d);
    var canEdit = !state.viewOnly && S.wasCanEdit(u, c.h, c.d);

    function statusKnoppen(row) {
      var b = row.bus;
      function knop(status, label, icon, cls) {
        var on = b.wasStatus === status;
        // Nogmaals op een actieve knop tikken zet 'm terug op open (bv. per ongeluk aangetikt).
        return '<span class="chip was-status ' + cls + (on ? " on" : "") + '" data-waszet="' +
          row.dagdeel + "|" + b.id + "|" + (on ? "" : status) + '">' + svg(icon, "icon-sm") + label + "</span>";
      }
      return knop("gewassen", "Gewassen", "check", "was-ok") + knop("niet", "Niet geweest", "x", "was-no");
    }
    function statusBadge(b) {
      if (b.wasStatus === "gewassen") return '<span class="badge st-goedgekeurd">' + svg("check", "icon-sm") + "Gewassen</span>";
      if (b.wasStatus === "niet") return '<span class="badge st-afgekeurd">' + svg("x", "icon-sm") + "Niet geweest</span>";
      return '<span class="cellsub">Nog niet langs geweest</span>';
    }
    var rows = lijst.length ? lijst.map(function (row) {
      var b = row.bus;
      var wie = b.wasAt ? '<div class="chk-time">' + fmtClock(b.wasAt) + (b.wasDoor && S.userById(b.wasDoor) ? " · " + fullName(S.userById(b.wasDoor)) : "") + "</div>" : "";
      return "<tr><td><div class=\"cellname\">Bus " + esc(b.bus || "?") + "</div><div class=\"cellsub\">" +
          esc(b.naam || "") + (b.kenteken ? " · " + esc(b.kenteken) : "") + "</div></td>" +
        '<td data-th="Shift"><span class="badge">' + svg(row.dagdeel === "PM" ? "moon" : "sun", "icon-sm") + esc(row.dagdeel) + "</span></td>" +
        '<td data-th="Status">' + (canEdit ? '<div class="chips">' + statusKnoppen(row) + "</div>" : statusBadge(b)) + wie + "</td></tr>";
    }).join("") : '<tr><td colspan="3"><div class="cellsub" style="padding:14px">Er zijn nog geen bussen aangewezen voor de wasstraat.</div></td></tr>';

    var rechtNote = (!canEdit && !state.viewOnly)
      ? '<div class="alert" style="margin-bottom:12px">' + svg("lock", "icon-sm") + " Je bent vandaag niet aangewezen voor de buswassing — je kunt de lijst wel bekijken.</div>" : "";
    var nietNote = st.niet
      ? '<div class="alert alert-error">' + svg("alertTri", "icon-sm") + " " + st.niet + (st.niet === 1 ? " bus is" : " bussen zijn") + " niet langs de wasstraat geweest.</div>" : "";

    el("app").innerHTML = moduleShell("Buswassing",
      dayBar() + rechtNote +
      (lijst.length ? opProgress(st.gewassen, st.total, "bussen gewassen") + nietNote : "") +
      '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table">' +
      "<thead><tr><th>Bus</th><th>Shift</th><th>Status</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>",
      { noShift: true });
    bindModuleHeader(renderBuswassing);
    document.querySelectorAll("[data-waszet]").forEach(function (ch) {
      ch.addEventListener("click", function () {
        var p = ch.getAttribute("data-waszet").split("|");
        try { S.setWasStatus(c.h, c.d, p[0], p[1], p[2]); renderBuswassing(); }
        catch (e) { toast(e.message, "err"); }
      });
    });
  }

  /* ---------- Bussenbeheer (overzicht bussen per shift; standaard alleen probleembussen) ---------- */
  function renderBussenbeheer() {
    var c = ctx();
    var s = S.getSchade(c.h, c.d, c.dd);
    if (state.bbAll === undefined) state.bbAll = false;
    var buses = s.buses.filter(function (b) { return state.bbAll || S.busHeeftProbleem(b); });
    function mistBadges(b) {
      var items = [["mist_tolkrol", "Tolkrol"], ["mist_kabels", "Kabels"], ["mist_doekjes", "Doekjes"]];
      var chips = items.filter(function (it) { return b[it[0]]; }).map(function (it) { return '<span class="badge st-afgekeurd">' + esc(it[1]) + " mist</span>"; }).join("");
      return chips || '<span class="cellsub">Geen afwijking</span>';
    }
    var rows = buses.length ? buses.map(function (b) {
      return "<tr><td><div class=\"cellname\">Bus " + esc(b.bus || "?") + "</div><div class=\"cellsub\">" + esc(b.naam || "") + (b.kenteken ? " · " + esc(b.kenteken) : "") + "</div></td>" +
        '<td data-th="Schadecontrole">' + (b.gecontroleerd ? '<span class="badge st-goedgekeurd">Gecontroleerd</span>' : '<span class="badge st-afwachting">Nog niet</span>') + "</td>" +
        '<td data-th="Ontbreekt"><div class="chips">' + mistBadges(b) + "</div></td>" +
        '<td data-th="Steekproef">' + (S.steekproefDone(b) ? '<span class="badge st-goedgekeurd">Gedaan</span>' : '<span class="cellsub">—</span>') + "</td></tr>";
    }).join("") : '<tr><td colspan="4"><div class="cellsub" style="padding:14px">' + (state.bbAll ? "Nog geen bussen voor deze shift." : "Geen probleembussen voor deze shift.") + "</div></td></tr>";
    var table = '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table">' +
      "<thead><tr><th>Bus</th><th>Schadecontrole</th><th>Ontbreekt</th><th>Steekproef</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
    var toggle = '<div class="page-head" style="margin:0 0 12px"><div><p class="cellsub" style="margin:0">' +
      (state.bbAll ? "Alle bussen van deze shift." : "Alleen bussen met een afwijking bij de schadecontrole.") + '</p></div><div class="grow"></div>' +
      '<label class="chk"><input type="checkbox" id="bbAllToggle"' + (state.bbAll ? " checked" : "") + "> Toon alle bussen</label></div>";
    el("app").innerHTML = moduleShell("Bussenbeheer", toggle + table);
    bindModuleHeader(renderBussenbeheer);
    var t = el("bbAllToggle"); if (t) t.addEventListener("change", function () { state.bbAll = t.checked; renderBussenbeheer(); });
  }

  /* ---------- Kwaliteit (vak-soort + emballage per vak) ---------- */
  function renderKwaliteit() {
    autoShift("kwaliteit");
    var c = ctx(), u = c.u;
    var canEdit = !state.viewOnly && opWindowOK(u, "kwaliteit", c) && S.canOpShift(u, c.h, c.d, c.dd, "kwaliteit", "Kwaliteit");
    function soortOpts(sel) { return S.VAK_SOORTEN.map(function (s) { return '<option value="' + s.id + '"' + (sel === s.id ? " selected" : "") + ">" + esc(s.label) + "</option>"; }).join(""); }
    var rows = S.VAK_NUMMERS.map(function (i) {
      var soort = S.vakSoort(c.h, c.d, c.dd, i), isEmb = soort === "emb5", tot = isEmb ? S.emballageVakTotal(c.h, c.d, c.dd, i) : 0;
      return '<tr class="' + (isEmb ? "vak-emb" : "") + '"><td class="lc-nr cellname">Vak ' + i + "</td>" +
        '<td data-th="Wat mag erin">' + (canEdit ? '<select class="lc-in vaksoort-sel" data-vaksoort="' + i + '">' + soortOpts(soort) + "</select>" : '<span class="badge ' + (soort ? "task" : "") + '">' + esc(S.vakSoortLabel(soort)) + "</span>") + "</td>" +
        '<td data-th="Emballage">' + (isEmb ? '<button class="btn btn-primary btn-sm" data-embopen="' + i + '">' + svg("tag", "icon-sm") + "Tellen · " + tot + "</button>" : '<span class="cellsub">—</span>') + "</td></tr>";
    }).join("");
    var table = '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table"><thead><tr><th>Vak</th><th>Wat mag erin</th><th>Emballage</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";

    // Tabs: Vakken (emballage) · Voedselbank (temperatuur retouren). Trolleys tellen is weg (v=102).
    if (!state.kwTab) state.kwTab = "vakken";
    var spT = S.spTrolleyGet(c.h, c.d, c.dd), spActief = !!spT && spT.status !== "gecontroleerd";
    if (state.kwTab === "trolleys" && !spActief) state.kwTab = "vakken";
    var seg = '<div class="seg" style="margin-bottom:16px">' +
      '<button data-kwtab="vakken" class="' + (state.kwTab === "vakken" ? "active" : "") + '">Vakken</button>' +
      '<button data-kwtab="voedselbank" class="' + (state.kwTab === "voedselbank" ? "active" : "") + '">Retouren</button>' +
      (spActief ? '<button data-kwtab="trolleys" class="' + (state.kwTab === "trolleys" ? "active" : "") + (spT.status === "open" ? " tab-warn" : "") + '">Trolleys' + (spT.status === "open" ? '<span class="tab-bang">!</span>' : "") + "</button>" : "") + "</div>";
    var canVb = !state.viewOnly && opWindowOK(u, "kwaliteit", c) && S.vbCanEdit(u, c.h, c.d, c.dd);
    el("app").innerHTML = moduleShell("Kwaliteit", windowLockNote(u, "kwaliteit", c) + seg + (state.kwTab === "voedselbank" ? vbBody(c, canVb) : state.kwTab === "trolleys" ? spTrolleyBody(c, spT, canEdit) : table));
    bindModuleHeader(renderKwaliteit);
    document.querySelectorAll("[data-kwtab]").forEach(function (b) { b.addEventListener("click", function () { state.kwTab = b.getAttribute("data-kwtab"); state.vbAdding = false; renderKwaliteit(); }); });
    document.querySelectorAll("[data-vaksoort]").forEach(function (s) { s.addEventListener("change", function () { try { S.setVakSoort(c.h, c.d, c.dd, parseInt(s.getAttribute("data-vaksoort"), 10), s.value); renderKwaliteit(); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-embopen]").forEach(function (b) { b.addEventListener("click", function () { openEmbVak(c, parseInt(b.getAttribute("data-embopen"), 10)); }); });
    if (state.kwTab === "voedselbank") bindVb(c);
    var spf = el("spTrolleyForm"); if (spf) spf.addEventListener("submit", function (e) {
      e.preventDefault();
      try { S.spTrolleyIndienen(c.h, c.d, c.dd, spf.elements.c4.value, spf.elements.c5.value); toast("Telling ingediend — de binnendienst controleert 'm.", "ok"); renderKwaliteit(); }
      catch (err) { toast(err.message, "err"); }
    });
    animateTab(el("app").querySelector("main"), "kwaliteit:" + state.kwTab);
  }
  // Steekproef trolleys: Kwaliteit telt blind (ziet de systeemvoorraad niet) en dient in.
  function spTrolleyBody(c, sp, canEdit) {
    if (sp.status === "ingediend") {
      return panel("clipboard", "Trolley-steekproef — ingediend",
        '<div class="troll-body"><div class="troll-nums"><div class="troll-num"><span class="dash-big">' + sp.c4 + '</span><span class="cellsub">4-laags</span></div>' +
        '<div class="troll-num"><span class="dash-big">' + sp.c5 + '</span><span class="cellsub">5-laags</span></div></div>' +
        '<div class="troll-status ok">' + svg("check", "icon-sm") + "Ingediend door " + esc(sp.doorNaam) + " om " + fmtClock(sp.ingediendAt) + " — de binnendienst controleert de telling.</div></div>");
    }
    if (!canEdit) return panel("clipboard", "Trolley-steekproef", '<div class="troll-body"><div class="cellsub">Er staat een steekproef open; alleen de Kwaliteit-dienst kan tellen.</div></div>');
    return panel("clipboard", "Trolley-steekproef",
      '<form id="spTrolleyForm" class="troll-body" autocomplete="off">' +
        '<p class="cellsub" style="margin:0 0 12px">Tel álle trolleys op de hub en vul de aantallen in.</p>' +
        '<div class="vb-grid" style="max-width:420px">' +
          '<div class="field"><label>4-laags</label><input class="lc-in" type="number" inputmode="numeric" min="0" name="c4" required></div>' +
          '<div class="field"><label>5-laags</label><input class="lc-in" type="number" inputmode="numeric" min="0" name="c5" required></div>' +
        "</div>" +
        '<button class="btn btn-primary" type="submit">' + svg("check", "icon-sm") + "Telling indienen</button>" +
      "</form>");
  }

  /* ---------- Voedselbank: temperatuur retouren vóór koel/diepvries (formulier "Registratieformulier temperatuur Voedselbank") ---------- */
  function vbBody(c, canEdit) {
    var lijst = S.vbList(c.h, c.d, c.dd), u = c.u;
    var intro = '<p class="cellsub" style="margin:0 0 12px">Controle van de temperatuur vóórdat retourproducten voor de Voedselbank in de koel- of diepvriesunit gaan.</p>';
    function ro(label, val) { return '<div class="field"><label>' + label + '</label><div class="vb-ro">' + val + "</div></div>"; }
    var type = state.vbType || "koel", groep = state.vbGroep || "koel";
    var form = "";
    if (canEdit && !state.vbAdding) {
      form = '<div style="margin:0 0 14px"><button class="btn btn-primary" data-vbnew>' + svg("plus", "icon-sm") + "Meting toevoegen</button></div>";
    } else if (canEdit) {
      form = panel("thermo", "Nieuwe meting",
        '<form id="vbForm" autocomplete="off">' +
          '<div class="vb-grid">' +
            ro("Datum", svg("calendar", "icon-sm") + esc(fmtDate(c.d))) +
            ro("Shift", (c.dd === "PM" ? svg("moon", "icon-sm") : svg("sun", "icon-sm")) + esc(c.dd)) +
            ro("Naam controleur", svg("user", "icon-sm") + fullName(u)) +
          "</div>" +
          '<div class="field"><label>Box</label><div class="seg vb-seg">' +
            '<button type="button" data-vbtype="koel" class="' + (type === "koel" ? "active" : "") + '">' + svg("fridge", "icon-sm") + "Koelbox</button>" +
            '<button type="button" data-vbtype="dv" class="' + (type === "dv" ? "active" : "") + '">' + svg("snow", "icon-sm") + "Vriesbox</button></div></div>" +
          (type === "koel"
            ? '<div class="field"><label>Productgroep</label><div class="seg vb-seg">' +
                '<button type="button" data-vbgroep="koel" class="' + (groep !== "kip" ? "active" : "") + '">Overig gekoeld</button>' +
                '<button type="button" data-vbgroep="kip" class="' + (groep === "kip" ? "active" : "") + '">Kip &amp; gevogelte</button></div>' +
                '<div class="cellsub" style="margin-top:4px">' + esc(tempNormHint(S.tempGroep(groep === "kip" ? "kip" : "koel"))) + "</div></div>"
            : '<div class="cellsub" style="margin:-4px 0 12px">' + esc(tempNormHint(S.tempGroep("dv"))) + "</div>") +
          '<div class="field"><label>Temperatuur (°C)</label><div class="temp-wrap" id="vbTempWrap"><input class="lc-in" type="text" inputmode="decimal" name="temp" autofocus><span class="temp-ico" aria-hidden="true"></span></div></div>' +
          '<div class="field" id="vbActieWrap" hidden><label>Actie bij afwijking temperatuur / kwaliteit</label><textarea class="lc-in" name="actie" rows="2" placeholder="Verplicht bij een afwijking: waarschuw je leidinggevende, beschrijf de actie en wat er met de producten is gedaan."></textarea></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" type="submit">' + svg("check", "icon-sm") + "Meting opslaan</button>" +
          '<button class="btn btn-ghost" type="button" data-vbcancel>Annuleren</button></div>' +
        "</form>");
    }
    var rows = lijst.length ? lijst.map(function (m) {
      var o = S.vbOordeel(m), afw = S.vbAfwijking(m);
      return '<tr class="' + (afw ? "vb-afw" : "") + '"><td><div class="cellname">' + (m.type === "dv" ? "Vriesbox" : "Koelbox") + "</div>" +
        (m.type === "koel" ? '<div class="cellsub">' + esc(S.tempGroep(m.koelGroep).naam) + "</div>" : "") + "</td>" +
        '<td data-th="Temperatuur"><b class="lv-' + o.level + '">' + esc(fmtTemp(m.temp)) + "</b></td>" +
        '<td data-th="Oordeel">' + tempBadge(o) + "</td>" +
        '<td data-th="Controleur">' + esc(m.doorNaam) + '<div class="cellsub">' + fmtClock(m.at) + "</div></td>" +
        '<td data-th="Actie">' + (m.actie ? esc(m.actie) : '<span class="cellsub">—</span>') + "</td>" +
        '<td style="text-align:right">' + (canEdit ? '<button class="pl-x" data-vbdel="' + m.id + '" title="Verwijderen">' + svg("trash", "icon-sm") + "</button>" : "") + "</td></tr>";
    }).join("") : '<tr><td colspan="6"><div class="cellsub" style="padding:14px">Nog geen metingen voor deze shift.</div></td></tr>';
    var tabel = '<div class="vb-tabel">' + panel("clipboard", "Metingen " + c.dd + " · " + esc(fmtDate(c.d)),
      '<div class="table-scroll"><table class="table"><thead><tr><th>Box</th><th>Temperatuur</th><th>Oordeel</th><th>Controleur</th><th>Actie bij afwijking</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>") + "</div>";
    return intro + form + tabel + tempNormsBox();
  }
  function bindVb(c) {
    var nb = el("app").querySelector("[data-vbnew]"); if (nb) nb.addEventListener("click", function () { state.vbAdding = true; renderKwaliteit(); });
    var cb = el("app").querySelector("[data-vbcancel]"); if (cb) cb.addEventListener("click", function () { state.vbAdding = false; renderKwaliteit(); });
    document.querySelectorAll("[data-vbtype]").forEach(function (b) { b.addEventListener("click", function () { state.vbType = b.getAttribute("data-vbtype"); renderKwaliteit(); }); });
    document.querySelectorAll("[data-vbgroep]").forEach(function (b) { b.addEventListener("click", function () { state.vbGroep = b.getAttribute("data-vbgroep"); renderKwaliteit(); }); });
    var f = el("vbForm");
    if (f) {
      // Live: veld kleurt mee met het oordeel; het actieveld verschijnt alleen bij oranje/rood.
      var sync = function () {
        var m = { type: state.vbType || "koel", koelGroep: state.vbGroep || "koel", temp: f.elements.temp.value };
        var st = tempInputState(el("vbTempWrap"), S.vbOordeel(m).level);
        el("vbActieWrap").hidden = !(st === "warn" || st === "err");
      };
      f.elements.temp.addEventListener("input", sync); sync();
    }
    if (f) f.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = { type: state.vbType || "koel", koelGroep: state.vbGroep || "koel", temp: f.elements.temp.value, actie: f.elements.actie.value };
      try { var m = S.vbAdd(c.h, c.d, c.dd, d); state.vbAdding = false; toast(S.vbAfwijking(m) ? "Meting opgeslagen — afwijking vastgelegd." : "Meting opgeslagen.", "ok"); renderKwaliteit(); }
      catch (err) { toast(err.message, "err"); }
    });
    document.querySelectorAll("[data-vbdel]").forEach(function (b) { b.addEventListener("click", function () { try { S.vbRemove(c.h, c.d, c.dd, b.getAttribute("data-vbdel")); toast("Meting verwijderd.", "ok"); renderKwaliteit(); } catch (err) { toast(err.message, "err"); } }); });
  }
  function openEmbVak(c, vak, refresh) {
    refresh = refresh || renderKwaliteit;
    var canEdit = S.canOpShift(S.currentUser(), c.h, c.d, c.dd, "kwaliteit", "Kwaliteit");
    var arr = S.emballageVakArr(c.h, vak) || [];
    var trolleys = "";
    for (var t = 0; t < S.EMB_TROLLEYS; t++) {
      trolleys += '<div class="emb-trolley"><div class="emb-tnr">Trolley ' + (t + 1) + "</div>" +
        '<div class="emb-ctrl">' +
          (canEdit ? '<button class="emb-btn" data-embbump="' + vak + "|" + t + '|-1">&minus;</button>' : "") +
          '<input type="number" min="0" inputmode="numeric" class="emb-in" data-emb="' + vak + "|" + t + '" value="' + (arr[t] || 0) + '"' + (canEdit ? "" : " disabled") + ">" +
          (canEdit ? '<button class="emb-btn" data-embbump="' + vak + "|" + t + '|1">+</button>' : "") +
        "</div></div>";
    }
    function refreshTotal(ov) { ov.querySelector(".emb-total").textContent = S.emballageVakTotal(c.h, c.d, c.dd, vak) + " kratjes"; }
    // Leeghalen mag de binnendienst, én de LC-dienst (zij doen de pendels en zetten hier statiegeld weg).
    var canClear = S.level(S.currentUser()) >= 3 || S.canOpShift(S.currentUser(), c.h, c.d, c.dd, "lc", "LC");
    openModal({
      title: "Vak " + vak + " — emballage", icon: "tag",
      body: '<div class="emb-rack"><div class="emb-rack-h">14 trolleys <span class="emb-total">' + S.emballageVakTotal(c.h, c.d, c.dd, vak) + " kratjes</span></div><div class=\"emb-grid\">" + trolleys + "</div></div>",
      foot: (canClear ? '<button class="btn btn-red" id="embClear">' + svg("trash", "icon-sm") + "Vak leeghalen</button>" : "") + '<button class="btn btn-primary" data-close>Klaar</button>',
      onMount: function (ov, close) {
        var ec = ov.querySelector("#embClear");
        if (ec) ec.addEventListener("click", function () { try { S.clearEmbVak(c.h, c.d, c.dd, vak); if (close) close(); refresh(); toast("Vak leeggehaald.", "ok"); } catch (e) { toast(e.message, "err"); } });
        ov.querySelectorAll("[data-emb]").forEach(function (inp) {
          inp.addEventListener("change", function () {
            var p = inp.getAttribute("data-emb").split("|");
            try { S.emballageSet(c.h, c.d, c.dd, p[0], parseInt(p[1], 10), inp.value); refreshTotal(ov); refresh(); } catch (e) { toast(e.message, "err"); }
          });
        });
        ov.querySelectorAll("[data-embbump]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var p = btn.getAttribute("data-embbump").split("|");
            var input = ov.querySelector('[data-emb="' + p[0] + "|" + p[1] + '"]');
            var nv = Math.max(0, (parseInt(input.value, 10) || 0) + parseInt(p[2], 10));
            try { S.emballageSet(c.h, c.d, c.dd, p[0], parseInt(p[1], 10), nv); input.value = nv; refreshTotal(ov); refresh(); } catch (e) { toast(e.message, "err"); }
          });
        });
      }
    });
  }

  /* ---------- Temperatuur goederenontvangst (EFC) — hoort bij Pendelcontrol ----------
     Digitale versie van formulier RF 11 HUB. De norm per productgroep bepaalt het
     oordeel; bij een afwijking is een actie verplicht (WI 01). */
  function fmtTemp(t) {
    var v = Math.round(parseFloat(t) * 10) / 10;
    return (v > 0 ? "+" : "") + String(v).replace(".", ",") + " °C";
  }
  function tempBadge(o) { return '<span class="badge tv-' + o.level + '">' + esc(o.label) + "</span>"; }
  // Korte omschrijving van de geldende grens, als hulp bij het invullen.
  // Live-status op een temperatuurveld: groen + vinkje (ok), oranje + uitroepteken (procesverbetering),
  // rood + kruisje (retour EFC). Geeft het niveau terug: "ok" | "warn" | "err" | "" (leeg).
  function tempInputState(wrap, level) {
    var st = level === "leeg" || !level ? "" : (level === "retour" ? "err" : level === "proces" ? "warn" : "ok");
    wrap.classList.remove("temp-ok", "temp-warn", "temp-err");
    if (st) wrap.classList.add("temp-" + st);
    var ico = wrap.querySelector(".temp-ico");
    if (ico) ico.innerHTML = st === "ok" ? svg("check", "icon-sm") : st === "warn" ? "!" : st === "err" ? svg("x", "icon-sm") : "";
    return st;
  }
  function tempNormHint(g) {
    return g.soort === "dv"
      ? "Streef " + fmtTemp(g.streefMax) + " · norm " + fmtTemp(g.norm) + " · " + fmtTemp(g.norm) + " tot " + fmtTemp(g.proces) + " vraagt procesverbetering · warmer dan " + fmtTemp(g.proces) + " retour EFC"
      : "Streef " + fmtTemp(g.streefMin) + " tot " + fmtTemp(g.streefMax) + " · norm " + fmtTemp(g.norm) + " · warmer dan " + fmtTemp(g.norm) + " retour EFC";
  }
  // Eén vak (koelbox of vriesbox) van een pendel: leeg met een invulknop, of de meting met oordeel.
  function tempSlotRow(p, slot, canEdit) {
    var m = (p.temps || {})[slot.id];
    if (!m) {
      return '<div class="pt-row pt-open">' +
        '<div class="pt-slot">' + esc(slot.naam) + "</div>" +
        '<div class="pt-mid"><div class="pt-todo">nog niet gemeten</div></div>' +
        (canEdit ? '<button class="btn btn-sm btn-ghost pt-fill" data-pttemp="' + p.id + "|" + slot.id + '">' + svg("thermo", "icon-sm") + "Meten</button>" : "") +
        "</div>";
    }
    var o = S.tempOordeel(m.groep, m.temp);
    var meta = [];
    if (m.box) meta.push("box " + esc(m.box));
    if (m.doorNaam) meta.push(esc(m.doorNaam) + (m.at ? " " + fmtClock(m.at) : ""));
    return '<div class="pt-row lv-' + o.level + '">' +
      '<div class="pt-slot">' + esc(slot.naam) + '<span class="pt-t">' + esc(fmtTemp(m.temp)) + "</span></div>" +
      '<div class="pt-mid"><div class="pt-prod">' + esc(m.product) + "</div>" +
        (meta.length ? '<div class="pt-meta">' + meta.join(" · ") + "</div>" : "") +
        '<div class="pt-tags">' + tempBadge(o) + (m.tht === false ? '<span class="badge tv-retour">THT niet OK</span>' : "") + "</div>" +
        (m.actie ? '<div class="pt-actie">' + svg("alertTri", "icon-sm") + esc(m.actie) + "</div>" : "") + "</div>" +
      (canEdit ? '<button class="pt-edit" data-pttemp="' + p.id + "|" + slot.id + '" title="Meting aanpassen">' + svg("pencil", "icon-sm") + "</button>" : "") +
      "</div>";
  }
  function tempBlock(p, nr, canEdit) {
    var t = p.temps || {};
    var gedaan = S.TEMP_SLOTS.filter(function (s) { return t[s.id]; });
    var afw = gedaan.filter(function (s) { return S.tempAfwijking(t[s.id]); }).length;
    var stat = afw ? '<span class="pt-count bad">' + afw + " afwijking" + (afw === 1 ? "" : "en") + "</span>"
      : gedaan.length === S.TEMP_SLOTS.length ? '<span class="pt-count good">compleet</span>'
      : '<span class="pt-count">' + gedaan.length + " van " + S.TEMP_SLOTS.length + "</span>";
    return '<div class="pt-block"><div class="pt-head">' + svg("thermo", "icon-sm") + "<b>Temperatuur</b>" + stat + "</div>" +
      '<div class="pt-list">' + S.TEMP_SLOTS.map(function (s) { return tempSlotRow(p, s, canEdit); }).join("") + "</div></div>";
  }
  // De normtabellen van het papieren formulier, als naslag onder de pendels.
  function tempNormsBox() {
    var koel = S.TEMP_GROEPEN.filter(function (g) { return g.soort === "koel"; });
    var dv = S.tempGroep("dv");
    return '<details class="pt-norms"><summary>' + svg("info", "icon-sm") + "Wettelijke normtemperaturen</summary><div class=\"pt-norms-body\">" +
      '<div class="table-scroll"><table class="table table-grid"><thead><tr><th>Productgroep</th><th>Streef</th><th>Norm</th><th>Retour EFC</th></tr></thead><tbody>' +
      koel.map(function (g) {
        return "<tr><td>" + esc(g.naam) + "</td><td>" + esc(fmtTemp(g.streefMin)) + " tot " + esc(fmtTemp(g.streefMax)) + "</td><td>" + esc(fmtTemp(g.norm)) + "</td><td>warmer dan " + esc(fmtTemp(g.norm)) + "</td></tr>";
      }).join("") +
      "<tr><td>" + esc(dv.naam) + "</td><td>" + esc(fmtTemp(dv.streefMax)) + "</td><td>" + esc(fmtTemp(dv.norm)) + "</td><td>warmer dan " + esc(fmtTemp(dv.proces)) + "</td></tr>" +
      "</tbody></table></div>" +
      '<p class="cellsub" style="margin:10px 0 0">Diepvries tussen ' + esc(fmtTemp(dv.norm)) + " en " + esc(fmtTemp(dv.proces)) + " vraagt procesverbetering — de locatiemanager informeert het EFC. " +
      "Bij afwijking: waarschuw je leidinggevende en beschrijf wat er met de producten is gedaan (WI 01).</p></div></details>";
  }

  /* Dagarchief (teamleider+): alle controles van één dag in de indeling van het
     papieren formulier — per pendel een koel- en een vriesregel. Bewust een
     table-grid, zodat hij als document leesbaar blijft en horizontaal scrollt
     in plaats van op mobiel uit elkaar te vallen in kaartjes. */
  function tempArchiefBody(c) {
    var rijen;
    try { rijen = S.tempArchief(c.h, c.d); }
    catch (e) { return '<div class="alert alert-error">' + esc(e.message) + "</div>"; }
    var hub = S.hubById(c.h);
    var kop = '<div class="ar-head">' +
      '<div><span class="ar-lab">Goederenontvangst vanuit EFC</span><b>' + esc(hub ? hub.naam : "") + "</b></div>" +
      '<div><span class="ar-lab">Weeknr</span><b>' + isoWeek(new Date(c.d + "T00:00:00")) + "</b></div>" +
      '<div><span class="ar-lab">Datum</span><b>' + esc(fmtDate(c.d)) + "</b></div>" +
      '<div><span class="ar-lab">Bereik</span><b>hele dag · AM + PM</b></div>' +
      "</div>";
    // Geen pendels, of wel pendels maar nergens een meting → niets te archiveren.
    var gemeten = rijen.some(function (r) { return r.metingen.some(function (x) { return !!x.meting; }); });
    if (!gemeten) return panel("van", "Temperatuurcontrole pendels (EFC)", kop + '<div class="cellsub" style="padding:14px">Geen temperatuurcontroles gevonden.</div>');

    var body = rijen.map(function (r) {
      var pendelCel = '<td rowspan="2" class="ar-nr"><b>Pendel ' + r.nr + "</b>" +
        '<div class="cellsub">' + esc(r.dagdeel) + (r.tijd ? " · " + esc(r.tijd) : "") + "</div></td>";
      var ritCel = '<td rowspan="2" class="ar-rit">' + (r.rit ? esc(r.rit) : '<span class="cellsub">—</span>') + "</td>";
      return r.metingen.map(function (x, i) {
        var m = x.meting, leeg = '<span class="cellsub">—</span>';
        // Kolomvolgorde van het formulier: pendel · vak · rit · box · product · temperatuur · oordeel · controleur · actie
        var cellen = [];
        if (i === 0) cellen.push(pendelCel);
        cellen.push('<td class="ar-slot">' + esc(x.slot.kort) + "</td>");
        if (i === 0) cellen.push(ritCel);
        if (!m) {
          cellen.push('<td colspan="6" class="cellsub ar-leeg">niet gemeten</td>');
        } else {
          var o = S.tempOordeel(m.groep, m.temp);
          var goed = o.level !== "retour" && o.level !== "proces" && m.tht !== false;
          cellen.push("<td>" + (m.box ? esc(m.box) : leeg) + "</td>");
          cellen.push("<td>" + esc(m.product) + "</td>");
          cellen.push('<td class="ar-temp lv-' + o.level + '">' + esc(fmtTemp(m.temp)) + "</td>");
          cellen.push('<td class="ar-ok">' + (goed ? '<span class="badge tv-streef">OK</span>' : '<span class="badge tv-retour">NIET OK</span>') +
            '<div class="cellsub">' + esc(m.tht === false ? "THT niet OK" : o.label) + "</div></td>");
          cellen.push("<td>" + esc(m.doorNaam || "—") + (m.at ? '<div class="cellsub">' + fmtClock(m.at) + "</div>" : "") + "</td>");
          cellen.push('<td class="ar-actie">' + (m.actie ? esc(m.actie) : leeg) + "</td>");
        }
        return "<tr>" + cellen.join("") + "</tr>";
      }).join("");
    }).join("");

    return panel("van", "Temperatuurcontrole pendels (EFC)", kop +
      '<div class="table-scroll"><table class="table table-grid ar-table">' +
      "<thead><tr><th>Pendel</th><th>Vak</th><th>Rtnr.</th><th>Boxnr.</th><th>Gemeten product</th><th>Temperatuur</th><th>Oordeel</th><th>Controleur</th><th>Actie bij afwijking</th></tr></thead>" +
      "<tbody>" + body + "</tbody></table></div>" +
      '<p class="cellsub" style="margin:10px 12px 8px">Alleen-lezen archief. Het oordeel volgt uit de wettelijke normtemperaturen; bij een afwijking is een actie verplicht vastgelegd (WI 01).</p>');
  }
  // Tweede blok in het dagarchief: de Voedselbank-metingen (AM + PM) in de kolomvolgorde van het papieren formulier.
  function vbArchiefBody(c) {
    var items; try { items = S.vbArchief(c.h, c.d); } catch (e) { return ""; }
    var kop = '<div class="ar-head"><div><span class="ar-lab">Registratieformulier temperatuur Voedselbank</span><b>' + esc(fmtDate(c.d)) + "</b></div><div><span class=\"ar-lab\">Bereik</span><b>hele dag · AM + PM</b></div></div>";
    if (!items.length) return panel("thermo", "Temperatuurcontrole retouren (Voedselbank)", kop + '<div class="cellsub" style="padding:14px">Geen Voedselbank-metingen gevonden.</div>');
    var leeg = '<span class="cellsub">—</span>';
    var rows = items.map(function (x) {
      var m = x.m, o = S.vbOordeel(m);
      return '<tr><td class="ar-nr"><b>' + esc(x.dagdeel) + "</b></td>" +
        "<td>" + (m.type === "dv" ? "Vriesbox" : "Koelbox") + (m.type === "koel" ? '<div class="cellsub">' + esc(S.tempGroep(m.koelGroep).kort) + "</div>" : "") + "</td>" +
        '<td class="ar-temp lv-' + o.level + '">' + esc(fmtTemp(m.temp)) + "</td>" +
        '<td class="ar-ok">' + (S.vbAfwijking(m) ? '<span class="badge tv-retour">NIET OK</span>' : '<span class="badge tv-streef">OK</span>') + '<div class="cellsub">' + esc(o.label) + "</div></td>" +
        "<td>" + esc(m.doorNaam || "—") + '<div class="cellsub">' + fmtClock(m.at) + "</div></td>" +
        '<td class="ar-actie">' + (m.actie ? esc(m.actie) : leeg) + "</td></tr>";
    }).join("");
    return panel("thermo", "Temperatuurcontrole retouren (Voedselbank)", kop + '<div class="table-scroll"><table class="table table-grid ar-table">' +
      "<thead><tr><th>AM / PM</th><th>Box</th><th>Temperatuur</th><th>Oordeel</th><th>Controleur</th><th>Actie bij afwijking</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>");
  }

  // Eigen module onder "Beheer" (v=103, was een tab in Laadproces). Per dag (AM + PM samen), dus alleen een datumkiezer.
  function renderTempArchief() {
    var c = ctx();
    if (!state.arTab) state.arTab = "pendels";
    var seg = '<div class="seg" style="margin-bottom:16px">' +
      '<button data-artab="pendels" class="' + (state.arTab === "pendels" ? "active" : "") + '">Pendels</button>' +
      '<button data-artab="retouren" class="' + (state.arTab === "retouren" ? "active" : "") + '">Retouren</button></div>';
    el("app").innerHTML = moduleShell("Temperatuurarchief", dayBar() + seg + (state.arTab === "retouren" ? vbArchiefBody(c) : tempArchiefBody(c)), { noShift: true });
    bindModuleHeader(renderTempArchief);
    document.querySelectorAll("[data-artab]").forEach(function (b) { b.addEventListener("click", function () { state.arTab = b.getAttribute("data-artab"); renderTempArchief(); }); });
    animateTab(el("app").querySelector("main"), "archief:" + state.arTab);
  }

  /* ---------- Boxnummer scannen (QR én streepjescode) ----------
     Twee routes, want de hub gebruikt Android én iPhone:
       1. BarcodeDetector — zit ingebouwd in Chrome/Android, kost niets extra.
       2. ZXing (js/vendor/zxing.min.js) — voor Safari/iPhone, dat die API niet heeft.
     De bibliotheek wordt pas ingeladen als hij nodig is, zodat de app licht blijft.
     De camera regel ik zelf (achtercamera), zodat beide routes hetzelfde beeld delen. */
  var zxingPromise = null;
  function appVersion() {                       // cache-bust gelijk aan de rest van de app
    var s = document.querySelector('script[src*="js/ui.js"]');
    var m = s && s.getAttribute("src").match(/\?v=(\d+)/);
    return m ? m[1] : "";
  }
  function loadZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (zxingPromise) return zxingPromise;
    zxingPromise = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "js/vendor/zxing.min.js" + (appVersion() ? "?v=" + appVersion() : "");
      s.onload = function () { window.ZXing ? res(window.ZXing) : rej(new Error("De scanner kon niet geladen worden.")); };
      s.onerror = function () { zxingPromise = null; rej(new Error("De scanner kon niet geladen worden.")); };
      document.head.appendChild(s);
    });
    return zxingPromise;
  }
  function scanBeschikbaar() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  function openBoxScanner(onFound) {
    if (!scanBeschikbaar()) { toast("Deze browser kan de camera niet gebruiken — typ het nummer.", "err"); return; }
    var stream = null, reader = null, gestopt = false, bewaker = null;
    function stop() {
      gestopt = true;
      if (bewaker) { clearInterval(bewaker); bewaker = null; }
      if (reader) { try { reader.reset(); } catch (e) {} reader = null; }
      if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); stream = null; }
    }
    var mod = openModal({
      title: "Boxnummer scannen", icon: "scan",
      body: '<div class="scan-wrap"><video id="scanVid" playsinline muted autoplay></video><div class="scan-frame"></div></div>' +
        '<div id="scanMsg" class="scan-msg">Camera starten…</div>',
      foot: '<button class="btn btn-ghost" data-close>Annuleren</button>',
      onMount: function (ov, close) {
        var video = ov.querySelector("#scanVid"), msg = ov.querySelector("#scanMsg");
        function zeg(t, err) { msg.textContent = t; msg.classList.toggle("err", !!err); }
        function klaar(waarde) {
          var v = String(waarde == null ? "" : waarde).trim();
          if (!v || gestopt) return;
          stop(); close(); onFound(v);
        }
        // De camera moet ook stoppen als de gebruiker via de achtergrond of het kruisje sluit.
        bewaker = setInterval(function () { if (!document.body.contains(ov)) stop(); }, 400);

        // Hoge resolutie + doorlopende autofocus: streepjescodes (Code 39) zijn anders te onscherp/klein om te lezen.
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: "continuous" }] }, audio: false })
          .then(function (s) {
            if (gestopt) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
            stream = s; video.srcObject = s;
            var p = video.play(); if (p && p.catch) p.catch(function () {});
            zeg("Richt de camera op de code op de box.");
            if ("BarcodeDetector" in window) return startNatief(video, klaar, zeg);
            return startZXing(s, video, klaar, zeg);
          })
          .catch(function (e) {
            var geweigerd = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
            zeg(geweigerd ? "Geen toegang tot de camera. Sta dat toe in je browser, of typ het nummer."
                          : "Camera niet beschikbaar — typ het nummer.", true);
          });

        // Formaten die op de boxen voorkomen: QR (koelbox) en Code 39 (vriesbox), plus de gangbare rest.
        var WIL = ["qr_code", "code_39", "code_128", "ean_13", "ean_8", "itf", "data_matrix", "upc_a", "upc_e"];
        function startNatief(vid, gevonden, zeggen) {
          return window.BarcodeDetector.getSupportedFormats().then(function (fmts) {
            var gebruik = (fmts || []).filter(function (f) { return WIL.indexOf(f) !== -1; });
            // Sommige Androids melden de API wel maar kunnen niets (geen Play Services): dan meteen ZXing.
            if (!gebruik.length) return startZXing(stream, vid, gevonden, zeggen);
            var det = new window.BarcodeDetector({ formats: gebruik });
            var start = Date.now(), fouten = 0;
            (function lus() {
              if (gestopt) return;
              // Levert de ingebouwde detector na 6 s niets op (of blijft hij fouten geven), dan alsnog ZXing erbij.
              if (Date.now() - start > 6000 || fouten > 5) return startZXing(stream, vid, gevonden, zeggen);
              det.detect(vid).then(function (codes) {
                if (codes && codes.length) return gevonden(codes[0].rawValue);
                setTimeout(lus, 100);
              }).catch(function () { fouten++; setTimeout(lus, 250); });
            })();
          }).catch(function () { return startZXing(stream, vid, gevonden, zeggen); });
        }
        function startZXing(s, vid, gevonden, zeggen) {
          if (reader) return; // al actief
          zeggen("Scanner laden…");
          return loadZXing().then(function (Z) {
            if (gestopt) return;
            zeggen("Richt de camera op de code op de box en houd stil.");
            var hints = new Map();
            hints.set(Z.DecodeHintType.TRY_HARDER, true);
            hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.ITF, Z.BarcodeFormat.DATA_MATRIX]);
            reader = new Z.BrowserMultiFormatReader(hints, 200);
            reader.decodeFromStream(s, vid, function (result) { if (result) gevonden(result.getText()); });
          }).catch(function (e) { zeggen(e.message + " Typ het nummer.", true); });
        }
      }
    });
    return mod;
  }

  // Meting vastleggen of aanpassen voor één vak. Toont live het oordeel en vraagt om een actie zodra het afwijkt.
  function openPenTemp(c, pen, nr, slot, refresh) {
    var meting = (pen.temps || {})[slot.id];
    var isNew = !meting;
    var m = meting || { groep: slot.groepen[0], temp: "", product: "", box: "", tht: true, actie: "" };
    var tht = m.tht !== false;
    var groepOpts = slot.groepen.map(function (id) {
      var g = S.tempGroep(id);
      return '<option value="' + g.id + '"' + (m.groep === g.id ? " selected" : "") + ">" + esc(g.naam) + "</option>";
    }).join("");
    // Bij de vriesbox is er maar één productgroep — dan is een keuzelijst alleen ruis.
    var groepVeld = slot.groepen.length > 1
      ? '<div class="field"><label>Productgroep</label><select name="groep">' + groepOpts + '</select><div class="hint" id="ptNorm"></div></div>'
      : '<input type="hidden" name="groep" value="' + slot.groepen[0] + '"><div class="field"><label>Productgroep</label>' +
        '<div class="pt-fixed">' + esc(S.tempGroep(slot.groepen[0]).naam) + '</div><div class="hint" id="ptNorm"></div></div>';
    openModal({
      title: esc(slot.naam) + " — pendel " + nr,
      icon: "thermo",
      // Volgorde zoals het papieren formulier: datum/shift/naam (vast) · boxnummer · product · productgroep · temperatuur · THT.
      body: '<form id="ptForm" autocomplete="off">' +
        '<div class="vb-grid" style="margin-bottom:12px">' +
          '<div class="field"><label>Datum</label><div class="vb-ro">' + svg("calendar", "icon-sm") + esc(fmtDate(c.d)) + "</div></div>" +
          '<div class="field"><label>Naam controleur</label><div class="vb-ro">' + svg("user", "icon-sm") + fullName(c.u) + "</div></div>" +
        "</div>" +
        '<div class="field"><label>Boxnummer</label><div class="box-scan">' +
          '<input name="box" value="' + esc(m.box || "") + '" required>' +
          (scanBeschikbaar() ? '<button type="button" class="btn btn-ghost scan-btn" id="ptScan" title="Code op de box scannen">' + svg("scan", "icon-sm") + "Scan</button>" : "") +
        "</div></div>" +
        '<div class="field"><label>Gemeten product</label><input name="product" value="' + esc(m.product || "") + '" required></div>' +
        groepVeld +
        '<div class="field"><label>Temperatuur (°C)</label><div class="temp-wrap" id="ptTempWrap"><input name="temp" inputmode="decimal" value="' + esc(m.temp === "" ? "" : String(m.temp).replace(".", ",")) + '" required><span class="temp-ico" aria-hidden="true"></span></div></div>' +
        '<div class="field"><label>THT (houdbaarheidsdatum)</label><div class="seg pt-seg">' +
          '<button type="button" data-ptht="ok" class="' + (tht ? "active" : "") + '">OK</button>' +
          '<button type="button" data-ptht="niet" class="' + (tht ? "" : "active") + '">NIET OK</button></div></div>' +
        '<div id="ptVerdict"></div>' +
        '<div class="field" id="ptActieWrap"><label>Actie bij afwijking</label>' +
          '<textarea name="actie" rows="2" placeholder="Wie is gewaarschuwd en wat is er met de producten gedaan?">' + esc(m.actie || "") + "</textarea></div>" +
        '<div id="ptMsg"></div></form>',
      foot: (isNew ? "" : '<button class="btn btn-red" id="ptDel">' + svg("trash", "icon-sm") + "Wissen</button>") +
        '<button class="btn btn-ghost" data-close>Annuleren</button>' +
        '<button class="btn btn-primary" id="ptSave">' + svg("check", "icon-sm") + "Opslaan</button>",
      onMount: function (ov, close) {
        var f = ov.querySelector("#ptForm");
        function vals() { return { groep: f.groep.value, temp: f.temp.value, product: f.product.value, box: f.box.value, tht: tht, actie: f.actie.value }; }
        // Live oordeel: kleurt mee en maakt het actieveld verplicht zodra er iets afwijkt.
        function sync() {
          var g = S.tempGroep(f.groep.value);
          ov.querySelector("#ptNorm").textContent = tempNormHint(g);
          var o = S.tempOordeel(f.groep.value, f.temp.value);
          var afw = S.tempAfwijking(vals());
          var goed = o.level === "streef" || o.level === "norm" || o.level === "koud";
          var v = ov.querySelector("#ptVerdict");
          v.innerHTML = o.level === "leeg" ? "" :
            '<div class="pt-verdict lv-' + o.level + '">' + svg(goed ? "checkCircle" : "alertTri", "icon-sm") +
            "<b>" + esc(fmtTemp(f.temp.value.replace(",", "."))) + "</b> — " + esc(o.label) + "</div>";
          ov.querySelector("#ptActieWrap").classList.toggle("req", afw);
          // Veld kleurt mee; het actieveld alleen tonen bij oranje/rood (of THT niet OK).
          var st = tempInputState(ov.querySelector("#ptTempWrap"), o.level);
          ov.querySelector("#ptActieWrap").hidden = !(st === "warn" || st === "err" || !tht);
        }
        f.addEventListener("input", sync);
        f.addEventListener("change", sync);
        var scanKnop = ov.querySelector("#ptScan");
        if (scanKnop) scanKnop.addEventListener("click", function () {
          openBoxScanner(function (waarde) {
            f.box.value = waarde;
            f.box.focus();
            // De ruwe waarde tonen: zo zie je meteen of er meer in de code zit dan het nummer.
            toast("Gescand: " + waarde, "ok");
            sync();
          });
        });
        ov.querySelectorAll("[data-ptht]").forEach(function (b) {
          b.addEventListener("click", function () {
            tht = b.getAttribute("data-ptht") === "ok";
            ov.querySelectorAll("[data-ptht]").forEach(function (x) { x.classList.toggle("active", (x.getAttribute("data-ptht") === "ok") === tht); });
            sync();
          });
        });
        sync();
        ov.querySelector("#ptSave").addEventListener("click", function () {
          try {
            S.setPendelTemp(c.h, c.d, c.dd, pen.id, slot.id, vals());
            close(); refresh(); toast(isNew ? "Meting vastgelegd." : "Meting bijgewerkt.", "ok");
          } catch (e) { ov.querySelector("#ptMsg").innerHTML = '<div class="alert alert-error">' + esc(e.message) + "</div>"; }
        });
        var del = ov.querySelector("#ptDel");
        if (del) del.addEventListener("click", function () {
          try { S.clearPendelTemp(c.h, c.d, c.dd, pen.id, slot.id); close(); refresh(); toast("Meting gewist.", "ok"); }
          catch (e) { toast(e.message, "err"); }
        });
      }
    });
  }

  /* ---------- LC (laden + pendels) ---------- */
  function renderLC() {
    autoShift("lc");
    var c = ctx(), u = c.u;
    var lc = S.getLC(c.h, c.d, c.dd);
    var tr = S.getTrolley(c.h, c.d, c.dd);
    var dashView = state.viewOnly;          // geopend via 'Bekijk voortgang' op het senior-dashboard
    var isBinnen = S.isSetup(u);
    var showTimes = dashView && isBinnen;   // afvinktijden alleen voor de binnendienst in de dashboard-weergave
    // In de dashboard-weergave mag de binnendienst zelf bewerken (zoals de controleur); anders de LC binnen het venster.
    var canLoad = dashView ? (isBinnen && !S.isFutureDay(c.d)) : (opWindowOK(u, "lc", c) && S.canOpShift(u, c.h, c.d, c.dd, "lc", "LC"));
    var canSetup = !state.viewOnly && S.level(u) >= 3;
    var isPM = c.dd === "PM";
    var st = S.lcStats(c.h, c.d, c.dd);
    var canPC = !state.viewOnly && opWindowOK(u, "lc", c) && S.pcCanEdit(u, c.h, c.d, c.dd);
    // Temperatuurregistratie: de LC-dienst óf de binnendienst, binnen hetzelfde tijdvenster.
    var canTemp = !state.viewOnly && opWindowOK(u, "lc", c) && S.tempCanEdit(u, c.h, c.d, c.dd);
    if (!state.lcTab || state.lcTab === "pendels") state.lcTab = state.lcTab === "pendels" ? "pc" : (state.lcTab || "laden");
    if (state.lcTab === "archief") state.lcTab = "pc";           // archief is sinds v=103 een eigen module onder Beheer
    var seg = '<div class="seg" style="margin-bottom:16px;flex-wrap:wrap">' +
      '<button data-lctab="laden" class="' + (state.lcTab === "laden" ? "active" : "") + '">Laden</button>' +
      '<button data-lctab="pc" class="' + (state.lcTab === "pc" ? "active" : "") + '">Pendelcontrol</button>' +
      '<button data-lctab="tellen" class="' + (state.lcTab === "tellen" ? "active" : "") + '">Tellen</button>' +
      '<button data-lctab="statiegeld" class="' + (state.lcTab === "statiegeld" ? "active" : "") + '">Statiegeld</button>' +
      "</div>";

    // ----- LADEN -----
    // Filter "Alleen nog te laden": bussen met rit/bus die nog niet geladen zijn (JBT/N2 hoeven niet).
    var eersteRitten = lc.vakken.filter(function (v) { return !v.tweedeRit; }), tweedeRitten = lc.vakken.filter(function (v) { return v.tweedeRit; });
    var lcVakken = state.lcOnlyOpen ? eersteRitten.filter(function (v) { return !(v.jbt || v.type === "N2") && !v.geladen && (v.bus || v.rit); }) : eersteRitten;
    var rows = lcVakken.length ? lcVakken.map(function (v) {
      var noLoad = v.jbt || v.type === "N2" || v.tweedeRit; // JBT, N2 en 2e ritten hoeven niet geladen te worden
      var busEditable = canLoad && isPM && v.type !== "N2"; // op PM mag de LC alleen diesel-bussen aanpassen
      var busCell = busEditable ? '<input class="lc-in" data-lcbus="' + v.nr + '" placeholder="busnr" value="' + esc(v.bus) + '">' : '<span class="' + (v.bus ? "cellname" : "cellsub") + '">' + (v.bus ? esc(v.bus) : "—") + "</span>";
      var typeBadge = v.type === "N2" ? '<span class="badge n2">' + svg("bolt", "icon-sm") + "N2</span>" : '<span class="badge diesel">' + svg("droplet", "icon-sm") + "Diesel</span>";
      var typeCell = (v.jbt ? '<span class="badge jbt">' + svg("cap", "icon-sm") + "JBT</span> " : "") + typeBadge;
      // JBT/N2: afvinkvakje grijs & aangevinkt (niet aanklikbaar); overige vakken normaal
      var chkCell = noLoad
        ? '<label class="chk-box grey ro" title="Hoeft niet geladen te worden"><input type="checkbox" checked disabled>' + svg("check", "icon-sm") + "</label>"
        : '<label class="chk-box ' + (v.geladen ? "on" : "") + (canLoad ? "" : " ro") + '"><input type="checkbox" ' + (v.geladen ? "checked" : "") + (canLoad ? "" : " disabled") + ' data-lcgel="' + v.nr + '">' + svg("check", "icon-sm") + "</label>";
      var rowCls = noLoad ? "lc-noload" : (v.geladen ? "sc-done" : "");
      var timeCell = (showTimes && v.geladen && v.geladenAt) ? '<div class="chk-time">' + fmtClock(v.geladenAt) + "</div>" : "";
      return "<tr class=\"" + rowCls + "\"><td class=\"lc-nr cellname\">Vak " + v.nr + "</td>" +
        '<td class="cellsub" data-th="Vertrek">' + (v.vertrek ? esc(v.vertrek) : "—") + '</td><td data-th="Bus">' + busCell + "</td>" +
        '<td class="cellsub" data-th="Rit">' + (v.rit ? esc(v.rit) : "—") + '</td><td data-th="Type">' + typeCell + "</td>" +
        '<td data-th="ZE" style="text-align:center">' + (v.ze ? '<span class="badge dock">ZE</span>' : "") + "</td>" +
        '<td class="sc-chk" data-th="Geladen">' + chkCell + timeCell + "</td></tr>";
    }).join("") : '<tr><td colspan="7"><div class="cellsub" style="padding:14px">' + (state.lcOnlyOpen && lc.vakken.length ? "Alle bussen zijn geladen. 🎉" : "Er is nog geen laadlijst klaargezet.") + "</div></td></tr>";
    var table = panel("vanFast", "1e ritten", '<div class="table-scroll"><table class="table lc-table">' +
      "<thead><tr><th>Vak</th><th>Vertrek</th><th>Bus</th><th>Rit</th><th>Type</th><th>ZE</th><th>Geladen</th></tr></thead><tbody>" + rows + "</tbody></table></div>");
    var lcFilter = lc.vakken.length ? '<label class="chk lc-filter"><input type="checkbox" id="lcOnlyOpen"' + (state.lcOnlyOpen ? " checked" : "") + "> Alleen nog te laden</label>" : "";
    // 2e ritten apart: hoeven niet geladen te worden, alleen ter info (vertrektijd, bus, rit)
    var rit2Rows = tweedeRitten.map(function (v) {
      return '<tr><td class="lc-nr cellname">Vak ' + v.nr + '</td><td class="cellsub" data-th="Vertrek">' + (v.vertrek ? esc(v.vertrek) : "—") + '</td>' +
        '<td data-th="Bus"><span class="' + (v.bus ? "cellname" : "cellsub") + '">' + (v.bus ? esc(v.bus) : "—") + '</span></td><td class="cellsub" data-th="Rit">' + (v.rit ? esc(v.rit) : "—") + "</td>" +
        '<td data-th="Type">' + (v.type === "N2" ? '<span class="badge n2">' + svg("bolt", "icon-sm") + "N2</span>" : '<span class="badge diesel">' + svg("droplet", "icon-sm") + "Diesel</span>") + "</td></tr>";
    }).join("");
    var rit2Block = tweedeRitten.length ? panel("refresh", "2e ritten",
      '<div class="table-scroll"><table class="table lc-table"><thead><tr><th>Vak</th><th>Vertrek</th><th>Bus</th><th>Rit</th><th>Type</th></tr></thead><tbody>' + rit2Rows + "</tbody></table></div>") : "";
    var ladenBody = opProgress(st.done, st.used, "vakken geladen") + lcFilter + table + rit2Block;

    // ----- PENDELCONTROL: pendels (retour) links, telling rechts, import onder -----
    function ctl(id, field, val) {
      return '<div class="pen-ctl">' +
        (canLoad ? '<button class="pen-btn" data-penbump="' + id + "|" + field + '|-1">&minus;</button>' : "") +
        '<span class="pen-val">' + (val || 0) + "</span>" +
        (canLoad ? '<button class="pen-btn" data-penbump="' + id + "|" + field + '|1">+</button>' : "") + "</div>";
    }
    // Op de pendel vul je alleen de RETOUR in (wat je hebt teruggegeven qua 4-/5-laags); binnen komt uit de telling.
    function retLay(p, n) {
      return '<div class="pen-lay">' + layerLabel(n) +
        '<span class="pen-ret-lab"><em>retour</em><span class="pen-arrow out">' + svg("arrowUp", "icon-sm") + "</span></span>" +
        ctl(p.id, "out" + n, p["out" + n]) + "</div>";
    }
    var pendelList = tr.pendels.length ? tr.pendels.map(function (p, i) {
      var t = p.temps || {};
      var afw = S.TEMP_SLOTS.filter(function (s) { return t[s.id] && S.tempAfwijking(t[s.id]); }).length;
      // Het ritnummer hoort bij de controle; de LC kan 'm invullen als de import 'm niet meebracht.
      var ritCell = canTemp
        ? '<input class="pen-rit" data-penrit="' + p.id + '" placeholder="ritnummer" value="' + esc(p.rit || "") + '">'
        : '<span class="' + (p.rit ? "cellname" : "cellsub") + '">' + (p.rit ? "rit " + esc(p.rit) : "geen ritnummer") + "</span>";
      return '<div class="pen-card' + (afw ? " pen-afw" : "") + '"><div class="pen-head">' + svg("van", "icon-sm") + "<b>Pendel " + (i + 1) + "</b>" +
        (p.tijd ? '<span class="pen-tijd">aankomst ' + esc(p.tijd) + "</span>" : "") + "</div>" +
        '<div class="pen-rit-row">' + ritCell +
          (p.trolleysVerwacht ? '<span class="cellsub">' + esc(p.trolleysVerwacht) + " trolleys</span>" : "") + "</div>" +
        '<div class="pen-grid">' + retLay(p, 4) + retLay(p, 5) + "</div>" +
        tempBlock(p, i + 1, canTemp) + "</div>";
    }).join("") : '<div class="cellsub" style="padding:12px">Er zijn nog geen pendels klaargezet.</div>';
    var stockBar = '<div class="hub-stock"><div class="hub-stock-h">' + svg("inbox", "icon-sm") + "Op de hub</div>" +
      '<div class="hub-stock-grid">' +
        '<div class="hub-stock-item">' + svg("layers5", "icon-sm") + '<div><div class="hub-stock-n">' + tr.stock5 + '</div><div class="hub-stock-l">5-laags</div></div></div>' +
        '<div class="hub-stock-item">' + svg("layers4", "icon-sm") + '<div><div class="hub-stock-n">' + tr.stock4 + '</div><div class="hub-stock-l">4-laags</div></div></div>' +
      "</div></div>";

    // ----- Telling (tellijst) -----
    var pcRows = S.getPCRows(c.h, c.d, c.dd), pcSt = S.pcStats(c.h, c.d, c.dd);
    function pcCounter(idx, field, val) {
      return '<div class="pc-ctrl">' + (canPC ? '<button class="tro-btn sm" data-pclayer="' + idx + "|" + field + '|-1">&minus;</button>' : "") +
        '<span class="pc-val">' + (val || 0) + "</span>" + (canPC ? '<button class="tro-btn sm" data-pclayer="' + idx + "|" + field + '|1">+</button>' : "") + "</div>";
    }
    var pcBodyRows = pcRows.length ? pcRows.map(function (r, idx) {
      return '<tr class="' + (r.gecontroleerd ? "sc-done" : "") + '"><td class="lc-nr cellname">Vak ' + esc(r.subrit) + "</td>" +
        '<td data-th="Trolleys">' + (r.trolleys || 0) + '</td><td data-th="Kratten">' + (r.kratten || 0) + '</td>' +
        '<td data-th="Vers">' + (r.versb || 0) + '</td><td data-th="Diepvries">' + (r.dvboxen || 0) + '</td><td data-th="XL">' + (r.xl || 0) + "</td>" +
        '<td data-th="4-laags">' + pcCounter(idx, "l4", r.l4) + '</td><td data-th="5-laags">' + pcCounter(idx, "l5", r.l5) + "</td>" +
        '<td class="sc-chk" data-th="Gecontroleerd"><label class="chk-box ' + (r.gecontroleerd ? "on" : "") + (canPC ? "" : " ro") + '"><input type="checkbox" ' + (r.gecontroleerd ? "checked" : "") + (canPC ? "" : " disabled") + ' data-pcchk="' + idx + '">' + svg("check", "icon-sm") + "</label></td></tr>";
    }).join("") : '<tr><td colspan="9"><div class="cellsub" style="padding:14px">Er is nog geen tellijst klaargezet.</div></td></tr>';
    var pcTot = pcSt.tot;
    var pcFoot = pcRows.length ? '<tr class="pc-tot"><td class="cellname">Totaal</td><td data-th="Trolleys"><b>' + pcTot.trolleys + '</b></td><td data-th="Kratten"><b>' + pcTot.kratten + '</b></td><td data-th="Vers"><b>' + pcTot.versb + '</b></td><td data-th="Diepvries"><b>' + pcTot.dvboxen + '</b></td><td data-th="XL"><b>' + pcTot.xl + '</b></td><td data-th="4-laags"><b>' + pcTot.l4 + '</b></td><td data-th="5-laags"><b>' + pcTot.l5 + "</b></td><td></td></tr>" : "";
    var pcTable = '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table pc-table"><thead><tr><th>Vak</th><th>Trolleys</th><th>Kratten</th><th>Vers</th><th>Diepvries</th><th>XL</th><th>4-laags</th><th>5-laags</th><th>Geteld</th></tr></thead><tbody>' + pcBodyRows + pcFoot + "</tbody></table></div></div>";
    // Pendelcontrol-tab: pendels met retour. Tellen-tab: de tellijst-telling (import staat in het dashboard).
    // Temperatuurcontrole hoort bij de pendel: voortgang + openstaande afwijkingen bovenaan.
    var tSt = S.tempStats(c.h, c.d, c.dd);
    var tempTop = tr.pendels.length
      ? opProgress(tSt.klaar, tSt.total, "pendels volledig gecontroleerd (koel + vries)") +
        (tSt.afwijkingen ? '<div class="alert alert-error">' + svg("alertTri", "icon-sm") + " " +
          (tSt.afwijkingen === 1 ? "1 meting wijkt af" : tSt.afwijkingen + " metingen wijken af") +
          " — waarschuw je leidinggevende en leg vast wat er met de producten is gedaan (WI 01).</div>" : "")
      : "";
    var pcBody = stockBar + tempTop + '<div class="pc-col-h">' + svg("van", "icon-sm") + "Pendels — retour &amp; temperatuur</div><div class=\"pen-list\">" + pendelList + "</div>" +
      (tr.pendels.length ? tempNormsBox() : "");
    var tellenBody = opProgress(pcSt.done, pcSt.total, "vakken gecontroleerd") +
      pcTable;

    // ----- STATIEGELD: emballagevakken zien + leeghalen (ook voor de LC-dienst, niet alleen Kwaliteit) -----
    var embVakken = S.VAK_NUMMERS.filter(function (i) { return S.vakSoort(c.h, c.d, c.dd, i) === "emb5"; });
    var statiegeldBody = embVakken.length
      ? '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table"><thead><tr><th>Vak</th><th>Statiegeld</th></tr></thead><tbody>' +
        embVakken.map(function (i) {
          return '<tr><td class="lc-nr cellname">Vak ' + i + '</td><td data-th="Statiegeld"><button class="btn btn-primary btn-sm" data-embopen="' + i + '">' +
            svg("tag", "icon-sm") + "Bekijken · " + S.emballageVakTotal(c.h, c.d, c.dd, i) + " kratjes</button></td></tr>";
        }).join("") + "</tbody></table></div></div>"
      : '<div class="cellsub" style="padding:12px">Er zijn nog geen vakken ingesteld op statiegeld (dat regelt Kwaliteit).</div>';

    var body = state.lcTab === "pc" ? pcBody : state.lcTab === "tellen" ? tellenBody
      : state.lcTab === "statiegeld" ? statiegeldBody : ladenBody;
    el("app").innerHTML = moduleShell("Laadproces", windowLockNote(u, "lc", c) + seg + body);
    bindModuleHeader(renderLC);
    document.querySelectorAll("[data-lctab]").forEach(function (b) { b.addEventListener("click", function () { state.lcTab = b.getAttribute("data-lctab"); renderLC(); }); });
    if (state.lcTab === "laden") {
      var lof = el("lcOnlyOpen"); if (lof) lof.addEventListener("change", function () { state.lcOnlyOpen = lof.checked; renderLC(); });
      document.querySelectorAll("[data-lcbus]").forEach(function (inp) { inp.addEventListener("change", function () { try { S.lcSetBus(c.h, c.d, c.dd, parseInt(inp.getAttribute("data-lcbus"), 10), inp.value); } catch (e) { toast(e.message, "err"); } }); });
      document.querySelectorAll("[data-lcgel]").forEach(function (cb) { cb.addEventListener("change", function () { try { S.lcToggleGeladen(c.h, c.d, c.dd, parseInt(cb.getAttribute("data-lcgel"), 10)); renderLC(); } catch (e) { toast(e.message, "err"); } }); });
    } else if (state.lcTab === "pc") {
      document.querySelectorAll("[data-penbump]").forEach(function (b) { b.addEventListener("click", function () { var p = b.getAttribute("data-penbump").split("|"); try { S.pendelBump(c.h, c.d, c.dd, p[0], p[1], parseInt(p[2], 10)); renderLC(); } catch (e) { toast(e.message, "err"); } }); });
      var penById = function (id) { return tr.pendels.filter(function (x) { return x.id === id; })[0]; };
      var penNr = function (id) { var n = 0; tr.pendels.forEach(function (x, i) { if (x.id === id) n = i + 1; }); return n; };
      document.querySelectorAll("[data-pttemp]").forEach(function (b) {
        b.addEventListener("click", function () {
          var q = b.getAttribute("data-pttemp").split("|"), p = penById(q[0]);
          if (p) openPenTemp(c, p, penNr(q[0]), S.tempSlot(q[1]), renderLC);
        });
      });
      document.querySelectorAll("[data-penrit]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          try { S.setPendelRit(c.h, c.d, c.dd, inp.getAttribute("data-penrit"), inp.value); }
          catch (e) { toast(e.message, "err"); }
        });
      });
    } else if (state.lcTab === "tellen") {
      document.querySelectorAll("[data-pcchk]").forEach(function (cb) { cb.addEventListener("change", function () { try { S.pcToggle(c.h, c.d, c.dd, parseInt(cb.getAttribute("data-pcchk"), 10)); renderLC(); } catch (e) { toast(e.message, "err"); } }); });
      document.querySelectorAll("[data-pclayer]").forEach(function (b) { b.addEventListener("click", function () { var p = b.getAttribute("data-pclayer").split("|"); try { S.pcSetLayer(c.h, c.d, c.dd, parseInt(p[0], 10), p[1], parseInt(p[2], 10)); renderLC(); } catch (e) { toast(e.message, "err"); } }); });
    } else if (state.lcTab === "statiegeld") {
      document.querySelectorAll("[data-embopen]").forEach(function (b) { b.addEventListener("click", function () { openEmbVak(c, parseInt(b.getAttribute("data-embopen"), 10), renderLC); }); });
    }
    animateTab(el("app").querySelector("main"), "lc:" + state.lcTab);
  }

  /* ---------- Senior-dashboard ---------- */
  function dockOptions(sel) { return '<option value="">—</option>' + S.DOCKS.map(function (d) { return '<option value="' + d + '"' + (String(sel) === String(d) ? " selected" : "") + ">Dock " + d + "</option>"; }).join(""); }
  function renderDashboard() {
    var c = ctx(), u = c.u;
    if (!state.dashTab || state.dashTab === "klaarzetten" || state.dashTab === "diensten") state.dashTab = state.dashTab ? "voorbereiding" : "overzicht";
    var tabs = [["overzicht", "Overzicht"], ["voorbereiding", "Voorbereiding"], ["trolley", "Trolleyvoorraad"], ["steekproeven", "Steekproeven"]];
    // Tabknoppen kleuren mee: Voorbereiding oranje+! zolang er iets mist; Trolleyvoorraad blauw tijdens een
    // lopende steekproef en oranje+! zodra Kwaliteit de telling heeft ingediend.
    var tabState = {};
    if (prepOpenCount(c) > 0) tabState.voorbereiding = "warn";
    var spT = S.spTrolleyGet(c.h, c.d, c.dd);
    if (spT && spT.status === "open") tabState.trolley = "info";
    else if (spT && spT.status === "ingediend") tabState.trolley = "warn";
    var seg = '<div class="seg dash-tabs" style="margin:14px 0 16px;flex-wrap:wrap">' + tabs.map(function (t) {
      var st = tabState[t[0]] || "";
      return '<button data-dashtab="' + t[0] + '" class="' + (state.dashTab === t[0] ? "active" : "") + (st ? " tab-" + st : "") + '">' + t[1] + (st === "warn" ? '<span class="tab-bang">!</span>' : st === "info" ? svg("clock", "icon-sm tab-clock") : "") + "</button>";
    }).join("") + "</div>";
    var body = state.dashTab === "voorbereiding" ? dashVoorbereiding(c)
      : state.dashTab === "trolley" ? dashTrolley(c)
      : state.dashTab === "steekproeven" ? dashSteekproeven(c)
      : dashOverzicht(c);
    el("app").innerHTML = moduleShell("Senior Dashboard", seg + body);
    el("app").classList.toggle("dash-page", state.dashTab === "overzicht"); // compacte kop op het overzicht (alles in beeld)
    bindModuleHeader(renderDashboard);
    document.querySelectorAll("[data-dashtab]").forEach(function (b) { b.addEventListener("click", function () { state.dashTab = b.getAttribute("data-dashtab"); renderDashboard(); }); });
    if (state.dashTab === "trolley") bindDashTrolley(c);
    else if (state.dashTab === "voorbereiding") {
      bindDashKlaarzetten(c); bindDashDiensten(c); bindSpControle(c);
      // open/dicht-stand van de checklist-items onthouden, zodat een actie (die opnieuw rendert) het item niet dichtklapt
      document.querySelectorAll("details.prep").forEach(function (d) { d.addEventListener("toggle", function () { state.prepOpen[d.getAttribute("data-prep")] = d.open; }); });
    } else if (state.dashTab === "overzicht") {
      document.querySelectorAll("[data-viewmod]").forEach(function (b) { b.addEventListener("click", function () { state.module = b.getAttribute("data-viewmod"); state.viewOnly = true; render(); }); });
      // kerngetallen → bijbehorende pagina
      document.querySelectorAll("[data-goto]").forEach(function (b) {
        b.addEventListener("click", function () {
          var p = b.getAttribute("data-goto").split("|"), mod = p[0], tab = p[1];
          if (mod === "dash") {
            if (tab === "steekproef") { state.dashTab = "voorbereiding"; if (!state.prepOpen) state.prepOpen = {}; state.prepOpen.steekproef = true; }
            else state.dashTab = tab;
            renderDashboard(); return;
          }
          if (mod === "bussenbeheer") { state.module = "bussenbeheer"; state.viewOnly = false; render(); return; }
          state.module = mod; state.viewOnly = true;
          if (mod === "lc" && tab) state.lcTab = tab;
          render();
        });
      });
      var pcBtn = el("app").querySelector("[data-viewpc]"); if (pcBtn) pcBtn.addEventListener("click", function () { state.module = "lc"; state.lcTab = "pc"; state.viewOnly = true; render(); });
    }
    animateTab(el("app").querySelector("main"), "dash:" + state.dashTab);
  }
  // Steekproeven controleren (vorige shift) — binnendienst vult systeem-kratten in en vinkt af.
  function bindSpControle(c) {
    var prevS = S.vorigeShift(c.d, c.dd);
    document.querySelectorAll("[data-spsys]").forEach(function (inp) { inp.addEventListener("change", function () { try { S.steekproefControleer(c.h, prevS.datum, prevS.dagdeel, inp.getAttribute("data-spsys"), { systeemKratten: inp.value }); renderDashboard(); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-spctrl]").forEach(function (cb) { cb.addEventListener("change", function () { try { S.steekproefControleer(c.h, prevS.datum, prevS.dagdeel, cb.getAttribute("data-spctrl"), { controleGedaan: cb.checked }); renderDashboard(); } catch (e) { toast(e.message, "err"); } }); });
  }

  // Aantal voorbereidingsonderdelen dat nog open staat (zelfde criteria als de checklist).
  function prepOpenCount(c) {
    var lcS = S.lcStats(c.h, c.d, c.dd), sc = S.schadeStats(c.h, c.d, c.dd), tr = S.getTrolley(c.h, c.d, c.dd), d = S.getDiensten(c.h, c.d, c.dd);
    var prevSc = S.vorigeShift(c.d, c.dd), scc = S.steekproefControleStats(c.h, prevSc.datum, prevSc.dagdeel);
    var n = 0;
    if (!(lcS.used > 0)) n++;
    if (!(tr.pendels.length > 0)) n++;
    if (!(sc.total > 0) && !(c.dd !== "PM" && !dockShift(c))) n++;
    if (["lc", "schadecontrole", "kwaliteit"].some(function (k) { return !(d[k] || []).length; })) n++;
    if (!(scc.total === 0 || scc.done >= scc.total)) n++;
    return n;
  }
  /* ---------- Voorbereiding: checklist (uitklapbaar) — groen+vinkje als klaar, oranje+uitroepteken als nog te doen ---------- */
  function dashVoorbereiding(c) {
    if (!state.prepOpen) state.prepOpen = {};
    var blocks = prepBlocks(c);
    var lcS = S.lcStats(c.h, c.d, c.dd), sc = S.schadeStats(c.h, c.d, c.dd), pc = S.pcStats(c.h, c.d, c.dd);
    var tr = S.getTrolley(c.h, c.d, c.dd), diensten = S.getDiensten(c.h, c.d, c.dd);
    var prevSc = S.vorigeShift(c.d, c.dd), scc = S.steekproefControleStats(c.h, prevSc.datum, prevSc.dagdeel);
    var dienstNamen = ["lc", "schadecontrole", "kwaliteit"];
    var dienstOpen = dienstNamen.filter(function (k) { return !(diensten[k] || []).length; });
    var items = [
      { key: "laden", titel: "Laadproces", icon: "inbox", done: lcS.used > 0,
        sub: lcS.used > 0 ? lcS.used + " ritten in " + lcS.total + " vakken" : (lcS.total > 0 ? lcS.total + " vakken, nog geen ritten" : "Laadlijst nog niet klaargezet"), body: blocks.laden },
      { key: "pendel", titel: "Pendels", icon: "van", done: tr.pendels.length > 0,
        sub: tr.pendels.length > 0 ? tr.pendels.length + (tr.pendels.length === 1 ? " pendel" : " pendels") + " · tellijst " + (pc.total ? pc.total + " vakken" : "nog niet geïmporteerd") : "Nog geen pendels klaargezet", body: blocks.pendel },
      { key: "schade", titel: "Schadecontrole", icon: "shield", done: sc.total > 0, opt: c.dd !== "PM" && !dockShift(c),
        sub: sc.total > 0 ? sc.total + " bussen klaargezet" : "Schadecontrolelijst nog niet klaargezet", body: blocks.schade },
      { key: "diensten", titel: "Diensten", icon: "users", done: !dienstOpen.length,
        sub: dienstOpen.length ? "Nog toewijzen: " + dienstOpen.map(function (k) { return k === "lc" ? "Laadproces" : k.charAt(0).toUpperCase() + k.slice(1); }).join(", ") : "Alle diensten toegewezen", body: dienstenBlocks(c) },
      { key: "steekproef", titel: "Steekproeven vorige shift controleren", icon: "clipboard", done: scc.total === 0 || scc.done >= scc.total,
        sub: scc.total === 0 ? "Geen steekproeven van de vorige shift" : scc.done + " / " + scc.total + " gecontroleerd", body: spControlePanel(c) }
    ];
    var klaar = items.filter(function (i) { return i.done || i.opt; }).length;
    var kop = opProgress(klaar, items.length, "onderdelen klaar");
    return kop + items.map(function (it) {
      var st = it.done ? "done" : (it.opt ? "opt" : "open");
      var open = state.prepOpen[it.key] === true || (state.prepOpen[it.key] == null && st === "open" && it.key === (items.filter(function (x) { return !x.done && !x.opt; })[0] || {}).key);
      return '<details class="prep prep-' + st + '" data-prep="' + it.key + '"' + (open ? " open" : "") + ">" +
        '<summary><span class="prep-st">' + (st === "done" ? svg("check", "icon-sm") : st === "opt" ? "–" : "!") + "</span>" +
          '<span class="prep-txt"><span class="prep-title">' + svg(it.icon, "icon-sm") + esc(it.titel) + "</span>" +
          '<span class="prep-sub">' + esc(it.sub) + (st === "opt" ? " · niet nodig voor deze shift" : "") + "</span></span>" +
          svg("chevronDown", "icon-sm prep-chev") + "</summary>" +
        '<div class="prep-body">' + it.body + "</div></details>";
    }).join("");
  }
  function dashOverzicht(c) {
    var sc = S.schadeStats(c.h, c.d, c.dd), lcS = S.lcStats(c.h, c.d, c.dd), pc = S.pcStats(c.h, c.d, c.dd);
    var diensten = S.getDiensten(c.h, c.d, c.dd);
    var isPM = c.dd === "PM";
    // to-do waarschuwingen voor de binnendienst
    var todo = [];
    var needKlaarzet = (lcS.total === 0) || (isPM && sc.total === 0);
    if (lcS.total === 0) todo.push("Laden is nog niet klaargezet");
    if (isPM && sc.total === 0) todo.push("Schadecontrolelijst is nog niet klaargezet");
    var needDiensten = !diensten.lc.length || !diensten.schadecontrole.length || !diensten.kwaliteit.length;
    if (needDiensten) todo.push("Niet alle diensten zijn toegewezen");
    // Steekproeven van de vorige shift moeten nog tegen het Jumbo-systeem gecontroleerd worden
    var prevSc = S.vorigeShift(c.d, c.dd), scc = S.steekproefControleStats(c.h, prevSc.datum, prevSc.dagdeel);
    if (scc.total > 0 && scc.done < scc.total) todo.push("Steekproeven van de vorige shift controleren (" + (scc.total - scc.done) + " open)");
    var todoBanner = ""; // geen melding meer op het overzicht — de tab 'Voorbereiding' kleurt oranje zolang er iets mist

    // Wie heeft deze shift de dienst? (namen onder de kop van elke kaart)
    function dienstNamen(key) {
      var ids = diensten[key] || [];
      var namen = ids.map(function (id) { return S.userById(id); }).filter(Boolean).map(function (us) { return esc(us.voornaam); });
      return '<div class="dash-dienst">' + svg("user", "icon-sm") + (namen.length ? namen.join(", ") : '<span class="dash-dienst-none">niemand toegewezen</span>') + "</div>";
    }
    function tile(title, icon, color, dienstKey, inner, mod) {
      var view = mod ? '<button class="btn btn-sm dash-view" data-viewmod="' + mod + '">' + svg("arrowRight", "icon-sm") + "Bekijk voortgang</button>" : "";
      return '<div class="dash-card dash-' + color + '"><div class="dash-h">' + svg(icon, "icon-sm") + esc(title) + "</div>" + (dienstKey ? dienstNamen(dienstKey) : "") + inner + view + "</div>";
    }
    var ring = function (pct, cls) { return '<div class="dash-ring ' + cls + '" style="--p:' + pct + '"><span>' + pct + "%</span></div>"; };
    // Kleine kerngetallen onder de ring: label + waarde, optioneel gekleurd (ok/warn/err)
    // Elk kerngetal is een knop naar de pagina waar het over gaat (data-goto = "module|tab").
    function facts(items) {
      return '<div class="dash-facts">' + items.map(function (f) {
        return '<button type="button" class="dash-fact' + (f.cls ? " " + f.cls : "") + '"' + (f.go ? ' data-goto="' + f.go + '"' : "") + "><b>" + f.val + "</b><span>" + esc(f.lab) + "</span></button>";
      }).join("") + "</div>";
    }
    function recentList(items, leeg) { return items.length ? '<ul class="dash-recent">' + items.join("") + "</ul>" : '<div class="cellsub dash-recent-empty">' + esc(leeg || "Nog niets.") + "</div>"; }
    function recentItem(icon, label, time) { return '<li class="dash-recent-item">' + svg(icon, "icon-sm") + '<span class="drn">' + esc(label) + "</span>" + (time ? '<span class="drt">' + esc(time) + "</span>" : "") + "</li>"; }

    // ----- Laden -----
    var lcVakken = S.getLC(c.h, c.d, c.dd).vakken;
    var lcGevuld = lcVakken.filter(function (v) { return v.bus || v.rit; });
    var lcRit2 = lcGevuld.filter(function (v) { return v.tweedeRit; }).length;
    var lcJbt = lcGevuld.filter(function (v) { return v.jbt && !v.tweedeRit; }).length;
    var recentGeladen = recentList(S.recentGeladenBussen(c.h, c.d, c.dd).map(function (v) { return recentItem("check", "Bus " + (v.bus || "vak " + v.nr), fmtClock(v.geladenAt)); }), "Nog geen bussen geladen");
    var ladenInner = '<div class="dash-row">' + ring(lcS.pct, "o") + '<div><div class="dash-big">' + lcS.done + " / " + lcS.used + '</div><div class="cellsub">Vakken geladen</div></div></div>' +
      facts([
        { lab: "Nog te laden (1e ritten)", val: lcS.used - lcS.done, cls: lcS.used - lcS.done ? "warn" : "ok", go: "lc|laden" },
        { lab: "2e ritten", val: lcRit2, go: "lc|laden" },
        { lab: "JBT-ritten", val: lcJbt, go: "lc|laden" },
        { lab: "Vakken gevuld", val: lcGevuld.length, go: "lc|laden" }
      ]) +
      '<div class="dash-recent-title">Recent geladen</div>' + recentGeladen;

    // ----- Schadecontrole -----
    var scBuses = S.getSchade(c.h, c.d, c.dd).buses;
    var scProbleem = scBuses.filter(S.busHeeftProbleem).length;
    var spSt = S.steekproefStats(c.h, c.d, c.dd);
    var recentSchade = recentList(S.recentGecontroleerdeBussen(c.h, c.d, c.dd).map(function (b) { return recentItem("check", "Bus " + (b.bus || "?"), fmtClock(b.gecontroleerdAt)); }), "Nog geen bussen gecontroleerd");
    var schadeInner = '<div class="dash-row">' + ring(sc.pct, "g") + '<div><div class="dash-big">' + sc.done + " / " + sc.total + '</div><div class="cellsub">Bussen gecontroleerd</div></div></div>' +
      facts([
        { lab: "Nog te controleren", val: sc.total - sc.done, cls: sc.total - sc.done ? "warn" : "ok", go: "schadecontrole|" },
        { lab: "Afwijkingen", val: scProbleem, cls: scProbleem ? "err" : "", go: "bussenbeheer|" },
        { lab: "Steekproeven voltooid", val: spSt.done + " / " + spSt.total, cls: spSt.done >= spSt.total ? "ok" : "warn", go: "schadecontrole|" },
        { lab: "Steekproeven controleren", val: scc.total - scc.done, cls: scc.total - scc.done ? "warn" : "ok", go: "dash|steekproef" }
      ]) +
      '<div class="dash-recent-title">Recent gecontroleerd</div>' + recentSchade;

    // ----- Pendels -----
    var tr = S.getTrolley(c.h, c.d, c.dd), tSt = S.tempStats(c.h, c.d, c.dd);
    var komendePendels = recentList(S.komendePendels(c.h, c.d, c.dd).map(function (p) { return recentItem("van", "Pendel " + (p.tijd || "?"), p.tijd || null); }), "Geen aankomende pendels");
    // Geweest = de geplande aankomsttijd is verstreken (alleen op de dag zelf; eerdere dagen: alles, latere: niets).
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes(), vandaag = ymd(new Date());
    var pGeweest = tr.pendels.filter(function (p) {
      if (c.d < vandaag) return true; if (c.d > vandaag) return false;
      var m = /^(\d{1,2}):(\d{2})$/.exec(p.tijd || ""); return !!m && (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) <= nowMin;
    }).length;
    var pPct = tr.pendels.length ? Math.round(pGeweest / tr.pendels.length * 100) : 0;
    var pendelInner = '<div class="dash-row">' + ring(pPct, "b") + '<div><div class="dash-big">' + pGeweest + " / " + tr.pendels.length + '</div><div class="cellsub">Pendels geweest</div></div></div>' +
      facts([
        { lab: "Vakken geteld", val: pc.done + " / " + pc.total, cls: pc.total && pc.done >= pc.total ? "ok" : "", go: "lc|tellen" },
        { lab: "Pendels getemperatuurd", val: tSt.klaar + " / " + tSt.total, cls: tSt.total && tSt.klaar >= tSt.total ? "ok" : "", go: "lc|pc" },
        { lab: "Afwijkingen", val: tSt.afwijkingen, cls: tSt.afwijkingen ? "err" : "", go: "lc|pc" },
        { lab: "Trolleys op de hub", val: (tr.stock4 || 0) + (tr.stock5 || 0), go: "dash|trolley" }
      ]) +
      '<div class="dash-recent-title">Volgende pendels</div>' + komendePendels +
      '<button class="btn btn-sm dash-view" data-viewpc>' + svg("arrowRight", "icon-sm") + "Bekijk Pendelcontrol</button>";

    // ----- Kwaliteit -----
    var embVakken = S.VAK_NUMMERS.filter(function (i) { return S.vakSoort(c.h, c.d, c.dd, i) === "emb5"; });
    var embTot = 0, embGevuld = 0;
    var vakTotals = embVakken.map(function (i) { var n = S.emballageVakTotal(c.h, c.d, c.dd, i); embTot += n; if (n) embGevuld++; return '<div class="emb-vaktot"><span>Vak ' + i + ":</span> <b>" + n + "</b></div>"; }).join("");
    var kwalInner = '<div class="dash-row"><div><div class="dash-big">' + embTot + '</div><div class="cellsub">Kratjes emballage</div></div></div>' +
      facts([
        { lab: "Statiegeldvakken", val: embVakken.length, go: "kwaliteit|" },
        { lab: "Vakken met emballage", val: embGevuld, cls: embGevuld ? "warn" : "ok", go: "kwaliteit|" }
      ]) +
      '<div class="dash-recent-title">Emballage per vak</div>' +
      (vakTotals ? '<div class="emb-vaktots">' + vakTotals + "</div>" : '<div class="cellsub dash-recent-empty">Geen statiegeldvakken ingesteld</div>');

    // Laden vóór schadecontrole
    var grid = '<div class="dash-grid">' +
      tile("Laden", "inbox", "orange", "lc", ladenInner, "lc") +
      tile("Schadecontrole", "shield", "green", "schadecontrole", schadeInner, "schadecontrole") +
      tile("Pendels", "van", "blue", "lc", pendelInner, null) +
      tile("Kwaliteit", "award", "purple", "kwaliteit", kwalInner, "kwaliteit") +
      "</div>";

    // ----- Buswassing: brede balk onderaan, alleen op dagen waarop bussen zijn aangewezen -----
    var ws = S.wasStats(c.h, c.d), wasBar = "";
    if (ws.total) {
      wasBar = '<div class="dash-wasbar">' +
        '<div class="dash-wasbar-h">' + svg("droplet", "icon-sm") + "<b>Buswassing</b>" + dienstNamen("buswassing") +
          '<span class="dash-wasbar-n">' + ws.gewassen + " / " + ws.total + " gewassen</span></div>" +
        '<div class="dash-wasbar-track">' +
          '<span class="ok" style="width:' + ws.pct + '%"></span>' +
          '<span class="niet" style="width:' + (ws.total ? Math.round(ws.niet / ws.total * 100) : 0) + '%"></span></div>' +
        '<div class="dash-wasbar-legend">' +
          '<span class="ok">' + svg("check", "icon-sm") + ws.gewassen + " gewassen</span>" +
          '<span class="niet">' + svg("x", "icon-sm") + ws.niet + " niet geweest</span>" +
          '<span class="open">' + svg("clock", "icon-sm") + ws.open + " open</span></div>" +
        '<button class="btn btn-sm dash-view dash-wasbar-btn" data-viewmod="buswassing">' + svg("arrowRight", "icon-sm") + "Bekijk Buswassing</button>" +
        "</div>";
    }
    return todoBanner + grid + wasBar;
  }

  // Trolleyvoorraad-tab: alleen de systeemvoorraad (alleen-lezen). De kwaliteitstelling is verwijderd (v=102).
  function dashTrolley(c) {
    var tr = S.getTrolley(c.h, c.d, c.dd), sp = S.spTrolleyGet(c.h, c.d, c.dd);
    function nums(v4, v5) {
      return '<div class="troll-nums"><div class="troll-num"><span class="dash-big">' + (v4 || 0) + '</span><span class="cellsub">4-laags</span></div>' +
        '<div class="troll-num"><span class="dash-big">' + (v5 || 0) + '</span><span class="cellsub">5-laags</span></div></div>';
    }
    var sys = panel("inbox", "Trolley-voorraad", '<div class="troll-body">' + nums(tr.stock4, tr.stock5) + "</div>");
    var mag = S.spTrolleyMogelijk(c.d, c.dd) && !S.isFutureDay(c.d);
    var spBody;
    if (!sp || sp.status === "gecontroleerd") {
      spBody = (sp ? '<div class="troll-status ok">' + svg("check", "icon-sm") + "Steekproef gecontroleerd om " + fmtClock(sp.gecontroleerdAt) + " (" + (sp.uitkomst === "aangepast" ? "voorraad aangepast" : "voorraad klopte") + ")</div>" : "") +
        (mag ? '<div style="margin-top:' + (sp ? "12px" : "0") + '"><button class="btn btn-primary" data-spstart>' + svg("clipboard", "icon-sm") + "Steekproef instellen</button>" +
               "</div>"
             : '<div class="cellsub">Een steekproef kan alleen in de PM-shift (op zondag in de AM).</div>');
    } else if (sp.status === "open") {
      spBody = '<div class="troll-status" style="color:var(--blue)">' + svg("clock", "icon-sm") + "Steekproef loopt</div>" +
        '<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-spannuleer>' + svg("x", "icon-sm") + "Steekproef annuleren</button></div>";
    } else { // ingediend
      var v = S.spTrolleyVerschil(c.h, c.d, c.dd);
      function dtxt(d) { return (d > 0 ? "+" : "") + d; }
      var klopt = v.d4 === 0 && v.d5 === 0;
      spBody = '<div class="cellsub">Geteld door ' + esc(sp.doorNaam) + " · " + fmtClock(sp.ingediendAt) + "</div>" +
        '<div class="sp-cmp"><div><span class="cellsub">Telling</span>' + nums(v.c4, v.c5) + "</div><div><span class=\"cellsub\">Systeem</span>" + nums(v.s4, v.s5) + "</div></div>" +
        '<div class="troll-status ' + (klopt ? "ok" : "err") + '">' + svg(klopt ? "check" : "alertTri", "icon-sm") + (klopt ? "Telling komt overeen met het systeem" : "Verschil: " + dtxt(v.d4) + " (4-laags) · " + dtxt(v.d5) + " (5-laags)") + "</div>" +
        '<div class="sp-adjust" id="spAdjust" hidden><div class="add-inline"><label>4-laags <input type="number" min="0" id="spS4" class="lc-in" value="' + v.c4 + '"></label>' +
          '<label>5-laags <input type="number" min="0" id="spS5" class="lc-in" value="' + v.c5 + '"></label><button class="btn btn-primary btn-sm" data-spopslaan>' + svg("check", "icon-sm") + "Opslaan</button></div></div>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary btn-sm" data-spaanpassen>' + svg("pencil", "icon-sm") + "Voorraad aanpassen</button>" +
          '<button class="btn btn-ghost btn-sm" data-spklopt>' + svg("check", "icon-sm") + "Klopt, geen aanpassing</button></div>";
    }
    return sys + panel("clipboard", "Steekproef Kwaliteit", '<div class="troll-body">' + spBody + "</div>");
  }
  function bindDashTrolley(c) {
    var q = function (sel) { return el("app").querySelector(sel); };
    var b;
    if ((b = q("[data-spstart]"))) b.addEventListener("click", function () { try { S.spTrolleyStart(c.h, c.d, c.dd); toast("Steekproef ingesteld — Kwaliteit ziet 'm nu.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    if ((b = q("[data-spannuleer]"))) b.addEventListener("click", function () { try { S.spTrolleyAnnuleer(c.h, c.d, c.dd); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    if ((b = q("[data-spaanpassen]"))) b.addEventListener("click", function () { var a = el("spAdjust"); a.hidden = !a.hidden; });
    if ((b = q("[data-spopslaan]"))) b.addEventListener("click", function () { try { S.spTrolleyAfsluiten(c.h, c.d, c.dd, "aanpassen", el("spS4").value, el("spS5").value); toast("Voorraad aangepast.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    if ((b = q("[data-spklopt]"))) b.addEventListener("click", function () { try { S.spTrolleyAfsluiten(c.h, c.d, c.dd, "klopt"); toast("Steekproef afgesloten.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
  }

  // Steekproeven-tab: controleren tegen het Jumbo-systeem (vorige shift) + overzicht deze shift.
  function dashSteekproeven(c) {
    var spItems = S.steekproevenList(c.h, c.d, c.dd);
    var spList = spItems.length ? '<table class="table"><thead><tr><th>Bus</th><th>Naam</th><th>hr-nummer</th><th>Rit</th><th>Kratten</th></tr></thead><tbody>' +
      spItems.map(function (b) {
        return "<tr><td class=\"cellname\">Bus " + esc(b.bus || "?") + '</td><td data-th="Naam">' + esc(b.steekproef.naam) + '</td><td data-th="hr-nummer">' + esc(b.steekproef.hr) + '</td><td data-th="Rit">' + esc(b.steekproef.rit || "-") + '</td><td data-th="Kratten">' + esc(b.steekproef.kratten) + "</td></tr>";
      }).join("") + "</tbody></table>" : '<div class="cellsub" style="padding:12px">Nog geen steekproeven ingevuld.</div>';
    return panel("clipboard", "Steekproeven schadecontrole", spList);
  }
  // Steekproeven van de vorige shift controleren tegen het Jumbo-systeem (checklist-item in Voorbereiding).
  function spControlePanel(c) {
    var prevSc = S.vorigeShift(c.d, c.dd);
    var scc = S.steekproefControleStats(c.h, prevSc.datum, prevSc.dagdeel);
    var prevLabel = fmtDate(prevSc.datum) + " · " + prevSc.dagdeel;
    var spCtrlItems = S.steekproevenList(c.h, prevSc.datum, prevSc.dagdeel);
    var spCtrlRows = spCtrlItems.length ? spCtrlItems.map(function (b) {
      var sp = b.steekproef, sys = (sp.systeemKratten == null ? "" : sp.systeemKratten);
      var mismatch = sys !== "" && Number(sys) !== Number(sp.kratten), done = sp.controleGedaan;
      var sysCls = sys === "" ? "" : (mismatch ? " sys-err" : " sys-ok");
      var status = !done ? '<span class="cellsub">—</span>' : (mismatch ? '<span class="badge st-afgekeurd">' + svg("alertTri", "icon-sm") + "Afwijking</span>" : '<span class="badge st-goedgekeurd">' + svg("check", "icon-sm") + "Klopt</span>");
      return "<tr class=\"" + (done && !mismatch ? "sc-done" : "") + "\"><td><div class=\"cellname\">Bus " + esc(b.bus || "?") + "</div><div class=\"cellsub\">" + esc(sp.naam || "") + (sp.rit ? " · rit " + esc(sp.rit) : "") + "</div></td>" +
        '<td data-th="Geteld in bus" class="cellname" style="text-align:center">' + esc(sp.kratten) + "</td>" +
        '<td data-th="Systeem (Jumbo)"><input class="lc-in' + sysCls + '" style="max-width:90px" type="number" inputmode="numeric" min="0" data-spsys="' + b.id + '" value="' + esc(sys) + '"></td>' +
        '<td class="sc-chk" data-th="Gecontroleerd"><label class="chk-box ' + (done ? "on" : "") + '"><input type="checkbox" ' + (done ? "checked" : "") + ' data-spctrl="' + b.id + '">' + svg("check", "icon-sm") + "</label></td>" +
        '<td data-th="Status">' + status + "</td></tr>";
    }).join("") : '<tr><td colspan="5"><div class="cellsub" style="padding:12px">Geen steekproeven om te controleren voor ' + esc(prevLabel) + ".</div></td></tr>";
    return '<div class="kz-section"><div class="kz-h">' + svg("clipboard", "icon-sm") + "Vorige shift: " + esc(prevLabel) + "</div>" +
      opProgress(scc.done, scc.total, "steekproeven gecontroleerd") +
      '<div class="panel" style="padding:0"><div class="table-scroll"><table class="table sc-table"><thead><tr><th>Bus</th><th>Geteld in bus</th><th>Systeem (Jumbo)</th><th>Gecontroleerd</th><th>Status</th></tr></thead><tbody>' + spCtrlRows + "</tbody></table></div></div></div>";
  }

  function prepBlocks(c) {
    var lc = S.getLC(c.h, c.d, c.dd);
    var s = S.getSchade(c.h, c.d, c.dd);

    // ---- Laadproces ----
    var ladenImport = '<div class="kz-section"><div class="kz-h">' + svg("download", "icon-sm") + "Laadproces importeren</div>" +
      '<p class="cellsub" style="margin:0 0 8px">Plak de hele planning-sheet (selecteer alles in het tabblad en kopieer). Vult de laadvakken per volgnummer en herkent N2/ZE/JBT.</p>' +
      '<textarea id="kzSheetLaden" rows="5" class="kz-sheet" placeholder="Plak hier de sheet…"></textarea>' +
      '<label class="chk" style="margin-top:8px"><input type="checkbox" id="kzLadenOokSchade" checked> Ook de schadecontrolelijst uit deze sheet vullen</label>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="kzImportLaden">' + svg("check", "icon-sm") + "Importeren</button>" +
      '<button class="btn btn-ghost btn-sm" id="kzResetLaden">' + svg("trash", "icon-sm") + "Laden leegmaken</button></div></div>";
    function lcRowHTML(v) {
      var inp = function (f, ph, val) { return '<input class="lc-in" data-lcset="' + v.nr + "|" + f + '" placeholder="' + ph + '" value="' + esc(val) + '">'; };
      return "<tr><td class=\"lc-nr cellname\">Vak " + v.nr + '</td><td data-th="Vertrek">' + inp("vertrek", "tijd", v.vertrek || "") + '</td><td data-th="Bus">' + inp("bus", "busnr", v.bus) + '</td><td data-th="Rit">' + inp("rit", "rit", v.rit) + "</td>" +
        '<td data-th="Type"><select class="lc-in" data-lcset="' + v.nr + '|type"><option value="diesel"' + (v.type !== "N2" ? " selected" : "") + ">Diesel</option><option value=\"N2\"" + (v.type === "N2" ? " selected" : "") + ">N2</option></select></td>" +
        '<td data-th="ZE" style="text-align:center"><input type="checkbox" data-lcze="' + v.nr + '"' + (v.ze ? " checked" : "") + "></td></tr>";
    }
    var lcRows = lc.vakken.length ? lc.vakken.map(lcRowHTML).join("") : '<tr><td colspan="6"><div class="cellsub" style="padding:12px">Importeer de planning of stel het aantal vakken in.</div></td></tr>';
    var kzRit2 = "";
    var tr = S.getTrolley(c.h, c.d, c.dd);
    var pendelRows = tr.pendels.length ? tr.pendels.map(function (p, i) {
      var meta = [];
      if (p.rit) meta.push("rit " + esc(p.rit));
      if (p.herkomst) meta.push(esc(p.herkomst));
      if (p.trolleysVerwacht) meta.push(esc(p.trolleysVerwacht) + " trolleys");
      if (p.afwijking) meta.push('<span class="pen-afw ' + (String(p.afwijking).charAt(0) === "-" ? "vroeg" : "laat") + '">' + esc(p.afwijking) + " min</span>");
      var sub = meta.length ? '<div class="kz-pendel-sub">' + meta.join(" · ") + "</div>" : "";
      return '<div class="kz-pendel-row"><div><span>' + svg("van", "icon-sm") + "Pendel " + (i + 1) + (p.tijd ? " · aankomst " + esc(p.tijd) : "") + "</span>" + sub + "</div>" +
        '<button class="pl-x" data-pendeldel="' + p.id + '" title="Verwijderen">' + svg("trash", "icon-sm") + "</button></div>";
    }).join("") : '<div class="cellsub" style="padding:8px 0">Er zijn nog geen pendels klaargezet.</div>';
    var pendelImportBlock = '<div class="kz-section"><div class="kz-h">' + svg("download", "icon-sm") + "Aankomsttijden importeren</div>" +
      '<p class="cellsub" style="margin:0 0 8px">Plak de pendellijst (blokken per pendel: aankomsttijd, aantallen, venstertijd, ritnr, herkomst). Pendels vóór 13:00 komen in AM, vanaf 13:00 in PM. <b>Vervangt de pendelplanning van deze dag.</b></p>' +
      '<textarea id="kzPendelImport" rows="5" class="kz-sheet" placeholder="05:15&#10;31&#10;29&#10;Venstertijd: 05:15 - 06:19&#10;A1003455643&#10;EFC Bleiswijk&#10;+30&#10;…"></textarea>' +
      '<div style="margin-top:8px"><button class="btn btn-primary btn-sm" id="kzImportPendel">' + svg("check", "icon-sm") + "Pendels importeren</button></div></div>";
    var pendelPlanBlock = pendelImportBlock + '<div class="kz-section"><div class="kz-h">' + svg("van", "icon-sm") + "Pendels klaarzetten (" + (c.dd === "PM" ? "PM" : "AM") + ")</div>" +
      '<div class="add-inline"><input id="penTijd" type="time" class="lc-in" style="max-width:140px"><button class="btn btn-dark btn-sm" id="penAdd">' + svg("plus", "icon-sm") + "Pendel toevoegen</button></div>" +
      '<div style="margin-top:10px">' + pendelRows + "</div></div>";
    var ladenBlock = ladenImport + '<div class="kz-section"><div class="kz-h">' + svg("inbox", "icon-sm") + "Laden klaarzetten</div>" +
      '<div class="lc-setup"><label>Aantal vakken</label><input type="number" min="0" max="60" id="lcAantal" value="' + (lc.aantal || lc.vakken.length) + '"><button class="btn btn-dark btn-sm" id="lcSetAantal">' + svg("check", "icon-sm") + "Instellen</button></div>" +
      '<div class="panel" style="padding:0;margin-top:10px"><div class="table-scroll"><table class="table lc-table"><thead><tr><th>Vak</th><th>Vertrek</th><th>Bus</th><th>Rit</th><th>Type</th><th>ZE</th></tr></thead><tbody>' + lcRows + "</tbody></table></div></div>" + kzRit2 + "</div>";
    var pcImportBlockDash = '<div class="kz-section"><div class="kz-h">' + svg("download", "icon-sm") + "Tellijst klaarzetten (" + (c.dd === "PM" ? "PM" : "AM") + ")</div>" +
      '<p class="cellsub" style="margin:0 0 8px">Plak de debriefing-tellijst — kolommen SUBRITNR · TROLLEYS · KRATTEN · VERSBOXEN · DIEPVRIESBOXEN · KWGR. Verschijnt bij Laadproces &rsaquo; Tellen.</p>' +
      '<textarea id="kzPcSheet" rows="4" class="kz-sheet" placeholder="Plak hier de tellijst…"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="kzPcImport">' + svg("check", "icon-sm") + "Importeren</button>" +
      '<button class="btn btn-ghost btn-sm" id="kzPcClear">' + svg("trash", "icon-sm") + "Leegmaken</button></div></div>";
    var pendelBlock = pendelPlanBlock + pcImportBlockDash;

    // ---- Schadecontrole (Voorbereiding AM) ----
    var schadeImport = '<div class="kz-section"><div class="kz-h">' + svg("download", "icon-sm") + "Schadecontrole importeren</div>" +
      '<p class="cellsub" style="margin:0 0 8px">Plak de hele planning-sheet. Vult de bussen (busnummer, kenteken, bezorger) voor de schadecontrole; bussen die er al in staan worden overgeslagen.</p>' +
      '<textarea id="kzSheetSchade" rows="5" class="kz-sheet" placeholder="Plak hier de sheet…"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="kzImportSchade">' + svg("check", "icon-sm") + "Importeren</button>" +
      '<button class="btn btn-ghost btn-sm" id="kzResetSchade">' + svg("trash", "icon-sm") + "Schade leegmaken</button></div></div>";
    var showDock = dockShift(c); // docks toewijzen is een PM-taak (zondag: AM); anders niet tonen
    var scRows = s.buses.length ? s.buses.map(function (b) {
      return "<tr><td><div class=\"cellname\">Bus " + esc(b.bus || "?") + "</div><div class=\"cellsub\">" + esc(b.naam || "") + (b.kenteken ? " · " + esc(b.kenteken) : "") + "</div></td>" +
        (showDock ? '<td data-th="Dock (morgen)"><select class="lc-in dock-sel" data-dock="' + b.id + '">' + dockOptions(b.dock) + "</select></td>" : "") +
        '<td data-th="Opmerking voor controleur"><input class="lc-in" data-scopm="' + b.id + '" placeholder="Opmerking (optioneel)" value="' + esc(b.opmerking || "") + '"></td>' +
        '<td data-th="Buswassing"><span class="chip was-chip ' + (b.wassen ? "on" : "") + '" data-scwas="' + b.id + '">' +
          svg("droplet", "icon-sm") + (b.wassen ? "Naar wasstraat" : "Wassen") + "</span></td>" +
        '<td data-th="" style="text-align:right"><button class="pl-x" data-schadedel="' + b.id + '">' + svg("trash", "icon-sm") + "</button></td></tr>";
    }).join("") : '<tr><td colspan="' + (showDock ? 5 : 4) + '"><div class="cellsub" style="padding:12px">Er is nog geen schadecontrolelijst klaargezet. Importeer de planning of voeg bussen toe.</div></td></tr>';
    var schadeBlock = schadeImport + '<div class="kz-section"><div class="kz-h">' + svg("sun", "icon-sm") + "Voorbereiding AM — bussen klaarzetten voor morgen</div>" +
      '<div class="add-inline"><input id="scBus" placeholder="Busnr"><input id="scKent" placeholder="Kenteken"><input id="scNaam" placeholder="Bezorger"><button class="btn btn-dark btn-sm" id="scAdd">' + svg("plus", "icon-sm") + "Bus</button></div>" +
      '<div class="panel" style="padding:0;margin-top:10px"><div class="table-scroll"><table class="table"><thead><tr><th>Bus</th>' + (showDock ? "<th>Dock (morgen)</th>" : "") + "<th>Opmerking voor controleur</th><th>Buswassing</th><th></th></tr></thead><tbody>" + scRows + "</tbody></table></div></div></div>";

    return { laden: ladenBlock, pendel: pendelBlock, schade: schadeBlock };
  }
  function bindDashKlaarzetten(c) {
    var il = el("kzImportLaden"); if (il) il.addEventListener("click", function () {
      try {
        var ook = el("kzLadenOokSchade") && el("kzLadenOokSchade").checked;
        var n = S.importSheet(c.h, c.d, c.dd, el("kzSheetLaden").value, ook ? "beide" : "laden");
        toast(n + " ritten geïmporteerd" + (ook ? " (laadlijst + schadecontrole)." : "."), "ok"); renderDashboard();
      } catch (e) { toast(e.message, "err"); }
    });
    var rl = el("kzResetLaden"); if (rl) rl.addEventListener("click", function () { try { S.lcReset(c.h, c.d, c.dd); toast("Laadproces gereset.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    var isc = el("kzImportSchade"); if (isc) isc.addEventListener("click", function () { try { var n = S.importSheet(c.h, c.d, c.dd, el("kzSheetSchade").value, "schade"); toast(n + " bussen geïmporteerd.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    var rsc = el("kzResetSchade"); if (rsc) rsc.addEventListener("click", function () { try { S.schadeReset(c.h, c.d, c.dd); toast("Schadecontrole gereset.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    var pa = el("penAdd"); if (pa) pa.addEventListener("click", function () { try { S.addPendelPlan(c.h, c.d, c.dd, el("penTijd").value); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    var pi = el("kzImportPendel"); if (pi) pi.addEventListener("click", function () { try { var r = S.pendelImport(c.h, c.d, el("kzPendelImport").value); toast(r.total + " pendels geïmporteerd (" + r.am + " AM · " + r.pm + " PM).", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    var pci = el("kzPcImport"); if (pci) pci.addEventListener("click", function () { try { var n = S.pcImport(c.h, c.d, c.dd, el("kzPcSheet").value); toast(n + " regels in de tellijst gezet.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    var pcc = el("kzPcClear"); if (pcc) pcc.addEventListener("click", function () { try { S.pcReset(c.h, c.d, c.dd); toast("Tellijst gewist.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    document.querySelectorAll("[data-pendeldel]").forEach(function (b) { b.addEventListener("click", function () { try { S.removePendel(c.h, c.d, c.dd, b.getAttribute("data-pendeldel")); toast("Pendel verwijderd.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } }); });
    var sa = el("lcSetAantal"); if (sa) sa.addEventListener("click", function () { try { S.lcSetAantal(c.h, c.d, c.dd, el("lcAantal").value); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    document.querySelectorAll("[data-lcset]").forEach(function (inp) { inp.addEventListener("change", function () { var p = inp.getAttribute("data-lcset").split("|"); var data = {}; data[p[1]] = inp.value; try { S.lcSetupVak(c.h, c.d, c.dd, parseInt(p[0], 10), data); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-lcze]").forEach(function (cb) { cb.addEventListener("change", function () { try { S.lcSetupVak(c.h, c.d, c.dd, parseInt(cb.getAttribute("data-lcze"), 10), { ze: cb.checked }); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-dock]").forEach(function (sl) { sl.addEventListener("change", function () { try { S.schadeSetDock(c.h, c.d, c.dd, sl.getAttribute("data-dock"), sl.value); renderDashboard(); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-scopm]").forEach(function (inp) { inp.addEventListener("change", function () { try { S.schadeSetOpmerking(c.h, c.d, c.dd, inp.getAttribute("data-scopm"), inp.value); } catch (e) { toast(e.message, "err"); } }); });
    document.querySelectorAll("[data-schadedel]").forEach(function (b) { b.addEventListener("click", function () { try { S.schadeRemove(c.h, c.d, c.dd, b.getAttribute("data-schadedel")); toast("Bus verwijderd.", "ok"); renderDashboard(); } catch (e) { toast(e.message, "err"); } }); });
    var add = el("scAdd"); if (add) add.addEventListener("click", function () { try { S.schadeAddBus(c.h, c.d, c.dd, el("scNaam").value, el("scBus").value, el("scKent").value); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    document.querySelectorAll("[data-scwas]").forEach(function (ch) { ch.addEventListener("click", function () { try { S.setBusWassen(c.h, c.d, c.dd, ch.getAttribute("data-scwas")); renderDashboard(); } catch (e) { toast(e.message, "err"); } }); });
  }
  function dienstenBlocks(c) {
    var d = S.getDiensten(c.h, c.d, c.dd);
    var users = S.usersForHub(c.h).slice().sort(function (a, b) { return (a.voornaam + a.achternaam).localeCompare(b.voornaam + b.achternaam); });
    if (!state.dienstOpen) state.dienstOpen = null;
    // Per proces een keuzelijst met zoekveld (één persoon per proces).
    function block(key, label, taskName) {
      var kandidaten = users.filter(function (us) { return us.taken.indexOf(taskName) !== -1 || S.level(us) >= 3; });
      var gekozenId = (d[key] || [])[0], gekozen = gekozenId ? S.userById(gekozenId) : null;
      var open = state.dienstOpen === key;
      var q = open ? (state.dienstQ || "") : "";
      var lijst = kandidaten.filter(function (us) { return !q || (us.voornaam + " " + us.achternaam).toLowerCase().indexOf(q.toLowerCase()) !== -1; });
      var items = lijst.length ? lijst.map(function (us) {
        return '<button type="button" class="pick-item' + (us.id === gekozenId ? " on" : "") + '" data-dienstpick="' + key + "|" + us.id + '">' + (us.id === gekozenId ? svg("check", "icon-sm") : '<span class="pick-dot"></span>') + fullName(us) + "</button>";
      }).join("") : '<div class="cellsub" style="padding:8px 10px">' + (kandidaten.length ? "Geen medewerker gevonden." : "Geen geschikte medewerkers.") + "</div>";
      return '<div class="dienst-block"><div class="dienst-h">' + esc(label) + "</div>" +
        '<div class="pick' + (open ? " open" : "") + '" data-pick="' + key + '">' +
          '<button type="button" class="pick-btn' + (gekozen ? " has" : "") + '" data-dienstopen="' + key + '">' + svg("user", "icon-sm") +
            "<span>" + (gekozen ? fullName(gekozen) : "Kies medewerker…") + "</span>" + svg("chevronDown", "icon-sm pick-chev") + "</button>" +
          (gekozen ? '<button type="button" class="pick-clear" data-dienstclear="' + key + '" title="Toewijzing weghalen">' + svg("x", "icon-sm") + "</button>" : "") +
          '<div class="pick-menu"><div class="pick-search">' + svg("search", "icon-sm") + '<input type="search" data-dienstq="' + key + '" placeholder="Zoek op naam…" value="' + esc(q) + '" autocomplete="off"></div>' +
          '<div class="pick-list">' + items + "</div></div>" +
        "</div></div>";
    }
    return '<div class="kz-section dienst-grid">' + block("schadecontrole", "Schadecontrole", "Schadecontrole") + block("lc", "Laadproces", "LC") + block("kwaliteit", "Kwaliteit", "Kwaliteit") + block("buswassing", "Buswassing", "Buswassing") + "</div>";
  }
  function bindDashDiensten(c) {
    function rerender(focusKey) {
      renderDashboard();
      if (focusKey) { var inp = document.querySelector('[data-dienstq="' + focusKey + '"]'); if (inp) { inp.focus(); var v = inp.value; inp.value = ""; inp.value = v; } }
    }
    document.querySelectorAll("[data-dienstopen]").forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); var k = b.getAttribute("data-dienstopen"); state.dienstOpen = state.dienstOpen === k ? null : k; state.dienstQ = ""; rerender(state.dienstOpen); });
    });
    document.querySelectorAll("[data-dienstq]").forEach(function (inp) {
      inp.addEventListener("input", function () { state.dienstQ = inp.value; rerender(inp.getAttribute("data-dienstq")); });
      inp.addEventListener("click", function (ev) { ev.stopPropagation(); });
    });
    document.querySelectorAll(".pick-menu").forEach(function (m) { m.addEventListener("click", function (ev) { ev.stopPropagation(); }); });
    document.querySelectorAll("[data-dienstpick]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-dienstpick").split("|");
        try { S.setDienst(c.h, c.d, c.dd, p[0], [p[1]]); state.dienstOpen = null; state.dienstQ = ""; renderDashboard(); } catch (e) { toast(e.message, "err"); }
      });
    });
    document.querySelectorAll("[data-dienstclear]").forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); try { S.setDienst(c.h, c.d, c.dd, b.getAttribute("data-dienstclear"), []); renderDashboard(); } catch (e) { toast(e.message, "err"); } });
    });
    if (state.dienstOpen) document.addEventListener("click", function closePick() { document.removeEventListener("click", closePick); if (state.dienstOpen) { state.dienstOpen = null; state.dienstQ = ""; renderDashboard(); } });
  }
  /* ---------- realtime via polling (werkt op Java-server én Netlify-functions) ---------- */
  var pollTimer = null;
  function startRealtime() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (!S.currentUser()) return; // niet ingelogd: niet pollen
      fetch("/api/version").then(function (r) {
        // 401 = de sessie is op de server niet meer geldig (bv. na een herstart). Niet blijven
        // doorpollen alsof er niets aan de hand is: uitloggen en het duidelijk zeggen.
        if (r.status === 401) { sessionExpired(); return null; }
        return r.ok ? r.json() : null;
      }).then(function (j) {
        if (j && j.version && j.version !== S.serverVersion) {
          S.refresh(function () { if (!document.querySelector(".modal-overlay")) render(); });
        }
      }).catch(function () { /* even geen verbinding; volgende tik opnieuw */ });
    }, 3000);
    startUpdateCheck();
  }
  /* Nieuwe app-versie? Een open tab/telefoon blijft anders weken op oude code draaien (en overschrijft
     via de PUT van de hele staat fixes van anderen). Elke 2 min index.html ophalen, ?v= vergelijken met
     de geladen versie, en bij verschil herladen — maar niet midden in een dialoog of formulier. */
  var updateTimer = null;
  function startUpdateCheck() {
    if (updateTimer || !appVersion()) return;
    updateTimer = setInterval(function () {
      fetch("/?u=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (html) {
        var m = html.match(/js\/ui\.js\?v=(\d+)/);
        if (!m || m[1] === appVersion()) return;
        var bezig = document.querySelector(".modal-overlay") || (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
        if (bezig) return; // volgende tik opnieuw proberen
        toast("Nieuwe versie van HubConnect — even herladen…", "ok");
        setTimeout(function () { location.reload(); }, 1200);
      }).catch(function () {});
    }, 120000);
  }
  // Sessie verlopen: lokaal uitloggen en terug naar het inlogscherm. De vlag voorkomt dat
  // meerdere gelijktijdige 401's dit allemaal apart afhandelen.
  var sessionExpiredBusy = false;
  function sessionExpired() {
    if (sessionExpiredBusy || !S.currentUser()) return;
    sessionExpiredBusy = true;
    S.logout().then(function () {
      sessionExpiredBusy = false;
      resetNav(); authScreen = "login"; render();
      toast("Je sessie is verlopen — log opnieuw in.", "err");
    });
  }

  function bootScreen(msg, err) {
    el("app").innerHTML = '<div class="auth-wrap"><div class="auth-card" style="max-width:380px"><div class="auth-head">' + logo(38) +
      "<h1>HubConnect</h1><p>" + esc(msg) + "</p></div>" +
      (err ? '<div class="auth-body"><div class="alert alert-error">' + esc(err) + '</div><button class="btn btn-primary btn-block" id="retry">Opnieuw proberen</button></div>' : '<div class="auth-body" style="display:flex;justify-content:center;padding-top:4px"><span class="spinner"></span></div>') + "</div></div>";
    var r = el("retry"); if (r) r.addEventListener("click", boot);
  }
  function boot() {
    bootScreen("Verbinden met de server…");
    S.setSaveErrorHandler(function () { toast("Wijziging kon niet worden opgeslagen — controleer je verbinding.", "err"); });
    S.boot(function (err) {
      if (err) { bootScreen("Geen verbinding met de server.", "Controleer of de server draait en de database bereikbaar is. (" + (err.message || err) + ")"); return; }
      startRealtime();
      startAutoLogout();
      render();
    });
  }

  // Elk account logt automatisch uit om 03:00 (dagelijkse reset). Controleert elke minuut.
  var autoLogoutTimer = null;
  function startAutoLogout() {
    if (autoLogoutTimer) return;
    autoLogoutTimer = setInterval(function () {
      var d = new Date();
      if (d.getHours() === 3 && d.getMinutes() === 0 && S.currentUser()) {
        S.logout().then(function () { resetNav(); authScreen = "landing"; render(); });
      }
    }, 60000);
  }

  // Dubbeltik-zoom hard uitzetten (iOS Safari negeert user-scalable=no en touch-action lang niet altijd).
  // Interactieve elementen overslaan: die worden al door touch-action gedekt en snel-tikken op +/- moet blijven werken.
  var lastTouchEnd = 0;
  document.addEventListener("touchend", function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 350) {
      var t = e.target;
      if (!(t && t.closest && t.closest("button, input, select, textarea, a, label"))) e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
  // Pinch-zoom (2 vingers) net zo blokkeren.
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();
})();
