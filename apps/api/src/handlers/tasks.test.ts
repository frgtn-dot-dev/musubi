import assert from "node:assert/strict";
import { can } from "@musubi/types";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "dev";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

async function main() {
  const { parseTaskCreateBody, parseTaskUpdateBody } = await import("./tasks");

  const created = parseTaskCreateBody({
    id: "00000000-0000-4000-8000-000000000001",
    calendarID: "00000000-0000-4000-8000-000000000002",
    title: "Complete VTODO support",
    status: "completed",
    percentComplete: 20,
  });
  assert.equal(created.percentComplete, 100);
  assert.ok(created.completedAt instanceof Date);

  const updated = parseTaskUpdateBody({
    calendarID: "00000000-0000-4000-8000-000000000002",
    title: "Reopened task",
  });
  assert.equal(updated.status, "needs-action");
  assert.equal(updated.percentComplete, 0);

  assert.throws(
    () =>
      parseTaskCreateBody({
        id: "not-a-uuid",
        calendarID: "00000000-0000-4000-8000-000000000002",
        title: "Invalid",
      }),
    /task\.id/,
  );
  assert.equal(can("editor", "editTasks"), true);
  assert.equal(can("viewer", "editTasks"), false);

  console.log("task handler contract ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
