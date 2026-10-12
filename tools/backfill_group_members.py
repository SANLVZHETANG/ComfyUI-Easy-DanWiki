# -*- coding: utf-8 -*-
"""Backfill missing tag-group members: crawl danbooru wiki bodies for the
6,107 uncollected members (v4 survey TSV) and emit per-category jsonl rows
consumed by build_index.py (schema: name/post_count/body/other_names).

Sharded long-run design (PROJECT long-run rules):
  --shard k/N  fetch that shard's names into the shared cache (parallel via
               multiple Detached processes; cache = resume + de-dup)
  --collect    single pass over cache -> 4 per-category jsonl + fail report
  --stat-only  TSV census

Long-run rules (PROJECT): detached process + STATUS file + cache resume.
"""
import argparse, io, json, os, re, subprocess, sys, time, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
REPO = r"C:\Users\SANLVZHETANG\Desktop\todo\ComfyUI-Easy-DanWiki"
TSV = r"C:\Users\SANLVZHETANG\AppData\Local\Temp\opencode\dbtags_missing_survey_v4.tsv"
OUT = r"C:\Users\SANLVZHETANG\Desktop\todo\sub-ComfyUI-Easy-DanWiki-组背填"
CACHE = os.path.join(OUT, "cache", "wiki")
STATUS = os.path.join(OUT, "STATUS.txt")
API = "https://danbooru.donmai.us"
t_start = time.time()

def status(line):
    with io.open(STATUS, "w", encoding="utf-8", newline="\n") as f:
        f.write("%s | elapsed %.0fs\n" % (line, time.time() - t_start))
    print("[%.0fs] %s" % (time.time() - t_start, line))

def norm(s):
    return re.sub(r"\s+", "_", s.strip().lower())

def safe(name):
    return urllib.parse.quote(name, safe="")

def load_tsv():
    rows = []
    for line in io.open(TSV, encoding="utf-8").read().splitlines()[1:]:
        p = line.split("\t")
        if len(p) < 4 or not p[0]:
            continue
        name, pc, cat = p[0], p[1], p[2]
        try:
            pc_i = int(pc)
            cat_i = int(cat) if cat else None
        except ValueError:
            rows.append({"name": name, "skip": "absent"})
            continue
        rows.append({"name": name, "pc": pc_i, "cat": cat_i, "groups": p[3]})
    return rows

def stat_only(rows):
    live = [r for r in rows if not r.get("skip")]
    absent = [r for r in rows if r.get("skip")]
    from collections import Counter
    by = Counter()
    for r in live:
        by[r["cat"] if r["cat"] is not None else -1] += 1
    CAT = {0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta"}
    print("TSV census: total=%d absent_skip=%d crawlable=%d" % (len(rows), len(absent), len(live)))
    for c, n in sorted(by.items(), key=lambda kv: -kv[1]):
        print("   %-9s -> %d" % (CAT.get(c, "?cat=%s" % c), n))

def curl_code(url):
    p = subprocess.run(["curl", "-sS", "-g", "--max-time", "45",
                        "-w", "\n%{http_code}", url], capture_output=True)
    out = p.stdout.decode("utf-8", "replace")
    body, _, code = out.rpartition("\n")
    return code.strip() or "?", body

def fetch_wiki(name, tries=4):
    fp = os.path.join(CACHE, safe(name) + ".json")
    if os.path.isfile(fp) and os.path.getsize(fp) > 3:
        try:
            return json.load(io.open(fp, encoding="utf-8"))
        except Exception:
            os.remove(fp)
    url = API + "/wiki_pages/" + safe(name) + ".json"
    last = None
    for att in range(tries):
        code, body = curl_code(url)
        if code == "200":
            try:
                d = json.loads(body)
            except Exception:
                d = {"_status": "parse"}
            if isinstance(d, dict) and d.get("id"):
                d["_status"] = 200
                json.dump(d, io.open(fp, "w", encoding="utf-8", newline="\n"), ensure_ascii=False)
                return d
        if code == "404":
            d = {"_status": 404}
            json.dump(d, io.open(fp, "w", encoding="utf-8", newline="\n"), ensure_ascii=False)
            return d
        last = "(http %s) %s" % (code, body[:120])
        time.sleep(2.5 + att * 2.5)
    return {"_retry_fail": last or "?"}

def bucket(cat):
    if cat == 3:
        return "copyright"
    if cat == 4:
        return "character"
    if cat == 5:
        return "meta"
    return "general"

def shard_run(shard, total_shards):
    os.makedirs(CACHE, exist_ok=True)
    rows = load_tsv()
    live = [r for r in rows if not r.get("skip")]
    names = [r["name"] for r in live[shard::total_shards]]
    status("[shard %d/%d] %d names" % (shard + 1, total_shards, len(names)))
    hits = fail = miss = 0
    t0 = time.time()
    for i, nm in enumerate(names):
        d = fetch_wiki(nm)
        sc = d.get("_status")
        if sc == 200:
            hits += 1
        elif sc == 404:
            miss += 1
        else:
            fail += 1
            with io.open(os.path.join(OUT, "failures_shard%d.txt" % shale_num(shard)), "a", encoding="utf-8", newline="\n") as f:
                f.write("%s\t%s\t%s\n" % (nm, d.get("_retry_fail") or d.get("_status"), str(d)[:120]))
        if (i + 1) % 40 == 0 or i + 1 >= len(names):
            rate = (i + 1) / max(0.1, time.time() - t0)
            eta = (len(names) - i - 1) / max(0.05, rate)
            status("[shard %d/%d] %d/%d | 200:%d 404:%d fail:%d | %.2f/s eta %.0fs"
                   % (shard + 1, total_shards, i + 1, len(names), hits, miss, fail, rate, eta))
        time.sleep(0.25)
    status("[shard %d/%d] done" % (shard + 1, total_shards))

def shale_num(shard):  # shard index straight through (name kept)
    return shard

def collect():
    rows = load_tsv()
    live = [r for r in rows if not r.get("skip")]
    deliver = {"general": [], "character": [], "copyright": [], "meta": []}
    hits = miss = fail = uncached = 0
    for r in live:
        fp = os.path.join(CACHE, safe(r["name"]) + ".json")
        if not (os.path.isfile(fp) and os.path.getsize(fp) > 3):
            uncached += 1
            continue
        d = json.load(io.open(fp, encoding="utf-8"))
        sc = d.get("_status")
        if sc == 200:
            hits += 1
            deliver[bucket(r["cat"])].append({
                "name": r["name"], "post_count": r["pc"],
                "body": d.get("body") or "",
                "other_names": [str(x) for x in (d.get("other_names") or []) if str(x).strip()],
            })
        elif sc == 404:
            miss += 1
            deliver[bucket(r["cat"])].append({
                "name": r["name"], "post_count": r["pc"],
                "body": "", "other_names": [],
            })
        else:
            fail += 1
    for b, lst in deliver.items():
        lst.sort(key=lambda x: -x["post_count"])
        fp = os.path.join(OUT, "backfill_%s.jsonl" % b)
        with io.open(fp, "w", encoding="utf-8", newline="\n") as f:
            for x in lst:
                f.write(json.dumps(x, ensure_ascii=False) + "\n")
        status("[write] %s: %d rows" % (fp, len(lst)))
    status("[collect] wiki200=%d no-wiki404=%d fail(re-run shard)=%d uncached=%d / live=%d"
           % (hits, miss, fail, uncached, len(live)))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stat-only", action="store_true")
    ap.add_argument("--shard", default=None, help="k/N -> run fetch shard k of N")
    ap.add_argument("--collect", action="store_true")
    a = ap.parse_args()
    if a.stat_only:
        stat_only(load_tsv())
        return
    if a.shard:
        k, n = a.shard.split("/")
        shard_run(int(k), int(n))
        return
    collect()

if __name__ == "__main__":
    main()
