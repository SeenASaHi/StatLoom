// 来源检查器（F07）：类型/状态+理由、定义与实例（KaTeX）、当前值、输入来源（含输入版本）、
// 被谁引用（下游 + Representation 登记项，不受关系图过滤影响）、可用操作。
// 折叠与过滤不改变本列表；这是双向追溯的检查面。

import type { DerivedObject, Status } from '../kernel/types';
import type { Store, StoreSnapshot } from '../state/store';
import { definitionLatexOf, elementBindingsOf, instanceLatexOf, renderKatex, shortLabel } from './formula';
import { fmt } from './scale';
import type { RepRegistry } from './reps';

const KIND_LABELS: Record<string, string> = {
  'def:count': '组计数',
  'def:meanGroup': '组均值',
  'def:meanGrand': '总体均值',
  'def:deviation': '偏差',
  'def:devSq': '平方偏差',
  'def:gdev': '组均值偏差',
  'def:gdevSq': '组均值平方偏差',
  'def:ssw': '组内平方和',
  'def:ssb': '组间平方和',
  'def:sst': '总平方和',
  'def:identity': '恒等式校验',
};

const STATUS_LABELS: Record<Status, string> = {
  valid: '有效',
  pending: '待计算',
  undefined: '未定义',
  invalid: '冲突',
  error: '错误',
};

const REP_KIND_LABELS: Record<string, string> = {
  point: '数据点',
  'mean-line': '均值线',
  'deviation-segment': '偏差线段',
  'square-block': '平方块',
  'reading-row': '读数行',
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function badge(status: Status): string {
  return `<span class="badge ${status}">${STATUS_LABELS[status]}</span>`;
}

export function mountInspector(root: HTMLElement, store: Store, reps: RepRegistry): { render(snap: StoreSnapshot): void } {
  root.addEventListener('click', (ev) => {
    const t = ev.target as Element;
    const goto = t.closest('[data-goto]');
    if (goto !== null) {
      store.setUi({ selectedId: goto.getAttribute('data-goto') });
      return;
    }
    const act = t.closest('[data-act]');
    if (act === null) return;
    const name = act.getAttribute('data-act') as string;
    const target = act.getAttribute('data-target') as string;
    const snap = store.getSnapshot();
    switch (name) {
      case 'move-group': {
        const sel = root.querySelector<HTMLSelectElement>('#moveGroupSel');
        if (sel !== null && sel.value !== '') store.dispatch({ type: 'setGroup', obsId: target, groupId: sel.value });
        return;
      }
      case 'remove-obs':
        store.dispatch({ type: 'removeObservation', obsId: target });
        return;
      case 'set-value': {
        const input = root.querySelector<HTMLInputElement>('#valueInput');
        if (input !== null) store.dispatch({ type: 'setValue', obsId: target, value: Number(input.value) });
        return;
      }
      case 'add-obs': {
        const mean = snap.effective.objects.get(`mean:${target}`)?.value ?? 0;
        const res = store.dispatch({ type: 'addObservation', groupId: target, value: Math.round(mean * 100) / 100 });
        if (res.ok) {
          const last = store.getSnapshot().source.dataset.observations.at(-1);
          if (last !== undefined) store.setUi({ selectedId: last.id });
        }
        return;
      }
      case 'rename-group': {
        const g = snap.source.dataset.groups.find((x) => x.id === target);
        const name = window.prompt('组名', g?.name ?? '');
        if (name !== null) store.dispatch({ type: 'renameGroup', groupId: target, name });
        return;
      }
      case 'remove-group':
        store.dispatch({ type: 'removeGroup', groupId: target });
        return;
      case 'goto-first-input': {
        const obj = snap.effective.objects.get(target);
        if (obj !== undefined && obj.inputs.length > 0) store.setUi({ selectedId: obj.inputs[0] as string });
        return;
      }
    }
  });

  function render(snap: StoreSnapshot): void {
    const { ui, effective, source } = snap;
    const id = ui.selectedId;
    if (id === null) {
      root.innerHTML = `<div class="panel"><div class="panel-body empty-hint">
        在画布、关系图、公式项或读数行上选择任意对象，这里显示它的定义、当前值、输入来源与引用关系。
      </div></div>`;
      return;
    }

    const lookup = (x: string): DerivedObject | undefined => effective.objects.get(x);

    // ---- 派生对象 ----
    const obj = effective.objects.get(id);
    if (obj !== undefined) {
      const kind = KIND_LABELS[obj.defId] ?? obj.defId;
      const current =
        obj.class === 'constraint'
          ? formatConstraintValue(obj)
          : obj.status === 'valid' && obj.value !== undefined
            ? `${obj.value.toFixed(2)}<span class="unit">数值</span>`
            : '—';

      const inputsHtml = obj.inputs
        .slice(0, 16)
        .map((inputId) => {
          const io = effective.objects.get(inputId);
          const src = sourceObjectStatus(snap, inputId);
          const status = io?.status ?? src.status;
          const ver = obj.inputsRevision[inputId];
          return `<li>
            <button class="ref-link" data-goto="${esc(inputId)}" data-key="in:${esc(inputId)}">${esc(inputId)}</button>
            ${badge(status)}
            <span class="rev">v${String(ver ?? '?')}</span>
          </li>`;
        })
        .join('');
      const moreIn = obj.inputs.length > 16 ? `<li class="empty-hint">…共 ${obj.inputs.length} 项输入</li>` : '';

      const dependents = [...effective.objects.values()].filter((o) => o.inputs.includes(id));
      const depsHtml = dependents
        .map(
          (d) =>
            `<li><button class="ref-link" data-goto="${esc(d.id)}" data-key="dep:${esc(d.id)}">${esc(d.id)}</button><span class="rev">${esc(KIND_LABELS[d.defId] ?? '')}</span></li>`,
        )
        .join('');
      const repsHtml = reps
        .get(id)
        .map((r) => `<span class="chip" title="${esc(r.elementKey)}">${esc(viewName(r.viewId))} · ${esc(REP_KIND_LABELS[r.kind] ?? r.kind)}</span>`)
        .join('');

      const elements = elementBindingsOf(obj, source, lookup);
      const elementHtml =
        elements.length > 0
          ? `<h4>逐项明细（${elements.length} 项）</h4>
             <div>${elements
               .slice(0, 12)
               .map(
                 (el) =>
                   `<span class="chip" data-goto="${esc(el.targetId)}" data-key="el:${esc(el.targetId)}" title="${esc(el.targetId)}">${esc(shortLabel(el.targetId))} → ${fmt(el.value)}</span>`,
               )
               .join('')}${elements.length > 12 ? `<span class="empty-hint">…共 ${elements.length} 项</span>` : ''}</div>`
          : '';

      root.innerHTML = `
        <div class="insp">
          <div class="obj-head">
            <span class="obj-id">${esc(obj.id)}</span>
            <span class="obj-kind">${esc(kind)}</span>
            ${badge(obj.status)}
          </div>
          ${obj.status !== 'valid' && obj.reason !== undefined ? `<div class="reason">${esc(obj.reason.message)}</div>` : ''}
          <div class="panel"><div class="panel-body">
            <h4>定义（结构化表达式）</h4>
            <div class="formula">${renderKatex(definitionLatexOf(obj, source, lookup))}</div>
            <h4>当前实例</h4>
            <div class="formula">${renderKatex(instanceLatexOf(obj, source, lookup))}</div>
            ${elementHtml}
          </div></div>
          <div class="panel"><div class="panel-body">
            <h4>当前值</h4>
            <div class="value-line" data-key="value:${esc(obj.id)}">${current}</div>
            ${obj.class === 'constraint' && obj.residual !== undefined ? `<div class="reason">原始残差（未格式化）：${String(obj.residual)}</div>` : ''}
          </div></div>
          <div class="panel"><div class="panel-body">
            <h4>输入来源（含输入版本）</h4>
            <ul class="ref-list">${inputsHtml}${moreIn}</ul>
          </div></div>
          <div class="panel"><div class="panel-body">
            <h4>被谁引用（下游 ${dependents.length}）</h4>
            <ul class="ref-list">${depsHtml !== '' ? depsHtml : '<li class="empty-hint">无下游对象</li>'}</ul>
            <h4>视觉表示（登记项；不受关系图过滤影响）</h4>
            <div>${repsHtml !== '' ? repsHtml : '<span class="empty-hint">当前没有视觉元素引用它</span>'}</div>
          </div></div>
          <div class="panel"><div class="panel-body">
            <h4>可用操作</h4>
            <div class="actions">
              ${obj.inputs.length > 0 ? `<button data-act="goto-first-input" data-target="${esc(obj.id)}">跳转到首个输入</button>` : ''}
            </div>
            <div class="reason">派生对象由定义与输入决定：修改它的输入或数据即可改变它。</div>
          </div></div>
        </div>`;
      return;
    }

    // ---- 观测 ----
    const obs = source.dataset.observations.find((o) => o.id === id);
    if (obs !== undefined) {
      const group = source.dataset.groups.find((g) => g.id === obs.groupId);
      const dependents = [...effective.objects.values()].filter((o) => o.inputs.includes(id));
      const repsHtml = reps.get(id).map((r) => `<span class="chip">${esc(viewName(r.viewId))} · ${esc(REP_KIND_LABELS[r.kind] ?? r.kind)}</span>`).join('');
      const options = source.dataset.groups
        .filter((g) => g.id !== obs.groupId)
        .map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`)
        .join('');
      root.innerHTML = `
        <div class="insp">
          <div class="obj-head">
            <span class="obj-id">${esc(obs.id)}</span>
            <span class="obj-kind">观测（源对象）</span>
            ${badge('valid')}
          </div>
          <div class="panel"><div class="panel-body">
            <h4>当前值</h4>
            <div class="value-line">${obs.value.toFixed(2)}<span class="unit">数值 · v${obs.version}</span></div>
            <h4>所属组</h4>
            <div><button class="ref-link" data-goto="${esc(obs.groupId)}">${esc(group?.name ?? obs.groupId)}</button></div>
          </div></div>
          <div class="panel"><div class="panel-body">
            <h4>可用操作</h4>
            <div class="actions">
              <input id="valueInput" type="number" step="0.5" value="${obs.value}" aria-label="新数值" style="width:110px;font-family:var(--sl-font-mono)"/>
              <button data-act="set-value" data-target="${esc(obs.id)}">提交新值</button>
              <select id="moveGroupSel" aria-label="目标组">${options}</select>
              <button data-act="move-group" data-target="${esc(obs.id)}">移到另一组</button>
              <button data-act="remove-obs" data-target="${esc(obs.id)}">删除观测</button>
            </div>
          </div></div>
          <div class="panel"><div class="panel-body">
            <h4>被谁引用（下游 ${dependents.length}）</h4>
            <ul class="ref-list">${dependents
              .map((d) => `<li><button class="ref-link" data-goto="${esc(d.id)}">${esc(d.id)}</button></li>`)
              .join('')}</ul>
            <h4>视觉表示</h4>
            <div>${repsHtml}</div>
          </div></div>
        </div>`;
      return;
    }

    // ---- 组 ----
    const group = source.dataset.groups.find((g) => g.id === id);
    if (group !== undefined) {
      const members = source.dataset.observations.filter((o) => o.groupId === id);
      const meanObj = effective.objects.get(`mean:${id}`);
      root.innerHTML = `
        <div class="insp">
          <div class="obj-head">
            <span class="obj-id">${esc(group.id)}</span>
            <span class="obj-kind">组（源对象）</span>
            ${badge(members.length > 0 ? 'valid' : 'undefined')}
          </div>
          ${members.length === 0 ? '<div class="reason">空组：没有观测。组均值在空集合上未定义；该组不参与 SS_B。</div>' : ''}
          <div class="panel"><div class="panel-body">
            <h4>规模与均值</h4>
            <div class="value-line">n = ${members.length}${meanObj !== undefined && meanObj.value !== undefined ? `<span class="unit">组均值 ${fmt(meanObj.value)}</span>` : ''}</div>
            <h4>成员观测</h4>
            <div>${members.map((o) => `<span class="chip" data-goto="${esc(o.id)}">${esc(o.id)} = ${o.value.toFixed(2)}</span>`).join('') || '<span class="empty-hint">无成员</span>'}</div>
          </div></div>
          <div class="panel"><div class="panel-body">
            <h4>可用操作</h4>
            <div class="actions">
              <button data-act="add-obs" data-target="${esc(group.id)}">添加观测到本组</button>
              <button data-act="rename-group" data-target="${esc(group.id)}">重命名</button>
              <button data-act="remove-group" data-target="${esc(group.id)}" ${members.length > 0 ? 'disabled title="组非空：先移走或删除观测"' : ''}>删除组</button>
            </div>
          </div></div>
        </div>`;
      return;
    }

    // ---- 其他源对象（变量 / 数据集） ----
    const variable = source.dataset.variables.find((v) => v.id === id);
    const label =
      variable !== undefined
        ? `变量 ${esc(variable.name)}（${variable.kind === 'numeric' ? '数值' : '类别'} · ${variable.semantic === 'response' ? '响应' : '分组'}）`
        : source.dataset.id === id
          ? `数据集 ${esc(source.dataset.label)}（revision ${source.dataset.revision}）`
          : esc(id);
    root.innerHTML = `<div class="panel"><div class="panel-body"><h4>对象</h4><div>${label}</div>
      <div class="reason">本原型限制：每数据集恰好一个数值响应变量 + 一个类别分组变量。</div></div></div>`;
  }

  function formatConstraintValue(obj: DerivedObject): string {
    const r = obj.residual;
    if (obj.status === 'valid') return `0.00<span class="unit">残差 · 容差内</span>`;
    if (r !== undefined) return `${r.toExponential(3)}<span class="unit">残差</span>`;
    return '—';
  }

  function sourceObjectStatus(snap: StoreSnapshot, id: string): { status: Status } {
    const d = snap.source.dataset;
    if (d.observations.some((o) => o.id === id) || d.groups.some((g) => g.id === id) || d.variables.some((v) => v.id === id) || d.id === id) {
      return { status: 'valid' };
    }
    return { status: 'undefined' };
  }

  function viewName(viewId: string): string {
    return viewId === 'canvas' ? '观测画布' : viewId === 'readings' ? '读数条' : viewId;
  }

  return { render };
}
