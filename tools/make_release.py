# -*- coding: utf-8 -*-
"""
Assemble a ready-to-share release/ folder under the project root.

Layout (nothing is compressed):
  release/
    README.md                         top-level install overview
    ComfyUI-Easy-DanWiki/             core plugin: drop into custom_nodes/
      __init__.py
      dbtags_server.py
      README.md
      LICENSE
      LICENSE-fonts.txt
      web/js/dbtags_autocomplete.js
      web/js/dbtags_autocomplete.css
      web/js/data/tags_index.json     word bank (always included)
      fonts/                          README.txt + 2 bundled OFL fonts
      dataset/manifest.json           image whitelist (always included)
    image-pack-small/                 optional: unpack over custom_nodes/
      ComfyUI-Easy-DanWiki/dataset/tag_images/...
    image-pack-large/                 optional:
      ComfyUI-Easy-DanWiki/dataset/tag_images_large/...

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
SRC = HUB
DATA = os.path.join(HUB, "..", "danbooru-general-tags")
DATA = os.path.abspath(DATA)
REL = os.path.join(HUB, "release")

MANIFEST_REL = "manifest.json"
SMALL_DIR = "tag_images"
LARGE_DIR = "tag_images_large"

VERSION = sys.argv[1] if len(sys.argv) > 1 else "1.0.0"

CORE = os.path.join(REL, "ComfyUI-Easy-DanWiki")
PACK_SMALL = os.path.join(REL, "image-pack-small",
                          "ComfyUI-Easy-DanWiki", "dataset", SMALL_DIR)
PACK_LARGE = os.path.join(REL, "image-pack-large",
                          "ComfyUI-Easy-DanWiki", "dataset", LARGE_DIR)

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
    hub_license = os.path.join(HUB, "LICENSE")
    if os.path.isfile(hub_license):
        fresh_copy(hub_license, os.path.join(CORE, "LICENSE"))
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
    log("release %s -> %s" % (VERSION, REL))
    log("  core            %8d files  %6.1f MB" % (count["core"], size["core"] / 1048576))
    log("  image-pack-small %6d files  %6.1f MB" % (count["small"], size["small"] / 1048576))
    log("  image-pack-large %6d files  %6.1f MB" % (count["large"], size["large"] / 1048576))
    log("  (manifest refs: small=%d large=%d)" % (len(small_wanted), len(large_wanted)))
    return 0


TOP_README = """# ComfyUI-Easy-DanWiki — Danbooru 中英双语标签补全 发布包 %s

项目主页：https://github.com/SANLVZHETANG/ComfyUI-Easy-DanWiki （MIT 协议，见 LICENSE）
作者：latent（潜在哈气空间）
致谢：标签补全交互源码参考 https://github.com/pythongosssss/ComfyUI-Custom-Scripts

三个包，按需取用：

## 1. ComfyUI-Easy-DanWiki/ —— 必须（核心插件）
解压后把 `ComfyUI-Easy-DanWiki` 整个文件夹放进 ComfyUI 的
`custom_nodes/` 目录，重启 ComfyUI 即生效。
> 本包已包含词库（web/js/data/tags_index.json，3 万余标签含中英文 wiki）
> 与示例图清单（dataset/manifest.json），**不含图片本体**。
> 界面字体已内置（Glass_TTY_VT220 / MapleMono NF CN Medium，SIL OFL 授权）。

## 2. image-pack-small/ —— 可选（小图包，约 77MB）
解压后将 `ComfyUI-Easy-DanWiki` 文件夹**覆盖合并**进
`custom_nodes/`（与核心包同目录树）。
提供列表/面板用的缩略示例图。

## 3. image-pack-large/ —— 可选（大图包，约 1.5GB）
同上解压覆盖。提供「示例」弹出的大图卡。
两个图包都不装也能用：图片槽位自动隐藏，词库/匹配/wiki/字体/主题全部正常。
只装一个时，另一档会自动回退（如只装小图包，大图卡显示缩略放大版）。

## 首次使用
- 版本要求：ComfyUI 稳定版即可（使用了少数 legacy 前端 API，仅有弃用警告，不影响功能）。
- 无任何 Python 第三方依赖；全部数据本地读取，无需联网。
- 输入框内输入标签即弹出补全；全部设置在「设置面板 → ComfyUI-Easy-DanWiki → 外观定制器」按钮打开的窗口内调节。
- 建议装小图包后体验更完整。
""" % VERSION

CORE_README = """# ComfyUI-Easy-DanWiki —— Danbooru 中英双语标签补全

一句话：**在 ComfyUI 的提示词框里打字，弹出中/英/拼音三语标签补全 + 本地 wiki 词典面板。**
全部数据随插件本地分发，零联网、零 Python 依赖。

- 项目主页：https://github.com/SANLVZHETANG/ComfyUI-Easy-DanWiki
- 作者：latent（潜在哈气空间）
- 协议：MIT（见 LICENSE）；内置字体为 SIL OFL 1.1（见 fonts/LICENSE-fonts.txt）

## 这个插件具体干什么

就两件事：

1. **标签补全**——在提示词等多行文本框里打几个字，光标处弹出候选 tag 列表。
   英文、中文、拼音都能当关键词，选中后回车/Tab 插入。
2. **wiki 查询**——候选列表右侧是一块本地化的 Danbooru wiki：
   中英释义正文、示例图、关联标签胶囊（点击=继续查阅，点 `+`=插入到光标词前）。
   不用开浏览器查网站。

## 数据快照（随包自带，全部本地）

| 项目 | 数量 / 规格 |
|---|---|
| tag 收录 | **30,442 条**（Danbooru 数据截至 **2026-08-15**，收录的全部是 post 数 > 50 的标签，最低 51） |
| 中文译名 | 30,442 条**全量翻译**（下拉、搜索、面板都能用中文） |
| wiki 正文 | **26,487 条**有中英文正文（其余 3,955 条源站本身就没有正文，只有译名） |
| 拼音 | 全部中文词条已预生成无声调全拼（打 `maoer` 即得"猫耳"，无需拼音输入法） |
| 示例图 | 9,756 个 tag 有示例图（去重后约 9,161 张）；图是**选装包**，见下 |
| 小图包 | 长边 ≤ 180px，单张约 4–10KB，整包约 58MB（列表/面板缩略图） |
| 大图包 | 长边 ≤ 850px，单张约 20KB–1MB，整包约 1.4GB（悬停大图卡） |

词库（含译名/正文/拼音，约 25MB）在核心包内，必装即用；
**示例图包不装也完全能用**——只是图片槽位自动隐藏，补全/wiki/字体/主题一切正常。
只装一档时另一档自动回退（如只装小图包，大图卡显示放大后的缩略图）。

## 装好之后是什么样

在 CLIP Text Encode 等**多行文本框**里输入时：

- 光标处弹出候选列表：`英文标签  热度  中文译名`（如 `cat_ears  521K  猫耳`）
- 右侧 wiki 面板显示该标签的中英文释义、示例图（悬停可放大看图卡）、
  关联标签胶囊（点击=跳转查阅，点 `+`=插入到光标词前面）

### 支持的输入方式
| 你输入 | 会匹配到 |
|---|---|
| 英文 `cat girl` | name/别名含该子串的标签（`cat_ears`、`cat_girl`…） |
| 中文 `猫耳` | 中文译名、中文别名的松散匹配 |
| 拼音 `maoer` | 无声调全拼命中"猫耳"等中文词（可关、可调触发长度） |
| 描述性短语 | wiki 正文全文搜索：只记得描述、忘名字时，整句去中英文正文里找 |

### 键盘操作
| 键 | 作用 |
|---|---|
| ↑ / ↓ 或 `[` / `]` | 上下选择候选（`[` `]` 可在设置里关掉恢复正常输入） |
| Enter / Tab | 插入选中 tag（替换正在输入的词，自动补 `, ` 分隔） |
| Esc | 先关右侧展开的 wiki 栏；没有展开栏时整体收起 |
| Home / End / PgUp / PgDn | 列表首 / 尾 / 翻页 |

## 安装

把整个 `ComfyUI-Easy-DanWiki` 文件夹放进 `ComfyUI/custom_nodes/`，重启 ComfyUI。

- 无需安装任何 Python 包；运行全程不联网。
- ComfyUI 稳定版即可。使用了少数 legacy 前端 API，个别新版控制台会有弃用警告，不影响功能。
- 想看到示例图，再按外层 README 装可选图包（大小包二选一或都装，见上文规格）。

## 设置在哪

全部设置都在「**外观定制器**」一个窗口里（实时预览 + 搜索试验台，改哪都能当场试）：

- 入口 1（推荐）：ComfyUI 设置面板（齿轮）→ `ComfyUI-Easy-DanWiki → 外观定制器` → 点**「打开」按钮**
- 入口 2：顶栏设置菜单 → "ComfyUI-Easy-DanWiki - 外观定制器"
- 入口 3：命令面板搜 "ComfyUI-Easy-DanWiki：打开外观定制器"（可绑快捷键）

能调什么：主题配色（7 套预设 + 9 色自定义 + 保存预设）、弹窗透明度、列表宽度/字号/行高、
界面字体、显示语言（中/英）、拼音搜索、正文匹配、wiki 面板内容与布局、`[ ]` 导航、
候选数量与热度过滤，以及性能监视面板。配置支持**导出/导入 JSON**（可分享给别人，
或把 `theme_desc` 丢给 AI 让它替你配色）。

> 设置存在**浏览器 localStorage**（键前缀 `dbtags.autocomplete.`）：
> 换浏览器 / 换 ComfyUI 访问地址 / 清浏览器数据都会回默认。重要配置请用导出留档。

## 界面字体

- 已内置 Glass_TTY_VT220、MapleMono NF CN Medium 两款，定制器「界面字体」下拉即选即换。
- 加自己的字体：把 `.ttf / .otf / .woff / .woff2` 放进本目录 `fonts/`，重启 ComfyUI 即出现在下拉里。

## 排查

| 现象 | 说明 / 处理 |
|---|---|
| 打字不弹候选 | 只接管**多行**文本框；个别节点声明了 `pysssss.autocomplete: false` 会被跳过；浏览器控制台看有无 `dbtags` 报错 |
| 图片不显示 | 多半是没装图包；浏览器开 `http(s)://<ComfyUI地址>/dbtags/status` 可看词库/图包/字体加载状态 |
| 需要看后端日志 | 设环境变量 `DBTAGS_DEBUG=1` 重启 ComfyUI，插件目录生成 `debug.log` |
| 图片数据放在别处 | 数据根定位顺序：环境变量 `DBTAGS_DATASET` > 插件内 `dataset/` > 插件根 |

## 目录结构

```
ComfyUI-Easy-DanWiki/
├─ __init__.py                  插件注册（纯前端扩展，不提供节点）
├─ dbtags_server.py             本地接口：供图 / 字体 / 状态
├─ web/js/…                     补全前端（js + css）
├─ web/js/data/tags_index.json  词库 v3（30,442 条，约 25MB）
├─ fonts/                       内置界面字体（SIL OFL 1.1）
├─ dataset/manifest.json        示例图白名单（tag → 图片路径）
└─ dataset/tag_images(_large)/  图片本体（可选图包解压后出现）
```

## 数据与免责声明

词库、译文与示例图来自对 [Danbooru](https://danbooru.donmai.us/) 公开数据的爬取加工
（截至 2026-08-15），仅用于学习研究，请自行评估使用合规性。

## 致谢

- [pythongosssss/ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)（pythongosssss）——
  标签补全功能的交互源码（光标定位、输入框接管等）参考自该项目。
"""

SMALL_NOTE = """# 小图包（缩略图，约 77MB）

把本目录下的 `ComfyUI-Easy-DanWiki` 文件夹解压后**覆盖合并**到
ComfyUI 的 `custom_nodes/` 下（与核心包同一目录树，覆盖即完成，无需改名）。

效果：候选/面板的缩略示例图可用。
只装本包而未装大图包时，「示例」大图卡自动回退为缩略放大显示。
"""

LARGE_NOTE = """# 大图包（原图，约 1.5GB）

把本目录下的 `ComfyUI-Easy-DanWiki` 文件夹解压后**覆盖合并**到
ComfyUI 的 `custom_nodes/` 下（与核心包同一目录树，覆盖即完成，无需改名）。

效果：「示例」弹出的原图大图卡可用。
只装本包而未装小图包时，面板/列表缩略图自动回退为大图（一屏仅一图，可接受）。
"""


if __name__ == "__main__":
    sys.exit(main())