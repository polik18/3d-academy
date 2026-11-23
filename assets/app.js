/* 小黃老師 3D 自學館：頁面互動（課程地圖、單元、影片、學習紀錄、搜尋、徽章） */
(function () {
  "use strict";
  var P = window.PK3D;
  var BASE = document.documentElement.getAttribute("data-base") || ".";
  var me = document.currentScript || document.querySelector("script[data-page]");
  var PAGE = (me && me.getAttribute("data-page")) || "";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var LABEL = { todo: "", doing: "學習中", done: "✓ 完成" };
  var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function status(id) { var v = P.video(id); return v ? v.status : "todo"; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無法儲存時略過 */ } }

  // ---------- 小工具：通知、慶祝 ----------
  function toast(html, kind) {
    var box = $("[data-toasts]");
    if (!box) return;
    var t = document.createElement("div");
    t.className = "toast-item" + (kind ? " " + kind : "");
    t.innerHTML = html;
    box.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3600);
    setTimeout(function () { t.remove(); }, 4100);
  }
  function celebrate(el) {
    if (REDUCED || !el) return;
    var r = el.getBoundingClientRect();
    var colors = ["#ff7a45", "#f59e0b", "#2dd4bf", "#4ade80", "#60a5fa", "#f472b6"];
    for (var i = 0; i < 28; i++) {
      var p = document.createElement("i");
      p.className = "confetti";
      var a = (Math.PI * 2 * i) / 28 + Math.random() * 0.4, d = 60 + Math.random() * 90;
      p.style.left = r.left + r.width / 2 + "px";
      p.style.top = r.top + r.height / 2 + "px";
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--dx", Math.cos(a) * d + "px");
      p.style.setProperty("--dy", Math.sin(a) * d - 40 + "px");
      p.style.setProperty("--rot", Math.random() * 720 - 360 + "deg");
      document.body.appendChild(p);
      setTimeout(p.remove.bind(p), 1100);
    }
  }

  // ---------- 主題切換 ----------
  (function theme() {
    var btn = $("[data-theme-toggle]");
    if (!btn) return;
    var root = document.documentElement;
    function effective() {
      var t = root.getAttribute("data-theme");
      if (t) return t;
      return window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    function label() { btn.setAttribute("aria-label", effective() === "dark" ? "切換成淺色" : "切換成深色"); }
    btn.addEventListener("click", function () {
      var next = effective() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      lsSet("pk3d.theme", next);
      label();
    });
    label();
  })();

  // ---------- 進場動畫 ----------
  function reveal() {
    if (REDUCED || !("IntersectionObserver" in window)) return;
    var els = $$(".band, .unit-h, .mcard, .vgrid > li, .kpi, .panel, .badge, .diagram-wrap, .goals");
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -6% 0px" });
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < innerHeight) return; // 首屏內容不延遲
      var sib = el.parentNode ? Array.prototype.indexOf.call(el.parentNode.children, el) : 0;
      el.style.transitionDelay = Math.min(sib % 8, 6) * 45 + "ms";
      el.classList.add("reveal");
      io.observe(el);
    });
  }

  // 卡片光暈跟著滑鼠
  document.addEventListener("pointermove", function (e) {
    var card = e.target.closest && e.target.closest(".mcard");
    if (!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
  }, { passive: true });

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
    var bar = $("[data-mbar]", el), txt = $("[data-mpct]", el), ring = $("[data-ring]", el), rp = $("[data-ringpct]", el);
    if (bar) bar.style.width = pct + "%";
    if (ring) ring.style.setProperty("--p", pct);
    if (rp) rp.textContent = pct + "%";
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
  function streakOf(s) {
    var n = 0, d = new Date();
    if (!s.log[P.today(d)]) d.setDate(d.getDate() - 1);
    while (s.log[P.today(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ---------- 成就徽章 ----------
  function badges(c) {
    var s = P.state, ids = Object.keys(c.videos);
    var done = ids.filter(function (i) { return status(i) === "done"; }).length;
    var passed = Object.keys(s.units).filter(function (u) { return s.units[u].criteria; }).length;
    var notes = Object.keys(s.videos).filter(function (i) { return (s.videos[i].note || "").trim(); }).length;
    var secs = Object.keys(s.log).reduce(function (a, d) { return a + s.log[d]; }, 0);
    var streak = streakOf(s);
    var modDone = function (id) { var m = c.modules.filter(function (x) { return x.id === id; })[0]; var st = m && modStats(m); return st && st.total > 0 && st.done === st.total; };
    var coreDone = c.modules.filter(function (m) { return m.core; }).every(function (m) { return modDone(m.id); });
    var printDone = modDone("M5");
    return [
      { id: "v1", icon: "▶", name: "第一步", desc: "完成第 1 部影片", got: done >= 1 },
      { id: "v10", icon: "10", name: "漸入佳境", desc: "完成 10 部影片", got: done >= 10 },
      { id: "v30", icon: "30", name: "建模學徒", desc: "完成 30 部影片", got: done >= 30 },
      { id: "v80", icon: "80", name: "建模職人", desc: "完成 80 部影片", got: done >= 80 },
      { id: "n1", icon: "✎", name: "認真筆記", desc: "寫下第 1 則筆記", got: notes >= 1 },
      { id: "n10", icon: "✎✎", name: "筆記達人", desc: "10 部影片寫了筆記", got: notes >= 10 },
      { id: "u1", icon: "✓", name: "過關！", desc: "通過第 1 個小單元", got: passed >= 1 },
      { id: "u10", icon: "✓✓", name: "關關難過", desc: "通過 10 個小單元", got: passed >= 10 },
      { id: "s3", icon: "3d", name: "三天不斷", desc: "連續學習 3 天", got: streak >= 3 },
      { id: "s7", icon: "7d", name: "一週習慣", desc: "連續學習 7 天", got: streak >= 7 },
      { id: "h1", icon: "1h", name: "專注一小時", desc: "在本站累計看 1 小時", got: secs >= 3600 },
      { id: "h10", icon: "10h", name: "十小時功力", desc: "在本站累計看 10 小時", got: secs >= 36000 },
      { id: "m0", icon: "M0", name: "準備就緒", desc: "看完 M0 全部影片", got: modDone("M0") },
      { id: "m5", icon: "M5", name: "印出來了", desc: "看完 M5 列印工作流", got: printDone },
      { id: "core", icon: "★", name: "主線制霸", desc: "看完主線全部影片", got: coreDone }
    ];
  }
  function checkBadges(c, silent) {
    if (!c) return;
    var seen = [];
    try { seen = JSON.parse(lsGet("pk3d.badges") || "null"); } catch (e) { seen = null; }
    var list = badges(c).filter(function (b) { return b.got; }).map(function (b) { return b.id; });
    if (!Array.isArray(seen)) { lsSet("pk3d.badges", JSON.stringify(list)); return; }
    var fresh = badges(c).filter(function (b) { return b.got && seen.indexOf(b.id) < 0; });
    if (fresh.length) {
      lsSet("pk3d.badges", JSON.stringify(seen.concat(fresh.map(function (b) { return b.id; }))));
      if (!silent) fresh.forEach(function (b) { toast('<span class="medal sm">' + esc(b.icon) + '</span><span><b>獲得徽章：' + esc(b.name) + "</b><br>" + esc(b.desc) + "</span>", "badge-toast"); });
    }
  }

  // ---------- 搜尋 ----------
  (function search() {
    var dlg = $("[data-search]"), input = $("[data-search-input]"), res = $("[data-search-res]");
    if (!dlg || !input) return;
    var items = null, sel = 0, shown = [];
    function build(c) {
      var unitT = {}, modT = {};
      c.modules.forEach(function (m) { modT[m.id] = m.title; m.units.forEach(function (u) { unitT[u.id] = u.title; }); });
      items = Object.keys(c.videos).map(function (id) {
        var v = c.videos[id];
        return { id: id, t: v.t, u: v.u, ut: unitT[v.u] || "", hay: (v.t + " " + v.u + " " + (unitT[v.u] || "") + " " + (modT[v.m] || "")).toLowerCase() };
      });
      var hint = $(".search-hint");
      if (hint) hint.textContent = "↑↓ 選擇 · Enter 開啟 · 共 " + items.length + " 部影片";
    }
    function hl(t, terms) {
      var out = esc(t);
      terms.forEach(function (w) { if (w) out = out.replace(new RegExp("(" + esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>"); });
      return out;
    }
    function render() {
      if (!items) { res.innerHTML = '<li class="empty">載入中…</li>'; return; }
      var q = input.value.trim().toLowerCase(), terms = q.split(/\s+/).filter(Boolean);
      shown = terms.length ? items.filter(function (i) { return terms.every(function (w) { return i.hay.indexOf(w) >= 0; }); }).slice(0, 40) : [];
      if (!terms.length) {
        var last = P.state.last && COURSE && COURSE.videos[P.state.last.id] ? [items.filter(function (i) { return i.id === P.state.last.id; })[0]] : [];
        shown = last.concat(items.filter(function (i) { return status(i.id) === "doing" && (!last[0] || i.id !== last[0].id); }).slice(0, 5));
        if (!shown.length) { res.innerHTML = '<li class="empty">試試：<button type="button" data-q="Cura">Cura</button><button type="button" data-q="倒角">倒角</button><button type="button" data-q="指尖陀螺">指尖陀螺</button><button type="button" data-q="Spatial">Spatial</button><button type="button" data-q="汽車">汽車</button></li>'; return; }
      }
      if (!shown.length) { res.innerHTML = '<li class="empty">找不到「' + esc(input.value) + '」，換個關鍵字試試。</li>'; return; }
      sel = Math.min(sel, shown.length - 1);
      res.innerHTML = (terms.length ? "" : '<li class="group">最近在學</li>') + shown.map(function (i, k) {
        var s = status(i.id);
        return '<li role="option" aria-selected="' + (k === sel) + '"><a href="' + BASE + "/v/" + i.id + '.html" data-k="' + k + '">' +
          '<img src="https://i.ytimg.com/vi/' + i.id + '/default.jpg" alt="" width="64" height="48" loading="lazy">' +
          "<span><b>" + hl(i.t, terms) + "</b><small>" + i.u + " " + esc(i.ut) + (s !== "todo" ? " · " + LABEL[s] : "") + "</small></span></a></li>";
      }).join("");
    }
    function open() {
      if (typeof dlg.showModal !== "function") { location.href = BASE + "/#map"; return; }
      if (!dlg.open) dlg.showModal();
      input.value = ""; sel = 0; render(); input.focus();
      if (!items) (COURSE ? Promise.resolve(COURSE) : loadCourse()).then(function (c) { build(c); render(); });
    }
    $$("[data-search-open]").forEach(function (b) { b.addEventListener("click", open); });
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); open(); }
    });
    input.addEventListener("input", function () { sel = 0; render(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!shown.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
        render();
        var cur = $('[aria-selected="true"]', res); if (cur) cur.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && shown[sel]) { location.href = BASE + "/v/" + shown[sel].id + ".html"; }
    });
    res.addEventListener("click", function (e) {
      var q = e.target.closest("[data-q]");
      if (q) { input.value = q.getAttribute("data-q"); render(); input.focus(); }
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
  })();

  // ---------- 課程地圖 ----------
  function initIndex(c) {
    var here = null;
    c.modules.forEach(function (m) {
      var st = modStats(m);
      $$('[data-module="' + m.id + '"]').forEach(function (el) { paintModule(el, st); });
      if (!here && m.core && st.done < st.total) here = m.id;
    });
    var hereEl = here && $('.mcard[data-module="' + here + '"]');
    if (hereEl && Object.keys(P.state.videos).length) {
      hereEl.classList.add("is-here");
      var tag = document.createElement("span"); tag.className = "here"; tag.textContent = "你在這裡"; hereEl.appendChild(tag);
    }
    var last = P.state.last && P.state.last.id;
    var lastV = last && P.video(last);
    var next = order(c).filter(function (id) { return status(id) !== "done"; })[0];
    var pick = lastV && lastV.status !== "done" ? last : next;
    var cta = $("[data-continue]");
    if (!pick || !cta) return;
    if (Object.keys(P.state.videos).length > 0) {
      cta.textContent = "繼續學習";
      cta.href = BASE + "/v/" + pick + ".html";
      var v = c.videos[pick], pv = P.video(pick);
      var pct = pv && v.d ? Math.min(100, Math.round((pv.pos / v.d) * 100)) : 0;
      var card = $("[data-resume]");
      card.innerHTML = '<p class="eyebrow">' + (pick === last ? "上次看到" : "建議下一部") + "</p>" +
        '<a href="' + BASE + "/v/" + pick + '.html"><span class="rthumb"><img src="https://i.ytimg.com/vi/' + pick + '/mqdefault.jpg" alt="" width="320" height="180">' +
        '<span class="bar"><i style="width:' + pct + '%"></i></span></span><b>' + esc(v.t) + "</b></a><p class=\"muted small\">" + esc(v.u) + (pv && pv.pos > 5 ? " · 從 " + fmt(pv.pos) + " 繼續" : "") + "</p>";
      card.hidden = false;
    }
  }

  // ---------- 單元頁 ----------
  function initModule(c) {
    function paintCards() {
      $$("[data-vid]").forEach(function (a) {
        var s = status(a.getAttribute("data-vid"));
        a.classList.toggle("is-done", s === "done");
        a.classList.toggle("is-doing", s === "doing");
        var badge = $("[data-status]", a);
        if (badge) badge.textContent = LABEL[s];
      });
    }
    paintCards();
    $$("section[data-unit]").forEach(function (sec) {
      var id = sec.getAttribute("data-unit");
      var u = P.unit(id) || {};
      var crit = $("[data-crit]", sec), work = $("[data-work]", sec);
      if (crit) {
        crit.checked = !!u.criteria;
        sec.classList.toggle("is-passed", !!u.criteria);
        crit.addEventListener("change", function () {
          P.setUnit(id, { criteria: crit.checked });
          sec.classList.toggle("is-passed", crit.checked);
          if (crit.checked) { celebrate(crit); toast("<b>" + id + " 過關！</b> 記得寫下作品紀錄。", "ok"); }
          refresh(); checkBadges(c);
        });
      }
      if (work) { work.value = u.work || ""; work.addEventListener("input", function () { P.setUnit(id, { work: work.value }); }); }
      var vids = $$("[data-vid]", sec).map(function (a) { return a.getAttribute("data-vid"); });
      var cnt = $("[data-ucount]", sec);
      if (cnt && vids.length) {
        var d = vids.filter(function (x) { return status(x) === "done"; }).length;
        cnt.innerHTML = d ? '<span class="mini-bar"><i style="width:' + Math.round((d / vids.length) * 100) + '%"></i></span>完成 ' + d + "/" + vids.length : vids.length + " 部影片";
      }
    });
    function refresh() {
      var el = $(".mhead");
      var m = c.modules.filter(function (x) { return x.id === el.getAttribute("data-module"); })[0];
      if (m) paintModule(el, modStats(m));
    }
    refresh();

    // 篩選
    var f = { status: "all", lv: "all" };
    function apply() {
      var shownN = 0, total = 0;
      $$(".vgrid > li").forEach(function (li) {
        total++;
        var lv = +li.getAttribute("data-lv"), id = $("[data-vid]", li).getAttribute("data-vid"), s = status(id);
        var okS = f.status === "all" || (f.status === "done" ? s === "done" : s !== "done");
        var okL = f.lv === "all" || (f.lv === "1-2" ? lv <= 2 : f.lv === "3" ? lv === 3 : lv >= 4);
        li.hidden = !(okS && okL);
        if (!li.hidden) shownN++;
      });
      $$("section[data-unit]").forEach(function (sec) {
        var g = $(".vgrid", sec);
        if (!g) return;
        var any = $$(":scope > li:not([hidden])", g).length > 0;
        sec.classList.toggle("is-filtered-empty", !any);
      });
      var fc = $("[data-fcount]");
      if (fc) fc.textContent = f.status === "all" && f.lv === "all" ? "共 " + total + " 部" : "顯示 " + shownN + " / " + total + " 部";
    }
    $$("[data-filter]").forEach(function (seg) {
      var key = seg.getAttribute("data-filter");
      $$("button", seg).forEach(function (b) {
        b.addEventListener("click", function () {
          f[key] = b.getAttribute("data-v");
          $$("button", seg).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          apply();
        });
      });
    });
    apply();

    // 目錄標示目前位置
    if ("IntersectionObserver" in window) {
      var links = {};
      $$(".toc a").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          $$(".toc a").forEach(function (a) { a.classList.remove("is-active"); });
          var a = links[e.target.id];
          if (a) { a.classList.add("is-active"); var t = a.parentNode; if (t.scrollWidth > t.clientWidth) t.scrollTo({ left: a.offsetLeft - 16, behavior: REDUCED ? "auto" : "smooth" }); }
        });
      }, { rootMargin: "-35% 0px -60% 0px" });
      $$("section.unit").forEach(function (s) { io.observe(s); });
    }
  }

  // ---------- 影片頁 ----------
  function initVideo() {
    var art = $("[data-video]");
    var id = art.getAttribute("data-video");
    var dur = +art.getAttribute("data-dur") || 0;
    var nextId = art.getAttribute("data-next"), nextT = art.getAttribute("data-next-title"), back = art.getAttribute("data-back");
    var rec = P.video(id) || { status: "todo", pos: 0, max: 0, note: "", steps: [false, false, false] };
    var player = null, ticking = null, acc = 0;
    var chapBtns = $$("[data-seek]");

    function paintStatus() {
      var s = (P.video(id) || rec).status;
      $$("[data-set]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-set") === s)); });
      art.classList.toggle("is-done", s === "done");
    }
    function showNext(reason) {
      var box = $("[data-nextup]");
      box.innerHTML = nextId
        ? '<span class="nx-k">' + (reason === "end" ? "影片播完了，" : "太棒了！") + "下一部</span>" +
          '<a class="nx" href="' + nextId + '.html"><img src="https://i.ytimg.com/vi/' + nextId + '/mqdefault.jpg" alt="" width="160" height="90"><b>' + esc(nextT) + '</b><span class="nx-go">繼續 →</span></a>'
        : '<span class="nx-k">這個小單元的影片都看完了！</span><a class="btn sm" href="' + back + '">回單元頁完成過關自評 →</a>';
      box.hidden = false;
    }
    $$("[data-set]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-set");
        var was = (P.video(id) || rec).status;
        P.setVideo(id, { status: v });
        paintStatus();
        $("[data-nudge]").hidden = true;
        if (v === "done" && was !== "done") { celebrate(b); showNext("done"); }
        if (v !== "done") $("[data-nextup]").hidden = true;
        if (COURSE) { paintOverall(COURSE); checkBadges(COURSE); }
      });
    });
    paintStatus();

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
      saved.textContent = P.available ? "✓ 已儲存" : "此瀏覽器無法儲存";
      st = setTimeout(function () { saved.textContent = ""; }, 1500);
    });
    note.addEventListener("change", function () { if (COURSE) checkBadges(COURSE); });
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
    function paintSteps() {
      var steps = (P.video(id) || rec).steps || [];
      var n = steps.filter(Boolean).length;
      var m = $("[data-stepmeter]");
      if (m) m.style.setProperty("--n", n);
    }
    $$("[data-step]").forEach(function (cb) {
      var i = +cb.getAttribute("data-step");
      cb.checked = !!(rec.steps && rec.steps[i]);
      cb.addEventListener("change", function () {
        var cur = (P.video(id) || rec).steps || [false, false, false];
        var steps = cur.slice(); steps[i] = cb.checked;
        var patch = { steps: steps };
        if ((P.video(id) || rec).status === "todo") patch.status = "doing";
        P.setVideo(id, patch); paintStatus(); paintSteps();
        if (steps.every(Boolean) && (P.video(id) || {}).status !== "done") toast("三項練習都完成了！可以按「✓ 已完成」。", "ok");
      });
    });
    paintSteps();

    // 章節：播放時標出目前章節
    function markChapter(t) {
      var cur = null;
      chapBtns.forEach(function (b) { if (+b.getAttribute("data-seek") <= t + 0.5) cur = b; });
      chapBtns.forEach(function (b) { b.classList.toggle("is-active", b === cur); });
    }

    function track() {
      clearInterval(ticking);
      ticking = setInterval(function () {
        if (!player || !player.getPlayerState || player.getPlayerState() !== 1) return;
        acc++;
        if (chapBtns.length) markChapter(player.getCurrentTime());
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
      if (chapBtns.length) markChapter(start);
      if (player) { if (player.seekTo) { player.seekTo(start, true); player.playVideo(); } return; }
      var box = $("[data-player]");
      box.classList.add("is-loading");
      box.innerHTML = '<div id="yt-' + id + '"></div>';
      player = {};
      var make = function () {
        player = new window.YT.Player("yt-" + id, {
          host: "https://www.youtube-nocookie.com", videoId: id,
          playerVars: { autoplay: 1, rel: 0, playsinline: 1, start: Math.floor(start) },
          events: {
            onReady: function () { box.classList.remove("is-loading"); },
            onStateChange: function (e) {
              if (e.data === 1) track(); else flush();
              if (e.data === 0) { $("[data-nudge]").hidden = (P.video(id) || {}).status === "done"; showNext("end"); }
            }
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
    chapBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        startPlayer(+b.getAttribute("data-seek"));
        $("[data-player]").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
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

    function countUp(el) {
      if (REDUCED) return;
      var b = $("b", el), m = /^([\d.]+)/.exec(b.textContent);
      if (!m) return;
      var end = parseFloat(m[1]), dec = (m[1].split(".")[1] || "").length, rest = b.innerHTML.slice(m[1].length), t0 = performance.now();
      (function step(t) {
        var k = Math.min(1, (t - t0) / 700), v = end * (1 - Math.pow(1 - k, 3));
        b.innerHTML = v.toFixed(dec) + rest;
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }

    function render() {
      var s = P.state, ids = Object.keys(c.videos);
      var done = ids.filter(function (i) { return status(i) === "done"; }).length;
      var doing = ids.filter(function (i) { return status(i) === "doing"; }).length;
      var unitsAll = [], passed = 0;
      c.modules.forEach(function (m) { m.units.forEach(function (u) { unitsAll.push(u); if ((s.units[u.id] || {}).criteria) passed++; }); });
      var secs = Object.keys(s.log).reduce(function (a, d) { return a + s.log[d]; }, 0);
      var pct = Math.round((done / ids.length) * 100);
      $("[data-kpis]").innerHTML =
        '<div class="kpi kpi-ring"><span class="ring big" style="--p:' + pct + '"><b>' + pct + "%</b></span><span>整體進度</span></div>" + [
        ["已完成影片", done + "<small>/" + ids.length + "</small>"],
        ["學習中", doing + "<small> 部</small>"],
        ["過關小單元", passed + "<small>/" + unitsAll.length + "</small>"],
        ["本站觀看時間", (secs >= 3600 ? (secs / 3600).toFixed(1) + "<small> 小時</small>" : Math.round(secs / 60) + "<small> 分鐘</small>")],
        ["連續學習", streakOf(s) + "<small> 天</small>"]
      ].map(function (k) { return '<div class="kpi"><span>' + k[0] + "</span><b>" + k[1] + "</b></div>"; }).join("");
      $$(".kpi:not(.kpi-ring)").forEach(countUp);

      // 徽章
      var bl = badges(c), got = bl.filter(function (b) { return b.got; }).length;
      $("[data-badgecount]").textContent = got + " / " + bl.length;
      $("[data-badges]").innerHTML = bl.map(function (b) {
        return '<div class="badge' + (b.got ? " got" : "") + '" title="' + esc(b.desc) + '"><span class="medal">' + esc(b.icon) + "</span><b>" + esc(b.name) + "</b><small>" + esc(b.desc) + "</small></div>";
      }).join("");
      checkBadges(c, true);

      // 近 12 週日曆
      var heat = $("[data-heat]"), cells = [], start = new Date();
      start.setDate(start.getDate() - start.getDay() - 7 * 11);
      for (var i = 0; i < 84; i++) {
        var x = new Date(start); x.setDate(start.getDate() + i);
        var key = P.today(x), sec = s.log[key] || 0;
        var lv = sec === 0 ? 0 : sec < 600 ? 1 : sec < 1800 ? 2 : sec < 3600 ? 3 : 4;
        var future = x > new Date();
        cells.push('<i class="h' + lv + (future ? " fut" : "") + (key === P.today() ? " today" : "") + '" title="' + key + "：" + Math.round(sec / 60) + ' 分鐘"></i>');
      }
      heat.innerHTML = cells.join("");

      // 各單元
      $("[data-mlist]").innerHTML = c.modules.map(function (m) {
        var st = modStats(m), p = st.total ? Math.round((st.done / st.total) * 100) : 0;
        return '<a class="mrow" href="' + BASE + "/m/" + m.id + '.html"><span class="mid">' + m.id + "</span><span class=\"mrow-t\">" + esc(m.title.split("：")[0]) +
          (m.core ? "" : ' <em class="tag">選修</em>') + '</span><span class="bar"><i style="width:' + p + '%"></i></span><span class="small">' +
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
      var old = $(".print-name"); if (old) old.remove();
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
      P.clear(); lsSet("pk3d.badges", "[]"); nick.value = ""; render(); say("已清除。");
    });
  }

  var c$ = loadCourse().catch(function () { return null; });
  if (PAGE === "video") initVideo();
  c$.then(function (c) {
    if (c) {
      paintOverall(c);
      if (PAGE === "index") initIndex(c);
      else if (PAGE === "module") initModule(c);
      else if (PAGE === "me") initMe(c);
      checkBadges(c, PAGE === "me");
    }
    reveal();
  });
})();
