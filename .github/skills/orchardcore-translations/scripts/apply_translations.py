#!/usr/bin/env python3
"""Apply generated translation JSON to PO catalogs without replacing populated values."""

import argparse
import copy
import json
import os
import re
import stat
import tempfile
from collections import Counter
from pathlib import Path

from generate_prompts import identity, json_text, plural_count, read_catalog, translation_key


VARIABLES = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{[^{}]+\}|%\d+", re.DOTALL)
TAGS = re.compile(r"""</?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>""")
ENTITIES = re.compile(r"&(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream, object_pairs_hook=unique_object)


def catalog_path(root, relative):
    path = root / relative
    if Path(relative).is_absolute() or root not in path.resolve().parents:
        raise ValueError(f"Catalog path must be inside Localization: {relative}")
    return path


def po_path(root, culture, relative):
    parts = Path(relative).parts
    if len(parts) != 2 or parts[0] != culture or not relative.endswith(".po"):
        raise ValueError(f"Unexpected culture/PO path in manifest: {relative}")
    return catalog_path(root, relative)


def validate_value(source, translated, key):
    if not isinstance(translated, str) or not translated.strip():
        raise ValueError(f"{key}: translation must be a non-empty JSON string.")
    if Counter(VARIABLES.findall(source)) != Counter(VARIABLES.findall(translated)):
        raise ValueError(f"{key}: variables or format specifiers changed.")
    if TAGS.findall(source) != TAGS.findall(translated):
        raise ValueError(f"{key}: HTML tags or attributes changed.")
    if Counter(ENTITIES.findall(source)) != Counter(ENTITIES.findall(translated)):
        raise ValueError(f"{key}: HTML entities changed.")
    for pattern in (r"^\s*", r"\s*$"):
        if re.search(pattern, source)[0] != re.search(pattern, translated)[0]:
            raise ValueError(f"{key}: leading or trailing whitespace changed.")
    if source.count("\n") != translated.count("\n") or source.count("\t") != translated.count("\t"):
        raise ValueError(f"{key}: line breaks or tabs changed.")


def prepare_updates(manifest, responses, root, remove_obsolete=False):
    units = {}
    for catalog in manifest["catalogs"]:
        for record in catalog["new"]:
            for unit in record["units"]:
                if unit["key"] in units:
                    raise ValueError(f"Duplicate manifest key: {unit['key']}")
                units[unit["key"]] = catalog, record, unit
    jobs = {frozenset(job["keys"]) for job in manifest["prompts"]}
    values = {}
    for path in responses:
        response = read_json(path)
        if not isinstance(response, dict) or not response:
            raise ValueError(f"{path}: expected a non-empty JSON object.")
        if frozenset(response) not in jobs:
            raise ValueError(f"{path}: keys must exactly match one manifest prompt.")
        if values.keys() & response.keys():
            raise ValueError(f"{path}: a response key was already supplied.")
        values.update(response)

    targets = {}
    summary = {
        "filled_values": 0, "preserved_values": 0, "removed_entries": 0,
        "retained_old_entries": 0, "files_changed": 0,
    }
    for key, value in values.items():
        catalog, record, unit = units[key]
        po_file = catalog["po_file"]
        target = po_path(root, manifest["culture"], po_file)
        pot_file = f"{Path(po_file).stem}.pot"
        if catalog["pot_file"] != pot_file:
            raise ValueError(f"{po_file}: POT filename does not match the target PO.")
        if po_file not in targets:
            pot = read_catalog(catalog_path(root, pot_file))
            original = target.read_bytes() if target.exists() else None
            po = read_catalog(target) if original is not None else copy.deepcopy(pot)
            if original is None:
                po.metadata["Language"] = manifest["culture"]
                header = catalog["plural_forms"]
                if header:
                    po.metadata["Plural-Forms"] = header
                for entry in po:
                    entry.msgstr = ""
                    entry.msgstr_plural = (
                        {slot: "" for slot in range(plural_count(header, po_file))}
                        if entry.msgid_plural and header else {}
                    )
            targets[po_file] = {
                "path": target, "original": original, "po": po,
                "sources": {identity(entry): entry for entry in pot if not entry.obsolete},
                "active": {identity(entry): entry for entry in po if not entry.obsolete},
                "changed": False,
            }
        state = targets[po_file]
        po = state["po"]
        source = state["sources"].get((record["msgctxt"], record["msgid"]))
        if source is None or source.msgid_plural != (record["msgid_plural"] or ""):
            raise ValueError(f"{po_file}: source entry changed or no longer exists: {key}")
        index = unit["plural_index"]
        if source.msgid_plural:
            header = po.metadata.get("Plural-Forms") or catalog["plural_forms"]
            if not header or not catalog["plural_forms"]:
                raise ValueError(f"{po_file}: missing Plural-Forms.")
            if re.sub(r"\s+", "", header) != re.sub(r"\s+", "", catalog["plural_forms"]):
                raise ValueError(f"{po_file}: Plural-Forms changed since prompt generation.")
            if type(index) is not int or not 0 <= index < plural_count(header, po_file):
                raise ValueError(f"{po_file}: invalid plural index: {index}")
        elif index is not None:
            raise ValueError(f"{po_file}: a singular entry cannot have a plural index.")
        expected_key = translation_key(manifest["culture"], po_file, source, index)
        source_text = source.msgid_plural if index is not None and index > 0 else source.msgid
        if key != expected_key or unit["source"] != source_text:
            raise ValueError(f"{po_file}: response identity does not match current source: {key}")
        validate_value(source_text, value, key)
        entry = state["active"].get(identity(source))
        if entry is not None and entry.msgid_plural != source.msgid_plural:
            raise ValueError(f"{po_file}: existing PO plural source does not match POT.")
        existing = (
            entry.msgstr_plural.get(index, "") if source.msgid_plural
            else entry.msgstr
        ) if entry is not None else ""
        if existing:
            summary["preserved_values"] += 1
            continue
        if entry is None:
            entry = copy.deepcopy(source)
            entry.msgstr = ""
            entry.msgstr_plural = {}
            po.append(entry)
            state["active"][identity(source)] = entry
        if source.msgid_plural:
            if not po.metadata.get("Plural-Forms"):
                po.metadata["Plural-Forms"] = header
            for slot in range(plural_count(header, po_file)):
                entry.msgstr_plural.setdefault(slot, "")
            entry.msgstr_plural[index] = value
        else:
            entry.msgstr = value
        state["changed"] = True
        summary["filled_values"] += 1
    if remove_obsolete:
        for catalog in manifest["catalogs"]:
            if not catalog["old"]:
                continue
            po_file = catalog["po_file"]
            target = po_path(root, manifest["culture"], po_file)
            if po_file not in targets:
                if not target.exists():
                    continue
                targets[po_file] = {
                    "path": target, "original": target.read_bytes(),
                    "po": read_catalog(target), "changed": False,
                }
            state = targets[po_file]
            pot_file = f"{Path(po_file).stem}.pot"
            if catalog["pot_file"] not in (None, pot_file):
                raise ValueError(f"{po_file}: POT filename does not match the target PO.")
            pot_path = catalog_path(root, pot_file)
            if catalog["pot_file"] is not None and not pot_path.exists():
                raise ValueError(f"{po_file}: expected POT is missing; refusing cleanup.")
            sources = {
                identity(entry) for entry in read_catalog(pot_path) if not entry.obsolete
            } if pot_path.exists() else set()
            old = {
                (record["msgctxt"], record["msgid"], record["msgid_plural"] or "")
                for record in catalog["old"]
            }
            retained = []
            for entry in state["po"]:
                signature = (*identity(entry), entry.msgid_plural)
                if signature in old:
                    if entry.obsolete or identity(entry) not in sources:
                        summary["removed_entries"] += 1
                        state["changed"] = True
                        continue
                    summary["retained_old_entries"] += 1
                retained.append(entry)
            state["po"][:] = retained
    changed = [state for state in targets.values() if state["changed"]]
    summary["files_changed"] = len(changed)
    return changed, summary


def check_unchanged(state):
    path = state["path"]
    current = path.read_bytes() if path.exists() else None
    if current != state["original"]:
        raise ValueError(f"{path}: PO changed during import; regenerate the import plan.")


def apply(manifest_path, responses, check=False, localization_root=None, remove_obsolete=False):
    manifest = read_json(manifest_path)
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise ValueError("Unsupported translation manifest.")
    if not responses and not remove_obsolete:
        raise ValueError("Supply a response JSON file or --remove-obsolete for cleanup only.")
    root = (localization_root or Path(manifest["localization_root"])).resolve()
    changed, summary = prepare_updates(manifest, responses, root, remove_obsolete)
    if not check:
        for state in changed:
            check_unchanged(state)
        for state in changed:
            path = state["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w", encoding="utf-8", newline="\n",
                    dir=path.parent, prefix=f".{path.name}.", delete=False,
                ) as stream:
                    temporary = Path(stream.name)
                    stream.write(str(state["po"]))
                if path.exists():
                    temporary.chmod(stat.S_IMODE(path.stat().st_mode))
                check_unchanged(state)
                os.replace(temporary, path)
            finally:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
    return {**summary, "check_only": check}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--response", type=Path, action="append", default=[],
                        help="One batch response JSON; repeat to apply several together.")
    parser.add_argument("--localization-root", type=Path,
                        help="Override the manifest checkout path without changing key identities.")
    parser.add_argument("--check", action="store_true",
                        help="Validate all responses and report changes without writing PO files.")
    parser.add_argument("--remove-obsolete", action="store_true",
                        help="Remove manifest old entries still absent from POTs or marked obsolete.")
    args = parser.parse_args()
    try:
        summary = apply(
            args.manifest, args.response, args.check, args.localization_root,
            args.remove_obsolete,
        )
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Error: {error}\n")
    print(json_text(summary), end="")


if __name__ == "__main__":
    main()
