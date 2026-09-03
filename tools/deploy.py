# -*- coding: utf-8 -*-
"""
Deploy hub src -> the ComfyUI plugin dir (E:).

Copies __init__.py, dbtags_server.py and web/js/*.{js,css} from src/ into
the deployed extension. Data files (web/js/data/*.json) are produced
directly into the plugin dir by build_index.py and are NOT touched here.

Usage:
  python tools\\deploy.py [--dry-run]
"""

import argparse
import os
import shutil
import sys

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HUB, "src")
DST = r"E:\ComfyUI\custom_nodes\danbooru-autocomplete"

FILES = [
    "__init__.py",
    "dbtags_server.py",
    os.path.join("web", "js", "dbtags_autocomplete.js"),
    os.path.join("web", "js", "dbtags_autocomplete.css"),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not os.path.isdir(DST):
        print("FAIL: plugin dir missing: %s" % DST)
        return 1
    changed = 0
    for rel in FILES:
        s = os.path.join(SRC, rel)
        d = os.path.join(DST, rel)
        if not os.path.isfile(s):
            print("FAIL: src missing %s" % rel)
            return 1
        same = os.path.isfile(d) and open(s, "rb").read() == open(d, "rb").read()
        if same:
            print("  same    %s" % rel)
            continue
        changed += 1
        if args.dry_run:
            print("  would    %s -> %s" % (rel, d))
            continue
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        print("  copied  %s" % rel)
    print("deploy done: %d file(s) updated" % changed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
