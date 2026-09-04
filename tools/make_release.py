# -*- coding: utf-8 -*-
"""
Assemble a ready-to-share release/ folder under the project root.

Layout (nothing is compressed):
  release/
    README.md                         top-level install overview
    danbooru-autocomplete/            core plugin: drop into custom_nodes/
      __init__.py
      dbtags_server.py
      README.md
      LICENSE-fonts.txt
      web/js/dbtags_autocomplete.js
      web/js/dbtags_autocomplete.css
      web/js/data/tags_index.json     word bank (always included)
      fonts/                          README.txt + 2 bundled OFL fonts
      dataset/manifest.json           image whitelist (always included)
    image-pack-small/                 optional: unpack over custom_nodes/
      danbooru-autocomplete/dataset/tag_images/...
    image-pack-large/                 optional:
      danbooru-autocomplete/dataset/tag_images_large/...

Only images referenced by manifest.json are copied into the packs, so the
packs are exactly what the app serves and nothing more.

Usage:
  python tools/make_release.py [version]
"""

import json
import os
import shutil
import sys

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HUB, "src")
DATA = os.path.join(HUB, "..", "danbooru-general-tags")
DATA = os.path.abspath(DATA)
REL = os.path.join(HUB, "release")

MANIFEST_REL = "manifest.json"
SMALL_DIR = "tag_images"
LARGE_DIR = "tag_images_large"

VERSION = sys.argv[1] if len(sys.argv) > 1 else "1.0.0"

CORE = os.path.join(REL, "danbooru-autocomplete")
PACK_SMALL = os.path.join(REL, "image-pack-small",
                          "danbooru-autocomplete", "dataset", SMALL_DIR)
PACK_LARGE = os.path.join(REL, "image-pack-large",
                          "danbooru-autocomplete", "dataset", LARGE_DIR)

CORE_FILES = [
    "__init__.py",
    "dbtags_server.py",
    os.path.join("web", "js", "dbtags_autocomplete.js"),
    os.path.join("web", "js", "dbtags_autocomplete.css"),
]


def log(msg):
    print(msg, flush=True)


def fresh_copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    return os.path.getsize(dst)


def copy_server(dst):
    """Ship dbtags_server.py with the author-machine fallback path blanked."""
    src = os.path.join(SRC, "dbtags_server.py")
    with open(src, "r", encoding="utf-8") as f:
        text = f.read()
    legacy = "_LEGACY_BASE = r\"C:/Users/SANLVZHETANG/Desktop/todo/danbooru-general-tags\""
    cleaned = text.replace(legacy, "_LEGACY_BASE = \"\"")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="\n") as f:
        f.write(cleaned)
    return os.path.getsize(dst)


def dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total


def count_files(path):
    n = 0
    for root, _, files in os.walk(path):
        n += len(files)
    return n


def copy_images(rel_dir, dst, wanted):
    n = 0
    for rel in wanted:
        s = os.path.join(DATA, rel)
        if not os.path.isfile(s):
            continue
        d = os.path.join(dst, os.path.relpath(s, os.path.join(DATA, rel_dir)))
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        n += 1
    return n


def write_file(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def main():
    manifest_path = os.path.join(DATA, MANIFEST_REL)
    if not os.path.isfile(manifest_path):
        log("FAIL: dataset manifest missing: %s" % manifest_path)
        return 1

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    small_wanted = set()
    large_wanted = set()
    for v in manifest.values():
        if isinstance(v, dict):
            if v.get("small"):
                small_wanted.add(v["small"])
            if v.get("large"):
                large_wanted.add(v["large"])

    if os.path.isdir(REL):
        shutil.rmtree(REL)

    # ---- core plugin ----
    for rel in CORE_FILES:
        if rel == "dbtags_server.py":
            copy_server(os.path.join(CORE, rel))
            continue
        s = os.path.join(SRC, rel)
        fresh_copy(s, os.path.join(CORE, rel))
    fresh_copy(os.path.join(SRC, "web", "js", "data", "tags_index.json"),
               os.path.join(CORE, "web", "js", "data", "tags_index.json"))
    fresh_copy(manifest_path, os.path.join(CORE, "dataset", MANIFEST_REL))
    # fonts: README + the two bundled OFL fonts
    for name in ("README.txt",
                 "Glass_TTY_VT220.ttf",
                 "MapleMonoNormal-NF-CN-Medium.ttf",
                 "LICENSE-fonts.txt"):
        fresh_copy(os.path.join(SRC, "fonts", name),
                   os.path.join(CORE, "fonts", name))

    write_file(os.path.join(CORE, "README.md"), CORE_README)
    write_file(os.path.join(REL, "README.md"), TOP_README)

    # ---- optional image packs (only manifest-referenced files) ----
    n_small = copy_images(SMALL_DIR, PACK_SMALL, small_wanted)
    n_large = copy_images(LARGE_DIR, PACK_LARGE, large_wanted)
    write_file(os.path.join(REL, "image-pack-small", "安装说明.txt"), SMALL_NOTE)
    write_file(os.path.join(REL, "image-pack-large", "安装说明.txt"), LARGE_NOTE)

    # ---- summary ----
    size = {
        "core": dir_size(CORE),
        "small": dir_size(os.path.join(REL, "image-pack-small")),
        "large": dir_size(os.path.join(REL, "image-pack-large")),
    }
    count = {
        "core": count_files(CORE),
        "small": count_files(os.path.join(REL, "image-pack-small")),
        "large": count_files(os.path.join(REL, "image-pack-large")),
    }
    log("release v%s -> %s" % (VERSION, REL))
    log("  core            %8d files  %6.1f MB" % (count["core"], size["core"] / 1048576))
    log("  image-pack-small %6d files  %6.1f MB" % (count["small"], size["small"] / 1048576))
    log("  image-pack-large %6d files  %6.1f MB" % (count["large"], size["large"] / 1048576))
    log("  (manifest refs: small=%d large=%d)" % (len(small_wanted), len(large_wanted)))
    return 0


TOP_README = """# Danbooru 中英双语标签补全 — 发布包 %s

三个包，按需取用：

## 1. danbooru-autocomplete/ —— 必须（核心插件）
解压后把 `danbooru-autocomplete` 整个文件夹放进 ComfyUI 的
`custom_nodes/` 目录，重启 ComfyUI 即生效。
> 本包已包含词库（web/js/data/tags_index.json，3 万余标签含中英文 wiki）
> 与示例图清单（dataset/manifest.json），**不含图片本体**。
> 界面字体已内置（Glass_TTY_VT220 / MapleMono NF CN Medium）。

## 2. image-pack-small/ —— 可选（小图包，约 77MB）
解压后将 `danbooru-autocomplete` 文件夹**覆盖合并**进
`custom_nodes/`（与核心包同目录树）。
提供列表/面板用的缩略示例图。

## 3. image-pack-large/ —— 可选（大图包，约 1.5GB）
同上解压覆盖。提供「示例」弹出的大图卡。
两个图包都不装也能用：图片槽位自动隐藏，词库/匹配/wiki/字体/主题全部正常。
只装一个时，另一档会自动回退（如只装小图包，大图卡显示缩略放大版）。

## 首次使用
- 版本要求：ComfyUI 稳定版即可（使用了少数 legacy 前端 API，仅有弃用警告，不影响功能）。
- 无任何 Python 第三方依赖；全部数据本地读取，无需联网。
- 输入框内输入标签即弹出补全；建议装小图包后体验更完整。
""" % VERSION

CORE_README = """# danbooru-autocomplete 中英双语标签补全

基于本地词库的中/英/拼音标签补全，含 wiki 释义、示例图（可选图包）、
界面字体、可定制外观主题。

## 目录结构
- `web/js/data/tags_index.json` 词库（v3，30,442 标签）
- `dataset/manifest.json` 示例图清单（服务端据此按白名单取图）
- `fonts/` 界面字体（SIL OFL 1.1 授权，见 LICENSE-fonts.txt）
- `dataset/tag_images/`、`dataset/tag_images_large/` 图片本体（选装，见外层 README）

## 数据说明
- 词库与译文由公开爬取加工，图片来自 Danbooru 公开图片；仅用于学习研究，
  请自行评估使用合规性。
- 数据根目录自动定位：环境变量 `DBTAGS_DATASET` > 插件内 `dataset/` > 插件根。
- 调试日志默认关闭，设环境变量 `DBTAGS_DEBUG=1` 才写入 debug.log。
"""

SMALL_NOTE = """# 小图包（缩略图，约 77MB）

把本目录下的 `danbooru-autocomplete` 文件夹解压后**覆盖合并**到
ComfyUI 的 `custom_nodes/` 下（与核心包同一目录树，覆盖即完成，无需改名）。

效果：候选/面板的缩略示例图可用。
只装本包而未装大图包时，「示例」大图卡自动回退为缩略放大显示。
"""

LARGE_NOTE = """# 大图包（原图，约 1.5GB）

把本目录下的 `danbooru-autocomplete` 文件夹解压后**覆盖合并**到
ComfyUI 的 `custom_nodes/` 下（与核心包同一目录树，覆盖即完成，无需改名）。

效果：「示例」弹出的原图大图卡可用。
只装本包而未装小图包时，面板/列表缩略图自动回退为大图（一屏仅一图，可接受）。
"""


if __name__ == "__main__":
    sys.exit(main())