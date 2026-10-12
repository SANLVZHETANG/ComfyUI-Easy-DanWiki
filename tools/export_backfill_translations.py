# -*- coding: utf-8 -*-
"""Export backfill translations from the sub-翻译 SQLite db to per-category
zh jsonl files consumed by build_index (load_zh_dict schema:
name / name_cn / aliases_cn / body_cn; body_cn may be null for skeletons).

Category buckets come from membership in the four backfill wiki jsonls
(names are disjoint by construction). Run AFTER the translation batch
finishes (and after rerun_failed.py fails=0):
  python tools/export_backfill_translations.py
"""
import io, json, os, sqlite3, sys

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
DB = r"C:\Users\SANLVZHETANG\Desktop\todo\sub-ComfyUI-Easy-DanWiki-翻译\data_backfill\backfill_translations.db"
SRC = r"C:\Users\SANLVZHETANG\Desktop\todo\sub-ComfyUI-Easy-DanWiki-组背填"
OUT = SRC  # emit into the backfill data dir

def main():
    cat_of = {}
    for b in ["general", "character", "copyright", "meta"]:
        with io.open(os.path.join(SRC, "backfill_%s.jsonl" % b), encoding="utf-8") as f:
            for line in f:
                cat_of[json.loads(line)["name"]] = b
    con = sqlite3.connect(DB)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    rows = con.execute(
        "SELECT seq,name,status,name_cn,body_cn,aliases_cn FROM translations ORDER BY seq"
    ).fetchall()
    con.close()
    buckets = {k: [] for k in ["general", "character", "copyright", "meta"]}
    unknown, no_alias = 0, 0
    for seq, name, status, name_cn, body_cn, aliases_raw in rows:
        if status != "done":
            continue
        try:
            aliases = json.loads(aliases_raw) if aliases_raw else []
        except Exception:
            aliases = []
        aliases = [str(a).strip() for a in aliases if str(a).strip()][:3]
        if not aliases:
            no_alias += 1
        if name_cn is not None:
            name_cn = str(name_cn).strip()
        b = cat_of.get(name)
        if b is None:
            unknown += 1
            continue
        buckets[b].append({
            "name": name,
            "name_cn": name_cn or None,
            "aliases_cn": aliases,
            "body_cn": (body_cn or None),
        })
    for b, lst in buckets.items():
        fp = os.path.join(OUT, "backfill_trans_%s.jsonl" % b)
        with io.open(fp, "w", encoding="utf-8", newline="\n") as f:
            for x in lst:
                f.write(json.dumps(x, ensure_ascii=False) + "\n")
        print("%s: %d rows -> %s" % (b, len(lst), fp))
    print("export done: unknown_name=%d no_alias_rows=%d / done_rows=%d"
          % (unknown, no_alias, sum(1 for r in rows if r[2] == "done")))

if __name__ == "__main__":
    main()
