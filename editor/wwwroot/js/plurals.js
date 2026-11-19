// Plural-Forms header support: "nplurals=2; plural=(n > 1);"
//
// The expression is a C-like integer expression in `n`. It is parsed with a small
// recursive-descent parser instead of eval, with the same limits as the repository's
// plural_forms.py validator.

const MAX_FORMS = 100;
const MAX_LENGTH = 1024;
const MAX_DEPTH = 64;

const TOKEN = /\s*(\d+|n|\|\||&&|==|!=|<=|>=|[?:()!<>%+\-*/])/y;

function tokenize(expression) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < expression.length) {
    if (/^\s*$/.test(expression.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(expression);
    if (!m) throw new Error(`Unexpected character in plural expression at position ${pos + 1}`);
    tokens.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return tokens;
}

function compile(expression) {
  const tokens = tokenize(expression);
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const take = (expected) => {
    if (expected !== undefined && tokens[pos] !== expected) throw new Error(`Expected "${expected}" in plural expression`);
    return tokens[pos++];
  };
  const nested = (fn) => {
    if (++depth > MAX_DEPTH) throw new Error('Plural expression is nested too deeply');
    const result = fn();
    depth--;
    return result;
  };
  const binary = (next, ops) => () => {
    let left = next();
    while (ops[peek()]) {
      const apply = ops[take()];
      const l = left;
      const r = next();
      left = (n) => apply(l(n), r(n));
    }
    return left;
  };

  const primary = () => nested(() => {
    const token = take();
    if (token === 'n') return (n) => n;
    if (token === '(') {
      const inner = ternary();
      take(')');
      return inner;
    }
    if (token !== undefined && /^\d+$/.test(token)) {
      const value = Number(token);
      return () => value;
    }
    throw new Error(token === undefined ? 'Plural expression ends unexpectedly' : `Unexpected "${token}" in plural expression`);
  });
  const unary = () => nested(() => {
    if (peek() === '!') { take(); const v = unary(); return (n) => (v(n) ? 0 : 1); }
    if (peek() === '-') { take(); const v = unary(); return (n) => -v(n); }
    return primary();
  });
  const mul = binary(unary, {
    '*': (a, b) => a * b,
    '/': (a, b) => (b === 0 ? 0 : Math.trunc(a / b)),
    '%': (a, b) => (b === 0 ? 0 : a % b),
  });
  const add = binary(mul, { '+': (a, b) => a + b, '-': (a, b) => a - b });
  const rel = binary(add, {
    '<': (a, b) => (a < b ? 1 : 0),
    '>': (a, b) => (a > b ? 1 : 0),
    '<=': (a, b) => (a <= b ? 1 : 0),
    '>=': (a, b) => (a >= b ? 1 : 0),
  });
  const eq = binary(rel, { '==': (a, b) => (a === b ? 1 : 0), '!=': (a, b) => (a !== b ? 1 : 0) });
  const and = binary(eq, { '&&': (a, b) => (a && b ? 1 : 0) });
  const or = binary(and, { '||': (a, b) => (a || b ? 1 : 0) });
  function ternary() {
    return nested(() => {
      const condition = or();
      if (peek() !== '?') return condition;
      take('?');
      const yes = ternary();
      take(':');
      const no = ternary();
      return (n) => (condition(n) ? yes(n) : no(n));
    });
  }

  const root = ternary();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos]}" in plural expression`);
  return root;
}

/**
 * Parses a Plural-Forms header value.
 * Returns { nplurals, expression, select(n) } where select gives the form index for n.
 */
export function parsePluralForms(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing Plural-Forms header');
  if (value.length > MAX_LENGTH) throw new Error('Plural-Forms header is too long');
  const m = /^\s*nplurals\s*=\s*(\d+)\s*;\s*plural\s*=\s*([^;]+?)\s*;?\s*$/.exec(value);
  if (!m) throw new Error('Plural-Forms must look like "nplurals=2; plural=(n != 1);"');
  const nplurals = Number(m[1]);
  if (nplurals < 1 || nplurals > MAX_FORMS) throw new Error(`nplurals must be between 1 and ${MAX_FORMS}`);
  const evaluate = compile(m[2]);
  return {
    nplurals,
    expression: m[2],
    select(n) {
      const index = Number(evaluate(n));
      return Number.isInteger(index) && index >= 0 && index < nplurals ? index : -1;
    },
  };
}

/** Reads a "range: a..b" flag (the numbers a plural entry can be used with). */
export function parseRange(flags) {
  for (const flag of flags ?? []) {
    const m = /^range:\s*(\d+)\.\.(\d+)$/.exec(flag);
    if (m && Number(m[1]) <= Number(m[2])) return { from: Number(m[1]), to: Number(m[2]) };
  }
  return null;
}

/** For each form, the numbers in [from, to] that select it. */
export function formNumbers(forms, range) {
  const from = range ? range.from : 0;
  const to = Math.min(range ? range.to : 200, from + 1000);
  const result = Array.from({ length: forms.nplurals }, () => []);
  for (let n = from; n <= to; n++) {
    const index = forms.select(n);
    if (index >= 0) result[index].push(n);
  }
  return result;
}

/** "0, 3–10, 103–110, …" */
export function formatNumbers(numbers, maxGroups = 4) {
  if (!numbers.length) return '';
  const groups = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (let i = 1; i <= numbers.length; i++) {
    const n = numbers[i];
    if (n === previous + 1) { previous = n; continue; }
    groups.push(start === previous ? `${start}` : previous === start + 1 ? `${start}, ${previous}` : `${start}–${previous}`);
    start = previous = n;
  }
  return groups.length > maxGroups ? groups.slice(0, maxGroups).join(', ') + ', …' : groups.join(', ');
}

/** One label per form, e.g. ["n = 1", "n = 2–4, 22–24, …", ...]. */
export function describeForms(forms, range) {
  return formNumbers(forms, range).map((numbers) => {
    const text = formatNumbers(numbers);
    if (text) return `n = ${text}`;
    return range ? `not used for ${range.from}..${range.to}` : 'other numbers';
  });
}
