/* ============================================================
   Dublin PD — Scenario-Based Training Task System
   Single-page app. All data is stored on the device
   (localStorage) — no server required.
   ============================================================ */

(function () {
  "use strict";

  var STORE_KEY = "sbt-task-system-v1";

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

  /* ---------- persistence ---------- */
  function freshDB() {
    return {
      version: 1,
      settings: { threshold: 80 },
      scenarios: DEFAULT_SCENARIOS.map(function (n) {
        return { id: uid(), name: n };
      }),
      days: [],
    };
  }

  var DB;
  try {
    DB = JSON.parse(localStorage.getItem(STORE_KEY)) || freshDB();
  } catch (e) {
    DB = freshDB();
  }
  if (!DB.settings) DB.settings = { threshold: 80 };
  if (!DB.scenarios) DB.scenarios = [];
  if (!DB.days) DB.days = [];

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(DB));
    } catch (e) {
      toast("Warning: could not save (storage full?)");
    }
  }

  function uid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  /* ---------- view state ---------- */
  var view = {
    screen: "home", // home | day | settings
    dayId: null,
    tab: "setup", // setup | notes | grade | results
    filter: "all", // all | recommended | ungraded
    voteMode: false,
    openNotes: {}, // lineId -> true (per-line note textarea revealed)
  };

  function currentDay() {
    for (var i = 0; i < DB.days.length; i++)
      if (DB.days[i].id === view.dayId) return DB.days[i];
    return null;
  }

  function scenarioName(id) {
    for (var i = 0; i < DB.scenarios.length; i++)
      if (DB.scenarios[i].id === id) return DB.scenarios[i].name;
    return "(deleted scenario)";
  }

  /* ---------- day model ---------- */
  function newDay() {
    var d = {
      id: uid(),
      createdAt: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      officerName: "",
      badge: "",
      observers: "",
      scenarioIds: [],
      notes: [],
      lines: {},
      otherNotes: "",
      finalized: false,
    };
    DB.days.unshift(d);
    save();
    return d;
  }

  function lineState(day, lineId) {
    if (!day.lines[lineId])
      day.lines[lineId] = { status: null, vp: 0, vf: 0, note: "" };
    return day.lines[lineId];
  }

  /* ---------- recommendations from notes ---------- */
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
            break; // one hit per note per line is enough
          }
        }
      });
    });
    return recs;
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
    var earned = 0,
      possible = 0,
      passCount = 0,
      failCount = 0,
      noCount = 0,
      perCat = [],
      criticalFails = [];

    CHECKLIST.forEach(function (cat) {
      var cEarned = 0,
        cPossible = 0,
        cGraded = 0;
      cat.lines.forEach(function (ln) {
        var st = day.lines[ln.id] && day.lines[ln.id].status;
        if (st === "pass") {
          earned += ln.w;
          possible += ln.w;
          cEarned += ln.w;
          cPossible += ln.w;
          cGraded++;
          passCount++;
        } else if (st === "fail") {
          possible += ln.w;
          cPossible += ln.w;
          cGraded++;
          failCount++;
          if (ln.w === 3) criticalFails.push(ln);
        } else if (st === "no") {
          noCount++;
        }
      });
      perCat.push({
        cat: cat,
        earned: cEarned,
        possible: cPossible,
        graded: cGraded,
        total: cat.lines.length,
        pct: cPossible ? Math.round((cEarned / cPossible) * 100) : null,
      });
    });

    return {
      earned: earned,
      possible: possible,
      pct: possible ? Math.round((earned / possible) * 100) : null,
      perCat: perCat,
      criticalFails: criticalFails,
      passCount: passCount,
      failCount: failCount,
      noCount: noCount,
      gradedCount: passCount + failCount,
    };
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(iso) {
    if (!iso) return "No date";
    var p = iso.split("-");
    if (p.length !== 3) return iso;
    return p[1] + "/" + p[2] + "/" + p[0];
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    var h = d.getHours(),
      m = d.getMinutes(),
      ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
    }, 2600);
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  var app = document.getElementById("app");

  function render() {
    if (view.screen === "home") renderHome();
    else if (view.screen === "settings") renderSettings();
    else renderDay();
    window.scrollTo(0, window.__keepScroll ? window.scrollY : 0);
    window.__keepScroll = false;
  }

  function rerenderKeepScroll() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  /* ---------- HOME ---------- */
  function renderHome() {
    var html =
      '<div class="topbar">' +
      '<h1>Scenario-Based Training<span class="sub">Dublin Police Department</span></h1>' +
      '<button class="icon-btn" data-action="go-settings">⚙︎</button>' +
      "</div>" +
      '<div class="screen">' +
      '<button class="btn block" data-action="new-day">＋ New Training Day</button>' +
      '<h3 style="margin:18px 4px 8px;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">Training Days</h3>';

    if (!DB.days.length) {
      html +=
        '<div class="card muted">No training days yet. Start one to grade a scenario day.</div>';
    } else {
      DB.days.forEach(function (d) {
        var sc = computeScore(d);
        var scoreHtml;
        if (sc.pct === null) {
          scoreHtml = '<span class="score none">—</span>';
        } else {
          var good = sc.pct >= DB.settings.threshold;
          scoreHtml =
            '<span class="score ' + (good ? "good" : "bad") + '">' + sc.pct + "%</span>";
        }
        html +=
          '<button class="day-item" data-action="open-day" data-id="' + d.id + '">' +
          scoreHtml +
          '<div class="title">' + esc(d.officerName || "Unnamed Officer") +
          (d.finalized ? ' <span class="badge pass">FINAL</span>' : "") +
          "</div>" +
          '<div class="meta">' + fmtDate(d.date) + " · " +
          d.scenarioIds.length + " scenarios · " +
          sc.gradedCount + " lines graded · " + d.notes.length + " notes</div>" +
          "</button>";
      });
    }
    html += "</div>";
    app.innerHTML = html;
  }

  /* ---------- SETTINGS ---------- */
  function renderSettings() {
    var html =
      '<div class="topbar">' +
      '<button class="icon-btn" data-action="go-home">‹ Back</button>' +
      "<h1>Settings</h1>" +
      "</div>" +
      '<div class="screen">';

    // Scenario library
    html +=
      '<div class="card"><h2>Scenario Library</h2>' +
      '<p class="muted">These appear in the scenario dropdown when setting up a training day. Replace the placeholders with your department’s actual scenarios.</p>';
    DB.scenarios.forEach(function (s) {
      html +=
        '<div class="lib-item"><span class="nm">' + esc(s.name) + "</span>" +
        '<button class="edit" data-action="edit-scenario" data-id="' + s.id + '">Edit</button>' +
        '<button class="del" data-action="del-scenario" data-id="' + s.id + '">✕</button>' +
        "</div>";
    });
    html +=
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<input type="text" id="new-scn-name" placeholder="New scenario name…">' +
      '<button class="btn sm" data-action="add-scenario" style="flex-shrink:0;">Add</button>' +
      "</div></div>";

    // Grading settings
    html +=
      '<div class="card"><h2>Grading</h2>' +
      '<label class="field"><span>Passing threshold (% of weighted points)</span>' +
      '<input type="number" min="1" max="100" id="threshold-input" value="' +
      DB.settings.threshold + '" data-action-input="set-threshold"></label>' +
      '<p class="muted">Line weights: <span class="badge w3">×3 Critical</span> safety, legal authority &amp; use-of-force lines · ' +
      '<span class="badge w2">×2 Core</span> standard lines. ' +
      "The day score = weighted points passed ÷ weighted points graded. Lines left ungraded or marked N/O are excluded.</p></div>";

    // Data
    html +=
      '<div class="card"><h2>Data</h2>' +
      '<p class="muted">All data lives on this device only.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn ghost sm" data-action="export-json">Export backup (JSON)</button>' +
      '<button class="btn danger sm" data-action="wipe">Erase all data</button>' +
      "</div></div>";

    html += "</div>";
    app.innerHTML = html;
  }

  /* ---------- DAY (tabbed) ---------- */
  function renderDay() {
    var day = currentDay();
    if (!day) {
      view.screen = "home";
      return renderHome();
    }
    var title = esc(day.officerName || "Unnamed Officer");
    var html =
      '<div class="topbar">' +
      '<button class="icon-btn" data-action="go-home">‹</button>' +
      "<h1>" + title + '<span class="sub">' + fmtDate(day.date) + " · Scenario Day</span></h1>" +
      "</div>";

    if (view.tab === "setup") html += renderSetupTab(day);
    else if (view.tab === "notes") html += renderNotesTab(day);
    else if (view.tab === "grade") html += renderGradeTab(day);
    else html += renderResultsTab(day);

    html +=
      '<div class="tabbar">' +
      tabBtn("setup", "📋", "Setup") +
      tabBtn("notes", "📝", "Notes") +
      tabBtn("grade", "✅", "Grade") +
      tabBtn("results", "🏁", "Results") +
      "</div>";

    app.innerHTML = html;
  }

  function tabBtn(id, ico, label) {
    return (
      '<button class="' + (view.tab === id ? "active" : "") +
      '" data-action="set-tab" data-tab="' + id + '">' +
      '<span class="ico">' + ico + "</span>" + label + "</button>"
    );
  }

  /* ---------- Setup tab ---------- */
  function renderSetupTab(day) {
    var html = '<div class="screen">';
    if (day.finalized)
      html +=
        '<div class="locked-banner">🔒 This day is finalized. Un-finalize on the Results tab to make changes.</div>';

    html +=
      '<div class="card"><h2>Officer &amp; Trainers</h2>' +
      '<label class="field"><span>Date</span><input type="date" value="' + esc(day.date) +
      '" data-action-input="day-field" data-field="date"></label>' +
      '<div class="row2">' +
      '<label class="field"><span>Officer Name</span><input type="text" value="' + esc(day.officerName) +
      '" data-action-input="day-field" data-field="officerName" placeholder="Officer being evaluated"></label>' +
      '<label class="field"><span>Badge Number</span><input type="text" value="' + esc(day.badge) +
      '" data-action-input="day-field" data-field="badge" placeholder="Badge #"></label>' +
      "</div>" +
      '<label class="field"><span>Observing Trainers (names / badge numbers)</span>' +
      '<input type="text" value="' + esc(day.observers) +
      '" data-action-input="day-field" data-field="observers" placeholder="e.g. Sgt. Smith #123, Ofc. Jones #456"></label>' +
      "</div>";

    // Scenarios for this day
    var options = DB.scenarios
      .filter(function (s) {
        return day.scenarioIds.indexOf(s.id) === -1;
      })
      .map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.name) + "</option>";
      })
      .join("");

    html +=
      '<div class="card"><h2>Scenarios Run Today <span class="muted">(' +
      day.scenarioIds.length + ")</span></h2>" +
      '<p class="muted">Add each scenario used today (typically 6–10) so this record shows what the day covered.</p>' +
      '<div style="display:flex;gap:8px;">' +
      '<select id="scenario-select"><option value="">— Select a scenario —</option>' + options + "</select>" +
      '<button class="btn sm" data-action="add-day-scenario" style="flex-shrink:0;">Add</button>' +
      "</div>" +
      '<div class="chips">' +
      day.scenarioIds
        .map(function (id, i) {
          return (
            '<span class="chip">' + (i + 1) + ". " + esc(scenarioName(id)) +
            '<button data-action="rm-day-scenario" data-id="' + id + '">✕</button></span>'
          );
        })
        .join("") +
      "</div>" +
      '<p class="muted small" style="margin-top:10px;">Scenario not listed? Add it in <a href="#" data-action="go-settings">Settings → Scenario Library</a>.</p>' +
      "</div>";

    html +=
      '<button class="btn danger block" data-action="del-day">Delete this training day</button>';
    html += "</div>";
    return html;
  }

  /* ---------- Notes tab ---------- */
  function renderNotesTab(day) {
    var html = '<div class="screen">';
    html +=
      '<div class="card"><h2>Add a Note</h2>' +
      '<p class="muted">Jot observations after each scenario. The grading tab will recommend lines to grade based on what you write.</p>' +
      '<label class="field"><span>Scenario</span><select id="note-scenario">' +
      '<option value="">General (whole day)</option>' +
      day.scenarioIds
        .map(function (id, i) {
          return '<option value="' + id + '">' + (i + 1) + ". " + esc(scenarioName(id)) + "</option>";
        })
        .join("") +
      "</select></label>" +
      '<label class="field"><span>Observation</span>' +
      '<textarea id="note-text" placeholder="e.g. Struggled to articulate probable cause before the arrest, cuffs not double locked…"></textarea></label>' +
      '<button class="btn block" data-action="add-note">Save Note</button>' +
      "</div>";

    if (day.notes.length) {
      html += '<div class="card"><h2>Notes (' + day.notes.length + ")</h2>";
      day.notes
        .slice()
        .reverse()
        .forEach(function (n) {
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
                hits
                  .map(function (l) {
                    return CAT_BY_ID[l.catId].name;
                  })
                  .filter(function (v, i, a) {
                    return a.indexOf(v) === i;
                  })
                  .join(", ") +
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
    var recCount = Object.keys(recs).length;
    var sc = computeScore(day);

    var html = '<div class="screen">';
    if (day.finalized)
      html +=
        '<div class="locked-banner">🔒 Finalized — grading is locked. Un-finalize on the Results tab to change grades.</div>';

    html +=
      '<div class="progress-wrap"><div class="spread"><strong class="small">' +
      sc.gradedCount + " of " + ALL_LINES.length + " lines graded</strong>" +
      '<span class="muted small">' + sc.passCount + " pass · " + sc.failCount +
      " fail · " + sc.noCount + " n/o</span></div>" +
      '<div class="progress-bar"><div style="width:' +
      Math.round(((sc.gradedCount + sc.noCount) / ALL_LINES.length) * 100) +
      '%"></div></div></div>';

    html +=
      '<div class="grade-controls">' +
      '<select data-action-input="set-filter">' +
      '<option value="all"' + (view.filter === "all" ? " selected" : "") + ">Show all lines</option>" +
      '<option value="recommended"' + (view.filter === "recommended" ? " selected" : "") +
      ">Recommended (" + recCount + ")</option>" +
      '<option value="ungraded"' + (view.filter === "ungraded" ? " selected" : "") + ">Ungraded only</option>" +
      "</select>" +
      '<label class="toggle"><input type="checkbox" data-action-input="toggle-votemode"' +
      (view.voteMode ? " checked" : "") + "> Vote mode</label>" +
      "</div>";

    if (view.voteMode)
      html +=
        '<p class="muted small" style="margin:0 4px 12px;">Each trainer taps 👍 or 👎 once per line. Majority sets the result; ties stay ungraded until resolved.</p>';
    if (view.filter === "recommended" && !recCount)
      html +=
        '<div class="card muted">No recommendations yet — add notes on the Notes tab and matching lines will show up here.</div>';

    CHECKLIST.forEach(function (cat) {
      var visible = cat.lines.filter(function (ln) {
        if (view.filter === "recommended") return !!recs[ln.id];
        if (view.filter === "ungraded") {
          var st = day.lines[ln.id] && day.lines[ln.id].status;
          return !st;
        }
        return true;
      });
      if (!visible.length) return;

      var graded = cat.lines.filter(function (ln) {
        var st = day.lines[ln.id] && day.lines[ln.id].status;
        return st === "pass" || st === "fail";
      }).length;

      html +=
        '<div class="cat open"><button class="cat-head" data-action="noop">' +
        esc(cat.name) +
        '<span class="count">' + graded + "/" + cat.lines.length + " graded</span></button>";

      visible.forEach(function (ln) {
        html += renderLine(day, ln, recs[ln.id]);
      });
      html += "</div>";
    });

    html += "</div>";
    return html;
  }

  function renderLine(day, ln, recList) {
    var st = day.lines[ln.id] || { status: null, vp: 0, vf: 0, note: "" };
    var isRec = !!recList;
    var html =
      '<div class="line-item' + (isRec ? " recommended" : "") + '">' +
      '<div class="line-meta">' +
      '<span class="badge w' + ln.w + '">×' + ln.w + " " + WEIGHT_LABELS[ln.w] + "</span>" +
      (isRec ? '<span class="badge rec">★ Recommended</span>' : "") +
      (st.status === "pass" && st.vp + st.vf > 0
        ? '<span class="badge pass">' + st.vp + "–" + st.vf + "</span>"
        : "") +
      (st.status === "fail" && st.vp + st.vf > 0
        ? '<span class="badge fail">' + st.vp + "–" + st.vf + "</span>"
        : "") +
      (!st.status && st.vp + st.vf > 0 && st.vp === st.vf
        ? '<span class="badge tie">TIE ' + st.vp + "–" + st.vf + "</span>"
        : "") +
      "</div>" +
      '<div class="line-text">' + esc(ln.text) + "</div>";

    if (isRec) {
      var why = recList[0];
      html +=
        '<div class="rec-why">Note match: “' + esc(why.snippet) + "”" +
        (why.scenarioId ? " — " + esc(scenarioName(why.scenarioId)) : "") +
        (recList.length > 1 ? " (+" + (recList.length - 1) + " more)" : "") +
        "</div>";
    }

    var dis = day.finalized ? " disabled" : "";
    html +=
      '<div class="seg">' +
      '<button' + dis + ' class="' + (st.status === "pass" ? "on-pass" : "") +
      '" data-action="set-status" data-id="' + ln.id + '" data-status="pass">PASS</button>' +
      '<button' + dis + ' class="' + (st.status === "fail" ? "on-fail" : "") +
      '" data-action="set-status" data-id="' + ln.id + '" data-status="fail">FAIL</button>' +
      '<button' + dis + ' class="' + (st.status === "no" ? "on-no" : "") +
      '" data-action="set-status" data-id="' + ln.id + '" data-status="no">N/O</button>' +
      "</div>";

    if (view.voteMode) {
      html +=
        '<div class="votes">' +
        '<button' + dis + ' class="vbtn vp" data-action="vote" data-id="' + ln.id +
        '" data-v="p">👍 Pass <span class="n">' + st.vp + "</span></button>" +
        '<button' + dis + ' class="vbtn vf" data-action="vote" data-id="' + ln.id +
        '" data-v="f">👎 Fail <span class="n">' + st.vf + "</span></button>" +
        (st.vp + st.vf > 0
          ? '<button' + dis + ' class="vclear" data-action="clear-votes" data-id="' + ln.id + '">reset</button>'
          : "") +
        "</div>";
    }

    if (view.openNotes[ln.id] || st.note) {
      html +=
        '<div class="line-note"><textarea placeholder="Line notes…" data-action-input="line-note" data-id="' +
        ln.id + '"' + dis + ">" + esc(st.note) + "</textarea></div>";
    } else {
      html +=
        '<button class="line-note-toggle" data-action="open-line-note" data-id="' +
        ln.id + '">＋ Add line note</button>';
    }

    html += "</div>";
    return html;
  }

  /* ---------- Results tab ---------- */
  function renderResultsTab(day) {
    var sc = computeScore(day);
    var recs = computeRecs(day);
    var html = '<div class="screen">';

    // Hero score
    if (sc.pct === null) {
      html =
        html +
        '<div class="card score-hero"><div class="big" style="color:var(--muted);">—</div>' +
        '<div class="sub">No lines graded yet. Grade lines on the Grade tab to see the day score.</div></div>';
    } else {
      var passDay = sc.pct >= DB.settings.threshold && sc.criticalFails.length === 0;
      html +=
        '<div class="card score-hero">' +
        '<div class="big" style="color:' + (passDay ? "var(--pass)" : "var(--fail)") + ';">' + sc.pct + "%</div>" +
        '<div class="verdict ' + (passDay ? "pass" : "fail") + '">' +
        (passDay ? "DAY PASSED" : "DAY NOT PASSED") + "</div>" +
        '<div class="sub">' + sc.earned + " of " + sc.possible +
        " weighted points · threshold " + DB.settings.threshold + "%" +
        (sc.criticalFails.length
          ? " · " + sc.criticalFails.length + " critical fail" + (sc.criticalFails.length > 1 ? "s" : "")
          : "") +
        "</div>" +
        '<div class="sub">' + sc.passCount + " passed · " + sc.failCount +
        " failed · " + sc.noCount + " not observed · " +
        (ALL_LINES.length - sc.gradedCount - sc.noCount) + " ungraded</div>" +
        "</div>";

      if (sc.criticalFails.length) {
        html +=
          '<div class="card"><h2 style="color:var(--fail);">⚠ Critical Line Failures</h2>' +
          '<p class="muted small">A failed ×3 Critical line fails the day regardless of the total score.</p><ul class="clean flag-list">';
        sc.criticalFails.forEach(function (ln) {
          html +=
            "<li><strong>" + esc(CAT_BY_ID[ln.catId].name) + ":</strong> " + esc(ln.text) + "</li>";
        });
        html += "</ul></div>";
      }

      // Category breakdown
      html += '<div class="card"><h2>Category Breakdown</h2>';
      sc.perCat.forEach(function (c) {
        if (c.pct === null) {
          html +=
            '<div class="cat-row"><span class="nm">' + esc(c.cat.name) +
            '</span><span class="muted small">not graded</span></div>';
        } else {
          var cls = c.pct >= 85 ? "bar-good" : c.pct >= 60 ? "bar-mid" : "bar-bad";
          html +=
            '<div class="cat-row"><span class="nm">' + esc(c.cat.name) +
            ' <span class="muted small">(' + c.graded + "/" + c.total + ')</span></span>' +
            '<span class="bar ' + cls + '"><div style="width:' + c.pct + '%"></div></span>' +
            '<span class="pct">' + c.pct + "%</span></div>";
        }
      });
      html += "</div>";
    }

    // Recommended but ungraded warning
    var pending = Object.keys(recs).filter(function (id) {
      var st = day.lines[id] && day.lines[id].status;
      return !st;
    });
    if (pending.length) {
      html +=
        '<div class="card"><h2 style="color:var(--warn);">★ Recommended lines not yet graded</h2>' +
        '<p class="muted small">Your notes flagged these lines but they have no grade yet:</p><ul class="clean flag-list">';
      pending.forEach(function (id) {
        var ln = LINE_BY_ID[id];
        html += "<li>" + esc(CAT_BY_ID[ln.catId].name) + ": " + esc(ln.text) + "</li>";
      });
      html += "</ul></div>";
    }

    // Scenario record
    html +=
      '<div class="card"><h2>Scenarios This Day (' + day.scenarioIds.length + ")</h2>";
    html += day.scenarioIds.length
      ? '<ul class="clean">' +
        day.scenarioIds
          .map(function (id) {
            return "<li>" + esc(scenarioName(id)) + "</li>";
          })
          .join("") +
        "</ul>"
      : '<p class="muted">No scenarios recorded — add them on the Setup tab.</p>';
    html += "</div>";

    // Other notes
    html +=
      '<div class="card"><h2>Other Notes</h2>' +
      '<textarea placeholder="End-of-day summary, remediation plan, etc." data-action-input="day-field" data-field="otherNotes"' +
      (day.finalized ? " disabled" : "") + ">" + esc(day.otherNotes) + "</textarea></div>";

    // Actions
    html +=
      '<div class="card"><h2>Actions</h2><div style="display:flex;flex-direction:column;gap:10px;">' +
      (day.finalized
        ? '<button class="btn subtle block" data-action="unfinalize">🔓 Un-finalize (allow edits)</button>'
        : '<button class="btn block" data-action="finalize">🔒 Finalize day (lock grades)</button>') +
      '<button class="btn ghost block" data-action="copy-summary">📋 Copy summary text</button>' +
      '<button class="btn ghost block" data-action="print">🖨 Print / Save as PDF</button>' +
      "</div></div>";

    html += "</div>";
    return html;
  }

  /* ---------- summary export ---------- */
  function summaryText(day) {
    var sc = computeScore(day);
    var out = [];
    out.push("DUBLIN POLICE DEPARTMENT — SCENARIO-BASED TRAINING DAY");
    out.push("Date: " + fmtDate(day.date));
    out.push("Officer: " + (day.officerName || "—") + (day.badge ? "  Badge #" + day.badge : ""));
    if (day.observers) out.push("Observing Trainers: " + day.observers);
    out.push("");
    out.push("SCENARIOS RUN (" + day.scenarioIds.length + "):");
    day.scenarioIds.forEach(function (id, i) {
      out.push("  " + (i + 1) + ". " + scenarioName(id));
    });
    out.push("");
    if (sc.pct !== null) {
      var passDay = sc.pct >= DB.settings.threshold && sc.criticalFails.length === 0;
      out.push(
        "DAY RESULT: " + (passDay ? "PASS" : "FAIL") + " — " + sc.pct + "% (" +
        sc.earned + "/" + sc.possible + " weighted points, threshold " +
        DB.settings.threshold + "%)"
      );
      if (sc.criticalFails.length)
        out.push("Critical failures: " + sc.criticalFails.length);
    } else {
      out.push("DAY RESULT: not graded");
    }
    out.push(
      "Lines: " + sc.passCount + " pass, " + sc.failCount + " fail, " +
      sc.noCount + " not observed, " +
      (ALL_LINES.length - sc.gradedCount - sc.noCount) + " ungraded"
    );
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
        var votes = st.vp + st.vf > 0 ? " (votes " + st.vp + "-" + st.vf + ")" : "";
        out.push("  [" + mark + "] (x" + ln.w + ") " + ln.text + votes);
        if (st.note) out.push("         note: " + st.note);
      });
      out.push("");
    });
    if (day.notes.length) {
      out.push("SCENARIO NOTES:");
      day.notes.forEach(function (n) {
        out.push(
          "  • [" + (n.scenarioId ? scenarioName(n.scenarioId) : "General") + "] " + n.text
        );
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
     EVENTS (delegated)
     ============================================================ */
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    var day = currentDay();
    e.preventDefault();

    switch (action) {
      case "noop":
        break;

      case "go-home":
        view.screen = "home";
        render();
        break;

      case "go-settings":
        view.screen = "settings";
        render();
        break;

      case "new-day": {
        var d = newDay();
        view.screen = "day";
        view.dayId = d.id;
        view.tab = "setup";
        render();
        break;
      }

      case "open-day":
        view.screen = "day";
        view.dayId = el.getAttribute("data-id");
        view.tab = "setup";
        view.filter = "all";
        view.openNotes = {};
        render();
        break;

      case "set-tab":
        view.tab = el.getAttribute("data-tab");
        render();
        break;

      case "del-day":
        if (day && confirm("Delete this training day and all its grades/notes? This cannot be undone.")) {
          DB.days = DB.days.filter(function (x) {
            return x.id !== day.id;
          });
          save();
          view.screen = "home";
          render();
        }
        break;

      /* ----- setup ----- */
      case "add-day-scenario": {
        var sel = document.getElementById("scenario-select");
        if (day && sel && sel.value) {
          day.scenarioIds.push(sel.value);
          save();
          rerenderKeepScroll();
        }
        break;
      }

      case "rm-day-scenario":
        if (day) {
          var rid = el.getAttribute("data-id");
          day.scenarioIds = day.scenarioIds.filter(function (x) {
            return x !== rid;
          });
          save();
          rerenderKeepScroll();
        }
        break;

      /* ----- notes ----- */
      case "add-note": {
        var txtEl = document.getElementById("note-text");
        var scnEl = document.getElementById("note-scenario");
        var txt = txtEl ? txtEl.value.trim() : "";
        if (!txt) {
          toast("Write an observation first");
          break;
        }
        day.notes.push({
          id: uid(),
          scenarioId: scnEl && scnEl.value ? scnEl.value : null,
          text: txt,
          ts: new Date().toISOString(),
        });
        save();
        var hits = recsForNoteText(txt);
        rerenderKeepScroll();
        toast(
          hits.length
            ? "Note saved — " + hits.length + " line" + (hits.length > 1 ? "s" : "") + " recommended for grading"
            : "Note saved"
        );
        break;
      }

      case "del-note": {
        var nid = el.getAttribute("data-id");
        day.notes = day.notes.filter(function (n) {
          return n.id !== nid;
        });
        save();
        rerenderKeepScroll();
        break;
      }

      /* ----- grading ----- */
      case "set-status": {
        if (!day || day.finalized) break;
        var ls = lineState(day, el.getAttribute("data-id"));
        var stv = el.getAttribute("data-status");
        ls.status = ls.status === stv ? null : stv; // tap again to clear
        save();
        rerenderKeepScroll();
        break;
      }

      case "vote": {
        if (!day || day.finalized) break;
        var vls = lineState(day, el.getAttribute("data-id"));
        if (el.getAttribute("data-v") === "p") vls.vp++;
        else vls.vf++;
        // majority decides; tie clears the result
        vls.status = vls.vp > vls.vf ? "pass" : vls.vf > vls.vp ? "fail" : null;
        save();
        rerenderKeepScroll();
        break;
      }

      case "clear-votes": {
        if (!day || day.finalized) break;
        var cls2 = lineState(day, el.getAttribute("data-id"));
        cls2.vp = 0;
        cls2.vf = 0;
        cls2.status = null;
        save();
        rerenderKeepScroll();
        break;
      }

      case "open-line-note":
        view.openNotes[el.getAttribute("data-id")] = true;
        rerenderKeepScroll();
        break;

      /* ----- results ----- */
      case "finalize":
        if (day) {
          var scf = computeScore(day);
          var msg =
            scf.gradedCount === 0
              ? "No lines are graded yet. Finalize anyway?"
              : "Finalize this day? Grades will be locked (you can un-finalize later).";
          if (confirm(msg)) {
            day.finalized = true;
            save();
            rerenderKeepScroll();
          }
        }
        break;

      case "unfinalize":
        if (day) {
          day.finalized = false;
          save();
          rerenderKeepScroll();
        }
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

      case "print":
        window.print();
        break;

      /* ----- settings ----- */
      case "add-scenario": {
        var inp = document.getElementById("new-scn-name");
        var name = inp ? inp.value.trim() : "";
        if (!name) break;
        DB.scenarios.push({ id: uid(), name: name });
        save();
        rerenderKeepScroll();
        toast("Scenario added");
        break;
      }

      case "edit-scenario": {
        var sid = el.getAttribute("data-id");
        var scn = DB.scenarios.filter(function (s) { return s.id === sid; })[0];
        if (!scn) break;
        var newName = prompt("Scenario name:", scn.name);
        if (newName && newName.trim()) {
          scn.name = newName.trim();
          save();
          rerenderKeepScroll();
        }
        break;
      }

      case "del-scenario": {
        var did = el.getAttribute("data-id");
        var used = DB.days.some(function (dd) {
          return dd.scenarioIds.indexOf(did) !== -1;
        });
        if (
          confirm(
            used
              ? "This scenario is used on saved training days (it will show as deleted there). Remove from the library?"
              : "Remove this scenario from the library?"
          )
        ) {
          DB.scenarios = DB.scenarios.filter(function (s) { return s.id !== did; });
          save();
          rerenderKeepScroll();
        }
        break;
      }

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

      case "wipe":
        if (confirm("Erase ALL training days, notes, and scenario library from this device?") &&
            confirm("Are you sure? This cannot be undone.")) {
          DB = freshDB();
          save();
          view.screen = "home";
          render();
        }
        break;
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

  /* Text inputs: save silently, no re-render (keeps keyboard focus) */
  document.addEventListener("input", function (e) {
    var el = e.target.closest("[data-action-input]");
    if (!el) return;
    var action = el.getAttribute("data-action-input");
    var day = currentDay();

    if (action === "day-field" && day && !day.finalized) {
      day[el.getAttribute("data-field")] = el.value;
      save();
    } else if (action === "line-note" && day && !day.finalized) {
      lineState(day, el.getAttribute("data-id")).note = el.value;
      save();
    } else if (action === "set-threshold") {
      var v = parseInt(el.value, 10);
      if (v >= 1 && v <= 100) {
        DB.settings.threshold = v;
        save();
      }
    }
  });

  document.addEventListener("change", function (e) {
    var el = e.target.closest("[data-action-input]");
    if (!el) return;
    var action = el.getAttribute("data-action-input");
    if (action === "set-filter") {
      view.filter = el.value;
      render();
    } else if (action === "toggle-votemode") {
      view.voteMode = el.checked;
      rerenderKeepScroll();
    }
  });

  /* ---------- boot ---------- */
  render();
})();
