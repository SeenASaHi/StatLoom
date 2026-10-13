# Findings & Decisions（test3 原型轮）

## Requirements（来源）
- 四份设计文档为唯一规范来源：`docs/2026-10-13-原型设计.md`（v1.2）、`docs/AST操作集规范.md`、`docs/统一依赖图规范.md`、`docs/状态与事务规范.md`。
- 五项开发准入门槛（设计文档 §12.1）：数学语义唯一 / 依赖闭合 / 状态事务可靠 / 追溯双向成立 / 测试能发现错误。
- 视觉契约：statloom-ui（dark / system 层级 / 变异分解信号）；唯一偏离＝`--win .72` + `blur 12px`，L2 读数面不透明。

## Research Findings
- 环境：Node v24.16.0；npm registry 可达（PING 1033ms）；工作区**不是 git 仓库**（无 commit 步骤，计划中的 commit 以文件快照替代）。Windows 11 / Git Bash。
- 旧原型（test/、test2/）为零依赖 vanilla 实现，已被本轮 TS+Vite 取代；但其 CDP 端到端模式（驱动本机 Chrome/Edge，44 项断言）与截图工具可直接移植参考。
- 已知的关键数学事实：SS_T ≡ SS_W + SS_B 是代数恒等式 ⇒ 恒等式护栏必须是结构判定（黄金 AST＋依赖集合＋变异演练），数值测试不可行（已论证，见《AST操作集规范》§7）。
- 浮点细节：kahan 不需要；置换不变性测试用容差比较（累加次序影响末位）。

## Technical Decisions
| 决策 | 理由 |
|---|---|
| 派生对象 version 在其 value/status/reason 变化时递增（源对象见 §4.3） | 复用判定：输入版本未变的实例可跳过求值；"结果未变的中间对象"不应误伤下游签名 |
| 单一代 rebuild（prev 参数决定增量程度），受影响集合是"未复用对象集合"的观测结果 | 规范 §4 禁止第二套遍历逻辑 |
| KaTeX 在 views 层 | kernel 零第三方依赖（purity 测试强制） |
| 快照仅源状态；悬空引用测试载体为 groupId / bindings / idCounter | 源状态不含对观测 id 的反向引用；测试精神（解析成功 ≠ 导入成功）不变 |
| 空态启动 + 一键载入基准案例 | 用户 2026-10-13 决策（延续 test2 轮"不预设数据"） |

## Issues Encountered
| Issue | Resolution |
|---|---|
| **SVG 被 HTML 解析器"破出"**：组均值标签中的 `<sub>` 属于外来内容的破出标签，其后整个 SVG 退回 HTML 解析，自闭合 `<circle/>` 变成吞并后续节点的未知元素——数据点根本没有绘成图形（文本/DOM 断言全绿但几何是坏的） | 改为 SVG 合法 `<tspan baseline-shift="sub">`；教训：SVG 字符串生成禁用 HTML 破出名单标签（sub/sup/b/i/span/div…） |
| 焦点恢复用 `instanceof HTMLElement` 判定 → SVG 元素被漏掉，重渲染后键盘焦点丢失（方向键预览后 Enter 提交失效） | 焦点捕捉与恢复同时覆盖 `SVGElement` |
| 视觉检查：平方块在基准尺度下（lane 66px vs 边长 ≈176px）几乎全部裁切，满屏"裁切"标记盖住偏差线 | 保留严格映射与裁切标记；**默认改为关**（设计文档 §10.3 的"默认开"实现期调整并已回写文档）；lane 高上限 66→96、点半径 5.5→6.5 |
| e2e 浏览器窗口未设尺寸（实际 758×482）+ 入场动效未结束 → 坐标漂移、按压命中错误元素 | e2e 固定 `--window-size=1440,900` 并等动效结束；画布标注/面积块/偏差线统一 `pointer-events:none`（命中目标只有数据点圆） |

## Audit Notes
- statloom-ui audit：0 FAIL / 1 WARN（unlabelled-sample）。根因：审计脚本 EXTS 不含 `.ts`，只收集了 index.html + 两个 css（"3 个文件"）；画布窗内的示意注记在 TS 渲染文本中，工具看不见。如实记录，不为过检在 HTML 里塞隐藏标注。

## Resources
- CDP 模式参考：`test/tools/e2e.mjs`、`test/tools/shot.mjs`
- statloom-ui 参考文档（P4A 前阅读）：typography / ambient-cloud / motion / frontend-contract；起手件 `assets/starter/`
- 基准数据：A=[4,5,6]、B=[7,8,9]（验收用例 A）
