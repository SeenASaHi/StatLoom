# Progress Log（test3 原型轮）

## Session 2026-10-13 · 实施启动
- 建立规划三件套（task_plan / findings / progress），阶段划分 P0–P5 对应设计文档 §14 实施顺序。
- 规范补丁：派生对象 version 规则补进《统一依赖图规范》§3 与设计文档 §4.3（本次实现前发现的口径缺口）。
- 执行方式：inline（本会话直接实现）；视觉偏离（窗口 .72）已在 tokens 中固定。
- 下一步：Phase 0 脚手架 + `npm install`。

## Session 2026-10-13 · Phase 0–3 完成
- P0 脚手架 + 冻结类型；P1 AST 与求值；P2 图与重建；P3 历史/序列化/事务/性质/层界/变异演练。
- 全套测试 **81/81 通过**；`tsc --noEmit` 干净。实现期共 5 处修正（见 task_plan Errors）。
- 关键证据：精确受影响集合＝17 对象（含 B 组 gdev 链、不含 B 组 dev 链）；换组案例总体均值数值与版本均不变；变异演练证明结构护栏可触发。
- 下一步：Phase 4A（statloom-ui 视图层）。

## Session 2026-10-13 · Phase 4A–5 完成（原型交付）
- 视图层全部落地（statloom-ui：导轨/三窗口/L2 读数面/L3 标注/环境点云/KaTeX 三模式公式/关系图折叠）。
- e2e 36/36；实现期通过截图+探针共发现并修复 5 个真实缺陷（记录于 task_plan Errors，最有价值的两个：SVG `<sub>` 破出导致数据点从未绘成图形；SVG 元素被焦点恢复遗漏）。
- 交付偏离（已回写文档）：平方块默认关；L1 窗口 .72+blur12（此前用户决策）。
- 审计：statloom-ui 0 FAIL / 1 WARN（示意标注，已注明）。

## Test Results
| 阶段 | 命令 | 结果 |
|---|---|---|
| P0–3 | `npx vitest run` | 8 files / 81 tests 全通过 |
| P0–3 | `npx tsc --noEmit` | exit 0 |
| P4–5 | `npx vitest run` | 9 files / 86 tests 全通过 |
| P5 | `node tools/e2e.mjs` | 36 passed, 0 failed |
| P5 | `npm run build` | ✓ built（dist ~326KB JS + 42KB CSS） |
| P5 | statloom-ui audit | 0 FAIL · 1 WARN（示意标注，已如实注明） |
