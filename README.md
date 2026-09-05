# ComfyUI-Easy-DanWiki

> Danbooru 中英双语标签补全 + 本地 Wiki —— ComfyUI 纯前端插件

- 作者：latent（潜在哈气空间）
- 仓库：https://github.com/SANLVZHETANG/ComfyUI-Easy-DanWiki
- 协议：[MIT](LICENSE)（内置字体为 SIL OFL 1.1，见 `src/fonts/LICENSE-fonts.txt`）

在 ComfyUI 任意多行文本框（正向提示词等）里打字，即弹出中/英/拼音三语补全，
右侧带真实 wiki 释义、示例图、关联标签跳转胶囊；全部数据本地化，零联网、零 Python 第三方依赖。

## 功能一览

- **30,442 条 Danbooru 标签**：英文名 + 中文译名 + 中文别名 + 双语 wiki 正文 + 无声调拼音
- **多语言匹配**：英文子串、中文子序列、拼音（`mao`→猫娘）、wiki 正文全文匹配（中英通吃）
- **wiki 面板**：释义 / 示例图（可选图包，悬浮出大图卡）/ `[[关联标签]]` 胶囊跳转（分栏或替换两种模式）
- **外观定制器**：主题取色、透明度、字号行高、界面字体（可放 `.ttf` 进插件 `fonts/`）、性能面板、导入/导出配置
- 入口：设置面板「ComfyUI-Easy-DanWiki」分类中的**「打开」按钮**、顶栏设置菜单、命令面板 `DbTagsAutocomplete.OpenStyler`

## 安装

发布包由 `tools/make_release.py` 生成，共三部分：

| 包 | 必需 | 说明 |
|---|---|---|
| `ComfyUI-Easy-DanWiki/` | 是 | 核心插件（含词库 25MB + manifest），整个文件夹放入 `custom_nodes/` |
| `image-pack-small/` | 否 | 缩略示例图（约 77MB），解压后覆盖合并进 `custom_nodes/` |
| `image-pack-large/` | 否 | 原图大图卡（约 1.5GB），同上 |

不装图包也能用：图片槽位自动隐藏，其余功能完整；只装一档时另一档自动回退。
数据根目录自动定位：环境变量 `DBTAGS_DATASET` > 插件内 `dataset/` > 插件根。

## 设置（统一入口：外观定制器）

全部设置在定制器窗内调节（可拖拽，右列实时预览，含搜索试验台与真实试用区），
配置存 localStorage `dbtags.autocomplete.*`，支持导出/导入 JSON。

| 设置 | 取值 | 默认 | 行为 |
|---|---|---|---|
| 主题 `theme` | `dark`/`light`/`pink`/`mint`/琥珀系×3/`custom`/用户预设 | `dark` | CSS 变量整套换色；自定义取色存 `customVars` |
| 弹窗透明度 `opacity` | 25–100（%） | 100 | 仅弹窗背景半透明（文字实心），带毛玻璃 |
| 显示语言 `lang` | `zh` / `en` | `zh` | zh 面板用中文 wiki（无则回退英文），下拉带中文标签 |
| 中文别名表 `aliasTable` | 开/关 | 开 | 中文搜索层级 `zhtag > aliases_zh > zh`；关=仅 `zhtag`。中文查询从不扫日文 `aliases` |
| 拼音搜索 `pyMode` | `zh-first`/`en-first`/`off` | `zh-first` | 纯字母输入按 `py` 匹配中文；精确/前缀英文名恒优先 |
| 拼音触发长度 `pyMinLen` | 数字 | 4 | 短于此长度的字母输入不触发拼音 |
| 匹配wiki正文 `fuzzy` | `always`/`fallback`/`off` | `always` | 整个查询子串匹配 `summary+wiki_zh`（英文≥3字/中文≥2字），命中行显示摘录 |
| 右侧wiki面板 `showWiki` | 开/关 | 开 | 关=只留候选列表下拉 |
| 面板内容 `showSummary`/`showImage`/`showLinks` | 开/关 | 开 | 释义正文 / 示例图 / 关联标签胶囊 |
| 面板布局 `panelImg` | 开/关 | 关 | 关=文字优先；开=图片完整展示优先 |
| 括号键导航 `bracketNav` | 开/关 | 开 | 候选框打开时 `[` `]` 上下移动焦点（Enter/Tab 插入） |
| 候选与数据 `mode`/`minPost`/`maxCount` | 限量/全部 + 热度过滤 + 上限 | limit/500/50 | 热度过滤与数量上限常驻生效；最低 post 低于 51 不再增益（上游导出即过滤） |

## 开发说明（本仓库）

本目录是唯一维护源（源码 + 构建工具）；部署产物区只由脚本写入，不要手改。

### 目录角色

| 位置 | 角色 | 读写约定 |
|---|---|---|
| 本仓库 | 大本营：源码基线 + 构建工具 | 唯一可编辑处 |
| `E:\ComfyUI\custom_nodes\ComfyUI-Easy-DanWiki\` | 部署产物区（ComfyUI 加载） | 只由 `tools\deploy.py` 写入 |
| `G:\翻译器\` | 翻译上游数据源 | **只读** |
| `Desktop\todo\danbooru-general-tags\` | 英文 wiki 源 + 示例图图库 + manifest | **只读**（后端供图指向此） |

### 数据流

```
G:\翻译器\clear_dantag_wiki.jsonl ──(英文源, 30442 条)──┐
G:\翻译器\out\translations.jsonl ──(全量中文, 30442 条)──┼→ tools\build_index.py
Desktop\todo\danbooru-general-tags\manifest.json (图) ──┘        │
                                                                 ▼
              E:\...\ComfyUI-Easy-DanWiki\web\js\data\tags_index.json  (v3)
```

> v3 起不再产出 `fuzzy_index.json`：正文匹配改为前端运行时直接子串扫描 `summary + wiki_zh`
> （预构建小写文档，每次按键 ~10ms），原「模糊搜索词表索引」与「`[短语]` 精确搜索」均已移除。

两条数据源 `name` 集合已验证 100% 对齐（30442 ∩ 30442，零缺失）。

### 索引字段契约（tags_index.json v3，每条）

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `name` | str | 英文源 | 英文标签，跳转/插入用，恒英文 |
| `post_count` | int | 英文源 | 热度 |
| `zh` | list | 英文源 other_names | 清洗后的源站中文别名（兜底） |
| `aliases` | list | 英文源 | 全部源站别名（英/日…，参与匹配） |
| `summary` | str | 英文源 body | 英文摘要，截 300 字，保留 `[[..]]` |
| `zhtag` | str | 翻译库 `name_cn` | 中文标签名（下拉显示 + 中文搜索） |
| `aliases_zh` | list | 翻译库 `aliases_cn` | 中文别名（搜索匹配） |
| `wiki_zh` | str | 翻译库 `body_cn` | 中文正文，截 800 字；**空正文条目不写此字段**（前端回退英文） |
| `py` | list | 构建期 pypinyin | 与 `[zhtag]+aliases_zh+zh`（去空值）**逐位平行**的无声调全拼小写串；JS 端以同一顺序重建原词，故不重复存中文 |
| `images` | list | manifest | [small, large] 相对路径 |
| `links` | list | 英文源 body | `[{n: 英文target, t: 显示词}]` |

> 构建拼音需要 `pip install pypinyin`（仅大本营构建环境，前端零依赖）。
> 多音字取词组语境读音（长袜→changwa 正确）；另一读法不收录，如需要可在构建脚本加人工读音表。

#### 链接标记硬规则（来自 G:\翻译器\out\README.md 契约）

- 正文内链接形态：`[[target]]` / `[[target|display]]` / `[[target|]]`（空显示合法）
- `target` **恒为英文**，是跳转依据；构建与渲染阶段**原样保留标记，不得改写**
- 前端渲染中文模式下 chip 双显：`中文 (english)`，中文优先取 display，空则查目标 tag 的 `zhtag`

### 构建 / 部署命令

```bash
# 冒烟（前 300 条，产物写 smoke\，检查产物结构）
python tools\build_index.py --limit 300 --out-dir smoke

# 全量重建（直接写部署盘 data 目录）
python tools\build_index.py --limit 0

# 部署 src → 插件目录
python tools\deploy.py

# 生成 release\ 分享包（核心包 + 两个图包，全量重拷耗时较长）
python tools\make_release.py [version]
```

## 许可与免责声明

- 代码以 **MIT** 协议发布（见 [LICENSE](LICENSE)）；内置字体为 SIL OFL 1.1（见 `src/fonts/LICENSE-fonts.txt`）。
- 词库、译文与示例图来自公开站点爬取加工，仅用于学习研究，请自行评估使用合规性。

## 致谢

- [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) — @pythongosssss：本插件的标签补全功能交互源码（光标定位、输入框接管等）参考自该项目。
- [Danbooru](https://danbooru.donmai.us/) — 标签与 wiki 数据上游。
