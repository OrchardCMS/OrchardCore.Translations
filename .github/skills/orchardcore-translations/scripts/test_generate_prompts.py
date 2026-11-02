import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import polib

from generate_prompts import generate, translation_key


class GeneratePromptsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "Localization"
        (self.root / "fr").mkdir(parents=True)
        self.output = self.base / "prompts"

    def catalog(self, name, entries, locale=None, plural_forms=None):
        directory = self.root / locale if locale else self.root
        directory.mkdir(exist_ok=True)
        path = directory / f"{name}.{'po' if locale else 'pot'}"
        catalog = polib.POFile()
        catalog.metadata = {"Content-Type": "text/plain; charset=UTF-8"}
        if plural_forms:
            catalog.metadata["Plural-Forms"] = plural_forms
        catalog.extend(entries)
        catalog.save(str(path))
        return path

    def entry(self, text, value="", context="View", **kwargs):
        return polib.POEntry(msgid=text, msgstr=value, msgctxt=context, **kwargs)

    def run_generate(self, **kwargs):
        return generate(self.root, "fr", "French (fr-FR)", self.output, **kwargs)

    def snapshots(self):
        return {
            str(path): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in self.root.rglob("*") if path.is_file()
        }

    def inputs(self, manifest):
        return [
            json.loads(
                (self.output / prompt["prompt_file"]).read_text(encoding="utf-8")
                .split("\nInput:\n", 1)[1]
            )
            for prompt in manifest["prompts"]
        ]

    def test_classifies_exact_contexts_and_orphan_catalogs_without_writes(self):
        self.catalog("Module", [
            self.entry("Add", context="Toolbar"),
            self.entry("Add", context="Menu"),
            self.entry("Edit"), self.entry("New"), self.entry("Space"),
        ])
        self.catalog("Module", [
            self.entry("Add", "Ajouter", context="Toolbar"),
            self.entry("Add", "", context="Menu"),
            self.entry("Edit", "Modifier", flags=["fuzzy"]),
            self.entry("Space", " "),
            self.entry("Old", "Ancien"),
            self.entry("Already obsolete", "Ancien", obsolete=True),
        ], locale="fr")
        self.catalog("Orphan", [self.entry("Removed module", "Supprimé")], locale="fr")
        self.catalog("BrandNew", [self.entry("New module")])
        before = self.snapshots()
        manifest = self.run_generate()
        module = next(c for c in manifest["catalogs"] if c["po_file"] == "fr/Module.po")
        self.assertEqual({(e["msgctxt"], e["msgid"]) for e in module["new"]},
                         {("Menu", "Add"), ("View", "New")})
        self.assertEqual({e["msgid"] for e in module["existing"]}, {"Add", "Edit", "Space"})
        self.assertEqual({e["msgid"] for e in module["old"]}, {"Old", "Already obsolete"})
        preserved = next(e for e in module["existing"] if e["msgid"] == "Edit")
        self.assertEqual(preserved["translations"], {"singular": "Modifier"})
        self.assertEqual(preserved["translation_flags"], ["fuzzy"])
        orphan = next(c for c in manifest["catalogs"] if c["po_file"] == "fr/Orphan.po")
        self.assertIsNone(orphan["pot_file"])
        self.assertEqual(len(orphan["old"]), 1)
        self.assertEqual(before, self.snapshots())
        self.assertEqual(manifest["summary"], {
            "new": 3, "old": 3, "existing": 3, "new_values": 3,
            "prompted_values": 3, "prompt_files": 2,
        })
        inputs = {key: value for batch in self.inputs(manifest) for key, value in batch.items()}
        self.assertCountEqual(inputs.values(), ["Add", "New", "New module"])
        for text, context in (("Add", "Toolbar"), ("Edit", "View"), ("Old", "View")):
            key = translation_key("fr", "fr/Module.po", self.entry(text, context=context), None)
            self.assertNotIn(key, inputs)

    def test_limits_batches_per_po_and_covers_final_partial_batch(self):
        for name in ("A", "B"):
            self.catalog(name, [self.entry(f"Entry {i}") for i in range(5)])
        manifest = self.run_generate(max_entries=2)
        self.assertEqual([len(p["keys"]) for p in manifest["prompts"]], [2, 2, 1, 2, 2, 1])
        self.assertEqual(manifest["summary"]["prompted_values"], 10)
        keys = [key for p in manifest["prompts"] for key in p["keys"]]
        self.assertEqual(len(keys), len(set(keys)))
        for prompt, values in zip(manifest["prompts"], self.inputs(manifest)):
            self.assertEqual(list(values), prompt["keys"])

    def test_start_index_skips_global_missing_values_not_each_file(self):
        self.catalog("A", [self.entry(f"A{i}") for i in range(3)])
        self.catalog("B", [self.entry(f"B{i}") for i in range(4)])
        manifest = self.run_generate(start_index=2, max_entries=2)
        self.assertEqual([p["start_index"] for p in manifest["prompts"]], [2, 3, 5])
        self.assertEqual([p["end_index_exclusive"] for p in manifest["prompts"]], [3, 5, 7])
        values = [v for batch in self.inputs(manifest) for v in batch.values()]
        self.assertEqual(values, ["A2", "B0", "B1", "B2", "B3"])

    def test_resume_at_200_covers_whole_remaining_set(self):
        self.catalog("Module", [self.entry(f"Value {i:04d}") for i in range(605)])
        manifest = self.run_generate(start_index=200, max_entries=200)
        self.assertEqual([len(p["keys"]) for p in manifest["prompts"]], [200, 200, 5])
        self.assertEqual(manifest["summary"]["prompted_values"], 405)

    def test_hashes_are_stable_and_include_all_identity_components(self):
        entry = self.entry("Count", context="Menu", msgid_plural="Counts")
        key = translation_key("fr", "fr/A.po", entry, 0)
        self.assertEqual(len(key), 64)
        alternatives = [
            translation_key("hu", "fr/A.po", entry, 0),
            translation_key("fr", "fr/B.po", entry, 0),
            translation_key("fr", "fr/A.po", self.entry("Count", context="View"), 0),
            translation_key("fr", "fr/A.po", self.entry("Different", context="Menu"), 0),
            translation_key("fr", "fr/A.po", entry, 1),
            translation_key("fr", "fr/A.po",
                            self.entry("Count", context="Menu", msgid_plural="Other"), 0),
        ]
        self.assertNotIn(key, alternatives)
        self.catalog("A", [entry])
        first = self.run_generate(max_entries=1, plural_forms="nplurals=2; plural=(n > 1);")
        self.output = self.base / "another-output"
        second = self.run_generate(max_entries=20, plural_forms="nplurals=2; plural=(n > 1);")
        self.assertEqual([k for p in first["prompts"] for k in p["keys"]],
                         [k for p in second["prompts"] for k in p["keys"]])
        self.assertEqual(first["prompts"][0]["keys"][0], key)

    def test_prompts_only_missing_plural_forms_and_preserves_existing_values(self):
        self.catalog("A", [self.entry("{0} item", msgid_plural="{0} items")])
        self.catalog("A", [self.entry("{0} item", msgid_plural="{0} items",
                                     msgstr_plural={0: "{0} élément", 1: ""})],
                     locale="fr", plural_forms="nplurals=2; plural=(n > 1);")
        manifest = self.run_generate(max_entries=1)
        record = manifest["catalogs"][0]["new"][0]
        self.assertEqual(record["translations"], {"0": "{0} élément", "1": ""})
        self.assertEqual(len(record["units"]), 1)
        self.assertEqual(record["units"][0]["plural_index"], 1)
        self.assertEqual(list(self.inputs(manifest)[0].values()), ["{0} items"])

    def test_infers_three_plural_forms_for_missing_catalog(self):
        rule = "nplurals=3; plural=(n==1 ? 0 : n==2 ? 1 : 2);"
        self.catalog("Existing", [self.entry("Existing", "Existant")],
                     locale="fr", plural_forms=rule)
        self.catalog("New", [self.entry("One", msgid_plural="Many")])
        manifest = self.run_generate()
        record = next(c for c in manifest["catalogs"] if c["po_file"] == "fr/New.po")["new"][0]
        self.assertEqual([u["plural_index"] for u in record["units"]], [0, 1, 2])
        self.assertEqual([u["source"] for u in record["units"]], ["One", "Many", "Many"])

    def test_missing_plural_rule_and_changed_plural_fail_without_output(self):
        self.catalog("A", [self.entry("One", msgid_plural="Many")])
        with self.assertRaisesRegex(ValueError, "cannot infer Plural-Forms"):
            self.run_generate()
        self.assertFalse(self.output.exists())
        self.catalog("A", [self.entry("One", msgid_plural="Different",
                                     msgstr_plural={0: "Un", 1: "Plusieurs"})],
                     locale="fr", plural_forms="nplurals=2; plural=(n > 1);")
        with self.assertRaisesRegex(ValueError, "plural source changed"):
            self.run_generate()
        self.assertFalse(self.output.exists())

    def test_ambiguous_plural_headers_require_rule_for_missing_catalog(self):
        self.catalog("A", [self.entry("First", "Premier")], locale="fr",
                     plural_forms="nplurals=2; plural=(n > 1);")
        self.catalog("B", [self.entry("Second", "Deuxième")], locale="fr",
                     plural_forms="nplurals=2; plural=(n != 1);")
        self.catalog("New", [self.entry("One", msgid_plural="Many")])
        with self.assertRaisesRegex(ValueError, "cannot infer Plural-Forms"):
            self.run_generate()
        manifest = self.run_generate(plural_forms="nplurals=2; plural=(n > 1);")
        self.assertEqual(manifest["catalogs"][1]["plural_forms"],
                         "nplurals=2; plural=(n != 1);")
        self.assertEqual(manifest["summary"]["new_values"], 2)

    def test_new_culture_does_not_reuse_another_cultures_reviewed_values(self):
        self.catalog("A", [self.entry("One")])
        self.catalog("A", [self.entry("One", "Un")], locale="fr")
        manifest = generate(self.root, "hu", "Hungarian", self.output)
        self.assertEqual(manifest["summary"]["existing"], 0)
        self.assertEqual(manifest["summary"]["new"], 1)
        self.assertEqual(manifest["catalogs"][0]["po_file"], "hu/A.po")
        self.assertFalse((self.root / "hu").exists())

    def test_duplicate_identities_fail_instead_of_losing_values(self):
        self.catalog("A", [self.entry("One"), self.entry("One")])
        with self.assertRaises(ValueError):
            self.run_generate()
        self.assertFalse(self.output.exists())

    def test_completed_catalogs_and_end_offset_have_no_prompts(self):
        self.catalog("A", [self.entry("One")])
        manifest = self.run_generate(start_index=1)
        self.assertEqual(manifest["prompts"], [])
        self.assertEqual(manifest["summary"]["prompted_values"], 0)
        self.catalog("A", [self.entry("One", "Un")], locale="fr")
        self.output = self.base / "complete"
        manifest = self.run_generate()
        self.assertEqual(manifest["summary"]["existing"], 1)
        self.assertEqual(manifest["prompts"], [])

    def test_source_context_and_json_preserve_unicode_markup_and_multiline(self):
        text = 'Hello, {name}: <a href="/edit?id={0}">"Edit"</a>\n{{ count }}'
        entry = self.entry(text, occurrences=[("Views/Edit.cshtml", "12")],
                           comment="A greeting", tcomment="Keep the link.")
        self.catalog("A", [entry])
        source_root = self.base / "OrchardCore"
        project = source_root / "src" / "OrchardCore.Modules" / "A"
        project.mkdir(parents=True)
        manifest = self.run_generate(source_root=source_root)
        prompt = (self.output / manifest["prompts"][0]["prompt_file"]).read_text()
        self.assertIn(str(project), prompt)
        self.assertIn("Views/Edit.cshtml", prompt)
        self.assertIn("A greeting", prompt)
        self.assertIn("Keep the link.", prompt)
        self.assertEqual(list(self.inputs(manifest)[0].values()), [text])
        self.assertTrue((self.output / "responses").is_dir())
        self.assertIn(str(self.output / manifest["prompts"][0]["response_file"]), prompt)

    def test_invalid_options_and_nonempty_output_fail_without_overwriting(self):
        self.catalog("A", [self.entry("One")])
        for kwargs in ({"max_entries": 0}, {"start_index": -1}, {"start_index": 2},
                       {"plural_forms": "unknown"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.run_generate(**kwargs)
        for culture in ("../fr", "", "/fr"):
            with self.subTest(culture=culture), self.assertRaises(ValueError):
                generate(self.root, culture, "French", self.output)
        with self.assertRaisesRegex(ValueError, "outside"):
            generate(self.root, "fr", "French", self.root / "prompts")
        self.output.mkdir()
        sentinel = self.output / "important.json"
        sentinel.write_text("do not overwrite")
        with self.assertRaisesRegex(ValueError, "empty directory"):
            self.run_generate()
        self.assertEqual(sentinel.read_text(), "do not overwrite")

    def test_cli_errors_are_explicit_and_do_not_write_output(self):
        result = subprocess.run([
            sys.executable, str(Path(__file__).with_name("generate_prompts.py")),
            "--localization-root", str(self.root), "--culture", "fr",
            "--target-language", "French", "--output", str(self.output),
        ], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No POT files", result.stderr)
        self.assertFalse(self.output.exists())

    def test_deterministic_files_for_unchanged_inputs(self):
        self.catalog("A", [self.entry("One"), self.entry("Two")])
        self.run_generate()
        first = {p.name: p.read_bytes() for p in self.output.iterdir() if p.is_file()}
        for path in self.output.iterdir():
            if path.is_file():
                path.unlink()
        (self.output / "responses").rmdir()
        self.run_generate()
        second = {p.name: p.read_bytes() for p in self.output.iterdir() if p.is_file()}
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
