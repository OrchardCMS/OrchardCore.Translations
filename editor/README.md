# Translation editor

A static web app for editing the `.po` files of this repository. It shows, for each
language and each section (`.pot` file), which strings are translated, untranslated,
missing from the `.po` file, or deprecated (still in the `.po` but no longer in the
`.pot`), and lets you fix them without disturbing the rest of the file.

The `.pot` files are never modified: they come from Orchard Core.

## Using it

Open the hosted site, pick a language, then a section.

There are two ways to get your changes into a pull request:

- **Local folder** (Chrome or Edge). Choose *Open local folder…* in the source menu and
  pick your clone of this repository. *Changes → Save* writes the `.po` files in place;
  create a branch, commit and open the pull request with git as usual.
- **Patch or zip** (any browser). Edits are kept in the browser's local storage.
  *Changes → Download patch* gives a file for `git apply --3way`; *Download zip* gives
  the changed files to unzip at the root of your clone.

Translations edited in the repository also have to be imported into Crowdin by a
maintainer (see the main [README](../README.md)).

### What the editor does

- One field per plural form, using the `Plural-Forms` rule of the `.po` file being
  edited. Each form is labelled with the numbers that select it, limited to the
  `range:` of the template entry when it has one.
- Warnings for placeholders (`{0}`) and leading/trailing whitespace that differ from
  the source.
- Search, and filters for untranslated, translated, deprecated, changed and flagged
  strings.
- Bulk helpers, per section or per language: remove deprecated entries, add the
  entries a file lacks (with an empty translation), and reorder a file to match its
  template.

### What it writes

Only the lines you change. Every other byte of a file is preserved: header order,
comments, line endings and the end of the file all stay as the tool that wrote the
file left them. New entries are inserted at their template position, copied from the
`.pot`. Strings are never wrapped. Removing every entry of a file leaves its header.

## Running it locally

Requires the .NET 10 SDK (or later).

```bash
dotnet run editor/site.cs -- serve
```

Then open <http://localhost:5080/>. The local server reads the catalogs of your
checkout; it does not write them. Use *Open local folder…* to edit the files.

## Tests

The tests check, among other things, that every `.pot` and `.po` file of the
repository can be read and written back byte for byte, and that the statistics
computed by `site.cs` match the editor's own.

- In the browser: <http://localhost:5080/tests.html>
- From a terminal (needs Node, no packages):

```bash
dotnet run editor/site.cs -- build --out _site
```

```bash
node editor/wwwroot/tests/run-node.mjs --index _site/data/index.json
```

## Layout

| Path | Purpose |
|---|---|
| `site.cs` | File-based C# app: `serve` for local use, `build` to produce the static site with its statistics index (`data/index.json`). |
| `wwwroot/js/po.js` | Lossless PO parser and serializer. |
| `wwwroot/js/catalog.js` | Merges a template with a translation file, computes statistics, applies pending changes. |
| `wwwroot/js/plurals.js` | `Plural-Forms` parser and evaluator. |
| `wwwroot/js/sources.js` | Hosted copy and local folder access. |
| `wwwroot/js/drafts.js` | Pending changes in local storage. |
| `wwwroot/js/diff.js`, `zip.js` | Patch and zip export. |
| `wwwroot/js/views/` | Dashboard, language, section editor and changes pages. |
| `wwwroot/tests/` | Tests, runnable in the browser and in Node. |

## Deployment

[`pages.yml`](../.github/workflows/pages.yml) builds the site, runs the tests and
deploys to GitHub Pages on every push to `main` that touches the catalogs or the
editor. It requires *Settings → Pages → Source* to be set to *GitHub Actions*.
