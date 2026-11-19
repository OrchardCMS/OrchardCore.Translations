// Small DOM helpers; the editor has no framework.

function append(parent, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** h('a', { class: 'x', href: '#', onclick: fn }, 'text', child, [more]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else if (name.includes('-') || !(name in el)) el.setAttribute(name, value === true ? '' : value);
    else el[name] = value;
  }
  append(el, children);
  return el;
}

export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const numbers = new Intl.NumberFormat('en');
export const fmt = (n) => numbers.format(n);

/** count(1, 'file') → "1 file", count(2, 'entry', 'entries') → "2 entries" */
export const count = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;

export function percent(part, total) {
  if (!total) return '–';
  const value = (part / total) * 100;
  if (value > 0 && value < 1) return '<1%';
  if (value > 99 && value < 100) return '>99%';
  return `${Math.round(value)}%`;
}

/** Stacked progress bar: translated, untranslated in the file, missing from the file. */
export function progressBar({ translated, untranslated, missing, total }) {
  const width = (n) => `${total ? (n / total) * 100 : 0}%`;
  return h('div', { class: 'bar', title: `${fmt(translated)} translated, ${fmt(untranslated)} untranslated, ${fmt(missing)} missing, of ${fmt(total)}` },
    h('span', { class: 'seg seg-translated', style: `width:${width(translated)}` }),
    h('span', { class: 'seg seg-untranslated', style: `width:${width(untranslated)}` }),
    h('span', { class: 'seg seg-missing', style: `width:${width(missing)}` }));
}

export function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Shows text with leading/trailing spaces, tabs and line breaks made visible. */
export function visibleText(text) {
  const out = document.createDocumentFragment();
  const mark = (symbol, title) => h('span', { class: 'ws', title }, symbol);
  const lead = /^ +/.exec(text)?.[0].length ?? 0;
  const trail = lead === text.length ? 0 : /[ ]+$/.exec(text)?.[0].length ?? 0;
  for (let i = 0; i < lead; i++) out.append(mark('·', 'space'));
  let buffer = '';
  const flush = () => { if (buffer) { out.append(buffer); buffer = ''; } };
  for (const ch of text.slice(lead, text.length - trail)) {
    if (ch === '\n') { flush(); out.append(mark('↵', 'line break'), '\n'); }
    else if (ch === '\t') { flush(); out.append(mark('→', 'tab')); }
    else buffer += ch;
  }
  flush();
  for (let i = 0; i < trail; i++) out.append(mark('·', 'space'));
  return out;
}
