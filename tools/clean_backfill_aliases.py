# -*- coding: utf-8 -*-
"""Clean over-eager skeleton aliases in the backfill translation files.

Rule: an alias is removed ONLY when
  - the tag has NO body (skeleton / wiki-less: LLM aliases are pure guesses), AND
  - the alias string is claimed by a DIFFERENT tag's zh pool (name/zhtag/
    aliases_zh/zh) in the merged index.
name_cn is always kept (a crooked alias is noise, a missing Chinese name is
a loss). Tags with real bodies keep every alias - LLM names grounded in the
body are trustworthy. DB rows are updated too so a future export cannot
regenerate the removed aliases.

Run AFTER rebuilds changed the index (pool = shipped web/js/data/*.json),
then rebuild both ends and bump DATA_V.
"""
import io, json, os, sqlite3, sys

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
IDX = r"C:\Users\SANLVZHETANG\Desktop\todo\ComfyUI-Easy-DanWiki\web\js\data"
SRC = r"C:\Users\SANLVZHETANG\Desktop\todo\sub-ComfyUI-Easy-DanWiki-组背填"
DB = r"C:\Users\SANLVZHETANG\Desktop\todo\sub-ComfyUI-Easy-DanWiki-翻译\data_backfill\backfill_translations.db"

def main():
    pool = {}
    for fn in ["0_general.json", "5_meta.json", "4_character.json", "6_copyright.json"]:
        d = json.load(io.open(os.path.join(IDX, fn), encoding="utf-8"))
        for t in d["tags"]:
            zhv = [t["name"]]
            if t.get("zhtag"):
                zhv.append(t["zhtag"])
            zhv += list(t.get("aliases_zh") or [])
            zhv += list(t.get("zh") or [])
            for z in set(zhv):
                if z and isinstance(z, str):
                    pool.setdefault(z, set()).add(t["name"])
    # seq lookup for db sync
    con = sqlite3.connect(DB)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    seq_of = {n: s for s, n in con.execute("SELECT seq, name FROM translations")}
    changed_rows, removed, kept_empty = 0, 0, 0
    for b in ["general", "character", "copyright", "meta"]:
        fp = os.path.join(SRC, "backfill_trans_%s.jsonl" % b)
        rows = [json.loads(l) for l in io.open(fp, encoding="utf-8") if l.strip()]
        out = []
        for r in rows:
            if r.get("body_cn") is None and r.get("aliases_cn"):
                selfnames = set([r["name"], r.get("name_cn")] + list(r["aliases_cn"] or []))
                newal = []
                for z in r["aliases_cn"]:
                    owners = pool.get(z, set())
                    collide = any(o not in selfnames for o in owners)
                    if collide:
                        removed += 1
                    else:
                        newal.append(z)
                if newal != r["aliases_cn"]:
                    changed_rows += 1
                    if not newal:
                        kept_empty += 1
                    r["aliases_cn"] = newal
                    s = seq_of.get(r["name"])
                    if s is not None:
                        con.execute("UPDATE translations SET aliases_cn=? WHERE seq=?",
                                    (json.dumps(newal, ensure_ascii=False), s))
            out.append(r)
        with io.open(fp, "w", encoding="utf-8", newline="\n") as f:
            for x in out:
                f.write(json.dumps(x, ensure_ascii=False) + "\n")
        print("%-10s rows=%d" % (b, len(out)))
    con.commit()
    con.close()
    print("clean: skeleton-alias removals=%d over %d rows (aliases empty after: %d) / conflict total seen earlier: 1455"
          % (removed, changed_rows, kept_empty))

if __name__ == "__main__":
    main()
