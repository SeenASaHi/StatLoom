// check-math.mjs — Node 端数学校验：验证统计引擎的核心恒等式与最优解结论。
// 运行：node tools/check-math.mjs（在 test/ 目录下）

import * as S from '../js/stats.js';

// 本地夹具（原型二无预设数据，测试自带固定样本，结构与原型一示例一致）
const SAMPLE_ROWS = [
  { id: 'r01', group: '讲授式', value: 40 },
  { id: 'r02', group: '讲授式', value: 62 },
  { id: 'r03', group: '讲授式', value: 68 },
  { id: 'r04', group: '讲授式', value: 72 },
  { id: 'r05', group: '讲授式', value: 75 },
  { id: 'r06', group: '讲授式', value: 78 },
  { id: 'r07', group: '讲授式', value: 80 },
  { id: 'r08', group: '讲授式', value: 83 },
  { id: 'r09', group: '讲授式', value: 86 },
  { id: 'r10', group: '讲授式', value: 90 },
  { id: 'r11', group: '探究式', value: 65 },
  { id: 'r12', group: '探究式', value: 70 },
  { id: 'r13', group: '探究式', value: 74 },
  { id: 'r14', group: '探究式', value: 79 },
  { id: 'r15', group: '探究式', value: 82 },
  { id: 'r16', group: '探究式', value: 85 },
  { id: 'r17', group: '探究式', value: 88 },
  { id: 'r18', group: '探究式', value: 91 },
  { id: 'r19', group: '探究式', value: 93 },
  { id: 'r20', group: '探究式', value: 96 },
];

let passes = 0;
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passes++;
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.error('  FAIL  ' + name + (extra ? '  →  ' + extra : ''));
  }
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('== 基础统计量 ==');
{
  const js = [40, 62, 68, 72, 75, 78, 80, 83, 86, 90];
  check('mean 已知值 73.4', near(S.mean(js), 73.4));
  check('median 偶数样本', near(S.median([1, 2, 3, 4]), 2.5));
  check('median 奇数样本', near(S.median([3, 1, 2]), 2));
  check('quantile type-7', near(S.quantile([1, 2, 3, 4], 0.25), 1.75));
  check('空数组 mean 为 NaN', Number.isNaN(S.mean([])));
}

console.log('== SS 分解恒等式：SS_T = SS_B + SS_W ==');
{
  const d0 = S.decomposition(SAMPLE_ROWS);
  check('原始数据恒等式', near(d0.ssT, d0.ssB + d0.ssW), `gap=${d0.gap}`);

  const removed = SAMPLE_ROWS.filter((r) => r.id !== 'r01');
  const d1 = S.decomposition(removed);
  check('删除一行后恒等式', near(d1.ssT, d1.ssB + d1.ssW), `gap=${d1.gap}`);

  const moved = SAMPLE_ROWS.map((r) => (r.id === 'r11' ? { ...r, group: '讲授式' } : r));
  const d2 = S.decomposition(moved);
  check('移动一行分组后恒等式', near(d2.ssT, d2.ssB + d2.ssW), `gap=${d2.gap}`);

  const single = SAMPLE_ROWS.map((r) => ({ ...r, group: '全部' }));
  const d3 = S.decomposition(single);
  check('单一分组时 SS_B = 0 且 SS_T = SS_W', near(d3.ssB, 0) && near(d3.ssT, d3.ssW));
}

console.log('== 偏差表 ==');
{
  const rows = S.deviationRows(SAMPLE_ROWS);
  const sumE = S.sum(rows.map((r) => r.e));
  const sumE2 = S.sum(rows.map((r) => r.e2));
  check('Σe_i ≈ 0', near(sumE, 0));
  check('Σe_i² = SS_T', near(sumE2, S.ssTotal(SAMPLE_ROWS)));
}

console.log('== 损失函数与最优解 ==');
{
  const vals = [1, 2, 3, 4];
  const sq = S.lossMinimum(vals, 'squared');
  check('平方损失最优解 = 均值（点解）', sq.kind === 'point' && near(sq.a, 2.5));
  check('平方损失 L(均值) 最小', near(sq.L, 5) && S.squaredLoss(vals, 2.6) > sq.L);

  const abOdd = S.lossMinimum([1, 5, 3], 'absolute');
  check('绝对损失奇数样本最优解 = 中位数', abOdd.kind === 'point' && near(abOdd.a, 3));

  const abEven = S.lossMinimum(vals, 'absolute');
  check(
    '绝对损失偶数样本最优解 = 中位区间 [2, 3]',
    abEven.kind === 'interval' && near(abEven.aLo, 2) && near(abEven.aHi, 3)
  );
  check(
    '中位区间内损失值持平',
    near(S.absoluteLoss(vals, 2), S.absoluteLoss(vals, 2.5)) &&
      near(S.absoluteLoss(vals, 2.5), S.absoluteLoss(vals, 3))
  );
  check('区间外损失更大', S.absoluteLoss(vals, 1.9) > S.absoluteLoss(vals, 2));

  const curve = S.lossCurve(SAMPLE_ROWS.map((r) => r.value), 'squared');
  check('损失曲线采样非空', curve && curve.pts.length === 221);
}

console.log('== IQR 规则提示 ==');
{
  const { flags, fences } = S.iqrFlags(SAMPLE_ROWS);
  const flagged = [...flags.entries()].filter(([, v]) => v).map(([id]) => id);
  check('仅 40 分被规则标记', flagged.length === 1 && flagged[0] === 'r01', `flagged=${flagged}`);
  check('每组都有栅栏记录', fences.length === 2);
}

console.log('');
console.log(`结果：${passes} 通过，${failures} 失败`);
process.exit(failures ? 1 : 0);
