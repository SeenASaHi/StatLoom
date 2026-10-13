// 比例尺与几何（设计文档 §10.5 视觉契约）：面积映射严格、裁切有标记
import { describe, expect, it } from 'vitest';
import { makeValueScale, squareGeometry } from '../src/views/scale';

const plot = { left: 100, right: 700, top: 20, bottom: 380 };

describe('makeValueScale', () => {
  it('域覆盖数值并含 6% 边距；x 单调', () => {
    const sc = makeValueScale([4, 5, 6, 7, 8, 9], [6.5], plot);
    expect(sc.domain.min).toBeLessThan(4);
    expect(sc.domain.max).toBeGreaterThan(9);
    expect(sc.x(4)).toBeLessThan(sc.x(9));
    expect(sc.x(sc.domain.min)).toBeCloseTo(plot.left, 6);
    expect(sc.x(sc.domain.max)).toBeCloseTo(plot.right, 6);
  });

  it('全相同值：域退化为 ±1（另加 6% 边距），不出现除零', () => {
    const sc = makeValueScale([5, 5, 5], [5], plot);
    expect(Number.isFinite(sc.s)).toBe(true);
    expect(sc.domain.max - sc.domain.min).toBeCloseTo(2.24, 9);
  });
});

describe('squareGeometry：面积映射严格成立', () => {
  const sc = makeValueScale([4, 9], [6.5], plot);

  it('侧长 = |偏差| × s；面积 ∝ 偏差²', () => {
    const a = squareGeometry(2, 300, 100, sc, 60);
    const b = squareGeometry(4, 300, 100, sc, 60);
    expect(a.side).toBeCloseTo(2 * sc.s, 9);
    expect(b.side).toBeCloseTo(4 * sc.s, 9);
    expect(b.side / a.side).toBeCloseTo(2, 9); // 面积比 = 4
  });

  it('正负偏差：块从均值线向点的方向展开', () => {
    const pos = squareGeometry(2, 300, 100, sc, 60);
    const neg = squareGeometry(-2, 300, 100, sc, 60);
    expect(pos.x).toBeCloseTo(300, 9);
    expect(neg.x).toBeCloseTo(300 - 2 * sc.s, 9);
  });

  it('超界只标记裁切，不改变侧长（视觉可读性优化不得改变映射）', () => {
    const huge = squareGeometry(1000, 300, 100, sc, 60);
    expect(huge.clipped).toBe(true);
    expect(huge.side).toBeCloseTo(1000 * sc.s, 6);
  });
});
