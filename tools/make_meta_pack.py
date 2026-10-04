# -*- coding: utf-8 -*-
"""
make_meta_pack.py — build STANDALONE meta example-image packs (small + large)
so the 1.5GB general packs need no re-upload just to add ~13MB of meta images.

Mirrors the general pack layout: each archive's root is `tag_images/` (small)
or `tag_images_large/` (large) + 安装说明.txt; the user drops that folder into
<plugin>/dataset/ and the already-merged dataset/manifest.json serves them.

Sources (read-only):
  $DBTAGS_SRC_BASE  (default sibling 爬图像 store) -> the actual image files
  web/js/data/5_meta.json -> which meta tags have images + their rel paths

Output (default <hub>/meta-image-pack/):
  meta-example-image-small.zip   (tag_images/...)
  meta-example-image-large.zip   (tag_images_large/...)
Usage:  python tools/make_meta_pack.py [--store DIR] [--out DIR]
"""
import argparse
import json
import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
HUB = os.path.dirname(REPO)                      # .../todo
SMALL_DIR = "tag_images"
LARGE_DIR = "tag_images_large"

DEFAULT_STORE = os.environ.get("DBTAGS_SRC_BASE", "").strip() or \
    os.path.join(HUB, "sub-ComfyUI-Easy-DanWiki-爬图像")
DEFAULT_OUT = os.path.join(HUB, "meta-image-pack")

NOTE = """# meta 示例图包(%s,约 %s)

这是**分类标签(meta/元数据)**用到的示例图,独立于通用图包。
把本包里的 `%s` 文件夹整个放进:
    .\\ComfyUI\\custom_nodes\\ComfyUI-Easy-DanWiki\\dataset\\
(与通用图包放法一致;若同名文件已在,覆盖即可,内容相同。)

放好后重启 / 硬刷新 ComfyUI,meta 标签的示例图就会显示。
清单(dataset\\manifest.json)已在核心包里合并好,无需再动。
"""


def meta_image_rels(index_path):
    with open(index_path, "r", encoding="utf-8") as f:
        idx = json.load(f)
    smalls, larges = [], []
    for t in idx.get("tags", []):
        imgs = t.get("images") or []
        if len(imgs) >= 2:
            if imgs[0]:
                smalls.append(imgs[0])
            if imgs[1]:
                larges.append(imgs[1])
    return smalls, larges


def stage(store, rels, subdir, out_root):
    """Copy each relative file from store into out_root/<subdir>/... ; return
    (copied, skipped_missing)."""
    copied = missing = 0
    for rel in rels:
        src = os.path.join(store, rel)
        if not os.path.isfile(src):
            missing += 1
            print("  !! missing in store:", rel)
            continue
        dst = os.path.join(out_root, rel)      # rel already starts with subdir/
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.isfile(dst):
            shutil.copy2(src, dst)
        copied += 1
    return copied, missing


def make_zip(folder, zip_path):
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(folder):
            for fn in files:
                fp = os.path.join(root, fn)
                arc = os.path.relpath(fp, folder)
                z.write(fp, arc)
    return os.path.getsize(zip_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default=DEFAULT_STORE)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--index", default=os.path.join(REPO, "web", "js", "data", "5_meta.json"))
    args = ap.parse_args()

    if not os.path.isdir(args.store):
        print("FAIL: image store missing:", args.store); return 2
    smalls, larges = meta_image_rels(args.index)
    print("meta small files: %d | large files: %d" % (len(smalls), len(larges)))

    # fresh staging dirs
    small_root = os.path.join(args.out, "meta-example-image-small")
    large_root = os.path.join(args.out, "meta-example-image-large")
    for d in (small_root, large_root):
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d)

    cs, ms = stage(args.store, smalls, SMALL_DIR, small_root)
    cl, ml = stage(args.store, larges, LARGE_DIR, large_root)

    def hsize(n):
        return ("%.1f KB" % (n / 1024.0)) if n < 1048576 else ("%.1f MB" % (n / 1048576.0))

    def tree_bytes(d):
        return sum(os.path.getsize(os.path.join(dp, fn))
                   for dp, _, fs in os.walk(d) for fn in fs)
    small_bytes, large_bytes = tree_bytes(small_root), tree_bytes(large_root)
    with open(os.path.join(small_root, "安装说明.txt"), "w", encoding="utf-8") as f:
        f.write(NOTE % ("小图/缩略图", hsize(small_bytes), SMALL_DIR))
    with open(os.path.join(large_root, "安装说明.txt"), "w", encoding="utf-8") as f:
        f.write(NOTE % ("大图", hsize(large_bytes), LARGE_DIR))

    zip_s = os.path.join(args.out, "meta-example-image-small.zip")
    zip_l = os.path.join(args.out, "meta-example-image-large.zip")
    zs = make_zip(small_root, zip_s)
    zl = make_zip(large_root, zip_l)

    print("staged: small copied=%d (missing %d), large copied=%d (missing %d)"
          % (cs, ms, cl, ml))
    print("OUTPUT:")
    print("  %s  (%d files, %s)" % (zip_s, len(smalls), hsize(zs)))
    print("  %s  (%d files, %s)" % (zip_l, len(larges), hsize(zl)))
    print("extract dir kept at: %s , %s" % (small_root, large_root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
