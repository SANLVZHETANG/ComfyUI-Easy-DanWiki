#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_theme_banner.py
====================
Render EVERY built-in theme of ComfyUI-Easy-DanWiki into two neat showcase
banner PNGs (search term = "cat_girl"):

  1. themes_list.png  -> the candidate dropdown, one themed copy per theme
  2. themes_hud.png   -> the floating detail window (HUD), one per theme

How it stays faithful without a running ComfyUI backend:
  * It links the REAL stylesheets (dbtags_autocomplete.css + dbtags_themes.css)
    inline, so every colour / radius / font / border is the shipped look.
  * The theme rules are scoped with `:root.dbtags-theme-X`, which forces ONE
    theme per document. We rewrite that prefix to a plain `.dbtags-theme-X`
    (a build-time, preview-only transform of a COPY of the CSS — the shipped
    files are never touched) so each grid cell can carry its own theme class
    and they can all sit side by side in one page.
  * The candidate rows / HUD content use the SAME class names the live app
    builds (dbtags-ac-item / -name / -count / -hud-head / -link ...) and are
    populated from the REAL 0_general.json (counts, Chinese names, wiki body)
    plus the real cat_girl example image (embedded as a data URI).

Output goes to the --out directory (default: the caller's 预览 folder).

Usage:
  python tools/make_theme_banner.py --out "C:\\Users\\you\\Desktop\\预览"
  optional: --chrome "C:\\path\\to\\chrome.exe"   (auto-detected otherwise)
"""

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEBJS = os.path.join(ROOT, "web", "js")
DATA_DIR = os.path.join(WEBJS, "data")
FONTS_DIR = os.path.join(ROOT, "fonts")

# --- author data lives OUTSIDE the repo; overridable, with a couple of
# --- best-effort guesses relative to the plugin (../danbooru-general-tags).
IDX = os.environ.get("DBTAGS_INDEX", os.path.join(DATA_DIR, "0_general.json"))

TERM = "cat_girl"

# ordered light->dark / grouped by family for an even, pleasant grid
THEMES = [
    ("light",          "米白"),
    ("retro-apple",    "复古苹果"),
    ("modern",         "现代"),
    ("nord",           "北欧"),
    ("solarized",      "暖阳"),
    ("eye-care",       "护眼"),
    ("pink",           "樱粉"),
    ("mint",           "薄荷"),
    ("amber-close",    "琥珀"),
    ("winxp",          "经典蓝"),
    ("winxp-classic",  "XP 经典"),
    ("winxp-olive",    "XP 橄榄"),
    ("winxp-silver",   "XP 银"),
    ("dark",           "深灰"),
    ("modern-dark",    "现代暗"),
    ("eye-care-dark",  "护眼暗"),
]

# candidate list for the term cat_girl (real names; count/zh come from index)
LIST_ROWS = [
    "cat_ears", "cat_tail", "cat_girl", "fox_girl", "wolf_girl",
    "rabbit_girl", "kemonomimi_mode", "dog_girl", "interspecies",
    "cat_boy", "lion_girl", "panther_girl", "reindeer_girl",
]


def _first_existing(paths):
    for p in paths:
        if p and os.path.isdir(p):
            return os.path.abspath(p)
    return None


def _esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def fmt_count(n):
    n = int(n or 0)
    if n >= 1_000_000:
        return f"{n/1e6:.{0 if n>=1e7 else 1}f}M"
    if n >= 1_000:
        return f"{n/1e3:.{0 if n>=1e5 else 1}f}K"
    return str(n)


def norm_name(s):
    return re.sub(r"\s+", "_", s.strip().lower())


def zh_name(tag):
    if not tag:
        return ""
    return tag.get("zhtag") or (tag.get("zh") or [""])[0] or ""


def load_index():
    with open(IDX, "r", encoding="utf-8") as f:
        idx = json.load(f)
    return {t["name"]: t for t in idx["tags"]}


def theme_css():
    """base + theme pack, with the :root-scoping relaxed to a wrapper class."""
    parts = []
    for fn in ("dbtags_autocomplete.css", "dbtags_themes.css"):
        p = os.path.join(WEBJS, fn)
        with open(p, "r", encoding="utf-8") as f:
            css = f.read()
        css = css.replace(":root.dbtags-theme-", ".dbtags-theme-")
        parts.append(f"/* {fn} (scoped->wrapper) */\n{css}")
    return "\n".join(parts)


def highlight_name(name):
    """bold+underline the matched fragment, like the live search does."""
    if name == TERM:
        return f'<span class="dbtags-ac-highlight">{_esc(name)}</span>'
    if name.startswith("cat"):
        return f'<span class="dbtags-ac-highlight">cat</span>{_esc(name[3:])}'
    if name.endswith("_girl"):
        return f'{_esc(name[:-5])}<span class="dbtags-ac-highlight">_girl</span>'
    return _esc(name)


def render_wiki_links(map_, text):
    """[[target|disp]] -> inline .dbtags-ac-link (zh) (+ en), like renderWikiBody."""
    out = []
    last = 0
    for m in re.finditer(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]", text or ""):
        if m.start() > last:
            out.append(_esc(text[last:m.start()]))
        target = m.group(1).strip()
        disp = (m.group(2) or m.group(1)).strip()
        rec = map_.get(norm_name(target))
        cn = zh_name(rec) if lang_zh(disp) or True else ""
        main = disp if has_cjk(disp) else (cn or target)
        en = target if (main != target) else ""
        seg = f'<span class="dbtags-ac-link">{_esc(main)}'
        if en:
            seg += f'<span class="dbtags-ac-link-en"> ({_esc(target)})</span>'
        seg += "</span>"
        out.append(seg)
        last = m.end()
    if last < len(text or ""):
        out.append(_esc((text or "")[last:]))
    return "".join(out)


def has_cjk(s):
    return any("\u4e00" <= ch <= "\u9fff" for ch in (s or ""))


def lang_zh(_):
    return True  # banner always renders the zh wiki body


def list_cell(map_, code, zh_label):
    rows = []
    for name in LIST_ROWS:
        t = map_.get(name)
        if not t:
            continue
        sel = " dbtags-ac-item--selected" if name == TERM else ""
        rows.append(
            f'<div class="dbtags-ac-item{sel}">'
            f'<span class="dbtags-ac-name">{highlight_name(name)}</span>'
            f'<span class="dbtags-ac-count">{fmt_count(t["post_count"])}</span>'
            f'</div>'
        )
    stage = (
        f'<div class="dbtags-ac-wrap"><div class="dbtags-ac-list">'
        f'{"".join(rows)}</div></div>'
    )
    return card(code, zh_label, stage)


def hud_cell(map_, code, zh_label, img_uri, g):
    title = g["name"]
    count = fmt_count(g["post_count"])
    zh = zh_name(g)
    body = render_wiki_links(map_, g.get("wiki_zh") or g.get("summary") or "")
    hud = (
        '<div class="dbtags-ac-hud">'
        '<div class="dbtags-ac-hud-head">'
        f'<span class="dbtags-ac-hud-title">{_esc(title)}</span>'
        f'<span class="dbtags-ac-hud-count">{count}</span>'
        '<span class="dbtags-ac-hud-add dbtags-ac-hud-btn">＋</span>'
        '<span class="dbtags-ac-hud-x dbtags-ac-hud-btn">×</span>'
        '</div>'
        '<div class="dbtags-ac-hud-tabs">'
        '<span class="dbtags-ac-hud-tab dbtags-ac-hud-tab--active">'
        f'<span class="dbtags-ac-hud-tab-lbl">{_esc(title)}</span>'
        '<span class="dbtags-ac-hud-tab-x">×</span></span></div>'
        '<div class="dbtags-ac-hud-scroll">'
        f'<img class="dbtags-ac-hud-img" src="{img_uri}">'
        f'<div class="dbtags-ac-hud-zh">{_esc(zh)}</div>'
        f'<div class="dbtags-ac-hud-body">{body}</div>'
        '</div></div>'
    )
    return card(code, zh_label, hud)


def card(code, zh_label, inner):
    return (
        f'<div class="card">'
        f'<div class="cap"><span class="nm">{_esc(zh_label)}</span>'
        f'<span class="code">{code}</span></div>'
        f'<div class="stage dbtags-theme-{code}">{inner}</div>'
        f'</div>'
    )


BANNER_CSS = """
@font-face{
  font-family:'MapleBanner';
  src:url('__FONT_URL__') format('truetype');
  font-weight:700;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:#eef0f3;
  color:#1a1d21;
  padding:52px 40px 60px;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.banner-title{
  text-align:center;font-family:'MapleBanner',"Cascadia Mono",Consolas,monospace;
  font-size:60px;font-weight:700;letter-spacing:.5px;color:#20242a;margin:0 0 6px;
}
.banner-title .g{color:#3a7bd5}
.banner-sub{
  text-align:center;font-size:16px;color:#5b6570;margin:0 0 6px;font-weight:600;
}
.banner-note{text-align:center;font-size:13px;color:#95a0ac;margin:0 0 30px}
.grid{display:grid;gap:26px;justify-content:center;grid-template-columns:repeat(__COLS__,max-content)}
.card{
  background:#fff;border:1px solid #e3e6eb;border-radius:14px;overflow:hidden;
  box-shadow:0 8px 22px rgba(22,28,38,.07);display:flex;flex-direction:column;
}
.cap{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:9px 13px;background:#f3f5f8;border-bottom:1px solid #e3e6eb;
}
.cap .nm{font-size:14px;font-weight:700;color:#2b3138}
.cap .code{font-family:Consolas,monospace;font-size:11px;color:#8b95a2}
.stage{
  padding:16px;display:flex;justify-content:center;align-items:flex-start;
  background:repeating-conic-gradient(#f7f8fa 0 25%,#eef1f4 0 50%) 0 0/20px 20px;
  --dbtags-ac-accent:var(--dbtags-ac-highlight);
}
/* neutralise popup absolute/fixed positioning so themed boxes flow in the grid */
.stage .dbtags-ac-wrap{position:static!important;z-index:auto!important}
.stage .dbtags-ac-list{
  position:static!important;max-height:none!important;overflow:visible!important;
  backdrop-filter:none!important;width:var(--dbtags-ac-width);min-width:0!important;
  box-shadow:0 3px 12px rgba(0,0,0,.18);
}
.stage .dbtags-ac-hud{
  position:static!important;z-index:auto!important;resize:none!important;
  backdrop-filter:none!important;width:300px;height:402px;max-width:none;max-height:none;
}
.stage .dbtags-ac-hud-scroll{overflow:hidden}
.stage .dbtags-ac-hud-img{max-height:158px}
.stage .dbtags-ac-hud-body{max-height:150px;overflow:hidden}
/* ---- tight mode: popups abut edge-to-edge, no chrome, no captions ---- */
body.tight{padding:22px 22px 24px}
body.tight .banner-title{font-size:46px;margin:0 0 14px}
body.tight .grid{gap:0;margin-top:0}
body.tight .card{background:transparent;border:0;box-shadow:none;border-radius:0}
body.tight .cap{display:none}
body.tight .stage{padding:0;background:none}
body.tight .stage .dbtags-ac-list{box-shadow:none}
body.tight .stage .dbtags-ac-hud{box-shadow:none}
/* force one row height everywhere so folded rows bottom-align (no slivers) */
body.tight .stage .dbtags-ac-item{line-height:26px}
body.tight .stage .dbtags-ac-hud{width:336px;height:430px}
body.tight .stage .dbtags-ac-hud-img{max-height:190px}
body.tight .stage .dbtags-ac-hud-body{max-height:196px}
"""


def build_html(map_, g, img_uri, kind, cols=4, tight=False, only=None, extra_css=""):
    css = theme_css()
    cells = []
    for code, label in (only if only else THEMES):
        if kind == "list":
            cells.append(list_cell(map_, code, label))
        else:
            cells.append(hud_cell(map_, code, label, img_uri, g))
    if kind == "list":
        sub, note = ("候选列表主题一览",
                     "搜索词 cat_girl · 共 %d 个内置主题 · 实时样式，非截图拼贴" % len(THEMES))
    else:
        sub, note = ("悬浮窗主题一览",
                     "cat_girl 详情 · 共 %d 个内置主题 · 实时样式，非截图拼贴" % len(THEMES))
    head = ('<div class="banner-title">ComfyUI<span class="g">-</span>'
            'Easy-DanWiki</div>')
    if not tight:
        head += (f'<div class="banner-sub">{_esc(sub)}</div>'
                 f'<div class="banner-note">{_esc(note)}</div>')
    font_url = (os.environ.get("DBTAGS_BANNER_FONT")
                or os.path.join(FONTS_DIR, "MapleMonoNormal-NF-CN-Medium.ttf"))
    font_url = "file:///" + font_url.replace("\\", "/")
    banner = BANNER_CSS.replace('__FONT_URL__', font_url).replace('__COLS__', str(int(cols)))
    bcls = ' class="tight"' if tight else ''
    extra = f"<style>{extra_css}</style>" if extra_css else ""
    return ("<!doctype html><html lang='zh'><head><meta charset='utf-8'>"
            f"<style>{css}</style>"
            f"<style>{banner}</style>{extra}</head>"
            f"<body{bcls}>{head}<div class='grid'>{''.join(cells)}</div></body></html>")


def find_chrome(override):
    if override and os.path.isfile(override):
        return override
    cands = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in cands:
        if os.path.isfile(c):
            return c
    for name in ("google-chrome", "chromium", "chrome", "microsoft-edge"):
        p = shutil.which(name)
        if p:
            return p
    return None


def shot(chrome, html_path, out_png, w, h, profile, alpha=False):
    cmd = [
        chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2",
        "--default-background-color=" + ("00000000" if alpha else "FFFFFFFF"),
        f"--user-data-dir={profile}", f"--window-size={w},{h}",
        f"--screenshot={out_png}", Path_url(html_path),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if not os.path.isfile(out_png):
        sys.stderr.write((r.stdout or "") + "\n" + (r.stderr or "") + "\n")
        raise RuntimeError("chrome produced no screenshot")


def autocrop_alpha(src, dst, pad=0):
    """trim a transparent-background render to its opaque bounding box."""
    from PIL import Image
    im = Image.open(src).convert("RGBA")
    bbox = im.split()[-1].getbbox()
    if bbox:
        l, t, r, b = bbox
        l = max(0, l - pad); t = max(0, t - pad)
        r = min(im.width, r + pad); b = min(im.height, b + pad)
        im = im.crop((l, t, r, b))
    im.save(dst)
    return im.size


def Path_url(p):
    return "file:///" + os.path.abspath(p).replace("\\", "/")


def autocrop(src, dst, bg=(238, 240, 243), pad=40):
    from PIL import Image, ImageChops
    im = Image.open(src).convert("RGB")
    # the page body bg is #eef0f3 -> trim to the content bounding box + padding
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg))
    bbox = diff.getbbox()
    if bbox:
        l, t, r, b = bbox
        l = max(0, l - pad); t = max(0, t - pad)
        r = min(im.width, r + pad); b = min(im.height, b + pad)
        im = im.crop((l, t, r, b))
    im.save(dst)
    return im.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="output dir for the two PNGs")
    ap.add_argument("--chrome", default=None, help="path to chrome/edge exe")
    ap.add_argument("--keep-html", action="store_true", help="also copy HTML to --out")
    ap.add_argument("--cols", type=int, default=4,
                    help="grid columns; set 16 for a single-row long strip, 8 for two rows")
    ap.add_argument("--tight", action="store_true",
                    help="abut popups edge-to-edge: no gaps, no card chrome, no captions/text")
    ap.add_argument("--parts", action="store_true",
                    help="render each theme to its OWN transparent PNG (list + HUD) under "
                         "<out>/parts/ for you to assemble yourself")
    args = ap.parse_args()

    out = args.out or os.getcwd()
    os.makedirs(out, exist_ok=True)
    chrome = find_chrome(args.chrome)
    if not chrome:
        sys.exit("no Chrome/Edge found — pass --chrome PATH")

    map_ = load_index()
    g = map_[TERM]

    # example image -> base64 data URI (robust under file://)
    img_uri = ""
    ds = os.environ.get("DBTAGS_DATASET") or _first_existing([
        os.path.join(ROOT, "..", "danbooru-general-tags"), os.path.join(ROOT, "dataset")])
    rel = (g.get("images") or [""])[0]
    jpg = os.path.join(ds, rel) if ds and rel else ""
    if jpg and os.path.isfile(jpg):
        with open(jpg, "rb") as f:
            img_uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    else:
        sys.stderr.write("warn: cat_girl example image not found (%s); HUD tiles render without it\n" % jpg)

    tmp = tempfile.mkdtemp(prefix="danwiki_banner_")
    prof = os.path.join(tmp, "profile")

    # ---- PARTS mode: one transparent PNG per theme (list + HUD) ----
    if args.parts:
        parts = os.path.join(out, "parts")
        os.makedirs(parts, exist_ok=True)
        solo_css = (
            "html,body{background:transparent!important;padding:0!important;margin:0!important}"
            ".banner-title{display:none!important}"
            ".grid{gap:0!important;justify-content:flex-start!important;grid-template-columns:1fr!important}"
            ".card{background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0!important}"
            ".cap{display:none!important}"
            ".stage{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important}"
        )
        print("chrome :", chrome)
        made = []
        for code, label in THEMES:
            for kind, tag in (("list", "列表"), ("hud", "悬浮窗")):
                hp = os.path.join(tmp, f"{code}_{kind}.html")
                with open(hp, "w", encoding="utf-8") as f:
                    f.write(build_html(map_, g, img_uri, kind, 1, True,
                                       only=[(code, label)], extra_css=solo_css))
                raw = os.path.join(tmp, f"{code}_{kind}_raw.png")
                shot(chrome, hp, raw, 620, 780, prof, alpha=True)
                final = os.path.join(parts, f"{code}__{kind}.png")
                size = autocrop_alpha(raw, final, pad=0)
                made.append((f"{code}__{kind}.png", tag, size))
        for fn, tag, s in made:
            print("wrote  : parts/%-28s %5dx%-5d %s" % (fn, s[0], s[1], tag))
        print("\n%d 个部件已输出到 %s (透明底, 可直接拼贴)" % (len(made), parts))
        return

    made = []
    ncols = max(1, args.cols)
    rows = -(-len(THEMES) // ncols)          # ceil division
    win_w = ncols * 410 + 120
    # a list card is ~540 CSS px tall, an HUD card ~620 (tight: no caption bar)
    cell_list, cell_hud = (480, 560) if args.tight else (540, 620)
    head_h = 120 if args.tight else 210
    list_h = head_h + rows * (cell_list + 26) + 60
    hud_h = head_h + rows * (cell_hud + 26) + 60
    jobs = [("themes_list", "list", win_w, list_h),
            ("themes_hud", "hud", win_w, hud_h)]
    for base, kind, w, h in jobs:
        hp = os.path.join(tmp, base + ".html")
        with open(hp, "w", encoding="utf-8") as f:
            f.write(build_html(map_, g, img_uri, kind, ncols, args.tight))
        raw = os.path.join(tmp, base + "_raw.png")
        shot(chrome, hp, raw, w, h, prof)
        final = os.path.join(out, base + ".png")
        size = autocrop(raw, final, pad=14 if args.tight else 40)
        if args.keep_html:
            shutil.copy(hp, os.path.join(out, base + ".html"))
        made.append((final, size))

    print("chrome :", chrome)
    for p, s in made:
        print("wrote  : %s  %dx%d px" % (p, s[0], s[1]))


if __name__ == "__main__":
    main()
