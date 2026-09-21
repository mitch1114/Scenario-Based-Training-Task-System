/* ============================================================
   Dublin PD — Scenario-Based Training Task System
   Single-page app. Data is stored on the device (localStorage)
   and can optionally sync to a shared Supabase backend
   (js/sync.js) for multi-device use and live trainer voting.
   ============================================================ */

(function () {
  "use strict";

  var STORE_KEY = "sbt-task-system-v1";
  var DB_VERSION = 3;

  /* ---------- flat line index ---------- */
  var ALL_LINES = [];
  var LINE_BY_ID = {};
  var CAT_BY_ID = {};
  CHECKLIST.forEach(function (cat) {
    CAT_BY_ID[cat.id] = cat;
    cat.lines.forEach(function (ln) {
      ln.catId = cat.id;
      ALL_LINES.push(ln);
      LINE_BY_ID[ln.id] = ln;
    });
  });

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function nowISO() {
    return new Date().toISOString();
  }
  /* stable id for library scenarios so every device generates the
     same id for the same default scenario (prevents duplicates
     when several phones sync to the shared backend) */
  function scenarioIdFor(name) {
    return "scn-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  /* ---------- persistence & migration ---------- */
  function freshDB() {
    return {
      version: DB_VERSION,
      settings: { threshold: 80, deviceTrainer: "", sync: { url: "", key: "" } },
      officers: [],
      scenarios: DEFAULT_SCENARIOS.map(function (s) {
        return { id: scenarioIdFor(s.name), name: s.name, cats: s.cats.slice(), updatedAt: nowISO() };
      }),
      days: [],
      libVersion: 2,
    };
  }

  function migrate(db) {
    if (!db || typeof db !== "object") return freshDB();
    if (!db.settings) db.settings = {};
    if (db.settings.threshold == null) db.settings.threshold = 80;
    if (db.settings.deviceTrainer == null) db.settings.deviceTrainer = "";
    if (!db.settings.sync) db.settings.sync = { url: "", key: "" };
    if (!db.officers) db.officers = [];
    if (!db.scenarios) db.scenarios = [];
    if (!db.days) db.days = [];

    db.scenarios.forEach(function (s) {
      if (!s.cats) s.cats = [];
      if (!s.updatedAt) s.updatedAt = nowISO();
    });

    /* library v2: swap the original placeholder scenarios for the
       real Dublin PD master list. Placeholders referenced by saved
       training days are kept so those records stay intact. */
    if ((db.libVersion || 1) < 2) {
      var usedIds = {};
      db.days.forEach(function (d) {
        (d.scenarioIds || []).forEach(function (id) { usedIds[id] = true; });
      });
      db.scenarios = db.scenarios.filter(function (s) {
        return RETIRED_PLACEHOLDER_SCENARIOS.indexOf(s.name) === -1 || usedIds[s.id];
      });
      var haveNames = {};
      db.scenarios.forEach(function (s) { haveNames[s.name.toLowerCase()] = true; });
      DEFAULT_SCENARIOS.forEach(function (ds) {
        if (!haveNames[ds.name.toLowerCase()]) {
          db.scenarios.push({
            id: scenarioIdFor(ds.name), name: ds.name,
            cats: ds.cats.slice(), updatedAt: nowISO(),
          });
        }
      });
      db.libVersion = 2;
    }

    db.days.forEach(function (d) {
      if (!d.updatedAt) d.updatedAt = d.createdAt || nowISO();
      if (!d.trainers) {
        // v1 had a free-text "observers" field — split it into trainer names
        d.trainers = (d.observers || "")
          .split(",")
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
        delete d.observers;
      }
      if (!d.dismissedRecs) d.dismissedRecs = {};
      if (d.officerId === undefined) d.officerId = null;
      if (!d.notes) d.notes = [];
      /* v3: notes are bullet points. Older narrative notes that
         contain line breaks are split into one bullet per line
         (ids stay deterministic so every synced device agrees). */
      if ((db.version || 1) < 3) {
        var split = [];
        d.notes.forEach(function (n) {
          var parts = splitBullets(n.text || "");
          if (parts.length <= 1) { split.push(n); return; }
          parts.forEach(function (t, i) {
            split.push({ id: n.id + "-" + i, scenarioId: n.scenarioId, text: t, ts: n.ts });
          });
        });
        d.notes = split;
      }
      Object.keys(d.lines || {}).forEach(function (id) {
        var ls = d.lines[id];
        if (!ls.votes) ls.votes = {};
        if (!ls.noteIds) ls.noteIds = [];
        // v1 anonymous tallies (vp/vf) can't be attributed — drop counters, keep result
        delete ls.vp;
        delete ls.vf;
      });
      // link day to an officer profile
      if (!d.officerId && d.officerName) {
        d.officerId = findOrCreateOfficerIn(db, d.officerName, d.badge).id;
      }
    });

    db.version = DB_VERSION;
    return db;
  }

  /* one bullet per non-empty line; leading "-", "•", "*" markers are stripped */
  function splitBullets(text) {
    return String(text || "").split(/\r?\n/).map(function (t) {
      return t.replace(/^\s*[-•*·]\s*/, "").trim();
    }).filter(Boolean);
  }

  function findOrCreateOfficerIn(db, name, badge) {
    var nm = (name || "").trim();
    var found = null;
    db.officers.forEach(function (o) {
      if (o.name.toLowerCase() === nm.toLowerCase()) found = o;
    });
    if (found) return found;
    var o = { id: uid(), name: nm, badge: badge || "", createdAt: nowISO(), updatedAt: nowISO() };
    db.officers.push(o);
    return o;
  }

  var DB;
  try {
    DB = migrate(JSON.parse(localStorage.getItem(STORE_KEY)));
  } catch (e) {
    DB = freshDB();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(DB));
    } catch (e) {
      toast("Warning: could not save (storage full?)");
    }
  }

  /* save + mark entity dirty for backend sync */
  function saveDay(day) {
    day.updatedAt = nowISO();
    save();
    if (window.SBTSync) SBTSync.dirty("day", day.id);
  }
  function saveOfficer(o) {
    o.updatedAt = nowISO();
    save();
    if (window.SBTSync) SBTSync.dirty("officer", o.id);
  }
  function saveScenario(s) {
    s.updatedAt = nowISO();
    save();
    if (window.SBTSync) SBTSync.dirty("scenario", s.id);
  }

  /* ---------- view state ---------- */
  var view = {
    screen: "home", // home | officers | profile | settings | day
    dayId: null,
    officerId: null,
    tab: "setup", // setup | notes | grade | results
    filter: "all", // all | suggested | ungraded
    voteMode: false,
    activeTrainer: "",
    openNotes: {}, // lineId -> line-note textarea revealed
    openPickers: {}, // lineId -> observation picker expanded
  };

  function currentDay() {
    for (var i = 0; i < DB.days.length; i++)
      if (DB.days[i].id === view.dayId) return DB.days[i];
    return null;
  }
  function officerById(id) {
    for (var i = 0; i < DB.officers.length; i++)
      if (DB.officers[i].id === id) return DB.officers[i];
    return null;
  }
  function scenarioById(id) {
    for (var i = 0; i < DB.scenarios.length; i++)
      if (DB.scenarios[i].id === id) return DB.scenarios[i];
    return null;
  }
  function scenarioName(id) {
    var s = scenarioById(id);
    return s ? s.name : "(deleted scenario)";
  }

  /* ---------- day model ---------- */
  function newDay() {
    var d = {
      id: uid(),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      date: new Date().toISOString().slice(0, 10),
      officerId: null,
      officerName: "",
      badge: "",
      trainers: [],
      scenarioIds: [],
      notes: [],
      lines: {},
      dismissedRecs: {},
      otherNotes: "",
      finalized: false,
    };
    DB.days.unshift(d);
    saveDay(d);
    return d;
  }

  function lineState(day, lineId) {
    if (!day.lines[lineId])
      day.lines[lineId] = { status: null, votes: {}, note: "", noteIds: [] };
    if (!day.lines[lineId].votes) day.lines[lineId].votes = {};
    if (!day.lines[lineId].noteIds) day.lines[lineId].noteIds = [];
    return day.lines[lineId];
  }

  /* recount pass/fail from attributed votes; majority sets status */
  function recountVotes(ls) {
    var p = 0, f = 0;
    Object.keys(ls.votes).forEach(function (t) {
      var v = ls.votes[t] && ls.votes[t].v;
      if (v === "pass") p++;
      else if (v === "fail") f++;
    });
    if (p + f > 0) ls.status = p > f ? "pass" : f > p ? "fail" : null;
    else if (ls.status === "pass" || ls.status === "fail") {
      // votes were the source and all were withdrawn
      ls.status = ls._manual ? ls.status : null;
    }
    return { p: p, f: f };
  }

  function voteTally(ls) {
    var p = 0, f = 0;
    if (ls && ls.votes)
      Object.keys(ls.votes).forEach(function (t) {
        var v = ls.votes[t] && ls.votes[t].v;
        if (v === "pass") p++;
        else if (v === "fail") f++;
      });
    return { p: p, f: f };
  }

  /* keep the day's officer profile linked & up to date */
  function syncOfficerProfile(day) {
    var nm = (day.officerName || "").trim();
    if (!nm) return;
    if (day.officerId) {
      var o = officerById(day.officerId);
      if (o) {
        if (o.name !== nm || o.badge !== day.badge) {
          o.name = nm;
          o.badge = day.badge;
          saveOfficer(o);
        }
        return;
      }
    }
    var prof = findOrCreateOfficerIn(DB, nm, day.badge);
    day.officerId = prof.id;
    saveOfficer(prof);
  }

  /* ---------- suggestions: note-bullet keyword matches ---------- */
  function noteById(day, id) {
    for (var i = 0; i < day.notes.length; i++)
      if (day.notes[i].id === id) return day.notes[i];
    return null;
  }

  /* every keyword hit: lineId -> [{note, kw}] (all bullets, unfiltered) */
  function computeRecs(day) {
    var recs = {};
    day.notes.forEach(function (note) {
      var text = " " + note.text.toLowerCase() + " ";
      ALL_LINES.forEach(function (ln) {
        for (var k = 0; k < ln.kw.length; k++) {
          if (text.indexOf(ln.kw[k].toLowerCase()) !== -1) {
            if (!recs[ln.id]) recs[ln.id] = [];
            recs[ln.id].push({ note: note, kw: ln.kw[k].trim() });
            break;
          }
        }
      });
    });
    return recs;
  }

  /* a recommendation can be dismissed per bullet or for the whole line */
  function recDismissed(day, lineId, noteId) {
    return !!(day.dismissedRecs[lineId] || day.dismissedRecs[lineId + "|" + noteId]);
  }

  /* recommended bullets still worth showing on a line: not dismissed,
     not already linked to it */
  function openRecs(day, lineId, recs) {
    var linked = (day.lines[lineId] && day.lines[lineId].noteIds) || [];
    return (recs[lineId] || []).filter(function (r) {
      return !recDismissed(day, lineId, r.note.id) && linked.indexOf(r.note.id) === -1;
    });
  }

  function linkedNotes(day, lineId) {
    var ids = (day.lines[lineId] && day.lines[lineId].noteIds) || [];
    return ids.map(function (id) { return noteById(day, id); }).filter(Boolean);
  }

  /* day notes grouped for display: [{scenarioId, label, notes:[...]}] */
  function notesByScenario(day) {
    var groups = [];
    day.scenarioIds.forEach(function (id, i) {
      groups.push({ scenarioId: id, label: (i + 1) + ". " + scenarioName(id), notes: [] });
    });
    var general = { scenarioId: null, label: "General (whole day)", notes: [] };
    var orphans = {}; // notes tagged to a scenario no longer on the day
    day.notes.forEach(function (n) {
      var g = null;
      for (var i = 0; i < groups.length; i++)
        if (groups[i].scenarioId === n.scenarioId) g = groups[i];
      if (!g && n.scenarioId) {
        if (!orphans[n.scenarioId]) {
          orphans[n.scenarioId] = { scenarioId: n.scenarioId, label: scenarioName(n.scenarioId) + " (removed from day)", notes: [] };
          groups.push(orphans[n.scenarioId]);
        }
        g = orphans[n.scenarioId];
      }
      (g || general).notes.push(n);
    });
    groups.push(general);
    return groups;
  }

  function recsForNoteText(text) {
    var t = " " + text.toLowerCase() + " ";
    var hits = [];
    ALL_LINES.forEach(function (ln) {
      for (var k = 0; k < ln.kw.length; k++) {
        if (t.indexOf(ln.kw[k].toLowerCase()) !== -1) {
          hits.push(ln);
          break;
        }
      }
    });
    return hits;
  }

  /* ---------- weighted scoring ---------- */
  function computeScore(day) {
    var earned = 0, possible = 0, passCount = 0, failCount = 0, noCount = 0,
      perCat = [], criticalFails = [];

    CHECKLIST.forEach(function (cat) {
      var cEarned = 0, cPossible = 0, cGraded = 0;
      cat.lines.forEach(function (ln) {
        var st = day.lines[ln.id] && day.lines[ln.id].status;
        if (st === "pass") {
          earned += ln.w; possible += ln.w;
          cEarned += ln.w; cPossible += ln.w;
          cGraded++; passCount++;
        } else if (st === "fail") {
          possible += ln.w; cPossible += ln.w;
          cGraded++; failCount++;
          if (ln.w >= CRITICAL_WEIGHT) criticalFails.push(ln);
        } else if (st === "no") {
          noCount++;
        }
      });
      perCat.push({
        cat: cat, earned: cEarned, possible: cPossible,
        graded: cGraded, total: cat.lines.length,
        pct: cPossible ? Math.round((cEarned / cPossible) * 100) : null,
      });
    });

    return {
      earned: earned, possible: possible,
      pct: possible ? Math.round((earned / possible) * 100) : null,
      perCat: perCat, criticalFails: criticalFails,
      passCount: passCount, failCount: failCount, noCount: noCount,
      gradedCount: passCount + failCount,
    };
  }

  function dayPassed(day, sc) {
    if (sc.pct === null) return null;
    return sc.pct >= DB.settings.threshold && sc.criticalFails.length === 0;
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtDate(iso) {
    if (!iso) return "No date";
    var p = iso.split("-");
    if (p.length !== 3) return iso;
    return p[1] + "/" + p[2] + "/" + p[0];
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }
  function initials(name) {
    return name.split(/\s+/).map(function (w) { return w.charAt(0); })
      .join("").toUpperCase().slice(0, 3);
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  var app = document.getElementById("app");

  function render() {
    if (view.screen === "home") renderHome();
    else if (view.screen === "officers") renderOfficers();
    else if (view.screen === "profile") renderProfile();
    else if (view.screen === "settings") renderSettings();
    else renderDay();
  }
  function rerenderKeepScroll() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function syncBadgeHtml() {
    if (!window.SBTSync || !SBTSync.isConfigured()) return "";
    var st = SBTSync.status();
    var cls = st.state === "connected" ? "on" : st.state === "error" ? "err" : "off";
    return '<span class="sync-dot ' + cls + '" title="' + esc(st.detail) + '"></span>';
  }

  /* ---------- HOME ---------- */
  function renderHome() {
    var html =
      '<div class="topbar">' +
      '<h1>Scenario-Based Training<span class="sub">Dublin Police Department ' +
      syncBadgeHtml() + "</span></h1>" +
      '<button class="icon-btn" data-action="go-officers">👤</button>' +
      '<button class="icon-btn" data-action="go-settings">⚙︎</button>' +
      "</div>" +
      '<div class="screen">' +
      '<button class="btn block" data-action="new-day">＋ New Training Day</button>' +
      '<h3 class="list-head">Training Days</h3>';

    if (!DB.days.length) {
      html += '<div class="card muted">No training days yet. Start one to grade a scenario day.</div>';
    } else {
      DB.days.forEach(function (d) {
        var sc = computeScore(d);
        var scoreHtml;
        if (sc.pct === null) scoreHtml = '<span class="score none">—</span>';
        else {
          var good = dayPassed(d, sc);
          scoreHtml = '<span class="score ' + (good ? "good" : "bad") + '">' + sc.pct + "%</span>";
        }
        html +=
          '<button class="day-item" data-action="open-day" data-id="' + d.id + '">' +
          scoreHtml +
          '<div class="title">' + esc(d.officerName || "Unnamed Officer") +
          (d.finalized ? ' <span class="badge pass">FINAL</span>' : "") + "</div>" +
          '<div class="meta">' + fmtDate(d.date) + " · " + d.scenarioIds.length +
          " scenarios · " + sc.gradedCount + " lines graded · " + d.notes.length + " notes</div>" +
          "</button>";
      });
    }
    html += "</div>";
    app.innerHTML = html;
  }

  /* ---------- OFFICERS LIST ---------- */
  function officerDays(officerId) {
    return DB.days.filter(function (d) { return d.officerId === officerId; });
  }

  function renderOfficers() {
    var html =
      '<div class="topbar">' +
      '<button class="icon-btn" data-action="go-home">‹ Back</button>' +
      "<h1>Officers</h1></div>" +
      '<div class="screen">';

    if (!DB.officers.length) {
      html += '<div class="card muted">No officer profiles yet. Profiles are created automatically when you enter an officer name on a training day.</div>';
    } else {
      DB.officers.slice().sort(function (a, b) {
        return a.name.localeCompare(b.name);
      }).forEach(function (o) {
        var days = officerDays(o.id);
        var scores = days.map(function (d) { return computeScore(d); })
          .filter(function (s) { return s.pct !== null; });
        var avg = scores.length
          ? Math.round(scores.reduce(function (a, s) { return a + s.pct; }, 0) / scores.length)
          : null;
        html +=
          '<button class="day-item" data-action="open-profile" data-id="' + o.id + '">' +
          (avg !== null
            ? '<span class="score ' + (avg >= DB.settings.threshold ? "good" : "bad") + '">' + avg + "%</span>"
            : '<span class="score none">—</span>') +
          '<div class="title">' + esc(o.name) + (o.badge ? ' <span class="muted small">#' + esc(o.badge) + "</span>" : "") + "</div>" +
          '<div class="meta">' + days.length + " training day" + (days.length === 1 ? "" : "s") +
          (avg !== null ? " · avg score shown" : "") + "</div></button>";
      });
    }
    html += "</div>";
    app.innerHTML = html;
  }

  /* ---------- OFFICER PROFILE ---------- */
  function sparklineSvg(points) {
    if (points.length < 2) return "";
    var w = 280, h = 60, pad = 4;
    var step = (w - pad * 2) / (points.length - 1);
    var coords = points.map(function (p, i) {
      var x = pad + i * step;
      var y = h - pad - ((h - pad * 2) * p) / 100;
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var thY = h - pad - ((h - pad * 2) * DB.settings.threshold) / 100;
    return (
      '<svg viewBox="0 0 ' + w + " " + h + '" class="spark" preserveAspectRatio="none">' +
      '<line x1="0" y1="' + thY + '" x2="' + w + '" y2="' + thY + '" class="spark-th"/>' +
      '<polyline points="' + coords.join(" ") + '" class="spark-line"/>' +
      coords.map(function (c, i) {
        var xy = c.split(",");
        return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="3" class="' +
          (points[i] >= DB.settings.threshold ? "spark-pt good" : "spark-pt bad") + '"/>';
      }).join("") +
      "</svg>"
    );
  }

  function renderProfile() {
    var o = officerById(view.officerId);
    if (!o) { view.screen = "officers"; return renderOfficers(); }
    var days = officerDays(o.id).slice().sort(function (a, b) {
      return (a.date || "").localeCompare(b.date || "");
    });
    var graded = days.map(function (d) {
      return { day: d, sc: computeScore(d) };
    }).filter(function (x) { return x.sc.pct !== null; });

    var avg = graded.length
      ? Math.round(graded.reduce(function (a, x) { return a + x.sc.pct; }, 0) / graded.length)
      : null;
    var passed = graded.filter(function (x) { return dayPassed(x.day, x.sc); }).length;

    // most-failed lines across all this officer's days
    var failCounts = {};
    days.forEach(function (d) {
      Object.keys(d.lines).forEach(function (id) {
        if (d.lines[id].status === "fail")
          failCounts[id] = (failCounts[id] || 0) + 1;
      });
    });
    var topFails = Object.keys(failCounts).map(function (id) {
      return { ln: LINE_BY_ID[id], n: failCounts[id] };
    }).filter(function (x) { return x.ln; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);

    var html =
      '<div class="topbar">' +
      '<button class="icon-btn" data-action="go-officers">‹ Officers</button>' +
      "<h1>" + esc(o.name) +
      '<span class="sub">' + (o.badge ? "Badge #" + esc(o.badge) + " · " : "") +
      days.length + " training day" + (days.length === 1 ? "" : "s") + "</span></h1></div>" +
      '<div class="screen">';

    html += '<div class="card"><h2>Progress</h2>';
    if (!graded.length) {
      html += '<p class="muted">No graded days yet.</p>';
    } else {
      html +=
        '<div class="stat-row">' +
        '<div class="stat"><div class="v">' + avg + '%</div><div class="l">avg score</div></div>' +
        '<div class="stat"><div class="v">' + passed + "/" + graded.length + '</div><div class="l">days passed</div></div>' +
        '<div class="stat"><div class="v">' + graded[graded.length - 1].sc.pct + '%</div><div class="l">latest</div></div>' +
        "</div>" +
        sparklineSvg(graded.map(function (x) { return x.sc.pct; })) +
        '<p class="muted small">Dashed line = passing threshold (' + DB.settings.threshold + "%)</p>";
    }
    html += "</div>";

    if (topFails.length) {
      html += '<div class="card"><h2>Repeat Problem Areas</h2><ul class="clean flag-list">';
      topFails.forEach(function (x) {
        html += "<li><strong>" + x.n + "× needs improvement</strong> — " +
          esc(CAT_BY_ID[x.ln.catId].name) + ": " + esc(x.ln.text) + "</li>";
      });
      html += "</ul></div>";
    }

    html += '<div class="card"><h2>Training Days</h2>';
    if (!days.length) html += '<p class="muted">None yet.</p>';
    days.slice().reverse().forEach(function (d) {
      var sc = computeScore(d);
      html +=
        '<button class="day-item flat" data-action="open-day" data-id="' + d.id + '">' +
        (sc.pct !== null
          ? '<span class="score ' + (dayPassed(d, sc) ? "good" : "bad") + '">' + sc.pct + "%</span>"
          : '<span class="score none">—</span>') +
        '<div class="title">' + fmtDate(d.date) +
        (d.finalized ? ' <span class="badge pass">FINAL</span>' : "") + "</div>" +
        '<div class="meta">' + d.scenarioIds.length + " scenarios · " + sc.gradedCount + " lines graded</div>" +
        "</button>";
    });
    html += "</div></div>";
    app.innerHTML = html;
  }

  /* ---------- SETTINGS ---------- */
  function renderSettings() {
    var html =
      '<div class="topbar">' +
      '<button class="icon-btn" data-action="go-home">‹ Back</button>' +
      "<h1>Settings</h1></div>" +
      '<div class="screen">';

    // Scenario library
    html +=
      '<div class="card"><h2>Scenario Library</h2>' +
      '<p class="muted">These appear in the scenario dropdown on day setup.</p>';
    DB.scenarios.forEach(function (s) {
      html +=
        '<div class="lib-item"><span class="nm">' + esc(s.name) + "</span>" +
        '<button class="edit" data-action="edit-scenario" data-id="' + s.id + '">Rename</button>' +
        '<button class="del" data-action="del-scenario" data-id="' + s.id + '">✕</button></div>';
    });
    html +=
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<input type="text" id="new-scn-name" placeholder="New scenario name…">' +
      '<button class="btn sm" data-action="add-scenario" style="flex-shrink:0;">Add</button>' +
      "</div></div>";

    // Grading
    html +=
      '<div class="card"><h2>Grading</h2>' +
      '<label class="field"><span>Passing threshold (% of weighted points)</span>' +
      '<input type="number" min="1" max="100" value="' + DB.settings.threshold +
      '" data-action-input="set-threshold"></label>' +
      '<p class="muted">Line weights: <span class="badge w2">×2 Critical</span> safety, legal authority, use-of-force, scene-control &amp; de-escalation lines · ' +
      '<span class="badge w1">×1 Standard</span> all other lines. ' +
      "Day score = weighted points passed ÷ weighted points graded. Ungraded and N/O lines are excluded. A Critical line marked Needs Improvement fails the day.</p></div>";

    // Shared backend
    var syncAvailable = typeof window.supabase !== "undefined";
    var st = window.SBTSync ? SBTSync.status() : { state: "off", detail: "" };
    html +=
      '<div class="card"><h2>Shared Backend ' + syncBadgeHtml() + "</h2>" +
      '<p class="muted">Optional: sync training days to a shared Supabase database so every trainer sees the same data and can vote live from their own phone. One-time setup guide is in the repo README (supabase-schema.sql).</p>' +
      '<label class="field"><span>Supabase Project URL</span>' +
      '<input type="text" id="sync-url" placeholder="https://xxxx.supabase.co" value="' +
      esc(DB.settings.sync.url) + '"></label>' +
      '<label class="field"><span>Supabase anon key</span>' +
      '<input type="text" id="sync-key" placeholder="eyJhbGciOi…" value="' + esc(DB.settings.sync.key) + '"></label>' +
      '<label class="field"><span>Your trainer name on this device (for vote attribution)</span>' +
      '<input type="text" placeholder="e.g. Sgt. Smith" value="' + esc(DB.settings.deviceTrainer) +
      '" data-action-input="set-device-trainer"></label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      (SBTSync && SBTSync.isConfigured()
        ? '<button class="btn sm" data-action="sync-now">↻ Sync now</button>' +
          '<button class="btn subtle sm" data-action="sync-disconnect">Disconnect</button>'
        : '<button class="btn sm" data-action="sync-connect"' + (syncAvailable ? "" : " disabled") + ">Connect</button>") +
      "</div>" +
      '<p class="muted small" style="margin-top:8px;">Status: ' + esc(st.detail || st.state) +
      (syncAvailable ? "" : " — sync library not loaded (offline?)") + "</p></div>";

    // Data
    html +=
      '<div class="card"><h2>Data</h2>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn ghost sm" data-action="export-json">Export backup</button>' +
      '<button class="btn ghost sm" data-action="import-json">Import backup</button>' +
      '<button class="btn danger sm" data-action="wipe">Erase all data</button>' +
      "</div>" +
      '<input type="file" id="import-file" accept="application/json,.json" style="display:none;">' +
      "</div>";

    html += "</div>";
    app.innerHTML = html;
  }

  /* ---------- DAY (tabbed) ---------- */
  function renderDay() {
    var day = currentDay();
    if (!day) { view.screen = "home"; return renderHome(); }
    var html =
      '<div class="topbar">' +
      '<button class="icon-btn" data-action="go-home">‹</button>' +
      "<h1>" + esc(day.officerName || "Unnamed Officer") +
      '<span class="sub">' + fmtDate(day.date) + " · Scenario Day " + syncBadgeHtml() + "</span></h1></div>";

    if (view.tab === "setup") html += renderSetupTab(day);
    else if (view.tab === "notes") html += renderNotesTab(day);
    else if (view.tab === "grade") html += renderGradeTab(day);
    else html += renderResultsTab(day);

    html +=
      '<div class="tabbar">' +
      tabBtn("setup", "📋", "Setup") + tabBtn("notes", "📝", "Notes") +
      tabBtn("grade", "✅", "Grade") + tabBtn("results", "🏁", "Results") +
      "</div>";
    app.innerHTML = html;
  }

  function tabBtn(id, ico, label) {
    return '<button class="' + (view.tab === id ? "active" : "") +
      '" data-action="set-tab" data-tab="' + id + '"><span class="ico">' + ico + "</span>" + label + "</button>";
  }

  /* ---------- Setup tab ---------- */
  function renderSetupTab(day) {
    var html = '<div class="screen">';
    if (day.finalized)
      html += '<div class="locked-banner">🔒 This day is finalized. Un-finalize on the Results tab to make changes.</div>';

    // officer picker
    var officerOpts = DB.officers.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    }).map(function (o) {
      return '<option value="' + o.id + '"' + (day.officerId === o.id ? " selected" : "") + ">" +
        esc(o.name) + (o.badge ? " (#" + esc(o.badge) + ")" : "") + "</option>";
    }).join("");

    html +=
      '<div class="card"><h2>Officer Being Evaluated</h2>' +
      '<label class="field"><span>Existing officer profile</span>' +
      '<select data-action-input="pick-officer"' + (day.finalized ? " disabled" : "") + ">" +
      '<option value="">— New / type below —</option>' + officerOpts + "</select></label>" +
      '<div class="row2">' +
      '<label class="field"><span>Officer Name</span><input type="text" value="' + esc(day.officerName) +
      '" data-action-input="day-field" data-field="officerName" placeholder="Officer name"' +
      (day.finalized ? " disabled" : "") + "></label>" +
      '<label class="field"><span>Badge Number</span><input type="text" value="' + esc(day.badge) +
      '" data-action-input="day-field" data-field="badge" placeholder="Badge #"' +
      (day.finalized ? " disabled" : "") + "></label></div>" +
      '<label class="field"><span>Date</span><input type="date" value="' + esc(day.date) +
      '" data-action-input="day-field" data-field="date"' + (day.finalized ? " disabled" : "") + "></label>" +
      '<p class="muted small">A profile is created/updated automatically so you can track this officer’s progress across days (Home → 👤).</p>' +
      "</div>";

    // trainers
    html +=
      '<div class="card"><h2>Observing Trainers <span class="muted">(' + day.trainers.length + ")</span></h2>" +
      '<p class="muted">Add each trainer taking part in end-of-day voting. Votes are recorded by name.</p>' +
      '<div style="display:flex;gap:8px;">' +
      '<input type="text" id="new-trainer-name" placeholder="e.g. Sgt. Smith #123"' + (day.finalized ? " disabled" : "") + ">" +
      '<button class="btn sm" data-action="add-trainer" style="flex-shrink:0;"' + (day.finalized ? " disabled" : "") + ">Add</button></div>" +
      '<div class="chips">' +
      day.trainers.map(function (t) {
        return '<span class="chip">' + esc(t) +
          (day.finalized ? "" : '<button data-action="rm-trainer" data-name="' + esc(t) + '">✕</button>') + "</span>";
      }).join("") +
      "</div></div>";

    // scenarios
    var options = DB.scenarios.filter(function (s) {
      return day.scenarioIds.indexOf(s.id) === -1;
    }).map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.name) + "</option>";
    }).join("");

    html +=
      '<div class="card"><h2>Scenarios Run Today <span class="muted">(' + day.scenarioIds.length + ")</span></h2>" +
      '<p class="muted">Add each scenario used today (typically 6–10). Each one gets its own bullet list on the Notes tab.</p>' +
      '<div style="display:flex;gap:8px;">' +
      '<select id="preset-select"><option value="">— Quick add: FTO practical day —</option>' +
      DEFAULT_PRESETS.map(function (p, i) {
        return '<option value="' + i + '">' + esc(p.name) + " (" + p.scenarios.length + " scenarios)</option>";
      }).join("") +
      "</select>" +
      '<button class="btn sm" data-action="add-preset" style="flex-shrink:0;"' + (day.finalized ? " disabled" : "") + ">Add</button></div>" +
      '<div style="display:flex;gap:8px;margin-top:8px;">' +
      '<select id="scenario-select"><option value="">— Select a scenario —</option>' + options + "</select>" +
      '<button class="btn sm" data-action="add-day-scenario" style="flex-shrink:0;"' + (day.finalized ? " disabled" : "") + ">Add</button></div>" +
      '<div class="chips">' +
      day.scenarioIds.map(function (id, i) {
        return '<span class="chip">' + (i + 1) + ". " + esc(scenarioName(id)) +
          (day.finalized ? "" : '<button data-action="rm-day-scenario" data-id="' + id + '">✕</button>') + "</span>";
      }).join("") +
      "</div>" +
      '<p class="muted small" style="margin-top:10px;">Scenario not listed? Add it in <a href="#" data-action="go-settings">Settings → Scenario Library</a>.</p>' +
      "</div>";

    html += '<button class="btn danger block" data-action="del-day">Delete this training day</button></div>';
    return html;
  }

  /* ---------- Notes tab ---------- */
  function noteHitsHtml(text) {
    var hits = recsForNoteText(text);
    if (!hits.length) return "";
    return '<div class="recs">→ ' +
      hits.map(function (l) { return CAT_BY_ID[l.catId].name; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ") +
      " (" + hits.length + " line" + (hits.length > 1 ? "s" : "") + ")</div>";
  }

  function renderNotesTab(day) {
    var speechOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var dis = day.finalized ? " disabled" : "";
    var html = '<div class="screen">';
    if (day.finalized)
      html += '<div class="locked-banner">🔒 Finalized — notes are locked. Un-finalize on the Results tab to edit.</div>';
    html +=
      '<p class="muted" style="margin:0 0 12px;">One short bullet per observation. Each new line becomes its own bullet, ' +
      "so you can link a single bullet to the exact checklist line it supports on the Grade tab.</p>";

    if (!day.scenarioIds.length)
      html += '<div class="card muted">No scenarios on this day yet — add them on the Setup tab to get a note list per scenario.</div>';

    notesByScenario(day).forEach(function (g) {
      var key = g.scenarioId || "general";
      html += '<div class="card note-group"><h2>' + esc(g.label) +
        ' <span class="muted">(' + g.notes.length + ")</span></h2>";
      if (g.notes.length) {
        html += '<ul class="bullets">';
        g.notes.forEach(function (n) {
          var used = ALL_LINES.filter(function (ln) {
            var ls = day.lines[ln.id];
            return ls && ls.noteIds && ls.noteIds.indexOf(n.id) !== -1;
          });
          html +=
            '<li class="bullet">' +
            '<div class="bullet-row"><span class="txt">' + esc(n.text) + "</span>" +
            (day.finalized ? "" : '<button class="del" data-action="del-note" data-id="' + n.id + '" title="Delete">✕</button>') +
            "</div>" +
            (used.length
              ? '<div class="linked-to">🔗 ' + used.map(function (ln) { return esc(ln.text); }).join(" · ") + "</div>"
              : noteHitsHtml(n.text)) +
            "</li>";
        });
        html += "</ul>";
      } else {
        html += '<p class="muted small" style="margin:0 0 8px;">No observations yet.</p>';
      }
      if (!day.finalized) {
        html +=
          '<div class="note-input-wrap"><textarea class="bullet-input" id="note-text-' + key +
          '" placeholder="Add observation…"' + dis + "></textarea>" +
          (speechOk
            ? '<button class="mic-btn" data-action="toggle-mic" data-target="note-text-' + key + '" title="Dictate">🎤</button>'
            : "") +
          "</div>" +
          '<button class="btn sm" data-action="add-note" data-scn="' + (g.scenarioId || "") + '" style="margin-top:8px;">＋ Add bullet</button>';
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  /* ---------- Grade tab ---------- */
  function renderGradeTab(day) {
    var recs = computeRecs(day);
    /* lines your notes point at: open recommendations or linked bullets */
    var suggestedIds = {};
    ALL_LINES.forEach(function (ln) {
      if (openRecs(day, ln.id, recs).length || linkedNotes(day, ln.id).length)
        suggestedIds[ln.id] = true;
    });
    var sugCount = Object.keys(suggestedIds).length;
    var sc = computeScore(day);

    var html = '<div class="screen">';
    if (day.finalized)
      html += '<div class="locked-banner">🔒 Finalized — grading is locked. Un-finalize on the Results tab to change grades.</div>';

    html +=
      '<div class="progress-wrap"><div class="spread"><strong class="small">' +
      sc.gradedCount + " of " + ALL_LINES.length + " lines graded</strong>" +
      '<span class="muted small">' + sc.passCount + " met · " + sc.failCount + " needs impr. · " + sc.noCount + " n/o</span></div>" +
      '<div class="progress-bar"><div style="width:' +
      Math.round(((sc.gradedCount + sc.noCount) / ALL_LINES.length) * 100) + '%"></div></div></div>';

    html +=
      '<div class="grade-controls">' +
      '<select data-action-input="set-filter">' +
      '<option value="all"' + (view.filter === "all" ? " selected" : "") + ">Show all lines</option>" +
      '<option value="suggested"' + (view.filter === "suggested" ? " selected" : "") + ">From notes (" + sugCount + ")</option>" +
      '<option value="ungraded"' + (view.filter === "ungraded" ? " selected" : "") + ">Ungraded only</option>" +
      "</select>" +
      '<label class="toggle"><input type="checkbox" data-action-input="toggle-votemode"' +
      (view.voteMode ? " checked" : "") + "> Vote mode</label></div>";

    if (view.voteMode) {
      if (!day.trainers.length) {
        html += '<div class="card muted">Add trainers on the Setup tab first — votes are recorded by name.</div>';
      } else {
        if (!view.activeTrainer && DB.settings.deviceTrainer &&
            day.trainers.indexOf(DB.settings.deviceTrainer) !== -1)
          view.activeTrainer = DB.settings.deviceTrainer;
        html +=
          '<div class="card voter-card"><strong class="small">Voting as:</strong><div class="chips" style="margin-top:6px;">' +
          day.trainers.map(function (t) {
            return '<button class="chip pick' + (view.activeTrainer === t ? " sel" : "") +
              '" data-action="pick-trainer" data-name="' + esc(t) + '">' + esc(t) + "</button>";
          }).join("") +
          '</div><p class="muted small" style="margin:6px 0 0;">Each trainer selects themselves, then taps 👍 Met / 👎 Needs Improvement per line. Majority sets the result; ties stay open. Tap your vote again to withdraw it.</p></div>';
      }
    }

    if (view.filter === "suggested" && !sugCount)
      html += '<div class="card muted">Nothing from notes yet — add bullets on the Notes tab, or link bullets to lines here.</div>';

    CHECKLIST.forEach(function (cat) {
      var visible = cat.lines.filter(function (ln) {
        if (view.filter === "suggested") return !!suggestedIds[ln.id];
        if (view.filter === "ungraded")
          return !(day.lines[ln.id] && day.lines[ln.id].status);
        return true;
      });
      if (!visible.length) return;

      var graded = cat.lines.filter(function (ln) {
        var st = day.lines[ln.id] && day.lines[ln.id].status;
        return st === "pass" || st === "fail";
      }).length;

      html += '<div class="cat open"><div class="cat-head">' + esc(cat.name) +
        '<span class="count">' + graded + "/" + cat.lines.length + " graded</span></div>";
      visible.forEach(function (ln) {
        html += renderLine(day, ln, openRecs(day, ln.id, recs));
      });
      html += "</div>";
    });

    html += "</div>";
    return html;
  }

  function bulletLabel(day, n) {
    return '<div class="bullet-main"><span class="txt">' + esc(n.text) + "</span>" +
      '<span class="src">' + (n.scenarioId ? esc(scenarioName(n.scenarioId)) : "General") + "</span></div>";
  }

  function renderLine(day, ln, recList) {
    var st = day.lines[ln.id] || { status: null, votes: {}, note: "", noteIds: [] };
    var tally = voteTally(st);
    var linked = linkedNotes(day, ln.id);
    var isRec = recList.length > 0;
    var dis = day.finalized ? " disabled" : "";
    var html =
      '<div class="line-item' + (isRec ? " recommended" : "") + '">' +
      '<div class="line-meta">' +
      '<span class="badge w' + ln.w + '">×' + ln.w + " " + WEIGHT_LABELS[ln.w] + "</span>" +
      (isRec ? '<span class="badge rec">★ ' + recList.length + " note match" + (recList.length > 1 ? "es" : "") + "</span>" : "") +
      (linked.length ? '<span class="badge link">🔗 ' + linked.length + " linked</span>" : "") +
      (tally.p + tally.f > 0
        ? '<span class="badge ' +
          (st.status === "pass" ? "pass" : st.status === "fail" ? "fail" : "tie") + '">' +
          (st.status ? "" : "TIE ") + tally.p + "–" + tally.f + "</span>"
        : "") +
      "</div>" +
      '<div class="line-text">' + esc(ln.text) + "</div>";

    if (isRec) {
      html += '<div class="rec-why"><div class="rec-head">Recommended from notes' +
        (recList.length > 1 && !day.finalized
          ? ' <button class="dismiss" data-action="dismiss-line-recs" data-id="' + ln.id + '">✕ dismiss all</button>'
          : "") + "</div><ul class=\"bullets rec-list\">";
      recList.forEach(function (r) {
        html += '<li class="bullet"><div class="bullet-row">' + bulletLabel(day, r.note) +
          (day.finalized ? "" :
            '<button class="link-btn" data-action="link-note" data-id="' + ln.id + '" data-note="' + r.note.id + '" title="Link to this line">＋ Link</button>' +
            '<button class="dismiss" data-action="dismiss-rec" data-id="' + ln.id + '" data-note="' + r.note.id + '" title="Dismiss">✕</button>') +
          "</div></li>";
      });
      html += "</ul></div>";
    }

    if (view.voteMode && day.trainers.length) {
      var mine = view.activeTrainer && st.votes[view.activeTrainer] && st.votes[view.activeTrainer].v;
      html +=
        '<div class="votes">' +
        '<button' + dis + ' class="vbtn vp' + (mine === "pass" ? " sel" : "") +
        '" data-action="vote" data-id="' + ln.id + '" data-v="pass">👍 Met <span class="n">' + tally.p + "</span></button>" +
        '<button' + dis + ' class="vbtn vf' + (mine === "fail" ? " sel" : "") +
        '" data-action="vote" data-id="' + ln.id + '" data-v="fail">👎 Needs Impr. <span class="n">' + tally.f + "</span></button>" +
        '<button' + dis + ' class="vbtn vno' + (st.status === "no" ? " sel" : "") +
        '" data-action="set-status" data-id="' + ln.id + '" data-status="no">N/O</button>' +
        "</div>";
      // per-trainer marks
      var marks = day.trainers.map(function (t) {
        var v = st.votes[t] && st.votes[t].v;
        if (!v) return "";
        return '<span class="tmark ' + (v === "pass" ? "tp" : "tf") + '">' +
          esc(initials(t)) + (v === "pass" ? " ✓" : " ✗") + "</span>";
      }).join("");
      if (marks) html += '<div class="tmarks">' + marks + "</div>";
    } else {
      html +=
        '<div class="seg">' +
        '<button' + dis + ' class="' + (st.status === "pass" ? "on-pass" : "") +
        '" data-action="set-status" data-id="' + ln.id + '" data-status="pass">MET STANDARD</button>' +
        '<button' + dis + ' class="' + (st.status === "fail" ? "on-fail" : "") +
        '" data-action="set-status" data-id="' + ln.id + '" data-status="fail">NEEDS IMPROVEMENT</button>' +
        '<button' + dis + ' class="' + (st.status === "no" ? "on-no" : "") +
        '" data-action="set-status" data-id="' + ln.id + '" data-status="no">N/O</button>' +
        "</div>";
    }

    if (linked.length) {
      html += '<div class="linked-notes"><div class="rec-head">Linked observations</div><ul class="bullets">';
      linked.forEach(function (n) {
        html += '<li class="bullet"><div class="bullet-row">' + bulletLabel(day, n) +
          (day.finalized ? "" :
            '<button class="dismiss" data-action="unlink-note" data-id="' + ln.id + '" data-note="' + n.id + '" title="Unlink">✕</button>') +
          "</div></li>";
      });
      html += "</ul></div>";
    }

    if (view.openPickers[ln.id] && !day.finalized) {
      html += '<div class="picker"><div class="spread"><strong class="small">Link observations</strong>' +
        '<button class="line-note-toggle" data-action="close-picker" data-id="' + ln.id + '">Done</button></div>';
      var any = false;
      notesByScenario(day).forEach(function (g) {
        if (!g.notes.length) return;
        any = true;
        html += '<div class="picker-group">' + esc(g.label) + "</div>";
        g.notes.forEach(function (n) {
          var on = st.noteIds && st.noteIds.indexOf(n.id) !== -1;
          html += '<label class="pick-row' + (on ? " on" : "") + '"><input type="checkbox"' + (on ? " checked" : "") +
            ' data-action-input="pick-note" data-id="' + ln.id + '" data-note="' + n.id + '"><span>' + esc(n.text) + "</span></label>";
        });
      });
      if (!any) html += '<p class="muted small" style="margin:6px 0 0;">No bullets yet — add some on the Notes tab.</p>';
      html += "</div>";
    }

    if (view.openNotes[ln.id] || st.note) {
      html += '<div class="line-note"><textarea placeholder="Line note (free text)…" data-action-input="line-note" data-id="' +
        ln.id + '"' + dis + ">" + esc(st.note) + "</textarea></div>";
    }
    if (!day.finalized) {
      html += '<div class="line-actions">' +
        (view.openPickers[ln.id] ? "" :
          '<button class="line-note-toggle" data-action="open-picker" data-id="' + ln.id + '">🔗 Link observations</button>') +
        (view.openNotes[ln.id] || st.note ? "" :
          '<button class="line-note-toggle" data-action="open-line-note" data-id="' + ln.id + '">＋ Add line note</button>') +
        "</div>";
    }
    html += "</div>";
    return html;
  }

  /* ---------- Results tab ---------- */
  function renderResultsTab(day) {
    var sc = computeScore(day);
    var recs = computeRecs(day);
    var html = '<div class="screen">';

    if (sc.pct === null) {
      html +=
        '<div class="card score-hero"><div class="big" style="color:var(--muted);">—</div>' +
        '<div class="sub">No lines graded yet. Grade lines on the Grade tab to see the day score.</div></div>';
    } else {
      var passDay = dayPassed(day, sc);
      html +=
        '<div class="card score-hero">' +
        '<div class="big" style="color:' + (passDay ? "var(--pass)" : "var(--fail)") + ';">' + sc.pct + "%</div>" +
        '<div class="verdict ' + (passDay ? "pass" : "fail") + '">' + (passDay ? "DAY PASSED" : "DAY NOT PASSED") + "</div>" +
        '<div class="sub">' + sc.earned + " of " + sc.possible + " weighted points · threshold " + DB.settings.threshold + "%" +
        (sc.criticalFails.length ? " · " + sc.criticalFails.length + " critical line" + (sc.criticalFails.length > 1 ? "s" : "") + " needing improvement" : "") + "</div>" +
        '<div class="sub">' + sc.passCount + " met standard · " + sc.failCount + " needs improvement · " + sc.noCount +
        " not observed · " + (ALL_LINES.length - sc.gradedCount - sc.noCount) + " ungraded</div></div>";

      if (sc.criticalFails.length) {
        html +=
          '<div class="card"><h2 style="color:var(--fail);">⚠ Critical Lines Needing Improvement</h2>' +
          '<p class="muted small">A ×2 Critical line marked Needs Improvement fails the day regardless of the total score.</p><ul class="clean flag-list">';
        sc.criticalFails.forEach(function (ln) {
          html += "<li><strong>" + esc(CAT_BY_ID[ln.catId].name) + ":</strong> " + esc(ln.text) + "</li>";
        });
        html += "</ul></div>";
      }

      html += '<div class="card"><h2>Category Breakdown</h2>';
      sc.perCat.forEach(function (c) {
        if (c.pct === null) {
          html += '<div class="cat-row"><span class="nm">' + esc(c.cat.name) +
            '</span><span class="muted small">not graded</span></div>';
        } else {
          var cls = c.pct >= 85 ? "bar-good" : c.pct >= 60 ? "bar-mid" : "bar-bad";
          html += '<div class="cat-row"><span class="nm">' + esc(c.cat.name) +
            ' <span class="muted small">(' + c.graded + "/" + c.total + ')</span></span>' +
            '<span class="bar ' + cls + '"><div style="width:' + c.pct + '%"></div></span>' +
            '<span class="pct">' + c.pct + "%</span></div>";
        }
      });
      html += "</div>";
    }

    var pending = ALL_LINES.filter(function (ln) {
      var st = day.lines[ln.id] && day.lines[ln.id].status;
      if (st) return false;
      return openRecs(day, ln.id, recs).length > 0 || linkedNotes(day, ln.id).length > 0;
    }).map(function (ln) { return ln.id; });
    if (pending.length) {
      html += '<div class="card"><h2 style="color:var(--warn);">★ Lines from notes not yet graded</h2>' +
        '<p class="muted small">Your note bullets point at (or are linked to) these lines, but they have no grade yet:</p><ul class="clean flag-list">';
      pending.forEach(function (id) {
        var ln = LINE_BY_ID[id];
        html += "<li>" + esc(CAT_BY_ID[ln.catId].name) + ": " + esc(ln.text) + "</li>";
      });
      html += "</ul></div>";
    }

    html += '<div class="card"><h2>Scenarios This Day (' + day.scenarioIds.length + ")</h2>";
    html += day.scenarioIds.length
      ? '<ul class="clean">' + day.scenarioIds.map(function (id) {
          return "<li>" + esc(scenarioName(id)) + "</li>";
        }).join("") + "</ul>"
      : '<p class="muted">No scenarios recorded — add them on the Setup tab.</p>';
    html += "</div>";

    html += '<div class="card"><h2>Other Notes</h2>' +
      '<textarea placeholder="End-of-day summary, remediation plan, etc." data-action-input="day-field" data-field="otherNotes"' +
      (day.finalized ? " disabled" : "") + ">" + esc(day.otherNotes) + "</textarea></div>";

    html +=
      '<div class="card"><h2>Actions</h2><div style="display:flex;flex-direction:column;gap:10px;">' +
      (day.finalized
        ? '<button class="btn subtle block" data-action="unfinalize">🔓 Un-finalize (allow edits)</button>'
        : '<button class="btn block" data-action="finalize">🔒 Finalize day (lock grades)</button>') +
      '<button class="btn ghost block" data-action="print-form">🖨 Print official form / Save PDF</button>' +
      '<button class="btn ghost block" data-action="copy-summary">📋 Copy summary text</button>' +
      "</div></div>";

    html += "</div>";
    return html;
  }

  /* ---------- printable official form ---------- */
  function printableHTML(day) {
    var sc = computeScore(day);
    var passDay = dayPassed(day, sc);
    function box(mark) { return mark ? "✓" : "&nbsp;"; }

    var h =
      '<div class="pf-header">' +
      "<div><strong>SCENARIO-BASED<br>TRAINING TASK SHEET</strong></div>" +
      '<div class="pf-title">DUBLIN POLICE<br>DEPARTMENT</div></div>' +
      '<table class="pf-fields"><tr>' +
      "<td><strong>Date:</strong> " + esc(fmtDate(day.date)) + "</td>" +
      "<td><strong>Officer Name:</strong> " + esc(day.officerName) + "</td>" +
      "<td><strong>Badge Number:</strong> " + esc(day.badge) + "</td></tr>" +
      '<tr><td colspan="3"><strong>Observing Trainers:</strong> ' + esc(day.trainers.join(", ")) + "</td></tr></table>";

    h += '<table class="pf-fields"><tr><td><strong>Scenarios Run (' + day.scenarioIds.length + "):</strong> " +
      day.scenarioIds.map(function (id, i) { return (i + 1) + ". " + esc(scenarioName(id)); }).join("; ") +
      "</td></tr></table>";

    if (sc.pct !== null) {
      h += '<div class="pf-score">DAY RESULT: <strong>' + (passDay ? "PASS" : "FAIL") + "</strong> — " +
        sc.pct + "% (" + sc.earned + "/" + sc.possible + " weighted points, threshold " + DB.settings.threshold + "%)" +
        (sc.criticalFails.length ? " — " + sc.criticalFails.length + " CRITICAL LINE(S) NEEDING IMPROVEMENT" : "") + "</div>";
    }

    CHECKLIST.forEach(function (cat) {
      h += '<table class="pf-cat"><thead><tr><th class="pf-name">' + esc(cat.name).toUpperCase() +
        "</th><th>MET<br>STANDARD</th><th>NEEDS<br>IMPROVEMENT</th><th>N/O</th><th class=\"pf-notes\">NOTES</th></tr></thead><tbody>";
      cat.lines.forEach(function (ln) {
        var st = day.lines[ln.id] || {};
        var tally = voteTally(st);
        var noteHtml = "";
        if (tally.p + tally.f > 0) noteHtml += "<div>votes " + tally.p + "–" + tally.f + "</div>";
        var lk = linkedNotes(day, ln.id);
        if (lk.length)
          noteHtml += "<ul>" + lk.map(function (n) {
            return "<li>" + esc(n.text) + (n.scenarioId ? " <em>(" + esc(scenarioName(n.scenarioId)) + ")</em>" : "") + "</li>";
          }).join("") + "</ul>";
        if (st.note) noteHtml += "<div>" + esc(st.note) + "</div>";
        h += "<tr><td class=\"pf-name\">" + esc(ln.text) + " <em>(×" + ln.w + ")</em></td>" +
          '<td class="pf-mark">' + box(st.status === "pass") + "</td>" +
          '<td class="pf-mark">' + box(st.status === "fail") + "</td>" +
          '<td class="pf-mark">' + box(st.status === "no") + "</td>" +
          '<td class="pf-notes">' + noteHtml + "</td></tr>";
      });
      h += "</tbody></table>";
    });

    if (day.notes.length) {
      h += '<div class="pf-block"><strong>SCENARIO NOTES:</strong>';
      notesByScenario(day).forEach(function (g) {
        if (!g.notes.length) return;
        h += "<div><em>" + esc(g.label) + "</em><ul>" +
          g.notes.map(function (n) { return "<li>" + esc(n.text) + "</li>"; }).join("") + "</ul></div>";
      });
      h += "</div>";
    }
    h += '<div class="pf-block"><strong>OTHER NOTES:</strong><div class="pf-other">' +
      (esc(day.otherNotes) || "&nbsp;") + "</div></div>";
    return h;
  }

  /* ---------- plain-text summary ---------- */
  function summaryText(day) {
    var sc = computeScore(day);
    var out = [];
    out.push("DUBLIN POLICE DEPARTMENT — SCENARIO-BASED TRAINING DAY");
    out.push("Date: " + fmtDate(day.date));
    out.push("Officer: " + (day.officerName || "—") + (day.badge ? "  Badge #" + day.badge : ""));
    if (day.trainers.length) out.push("Observing Trainers: " + day.trainers.join(", "));
    out.push("");
    out.push("SCENARIOS RUN (" + day.scenarioIds.length + "):");
    day.scenarioIds.forEach(function (id, i) {
      out.push("  " + (i + 1) + ". " + scenarioName(id));
    });
    out.push("");
    if (sc.pct !== null) {
      out.push("DAY RESULT: " + (dayPassed(day, sc) ? "PASS" : "FAIL") + " — " + sc.pct + "% (" +
        sc.earned + "/" + sc.possible + " weighted points, threshold " + DB.settings.threshold + "%)");
      if (sc.criticalFails.length) out.push("Critical lines needing improvement: " + sc.criticalFails.length);
    } else out.push("DAY RESULT: not graded");
    out.push("Lines: " + sc.passCount + " met standard, " + sc.failCount + " needs improvement, " +
      sc.noCount + " not observed, " + (ALL_LINES.length - sc.gradedCount - sc.noCount) + " ungraded");
    out.push("");
    CHECKLIST.forEach(function (cat) {
      var any = cat.lines.some(function (ln) {
        return day.lines[ln.id] && day.lines[ln.id].status;
      });
      if (!any) return;
      out.push(cat.name.toUpperCase());
      cat.lines.forEach(function (ln) {
        var st = day.lines[ln.id];
        if (!st || !st.status) return;
        var mark = st.status === "pass" ? "MET" : st.status === "fail" ? "NI " : "N/O";
        var tally = voteTally(st);
        var votes = tally.p + tally.f > 0
          ? " (votes " + tally.p + "-" + tally.f +
            (Object.keys(st.votes).length
              ? ": " + Object.keys(st.votes).map(function (t) {
                  return t + "=" + (st.votes[t].v === "pass" ? "met" : "needs-improvement");
                }).join(", ")
              : "") + ")"
          : "";
        out.push("  [" + mark + "] (x" + ln.w + ") " + ln.text + votes);
        linkedNotes(day, ln.id).forEach(function (n) {
          out.push("         • " + n.text + (n.scenarioId ? " (" + scenarioName(n.scenarioId) + ")" : ""));
        });
        if (st.note) out.push("         note: " + st.note);
      });
      out.push("");
    });
    if (day.notes.length) {
      out.push("SCENARIO NOTES:");
      notesByScenario(day).forEach(function (g) {
        if (!g.notes.length) return;
        out.push("  " + g.label);
        g.notes.forEach(function (n) { out.push("    • " + n.text); });
      });
      out.push("");
    }
    if (day.otherNotes) {
      out.push("OTHER NOTES:");
      out.push("  " + day.otherNotes);
    }
    return out.join("\n");
  }

  /* ============================================================
     VOICE DICTATION
     ============================================================ */
  var recog = null, recogActive = false, recogTarget = null;
  function micButtons() {
    return Array.prototype.slice.call(document.querySelectorAll(".mic-btn"));
  }
  function stopMic() {
    recogActive = false;
    recogTarget = null;
    if (recog) { try { recog.stop(); } catch (e) { /* already stopped */ } }
    micButtons().forEach(function (b) { b.classList.remove("rec"); });
  }
  /* each scenario's bullet box has its own 🎤; only one listens at a time */
  function toggleMic(targetId) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var ta = document.getElementById(targetId);
    if (!SR || !ta) return;
    if (recogActive) {
      var same = recogTarget === targetId;
      stopMic();
      if (same) return;
    }
    recog = new SR();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = "en-US";
    recog.onresult = function (ev) {
      var txt = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++)
        if (ev.results[i].isFinal) txt += ev.results[i][0].transcript;
      var el = document.getElementById(recogTarget);
      if (el && txt) el.value = (el.value ? el.value.trim() + " " : "") + txt.trim();
    };
    recog.onend = function () { stopMic(); };
    recog.onerror = function (ev) {
      stopMic();
      if (ev.error === "not-allowed") toast("Microphone permission denied");
    };
    try {
      recog.start();
      recogActive = true;
      recogTarget = targetId;
      micButtons().forEach(function (b) {
        b.classList.toggle("rec", b.getAttribute("data-target") === targetId);
      });
      toast("Listening… tap 🎤 again to stop");
    } catch (e) {
      stopMic();
      toast("Could not start dictation");
    }
  }

  /* ============================================================
     EVENTS (delegated)
     ============================================================ */
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    var day = currentDay();
    e.preventDefault();

    switch (action) {
      case "go-home": view.screen = "home"; render(); break;
      case "go-settings": view.screen = "settings"; render(); break;
      case "go-officers": view.screen = "officers"; render(); break;

      case "open-profile":
        view.screen = "profile";
        view.officerId = el.getAttribute("data-id");
        render();
        break;

      case "new-day": {
        var d = newDay();
        view.screen = "day"; view.dayId = d.id; view.tab = "setup";
        render();
        break;
      }

      case "open-day":
        view.screen = "day";
        view.dayId = el.getAttribute("data-id");
        view.tab = "setup"; view.filter = "all"; view.openNotes = {}; view.openPickers = {};
        render();
        break;

      case "set-tab": view.tab = el.getAttribute("data-tab"); render(); break;

      case "del-day":
        if (day && confirm("Delete this training day and all its grades/notes? This cannot be undone.")) {
          DB.days = DB.days.filter(function (x) { return x.id !== day.id; });
          save();
          if (window.SBTSync) SBTSync.deleteRemote("day", day.id);
          view.screen = "home";
          render();
        }
        break;

      /* ----- setup ----- */
      case "add-trainer": {
        var ti = document.getElementById("new-trainer-name");
        var tn = ti ? ti.value.trim() : "";
        if (!tn || !day || day.finalized) break;
        if (day.trainers.indexOf(tn) !== -1) { toast("Trainer already added"); break; }
        day.trainers.push(tn);
        saveDay(day);
        rerenderKeepScroll();
        break;
      }

      case "rm-trainer":
        if (day && !day.finalized) {
          var rn = el.getAttribute("data-name");
          day.trainers = day.trainers.filter(function (t) { return t !== rn; });
          if (view.activeTrainer === rn) view.activeTrainer = "";
          saveDay(day);
          rerenderKeepScroll();
        }
        break;

      case "add-preset": {
        var psel = document.getElementById("preset-select");
        if (!day || day.finalized || !psel || psel.value === "") break;
        var preset = DEFAULT_PRESETS[parseInt(psel.value, 10)];
        if (!preset) break;
        var added = 0, missing = 0;
        preset.scenarios.forEach(function (nm) {
          var match = null;
          DB.scenarios.forEach(function (s) {
            if (s.name.toLowerCase() === nm.toLowerCase()) match = s;
          });
          if (!match) { missing++; return; }
          if (day.scenarioIds.indexOf(match.id) === -1) {
            day.scenarioIds.push(match.id);
            added++;
          }
        });
        saveDay(day);
        rerenderKeepScroll();
        toast("Added " + added + " scenario" + (added === 1 ? "" : "s") +
          (missing ? " (" + missing + " not found in library)" : ""));
        break;
      }

      case "add-day-scenario": {
        var sel = document.getElementById("scenario-select");
        if (day && !day.finalized && sel && sel.value) {
          day.scenarioIds.push(sel.value);
          saveDay(day);
          rerenderKeepScroll();
        }
        break;
      }

      case "rm-day-scenario":
        if (day && !day.finalized) {
          var rid = el.getAttribute("data-id");
          day.scenarioIds = day.scenarioIds.filter(function (x) { return x !== rid; });
          saveDay(day);
          rerenderKeepScroll();
        }
        break;

      /* ----- notes ----- */
      case "toggle-mic": toggleMic(el.getAttribute("data-target")); break;

      case "add-note": {
        if (!day || day.finalized) break;
        var scn = el.getAttribute("data-scn") || null;
        var txtEl = document.getElementById("note-text-" + (scn || "general"));
        var bullets = splitBullets(txtEl ? txtEl.value : "");
        if (!bullets.length) { toast("Write an observation first"); break; }
        if (recogActive) stopMic();
        var hitLines = 0;
        bullets.forEach(function (t) {
          day.notes.push({ id: uid(), scenarioId: scn, text: t, ts: nowISO() });
          hitLines += recsForNoteText(t).length;
        });
        saveDay(day);
        rerenderKeepScroll();
        var focusEl = document.getElementById("note-text-" + (scn || "general"));
        if (focusEl) focusEl.focus();
        toast((bullets.length > 1 ? bullets.length + " bullets saved" : "Bullet saved") +
          (hitLines ? " — " + hitLines + " line" + (hitLines > 1 ? "s" : "") + " recommended for grading" : ""));
        break;
      }

      case "del-note": {
        if (!day || day.finalized) break;
        var nid = el.getAttribute("data-id");
        day.notes = day.notes.filter(function (n) { return n.id !== nid; });
        // drop any links / per-bullet dismissals that pointed at it
        Object.keys(day.lines).forEach(function (lid) {
          var lsn = day.lines[lid];
          if (lsn.noteIds) lsn.noteIds = lsn.noteIds.filter(function (x) { return x !== nid; });
        });
        Object.keys(day.dismissedRecs).forEach(function (k) {
          if (k.indexOf("|" + nid) !== -1) delete day.dismissedRecs[k];
        });
        saveDay(day);
        rerenderKeepScroll();
        break;
      }

      /* ----- grading ----- */
      case "pick-trainer":
        view.activeTrainer = el.getAttribute("data-name");
        DB.settings.deviceTrainer = view.activeTrainer;
        save();
        rerenderKeepScroll();
        break;

      case "set-status": {
        if (!day || day.finalized) break;
        var ls = lineState(day, el.getAttribute("data-id"));
        var stv = el.getAttribute("data-status");
        if (ls.status === stv) {
          ls.status = null;
          ls._manual = false;
        } else {
          ls.status = stv;
          ls._manual = true;
          if (stv === "no") {
            // not observed: withdraw all votes
            Object.keys(ls.votes).forEach(function (t) {
              if (window.SBTSync)
                SBTSync.pushVote(day.id, el.getAttribute("data-id"), t, null, nowISO());
            });
            ls.votes = {};
          }
        }
        saveDay(day);
        rerenderKeepScroll();
        break;
      }

      case "vote": {
        if (!day || day.finalized) break;
        if (!view.activeTrainer) { toast("Select who's voting first"); break; }
        var lineId = el.getAttribute("data-id");
        var vls = lineState(day, lineId);
        var v = el.getAttribute("data-v");
        var ts = nowISO();
        var existing = vls.votes[view.activeTrainer];
        if (existing && existing.v === v) {
          delete vls.votes[view.activeTrainer]; // withdraw
          if (window.SBTSync) SBTSync.pushVote(day.id, lineId, view.activeTrainer, null, ts);
        } else {
          vls.votes[view.activeTrainer] = { v: v, ts: ts };
          if (window.SBTSync) SBTSync.pushVote(day.id, lineId, view.activeTrainer, v, ts);
        }
        vls._manual = false;
        recountVotes(vls);
        saveDay(day);
        rerenderKeepScroll();
        break;
      }

      case "dismiss-rec":
        if (day && !day.finalized) {
          day.dismissedRecs[el.getAttribute("data-id") + "|" + el.getAttribute("data-note")] = true;
          saveDay(day);
          rerenderKeepScroll();
        }
        break;

      case "dismiss-line-recs":
        if (day && !day.finalized) {
          day.dismissedRecs[el.getAttribute("data-id")] = true;
          saveDay(day);
          rerenderKeepScroll();
        }
        break;

      case "link-note":
      case "unlink-note": {
        if (!day || day.finalized) break;
        setNoteLink(day, el.getAttribute("data-id"), el.getAttribute("data-note"), action === "link-note");
        rerenderKeepScroll();
        break;
      }

      case "open-picker":
        view.openPickers[el.getAttribute("data-id")] = true;
        rerenderKeepScroll();
        break;

      case "close-picker":
        delete view.openPickers[el.getAttribute("data-id")];
        rerenderKeepScroll();
        break;

      case "open-line-note":
        view.openNotes[el.getAttribute("data-id")] = true;
        rerenderKeepScroll();
        break;

      /* ----- results ----- */
      case "finalize":
        if (day) {
          var scf = computeScore(day);
          var msg = scf.gradedCount === 0
            ? "No lines are graded yet. Finalize anyway?"
            : "Finalize this day? Grades will be locked (you can un-finalize later).";
          if (confirm(msg)) {
            day.finalized = true;
            saveDay(day);
            rerenderKeepScroll();
          }
        }
        break;

      case "unfinalize":
        if (day) { day.finalized = false; saveDay(day); rerenderKeepScroll(); }
        break;

      case "copy-summary":
        if (day) {
          var text = summaryText(day);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              function () { toast("Summary copied to clipboard"); },
              function () { fallbackCopy(text); }
            );
          } else fallbackCopy(text);
        }
        break;

      case "print-form":
        if (day) {
          var pr = document.getElementById("print-root");
          pr.innerHTML = printableHTML(day);
          window.print();
        }
        break;

      /* ----- settings: scenario library ----- */
      case "add-scenario": {
        var inp = document.getElementById("new-scn-name");
        var name = inp ? inp.value.trim() : "";
        if (!name) break;
        var ns = { id: uid(), name: name, cats: [], updatedAt: nowISO() };
        DB.scenarios.push(ns);
        saveScenario(ns);
        rerenderKeepScroll();
        toast("Scenario added");
        break;
      }

      case "edit-scenario": {
        var sid = el.getAttribute("data-id");
        var scn = scenarioById(sid);
        if (!scn) break;
        var newName = prompt("Scenario name:", scn.name);
        if (newName && newName.trim()) {
          scn.name = newName.trim();
          saveScenario(scn);
          rerenderKeepScroll();
        }
        break;
      }

      case "del-scenario": {
        var did = el.getAttribute("data-id");
        var used = DB.days.some(function (dd) {
          return dd.scenarioIds.indexOf(did) !== -1;
        });
        if (confirm(used
          ? "This scenario is used on saved training days (it will show as deleted there). Remove from the library?"
          : "Remove this scenario from the library?")) {
          DB.scenarios = DB.scenarios.filter(function (s) { return s.id !== did; });
          save();
          if (window.SBTSync) SBTSync.deleteRemote("scenario", did);
          rerenderKeepScroll();
        }
        break;
      }

      /* ----- settings: sync ----- */
      case "sync-connect": {
        var u = document.getElementById("sync-url");
        var k = document.getElementById("sync-key");
        if (!u || !u.value.trim() || !k || !k.value.trim()) {
          toast("Enter the Supabase URL and anon key first");
          break;
        }
        DB.settings.sync = { url: u.value.trim(), key: k.value.trim() };
        save();
        if (window.SBTSync) {
          SBTSync.connect().then(function () {
            toast("Connected — syncing");
            rerenderKeepScroll();
          }).catch(function (err) {
            toast("Connect failed: " + err.message);
            rerenderKeepScroll();
          });
        }
        break;
      }

      case "sync-disconnect":
        if (window.SBTSync) SBTSync.disconnect();
        DB.settings.sync = { url: "", key: "" };
        save();
        rerenderKeepScroll();
        break;

      case "sync-now":
        if (window.SBTSync)
          SBTSync.syncNow().then(function () {
            toast("Synced");
            rerenderKeepScroll();
          }).catch(function (err) { toast("Sync failed: " + err.message); });
        break;

      /* ----- settings: data ----- */
      case "export-json": {
        var blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "sbt-training-data.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        break;
      }

      case "import-json": {
        var fi = document.getElementById("import-file");
        if (fi) fi.click();
        break;
      }

      case "wipe":
        if (confirm("Erase ALL training days, notes, officers, and scenario library from this device?") &&
            confirm("Are you sure? This cannot be undone.")) {
          DB = freshDB();
          save();
          view.screen = "home";
          render();
        }
        break;
    }
  });

  /* import backup file */
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "import-file" && e.target.files && e.target.files[0]) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.days)) throw new Error("not a backup file");
          if (confirm("Replace all data on this device with this backup? (" +
              data.days.length + " training days, " + (data.officers || []).length + " officers)")) {
            DB = migrate(data);
            save();
            view.screen = "home";
            render();
            toast("Backup imported");
          }
        } catch (err) {
          toast("Import failed: " + err.message);
        }
      };
      reader.readAsText(e.target.files[0]);
      e.target.value = "";
    }
  });

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Summary copied to clipboard");
    } catch (e) {
      toast("Could not copy — use Print instead");
    }
    ta.remove();
  }

  /* text inputs: save silently, no re-render (keeps keyboard focus) */
  document.addEventListener("input", function (e) {
    var el = e.target.closest("[data-action-input]");
    if (!el) return;
    var action = el.getAttribute("data-action-input");
    var day = currentDay();

    if (action === "day-field" && day && !day.finalized) {
      day[el.getAttribute("data-field")] = el.value;
      if (el.getAttribute("data-field") === "officerName" ||
          el.getAttribute("data-field") === "badge")
        syncOfficerProfile(day);
      saveDay(day);
    } else if (action === "line-note" && day && !day.finalized) {
      lineState(day, el.getAttribute("data-id")).note = el.value;
      saveDay(day);
    } else if (action === "set-threshold") {
      var v = parseInt(el.value, 10);
      if (v >= 1 && v <= 100) { DB.settings.threshold = v; save(); }
    } else if (action === "set-device-trainer") {
      DB.settings.deviceTrainer = el.value.trim();
      save();
    }
  });

  document.addEventListener("change", function (e) {
    var el = e.target.closest("[data-action-input]");
    if (!el) return;
    var action = el.getAttribute("data-action-input");
    var day = currentDay();

    if (action === "set-filter") {
      view.filter = el.value;
      render();
    } else if (action === "toggle-votemode") {
      view.voteMode = el.checked;
      rerenderKeepScroll();
    } else if (action === "pick-officer" && day && !day.finalized) {
      var o = officerById(el.value);
      if (o) {
        day.officerId = o.id;
        day.officerName = o.name;
        day.badge = o.badge;
      } else {
        day.officerId = null;
      }
      saveDay(day);
      rerenderKeepScroll();
    } else if (action === "pick-note" && day && !day.finalized) {
      setNoteLink(day, el.getAttribute("data-id"), el.getAttribute("data-note"), el.checked);
      rerenderKeepScroll();
    }
  });

  /* tie / untie a note bullet to a checklist line */
  function setNoteLink(day, lineId, noteId, on) {
    var ls = lineState(day, lineId);
    var idx = ls.noteIds.indexOf(noteId);
    if (on && idx === -1) ls.noteIds.push(noteId);
    if (!on && idx !== -1) ls.noteIds.splice(idx, 1);
    if (on) delete day.dismissedRecs[lineId + "|" + noteId];
    saveDay(day);
  }

  /* ---------- sync hookup ---------- */
  if (window.SBTSync) {
    SBTSync.init({
      getDB: function () { return DB; },
      saveLocal: save,
      migrate: migrate,
      lineState: lineState,
      recountVotes: recountVotes,
      onRemoteApplied: function () { rerenderKeepScroll(); },
      onStatusChange: function () {
        // refresh sync badges without disturbing input focus
        if (view.screen === "settings" || view.screen === "home") rerenderKeepScroll();
      },
    });
    if (SBTSync.isConfigured())
      SBTSync.connect().catch(function () { /* stays offline; badge shows error */ });
  }

  /* ---------- service worker ---------- */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(function () { /* non-fatal */ });
  }

  /* ---------- boot ---------- */
  render();
})();
