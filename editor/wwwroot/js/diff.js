// Line diff (Myers) and git-style unified patches.

import { splitLines } from './po.js';

const MAX_EDITS = 2500;

const toLines = (text) => (text ? splitLines(text).map((l) => l.text + l.eol) : []);

/** Shortest edit script between two line arrays, or null when it would exceed maxEdits. */
function myers(a, b, maxEdits) {
  const N = a.length;
  const M = b.length;
  const max = Math.min(N + M, maxEdits);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) return backtrack(trace, a, b, d);
    }
  }
  return null;
}

function backtrack(trace, a, b, depth) {
  const ops = [];
  let x = a.length;
  let y = b.length;
  for (let d = depth; d > 0; d--) {
    const snapshot = trace[d];
    const at = (k) => snapshot[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push([' ', a[x - 1]]); x--; y--; }
    if (x === prevX) ops.push(['+', b[y - 1]]);
    else ops.push(['-', a[x - 1]]);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { ops.push([' ', a[x - 1]]); x--; y--; }
  return ops.reverse();
}

const replaceAll = (a, b) => [...a.map((l) => ['-', l]), ...b.map((l) => ['+', l])];

function lineScript(a, b) {
  if (!a.length || !b.length) return replaceAll(a, b);
  return myers(a, b, MAX_EDITS) ?? replaceAll(a, b);
}

/** Groups lines into paragraphs: runs of lines ending with a blank line. */
function paragraphs(lines) {
  const result = [];
  let current = [];
  for (const line of lines) {
    current.push(line);
    if (line.trim() === '') { result.push(current); current = []; }
  }
  if (current.length) result.push(current);
  return result;
}

/**
 * Diffs paragraph by paragraph first (a PO entry is a paragraph), then line by line
 * inside each changed region. Bulk changes touch thousands of lines but few
 * paragraphs, so this stays fast and keeps untouched entries as context.
 */
function paragraphScript(a, b) {
  const pa = paragraphs(a);
  const pb = paragraphs(b);
  const script = myers(pa.map((p) => p.join('')), pb.map((p) => p.join('')), MAX_EDITS);
  if (!script) return replaceAll(a, b);
  const out = [];
  let ia = 0;
  let ib = 0;
  let removed = [];
  let added = [];
  const flush = () => {
    if (removed.length || added.length) out.push(...lineScript(removed, added));
    removed = [];
    added = [];
  };
  for (const [type] of script) {
    if (type === '-') removed.push(...pa[ia++]);
    else if (type === '+') added.push(...pb[ib++]);
    else {
      flush();
      for (const line of pa[ia]) out.push([' ', line]);
      ia++;
      ib++;
    }
  }
  flush();
  return out;
}

/** Returns [[type, line], ...] with type ' ', '-' or '+'. */
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const middle = paragraphScript(a.slice(start, endA), b.slice(start, endB));
  return [...a.slice(0, start).map((l) => [' ', l]), ...middle, ...a.slice(endA).map((l) => [' ', l])];
}

/** Groups a diff into hunks with `context` unchanged lines around each change. */
export function hunks(ops, context = 3) {
  const positions = [];
  let aLine = 0;
  let bLine = 0;
  for (const [type] of ops) {
    positions.push([aLine, bLine]);
    if (type !== '+') aLine++;
    if (type !== '-') bLine++;
  }
  // One [from, to) window per change, merged when windows touch.
  const ranges = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i][0] === ' ') continue;
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length, i + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  return ranges.map(([from, to]) => {
    const slice = ops.slice(from, to);
    return {
      aStart: positions[from][0],
      bStart: positions[from][1],
      aCount: slice.filter(([t]) => t !== '+').length,
      bCount: slice.filter(([t]) => t !== '-').length,
      ops: slice,
    };
  });
}

export function diffStat(oldText, newText) {
  let added = 0;
  let removed = 0;
  for (const [type] of diffLines(toLines(oldText), toLines(newText))) {
    if (type === '+') added++;
    else if (type === '-') removed++;
  }
  return { added, removed };
}

/** Hunks between two texts, for display. */
export const textHunks = (oldText, newText, context = 3) => hunks(diffLines(toLines(oldText), toLines(newText)), context);

/** The object id git gives a file with this content. */
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(head.length + body.length);
  bytes.set(head);
  bytes.set(body, head.length);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function formatHunk(hunk) {
  const start = (first, count) => (count === 0 ? first : first + 1);
  let out = `@@ -${start(hunk.aStart, hunk.aCount)},${hunk.aCount} +${start(hunk.bStart, hunk.bCount)},${hunk.bCount} @@\n`;
  for (const [type, line] of hunk.ops) {
    out += type + line;
    if (!line.endsWith('\n')) out += '\n\\ No newline at end of file\n';
  }
  return out;
}

/**
 * A `git apply`-compatible patch for one file. oldText is null for a new file.
 * Blob ids are included so `git apply --3way` can fall back to a merge.
 */
export async function filePatch(path, oldText, newText) {
  if (oldText === newText) return '';
  const created = oldText == null;
  const newSha = await gitBlobSha(newText);
  const oldSha = created ? '0'.repeat(40) : await gitBlobSha(oldText);
  let out = `diff --git a/${path} b/${path}\n`;
  if (created) out += 'new file mode 100644\n';
  out += created ? `index ${oldSha}..${newSha}\n` : `index ${oldSha}..${newSha} 100644\n`;
  out += `--- ${created ? '/dev/null' : 'a/' + path}\n+++ b/${path}\n`;
  for (const hunk of hunks(diffLines(toLines(oldText), toLines(newText)))) out += formatHunk(hunk);
  return out;
}
