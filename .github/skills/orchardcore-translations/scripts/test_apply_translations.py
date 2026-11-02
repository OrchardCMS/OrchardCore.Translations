import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import polib

from apply_translations import apply, validate_value
from generate_prompts import generate


class ApplyTranslationsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "Localization"
        self.root.mkdir()
        self.output = self.base / "jobs"
        self.rule = "nplurals=2; plural=(n > 1);"

    def entry(self, text, value="", **kwargs):
        return polib.POEntry(msgctxt="View", msgid=text, msgstr=value, **kwargs)

    def catalog(self, entries, locale=None, name="A"):
        directory = self.root / locale if locale else self.root
        directory.mkdir(exist_ok=True)
        path = directory / f"{name}.{'po' if locale else 'pot'}"
        po = polib.POFile()
        po.metadata = {"Content-Type": "text/plain; charset=UTF-8", "Custom": "Keep me"}
        if locale:
            po.metadata["Plural-Forms"] = self.rule
        po.extend(entries)
        po.save(str(path))
        return path

    def generate(self, max_entries=200):
        return generate(self.root, "fr", "French", self.output,
                        max_entries=max_entries, plural_forms=self.rule)

    def response(self, manifest, translations, job=0):
        prompt = manifest["prompts"][job]
        path = self.output / prompt["response_file"]
        path.write_text(json.dumps(dict(zip(prompt["keys"], translations)),
                                   ensure_ascii=False), encoding="utf-8")
        return path

    def apply(self, *responses, **kwargs):
        return apply(self.output / "manifest.json", list(responses), **kwargs)

    def test_fills_only_missing_values_preserving_reviewed_and_old_entries(self):
        self.catalog([self.entry("Add"), self.entry("Edit"), self.entry("New")])
        target = self.catalog([
            self.entry("Add", "Ajouter", flags=["fuzzy"], tcomment="Reviewed"),
            self.entry("Edit"),
            self.entry("Old", "Ancien", obsolete=True),
        ], locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["Modifier", "Nouveau"])
        summary = self.apply(response)
        self.assertEqual(summary["filled_values"], 2)
        po = polib.pofile(str(target))
        self.assertEqual(po.find("Add").msgstr, "Ajouter")
        self.assertEqual(po.find("Add").flags, ["fuzzy"])
        self.assertEqual(po.find("Add").tcomment, "Reviewed")
        self.assertEqual(po.find("Edit").msgstr, "Modifier")
        self.assertEqual(po.find("New").msgstr, "Nouveau")
        self.assertEqual(po.metadata["Custom"], "Keep me")
        self.assertEqual(po.obsolete_entries()[0].msgstr, "Ancien")
        before = target.read_bytes()
        repeated = self.apply(response)
        self.assertEqual(repeated["preserved_values"], 2)
        self.assertEqual(repeated["files_changed"], 0)
        self.assertEqual(target.read_bytes(), before)

    def test_intervening_reviewer_edit_is_never_overwritten(self):
        self.catalog([self.entry("Edit")])
        target = self.catalog([self.entry("Edit")], locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["Modifier"])
        self.catalog([self.entry("Edit", "Valeur relue")], locale="fr")
        before = target.read_bytes()
        summary = self.apply(response)
        self.assertEqual(summary["preserved_values"], 1)
        self.assertEqual(summary["filled_values"], 0)
        self.assertEqual(before, target.read_bytes())

    def test_fills_partial_plural_without_replacing_other_forms(self):
        self.catalog([self.entry("{0} item", msgid_plural="{0} items")])
        target = self.catalog([
            self.entry("{0} item", msgid_plural="{0} items",
                       msgstr_plural={0: "{0} élément", 1: ""})
        ], locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["{0} éléments"])
        self.apply(response)
        entry = polib.pofile(str(target))[0]
        self.assertEqual(entry.msgstr_plural, {0: "{0} élément", 1: "{0} éléments"})

    def test_creates_new_po_with_valid_empty_plural_slots_for_remaining_batches(self):
        self.catalog([self.entry("A label"),
                      self.entry("{0} item", msgid_plural="{0} items")])
        manifest = self.generate(max_entries=1)
        response = self.response(manifest, ["Libellé"])
        checked = self.apply(response, check=True)
        self.assertEqual(checked["filled_values"], 1)
        self.assertFalse((self.root / "fr").exists())
        self.apply(response)
        target = self.root / "fr/A.po"
        po = polib.pofile(str(target))
        self.assertEqual(po.metadata["Language"], "fr")
        self.assertEqual(po.metadata["Plural-Forms"], self.rule)
        self.assertEqual(po[1].msgstr_plural, {0: "", 1: ""})
        if shutil.which("msgfmt"):
            subprocess.run(["msgfmt", "--check-format", "-o", os.devnull, str(target)],
                           check=True, capture_output=True)

    def test_rejects_invalid_json_keys_or_values_without_writes(self):
        self.catalog([self.entry("One"), self.entry("Two")])
        target = self.catalog([self.entry("One"), self.entry("Two")], locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["Un", "Deux"])
        keys = manifest["prompts"][0]["keys"]
        before = target.read_bytes()
        invalid = [
            {keys[0]: "Un"}, {**{k: "Un" for k in keys}, "extra": "X"},
            {keys[0]: "", keys[1]: "Deux"},
            {keys[0]: 3, keys[1]: "Deux"}, ["Un", "Deux"],
        ]
        for value in invalid:
            with self.subTest(value=value):
                response.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    self.apply(response)
                self.assertEqual(target.read_bytes(), before)
        response.write_text('{"x":"first","x":"second"}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON key"):
            self.apply(response)

    def test_rejects_altered_variables_markup_and_whitespace(self):
        cases = [
            ("Hello {name}", "Bonjour {nom}"),
            ("{0:N2}", "{0}"),
            ("{{ value }}", "{{ valeur }}"),
            ('<a href="/edit">Edit</a>', '<a href="/modifier">Modifier</a>'),
            ('<a title="x>y" href="/edit">Edit</a>',
             '<a title="x>y" href="/modifier">Modifier</a>'),
            ("<b><i>Text</i></b>", "<i><b>Texte</b></i>"),
            ("A &amp; B", "A & B"),
            ("Hello\nworld", "Bonjour monde"),
            (" Text ", "Texte"),
            ("Hello %1", "Bonjour %2"),
        ]
        for source, value in cases:
            with self.subTest(source=source), self.assertRaises(ValueError):
                validate_value(source, value, "key")
        validate_value('<b>Hello {0}</b>', '<b>Bonjour {0}</b>', "key")

    def test_fills_the_correct_context_when_sources_are_identical(self):
        self.catalog([
            polib.POEntry(msgctxt="Menu", msgid="Add"),
            polib.POEntry(msgctxt="Toolbar", msgid="Add"),
        ])
        target = self.catalog([
            polib.POEntry(msgctxt="Menu", msgid="Add", msgstr="Ajouter au menu"),
            polib.POEntry(msgctxt="Toolbar", msgid="Add"),
        ], locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["Ajouter"])
        self.apply(response)
        po = polib.pofile(str(target))
        self.assertEqual(po.find("Add", msgctxt="Menu").msgstr, "Ajouter au menu")
        self.assertEqual(po.find("Add", msgctxt="Toolbar").msgstr, "Ajouter")

    def test_all_responses_validated_before_first_catalog_is_written(self):
        for name in ("A", "B"):
            self.catalog([self.entry("{0}")], name=name)
            self.catalog([self.entry("{0}")], locale="fr", name=name)
        manifest = self.generate()
        first = self.response(manifest, ["{0} traduit"], job=0)
        second = self.response(manifest, ["{1} incorrect"], job=1)
        before = {p: p.read_bytes() for p in (self.root / "fr").glob("*.po")}
        with self.assertRaisesRegex(ValueError, "variables"):
            self.apply(first, second)
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_source_drift_and_plural_rule_drift_block_import(self):
        self.catalog([self.entry("One", msgid_plural="Many")])
        target = self.catalog([
            self.entry("One", msgid_plural="Many", msgstr_plural={0: "", 1: ""})
        ], locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["Un", "Plusieurs"])
        po = polib.pofile(str(target))
        po.metadata["Plural-Forms"] = "nplurals=2; plural=(n != 1);"
        po.save(str(target))
        with self.assertRaisesRegex(ValueError, "Plural-Forms changed"):
            self.apply(response)
        self.catalog([self.entry("Gone")])
        with self.assertRaisesRegex(ValueError, "source entry changed"):
            self.apply(response)

    def test_duplicate_response_and_escaping_manifest_paths_are_rejected(self):
        self.catalog([self.entry("One")])
        manifest = self.generate()
        response = self.response(manifest, ["Un"])
        with self.assertRaisesRegex(ValueError, "already supplied"):
            self.apply(response, response)
        manifest["catalogs"][0]["po_file"] = "../A.po"
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Unexpected culture/PO path"):
            self.apply(response)
        self.assertFalse((self.root / "fr").exists())

    def test_import_and_cleanup_handle_all_three_groups_without_changing_other_cultures(self):
        self.catalog([self.entry("Keep"), self.entry("New")])
        target = self.catalog([
            self.entry("Keep", "Relu", flags=["fuzzy"], tcomment="Reviewed"),
            self.entry("Old", "Ancien"),
            self.entry("Obsolete", "Ancien", obsolete=True),
        ], locale="fr")
        orphan = self.catalog([self.entry("Gone module", "Supprimé")],
                              locale="fr", name="Orphan")
        other_culture = self.catalog([self.entry("Old", "Régi")], locale="hu")
        other_bytes = other_culture.read_bytes()
        manifest = self.generate()
        response = self.response(manifest, ["Nouveau"])
        before = {p: p.read_bytes() for p in (target, orphan)}
        checked = self.apply(response, check=True, remove_obsolete=True)
        self.assertEqual(checked["filled_values"], 1)
        self.assertEqual(checked["removed_entries"], 3)
        self.assertEqual(checked["files_changed"], 2)
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        applied = self.apply(response, remove_obsolete=True)
        self.assertEqual(applied["removed_entries"], 3)
        po = polib.pofile(str(target))
        self.assertEqual({entry.msgid for entry in po}, {"Keep", "New"})
        self.assertEqual(po.find("Keep").msgstr, "Relu")
        self.assertEqual(po.find("Keep").flags, ["fuzzy"])
        self.assertEqual(po.find("Keep").tcomment, "Reviewed")
        self.assertEqual(po.find("New").msgstr, "Nouveau")
        self.assertEqual(len(polib.pofile(str(orphan))), 0)
        self.assertEqual(other_bytes, other_culture.read_bytes())
        unchanged = {p: p.read_bytes() for p in before}
        repeated = self.apply(response, remove_obsolete=True)
        self.assertEqual(repeated["files_changed"], 0)
        self.assertEqual(repeated["removed_entries"], 0)
        self.assertEqual(unchanged, {p: p.read_bytes() for p in before})

    def test_cleanup_without_any_translation_responses(self):
        self.catalog([self.entry("Keep")])
        target = self.catalog([self.entry("Keep", "Relu"), self.entry("Old", "Ancien")],
                              locale="fr")
        self.generate()
        summary = self.apply(remove_obsolete=True)
        self.assertEqual(summary["filled_values"], 0)
        self.assertEqual(summary["removed_entries"], 1)
        self.assertEqual(polib.pofile(str(target))[0].msgstr, "Relu")
        with self.assertRaisesRegex(ValueError, "Supply a response"):
            self.apply()

    def test_cleanup_keeps_old_entries_reintroduced_into_current_pots(self):
        self.catalog([self.entry("Keep")])
        target = self.catalog([self.entry("Keep", "Relu"), self.entry("Returned", "Revenu")],
                              locale="fr")
        orphan = self.catalog([self.entry("Returned module", "Revenu")],
                              locale="fr", name="Orphan")
        self.generate()
        self.catalog([self.entry("Keep"), self.entry("Returned")])
        self.catalog([self.entry("Returned module")], name="Orphan")
        before = {p: p.read_bytes() for p in (target, orphan)}
        summary = self.apply(remove_obsolete=True)
        self.assertEqual(summary["removed_entries"], 0)
        self.assertEqual(summary["retained_old_entries"], 2)
        self.assertEqual(summary["files_changed"], 0)
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_cleanup_removes_obsolete_copy_without_removing_imported_active_entry(self):
        self.catalog([self.entry("Current")])
        target = self.catalog([self.entry("Current", "Ancien", obsolete=True)], locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["Actuel"])
        summary = self.apply(response, remove_obsolete=True)
        self.assertEqual(summary["filled_values"], 1)
        self.assertEqual(summary["removed_entries"], 1)
        po = polib.pofile(str(target))
        self.assertEqual(len(po), 1)
        self.assertFalse(po[0].obsolete)
        self.assertEqual(po[0].msgstr, "Actuel")

    def test_cleanup_leaves_unrecorded_po_entries_untouched(self):
        self.catalog([self.entry("Keep")])
        target = self.catalog([self.entry("Keep", "Relu"), self.entry("Old", "Ancien")],
                              locale="fr")
        self.generate()
        po = polib.pofile(str(target))
        po.append(self.entry("Added afterwards", "Ajouté"))
        po.save()
        summary = self.apply(remove_obsolete=True)
        self.assertEqual(summary["removed_entries"], 1)
        po = polib.pofile(str(target))
        self.assertEqual(po.find("Keep").msgstr, "Relu")
        self.assertEqual(po.find("Added afterwards").msgstr, "Ajouté")
        self.assertIsNone(po.find("Old"))

    def test_cleanup_refuses_missing_expected_pot_without_deleting_entries(self):
        pot = self.catalog([self.entry("Keep")])
        target = self.catalog([self.entry("Keep", "Relu"), self.entry("Old", "Ancien")],
                              locale="fr")
        self.generate()
        before = target.read_bytes()
        pot.unlink()
        with self.assertRaisesRegex(ValueError, "expected POT is missing"):
            self.apply(remove_obsolete=True)
        self.assertEqual(before, target.read_bytes())

    def test_invalid_response_prevents_obsolete_cleanup(self):
        self.catalog([self.entry("{0}")])
        target = self.catalog([self.entry("{0}"), self.entry("Old", "Ancien")],
                              locale="fr")
        manifest = self.generate()
        response = self.response(manifest, ["{1} incorrect"])
        before = target.read_bytes()
        with self.assertRaisesRegex(ValueError, "variables"):
            self.apply(response, remove_obsolete=True)
        self.assertEqual(before, target.read_bytes())


if __name__ == "__main__":
    unittest.main()
