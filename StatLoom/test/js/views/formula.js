// formula.js — 分析规程（原公式推导面板）
// 校准步进板：编号诊断板把规程逐步推进（0 起点 → 1 偏差 → 2 平方 → 3 求和），
// 保留精确的当前阶段；每一步含解释、依据前提、当前数据实例与定位入口。
// 双向追踪不变：公式项 → 数据/观测窗；数据 → 本面板数值实例行。

import * as store from './../store.js';
import * as S from './../stats.js';
import * as G from './../guidance.js';
import { h, fmt, clear, pulse, scrollToEl, seriesClass } from './../util.js';

const PLATES_A = [
  { n: 0, label: '起点' },
  { n: 1, label: '偏差' },
  { n: 2, label: '平方' },
  { n: 3, label: '求和' },
];
const PLATES_B = [
  { n: 0, label: '起点' },
  { n: 1, label: '组均值' },
  { n: 2, label: '组间' },
  { n: 3, label: '组内' },
];

let root = null;
let lastFocusSeq = -1;
const lastStages = { 'ssTotal-def': 0, decomp: 0 };

export function init(container) {
  root = container;
}

export function render(state) {
  if (!root) return;
  clear(root);
  const seq = state.focusSeq ?? 0;
  const fresh = seq !== lastFocusSeq;
  lastFocusSeq = seq;
  const f = state.focus;

  const hint = G.hintEl(state, 'formula', '编号诊断板把规程逐步推进；蓝色符号可以点击，定位到对应的数据或读数。');
  if (hint) root.append(hint);

  const rows = state.rows;
  if (!rows.length) {
    root.append(h('p', { class: 'empty-note' }, '没有数据，暂时没有可追踪的计算实例。'));
    return;
  }

  const values = rows.map((r) => r.value);
  const mean = S.mean(values);
  const d = S.decomposition(store.effectiveRows()); // 混合视图下按单一分组计算
  const devs = S.deviationRows(rows);
  const devById = new Map(devs.map((x) => [x.id, x]));
  const gcs = S.groupContributions(rows);
  const groupNames = [...new Set(rows.map((r) => r.group))];

  const example = devById.get(f?.kind === 'obs' ? f.id : rows[0].id);

  const isTerm = (t) => f?.kind === 'term' && f.target === t;
  const markCard = (el, match) => {
    if (match) {
      el.classList.add('is-focus');
      if (fresh) pulse(el);
    }
    return el;
  };

  const grid = h('div', { class: 'f-grid' });
  const left = h('div', { class: 'f-col' });
  const right = h('div', { class: 'f-col' });

  const stageA = state.stage['ssTotal-def'] ?? 0;
  const stageB = state.stage.decomp ?? 0;
  const prevA = lastStages['ssTotal-def'];
  const prevB = lastStages.decomp;
  lastStages['ssTotal-def'] = stageA;
  lastStages.decomp = stageB;

  // ================= 卡片 A：总平方和 =================

  const cardA = markCard(h('div', { class: 'f-card' }), isTerm('ssTotal'));
  const titleA = h('div', { class: 'f-title' });
  titleA.append('总平方和 SS_T', stagePlates(state, 'ssTotal-def', PLATES_A, stageA));
  cardA.append(titleA);
  cardA.append(
    eq(
      chip('SS_T', { kind: 'term', target: 'ssTotal' }),
      ' = Σ',
      msub('i=1'),
      msup('n'),
      ' ',
      chip('(yᵢ − ȳ)²', { kind: 'term', target: 'dev' })
    )
  );
  cardA.append(h('p', { class: 'f-note' }, '前提：只用描述性统计。ȳ 是当前这批数据的算术平均，不需要抽样假设；点击蓝色符号可以定位到数据。'));

  if (stageA >= 1) {
    cardA.append(
      step({
        fresh,
        reveal: stageA > prevA ? 1 : 0,
        focused: isTerm('dev') || f?.kind === 'obs',
        head: eq('第 1 步 · 偏差 ', chip('eᵢ = yᵢ − ȳ', { kind: 'term', target: 'dev' })),
        explain: '每个观测值相对总均值的偏离。偏差有正有负，直接相加会相互抵消（Σeᵢ = 0），所以不能直接用它衡量整体波动。',
        instance: `以 ${example.id} 为例：e = ${fmt(example.y)} − ${fmt(example.mean)} = ${fmt(example.e)}`,
        actions: [['定位这条观测', { kind: 'obs', id: example.id }]],
      })
    );
  }
  if (stageA >= 2) {
    cardA.append(
      step({
        fresh,
        reveal: stageA > prevA ? 2 : 0,
        focused: isTerm('sq'),
        head: eq('第 2 步 · 平方 ', chip('eᵢ²', { kind: 'term', target: 'sq' })),
        explain: '平方消除了正负号，并让偏离越大的观测贡献越大。',
        instance: `继续以 ${example.id} 为例：e² = (${fmt(example.e)})² = ${fmt(example.e2)}`,
        actions: [['在托盘中看全部偏差', { kind: 'term', target: 'dev' }]],
      })
    );
  }
  if (stageA >= 3) {
    cardA.append(
      step({
        fresh,
        reveal: stageA > prevA ? 3 : 0,
        focused: false,
        head: eq('第 3 步 · 求和 ', chip('SS_T', { kind: 'term', target: 'ssTotal' }), ' = Σ eᵢ²'),
        explain: '把每个观测的平方偏差加起来，得到整批数据的总波动。',
        instance: `当前数据：SS_T = ${fmt(d.ssT)}（${devs.length} 个 eᵢ² 之和）`,
        actions: [['查看逐观测明细', null, () => scrollToEl('f-inst-obs')]],
      })
    );
    cardA.append(
      branchRow([
        ['分支：平方和分解 SS_T = SS_B + SS_W', () => store.setStage('decomp', 2)],
        ['分支：平方损失 L(a) = Σ(yᵢ − a)²', () => scrollToEl('panel-loss')],
        ['知识卡：平方损失', () => store.setCard('squared-loss')],
      ])
    );
  }
  left.append(cardA);

  // ================= 卡片 B：平方和分解 =================

  const cardB = markCard(h('div', { class: 'f-card' }), isTerm('ssBetween') || isTerm('ssWithin'));
  const titleB = h('div', { class: 'f-title' });
  titleB.append('平方和分解：组内与组间', stagePlates(state, 'decomp', PLATES_B, stageB));
  cardB.append(titleB);
  cardB.append(
    eq(
      chip('SS_T', { kind: 'term', target: 'ssTotal' }),
      ' = ',
      chip('SS_B', { kind: 'term', target: 'ssBetween' }),
      ' ＋ ',
      chip('SS_W', { kind: 'term', target: 'ssWithin' })
    )
  );
  cardB.append(h('p', { class: 'f-note' }, '前提：分组需要构成数据的一个划分——每条观测恰好属于一个组。'));

  if (stageB >= 1) {
    cardB.append(
      step({
        fresh,
        reveal: stageB > prevB ? 1 : 0,
        focused: false,
        head: eq('第 1 步 · 组均值 ', chip('ȳₖ', { kind: 'term', target: 'mean' }), '（每组自己的平均）'),
        explain: '分组之后，每组有一个自己的均值，用来度量“组内”的典型水平。',
        instanceNodes: gcs.map((gc) => groupInstance(state, gc)),
      })
    );
  }
  if (stageB >= 2) {
    cardB.append(
      step({
        fresh,
        reveal: stageB > prevB ? 2 : 0,
        focused: isTerm('ssBetween'),
        head: eq(
          '第 2 步 · 组间 ',
          chip('SS_B', { kind: 'term', target: 'ssBetween' }),
          ' = Σ',
          msub('k'),
          ' ',
          chip('nₖ(ȳₖ − ȳ)²', { kind: 'term', target: 'ssBetween' })
        ),
        explain: '各组均值相对总均值的偏离，按组样本量加权。它度量“组与组之间”的差异总量。',
        instance: `当前数据：SS_B = ${fmt(d.ssB)}（各组贡献之和）`,
        actions: [['在观测窗中查看组均值', { kind: 'term', target: 'ssBetween' }]],
      })
    );
  }
  if (stageB >= 3) {
    cardB.append(
      step({
        fresh,
        reveal: stageB > prevB ? 3 : 0,
        focused: isTerm('ssWithin'),
        head: eq(
          '第 3 步 · 组内 ',
          chip('SS_W', { kind: 'term', target: 'ssWithin' }),
          ' = Σ',
          msub('k'),
          ' Σ',
          msub('i'),
          ' ',
          chip('(yᵢₖ − ȳₖ)²', { kind: 'term', target: 'ssWithin' })
        ),
        explain: '每组内部，各观测相对本组均值的偏离之和。它度量“组内部”的波动。',
        instance: `当前数据：SS_W = ${fmt(d.ssW)}`,
        actions: [['在观测窗中查看组内偏差', { kind: 'term', target: 'ssWithin' }]],
      })
    );
    cardB.append(
      h('div', { class: 'f-instance' }, `恒等式实例：SS_T = ${fmt(d.ssT)} = SS_B ${fmt(d.ssB)} ＋ SS_W ${fmt(d.ssW)}`)
    );
    if (state.mixed) {
      cardB.append(
        h('p', { class: 'f-note' }, '当前为混合视图：所有观测视为同一组，因此 SS_B = 0；下方“分组实例”保留混合前的分组明细，用于对照。')
      );
    }
    cardB.append(
      branchRow([
        ['知识卡：组内与组间变异', () => store.setCard('within-between')],
        ['分支：打开处置台', () => scrollToEl('panel-loss')],
      ])
    );
  }
  left.append(cardB);

  // ================= 右列：数值实例 =================

  right.append(h('h3', null, '数值实例', h('span', { class: 'micro' }, 'LIVE INSTANCES')));

  const t1 = h('table', { class: 'f-inst-table' });
  t1.append(
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', null, '观测'),
        h('th', null, 'yᵢ'),
        thTerm('eᵢ = yᵢ − ȳ', { kind: 'term', target: 'dev' }, f),
        thTerm('eᵢ²', { kind: 'term', target: 'sq' }, f)
      )
    )
  );
  const tbody1 = h('tbody');
  for (const x of devs) {
    const tr = h('tr', { onclick: () => store.setFocus({ kind: 'obs', id: x.id }) });
    if (f?.kind === 'obs' && f.id === x.id) tr.classList.add('is-focus');
    tr.append(h('td', null, x.id), h('td', null, fmt(x.y)), h('td', null, fmt(x.e)), h('td', null, fmt(x.e2)));
    tbody1.append(tr);
  }
  t1.append(tbody1);
  right.append(h('div', { class: 'f-inst-scroll', id: 'f-inst-obs' }, t1));

  right.append(h('h3', null, '分组实例', h('span', { class: 'micro' }, 'BY GROUP')));
  const t2 = h('table', { class: 'f-inst-table' });
  t2.append(
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', null, '组'),
        h('th', null, 'nₖ'),
        h('th', null, 'ȳₖ'),
        h('th', null, 'ȳₖ − ȳ'),
        h('th', null, 'nₖ(ȳₖ − ȳ)²')
      )
    )
  );
  const tbody2 = h('tbody');
  for (const gc of gcs) {
    const tr = h('tr', { onclick: () => store.setFocus({ kind: 'group', name: gc.name }) });
    if (f?.kind === 'group' && f.name === gc.name) tr.classList.add('is-focus');
    tr.append(
      h('td', null, h('span', { class: `legend-dot ${seriesClass(groupNames, gc.name)}` }), ' ', gc.name),
      h('td', null, String(gc.n)),
      h('td', null, fmt(gc.mean)),
      h('td', null, fmt(gc.gap)),
      h('td', null, fmt(gc.contribution))
    );
    tbody2.append(tr);
  }
  t2.append(tbody2);
  right.append(t2);
  right.append(h('p', { class: 'f-note' }, `SS_B = 各行贡献之和 = ${fmt(d.ssB)}`));

  grid.append(left, right);
  root.append(grid);

  // ---------- 渲染后处理：滚动与脉冲 ----------
  if (fresh) {
    const target = root.querySelector('.f-inst-table tbody tr.is-focus');
    if (target) {
      pulse(target);
      target.scrollIntoView({ block: 'nearest' });
    }
    if (f?.kind === 'term' && ['ssTotal', 'ssBetween', 'ssWithin', 'dev', 'sq'].includes(f.target)) {
      root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

// ---------- 构件 ----------

function eq(...parts) {
  return h('div', { class: 'f-eq' }, ...parts);
}

function chip(text, focus) {
  return h('button', { class: 'f-term', title: '点击可追踪到数据或读数', onclick: () => store.setFocus(focus) }, text);
}

function msub(text) {
  return h('sub', null, text);
}

function msup(text) {
  return h('sup', null, text);
}

// 校准步进板：编号诊断板，点击推进到该步；再次点击当前步保持不变
function stagePlates(state, id, plates, current) {
  const wrap = h('div', { class: 'stage-plates' });
  wrap.append(h('span', { class: 'stage-note' }, '步进'));
  for (const { n, label } of plates) {
    wrap.append(
      h(
        'button',
        {
          class: 'stage-plate' + (current === n ? ' is-active' : ''),
          'aria-pressed': current === n ? 'true' : 'false',
          title: n === 0 ? '回到起点板' : `推进到第 ${n} 步`,
          dataset: { stage: String(n) },
          onclick: () => store.setStage(id, n),
        },
        `${n} · ${label}`
      )
    );
  }
  return wrap;
}

function step({ fresh, reveal, focused, head, explain, instance, instanceNodes, actions }) {
  const el = h('div', { class: 'f-step' });
  if (reveal > 0) {
    el.classList.add('is-revealing');
    el.style.animationDelay = `${(reveal - 1) * 60}ms`;
  }
  if (focused) {
    el.classList.add('is-focus');
    if (fresh) pulse(el);
  }
  el.append(head);
  if (explain) el.append(h('p', { class: 'f-note' }, explain));
  if (instance || instanceNodes || actions) {
    const box = h('div', { class: 'f-instance' });
    if (instance) box.append(instance);
    if (instanceNodes) for (const n of instanceNodes) box.append(n);
    for (const [label, focus, fn] of actions ?? []) {
      box.append(' ', h('button', { class: 'btn btn-small', onclick: () => (fn ? fn() : store.setFocus(focus)) }, label));
    }
    el.append(box);
  }
  return el;
}

function groupInstance(state, gc) {
  const line = h('div', null);
  line.append(
    h('span', { class: `legend-dot ${seriesClass([...new Set(state.rows.map((r) => r.group))], gc.name)}` }),
    ' ',
    h('span', { class: 'f-term', title: '点击追踪这个组', onclick: () => store.setFocus({ kind: 'group', name: gc.name }) }, gc.name),
    `：nₖ=${gc.n}，ȳₖ=${fmt(gc.mean)}，ȳₖ−ȳ=${fmt(gc.gap)}，贡献 nₖ(ȳₖ−ȳ)²=${fmt(gc.contribution)}`
  );
  return line;
}

function thTerm(label, focus, f) {
  const th = h('th', { onclick: () => store.setFocus(focus), title: '点击高亮对应的数据' }, label);
  if (f?.kind === 'term' && f.target === focus.target) th.classList.add('is-focus');
  return th;
}

function branchRow(items) {
  const row = h('div', { class: 'branch-row' });
  for (const [label, fn] of items) {
    row.append(h('button', { class: 'btn btn-small', onclick: fn }, label));
  }
  return row;
}
