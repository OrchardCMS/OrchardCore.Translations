// Tiny test harness that runs unchanged in Node and in the browser.

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

export function equal(actual, expected, message = '') {
  if (actual === expected) return;
  const show = (v) => {
    const s = typeof v === 'string' ? JSON.stringify(v) : String(v);
    return s.length > 300 ? s.slice(0, 300) + '…' : s;
  };
  throw new Error(`${message ? message + ': ' : ''}expected ${show(expected)}, got ${show(actual)}`);
}

export function deepEqual(actual, expected, message = '') {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

export function throws(fn, message = 'expected an error') {
  try { fn(); } catch { return; }
  throw new Error(message);
}

/**
 * Runs every registered test. `env` gives access to the repository files:
 *   env.templates            → ['OrchardCore.Admin', ...]
 *   env.cultures             → { fr: ['OrchardCore.Admin', ...], ... }
 *   env.read(path)           → Promise<string|null>  (path relative to the repo root)
 *   env.index                → parsed data/index.json, or null
 *   env.gitApplyCheck(patch) → Promise<string|null>  error text, or null when it applies (Node only)
 */
export async function run(env, report = () => {}) {
  const results = [];
  for (const { name, fn } of tests) {
    const started = Date.now();
    let error = null;
    let note = '';
    try {
      note = (await fn(env)) ?? '';
    } catch (e) {
      error = e;
    }
    const result = { name, ok: !error, error, note, ms: Date.now() - started };
    results.push(result);
    report(result);
  }
  return results;
}
