// cards.js — 知识卡片内容
// 每张卡：标题、分层章节（直观解释默认展开）、当前数据实例（实时计算）、相关概念/操作入口。
// 卡片文字为系统整理的知识说明；数值实例由当前数据实时计算。

import * as store from './../store.js';
import * as S from './../stats.js';
import { fmt, scrollToEl } from './../util.js';

function cur() {
  const rows = store.state.rows;
  const values = rows.map((r) => r.value);
  return {
    values,
    n: values.length,
    mean: S.mean(values),
    median: S.median(values),
    decomp: S.decomposition(store.effectiveRows()),
  };
}

const closeAnd = (fn) => () => {
  store.setCard(null);
  fn();
};

export const CARDS = {
  mean: {
    title: '均值 ȳ',
    sections: [
      {
        h: '直观解释',
        open: true,
        p: '一群数值的平衡点。每个观测相对它的偏差有正有负，加起来恰好抵消（Σeᵢ = 0）。它也是让平方损失最小的那个常数。',
      },
      { h: '数学定义', formula: 'ȳ = (1/n) Σᵢ yᵢ' },
      {
        h: '适用条件',
        p: '数值型变量；对极端值敏感——把一个成绩改得很大，可以观察均值被拉动多少。',
      },
      {
        h: '常见误解',
        p: '“均值总能代表数据的典型水平”。分布偏斜或有极端值时，中位数可能更合适；选哪个取决于分析目的。',
      },
      { h: '延伸阅读', p: '统计教材中「集中趋势」章节。' },
    ],
    instance: () => {
      const c = cur();
      return `当前数据：n = ${c.n}，ȳ = ${fmt(c.mean)}。`;
    },
    links: [
      { label: '中位数', card: 'median' },
      { label: '偏差', card: 'dev' },
      { label: '平方损失', card: 'squared-loss' },
      {
        label: '在复核台查看',
        fn: closeAnd(() => {
          store.setFocus({ kind: 'term', target: 'mean' });
          scrollToEl('panel-dock');
        }),
      },
    ],
  },

  median: {
    title: '中位数',
    sections: [
      { h: '直观解释', open: true, p: '排序后处在正中间的值：一半观测在它以下，一半在它以上。' },
      {
        h: '数学定义',
        p: 'n 为奇数时取正中间那个；n 为偶数时取中间两个值的平均。它使绝对损失最小——偶数样本时，最优解是中间两个值之间的一整段区间。',
      },
      { h: '适用条件', p: '适用于有序数据；对极端值不敏感。' },
      { h: '常见误解', p: '“中位数最小化的也是平方和”。中位数对应的目标函数是绝对损失之和，与均值（平方损失）是两回事。' },
    ],
    instance: () => {
      const c = cur();
      return `当前数据：中位数 = ${fmt(c.median)}。`;
    },
    links: [
      { label: '均值', card: 'mean' },
      { label: '绝对损失', card: 'absolute-loss' },
      { label: '打开损失画布', fn: closeAnd(() => scrollToEl('panel-loss')) },
    ],
  },

  dev: {
    title: '偏差 eᵢ',
    sections: [
      { h: '直观解释', open: true, p: '观测值离总均值多远，带方向：eᵢ = yᵢ − ȳ。' },
      { h: '数学性质', p: 'Σeᵢ = 0。正负偏差相互抵消，所以度量“整体波动”需要把偏差平方或取绝对值再求和。' },
      { h: '常见误解', p: '“偏差大说明数据错了”。偏差只说明它离均值远；是否值得注意要结合规则与背景判断。' },
    ],
    instance: () => {
      const c = cur();
      return `当前数据：Σeᵢ = 0，Σeᵢ² = SS_T = ${fmt(c.decomp.ssT)}。`;
    },
    links: [
      { label: '平方和分解', card: 'ss-decomposition' },
      { label: '均值', card: 'mean' },
      {
        label: '在规程中追踪偏差',
        fn: closeAnd(() => {
          store.setStage('ssTotal-def', 3);
          store.setFocus({ kind: 'term', target: 'dev' });
        }),
      },
    ],
  },

  'ss-decomposition': {
    title: '平方和分解',
    sections: [
      { h: '直观解释', open: true, p: '总波动 = 组间差异 + 组内波动。组间占比越大，“组”这一划分解释的差异越多。' },
      {
        h: '数学定义',
        formula: 'SS_T = Σ(yᵢ − ȳ)²；SS_B = Σₖ nₖ(ȳₖ − ȳ)²；SS_W = Σₖ Σᵢ (yᵢₖ − ȳₖ)²；恒等式 SS_T = SS_B + SS_W。',
      },
      { h: '适用条件', p: '分组必须构成数据的一个划分：每条观测恰好属于一个组。' },
      {
        h: '常见误解',
        p: '“SS_B 大就证明两组真的不同”。这是数据层面的描述；要推广到总体或谈因果，还需要抽样设计与统计推断，本原型不做这一步。',
      },
    ],
    instance: () => {
      const c = cur();
      return `当前数据：SS_T = ${fmt(c.decomp.ssT)} = SS_B ${fmt(c.decomp.ssB)} + SS_W ${fmt(c.decomp.ssW)}。`;
    },
    links: [
      { label: '组内与组间变异', card: 'within-between' },
      {
        label: '推进推导步骤',
        fn: closeAnd(() => {
          store.setStage('ssTotal-def', 3);
          store.setStage('decomp', 3);
        }),
      },
    ],
  },

  'within-between': {
    title: '组内与组间变异',
    sections: [
      {
        h: '直观解释',
        open: true,
        p: '比较两组均值差异时，要把差异放进组内波动里看：组内波动越小，同样的均值差越显眼。',
      },
      {
        h: '描述与推断的分界',
        p: 'SS_B / SS_T 是描述性比例，只说明“数据里”组间差异占多少；它本身不是显著性结论，也不能解释为因果关系。',
      },
      {
        h: '常见误解',
        p: '“组均值不同就说明某种教学方式更有效”。均值差异也可能来自抽样波动；做这种判断需要明确的研究设计与统计推断。',
      },
    ],
    instance: () => {
      const c = cur();
      const pct = c.decomp.ssT > 0 ? (c.decomp.ssB / c.decomp.ssT) * 100 : NaN;
      return `当前数据：组间占比 SS_B / SS_T = ${fmt(pct, 1)}%（描述性比例）。`;
    },
    links: [
      { label: '平方和分解', card: 'ss-decomposition' },
      { label: '均值', card: 'mean' },
    ],
  },

  'squared-loss': {
    title: '平方损失',
    sections: [
      { h: '直观解释', open: true, p: '预测值离真实值越远，惩罚按平方增长：远一点的观测权重大得多。' },
      {
        h: '数学依据',
        p: 'L(a) = Σ(yᵢ − a)² 是 a 的凸函数；对 a 求导并令其为 0：−2Σ(yᵢ − a) = 0，得到 a* = ȳ——最优解是样本均值，且唯一。',
      },
      {
        h: '适用条件',
        p: '固定数据、无约束的常数预测。“找到数值解”和“已证明全局最优”是两回事：这里可以证明（凸函数），换成其他目标未必。',
      },
      {
        h: '常见误解',
        p: '“平方损失总是更好的选择”。它对极端值更敏感；目标的选择取决于问题——平方损失对应均值，绝对损失对应中位数。',
      },
    ],
    instance: () => {
      const c = cur();
      const m = S.mean(c.values);
      return `当前数据：L(ȳ) = SS_T = ${fmt(S.squaredLoss(c.values, m))}（a = ȳ = ${fmt(m)}）。`;
    },
    links: [
      { label: '绝对损失', card: 'absolute-loss' },
      { label: '均值', card: 'mean' },
      { label: '打开损失画布', fn: closeAnd(() => scrollToEl('panel-loss')) },
    ],
  },

  'absolute-loss': {
    title: '绝对损失',
    sections: [
      { h: '直观解释', open: true, p: '惩罚与距离成正比：每个观测的贡献就是 |yᵢ − a|，不会特别放大远处的观测。' },
      {
        h: '数学依据',
        p: 'L(a) = Σ|yᵢ − a| 的最小值在样本中位数处取到；n 为偶数时，中间两个有序观测值之间的整段区间都能取到相同的最小值（曲线在那一段是平的）。',
      },
      {
        h: '常见误解',
        p: '“最优解总是唯一的一个数”。偶数样本时是一整段区间；“跳到最优解”落在区间中点，只是给出一个代表值。',
      },
    ],
    instance: () => {
      const c = cur();
      const min = S.lossMinimum(c.values, 'absolute');
      if (!min) return '当前数据为空。';
      return min.kind === 'interval'
        ? `当前数据 n = ${c.n}（偶数）：最优区间 [${fmt(min.aLo)}, ${fmt(min.aHi)}]。`
        : `当前数据：最优解 = 中位数 ${fmt(min.a)}。`;
    },
    links: [
      { label: '中位数', card: 'median' },
      { label: '平方损失', card: 'squared-loss' },
      { label: '打开损失画布', fn: closeAnd(() => scrollToEl('panel-loss')) },
    ],
  },

  'outlier-rule': {
    title: 'IQR 规则提示',
    sections: [
      {
        h: '规则说明',
        open: true,
        p: '原型按 1.5×IQR 规则标记“离本组大部分取值较远”的观测：超出 Q1 − 1.5×IQR 或 Q3 + 1.5×IQR 的取值会带上虚线菱形标记。',
      },
      {
        h: '定位',
        p: '这是按固定规则给出的观察入口，不是数据错误的判定，也不等于该观测一定“异常”；是否特殊要结合数据背景与后续分析。',
      },
    ],
    instance: () => {
      const { flags } = S.iqrFlags(store.state.rows);
      const ids = [...flags.entries()].filter(([, v]) => v).map(([id]) => id);
      return ids.length ? `当前数据：${ids.join('、')} 被规则标记。` : '当前数据：没有被规则标记的观测。';
    },
    links: [
      { label: '偏差', card: 'dev' },
      { label: '均值', card: 'mean' },
    ],
  },
};
