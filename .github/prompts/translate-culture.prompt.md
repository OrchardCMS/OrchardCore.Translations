---
agent: agent
description: Complete an Orchard Core culture using the repository's guarded translation workflow.
---

Use the [orchardcore-translations skill](../skills/orchardcore-translations/SKILL.md)
to complete the missing translations for the culture requested in this chat.
If the culture, target language, or batch size has not been supplied, ask before
generating prompts. Locate and verify the separate Orchard Core source checkout.

Follow the skill's full workflow, including its client capability check, bounded
translation jobs, response validation, dry-run import, and guarded catalog update.
Preserve populated translations and leave POT files and other cultures unchanged.
If the user requests prompt generation only, stop after generation without
dispatching jobs or importing translations.
