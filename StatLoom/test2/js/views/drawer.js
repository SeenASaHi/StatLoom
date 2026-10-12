// drawer.js — 知识库窗口（次级窗口）
// 「目录 + 内容」两栏：目录按类别收录全部知识卡；从对象旁 📖 锚点进入时定位到对应卡片。
// 概念与方法的解释始终与当前数据保持关联；数值实例随数据实时更新。

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
  head.append(h('h3', null, '知识库 ', h('span', { class: 'micro' }, 'KNOWLEDGE BASE')));
  head.append(h('button', { class: 'drawer-close', title: '关闭（Esc）', 'aria-label': '关闭知识库', onclick: () => store.setCard(null) }, '×'));
  root.append(head);

  const hint = G.hintEl(state, 'knowledge', '知识库收录全部概念与方法卡：左侧目录可以自由浏览；从对象旁的 📖 进入时会定位到对应卡片。');
  if (hint) root.append(hint);

  const kb = h('div', { class: 'kb' });

  // ---- 目录 ----
  const index = h('nav', { class: 'kb-index', 'aria-label': '知识库目录' });
  const groups = [...new Set(Object.values(CARDS).map((c) => c.category ?? '其他'))];
  for (const g of groups) {
    index.append(h('div', { class: 'kb-group micro' }, g));
    for (const [id, c] of Object.entries(CARDS)) {
      if ((c.category ?? '其他') !== g) continue;
      const active = id === state.card;
      index.append(
        h(
          'button',
          {
            class: 'kb-item' + (active ? ' is-active' : ''),
            'aria-current': active ? 'true' : 'false',
            title: c.brief ?? '',
            onclick: () => store.setCard(id),
          },
          c.title
        )
      );
    }
  }
  kb.append(index);

  // ---- 内容 ----
  const content = h('div', { class: 'kb-content' });
  content.append(h('h4', { class: 'kb-title' }, card.title));
  if (card.brief) content.append(h('p', { class: 'kb-brief' }, card.brief));

  for (const sec of card.sections ?? []) {
    const det = h('details', { class: 'card-section' });
    if (sec.open) det.open = true;
    det.append(h('summary', null, sec.h));
    if (sec.p) det.append(h('p', null, sec.p));
    if (sec.formula) det.append(h('div', { class: 'formula' }, sec.formula));
    content.append(det);
  }

  if (card.instance) content.append(h('div', { class: 'card-instance' }, card.instance()));

  if (card.links?.length) {
    const row = h('div', { class: 'card-links' });
    for (const l of card.links) {
      row.append(h('button', { class: 'btn btn-small', onclick: () => (l.card ? store.setCard(l.card) : l.fn?.()) }, l.label));
    }
    content.append(row);
  }

  content.append(
    h('p', { class: 'drawer-foot' }, '卡片说明：文字为系统整理的知识说明；数值实例由当前数据实时计算，与推导步骤相互独立。')
  );
  kb.append(content);
  root.append(kb);
}
