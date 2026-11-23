/* 小黃老師 3D 自學館：學習紀錄（只存在本機瀏覽器 localStorage，不上傳） */
(function () {
  "use strict";
  var KEY = "pk3d.v1";
  var available = false;
  try {
    var t = "__pk3d_test";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    available = true;
  } catch (e) { available = false; }

  function blank() {
    return { version: 1, learner: "", videos: {}, units: {}, log: {}, last: null, created: today() };
  }
  function today(d) {
    var x = d || new Date();
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  }
  function now() { return new Date().toISOString(); }

  function sanitize(s) {
    var b = blank();
    if (!s || typeof s !== "object") return b;
    b.learner = typeof s.learner === "string" ? s.learner.slice(0, 30) : "";
    b.created = typeof s.created === "string" ? s.created : b.created;
    if (s.videos && typeof s.videos === "object") {
      Object.keys(s.videos).forEach(function (id) {
        if (!/^[\w-]{11}$/.test(id)) return;
        var v = s.videos[id] || {};
        b.videos[id] = {
          status: ["todo", "doing", "done"].indexOf(v.status) >= 0 ? v.status : "todo",
          pos: +v.pos || 0, max: +v.max || 0,
          note: typeof v.note === "string" ? v.note.slice(0, 20000) : "",
          steps: Array.isArray(v.steps) ? v.steps.slice(0, 3).map(Boolean) : [false, false, false],
          updated: typeof v.updated === "string" ? v.updated : ""
        };
      });
    }
    if (s.units && typeof s.units === "object") {
      Object.keys(s.units).forEach(function (id) {
        if (!/^M\d\.\d$/.test(id)) return;
        var u = s.units[id] || {};
        b.units[id] = { criteria: !!u.criteria, work: typeof u.work === "string" ? u.work.slice(0, 20000) : "",
          updated: typeof u.updated === "string" ? u.updated : "" };
      });
    }
    if (s.log && typeof s.log === "object") {
      Object.keys(s.log).forEach(function (d) { if (/^\d{4}-\d{2}-\d{2}$/.test(d)) b.log[d] = Math.max(0, +s.log[d] || 0); });
    }
    if (s.last && typeof s.last === "object" && /^[\w-]{11}$/.test(s.last.id || "")) b.last = { id: s.last.id, at: s.last.at || "" };
    return b;
  }

  var state = blank();
  if (available) {
    try { state = sanitize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { state = blank(); }
  }

  var timer = null;
  function save(immediate) {
    if (!available) return false;
    clearTimeout(timer);
    var run = function () { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 空間已滿或被封鎖 */ } };
    if (immediate) run(); else timer = setTimeout(run, 400);
    return true;
  }
  window.addEventListener("pagehide", function () { save(true); });

  function video(id) {
    if (!state.videos[id]) state.videos[id] = { status: "todo", pos: 0, max: 0, note: "", steps: [false, false, false], updated: "" };
    return state.videos[id];
  }
  function unit(id) {
    if (!state.units[id]) state.units[id] = { criteria: false, work: "", updated: "" };
    return state.units[id];
  }

  // 取兩份紀錄中較新的一筆（依 updated），學習時數取較大值
  function merge(a, b) {
    var out = sanitize(a);
    var inc = sanitize(b);
    Object.keys(inc.videos).forEach(function (id) {
      var x = out.videos[id], y = inc.videos[id];
      if (!x || (y.updated || "") > (x.updated || "")) out.videos[id] = y;
    });
    Object.keys(inc.units).forEach(function (id) {
      var x = out.units[id], y = inc.units[id];
      if (!x || (y.updated || "") > (x.updated || "")) out.units[id] = y;
    });
    Object.keys(inc.log).forEach(function (d) { out.log[d] = Math.max(out.log[d] || 0, inc.log[d]); });
    if (!out.learner) out.learner = inc.learner;
    if (inc.last && (!out.last || (inc.last.at || "") > (out.last.at || ""))) out.last = inc.last;
    if (inc.created < out.created) out.created = inc.created;
    return out;
  }

  window.PK3D = {
    available: available,
    get state() { return state; },
    today: today,
    video: function (id) { return state.videos[id] || null; },
    setVideo: function (id, patch) {
      var v = video(id);
      Object.keys(patch).forEach(function (k) { v[k] = patch[k]; });
      v.updated = now();
      state.last = { id: id, at: v.updated };
      save();
      return v;
    },
    unit: function (id) { return state.units[id] || null; },
    setUnit: function (id, patch) {
      var u = unit(id);
      Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
      u.updated = now();
      save();
      return u;
    },
    setLearner: function (name) { state.learner = String(name || "").slice(0, 30); save(); },
    addSeconds: function (sec) {
      var d = today();
      state.log[d] = (state.log[d] || 0) + sec;
      save();
    },
    exportJSON: function () {
      return JSON.stringify({ app: "polik-3d-academy", exported: now(), data: state }, null, 2);
    },
    importJSON: function (text) {
      var obj = JSON.parse(text);
      var incoming = obj && obj.app === "polik-3d-academy" ? obj.data : obj;
      if (!incoming || typeof incoming !== "object" || (!incoming.videos && !incoming.units)) throw new Error("不是本站的學習紀錄檔");
      state = merge(state, incoming);
      save(true);
      return state;
    },
    clear: function () { state = blank(); if (available) { try { localStorage.removeItem(KEY); } catch (e) {} } },
    flush: function () { save(true); }
  };
})();
