// util.js — DOM 构建与显示辅助（无框架）

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c);
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// 数字显示：NaN 显示为 —，去掉多余的尾零
export function fmt(x, digits = 2) {
  if (x == null || !Number.isFinite(x)) return '—';
  let s = x.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

export function pulse(el) {
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

export function pulseSvg(el) {
  if (!el) return;
  el.classList.remove('pulse-svg');
  void el.getBoundingClientRect();
  el.classList.add('pulse-svg');
}

// 组名 → 序列样式类（固定顺序，前两组用序列 1/2，其余退化为中性）
export function seriesClass(groupNames, name) {
  const i = groupNames.indexOf(name);
  return i === 0 ? 's1' : i === 1 ? 's2' : 'p';
}

export function scrollToEl(id) {
  document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---------- 工具提示（单例） ----------

let tipEl = null;

export function initTooltip() {
  tipEl = document.getElementById('tooltip');
}

export function showTooltip(html, clientX, clientY) {
  if (!tipEl) return;
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const pad = 14;
  const rect = tipEl.getBoundingClientRect();
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = clientY - rect.height - pad;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  tipEl.style.transform = `translate(${x}px, ${y}px)`;
}

export function hideTooltip() {
  if (tipEl) tipEl.hidden = true;
}
