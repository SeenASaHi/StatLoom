# Task Plan: StatLoom 最小原型（test/）

## Goal
在 test/ 下实现数学链路完整、可直接运行的最小原型：可编辑数据集、分组分布视图、实时统计量、可展开/可分支/可反向追踪的公式推导面板、可切换损失函数画布、知识卡片、可选预测—验证机制，走通"从数据现象出发→操作发现变化→追踪数学原因→自主转向新问题"一条完整探索路径。

## Next Step
本轮收敛：五项交互需求已全部落地并通过验证。后续候选：分析分支、统计推断入门、概念网络、CSV 列映射界面。

## Current Phase
Phase 17（complete）

## Phases

### Phase 1: 规划与结构决定
- [x] 读取两份设计文档与《项目框架.md》，提取原型范围（已在整理框架阶段完成）
- [x] 确认技术栈与目录结构（记录于 Decisions）
- [x] 创建 task_plan.md / findings.md / progress.md
- **Status:** complete

### Phase 2: 数据模型与数学引擎
- [x] test/js/stats.js：纯函数统计引擎（均值、中位数、组统计、SS_T/SS_B/SS_W、平方/绝对损失、最优解、IQR 规则提示）
- [x] test/js/store.js + data.js：数据集模型、编辑操作（改值/换组/增删/混合分组）、快照撤销栈、订阅通知
- [x] Node 校验脚本（tools/check-math.mjs）验证 SS 分解恒等式与损失最优解（20 项全部通过）
- **Status:** complete

### Phase 3: 基础视图联动
- [x] 写图表代码前加载 dataviz 技能，确定配色与图形规范（配色校验浅色/深色全部 PASS）
- [x] 可编辑数据表（改分数、切换组、增删行，行与图中点互相定位）
- [x] 分组分布图（SVG 点图、组均值线、样本量、IQR 规则异常提示且注明依据）
- [x] 实时统计量面板（n、均值、SS_T/SS_B/SS_W 与分解关系，附来源入口）
- [x] 混合分组操作 + 混合前后对比 + 撤销/恢复原始数据
- **Status:** complete

### Phase 4: 公式推导面板与双向追踪
- [x] 折叠式推导步骤（公式、简短解释、依据/前提、当前数据数值实例）
- [x] 分支节点（连接到损失画布与相关知识卡）
- [x] 双向追踪：公式项 ↔ 数据表行 / 分布图点 双向定位高亮
- **Status:** complete （交付物见 test/js/views/formula.js；e2e 已验证）

### Phase 5: 损失函数画布
- [x] 平方/绝对损失曲线、可拖动候选解 a、损失值实时显示
- [x] 最优解标记与"跳到最优解"操作（平方→均值、绝对→中位数）
- [x] 偶数样本绝对损失最优区间提示；与推导面板、知识卡互连
- **Status:** complete （e2e 已验证：L(60)=9587 实时更新、跳最优、区间 [79,80] + 带宽）

### Phase 6: 知识卡片、引导与预测—验证
- [x] 嵌入式知识卡片（定义/直观/依据/条件/误解/关联，分层展开，锚点定位）
- [x] 情境提示 + 可选探索建议（与当前对象相关、可忽略可关闭）
- [x] 预测—验证（可选、可跳过、只呈现差异不评分、差异可进入追踪）
- **Status:** complete （8 张卡 + 抽屉 + 卡内互跳；e2e 39/39）

### Phase 7: 验证与交付
- [x] Node 语法检查全部 JS + 数学引擎测试通过（check-math 20/20）
- [x] 本地服务器启动 + 无头浏览器截图/DUMP DOM 检查（三张截图逐一目检）
- [x] 六阶段场景由 e2e 全链路覆盖（观察→修改/混合→追踪→展开推导→损失画布→知识卡）；"初学者能否上手"类标准需真人试用，记入 README 边界
- [x] test/README.md 使用说明与 start.bat
- **Status:** complete （e2e 44/44，含页面异常兜底检查）

### Phase 17: 交互逻辑迭代（用户五项需求，test2）
- [x] 样本托盘与「数据/推导/损失」平级：视图栏四块；托盘视图 = 托盘 + 检查器；空数据默认落托盘（导入门）；导入后直达数据视图
- [x] 推导次级窗口：规程卡只留起点与步进板；浮动推导窗（#derive-window）展示步骤，自带步进板、可关闭、Esc 关闭、回到起点自动收起；「关闭不丢阶段」写入窗口说明
- [x] 知识库窗口：「目录 + 内容」两栏（统计概念 6 卡 / 分析目标 2 卡，含一句话摘要），可自由浏览与切换；锚点定位保留
- [x] 顶栏与底部提示栏黑底白字：charcoal 仪器面（令牌域覆盖，控件自动适配）；正文保持冷色浅色；对比度 ink 15.3 / ink2 10.5 / muted 6.4 / 信号 11.5（vs #171c1a）
- [x] 点阵网格背景 + 点阵波浪：CSS 24px 点阵打底 + canvas 行进波（周期约 7s、低对比、aria-hidden、只画高亮带），reduce 时静态一帧；内容区 z-index 提高到画布之上
- [x] e2e 66/66（新增托盘视图/推导窗口/知识库/仪器面用例）；audit-faction-ui PASS（22 files, 0 issues）；截图 7 张目检通过；README 更新
- **Status:** complete

### Phase 12: 新文档解读与契约（test2 原型）
- [x] 读取《StatLoom 项目框架：基于交互语法的自主统计学探索环境》（§4 交互语法、§5 稳定框架+动态主体、§6.3 关系类型、§13.2 首轮十项、预测—验证移出必需）
- [x] 契约锁定：rhine-lab / high / moderate / dashboard / cool-light-laboratory；决策物＝导入门（阈值+回退）
- [x] 复制 test/ → test2/ 脚手架（改 package 名与端口 8124）
- **Status:** complete

### Phase 13: 数据入口与状态核心（test2）
- [x] 空数据启动：import.js 纯函数解析器（粘贴 / .csv/.txt 文件 / 手动登记；表头探测；无效行按行号拦截）
- [x] store：撤销 + 重做双栈、选区、视图、探索路径、损失配置记忆 aByType、数据集名与列名、导入操作、状态反馈、localStorage 持久化
- [x] 移除预测—验证；操作直接应用并留状态反馈
- **Status:** complete

### Phase 14: 稳定框架与任务视图（test2）
- [x] 稳定框架：视图切换（数据/推导/损失连排诊断板）、撤销/重做/清空、探索路径条、混合视图开关（面板级二元配置）
- [x] 动态主体：CSS grid-template-areas 三视图重排（同一 DOM；e2e 验证切换保状态）
- [x] 对象检查器：选中对象类型 / 真实数值 / 可执行动作（带关系标签）/ 描述性观察；选区读数
- [x] 选区：观测窗拖动框选（预览层直更属性、提交后托盘+检查器联动、Escape/点击背景清除）
- **Status:** complete

### Phase 15: 交互语法细节（test2）
- [x] 关系类型标签：分支与检查器动作标注（依赖 / 组成 / 定义 / 推导 / 概念 / 映射）
- [x] 控件状态：导入门阈值无效态（红色计数+禁用提交）、数值编辑无效态、禁用/焦点态
- [x] 提示与建议适配空态与导入后情境；底部条为"状态反馈（可撤销/重做）+ 探索建议"
- **Status:** complete

### Phase 16: 验证与交付（test2）
- [x] check-math 适配本地夹具（20/20）；e2e 重写 51/51（空态→导入门→编辑→撤销/重做→框选→视图切换→步进→追踪→损失配置→知识卡→清空恢复；含页面异常兜底）
- [x] audit-faction-ui 审计 PASS（0 问题；修复：二进制控件→混合视图开关）；截图 6 张（空态/数据+选区/推导/损失/竖屏/灰度）目检通过
- [x] test2/README.md；规划文件收尾
- **Status:** complete

### Phase 8: 派系契约与结构重组（terra-faction-ui）
- [x] 锁定契约：faction=rhine-lab / confidence=high / depth=moderate / task=dashboard / lane=cool-light-laboratory
- [x] index.html 区域重写：顶栏 shell、分析台（观测窗 + 复核台 + 容差轨）、样本托盘、分析规程、处置台
- [x] 复制 Lucide 图标（含 ISC LICENSE）到 test/assets/icons/，以内联 symbol 使用
- [x] store：expand 状态改为校准步进的 stage 状态（setStage），guidance/cards 同步更新
- **Status:** complete

### Phase 9: 视觉系统（样式重写 + 运动语法）
- [x] styles.css 全量重写：语义令牌（field/pane/well/ink/rule/signal/attention/critical）、2px 诊断板 + 内嵌测量线、托盘/复核台/规程/处置台几何、--control-radius 令牌
- [x] 控件族：保持开关的预测门（黄绿内嵌方格）、编号诊断板步进、卡钳拇指滑条（input[type=range]）、焦点环 2px、translate+scale 向内容差按压
- [x] 运动：入场窗格校准（一组，nth-child 交错 ≤4）、选中内嵌缘 160–280ms、复核门锁定 420ms、焦点样本环呼吸 2.2s（唯一循环）、显式 prefers-reduced-motion: reduce 静态回退
- **Status:** complete

### Phase 10: 视图重构
- [x] tray.js（样本托盘：芯片、组切换、值编辑、偏差读数、移除、登记新样本、键盘可达）
- [x] dock.js（复核台：溯源胶囊、诊断读数、分组读数；容差轨独立成横贯仪器条）
- [x] formula.js（校准步进板取代布尔折叠；步骤保持可追踪与双向联动）
- [x] chart.js / loss.js / drawer.js / guidance.js 重制（呼吸环、复核门 armed/locked 态与回退按钮；交互逻辑与数据编码全部保留）
- **Status:** complete

### Phase 11: 验证与交付（派系）
- [x] 语法检查 + check-math 保持 20/20 + e2e 更新选择器后 48/48（含页面异常兜底）
- [x] audit-faction-ui.mjs 审计：PASS，0 问题（声明式根属性 + 控制半径令牌 + 方向性按压 + 显式减动效块逐项补齐）；对比度核算：全部达标
- [x] 截图目检：桌面默认态、工作态（选中 + 步进推进）、480px 竖屏重组、灰度辨认测试通过
- [x] README 更新（派系演绎说明、光色基调、结构变更、审计命令）
- **Status:** complete

### Phase 7: 验证与交付
- [ ] Node 语法检查全部 JS + 数学引擎测试通过
- [ ] 本地服务器启动 + 无头浏览器截图/DUMP DOM 检查
- [ ] 按框架的六条验证标准走查六阶段场景
- [ ] test/README.md 使用说明与 start.bat
- **Status:** pending

## Key Questions
1. 混合分组后如何保留"混合前"用于比较？→ 方案：混合时保留原始分布幽灵叠影 + 数值前后对照
2. 追踪粒度做到哪一级？→ 先做"观测值 ↔ 偏差项/平方项"与"组 ↔ 组间项"两级；纯符号级（下标、求和号）以步骤说明呈现
3. 预测—验证的输入形式？→ 方向选择（↑/↓/不变）与选择题（如"最优解对应哪个统计量"），不用统一文本框

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 技术栈：原生 ES Modules + SVG，零依赖、零构建 | 最小原型以验证交互语言为核心；python -m http.server 即可运行，无需 npm install |
| 视图与数学解耦：stats.js 为纯函数引擎，视图只做展示 | 对应设计原则"数学语义、计算逻辑与可视化实现相互解耦"（框架第 8 条） |
| 快照式撤销栈（撤销 + 一键恢复原始数据） | 对应"操作可随时撤销或返回原始状态" |
| 内置示例数据（教学方式×考试成绩，来自验证场景） | 暂不做 CSV 导入，列为首要扩展点 |
| UI 全中文，界面语言遵循设计文档用语 | 目标用户与文档语言一致 |
| 预测不判对错：只呈现"预测 vs 实际"的差异 | 对应红线"预测—验证不做成评分" |
| 界面语言：莱茵生命（terra-faction-ui，原创演绎） | 数据=样本、分析=实验、损失对比=模型检验，语义归属莱茵生命（实验/样本/核准） |
| 固定冷色浅色基调，不再跟随系统深色 | 派系配色分离矩阵要求保持 cool-light-laboratory 固定光色基调 |
| 数据序列色保留已校验的蓝/橙，与派系信号（黄绿=进行中，琥珀=例外）分工 | 数据编码与界面信号是两个语义域；序列色已通过 CVD 校验 |
| 布局按派系档案重组：仪器主台 + 样本托盘 + 边缘复核台 | layout-grammar 固定空间档案，禁止通用三栏壳 |
| test2 沿用零依赖 ES Modules + SVG（不用 React/D3/KaTeX） | 文档 §11.2 为"可采用"建议；最小原型验证交互语法，解耦架构一致；生产化再迁技术栈 |
| test2 无预设数据：空态启动，导入门为第一入口 | 用户明示"不要有预设数据"；文档 §13.2 第 1 条"用户数据导入与编辑" |
| test2 移除预测—验证 | 文档 §13.2 明示"不将预测—验证任务作为原型的必需模块" |
| 视图切换用 CSS grid-template-areas 重排（同一 DOM） | 面板节点与监听器保持存活，切换不丢状态、不重建（§5.2 布局变化不丢对象身份） |
| 撤销 + 重做双栈；导入/编辑/分组/重置均记入 | 文档 §7.3 明确要求可恢复性 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 首屏完全不渲染（无报错） | 1 | store.subscribe 未在订阅时立即执行一次渲染 → subscribe 内补 fn(state) |
| 混合分组后 SS_B 未归零 | 1 | 统计口径未等效化 → 新增 store.effectiveRows()，统计量/公式/预测快照统一走它 |
| 关闭情境提示后提示仍在（数据表） | 1 | 数据表仅在行签名变化时重建 → 签名并入 hintsDismissed 状态 |
| e2e 断言期望算错（中位区间写成 [79,82]） | 1 | 复核排序后实为 [79,80]，修正断言（引擎输出正确） |
| 重构后 e2e/shot 残留旧选择器（#panel-table / .data-row） | 1 | grep 全仓统一迁移到新容器（#specimen-tray / .specimen） |
| audit 警告 9 条（缺声明式标记） | 2 | 补充规范根属性、--control-radius、translate 按压、显式 reduce 块 → PASS |
| test2 首屏不渲染（views 相对导入路径少 ../） | 1 | grep 全 views 修正 inspector/tray 的导入路径 |
| tray.init 缺失导致 main 装配中断 | 1 | 补回 init 导出；用 CDP 重载收集异常定位 |
| audit 缺二进制控件警告 | 1 | 混合视图升级为真实 <input type=checkbox> 开关（面板级配置） |
| e2e 对照行期望值写成 40（实为平方 L(25)=500） | 1 | 复核两目标数值后修正断言 |
| cards.js 元数据补丁漏匹配未加引号的键 | 1 | 补一轮正则处理 mean/median/dev |

## Notes
- Update phase status as you progress: pending → in_progress → complete
- Re-read this plan before major decisions (attention manipulation)
- Log ALL errors - they help avoid repetition
- 每完成一个阶段，同步更新 findings.md（发现）与 progress.md（日志）
