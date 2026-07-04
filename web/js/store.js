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

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      plannings: [], schade: {}, kwaliteit: {}, lc: {}, trolley: {}, trolleyStock: {}, diensten: {},
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
    seeBeheer:    function (u) { return level(u) >= 4; },   // personeelsbeheer = teamleider+ (senior niet)
    seeBussenbeheer: function (u) { return level(u) >= 3; }, // bussenbeheer = senior+ (senior mag hier wél bij)
    planning:     function (u) { return level(u) >= 3; },
    editTeam:     function (u) { return level(u) >= 4; },   // N2, taken, jbt, account toevoegen
    editRoles:    function (u) { return level(u) >= 5; },   // functie toewijzen = locatie-manager
    editHubs:     function (u) { return level(u) >= 5; },   // hubs = locatie-manager
    editCatalog:  function (u) { return level(u) >= 4; },   // takenlijst = teamleider+
    resetData:    function (u) { return isAdmin(u); },   // alle gegevens wissen = alleen beheerder
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
    var email = (data.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Vul een geldig e-mailadres in.");
    if (userByEmail(email)) throw new Error("Er bestaat al een account met dit e-mailadres.");
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
    if (!approve && !(reden || "").trim()) throw new Error("Geef verplicht een reden op bij afkeuren.");
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
    // Afgekeurd blijft "afgekeurd": de aanbieder kiest zelf of de shift terug op het bord komt (repostRequest) of niet (dropRequest).
    if (!approve) { s.overnemerId = null; s.fifoWarning = false; }
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
    // Back-up alleen voor de eerstvolgende dienst: morgenvroeg (AM) of vandaagmiddag (PM).
    var _d = new Date(); _d.setDate(_d.getDate() + 1);
    var tomStr = _d.getFullYear() + "-" + ("0" + (_d.getMonth() + 1)).slice(-2) + "-" + ("0" + _d.getDate()).slice(-2);
    var okAM = data.dagdeel === "AM" && data.datum === tomStr;
    var okPM = data.dagdeel === "PM" && data.datum === todayYmd();
    if (!okAM && !okPM) throw new Error("Back-up kan alleen voor morgenvroeg (AM) of vandaagmiddag (PM) aangevraagd worden.");
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
    if (!approve && !(reden || "").trim()) throw new Error("Geef verplicht een reden op bij afkeuren.");
    b.status = approve ? "goedgekeurd" : "afgekeurd";
    b.besluitDoorId = u.id; b.besluitOp = now(); b.reden = reden || "";
    addLog({
      type: "backup", actie: approve ? "goedgekeurd" : "afgekeurd", refId: b.id,
      doorId: u.id, aanbiederId: b.aanbiederId, overnemerId: b.overnemerId, hubId: b.hubId,
      details: { datum: b.datum, dagdeel: b.dagdeel, direction: b.direction, taak: b.ritOmschrijving }, reden: reden || ""
    });
    if (!approve) { b.overnemerId = null; }
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
    if (!approve && !(reden || "").trim()) throw new Error("Geef verplicht een reden op bij afkeuren.");
    c.status = approve ? "goedgekeurd" : "afgekeurd";
    c.besluitDoorId = u.id; c.besluitOp = now(); c.reden = reden || "";
    addLog({
      type: "oproep", actie: approve ? "goedgekeurd" : "afgekeurd", refId: c.id,
      doorId: u.id, aanbiederId: c.aanbiederId, overnemerId: c.overnemerId, hubId: c.hubId,
      details: { datum: c.datum, dagdeel: c.dagdeel }, reden: reden || ""
    });
    if (!approve) { c.overnemerId = null; }
    save(); return c;
  }

  /* ---------- Afgekeurd: aanbieder kiest terug-op-bord of niet ---------- */
  function _reqList(kind) { return kind === "shift" ? db.shifts : kind === "callout" ? db.callouts : kind === "backup" ? db.backups : db.taskOffers; }
  function repostRequest(kind, id) {
    var u = currentUser(); var x = _reqList(kind).filter(function (o) { return o.id === id; })[0];
    if (!x || x.aanbiederId !== u.id) throw new Error("Dit is niet jouw verzoek.");
    if (x.status !== "afgekeurd") throw new Error("Alleen een afgekeurd verzoek kan terug op het bord.");
    x.status = "open"; x.overnemerId = null; x.besluitDoorId = null; x.besluitOp = null; x.reden = "";
    if (kind === "shift") { x.fifoWarning = false; x.fifoSkippedBy = ""; x.fifoSkippedAt = null; x.seq = nextSeq(); }
    save(); return x;
  }
  function dropRequest(kind, id) {
    var u = currentUser(); var x = _reqList(kind).filter(function (o) { return o.id === id; })[0];
    if (!x || x.aanbiederId !== u.id) throw new Error("Dit is niet jouw verzoek.");
    if (x.status !== "afgekeurd") throw new Error("Alleen een afgekeurd verzoek kan verwijderd worden.");
    x.status = "ingetrokken"; save(); return x;
  }
  // Match: de aanbieder geeft zijn open shift direct aan een collega die een oproep (shift gezocht) heeft geplaatst.
  function giveShiftTo(shiftId, targetUserId) {
    var u = currentUser();
    var s = db.shifts.filter(function (x) { return x.id === shiftId; })[0];
    if (!s || s.aanbiederId !== u.id) throw new Error("Dit is niet jouw shift.");
    if (s.status !== "open") throw new Error("Deze shift staat niet meer open.");
    var t = userById(targetUserId);
    if (!t) throw new Error("Collega niet gevonden.");
    if (!can.claimShift(t, s)) throw new Error("Deze collega kan deze shift niet overnemen.");
    s.overnemerId = targetUserId; s.status = "in-afwachting"; s.fifoWarning = false;
    // De bijbehorende oproep van die collega sluiten
    db.callouts.forEach(function (c) { if (c.aanbiederId === targetUserId && c.status === "open" && c.datum === s.datum && c.dagdeel === s.dagdeel) c.status = "ingetrokken"; });
    save(); return s;
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
  function todayYmd() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function isFutureDay(datum) { return datum > todayYmd(); }
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
  function canOpShift(u, hubId, datum, dagdeel, moduleKey) {
    if (isAdmin(u) || level(u) >= 4) return true;
    var d = getDiensten(hubId, datum, dagdeel)[moduleKey] || [];
    return d.indexOf(u.id) !== -1; // alleen uitvoerrecht via expliciete dienst-toewijzing (dashboard), niet via de taak in personeelsbeheer
  }
  // Tijdvensters per taak: PM begint op onderstaand tijdstip; ervoor is het AM.
  var PM_START = { lc: 13 * 60, pc: 13 * 60, kwaliteit: 16 * 60, schadecontrole: 16 * 60 };
  // Welke shift bij het (opnieuw) openen standaard actief is, op basis van de klok.
  function defaultDagdeelFor(moduleKey) {
    var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    var s = PM_START[moduleKey] != null ? PM_START[moduleKey] : 13 * 60;
    return m >= s ? "PM" : "AM";
  }
  // Mag de taakuitvoerder deze (datum, dagdeel) NU nog bewerken? Alleen vandaag én binnen het eigen tijdvenster.
  function withinShiftWindow(moduleKey, datum, dagdeel) {
    if (datum !== todayYmd()) return false;
    var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    var s = PM_START[moduleKey] != null ? PM_START[moduleKey] : 13 * 60;
    return dagdeel === "PM" ? m >= s : m < s;
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
  // Welke shift wordt door DEZE shift gecontroleerd? PM controleert de AM van dezelfde dag; AM de PM van de vorige dag.
  function vorigeShift(datum, dagdeel) {
    if (dagdeel === "PM") return { datum: datum, dagdeel: "AM" };
    var d = new Date(datum + "T00:00:00"); d.setDate(d.getDate() - 1);
    var pd = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    return { datum: pd, dagdeel: "PM" };
  }
  // Binnendienst controleert een steekproef tegen het Jumbo-systeem (aantal kratten).
  function steekproefControleer(hubId, datum, dagdeel, busId, data) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag steekproeven controleren.");
    var b = getSchade(hubId, datum, dagdeel).buses.filter(function (x) { return x.id === busId; })[0];
    if (!b || !b.steekproef) return;
    if (data.systeemKratten !== undefined) b.steekproef.systeemKratten = data.systeemKratten;
    if (data.controleGedaan !== undefined) { b.steekproef.controleGedaan = !!data.controleGedaan; b.steekproef.controleAt = data.controleGedaan ? now() : null; }
    save();
  }
  function steekproefControleStats(hubId, datum, dagdeel) {
    var list = getSchade(hubId, datum, dagdeel).buses.filter(steekproefDone);
    var done = list.filter(function (b) { return b.steekproef && b.steekproef.controleGedaan; }).length;
    return { total: list.length, done: done };
  }
  function newBus(naam, bus, kenteken) { return { id: uid("bus"), naam: (naam || "").trim(), bus: (bus || "").trim(), kenteken: (kenteken || "").trim(), dock: "", opmerking: "", gecontroleerd: false, mist_tolkrol: false, mist_kabels: false, mist_doekjes: false, steekproef: null }; }
  // Probleembus: er mist iets bij de schadecontrole (voor Bussenbeheer).
  function busHeeftProbleem(b) { return !!(b.mist_tolkrol || b.mist_kabels || b.mist_doekjes); }
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
    b[field] = !b[field];
    if (field === "gecontroleerd") b.gecontroleerdAt = b.gecontroleerd ? now() : null;
    save();
  }
  // Recentst gecontroleerde bussen (voor het dashboard).
  function recentGecontroleerdeBussen(hubId, datum, dagdeel) {
    return getSchade(hubId, datum, dagdeel).buses.filter(function (b) { return b.gecontroleerd && b.gecontroleerdAt; })
      .sort(function (a, b) { return b.gecontroleerdAt.localeCompare(a.gecontroleerdAt); }).slice(0, 3);
  }
  // Alle bussen met een ingevulde steekproef (voor het dashboard).
  function steekproevenList(hubId, datum, dagdeel) {
    return getSchade(hubId, datum, dagdeel).buses.filter(steekproefDone);
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
  // Opmerking bij een bus (binnendienst zet 'm klaar, de schadecontroleur ziet 'm).
  function schadeSetOpmerking(hubId, datum, dagdeel, busId, tekst) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag een opmerking plaatsen.");
    var b = getSchade(hubId, datum, dagdeel).buses.filter(function (x) { return x.id === busId; })[0]; if (!b) return;
    b.opmerking = (tekst || "").trim(); save();
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
  // Emballage-voorraad per (hub + vak): DOORLOPEND over alle dagen/shifts (AM/PM), blijft staan
  // tot de binnendienst het vak leeghaalt. Opgeslagen onder een gereserveerde kwaliteit-sleutel
  // `hub|__STOCK__|__STOCK__` zodat de bestaande kwaliteit-tabel het persisteert (geen serverwijziging).
  // Eenmalige migratie: overnemen van de meest recente per-shift emballage-telling van deze hub.
  var EMB_STOCK = "__STOCK__";
  function embStockHub(hubId) {
    if (!db.kwaliteit) db.kwaliteit = {};
    var sk = hubId + "|" + EMB_STOCK + "|" + EMB_STOCK;
    if (!db.kwaliteit[sk]) {
      var ent = { emballage: {}, soort: {} };
      var best = null, bestOrd = "";
      Object.keys(db.kwaliteit).forEach(function (kk) {
        var p = kk.split("|"); if (p[0] !== hubId || p[1] === EMB_STOCK || (p[2] && p[2].indexOf("PC-") === 0)) return;
        var e = db.kwaliteit[kk] && db.kwaliteit[kk].emballage;
        if (!e || !Object.keys(e).length || e.rows) return;
        var ord = p[1] + (p[2] === "AM" ? "0" : "1");
        if (ord > bestOrd) { bestOrd = ord; best = e; }
      });
      if (best) ent.emballage = JSON.parse(JSON.stringify(best));
      db.kwaliteit[sk] = ent;
    }
    return db.kwaliteit[sk].emballage;
  }
  function embVakArr(hubId, vak) {
    var h = embStockHub(hubId);
    if (!h[vak]) { h[vak] = []; for (var i = 0; i < EMB_TROLLEYS; i++) h[vak].push(0); }
    return h[vak];
  }
  function emballageVakArr(hubId, vak) { return embStockHub(hubId)[vak] || []; }
  function emballageSet(hubId, datum, dagdeel, vak, idx, value) {
    if (!canOpShift(currentUser(), hubId, datum, dagdeel, "kwaliteit", "Kwaliteit")) throw new Error("Je bent deze shift niet aangewezen voor kwaliteit.");
    if (vakSoortOf(getKwaliteit(hubId, datum, dagdeel), vak) !== "emb5") throw new Error("Dit vak is niet ingesteld op emballage.");
    var arr = embVakArr(hubId, vak);
    arr[idx] = Math.max(0, parseInt(value, 10) || 0); save();
  }
  function emballageVakTotal(hubId, datum, dagdeel, vak) {
    return (embStockHub(hubId)[vak] || []).reduce(function (a, b) { return a + (b || 0); }, 0);
  }
  // Binnendienst kan een emballagevak leeghalen (staat los van de trolley-telling).
  function clearEmbVak(hubId, datum, dagdeel, vak) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag een vak leeghalen.");
    delete embStockHub(hubId)[vak]; save();
  }

  /* ----- Pendelcontrol: tellijst per shift -----
     Bewaard in de kwaliteit-tabel onder sleutel `hub|datum|PC-<dagdeel>` (in de emballage-JSONB als
     { rows: [...] }), zodat de bestaande tabel het persisteert zonder serverwijziging. */
  function pcCanEdit(u, hubId, datum, dagdeel) { return canOpShift(u, hubId, datum, dagdeel, "lc") || isSetup(u); }
  function pcStore(hubId, datum, dagdeel) {
    if (!db.kwaliteit) db.kwaliteit = {};
    var k = hubId + "|" + datum + "|PC-" + dagdeel;
    if (!db.kwaliteit[k] || !db.kwaliteit[k].emballage || !db.kwaliteit[k].emballage.rows) db.kwaliteit[k] = { emballage: { rows: [] }, soort: {} };
    return db.kwaliteit[k].emballage;
  }
  function getPCRows(hubId, datum, dagdeel) { return pcStore(hubId, datum, dagdeel).rows; }
  function num(x) { var v = parseInt(String(x == null ? "" : x).replace(/[^0-9-]/g, ""), 10); return isNaN(v) ? 0 : Math.max(0, v); }
  function pcImport(hubId, datum, dagdeel, text) {
    if (!pcCanEdit(currentUser(), hubId, datum, dagdeel)) throw new Error("Je bent deze shift niet aangewezen voor het laadproces.");
    var lines = (text || "").split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim(); });
    if (!lines.length) throw new Error("Plak de tellijst.");
    function cells(l) { return l.indexOf("\t") !== -1 ? l.split("\t") : l.trim().split(/ {2,}|;|,/); }
    var start = 0, h0 = lines[0].toLowerCase();
    if (h0.indexOf("subrit") !== -1 || h0.indexOf("trolley") !== -1) start = 1; // kopregel overslaan
    var rows = [];
    for (var i = start; i < lines.length; i++) {
      var c = cells(lines[i]).map(function (x) { return (x || "").trim(); });
      if (!c.length || !c.join("")) continue;
      rows.push({ subrit: c[0] || String(rows.length + 1), trolleys: num(c[1]), kratten: num(c[2]), versb: num(c[3]), dvboxen: num(c[4]), xl: num(c[5]), gecontroleerd: false, gecontroleerdAt: null, l4: 0, l5: 0 });
    }
    pcStore(hubId, datum, dagdeel).rows = rows; save(); return rows.length;
  }
  function pcToggle(hubId, datum, dagdeel, idx) {
    if (!pcCanEdit(currentUser(), hubId, datum, dagdeel)) throw new Error("Je bent deze shift niet aangewezen voor het laadproces.");
    var r = getPCRows(hubId, datum, dagdeel)[idx]; if (!r) return;
    r.gecontroleerd = !r.gecontroleerd; r.gecontroleerdAt = r.gecontroleerd ? now() : null; save();
  }
  function pcSetLayer(hubId, datum, dagdeel, idx, field, delta) {
    if (!pcCanEdit(currentUser(), hubId, datum, dagdeel)) throw new Error("Je bent deze shift niet aangewezen voor het laadproces.");
    if (field !== "l4" && field !== "l5") return;
    var r = getPCRows(hubId, datum, dagdeel)[idx]; if (!r) return;
    var other = field === "l4" ? (r.l5 || 0) : (r.l4 || 0);
    var nv = Math.max(0, (r[field] || 0) + (parseInt(delta, 10) || 0));
    if (nv + other > (r.trolleys || 0)) nv = Math.max(0, (r.trolleys || 0) - other); // 4- + 5-laags samen ≤ trolleys
    r[field] = nv; save();
  }
  function pcReset(hubId, datum, dagdeel) {
    if (!pcCanEdit(currentUser(), hubId, datum, dagdeel)) throw new Error("Geen rechten.");
    pcStore(hubId, datum, dagdeel).rows = []; save();
  }
  function pcStats(hubId, datum, dagdeel) {
    var rows = getPCRows(hubId, datum, dagdeel);
    var done = rows.filter(function (r) { return r.gecontroleerd; }).length;
    var tot = { trolleys: 0, kratten: 0, versb: 0, dvboxen: 0, xl: 0, l4: 0, l5: 0 };
    rows.forEach(function (r) { tot.trolleys += r.trolleys || 0; tot.kratten += r.kratten || 0; tot.versb += r.versb || 0; tot.dvboxen += r.dvboxen || 0; tot.xl += r.xl || 0; tot.l4 += r.l4 || 0; tot.l5 += r.l5 || 0; });
    return { total: rows.length, done: done, pct: rows.length ? Math.round(done / rows.length * 100) : 0, tot: tot };
  }

  /* ----- Trolley-voorraad: ÉÉN doorlopende voorraad per hub (loopt door tussen dagdelen én dagen) ----- */
  // Migratie: als er nog geen doorlopende voorraad is, overnemen van de meest recente per-shift telling.
  function latestShiftStock(hubId) {
    if (!db.trolley) return null;
    var best = null, bestOrd = "";
    Object.keys(db.trolley).forEach(function (kk) {
      var p = kk.split("|"); if (p[0] !== hubId) return;
      var o = p[1] + (p[2] === "AM" ? "0" : "1");
      if (o > bestOrd && db.trolley[kk] && (db.trolley[kk].stock4 != null || db.trolley[kk].stock5 != null)) { bestOrd = o; best = db.trolley[kk]; }
    });
    return best;
  }
  // Een dag "telt mee" voor de overdracht zodra er echt op geteld is (counted). Bestaande dagen
  // van vóór deze fix hebben geen vlag (counted === undefined) en gelden als geteld (behoud).
  // Een dag telt alleen als "geteld" als het NIET in de toekomst ligt én expliciet geteld is.
  // Toekomstige dagen zijn per definitie nooit geteld → ze tonen altijd de live overdracht
  // (zelfhelend: oude bevroren toekomstdagen verdwijnen vanzelf).
  function isCountedDay(e, datum) { if (isFutureDay(datum)) return false; return !!e && e.counted !== false; }
  // Voorraad van de meest recente eerdere GETELDE dag voor deze hub (voor de dag-overdracht).
  function prevDayStock(hubId, datum) {
    if (!db.trolleyStock) return null;
    var best = null, bestDatum = "";
    Object.keys(db.trolleyStock).forEach(function (kk) {
      var p = kk.split("|"); if (p[0] !== hubId) return;
      if (!isCountedDay(db.trolleyStock[kk], p[1])) return; // niet-getelde/toekomstige dagen dragen niet over
      if (p[1] < datum && p[1] > bestDatum) { bestDatum = p[1]; best = db.trolleyStock[kk]; }
    });
    return best;
  }
  // Voorraad per (hub + dag): AM en PM delen dezelfde dagtelling; elke dag is een momentopname met historie.
  // Een dag die nog niet geteld is, toont LIVE de overdracht van de meest recente getelde eerdere dag
  // (wordt telkens herberekend, niet bevroren) — zodat een latere telling van gisteren doorwerkt naar vandaag.
  function getTrolleyStock(hubId, datum) {
    if (!db.trolleyStock) db.trolleyStock = {};
    var k = hubId + "|" + datum;
    var e = db.trolleyStock[k];
    if (isCountedDay(e, datum)) return e; // deze dag is (niet-toekomstig én) expliciet geteld → eigen momentopname
    var prev = prevDayStock(hubId, datum) || latestShiftStock(hubId); // overdracht vorige getelde dag, anders migratie
    db.trolleyStock[k] = { stock4: prev ? (prev.stock4 || 0) : 0, stock5: prev ? (prev.stock5 || 0) : 0, counted: false };
    return db.trolleyStock[k];
  }
  // Markeer de dag als daadwerkelijk geteld (eigen momentopname vanaf nu).
  function markCounted(hubId, datum) { var s = getTrolleyStock(hubId, datum); s.counted = true; return s; }
  // Pendels blijven per shift; stock4/stock5 komen uit de dagtelling van de hub.
  function getTrolley(hubId, datum, dagdeel) {
    if (!db.trolley) db.trolley = {};
    var k = opKey(hubId, datum, dagdeel);
    if (!db.trolley[k]) db.trolley[k] = { pendels: [] };
    if (!db.trolley[k].pendels) db.trolley[k].pendels = [];
    var s = getTrolleyStock(hubId, datum);
    db.trolley[k].stock4 = s.stock4; db.trolley[k].stock5 = s.stock5; // spiegel voor bestaande UI
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
  // Verwachte aankomsttijden importeren (blok-formaat per pendel: tijd / aantallen / Venstertijd / ritnr / herkomst / afwijking).
  // Pendels vóór 13:00 → AM-shift, vanaf 13:00 → PM-shift van diezelfde dag. Vervangt de pendelplanning van de dag.
  function pendelImport(hubId, datum, text) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag pendels importeren.");
    var lines = (text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l; });
    if (!lines.length) throw new Error("Plak de pendellijst.");
    var isTime = function (l) { return /^\d{1,2}:\d{2}$/.test(l); };
    var blocks = [], cur = null;
    lines.forEach(function (l) {
      if (isTime(l)) { if (cur) blocks.push(cur); cur = { tijd: l, nums: [], rit: "", herkomst: "", venster: "", afwijking: "" }; return; }
      if (!cur) return; // regels vóór de eerste tijd negeren
      if (/^venstertijd/i.test(l)) { cur.venster = l.replace(/^venstertijd:?\s*/i, "").trim(); return; }
      if (/^[+-]\d+$/.test(l)) { cur.afwijking = l; return; }
      if (/^\d+$/.test(l)) { cur.nums.push(parseInt(l, 10)); return; }
      if (/^[A-Za-z]?\d{5,}$/.test(l.replace(/\s+/g, "")) && !cur.rit) { cur.rit = l; return; }
      cur.herkomst = cur.herkomst ? cur.herkomst + " " + l : l;
    });
    if (cur) blocks.push(cur);
    if (!blocks.length) throw new Error("Geen pendels herkend — controleer het formaat (begin elke pendel met de aankomsttijd, bv. 05:15).");
    var am = [], pm = [];
    blocks.forEach(function (b) {
      var pen = { id: uid("pen"), tijd: b.tijd, in4: 0, out4: 0, in5: 0, out5: 0,
        rit: b.rit, herkomst: b.herkomst, venster: b.venster, afwijking: b.afwijking,
        trolleysVerwacht: b.nums.length ? b.nums[0] : 0 };
      (toMin(b.tijd) >= 13 * 60 ? pm : am).push(pen);
    });
    getTrolley(hubId, datum, "AM").pendels = am;
    getTrolley(hubId, datum, "PM").pendels = pm;
    save();
    return { am: am.length, pm: pm.length, total: am.length + pm.length };
  }
  // Recentste pendels (voor het dashboard) — laatst toegevoegd eerst.
  function recentPendels(hubId, datum, dagdeel) {
    return getTrolley(hubId, datum, dagdeel).pendels.slice(-3).reverse();
  }
  // Volgende pendels (voor het dashboard): die vanaf de huidige tijd aankomen, oplopend op aankomsttijd.
  function komendePendels(hubId, datum, dagdeel) {
    var d = new Date(), nowMin = d.getHours() * 60 + d.getMinutes();
    return getTrolley(hubId, datum, dagdeel).pendels
      .filter(function (p) { var m = toMin(p.tijd); return m != null && m >= nowMin; })
      .sort(function (a, b) { return toMin(a.tijd) - toMin(b.tijd); })
      .slice(0, 3);
  }
  // LC verwerkt de trolley-veranderingen per pendel met +/- (past de doorlopende voorraad aan).
  function pendelBump(hubId, datum, dagdeel, id, field, delta) {
    if (!canOpShift(currentUser(), hubId, datum, dagdeel, "lc", "LC")) throw new Error("Je bent deze shift niet aangewezen als LC.");
    if (["in4", "out4", "in5", "out5"].indexOf(field) === -1) return;
    var t = getTrolley(hubId, datum, dagdeel); var p = t.pendels.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var nv = Math.max(0, (p[field] || 0) + (parseInt(delta, 10) || 0)); var applied = nv - (p[field] || 0); p[field] = nv;
    var lay = (field === "in4" || field === "out4") ? "stock4" : "stock5";
    var sign = (field === "in4" || field === "in5") ? 1 : -1;
    var s = markCounted(hubId, datum); s[lay] = Math.max(0, (s[lay] || 0) + sign * applied);
    save();
  }
  function trolleySetStock(hubId, datum, dagdeel, field, value) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag corrigeren.");
    if (isFutureDay(datum)) throw new Error("Je kunt trolleys niet vooruit tellen — alleen op de dag zelf.");
    if (field !== "stock4" && field !== "stock5") return;
    var s = markCounted(hubId, datum); s[field] = Math.max(0, parseInt(value, 10) || 0); save();
  }
  // Trolley-voorraad corrigeren met +/- — alleen binnendienst (senior+). Past de doorlopende hub-voorraad aan.
  function trolleyBump(hubId, datum, dagdeel, field, delta) {
    if (!isSetup(currentUser())) throw new Error("Alleen binnendienst (senior+) mag de voorraad aanpassen.");
    if (isFutureDay(datum)) throw new Error("Je kunt trolleys niet vooruit tellen — alleen op de dag zelf.");
    if (field !== "stock4" && field !== "stock5") return;
    var s = markCounted(hubId, datum); s[field] = Math.max(0, (s[field] || 0) + (parseInt(delta, 10) || 0)); save();
  }

  /* ----- Kwaliteit telt de trolleys (aparte controle-telling, past de voorraad NIET aan) -----
     Kwaliteit ziet de systeemvoorraad alleen-lezen en telt er zelf onder; een afwijking meldt de senior. */
  function qtelGet(hubId, datum, dagdeel) {
    var t = getTrolley(hubId, datum, dagdeel);
    if (!t.qtel) t.qtel = { c4: 0, c5: 0, at: null };
    return t.qtel;
  }
  function qtelBump(hubId, datum, dagdeel, field, delta) {
    if (!(canOpShift(currentUser(), hubId, datum, dagdeel, "kwaliteit", "Kwaliteit") || isSetup(currentUser()))) throw new Error("Je bent deze shift niet aangewezen voor kwaliteit.");
    if (isFutureDay(datum)) throw new Error("Je kunt trolleys niet vooruit tellen — alleen op de dag zelf.");
    if (field !== "c4" && field !== "c5") return;
    var q = qtelGet(hubId, datum, dagdeel);
    q[field] = Math.max(0, (q[field] || 0) + (parseInt(delta, 10) || 0));
    q.at = now(); save();
  }
  function qtelReset(hubId, datum, dagdeel) {
    if (!(canOpShift(currentUser(), hubId, datum, dagdeel, "kwaliteit", "Kwaliteit") || isSetup(currentUser()))) throw new Error("Geen rechten.");
    var q = qtelGet(hubId, datum, dagdeel); q.c4 = 0; q.c5 = 0; q.at = null; save();
  }
  // Afwijking tussen de Kwaliteit-telling en de systeemvoorraad (voor de dashboard-melding aan de senior).
  function qtelAfwijking(hubId, datum, dagdeel) {
    var t = getTrolley(hubId, datum, dagdeel);
    var q = t.qtel || { c4: 0, c5: 0, at: null };
    var d4 = (q.c4 || 0) - (t.stock4 || 0), d5 = (q.c5 || 0) - (t.stock5 || 0);
    return { counted: !!q.at, c4: q.c4 || 0, c5: q.c5 || 0, d4: d4, d5: d5, has: !!q.at && (d4 !== 0 || d5 !== 0) };
  }

  /* ----- LC (laden) ----- */
  function getLC(hubId, datum, dagdeel) { if (!db.lc) db.lc = {}; var k = opKey(hubId, datum, dagdeel); if (!db.lc[k]) db.lc[k] = { vakken: [], aantal: 0 }; return db.lc[k]; }
  function newVak(nr) { return { nr: nr, vertrek: "", bus: "", rit: "", ze: false, type: "diesel", jbt: false, geladen: false }; }
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
    if (vk.jbt || vk.type === "N2") return; // JBT/N2 hoeven niet geladen te worden
    vk.geladen = !vk.geladen;
    vk.geladenAt = vk.geladen ? now() : null;
    save();
  }
  // Recentst geladen bussen (voor het dashboard).
  function recentGeladenBussen(hubId, datum, dagdeel) {
    return getLC(hubId, datum, dagdeel).vakken.filter(function (v) { return v.geladen && v.geladenAt; })
      .sort(function (a, b) { return b.geladenAt.localeCompare(a.geladenAt); }).slice(0, 3);
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
      var jbt = tokHas(opmText, "jbt"); // "JBT" in de opmerking(en) → hoeft niet geladen te worden
      if (!bus && !rit) continue; // lege regel
      // schade alleen voor regels met een echte bus
      if (bus && doSchade) schade.buses.push(newBus(naam, bus, kent));
      // lc-vak — ritnummer is altijd aan het vaknummer gekoppeld, ook zonder bus
      if (doLaden) {
        while (lc.vakken.length < volg) lc.vakken.push(newVak(lc.vakken.length + 1));
        var vk = lc.vakken[volg - 1];
        if (vk) { vk.bus = bus; vk.rit = rit; vk.vertrek = vertrek; vk.type = n2 ? "N2" : "diesel"; vk.ze = ze; vk.jbt = jbt; }
      }
      n++;
    }
    if (doLaden) lc.aantal = lc.vakken.length;
    save();
    return n;
  }
  function lcStats(hubId, datum, dagdeel) {
    // JBT- en N2-vakken hoeven niet geladen te worden → niet meetellen in de voortgang
    var v = getLC(hubId, datum, dagdeel).vakken.filter(function (x) { return (x.bus || x.rit) && !(x.jbt || x.type === "N2"); });
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
    repostRequest: repostRequest, dropRequest: dropRequest, giveShiftTo: giveShiftTo,
    setUserRole: setUserRole, setUserN2: setUserN2, setUserJbt: setUserJbt, setUserHub: setUserHub, toggleUserTask: toggleUserTask, removeUser: removeUser,
    addHub: addHub, removeHub: removeHub, addCatalogTask: addCatalogTask, removeCatalogTask: removeCatalogTask,
    planningFor: planningFor, planById: planById, setPlanCell: setPlanCell, addPlanRow: addPlanRow, removePlanRow: removePlanRow,
    reload: reload, DOCKS: DOCKS, EMB_TROLLEYS: EMB_TROLLEYS, EMB_VAKKEN: EMB_VAKKEN, VAK_NUMMERS: VAK_NUMMERS, VAK_SOORTEN: VAK_SOORTEN, vakSoortLabel: vakSoortLabel,
    isSunday: isSunday, dagdelenVoor: dagdelenVoor, isFutureDay: isFutureDay, todayYmd: todayYmd, isSetup: isSetup, canOpShift: canOpShift,
    defaultDagdeelFor: defaultDagdeelFor, withinShiftWindow: withinShiftWindow,
    getDiensten: getDiensten, setDienst: setDienst, importSheet: importSheet,
    getSchade: getSchade, schadeImportColumns: schadeImportColumns, schadeAddBus: schadeAddBus, schadeToggle: schadeToggle, schadeSetDock: schadeSetDock, schadeSetOpmerking: schadeSetOpmerking, schadeRemove: schadeRemove, schadeReset: schadeReset, schadeStats: schadeStats,
    setBusSteekproef: setBusSteekproef, steekproefDone: steekproefDone, steekproefStats: steekproefStats, steekproevenList: steekproevenList, recentGecontroleerdeBussen: recentGecontroleerdeBussen, busHeeftProbleem: busHeeftProbleem,
    vorigeShift: vorigeShift, steekproefControleer: steekproefControleer, steekproefControleStats: steekproefControleStats,
    getKwaliteit: getKwaliteit, vakSoort: vakSoort, setVakSoort: setVakSoort, emballageSet: emballageSet, emballageVakTotal: emballageVakTotal, emballageVakArr: emballageVakArr, clearEmbVak: clearEmbVak,
    getTrolley: getTrolley, addPendelPlan: addPendelPlan, removePendel: removePendel, pendelImport: pendelImport, pendelBump: pendelBump, trolleySetStock: trolleySetStock, trolleyBump: trolleyBump, recentPendels: recentPendels, komendePendels: komendePendels,
    qtelGet: qtelGet, qtelBump: qtelBump, qtelReset: qtelReset, qtelAfwijking: qtelAfwijking,
    getLC: getLC, lcSetAantal: lcSetAantal, lcSetupVak: lcSetupVak, lcSetBus: lcSetBus, lcToggleGeladen: lcToggleGeladen, lcImportColumns: lcImportColumns, lcReset: lcReset, lcStats: lcStats, recentGeladenBussen: recentGeladenBussen,
    getPCRows: getPCRows, pcImport: pcImport, pcToggle: pcToggle, pcSetLayer: pcSetLayer, pcReset: pcReset, pcStats: pcStats, pcCanEdit: pcCanEdit,
    shiftsForHub: shiftsForHub, taskOffersForHub: taskOffersForHub, backupsForHub: backupsForHub, calloutsForHub: calloutsForHub,
    logsForHub: logsForHub, usersForHub: usersForHub, manageableUsers: manageableUsers,
    pendingForApprover: pendingForApprover, pendingCount: pendingCount
  };
})();
