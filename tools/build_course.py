#!/usr/bin/env python3
"""小黃老師 3D 自學館：把私有課程 JSON 轉成公開資料與靜態頁。

用法：python3 -I tools/build_course.py [--src <課程資料夾>]
- 只輸出白名單欄位；YouTube Studio 私有資訊（後台連結、觀看數、收益）一律丟棄。
- 只收公開影片：visibility=public，或 tools/oembed-check.json 驗證可嵌入且作者為小黃老師。
- 建置後掃描輸出，含禁用字串即失敗。
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path.home() / "Desktop" / "小黃老師3d列印教學檔案"
SITE = "https://polik18.github.io/3d-academy/"
CHANNEL = "https://www.youtube.com/@polikjames"
ASSET_V = "20261123"
FORBIDDEN = ["studio.youtube.com", "US$", "row_text", "matched_queries", "search_query"]
CORE = ["M0", "M1", "M2", "M3", "M5", "M7", "M9"]

esc = html.escape


# ---------- 資料轉換 ----------
def parse_duration(s: str) -> int:
    s = (s or "").strip()
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s)
    if m:
        h, mi, se = (int(x or 0) for x in m.groups())
        return h * 3600 + mi * 60 + se
    if re.fullmatch(r"\d+(:\d{1,2}){1,2}", s):
        sec = 0
        for p in s.split(":"):
            sec = sec * 60 + int(p)
        return sec
    return 0


def fmt_time(sec: int) -> str:
    h, r = divmod(int(sec), 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def iso_duration(sec: int) -> str:
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return "PT" + (f"{h}H" if h else "") + (f"{m}M" if m else "") + f"{s}S"


def parse_date(s: str) -> str:
    s = s or ""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return "-".join(m.groups())
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return ""


TS = r"(?<![\d:])(\d{1,2}(?::\d{2}){1,2})(?![\d:])"


def to_sec(t: str) -> int:
    v = 0
    for p in t.split(":"):
        v = v * 60 + int(p)
    return v


def parse_chapters(desc: str) -> list[dict]:
    desc = desc or ""
    hits = list(re.finditer(TS, desc))
    if len(hits) < 3:
        return []
    out = []
    for i, h in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(desc)
        label = desc[h.end():end]
        label = re.split(r"\s#|\s*【|\n", label)[0].strip(" ：:-–|")
        if label:
            out.append({"t": to_sec(h.group(1)), "label": label[:80]})
    if not out or out[0]["t"] > 30:
        return []
    # 時間必須遞增
    ts = [c["t"] for c in out]
    return out if ts == sorted(ts) else []


def parse_links(desc: str) -> list[str]:
    out = []
    for u in re.findall(r"https?://[^\s，。、）)】✔「」<>\"]+", desc or ""):
        u = u.rstrip(".,;:")
        if "studio.youtube.com" in u or u in out or len(u) > 300:
            continue
        out.append(u)
    return out[:8]


def link_label(u: str) -> str:
    host = re.sub(r"^https?://(www\.)?", "", u).split("/")[0]
    names = {"thingiverse.com": "Thingiverse 模型／練習檔", "youtube.com": "YouTube 播放清單／影片", "youtu.be": "相關影片",
             "github.com": "GitHub 外掛下載", "drive.google.com": "練習檔（Google 雲端硬碟）", "tinkercad.com": "Tinkercad 官網",
             "zh.wikipedia.org": "維基百科參考圖", "en.wikipedia.org": "維基百科參考圖"}
    return names.get(host, host)


def make_summary(desc: str, title: str) -> str:
    d = desc or ""
    d = re.split(r"【?\s*(?:重點)?時間軸|Timestamps|章節[:：]|" + TS, d)[0]
    d = re.sub(r"https?://\S+", "", d)
    d = re.sub(r"#\S+", "", d)
    d = re.sub(r"\s+", " ", d).strip(" ：:-")
    d = d.rstrip(".…")
    if d in ("", "新增說明") or d == title or len(d) < 24:
        return ""
    if len(d) > 240:
        cut = max(d.rfind(p, 0, 240) for p in "。！？!?")
        d = d[: cut + 1] if cut > 80 else d[:238] + "…"
    return d


def load(src: Path) -> dict:
    plan = json.loads((src / "self-study-course-plan.json").read_text("utf-8"))
    cat = json.loads((src / "owned-channel-education-catalog.json").read_text("utf-8"))
    full = {i["video_id"]: i.get("studio_description") or "" for i in cat["items"]}
    oembed_path = ROOT / "tools" / "oembed-check.json"
    oembed = json.loads(oembed_path.read_text("utf-8")) if oembed_path.exists() else {}

    videos: dict[str, dict] = {}
    skipped = []
    for it in plan["items"]:
        vid = it["video_id"]
        vis = it.get("visibility")
        ok = vis == "public" or (
            vis == "unknown" and oembed.get(vid, {}).get("ok") and oembed[vid].get("author") == "小黃老師"
        )
        if not ok:
            skipped.append((vid, vis))
            continue
        desc = full.get(vid) or it.get("studio_description") or ""
        title = it["title"].strip()
        summary = make_summary(desc, title)
        videos[vid] = {
            "id": vid,
            "title": title,
            "dur": parse_duration(it.get("duration", "")),
            "date": parse_date(it.get("published_date", "")),
            "lv": int((it.get("difficulty") or {}).get("score") or 1),
            "lvLabel": (it.get("difficulty") or {}).get("label") or "",
            "module": it["recommended_module"],
            "unit": it["recommended_unit"],
            "series": it.get("series") or "",
            "lesson": it.get("series_lesson"),
            "prereq": it.get("prerequisite_module") or "",
            "summary": summary,
            "chapters": parse_chapters(desc),
            "links": parse_links(full.get(vid, "")),
            "review": it.get("content_detail_status") != "owner_studio_description_and_timestamps" or not summary,
        }

    units = []
    for u in plan["units"]:
        vids = [v["id"] for v in videos.values() if v["unit"] == u["id"]]
        # 系列影片依課次排列，其餘保持課程計畫順序
        vids.sort(key=lambda i: (videos[i]["lesson"] is None, videos[i]["lesson"] or 0))
        units.append({"id": u["id"], "module": u["module_id"], "title": u["title"],
                      "purpose": u["purpose"], "exit": u["exit_criteria"], "videos": vids})
    modules = []
    for m in plan["modules"]:
        mu = [u for u in units if u["module"] == m["id"]]
        modules.append({
            "id": m["id"], "title": m["title"], "level": m["level"], "lv": m["difficulty"],
            "weeks": m["weeks"], "purpose": m["purpose"], "outcomes": m["outcomes"],
            "exit": m["exit_criteria"], "core": m["id"] in CORE, "units": mu,
            "count": sum(len(u["videos"]) for u in mu),
        })
    return {"modules": modules, "videos": videos, "skipped": skipped,
            "weeks": plan.get("recommended_total_weeks", "")}


# ---------- 圖解（inline SVG，跟隨主題色） ----------
def svg_workflow() -> str:
    steps = [("建模", "Blender／Tinkercad", "M1–M3"), ("匯出", "STL・3MF", "M5.1"),
             ("切片", "Cura・Bambu", "M5.2"), ("列印", "FDM・光固化", "M5.4"), ("展示", "Sketchfab・Spatial", "M7")]
    w, gap = 150, 34
    parts = []
    for i, (a, b, c) in enumerate(steps):
        x = i * (w + gap)
        parts.append(
            f'<g transform="translate({x},0)"><rect class="s-box" x="0" y="10" width="{w}" height="92" rx="14"/>'
            f'<text class="s-tag" x="14" y="34">{c}</text><text class="s-h" x="14" y="66">{a}</text>'
            f'<text class="s-sub" x="14" y="88">{b}</text></g>')
        if i < len(steps) - 1:
            ax = x + w + 4
            parts.append(f'<path class="s-arrow" d="M{ax} 56 h{gap-10} m-7 -6 l7 6 l-7 6"/>')
    total = len(steps) * w + (len(steps) - 1) * gap
    return (f'<svg class="diagram" viewBox="-2 0 {total+4} 112" role="img" aria-label="3D 列印工作流程：建模、匯出、切片、列印、展示">'
            + "".join(parts) + "</svg>")


def svg_axes() -> str:
    return ('<svg class="diagram diagram-sm" viewBox="0 0 360 200" role="img" aria-label="Blender 座標軸：X 紅、Y 綠、Z 藍；G 移動、R 旋轉、S 縮放">'
            '<g transform="translate(110,130)"><path class="ax-x" d="M0 0 L110 34"/><path class="ax-y" d="M0 0 L80 -46"/><path class="ax-z" d="M0 0 L0 -110"/>'
            '<text class="ax-xt" x="116" y="44">X</text><text class="ax-yt" x="86" y="-50">Y</text><text class="ax-zt" x="-6" y="-116">Z</text>'
            '<path class="s-cube" d="M-60 30 l40 12 l30 -18 l-40 -12z M-60 30 v-40 l40 12 v40 M-20 2 l30 -18 v40 M-60 -10 l30 -18 l40 12"/></g>'
            '<g class="s-keys" transform="translate(250,40)"><rect x="0" y="0" width="96" height="34" rx="8"/><text x="12" y="23">G 移動</text>'
            '<rect x="0" y="46" width="96" height="34" rx="8"/><text x="12" y="69">R 旋轉</text>'
            '<rect x="0" y="92" width="96" height="34" rx="8"/><text x="12" y="115">S 縮放</text></g></svg>')


def svg_mesh() -> str:
    return ('<svg class="diagram diagram-sm" viewBox="0 0 360 200" role="img" aria-label="網格三要素：頂點、邊、面，以及面的法線方向">'
            '<path class="s-face" d="M60 150 L170 170 L220 70 L110 50 Z"/>'
            '<path class="s-edge" d="M60 150 L170 170 L220 70 L110 50 Z M60 150 L220 70"/>'
            '<g class="s-vert"><circle cx="60" cy="150" r="6"/><circle cx="170" cy="170" r="6"/><circle cx="220" cy="70" r="6"/><circle cx="110" cy="50" r="6"/></g>'
            '<path class="s-normal" d="M140 110 L150 30 m-8 10 l8 -10 l7 11"/>'
            '<text class="s-sub" x="230" y="64">頂點 Vertex</text><text class="s-sub" x="182" y="182">邊 Edge</text>'
            '<text class="s-sub" x="40" y="98">面 Face</text><text class="s-tag" x="160" y="30">法線 Normal</text></svg>')


def svg_slice() -> str:
    layers = "".join(f'<rect class="s-layer" x="{120 - i*2}" y="{150 - i*12}" width="{80 + i*4}" height="9" rx="2"/>' for i in range(8))
    return ('<svg class="diagram diagram-sm" viewBox="0 0 360 200" role="img" aria-label="切片：模型被切成一層層，懸空處需要支撐，底部需要平台附著">'
            '<rect class="s-bed" x="30" y="166" width="300" height="12" rx="3"/>'
            + layers +
            '<rect class="s-over" x="200" y="66" width="70" height="9" rx="2"/>'
            '<path class="s-support" d="M210 75 v88 M226 75 v88 M242 75 v88 M258 75 v88"/>'
            '<text class="s-sub" x="24" y="110">層高</text><path class="s-arrow" d="M70 105 h40"/>'
            '<text class="s-tag" x="236" y="56">懸空→支撐</text><text class="s-sub" x="30" y="196">平台附著（Brim／Raft）</text></svg>')


def svg_exhibit() -> str:
    return ('<svg class="diagram diagram-sm" viewBox="0 0 360 200" role="img" aria-label="虛擬展場：上傳模型到線上空間，觀眾以連結進入參觀">'
            '<path class="s-face" d="M40 160 L180 190 L320 160 L180 130 Z"/><path class="s-edge" d="M40 160 V60 L180 30 V130 M320 160 V60 L180 30"/>'
            '<rect class="s-box" x="70" y="80" width="44" height="34" rx="4"/><rect class="s-box" x="246" y="80" width="44" height="34" rx="4"/>'
            '<circle class="s-vert" cx="180" cy="150" r="9"/><text class="s-tag" x="150" y="122">作品展台</text>'
            '<text class="s-sub" x="40" y="40">Sketchfab</text><text class="s-sub" x="262" y="40">Spatial</text></svg>')


DIAGRAMS = {"M0": ("檔案從哪裡來、要往哪裡去", svg_workflow), "M1": ("先熟悉座標與三個變形鍵", svg_axes),
            "M2": ("所有模型都由頂點、邊、面組成", svg_mesh), "M5": ("切片軟體把模型切成一層層", svg_slice),
            "M7": ("把作品搬進線上展場", svg_exhibit), "M3": ("專題就是把工作流程完整走一次", svg_workflow),
            "M9": ("整合專題：從需求走到成品", svg_workflow)}


# ---------- 頁面模板 ----------
def stars(n: int) -> str:
    return f'<span class="lv" aria-label="難度 {n}/5">' + "".join(
        f'<i class="{"on" if i < n else ""}"></i>' for i in range(5)) + "</span>"


def head(title: str, desc: str, path: str, base: str, extra: str = "", og_img: str = "") -> str:
    url = SITE + path
    img = og_img or "https://i.ytimg.com/vi/foodwxKDQC4/hqdefault.jpg"
    return f'''<!doctype html>
<html lang="zh-Hant-TW" data-base="{base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{img}">
<meta name="theme-color" content="#0b1020">
<link rel="icon" href="https://polik18.github.io/assets/brand/favicon.svg?v=20261123" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=Space+Grotesk:wght@500;700&display=swap">
<link rel="stylesheet" href="{base}/assets/style.css?v={ASSET_V}">
{extra}
</head>
<body>
<a class="skip" href="#main">跳到主要內容</a>
<header class="top">
  <a class="brand" href="{base}/"><span class="brand-mark" aria-hidden="true">3D</span><span>小黃老師 3D 自學館</span></a>
  <nav class="top-nav" aria-label="主選單">
    <a href="{base}/#map">課程地圖</a>
    <a href="{base}/me.html">我的學習紀錄 <span class="pill" data-overall>0%</span></a>
  </nav>
</header>
<main id="main">
'''


def foot(base: str, page: str) -> str:
    return f'''</main>
<footer class="foot">
  <p>影片皆來自 YouTube 頻道 <a href="{CHANNEL}" rel="noopener" target="_blank">小黃老師 @polikjames</a>。學習紀錄只存在你自己的瀏覽器，不會上傳。</p>
  <p><a href="{base}/me.html">匯出／備份學習紀錄</a> · <a href="https://polik18.github.io/education.html">Polik 教學現場</a></p>
</footer>
<script src="{base}/assets/progress.js?v={ASSET_V}"></script>
<script src="{base}/assets/app.js?v={ASSET_V}" data-page="{page}"></script>
<script src="https://polik18.github.io/assets/site-stats.js" defer></script>
<script src="https://polik18.github.io/assets/polik-shell.js" data-cat="education" data-accent="#ff7a45" data-accent2="#2dd4bf" defer></script>
</body>
</html>
'''


def video_card(v: dict, base: str) -> str:
    lesson = f'<span class="tag">第 {v["lesson"]} 課</span>' if v["lesson"] else ""
    return (f'<li><a class="vcard" href="{base}/v/{v["id"]}.html" data-vid="{v["id"]}">'
            f'<span class="thumb"><img src="https://i.ytimg.com/vi/{v["id"]}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">'
            f'<span class="dur">{fmt_time(v["dur"])}</span><span class="st" data-status></span></span>'
            f'<span class="vbody"><span class="vtitle">{esc(v["title"])}</span>'
            f'<span class="vmeta">{stars(v["lv"])}{lesson}</span></span></a></li>')


def module_card(m: dict, base: str) -> str:
    return (f'<a class="mcard{" core" if m["core"] else " elective"}" href="{base}/m/{m["id"]}.html" data-module="{m["id"]}">'
            f'<span class="mid">{m["id"]}</span><span class="mtitle">{esc(m["title"].split("：")[0])}</span>'
            f'<span class="msub">{esc(m["title"].split("：")[1] if "：" in m["title"] else "")}</span>'
            f'<span class="mmeta">{stars(m["lv"])}<span>{esc(m["weeks"])}</span><span>{m["count"]} 部影片</span></span>'
            f'<span class="bar"><i data-mbar></i></span><span class="mpct" data-mpct>尚未開始</span></a>')


def page_index(data: dict) -> str:
    mods = data["modules"]
    by = {m["id"]: m for m in mods}
    total = len(data["videos"])
    core = "".join(module_card(by[i], ".") for i in CORE)
    elec = "".join(module_card(m, ".") for m in mods if not m["core"])
    desc = f"小黃老師 YouTube 頻道 {total} 部 Blender 建模與 3D 列印教學影片，整理成由淺入深的自學課程；學習進度與筆記存在自己的電腦。"
    ld = {"@context": "https://schema.org", "@type": "Course", "name": "小黃老師 3D 自學館：Blender 建模到 3D 列印",
          "description": desc, "inLanguage": "zh-Hant-TW", "url": SITE, "isAccessibleForFree": True,
          "provider": {"@type": "Person", "name": "小黃老師", "url": CHANNEL},
          "hasCourseInstance": {"@type": "CourseInstance", "courseMode": "online", "courseWorkload": "PT4H"}}
    extra = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
    return head("小黃老師 3D 自學館｜Blender 建模到 3D 列印免費自學課程", desc, "", ".", extra) + f'''
<section class="hero">
  <div class="hero-txt">
    <p class="eyebrow">免費・免登入・自己的進度自己存</p>
    <h1>從 Blender 建模<br>到 <em>3D 列印</em>，一步一步自學</h1>
    <p class="lead">把小黃老師頻道 {total} 部教學影片排成由淺入深的路線：先學會操作，再做出作品，最後切片、列印、上線展示。</p>
    <div class="cta">
      <a class="btn primary" href="m/M0.html" data-continue>從 M0 開始</a>
      <a class="btn" href="#map">看課程地圖</a>
    </div>
    <ul class="stats">
      <li><b>{total}</b>部影片</li><li><b>{len(mods)}</b>大單元</li>
      <li><b>{sum(len(m["units"]) for m in mods)}</b>小單元</li><li><b>{esc(data["weeks"].split("（")[0])}</b>建議時程</li>
    </ul>
  </div>
  <div class="hero-card" data-resume hidden></div>
</section>

<section class="band">
  <h2>3D 列印的完整流程</h2>
  <p class="muted">每個大單元對應流程中的一段。卡住時回到這張圖，看看自己在哪一步。</p>
  <div class="diagram-wrap">{svg_workflow()}</div>
</section>

<section id="map" class="band">
  <h2>課程地圖</h2>
  <p class="muted">建議依主線順序學習；選修可以在完成 M2 之後依興趣穿插。</p>
  <h3 class="lane">主線</h3>
  <div class="path">{core}</div>
  <h3 class="lane">選修</h3>
  <div class="grid3">{elec}</div>
</section>

<section class="band">
  <h2>每支影片這樣學</h2>
  <ol class="steps">
    <li><b>看之前</b>先讀「影片重點」，想好要做出什麼。</li>
    <li><b>看的時候</b>邊做邊記：用了什麼工具、哪裡出錯、尺寸多少。按「插入時間」把關鍵畫面記進筆記。</li>
    <li><b>看完後</b>關掉影片自己重做一次，至少改一個形狀或參數。</li>
    <li><b>每 3–5 部</b>完成一個小作品，在單元頁寫下作品紀錄；達成「過關標準」再往下一個單元。</li>
  </ol>
</section>

<section class="band note">
  <h2>你的學習紀錄存在哪裡？</h2>
  <p>進度、筆記、作品紀錄都只存在這台電腦的瀏覽器裡，不需要帳號，也不會傳到任何伺服器。清除瀏覽器資料或換電腦前，請到 <a href="me.html">我的學習紀錄</a> 匯出備份檔，之後可以再匯入。</p>
</section>
''' + foot(".", "index")


def page_module(m: dict, data: dict, prev_m, next_m) -> str:
    V = data["videos"]
    base = ".."
    units_html = []
    for u in m["units"]:
        if u["videos"]:
            body = '<ul class="vgrid">' + "".join(video_card(V[i], base) for i in u["videos"]) + "</ul>"
        else:
            body = ('<div class="task"><b>實作任務</b><p>這個小單元沒有專屬影片，請運用前面學到的技巧完成下方的過關標準，'
                    '並把作品寫進作品紀錄。</p></div>')
        units_html.append(f'''
<section class="unit" id="{u["id"]}" data-unit="{u["id"]}">
  <header class="unit-h"><span class="uid">{u["id"]}</span><h2>{esc(u["title"])}</h2><span class="ucount" data-ucount>{len(u["videos"])} 部影片</span></header>
  <p class="muted">{esc(u["purpose"])}</p>
  {body}
  <div class="check">
    <label class="crit"><input type="checkbox" data-crit> <span><b>過關標準：</b>{esc(u["exit"])}</span></label>
    <label class="work"><span>我的作品紀錄（檔名、做了什麼、遇到什麼問題）</span>
      <textarea data-work rows="3" placeholder="例如：heart_v2.blend，改用倒角讓邊緣變圓；匯出 STL 時尺寸太小，已改成 50 mm。"></textarea></label>
  </div>
</section>''')
    diag = ""
    if m["id"] in DIAGRAMS:
        cap, fn = DIAGRAMS[m["id"]]
        diag = f'<figure class="diagram-wrap">{fn()}<figcaption>{esc(cap)}</figcaption></figure>'
    nav = '<nav class="pager">' + (
        f'<a href="{prev_m["id"]}.html">← {prev_m["id"]} {esc(prev_m["title"].split("：")[0])}</a>' if prev_m else "<span></span>") + (
        f'<a href="{next_m["id"]}.html">{next_m["id"]} {esc(next_m["title"].split("：")[0])} →</a>' if next_m else "<span></span>") + "</nav>"
    toc = "".join(f'<a href="#{u["id"]}">{u["id"]} {esc(u["title"])}</a>' for u in m["units"])
    title = f'{m["id"]} {m["title"]}｜小黃老師 3D 自學館'
    desc = f'{m["purpose"]} 共 {m["count"]} 部教學影片，難度 {m["lv"]}/5，建議 {m["weeks"]}。'
    first = next((u["videos"][0] for u in m["units"] if u["videos"]), None)
    og = f"https://i.ytimg.com/vi/{first}/hqdefault.jpg" if first else ""
    return head(title, desc, f'm/{m["id"]}.html', base, og_img=og) + f'''
<nav class="crumb" aria-label="路徑"><a href="../">課程地圖</a><span>›</span><span>{m["id"]}</span></nav>
<section class="mhead" data-module="{m["id"]}">
  <div>
    <p class="eyebrow">{"主線" if m["core"] else "選修"} · {esc(m["level"])} · {esc(m["weeks"])}</p>
    <h1><span class="mid big">{m["id"]}</span>{esc(m["title"])}</h1>
    <p class="lead">{esc(m["purpose"])}</p>
    <div class="mprog"><span class="bar"><i data-mbar></i></span><span data-mpct>尚未開始</span></div>
  </div>
  <aside class="goals">
    <h2>學完你能夠</h2>
    <ul>{"".join(f"<li>{esc(o)}</li>" for o in m["outcomes"])}</ul>
    <h2>大單元過關</h2><p>{esc(m["exit"])}</p>
  </aside>
</section>
{diag}
<nav class="toc" aria-label="小單元">{toc}</nav>
{"".join(units_html)}
{nav}
''' + foot(base, "module")


def page_video(v: dict, data: dict, unit: dict, mod: dict) -> str:
    base = ".."
    ids = unit["videos"]
    i = ids.index(v["id"])
    prev_v = data["videos"][ids[i - 1]] if i > 0 else None
    next_v = data["videos"][ids[i + 1]] if i + 1 < len(ids) else None
    chapters = ""
    if v["chapters"]:
        chapters = '<section class="panel"><h2>章節</h2><ol class="chapters">' + "".join(
            f'<li><button type="button" data-seek="{c["t"]}"><time>{fmt_time(c["t"])}</time>{esc(c["label"])}</button></li>'
            for c in v["chapters"]) + "</ol></section>"
    summary = (f'<p>{esc(v["summary"])}</p>' if v["summary"] else "")
    links = ""
    if v["links"]:
        links = '<h3 class="res-h">影片附的練習資源</h3><ul class="res">' + "".join(
            f'<li><a href="{esc(u)}" target="_blank" rel="noopener nofollow">{esc(link_label(u))}</a></li>' for u in v["links"]) + "</ul>"
    review = ('<p class="review">這部影片的文字重點還在整理中，請直接觀看影片，並把你的重點寫進筆記。</p>' if v["review"] else "")
    lesson = f' · {esc(v["series"])} 第 {v["lesson"]} 課' if v["lesson"] else ""
    desc = (v["summary"] or v["title"])[:150]
    ld = {"@context": "https://schema.org", "@type": "VideoObject", "name": v["title"], "description": desc,
          "thumbnailUrl": f"https://i.ytimg.com/vi/{v['id']}/hqdefault.jpg", "embedUrl": f"https://www.youtube.com/embed/{v['id']}",
          "contentUrl": f"https://www.youtube.com/watch?v={v['id']}", "inLanguage": "zh-Hant-TW"}
    if v["date"]:
        ld["uploadDate"] = v["date"]
    if v["dur"]:
        ld["duration"] = iso_duration(v["dur"])
    extra = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'

    def pv(x, label):
        return (f'<a class="pv" href="{x["id"]}.html"><img src="https://i.ytimg.com/vi/{x["id"]}/mqdefault.jpg" alt="" loading="lazy" width="160" height="90">'
                f'<span><small>{label}</small>{esc(x["title"])}</span></a>') if x else "<span></span>"
    return head(f'{v["title"]}｜小黃老師 3D 自學館', desc, f'v/{v["id"]}.html', base, extra,
                f"https://i.ytimg.com/vi/{v['id']}/hqdefault.jpg") + f'''
<nav class="crumb" aria-label="路徑"><a href="../">課程地圖</a><span>›</span><a href="../m/{mod["id"]}.html">{mod["id"]} {esc(mod["title"].split("：")[0])}</a><span>›</span><a href="../m/{mod["id"]}.html#{unit["id"]}">{unit["id"]} {esc(unit["title"])}</a></nav>
<article class="watch" data-video="{v["id"]}" data-dur="{v["dur"]}" data-unit="{unit["id"]}">
  <div class="watch-main">
    <div class="player" data-player>
      <button type="button" class="facade" data-facade aria-label="播放影片：{esc(v["title"])}">
        <img src="https://i.ytimg.com/vi/{v["id"]}/hqdefault.jpg" alt="" width="480" height="360">
        <span class="play" aria-hidden="true"></span><span class="resume-at" data-resume-at hidden></span>
      </button>
    </div>
    <h1 class="vh1">{esc(v["title"])}</h1>
    <p class="vmeta">{stars(v["lv"])}<span>{esc(v["lvLabel"])}</span><span>{fmt_time(v["dur"])}</span>{f"<span>{v['date']}</span>" if v["date"] else ""}<span>{esc(unit["id"])}{lesson}</span></p>
    <div class="status" role="group" aria-label="學習狀態">
      <button type="button" data-set="todo">未開始</button><button type="button" data-set="doing">學習中</button><button type="button" data-set="done">✓ 已完成</button>
      <a class="yt" href="https://www.youtube.com/watch?v={v["id"]}" target="_blank" rel="noopener">在 YouTube 開啟 ↗</a>
    </div>
    <p class="nudge" data-nudge hidden>快看完了！做完練習後記得按「已完成」。</p>
    <section class="panel"><h2>影片重點</h2>{summary}{review}{links}
      <p class="muted small">先修：{esc(v["prereq"] or "無")}</p></section>
    {chapters}
  </div>
  <aside class="watch-side">
    <section class="panel notes">
      <h2>我的筆記</h2>
      <textarea data-note rows="9" placeholder="記下工具、快捷鍵、參數、遇到的錯誤…（自動儲存在這台電腦）"></textarea>
      <div class="row"><button type="button" class="btn sm" data-stamp>插入目前時間</button><span class="saved" data-saved aria-live="polite"></span></div>
    </section>
    <section class="panel">
      <h2>練習檢核</h2>
      <ul class="todo">
        <li><label><input type="checkbox" data-step="0"> 讀完重點，知道要做出什麼</label></li>
        <li><label><input type="checkbox" data-step="1"> 跟著影片做一次</label></li>
        <li><label><input type="checkbox" data-step="2"> 關掉影片自己重做，並改一個參數</label></li>
      </ul>
    </section>
  </aside>
</article>
<nav class="pager pv-pager">{pv(prev_v, "上一部")}{pv(next_v, "下一部")}</nav>
<p class="back"><a href="../m/{mod["id"]}.html#{unit["id"]}">← 回到 {unit["id"]} {esc(unit["title"])}</a></p>
''' + foot(base, "video")


def page_me(data: dict) -> str:
    return head("我的學習紀錄｜小黃老師 3D 自學館", "查看自己的 3D 自學進度、筆記與作品紀錄，並匯出備份。", "me.html", ".") + '''
<section class="mehead">
  <div>
    <p class="eyebrow">只存在這台電腦</p>
    <h1>我的學習紀錄</h1>
    <label class="nick">暱稱（列印學習歷程時顯示，可留白）<input type="text" data-nick maxlength="30" autocomplete="nickname"></label>
  </div>
  <div class="tools">
    <button type="button" class="btn primary" data-export>匯出備份檔</button>
    <label class="btn">匯入備份檔<input type="file" accept="application/json,.json" data-import hidden></label>
    <button type="button" class="btn" data-print>列印學習歷程</button>
    <button type="button" class="btn danger" data-clear>清除全部紀錄</button>
  </div>
</section>
<p class="warn" data-nostore hidden>這個瀏覽器目前無法儲存資料（可能是無痕模式或封鎖網站資料）。你仍可以學習，但關掉頁面後紀錄會消失。</p>
<p class="toast" data-msg role="status" aria-live="polite" hidden></p>
<section class="kpis" data-kpis></section>
<section class="band"><h2>近 12 週學習日曆</h2><div class="heat" data-heat></div><p class="muted small">顏色越深代表當天看影片的時間越長（只計算在本站播放器播放的時間）。</p></section>
<section class="band"><h2>各單元進度</h2><div class="mlist" data-mlist></div></section>
<section class="band"><h2>我的筆記與作品紀錄</h2><div data-notes><p class="muted">還沒有筆記。</p></div></section>
''' + foot(".", "me")


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, "utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    a = ap.parse_args()
    data = load(a.src)
    mods = data["modules"]

    public = {
        "generated": date.today().isoformat(), "site": SITE, "core": CORE, "weeks": data["weeks"],
        "modules": [{k: m[k] for k in ("id", "title", "level", "lv", "weeks", "core", "count")}
                    | {"units": [{k: u[k] for k in ("id", "title", "exit", "videos")} for u in m["units"]]} for m in mods],
        "videos": {v["id"]: {"t": v["title"], "d": v["dur"], "lv": v["lv"], "u": v["unit"], "m": v["module"]}
                   for v in data["videos"].values()},
    }
    write(ROOT / "data" / "course.json", json.dumps(public, ensure_ascii=False, separators=(",", ":")))
    write(ROOT / "index.html", page_index(data))
    write(ROOT / "me.html", page_me(data))
    order = CORE + [m["id"] for m in mods if not m["core"]]
    by = {m["id"]: m for m in mods}
    for k, mid in enumerate(order):
        m = by[mid]
        write(ROOT / "m" / f"{mid}.html", page_module(m, data, by[order[k - 1]] if k else None,
                                                     by[order[k + 1]] if k + 1 < len(order) else None))
        for u in m["units"]:
            for vid in u["videos"]:
                write(ROOT / "v" / f"{vid}.html", page_video(data["videos"][vid], data, u, m))

    urls = [SITE, SITE + "me.html"] + [f"{SITE}m/{i}.html" for i in order] + [f"{SITE}v/{i}.html" for i in data["videos"]]
    write(ROOT / "sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + "".join(f"  <url><loc>{u}</loc><lastmod>{date.today().isoformat()}</lastmod></url>\n" for u in urls) + "</urlset>\n")

    # 守門：輸出不得含私有欄位或排除影片
    bad = []
    skipped_ids = [s[0] for s in data["skipped"]]
    for f in list(ROOT.glob("*.html")) + list(ROOT.glob("m/*.html")) + list(ROOT.glob("v/*.html")) + [ROOT / "data" / "course.json", ROOT / "sitemap.xml"]:
        t = f.read_text("utf-8")
        bad += [f"{f.relative_to(ROOT)}: {w}" for w in FORBIDDEN + skipped_ids if w in t]
    stale = [p for p in ROOT.glob("v/*.html") if p.stem not in data["videos"]]
    for p in stale:
        p.unlink()
    print(f"videos={len(data['videos'])} skipped={data['skipped']} modules={len(mods)} "
          f"chapters={sum(1 for v in data['videos'].values() if v['chapters'])} "
          f"summaries={sum(1 for v in data['videos'].values() if v['summary'])} stale_removed={len(stale)}")
    if bad:
        print("GUARD FAIL:", *bad[:20], sep="\n  ")
        sys.exit(1)
    print("GUARD PASS")


if __name__ == "__main__":
    main()
