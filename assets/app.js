/* 小黃老師 3D 自學館：頁面互動（課程地圖、單元、影片、學習紀錄） */
(function () {
  "use strict";
  var P = window.PK3D;
  var BASE = document.documentElement.getAttribute("data-base") || ".";
  var me = document.currentScript || document.querySelector("script[data-page]");
  var PAGE = (me && me.getAttribute("data-page")) || "";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var LABEL = { todo: "", doing: "學習中", done: "✓ 完成" };

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function status(id) { var v = P.video(id); return v ? v.status : "todo"; }

  var COURSE = null;
  function loadCourse() {
    return fetch(BASE + "/data/course.json").then(function (r) { return r.json(); }).then(function (c) { COURSE = c; return c; });
  }
  function order(c) {
    var core = c.modules.filter(function (m) { return m.core; });
    var el = c.modules.filter(function (m) { return !m.core; });
    var seq = [];
    core.concat(el).forEach(function (m) { m.units.forEach(function (u) { seq = seq.concat(u.videos); }); });
    return seq;
  }
  function modStats(m) {
    var total = 0, done = 0, doing = 0;
    m.units.forEach(function (u) { u.videos.forEach(function (id) { total++; var s = status(id); if (s === "done") done++; else if (s === "doing") doing++; }); });
    var units = m.units.filter(function (u) { var x = P.unit(u.id); return x && x.criteria; }).length;
    return { total: total, done: done, doing: doing, units: units, unitTotal: m.units.length };
  }
  function paintModule(el, st) {
    var pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    var bar = $("[data-mbar]", el), txt = $("[data-mpct]", el);
    if (bar) bar.style.width = pct + "%";
    if (txt) txt.textContent = st.done || st.doing || st.units
      ? "完成 " + st.done + "/" + st.total + " 部 · 過關 " + st.units + "/" + st.unitTotal + " 單元"
      : "尚未開始";
    el.classList.toggle("is-done", st.total > 0 && st.done === st.total);
  }
  function paintOverall(c) {
    var ids = Object.keys(c.videos);
    var done = ids.filter(function (id) { return status(id) === "done"; }).length;
    $$("[data-overall]").forEach(function (e) { e.textContent = Math.round((done / ids.length) * 100) + "%"; });
  }

  // ---------- 課程地圖 ----------
  function initIndex(c) {
    c.modules.forEach(function (m) { $$('[data-module="' + m.id + '"]').forEach(function (el) { paintModule(el, modStats(m)); }); });
    var last = P.state.last && P.state.last.id;
    var lastV = last && P.video(last);
    var next = order(c).filter(function (id) { return status(id) !== "done"; })[0];
    var pick = lastV && lastV.status !== "done" ? last : next;
    var cta = $("[data-continue]");
    if (!pick || !cta) return;
    var started = Object.keys(P.state.videos).length > 0;
    if (started) {
      cta.textContent = "繼續學習";
      cta.href = BASE + "/v/" + pick + ".html";
      var v = c.videos[pick], pv = P.video(pick);
      var card = $("[data-resume]");
      card.innerHTML = '<p class="eyebrow">' + (pick === last ? "上次看到" : "建議下一部") + "</p>" +
        '<a href="' + BASE + "/v/" + pick + '.html"><img src="https://i.ytimg.com/vi/' + pick + '/mqdefault.jpg" alt="" width="320" height="180">' +
        "<b>" + esc(v.t) + "</b></a><p class=\"muted small\">" + esc(v.u) + (pv && pv.pos > 5 ? " · 從 " + fmt(pv.pos) + " 繼續" : "") + "</p>";
      card.hidden = false;
    }
  }

  // ---------- 單元頁 ----------
  function initModule(c) {
    $$("[data-vid]").forEach(function (a) {
      var s = status(a.getAttribute("data-vid"));
      a.classList.toggle("is-done", s === "done");
      a.classList.toggle("is-doing", s === "doing");
      var badge = $("[data-status]", a);
      if (badge) badge.textContent = LABEL[s];
    });
    $$("[data-unit]").forEach(function (sec) {
      var id = sec.getAttribute("data-unit");
      var u = P.unit(id) || {};
      var crit = $("[data-crit]", sec), work = $("[data-work]", sec);
      if (crit) { crit.checked = !!u.criteria; crit.addEventListener("change", function () { P.setUnit(id, { criteria: crit.checked }); refresh(); }); }
      if (work) { work.value = u.work || ""; work.addEventListener("input", function () { P.setUnit(id, { work: work.value }); }); }
      var vids = $$("[data-vid]", sec).map(function (a) { return a.getAttribute("data-vid"); });
      var cnt = $("[data-ucount]", sec);
      if (cnt && vids.length) {
        var d = vids.filter(function (x) { return status(x) === "done"; }).length;
        cnt.textContent = d ? "完成 " + d + "/" + vids.length : vids.length + " 部影片";
      }
    });
    function refresh() {
      var el = $(".mhead");
      var m = c.modules.filter(function (x) { return x.id === el.getAttribute("data-module"); })[0];
      if (m) paintModule(el, modStats(m));
    }
    refresh();
  }

  // ---------- 影片頁 ----------
  function initVideo() {
    var art = $("[data-video]");
    var id = art.getAttribute("data-video");
    var dur = +art.getAttribute("data-dur") || 0;
    var rec = P.video(id) || { status: "todo", pos: 0, max: 0, note: "", steps: [false, false, false] };
    var player = null, ticking = null, acc = 0;

    // 狀態按鈕
    function paintStatus() {
      var s = (P.video(id) || rec).status;
      $$("[data-set]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-set") === s)); });
    }
    $$("[data-set]").forEach(function (b) {
      b.addEventListener("click", function () {
        P.setVideo(id, { status: b.getAttribute("data-set") });
        paintStatus();
        $("[data-nudge]").hidden = true;
        if (COURSE) paintOverall(COURSE);
      });
    });
    paintStatus();

    // 繼續播放提示
    if (rec.pos > 5 && (!dur || rec.pos < dur - 10)) {
      var ra = $("[data-resume-at]");
      ra.textContent = "從 " + fmt(rec.pos) + " 繼續";
      ra.hidden = false;
    }

    // 筆記
    var note = $("[data-note]"), saved = $("[data-saved]"), st;
    note.value = rec.note || "";
    note.addEventListener("input", function () {
      P.setVideo(id, { note: note.value });
      clearTimeout(st);
      saved.textContent = P.available ? "已儲存" : "此瀏覽器無法儲存";
      st = setTimeout(function () { saved.textContent = ""; }, 1500);
    });
    $("[data-stamp]").addEventListener("click", function () {
      var t = player && player.getCurrentTime ? player.getCurrentTime() : (P.video(id) || rec).pos;
      var tag = "[" + fmt(t) + "] ";
      var a = note.selectionStart || note.value.length;
      var pre = note.value.slice(0, a);
      if (pre && !/\n$/.test(pre)) tag = "\n" + tag;
      note.value = pre + tag + note.value.slice(a);
      note.focus();
      note.selectionStart = note.selectionEnd = a + tag.length;
      P.setVideo(id, { note: note.value });
    });

    // 練習檢核
    $$("[data-step]").forEach(function (cb) {
      var i = +cb.getAttribute("data-step");
      cb.checked = !!(rec.steps && rec.steps[i]);
      cb.addEventListener("change", function () {
        var cur = (P.video(id) || rec).steps || [false, false, false];
        var steps = cur.slice(); steps[i] = cb.checked;
        var patch = { steps: steps };
        if ((P.video(id) || rec).status === "todo") patch.status = "doing";
        P.setVideo(id, patch); paintStatus();
      });
    });

    // 播放器（點擊才載入；YouTube IFrame API 用來記住看到哪）
    function track() {
      clearInterval(ticking);
      ticking = setInterval(function () {
        if (!player || !player.getPlayerState || player.getPlayerState() !== 1) return;
        acc++;
        if (acc % 10 === 0) flush();
      }, 1000);
    }
    function flush() {
      if (!player || !player.getCurrentTime) return;
      var t = player.getCurrentTime(), d = player.getDuration ? player.getDuration() : dur;
      var cur = P.video(id) || rec;
      var patch = { pos: t, max: Math.max(cur.max || 0, t) };
      if (cur.status === "todo") patch.status = "doing";
      P.setVideo(id, patch);
      if (acc) P.addSeconds(acc);
      acc = 0;
      paintStatus();
      if (d && t / d >= 0.9 && (P.video(id) || {}).status !== "done") $("[data-nudge]").hidden = false;
    }
    function plainEmbed(start) {
      $("[data-player]").innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id + "?autoplay=1&rel=0&playsinline=1&start=" +
        Math.floor(start) + '" title="YouTube 影片" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    }
    function startPlayer(start) {
      if (player) { if (player.seekTo) { player.seekTo(start, true); player.playVideo(); } return; }
      var box = $("[data-player]");
      box.innerHTML = '<div id="yt-' + id + '"></div>';
      player = {}; // 避免重複建立
      var make = function () {
        player = new window.YT.Player("yt-" + id, {
          host: "https://www.youtube-nocookie.com", videoId: id,
          playerVars: { autoplay: 1, rel: 0, playsinline: 1, start: Math.floor(start) },
          events: {
            onStateChange: function (e) { if (e.data === 1) track(); else flush(); }
          }
        });
      };
      if (window.YT && window.YT.Player) return make();
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); make(); };
      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = function () { player = null; plainEmbed(start); };
      document.head.appendChild(s);
    }
    $("[data-facade]").addEventListener("click", function () {
      var p = (P.video(id) || rec).pos;
      startPlayer(p > 5 && (!dur || p < dur - 10) ? p : 0);
    });
    $$("[data-seek]").forEach(function (b) {
      b.addEventListener("click", function () {
        startPlayer(+b.getAttribute("data-seek"));
        $("[data-player]").scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    document.addEventListener("visibilitychange", function () { if (document.hidden) { flush(); P.flush(); } });
    window.addEventListener("pagehide", flush);
  }

  // ---------- 我的學習紀錄 ----------
  function initMe(c) {
    var msg = $("[data-msg]");
    function say(t) { msg.textContent = t; msg.hidden = false; setTimeout(function () { msg.hidden = true; }, 4000); }
    if (!P.available) $("[data-nostore]").hidden = false;

    var nick = $("[data-nick]");
    nick.value = P.state.learner || "";
    nick.addEventListener("input", function () { P.setLearner(nick.value); });

    function render() {
      var s = P.state, ids = Object.keys(c.videos);
      var done = ids.filter(function (i) { return status(i) === "done"; }).length;
      var doing = ids.filter(function (i) { return status(i) === "doing"; }).length;
      var unitsAll = [], passed = 0;
      c.modules.forEach(function (m) { m.units.forEach(function (u) { unitsAll.push(u); if ((s.units[u.id] || {}).criteria) passed++; }); });
      var secs = Object.keys(s.log).reduce(function (a, d) { return a + s.log[d]; }, 0);
      var streak = 0, d = new Date();
      if (!s.log[P.today(d)]) d.setDate(d.getDate() - 1);
      while (s.log[P.today(d)] > 0) { streak++; d.setDate(d.getDate() - 1); }
      $("[data-kpis]").innerHTML = [
        ["已完成影片", done + "<small>/" + ids.length + "</small>"],
        ["學習中", doing + "<small> 部</small>"],
        ["過關小單元", passed + "<small>/" + unitsAll.length + "</small>"],
        ["本站觀看時間", (secs >= 3600 ? (secs / 3600).toFixed(1) + "<small> 小時</small>" : Math.round(secs / 60) + "<small> 分鐘</small>")],
        ["連續學習", streak + "<small> 天</small>"]
      ].map(function (k) { return '<div class="kpi"><span>' + k[0] + "</span><b>" + k[1] + "</b></div>"; }).join("");

      // 近 12 週日曆
      var heat = $("[data-heat]"), cells = [], start = new Date();
      start.setDate(start.getDate() - start.getDay() - 7 * 11);
      for (var i = 0; i < 84; i++) {
        var x = new Date(start); x.setDate(start.getDate() + i);
        var key = P.today(x), sec = s.log[key] || 0;
        var lv = sec === 0 ? 0 : sec < 600 ? 1 : sec < 1800 ? 2 : sec < 3600 ? 3 : 4;
        var future = x > new Date();
        cells.push('<i class="h' + lv + (future ? " fut" : "") + '" title="' + key + "：" + Math.round(sec / 60) + ' 分鐘"></i>');
      }
      heat.innerHTML = cells.join("");

      // 各單元
      $("[data-mlist]").innerHTML = c.modules.map(function (m) {
        var st = modStats(m), pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
        return '<a class="mrow" href="' + BASE + "/m/" + m.id + '.html"><span class="mid">' + m.id + "</span><span class=\"mrow-t\">" + esc(m.title.split("：")[0]) +
          (m.core ? "" : ' <em class="tag">選修</em>') + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="small">' +
          st.done + "/" + st.total + " 部 · 過關 " + st.units + "/" + st.unitTotal + "</span></a>";
      }).join("");

      // 筆記與作品
      var items = [];
      unitsAll.forEach(function (u) {
        var x = s.units[u.id];
        if (x && (x.work || "").trim()) items.push({ at: x.updated, html: '<article class="nitem"><h3><a href="' + BASE + "/m/" + u.id.split(".")[0] + ".html#" + u.id + '">' +
          u.id + " " + esc(u.title) + '</a> <em class="tag">作品紀錄</em>' + (x.criteria ? ' <em class="tag ok">已過關</em>' : "") + "</h3><pre>" + esc(x.work) + "</pre></article>" });
      });
      Object.keys(s.videos).forEach(function (id) {
        var x = s.videos[id], v = c.videos[id];
        if (v && (x.note || "").trim()) items.push({ at: x.updated, html: '<article class="nitem"><h3><a href="' + BASE + "/v/" + id + '.html">' + esc(v.t) +
          '</a> <em class="tag">' + v.u + "</em>" + (x.status === "done" ? ' <em class="tag ok">已完成</em>' : "") + "</h3><pre>" + esc(x.note) + "</pre></article>" });
      });
      items.sort(function (a, b) { return (b.at || "").localeCompare(a.at || ""); });
      $("[data-notes]").innerHTML = items.length ? items.map(function (i) { return i.html; }).join("") : '<p class="muted">還沒有筆記。看影片時在右側「我的筆記」寫下重點，就會出現在這裡。</p>';
      $(".print-name") && $(".print-name").remove();
      var h = document.createElement("p");
      h.className = "print-name";
      h.textContent = "學習者：" + (s.learner || "（未填）") + "　列印日期：" + P.today();
      $(".mehead").appendChild(h);
      paintOverall(c);
    }
    render();

    $("[data-export]").addEventListener("click", function () {
      var blob = new Blob([P.exportJSON()], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "小黃老師3D學習紀錄-" + P.today().replace(/-/g, "") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      say("已下載備份檔，請存到雲端硬碟或隨身碟。");
    });
    $("[data-import]").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then(function (t) {
        try { P.importJSON(t); nick.value = P.state.learner || ""; render(); say("匯入完成，已和目前紀錄合併（保留較新的內容）。"); }
        catch (err) { say("匯入失敗：" + (err.message || "檔案格式不正確")); }
        e.target.value = "";
      });
    });
    $("[data-print]").addEventListener("click", function () { window.print(); });
    $("[data-clear]").addEventListener("click", function () {
      if (!confirm("確定清除這台電腦上的全部學習紀錄？建議先匯出備份。此動作無法復原。")) return;
      P.clear(); nick.value = ""; render(); say("已清除。");
    });
  }

  var c$ = loadCourse().catch(function () { return null; });
  if (PAGE === "video") initVideo();
  c$.then(function (c) {
    if (!c) return;
    paintOverall(c);
    if (PAGE === "index") initIndex(c);
    else if (PAGE === "module") initModule(c);
    else if (PAGE === "me") initMe(c);
  });
})();
