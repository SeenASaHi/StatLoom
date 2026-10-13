# Task Plan: StatLoom 最小原型（test3/ · V1.0 数学对象驱动）

## Goal
按 test3/docs 四份设计文档实现最小原型：TypeScript + Vite + Vitest 纯函数数学内核 + statloom-ui 三窗口界面。完成标准＝五项开发准入门槛（设计文档 §12.1）与验收矩阵（§12）逐项有测试支撑，e2e 在浏览器中走通核心路径。

## Specs（规范来源；实现与本计划冲突时以规范为准）
- `test3/docs/2026-10-13-原型设计.md`（v1.2）
- `test3/docs/AST操作集规范.md`
- `test3/docs/统一依赖图规范.md`
- `test3/docs/状态与事务规范.md`
- 视觉：statloom-ui skill；本项目唯一偏离 `--win: rgba(255,255,255,.72)` + `blur:12px`，L2 读数面保持不透明

## Next Step
全部阶段完成。交付审阅：三份规范 + README + `.shots/` 截图；后续轮候选见设计文档 §16（F06 动画层、F01 高级导入、F09 候选引擎）。

## Current Phase
Phase 5（complete）· 原型交付就绪

## Phases

### Phase 0: 脚手架与契约类型
- [x] package.json / tsconfig.json / vite.config.ts（含 Vitest 配置）/ index.html 骨架 / app.ts 占位
- [x] src/kernel/types.ts：全部冻结类型（SourceState / Dataset / Group / Observation / VariableMeta；Status / ObjectReason / DerivedObject；Expr / Scope / RoleName；容差；Command / CommandResult / Result / PreviewState）
- [x] `npm install` 完成；`npm test` 可运行；`tsc --noEmit` 通过
- **Status:** complete

### Phase 1: 内核Ⅰ — AST 与单对象求值
- [x] expressions.ts：11 节点 AST 类型；求值器（值/引用双模式）；作用域解析（稳定序＝源数组序）；10 角色解析表；11 条定义数据（defId → 模板 + class + 自由变量）
- [x] expressions.ts：`instantiateAll(source) → Map<id, Draft>`；inputs 由模板引用遍历推导（refs ∪ scopeMembers），无手工字段
- [x] compute.ts：`evaluateDraft`（传播 error>invalid>undefined、空作用域 sum/mean=undefined、count=0、结果有限性检查）；`TOLERANCE`（atol=rtol=1e-9）；`identityThreshold`；`formatResidual`；finalize（version 递增规则 + inputsRevision 落定）
- [x] fixtures.ts：BENCHMARK 源状态构造器（A=[4,5,6] B=[7,8,9]）
- [x] tests/kernel.test.ts：参考值 6.5/5/8、SS_W=4、SS_B=13.5、SS_T=17.5、残差精确 0（1e-9）；边界矩阵（空数据集/空组/单点组/全同值/仅一个非空组）；黄金 AST 快照；sst 依赖集合测试（含观测+mean:grand，不含 ssw/ssb）
- **Status:** complete （20/20 通过；实现期修正：静态引用无条件计入输入与 `sst` 空数据集下的状态传播）

### Phase 2: 内核Ⅱ — 图与重建
- [x] graph.ts：拓扑序（Kahn）、环检测（KernelCycleError）、消费者索引、`affectedFrom(changedSourceIds)`、`audit()` 三项（stale/pending/nonFinite）
- [x] rebuild.ts：drafts → 拓扑序 → 签名匹配复用 prev 实例 / 否则求值 → audit 空断言（非空抛内核错误）→ `Result{source, objects, changedObjectIds}`；"增量 vs 全量"＝prev 参数有无（唯一实现）
- [x] deepEqualSource（no-op 判定，显式字段比较）
- [x] tests/graph.test.ts：精确受影响集合两例（改值→总体均值变 / 换组→总体均值不变而组均值变；含 B 组 gdev 链受影响、B 组 dev 链不受影响）；五不变（引用相等/值/签名/源版本）；实例化差异（增删观测、删空组）；构造环→抛错；rebuild 后 audit 空
- **Status:** complete （graph 15/15；精确受影响集合＝17 对象断言通过）

### Phase 3: 内核Ⅲ — 历史、序列化、事务
- [x] history.ts：快照栈 + 指针 + cap 200 + 新提交截断 redo
- [x] schema.ts：`serializeSource` / `parseSource`（①结构②引用：id 唯一、groupId 存在、bindings 存在、value 有限、idCounter > max、组名规范化非空）
- [x] state/store.ts + state/commands.ts：完整管线（校验→候选源→rebuild→audit→原子换入→历史→单次通知）；拒绝种类枚举；no-op；预览 begin/update/commit/cancel + 锁定范围（仅数学状态命令）
- [x] tests/history.test.ts：undo/redo 往返一致；快照序列化→重建→校验；悬空引用/损坏结构/未知 schemaVersion 拒绝；导入失败零副作用
- [x] tests/commands.test.ts：no-op(rejected)；拒绝零副作用（引用都相同）；预览事务（单一 PreviewResult 身份 / 取消零残留 / 纯 UI 操作不受限 / 数学命令 preview-locked）；一命令一历史；版本一次递增
- [x] tests/properties.test.ts（fast-check）：整体平移；组内平移；置换（容差比较）；恒等式；依赖传播（重算集合==受影响集合）；增量 ≡ 全量（随机操作序列 + audit 空）
- [x] tests/purity.test.ts：kernel 层界扫描（无 kernel 外 import、无浏览器全局、无第三方包）
- [x] 变异演练：黄金 AST 与依赖集合测试在 `sst := add(ssw,ssb)` 变异注册表下确实失败
- **Status:** complete （全套 81/81；实现期修正见 Errors：idCounter 语义、不变量 A 比对范围、删除观测的并集可达性）

### Phase 4A: 视图（statloom-ui 结构层）
- [x] 读 statloom-ui 参考：typography / ambient-cloud / motion / frontend-contract + assets/starter
- [x] tokens.css（含 .72 偏离 + 次级文字 ≥#4A4A4A）/ app.css / index.html 完整布局（56px 导轨 + 三窗口 + L2 读数条 + L3 标注）
- [x] views/formula.ts（KaTeX 三模式：definition/instance/diagnostic；失败降级纯文本）
- [x] views/scale.ts + tests/scale.test.ts（统一比例尺；面积=偏差²×s²；超界裁切标记）
- [x] views/canvas-view.ts（分行点阵/总均值实线/组均值虚线/偏差线段/平方块开关/分解条；拖动改值+跨行换组；键盘 ←→/Shift/Enter/Esc）
- [x] views/readings.ts（四项 + 残差显示算法 + aria-live 播报）
- [x] views/inspector-view.ts（类型/状态+理由/定义与实例/当前值/输入来源+版本/下游+Representation/操作按钮）
- [x] views/relation-view.ts（最长路径分层；观测级折叠仅显示；多入边；键盘 Tab/Enter/Space；边类型过滤；布局含义注记）
- [x] views/app.ts 装配 + 选中联动 + 撤销/重做快捷键
- **Status:** complete （截图目检通过；实现期修正见 Errors：SVG 破出、焦点 SVG 判定、平方块默认关、e2e 视口/动效时序）

### Phase 4B: 环境层与动效
- [x] views/ambient.ts（L0 点云：簇=组、波浪=数据变化、光带=当前对象；document.hidden/resize/DPR≤2；空态匀速扫描）
- [x] 入场动效 cubic-bezier(1,0,.7,1) 600–1000ms；reduced-motion → 150ms 淡入、静态一帧
- **Status:** complete

### Phase 5: 端到端与验收
- [x] tools/e2e.mjs（CDP 沿用 test/tools 模式；固定 1440×900 + 独立 900×1200；载入基准→拖动→读数同帧→撤销/重做→关系图联动→纯键盘改值→Esc 取消预览→reduced-motion）
- [x] tools/shot.mjs（两视口截图 + 灰度）
- [x] statloom-ui audit 脚本通过（0 FAIL；WARN=示意标注，已用窗内注记如实说明）；三条不变量目检；灰度检查
- [x] `npm test` 全绿（86）+ `tsc --noEmit` + `npm run build`
- [x] README.md（契约 + 三分钟上手 + 运行说明）；planning 文件收尾
- **Status:** complete （e2e 36/36）

## Decisions
| # | 决策 | 依据 |
|---|---|---|
| 1 | 派生对象携带 version：value/status/reason 变化才递增；重算结果不变不递增 | 复用判定需要"结果未变的中间对象"不误伤下游（已补进《统一依赖图规范》§3 与设计文档 §4.3） |
| 2 | "增量"与"全量重建"共用唯一 rebuild；复用 = 签名匹配则引用同一实例 | 《统一依赖图规范》§4 唯一实现要求；五不变之身份不变量 |
| 3 | 悬空引用快照的测试载体为 groupId/bindings/idCounter（源状态不含对观测 id 的反向引用） | 与审查用例等价的实现形式，记入 findings |
| 4 | KaTeX 渲染在 views/formula.ts；kernel 零第三方依赖 | 设计文档 §2/§3；purity.test 强制 |
| 5 | 执行方式：inline（本会话直接实现），内核契约密集不宜跨 subagent 交接 | 用户指示"开始制作"；如需 subagent 分任务模式可随时切换 |

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| tsc：`SEVERITY` 缺 `valid` 键（Record<Status,…>） | 1 | 补 `valid: 0`（传播时 valid 不可能是 worst） |
| 测试期望 `['ssb','ssw','sst']` 与实现字典序不符 | 1 | 实现正确（`'sst' < 'ssw'`），改为 `['ssb','sst','ssw']` |
| 快照往返被 schema 拒绝：`idCounter` 语义冲突（fixtures/命令写成"已分配末号"，规范为"下一个待分配号"） | 1 | 统一为规范语义：fixtures 基准 7 / 空 1；命令改为先分配后递增 |
| 不变量 A 比对 `inputsRevision` 完整映射失败 | 1 | 版本值是路径相关的；按规范只比输入集合键 + ruleVersion |
| 依赖传播性质测试：删除观测后 `count:grp-1` 重算但不在可达集 | 1 | 并图按**边**并（保留旧边），非按节点覆盖；已注释说明 |
| SVG 被 HTML 解析器"破出"：`<sub>` 触发外来内容退出，后续自闭合节点全部解析错误（数据点未绘成图形，文本断言假绿） | 1 | 改用 `<tspan baseline-shift="sub">`；findings 记录 SVG 字符串生成禁用 HTML 破出名单标签 |
| 焦点恢复 `instanceof HTMLElement` 漏掉 SVG 元素 → 重渲染丢焦，Enter 提交失效 | 1 | 判定与恢复同时覆盖 `SVGElement` |
| 视觉检查：平方块全裁切噪声大 | 1 | 默认关（回写设计文档）、lane 66→96、点半径 5.5→6.5；映射与裁切标记不变 |
| e2e 视口未设（758×482）+ 入场动效未结束 → 按压命中漂移 | 1 | 固定 `--window-size=1440,900` + 等待动效；画布装饰层 `pointer-events:none` |

## Resources
- 设计文档 ×4：`test3/docs/`
- 旧原型参考（CDP e2e 模式、截图工具）：`test/tools/e2e.mjs`、`test/tools/shot.mjs`、`test/tools/check-math.mjs`
- statloom-ui skill：`C:\Users\HazeSeas\.claude\skills\statloom-ui\`（audit 脚本：`scripts/audit-statloom-ui.mjs`）
- 基准案例：A=[4,5,6] B=[7,8,9] → 均值 6.5/5/8，SS_W=4，SS_B=13.5，SS_T=17.5
