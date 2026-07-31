/* ============================================================
   Optional shared-backend sync (Supabase).

   Design:
   - Training days, officers, and scenarios sync as whole records
     with last-write-wins by client timestamp.
   - Votes sync as individual rows (one per day/line/trainer), so
     several trainers can vote at once from their own phones
     without overwriting each other. A realtime subscription
     applies incoming votes live.
   - Day records are pushed WITHOUT their votes; votes always come
     from the votes table. This prevents a day update from
     clobbering another trainer's simultaneous vote.

   The app works fully offline; this module no-ops until
   Settings → Shared Backend is configured. Requires the
   supabase-js UMD bundle (loaded from CDN in index.html) and a
   project set up with supabase-schema.sql.
   ============================================================ */

(function () {
  "use strict";

  var client = null;
  var channel = null;
  var hooks = null;
  var state = { state: "off", detail: "Not configured" };
  var dirtySets = { day: {}, officer: {}, scenario: {} };
  var pushTimer = null;

  function db() { return hooks.getDB(); }
  function cfg() { return (db().settings && db().settings.sync) || { url: "", key: "" }; }
  function tsNum(x) { var n = Date.parse(x); return isNaN(n) ? 0 : n; }

  function setState(s, detail) {
    state = { state: s, detail: detail || s };
    if (hooks && hooks.onStatusChange) hooks.onStatusChange();
  }

  function findDay(id) {
    var days = db().days;
    for (var i = 0; i < days.length; i++) if (days[i].id === id) return days[i];
    return null;
  }
  function findIn(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* day blob for the server: votes live in their own table */
  function stripVotes(day) {
    var copy = JSON.parse(JSON.stringify(day));
    Object.keys(copy.lines || {}).forEach(function (id) {
      delete copy.lines[id].votes;
      delete copy.lines[id]._manual;
    });
    return copy;
  }

  /* ---------- apply remote records locally ---------- */
  function applyRemoteDay(row) {
    if (!row || !row.id) return false;
    var local = findDay(row.id);
    var remote = row.data;
    if (!remote) return false;
    if (!local) {
      Object.keys(remote.lines || {}).forEach(function (id) {
        if (!remote.lines[id].votes) remote.lines[id].votes = {};
      });
      db().days.unshift(remote);
      return true;
    }
    if (tsNum(row.updated_at) <= tsNum(local.updatedAt)) return false;
    // preserve local vote maps — votes merge separately, row by row
    var savedVotes = {};
    Object.keys(local.lines || {}).forEach(function (id) {
      savedVotes[id] = local.lines[id].votes || {};
    });
    Object.keys(remote).forEach(function (k) { local[k] = remote[k]; });
    Object.keys(local.lines || {}).forEach(function (id) {
      local.lines[id].votes = savedVotes[id] || {};
      hooks.recountVotes(local.lines[id]);
    });
    // lines the remote blob dropped but we have votes for
    Object.keys(savedVotes).forEach(function (id) {
      if (!local.lines[id] && Object.keys(savedVotes[id]).length) {
        local.lines[id] = { status: null, votes: savedVotes[id], note: "" };
        hooks.recountVotes(local.lines[id]);
      }
    });
    return true;
  }

  function applyRemoteVote(row) {
    if (!row || !row.day_id) return false;
    var day = findDay(row.day_id);
    if (!day) return false;
    var ls = hooks.lineState(day, row.line_id);
    var existing = ls.votes[row.trainer];
    if (existing && tsNum(existing.ts) >= tsNum(row.ts)) return false;
    if (row.vote === "pass" || row.vote === "fail") {
      ls.votes[row.trainer] = { v: row.vote, ts: row.ts };
    } else if (existing) {
      delete ls.votes[row.trainer];
    } else {
      return false;
    }
    ls._manual = false;
    hooks.recountVotes(ls);
    return true;
  }

  function applyRemoteBlob(kind, row) {
    if (!row || !row.id || !row.data) return false;
    var arr = kind === "officer" ? db().officers : db().scenarios;
    var local = findIn(arr, row.id);
    if (!local) { arr.push(row.data); return true; }
    if (tsNum(row.updated_at) <= tsNum(local.updatedAt)) return false;
    Object.keys(row.data).forEach(function (k) { local[k] = row.data[k]; });
    return true;
  }

  function applyRemoteDelete(table, oldRow) {
    if (!oldRow) return false;
    if (table === "sbt_days" && oldRow.id) {
      var before = db().days.length;
      db().days = db().days.filter(function (d) { return d.id !== oldRow.id; });
      return db().days.length !== before;
    }
    if (table === "sbt_scenarios" && oldRow.id) {
      var b2 = db().scenarios.length;
      db().scenarios = db().scenarios.filter(function (s) { return s.id !== oldRow.id; });
      return db().scenarios.length !== b2;
    }
    if (table === "sbt_officers" && oldRow.id) {
      var b3 = db().officers.length;
      db().officers = db().officers.filter(function (o) { return o.id !== oldRow.id; });
      return db().officers.length !== b3;
    }
    return false;
  }

  /* ---------- pull / push ---------- */
  function pullAll() {
    var changed = false;
    return client.from("sbt_officers").select("*").then(function (r) {
      if (r.error) throw r.error;
      r.data.forEach(function (row) { if (applyRemoteBlob("officer", row)) changed = true; });
      return client.from("sbt_scenarios").select("*");
    }).then(function (r) {
      if (r.error) throw r.error;
      r.data.forEach(function (row) { if (applyRemoteBlob("scenario", row)) changed = true; });
      return client.from("sbt_days").select("*");
    }).then(function (r) {
      if (r.error) throw r.error;
      r.data.forEach(function (row) { if (applyRemoteDay(row)) changed = true; });
      return client.from("sbt_votes").select("*");
    }).then(function (r) {
      if (r.error) throw r.error;
      r.data.forEach(function (row) { if (applyRemoteVote(row)) changed = true; });
      if (changed) {
        hooks.saveLocal();
        hooks.onRemoteApplied();
      }
      return changed;
    });
  }

  function pushAll() {
    var d = db();
    var dayRows = d.days.map(function (day) {
      return { id: day.id, data: stripVotes(day), updated_at: day.updatedAt };
    });
    var offRows = d.officers.map(function (o) {
      return { id: o.id, data: o, updated_at: o.updatedAt || new Date().toISOString() };
    });
    var scnRows = d.scenarios.map(function (s) {
      return { id: s.id, data: s, updated_at: s.updatedAt || new Date().toISOString() };
    });
    var voteRows = [];
    d.days.forEach(function (day) {
      Object.keys(day.lines || {}).forEach(function (lineId) {
        var votes = day.lines[lineId].votes || {};
        Object.keys(votes).forEach(function (trainer) {
          voteRows.push({
            day_id: day.id, line_id: lineId, trainer: trainer,
            vote: votes[trainer].v, ts: votes[trainer].ts,
          });
        });
      });
    });
    var chain = Promise.resolve();
    if (offRows.length) chain = chain.then(function () { return upsert("sbt_officers", offRows); });
    if (scnRows.length) chain = chain.then(function () { return upsert("sbt_scenarios", scnRows); });
    if (dayRows.length) chain = chain.then(function () { return upsert("sbt_days", dayRows); });
    if (voteRows.length) chain = chain.then(function () { return upsert("sbt_votes", voteRows); });
    return chain;
  }

  function upsert(table, rows) {
    return client.from(table).upsert(rows).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  function flushDirty() {
    if (!client) return Promise.resolve();
    var d = db();
    var chain = Promise.resolve();

    var dayIds = Object.keys(dirtySets.day);
    if (dayIds.length) {
      var rows = dayIds.map(function (id) { return findDay(id); })
        .filter(Boolean)
        .map(function (day) {
          return { id: day.id, data: stripVotes(day), updated_at: day.updatedAt };
        });
      if (rows.length) chain = chain.then(function () { return upsert("sbt_days", rows); });
    }
    var offIds = Object.keys(dirtySets.officer);
    if (offIds.length) {
      var orows = offIds.map(function (id) { return findIn(d.officers, id); })
        .filter(Boolean)
        .map(function (o) { return { id: o.id, data: o, updated_at: o.updatedAt }; });
      if (orows.length) chain = chain.then(function () { return upsert("sbt_officers", orows); });
    }
    var scnIds = Object.keys(dirtySets.scenario);
    if (scnIds.length) {
      var srows = scnIds.map(function (id) { return findIn(d.scenarios, id); })
        .filter(Boolean)
        .map(function (s) { return { id: s.id, data: s, updated_at: s.updatedAt }; });
      if (srows.length) chain = chain.then(function () { return upsert("sbt_scenarios", srows); });
    }
    dirtySets = { day: {}, officer: {}, scenario: {} };
    return chain.then(function () {
      if (state.state !== "connected") setState("connected", "Connected");
    }).catch(function (err) {
      setState("error", "Push failed: " + err.message);
    });
  }

  /* ---------- realtime ---------- */
  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = client.channel("sbt-live");
    ["sbt_days", "sbt_votes", "sbt_officers", "sbt_scenarios"].forEach(function (table) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: table }, function (payload) {
        var changed = false;
        if (payload.eventType === "DELETE") {
          changed = applyRemoteDelete(table, payload.old);
        } else if (table === "sbt_days") {
          changed = applyRemoteDay(payload.new);
        } else if (table === "sbt_votes") {
          changed = applyRemoteVote(payload.new);
        } else {
          changed = applyRemoteBlob(table === "sbt_officers" ? "officer" : "scenario", payload.new);
        }
        if (changed) {
          hooks.saveLocal();
          hooks.onRemoteApplied();
        }
      });
    });
    channel.subscribe(function (status) {
      if (status === "SUBSCRIBED") setState("connected", "Connected — live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        setState("error", "Realtime connection lost — data still syncs on demand");
    });
  }

  /* ---------- public API ---------- */
  window.SBTSync = {
    init: function (h) { hooks = h; },

    isConfigured: function () {
      var c = cfg();
      return !!(c.url && c.key);
    },
    isConnected: function () { return state.state === "connected"; },
    status: function () { return state; },

    connect: function () {
      var c = cfg();
      if (!c.url || !c.key) return Promise.reject(new Error("Not configured"));
      if (typeof window.supabase === "undefined")
        return Promise.reject(new Error("Sync library not loaded (offline?)"));
      setState("connecting", "Connecting…");
      try {
        client = window.supabase.createClient(c.url, c.key);
      } catch (e) {
        setState("error", "Bad URL/key: " + e.message);
        return Promise.reject(e);
      }
      return pullAll().then(function () {
        return pushAll();
      }).then(function () {
        subscribe();
        setState("connected", "Connected");
      }).catch(function (err) {
        setState("error", (err && err.message) || "Connection failed");
        throw err;
      });
    },

    disconnect: function () {
      if (channel && client) client.removeChannel(channel);
      channel = null;
      client = null;
      setState("off", "Disconnected");
    },

    syncNow: function () {
      if (!client) return this.connect();
      return flushDirty().then(pullAll).then(pushAll);
    },

    /* mark an entity changed; debounced batch push */
    dirty: function (kind, id) {
      if (!client) return;
      dirtySets[kind][id] = true;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(flushDirty, 1200);
    },

    /* votes push immediately for live multi-device voting */
    pushVote: function (dayId, lineId, trainer, vote, ts) {
      if (!client) return;
      client.from("sbt_votes").upsert({
        day_id: dayId, line_id: lineId, trainer: trainer, vote: vote, ts: ts,
      }).then(function (r) {
        if (r.error) setState("error", "Vote push failed: " + r.error.message);
      });
    },

    deleteRemote: function (kind, id) {
      if (!client) return;
      if (kind === "day") {
        client.from("sbt_votes").delete().eq("day_id", id).then(function () {
          return client.from("sbt_days").delete().eq("id", id);
        });
      } else if (kind === "scenario") {
        client.from("sbt_scenarios").delete().eq("id", id);
      } else if (kind === "officer") {
        client.from("sbt_officers").delete().eq("id", id);
      }
    },
  };
})();
