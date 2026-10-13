# 待开发方案：缺图 tag 联网取图 + 本地永久缓存（on-demand image cache）

> 状态：**待拍板，未开工**（2026-10-06 立项记录）。
> 一句话：卡片 hover 遇缺图 → 后端联网抓一张代表图 → 永久落盘缓存 → 此后该 tag 全本地秒开，永不联网。

## 1. 现状事实（已勘查）
- 索引 `images` 覆盖：角色 12,176/36,128（1/3）、通用 9,758/30,442、meta 75/539——**2/3 数据层就没图**。
- 图包（`dataset/manifest.json + tag_images*/`）**E: 部署位在位**（2026-10-06 复核:manifest 22,007 条 + small 20,705 + large 20,727 文件实存,10-04 合并版含 char 12,176）。初稿曾误判「E: 部署目录未放」——根因=ls 插件根目录后 grep 关键词匹配不到 dataset 目录名,已更正并在 CHANGELOG 记教训。
- `dbtags_server.py` 已有 `GET /dbtags/image`（FileResponse + BASE 路径白名单守卫），**无任何联网代码**。
- 前端只请求本地路由，404 → 隐藏图片区。
- 结论："没图"**只剩一层=数据层缺口**（2/3 tag 当年爬图未覆盖,如 hilbert_(pokemon);有图字段者本地即命中）→ 本方案对象=数据缺口 2/3 + 未来新增 tag 的图空白。

## 2. 方案 A：按需懒抓（推荐主路径）
```
/dbtags/image 本地命中(图包 ∪ img_cache) → 秒回
  ↘ 404 且开关开 → 前端后台触发 GET /dbtags/fetch?tag=xxx
    → 后端 danbooru API:
      /posts.json?tags=<tag>&limit=1&status=active&sort=fav_count
                 &only=id,preview_file_url,large_file_url
    → 下载存 <BASE>/img_cache/<sha1(tag)>.small.jpg（可选 .large.jpg）
    → 记 img_cache/manifest.json（tag → {small,large}）
    → 前端回填 <img src="/dbtags/image?...">（此时本地命中）
下次同一 tag → 纯本地，永不联网。
```
关键设计点：
1. **联网只在后端**（浏览器直连 donmai.us 有 CORS；aiohttp 代理可管限速/缓存/失败）。
2. **队列与去重**：全局 asyncio 队列 + in-flight 集合（同 tag 并发只发一次）；匿名 API ≈2 req/s；可选配 `danbooru user+api_key` 提速。
3. **负缓存**：查无结果 → `img_cache/negative.json`（含时间戳，如 30 天过期重查自愈）——无图 tag 不再重复打网络。
4. **防竞态**：临时文件 + `os.replace` 原子改名；manifest 读改写单事件循环串行。
5. **`/dbtags/image` 增强**：图包 manifest 未命中再查 `img_cache/manifest.json`（img_cache 在 BASE 内，守卫零改动）。
6. **前端**：404 触发通道 + 占位转圈 + 完成换图；新设置 `onDemandImg = off | small | small+large`。
7. **可观测**：`/dbtags/status` 报 cache 条数/总字节，进设置面板数据提示行。
8. **发版**：server 改动 → 验收需**重启一次 ComfyUI**；js 动 → ASSET_V bump + VERSION→v0.4.7；**DATA_V 不动**（索引零变化）。
9. **`_load_manifest` 进程级单例老坑**：运行时缓存图不能走该单例——img_cache 用独立 manifest + 实时查（或短 TTL）。

## 3. 方案 B：离线批量预抓（可选补充，与 A 不互斥）
- `tools/fetch_missing_images.py` 夜间铺底：≈24k small × ~30KB ≈ **700MB**，输出图包同款布局并入 Release；匿名 ≈8h，账号提速。
- 定位：给"零运行时联网"用户一次铺底；A 管长尾+增量。遵守长跑铁律（Start-Process 脱离进程树等）。

## 4. 待拍板决策点
1. 范围：仅 A？还是 A+B？
2. 缓存目录：`<BASE>/img_cache/`（推荐）vs ComfyUI output 子目录（需双根白名单，易被批量清理误伤）。
3. 懒抓默认档位：small（省流量）/ small+large（~0.5-1.5MB/张，大图档也永不联网）。
4. Danbooru 账号（user+api_key）有无？无也成立，2 req/s。
5. `onDemandImg` 默认开（small）还是关？
6. 一期是否做磁盘上限（maxMB+LRU）或先按使用生长。

## 5. 实施清单
1. server：img_cache manifest 读写 + 原子写 + 负缓存。
2. server：danbooru 客户端（UA/超时/重试一次/凭据）+ 抓取队列 + in-flight 去重。
3. server：`GET /dbtags/fetch` 路由；`/dbtags/image` 合查缓存 manifest。
4. js：404→fetch 触发通道、占位/转圈、完成回填；`SETTING_DEFS.onDemandImg` + comboRow。
5. js：`/dbtags/status` 消费 cache 统计进设置数据提示。
6. VERSION→v0.4.7 + ASSET_V bump；`node --check` + `py_compile`。
7. 验收单：缺图 tag 首 hover 出图 / 二次断网复测纯本地 / 连滑去重 / 负缓存 tag 不复网 / cache 统计正确 / 重启 ComfyUI 全绿。
8. agent-memory 记账 + E: 同步 + commit/tag v0.4.7（**未推，等"推"字**）。
9. （若拍板 B）`tools/fetch_missing_images.py` 长跑批。

## 6. 风险与边界
- **外网可达性（方案成立前提）**：donmai.us 可能被 CF 403/墙 → 开工前一次性 curl 探测部署环境；fetch 带 UA+超时重试，失败静默降级保持"无图"现状，debug 计数可查。
- **图源合规**：`status=active` 过滤删除/禁止帖；只取 preview/large（sample），不取 original。
- **磁盘增长**：懒抓按使用生长（通常数百张量级），不失控。
- **tag 更名/大小写**：缓存键=索引 `name` 经 `normName`；负缓存过期自愈。
- **打包污染**：`make_release.py` 出包规则排除 `img_cache/`（运行时数据不进 Release）。

## 7. 文件坐标
- `dbtags_server.py`：BASE 解析 :34-48、`/dbtags/image` :160 起、`/dbtags/status` :136 起。
- js：图片 URL 组装 :1240/:2668、HUD 大图 :1524、`SETTING_DEFS` :1917 区、设置 comboRow 区 :3458 附近。
- 索引：`web/js/data/*.json` 的 `images` 字段（相对 BASE 的 `tag_images/…`）。
- 图源 store（构建期已有）：`todo\sub-ComfyUI-Easy-DanWiki-爬图像\`（manifest 22,007）。
