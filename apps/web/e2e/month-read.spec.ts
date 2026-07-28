import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const session = {
  session: {
    createdAt: "2026-07-26T14:00:00.000Z",
    expiresAt: "2026-07-27T14:00:00.000Z",
    id: "session-web-qa",
    token: "redacted",
    updatedAt: "2026-07-26T14:00:00.000Z",
    userId: "user-web-qa",
  },
  user: {
    createdAt: "2026-07-26T14:00:00.000Z",
    email: "web-qa@example.invalid",
    emailVerified: true,
    id: "user-web-qa",
    name: "Web QA",
    updatedAt: "2026-07-26T14:00:00.000Z",
  },
};

const calendars = [
  {
    color: "#b3492f",
    creatorID: "user-web-qa",
    id: "personal",
    isDefault: true,
    members: [],
    name: "Personal",
    role: "owner",
  },
  {
    color: "#d6b76b",
    creatorID: "user-web-qa",
    id: "studio",
    members: [],
    name: "Studio",
    role: "owner",
  },
  {
    color: "#365a92",
    creatorID: "user-web-qa",
    id: "family",
    members: [],
    name: "Family",
    role: "editor",
  },
];

function event(
  id: string,
  title: string,
  calendarId: string,
  color: string,
  start: string,
  end: string,
  extra: Record<string, unknown> = {},
) {
  return {
    calendars: [calendarId],
    color,
    creatorID: "user-web-qa",
    end,
    hasAttendees: false,
    id,
    isAllDay: false,
    isCanceled: false,
    organizer: "web-qa@example.invalid",
    originCalendarID: calendarId,
    start,
    title,
    ...extra,
  };
}

const events = {
  deletedIds: [],
  events: [
    event(
      "weekly-review",
      "Weekly review",
      "personal",
      "#b3492f",
      "2026-07-06T09:00:00.000Z",
      "2026-07-06T10:00:00.000Z",
      { recurrence: "FREQ=WEEKLY;BYDAY=MO" },
    ),
    event(
      "client-call",
      "Client call",
      "studio",
      "#d6b76b",
      "2026-07-08T12:30:00.000Z",
      "2026-07-08T13:30:00.000Z",
    ),
    event(
      "studio-retreat",
      "Studio retreat",
      "studio",
      "#d6b76b",
      "2026-07-06T00:00:00.000Z",
      "2026-07-10T00:00:00.000Z",
      { isAllDay: true, location: "Kokořínsko" },
    ),
    event(
      "family-holiday",
      "Family holiday",
      "family",
      "#365a92",
      "2026-07-17T00:00:00.000Z",
      "2026-07-22T00:00:00.000Z",
      { isAllDay: true },
    ),
    event(
      "project-check-in",
      "Project check-in",
      "personal",
      "#b3492f",
      "2026-07-23T07:30:00.000Z",
      "2026-07-23T08:30:00.000Z",
    ),
    event(
      "overlap-call",
      "Partner call",
      "studio",
      "#d6b76b",
      "2026-07-23T08:00:00.000Z",
      "2026-07-23T09:00:00.000Z",
    ),
    event(
      "client-presentation",
      "Client presentation",
      "studio",
      "#d6b76b",
      "2026-07-24T11:00:00.000Z",
      "2026-07-24T12:00:00.000Z",
    ),
    event(
      "theatre-night",
      "Theatre night",
      "family",
      "#365a92",
      "2026-07-25T17:00:00.000Z",
      "2026-07-25T20:00:00.000Z",
    ),
    event(
      "design-review",
      "Design review",
      "family",
      "#365a92",
      "2026-08-06T14:00:00.000Z",
      "2026-08-06T15:00:00.000Z",
      { hasAttendees: true, location: "Studio B" },
    ),
    event(
      "studio-open-day",
      "Studio open day",
      "studio",
      "#d6b76b",
      "2026-08-14T00:00:00.000Z",
      "2026-08-14T00:00:00.000Z",
      { isAllDay: true },
    ),
  ],
  serverTime: "2026-07-26T14:00:00.000Z",
};

const settings = {
  dateFormat: "dmy",
  defaultCalendarView: "month",
  notificationsOnByDefault: true,
  onboarded: true,
  showKanji: true,
  theme: "system",
  timeFormat: "24h",
  weekStartsOn: "monday",
};

const DEFAULT_PAGE_ID = "11111111-1111-4111-8111-111111111111";

const defaultPage = {
  config: {
    calendarVisibility: { hiddenCalendarIds: [], mode: "all" },
    filters: [],
    schemaVersion: 1,
    view: { configVersion: 1, id: "month", showAdjacentDays: true },
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  id: DEFAULT_PAGE_ID,
  isDefault: true,
  name: "My calendar",
  position: 0,
  revision: 1,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function respond(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    headers: { "x-request-id": "playwright-fixture" },
    status,
  });
}

async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function mockAuthenticatedReads(
  page: Page,
  eventResponse: typeof events = events,
  calendarResponse: typeof calendars = calendars,
  failWritesForCalendarId?: string,
) {
  let authenticated = true;
  let settingsState = { ...settings };
  let settingsRevision = 1;
  let calendarState = calendarResponse.map((calendar) => ({
    ...calendar,
  }));
  let eventState = {
    ...eventResponse,
    events: eventResponse.events.map((item) => ({ ...item })),
  };
  let attendeeState = [
    { id: "guest-1", image: null, name: "Guest One" },
  ];

  await page.route("**/api/auth/get-session", (route) =>
    respond(route, authenticated ? session : null),
  );
  await page.route("**/api/auth/sign-out", (route) => {
    authenticated = false;
    return respond(route, { success: true });
  });
  await page.route("**/api/v1/calendars", async (route) => {
    const method = route.request().method();
    if (method === "GET") return respond(route, calendarState);

    const body = route.request().postDataJSON() as (typeof calendars)[number];
    if (method === "POST") {
      const created = {
        ...body,
        creatorID: session.user.id,
        id: `calendar-${calendarState.length + 1}`,
        members: [],
        role: "owner",
      };
      calendarState = [...calendarState, created];
      return respond(route, created, 201);
    }
    if (method === "PUT") {
      calendarState = calendarState.map((calendar) =>
        calendar.id === body.id ? { ...calendar, ...body } : calendar,
      );
      return respond(
        route,
        calendarState.find((calendar) => calendar.id === body.id),
      );
    }
    if (method === "DELETE") {
      calendarState = calendarState.filter(
        (calendar) => calendar.id !== body.id,
      );
      return respond(route, { ...body, members: [] });
    }
    return respond(route, calendarState);
  });
  await page.route("**/api/v1/pages", (route) => respond(route, [defaultPage]));
  // No federated servers by default; the federation test overrides this.
  await page.route("**/api/v1/federation/connections", (route) =>
    respond(route, []),
  );
  // Hold the SSE connection open like the real server so EventSource stays
  // connected instead of reconnect-looping against a closed mock.
  await page.route("**/api/stream", () => {
    // Intentionally never resolved; Playwright aborts it when the page closes.
    return new Promise<void>(() => {});
  });
  await page.route("**/api/v1/calendars/*/export", (route) =>
    route.fulfill({
      body: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
      contentType: "text/calendar",
      status: 200,
    }),
  );
  await page.route("**/api/v1/calendars/import?*", (route) => {
    const url = new URL(route.request().url());
    const imported = {
      color: url.searchParams.get("color") ?? "#7a9e7e",
      creatorID: session.user.id,
      id: "imported-calendar",
      imported: 1,
      members: [],
      name: url.searchParams.get("name") ?? "Imported calendar",
      role: "owner",
    };
    calendarState = [...calendarState, imported];
    return respond(route, imported, 201);
  });
  await page.route("**/api/v1/events", async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      return respond(route, eventState);
    }

    const body = route.request().postDataJSON() as (typeof events.events)[number];
    const homeCalendarId =
      body.originCalendarID ?? body.calendars[0];

    if (
      failWritesForCalendarId &&
      homeCalendarId === failWritesForCalendarId
    ) {
      return route.fulfill({
        body: JSON.stringify({
          error: "ProviderUnavailable",
          message: "Provider unavailable",
          requestId: "provider-write-failed",
        }),
        contentType: "application/json",
        headers: { "x-request-id": "provider-write-failed" },
        status: 502,
      });
    }

    if (method === "POST") {
      eventState = {
        ...eventState,
        events: [...eventState.events, body],
      };
      return respond(route, body, 201);
    }

    if (method === "PUT") {
      eventState = {
        ...eventState,
        events: eventState.events.map((item) =>
          item.id === body.id ? body : item,
        ),
      };
      return respond(route, body);
    }

    if (method === "DELETE") {
      eventState = {
        ...eventState,
        events: eventState.events.filter(
          (item) => item.id !== body.id,
        ),
      };
      return respond(route, {
        calendars: [],
        id: body.id,
        removed: true,
      });
    }

    return route.abort();
  });
  await page.route("**/api/v1/events/*/attendees", (route) =>
    respond(route, attendeeState),
  );
  await page.route("**/api/v1/events/*/attendance", (route) => {
    const attending = (
      route.request().postDataJSON() as { attending: boolean }
    ).attending;
    attendeeState = attending
      ? [
          ...attendeeState,
          { id: session.user.id, image: null, name: session.user.name },
        ]
      : attendeeState.filter((item) => item.id !== session.user.id);
    return respond(route, attendeeState);
  });
  await page.route("**/api/v1/events/*/link", (route) => {
    const eventId = route.request().url().split("/").at(-2)!;
    const { calendarID } = route.request().postDataJSON() as {
      calendarID: string;
    };
    const linked = eventState.events.find((item) => item.id === eventId)!;
    const result = {
      ...linked,
      calendars: [...linked.calendars, calendarID],
    };
    eventState = {
      ...eventState,
      events: eventState.events.map((item) =>
        item.id === eventId ? result : item,
      ),
    };
    return respond(route, result);
  });
  await page.route("**/api/v1/events/*/fork", (route) => {
    const eventId = route.request().url().split("/").at(-2)!;
    const { calendarID } = route.request().postDataJSON() as {
      calendarID: string;
    };
    const source = eventState.events.find((item) => item.id === eventId)!;
    const forked = {
      ...source,
      calendars: [calendarID],
      id: `${eventId}-fork`,
      originCalendarID: calendarID,
    };
    eventState = {
      ...eventState,
      events: [...eventState.events, forked],
    };
    return respond(route, forked, 201);
  });
  await page.route("**/api/v1/users/settings", (route) =>
    respond(route, settingsState),
  );
  await page.route("**/api/v1/users/settings/document", (route) =>
    respond(route, {
      revision: settingsRevision,
      updatedAt: "2026-07-26T14:00:00.000Z",
      value: settingsState,
    }),
  );
  await page.route("**/api/v1/users/me/settings", (route) => {
    const body = route.request().postDataJSON() as {
      baseRevision: number;
      patch: Partial<typeof settings>;
    };
    if (body.baseRevision !== settingsRevision) {
      return respond(
        route,
        {
          current: {
            revision: settingsRevision,
            updatedAt: "2026-07-26T14:00:00.000Z",
            value: settingsState,
          },
          error: "SettingsConflict",
          message: "Settings changed on another device.",
        },
        409,
      );
    }
    settingsRevision += 1;
    settingsState = { ...settingsState, ...body.patch };
    return respond(route, {
      revision: settingsRevision,
      updatedAt: "2026-07-26T14:01:00.000Z",
      value: settingsState,
    });
  });
}

test("redirects an anonymous Month request to sign in", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));

  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(
    page.getByRole("heading", { name: "Pick up where you left off." }),
  ).toBeVisible();

  await expectNoAccessibilityViolations(page);
});

test("reads, filters and signs out of the authenticated Month", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);

  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await expect(page.getByRole("heading", { name: "My calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Studio retreat/ })).toHaveCount(5);
  await expect(page.getByRole("button", { name: /Family holiday/ })).toHaveCount(6);
  await expect(page.getByRole("button", { name: /Weekly review/ })).toHaveCount(5);

  await page.getByRole("button", { name: /Studio retreat/ }).first().click();
  await expect(
    page.getByText(/Monday, July 6, 2026.*Friday, July 10, 2026/),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page
    .locator("label")
    .filter({ has: page.getByRole("checkbox", { name: "Studio" }) })
    .click();
  await expect(page.getByRole("button", { name: /Studio retreat/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Event", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Create event" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await expectNoAccessibilityViolations(page);

  await page.getByRole("button", { name: "Sign out Web QA" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("keeps an empty Month canvas quiet", async ({ page }) => {
  await mockAuthenticatedReads(page, {
    ...events,
    events: [],
  });

  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await expect(page.getByRole("heading", { name: "My calendar" })).toBeVisible();
  await expect(page.getByText("Nothing is scheduled")).toHaveCount(0);
  await expect(page.getByText("No events match")).toHaveCount(0);

  await page
    .getByRole("main")
    .getByRole("button", { name: "Next month" })
    .click();
  await expect(page.getByText("August 2026")).toBeVisible();
  await expect(page.getByText("Nothing is scheduled")).toHaveCount(0);

  await expectNoAccessibilityViolations(page);
});

test("reads, filters and pages the authenticated Agenda", async ({ page }) => {
  await mockAuthenticatedReads(page);

  await page.goto("/app/p/my-calendar/agenda?date=2026-07-26");

  await expect(page.getByRole("heading", { name: "My calendar" })).toBeVisible();
  await expect(page.getByText("From Jul 26, 2026")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Agenda", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // The initial DOM is a bounded slice of a year-long range, not the whole
  // range. How many batches fit depends on the viewport, so this asserts the
  // bound rather than one exact batch.
  const initialDays = await page.locator("[data-agenda-date]").count();
  expect(initialDays).toBeGreaterThanOrEqual(14);
  expect(initialDays).toBeLessThanOrEqual(28);
  await expect(page.locator('[data-agenda-date="2026-07-26"]')).toHaveCount(0);
  // One occurrence per loaded week, and the one-offs exactly once each.
  expect(
    await page.getByRole("button", { name: /Weekly review/ }).count(),
  ).toBeGreaterThanOrEqual(12);
  await expect(page.getByRole("button", { name: /Design review/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Studio open day/ })).toHaveCount(1);

  await page.getByRole("button", { name: /Design review/ }).click();
  await expect(page.getByText("Studio B")).toBeVisible();
  await expect(page.getByText("16:00 – 17:00")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("region", { name: /From Jul 26, 2026 agenda/ }).evaluate(
    (agenda) => {
      agenda.parentElement?.scrollTo({
        top: agenda.parentElement.scrollHeight,
      });
    },
  );
  await expect
    .poll(() => page.locator("[data-agenda-date]").count())
    .toBeGreaterThan(initialDays);

  await page
    .locator("label")
    .filter({ has: page.getByRole("checkbox", { name: "Family" }) })
    .click();
  await expect(page.getByRole("button", { name: /Design review/ })).toHaveCount(0);

  await expectNoAccessibilityViolations(page);

  await page.getByRole("button", { name: "Next agenda start" }).click();
  await expect(page).toHaveURL(/[?&]date=2026-08-23/);
  await expect(page.getByText("From Aug 23, 2026")).toBeVisible();
});

test("renders and navigates the authenticated Week time grid", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  // Pin "now" inside the displayed week so the current-time marker is
  // deterministic regardless of the real date.
  await page.clock.setFixedTime(new Date("2026-07-26T10:00:00"));

  await page.goto("/app/p/my-calendar/week?date=2026-07-26");

  await expect(page.getByText("Jul 20 – 26, 2026")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-time-grid-day]")).toHaveCount(7);
  await expect(
    page.getByRole("button", { name: /All-day event, Family holiday/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Weekly review/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Project check-in/ })).toHaveCount(1);
  await expect(page.locator("[data-current-time]")).toHaveCount(1);

  await page.getByRole("button", { name: /Weekly review/ }).click();
  await expect(page.getByText("11:00 – 12:00")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page).toHaveURL(/[?&]date=2026-08-02/);
  await expect(page.getByText("Jul 27 – Aug 2, 2026")).toBeVisible();

  await expectNoAccessibilityViolations(page);
});

test("uses the shared time grid as a one-column Day", async ({ page }) => {
  await mockAuthenticatedReads(page);

  await page.goto("/app/p/my-calendar/day?date=2026-07-23");

  await expect(page.getByText("Thursday, July 23, 2026")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Day", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-time-grid-day]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Project check-in/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Partner call/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page).toHaveURL(/[?&]date=2026-07-24/);
  await expect(page.getByText("Friday, July 24, 2026")).toBeVisible();
});

test("creates, edits and deletes an event through confirmed API writes", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Release check");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("status")).toContainText("Event created.");
  await expect(
    page.getByRole("button", { name: /Release check/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Release check/ }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Release readiness");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("status")).toContainText("Event updated.");
  await expect(
    page.getByRole("button", { name: /Release readiness/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Release readiness/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("status")).toContainText("Event deleted.");
  await expect(
    page.getByRole("button", { name: /Release readiness/ }),
  ).toHaveCount(0);

  // Undo brings it back rather than a confirm step keeping it from going.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status")).toContainText("Change undone.");
  await expect(
    page.getByRole("button", { name: /Release readiness/ }),
  ).toBeVisible();
});

test("keeps provider failures actionable without assuming a write succeeded", async ({
  page,
}) => {
  const providerCalendars = calendars.map((calendar) =>
    calendar.id === "studio"
      ? { ...calendar, provider: "google" }
      : calendar,
  );
  await mockAuthenticatedReads(
    page,
    events,
    providerCalendars,
    "studio",
  );
  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Provider check");
  await page
    .getByRole("combobox", { name: "Calendar" })
    .selectOption("studio");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Google Calendar did not confirm this change",
  );
  await expect(page.getByRole("alert")).toContainText(
    "provider-write-failed",
  );
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toHaveValue("Provider check");
  await expectNoAccessibilityViolations(page);
});

test("handles attendance, linking, forking and recurring delete scopes", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await mockAuthenticatedReads(page);
  await page.goto("/app/p/my-calendar/agenda?date=2026-07-26");

  await page.getByRole("button", { name: /Design review/ }).click();
  await expect(page.getByText("Guest One")).toBeVisible();
  await page.getByRole("button", { name: "Attend" }).click();
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible();

  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Event linked to calendar.",
  );

  await page.getByRole("button", { name: /Design review/ }).click();
  await page.getByRole("button", { name: "Fork" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Independent event copy created.",
  );
  await expect(
    page.getByRole("button", { name: /Design review/ }),
  ).toHaveCount(2);

  await page.goto("/app/p/my-calendar/week?date=2026-07-26");
  await page.getByRole("button", { name: /Weekly review/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByRole("combobox", {
      name: "Recurring event delete scope",
    }),
  ).toHaveValue("occurrence");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Occurrence removed.",
  );
  await expect(
    page.getByRole("button", { name: /Weekly review/ }),
  ).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("exports and imports iCalendar files from calendar management", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await mockAuthenticatedReads(page);
  await page.goto("/app/p/my-calendar/month?date=2026-07-26");
  await page.getByRole("button", { name: "Calendars" }).click();
  await expect(
    page.getByRole("heading", { name: "Your calendars" }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "Calendar to export" })
    .selectOption("studio");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .ics" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Studio.ics");

  await page
    .getByLabel("Choose .ics file")
    .setInputFiles({
      buffer: Buffer.from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Roadmap\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      ),
      mimeType: "text/calendar",
      name: "roadmap.ics",
    });
  await page
    .getByRole("textbox", { name: "Imported calendar name" })
    .fill("Roadmap");
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Imported 1 event into Roadmap.",
  );
  const importedCalendar = page.getByRole("checkbox", {
    name: "Roadmap",
  });
  const importedCalendarRow = page
    .locator("label")
    .filter({ has: importedCalendar });
  await importedCalendarRow.scrollIntoViewIfNeeded();
  await expect(importedCalendar).toBeChecked();
  await expect(importedCalendarRow).toContainText("Roadmap");
  expect(runtimeErrors).toEqual([]);
});

test("saves revisioned settings and applies display preferences", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await mockAuthenticatedReads(page);
  await page.goto("/app/p/my-calendar/week?date=2026-07-26");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings" }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "Time format" })
    .selectOption("12h");
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Settings saved.",
  );
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect(
    page.getByRole("button", { name: /Weekly review/ }),
  ).toHaveAttribute("aria-label", /AM/);
  expect(runtimeErrors).toEqual([]);
});

test("recovers when settings fail to load", async ({ page }) => {
  await mockAuthenticatedReads(page);
  let attempts = 0;
  await page.route(
    "**/api/v1/users/settings/document",
    async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          body: "Cannot GET /api/v1/users/settings/document",
          contentType: "text/plain",
          status: 404,
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto("/app/p/my-calendar/week?date=2026-07-26");
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("alert")).toContainText("Not Found");
  await expect(page.getByText("Loading settings…")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("combobox", { name: "Theme" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("resolves the default page and switches between pages", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  const workPageId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/v1/pages", (route) =>
    respond(route, [
      defaultPage,
      {
        config: {
          calendarVisibility: { calendarIds: [], mode: "include" },
          filters: [],
          schemaVersion: 1,
          view: {
            configVersion: 1,
            density: "comfortable",
            id: "week",
            weekend: true,
          },
        },
        createdAt: "2026-07-01T00:00:00.000Z",
        id: workPageId,
        isDefault: false,
        name: "Work",
        position: 1,
        revision: 1,
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]),
  );

  // The "default" sentinel redirects to the real default Page, keeping view/date.
  await page.goto("/app/p/default/month?date=2026-07-26");
  await expect(page).toHaveURL(
    new RegExp(`/app/p/${DEFAULT_PAGE_ID}/month`),
  );
  await expect(page).toHaveURL(/[?&]date=2026-07-26/);

  // Both pages are listed; selecting one navigates without losing the date.
  await expect(
    page.getByRole("button", { name: "My calendar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Work" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/p/${workPageId}/month`));
  await expect(page).toHaveURL(/[?&]date=2026-07-26/);
});

test("moves and resizes an event by dragging it", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const writes: Array<{ end: string; start: string }> = [];
  // Record the write, then let the shared mock apply it to its event state —
  // otherwise the refetch that follows would undo the move.
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        end: string;
        start: string;
      };
      writes.push({ end: body.end, start: body.start });
    }
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-23`);
  // "Project check-in" is 07:30–08:30 UTC on this day.
  const block = page.getByRole("button", { name: /Project check-in/ }).first();
  await expect(block).toBeVisible();
  const before = (await block.boundingBox())!;

  // A drag has to travel past the threshold, so step the pointer.
  await page.mouse.move(before.x + before.width / 2, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + 40, {
    steps: 6,
  });
  await page.mouse.up();

  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Event moved.",
  );
  expect(writes).toHaveLength(1);
  // Moved later in the day, and the duration is preserved.
  const moved = writes[0]!;
  expect(new Date(moved.start).getTime()).toBeGreaterThan(
    new Date("2026-07-23T07:30:00.000Z").getTime(),
  );
  expect(
    new Date(moved.end).getTime() - new Date(moved.start).getTime(),
  ).toBe(60 * 60_000);

  // Resizing from the bottom edge changes only the end.
  const afterMove = (await block.boundingBox())!;
  await page.mouse.move(
    afterMove.x + afterMove.width / 2,
    afterMove.y + afterMove.height - 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    afterMove.x + afterMove.width / 2,
    afterMove.y + afterMove.height + 40,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Event resized.",
  );
  expect(writes).toHaveLength(2);
  const resized = writes[1]!;
  expect(resized.start).toBe(moved.start);
  expect(new Date(resized.end).getTime()).toBeGreaterThan(
    new Date(moved.end).getTime(),
  );
});

test("drags an empty interval to pre-fill quick create", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-30`);

  const column = page.locator("[data-time-grid-column]").first();
  await expect(column).toBeVisible();
  // The grid opens scrolled near the working day, which would put 02:00 above
  // the viewport.
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      '[class*="calendarArea"]',
    );
    if (scroller) scroller.scrollTop = 0;
  });
  const bounds = (await column.boundingBox())!;
  // 64px per hour at comfortable density: 128px down is 02:00, dragging 96px
  // further selects three quarters of an hour past that.
  const from = bounds.y + 128;

  await page.mouse.move(bounds.x + bounds.width / 2, from);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, from + 96, { steps: 8 });

  // The chosen interval is visible before the popover opens.
  await expect(page.getByText("02:00–03:30")).toBeVisible();
  await page.mouse.up();

  // Quick create opens with the dragged length, not a default hour.
  const start = page.getByLabel("Start time");
  const end = page.getByLabel("End time");
  await expect(start).toHaveValue("02:00");
  await expect(end).toHaveValue("03:30");
});

test("keeps the chosen interval visible while quick create is open", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-30`);
  const column = page.locator("[data-time-grid-column]").first();
  // Wait for the grid before scrolling it, or the scroll lands on nothing and
  // the click falls outside the columns.
  await expect(column).toBeVisible();
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      '[class*="calendarArea"]',
    );
    if (scroller) scroller.scrollTop = 0;
  });

  const bounds = (await column.boundingBox())!;
  // A plain click, not a drag: the slot it picked should still be shown.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 192);

  await expect(page.getByLabel("Start time")).toHaveValue("03:00");
  await expect(page.getByText("03:00–04:00")).toBeVisible();

  // Dismissing the popover clears it again.
  await page.keyboard.press("Escape");
  await expect(page.getByText("03:00–04:00")).toHaveCount(0);
});

test("moves an event to another day in the month grid", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const writes: Array<{ end: string; start: string }> = [];
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        end: string;
        start: string;
      };
      writes.push({ end: body.end, start: body.start });
    }
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  const chip = page
    .getByRole("button", { name: /Project check-in/ })
    .first();
  await expect(chip).toBeVisible();
  const from = (await chip.boundingBox())!;
  const target = page.locator('[data-day-key="2026-07-27"]');
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(target).toHaveAttribute("data-drop-target", "");
  await page.mouse.up();

  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Event moved.",
  );
  expect(writes).toHaveLength(1);
  // The date moved by a day and the time of day is preserved.
  const moved = writes[0]!;
  expect(new Date(moved.start).toISOString()).toContain("2026-07-27");
  expect(new Date(moved.start).getUTCHours()).toBe(7);
  expect(
    new Date(moved.end).getTime() - new Date(moved.start).getTime(),
  ).toBe(60 * 60_000);
});

test("moves an event with the keyboard", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const writes: Array<{ end: string; start: string }> = [];
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        end: string;
        start: string;
      };
      writes.push({ end: body.end, start: body.start });
    }
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-23`);
  const block = page.getByRole("button", { name: /Project check-in/ }).first();
  await block.focus();

  // Alt+Down moves by one snap interval; the change is announced.
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator('[aria-live="polite"]')).toContainText("now ");
  expect(writes).toHaveLength(1);
  expect(
    new Date(writes[0]!.end).getTime() - new Date(writes[0]!.start).getTime(),
  ).toBe(60 * 60_000);

  // Alt+Shift+Down lengthens it instead of moving it.
  await block.focus();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  expect(writes).toHaveLength(2);
  expect(writes[1]!.start).toBe(writes[0]!.start);
  expect(new Date(writes[1]!.end).getTime()).toBeGreaterThan(
    new Date(writes[0]!.end).getTime(),
  );
});

test("cancels a drag with Escape and leaves the event alone", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  let writes = 0;
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "PUT") writes += 1;
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-23`);
  const block = page.getByRole("button", { name: /Project check-in/ }).first();
  await expect(block).toBeVisible();
  const before = (await block.boundingBox())!;

  await page.mouse.move(before.x + before.width / 2, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + 60, {
    steps: 6,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();

  // Escape cancels the drag, not the screen: nothing is written and the block
  // returns to where it was.
  expect(writes).toBe(0);
  const after = (await block.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
});

test("changes time grid density from the page editor", async ({ page }) => {
  await mockAuthenticatedReads(page);
  let savedDensity: string | undefined;
  const weekPage = {
    ...defaultPage,
    config: {
      ...defaultPage.config,
      view: {
        configVersion: 1,
        density: "comfortable",
        id: "week",
        weekend: true,
      },
    },
  };
  await page.route("**/api/v1/pages", (route) => respond(route, [weekPage]));
  await page.route(`**/api/v1/pages/${DEFAULT_PAGE_ID}`, async (route) => {
    const body = route.request().postDataJSON() as {
      config: { view: { density?: string } };
    };
    savedDensity = body.config.view.density;
    return respond(route, { ...weekPage, config: body.config, revision: 2 });
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/week?date=2026-07-26`);

  // The grid height is derived from the same geometry as the event maths, so a
  // density change has to move it.
  const canvas = page.locator('[class*="timeGridCanvas"]');
  await expect(canvas).toBeVisible();
  const canvasHeight = async () =>
    (await canvas.boundingBox())?.height ?? 0;

  const comfortable = await canvasHeight();
  expect(comfortable).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Edit page" }).click();
  await page
    .getByRole("combobox", { name: "Row height" })
    .selectOption("compact");

  const compact = await canvasHeight();
  expect(compact).toBeLessThan(comfortable);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Page saved.",
  );
  expect(savedDensity).toBe("compact");
});

test("edits and saves a page's calendar visibility", async ({ page }) => {
  await mockAuthenticatedReads(page);
  let saved: { config?: { calendarVisibility?: unknown } } | undefined;
  await page.route(
    `**/api/v1/pages/${DEFAULT_PAGE_ID}`,
    async (route) => {
      const body = route.request().postDataJSON() as {
        config: unknown;
        name: string;
      };
      saved = body;
      return respond(route, {
        ...defaultPage,
        config: body.config,
        name: body.name,
        revision: 2,
      });
    },
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(
    page.getByRole("checkbox", { name: "Studio" }),
  ).toBeChecked();

  await page.getByRole("button", { name: "Edit page" }).click();
  // The real checkbox is visually collapsed; toggle it through its label text.
  await page.getByText("Studio", { exact: true }).click();
  await expect(page.getByText("Unsaved page changes")).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Page saved.",
  );
  expect(saved?.config?.calendarVisibility).toEqual({
    hiddenCalendarIds: ["studio"],
    mode: "all",
  });
  // Read mode now reflects the saved visibility.
  await expect(
    page.getByRole("checkbox", { name: "Studio" }),
  ).not.toBeChecked();
});

test("surfaces a page save conflict without overwriting", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.route(
    `**/api/v1/pages/${DEFAULT_PAGE_ID}`,
    (route) =>
      route.fulfill({
        body: JSON.stringify({
          current: { ...defaultPage, revision: 9 },
          error: "PAGE_CONFLICT",
          message: "Page changed on another device.",
          requestId: "page-conflict",
        }),
        contentType: "application/json",
        headers: { "x-request-id": "page-conflict" },
        status: 409,
      }),
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Edit page" }).click();
  // The real checkbox is visually collapsed; toggle it through its label text.
  await page.getByText("Studio", { exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(
    page.getByText("This page changed on another device", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save as a copy" }),
  ).toBeVisible();
});

test("applies a realtime page created in another session", async ({ page }) => {
  // Replace EventSource with a controllable fake so the test can push a server
  // event deterministically (Playwright can't stream a real SSE response).
  await page.addInitScript(() => {
    class FakeEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;
      readyState = 1;
      constructor(public url: string) {
        (window as unknown as { __sse: FakeEventSource[] }).__sse ??= [];
        (window as unknown as { __sse: FakeEventSource[] }).__sse.push(this);
      }
      close() {
        this.readyState = 2;
      }
      addEventListener() {}
      removeEventListener() {}
    }
    (window as unknown as { EventSource: unknown }).EventSource =
      FakeEventSource;
  });

  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(
    page.getByRole("button", { name: "My calendar" }),
  ).toBeVisible();

  const sharedPage = {
    ...defaultPage,
    id: "33333333-3333-4333-8333-333333333333",
    isDefault: false,
    name: "Shared plan",
    position: 1,
  };
  await page.evaluate((data) => {
    const sockets = (window as unknown as { __sse?: Array<{ onmessage: ((e: { data: string }) => void) | null }> }).__sse;
    sockets?.[sockets.length - 1]?.onmessage?.({ data });
  }, JSON.stringify({ payload: { page: sharedPage }, type: "page_created" }));

  // The page created elsewhere shows up without a manual refresh.
  await expect(
    page.getByRole("button", { name: "Shared plan" }),
  ).toBeVisible();
});

test("creates, renames and deletes a calendar", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "Calendars" }).click();
  await expect(
    page.getByRole("heading", { name: "Your calendars" }),
  ).toBeVisible();

  // Create
  await page.getByPlaceholder("New calendar").fill("Travel");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Travel created.",
  );
  const travelRow = page
    .getByRole("listitem")
    .filter({ hasText: "Travel" });
  await expect(travelRow).toBeVisible();

  // Rename
  await page.getByRole("button", { name: "Rename Travel" }).click();
  await page
    .getByRole("textbox", { name: "Rename Travel" })
    .fill("Trips");
  await page.getByRole("button", { name: "Save calendar" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Calendar updated.",
  );
  await expect(
    page.getByRole("listitem").filter({ hasText: "Trips" }),
  ).toBeVisible();

  // Delete (accepts the confirm dialog)
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete Trips" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Trips deleted.",
  );
  await expect(
    page.getByRole("listitem").filter({ hasText: "Trips" }),
  ).toHaveCount(0);
});

test("manages members and invite links for a calendar", async ({ page }) => {
  await mockAuthenticatedReads(page);
  let members = [
    { id: "user-web-qa", image: null, name: "Web QA", role: "owner" },
    { id: "member-2", image: null, name: "Sam Rivers", role: "viewer" },
  ];
  let invites: Array<{ id: string }> = [];
  let inviteSeq = 0;
  const empty = (route: Route) =>
    route.fulfill({ body: "", status: 200 });

  await page.route("**/api/v1/calendars/*/members/*", (route) => {
    const method = route.request().method();
    const memberId = route.request().url().split("/").pop();
    if (method === "PUT") {
      const role = (route.request().postDataJSON() as { role: string }).role;
      members = members.map((member) =>
        member.id === memberId ? { ...member, role } : member,
      );
      return empty(route);
    }
    if (method === "DELETE") {
      members = members.filter((member) => member.id !== memberId);
      return empty(route);
    }
    return route.fallback();
  });
  await page.route("**/api/v1/calendars/*/members", (route) =>
    respond(route, members),
  );
  await page.route("**/api/v1/calendars/*/invites", (route) =>
    respond(route, invites),
  );
  await page.route("**/api/v1/calendars/invites", (route) => {
    inviteSeq += 1;
    const created = {
      calendarID: "44444444-4444-4444-8444-444444444444",
      expiresAt: null,
      id: `invite-${inviteSeq}`,
      maxUses: null,
      uses: 0,
    };
    invites = [...invites, created];
    return respond(route, created, 201);
  });
  await page.route("**/api/v1/calendars/invites/*", (route) => {
    const inviteId = route.request().url().split("/").pop();
    invites = invites.filter((invite) => invite.id !== inviteId);
    return empty(route);
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Calendars" }).click();
  await page.getByRole("button", { name: "Share Studio" }).click();

  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await expect(page.getByText("Sam Rivers", { exact: true })).toBeVisible();

  // Promote Sam to editor.
  await page
    .getByRole("combobox", { name: "Sam Rivers role" })
    .selectOption("editor");
  await expect(
    page.getByRole("combobox", { name: "Sam Rivers role" }),
  ).toHaveValue("editor");

  // Create then revoke an invite link.
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(
    page.getByRole("textbox", { name: "Invite link" }),
  ).toHaveValue(/\/invite\/invite-1$/);
  await page.getByRole("button", { name: "Revoke invite link" }).click();
  await expect(
    page.getByRole("textbox", { name: "Invite link" }),
  ).toHaveCount(0);

  // Remove Sam entirely.
  await page.getByRole("button", { name: "Remove Sam Rivers" }).click();
  await expect(page.getByText("Sam Rivers", { exact: true })).toHaveCount(0);
});

test("transfers calendar ownership", async ({ page }) => {
  await mockAuthenticatedReads(page);
  let members = [
    { id: "user-web-qa", image: null, name: "Web QA", role: "owner" },
    { id: "member-2", image: null, name: "Sam Rivers", role: "editor" },
  ];
  let transferredRole: string | undefined;
  await page.route("**/api/v1/calendars/*/members/*", (route) => {
    if (route.request().method() === "PUT") {
      const role = (route.request().postDataJSON() as { role: string }).role;
      const memberId = route.request().url().split("/").pop();
      transferredRole = role;
      members = members.map((member) =>
        member.id === memberId ? { ...member, role } : member,
      );
      return route.fulfill({ body: "", status: 200 });
    }
    return route.fallback();
  });
  await page.route("**/api/v1/calendars/*/members", (route) =>
    respond(route, members),
  );
  await page.route("**/api/v1/calendars/*/invites", (route) =>
    respond(route, []),
  );
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Calendars" }).click();
  await page.getByRole("button", { name: "Share Studio" }).click();
  await expect(page.getByText("Sam Rivers", { exact: true })).toBeVisible();

  await page
    .getByRole("combobox", { name: "Sam Rivers role" })
    .selectOption("owner");

  // The new owner loses the role control (shown as an Owner badge instead).
  await expect(
    page.getByRole("combobox", { name: "Sam Rivers role" }),
  ).toHaveCount(0);
  expect(transferredRole).toBe("owner");
});

test("connects and disconnects calendar providers", async ({ page }) => {
  const withExternal = [
    ...calendars,
    {
      accountId: "acc-1",
      accountLabel: "work@gmail.com",
      color: "#4285f4",
      creatorID: "user-web-qa",
      id: "g-cal-1",
      members: [],
      name: "Work (Google)",
      provider: "google",
      role: "owner",
      syncStatus: "active",
    },
  ];
  await mockAuthenticatedReads(page, events, withExternal);
  let disconnectBody: unknown;
  let caldavBody: unknown;
  await page.route("**/api/v1/server", (route) =>
    respond(route, {
      email: true,
      minClientVersion: "0.1.2",
      socials: ["google"],
      syncProviders: ["google", "microsoft", "caldav"],
    }),
  );
  await page.route("**/api/v1/users/connections/disconnect", (route) => {
    disconnectBody = route.request().postDataJSON();
    return route.fulfill({ body: "", status: 200 });
  });
  await page.route("**/api/v1/users/connections/caldav", (route) => {
    if (route.request().method() === "POST") {
      caldavBody = route.request().postDataJSON();
      return route.fulfill({ body: "", status: 200 });
    }
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Connections" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Connections" }),
  ).toBeVisible();

  // Capability-gated add buttons.
  await expect(
    page.getByRole("button", { name: "Connect Google Calendar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Apple / iCloud" }),
  ).toBeVisible();

  // Connected account shows and disconnects.
  await expect(page.getByText("work@gmail.com")).toBeVisible();
  await page
    .getByRole("button", { name: "Disconnect work@gmail.com" })
    .click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "work@gmail.com disconnected.",
  );
  expect(disconnectBody).toEqual({ accountId: "acc-1", provider: "google" });

  // CalDAV/Apple connect form.
  await page.getByRole("button", { name: "Connect Apple / iCloud" }).click();
  await page.getByPlaceholder("Apple ID email").fill("me@icloud.com");
  await page.getByPlaceholder("Password").fill("app-specific-pw");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Calendar connected.",
  );
  expect(caldavBody).toEqual({
    password: "app-specific-pw",
    serverUrl: "https://caldav.icloud.com",
    username: "me@icloud.com",
  });
});

test("shows federated calendars and reports an unreachable server", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  let disconnectedServer: unknown;
  await page.route("**/api/v1/federation/connections", (route) =>
    respond(route, [
      { id: "conn-1", label: "friends.example", remoteUserID: "fed_1", server: "https://friends.example" },
      { id: "conn-2", label: "dead.example", remoteUserID: "fed_2", server: "https://dead.example" },
    ]),
  );
  // Reachable server: one shared calendar with one event.
  await page.route(
    "**/api/v1/federation/s/conn-1/api/v1/calendars",
    (route) =>
      respond(route, [
        {
          color: "#8a6fae",
          creatorID: "remote-owner",
          id: "remote-cal-1",
          members: [],
          name: "Book club",
          role: "editor",
        },
      ]),
  );
  await page.route("**/api/v1/federation/s/conn-1/api/v1/events", (route) =>
    respond(route, {
      deletedIds: [],
      events: [
        event(
          "remote-book-club",
          "Book club meetup",
          "remote-cal-1",
          "#8a6fae",
          "2026-07-23T17:00:00.000Z",
          "2026-07-23T18:30:00.000Z",
        ),
      ],
      serverTime: "2026-07-26T14:00:00.000Z",
    }),
  );
  // Unreachable server: the gateway reports 502.
  await page.route("**/api/v1/federation/s/conn-2/**", (route) =>
    route.fulfill({
      body: JSON.stringify({
        error: "FederatedServerUnreachable",
        message: "The connected Musubi server could not be reached.",
      }),
      contentType: "application/json",
      status: 502,
    }),
  );
  await page.route("**/api/v1/users/connections/musubi", (route) => {
    disconnectedServer = route.request().postDataJSON();
    return route.fulfill({ body: "", status: 200 });
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  // The remote calendar and its event render like any other.
  await expect(
    page.getByRole("checkbox", { name: "Book club" }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: /Book club meetup/ }),
  ).toBeVisible();
  // A dead server must not take the home calendar down with it.
  await expect(
    page.getByRole("button", { name: /Weekly review/ }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Musubi servers" }),
  ).toBeVisible();
  const deadRow = page
    .getByRole("listitem")
    .filter({ hasText: "dead.example" });
  await expect(deadRow).toContainText("Unreachable");
  // Transient failures offer a retry, not a re-invite.
  await expect(
    page.getByRole("button", { name: "Retry dead.example" }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "friends.example" }),
  ).toContainText("Connected");

  // Disconnecting a federated server uses its own endpoint, not provider disconnect.
  await page.getByRole("button", { name: "Disconnect dead.example" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "dead.example disconnected.",
  );
  expect(disconnectedServer).toEqual({ server: "https://dead.example" });
});

test("routes federated event writes through the gateway", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const remoteCalendar = {
    color: "#8a6fae",
    creatorID: "user-web-qa",
    id: "remote-cal-1",
    members: [],
    name: "Book club",
    role: "owner",
  };
  let remoteEvents = [
    event(
      "remote-book-club",
      "Book club meetup",
      "remote-cal-1",
      "#8a6fae",
      "2026-07-23T17:00:00.000Z",
      "2026-07-23T18:30:00.000Z",
    ),
  ];
  let homeWrites = 0;
  const gatewayWrites: string[] = [];

  // Registered first: a later route wins in Playwright, and the gateway paths
  // below also end in /api/v1/events. Any home write here would be a routing bug.
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() !== "GET") {
      homeWrites += 1;
      return respond(route, {}, 500);
    }
    return route.fallback();
  });

  await page.route("**/api/v1/federation/connections", (route) =>
    respond(route, [
      { id: "conn-1", label: "friends.example", remoteUserID: "fed_1", server: "https://friends.example" },
    ]),
  );
  await page.route(
    "**/api/v1/federation/s/conn-1/api/v1/calendars",
    (route) => respond(route, [remoteCalendar]),
  );
  await page.route(
    "**/api/v1/federation/s/conn-1/api/v1/events",
    async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        return respond(route, {
          deletedIds: [],
          events: remoteEvents,
          serverTime: "2026-07-26T14:00:00.000Z",
        });
      }
      gatewayWrites.push(method);
      const body = route.request().postDataJSON() as (typeof remoteEvents)[number];
      if (method === "PUT") {
        remoteEvents = remoteEvents.map((item) =>
          item.id === body.id ? body : item,
        );
        return respond(route, body);
      }
      return respond(route, body);
    },
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: /Book club meetup/ }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Book club — new venue");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Event updated.",
  );
  expect(gatewayWrites).toEqual(["PUT"]);
  expect(homeWrites).toBe(0);
  await expect(
    page.getByRole("button", { name: /Book club — new venue/ }),
  ).toBeVisible();
});

test("distinguishes a revoked federated token from an outage", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.route("**/api/v1/federation/connections", (route) =>
    respond(route, [
      { id: "conn-1", label: "revoked.example", remoteUserID: "fed_1", server: "https://revoked.example" },
    ]),
  );
  // The origin rejects our member token (kicked, or the token expired). The
  // gateway relays that status unchanged.
  await page.route("**/api/v1/federation/s/conn-1/**", (route) =>
    route.fulfill({
      body: JSON.stringify({ error: "Unauthorized", message: "Unauthorized" }),
      contentType: "application/json",
      status: 401,
    }),
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Connections" }).click();

  const row = page
    .getByRole("listitem")
    .filter({ hasText: "revoked.example" });
  // A dead credential needs a new invite — retrying would never fix it.
  await expect(row).toContainText("Needs a new invite");
  await expect(
    page.getByRole("button", { name: "Retry revoked.example" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Disconnect revoked.example" }),
  ).toBeVisible();
});

test("refreshes federated calendars on a realtime federated_sync", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FakeEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;
      readyState = 1;
      constructor(public url: string) {
        (window as unknown as { __sse: FakeEventSource[] }).__sse ??= [];
        (window as unknown as { __sse: FakeEventSource[] }).__sse.push(this);
      }
      close() {
        this.readyState = 2;
      }
      addEventListener() {}
      removeEventListener() {}
    }
    (window as unknown as { EventSource: unknown }).EventSource =
      FakeEventSource;
  });

  await mockAuthenticatedReads(page);
  let remoteName = "Book club";
  await page.route("**/api/v1/federation/connections", (route) =>
    respond(route, [
      { id: "conn-1", label: "friends.example", remoteUserID: "fed_1", server: "https://friends.example" },
    ]),
  );
  await page.route(
    "**/api/v1/federation/s/conn-1/api/v1/calendars",
    (route) =>
      respond(route, [
        {
          color: "#8a6fae",
          creatorID: "remote-owner",
          id: "remote-cal-1",
          members: [],
          name: remoteName,
          role: "viewer",
        },
      ]),
  );
  await page.route("**/api/v1/federation/s/conn-1/api/v1/events", (route) =>
    respond(route, {
      deletedIds: [],
      events: [],
      serverTime: "2026-07-26T14:00:00.000Z",
    }),
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(
    page.getByRole("checkbox", { name: "Book club" }),
  ).toBeChecked();

  // The remote calendar is renamed on its own server; our server relays the
  // change as federated_sync and the snapshot refetches.
  remoteName = "Book club (Thursdays)";
  await page.evaluate(() => {
    const sockets = (
      window as unknown as {
        __sse?: Array<{ onmessage: ((e: { data: string }) => void) | null }>;
      }
    ).__sse;
    sockets?.[sockets.length - 1]?.onmessage?.({
      data: JSON.stringify({
        payload: { server: "https://friends.example" },
        type: "federated_sync",
      }),
    });
  });

  await expect(
    page.getByRole("checkbox", { name: "Book club (Thursdays)" }),
  ).toBeChecked();
});

test("joins a calendar from a pasted cross-server invite link", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  const token = "0f9c1d2e3a4b5c6d7e8f9a0b1c2d3e4f";
  let previewQuery: string | undefined;
  let connectBody: unknown;

  await page.route("**/api/v1/federation/preview?*", (route) => {
    previewQuery = new URL(route.request().url()).search;
    return respond(route, {
      color: "#8a6fae",
      events: [
        {
          end: "2026-07-28T18:00:00.000Z",
          id: "remote-1",
          isAllDay: false,
          start: "2026-07-28T17:00:00.000Z",
          title: "Book club",
        },
      ],
      id: "remote-cal-1",
      members: [{ id: "remote-owner", image: null, name: "Sam Rivers" }],
      name: "Book club",
    });
  });
  await page.route("**/api/v1/federation/connect", (route) => {
    connectBody = route.request().postDataJSON();
    return respond(route, { calendar: null, server: "https://friends.example" });
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Join a shared calendar" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Invite link" })
    .fill(`https://friends.example/invite/${token}`);
  await page.getByRole("button", { name: "Open invite" }).click();

  // Preview is fetched through the home server, and shows what we're joining.
  await expect(page.getByText("1 member · 1 event")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "friends.example" }),
  ).toHaveCount(0); // not connected yet
  expect(previewQuery).toContain("server=https%3A%2F%2Ffriends.example");
  expect(previewQuery).toContain(`token=${token}`);

  await page.getByRole("button", { name: "Join calendar" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Joined Book club.",
  );
  // The handshake runs server-side — no member token is sent by the browser.
  expect(connectBody).toEqual({
    server: "https://friends.example",
    token,
  });
});

test("joins a calendar from an invite link on this server", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const token = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
  let joinedCalendarId: string | undefined;

  await page.route(`**/api/v1/calendars/tokens/${token}`, (route) =>
    respond(route, {
      color: "#b3492f",
      events: [],
      id: "shared-cal",
      members: [{ id: "owner-1", image: null, name: "Ada" }],
      name: "Shared plans",
    }),
  );
  await page.route("**/api/v1/calendars/members/shared-cal", (route) => {
    joinedCalendarId = "shared-cal";
    return respond(route, {});
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Connections" }).click();
  // A bare token is accepted too.
  await page.getByRole("textbox", { name: "Invite link" }).fill(token);
  await page.getByRole("button", { name: "Open invite" }).click();

  await expect(page.getByText("Shared plans", { exact: true })).toBeVisible();
  await expect(page.getByText("This server")).toBeVisible();

  await page.getByRole("button", { name: "Join calendar" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Joined Shared plans.",
  );
  expect(joinedCalendarId).toBe("shared-cal");
});

test("updates the display name and gates account deletion", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  let deleteRequested = false;
  await page.route("**/api/auth/update-user", (route) =>
    respond(route, { status: true }),
  );
  await page.route("**/api/auth/request-password-reset", (route) =>
    respond(route, { status: true }),
  );
  await page.route("**/api/v1/users", (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequested = true;
      return route.fulfill({ body: "", status: 200 });
    }
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Manage account" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Account" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Display name" })
    .fill("Web QA Updated");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Name updated.",
  );

  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Check your email for a link to reset your password.",
  );

  // Deletion needs the exact display name typed to confirm.
  const deleteButton = page.getByRole("button", { name: "Delete account" });
  await expect(deleteButton).toBeDisabled();
  await page.getByPlaceholder("Web QA").fill("wrong");
  await expect(deleteButton).toBeDisabled();
  await page.getByPlaceholder("Web QA").fill("Web QA");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(page.locator('[aria-live="polite"]')).toContainText(
    "Check your email",
  );
  expect(deleteRequested).toBe(true);
});

test("drags across month days to create an all-day range", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const from = page.locator('[data-day-key="2026-07-28"]');
  const to = page.locator('[data-day-key="2026-07-30"]');
  await expect(from).toBeVisible();
  const fromBox = (await from.boundingBox())!;
  const toBox = (await to.boundingBox())!;

  // Press near the bottom of the cell, clear of the day number and any chips.
  await page.mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height - 6,
  );
  await page.mouse.down();
  await page.mouse.move(
    toBox.x + toBox.width / 2,
    toBox.y + toBox.height - 6,
    { steps: 8 },
  );
  // Every day in the range is highlighted while dragging.
  await expect(page.locator("[data-range-selected]")).toHaveCount(3);
  await page.mouse.up();

  // Quick create opens pre-filled as an all-day event spanning the range.
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-07-28");
  await expect(page.getByLabel("Ends")).toHaveValue("2026-07-30");
  // The tint hands over to the draft pill, which spans the same three days.
  await expect(page.locator("[data-range-selected]")).toHaveCount(0);
  await expect(page.locator("[data-draft]")).toHaveCount(3);

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-draft]")).toHaveCount(0);
});

test("dragging backwards across month days still creates a forward range", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const from = page.locator('[data-day-key="2026-07-30"]');
  const to = page.locator('[data-day-key="2026-07-28"]');
  await expect(from).toBeVisible();
  const fromBox = (await from.boundingBox())!;
  const toBox = (await to.boundingBox())!;

  await page.mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height - 6,
  );
  await page.mouse.down();
  await page.mouse.move(
    toBox.x + toBox.width / 2,
    toBox.y + toBox.height - 6,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-07-28");
  await expect(page.getByLabel("Ends")).toHaveValue("2026-07-30");
});

test("asks which occurrences a dragged series should change", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/v1/events", async (route) => {
    const method = route.request().method();
    if (method === "PUT" || method === "POST") {
      writes.push({
        body: route.request().postDataJSON() as Record<string, unknown>,
        method,
      });
    }
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  const chip = page.getByRole("button", { name: /Weekly review/ }).first();
  await expect(chip).toBeVisible();
  const from = (await chip.boundingBox())!;
  const target = page.locator('[data-day-key="2026-07-29"]');
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  // Nothing is written until the scope is answered.
  const dialog = page.getByRole("dialog", { name: "Change recurring event" });
  await expect(dialog).toBeVisible();
  expect(writes).toHaveLength(0);

  // Dismissing writes nothing at all.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(0);

  // Drag again and detach this one occurrence.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "This event" }).click();

  await expect(page.getByRole("status")).toContainText("Event moved.");
  // The series keeps its rule minus this date, and the moved occurrence is a
  // new standalone event.
  const updated = writes.find((write) => write.method === "PUT")!;
  expect(updated.body.recurrence).toContain("EXDATE:");
  const created = writes.find((write) => write.method === "POST")!;
  expect(created.body.recurrence).toBeNull();
  expect(created.body.id).not.toBe("weekly-review");
});

test("navigates by keyboard and documents the map behind ?", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByText("July 2026")).toBeVisible();

  // View switching, period paging and Today all run the same path as the
  // controls, so the URL follows.
  await page.keyboard.press("w");
  await expect(page).toHaveURL(/\/week\?/);
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/date=2026-07-19/);
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/date=2026-07-26/);
  await page.keyboard.press("m");
  await expect(page).toHaveURL(/\/month\?/);

  // "/" puts the caret in search rather than typing a shortcut.
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.type("client");
  await expect(page.getByRole("searchbox")).toHaveValue("client");
  await page.keyboard.press("Escape");

  // "?" opens the overlay listing the same shortcuts.
  await page.getByRole("searchbox").blur();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("New event");
  await expect(dialog).toContainText("Alt + arrows");
  await expectNoAccessibilityViolations(page);
});

test("jumps to a date from the mini calendar without changing the view", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/week?date=2026-07-26`);

  const mini = page.getByRole("region", { name: "Jump to date" });
  await expect(mini).toContainText("Jul 2026");
  // One tab stop: the day the view is on.
  await expect(
    mini.getByRole("gridcell", { name: /July 26, 2026/ }),
  ).toHaveAttribute("tabindex", "0");

  await mini.getByRole("gridcell", { name: /July 9, 2026/ }).click();
  await expect(page).toHaveURL(/\/week\?date=2026-07-09/);

  // Paging the mini leaves the main view where it is.
  await mini.getByRole("button", { name: "Next month in date picker" }).click();
  await expect(mini).toContainText("Aug 2026");
  await expect(page).toHaveURL(/date=2026-07-09/);
});

test("keeps the calendar on screen while the next range loads", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByText("July 2026")).toBeVisible();

  // Hold the next range's read open, so the transition is observable.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/events**", async (route) => {
    if (route.request().method() === "GET") await held;
    return route.fallback();
  });

  await page.keyboard.press("n");
  // The old month stays up, marked as refreshing — no loading screen swap.
  await expect(page.getByText("Preparing your calendar…")).toHaveCount(0);
  await expect(page.getByText("Refreshing server data…")).toBeVisible();
  // The grid, the toolbar and the day cells are all still there.
  await expect(page.getByText("August 2026")).toBeVisible();
  await expect(page.locator('[data-day-key="2026-08-05"]')).toBeVisible();

  release();
  // August's own occurrences arrive once the read completes.
  await expect(
    page.getByRole("button", { name: /Weekly review/ }).first(),
  ).toBeVisible();
});

test("scales what an event block shows to the height it has", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-23`);

  const block = page.locator("[data-time-event]").first();
  await expect(block).toBeVisible();
  const time = block.locator('[class*="timelineEventTime"]');
  // An hour-long block at comfortable density has room for the time.
  await expect(time).toBeVisible();

  // Shrink it to a sliver: the title stays, the time drops out. No JS threshold
  // is involved — the block queries its own box.
  await block.evaluate((element: HTMLElement) => {
    element.style.height = "18px";
  });
  await expect(time).toBeHidden();
  await expect(block.locator('[class*="timelineEventTitle"]')).toBeVisible();

  await block.evaluate((element: HTMLElement) => {
    element.style.height = "120px";
  });
  await expect(time).toBeVisible();
});

test("marks a recurring event with more than its colour", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const recurring = page.getByRole("button", { name: /Weekly review/ }).first();
  await expect(recurring.locator("svg.lucide-repeat")).toBeVisible();
  // A one-off event carries no mark.
  const single = page.getByRole("button", { name: /Client call/ }).first();
  await expect(single.locator('[class*="eventMarks"]')).toHaveCount(0);
});

test("says an event is unsettled while its write is in flight", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "PUT") await held;
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-23`);
  const block = page.getByRole("button", { name: /Project check-in/ }).first();
  await block.focus();
  await page.keyboard.press("Alt+ArrowDown");

  await expect(block).toHaveAttribute("aria-busy", "true");
  await expect(block).toHaveAttribute("data-pending", "");

  release();
  await expect(block).not.toHaveAttribute("data-pending", "");
});

test("turns anchored surfaces into sheets on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  // Create sits within thumb reach rather than in the toolbar.
  const create = page.getByRole("button", { name: "Event", exact: true });
  const fab = (await create.boundingBox())!;
  expect(fab.y).toBeGreaterThan(500);
  expect(Math.round(fab.width)).toBe(Math.round(fab.height));

  await create.click();
  // The popover is a bottom sheet: full width, sitting on the bottom edge.
  const sheet = page.getByRole("dialog", { name: "Create event" });
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(721);
  expect(box.x).toBe(0);

  // It is still the same layer: Escape dismisses it and focus is handled.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expectNoAccessibilityViolations(page);
});

test("opens an event's details as a sheet on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: /Client call/ }).first().click();
  const sheet = page.getByRole("dialog").first();
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  // Tall content scrolls inside the sheet instead of running off the screen.
  expect(box.height).toBeLessThanOrEqual(720 * 0.86 + 1);
  await expect(
    page.getByRole("heading", { name: "Client call" }),
  ).toBeVisible();
});




test("keeps the page name and theme out of the calendar chrome", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  // No theme control in the toolbar: it is a setting, and it lives in Settings.
  await expect(
    page.getByRole("button", { name: /theme/i }),
  ).toHaveCount(0);
  // The page name is the sidebar's job; the heading stays for structure only.
  await expect(
    page.getByRole("button", { name: "My calendar" }),
  ).toBeVisible();

  // Renaming still has a field, in the row edit mode brings with it.
  await page.getByRole("button", { name: "Edit page" }).click();
  await expect(page.getByLabel("Page name")).toHaveValue("My calendar");
  await page.getByRole("button", { name: "Finish editing page" }).click();
  await expect(page.getByLabel("Page name")).toHaveCount(0);
});

test("leaves a draft on the grid that can be moved before saving", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-30`);
  const column = page.locator("[data-time-grid-column]").first();
  await expect(column).toBeVisible();
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      '[class*="calendarArea"]',
    );
    if (scroller) scroller.scrollTop = 0;
  });

  // Drag out a 90-minute slot.
  const bounds = (await column.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 128);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 224, {
    steps: 6,
  });
  await page.mouse.up();

  const start = page.getByLabel("Start time");
  await expect(start).toHaveValue("02:00");
  await expect(page.getByLabel("End time")).toHaveValue("03:30");

  // Type a title, then drag the draft itself: the time follows, the title stays.
  await page.getByRole("textbox", { name: "Event title" }).fill("Deep work");
  const draft = page.locator("[data-draft]");
  await expect(draft).toBeVisible();
  // It reads as the event it is about to become, not as a selection.
  await expect(draft).toContainText("New event");
  await expect(draft).toContainText("02:00–03:30");
  const draftBox = (await draft.boundingBox())!;
  await page.mouse.move(
    draftBox.x + draftBox.width / 2,
    draftBox.y + draftBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    draftBox.x + draftBox.width / 2,
    draftBox.y + draftBox.height / 2 + 64,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(start).toHaveValue("03:00");
  await expect(page.getByLabel("End time")).toHaveValue("04:30");
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toHaveValue("Deep work");

  // Saving writes the dragged time.
  const writes: Array<{ end: string; start: string }> = [];
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        end: string;
        start: string;
      };
      writes.push({ end: body.end, start: body.start });
    }
    return route.fallback();
  });
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Event created.");
  expect(new Date(writes[0]!.start).getHours()).toBe(3);
  expect(
    new Date(writes[0]!.end).getTime() - new Date(writes[0]!.start).getTime(),
  ).toBe(90 * 60_000);
});

test("leaves a draggable pill on the month grid", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const from = page.locator('[data-day-key="2026-07-28"]');
  const to = page.locator('[data-day-key="2026-07-30"]');
  await expect(from).toBeVisible();
  const fromBox = (await from.boundingBox())!;
  const toBox = (await to.boundingBox())!;

  await page.mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height - 6,
  );
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height - 6, {
    steps: 8,
  });
  await page.mouse.up();

  // One pill per covered day, flat where it runs into the next cell.
  await expect(page.locator("[data-draft]")).toHaveCount(3);
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-07-28",
  );
  await page.getByRole("textbox", { name: "Event title" }).fill("Retreat");

  // Grab the pill and move the whole range a day later.
  const pill = page.locator("[data-draft]").first();
  const pillBox = (await pill.boundingBox())!;
  const target = page.locator('[data-day-key="2026-07-29"]');
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(
    pillBox.x + pillBox.width / 2,
    pillBox.y + pillBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    pillBox.y + pillBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-07-29",
  );
  await expect(page.getByLabel("Ends")).toHaveValue("2026-07-31");
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toHaveValue("Retreat");
});




test("asks for a name and a time first, the rest on request", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.locator('[data-day-key="2026-07-15"]').click();

  const bubble = page.getByRole("dialog", { name: "Create event" });
  await expect(bubble).toBeVisible();
  // What a new event cannot do without: name, when, which calendar.
  await expect(page.getByRole("textbox", { name: "Event title" })).toBeFocused();
  await expect(page.getByLabel("Date", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Start time")).toBeVisible();
  await expect(bubble.getByRole("combobox")).toBeVisible();
  // Everything else is out of the way until asked for.
  await expect(page.getByPlaceholder("Add location")).toHaveCount(0);
  await expect(page.getByPlaceholder("Add notes")).toHaveCount(0);
  await expect(page.getByLabel("Repeat")).toHaveCount(0);
  await expect(page.getByText("Also show in")).toHaveCount(0);

  // The short way out is still one click.
  await page.getByRole("textbox", { name: "Event title" }).fill("Studio time");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Event created.");
});

test("keeps the full editor whole when editing an event", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: /Client call/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  // Editing is the heavy layer: nothing is hidden behind a disclosure.
  await expect(page.getByRole("button", { name: "More options" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Add location")).toBeVisible();
  await expect(page.getByLabel("Repeat")).toBeVisible();
});

test("hands the draft to a full editor page and back", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/week?date=2026-07-30`);

  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Quarterly review");
  await page.getByRole("button", { name: "More options" }).click();

  // A real page, with the draft in the URL so a reload cannot lose it.
  await expect(page).toHaveURL(/\/event\/new\?/);
  await expect(page).toHaveURL(/title=Quarterly\+review/);
  await expect(page.getByRole("heading", { name: "New event" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toHaveValue("Quarterly review");
  // The full set of fields is here, with no disclosure left.
  await expect(page.getByPlaceholder("Add location")).toBeVisible();
  await expect(page.getByLabel("Repeat")).toBeVisible();
  await expect(page.getByRole("button", { name: "More options" })).toHaveCount(0);

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toHaveValue("Quarterly review");

  const writes: Array<{ title: string }> = [];
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON() as { title: string });
    }
    return route.fallback();
  });
  await page.getByPlaceholder("Add location").fill("Studio B");
  await page.getByRole("button", { name: "Create event" }).click();

  // Saving lands back on the view and date it started from.
  await expect(page).toHaveURL(/\/week\?date=2026-07-30/);
  expect(writes[0]!.title).toBe("Quarterly review");
  await expect(
    page.getByRole("button", { name: /Quarterly review/ }).first(),
  ).toBeVisible();
});

test("leaving the full editor page keeps the calendar where it was", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.locator('[data-day-key="2026-07-15"]').click();
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page).toHaveURL(/\/event\/new\?/);

  await page.getByRole("button", { name: "Back to calendar" }).click();
  await expect(page).toHaveURL(/\/month\?date=2026-07-26/);
});


test("moves the create window by its header, never out of the calendar", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.locator('[data-day-key="2026-07-15"]').click();

  const bubble = page.getByRole("dialog", { name: "Create event" });
  await bubble.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const before = (await bubble.boundingBox())!;
  const header = bubble.locator("[data-drag-handle]");

  // Dragging the header moves the window.
  const grip = (await header.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip.x + grip.width / 2 - 220,
    grip.y + grip.height / 2 - 60,
    { steps: 10 },
  );
  await page.mouse.up();

  const after = (await bubble.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(before.x - 220));
  expect(Math.round(after.y)).toBe(Math.round(before.y - 60));
  // Still the same draft: moving the window is not editing it.
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-07-15",
  );

  // Dragged hard at the calendar's left edge it stops there, whole.
  const area = (await page.getByRole("main").boundingBox())!;
  await page.mouse.move(after.x + 60, after.y + 20);
  await page.mouse.down();
  await page.mouse.move(area.x - 900, after.y + 20, { steps: 10 });
  await page.mouse.up();

  const clamped = (await bubble.boundingBox())!;
  expect(clamped.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(clamped.x + clamped.width).toBeLessThanOrEqual(
    area.x + area.width + 1,
  );
});


test("shows a dragged event where it is going and a ghost where it was", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/week?date=2026-07-06`);

  const block = page.getByRole("button", { name: /Weekly review/ }).first();
  await expect(block).toBeVisible();
  const from = (await block.boundingBox())!;
  const monday = page.locator("[data-time-grid-column]").first();
  const thursday = page.locator("[data-time-grid-column]").nth(3);
  const target = (await thursday.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    from.y + from.height / 2 + 70,
    { steps: 10 },
  );

  // The event is where the pointer is — in another day's column, at the time it
  // would take — and its outline stays behind on the day it came from.
  const preview = page.locator("[data-drag-preview]");
  await expect(preview).toHaveCount(1);
  await expect(thursday.locator("[data-drag-preview]")).toHaveCount(1);
  await expect(preview).toContainText("Weekly review");
  await expect(preview).toContainText("12:00–13:00");
  await expect(monday.locator("[data-ghost]")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  await expect(page.locator("[data-ghost]")).toHaveCount(0);
});

test("shows a dragged chip in the month cell it would land in", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const chip = page.getByRole("button", { name: /Client call/ }).first();
  await expect(chip).toBeVisible();
  const from = (await chip.boundingBox())!;
  const origin = page.locator('[data-day-key="2026-07-08"]');
  const target = page.locator('[data-day-key="2026-07-10"]');
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 10,
  });

  await expect(target.locator("[data-drag-preview]")).toHaveCount(1);
  await expect(target.locator("[data-drag-preview]")).toContainText(
    "Client call",
  );
  await expect(origin.locator("[data-ghost]")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
});

