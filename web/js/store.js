/* =========================================================================
   Ruilhub — datalaag (localStorage)
   Prototype: alle data staat in de browser. Eén globaal object: Store.
   ========================================================================= */
(function () {
  "use strict";

  var KEY = "ruilhub_v7";

  /* ---------- Constanten ---------- */
  var ROLES = [
    { id: "locatie-manager", label: "Locatie-manager", level: 5 },
    { id: "teamleider",      label: "Teamleider",       level: 4 },
    { id: "senior",          label: "Senior bezorger",  level: 3 },
    { id: "bezorger",        label: "Bezorger",         level: 2 },
    { id: "aankomend",       label: "Aankomend bezorger", level: 1 }
  ];

  var DEFAULT_HUBS = [
    "Amsterdam", "Bemmel", "Bergen op Zoom", "Bleiswijk", "Den Bosch",
    "Breda", "Deventer", "Dordrecht", "Eindhoven", "Groningen",
    "Heerenveen", "Heerhugowaard", "Utrecht Ravenswade"
  ];

  // Per medewerker toewijsbare taken (catalogus). Elke taak is een bezorger- of senior-taak.
  var DEFAULT_TASKS = ["LC", "Schadecontrole", "Kwaliteit", "Inname", "Laden", "Binnendienst"];
  var DEFAULT_TASK_TYPES = { "Binnendienst": "senior" }; // overige = "bezorger"

  var TASK_BINNENDIENST = "Binnendienst";
  var TASK_JBT = "JBT-training"; // alleen JBT-trainers, taak tijdens de rit (buiten de catalogus)

  var EMAIL_RE = /^hr-(\d{4,9})@jumbo\.com$/i;

  // Vaste redenen om een shift/taak weg te geven (bezorgers kiezen hieruit; vrij typen kan niet)
  var REASONS = ["Ziekte", "Uitvaart / begrafenis", "Medische afspraak", "Familieomstandigheden", "Vakantie", "Studie / school", "Persoonlijke reden"];

  // Tijdsvensters
  var WINDOW = { AM: { min: 5 * 60, max: 15 * 60 }, PM: { min: 13 * 60, max: 23 * 60 } };

  /* ---------- Helpers ---------- */
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7); }
  function now() { return new Date().toISOString(); }
  function nextSeq() { db._seq = (db._seq || 0) + 1; return db._seq; }
  function hash(str) { var h = 5381, i = str.length; while (i) { h = (h * 33) ^ str.charCodeAt(--i); } return (h >>> 0).toString(16); }
  function genOtp() { var c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = ""; for (var i = 0; i < 6; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
  function toMin(t) { if (!t) return null; var p = t.split(":"); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }

  /* ---------- State ---------- */
  var db = null;
  function blankStats() { return { shiftsAangeboden: 0, shiftsOvergenomen: 0, takenAangeboden: 0, takenOvergenomen: 0 }; }

  function seed() {
    var hubs = DEFAULT_HUBS.map(function (n) { return { id: uid("hub"), naam: n }; });
    var utrecht = hubs.filter(function (h) { return h.naam === "Utrecht Ravenswade"; })[0] || hubs[0];

    function mk(num, vn, an, rol, n2, jbt, taken, hubId) {
      return {
        id: uid("usr"), personeelsnummer: num, email: "hr-" + num + "@jumbo.com",
        voornaam: vn, achternaam: an, pass: hash("demo123"), otp: null, mustSetPassword: false,
        rol: rol, n2: !!n2, jbtTrainer: !!jbt, taken: taken || [],
        hubId: hubId || utrecht.id, stats: blankStats(), createdAt: now()
      };
    }

    var users = [];
    // Verborgen super-admin: staat niet tussen de medewerkers, kan alles, acties worden niet gelogd.
    // Maakt na inloggen alle echte accounts aan.
    var admin = mk("0000000", "Marlon", "Beheerder", "admin", true, true, DEFAULT_TASKS.slice(), utrecht.id);
    admin.email = "marlon@admin.com"; admin.pass = hash("Admin!1"); admin.hidden = true;
    users.push(admin);

    return {
      version: 7, hubs: hubs, taskCatalog: DEFAULT_TASKS.slice(),
      taskTypes: JSON.parse(JSON.stringify(DEFAULT_TASK_TYPES)),
      users: users, shifts: [], taskOffers: [], backups: [], callouts: [], logs: [],
      plannings: [], schade: {}, kwaliteit: {}, lc: {}, trolley: {}, diensten: {},
      session: { userId: null }
    };
  }

  /* ---------- Server-koppeling + realtime ---------- */
  var API = "/api/state";
  var SESSION_KEY = "ruilhub_session";
  var clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var serverVersion = 0;
  var saveTimer = null, pendingSave = false;

  function localSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  function applyLocalSession() {
    if (!db.session) db.session = { userId: null };
    var sid = localSession();
    db.session.userId = (sid && userById(sid)) ? sid : null;
  }
  function sharedState() { var out = {}; for (var k in db) { if (k !== "session") out[k] = db[k]; } return out; }

  // Eerste keer laden vanaf de server (async). cb(err).
  function boot(cb) {
    fetch(API).then(function (r) { return r.json(); }).then(function (j) {
      if (j.empty) { db = seed(); applyLocalSession(); pushState(true); }
      else { db = j.data; serverVersion = j.version || 0; applyLocalSession(); }
      cb(null);
    }).catch(function (e) { cb(e || new Error("Geen verbinding")); });
  }
  // Herlaad gedeelde staat vanaf de server (bij realtime-update). cb().
  function refresh(cb) {
    if (pendingSave) { if (cb) cb(); return; } // niet overschrijven terwijl we zelf opslaan
    fetch(API).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.empty) { db = j.data; serverVersion = j.version || 0; applyLocalSession(); }
      if (cb) cb();
    }).catch(function () { if (cb) cb(); });
  }
  function pushState(immediate) {
    fetch(API + "?cid=" + encodeURIComponent(clientId), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sharedState())
    }).then(function (r) { return r.json(); }).then(function (j) { if (j && j.version) serverVersion = j.version; })
      .catch(function (e) { console.error("Opslaan mislukt", e); });
  }
  // save(): sessie lokaal bewaren + gedeelde staat (gedebounced) naar de server.
  function save(immediate) {
    try { if (db.session && db.session.userId) localStorage.setItem(SESSION_KEY, db.session.userId); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
    if (immediate) { pushState(true); return; }
    pendingSave = true;
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; if (pendingSave) { pendingSave = false; pushState(); } }, 200);
  }
  function resetDemo() { db = seed(); applyLocalSession(); save(true); }

  /* ---------- Lookups ---------- */
  function userById(id) { return db.users.filter(function (u) { return u.id === id; })[0] || null; }
  function userByEmail(e) { e = (e || "").trim().toLowerCase(); return db.users.filter(function (u) { return u.email === e; })[0] || null; }
  function hubById(id) { return db.hubs.filter(function (h) { return h.id === id; })[0] || null; }
  function isAdmin(u) { return !!(u && u.rol === "admin"); }
  function roleMeta(id) {
    if (id === "admin") return { id: "admin", label: "Beheerder", level: 99 };
    return ROLES.filter(function (r) { return r.id === id; })[0] || ROLES[ROLES.length - 1];
  }
  function level(user) { return user ? roleMeta(user.rol).level : 0; }
  function currentUser() { return db.session.userId ? userById(db.session.userId) : null; }
  function visibleUsers() { return db.users.filter(function (u) { return !u.hidden; }); }

  /* ---------- Taken: mogen & zien ---------- */
  function taskType(naam) { return (db.taskTypes && db.taskTypes[naam]) || "bezorger"; }
  function canDoTask(u, taak) {
    if (!taak) return true;
    if (taak === TASK_JBT) return !!u.jbtTrainer;
    if (u.taken.indexOf(taak) === -1) return false;
    if (taskType(taak) === "senior") return level(u) >= 3; // senior-taak alleen door senior+
    return true; // bezorger-taak: senior mag dit ook
  }
  function visibleTask(u, taak) {
    if (!taak) return true;
    if (taskType(taak) === "senior" && level(u) < 3) return false; // senior-taken niet zichtbaar voor lager
    return true;
  }
  // Taken die je aan deze medewerker mág toewijzen (op basis van functie)
  function assignableTasks(targetUser) {
    return db.taskCatalog.filter(function (t) {
      return taskType(t) === "bezorger" || level(targetUser) >= 3;
    }).sort(function (a, b) { return a.localeCompare(b); });
  }
  function availableTasks(u) {
    var list = db.taskCatalog.filter(function (t) { return canDoTask(u, t); });
    if (u.jbtTrainer) list.push(TASK_JBT);
    return list.sort(function (a, b) { return a.localeCompare(b); });
  }

  /* ---------- Rechten ---------- */
  var can = {
    seeLog:       function (u) { return level(u) >= 3; },
    seeStats:     function (u) { return level(u) >= 4; },
    seeBeheer:    function (u) { return level(u) >= 3; },
    planning:     function (u) { return level(u) >= 3; },
    editTeam:     function (u) { return level(u) >= 4; },   // N2, taken, jbt, account toevoegen
    editRoles:    function (u) { return level(u) >= 5; },   // functie toewijzen = locatie-manager
    editHubs:     function (u) { return level(u) >= 5; },   // hubs = locatie-manager
    editCatalog:  function (u) { return level(u) >= 4; },   // takenlijst = teamleider+
    resetData:    function (u) { return level(u) >= 5; },
    approveTask:  function (u) { return level(u) >= 3; },
    approveBackup:function (u) { return level(u) >= 3; },
    approveShift: function (u, shift) {
      if (!u) return false;
      if (level(u) >= 4) return true;
      if (level(u) >= 3 && shift && shift.shiftsBekend) return true;
      return false;
    },
    isApprover:   function (u) { return level(u) >= 3; },
    claimShift: function (u, s) {
      if (!u || !s || s.status !== "open" || s.aanbiederId === u.id || s.hubId !== u.hubId) return false;
      if (!visibleTask(u, s.taak)) return false;
      if (s.busType === "N2" && !u.n2) return false;
      if (!canDoTask(u, s.taak)) return false;
      return true;
    },
    claimTask: function (u, t) {
      if (!u || !t || t.status !== "open" || t.aanbiederId === u.id || t.hubId !== u.hubId) return false;
      if (!visibleTask(u, t.taak)) return false;
      return canDoTask(u, t.taak);
    },
    claimBackup: function (u, b) {
      if (!u || !b || b.status !== "open" || b.aanbiederId === u.id || b.hubId !== u.hubId) return false;
      return true; // wie een rit heeft en op back-up wil mag reageren
    }
  };

  /* ---------- Auth ---------- */
  function login(email, password) {
    var u = userByEmail(email);
    if (!u) throw new Error("Onjuist e-mailadres of wachtwoord.");
    if (u.pass) {
      if (u.pass !== hash(password || "")) throw new Error("Onjuist e-mailadres of wachtwoord.");
    } else if (u.otp) {
      if ((password || "").toUpperCase() !== u.otp) throw new Error("Onjuist eenmalig wachtwoord. Vraag je teamleider om een nieuwe.");
    } else {
      throw new Error("Dit account heeft nog geen wachtwoord. Vraag je teamleider om een eenmalig wachtwoord.");
    }
    db.session.userId = u.id; save();
    return u;
  }
  function logout() { db.session.userId = null; save(); }

  function setInitialPassword(newPw) {
    var u = currentUser();
    if (!u || !u.mustSetPassword) throw new Error("Geen wachtwoord in te stellen.");
    if (!newPw || newPw.length < 4) throw new Error("Kies een wachtwoord van minimaal 4 tekens.");
    u.pass = hash(newPw); u.otp = null; u.mustSetPassword = false; save();
  }
  function changeOwnPassword(oldPw, newPw) {
    var u = currentUser();
    if (u.pass !== hash(oldPw || "")) throw new Error("Je huidige wachtwoord klopt niet.");
    if (!newPw || newPw.length < 4) throw new Error("Kies een nieuw wachtwoord van minimaal 4 tekens.");
    u.pass = hash(newPw); save();
  }

  // Account aanmaken door leiding (teamleider+). Geeft een eenmalig wachtwoord terug.
  function createUserByLeader(data) {
    var me = currentUser();
    if (!can.editTeam(me)) throw new Error("Alleen teamleider of hoger mag accounts aanmaken.");
    var num = (data.personeelsnummer || "").replace(/\D/g, "");
    if (num.length < 4) throw new Error("Vul een geldig personeelsnummer in (minimaal 4 cijfers).");
    var email = ("hr-" + num + "@jumbo.com").toLowerCase();
    if (userByEmail(email)) throw new Error("Er bestaat al een account met dit personeelsnummer.");
    if (!data.voornaam || !data.achternaam) throw new Error("Vul voor- en achternaam in.");

    var rol = data.rol || "bezorger";
    if (!can.editRoles(me)) { if (["bezorger", "aankomend", "senior"].indexOf(rol) === -1) rol = "bezorger"; }
    var hubId = can.editRoles(me) ? (data.hubId || me.hubId) : me.hubId; // teamleider: eigen hub
    var otp = genOtp();

    var u = {
      id: uid("usr"), personeelsnummer: num, email: email,
      voornaam: data.voornaam.trim(), achternaam: data.achternaam.trim(),
      pass: null, otp: otp, mustSetPassword: true,
      rol: rol, n2: !!data.n2, jbtTrainer: !!data.jbtTrainer, taken: [],
      hubId: hubId, stats: blankStats(), createdAt: now()
    };
    db.users.push(u); save();
    return { user: u, otp: otp };
  }
  function regenerateOtp(targetId) {
    var me = currentUser();
    if (!can.editTeam(me)) throw new Error("Alleen teamleider of hoger.");
    var t = userById(targetId); if (!t) throw new Error("Gebruiker niet gevonden.");
    var otp = genOtp(); t.otp = otp; t.pass = null; t.mustSetPassword = true; save();
    return otp;
  }

  /* ---------- Log ---------- */
  function addLog(entry) {
    if (isAdmin(currentUser())) return; // admin-acties worden niet gelogd
    entry.id = uid("log"); entry.timestamp = now(); db.logs.unshift(entry);
  }

  /* ---------- Shifts ---------- */
  function validTime(dagdeel, t) {
    if (!t) return true;
    var m = toMin(t), w = WINDOW[dagdeel];
    return w && m >= w.min && m <= w.max;
  }

  function offerShift(data) {
    var u = currentUser();
    if (!u) throw new Error("Niet ingelogd.");
    if (!data.datum) throw new Error("Kies een datum.");
    if (!data.dagdeel) throw new Error("Kies AM of PM.");
    if (data.dagdeel === "PM" && isSunday(data.datum)) throw new Error("Zondag heeft geen PM-shift.");
    if (data.shiftsBekend && data.starttijd && !validTime(data.dagdeel, data.starttijd))
      throw new Error("Starttijd valt buiten het toegestane venster voor " + data.dagdeel + ".");
    if (data.shiftsBekend && data.taak && !canDoTask(u, data.taak))
      throw new Error("Je kunt geen shift met een taak aanbieden die je zelf niet mag uitvoeren.");
    var s = {
      id: uid("shift"), aanbiederId: u.id, hubId: u.hubId,
      datum: data.datum, dagdeel: data.dagdeel, shiftsBekend: !!data.shiftsBekend,
      starttijd: data.shiftsBekend ? (data.starttijd || "") : "",
      busType: data.shiftsBekend ? (data.busType || "") : "",
      taak: data.shiftsBekend ? (data.taak || "") : "",
      aanbiedReden: REASONS.indexOf(data.aanbiedReden) !== -1 ? data.aanbiedReden : "",
      status: "open", overnemerId: null, besluitDoorId: null, besluitOp: null, reden: "",
      fifoWarning: false, fifoSkippedBy: "", fifoSkippedAt: null, seq: nextSeq(), createdAt: now()
    };
    db.shifts.unshift(s); save();
    return s;
  }

  function editShift(id, data) {
    var s = db.shifts.filter(function (x) { return x.id === id; })[0]; var u = currentUser();
    if (!s) throw new Error("Shift niet gevonden.");
    if (s.aanbiederId !== u.id) throw new Error("Je kunt alleen je eigen shift aanpassen.");
    if (s.status !== "open") throw new Error("Deze shift kan niet meer aangepast worden.");
    if (data.shiftsBekend && data.starttijd && !validTime(data.dagdeel || s.dagdeel, data.starttijd))
      throw new Error("Starttijd valt buiten het toegestane venster.");
    s.datum = data.datum || s.datum; s.dagdeel = data.dagdeel || s.dagdeel;
    s.shiftsBekend = !!data.shiftsBekend;
    s.starttijd = s.shiftsBekend ? (data.starttijd || "") : "";
    s.busType = s.shiftsBekend ? (data.busType || "") : "";
    s.taak = s.shiftsBekend ? (data.taak || "") : "";
    save(); return s;
  }

  function withdrawShift(id) {
    var s = db.shifts.filter(function (x) { return x.id === id; })[0]; var u = currentUser();
    if (!s || s.aanbiederId !== u.id) throw new Error("Je kunt alleen je eigen shift intrekken.");
    if (s.status !== "open" && s.status !== "in-afwachting") throw new Error("Kan niet meer ingetrokken worden.");
    s.status = "ingetrokken"; save();
  }

  function claimShift(id) {
    var u = currentUser(); var s = db.shifts.filter(function (x) { return x.id === id; })[0];
    if (!s) throw new Error("Shift niet gevonden.");
    if (!can.claimShift(u, s)) throw new Error("Je kunt deze shift niet overnemen.");
    // FCFS: zonder starttijd geldt 'wie eerst komt, eerst maalt'. Een later geplaatste shift
    // overnemen terwijl een eerdere nog open staat -> markeer voor de beoordelaar.
    s.fifoWarning = false; s.fifoSkippedBy = ""; s.fifoSkippedAt = null;
    if (!s.starttijd) {
      var earlier = db.shifts.filter(function (o) {
        return o.id !== s.id && o.hubId === s.hubId && o.status === "open" &&
          o.datum === s.datum && o.dagdeel === s.dagdeel && !o.starttijd && (o.seq || 0) < (s.seq || 0);
      }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
      if (earlier.length) {
        var ab = userById(earlier[0].aanbiederId);
        s.fifoWarning = true;
        s.fifoSkippedBy = ab ? ab.voornaam + " " + ab.achternaam : "";
        s.fifoSkippedAt = earlier[0].createdAt;
      }
    }
    s.overnemerId = u.id; s.status = "in-afwachting"; save();
    return s;
  }

  function decideShift(id, approve, reden) {
    var u = currentUser(); var s = db.shifts.filter(function (x) { return x.id === id; })[0];
    if (!s) throw new Error("Shift niet gevonden.");
    if (s.status !== "in-afwachting") throw new Error("Deze shiftwissel wacht niet op goedkeuring.");
    if (!can.approveShift(u, s)) throw new Error("Je mag deze shiftwissel niet beoordelen.");
    s.status = approve ? "goedgekeurd" : "afgekeurd";
    s.besluitDoorId = u.id; s.besluitOp = now(); s.reden = reden || "";
    if (approve) {
      var a = userById(s.aanbiederId), o = userById(s.overnemerId);
      if (a) a.stats.shiftsAangeboden++; if (o) o.stats.shiftsOvergenomen++;
    }
    addLog({
      type: "shiftwissel", actie: approve ? "goedgekeurd" : "afgekeurd", refId: s.id,
      doorId: u.id, aanbiederId: s.aanbiederId, overnemerId: s.overnemerId, hubId: s.hubId,
      details: { datum: s.datum, dagdeel: s.dagdeel, starttijd: s.starttijd, busType: s.busType, taak: s.taak, shiftsBekend: s.shiftsBekend },
      reden: reden || ""
    });
    if (!approve) { s.overnemerId = null; s.status = "open"; s.fifoWarning = false; }
    save(); return s;
  }

  /* ---------- Losse taken ---------- */
  function offerTask(data) {
    var u = currentUser();
    if (!u) throw new Error("Niet ingelogd.");
    if (!data.datum) throw new Error("Kies een datum.");
    if (!data.dagdeel) throw new Error("Kies AM of PM.");
    if (data.dagdeel === "PM" && isSunday(data.datum)) throw new Error("Zondag heeft geen PM-shift.");
    if (!data.taak) throw new Error("Kies een taak.");
    if (!canDoTask(u, data.taak)) throw new Error("Je kunt alleen taken aanbieden die je zelf mag uitvoeren.");
    if (data.starttijd && !validTime(data.dagdeel, data.starttijd)) throw new Error("Tijd valt buiten het venster voor " + data.dagdeel + ".");
    var t = {
      id: uid("task"), aanbiederId: u.id, hubId: u.hubId, datum: data.datum, dagdeel: data.dagdeel,
      taak: data.taak, starttijd: data.starttijd || "",
      aanbiedReden: REASONS.indexOf(data.aanbiedReden) !== -1 ? data.aanbiedReden : "",
      status: "open", overnemerId: null, besluitDoorId: null, besluitOp: null, reden: "", createdAt: now()
    };
    db.taskOffers.unshift(t); save();
    return t;
  }
  function withdrawTask(id) {
    var t = db.taskOffers.filter(function (x) { return x.id === id; })[0]; var u = currentUser();
    if (!t || t.aanbiederId !== u.id) throw new Error("Je kunt alleen je eigen taak intrekken.");
    if (t.status !== "open" && t.status !== "in-afwachting") throw new Error("Kan niet meer ingetrokken worden.");
    t.status = "ingetrokken"; save();
  }
  function claimTask(id) {
    var u = currentUser(); var t = db.taskOffers.filter(function (x) { return x.id === id; })[0];
    if (!t) throw new Error("Taak niet gevonden.");
    if (!can.claimTask(u, t)) throw new Error("Je kunt deze taak niet overnemen.");
    t.overnemerId = u.id; t.status = "in-afwachting"; save(); return t;
  }
  function decideTask(id, approve, reden) {
    var u = currentUser(); var t = db.taskOffers.filter(function (x) { return x.id === id; })[0];
    if (!t) throw new Error("Taak niet gevonden.");
    if (t.status !== "in-afwachting") throw new Error("Deze taakwissel wacht niet op goedkeuring.");
    if (!can.approveTask(u)) throw new Error("Je mag deze taakwissel niet beoordelen.");
    t.status = approve ? "goedgekeurd" : "afgekeurd";
    t.besluitDoorId = u.id; t.besluitOp = now(); t.reden = reden || "";
    if (approve) { var a = userById(t.aanbiederId), o = userById(t.overnemerId); if (a) a.stats.takenAangeboden++; if (o) o.stats.takenOvergenomen++; }
    addLog({
      type: "taakwissel", actie: approve ? "goedgekeurd" : "afgekeurd", refId: t.id,
      doorId: u.id, aanbiederId: t.aanbiederId, overnemerId: t.overnemerId, hubId: t.hubId,
      details: { datum: t.datum, dagdeel: t.dagdeel, starttijd: t.starttijd, taak: t.taak }, reden: reden || ""
    });
    if (!approve) { t.overnemerId = null; t.status = "open"; }
    save(); return t;
  }

  /* ---------- Back-up verzoeken (beide richtingen) ----------
     direction "rijden": ik sta op back-up en wil rijden -> een collega geeft zijn rit op (vult ritdetails in bij overnemen).
     direction "backup": ik heb een rit maar wil back-up staan -> ik vul ritdetails in; iemand op back-up neemt mijn rit over. */
  function offerBackup(data) {
    var u = currentUser();
    if (!data.datum) throw new Error("Kies een datum.");
    if (!data.dagdeel) throw new Error("Kies AM of PM.");
    if (data.dagdeel === "PM" && isSunday(data.datum)) throw new Error("Zondag heeft geen PM-shift.");
    var dir = data.direction === "backup" ? "backup" : "rijden";
    if (dir === "backup" && !(data.ritOmschrijving || "").trim()) throw new Error("Beschrijf je rit (wat voor rit en hoe laat).");
    var b = {
      id: uid("bu"), aanbiederId: u.id, hubId: u.hubId, datum: data.datum, dagdeel: data.dagdeel,
      direction: dir, toelichting: (data.toelichting || "").trim(),
      ritOmschrijving: (data.ritOmschrijving || "").trim(), ritTijd: data.ritTijd || "",
      status: "open", overnemerId: null, besluitDoorId: null, besluitOp: null, reden: "", createdAt: now()
    };
    db.backups.unshift(b); save(); return b;
  }
  function withdrawBackup(id) {
    var b = db.backups.filter(function (x) { return x.id === id; })[0]; var u = currentUser();
    if (!b || b.aanbiederId !== u.id) throw new Error("Je kunt alleen je eigen verzoek intrekken.");
    if (b.status !== "open" && b.status !== "in-afwachting") throw new Error("Kan niet meer ingetrokken worden.");
    b.status = "ingetrokken"; save();
  }
  function claimBackup(id, details) {
    var u = currentUser(); var b = db.backups.filter(function (x) { return x.id === id; })[0];
    if (!b) throw new Error("Verzoek niet gevonden.");
    if (!can.claimBackup(u, b)) throw new Error("Je kunt dit verzoek niet oppakken.");
    details = details || {};
    if (b.direction === "rijden") {
      // jij geeft je rit op -> ritdetails verplicht
      if (!(details.ritOmschrijving || "").trim()) throw new Error("Vul in wat voor rit je opgeeft (en hoe laat).");
      b.ritOmschrijving = details.ritOmschrijving.trim();
      b.ritTijd = details.ritTijd || "";
    }
    b.overnemerId = u.id; b.status = "in-afwachting"; save(); return b;
  }
  function decideBackup(id, approve, reden) {
    var u = currentUser(); var b = db.backups.filter(function (x) { return x.id === id; })[0];
    if (!b) throw new Error("Verzoek niet gevonden.");
    if (b.status !== "in-afwachting") throw new Error("Dit verzoek wacht niet op goedkeuring.");
    if (!can.approveBackup(u)) throw new Error("Je mag dit verzoek niet beoordelen.");
    b.status = approve ? "goedgekeurd" : "afgekeurd";
    b.besluitDoorId = u.id; b.besluitOp = now(); b.reden = reden || "";
    addLog({
      type: "backup", actie: approve ? "goedgekeurd" : "afgekeurd", refId: b.id,
      doorId: u.id, aanbiederId: b.aanbiederId, overnemerId: b.overnemerId, hubId: b.hubId,
      details: { datum: b.datum, dagdeel: b.dagdeel, direction: b.direction, taak: b.ritOmschrijving }, reden: reden || ""
    });
    if (!approve) { b.overnemerId = null; b.status = "open"; }
    save(); return b;
  }

  /* ---------- Oproep: "shift gezocht" ----------
     Iemand vraagt of een collega zijn shift aan hem/haar wil geven. */
  function offerCallout(data) {
    var u = currentUser();
    if (!data.datum) throw new Error("Kies een datum.");
    if (!data.dagdeel) throw new Error("Kies AM of PM.");
    if (data.dagdeel === "PM" && isSunday(data.datum)) throw new Error("Zondag heeft geen PM-shift.");
    var c = {
      id: uid("call"), aanbiederId: u.id, hubId: u.hubId, datum: data.datum, dagdeel: data.dagdeel,
      toelichting: (data.toelichting || "").trim(), status: "open",
      overnemerId: null, besluitDoorId: null, besluitOp: null, reden: "", createdAt: now()
    };
    db.callouts.unshift(c); save(); return c;
  }
  function withdrawCallout(id) {
    var c = db.callouts.filter(function (x) { return x.id === id; })[0]; var u = currentUser();
    if (!c || c.aanbiederId !== u.id) throw new Error("Je kunt alleen je eigen oproep intrekken.");
    if (c.status !== "open" && c.status !== "in-afwachting") throw new Error("Kan niet meer ingetrokken worden.");
    c.status = "ingetrokken"; save();
  }
  function claimCallout(id) {
    var u = currentUser(); var c = db.callouts.filter(function (x) { return x.id === id; })[0];
    if (!c) throw new Error("Oproep niet gevonden.");
    if (c.status !== "open" || c.aanbiederId === u.id || c.hubId !== u.hubId) throw new Error("Je kunt deze oproep niet beantwoorden.");
    c.overnemerId = u.id; c.status = "in-afwachting"; save(); return c;
  }
  function decideCallout(id, approve, reden) {
    var u = currentUser(); var c = db.callouts.filter(function (x) { return x.id === id; })[0];
    if (!c) throw new Error("Oproep niet gevonden.");
    if (c.status !== "in-afwachting") throw new Error("Deze oproep wacht niet op goedkeuring.");
    if (!can.approveBackup(u)) throw new Error("Je mag deze oproep niet beoordelen.");
    c.status = approve ? "goedgekeurd" : "afgekeurd";
    c.besluitDoorId = u.id; c.besluitOp = now(); c.reden = reden || "";
    addLog({
      type: "oproep", actie: approve ? "goedgekeurd" : "afgekeurd", refId: c.id,
      doorId: u.id, aanbiederId: c.aanbiederId, overnemerId: c.overnemerId, hubId: c.hubId,
      details: { datum: c.datum, dagdeel: c.dagdeel }, reden: reden || ""
    });
    if (!approve) { c.overnemerId = null; c.status = "open"; }
    save(); return c;
  }

  /* ---------- Beheer ---------- */
  function setUserRole(targetId, rol) {
    if (!can.editRoles(currentUser())) throw new Error("Alleen een locatie-manager mag functies toewijzen.");
    var t = userById(targetId); if (!t) throw new Error("Gebruiker niet gevonden.");
    t.rol = rol; save();
  }
  function setUserN2(targetId, val) {
    if (!can.editTeam(currentUser())) throw new Error("Alleen teamleider of hoger mag dit aanpassen.");
    var t = userById(targetId); if (!t) return; t.n2 = !!val; save();
  }
  function setUserJbt(targetId, val) {
    if (!can.editTeam(currentUser())) throw new Error("Alleen teamleider of hoger mag dit aanpassen.");
    var t = userById(targetId); if (!t) return; t.jbtTrainer = !!val; save();
  }
  function setUserHub(targetId, hubId) {
    if (!can.editRoles(currentUser())) throw new Error("Alleen een locatie-manager mag de hub wijzigen.");
    var t = userById(targetId); if (!t) return; t.hubId = hubId; save();
  }
  function toggleUserTask(targetId, taak) {
    if (!can.editTeam(currentUser())) throw new Error("Alleen teamleider of hoger mag taken toewijzen.");
    var t = userById(targetId); if (!t) return;
    var i = t.taken.indexOf(taak); if (i === -1) t.taken.push(taak); else t.taken.splice(i, 1); save();
  }
  function removeUser(targetId) {
    var me = currentUser();
    if (!can.editTeam(me)) throw new Error("Alleen teamleider of hoger mag medewerkers verwijderen.");
    var t = userById(targetId); if (!t) throw new Error("Medewerker niet gevonden.");
    if (t.id === me.id) throw new Error("Je kunt jezelf niet verwijderen.");
    if (t.hidden) throw new Error("Deze gebruiker kan niet verwijderd worden.");
    if (!isAdmin(me) && level(t) >= level(me)) throw new Error("Je kunt alleen medewerkers met een lagere functie verwijderen.");
    db.users = db.users.filter(function (u) { return u.id !== targetId; });
    // opruimen: eigen ruilitems weg, en 'overgenomen door' terugzetten naar open
    ["shifts", "taskOffers", "backups", "callouts"].forEach(function (key) {
      if (!Array.isArray(db[key])) return;
      db[key] = db[key].filter(function (x) { return x.aanbiederId !== targetId; });
      db[key].forEach(function (x) { if (x.overnemerId === targetId) { x.overnemerId = null; if (x.status === "in-afwachting") x.status = "open"; } });
    });
    save();
  }
  function addHub(naam) {
    if (!can.editHubs(currentUser())) throw new Error("Alleen een locatie-manager mag hubs beheren.");
    naam = (naam || "").trim(); if (!naam) throw new Error("Vul een hubnaam in.");
    if (db.hubs.some(function (h) { return h.naam.toLowerCase() === naam.toLowerCase(); })) throw new Error("Deze hub bestaat al.");
    db.hubs.push({ id: uid("hub"), naam: naam }); save();
  }
  function removeHub(id) {
    if (!can.editHubs(currentUser())) throw new Error("Alleen een locatie-manager mag hubs beheren.");
    if (db.users.some(function (u) { return u.hubId === id; })) throw new Error("Er zijn nog medewerkers gekoppeld aan deze hub.");
    db.hubs = db.hubs.filter(function (h) { return h.id !== id; }); save();
  }
  function addCatalogTask(naam, type) {
    if (!can.editCatalog(currentUser())) throw new Error("Alleen teamleider of hoger mag taken beheren.");
    naam = (naam || "").trim(); if (!naam) throw new Error("Vul een taaknaam in.");
    if (naam === TASK_JBT) throw new Error("Dit is een speciale taak en kan niet worden toegevoegd.");
    if (db.taskCatalog.some(function (t) { return t.toLowerCase() === naam.toLowerCase(); })) throw new Error("Deze taak bestaat al.");
    db.taskCatalog.push(naam);
    db.taskTypes[naam] = (type === "senior") ? "senior" : "bezorger";
    save();
  }
  function removeCatalogTask(naam) {
    if (!can.editCatalog(currentUser())) throw new Error("Alleen teamleider of hoger mag taken beheren.");
    db.taskCatalog = db.taskCatalog.filter(function (t) { return t !== naam; });
    delete db.taskTypes[naam];
    db.users.forEach(function (u) { u.taken = u.taken.filter(function (t) { return t !== naam; }); });
    save();
  }
  function setTaskType(naam, type) {
    if (!can.editCatalog(currentUser())) throw new Error("Alleen teamleider of hoger mag taken beheren.");
    if (db.taskCatalog.indexOf(naam) === -1) return;
    db.taskTypes[naam] = (type === "senior") ? "senior" : "bezorger";
    // taak intrekken bij bezorgers die 'm niet meer mogen
    if (db.taskTypes[naam] === "senior") db.users.forEach(function (u) { if (level(u) < 3) u.taken = u.taken.filter(function (t) { return t !== naam; }); });
    save();
  }

  /* ---------- Takenplanning ---------- */
  function planningFor(hubId, weekStart) {
    if (!db.plannings) db.plannings = [];
    var p = db.plannings.filter(function (x) { return x.hubId === hubId && x.weekStart === weekStart; })[0];
    if (!p) {
      p = {
        id: uid("plan"), hubId: hubId, weekStart: weekStart,
        rows: usersForHub(hubId).slice().sort(function (a, b) { return level(b) - level(a) || a.voornaam.localeCompare(b.voornaam); })
          .map(function (u) { return { key: u.id, naam: u.voornaam + " " + u.achternaam }; }),
        cells: {}, createdAt: now()
      };
      db.plannings.push(p); save();
    }
    return p;
  }
  function planById(id) { return (db.plannings || []).filter(function (p) { return p.id === id; })[0] || null; }
  function setPlanCell(planId, key, dayIdx, dagdeel, data) {
    if (!can.planning(currentUser())) throw new Error("Alleen senior of hoger mag de planning maken.");
    var p = planById(planId); if (!p) return;
    var k = key + "__" + dayIdx + "__" + dagdeel;
    if (data === null) delete p.cells[k];
    else p.cells[k] = { taak: (data.taak || "").trim() };
    save();
  }
  function addPlanRow(planId, naam) {
    if (!can.planning(currentUser())) throw new Error("Geen rechten.");
    naam = (naam || "").trim(); if (!naam) throw new Error("Vul een naam in.");
    var p = planById(planId); if (!p) return;
    p.rows.push({ key: uid("prow"), naam: naam }); save();
  }
  function removePlanRow(planId, key) {
    if (!can.planning(currentUser())) throw new Error("Geen rechten.");
    var p = planById(planId); if (!p) return;
    p.rows = p.rows.filter(function (r) { return r.key !== key; });
    Object.keys(p.cells).forEach(function (k) { if (k.indexOf(key + "__") === 0) delete p.cells[k]; });
    save();
  }

  /* ---------- Operationeel (per shift: hub + datum + dagdeel) ---------- */
  var DOCKS = [16, 17, 18, 21, 22, 23];
  var EMB_TROLLEYS = 14;
  var EMB_VAKKEN = 18;
  var VAK_SOORTEN = [
    { id: "", label: "— Niet ingesteld —" },
    { id: "leeg5", label: "Lege 5-laags" },
    { id: "leeg4", label: "Lege 4-laags" },
    { id: "koel4", label: "Koelboxen (4-laags)" },
    { id: "kratten5", label: "Kratten (5-laags)" },
    { id: "emb5", label: "Emballage (5-laags)" },
    { id: "overig", label: "Overig" }
  ];
  // Vaste vakindeling (nummering met gaten: 14 en 15 bestaan niet) + standaard-soort per vak. Blijft aanpasbaar.
  var VAK_NUMMERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18];
  var VAK_STANDAARD = { 1: "leeg5", 2: "kratten5", 3: "kratten5", 4: "koel4", 5: "koel4", 6: "koel4", 7: "koel4", 8: "emb5", 9: "emb5", 10: "emb5", 11: "emb5", 12: "leeg5", 13: "leeg5", 16: "overig", 17: "leeg4", 18: "leeg4" };
  function vakSoortLabel(id) { var s = VAK_SOORTEN.filter(function (x) { return x.id === id; })[0]; return s ? s.label : "—"; }
  function reload() { refresh(); }
  function splitLines(t) { return (t || "").split(/\r?\n/).map(function (x) { return x.trim(); }); }
  function opKey(hubId, datum, dagdeel) { return hubId + "|" + datum + "|" + dagdeel; }
  function isSunday(datum) { return new Date(datum + "T00:00:00").getDay() === 0; }
  function dagdelenVoor(datum) { return isSunday(datum) ? ["AM"] : ["AM", "PM"]; }
  function isSetup(u) { return isAdmin(u) || level(u) >= 3; } // binnendienst/senior+ regelt de setup via dashboard

  // Dienst-toewijzing: wie mag deze shift welke taak uitvoeren
  function getDiensten(hubId, datum, dagdeel) {
    if (!db.diensten) db.diensten = {};
    var k = opKey(hubId, datum, dagdeel);
    if (!db.diensten[k]) db.diensten[k] = { schadecontrole: [], lc: [], kwaliteit: [] };
    return db.diensten[k];
  }
  function setDienst(hubId, datum, dagdeel, moduleKey, userIds) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag diensten toewijzen.");
    getDiensten(hubId, datum, dagdeel)[moduleKey] = userIds.slice(); save();
  }
  function canOpShift(u, hubId, datum, dagdeel, moduleKey, taskName) {
    if (isAdmin(u) || level(u) >= 4) return true;
    var d = getDiensten(hubId, datum, dagdeel)[moduleKey] || [];
    if (d.length) return d.indexOf(u.id) !== -1;
    return u.taken.indexOf(taskName) !== -1; // terugval als nog niemand is toegewezen
  }

  /* ----- Schadecontrole ----- */
  function getSchade(hubId, datum, dagdeel) { if (!db.schade) db.schade = {}; var k = opKey(hubId, datum, dagdeel); if (!db.schade[k]) db.schade[k] = { buses: [], steekproeven: [] }; if (!db.schade[k].steekproeven) db.schade[k].steekproeven = []; return db.schade[k]; }
  // Steekproef per bus: gele knop op de busregel opent naam/hr/rit/kratten (standaard 5 steekproeven).
  function setBusSteekproef(hubId, datum, dagdeel, busId, data) {
    if (!canOpShift(currentUser(), hubId, datum, dagdeel, "schadecontrole", "Schadecontrole")) throw new Error("Je bent deze shift niet aangewezen voor de schadecontrole.");
    var b = getSchade(hubId, datum, dagdeel).buses.filter(function (x) { return x.id === busId; })[0]; if (!b) return;
    if (!b.steekproef) b.steekproef = { naam: "", hr: "", rit: "", kratten: "" };
    if (data.naam !== undefined) b.steekproef.naam = data.naam.trim();
    if (data.hr !== undefined) b.steekproef.hr = data.hr.trim();
    if (data.rit !== undefined) b.steekproef.rit = data.rit.trim();
    if (data.kratten !== undefined) b.steekproef.kratten = data.kratten;
    save();
  }
  function steekproefDone(b) { return !!(b && b.steekproef && b.steekproef.naam && b.steekproef.kratten !== "" && b.steekproef.kratten != null); }
  function steekproefStats(hubId, datum, dagdeel) {
    var b = getSchade(hubId, datum, dagdeel).buses;
    return { done: b.filter(steekproefDone).length, total: 5 };
  }
  function newBus(naam, bus, kenteken) { return { id: uid("bus"), naam: (naam || "").trim(), bus: (bus || "").trim(), kenteken: (kenteken || "").trim(), dock: "", gecontroleerd: false, mist_tolkrol: false, mist_kabels: false, mist_doekjes: false, steekproef: null }; }
  function schadeImportColumns(hubId, datum, dagdeel, busText, kentekenText, naamText) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag importeren.");
    var s = getSchade(hubId, datum, dagdeel);
    var bus = splitLines(busText), kent = splitLines(kentekenText), naam = splitLines(naamText);
    var n = Math.max(bus.length, kent.length, naam.length);
    for (var i = 0; i < n; i++) { if (!(bus[i] || kent[i] || naam[i])) continue; s.buses.push(newBus(naam[i], bus[i], kent[i])); }
    save();
  }
  function schadeAddBus(hubId, datum, dagdeel, naam, bus, kenteken) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag bussen toevoegen.");
    getSchade(hubId, datum, dagdeel).buses.push(newBus(naam, bus, kenteken)); save();
  }
  function schadeToggle(hubId, datum, dagdeel, busId, field) {
    if (!canOpShift(currentUser(), hubId, datum, dagdeel, "schadecontrole", "Schadecontrole")) throw new Error("Je bent deze shift niet aangewezen voor de schadecontrole.");
    var b = getSchade(hubId, datum, dagdeel).buses.filter(function (x) { return x.id === busId; })[0]; if (!b) return;
    b[field] = !b[field]; save();
  }
  function schadeSetDock(hubId, datum, dagdeel, busId, dock) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag een dock toewijzen.");
    var s = getSchade(hubId, datum, dagdeel);
    var b = s.buses.filter(function (x) { return x.id === busId; })[0]; if (!b) return;
    if (dock) { // maar één bus per dock
      var bezet = s.buses.filter(function (x) { return x.id !== busId && String(x.dock) === String(dock); })[0];
      if (bezet) throw new Error("Dock " + dock + " is al toegewezen aan bus " + (bezet.bus || "?") + ".");
    }
    b.dock = dock || ""; save();
  }
  function schadeRemove(hubId, datum, dagdeel, busId) { if (!isSetup(currentUser())) throw new Error("Geen rechten."); var s = getSchade(hubId, datum, dagdeel); s.buses = s.buses.filter(function (x) { return x.id !== busId; }); save(); }
  function schadeReset(hubId, datum, dagdeel) { if (!isSetup(currentUser())) throw new Error("Geen rechten."); db.schade[opKey(hubId, datum, dagdeel)] = { buses: [] }; save(); }
  function schadeStats(hubId, datum, dagdeel) {
    var b = getSchade(hubId, datum, dagdeel).buses;
    var done = b.filter(function (x) { return x.gecontroleerd; }).length;
    return { total: b.length, done: done, pct: b.length ? Math.round(done / b.length * 100) : 0 };
  }

  /* ----- Kwaliteit: vak-soort + emballage per vak ----- */
  function getKwaliteit(hubId, datum, dagdeel) { if (!db.kwaliteit) db.kwaliteit = {}; var k = opKey(hubId, datum, dagdeel); if (!db.kwaliteit[k]) db.kwaliteit[k] = { emballage: {}, soort: {} }; if (!db.kwaliteit[k].soort) db.kwaliteit[k].soort = {}; return db.kwaliteit[k]; }
  function vakSoortOf(k, vak) { var s = k.soort[vak]; return (s === undefined || s === null) ? (VAK_STANDAARD[vak] || "") : s; }
  function vakSoort(hubId, datum, dagdeel, vak) { return vakSoortOf(getKwaliteit(hubId, datum, dagdeel), vak); }
  function setVakSoort(hubId, datum, dagdeel, vak, soortId) {
    if (!(canOpShift(currentUser(), hubId, datum, dagdeel, "kwaliteit", "Kwaliteit") || isSetup(currentUser()))) throw new Error("Je bent deze shift niet aangewezen voor kwaliteit.");
    var k = getKwaliteit(hubId, datum, dagdeel); k.soort[vak] = soortId || "";
    if (soortId !== "emb5") delete k.emballage[vak]; // alleen emballage-vakken worden geteld
    save();
  }
  function emballageSet(hubId, datum, dagdeel, vak, idx, value) {
    if (!canOpShift(currentUser(), hubId, datum, dagdeel, "kwaliteit", "Kwaliteit")) throw new Error("Je bent deze shift niet aangewezen voor kwaliteit.");
    var k = getKwaliteit(hubId, datum, dagdeel);
    if (vakSoortOf(k, vak) !== "emb5") throw new Error("Dit vak is niet ingesteld op emballage.");
    if (!k.emballage[vak]) { k.emballage[vak] = []; for (var i = 0; i < EMB_TROLLEYS; i++) k.emballage[vak].push(0); }
    k.emballage[vak][idx] = Math.max(0, parseInt(value, 10) || 0); save();
  }
  function emballageVakTotal(hubId, datum, dagdeel, vak) {
    var arr = getKwaliteit(hubId, datum, dagdeel).emballage[vak] || [];
    return arr.reduce(function (a, b) { return a + (b || 0); }, 0);
  }
  // Binnendienst kan een emballagevak leeghalen (staat los van de trolley-telling).
  function clearEmbVak(hubId, datum, dagdeel, vak) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag een vak leeghalen.");
    var k = getKwaliteit(hubId, datum, dagdeel); delete k.emballage[vak]; save();
  }

  /* ----- Trolley-voorraad (loopt door per hub: draagt over naar volgende dagdeel én dag) ----- */
  function trolleyOrd(datum, dagdeel) { return datum + (dagdeel === "AM" ? "0" : "1"); }
  function latestTrolleyBefore(hubId, datum, dagdeel) {
    if (!db.trolley) return null;
    var curOrd = trolleyOrd(datum, dagdeel), best = null, bestOrd = "";
    Object.keys(db.trolley).forEach(function (kk) {
      var p = kk.split("|"); if (p[0] !== hubId) return;
      var o = trolleyOrd(p[1], p[2]);
      if (o < curOrd && o > bestOrd) { bestOrd = o; best = db.trolley[kk]; }
    });
    return best;
  }
  function getTrolley(hubId, datum, dagdeel) {
    if (!db.trolley) db.trolley = {};
    var k = opKey(hubId, datum, dagdeel);
    if (!db.trolley[k]) { var prev = latestTrolleyBefore(hubId, datum, dagdeel); db.trolley[k] = { stock4: prev ? prev.stock4 : 0, stock5: prev ? prev.stock5 : 0, pendels: [] }; }
    if (!db.trolley[k].pendels) db.trolley[k].pendels = [];
    return db.trolley[k];
  }
  // Binnendienst plant een pendel (met geplande aankomsttijd) klaar voor deze shift.
  function addPendelPlan(hubId, datum, dagdeel, tijd) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag pendels klaarzetten.");
    var t = getTrolley(hubId, datum, dagdeel);
    t.pendels.push({ id: uid("pen"), tijd: (tijd || "").trim(), in4: 0, out4: 0, in5: 0, out5: 0 });
    save();
  }
  function removePendel(hubId, datum, dagdeel, id) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag pendels verwijderen.");
    var t = getTrolley(hubId, datum, dagdeel); t.pendels = t.pendels.filter(function (p) { return p.id !== id; }); save();
  }
  // LC verwerkt de trolley-veranderingen per pendel met +/- (past de doorlopende voorraad aan).
  function pendelBump(hubId, datum, dagdeel, id, field, delta) {
    if (!canOpShift(currentUser(), hubId, datum, dagdeel, "lc", "LC")) throw new Error("Je bent deze shift niet aangewezen als LC.");
    if (["in4", "out4", "in5", "out5"].indexOf(field) === -1) return;
    var t = getTrolley(hubId, datum, dagdeel); var p = t.pendels.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var nv = Math.max(0, (p[field] || 0) + (parseInt(delta, 10) || 0)); var applied = nv - (p[field] || 0); p[field] = nv;
    var lay = (field === "in4" || field === "out4") ? "stock4" : "stock5";
    var sign = (field === "in4" || field === "in5") ? 1 : -1;
    t[lay] = Math.max(0, (t[lay] || 0) + sign * applied);
    save();
  }
  function trolleySetStock(hubId, datum, dagdeel, field, value) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag corrigeren.");
    var t = getTrolley(hubId, datum, dagdeel); t[field] = Math.max(0, parseInt(value, 10) || 0); save();
  }
  // Trolley-telling met +/- (kwaliteit tijdens/na de shift, of senior+).
  function trolleyBump(hubId, datum, dagdeel, field, delta) {
    if (!(canOpShift(currentUser(), hubId, datum, dagdeel, "kwaliteit", "Kwaliteit") || isSetup(currentUser()))) throw new Error("Je bent deze shift niet aangewezen voor kwaliteit.");
    if (field !== "stock4" && field !== "stock5") return;
    var t = getTrolley(hubId, datum, dagdeel); t[field] = Math.max(0, (t[field] || 0) + (parseInt(delta, 10) || 0)); save();
  }

  /* ----- LC (laden) ----- */
  function getLC(hubId, datum, dagdeel) { if (!db.lc) db.lc = {}; var k = opKey(hubId, datum, dagdeel); if (!db.lc[k]) db.lc[k] = { vakken: [], aantal: 0 }; return db.lc[k]; }
  function newVak(nr) { return { nr: nr, vertrek: "", bus: "", rit: "", ze: false, type: "diesel", geladen: false }; }
  function lcSetAantal(hubId, datum, dagdeel, aantal) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag het aantal vakken instellen.");
    aantal = Math.max(0, Math.min(60, parseInt(aantal, 10) || 0));
    var lc = getLC(hubId, datum, dagdeel); lc.aantal = aantal;
    var cur = lc.vakken.length;
    if (aantal > cur) { for (var i = cur + 1; i <= aantal; i++) lc.vakken.push(newVak(i)); }
    else if (aantal < cur) lc.vakken = lc.vakken.slice(0, aantal);
    save();
  }
  // Volledige setup van een vak (binnendienst): bus/rit/type/ze.
  function lcSetupVak(hubId, datum, dagdeel, nr, data) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag de vakken klaarzetten.");
    var vk = getLC(hubId, datum, dagdeel).vakken.filter(function (x) { return x.nr === nr; })[0]; if (!vk) return;
    if (data.bus !== undefined) vk.bus = data.bus.trim();
    if (data.rit !== undefined) vk.rit = data.rit.trim();
    if (data.vertrek !== undefined) vk.vertrek = data.vertrek.trim();
    if (data.ze !== undefined) vk.ze = !!data.ze;
    if (data.type !== undefined) vk.type = data.type;
    save();
  }
  // LC mag alleen op een PM-shift de busnummers invullen.
  function lcSetBus(hubId, datum, dagdeel, nr, bus) {
    var u = currentUser();
    if (!canOpShift(u, hubId, datum, dagdeel, "lc", "LC")) throw new Error("Je bent deze shift niet aangewezen als LC.");
    if (dagdeel !== "PM" && !isSetup(u)) throw new Error("Busnummers invoeren door de LC kan alleen op een PM-shift.");
    var vk = getLC(hubId, datum, dagdeel).vakken.filter(function (x) { return x.nr === nr; })[0]; if (!vk) return;
    if (vk.type === "N2" && !isSetup(u)) throw new Error("N2-bussen worden door de binnendienst ingevuld, niet door de LC.");
    vk.bus = (bus || "").trim(); save();
  }
  function lcToggleGeladen(hubId, datum, dagdeel, nr) {
    if (!canOpShift(currentUser(), hubId, datum, dagdeel, "lc", "LC")) throw new Error("Je bent deze shift niet aangewezen als LC.");
    var vk = getLC(hubId, datum, dagdeel).vakken.filter(function (x) { return x.nr === nr; })[0]; if (!vk) return;
    vk.geladen = !vk.geladen; save();
  }
  function lcImportColumns(hubId, datum, dagdeel, busText, ritText, typeText) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag importeren.");
    var lc = getLC(hubId, datum, dagdeel);
    var bus = splitLines(busText), rit = splitLines(ritText), type = splitLines(typeText);
    var n = Math.max(bus.length, rit.length, type.length);
    if (lc.vakken.length < n) { var cur = lc.vakken.length; lc.aantal = Math.max(lc.aantal, n); for (var j = cur + 1; j <= n; j++) lc.vakken.push(newVak(j)); }
    for (var i = 0; i < n; i++) { var vk = lc.vakken[i]; if (!vk) continue; if (bus[i]) vk.bus = bus[i]; if (rit[i]) vk.rit = rit[i]; if (type[i]) vk.type = type[i].toLowerCase() === "n2" ? "N2" : "diesel"; }
    save();
  }
  function lcReset(hubId, datum, dagdeel) { if (!isSetup(currentUser())) throw new Error("Geen rechten."); db.lc[opKey(hubId, datum, dagdeel)] = { vakken: [], aantal: 0 }; save(); }

  // Volledige planning-sheet importeren (plak met kopregel). Vult schade + LC automatisch.
  function importSheet(hubId, datum, dagdeel, text, part) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag importeren.");
    var doSchade = part !== "laden", doLaden = part !== "schade";
    var lines = (text || "").split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error("Plak de hele sheet inclusief de kopregel.");
    function cells(l) { return l.indexOf("\t") !== -1 ? l.split("\t") : l.split(/ {2,}|;|,/); }
    var head = cells(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    function col(test) { for (var i = 0; i < head.length; i++) if (test(head[i])) return i; return -1; }
    var iBez = col(function (h) { return h === "bezorger"; });
    var iType = col(function (h) { return h.indexOf("bustype") !== -1; });
    var iBus = col(function (h) { return h === "bus"; });
    var iKent = col(function (h) { return h.indexOf("kenteken") !== -1; });
    var iTrip = col(function (h) { return h.indexOf("trip") !== -1; });
    var iVolg = col(function (h) { return h.indexOf("volg") !== -1; });
    var iVertrek = col(function (h) { return h.indexOf("vertrek") !== -1; });
    var iMoeil = col(function (h) { return h.indexOf("moeil") !== -1; });
    // alle "opmerking"-kolommen (Opmerking Hub én Opmerking) verzamelen
    var iOpm = []; for (var hi = 0; hi < head.length; hi++) if (head[hi].indexOf("opmerking") !== -1) iOpm.push(hi);

    var schade = getSchade(hubId, datum, dagdeel);
    var lc = getLC(hubId, datum, dagdeel);
    var n = 0;
    for (var r = 1; r < lines.length; r++) {
      var c = cells(lines[r]).map(function (x) { return (x || "").trim(); });
      var bus = iBus > -1 ? (c[iBus] || "") : "";
      var kent = iKent > -1 ? c[iKent] : "";
      var naam = iBez > -1 ? c[iBez] : "";
      var type = iType > -1 ? c[iType] : "";
      var rit = iTrip > -1 ? c[iTrip] : "";
      var vertrek = iVertrek > -1 ? c[iVertrek] : "";
      var volg = iVolg > -1 ? parseInt(c[iVolg], 10) : 0; if (!volg) volg = r;
      // N2/ZE uit bustype (codes als VAN_VOLKSWAGEN_ZE / E_VAN_RENAULT_N2) + opmerking(en) + moeilijkheid (los woord)
      var opmText = ""; iOpm.forEach(function (j) { opmText += " " + (c[j] || ""); }); if (iMoeil > -1) opmText += " " + (c[iMoeil] || "");
      function tokHas(str, w) { return new RegExp("(^|[^a-z0-9])" + w + "([^a-z0-9]|$)", "i").test(str); }
      var n2 = /n2/i.test(type) || tokHas(opmText, "n2");
      var ze = /ze/i.test(type) || tokHas(opmText, "ze");
      if (!bus && !rit) continue; // lege regel
      // schade alleen voor regels met een echte bus
      if (bus && doSchade) schade.buses.push(newBus(naam, bus, kent));
      // lc-vak — ritnummer is altijd aan het vaknummer gekoppeld, ook zonder bus
      if (doLaden) {
        while (lc.vakken.length < volg) lc.vakken.push(newVak(lc.vakken.length + 1));
        var vk = lc.vakken[volg - 1];
        if (vk) { vk.bus = bus; vk.rit = rit; vk.vertrek = vertrek; vk.type = n2 ? "N2" : "diesel"; vk.ze = ze; }
      }
      n++;
    }
    if (doLaden) lc.aantal = lc.vakken.length;
    save();
    return n;
  }
  function lcStats(hubId, datum, dagdeel) {
    var v = getLC(hubId, datum, dagdeel).vakken.filter(function (x) { return x.bus || x.rit; });
    var done = v.filter(function (x) { return x.geladen; }).length;
    return { used: v.length, done: done, total: getLC(hubId, datum, dagdeel).vakken.length, pct: v.length ? Math.round(done / v.length * 100) : 0 };
  }

  /* ---------- Selectors ---------- */
  function shiftsForHub(hubId) { return db.shifts.filter(function (s) { return s.hubId === hubId; }); }
  function taskOffersForHub(hubId) { return db.taskOffers.filter(function (t) { return t.hubId === hubId; }); }
  function backupsForHub(hubId) { return db.backups.filter(function (b) { return b.hubId === hubId; }); }
  function calloutsForHub(hubId) { return db.callouts.filter(function (c) { return c.hubId === hubId; }); }
  function logsForHub(hubId) { return db.logs.filter(function (l) { return l.hubId === hubId; }); }
  function usersForHub(hubId) { return db.users.filter(function (u) { return !u.hidden && u.hubId === hubId; }); }
  // Medewerkers die deze gebruiker mag beheren/zien in beheer
  function manageableUsers(u) {
    if (level(u) >= 5) return visibleUsers();        // locatie-manager/admin: alle hubs
    return usersForHub(u.hubId);                       // overig: eigen hub
  }

  function pendingForApprover(u) {
    var shifts = db.shifts.filter(function (s) { return s.hubId === u.hubId && s.status === "in-afwachting" && can.approveShift(u, s); });
    var tasks = can.approveTask(u) ? db.taskOffers.filter(function (t) { return t.hubId === u.hubId && t.status === "in-afwachting" && visibleTask(u, t.taak); }) : [];
    var backups = can.approveBackup(u) ? db.backups.filter(function (b) { return b.hubId === u.hubId && b.status === "in-afwachting"; }) : [];
    var callouts = can.approveBackup(u) ? db.callouts.filter(function (c) { return c.hubId === u.hubId && c.status === "in-afwachting"; }) : [];
    return { shifts: shifts, tasks: tasks, backups: backups, callouts: callouts };
  }
  function pendingCount(u) { if (!u) return 0; var p = pendingForApprover(u); return p.shifts.length + p.tasks.length + p.backups.length + p.callouts.length; }

  /* ---------- Export ---------- */
  window.Store = {
    KEY: KEY, ROLES: ROLES, EMAIL_RE: EMAIL_RE, WINDOW: WINDOW, REASONS: REASONS,
    TASK_BINNENDIENST: TASK_BINNENDIENST, TASK_JBT: TASK_JBT,
    boot: boot, refresh: refresh, save: save, resetDemo: resetDemo,
    get db() { return db; }, get clientId() { return clientId; }, get serverVersion() { return serverVersion; },
    userById: userById, userByEmail: userByEmail, hubById: hubById, roleMeta: roleMeta, level: level, isAdmin: isAdmin, currentUser: currentUser,
    can: can, canDoTask: canDoTask, visibleTask: visibleTask, availableTasks: availableTasks,
    taskType: taskType, assignableTasks: assignableTasks, setTaskType: setTaskType,
    login: login, logout: logout, setInitialPassword: setInitialPassword, changeOwnPassword: changeOwnPassword,
    createUserByLeader: createUserByLeader, regenerateOtp: regenerateOtp,
    offerShift: offerShift, editShift: editShift, withdrawShift: withdrawShift, claimShift: claimShift, decideShift: decideShift,
    offerTask: offerTask, withdrawTask: withdrawTask, claimTask: claimTask, decideTask: decideTask,
    offerBackup: offerBackup, withdrawBackup: withdrawBackup, claimBackup: claimBackup, decideBackup: decideBackup,
    offerCallout: offerCallout, withdrawCallout: withdrawCallout, claimCallout: claimCallout, decideCallout: decideCallout,
    setUserRole: setUserRole, setUserN2: setUserN2, setUserJbt: setUserJbt, setUserHub: setUserHub, toggleUserTask: toggleUserTask, removeUser: removeUser,
    addHub: addHub, removeHub: removeHub, addCatalogTask: addCatalogTask, removeCatalogTask: removeCatalogTask,
    planningFor: planningFor, planById: planById, setPlanCell: setPlanCell, addPlanRow: addPlanRow, removePlanRow: removePlanRow,
    reload: reload, DOCKS: DOCKS, EMB_TROLLEYS: EMB_TROLLEYS, EMB_VAKKEN: EMB_VAKKEN, VAK_NUMMERS: VAK_NUMMERS, VAK_SOORTEN: VAK_SOORTEN, vakSoortLabel: vakSoortLabel,
    isSunday: isSunday, dagdelenVoor: dagdelenVoor, isSetup: isSetup, canOpShift: canOpShift,
    getDiensten: getDiensten, setDienst: setDienst, importSheet: importSheet,
    getSchade: getSchade, schadeImportColumns: schadeImportColumns, schadeAddBus: schadeAddBus, schadeToggle: schadeToggle, schadeSetDock: schadeSetDock, schadeRemove: schadeRemove, schadeReset: schadeReset, schadeStats: schadeStats,
    setBusSteekproef: setBusSteekproef, steekproefDone: steekproefDone, steekproefStats: steekproefStats,
    getKwaliteit: getKwaliteit, vakSoort: vakSoort, setVakSoort: setVakSoort, emballageSet: emballageSet, emballageVakTotal: emballageVakTotal, clearEmbVak: clearEmbVak,
    getTrolley: getTrolley, addPendelPlan: addPendelPlan, removePendel: removePendel, pendelBump: pendelBump, trolleySetStock: trolleySetStock, trolleyBump: trolleyBump,
    getLC: getLC, lcSetAantal: lcSetAantal, lcSetupVak: lcSetupVak, lcSetBus: lcSetBus, lcToggleGeladen: lcToggleGeladen, lcImportColumns: lcImportColumns, lcReset: lcReset, lcStats: lcStats,
    shiftsForHub: shiftsForHub, taskOffersForHub: taskOffersForHub, backupsForHub: backupsForHub, calloutsForHub: calloutsForHub,
    logsForHub: logsForHub, usersForHub: usersForHub, manageableUsers: manageableUsers,
    pendingForApprover: pendingForApprover, pendingCount: pendingCount
  };
})();
