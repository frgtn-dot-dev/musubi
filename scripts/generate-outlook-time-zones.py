#!/usr/bin/env python3
"""Regenerate from the pinned CLDR 48 windowsZones.xml passed as argv[1].

Source: https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/supplemental/windowsZones.xml
Unicode License v3 is retained in packages/calendar/UNICODE-LICENSE.txt.
No network or third-party Python dependencies are used by this generator.
"""
from pathlib import Path
import hashlib
import json
import sys
import xml.etree.ElementTree as ET

source = Path(sys.argv[1]).read_bytes()
digest = hashlib.sha256(source).hexdigest()
assert digest == '9cf3db6a31fb382fee21b70be6feba1e82766b0fcd06e6261fb7936a73e537ff', "Unexpected CLDR source: review a version update explicitly"
rows = {}
for entry in ET.fromstring(source).findall(".//mapZone"):
    row = rows.setdefault(entry.attrib["other"], {"default": "", "zones": []})
    if entry.attrib["territory"] == "001":
        row["default"] = entry.attrib["type"]
    for zone in entry.attrib["type"].split():
        if zone not in row["zones"]:
            row["zones"].append(zone)
assert len(rows) == 139 and all(row["default"] in row["zones"] for row in rows.values())
output = Path(__file__).resolve().parents[1] / "packages/calendar/src/outlook-windows-zones.ts"
output.write_text(
    "// Generated from Unicode CLDR release 48, windowsZones.xml. Do not edit by hand.\n"
    "// Source: https://github.com/unicode-org/cldr/blob/release-48/common/supplemental/windowsZones.xml\n"
    f"// SHA-256: {digest}\n"
    "// Unicode License v3: ../UNICODE-LICENSE.txt\n"
    "export const OUTLOOK_WINDOWS_ZONES: Readonly<Record<string, { default: string; zones: readonly string[] }>> = "
    + json.dumps(rows, ensure_ascii=False, indent=2) + ";\n"
)
