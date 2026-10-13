// 统一比例尺模块（设计文档 §10.5）：几何由表示层计算；数学数值只来自数学对象。
// 面积映射严格成立：侧长 = |偏差| × s（与数值轴同一比例尺），面积 = 偏差² × s²；
// 不截断、不设最小值；超界由画布裁切并标记，真实数值保留可在检查器读取。

export interface ValueScale {
  /** 值 → 绘图区 x 坐标 */
  x: (v: number) => number;
  /** 每单位值的像素数（平方块侧长 = |偏差| × s） */
  s: number;
  domain: { min: number; max: number };
  /** 绘图区 */
  plot: { left: number; right: number; top: number; bottom: number };
}

export function makeValueScale(
  values: readonly number[],
  extra: readonly number[],
  plot: { left: number; right: number; top: number; bottom: number },
): ValueScale {
  const all = [...values, ...extra].filter((v) => Number.isFinite(v));
  let min = all.length > 0 ? Math.min(...all) : -1;
  let max = all.length > 0 ? Math.max(...all) : 1;
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.06;
  min -= pad;
  max += pad;
  const span = max - min;
  const s = (plot.right - plot.left) / span;
  return {
    x: (v: number) => plot.left + (v - min) * s,
    s,
    domain: { min, max },
    plot,
  };
}

export interface SquareGeometry {
  side: number;
  x: number;
  y: number;
  clipped: boolean;
}

/**
 * 平方块几何：以组均值线为锚，垂直居中于点所在行。
 * side = |偏差| × s；越界只做裁切标记，不改变 side。
 */
export function squareGeometry(
  dev: number,
  meanX: number,
  pointY: number,
  scale: ValueScale,
  laneHalfHeight: number,
): SquareGeometry {
  const side = Math.abs(dev) * scale.s;
  const x = dev >= 0 ? meanX : meanX - side;
  const y = pointY - side / 2;
  const clipped = x < scale.plot.left || x + side > scale.plot.right || y < scale.plot.top || y + side > scale.plot.bottom || side / 2 > laneHalfHeight;
  return { side, x, y, clipped };
}

/** 数值显示：统计量固定两位小数（同一屏位数一致） */
export function fmt(v: number | undefined, digits = 2): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
