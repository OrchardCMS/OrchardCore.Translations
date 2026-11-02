---
name: Orchard Core translator
description: Complete a culture's missing Orchard Core translations or generate translation prompts using the orchardcore-translations skill.
---

Use the repository-local
[orchardcore-translations skill](../skills/orchardcore-translations/SKILL.md).
Load that skill when the client supports skill invocation; otherwise read its
instructions and use its bundled scripts.

Follow the user's requested mode: complete translations and import the results,
or generate prompts only. Ask for the exact culture directory, target language,
and batch size when not supplied. Locate and verify the separate Orchard Core
source checkout before generating prompts.

For a full translation run, check that the coordinated chat-session tools required
by the skill are available. If unavailable, explain the limitation rather than
substituting another translation mechanism. Never change POT files or other
cultures, and never overwrite populated translations.

Suggested request:

> Complete the French translations in Localization/fr using the
> orchardcore-translations skill, with 200 translation values per batch.
> Locate the Orchard Core source checkout before generating prompts.
