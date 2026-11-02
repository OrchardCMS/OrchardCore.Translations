---
name: orchardcore-translations
description: Work in OrchardCore.Translations to classify PO entries against POT catalogs, generate bounded LLM prompts, delegate each prompt to a same-model/effort sub-session, and patch PO files from JSON while removing obsolete entries and preserving reviewed values. Use when completing a culture's translations, isolating new/existing/obsolete entries, batching translation prompts, or importing their JSON responses.
---

# Orchard Core translations

Generate translation jobs locally, translate with LLM sub-sessions, then apply
returned JSON with the guarded importer. Do not call external translation services
or let translator children edit catalogs.

Use this repository's bundled scripts, not a separately installed copy of the
skill. Resolve `<skill>` below to `.github/skills/orchardcore-translations`
in the current checkout.

Prompt generation and JSON import work in any client with Python and file access.
The full translation workflow requires the Copilot app's coordinated chat-session
tools (`create_session` and session inspection/messaging) with inherited model and
effort settings. Before starting a full run, verify those tools are available. If
they are not, explain the limitation and ask the user to switch to the Copilot app
or request prompt generation only; do not silently substitute another dispatcher.
Keep manifests, responses, dispatch records, and Python environments in temporary
or session artifact storage outside the repository. Never commit them.

## 1. Select the catalogs and culture

Run from the root of the
[OrchardCMS/OrchardCore.Translations](https://github.com/OrchardCMS/OrchardCore.Translations)
checkout. All catalog paths below are relative to that repository root:

| Files | Repository-relative path | Example |
|-------|--------------------------|---------|
| English source templates | `Localization/<AssemblyName>.pot` | `Localization/OrchardCore.Admin.pot` |
| Target-culture translations | `Localization/<culture>/<AssemblyName>.po` | `Localization/fr/OrchardCore.Admin.po` |
| Hungarian translations | `Localization/hu/<AssemblyName>.po` | `Localization/hu/OrchardCore.Admin.po` |

Pair files by the same assembly name: compare
`Localization/OrchardCore.Admin.pot` with
`Localization/fr/OrchardCore.Admin.po` when targeting `fr`. Process every
`Localization/*.pot`, including those whose target PO does not yet exist, and
report target-culture PO files without a corresponding POT as old catalogs.
Leave other cultures unchanged.

Use `--localization-root "$PWD/Localization"` from this checkout. Use the current
POTs; do not regenerate or change them unless requested. Keep generated artifacts
in the session's artifact directory, outside `Localization`.

### Locate the Orchard Core source checkout (required)

**The caller must find the source repository before generating or dispatching
translation prompts.** Do not leave source discovery to the translation children.
Use a separate **OrchardCMS/OrchardCore** checkout, not OrchardCore.Translations.

1. Use a source path explicitly supplied by the user when available. Otherwise,
   look for an existing Orchard Core session/worktree or configured repository
   using `list_sessions_and_chats` and `list_repositories`, when available.
   Prefer an existing accessible worktree. If those tools are unavailable,
   inspect known workspace/sibling checkout locations, not the entire filesystem.
2. Verify the candidate is an Orchard Core Git checkout: check its remote identity
   and the presence of `src/OrchardCore.Modules` and `src/OrchardCore`. Prefer the
   source revision matching the POT catalogs. If multiple candidates are
   ambiguous, ask the user which checkout to use.
3. Resolve the chosen checkout to an **absolute path** readable by the child
   sessions on their execution host. Store that path as
   `ORCHARDCORE_SOURCE_ROOT`. Treat the source checkout as read-only.
4. If no usable local checkout can be found, use `ask_user` to request its path
   and wait. Do not generate context-free translation jobs, assume a sibling
   folder exists, or clone a repository without the user's approval.

Pass this verified path explicitly with
`--source-root "$ORCHARDCORE_SOURCE_ROOT"` on every generator run. The generator
embeds it as `Source root` in each prompt and records it in `manifest.json`;
referenced views and C# files live under that checkout's
`src/OrchardCore.Modules`, `src/OrchardCore`, and `src/OrchardCore.Themes`.
Resolve `<skill>` in the commands below to the loaded skill's directory,
regardless of the current working directory.

### Choose the culture and batch size

Use the **exact culture directory name** for `--culture`. For example, this
repository stores French in `fr`, even when the requested language is French
(`fr-FR`): pass `--culture fr --target-language "French (fr-FR)"`. Do not silently
substitute one culture's files for another. If the intended directory is unclear,
ask before proceeding.

**Ask the user how many entries each batch should contain before generating
prompts**, unless they already specified a size in the current request. Use
`ask_user`, for example "How many translation entries should each prompt batch
contain?" with choices "200 (Recommended)", "100", and "50". Accept another
positive integer through freeform input. Wait for the answer; do not silently
choose the script's default. Pass that number as `--max-entries`.

Use Python 3.10 or later with the bundled script. If it reports a missing `polib` dependency, install
`scripts/requirements.txt` into the session's Python environment and retry.

```bash
python3 <skill>/scripts/generate_prompts.py \
  --localization-root "$PWD/Localization" \
  --culture fr \
  --target-language "French (fr-FR)" \
  --source-root "$ORCHARDCORE_SOURCE_ROOT" \
  --max-entries 200 \
  --start-index 0 \
  --output <session-artifacts>/translation-prompts/fr
```

Choose an empty output directory. The script refuses to overwrite an existing run
or write inside `Localization`. It has no network calls and never changes catalogs.
If the user asks only to generate prompts, stop after generation.

### Classification and indices

Read `manifest.json`. Its `catalogs` contain three groups:

| Group | Meaning | Action |
|-------|---------|--------|
| `new` | A current POT entry is absent from the matching PO, or at least one translation value is empty. | Include only the missing values in translation Input, then import the returned JSON. |
| `old` | A PO entry is absent from the matching POT, or already marked obsolete. Includes PO files whose POT no longer exists. | Remove with the Python importer; never request a translation. |
| `existing` | A current entry already has all its translation values. | Exclude from translation Input and preserve exactly, including any fuzzy flag. |

Only `new` values go into each prompt's `Input` JSON. `old` and `existing`
entries remain in the manifest for bookkeeping, not in the translation request.
For a partially translated plural, already populated forms may appear as
read-only context, but only missing forms are submitted for translation.

Match by exact `msgctxt` and `msgid` **within the corresponding filename**. Do not
reuse a reviewed value from an unrelated context or catalog. Empty means `""`,
not a whitespace-only value. A changed plural source is an explicit error rather
than permission to overwrite a translation.

For a partially translated plural entry, classify it as `new`, record its existing
values, and prompt only for missing `msgstr[n]` forms. Use the culture's
`Plural-Forms` header, inferred from its POs when unambiguous. For a new culture
or ambiguous/missing headers, supply its known rule explicitly:

```bash
--plural-forms 'nplurals=2; plural=(n != 1);'
```

Never guess a plural rule. That option supplies a rule for catalogs without a
header; it does not replace an existing catalog's rule.

Each missing singular value or plural form is one **translation unit / JSON key**.
`--max-entries` caps those units per prompt (default 200), never mixing PO files.
`--start-index` is a zero-based offset in the globally sorted missing-unit list:
catalog filename, context, msgid, then plural index. It defaults to zero to cover
the entire culture. Passing `200` skips the first 200 missing values and generates
**all remaining** prompts, including the final partial batch. Resume against the
same unchanged catalog snapshot; reconciliation changes can move indices.

Keys are SHA-256 hashes of the culture, relative PO path, context, msgid, plural
source, and plural index. They do not depend on the offset, batch size, or absolute
checkout path. Use the manifest's mappings rather than trying to reverse a hash.

## 2. Create one sub-session per prompt

Before launching any child, verify `manifest.json` contains the verified absolute
`source_root` and every generated prompt contains that same concrete path in its
`Source root` field. Do not dispatch prompts with a missing path,
`(not supplied)`, or an unresolved placeholder. Regenerate them with the verified
`--source-root` instead.

Follow the manifest's `prompts` array, not a directory glob that could pick up old
jobs. Read each listed `prompt_file` fully, including its source root, source
project, and per-entry references. Pass that entire content to the child; chat
children do not inherit a source checkout or the caller's working directory.
Create **exactly one new chat child session for each prompt**, using
`create_session` with:

```text
name: a short culture/catalog/batch label
session_kind: "chat"
coordinate_with_creator: true
notify_on_idle: "once"
kickoff.prompt: the entire generated prompt file, verbatim
kickoff.mode: "interactive"
```

**Omit `kickoff.model`, `kickoff.reasoning_effort`, and `kickoff.context_tier`.**
`create_session` inherits the creating session's model, effort, and context tier
when these overrides are absent. Do not select a cheaper model, invent an effort,
or substitute a task agent, workflow, or translation endpoint. If the runtime
cannot inherit these settings, surface the limitation before launching.

Use chat children to avoid creating a checkout for every batch. The prompt
contains absolute source paths and an absolute response path. Keep at most two
children active unless the user specifies another concurrency limit; queue the
remaining prompts. Record each prompt-to-session ID mapping in a separate session
artifact such as `dispatch.json` immediately after creation. Do not launch a
duplicate job when resuming; inspect its recorded session first.

Each child must translate every input value itself, inspect the referenced
Razor/Liquid view or C# source when context matters, and write only the specified
JSON response file. For example, distinguish "Part" as a CMS content part from an
ordinary fragment, or "Publish" as an action from a publication state. Preserve
variables, format specifiers, markup, attributes, code, brands, and whitespace.

If a source reference cannot be resolved and the context affects the translation,
report the blocker. Do not fill the value with a guess or copy English simply to
meet a coverage count.

## 3. Collect results

Wait for completion notifications and inspect the recorded child sessions. Collect
all responses at the manifest's `response_file` paths. Reject missing files,
duplicate/extra/missing JSON keys, non-string or empty values, changed
placeholders, or altered HTML attributes. Have the same child correct its batch
instead of launching a duplicate. Report unresolved batches explicitly.

The prompts return a flat JSON object of hash keys to translated strings. The
manifest is the lossless mapping back to culture, PO filename, context, msgid, and
plural index. Keep that manifest, the source snapshot, and responses together.

## 4. Patch the target PO files

If the user requested translating/completing the catalogs, use
`scripts/apply_translations.py` to import the returned JSON. If they requested only
prompts or JSON drafts, leave the catalogs unchanged. Do not manually replace
translations, use fuzzy matching, or overwrite entire catalogs with LLM output.

Check the import first:

```bash
python3 <skill>/scripts/apply_translations.py \
  --manifest <output>/manifest.json \
  --response <output>/responses/<batch>.json \
  --localization-root "$PWD/Localization" \
  --remove-obsolete \
  --check
```

Repeat `--response` for additional completed batches. After the check succeeds,
run the same command without `--check` to patch the targeted PO files.
Keep `--remove-obsolete` to remove the manifest's old entries as part of the
same operation. If there are no translation prompts, or all responses were
already imported, run the importer with `--manifest`, `--localization-root`,
and `--remove-obsolete` but no `--response` to perform cleanup only; preview
with `--check` first.
Keep the explicit localization root so that a manifest copied from another
checkout cannot redirect the import away from the current translations worktree.

The importer resolves each hash to its culture, PO file, exact context/msgid and
plural form. It checks the current POT and plural rule again, validates response
keys, variables, markup/attributes and whitespace, and fills **only still-empty
values**. It preserves existing translations, flags, comments and headers,
including a reviewer's edits made after prompt generation. It reports skipped
populated values explicitly. Missing entries are appended; a missing PO file is
created from its POT with the target culture and plural rule.

Old entries need no JSON response. With `--remove-obsolete`, the importer removes
only recorded old entries that are still absent from the current POT or still
marked obsolete. It also cleans catalogs with no new entries, including orphan
PO files. It leaves a header-only PO rather than deleting the file when no entries
remain. Entries reintroduced into the current POT are retained and reported.
If a POT expected by the manifest is missing, stop and regenerate the manifest
rather than treating the entire catalog as obsolete.

All supplied responses are validated before any files are changed. Each changed
PO is replaced atomically, with a check that it has not changed since reading.
Imports are idempotent: applying an already imported response preserves its
values without rewriting the file. Do not run concurrent imports against the
same catalog.

Inspect the resulting diff and, when available, run `msgfmt --check-format` on
changed PO files. Report blockers instead of forcing an import.
