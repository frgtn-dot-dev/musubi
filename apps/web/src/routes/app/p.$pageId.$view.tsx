import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { toDateKey } from "~/calendar/date-key";

const searchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => toDateKey(new Date())),
});

export const Route = createFileRoute("/app/p/$pageId/$view")({
  validateSearch: searchSchema,
  component: WebFoundation,
});

function WebFoundation() {
  return (
    <main id="main-content" className="foundation">
      <span className="foundation__mark" aria-hidden="true">
        結
      </span>
      <p>Musubi Web</p>
      <h1>The calendar workspace is ready for its first view.</h1>
      <p>
        TanStack Start, typed routing, query hydration and the shared theme are
        connected.
      </p>
    </main>
  );
}
