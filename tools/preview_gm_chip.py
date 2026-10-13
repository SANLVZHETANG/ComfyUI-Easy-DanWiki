# -*- coding: utf-8 -*-
"""Self-render preview for the belongs-to group chip (gm-chip) restyle.

Renders 4 candidates with the REAL stylesheets (base + retro-apple theme,
:root scoped -> wrapper class, same trick as make_theme_banner.py) and shots
one PNG for the agent to inspect without waiting for user screenshots."""
import os, subprocess, tempfile, sys, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEBJS = os.path.join(ROOT, "web", "js")
OUT = os.environ.get("DBTAGS_PREVIEW_OUT", os.path.join(tempfile.gettempdir(), "opencode"))

def find_chrome():
    for c in [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"]:
        if os.path.isfile(c):
            return c
    for name in ("google-chrome", "chromium", "chrome", "microsoft-edge"):
        p = shutil.which(name)
        if p:
            return p
    return None

css = ""
for fn in ("dbtags_autocomplete.css", "dbtags_themes.css"):
    p = os.path.join(WEBJS, fn)
    css += "/* %s */\n" % fn + open(p, encoding="utf-8").read().replace(
        ":root.dbtags-theme-", ".dbtags-theme-") + "\n"

# fix6b shipped state lives in the css above (gm-chip block); candidates
# override per-row via inline classes on TOP of that.
CAND = """
.gmA{background:var(--dbtags-ac-bg2)!important;border:0!important;padding:1px 7px!important;border-radius:4px!important;font-size:calc(var(--dbtags-ac-font) - 3px)!important;}
.gmB{background:var(--dbtags-ac-bg2)!important;border:0!important;padding:1px 7px!important;border-radius:4px!important;font-size:calc(var(--dbtags-ac-font) - 3px)!important;}
.gmC{background:var(--dbtags-ac-bg2)!important;border:0!important;padding:1px 7px!important;border-radius:4px!important;font-size:calc(var(--dbtags-ac-font) - 3px)!important;}
.gmD{background:var(--dbtags-ac-bg2)!important;border:0!important;padding:1px 7px!important;border-radius:4px!important;font-size:calc(var(--dbtags-ac-font) - 3px)!important;}
/* vertical rhythm candidates: gap above / below the gm row */
.pA .dmGm{padding-top:3px!important;padding-bottom:0!important;}   /* current 6px beat (asym 9/6) */
.pB .dmGm{padding-top:4px!important;padding-bottom:4px!important;} /* symmetric 4px beat (tight fix10) */
.pC .dmGm{padding-top:3px!important;padding-bottom:3px!important;} /* symmetric 3px beat (tightest) */
.pD .dmGm{padding-top:2px!important;padding-bottom:2px!important;} /* symmetric 2px beat */
.dmImg{display:block;width:180px;height:56px;background:repeating-linear-gradient(45deg,#fff 0 8px,#f3ecf4 8px 16px);border:1px solid #000;box-shadow:2px 2px 0 rgba(0,0,0,.25);margin:0 auto;}
"""
def chip_html(cls, names):
    return '<span class="dbtags-ac-link dbtags-ac-gm-chip gmA"><span class="dbtags-ac-g-ico">▣</span>%s</span>' % (names,)

rows = []
LAY = '<div class="dmGm dbtags-ac-panel-gm"><span class="dbtags-ac-gm-cap">属于组</span>%s%s%s</div><span class="dmImg"></span>'
rows.append('<div class="lbl">LADDER B/C/D = symmetric beats 12/10/12</div>')
for pk in ["A", "B", "C", "D"]:
    rows.append(
        '<div class="row p%s"><span class="lbl">PANEL p%s</span>'
        '<div class="dmGm dbtags-ac-panel-gm"><span class="dbtags-ac-gm-cap">属于组</span>%s%s%s</div>'
        '<span class="dmImg"></span></div>' % (
            pk, pk, chip_html("A", "食物"), chip_html("A", "角色数量"), chip_html("A", "姿势")))
EXTRA = """
body{margin:0;padding:14px;background:#cdcdc2}
.panel{
  width:320px;padding:10px 12px;border:1px solid #000;border-radius:6px;
  background:var(--dbtags-ac-bg);
  font-family:var(--dbtags-ac-family);color:var(--dbtags-ac-text);
}
.row{margin:0 0 10px;font-size:var(--dbtags-ac-font)}
.cap{font-size:10px;color:var(--dbtags-ac-sub);margin-right:4px}
.lbl{display:block;font-family:Consolas,monospace;font-size:11px;color:#333;margin:0 0 2px}
"""
html = ("<!doctype html><meta charset='utf-8'><style>%s%s%s</style>"
        "<body class='dbtags-theme-retro-apple'><div class='panel'>%s</div></body>"
        % (css, CAND, EXTRA, "".join(rows)))

tmp = tempfile.mkdtemp(prefix="gmpreview_")
hpath = os.path.join(tmp, "gm.html")
with open(hpath, "w", encoding="utf-8") as f:
    f.write(html)
chrome = find_chrome()
if not chrome:
    sys.exit("no chrome found")
out = os.path.join(OUT, "gm_chip_preview.png")
cmd = [chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
       "--force-device-scale-factor=2", "--window-size=400,500",
       "--screenshot=%s" % out, "file:///" + hpath.replace("\\", "/")]
subprocess.run(cmd, capture_output=True, timeout=120)
print("wrote:", out, os.path.getsize(out))
