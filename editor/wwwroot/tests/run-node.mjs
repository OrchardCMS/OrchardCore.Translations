// Runs the editor tests against the repository checkout:
//   node editor/wwwroot/tests/run-node.mjs [--index _site/data/index.json]
// No npm packages are needed.

import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from './harness.js';
import './core.test.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const localization = path.join(root, 'Localization');

const args = process.argv.slice(2);
const indexArg = args.indexOf('--index');
const index = indexArg >= 0 ? JSON.parse(await readFile(args[indexArg + 1], 'utf8')) : null;

const templates = [];
const cultures = {};
for (const entry of await readdir(localization, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.pot')) templates.push(entry.name.slice(0, -4));
  if (entry.isDirectory()) {
    cultures[entry.name] = (await readdir(path.join(localization, entry.name)))
      .filter((name) => name.endsWith('.po'))
      .map((name) => name.slice(0, -3))
      .sort();
  }
}
templates.sort();

const scratch = await mkdtemp(path.join(tmpdir(), 'po-editor-tests-'));
let patchNumber = 0;

const env = {
  templates,
  cultures,
  index,
  async read(relative) {
    try {
      return await readFile(path.join(root, relative), 'utf8');
    } catch {
      return null;
    }
  },
  async gitApplyCheck(patch) {
    const file = path.join(scratch, `${++patchNumber}.patch`);
    await writeFile(file, patch);
    return new Promise((resolve) => {
      execFile('git', ['-C', root, 'apply', '--check', file], (error, stdout, stderr) => resolve(error ? stderr || error.message : null));
    });
  },
};

const results = await run(env, (r) => {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.note ? ` (${r.note})` : ''} [${r.ms} ms]`);
  if (!r.ok) console.log('     ' + String(r.error?.stack ?? r.error).split('\n').join('\n     '));
});
await rm(scratch, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
