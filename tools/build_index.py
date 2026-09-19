# -*- coding: utf-8 -*-
"""
Build the compact client index for the danbooru autocomplete extension (v3).

READ-ONLY on all upstream sources. Outputs go straight into the deployed
plugin data dir (see PLUGIN_DATA) + a build report in the hub dir.

Input (read-only; paths come from the DBTAGS_* env vars, see below):
  $DBTAGS_WIKI_FILE       英文源 (name, post_count, body, other_names, ...)
  $DBTAGS_ZH_DICT         全量中文 (name, name_cn, aliases_cn, body_cn)
  $DBTAGS_SRC_BASE/manifest.json   示例图清单 (tag -> {small, large})

Output:
  $DBTAGS_PLUGIN_DATA/0_general.json   (+ one file per category, 5_meta.json …)
  <project root>/build_report.json

Per-tag entry keys:
  name / post_count         英文标签与热度
  zh / aliases              源站中文别名 / 全部别名（匹配用）
  summary                   英文 wiki 摘要（截 300，en 模式显示与前端正文匹配用）
  zhtag                     中文名（翻译库 name_cn）
  aliases_zh                中文别名（翻译库 aliases_cn）
  wiki_zh                   中文正文（翻译库 body_cn，清洗截 800；
                            空正文条目不写此字段，前端回退 summary）
  py                        拼音列表（v3）：与 [zhtag]+aliases_zh+zh 逐位平行的
                            无声调全拼串（词组语境读音，长袜->changwa）。
                            JS 端用同一取数顺序重建中文原词，故不重复存原文。
  images / links            示例图路径 / 英文 body 提取的链接

Link markup [[target|display]] is kept verbatim inside summary/wiki_zh;
target is always English. Only whitespace is collapsed and over-long tails
are cut at a link boundary.

Usage:
  python build_index.py [--limit N] [--verbose]
                        [--zh-dict PATH] [--out-dir DIR]
  --limit 0  builds ALL tags
"""

import argparse
import io
import json
import os
import re
import sys
import time

try:
    from pypinyin import lazy_pinyin      # build-time only; front-end ships no dict
except ImportError:                        # pragma: no cover
    print("FAIL: pip install pypinyin (needed to emit the 'py' field)")
    sys.exit(1)

if sys.stdout and hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                   errors="replace")

# Author-machine inputs are read from env vars (kept out of the public repo).
# Set these before running build_index.py:
#   DBTAGS_SRC_BASE     crawled dataset dir (holds manifest.json / links_pending.jsonl)
#   DBTAGS_PLUGIN_DATA  output dir for the category index files
#   DBTAGS_WIKI_FILE    English wiki source (jsonl)
#   DBTAGS_ZH_DICT      full Chinese translations (jsonl)
SRC_BASE = os.environ.get("DBTAGS_SRC_BASE", "").strip()
HUB_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # project root
PLUGIN_DATA = os.environ.get("DBTAGS_PLUGIN_DATA", "").strip()
WIKI_FILE = os.environ.get("DBTAGS_WIKI_FILE", "").strip()        # 英文源（上游）
ZH_DICT_FILE = os.environ.get("DBTAGS_ZH_DICT", "").strip()      # 全量中文翻译（上游）
CAT = int(os.environ.get("DBTAGS_CAT", "0") or 0)                # 本宇宙分类: general=0, meta=5
MANIFEST_FILE = os.path.join(SRC_BASE, "manifest.json")
# multi-category: each category is a SEPARATE output file (0_general.json,
# 5_meta.json, ...). A "source" = {name, cat, wiki, zh, manifest, out}.
SOURCES_FILE = os.environ.get("DBTAGS_SOURCES", "").strip()
OUT_INDEX = os.path.join(PLUGIN_DATA, "0_general.json")
OUT_REPORT = os.path.join(HUB_BASE, "build_report.json")
OUT_PENDING = os.path.join(SRC_BASE, "links_pending.jsonl")

# Fallback single source from the legacy per-run env vars.
def _legacy_source():
    return {"name": "general", "cat": CAT, "wiki": WIKI_FILE,
            "zh": ZH_DICT_FILE, "manifest": MANIFEST_FILE,
            "out": os.path.basename(OUT_INDEX)}

if not PLUGIN_DATA:
    print("FAIL: missing required env var: DBTAGS_PLUGIN_DATA")
    print("      build_index.py is the author's offline dataset builder; set the "
          "DBTAGS_* paths above (see header comment) before running.")
    sys.exit(1)
if not SOURCES_FILE and not (SRC_BASE and WIKI_FILE and ZH_DICT_FILE):
    print("FAIL: set DBTAGS_SOURCES (multi-category json) or the legacy "
          "DBTAGS_SRC_BASE/DBTAGS_WIKI_FILE/DBTAGS_ZH_DICT triple.")
    sys.exit(1)

SUMMARY_LEN = 300       # 英文 summary 截断
WIKI_ZH_LEN = 800       # 中文正文 wiki_zh 截断
VERSION = 3
LINK_CAP = 10   # 每个 tag 最多保留的有效链接数

CJK = re.compile(r"[\u4e00-\u9fff]")
_JP_KANA = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff]")  # 平假名/片假名# 日文独有汉字（简体中文基本不使用）：命中即判为日文别名
_JP_HANZI = set(
    "髪長黒絵図訳圧拡巻崎藤沢岡塚畑丼峠働凧凪桜桧穂瀬冴艦様獣豚滝湧漬"
    "蟹蛸蟻蝶蛹蛾蝿虹鯨鯛鱈鰯鮎鮭鰻鳩鴉雀鷹鶴鷲兎狸狐狛獅罠虜鍵鋸釘鎌"
    "剣砲銃弾弐壱円駒鞍轡鐙蔦葛団饅飴薔薇茉莉絆錬冨"
    "蜷螢蚤蟋蟀蟬蜩蜻蛉蜆蜊蛤鮪鮫鮟鮠鰹鰤鱚鱶"
    "帯齢異姦絶縁続経済給線語際関頭顔発動後東車駅気隣拡栄壊決検権観覧覚"
    "読買売転専職複雑産確実悪状態確認論議縦横満従処総応歳週億円"
    "擬尻姫穫聴竜"
    "機馬鳥魚龍點風蟲雲電學體國門關時書紙筆畫圖寫讀說話語詩樂藥醫劍"
)
# 日文词汇黑名单：含以下词即判为日文
_JP_WORDS = ("子供", "人外", "女体化", "異種", "悪戯", "必殺", "妹系", "兄貴",
             "姦通", "処女", "処男", "輪姦", "幼馴染", "寝取", "学園", "戦争",
             "悪役", "着替", "抜き", "倒錯", "調教", "凌辱", "陵辱", "巨大娘")
_BRACKET = re.compile(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]")
_POSTLINK = re.compile(r"!post #\d+")
_HEADING = re.compile(r"^h\d+\.\s*", re.MULTILINE)
_LIST = re.compile(r"^\s*\*\s+", re.MULTILINE)
_URL = re.compile(r"\([^)]*\)")
_ASSET = re.compile(r"!asset #?\d+(?::[^\r\n.!]*)?")
_URLREF = re.compile(r'"([^"]+)":\[?https?://[^\]]+\]?')
_WS = re.compile(r"\s+")

_VERBOSE = False


def log(msg):
    print(msg, flush=True)


def verbose(msg):
    if _VERBOSE:
        print("[verbose] " + msg, flush=True)


def clean_summary(body, cap=None):
    """Collapse whitespace and truncate, but KEEP [[...]] link markers so the
    front-end can render them clickable. Source is already clean_wiki output."""
    if not body:
        return ""
    if cap is None:
        cap = SUMMARY_LEN
    t = body.replace("\r\n", "\n").replace("\r", "\n")
    # keep [[...]] verbatim, compress whitespace around them
    parts = []
    last = 0
    for m in _LINK.finditer(t):
        if m.start() > last:
            parts.append(_WS.sub(" ", t[last:m.start()]).strip())
        parts.append(m.group(0))
        last = m.end()
    if last < len(t):
        parts.append(_WS.sub(" ", t[last:]).strip())
    out = " ".join(p for p in parts if p)
    out = out[:cap]
    # drop a trailing unclosed [[ link (or {{ template }) cut by the truncation
    if out.count("[[") > out.count("]]"):
        i = out.rfind("[[")
        out = out[:i].rstrip()
    if out.count("{{") > out.count("}}"):
        i = out.rfind("{{")
        out = out[:i].rstrip()
    return out


def extract_zh(other_names):
    """Real Chinese aliases only (japanese kanji/kana removed), deduped."""
    out = []
    seen = set()
    for x in other_names or []:
        s = str(x).strip()
        if not s or s in seen:
            continue
        if not CJK.search(s):
            continue
        if _JP_KANA.search(s):
            continue                        # 含日文假名 -> 日文
        if any(c in _JP_HANZI for c in s):
            continue                        # 含日文专用汉字 -> 日文
        if any(w in s for w in _JP_WORDS):
            continue                        # 含日文词汇 -> 日文
        seen.add(s)
        out.append(s)
    return out


_LINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]")  # allow empty display text [[x|]]


def norm_tag(t):
    """Normalize a [[target]] so it can be looked up in the tag table."""
    return re.sub(r"\s+", " ", t).strip().lower().replace(" ", "_")


def guess_category(target):
    """Coarse guess for pending (unresolved) link targets."""
    low = target.lower()
    if low.startswith("tag group:") or low.startswith("tag_group:"):
        return "taggroup"
    if low.startswith("list of "):
        return "listpage"
    if "(" in target or ")" in target:
        return "character_like"
    if target != target.lower():
        return "proper_noun"
    return "general_miss"


def extract_links(body, name_set, pending, source_name):
    """Return valid links [{n, t}] for one tag; unresolved targets go to
    `pending` (a dict) which is later written out as links_pending.jsonl."""
    if not body:
        return []
    links = []
    seen = set()
    for m in _LINK.finditer(body):
        t = m.group(1).strip()
        n = norm_tag(t)
        if n in name_set:
            if n in seen:
                continue
            seen.add(n)
            links.append({"n": n, "t": (m.group(2) or t).strip()})
            if len(links) >= LINK_CAP:
                break
        else:
            p = pending.get(n)
            if p is None:
                pending[n] = {"target": t, "norm": n, "category": guess_category(t),
                              "count": 0, "sources": []}
            pending[n]["count"] += 1
            if source_name and source_name not in pending[n]["sources"] \
                    and len(pending[n]["sources"]) < 5:
                pending[n]["sources"].append(source_name)
    return links


def load_rows(wiki_file):
    rows = []
    with open(wiki_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception as e:
                verbose("skip bad line: %r" % e)
    return rows


def load_manifest(manifest_file):
    if not manifest_file or not os.path.exists(manifest_file):
        return {}
    try:
        with open(manifest_file, "r", encoding="utf-8") as f:
            m = json.load(f)
        if not isinstance(m, dict):
            return {}
        return m
    except Exception as e:
        verbose("manifest load failed: %r" % e)
        return {}


def load_zh_dict(path):
    """Load the full translation export -> {name: {zhtag, aliases_zh, wiki_zh}}.

    Source schema ($DBTAGS_ZH_DICT jsonl):
      name / name_cn / aliases_cn / body_cn
    Field mapping (old pipeline names kept so the front-end needs no change):
      name_cn -> zhtag, aliases_cn -> aliases_zh, body_cn -> wiki_zh
    Empty body_cn (source wiki has no text) is skipped on purpose so the
    front-end falls back to the English summary.
    """
    out = {}
    if not path or not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            if not r.get("name"):
                continue
            rec = {}
            if r.get("name_cn"):
                rec["zhtag"] = str(r["name_cn"]).strip()
            if r.get("aliases_cn"):
                rec["aliases_zh"] = [str(a).strip() for a in r["aliases_cn"]
                                     if str(a).strip()]
            if r.get("body_cn"):
                rec["wiki_zh"] = r["body_cn"]
            if rec:
                out[r["name"]] = rec
    return out


def build(limit, out_path, zh_dict_path=None, wiki_file=None,
          manifest_file=None, cat=None, name_set=None, out_pending=None):
    start = time.time()
    wiki_file = wiki_file or WIKI_FILE
    manifest_file = manifest_file or MANIFEST_FILE
    cat = CAT if cat is None else cat
    out_pending = out_pending or OUT_PENDING
    rows = load_rows(wiki_file)
    manifest = load_manifest(manifest_file)
    zh_dict = load_zh_dict(zh_dict_path)
    if zh_dict:
        print("zh-dict merged: %d tags" % len(zh_dict), flush=True)
    verbose("loaded %d wiki rows, %d manifest entries" % (len(rows), len(manifest)))

    rows.sort(key=lambda r: -(r.get("post_count") or 0))
    if limit:
        rows = rows[:limit]

    tags = []
    n_zh = 0
    n_alias = 0
    n_img = 0
    n_links = 0
    n_truncated = 0
    n_zhtag = 0
    n_zhwiki = 0
    n_zhwiki_trunc = 0
    n_py = 0
    pending = {}
    # link targets resolve against the UNION of every category's names, so a
    # general body's [[highres]] and a meta body's [[1girl]] both become
    # clickable chips -> bidirectional jump (name_set is precomputed by main()).
    if name_set is None:
        name_set = {r.get("name") for r in rows if r.get("name")}
    for r in rows:
        name = r.get("name", "")
        zh = extract_zh(r.get("other_names"))
        aliases = [str(x).strip() for x in (r.get("other_names") or [])
                   if str(x).strip()]
        if zh:
            n_zh += 1
        if aliases:
            n_alias += 1
        links = extract_links(r.get("body"), name_set, pending, name)
        n_links += len(links)
        if len(links) >= LINK_CAP:
            n_truncated += 1
        entry = manifest.get(name)
        img = []
        if isinstance(entry, dict):
            small = entry.get("small")
            large = entry.get("large")
            if small or large:
                img = [small or "", large or ""]
                n_img += 1
        rec = {
            "name": name,
            "cat": cat,
            "post_count": r.get("post_count") or 0,
            "zh": zh,
            "aliases": aliases,
            "summary": clean_summary(r.get("body")),
            "images": img,
            "links": links,
        }
        if zh_dict:
            t = zh_dict.get(name) or {}
            if "zhtag" in t:
                rec["zhtag"] = t["zhtag"]
                n_zhtag += 1
            if "aliases_zh" in t:
                rec["aliases_zh"] = t["aliases_zh"]
            if "wiki_zh" in t:
                body = clean_summary(t["wiki_zh"], WIKI_ZH_LEN)
                if body:
                    rec["wiki_zh"] = body
                    n_zhwiki += 1
                if len(t["wiki_zh"]) > WIKI_ZH_LEN:
                    n_zhwiki_trunc += 1
        # py: toneless full pinyin, positionally parallel to
        # [zhtag] + aliases_zh + zh (JS rebuilds the source list identically)
        zh_strings = [s for s in ([rec.get("zhtag")] + rec.get("aliases_zh", [])
                                  + rec.get("zh", [])) if s]
        if zh_strings:
            rec["py"] = ["".join(lazy_pinyin(s)).lower() for s in zh_strings]
            n_py += 1
        tags.append(rec)

    n_pending_links = sum(p["count"] for p in pending.values())
    if pending:
        try:
            with open(out_pending, "w", encoding="utf-8") as f:
                for p in sorted(pending.values(), key=lambda x: -x["count"]):
                    f.write(json.dumps(p, ensure_ascii=False) + "\n")
        except Exception as e:
            verbose("pending write failed: %r" % e)

    index = {
        "version": VERSION,
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source_total": len(rows) if not limit else _count_all(wiki_file),
        "limit": limit,
        "count": len(tags),
        "tags": tags,
    }
    if limit:
        index["source_total"] = _count_all(wiki_file)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)

    size = os.path.getsize(out_path)
    elapsed = time.time() - start

    report = {
        "timestamp": index["built_at"],
        "args": {"limit": limit, "verbose": _VERBOSE,
                 "zh_dict": zh_dict_path or None},
        "source": {"wiki_file": wiki_file, "manifest_file": manifest_file,
                   "zh_dict": zh_dict_path or None},
        "cat": cat,
        "source_total": index["source_total"],
        "built_count": len(tags),
        "with_chinese_alias": n_zh,
        "with_any_alias": n_alias,
        "with_image": n_img,
        "with_zhtag": n_zhtag,
        "with_zhwiki": n_zhwiki,
        "with_zhwiki_truncated": n_zhwiki_trunc,
        "with_py": n_py,
        "links_valid": n_links,
        "links_truncated_tags": n_truncated,
        "links_pending_targets": len(pending),
        "links_pending_links": n_pending_links,
        "links_hit_rate": round(100.0 * n_links / max(1, n_links + n_pending_links), 1),
        "output": out_path,
        "output_bytes": size,
        "elapsed_s": round(elapsed, 2),
        "samples": tags[:3],
    }
    print("=== build report (%s) ===" % out_path)
    for k in ("source_total", "built_count", "with_chinese_alias",
              "with_any_alias", "with_image", "with_zhtag", "with_zhwiki",
              "with_zhwiki_truncated", "with_py",
              "links_valid",
              "links_truncated_tags", "links_pending_targets",
              "links_pending_links", "links_hit_rate",
              "output_bytes", "elapsed_s"):
        print("  %-18s %s" % (k, report[k]))
    print("  output: %s" % out_path)
    if _VERBOSE:
        print("=== samples ===")
        print(json.dumps(report["samples"], ensure_ascii=False, indent=2))
    return report


def _count_all(wiki_file):
    n = 0
    with open(wiki_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                n += 1
    return n


def verify(out_path):
    print("=== self-check ===")
    errors = []
    if not os.path.exists(out_path):
        errors.append("index file missing: %s" % out_path)
    else:
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                idx = json.load(f)
            required = {"version", "count", "tags"}
            missing = required - set(idx.keys())
            if missing:
                errors.append("missing keys: %s" % sorted(missing))
            if idx["count"] != len(idx["tags"]):
                errors.append("count mismatch: header=%d actual=%d"
                              % (idx["count"], len(idx["tags"])))
            for t in idx["tags"]:
                if "name" not in t or "post_count" not in t or "zh" not in t \
                        or "aliases" not in t or "summary" not in t \
                        or "images" not in t or "links" not in t:
                    errors.append("bad tag entry: %s" % t.get("n"))
                    break
            if idx.get("version") != VERSION:
                errors.append("version mismatch: file=%s expected=%s"
                              % (idx.get("version"), VERSION))
            n_zhtag = sum(1 for t in idx["tags"] if t.get("zhtag"))
            n_wiki = sum(1 for t in idx["tags"] if t.get("wiki_zh"))
            # only flag imbalance caused BY truncation (entry at the cap).
            # Source-faithful unclosed links (contract 3.3) are kept as-is.
            bad = [t["name"] for t in idx["tags"]
                   if isinstance(t.get("wiki_zh"), str)
                   and len(t["wiki_zh"]) >= WIKI_ZH_LEN
                   and (t["wiki_zh"].count("[[") != t["wiki_zh"].count("]]")
                        or t["wiki_zh"].count("{{") > t["wiki_zh"].count("}}"))]
            over = [t["name"] for t in idx["tags"]
                    if isinstance(t.get("wiki_zh"), str)
                    and len(t["wiki_zh"]) > WIKI_ZH_LEN]
            if bad:
                errors.append("wiki_zh unbalanced links: %d (e.g. %s)"
                              % (len(bad), bad[:3]))
            if over:
                errors.append("wiki_zh over cap: %d (e.g. %s)"
                              % (len(over), over[:3]))
            n_py = 0
            for t in idx["tags"]:
                srcs = [s for s in ([t.get("zhtag")] + t.get("aliases_zh", [])
                                    + t.get("zh", [])) if s]
                py = t.get("py")
                if py is None:
                    if srcs:
                        errors.append("py missing with zh sources: %s" % t["name"])
                        break
                    continue
                if len(py) != len(srcs) or not all(isinstance(x, str) and x
                                                   for x in py):
                    errors.append("py not parallel to zh sources: %s" % t["name"])
                    break
                n_py += 1
            print("  zhtag coverage: %d/%d" % (n_zhtag, len(idx["tags"])))
            print("  wiki_zh coverage: %d/%d" % (n_wiki, len(idx["tags"])))
            print("  py coverage: %d/%d" % (n_py, len(idx["tags"])))
        except Exception as e:
            errors.append("index parse failed: %r" % e)
    if errors:
        print("  FAIL:")
        for e in errors:
            print("    - " + e)
        return 1
    print("  OK: %d tags, %d bytes" % (idx["count"],
                                        os.path.getsize(out_path)))
    return 0


def _load_sources():
    """Category sources to build. Multi-category via $DBTAGS_SOURCES (a JSON
    file: {"sources":[{name,cat,wiki,zh,manifest,out},...]} or a bare list).
    Falls back to a single legacy source from the per-run env vars."""
    if SOURCES_FILE:
        with open(SOURCES_FILE, "r", encoding="utf-8") as f:
            spec = json.load(f)
        srcs = spec.get("sources") if isinstance(spec, dict) else spec
        return srcs or []
    return [_legacy_source()]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=0,
                    help="only build the first N tags by post_count (0=all)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--zh-dict", default=None,
                    help="legacy single-source zh override (ignored with "
                         "DBTAGS_SOURCES; each source carries its own zh)")
    ap.add_argument("--out-dir", default=None,
                    help="override output dir (DBTAGS_PLUGIN_DATA) for the "
                         "category index files")
    args = ap.parse_args()
    global _VERBOSE, PLUGIN_DATA
    _VERBOSE = args.verbose
    if args.out_dir:
        PLUGIN_DATA = os.path.abspath(args.out_dir)
    if not PLUGIN_DATA:
        print("FAIL: no output dir (set DBTAGS_PLUGIN_DATA or --out-dir)")
        return 2

    srcs = _load_sources()

    # pass 1: preload every category and form the UNION name-set so link
    # extraction in every output can resolve cross-category [[targets]].
    union = set()
    for s in srcs:
        for r in load_rows(s["wiki"]):
            nm = r.get("name")
            if nm:
                union.add(nm)
    log("union name-set across %d categories: %d tags" % (len(srcs), len(union)))

    reports = []
    rc = 0
    for s in srcs:
        out_path = os.path.join(PLUGIN_DATA, s["out"])
        stem = os.path.splitext(s["out"])[0]
        zh = args.zh_dict or s.get("zh")
        log("\n### building %s -> %s (cat=%s) ###"
            % (s.get("name", s["out"]), s["out"], s.get("cat", 0)))
        rep = build(args.limit, out_path, zh_dict_path=zh,
                    wiki_file=s["wiki"], manifest_file=s.get("manifest"),
                    cat=s.get("cat", 0), name_set=union,
                    out_pending=os.path.join(HUB_BASE, "links_pending_%s.jsonl" % stem))
        rep["name"] = s.get("name", s["out"])
        reports.append(rep)
        if verify(out_path) != 0:
            rc = 1

    # catalog.json: the frontend discovers which category files exist here and
    # builds the "标签类别" toggles from it (dynamic discovery). `default` marks
    # categories loaded out-of-the-box (general always; extras opt-in).
    catalog = {
        "version": VERSION,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "categories": [{
            "file": os.path.basename(r["output"]),
            "key": os.path.splitext(os.path.basename(r["output"]))[0],
            "label": s.get("label") or s.get("name") or r["name"],
            "cat": r["cat"],
            "count": r["built_count"],
            "default": bool(s.get("default", r["cat"] == 0)),
        } for s, r in zip(srcs, reports)],
    }
    with open(os.path.join(PLUGIN_DATA, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))
    log("catalog.json: " + ", ".join(
        "%s(%s,%d%s)" % (c["key"], c["label"], c["count"],
                         ",default" if c["default"] else "")
        for c in catalog["categories"]))

    with open(OUT_REPORT, "w", encoding="utf-8") as f:
        json.dump({"union_names": len(union),
                   "categories": [{"name": r["name"], "cat": r["cat"],
                                   "out": r["output"], "count": r["built_count"],
                                   "links_valid": r["links_valid"],
                                   "output_bytes": r["output_bytes"]}
                                  for r in reports],
                   "sources": reports},
                  f, ensure_ascii=False, indent=2)
    log("\nwrote %d category index file(s) to %s" % (len(reports), PLUGIN_DATA))
    log("aggregated report: %s" % OUT_REPORT)
    return rc


if __name__ == "__main__":
    sys.exit(main())
