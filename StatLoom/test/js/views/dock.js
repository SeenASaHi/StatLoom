// dock.js — 复核台（原统计量面板）
// 标本溯源胶囊 + 诊断读数（SS 分解）+ 分组读数 + 容差轨。
// 容差轨是固定的次要仪器：把每件样本放回它所在组的容差区间去对照，
// 对选中样本给出现实的余量/超出读数；轨道本身是大命中区（点击选择最近样本）。

import * as store from './../store.js';
import * as S from './../stats.js';
import { h, fmt, clear, pulse, seriesClass } from './../util.js';

let root = null;
let railRoot = null;
let lastFocusSeq = -1;

export function init(container, railContainer) {
  root = container;
  railRoot = railContainer;
}

export function render(state) {
  if (!root) return;
  clear(root);
  const seq = state.focusSeq ?? 0;
  const fresh = seq !== lastFocusSeq;
  lastFocusSeq = seq;
  const f = state.focus;

  const rows = state.rows;
  const values = rows.map((r) => r.value);
  const n = values.length;
  const d = S.decomposition(store.effectiveRows());
  const groupNames = [...new Set(rows.map((r) => r.group))];

  // ---- 标本溯源胶囊 ----
  const lo = n ? Math.min(...values) : NaN;
  const hi = n ? Math.max(...values) : NaN;
  const capsule = h('div', { class: 'capsule' });
  capsule.append(
    capsuleCell('批次 BATCH', '教学方式 × 考试成绩'),
    capsuleCell('阶段 PHASE', state.mixed ? '混合视图' : '分组视图'),
    capsuleCell('完整记录 INTEGRITY', `${n}/${n} 条有效`),
    capsuleCell('观测窗口 WINDOW', n ? `${fmt(lo)} – ${fmt(hi)}` : '—')
  );
  root.append(capsule);

  // ---- 诊断读数 ----
  const diag = h('div', { class: 'stat-block' });
  diag.append(h('h3', null, '诊断读数', h('span', { class: 'micro' }, 'DIAGNOSTICS')));
  diag.append(
    h(
      'div',
      { class: 'stat-tiles' },
      tile({ label: '观测数 n', value: String(n) }),
      tile({
        label: '均值 ȳ',
        value: fmt(S.mean(values)),
        focus: { kind: 'term', target: 'mean' },
        key: 'mean',
        f,
        fresh,
        book: ['mean', '关于均值'],
      })
    )
  );
  diag.append(
    h(
      'div',
      { class: 'ss-eq' },
      h(
        'div',
        { class: 'ss-line' },
        tile({ label: 'SS_T 总', value: fmt(d.ssT), focus: { kind: 'term', target: 'ssTotal' }, key: 'ssTotal', f, fresh, sm: true })
      ),
      h(
        'div',
        { class: 'ss-line' },
        h('span', { class: 'op' }, '='),
        tile({
          label: 'SS_B 组间',
          value: fmt(d.ssB),
          focus: { kind: 'term', target: 'ssBetween' },
          key: 'ssBetween',
          f,
          fresh,
          sm: true,
          book: ['within-between', '关于组内与组间变异'],
        }),
        h('span', { class: 'op' }, '＋'),
        tile({ label: 'SS_W 组内', value: fmt(d.ssW), focus: { kind: 'term', target: 'ssWithin' }, key: 'ssWithin', f, fresh, sm: true })
      )
    )
  );
  diag.append(
    h(
      'p',
      { class: 'ss-note' },
      state.mixed ? '已合并为单组：组间平方和自然为 0，全部变动计入组内。' : '三项恒等：SS_T = SS_B + SS_W，随数据实时计算。'
    )
  );
  root.append(diag);

  // ---- 分组读数 ----
  const gBlock = h('div', { class: 'stat-block' + (state.mixed ? ' is-ghost' : '') });
  gBlock.append(h('h3', null, state.mixed ? '混合前 · 分组读数' : '分组读数', h('span', { class: 'micro' }, 'BY GROUP')));
  for (const gc of S.groupContributions(rows)) {
    const line = h('div', {
      class: 'group-line',
      onclick: (ev) => {
        if (ev.target.closest('.book-btn')) return;
        store.setFocus({ kind: 'group', name: gc.name });
      },
    });
    const hit = f?.kind === 'group' && f.name === gc.name;
    if (hit) {
      line.classList.add('is-focus');
      if (fresh) pulse(line);
    }
    line.append(
      h('span', { class: `legend-dot ${seriesClass(groupNames, gc.name)}` }),
      h('span', { class: 'g-name' }, gc.name),
      h('span', { class: 'g-meta' }, `n=${gc.n}`),
      h('span', { class: 'g-meta' }, `ȳ=${fmt(gc.mean)}`),
      h('span', { class: 'g-meta', title: '组均值相对总均值的贡献：n·(ȳₖ−ȳ)²' }, `组间贡献 ${fmt(gc.contribution)}`)
    );
    gBlock.append(line);
  }
  root.append(gBlock);

  // ---- 容差轨（次要仪器：横跨台面底部的仪器条，不占复核台） ----
  if (railRoot) {
    clear(railRoot);
    const railGrid = h('div', { class: 'rail-grid' + (state.mixed ? ' is-ghost' : '') });
    const { fences } = S.iqrFlags(rows);
    let railCount = 0;
    for (const name of groupNames) {
      const rail = toleranceRail(state, name, fences, groupNames, f, fresh);
      if (rail) {
        railGrid.append(rail);
        railCount++;
      }
    }
    if (railCount) {
      railRoot.append(
        h(
          'div',
          { class: 'rail-tools' },
          bookBtn('outlier-rule', 'IQR 规则提示'),
          h('span', { class: 'ss-note', text: '把每件样本放回它所在组的容差区间对照；点击轨道选择最近的样本。' })
        )
      );
      railRoot.append(railGrid);
    } else {
      railRoot.append(h('p', { class: 'ss-note' }, '当前没有可对照的分组容差。'));
    }
  }
}

// ---------- 容差轨 ----------

function toleranceRail(state, groupName, fences, groupNames, f, fresh) {
  const fence = fences.find((x) => x.name === groupName);
  const members = state.rows.filter((r) => r.group === groupName);
  if (!fence || fence.skipped || !members.length) return null;

  const vals = members.map((r) => r.value);
  const A = Math.min(fence.lo, ...vals);
  const B = Math.max(fence.hi, ...vals);
  const pad = Math.max(0.5, (B - A) * 0.05);
  const lo = A - pad;
  const hi = B + pad;
  const X = (v) => ((v - lo) / (hi - lo)) * 100;

  const outside = members.filter((r) => r.value < fence.lo || r.value > fence.hi);
  const rail = h('div', { class: 'rail' });

  const head = h('div', { class: 'rail-head' });
  head.append(
    h('span', { class: `legend-dot ${seriesClass(groupNames, groupName)}` }),
    h('span', { class: 'rail-name', text: groupName }),
    h('span', { class: 'rail-state' + (outside.length ? ' is-out' : ''), text: outside.length ? `${outside.length} 件超出容差` : '全部在容差内' })
  );
  rail.append(head);

  const track = h('div', { class: 'rail-track' });
  track.append(h('div', { class: 'rail-band', style: `left:${X(fence.lo)}%;width:${X(fence.hi) - X(fence.lo)}%` }));
  for (const r of members) {
    const out = r.value < fence.lo || r.value > fence.hi;
    const sel = f?.kind === 'obs' && f.id === r.id;
    const mark = h('span', {
      class: 'rail-mark' + (out ? ' is-out' : '') + (sel ? ' is-focus' : ''),
      style: `left:${Math.min(99, Math.max(1, X(r.value)))}%`,
      title: `样本 ${r.id}：成绩 ${fmt(r.value)}（容差区间 [${fmt(fence.lo)}, ${fmt(fence.hi)}]）`,
    });
    if (sel && fresh) {
      mark.classList.remove('pulse');
      void mark.offsetWidth;
      mark.classList.add('pulse');
    }
    track.append(mark);
  }
  // 大命中区：点击选择最近的样本
  track.addEventListener('click', (ev) => {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return;
    const t = (ev.clientX - rect.left) / rect.width;
    const v = lo + t * (hi - lo);
    let best = members[0];
    for (const r of members) if (Math.abs(r.value - v) < Math.abs(best.value - v)) best = r;
    store.setFocus({ kind: 'obs', id: best.id });
  });
  rail.append(track);

  const axis = h('div', { class: 'rail-axis' });
  axis.append(
    h('span', { class: 'num', text: fmt(fence.lo) }),
    h('span', { class: 'rail-axis-label', text: '容差区间（1.5×IQR 栅栏）' }),
    h('span', { class: 'num', text: fmt(fence.hi) })
  );
  rail.append(axis);

  if (f?.kind === 'obs') {
    const r = members.find((x) => x.id === f.id);
    if (r) {
      const outMargin = r.value < fence.lo ? r.value - fence.lo : r.value > fence.hi ? r.value - fence.hi : null;
      const text =
        outMargin == null
          ? `选中样本 ${r.id}：余量 ${fmt(Math.min(r.value - fence.lo, fence.hi - r.value))}（最近栅栏的距离）`
          : `选中样本 ${r.id}：超出栅栏 ${fmt(Math.abs(outMargin))}（规则提示，不代表数据错误）`;
      rail.append(h('div', { class: 'rail-margin' + (outMargin == null ? '' : ' is-out'), text }));
    }
  }
  return rail;
}

// ---------- 构件 ----------

function capsuleCell(label, value) {
  const cell = h('div', { class: 'capsule-cell' });
  cell.append(h('span', { class: 'capsule-label', text: label }), h('span', { class: 'capsule-value', text: value }));
  return cell;
}

function tile({ label, value, focus, key, f, fresh, book, sm }) {
  const labelEl = h('div', { class: 'tile-label' });
  labelEl.append(document.createTextNode(label));
  if (book) labelEl.append(bookBtn(book[0], book[1]));

  const valueEl = h('div', { class: 'tile-value' + (focus ? ' clickable' : ''), text: value });
  if (focus) {
    valueEl.title = '点击追踪这个数在规程中的来源';
    valueEl.addEventListener('click', () => store.setFocus(focus));
  }

  const el = h('div', { class: 'stat-tile' + (sm ? ' sm' : '') }, labelEl, valueEl);
  if (key && f?.kind === 'term' && f.target === key) {
    el.classList.add('is-focus');
    if (fresh) pulse(el);
  }
  return el;
}

function bookBtn(cardId, title) {
  return h('button', { class: 'book-btn', title: `打开知识卡：${title}`, onclick: () => store.setCard(cardId) }, '📖');
}
