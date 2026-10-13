# 已实现：Danbooru 标签组浏览（tag groups, v0.4.7）

> 状态：**编码完成，待 ComfyUI 验收**（2026-10-12 实现；preview v0–v5 五轮迭代 + 用户四项拍板后落地）。
> 一句话：输入 `组:` / `group:` 前缀 → 组列表 → 回车/点击开持久浮窗图墙 → 点成员=往当前输入框加词；wiki 面板 / HUD 显示 tag 的组归属。

## 数据
- 源：Danbooru wiki `tag_group:*` 活页（2026-10-12 核定 **91 个**；另有 19 个已删墓碑页不收录）。`tools/build_tag_groups.py`（parser 五规则：h2–h6 节、`!post #N:` 剥离、别名链分隔符 `/ + , ; & or and`、括号/破折号后散文=note、无标题隐式首节、See also/External links 剔除）→ `web/js/data/tag_groups.json`（421KB）。
- **成员 zh/热度/图不进数据文件**：运行时查 `getTagMap()` + `tag.images`，类别开关/数据重建自动同步组浏览器。
- 口径（**2026-10-13 调查勘误为准，preview 旧口径作废**）：成员引用 16,591 / **唯一 14,711**（normName 折叠写法差异后的前端 runtime 口径，preview 报的 16,246 是 raw 串口径）/ **本地收录 8,604（59%）**。people 0/1,679、fine_art_parody 与 platform_games 之外另有多组低收录——见下方调查节。
- 组列表排序 = **已收录数降序**（构建文件按成员数降序仅作后备稳定序）。
- **组数复核（2026-10-12 深夜在线实证）**：活组 **91** ✅——`title_normalize=tag_group:*` 全量 110=活 91+已删墓碑 19（_species_(f/m)/artistic_freedom/bra/breasts/card_games/dress/embellishment/glasses/language/mask/meme/panties/penis/piercings/scan/skin_folds/smileys/tail，均为被新主题组并编后删除的旧页）；与本地缓存 110 份、与 tag_groups.json 91 组**三方对账零差**；分页实拉一页装下（无 limit=500 截断风险）；官方 `tag_groups` 总览页仅说明文+锚点无组链接、sd_tag_groups/tag_group_list/help:tag_groups 均不存在——命名空间外无漏网组页。**在线模式枚举是实时拉取，91 非写死名单**（GROUP_ZH 92 键仅=离线回退+中文对照，含 1 个非组页 language 已显式排除）。
- 构建：`DBTAGS_GROUPS_CACHE=<todo>/preview-tag-groups/cache/groups python tools/build_tag_groups.py`（`--offline` 纯缓存；活组名单离线回退=GROUP_ZH 表−language）。

## 交互（四项拍板，2026-10-12"按你说的做"锁定）
1. **触发**：`组:` 或 `group:` 双前缀（ASCII 与全角冒号都认；前一字须分隔符/行首，防误伤）；候选列表 = 组列表（▣ + 中文组名 + 英文原名 + 已收录/成员），组内继续输入即过滤。
2. **"属于组"反查**：wiki 面板与 HUD 详情顶部显示 `▣ 属于组: 食物` chips（member→groups 反查表运行时建），点击直达该组。
3. **展示区（不开第三形态）**：内联模式 = GroupBrowser **独立持久浮窗**（×/Esc 关；不随补全弹窗隐藏——连续加词必需）；HUD 模式 = HUD 内**组 tab**（pins 前缀 `grp:`，上限 3 个超出顶最旧，随 hud.tabs 持久化）。
4. **使用**：**无胶囊**，图格为唯一形态（缩略图+中文名+英文小字；未收录=灰格 `?`，仍可点击插入）；组内过滤（中/英）、"只看已收录"、节折叠（▾/▸ + 收起/展开全部）；点图格 = `insertWikiTag`（光标处未完成词被顶替），**插完不关窗**。

- 已否决：胶囊视图（用户 2026-10-12"不需要胶囊展示"）；居中模态、独立 ComfyUI 节点、styler 加 tab（2026-10-12 讨论定案）。
- 二期（未做）：shift 多选批量插入、浮窗拖拽/调宽、节标题批量翻译、LLM 批译成员名补充。

## 关键代码位（dbtags_autocomplete.js）
- 组数据层：`normName` 之后（`_groups/_groupMap/_memberGroups/groupHit/loadGroups` 等）。
- 类内：`#groupQuery / #consumeGroupTrigger / #renderGroups / #openGroup`（#update 顶部拦截，先于 token 守卫——全角冒号是 token 分隔符）；`#insert` 组分支；`#renderMemberOf` + `#createPanel` 的 `p.gm` 槽。
- 模块级：`buildGroupRow`（buildItemRow 后）；`buildGroupBody / renderMemberChips / GroupBrowser / openTagGroupBrowser`（styler 段前）。
- HUD：`openGroup / refreshGroups / #renderGrpTab`、`#current` grp 分支、`#renderCurrent` 顶部分支 + `this.gm`、tab 标签 ▣ 前缀。
- 设置：SETTING_DEFS `groups:"true"`；外观设置"wiki 面板"组新增"标签组"开关。
- CSS：文件尾"tag groups (P19, v0.4.7)"整段（全主题变量，无硬编码色）。

## 未收录构成调查（2026-10-13，v4 全量实证）
> 背景：用户问"灰格未收录是不是大部分因为 tag<50 帖"。方法=6,107 未收录成员逐批查 danbooru /tags.json 实际 post_count+category（批 20/批=匿名 API 硬上限；早期版本误用 60/批致 67% 假"不存在"，v3 单查 60/60 全命中证伪后修订）。
1. **<50 帖 = 4,899（80.3%）**（1..49 档 4,774 + 0 帖 125）——主流原因，与用户假设吻合；people 组 1,679 未收中 1,670(99.5%)<50（真人名目录天然如此）；real_world_locations 363/sports 309/food_tags 270 等单表组也是 <50 档主力。
2. **≥50 帖 = 1,181（19.3%）**，其中 **copyright（版权 IP）1,096（92.8%）**——touhou/fire_emblem/gundam/elden_ring… 全是 IP tag：**设计上我们只有 general/meta/character 三库、不含版权类**，不算漏收（若要收是"建版权库"新立项）。
3. **真·漏收候选 = 85 个（1.4%）**：general 79 + character 4 + meta 1 + artist 1。general 里最扎眼：cum_puddle(7,001)/tokyo(1,802)/rainbow_theme(771)/aztec_clothes(574)/kyoto_(city) 440/acubi 等多在 80-1,800 帖区间——疑为当年 general 爬取清单截断或清理时漏网（TODO 线索，低优先补抓评估）。
4. **danbooru 上真不存在的仅 27 个（0.4%）**（已改名/废弃，含 shit_post_central）。
- 工具与全量产物：`Temp\opencode\dbtags_survey_v4.py` → `dbtags_missing_survey_v4.tsv`（6,107 名×post_count×category×组归属）+ `survey_v4_summary.json`。教训回首：联网批查必先试金石+受限额上限定批大小（匿名 /tags.json limit=20）。

## 缓存键（本次 bump）
`VERSION=v0.4.7` / `DATA_V=v0.4.7`（新数据文件）/ `ASSET_V=a6`（CSS 变更）。

## 验收清单（ComfyUI 重启 + js/css 硬刷新后）
1. 输入框敲 `组:` → 91 组列表（按收录数降序、中文组名）；`组:食` 收窄到食物；`组：`（全角冒号）同效。
2. 回车/点击组 → 浮窗打开，输入框里的触发词被清除。
3. 点 `苹果` 图格 → 光标处插入 `apple, `，图格亮边；连续点选不死窗。
4. 敲 `苹果`（普通候选）→ wiki 面板顶部出现 `▣ 属于组 食物`；点击直达。
5. HUD 模式下点"属于组" → HUD 出现组 tab；开第 4 个组顶掉最旧组 tab；重启后组 tab 恢复。
6. 外观设置关"标签组" → `组:` 不再触发。

## 验收反馈与修复记录
- **fix1（2026-10-12 晚，commit 9ade0fb + ASSET_V a7）**——首轮验收 3 问题：
  1. **无法折叠**：原实现折叠只换 caret 图形、格网照渲染（真 bug）；改为 `open = !coll[si] || 有搜索词`（格网真隐藏，搜索时临时强展开，折叠节数字只显示总数），收起全部/展开全部随之生效。
  2. **竖字**：`dbtags-ac-gtoolbtn` 不再复用 `dbtags-ac-close`，改 `all: unset` 归零后手工重建（writing-mode/text-orientation/white-space 全部显式钉死），宿主任何注入样式不再影响；节标题 nowrap 防竖排。
  3. **节标题汉化**：SEC_ZH 迁至 `tools/tag_group_section_zh.json`（758 条独立增补，build_tag_groups.py 加载失败时回退内置精简表），覆盖全部 91 组（含 Meat and Seafood→肉与海鲜、people 组国家形容词 48 条+-generic 职业分类；作品专名保留英文）。非 people 组 ≥15 成员的节 100% 汉化；h5/h6 子节标题按层级缩进 14/28px（h6 斜体）。
- **fix2（2026-10-12 深夜）**——fix1 首轮验收"同性行为像父节"暴露出**缩进方案整个作废**，另有浮窗自由度两项：
  1. **节标题层级≠语义层级，全线平铺**：sex_acts 里 Ageplay…Roles 共 16 节全是 h6、而前后节是 h4（wiki 页作者把标题层级当排版用）→ fix1 的缩进/斜体把同级大节画成"同性行为"的子节。全库扫描：91 组中 54 组带 lv5/6 节、49 组存在假嵌套（people 73 深节、holding_tags 52、technology 28、sports 25…）→ **删除 lv 缩进与 `--deep` 斜体，所有节头同级平铺**；lv 数据字段保留（数据文件不动，仅渲染层）。
  2. **组浏览器浮窗可拖拽**：head 整条 = 拖拽把手（pointerdown + setPointerCapture；×按钮除外）；拖动限位（留 40px 横向/24px 纵向可见，不会被拖丢）；拖完存 `localStorage dbtags.autocomplete.gbGeom`；位置只在用户拖过一次后记忆——首开仍按调用点锚定。
  3. **浮窗自由缩放**：`.dbtags-ac-gbrowser` 加 `resize: both`（右下角手柄），min 320×200 / max 96vw×94vh；ResizeObserver 节流 200ms 忆尺寸，重开时回填内联宽高（浏览器 resize 的 inline 样式不跨刷新，需 JS 恢复）。
  4. **DATA_V 补 bump（fix1 遗漏修正）**：fix1 重建过 tag_groups.json 但没 bump DATA_V，URL 键仍是 v0.4.7——HTTP 缓存可能让 fix1 汉化数据根本到不了浏览器。现 **DATA_V=v0.4.7b / ASSET_V=a8**；代价=全员重拉一次 25MB 索引（一次性）。
- **fix2 验收：通过（2026-10-12 深夜，用户"P1.1 done"）**。拖拽/缩放/几何记忆/层级平铺就位。
- **fix3（2026-10-12 深夜，用户令）**——组浏览器加"全部组目录"页：
  1. **入口**：①`组:` 下拉候选**首行固定「全部组…」**（`组:` 直接回车即开目录页）；②详情页标题栏左侧 **`‹ 全部组`** 返回键。目录↔详情互相可达、窗位置尺寸全程保持。
  2. **目录页形态**：过滤框（中/英，Esc 先清词再关窗）+ 匹配计数 + **卡片栅格 `auto-fill minmax(200px,1fr)`**——大窗自动增列（用户拉大窗口后仍是 2 列的问题不存在，卡片流满宽）；排序=已收录数降序（同下拉）；卡片=▣+中文组名+命中/总数+英文小字；点卡片进详情不重定位。
  3. **openTagGroupBrowser(null, anchor)=目录页**（语义化-null 路由）；定位抽 `_place()`（记忆几何>锚点>CSS 默认，尺寸记忆回填），open/showList 共用。
  4. CSS 新增 fix3 段（gcard 卡片走 all:unset 防竖字教训）；**ASSET_V=a8→a9**；DATA_V 不动。
