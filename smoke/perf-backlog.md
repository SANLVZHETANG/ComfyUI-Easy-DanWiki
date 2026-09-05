# 性能优化待办备忘（2026-09-05，cp51 基线）

## 已完成（批次一 + 批次二大部，均已验收）
- 词库缓存化/启动不阻塞、图片/字体 max-age、字体懒载、AC 僵尸剪枝、
  正文扫描 300ms 静默期（BODY_IDLE_MS，js:25）
- cp51：langIsZh 缓存进 applyConfig（每查询省 100+ 次 localStorage 读，
  三条 lang 写入路径 #set/导入/重置均收敛于 applyConfig，失效闭环已核实）；
  pysssss 守卫 setInterval(300ms) → MutationObserver（只查 addedNodes，O(新增)）
- cp52：顺手修复验收时抓到的存量 bug——#showPreview 在 250ms 定时器里读
  event.currentTarget（派发结束即被置 null），链接悬停预览从未工作过且每次
  hover 抛 TypeError；改为同步捕获 anchor + isConnected 守卫；destroy() 补
  清 _previewTimer/_previewEl。教训：hover 类功能不在手工测试清单里，验收
  协议应加"面板链接悬停出预览"一项
- 实测：连打单键 ≈5.8ms（原 ~14ms）；索引加载 289ms(缓存)；监听器 47→47 稳定

## 待办 1：Styler 全管线重跑（低优先——窗口使用频率低）
- #set() 对所有键执行 applyConfig+refreshAllInstances+labRefresh(全管线 ~15-22ms)，
  滑条 oninput 每鼠标事件一次；拖 1 秒 ≈ 60 次全管线
- 方案 A：键→影响域分派（css/search/popup/none）+ labRefresh rAF 合并，~40 行
  - css 组：theme, customVars, opacity, width, font, rowH, widthMode, fontFamily
  - search 组：aliasTable, pyMode, pyMinLen, fuzzy, mode, minPost, maxCount
  - popup 组：lang(兼search), showWiki, showSummary, showImage, showLinks,
    panelImg, imgMode, navMode, bracketNav
  - none 组：debug, perf（perf 由 applyConfig 内 syncPerfFromConfig 消费）
- 验收：拖各类滑条 3 秒看 Styler 流畅；改 search/popup 组键后弹层与试验台
  结果仍即时正确；导出/导入/重置正常

## 待办 2：批次三（按需再评估，均有真实风险）
- 词库 gzip / 拆"搜索核心+正文"两文件（远程访问场景收益最大，~80 行，中风险）
- bigram 倒排索引根治每键 5.7ms 字段扫描（~200-300 行，高风险；
  验收：跑分基准 6 词逐项等价 + P50<3ms）
- 25MB JSON.parse 一次性主线程阻塞 ~200ms（根治需 Worker，中风险；热缓存下已无感）

## 待办 3：验收遗留（各一行操作）
- image 404 响应头复测：访问 /dbtags/image?tag=zzz_xyz 看是否仍 no-store
- ?v= 失效链确认：本条 cp51 升版即是活证——首开 Network 里 tags_index.json
  应为全量下载（?v=cp51），其后再次刷新回到 disk cache

## 已知现状备忘
- JS 堆 ~230MB（index+TAG_MAP+_mc+bodyDocs 3-4 倍冗余），倒排索引批次应合并派生结构
- 性能面板样本现为"字段+正文成对"（S5 副作用），近N次统计口径与历史数字不可直接比
- 长任务多为跑分基准自污染（连跑 6词×20遍同步管线），纯打字时应接近 0
- 核实后确认不存在的"伪优化点"：服务端 manifest 已模块级缓存（server:80-89）、
  高亮为字符串切片无 RegExp（js:790）、backdrop-filter 仅 blur(4px)、
  searchTags 配置读取已 per-query 提升
