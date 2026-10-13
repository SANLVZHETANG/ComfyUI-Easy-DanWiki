# 项目状态 — ComfyUI-Easy-DanWiki

> 本文件只保存"现在"。历史见 `CHANGELOG.md`。
> 一切以实际代码 / git / 测试结果为准;下列均为已核实状态(截至最近一次核对)。

## 当前阶段
**v0.4.8 已推送（2026-10-14，用户令"开始推送"，验收全关）**：v0.4.7 组链路(tag_groups 91 组+触发六形态+组浏览器/HUD 组 tab)+ v0.4.8 悬停预览特性链(feat1~feat4)+设置折叠组(feat2)全部验收通过——feat4 跳转残留、C5 日文正文悬案用户均已确认关闭。49+ 新文档 commit + tag v0.4.8 上了 GitHub(fast-forward,origin 无冲突)。开口=图包分包发布(`tools/pack_split.py`,方案已拍板待动工)+copyright 补图(全零 1,964,>500 版 426 优先)。
前版:v0.4.6 已推(2026-10-06,origin=9791838,tag v0.4.2–v0.4.6);v0.4.7 的 commit 随本次一并上 GitHub(未单独打 tag,状态行 VERSION=v0.4.8 直接受众)。

## 当前任务
- **图包分包(等"打包"口令)**:`tools/pack_split.py` 按已拍板方案出包(方案记录见"重要契约"段),含逐库对账与 release/README.md 更新(禁改仓库根 README)。
- **copyright 补图(分包后)**:>500 posts 426 个优先,补完发 `6_copyright_*` 首包;general 2,062 个随后出 update。
- **验收三批(用户侧)**:①v0.4.3 组——重启 ComfyUI 后 B1/B2 角色图接口+C 组 HUD(矩阵 `sub-…-llm命名\acceptance_v0.4.3.md`);②v0.4.4/4.5 组——属性检索实测("社恐"→后藤一里、"北极熊"→早露)+卡片正文无 markup 噪音;③v0.4.6 组——角色 tag 橙色观感。**更正(2026-10-06 复核):E: 图包在位——`dataset/manifest.json`(10-04 合并版 22,007 条)+ tag_images 20,705 + tag_images_large 20,727 文件实存,图类验收仅需重启 ComfyUI;无图的 2/3 tag(hilbert_(pokemon) 案)是当年爬图未覆盖的数据事实,非 bug。**
- **分享/截图功能**:已按用户指令**降为低优先级**(挂起;恢复时从 6 问拍板续)。

## 工作约定(用户指令,须遵守)
- **凡涉及 TODO,一律以 list 形式列出**(编号 + 简短标题 + 状态/依赖),方便用户查看;不要只写成散段落。
- **已关闭/完成的 TODO 不再显示**,只列未完成项。
- **脚本运行实时进度(2026-10-13 用户令)**:凡脚本/批查/构建一律**禁止黑盒静默运行**——①>数秒的脚本必须分段 print 进度(阶段开始/每批 i/N/结束+耗时),`python -u` 直通不缓冲;②长跑(>1-2min)必须后台化 + 落 STATUS/log 文件 + 链式轮询自播报;③联网批量查询**先打试金石**(单条/小批验证参数语义与限流)再全量;④脚本报 0 命中/全灭类异常必须当场验伪不得直接采信(教训=组收录调查首版 name_comma 全灭被误读为"tag 不存在")。

## 关键路径与环境(供后续接手,避免重新踩点)
- 代码仓库(主开发):`C:\Users\SANLVZHETANG\Desktop\todo\ComfyUI-Easy-DanWiki`(git master)。
- **ComfyUI 实际加载的部署位**:`E:\ComfyUI\custom_nodes\ComfyUI-Easy-DanWiki`(每次改前端/数据需同步;server.py 改动要重启 ComfyUI,js/css 硬刷新即可)。
- 数据源分类目录(仓库外,author-local):
  - 通用英文 wiki:`todo\danbooru-general-tags\clear_dantag_wiki.jsonl`(30442)
  - 通用中文:`todo\sub-ComfyUI-Easy-DanWiki-翻译\out\translations.jsonl`(30442)
  - 图源 store(全类共用,canonical):`todo\sub-ComfyUI-Easy-DanWiki-爬图像\`(manifest 22,007=general+meta+char 全在内;两盘合计实占 5.4GB)
  - meta 全链路:`todo\sub-Comfyui-Easy-DanWiki-workflowtest\`(clear_wiki_ge50.jsonl / pipeline/meta_translations_ge50.jsonl / dataset\manifest.json)
  - **角色正文翻译正式库**:`todo\sub-ComfyUI-Easy-DanWiki-翻译\data\char\char_translations.db`(29,112=done 29,107+bad_markup 5;占位池/判卷/QA 工具同工程)
- **构建(一次产出全部类)**:`DBTAGS_SOURCES=<repo>/tools/dbsources.json`(已固化进仓库,2026-10-04;含 general/meta/character 三源),`DBTAGS_PLUGIN_DATA=<repo>/web/js/data`,`python tools/build_index.py`。
- **标签组构建(v0.4.7 新)**:`DBTAGS_GROUPS_CACHE=<todo>/preview-tag-groups/cache/groups python tools/build_tag_groups.py`(离线 `--offline`;产出 `web/js/data/tag_groups.json` 91 组/421KB;E: 部署位需再跑一次换 `DBTAGS_PLUGIN_DATA` 指向 E: 的 data 目录)。
- 角色源三件套:`todo\all dantag\wiki_checked_cat4_gt50.jsonl`(36,128 wiki)+ `todo\sub-ComfyUI-Easy-DanWiki-llm命名\out\char_zh.jsonl`(三源+fill 转典,body 覆盖 31,572)+ `todo\sub-ComfyUI-Easy-DanWiki-爬图像\manifest.json`(22,007,已含 char 图 12,176)。
- **角色数据工作流(新 tag 增量复用)**:`todo\sub-ComfyUI-Easy-DanWiki-llm命名\PIPELINE.md`(账本续传,幂等,9 步)。
- meta 图打包(独立小包):`python tools/make_meta_pack.py` → `todo\meta-image-pack\meta-example-image-{small,large}.zip`。
- **待开发方案登记处**:`agent-memory\ROADMAP-*.md`(现行:ROADMAP-on-demand-image-cache.md,缺图按需联网取图+本地缓存,6 个决策点待拍板;ROADMAP-tag-groups.md——tag 组浏览,**2026-10-12 已实现待验收**)。

## 重要契约(勿破坏)
- 分类文件命名 `N_<名>.json`(`0_general.json` 恒载;`5_meta.json` 等按设置加载)。category 实测:**general=0, artist=1, copyright=3, character=4, meta=5**(meta 曾是 5,勿再当 4)。
- 前端把"启用的各分类 `.tags` 拼成单一 `index.tags`"→ 检索/跳转/HUD/图片零改动。开关=`enabledCats`(CSV,""=按 catalog 默认=通用+meta)。动态发现读 `web/js/data/catalog.json`(build 生成)。
- 图片共用单一 `dataset/manifest.json`(general+meta+character 合并,22,007 条=9,831+char 12,176,名不相交;源目录与 E: 部署两份)。server `/dbtags/image` 按 `manifest[tag]` 发图,large↔small 自动回退。**2026-10-06 复核:E: 部署位图包完整在 `dataset/` 子目录**(初查误判"无图包"根因=`ls 插件根|grep "img|tag_|manifest"` 匹配不到目录名 dataset——**勘查教训:嵌套目录存在性必须进内部验证**)。**2026-10-13 再勘:图记录源头=索引 images 数组+E: `dataset/manifest.json`(22,007 合并版);仓库根 `dataset/manifest.json` 只有 9,831 旧副本(general+meta)——图统计/分包必须读 E: manifest,否则误判 character 0 图(本次已踩,用户纠正)**。
- **图包分包方案(2026-10-13 用户拍板,记而未执行)**:包名=`数字分类_英文分类名_大小_example-img.zip`——`0_general_large_example-img.zip`(1,508MB)/`4_character_large_example-img.zip`(12,174 图,1,290MB)/`5_meta_large_example-img.zip`(75 图,13MB)/`6_copyright_large_example-img.zip`(**0 图,唯一结构性缺口**——>500 posts 无图 426 个,补图后首发~60MB);small 同式分包(62/67/1MB)+总包 `all_small_example-img.zip`(130MB,`all` 占数字分类位)。要点:①包内路径冻结 `tag_images{,_large}/ab/cd/…`,解压 `dataset/` 同树合并,js 零改动、**DATA_V 不 bump**(分包不动索引;补图入库才 bump);②每包附 `manifest_<分类>.json` 子清单(自描述+重建用),主 manifest 不动;③zip 用 STORED(Python zipfile,jpeg 压不动);④**不搞增量 update 包**——补图后直接重打对应分类全量包,老用户按包重下;⑤缺包降级安全(图缺失→悬停 onerror 自摘回文字卡,不报错);⑥release/ 7z 分卷旧包保留。执行清单:`tools/pack_split.py`(读 E: manifest+四库索引按库分组打包→逐库对账文件数/字节→release/README.md 更新下载与安装说明,禁改仓库根 README)。
- build 链抽取用**全类并集 name_set**→ general↔meta 双向 `[[链接]]`(已验证 394/368 条)。
- **禁止编辑仓库根 `README.md`**(用户硬规);**未获"推"指令禁止 git push**;回复用中文。
- **角色命名优先级(2026-10-04 用户定版+补充裁定)**:`zhtag`=第一遍 LLM 考据名(c=high/medium)最高优先;**但孤名败给共识**——一轮名与 wiki 不符、且 wiki≡pixiv 双源互证时,双证名上位、一轮名降为别名(首裁 248 例,含 rosa→早露;平票仍 LLM 优先,见 `char_make_zhdict.py` 投票段)。wiki/pixiv/fill 其余进 `aliases_zh`;脏名治理=精确匹配 `llm命名\out\blacklist.txt`。
- **正文翻译契约(2026-10-05 定版)**:`[[链接]]`/`{{模板}}`/外链逐字保留,`Kx` 占位符按成对数核对;译文层禁止给未验真名背书(name_cn 仅参考);bad_markup 行不参与 rerun,转典 `WHERE status='done'` 天然回退 who。
- **显示层清理(2026-10-06)**:build_index `display_clean()` 剥画廊行/bbcode/hN./模板/内联 pools(N)——wiki_zh/summary 进索引前统一净身,DB 原文无损可回退;渲染层 `renderWikiBody` 只解析 `[[..]]`,chip "中文 (en)" 双写是 linkLabel 既有设计非残留。
- **角色 tag 染橙(v0.4.6 定稿)**:cat=4 的下拉行名字+译名列、所有 wiki chip 直接用 `--dbtags-char-accent` 橙(基座亮橙/onlight 深橙自动适配全主题);**彩点、常驻色条两案均被用户否决**,再动外观先问。
- **缓存键(v0.4.2 起)**:`DATA_V`=索引+图片 URL 键(仅数据重建时 bump);`ASSET_V`=CSS 键(样式改动 bump);`VERSION` 纯显示/跟 tag。js 本体走 ComfyUI ETag,三者都不管它。现值(2026-10-14):**VERSION=v0.4.8 / DATA_V=v0.4.7e / ASSET_V=a37**(回退到 `59b09b1` 后重启 UI 线:fix15 zh 别名小字;教训=任何数据文件重建后立即核 DATA_V;**教训2(v0.4.7 fix15):ASSET_V 键永不复用**——a9 曾属 fix6 弃线,fix15 复撞后浏览器强缓存吐旧 css,用户看到的"字号变化"其实是被废弃的 fix6 形态;键值从 a19 起步跳过 a10..a18 全部历史)。
- **正文检索通道已存在**:js `bodySearch`(summary+wiki_zh 拼 bodyDocs,CJK≥2字扫,fuzzy 末位,热度序 top20)。角色正文翻译=解锁属性检索("社恐"→后藤一里);31k→67k 扫描翻倍,上线后需 PERF 实测。
- **server `_load_manifest` 是进程级单例缓存**:换 manifest 必须重启 ComfyUI 才生效(2026-10-04 实测教训)。
- **长跑批铁律**:后台任务必须 `Start-Process` 脱离进程树发射(harness 后台 shell 会被 OpenCode 重启连坐击杀);PS 脚本带 BOM、重定向用绝对路径;rerun 兜底必须等全部分片退出。

## 已完成(已验证)
- v0.4.1:多分类库(build 多源+并集+catalog)、meta 图并入共享 dataset、manifest 合并 9831、server INDEX_FILE→0_general + `/status` 报分类、前端 loadIndex 多文件拼接+"标签类别"动态复选框群(meta 默认开)、去掉临时 includeMeta/META_CAT 门、make_release glob `*.json`、删 tags_index.json、`.gitignore` 屏蔽 build_report/links_pending/*.bak。**已 commit+tag v0.4.1+push**(origin/master=214cbc5)。
- meta 标签名修正:catalog 里 `meta(修饰词)`→`meta(元数据)`(码点已验)。删除"标签类别"里会累加的独立提示行(renderCatGroup 幂等化)。
- meta 独立图包:small 530KB / large 12.4MB(75 标签,md5 去重后 72+说明;交叉验证与部署 manifest 路径 100% 一致)。
- HUD 悬浮看大图(**v0.4.2,commit ec2c265+tag,已部署**):两模式悬浮+200ms 弹大图卡+即时浮标;`.dbtags-ac-hud-imghint` 样式。
- **v0.4.2 附带:缓存键拆分**:`VERSION` 转纯显示;新增 `DATA_V`/`ASSET_V`。样式发版不再逼全员重拉 25MB。
- v0.4.3 角色库(7003ccc/82e2638/04c5b82):4_character.json 36,128 tag 入索引;LLM 一轮名=zhtag、双源共识 248 例降位、unknown 前缀 9 条修复。
- **v0.4.4 角色正文真译文(45d3274)**:29,112 全落账(16 并发跑批,~58M token/日);三层质检全绿(链接序列/{{}}对数/结构计数/五维终审 38 疑点=0 实质缺陷);char_zh.jsonl body 覆盖 31,575=真译 29,107+who 兜底 2,468。
- **v0.4.5 display_clean(8d160b8)**:三源脏 markup 327→0(hilbert 案暴露);4_character 33.9→32.0MB;链接计数无损(miku 27/27)。
- **v0.4.6 角色 tag 染橙(4814381,前两案已 revert)**:本体染色,主题自适应,无附加装饰。
- **"推"执行完毕(2026-10-06)**:master 推至 9791838(non-fast-forward→merge 保 GitHub 侧 README 提交,**不 rebase**——tag 已先推,rebase 会断 tag lineage);5 新 tag 上架;Release 惯例=单一滚动图包 Release(挂 v0.4.1,用户网页手建)。
- **smoke/ 处决(903168e,2026-10-06 用户令)**:tracked 的 9 月性能随笔删除,.gitignore 同项清除;活口两条移植低优先行(原文可 `git show b5bb364:smoke/perf-backlog.md` 取回)。**晚于"推",待再推。**

## 已知问题 / 注意点
- **死胶囊(未决)**:关掉 meta 时,通用正文里 394 条指向 meta 的 `[[链接]]` 仍显示但点开提示"未收录"。三方案①保持②隐藏未加载目标③置灰——待用户选。
- HUD 分享/截图:若采用,毛玻璃 `backdrop-filter` 截不出(可临时挂 `html.dbtags-noblur` 规避);FontFace 载入的自定义字体库通常取不到内联(可能回退系统字体)。
- server 改动需重启 ComfyUI 才生效;前端需硬刷新。

## 重要决策(本次形成)
- 索引**不合并**,每类独立文件;图片并入共享 dataset(3a 单一合并 manifest)。
- 图包发布走 **B 方案**:通用 1.5GB 包不重做,meta 单独出小包(增量仅 ~13MB)。
- HUD 悬浮时长从误设的 1s 改为 200ms + 即时"查看大图"提示(用户反馈)。
- 正文翻译范围=**A 全量 29,112**(用户拍板,非 D),渐进试点验证后放量。
- 类别区分外观:**彩点、常驻色条先后被否**,终=角色名本体染橙(v0.4.6)。
- smoke/ 随笔类工作文件**不入公开仓**(tracked 笔记=历史包袱;要留的活口直接写进 PROJECT)。

## 角色普查数据(历史,已定版执行——详见 CHANGELOG 09-24/09-25/10-04)
- 角色 ≥50 = 36,128 个已全量入图入典;图 12,176 张已随合并 manifest 部署 E:(2026-10-06 复核在位)。

## 待办 TODO(按优先级;用户指令:**已关闭项不再显示**)
- [ ] **P1** 图包分包动工与补图链(见上方 P2 图包条目;用户口令驱动)。
- [ ] **P2** 图包分包**发布动工**:按 2026-10-13 方案写 `tools/pack_split.py`(四类 large 分包+small 总包/分包,见"重要契约"段;对账;release/README.md 更新,禁改仓库根 README)。E: 部署位图包已在位,无需动;copyright 包待补图后首发。
- [ ] **P2** **缺图按需联网取图方案**:详见 `ROADMAP-on-demand-image-cache.md`;对象=**数据缺口 2/3**(E: 图包误判已更正)+未来增量;**6 个决策点待拍板**(范围 A/B、缓存目录、默认档位、danbooru 账号、开关默认、磁盘上限);开工前置=donmai.us 可达性 curl 探测。
- [ ] **P3** pixiv C 类 6,308 挂起表 × cat3 别名对账(可救《永恒久留姬》新 IP 无名头部 + B 类 431 括注歧义)。
- [ ] **P4(可选)** U3:danbooru tag_aliases 爬取(别名链救援,匿名可行)。
- [ ] **低** bad_markup 5 条手工修译文;`build_index.extract_zh` 的 `_JP_HANZI` 表误杀中文常用汉字(clownpiece 案)待修;67k bodyDocs 线性扫描 PERF 实测;死胶囊三方案待选;分享/截图挂起;离线回归脚本;**Styler `#set()` 键→影响域分派+rAF 合并**(css/search/popup/none 四组方案已拟)、**批次三按需再评估**(词库 gzip/bigram 倒排/Worker 解析)——原 `smoke/perf-backlog.md` 已删(903168e),全文见 `git show b5bb364:smoke/perf-backlog.md`。

## 下一步
用户驱动:①"打包"口令→分包动工→②copyright 补图→③Release 资产替换(网页手传,本机无 gh);ROADMAP 按需取图 6 决策点另行拍板。新 tag 增量走 `PIPELINE.md`。

- **约定补充(2026-09-23)**:长时间后台任务运行期间,助手必须**链式轮询自播报**(每 ~10 分钟在回合内报告一次进度直至完成),另提供 `tools/watch.py`+`STATUS.txt` 供用户任意终端自看。
