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
  await page.route("**/api/v1/calendars", (route) =>
    respond(route, calendarResponse),
  );
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
    respond(route, settings),
  );
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

  await page.getByRole("button", { name: "Next month" }).click();
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
  await expect(page.locator("[data-agenda-date]")).toHaveCount(14);
  await expect(page.locator('[data-agenda-date="2026-07-26"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Weekly review/ })).toHaveCount(12);
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
  await expect(page.locator("[data-agenda-date]")).toHaveCount(28);

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
  await page.getByRole("button", { name: "Edit" }).click();
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
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("status")).toContainText("Event deleted.");
  await expect(
    page.getByRole("button", { name: /Release readiness/ }),
  ).toHaveCount(0);
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
