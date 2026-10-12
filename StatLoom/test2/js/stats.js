// stats.js — StatLoom 原型：纯函数统计引擎
// 无 DOM、无副作用；可被浏览器与 Node 同时使用。
// 约定：rows 为 {id, group, value} 的数组；value 是数值型变量。

export function sum(xs) {
  return xs.reduce((s, x) => s + x, 0);
}

export function mean(xs) {
  return xs.length ? sum(xs) / xs.length : NaN;
}

export function sortedValues(xs) {
  return [...xs].sort((a, b) => a - b);
}

// 线性插值分位数（R type-7）。sorted 必须已升序。
export function quantile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(values) {
  const s = sortedValues(values);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---------- 分组 ----------

export function groupNames(rows) {
  return [...new Set(rows.map((r) => r.group))];
}

export function groupValues(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.group)) m.set(r.group, []);
    m.get(r.group).push(r.value);
  }
  return m;
}

export function overallStats(rows) {
  const vs = rows.map((r) => r.value);
  return { n: vs.length, mean: mean(vs) };
}

export function groupStats(rows) {
  const m = groupValues(rows);
  return [...m.entries()].map(([name, vs]) => ({ name, n: vs.length, mean: mean(vs), values: vs }));
}

// ---------- 平方和 ----------

export function ssTotal(rows) {
  const vs = rows.map((r) => r.value);
  const m = mean(vs);
  return sum(vs.map((y) => (y - m) ** 2));
}

export function ssWithin(rows) {
  let s = 0;
  for (const [, vs] of groupValues(rows)) {
    const m = mean(vs);
    s += sum(vs.map((y) => (y - m) ** 2));
  }
  return s;
}

export function ssBetween(rows) {
  const vs = rows.map((r) => r.value);
  const m = mean(vs);
  let s = 0;
  for (const [, gvs] of groupValues(rows)) {
    s += gvs.length * (mean(gvs) - m) ** 2;
  }
  return s;
}

// SS_T = SS_B + SS_W（分组构成数据的划分时恒成立）；gap 记录浮点残差。
export function decomposition(rows) {
  const ssT = ssTotal(rows);
  const ssB = ssBetween(rows);
  const ssW = ssWithin(rows);
  return { ssT, ssB, ssW, gap: ssT - ssB - ssW };
}

// 每个观测值相对总均值的偏差与平方项（公式追踪用）
export function deviationRows(rows) {
  const vs = rows.map((r) => r.value);
  const m = mean(vs);
  return rows.map((r) => ({
    id: r.id,
    group: r.group,
    y: r.value,
    mean: m,
    e: r.value - m,
    e2: (r.value - m) ** 2,
  }));
}

// 每个组相对总均值的贡献（组间平方和分解用）
export function groupContributions(rows) {
  const vs = rows.map((r) => r.value);
  const m = mean(vs);
  return groupStats(rows).map((g) => ({
    name: g.name,
    n: g.n,
    mean: g.mean,
    overallMean: m,
    gap: g.mean - m,
    gapSq: (g.mean - m) ** 2,
    contribution: g.n * (g.mean - m) ** 2,
  }));
}

// ---------- 损失函数 ----------

export function squaredLoss(values, a) {
  return sum(values.map((y) => (y - a) ** 2));
}

export function absoluteLoss(values, a) {
  return sum(values.map((y) => Math.abs(y - a)));
}

export function lossFn(type) {
  return type === 'absolute' ? absoluteLoss : squaredLoss;
}

// 无约束常数预测的最优解：
//   平方损失 → 样本均值；绝对损失 → 样本中位数（偶数样本时为一段区间）。
export function lossMinimum(values, type) {
  const s = sortedValues(values);
  const n = s.length;
  if (n === 0) return null;
  if (type === 'absolute') {
    if (n % 2 === 1) {
      const a = s[(n - 1) / 2];
      return { kind: 'point', a, L: absoluteLoss(values, a) };
    }
    const aLo = s[n / 2 - 1];
    const aHi = s[n / 2];
    return { kind: 'interval', aLo, aHi, L: absoluteLoss(values, aLo) };
  }
  const a = mean(values);
  return { kind: 'point', a, L: squaredLoss(values, a) };
}

// 采样损失曲线；数据为空时返回 null。
export function lossCurve(values, type, steps = 220) {
  const s = sortedValues(values);
  if (s.length === 0) return null;
  const lo = s[0];
  const hi = s[s.length - 1];
  const pad = Math.max((hi - lo) * 0.15, 1);
  const aMin = lo - pad;
  const aMax = hi + pad;
  const f = lossFn(type);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = aMin + ((aMax - aMin) * i) / steps;
    pts.push({ a, L: f(values, a) });
  }
  return { aMin, aMax, pts };
}

// ---------- 规则提示：IQR 栅栏 ----------
// 仅按明确的 IQR 规则产生"值得注意"的提示；不代表数据错误，也不构成对错判定。

export function iqrFlags(rows, k = 1.5) {
  const flags = new Map();
  const fences = [];
  for (const [name, vs] of groupValues(rows)) {
    if (vs.length < 4) {
      fences.push({ name, q1: NaN, q3: NaN, iqr: NaN, lo: NaN, hi: NaN, skipped: true });
      continue;
    }
    const s = sortedValues(vs);
    const q1 = quantile(s, 0.25);
    const q3 = quantile(s, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - k * iqr;
    const hi = q3 + k * iqr;
    fences.push({ name, q1, q3, iqr, lo, hi, skipped: false });
    for (const r of rows) {
      if (r.group === name) flags.set(r.id, r.value < lo || r.value > hi);
    }
  }
  for (const r of rows) if (!flags.has(r.id)) flags.set(r.id, false);
  return { flags, fences };
}
