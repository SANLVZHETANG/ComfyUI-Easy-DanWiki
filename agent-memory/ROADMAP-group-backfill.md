# 组背填（group backfill）——补全标签组内缺失的 tags 与 wiki（2026-10-13）

> 状态：**进行中**（爬批已发射）。上游=tag groups 验收后用户新指令："补全组里所有缺失的 tags 和 wiki；版权类建库；按原管线；先不管图片"。
> 一句话：把组浏览里 6,107 个灰格中**能补的 6,080 个**逐个拉取 danbooru wiki 正文 → 按类生成背填 jsonl → 走原 build_index 多分类链重建四库（0_general + backfill / 4_character + backfill / 5_meta + backfill / **6_copyright 新建**）。

## 范围与数据基础（v4 调查，见 ROADMAP-tag-groups.md 调查节）
- 对象 = 组浏览灰格 6,107 中查得到的 6,080（**27 个 absent 放弃**——danbooru 上已改名/不存在，名单在 `组背填\cache` 工具日志；它们在组里继续灰格属正常）。
- 分类普查：general 2,197 / copyright 1,964 / character 1,799 / meta 116 / artist 4。
  - **copyright 里 868 个 <50 帖**——一并收进版权库（"组内缺失全收"，不受 50 帖门槛限制）。
  - **meta 背填 116**（此前以为只有 2 条——v4 全量 category 矫正）。
  - artist 4 条按设计归入 general 背填（cat 标 0；误差 4 条，注明）。
- **翻译不在本轮**：wiki 中文译文（wiki_zh/zhtag）属既有 LLM 翻译管线（sub-翻译 工程）后续批——本轮先把**英文 wiki 正文**与 tag 名入位，译文空缺时卡片自动显示英文 summary（现有回退）。

## 交付物
1. `tools/backfill_group_members.py`（新）：v4 TSV → 每名拉 `/wiki_pages/<title>.json`（**http 200=wiki 页、404=骨架行（名字-only）**、5xx/DB 瞬断=重试×4）→ 四路 jsonl（schema 与底稿一致：name/post_count/body/other_names）。
   - 缓存=每名一 json（`组背填\cache\wiki\`）→ **断点续传可重跑**；输出实存 `todo\sub-ComfyUI-Easy-DanWiki-组背填\`（repo 外数据源惯例目录）。
   - 试金石教训入库：danbooru 会瞬时返回 `"database is unavailable"` JSON（curl 仍 200 code）→ 按 `success:"False"` 识别重试；`other_names` 自带 CJK 别名 → `extract_zh` 自动接住。
2. `tools/build_index.py` **数组 wiki 兼容**（向后兼容小增强）：source 的 `wiki` 字段可=字符串或 jsonl 路径数组（融合多文件）；`zh` 字段可缺（空译文）。不改写入/verify/其余逻辑。
3. `tools/dbsources.json`：general/meta/character 三源的 `wiki` 升级为数组（原底稿 + backfill_*.jsonl）；**新增 copyright 源** `{cat:3, label:"copyright(版权)", default:true, wiki:backfill_copyright.jsonl, out:"6_copyright.json"}`（zh 省略）→ **catalog/设置"标签类别"复选框自动出现，无需改前端**。
4. 重建链：repo 层 build（DBTAGS_PLUGIN_DATA=repo data）→ 同套 DBTAGS_PLUGIN_DATA=E: data 目录再跑 → **DATA_V→v0.4.7c**（索引大改，0/4/5/6 全变）+ deploy。
5. **图片照旧不动**（manifest/release/图包零改动；背填 tag `images` 空走现状回退）。

## 验收清单（build+部署+硬刷新后）
1. 设置"标签类别"自动出现 `copyright(版权)`（默认勾选）；已有三门勾选记忆保留。
2. 组浏览器中版权成员从灰格变**可点/可插**（卡内名字+英文正文；无译文显示英文）。
3. people 组成员大多变名字-only 亮格（可插入，无图无中文）。
4. `cum_puddle / tokyo / pokemon_sword_and_shield` 等原灰名可插入；版权 tag 搜索/跳转正常。
5. 原 91 组数量/功能不变；`组:` 触发、收藏、HUD 无回归。
6. 首次刷新重拉 ~40MB+（DATA_V bump 一次性代价，告知用户）。

## 边界与已知
- 27 absent 永不可补（记录名单）。
- 翻译批（中文化）是下一阶段，走 sub-翻译 既有管线（本轮泥卡不动）。
- artist 4 条误挂 general 色（1-4 条级误差）。
- 爬批长跑 Zukunfts 已按铁律：Start-Process 脱离进程树 + STATUS.txt + 链式播报。

## 执行实录（2026-10-13 凌晨收工）
- 爬批初版单进程 rate 0.67/s（ETA 141min）→ **6 分片并行再重启**（Start-Process ×6 + `--shard k/6` 缓存共享断点续传初版 400 名）→ 31 分钟收工：**wiki200=4,893 / 404 骨架=1,187 / fail=0**。
- 截然约束实录：danbooru 匿名软限速聚合 ~3.3 名/s（服务端 throttle，响应被拖慢，无 429 信号；burst 窗口曾 17 名/s）；**tags.json 匿名 limit 硬上限=20/批**（早期 60/批误配曾致 67% 假"不存在"，v3 单查 60/60 全命中证伪）。
- `--collect` 四路 jsonl：general 2,201（含 artist 4）/character 1,799/copyright 1,964/meta 116=**6,080 全落账**。
- **双端 build 全绿对账**：0_general 32,643（30,442+2,201）/ 5_meta 655（539+116）/ 4_character 37,927（36,128+1,799）/ **6_copyright 1,964 新建 947KB**；catalog 自动 Four 类全 default；copyright with_any_alias 1,579、py 277（other_names CJK→extract_zh 自动接住）、zh/wiki_zh 按设计=0（等翻译批）。
- **DATA_V→v0.4.7c**（索引+图片 URL 键全变，首拉 ~40MB 一次性）；ASSET_V a9 不动。

## 译文批实录（2026-10-13，同日接续）
- 走 sub-翻译 既有工具链零改动：合并四路 → `make_placeholder` 占位化（6,080 条 no_body=1,736/with_link=4,029/restore_mismatch=0）→ 新 `config_backfill.json`（独立 `data_backfill/` 库，**不动** 30k 主库/char 库/meta 库）→ **16 路 Start-Process 分段直写 WAL**（launch_full 同款）。
- **全程走 general 契约**（char 契约不出 name_cn——骨架也要名字中文化，故统一通用提示词；背填角色名=LLM 通用命名，与 36k 主库 zhtag 定稿管道不同源，误差可接受）。
- 用时 ~47 分钟 / 聚合 140-146 条/分（比 char 全量 62 快 2.3 倍）；**token 全程 ~7M**（均价 ~1.1K/条）。
- **`--limit` 语义实测坑**：limit 锚定"实际执行批数"非区间端点——前段工人越界接力、后期并发衰减到少数几路（ETA 尾段飘长的主因）；db_write 幂等覆盖，零伤害。
- 失败 6 条全部回收：5 条 batch_runner 单 seq 重跑即过；`sonic_(series)`（148 链接列表巨文）模型 6 连败于句序重排 → **外科手工翻译**（`data_backfill/fix_4028.py`：linkguard.verify 双重 0 diff + 占位序列 canonical 校验后 db_write）。
- **导出**（`tools/export_backfill_translations.py`）四分类译名 jsonl：name_cn **6,080/6,080 全覆盖**（含 1,736 骨架纯名译：黄苹果/华纳兄弟…）；body_cn=4,344 与有正文数精确咬合。
- dbsources 升级：general/meta/character `zh` 字段数组化（原底稿+背填译文）、copyright 首挂 zh；**build_index `load_zh_dict_any` 镜像 wiki_files 增强**（先入者优先，零重叠）。
- 双端重建对账：general zhtag 32,643/32,643 全覆盖；character 17,969+1,799=19,768 精确；**copyright zhtag 0→1,964/1,964**；两 wiki_zh 覆盖=28,102/32,643 与 1,490/1,964；五文件 ALL-EQUAL（built_at 除外）。**DATA_V→v0.4.7d**。

## 别名清洗实录（v0.4.7e，同日）
- 用户验收暴露**骨架别名撞名**面：LLM 对无正文骨架抖机灵造别名，全库 scan 1,455 条 zh 撞车（general 530/char 579/copy 346）。
- 清洗规则（`tools/clean_backfill_aliases.py`）：**只动 body_cn=null 的骨架行**；alias 与"别的 tag 的 zh 池（name/zhtag/aliases_zh/zh）"撞车才剔除；**name_cn 永不删**（错别名是噪音、没中文名是损失）；有正文行 1,215 条冲突全保留（body 支撑可信 + exact 排序兜底）。
- 结果：**240 别名删除（214 骨架行），34 行别名清空仅留名译**；DB aliases_cn 同步 UPDATE 防 export 回潮；yellow_apple['金色苹果']→['黄色苹果'] 样例验证；py 字段联动重算。
- 附带查明：searchTags 的 CJK 子序列宽松匹配（黄苹果 ⊂ 黄金苹果 命中 golden_apple）= 历史设计非 bug，exact 排序已扶正。
