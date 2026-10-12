# Progress Log

## Session: 2026-10-12（test2 原型：基于交互语法的自主探索环境）

### Phases 12-16: 契约 → 实现 → 验证（明细见 task_plan）
- **Status:** complete
- **Started:** 2026-10-12
- Actions taken:
  - 读取新框架文档；契约锁定 rhine-lab / moderate / dashboard / cool-light-laboratory；决策物＝导入门
  - 以 test/ 为基座复制 test2/（端口 8124），连续实现：
    - import.js 纯函数解析器（表头探测 / 列序自适应 / 无效行按行号报告）
    - store：空数据启动、撤销+重做双栈、选区、视图、探索路径、损失配置 aByType、localStorage 持久化
    - 稳定框架：视图切换（数据/推导/损失）、撤销/重做/清空、探索路径条、混合视图开关（真 checkbox）
    - 动态主体：grid-template-areas 三视图重排（同一 DOM；e2e 验证切换保状态）
    - 对象检查器（对象/动作/状态/反馈 + 关系类型标签）、观测窗框选选区、导入门（阈值+回退）
    - 移除预测—验证（按文档 §13.2）；底部条改为状态反馈 + 探索建议
  - 修复链（见 Error Log）：views 相对导入路径、tray.init 缺失、二进制控件审计、e2e 期望值
  - 验证：check-math 20/20；e2e 51/51（含页面异常兜底）；audit-faction-ui PASS（0 问题）；
    截图 6 张目检（空态/数据+选区/推导/损失/竖屏/灰度）全部通过
- Files created/modified:
  - test2/ 全套（index.html、styles.css、js/{import,data,store,guidance,main}.js、views/*、tools/*、README.md）

## 交付摘要（2026-10-12 · 原型二）

- 交付物：test2/ 下无预设数据的 StatLoom 原型二，覆盖新文档 §13.2 首轮十项功能。
- 运行：`test2/start.bat` 或 `python -m http.server 8124`。
- 验证：e2e 51/51、数学校验 20/20、派系审计 0 问题、灰度与竖屏目检通过。

### Phase 17: 交互逻辑迭代（五项需求）
- **Status:** complete
- **Started:** 2026-10-12（第二批需求）
- Actions taken:
  - 托盘升格为平级视图（数据/托盘/推导/损失）；空数据落托盘、导入后直达数据视图；检查器在所有视图保留
  - 推导次级窗口：步骤从流程卡迁入浮动窗口（buildCardSteps 共享构建），窗口自带步进板与关闭；回到起点自动收起
  - 知识库：抽屉升级为目录+内容两栏（8 卡按类别分组，一句话摘要，自由浏览+锚点定位）
  - 炭黑仪器面：顶栏与底部提示栏通过令牌域覆盖为黑底白字（charcoal，莱茵生命中性色），正文保持冷色浅色
  - 点阵波浪：CSS 点阵打底 + canvas 行进波（低对比、aria-hidden、reduce 静态一帧）；main/path 提升 z-index
  - e2e 更新后 66/66 一次通过；审计 PASS（22 files）；截图 7 张目检（含空态点阵波浪、推导窗口、知识库、托盘视图）
- Files created/modified:
  - test2/js/wave.js、js/views/deriveWindow.js（创建）
  - store.js / formula.js（步骤抽取与窗口状态）/ drawer.js（知识库）/ cards.js（类别）
  - index.html / styles.css / main.js / inspector.js / chart.js / guidance.js / README.md / tools/e2e.mjs

## Session: 2026-10-12（terra-faction-ui 界面重构）

### Phase 8: 派系契约与结构重组
- **Status:** complete
- **Started:** 2026-10-12
- Actions taken:
  - 加载 terra-faction-ui 技能并读取全部无条件参考（元素/布局/交互/控件/运动/证据/前端契约 + 派系档案 + 配色分离矩阵）
  - 用户选定派系：rhine-lab；契约锁定：depth=moderate，task=dashboard，lane=cool-light-laboratory
  - index.html 区域重写：shell / 分析台（观测窗 + 复核台 dock + 容差轨条）/ 样本托盘 / 分析规程 / 处置台
  - 复制 Lucide 图标（flask/microscope/scan-line/scale/atom + ISC LICENSE）并内联为 symbol
  - store：expand → stage（setStage），全仓清理旧 API 引用
- Files created/modified:
  - test/index.html、test/js/store.js、test/js/main.js（重写）

### Phase 9: 视觉系统
- **Status:** complete
- Actions taken:
  - styles.css 全量重写：语义令牌、2px 诊断板 + 测量内嵌线（.btn::after / .instrument::after / 窗格双层框）
  - 控件：预测门开关（黄绿校准方格）、编号步进板（连排 + 内嵌下缘样轨）、卡钳拇指滑条、2px 黄绿焦点环、translate+scale 向内容差
  - 运动：入场校准 560ms×4 交错、步进揭示 280ms、复核门锁定 420ms、焦点样本环呼吸 2.2s（唯一循环）、显式 reduce 全静态
- Files created/modified:
  - test/styles.css（重写）

### Phase 10: 视图重构
- **Status:** complete
- Actions taken:
  - 新 tray.js（样本托盘，原数据表）、新 dock.js（复核台，原统计量面板；容差轨为横贯仪器条）；删除 table.js / statsPanel.js
  - formula.js 校准步进板重写（阶段推进 + 逐级揭示动画）
  - chart.js 呼吸环与例外标记；loss.js / drawer.js / guidance.js 适配新词汇（复核门 armed/locked + 回退按钮）
  - 构图修正：容差轨从复核台移出台面底部横条，仪器:复核台高度比例回到仪器主导
- Files created/modified:
  - test/js/views/tray.js、dock.js（创建）；formula.js（重写）
  - chart.js / loss.js / guidance.js / content/cards.js（修改）
  - 删除 js/views/table.js、js/views/statsPanel.js

### Phase 11: 验证与交付（派系）
- **Status:** complete
- Actions taken:
  - e2e 选择器迁移 + 新增用例（步进板推进/回起、复核门回退），最终 48/48 通过，无页面异常
  - audit-faction-ui.mjs 两轮补齐声明（根属性规范词汇、--control-radius、translate 按压、显式 reduce 块）后 PASS（0 问题）
  - 对比度核算：ink 17.4 / ink2 8.9 / muted 4.7 / 信号墨 6.5 / 例外墨 6.0 / 序列 4.2 与 3.1（均为 vs 窗格）
  - 截图目检 4 张：桌面默认、工作态（r01 选中 + 步进到第 3 步）、480px 竖屏、灰度
  - README 重写；规划文件收尾
- Files created/modified:
  - test/tools/e2e.mjs、shot.mjs（更新）；test/README.md（重写）

## Session: 2026-10-10

### Phase 1: 规划与结构决定
- **Status:** complete
- **Started:** 2026-10-10 21:10
- Actions taken:
  - 读取两份设计文档并整理出《项目框架.md》（上一轮对话完成）
  - 确认环境：Python 3.13.15 / Node v24.16.0 可用；test/ 为空目录
  - 读取 planning-with-files 模板，创建 task_plan.md / findings.md / progress.md
  - 决定技术栈：原生 ES Modules + SVG，零依赖，Python http.server 运行
- Files created/modified:
  - 项目框架.md（本会话前创建）
  - task_plan.md（创建）
  - findings.md（创建）
  - progress.md（创建）

### Phase 2: 数据模型与数学引擎
- **Status:** complete
- **Started:** 2026-10-10 21:12
- Actions taken:
  - 创建 package.json（"type": "module"，供 Node 直接加载 .js 版 ESM）
  - 编写 data.js：内置数据集（讲授式 10 人，含 40 分低位观测；探究式 10 人）
  - 编写 stats.js：纯函数统计引擎（均值/中位数/分位数、分组统计、SS_T/SS_B/SS_W 分解、平方/绝对损失与最优解、IQR 规则提示）
  - 编写 store.js：单一状态源（数据操作记入撤销栈，界面状态独立，订阅通知，损失画布取值口径）
  - 编写并运行 tools/check-math.mjs：20 项校验全部通过
- Files created/modified:
  - test/package.json（创建）
  - test/js/data.js（创建）
  - test/js/stats.js（创建）
  - test/js/store.js（创建）
  - test/tools/check-math.mjs（创建）

### Phase 3: 基础视图联动
- **Status:** complete
- **Started:** 2026-10-10 21:20
- Actions taken:
  - 加载 dataviz 技能：运行配色校验脚本，浅色（#2a78d6/#eb6834）与深色（#3987e5/#d95926）全部检查项 PASS
  - 编写 index.html / styles.css / util.js / guidance.js（操作入口 + 预测流程 + 提示 + 建议）
  - 编写 views/table.js（可编辑数据表，行点击追踪）、views/chart.js（SVG 点图 + IQR 菱形标记 + 悬停提示 + 图例）、views/statsPanel.js（统计量面板 + 来源入口 + 知识卡锚点）
  - 混合分组：第一行显示合并后的数据，原分组行淡色保留对比；撤销栈与恢复原始数据可用
  - 修复：subscribe 首渲染 bug（见 Error Log）；修复 SS 等式换行布局
  - 建立 CDP 端到端脚本 tools/e2e.mjs（无依赖，Node 原生 WebSocket 驱动 Chrome）与截图工具 tools/shot.mjs
- Files created/modified:
  - test/index.html、test/styles.css、test/start.bat（创建）
  - test/js/util.js、test/js/guidance.js、test/js/main.js（创建）
  - test/js/views/table.js、chart.js、statsPanel.js（创建）
  - test/tools/e2e.mjs、test/tools/shot.mjs（创建）

### Phase 4: 公式推导面板与双向追踪
- **Status:** complete
- **Started:** 2026-10-10 21:35
- Actions taken:
  - 编写 views/formula.js：折叠式推导卡（SS_T 三步：偏差→平方→求和；分解卡三步：组均值→SS_B→SS_W）
  - 每步含公式、解释、依据前提、当前数据数值实例、定位按钮、分支入口
  - 双向追踪实测通过：公式项点击 → 数据表 20 个偏差格高亮 + 分布图偏差连线；数据行点击 → 公式实例行 + 图中点高亮
  - 修复混合视图下的 SS_B 统计口径（effectiveRows）与提示关闭重建 bug
  - e2e 全量运行：26 项全部通过（首轮 24/26，修复后 26/26）
- Files created/modified:
  - test/js/views/formula.js（创建）
  - test/js/store.js（effectiveRows、subscribe 修复）
  - test/tools/e2e.mjs（新增 Phase 3/4 用例）

### Phase 5: 损失函数画布
- **Status:** complete
- **Started:** 2026-10-10 21:45
- Actions taken:
  - 编写 views/loss.js：数轴贡献图（线段 = |yᵢ−a|，逐观测行）+ 损失曲线（200 采样点、y 从 0 起）
  - 候选解 a：图上拖动（window 级 pointermove + rAF 节流）、滑条（节点跨渲染复用避免打断拖动）、点按定位
  - 最优解：平方→均值点解；绝对→中位数，偶数样本时绘制整段最优区间带宽（当前数据 n=20 → [79, 80]）
  - "跳到最优解"（吸收 gap）+ 当前损失与最优差距提示；与预测流程、公式面板、知识卡按钮互连
  - e2e 新增 4 项用例（L(60)=9587 实时更新、跳最优、区间带宽、区间中点跳转），首轮 1 项断言是我方算错（[79,82]→实为[79,80]），修正后 32/32 通过
- Files created/modified:
  - test/js/views/loss.js（创建）
  - test/styles.css（损失画布样式）
  - test/tools/e2e.mjs（Phase 5 用例）

### Phase 6: 知识卡片、引导与预测—验证
- **Status:** complete
- **Started:** 2026-10-10 22:00
- Actions taken:
  - 编写 content/cards.js：8 张知识卡（均值/中位数/偏差/平方和分解/组内组间/平方损失/绝对损失/IQR 规则），每张含分层章节（直观解释默认展开）、实时数值实例、关联入口
  - 重写 views/drawer.js：抽屉开合、Esc 关闭、卡内互跳、操作型入口（关闭抽屉后聚焦统计量/滚动到画布）、卡片性质说明
  - 分布图的 IQR 规则提示旁补 📖 入口；卡片实例全部由当前数据实时计算
  - e2e 新增 7 项卡片用例，含"全程无页面异常"兜底（Runtime.exceptionThrown 监听）
- Files created/modified:
  - test/js/content/cards.js（创建）
  - test/js/views/drawer.js（重写）
  - test/js/views/chart.js（📖 入口）
  - test/tools/e2e.mjs（卡片用例 + 异常监听）

### Phase 7: 验证与交付
- **Status:** complete
- **Started:** 2026-10-10 22:10
- Actions taken:
  - 编写 test/README.md：运行方式、三分钟上手、七件事覆盖对照、目录结构、测试命令、已知边界
  - e2e 补两条遗漏用例（增删观测、调整分组）+ 全程 Runtime.exceptionThrown 监听兜底
  - 最终全量验证：check-math 20/20；e2e 44/44（含"全程无页面脚本异常"）；三张截图目检通过
- Files created/modified:
  - test/README.md（创建）
  - test/tools/e2e.mjs（补用例与异常监听）
  - task_plan.md / progress.md / findings.md（收尾更新）

## 交付摘要（2026-10-10）

- 交付物：test/ 下零依赖、可本地运行的 StatLoom 最小原型，覆盖框架七件事，数学链路完整。
- 验证：数学引擎 20 项、端到端 44 项全部通过；无头浏览器三张截图目检通过；全程无页面脚本异常。
- 运行：`test/start.bat` 或 `python -m http.server 8123`（本次会话中服务器已在 8123 端口后台运行）。

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 数学校验 check-math.mjs | node tools/check-math.mjs | 20 项全部通过 | 20 通过，0 失败 | ✓ |
| 语法检查 | node --check 全部 js | 无语法错误 | 全部 OK | ✓ |
| 无头渲染 | chrome --dump-dom | 面板渲染、数值正确 | 20 行数据、77.85/396.05 等正确 | ✓ |
| 端到端交互 e2e（首轮） | node tools/e2e.mjs | — | 24 通过，2 失败（混合 SS_B、提示关闭） | ✗ |
| 端到端交互 e2e（修复后） | node tools/e2e.mjs | 26 项全部通过 | 26 通过，0 失败 | ✓ |
| e2e 含损失画布用例 | node tools/e2e.mjs | 32 项全部通过 | 32 通过，0 失败 | ✓ |
| e2e 含知识卡片用例 | node tools/e2e.mjs | 39 项全部通过 | 39 通过，0 失败 | ✓ |
| e2e 最终全量 | node tools/e2e.mjs | 44 项全部通过 | 44 通过，0 失败，无页面异常 | ✓ |
| 截图目检 | tools/shot.mjs × 3 | 布局/数值符合预期 | 通过（默认态、展开推导、知识卡抽屉） | ✓ |
| 派系重构 e2e（首轮） | node tools/e2e.mjs | 全量通过 | 47/48（e2e 残留 #panel-table 旧选择器） | ✗ |
| 派系重构 e2e（修复后） | node tools/e2e.mjs | 全量通过 | 48/48，无页面异常 | ✓ |
| 派系审计 | audit-faction-ui.mjs test/ | 0 问题 | PASS: 18 files, no issues | ✓ |
| 对比度核算 | WCAG 比值（vs #f8fbf9） | 文本 ≥4.5、图形 ≥3 | 全部达标 | ✓ |
| 截图目检（派系） | shot.mjs × 4 | 桌面/工作态/竖屏/灰度 | 通过（灰度下托盘/步进板/容差轨/胶囊仍可辨认） | ✓ |
| 原型二 check-math（夹具） | node tools/check-math.mjs | 20 项通过 | 20 通过，0 失败 | ✓ |
| 原型二 e2e（首轮） | node tools/e2e.mjs | — | 0/1（导入路径错误 + tray.init 缺失） | ✗ |
| 原型二 e2e（修复后） | node tools/e2e.mjs | 全量通过 | 51/51（含页面异常兜底） | ✓ |
| 原型二派系审计 | audit-faction-ui.mjs test2/ | 0 问题 | PASS: 20 files, no issues | ✓ |
| 原型二截图目检 | shot.mjs × 6 | 空态/数据+选区/推导/损失/竖屏/灰度 | 全部通过（选区联动、检查器动作集、胶囊五格、状态条均如预期） | ✓ |
| 迭代 e2e（五项需求） | node tools/e2e.mjs | 全量通过 | 66/66，一次通过，无页面异常 | ✓ |
| 迭代派系审计 | audit-faction-ui.mjs test2/ | 0 问题 | PASS: 22 files, no issues | ✓ |
| 深底对比度 | WCAG 比值（vs #171c1a） | 文本 ≥4.5 | ink 15.3 / ink2 10.5 / muted 6.4 / 信号 11.5 | ✓ |
| 迭代截图目检 | shot.mjs × 7 | 空态/数据/推导窗口/托盘/知识库/竖屏/灰度 | 全部通过（点阵波浪可见、推导窗口步进板、知识库两栏目录） | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-10-10 21:17 | 首屏完全不渲染且无控制台报错 | 1 | 定位到 store.subscribe 未执行首次渲染，补 fn(state) |
| 2026-10-10 21:40 | 混合分组后 SS_B 未归零 | 1 | 新增 store.effectiveRows()，统计量/公式/预测统一走混合等效口径 |
| 2026-10-10 21:40 | 关闭情境提示不生效（数据表） | 1 | 数据表重建签名并入 hintsDismissed |
| 2026-10-10 21:55 | e2e 断言期望算错（中位区间写成 [79,82]） | 1 | 复核排序后实为 [79,80]，修正断言（引擎输出正确） |
| 2026-10-12 | 重构后 e2e 1 项失败（#panel-table 残留） | 1 | 全仓 grep 旧选择器（e2e/shot/cards 共 3 处）统一迁移到新容器 id |
| 2026-10-12 | shot.mjs 等待条件停留在 .data-row | 1 | 改为 .specimen 并参数化窗口尺寸 |
| 2026-10-12 | test2 首屏不渲染：views 相对导入路径少 ../ | 1 | 全 views grep 修正（inspector/tray 共 7 条导入） |
| 2026-10-12 | test2 TypeError: tray.init is not a function | 1 | 补回 init 导出；CDP 重载收集异常定位 |
| 2026-10-12 | audit 缺二进制控件警告（预测门移除后） | 1 | 混合视图升级为真实 checkbox 开关（面板级配置） |
| 2026-10-12 | e2e 对照行期望值写成 40（实为平方 L(25)=500） | 1 | 复核两目标数值后修正断言 |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 11（complete，莱茵生命界面重构交付完成） |
| Where am I going? | 后续候选：CSV 导入、真人试用记录 |
| What's the goal? | test/ 下可运行的最小原型，覆盖框架七件事并走通一条完整探索路径（已达成） |
| What have I learned? | See findings.md |
| What have I done? | See above |
