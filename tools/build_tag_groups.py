# -*- coding: utf-8 -*-
"""
Build web/js/data/tag_groups.json — the live Danbooru tag_group catalogue.

Input (read-only):
  $DBTAGS_GROUPS_CACHE  dir of raw DText dumps, one "<title>.dtext" per wiki
                        page (title ":" -> "__"). Missing pages are fetched
                        from Danbooru unless --offline.
Output:
  $DBTAGS_PLUGIN_DATA/tag_groups.json   (+ <project root>/build_report.json entry)

Design: the file stores ONLY the group structure (sections + member order +
per-bullet note). Member zh names, post counts and example-image availability
are resolved at RUNTIME by the frontend against the composed tag index
(getTagMap().get / tag.images), so category toggles and data rebuilds keep
the browser in sync for free.

Parser rules (validated in the preview round; five blind spots fixed):
  * section heads h2..h6 ("h4. Title"), see-also/external-links dropped
  * members = leading [[tag]] chain of a bullet after stripping "!post #N:"
  * alias-chain separators: / + , ; & or and  (+ whitespace directly before [[)
  * anything after a non-separator (parenthesis, dash, prose) is a NOTE
  * untitled leading bullets form an implicit first section; [[a|disp]] -> a
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

sys.stdout.reconfigure(encoding="utf-8")

HUB_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # project root
PLUGIN_DATA = os.environ.get("DBTAGS_PLUGIN_DATA", "").strip() or os.path.join(
    HUB_BASE, "web", "js", "data")
GROUPS_CACHE = os.environ.get("DBTAGS_GROUPS_CACHE", "").strip()
API = "https://danbooru.donmai.us"

HEAD_RE = re.compile(r"^h([2-6])(?:#[\w-]+)?\.\s*(.+)$")
BUL_RE = re.compile(r"^(\*+)\s+(.*)$")
LINK_RE = re.compile(r"\[\[([^\]|\#]+)(?:\|([^\]]*))?\]\]")
POST_RE = re.compile(r"^!post\s*#\d+\s*:\s*")
SEP_TOK = re.compile(r"(?:\s*(?:[/+,;&]|\bor\b|\band\b))+\s*")
SKIP_H = re.compile(r"^(see\s+also|external\s+links?)\b", re.I)
NAMESPACE = re.compile(r"^(tag group|tag_group|list of|help|template|category|file)\s*[:_]", re.I)


def clean_title(t):
    t = LINK_RE.sub(lambda m: (m.group(2) or m.group(1)).strip(), t)
    return re.sub(r"\s+", " ", t.replace("[[", "").replace("]]", "")).strip()


def clean_note(t):
    t = POST_RE.sub("", t)
    t = LINK_RE.sub(lambda m: (m.group(2) or m.group(1)).strip(), t)
    t = re.sub(r"\s*\[\[|\]\]\s*", " ", t)
    t = re.sub(r"\[/?(?:tn|i|b|code|u|sup|small)\]", "", t)
    t = re.sub(r"^\s*[-–—:：>→\s]+", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return (t[:110] + "…") if len(t) > 111 else t


def sep_len(rest):
    for m in (SEP_TOK.match(rest), re.match(r"^\s+", rest)):
        if m and LINK_RE.match(rest[m.end():]):
            return m.end()
    return None


def bullet_members(body):
    body = POST_RE.sub("", body.strip())
    heads, pos = [], 0
    while True:
        m = LINK_RE.match(body, pos)
        if not m:
            break
        heads.append(m)
        n = sep_len(body[m.end():])
        if n is None:
            pos = m.end()
            break
        pos = m.end() + n
    if not heads:
        return []
    note = clean_note(body[pos:]) if pos < len(body) else ""
    out = []
    for h in heads:
        k = h.group(1).strip().replace(" ", "_").lower().rstrip(",.")
        if k and not NAMESPACE.match(k) and len(k) <= 60:
            out.append((k, note))
    return out


def parse_group(dtext):
    sections, cur, in_code, seen_head = [], None, False, False
    intro = ""
    for raw in dtext.splitlines():
        line = raw.strip()
        if line.startswith("[code]"):
            in_code = True
            continue
        if line.startswith("[/code]"):
            in_code = False
            continue
        if in_code or not line:
            continue
        if cur is None and not seen_head and not intro and not HEAD_RE.match(line) and not BUL_RE.match(line):
            intro = clean_note(line)[:200]
        m = HEAD_RE.match(line)
        if m:
            seen_head = True
            t = clean_title(m.group(2))
            if SKIP_H.match(t):
                cur = None
            else:
                cur = {"t": t, "lv": int(m.group(1)), "m": []}
                sections.append(cur)
            continue
        b = BUL_RE.match(line)
        if not b:
            continue
        if cur is None:
            if seen_head:
                continue
            cur = {"t": "", "lv": 4, "m": []}
            sections.append(cur)
        for name, note in bullet_members(b.group(2)):
            cur["m"].append({"k": name, "n": note, "d": len(b.group(1))})
    return [s for s in sections if s["m"]], intro


# ---- 组中文名（91 活组全量，与 preview 验证版一致） ----
GROUP_ZH = {
    "attire": "服装", "accessories": "饰品", "headwear": "头部穿戴", "handwear": "手部穿戴",
    "legwear": "腿部穿戴", "neck_and_neckwear": "颈部与领饰", "sleeves": "袖子",
    "sexual_attire": "情色服装", "fashion_style": "时尚风格", "covering": "遮蔽方式",
    "prints": "印花图案", "patterns": "纹样", "hair": "头发", "hair_styles": "发型",
    "hair_color": "发色", "face_tags": "面部", "eyes_tags": "眼睛", "eyewear": "镜类",
    "ears_tags": "耳朵", "hands": "手部动作", "feet": "足部", "ass": "臀部",
    "body_parts": "身体部位", "shoulders": "肩部", "breasts_tags": "胸部", "pussy": "女性私处",
    "nudity": "裸露", "skin_color": "肤色", "posture": "姿态", "gestures": "手势",
    "verbs_and_gerunds": "动作动词", "holding_tags": "手持物", "sex_acts": "性行为",
    "simulated_sex_acts": "模仿性行为", "sexual_positions": "体位", "sex_objects": "性具",
    "bdsm_and_torture": "绑缚调教", "character_count": "角色数量", "gender_nonconformity": "性别表达",
    "transgender": "跨性别", "image_composition": "图像构图", "focus_tags": "取景焦点",
    "lighting": "光照", "backgrounds": "背景", "water": "水", "fire": "火", "colors": "颜色",
    "symbols": "符号", "text": "画面文字", "phrases": "台词短语", "subjective": "主观评价",
    "visual_aesthetic": "视觉质感", "audio_tags": "声音", "technology": "科技设备",
    "drawing_software": "绘图软件", "locations": "场景地点", "real_world_locations": "现实地点",
    "doors_and_gates": "门窗与大门", "history": "历史", "jobs": "职业",
    "family_relationships": "亲属关系", "companies_and_brand_names": "公司与品牌",
    "holidays_and_celebrations": "节日庆典", "censorship": "审查打码", "metatags": "元标签",
    "groups": "群体组合", "year_tags": "年份年代", "flowers": "花", "birds": "鸟类",
    "cats": "猫", "dogs": "犬", "wings": "翅膀", "legendary_creatures": "传说生物",
    "people": "真实人物", "food_tags": "食物", "sports": "运动", "dances": "舞蹈",
    "makeup": "妆容", "video_game": "电子游戏", "cards": "卡牌", "board_games": "桌面游戏",
    "role-playing_games": "角色扮演游戏", "fighting_games": "格斗游戏", "shooter_games": "射击游戏",
    "platform_games": "平台游戏", "visual_novel_games": "视觉小说", "pixiv_projects": "Pixiv企划",
    "fine_art_parody": "名画恶搞", "artistic_license": "艺术加工", "japanese_dialects": "日语方言",
    "theme": "主题", "language": "语言",
}
# ---- 高频英文节标题 -> 中文（未命中者前端原样显示英文） ----
# 全量表自 v0.4.7 起迁到 tools/tag_group_section_zh.json（可独立增补，免改码）
SEC_ZH_FILE = os.path.join(HUB_BASE, "tools", "tag_group_section_zh.json")


def load_sec_zh():
    try:
        with io.open(SEC_ZH_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print("note: 节标题汉化表加载失败(%s)，用内置精简表" % e)
        return SEC_ZH
SEC_ZH = {
    "View Angle": "取景视角", "Perspective/Depth": "透视与纵深", "Composition": "构图",
    "Format": "媒介格式", "Subject matter": "题材", "Framing the body": "身体取景",
    "Styles": "画风", "Techniques": "技法", "Traditional Japanese Patterns": "日本传统纹样",
    "Other Patterns": "其他纹样", "Flaws": "画面瑕疵", "Background/Color": "背景与色彩",
    "Traditional media": "传统媒介", "Other": "其他", "Others": "其他", "Misc": "杂项",
    "Miscellaneous": "杂项", "Main": "主要", "Actions": "动作", "About": "说明",
    "Colors": "颜色", "Multiple Colors": "多色", "Types": "类型", "Type": "类型",
    "Patterns": "图案", "Accessories": "配饰", "Jewelry": "首饰",
    "Jewelry and Accessories": "首饰与配饰", "Related tags": "相关标签",
    "Related tag groups": "相关标签组", "Head": "头部", "Neck": "颈部", "Arms": "手臂",
    "Legs": "腿部", "Torso": "躯干", "Hands on breasts": "手放胸部", "Places": "地点",
    "Ties": "系带与领带", "Video games": "电子游戏", "Sexual": "性相关", "Style": "风格",
    "Weapons": "武器", "Objects": "物件", "Symbols": "符号", "Anatomy": "解剖",
    "Fetishes": "癖好", "Culture": "文化", "Tools": "工具", "Jobs": "职业",
    "Military": "军事", "Fluids": "液体", "Vehicles": "载具", "By body part": "按部位",
    "Bags": "包袋", "Decorations": "装饰", "Headwear and Headgear": "头部穿戴",
    "Shirts and Topwear": "上衣", "Pants and Bottomwear": "下装",
    "Africa": "非洲", "Asia": "亚洲", "Europe": "欧洲", "South America": "南美洲",
    "North America": "北美洲", "Oceania": "大洋洲", "Ice hockey": "冰球",
    "Baseball": "棒球", "Soccer": "足球", "Boxing": "拳击", "Golf": "高尔夫",
    "Tennis": "网球", "Basketball": "篮球", "Rugby": "橄榄球",
    "American Football": "美式橄榄球", "Association football (soccer)": "足球",
    "Motorsports": "赛车", "Horse racing": "赛马", "Figure skating": "花样滑冰",
    "Mixed martial arts": "综合格斗", "Volleyball": "排球", "Athletics": "田径",
    "Major Countries": "主要国家", "Minor Countries": "其他国家",
}


def curl_json(url, tries=3):
    for _ in range(tries):
        p = subprocess.run(["curl", "-s", "--max-time", "40", url], capture_output=True)
        try:
            return json.loads(p.stdout.decode("utf-8", "replace"))
        except Exception:
            time.sleep(1.2)
    return None


def fetch_body(title, offline):
    if GROUPS_CACHE:
        fp = os.path.join(GROUPS_CACHE, title.replace(":", "__") + ".dtext")
        if os.path.isfile(fp) and os.path.getsize(fp) > 50:
            return io.open(fp, encoding="utf-8").read()
    if offline:
        return ""
    d = curl_json(API + "/wiki_pages/" + urllib.parse.quote(title, safe="") + ".json")
    body = (d or {}).get("body") or ""
    if body and GROUPS_CACHE:
        io.open(os.path.join(GROUPS_CACHE, title.replace(":", "__") + ".dtext"),
                "w", encoding="utf-8", newline="\n").write(body)
        time.sleep(0.3)
    return body


def list_titles(offline):
    """Live, non-deleted tag_group:* wiki titles (91 as of 2026-10)."""
    if not offline:
        live = curl_json(API + "/wiki_pages.json?search%5Btitle_normalize%5D=tag_group%3A%2A&limit=500")
        if live:
            return sorted(w["title"] for w in live if not w.get("is_deleted"))
    # offline fallback: the verified live set (GROUP_ZH minus "language" which
    # is not a tag_group page; tombstones are never cached with bodies here)
    return sorted("tag_group:" + k for k in GROUP_ZH if k != "language")


def build(offline=False):
    titles = list_titles(offline)
    out, totR, totN, skipped = [], 0, 0, []
    SEC_ZH = load_sec_zh()
    for t in titles:
        body = fetch_body(t, offline)
        if not body:
            skipped.append((t, "空正文"))
            continue
        secs, intro = parse_group(body)
        if not secs:
            skipped.append((t, "解析后 0 成员"))
            continue
        short = t.split(":", 1)[1]
        members = set()
        srow = []
        for s in secs:
            rows = []
            for e in s["m"]:
                members.add(e["k"])
                rows.append([e["k"], e["n"], e["d"]])
            totR += len(rows)
            srow.append([s["t"], SEC_ZH.get(s["t"], ""), s["lv"], rows])
        totN += len(members)
        out.append((len(members), {"n": short, "zh": GROUP_ZH.get(short, ""),
                                   "intro": intro, "s": srow}))
    out.sort(key=lambda x: -x[0])   # 成员数降序; 前端再按收录数重排
    data = {
        "version": "v0.4.7",
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": "danbooru wiki tag_group:* (live pages)",
        "groups": [g for _, g in out],
    }
    return data, totR, totN, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="cache only, no network")
    args = ap.parse_args()
    if not GROUPS_CACHE:
        print("note: $DBTAGS_GROUPS_CACHE 未设置 -> 全部正文从 Danbooru 现fetch（无缓存）")
    data, totR, totN, skipped = build(args.offline)
    os.makedirs(PLUGIN_DATA, exist_ok=True)
    fp = os.path.join(PLUGIN_DATA, "tag_groups.json")
    io.open(fp, "w", encoding="utf-8", newline="\n").write(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    kb = os.path.getsize(fp) / 1024
    rep = {"tag_groups": {"groups": len(data["groups"]), "member_refs": totR,
                          "unique_members": totN, "out": fp, "size_kb": round(kb, 1),
                          "skipped": skipped}}
    rp = os.path.join(HUB_BASE, "build_report.json")
    old = {}
    if os.path.isfile(rp):
        try:
            old = json.load(io.open(rp, encoding="utf-8"))
        except Exception:
            old = {}
    old.update(rep)
    io.open(rp, "w", encoding="utf-8", newline="\n").write(json.dumps(old, ensure_ascii=False, indent=1))
    print("OK %s | %d 组 | %d 成员引用 | %d 唯一成员 | %.0fKB" % (fp, len(data["groups"]), totR, totN, kb))
    for t, why in skipped:
        print("  skip:", t, why)


if __name__ == "__main__":
    main()
