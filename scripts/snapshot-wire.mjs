// Re-baseline the promised wire contract.
//
// Run this ONLY when a break is deliberate, and read `docs/releasing.md` first
// — everything the old snapshot promised, some client in the world is still
// relying on. The test that sent you here names exactly what would break.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wireSnapshot } from "../packages/types/src/wire.ts";

const target = fileURLToPath(
  new URL("../packages/types/contracts/wire.json", import.meta.url),
);
const snapshot = wireSnapshot();
writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `Wire contract re-baselined at ${snapshot.version}: ` +
    `${Object.keys(snapshot.documents).length} documents.`,
);
