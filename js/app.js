/* ============================================================
   Dublin PD — Scenario-Based Training Task System
   Single-page app. Data is stored on the device (localStorage)
   and can optionally sync to a shared Supabase backend
   (js/sync.js) for multi-device use and live trainer voting.
   ============================================================ */

(function () {
  "use strict";

  var STORE_KEY = "sbt-task-system-v1";
  var DB_VERSION = 2;

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

  /* ---------- persistence & migration ---------- */
  function freshDB() {
    return {
      version: DB_VERSION,
      settings: { threshold: 80, deviceTrainer: "", sync: { url: "", key: "" } },
      officers: [],
      scenarios: DEFAULT_SCENARIOS.map(function (s) {
        return { id: uid(), name: s.name, cats: s.cats.slice(), updatedAt: nowISO() };
      }),
      days: [],
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
      Object.keys(d.lines || {}).forEach(function (id) {
        var ls = d.lines[id];
        if (!ls.votes) ls.votes = {};
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
    libOpen: {}, // scenarioId -> category editor expanded
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
      day.lines[lineId] = { status: null, votes: {}, note: "" };
    if (!day.lines[lineId].votes) day.lines[lineId].votes = {};
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

  /* ---------- suggestions: note keywords + scenario mapping ---------- */
  function computeRecs(day) {
    var recs = {}; // lineId -> [{kw, snippet, scenarioId}]
    day.notes.forEach(function (note) {
      var text = " " + note.text.toLowerCase() + " ";
      ALL_LINES.forEach(function (ln) {
        for (var k = 0; k < ln.kw.length; k++) {
          var kw = ln.kw[k].toLowerCase();
          if (text.indexOf(kw) !== -1) {
            if (!recs[ln.id]) recs[ln.id] = [];
            recs[ln.id].push({
              kw: ln.kw[k].trim(),
              scenarioId: note.scenarioId,
              snippet: note.text.length > 70 ? note.text.slice(0, 70) + "…" : note.text,
            });
            break;
          }
        }
      });
    });
    return recs;
  }

  /* lines expected because a selected scenario tests their category */
  function computeExpected(day) {
    var byCat = {}; // catId -> [scenario names]
    day.scenarioIds.forEach(function (id) {
      var s = scenarioById(id);
      if (!s || !s.cats) return;
      s.cats.forEach(function (c) {
        if (!byCat[c]) byCat[c] = [];
        if (byCat[c].indexOf(s.name) === -1) byCat[c].push(s.name);
      });
    });
    var expected = {}; // lineId -> [scenario names]
    ALL_LINES.forEach(function (ln) {
      if (byCat[ln.catId]) expected[ln.id] = byCat[ln.catId];
    });
    return expected;
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
          if (ln.w === 3) criticalFails.push(ln);
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
        html += "<li><strong>" + x.n + "× failed</strong> — " +
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
      '<p class="muted">These appear in the scenario dropdown on day setup. Tap a scenario to set which skill categories it tests — those lines get pre-suggested for grading.</p>';
    DB.scenarios.forEach(function (s) {
      var open = view.libOpen[s.id];
      html +=
        '<div class="lib-item-wrap">' +
        '<div class="lib-item"><button class="nm as-btn" data-action="toggle-lib" data-id="' + s.id + '">' +
        esc(s.name) +
        ' <span class="muted small">(' + (s.cats && s.cats.length ? s.cats.length + " cats" : "no mapping") + ")</span></button>" +
        '<button class="edit" data-action="edit-scenario" data-id="' + s.id + '">Rename</button>' +
        '<button class="del" data-action="del-scenario" data-id="' + s.id + '">✕</button></div>';
      if (open) {
        html += '<div class="cat-picker">';
        CHECKLIST.forEach(function (cat) {
          var on = s.cats && s.cats.indexOf(cat.id) !== -1;
          html +=
            '<label class="cat-check' + (on ? " on" : "") + '"><input type="checkbox" ' +
            (on ? "checked " : "") + 'data-action-input="toggle-scn-cat" data-id="' + s.id +
            '" data-cat="' + cat.id + '">' + esc(cat.name) + "</label>";
        });
        html += "</div>";
      }
      html += "</div>";
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
      '<p class="muted">Line weights: <span class="badge w3">×3 Critical</span> safety, legal authority &amp; use-of-force lines · ' +
      '<span class="badge w2">×2 Core</span> standard lines. ' +
      "Day score = weighted points passed ÷ weighted points graded. Ungraded and N/O lines are excluded. A failed ×3 line fails the day.</p></div>";

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
      '<p class="muted">Add each scenario used today (typically 6–10). The categories each scenario tests get pre-suggested on the Grade tab.</p>' +
      '<div style="display:flex;gap:8px;">' +
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
  function renderNotesTab(day) {
    var speechOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var html = '<div class="screen">';
    html +=
      '<div class="card"><h2>Add a Note</h2>' +
      '<p class="muted">Jot observations after each scenario. The Grade tab recommends lines to grade based on what you write.</p>' +
      '<label class="field"><span>Scenario</span><select id="note-scenario">' +
      '<option value="">General (whole day)</option>' +
      day.scenarioIds.map(function (id, i) {
        return '<option value="' + id + '">' + (i + 1) + ". " + esc(scenarioName(id)) + "</option>";
      }).join("") +
      "</select></label>" +
      '<label class="field"><span>Observation</span>' +
      '<div class="note-input-wrap"><textarea id="note-text" placeholder="e.g. Struggled to articulate probable cause before the arrest, cuffs not double locked…"></textarea>' +
      (speechOk
        ? '<button class="mic-btn" id="mic-btn" data-action="toggle-mic" title="Dictate">🎤</button>'
        : "") +
      "</div></label>" +
      '<button class="btn block" data-action="add-note">Save Note</button>' +
      "</div>";

    if (day.notes.length) {
      html += '<div class="card"><h2>Notes (' + day.notes.length + ")</h2>";
      day.notes.slice().reverse().forEach(function (n) {
        var hits = recsForNoteText(n.text);
        html +=
          '<div class="note-item">' +
          '<div class="head"><span class="scn">' +
          (n.scenarioId ? esc(scenarioName(n.scenarioId)) : "General") +
          "</span><span>" + fmtTime(n.ts) +
          ' · <button class="del" data-action="del-note" data-id="' + n.id + '">delete</button></span></div>' +
          '<div class="body">' + esc(n.text) + "</div>" +
          (hits.length
            ? '<div class="recs">→ Recommends grading: ' +
              hits.map(function (l) { return CAT_BY_ID[l.catId].name; })
                .filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ") +
              " (" + hits.length + " line" + (hits.length > 1 ? "s" : "") + ")</div>"
            : "") +
          "</div>";
      });
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  /* ---------- Grade tab ---------- */
  function renderGradeTab(day) {
    var recs = computeRecs(day);
    var expected = computeExpected(day);
    var suggestedIds = {};
    Object.keys(recs).forEach(function (id) {
      if (!day.dismissedRecs[id]) suggestedIds[id] = true;
    });
    Object.keys(expected).forEach(function (id) { suggestedIds[id] = true; });
    var sugCount = Object.keys(suggestedIds).length;
    var sc = computeScore(day);

    var html = '<div class="screen">';
    if (day.finalized)
      html += '<div class="locked-banner">🔒 Finalized — grading is locked. Un-finalize on the Results tab to change grades.</div>';

    html +=
      '<div class="progress-wrap"><div class="spread"><strong class="small">' +
      sc.gradedCount + " of " + ALL_LINES.length + " lines graded</strong>" +
      '<span class="muted small">' + sc.passCount + " pass · " + sc.failCount + " fail · " + sc.noCount + " n/o</span></div>" +
      '<div class="progress-bar"><div style="width:' +
      Math.round(((sc.gradedCount + sc.noCount) / ALL_LINES.length) * 100) + '%"></div></div></div>';

    html +=
      '<div class="grade-controls">' +
      '<select data-action-input="set-filter">' +
      '<option value="all"' + (view.filter === "all" ? " selected" : "") + ">Show all lines</option>" +
      '<option value="suggested"' + (view.filter === "suggested" ? " selected" : "") + ">Suggested (" + sugCount + ")</option>" +
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
          '</div><p class="muted small" style="margin:6px 0 0;">Each trainer selects themselves, then taps 👍/👎 per line. Majority sets the result; ties stay open. Tap your vote again to withdraw it.</p></div>';
      }
    }

    if (view.filter === "suggested" && !sugCount)
      html += '<div class="card muted">No suggestions yet — add notes, or map scenarios to categories in Settings.</div>';

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
        html += renderLine(day, ln, day.dismissedRecs[ln.id] ? null : recs[ln.id], expected[ln.id]);
      });
      html += "</div>";
    });

    html += "</div>";
    return html;
  }

  function renderLine(day, ln, recList, expectedFrom) {
    var st = day.lines[ln.id] || { status: null, votes: {}, note: "" };
    var tally = voteTally(st);
    var isRec = !!recList;
    var html =
      '<div class="line-item' + (isRec ? " recommended" : "") + '">' +
      '<div class="line-meta">' +
      '<span class="badge w' + ln.w + '">×' + ln.w + " " + WEIGHT_LABELS[ln.w] + "</span>" +
      (isRec ? '<span class="badge rec">★ Note match</span>' : "") +
      (expectedFrom ? '<span class="badge exp">◆ Expected</span>' : "") +
      (tally.p + tally.f > 0
        ? '<span class="badge ' +
          (st.status === "pass" ? "pass" : st.status === "fail" ? "fail" : "tie") + '">' +
          (st.status ? "" : "TIE ") + tally.p + "–" + tally.f + "</span>"
        : "") +
      "</div>" +
      '<div class="line-text">' + esc(ln.text) + "</div>";

    if (isRec) {
      var why = recList[0];
      html +=
        '<div class="rec-why">Note: “' + esc(why.snippet) + "”" +
        (why.scenarioId ? " — " + esc(scenarioName(why.scenarioId)) : "") +
        (recList.length > 1 ? " (+" + (recList.length - 1) + " more)" : "") +
        ' <button class="dismiss" data-action="dismiss-rec" data-id="' + ln.id + '">✕ dismiss</button></div>';
    }
    if (expectedFrom) {
      html += '<div class="exp-why">Tested by: ' +
        expectedFrom.slice(0, 2).map(esc).join(", ") +
        (expectedFrom.length > 2 ? " +" + (expectedFrom.length - 2) : "") + "</div>";
    }

    var dis = day.finalized ? " disabled" : "";

    if (view.voteMode && day.trainers.length) {
      var mine = view.activeTrainer && st.votes[view.activeTrainer] && st.votes[view.activeTrainer].v;
      html +=
        '<div class="votes">' +
        '<button' + dis + ' class="vbtn vp' + (mine === "pass" ? " sel" : "") +
        '" data-action="vote" data-id="' + ln.id + '" data-v="pass">👍 Pass <span class="n">' + tally.p + "</span></button>" +
        '<button' + dis + ' class="vbtn vf' + (mine === "fail" ? " sel" : "") +
        '" data-action="vote" data-id="' + ln.id + '" data-v="fail">👎 Fail <span class="n">' + tally.f + "</span></button>" +
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
        '" data-action="set-status" data-id="' + ln.id + '" data-status="pass">PASS</button>' +
        '<button' + dis + ' class="' + (st.status === "fail" ? "on-fail" : "") +
        '" data-action="set-status" data-id="' + ln.id + '" data-status="fail">FAIL</button>' +
        '<button' + dis + ' class="' + (st.status === "no" ? "on-no" : "") +
        '" data-action="set-status" data-id="' + ln.id + '" data-status="no">N/O</button>' +
        "</div>";
    }

    if (view.openNotes[ln.id] || st.note) {
      html += '<div class="line-note"><textarea placeholder="Line notes…" data-action-input="line-note" data-id="' +
        ln.id + '"' + dis + ">" + esc(st.note) + "</textarea></div>";
    } else {
      html += '<button class="line-note-toggle" data-action="open-line-note" data-id="' + ln.id + '">＋ Add line note</button>';
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
        (sc.criticalFails.length ? " · " + sc.criticalFails.length + " critical fail" + (sc.criticalFails.length > 1 ? "s" : "") : "") + "</div>" +
        '<div class="sub">' + sc.passCount + " passed · " + sc.failCount + " failed · " + sc.noCount +
        " not observed · " + (ALL_LINES.length - sc.gradedCount - sc.noCount) + " ungraded</div></div>";

      if (sc.criticalFails.length) {
        html +=
          '<div class="card"><h2 style="color:var(--fail);">⚠ Critical Line Failures</h2>' +
          '<p class="muted small">A failed ×3 Critical line fails the day regardless of the total score.</p><ul class="clean flag-list">';
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

    var pending = Object.keys(recs).filter(function (id) {
      if (day.dismissedRecs[id]) return false;
      var st = day.lines[id] && day.lines[id].status;
      return !st;
    });
    if (pending.length) {
      html += '<div class="card"><h2 style="color:var(--warn);">★ Recommended lines not yet graded</h2>' +
        '<p class="muted small">Your notes flagged these lines but they have no grade yet:</p><ul class="clean flag-list">';
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
        (sc.criticalFails.length ? " — " + sc.criticalFails.length + " CRITICAL FAILURE(S)" : "") + "</div>";
    }

    CHECKLIST.forEach(function (cat) {
      h += '<table class="pf-cat"><thead><tr><th class="pf-name">' + esc(cat.name).toUpperCase() +
        "</th><th>PASS</th><th>FAIL</th><th>N/O</th><th class=\"pf-notes\">NOTES</th></tr></thead><tbody>";
      cat.lines.forEach(function (ln) {
        var st = day.lines[ln.id] || {};
        var tally = voteTally(st);
        var noteBits = [];
        if (tally.p + tally.f > 0) noteBits.push("votes " + tally.p + "–" + tally.f);
        if (st.note) noteBits.push(st.note);
        h += "<tr><td class=\"pf-name\">" + esc(ln.text) + " <em>(×" + ln.w + ")</em></td>" +
          '<td class="pf-mark">' + box(st.status === "pass") + "</td>" +
          '<td class="pf-mark">' + box(st.status === "fail") + "</td>" +
          '<td class="pf-mark">' + box(st.status === "no") + "</td>" +
          '<td class="pf-notes">' + esc(noteBits.join(" — ")) + "</td></tr>";
      });
      h += "</tbody></table>";
    });

    if (day.notes.length) {
      h += '<div class="pf-block"><strong>SCENARIO NOTES:</strong><ul>' +
        day.notes.map(function (n) {
          return "<li>[" + (n.scenarioId ? esc(scenarioName(n.scenarioId)) : "General") + "] " + esc(n.text) + "</li>";
        }).join("") + "</ul></div>";
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
      if (sc.criticalFails.length) out.push("Critical failures: " + sc.criticalFails.length);
    } else out.push("DAY RESULT: not graded");
    out.push("Lines: " + sc.passCount + " pass, " + sc.failCount + " fail, " +
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
        var mark = st.status === "pass" ? "PASS" : st.status === "fail" ? "FAIL" : "N/O ";
        var tally = voteTally(st);
        var votes = tally.p + tally.f > 0
          ? " (votes " + tally.p + "-" + tally.f +
            (Object.keys(st.votes).length
              ? ": " + Object.keys(st.votes).map(function (t) {
                  return t + "=" + st.votes[t].v;
                }).join(", ")
              : "") + ")"
          : "";
        out.push("  [" + mark + "] (x" + ln.w + ") " + ln.text + votes);
        if (st.note) out.push("         note: " + st.note);
      });
      out.push("");
    });
    if (day.notes.length) {
      out.push("SCENARIO NOTES:");
      day.notes.forEach(function (n) {
        out.push("  • [" + (n.scenarioId ? scenarioName(n.scenarioId) : "General") + "] " + n.text);
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
  var recog = null, recogActive = false;
  function toggleMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = document.getElementById("mic-btn");
    var ta = document.getElementById("note-text");
    if (!SR || !ta) return;
    if (recogActive) {
      recogActive = false;
      if (recog) recog.stop();
      if (btn) btn.classList.remove("rec");
      return;
    }
    recog = new SR();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = "en-US";
    recog.onresult = function (ev) {
      var txt = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++)
        if (ev.results[i].isFinal) txt += ev.results[i][0].transcript;
      var el = document.getElementById("note-text");
      if (el && txt) el.value = (el.value ? el.value.trim() + " " : "") + txt.trim();
    };
    recog.onend = function () {
      recogActive = false;
      var b = document.getElementById("mic-btn");
      if (b) b.classList.remove("rec");
    };
    recog.onerror = function (ev) {
      recogActive = false;
      var b = document.getElementById("mic-btn");
      if (b) b.classList.remove("rec");
      if (ev.error === "not-allowed") toast("Microphone permission denied");
    };
    try {
      recog.start();
      recogActive = true;
      if (btn) btn.classList.add("rec");
      toast("Listening… tap 🎤 again to stop");
    } catch (e) {
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
        view.tab = "setup"; view.filter = "all"; view.openNotes = {};
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
      case "toggle-mic": toggleMic(); break;

      case "add-note": {
        var txtEl = document.getElementById("note-text");
        var scnEl = document.getElementById("note-scenario");
        var txt = txtEl ? txtEl.value.trim() : "";
        if (!txt) { toast("Write an observation first"); break; }
        if (recogActive) toggleMic();
        day.notes.push({
          id: uid(),
          scenarioId: scnEl && scnEl.value ? scnEl.value : null,
          text: txt,
          ts: nowISO(),
        });
        saveDay(day);
        var hits = recsForNoteText(txt);
        rerenderKeepScroll();
        toast(hits.length
          ? "Note saved — " + hits.length + " line" + (hits.length > 1 ? "s" : "") + " recommended for grading"
          : "Note saved");
        break;
      }

      case "del-note": {
        var nid = el.getAttribute("data-id");
        day.notes = day.notes.filter(function (n) { return n.id !== nid; });
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
        if (day) {
          day.dismissedRecs[el.getAttribute("data-id")] = true;
          saveDay(day);
          rerenderKeepScroll();
        }
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
      case "toggle-lib": {
        var lid = el.getAttribute("data-id");
        view.libOpen[lid] = !view.libOpen[lid];
        rerenderKeepScroll();
        break;
      }

      case "add-scenario": {
        var inp = document.getElementById("new-scn-name");
        var name = inp ? inp.value.trim() : "";
        if (!name) break;
        var ns = { id: uid(), name: name, cats: [], updatedAt: nowISO() };
        DB.scenarios.push(ns);
        saveScenario(ns);
        rerenderKeepScroll();
        toast("Scenario added — tap it to map categories");
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
    } else if (action === "toggle-scn-cat") {
      var s = scenarioById(el.getAttribute("data-id"));
      if (s) {
        var cid = el.getAttribute("data-cat");
        if (el.checked) {
          if (s.cats.indexOf(cid) === -1) s.cats.push(cid);
        } else {
          s.cats = s.cats.filter(function (c) { return c !== cid; });
        }
        saveScenario(s);
        rerenderKeepScroll();
      }
    }
  });

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
