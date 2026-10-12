// drawer.js — 知识卡片抽屉
// 与当前公式、统计量、概念直接关联；分层展开；数值实例随数据实时更新。

import * as store from './../store.js';
import * as G from './../guidance.js';
import { CARDS } from './../content/cards.js';
import { h, clear } from './../util.js';

let root = null;

export function init(container) {
  root = container;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') store.setCard(null);
  });
}

export function render(state) {
  if (!root) return;
  const card = state.card ? CARDS[state.card] : null;
  root.classList.toggle('open', !!card);
  root.setAttribute('aria-hidden', card ? 'false' : 'true');
  clear(root);
  if (!card) return;

  const head = h('div', { class: 'drawer-head' });
  head.append(h('h3', null, card.title));
  head.append(h('button', { class: 'drawer-close', title: '关闭（Esc）', onclick: () => store.setCard(null) }, '×'));
  root.append(head);

  const hint = G.hintEl(state, 'knowledge', '卡片与当前数据保持关联：数值实例会随数据更新；章节可以逐层展开。');
  if (hint) root.append(hint);

  for (const sec of card.sections ?? []) {
    const det = h('details', { class: 'card-section' });
    if (sec.open) det.open = true;
    det.append(h('summary', null, sec.h));
    if (sec.p) det.append(h('p', null, sec.p));
    if (sec.formula) det.append(h('div', { class: 'formula' }, sec.formula));
    root.append(det);
  }

  if (card.instance) {
    root.append(h('div', { class: 'card-instance' }, card.instance()));
  }

  if (card.links?.length) {
    const row = h('div', { class: 'card-links' });
    for (const l of card.links) {
      row.append(h('button', { class: 'btn btn-small', onclick: () => (l.card ? store.setCard(l.card) : l.fn?.()) }, l.label));
    }
    root.append(row);
  }

  root.append(
    h('p', { class: 'drawer-foot' }, '卡片说明：文字为系统整理的知识说明；数值实例由当前数据实时计算，与推导步骤相互独立。')
  );
}
