// data.js — 原型内置数据集：教学方式 × 考试成绩
// 对应《交互设计改进建议》第八节的验证场景。
// 讲授式含一个偏低观测值（40），用于展示 IQR 规则异常提示（提示不是判定数据错误）。

export const META = {
  variable: '成绩',
  group: '教学方式',
  unit: '分',
};

export const ORIGINAL_ROWS = [
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

let seq = 21;
export function nextId() {
  return 'r' + String(seq++).padStart(2, '0');
}
