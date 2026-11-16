// Pending changes: review, then save to the local folder or export a patch / zip.

import { h, replace, fmt, count, download } from '../dom.js';
import { drafts } from '../drafts.js';
import { allChanges } from '../workspace.js';
import { filePatch, textHunks } from '../diff.js';
import { createZip } from '../zip.js';

const REPOSITORY = 'https://github.com/OrchardCMS/OrchardCore.Translations';

function stamp() {
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

function renderDiff(change) {
  const container = h('div', { class: 'diff' });
  for (const hunk of textHunks(change.oldText ?? '', change.newText)) {
    container.append(h('div', { class: 'diff-hunk' }, `@@ -${hunk.aStart + 1},${hunk.aCount} +${hunk.bStart + 1},${hunk.bCount} @@`));
    for (const [type, line] of hunk.ops) {
      container.append(h('div', { class: type === '+' ? 'diff-add' : type === '-' ? 'diff-del' : 'diff-ctx' }, type + line.replace(/\r?\n$/, '')));
    }
  }
  return container;
}

export async function changesView(app, root, params, isCurrent) {
  app.setCrumbs({ text: 'Changes' });
  const progress = h('p', { class: 'muted' }, 'Preparing changes…');
  replace(root, progress);
  const total = drafts.list().length;
  let done = 0;
  const changes = await allChanges(app, () => { progress.textContent = `Preparing changes… ${++done}/${total}`; });
  if (!isCurrent()) return;

  const status = h('div', { class: 'notice', hidden: true });
  const say = (...content) => { status.hidden = false; replace(status, content); };

  if (!changes.length) {
    replace(root,
      h('div', { class: 'page-head' }, h('h1', {}, 'Changes')),
      h('p', { class: 'muted' }, 'No pending changes. Edit a translation and it shows up here.'),
      h('p', {}, h('a', { href: '#/' }, 'Back to all languages')));
    return;
  }

  const added = changes.reduce((sum, c) => sum + c.stat.added, 0);
  const removed = changes.reduce((sum, c) => sum + c.stat.removed, 0);
  const cultures = [...new Set(changes.map((c) => c.culture))];
  const baseName = `translations-${cultures.length <= 3 ? cultures.join('-') : `${cultures.length}-languages`}-${stamp()}`;

  async function saveToFolder() {
    let saved = 0;
    try {
      for (const change of changes) {
        await app.source.writePo(change.culture, change.name, change.newText);
        drafts.clear(change.culture, change.name);
        saved++;
      }
    } catch (e) {
      say(`Saved ${saved} of ${changes.length} files, then failed: ${e.message}`);
      return;
    }
    replace(root,
      h('div', { class: 'page-head' }, h('h1', {}, 'Changes')),
      h('div', { class: 'notice notice-ok' }, `Saved ${count(saved, 'file')} to “${app.source.handle.name}”. Review them with git diff, commit, and open a pull request.`),
      h('p', {}, h('a', { href: '#/' }, 'Back to all languages')));
  }

  async function downloadPatch() {
    let patch = '';
    for (const change of changes) patch += await filePatch(change.path, change.oldText, change.newText);
    const intro = `Translations exported from the Orchard Core translation editor.\n${app.info.commit ? `Base commit: ${app.info.commit}\n` : ''}Apply with: git apply --3way <this file>\n\n`;
    download(`${baseName}.patch`, intro + patch, 'text/x-diff');
    say(`Downloaded ${baseName}.patch. Your changes stay here until you discard them.`);
  }

  function downloadZip() {
    download(`${baseName}.zip`, createZip(changes.map((c) => ({ path: c.path, text: c.newText }))), 'application/zip');
    say(`Downloaded ${baseName}.zip. Unzip it at the root of your clone to overwrite the changed files.`);
  }

  function discardAll() {
    if (!confirm(`Discard the pending changes of ${count(changes.length, 'file')}? This cannot be undone.`)) return;
    drafts.clearAll();
    app.refresh();
  }

  const conflicts = changes.reduce((sum, c) => sum + c.conflicts, 0);
  const branch = `translations/${cultures.length === 1 ? cultures[0] : 'update'}`;

  replace(root,
    h('div', { class: 'page-head' },
      h('h1', {}, 'Changes'),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, count(changes.length, 'file')),
        h('span', { class: 'chip chip-translated' }, `+${fmt(added)}`),
        h('span', { class: 'chip chip-missing' }, `−${fmt(removed)}`))),
    conflicts ? h('div', { class: 'notice notice-error' }, `${count(conflicts, 'edited string was', 'edited strings were')} also changed in the files since you edited them. Your version wins when you save; open the file to compare.`) : null,
    h('div', { class: 'toolbar' },
      app.source.canWrite ? h('button', { class: 'btn btn-primary', onclick: saveToFolder }, `Save to “${app.source.handle.name}”`) : null,
      h('button', { class: `btn${app.source.canWrite ? '' : ' btn-primary'}`, onclick: downloadPatch }, 'Download patch'),
      h('button', { class: 'btn', onclick: downloadZip }, 'Download zip'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-quiet', onclick: discardAll }, 'Discard all')),
    status,
    h('div', { class: 'files' }, changes.map((change) => {
      const body = h('div', { class: 'file-body' });
      return h('details', {
        class: 'file',
        ontoggle: (event) => { if (event.target.open && !body.firstChild) body.append(renderDiff(change)); },
      },
        h('summary', {},
          h('code', {}, change.path),
          change.created ? h('span', { class: 'tag' }, 'new file') : null,
          change.conflicts ? h('span', { class: 'tag tag-error' }, count(change.conflicts, 'conflict')) : null,
          h('span', { class: 'spacer' }),
          h('span', { class: 'plus' }, `+${change.stat.added}`), h('span', { class: 'minus' }, `−${change.stat.removed}`),
          h('a', { class: 'link', href: `#/${encodeURIComponent(change.culture)}/${encodeURIComponent(change.name)}` }, 'Open'),
          h('button', {
            class: 'link danger',
            onclick: (event) => {
              event.preventDefault();
              if (!confirm(`Discard the pending changes of ${change.path}?`)) return;
              drafts.clear(change.culture, change.name);
              app.refresh();
            },
          }, 'Discard')),
        body);
    })),
    h('section', { class: 'howto' },
      h('h2', {}, 'Turning this into a pull request'),
      app.source.canWrite
        ? h('p', {}, 'After saving, the files of your clone contain the changes. Create a branch, commit, push and open a pull request:')
        : h('p', {}, 'In your clone of the repository, create a branch, apply the patch (or unzip the archive at the root of the clone), commit, push and open a pull request:'),
      h('pre', {}, [
        `git switch -c ${branch}`,
        app.source.canWrite ? null : `git apply --3way ~/Downloads/${baseName}.patch`,
        'git commit -am "Update translations"',
        `git push -u origin ${branch}`,
      ].filter(Boolean).join('\n')),
      h('p', { class: 'muted' },
        'Pull requests go to ', h('a', { href: REPOSITORY, target: '_blank', rel: 'noopener' }, 'OrchardCMS/OrchardCore.Translations'),
        '. Translations edited in the repository also have to be imported into Crowdin by a maintainer, otherwise the next Crowdin export can overwrite them.')));
}
