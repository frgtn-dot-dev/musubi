import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

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

async function chooseSelectOption(
  page: Page,
  label: string,
  option: string,
) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

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

/**
 * The calendar filter pills. Visibility lives on the shelf behind Filters — the
 * sidebar no longer carries a second copy of the same choice.
 */
async function openFilterShelf(page: Page) {
  const shelf = page.getByRole("region", { name: "Visible calendars" });
  if (!(await shelf.isVisible())) {
    await page.getByRole("button", { name: "Filters" }).click();
  }
  await expect(shelf).toBeVisible();
  return shelf;
}

async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

// Takes a Page or a whole BrowserContext: the mock is nothing but route handlers
// over one closure of state, so registering it on a context gives every page in it
// the SAME backend — which is what a two-session test needs.
async function mockAuthenticatedReads(
  page: Page | BrowserContext,
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

test("keeps sign in clear and keyboard-usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.route("**/api/auth/get-session", (route) => respond(route, null));

  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  const email = page.getByRole("textbox", { name: "Email" });
  await expect(email).toBeFocused();
  await email.fill("not-an-email");
  await page.getByLabel("Passphrase").fill("long-enough");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a valid email address.");

  const createAccount = page.getByRole("button", { name: "Create one" });
  await createAccount.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Begin simply." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await expectNoAccessibilityViolations(page);
});

test("renders an accessible route state for an unknown page", async ({
  page,
}) => {
  await page.goto("/this-page-does-not-exist");

  await expect(
    page.getByRole("heading", {
      name: "This page is not part of your workspace.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Musubi" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
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

  await (await openFilterShelf(page))
    .getByRole("button", { name: "Studio" })
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

test("keeps a compact Month fixed and folds excess events into More", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 720 });
  const crowdedEvents = Array.from({ length: 5 }, (_, index) =>
    event(
      `crowded-${index}`,
      `Crowded event ${index + 1}`,
      "personal",
      "#b3492f",
      `2026-07-23T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
      `2026-07-23T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
    ),
  );
  await mockAuthenticatedReads(page, {
    ...events,
    events: crowdedEvents,
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const area = page.locator("[data-calendar-area]");
  const month = page.getByRole("grid", { name: "July 2026 calendar" });
  const crowdedDay = page.locator('[data-day-key="2026-07-23"]');
  await expect(month).toHaveAttribute("data-event-capacity", "2");
  await expect(crowdedDay.locator("[data-event-id]")).toHaveCount(1);
  await crowdedDay.getByRole("button", { name: "+4 more" }).click();
  const overflowDialog = page.getByRole("dialog", {
    name: "Thursday, July 23, 2026 events",
  });
  await expect(overflowDialog).toBeVisible();
  await expect(overflowDialog.locator("[data-event-id]")).toHaveCount(5);
  await overflowDialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await expectNoAccessibilityViolations(page);
  await overflowDialog
    .getByRole("button", { name: /Crowded event 1/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Crowded event 1" }),
  ).toBeVisible();
  expect(
    await area.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
});

test("reads, filters and continuously loads the authenticated Agenda", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);

  await page.goto("/app/p/my-calendar/agenda?date=2026-07-26");

  await expect(page.getByRole("heading", { name: "My calendar" })).toBeVisible();
  await expect(page.getByText("From Jul 26, 2026")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Agenda", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  // The DOM stays bounded even though Agenda is one continuous two-year
  // timeline. How many batches fit depends on the viewport, so this asserts
  // the bound rather than one exact batch.
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
  // Scoped to the preview: the agenda row shows the location too.
  const agendaPreview = page.getByRole("dialog", { name: "Design review" });
  await expect(agendaPreview.getByText("Studio B")).toBeVisible();
  await expect(agendaPreview.getByText("16:00 – 17:00")).toBeVisible();
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
  await expect(
    page.getByRole("button", { name: "Previous agenda start" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Next agenda start" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]date=2026-07-26/);

  await (await openFilterShelf(page))
    .getByRole("button", { name: "Family" })
    .click();
  await expect(page.getByRole("button", { name: /Design review/ })).toHaveCount(0);

  await expectNoAccessibilityViolations(page);
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
    page.getByRole("radio", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
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

test("lays overlapping events over each other, not into slivers", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1400 });
  // Two events that overlap, plus one that starts after the first has ended.
  await mockAuthenticatedReads(page, {
    ...events,
    events: [
      event(
        "pp",
        "pp",
        "personal",
        "#b3492f",
        "2026-07-27T12:30:00.000Z",
        "2026-07-27T15:50:00.000Z",
      ),
      event(
        "ppp",
        "ppp",
        "personal",
        "#b3492f",
        "2026-07-27T14:45:00.000Z",
        "2026-07-27T17:05:00.000Z",
      ),
      event(
        "test",
        "TEST",
        "personal",
        "#b3492f",
        "2026-07-27T16:00:00.000Z",
        "2026-07-27T17:35:00.000Z",
      ),
    ],
  });
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-27`);

  const column = page.locator("[data-time-grid-column]").first();
  const columnBox = (await column.boundingBox())!;
  const box = async (id: string) =>
    (await page.locator(`[data-time-event="${id}"]`).boundingBox())!;
  const [pp, ppp, test] = await Promise.all([
    box("pp"),
    box("ppp"),
    box("test"),
  ]);

  // The later event lies over the earlier one from about halfway across the
  // column, so what stays visible of the first is a readable strip and not the
  // hairline a fixed-pixel cascade leaves.
  expect(ppp.x - pp.x).toBeGreaterThan(columnBox.width * 0.4);
  // It reaches the column's edge, bar the inset every block keeps off the grid
  // line (COLUMN_RIGHT_INSET_PX in time-grid-math).
  expect(ppp.x + ppp.width).toBeGreaterThan(
    columnBox.x + columnBox.width - 14,
  );
  // It is also marked as covering, which is what earns it the separating ring:
  // two events from one calendar are the same colour.
  await expect(page.locator('[data-time-event="ppp"]')).toHaveAttribute(
    "data-overlapping",
    "",
  );
  // An event that starts after the first one ends is not in its cluster, so it
  // goes back to the column's left edge.
  expect(Math.abs(test.x - pp.x)).toBeLessThan(2);
});

test("uses the shared time grid as a one-column Day", async ({ page }) => {
  await mockAuthenticatedReads(page);

  await page.goto("/app/p/my-calendar/day?date=2026-07-23");

  await expect(page.getByText("Thursday, July 23, 2026")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Day", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-time-grid-day]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Project check-in/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Partner call/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page).toHaveURL(/[?&]date=2026-07-24/);
  await expect(page.getByText("Friday, July 24, 2026")).toBeVisible();
});

test("creates across chosen calendars, then edits and deletes through confirmed API writes", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Release check");
  await page.getByRole("button", { name: /^Choose calendars/ }).click();
  await expect(
    page.getByRole("checkbox", { name: "Show event in Personal" }),
  ).toBeChecked();
  await page
    .getByRole("radio", { name: "Studio as home calendar" })
    .click();
  await page
    .getByRole("checkbox", { name: "Show event in Family" })
    .check();
  const createRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/events",
  );
  await page.getByRole("button", { name: "Create" }).click();
  const createdEvent = (await createRequest).postDataJSON() as {
    calendars: string[];
    originCalendarID: string;
  };
  expect(createdEvent.originCalendarID).toBe("studio");
  expect(createdEvent.calendars).toEqual(["studio", "family"]);

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

test("chooses an event date from the calendar picker", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const writes: Array<{ start: string }> = [];
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(
        route.request().postDataJSON() as {
          start: string;
        },
      );
    }
    return route.fallback();
  });
  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Planning day");
  await page.getByRole("button", { name: /^Date:/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose date" });
  await expect(picker).toBeVisible();
  await picker.evaluate(async (element) => {
    // Radix mounts the portal before the CSS animation is registered. Wait two
    // frames so Axe measures the settled UI rather than a translucent frame.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await expectNoAccessibilityViolations(page);
  await picker
    .getByRole("gridcell", { name: "Thursday, July 30, 2026" })
    .click();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Event created.");
  expect(writes[0]?.start.startsWith("2026-07-30")).toBe(true);
  await expect(
    page
      .locator('[data-day-key="2026-07-30"]')
      .getByRole("button", { name: /Planning day/ }),
  ).toBeVisible();
});

test("chooses an event time and duration from the time pickers", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  const writes: Array<{ end: string; start: string }> = [];
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(
        route.request().postDataJSON() as {
          end: string;
          start: string;
        },
      );
    }
    return route.fallback();
  });
  await page.goto("/app/p/my-calendar/month?date=2026-07-26");

  await page.getByRole("button", { name: "Event", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Portfolio review");

  const start = page.getByRole("combobox", { name: "Start time" });
  const end = page.getByRole("combobox", { name: "End time" });
  await start.click();
  const startOptions = page.getByRole("listbox", {
    name: "Start time options",
  });
  await expectNoAccessibilityViolations(page);
  await startOptions
    .getByRole("option", { name: "13:15", exact: true })
    .click();
  await expect(start).toHaveValue("13:15");
  await expect(end).toHaveValue("14:15");

  await end.click();
  await page
    .getByRole("listbox", { name: "End time options" })
    .getByRole("option", { name: "13:45, +30m", exact: true })
    .click();
  await expect(end).toHaveValue("13:45");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Event created.");
  expect(new Date(writes[0]!.start).getHours()).toBe(13);
  expect(new Date(writes[0]!.start).getMinutes()).toBe(15);
  expect(
    new Date(writes[0]!.end).getTime() -
      new Date(writes[0]!.start).getTime(),
  ).toBe(30 * 60 * 1_000);
});

test("keeps the all-day toggle in one place when it is flipped", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { exact: true, name: "Event" }).click();

  const toggle = page.locator('[class*="toggleRow"]');
  const label = page.getByText("All day", { exact: true });
  await expect(toggle).toBeVisible();
  // Let the popover finish arriving before measuring where anything sits.
  await page
    .locator('[class*="createPopover"]')
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );

  const timed = (await toggle.boundingBox())!.y;
  await label.click();
  await expect(page.getByRole("button", { name: /^Ends:/ })).toBeVisible();
  // All-day swaps the time range for an end date in the same slot, so the toggle
  // under it does not hop a row.
  expect((await toggle.boundingBox())!.y).toBe(timed);

  await label.click();
  await expect(page.getByRole("combobox", { name: "Start time" })).toBeVisible();
  expect((await toggle.boundingBox())!.y).toBe(timed);
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
  await page.getByRole("button", { name: /^Choose calendars/ }).click();
  await page
    .getByRole("radio", { name: "Studio as home calendar" })
    .click();
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

  await page.getByRole("button", { exact: true, name: "Link" }).click();
  await expect(
    page.getByRole("heading", { name: "Link to a calendar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Link to Personal" }),
  ).toBeFocused();
  await expect(
    page.getByText(
      "It stays one event, so future changes appear in every linked calendar.",
    ),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
  // Escape goes back one decision, not out of the event.
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { exact: true, name: "Link" }),
  ).toBeFocused();
  await page.getByRole("button", { exact: true, name: "Link" }).click();
  await page.getByRole("button", { name: "Link to Personal" }).click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Event linked to calendar.",
  );

  await page.getByRole("button", { name: /Design review/ }).click();
  await page.getByRole("button", { exact: true, name: "Fork" }).click();
  await expect(
    page.getByRole("heading", { name: "Make an independent copy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Make copy in Studio" }).click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Independent event copy created.",
  );
  await expect(
    page.getByRole("button", { name: /Design review/ }),
  ).toHaveCount(2);

  await page.goto("/app/p/my-calendar/week?date=2026-07-26");
  const recurringEvent = page
    .getByRole("button", { name: /Weekly review/ })
    .first();
  await recurringEvent.click();
  const deleteButton = page.getByRole("button", { name: "Delete" });
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", {
    name: "Delete recurring event",
  });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  await expect(
    deleteDialog.getByRole("button", { name: "This event", exact: true }),
  ).toBeVisible();
  await expect(
    deleteDialog.getByRole("button", {
      name: "This and following events",
    }),
  ).toBeVisible();
  await expect(
    deleteDialog.getByRole("button", { name: "Entire series" }),
  ).toBeVisible();
  const deleteAccessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(deleteAccessibility.violations).toEqual([]);

  // Opening the modal dismisses the preview. Escape returns to the event that
  // launched that preview, so the keyboard path has a stable place to resume.
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toHaveCount(0);
  await expect(recurringEvent).toBeFocused();
  await recurringEvent.click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: "Delete recurring event" })
    .getByRole("button", { name: "This event", exact: true })
    .click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
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

  await chooseSelectOption(page, "Calendar to export", "Studio");
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

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Imported 1 event into Roadmap.",
  );
  const importedCalendar = (await openFilterShelf(page)).getByRole("button", {
    name: "Roadmap",
  });
  await expect(importedCalendar).toHaveAttribute("aria-pressed", "true");
  await expect(importedCalendar).toContainText("Roadmap");
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

  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  const sectionHeadings = [
    "Appearance",
    "Notifications",
    "Help & About",
    "Account",
  ];
  const sectionTops = await Promise.all(
    sectionHeadings.map(async (name) =>
      (
        await settingsDialog
          .getByRole("heading", { name })
          .boundingBox()
      )!.y,
    ),
  );
  expect(sectionTops).toEqual([...sectionTops].sort((a, b) => a - b));

  await expect(
    settingsDialog.getByRole("radiogroup", { name: "Theme" }),
  ).toBeVisible();
  const currentTimeFormat = settingsDialog.getByRole("radio", {
    name: "24 hour",
  });
  await currentTimeFormat.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    settingsDialog.getByRole("radio", { name: "12 hour" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("status").filter({ hasText: "Settings saved." }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
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
    page.getByRole("radiogroup", { name: "Theme" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("keeps settings usable as a mobile sheet", async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const sheet = page.getByRole("dialog", { name: "Settings" });
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );

  const box = (await sheet.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(box.height).toBeLessThanOrEqual(700 + 1);
  await expect(
    sheet.getByRole("heading", { name: "Appearance" }),
  ).toBeVisible();
  await sheet.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("status").filter({ hasText: "Settings saved." }),
  ).toBeVisible();

  const manageAccount = sheet.getByRole("button", {
    name: /Manage account/,
  });
  await manageAccount.scrollIntoViewIfNeeded();
  await expect(manageAccount).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await manageAccount.click();
  await expect(
    page.getByRole("dialog", { name: "Account" }),
  ).toBeVisible();
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
    page.getByRole("button", { exact: true, name: "My calendar" }),
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Work" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/p/${workPageId}/month`));
  await expect(page).toHaveURL(/[?&]date=2026-07-26/);
});

test("creates a page from the sidebar and deletes it again", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  const workPageId = "22222222-2222-4222-8222-222222222222";
  const writes: Array<{ body?: unknown; method: string }> = [];
  let pageState: unknown[] = [defaultPage];

  await page.route("**/api/v1/pages", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        config: unknown;
        name: string;
      };
      writes.push({ body, method: "POST" });
      const created = {
        ...defaultPage,
        config: body.config,
        id: workPageId,
        isDefault: false,
        name: body.name,
        position: 1,
      };
      pageState = [defaultPage, created];
      return respond(route, created, 201);
    }
    return respond(route, pageState);
  });
  await page.route(`**/api/v1/pages/${workPageId}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    writes.push({ method: "DELETE" });
    pageState = [defaultPage];
    return respond(route, { id: workPageId });
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "New page" }).click();
  const newPage = page.getByRole("dialog");
  await newPage.getByLabel("Page name").fill("Work");
  await newPage.getByRole("radio", { name: "Briefcase" }).click();
  await newPage.getByRole("button", { name: "Create page" }).click();

  // The new page opens straight away, keeping the date.
  await expect(page).toHaveURL(new RegExp(`/app/p/${workPageId}/month`));
  await expect(page).toHaveURL(/[?&]date=2026-07-26/);
  await expect(
    page.getByRole("button", { exact: true, name: "Work" }),
  ).toBeVisible();

  // Deleting the open page falls back to the default page.
  await page
    .getByRole("button", { name: "Edit Work" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete page" })
    .click();
  // Soft-deleted with no restore endpoint, so this one asks before it goes.
  await page
    .getByRole("dialog", { name: "Delete “Work”?" })
    .getByRole("button", { name: "Delete page" })
    // The confirmation renders inside the settings dialog it guards, so the
    // trigger is in scope too; the confirm's own action is the later one.
    .last()
    .click();

  await expect(page).toHaveURL(new RegExp(`/app/p/${DEFAULT_PAGE_ID}/month`));
  await expect(
    page.getByRole("button", { exact: true, name: "Work" }),
  ).toBeHidden();
  expect(writes.map((write) => write.method)).toEqual(["POST", "DELETE"]);
  // Started from what was on screen, as an explicit include list.
  expect(writes[0]!.body).toMatchObject({
    config: {
      calendarVisibility: {
        calendarIds: ["personal", "studio", "family"],
        mode: "include",
      },
      icon: "briefcase",
      view: { configVersion: 1, id: "month", showAdjacentDays: true },
    },
    name: "Work",
  });
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

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
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

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
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

test("a second month drag replaces the first draft, not both", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  // One draft from a plain click.
  const firstCell = page.locator('[data-day-key="2026-07-07"]');
  const firstBox = (await firstCell.boundingBox())!;
  await page.mouse.click(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height - 6,
  );
  await expect(page.getByRole("dialog", { name: "Create event" })).toBeVisible();
  await expect(page.locator("[data-draft]")).toHaveCount(1);

  // Dragging out another one drops the first from the first press.
  const from = page.locator('[data-day-key="2026-07-28"]');
  const to = page.locator('[data-day-key="2026-07-30"]');
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
  await expect(page.locator("[data-live]")).toHaveCount(3);
  await expect(page.locator("[data-draft]")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Create event" }),
  ).toHaveCount(0);

  // Releasing keeps the new one. The replaced popover restores focus to its own
  // origin cell as it goes, which must not read as a dismissal of the new one.
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Create event" })).toBeVisible();
  await expect(page.locator("[data-draft]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^Date:/ })).toContainText(
    "Tuesday, July 28, 2026",
  );
});

test("keeps the event preview open while its text is being selected", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: /Design review/ }).first().click();
  const preview = page.locator('[class*="detailPopover"]');
  await expect(preview).toBeVisible();
  await preview.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );

  // Dragging across the title is how you copy it. Focus leaves the text as the
  // drag starts, which Radix reports as an interaction outside the layer — the
  // preview used to close on the way.
  const title = preview.getByRole("heading", { name: "Design review" });
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(
    "Design review",
  );
  // The grid behind it stays unselectable, so a drag there is always a gesture
  // and never a stray selection — which Chromium would cancel the drag for.
  expect(
    await page
      .locator("[data-calendar-area]")
      .evaluate((el) => getComputedStyle(el).userSelect),
  ).toBe("none");
});

test("flicks sideways to change period, but a held drag still creates", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.locator("[data-calendar-area]")).toBeVisible();

  // Playwright's touchscreen only taps, so the gesture is dispatched directly.
  // pointerType is what separates a finger from the mouse here.
  const touchDrag = (dx: number, dy = 0, holdMs = 0) =>
    page.evaluate(
      async ([shiftX, shiftY, hold]) => {
        const area = document.querySelector("[data-calendar-area]")!;
        const box = area.getBoundingClientRect();
        const from = {
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        };
        const common = {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: "touch",
        };
        const target = document.elementFromPoint(from.x, from.y) ?? area;
        target.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...common,
            clientX: from.x,
            clientY: from.y,
          }),
        );
        if (hold) await new Promise((done) => setTimeout(done, hold as number));
        for (const step of [0.5, 1]) {
          window.dispatchEvent(
            new PointerEvent("pointermove", {
              ...common,
              clientX: from.x + (shiftX as number) * step,
              clientY: from.y + (shiftY as number) * step,
            }),
          );
        }
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            ...common,
            clientX: from.x + (shiftX as number),
            clientY: from.y + (shiftY as number),
          }),
        );
      },
      [dx, dy, holdMs] as const,
    );

  // Flick left for the next period, right for the previous one.
  await touchDrag(-120);
  await expect(page).toHaveURL(/date=2026-08-01/);
  await expect(page.locator("[data-live], [data-draft]")).toHaveCount(0);
  await touchDrag(120);
  await expect(page).toHaveURL(/date=2026-07-01/);

  // Scrolling must win when the gesture is mostly vertical.
  await touchDrag(20, 140);
  await expect(page).toHaveURL(/date=2026-07-01/);

  // Past the hold the same finger is dragging out a range, so it creates instead
  // of paging — one shared constant decides which, so neither can double-fire.
  await touchDrag(-120, 0, 350);
  await expect(page.locator("[data-draft]")).toHaveCount(3);
  await expect(page).toHaveURL(/date=2026-07-01/);
});

test("reorders pages by dragging a row, and by keyboard", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const workPageId = "22222222-2222-4222-8222-222222222222";
  const writes: string[][] = [];
  let pageState = [
    defaultPage,
    {
      ...defaultPage,
      id: workPageId,
      isDefault: false,
      name: "Work",
      position: 1,
    },
  ];
  await page.route("**/api/v1/pages", (route) => respond(route, pageState));
  await page.route("**/api/v1/pages/reorder", async (route) => {
    const body = route.request().postDataJSON() as { pageIds: string[] };
    writes.push(body.pageIds);
    pageState = body.pageIds.map((id, position) => ({
      ...pageState.find((page) => page.id === id)!,
      position,
    }));
    return respond(route, pageState);
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  const rows = page.locator('[class*="pageRow_"]');
  // Retrying assertion: the order is painted optimistically and then replaced by
  // the response, so a one-shot read can land between the two.
  const order = page.locator('[class*="pageRowMain"]');
  await expect(rows).toHaveCount(2);
  await expect(order).toHaveText(["My calendar", "Work"]);

  // Drag the second row above the first.
  const first = (await rows.nth(0).boundingBox())!;
  const second = (await rows.nth(1).boundingBox())!;
  await page.mouse.move(
    second.x + second.width / 2,
    second.y + second.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, first.y + 4, { steps: 6 });
  await page.mouse.up();

  // The write leaves on release; poll rather than reading the array straight away.
  await expect.poll(() => writes).toEqual([[workPageId, DEFAULT_PAGE_ID]]);
  await expect(order).toHaveText(["Work", "My calendar"]);
  // The release ended a drag, so it must not also have opened that page.
  await expect(page).toHaveURL(new RegExp(`/app/p/${DEFAULT_PAGE_ID}/month`));

  // Alt+arrows are the keyboard path to the same move (R10).
  await rows.nth(1).getByRole("button", { exact: true, name: "My calendar" }).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(() => writes[1])
    .toEqual([DEFAULT_PAGE_ID, workPageId]);
  await expect(order).toHaveText(["My calendar", "Work"]);
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

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
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
  await expect(page.locator('[class*="toastRegion"]')).toContainText("now ");
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

  await page
    .getByRole("button", { name: "Edit My calendar" })
    .click();
  await chooseSelectOption(page, "Row height", "Compact");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Page saved.",
  );
  expect(savedDensity).toBe("compact");
  // Saved, so the grid geometry follows — the dialog previews nothing live.
  await expect(async () => {
    expect(await canvasHeight()).toBeLessThan(comfortable);
  }).toPass();
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
    (await openFilterShelf(page)).getByRole("button", { name: "Studio" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page
    .getByRole("button", { name: "Edit My calendar" })
    .click();
  const settings = page.getByRole("dialog");
  // A brand-new surface with a custom icon radiogroup — check it before saving.
  await expectNoAccessibilityViolations(page);
  await settings.getByRole("button", { name: "Studio" }).click();
  await settings.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Page saved.",
  );
  expect(saved?.config?.calendarVisibility).toEqual({
    hiddenCalendarIds: ["studio"],
    mode: "all",
  });
  // Read mode now reflects the saved visibility.
  // Saved visibility shows on the shelf: the pill is off without the page having
  // to be reopened.
  await expect(
    (await openFilterShelf(page)).getByRole("button", { name: "Studio" }),
  ).toHaveAttribute("aria-pressed", "false");
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
  await page
    .getByRole("button", { name: "Edit My calendar" })
    .click();
  const conflicted = page.getByRole("dialog");
  await conflicted.getByRole("button", { name: "Studio" }).click();
  await conflicted.getByRole("button", { name: "Save", exact: true }).click();

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
    page.getByRole("button", { exact: true, name: "My calendar" }),
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
    page.getByRole("button", { exact: true, name: "Shared plan" }),
  ).toBeVisible();
});

test("creates, renames and deletes a calendar", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "Calendars" }).click();
  await expect(
    page.getByRole("heading", { name: "Your calendars" }),
  ).toBeVisible();
  const calendarDialog = page.getByRole("dialog", { name: "Calendars" });
  const newName = calendarDialog.getByPlaceholder("New calendar");
  const newColor = calendarDialog.getByRole("button", {
    name: /New calendar color:/,
  });
  const add = calendarDialog.getByRole("button", { name: "Add" });
  const [nameBox, colorBox, addBox] = await Promise.all([
    newName.boundingBox(),
    newColor.boundingBox(),
    add.boundingBox(),
  ]);
  expect(nameBox).not.toBeNull();
  expect(colorBox).not.toBeNull();
  expect(addBox).not.toBeNull();
  expect(Math.abs(nameBox!.y - colorBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(colorBox!.y - addBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(nameBox!.height - colorBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(colorBox!.height - addBox!.height)).toBeLessThanOrEqual(1);

  const sourceIcon = calendarDialog.locator('[data-provider="musubi"]').first();
  const calendarSwatch = calendarDialog.locator("[data-calendar-swatch]").first();
  const [sourceBox, swatchBox] = await Promise.all([
    sourceIcon.boundingBox(),
    calendarSwatch.boundingBox(),
  ]);
  expect(sourceBox).not.toBeNull();
  expect(swatchBox).not.toBeNull();
  expect(
    Math.abs(
      sourceBox!.x +
        sourceBox!.width / 2 -
        (swatchBox!.x + swatchBox!.width / 2),
    ),
  ).toBeLessThanOrEqual(1);

  const exportSelect = calendarDialog.getByRole("combobox", {
    name: "Calendar to export",
  });
  const fileControl = calendarDialog.locator("[data-calendar-file-control]");
  const exportButton = calendarDialog.getByRole("button", {
    name: "Export .ics",
  });
  const importButton = calendarDialog.getByRole("button", {
    name: "Import",
    exact: true,
  });
  const [exportSelectBox, fileControlBox, exportButtonBox, importButtonBox] =
    await Promise.all([
      exportSelect.boundingBox(),
      fileControl.boundingBox(),
      exportButton.boundingBox(),
      importButton.boundingBox(),
    ]);
  expect(exportSelectBox).not.toBeNull();
  expect(fileControlBox).not.toBeNull();
  expect(exportButtonBox).not.toBeNull();
  expect(importButtonBox).not.toBeNull();
  expect(
    Math.abs(exportSelectBox!.y - fileControlBox!.y),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(exportButtonBox!.y - importButtonBox!.y),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(exportButtonBox!.height - importButtonBox!.height),
  ).toBeLessThanOrEqual(1);

  // Create
  await page.getByPlaceholder("New calendar").fill("Travel");
  await page
    .getByRole("button", { name: "New calendar color: #B3A48A" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Choose color" }),
  ).toBeVisible();
  const colorPickerAccessibility = await new AxeBuilder({ page })
    .include('[data-ui="color-picker-popover"]')
    .analyze();
  expect(colorPickerAccessibility.violations).toEqual([]);
  await page.getByRole("option", { name: "Moss, #A8B5A0" }).click();
  await expect(
    page.getByRole("button", {
      name: "New calendar color: #A8B5A0",
    }),
  ).toBeVisible();
  const createRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/calendars",
  );
  await page.getByRole("button", { name: "Add" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    color: "#A8B5A0",
    name: "Travel",
  });
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Travel created.",
  );
  const travelRow = page
    .getByRole("listitem")
    .filter({ hasText: "Travel" });
  await expect(travelRow).toBeVisible();
  await expect(travelRow.locator("[data-calendar-swatch]")).toHaveCSS(
    "background-color",
    "rgb(168, 181, 160)",
  );

  // Rename
  await page.getByRole("button", { name: "Rename Travel" }).click();
  await page
    .getByRole("textbox", { name: "Rename Travel" })
    .fill("Trips");
  await page
    .getByRole("dialog", { name: "Edit calendar" })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Calendar updated.",
  );
  await expect(
    page.getByRole("listitem").filter({ hasText: "Trips" }),
  ).toBeVisible();

  // Delete uses the same accessible dialog and focus policy as the rest of UI.
  const deleteButton = page.getByRole("button", { name: "Delete Trips" });
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", {
    name: "Delete “Trips”?",
  });
  await expect(deleteDialog).toBeVisible();
  await expect(
    deleteDialog.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await deleteDialog
    .getByRole("button", { name: "Delete calendar" })
    .click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Trips deleted.",
  );
  await expect(
    page.getByRole("listitem").filter({ hasText: "Trips" }),
  ).toHaveCount(0);
});

test("groups calendars by server and connected account", async ({ page }) => {
  const groupedCalendars = [
    calendars[0]!,
    {
      ...calendars[1]!,
      accountId: "google-work",
      accountLabel: "work@example.com",
      provider: "google",
    },
    {
      ...calendars[2]!,
      accountId: "google-work",
      accountLabel: "work@example.com",
      provider: "google",
    },
  ];
  await mockAuthenticatedReads(page, events, groupedCalendars);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "Calendars" }).click();
  const dialog = page.getByRole("dialog", { name: "Calendars" });
  const musubiGroup = dialog.getByRole("region", { name: "Musubi" });
  const googleGroup = dialog.getByRole("region", {
    name: "work@example.com",
  });

  await expect(
    musubiGroup.getByRole("listitem").filter({ hasText: "Personal" }),
  ).toBeVisible();
  await expect(
    googleGroup.getByRole("listitem").filter({ hasText: "Studio" }),
  ).toBeVisible();
  await expect(
    googleGroup.getByRole("listitem").filter({ hasText: "Family" }),
  ).toBeVisible();
  await expect(
    googleGroup.getByText("Google Calendar", { exact: true }),
  ).toBeVisible();
  await expect(
    googleGroup.getByText("Managed in Google Calendar", {
      exact: true,
    }),
  ).toHaveCount(2);
  await expect(
    googleGroup.getByRole("button", { name: "Rename Studio" }),
  ).toHaveCount(0);
  await expect(
    googleGroup.getByRole("button", { name: "Share Studio" }),
  ).toHaveCount(0);

  const [musubiBox, googleBox] = await Promise.all([
    musubiGroup.boundingBox(),
    googleGroup.boundingBox(),
  ]);
  expect(musubiBox?.y).toBeLessThan(googleBox?.y ?? 0);
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
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
  const sharingDialog = page.getByRole("dialog", { name: "Share Studio" });
  await sharingDialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  // Promote Sam to editor through the visible, keyboard-friendly role group.
  const roleGroup = page.getByRole("radiogroup", {
    name: "Sam Rivers role",
  });
  await roleGroup.getByRole("radio", { name: "Editor" }).click();
  await expect(
    roleGroup.getByRole("radio", { name: "Editor" }),
  ).toHaveAttribute("aria-checked", "true");

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

test("keeps calendar sharing usable as a mobile sheet", async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.route("**/api/v1/calendars/*/members", (route) =>
    respond(route, [
      { id: "user-web-qa", image: null, name: "Web QA", role: "owner" },
      { id: "member-2", image: null, name: "Sam Rivers", role: "viewer" },
    ]),
  );
  await page.route("**/api/v1/calendars/*/invites", (route) =>
    respond(route, []),
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Calendars" }).click();
  await page.getByRole("button", { name: "Share Studio" }).click();

  const sheet = page.getByRole("dialog", { name: "Share Studio" });
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(721);
  await expect(
    sheet.getByRole("radiogroup", { name: "Sam Rivers role" }),
  ).toBeVisible();

  const transfer = sheet.getByRole("button", { name: "Make owner" });
  await transfer.click();
  const confirmation = page.getByRole("dialog", {
    name: "Make Sam Rivers the owner?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(transfer).toBeFocused();

  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
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
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Calendars" }).click();
  await page.getByRole("button", { name: "Share Studio" }).click();
  await expect(page.getByText("Sam Rivers", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Make owner" }).click();
  const transferDialog = page.getByRole("dialog", {
    name: "Make Sam Rivers the owner?",
  });
  await expect(transferDialog).toBeVisible();
  await expect(
    transferDialog.getByText(
      "You will become an editor and lose access to sharing controls for Studio.",
    ),
  ).toBeVisible();
  await transferDialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await transferDialog
    .getByRole("button", { name: "Transfer ownership" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Sam Rivers is now the owner of Studio.",
  );
  await expect(
    page.getByRole("dialog", { name: "Share Studio" }),
  ).toHaveCount(0);
  expect(transferredRole).toBe("owner");
});

test("connects and disconnects calendar providers", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

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
  const connectionsDialog = page.getByRole("dialog", {
    name: "Connections",
  });
  await connectionsDialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);

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
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "work@gmail.com disconnected.",
  );
  expect(disconnectBody).toEqual({ accountId: "acc-1", provider: "google" });

  // CalDAV/Apple connect form.
  await page.getByRole("button", { name: "Connect Apple / iCloud" }).click();
  await page
    .getByRole("textbox", { name: "Apple ID email" })
    .fill("me@icloud.com");
  await page.getByPlaceholder("Password").fill("app-specific-pw");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Calendar connected.",
  );
  expect(caldavBody).toEqual({
    password: "app-specific-pw",
    serverUrl: "https://caldav.icloud.com",
    username: "me@icloud.com",
  });
  expect(runtimeErrors).toEqual([]);
});

test("keeps connections usable as a mobile sheet", async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page, events, [
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
      syncStatus: "reconnect_required",
    },
  ]);
  await page.route("**/api/v1/server", (route) =>
    respond(route, {
      email: true,
      minClientVersion: "0.1.2",
      socials: ["google"],
      syncProviders: ["google", "microsoft", "caldav"],
    }),
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Connections" }).click();

  const sheet = page.getByRole("dialog", { name: "Connections" });
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(721);

  const account = sheet
    .getByRole("listitem")
    .filter({ hasText: "work@gmail.com" });
  await expect(account).toContainText("Needs attention");
  await expect(
    account.getByRole("button", { name: "Reconnect" }),
  ).toBeVisible();

  const apple = sheet.getByRole("button", {
    name: "Connect Apple / iCloud",
  });
  await apple.click();
  const email = sheet.getByRole("textbox", { name: "Apple ID email" });
  await expect(email).toBeFocused();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(apple).toBeFocused();

  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
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
    (await openFilterShelf(page)).getByRole("button", { name: "Book club" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .locator('[data-day-key="2026-07-23"]')
    .getByRole("button", { name: /\+\d+ more/ })
    .click();
  const dayEvents = page.getByRole("dialog", {
    name: "Thursday, July 23, 2026 events",
  });
  await expect(
    dayEvents.getByRole("button", { name: /Book club meetup/ }),
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
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
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
  await page
    .locator('[data-day-key="2026-07-23"]')
    .getByRole("button", { name: /\+\d+ more/ })
    .click();
  await page
    .getByRole("dialog", {
      name: "Thursday, July 23, 2026 events",
    })
    .getByRole("button", { name: /Book club meetup/ })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Book club — new venue");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
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
    (await openFilterShelf(page)).getByRole("button", { name: "Book club" }),
  ).toHaveAttribute("aria-pressed", "true");

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
    (await openFilterShelf(page)).getByRole("button", {
      name: "Book club (Thursdays)",
    }),
  ).toHaveAttribute("aria-pressed", "true");
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
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
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
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Joined Shared plans.",
  );
  expect(joinedCalendarId).toBe("shared-cal");
});

test("manages account identity and gates account deletion", async ({
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
  const accountDialog = page.getByRole("dialog", { name: "Account" });
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog).toContainText("web-qa@example.invalid");
  await accountDialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );

  const sectionHeadings = ["Profile", "Security", "Danger zone"];
  const sectionTops = await Promise.all(
    sectionHeadings.map(async (name) =>
      (
        await accountDialog
          .getByRole("heading", { name })
          .boundingBox()
      )!.y,
    ),
  );
  expect(sectionTops).toEqual([...sectionTops].sort((a, b) => a - b));

  await accountDialog
    .getByLabel("Change profile photo")
    .setInputFiles({
      buffer: Buffer.from("not-an-image"),
      mimeType: "text/plain",
      name: "notes.txt",
    });
  await expect(accountDialog.getByRole("alert")).toContainText(
    "Choose a PNG, JPEG, or WebP image.",
  );
  await expectNoAccessibilityViolations(page);

  const displayNameAction = accountDialog.getByRole("button", {
    name: /Display name/,
  });
  await displayNameAction.focus();
  await page.keyboard.press("Enter");
  const nameDialog = page.getByRole("dialog", { name: "Display name" });
  await expect(nameDialog).toBeVisible();
  await expect(nameDialog.getByRole("textbox")).toBeFocused();

  await nameDialog
    .getByRole("textbox", { name: "Display name" })
    .fill("Web QA Updated");
  await nameDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Name updated.",
  );
  await expect(nameDialog).toBeHidden();

  await accountDialog
    .getByRole("button", { name: /Reset password/ })
    .click();
  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Check your email for a link to reset your password.",
  );

  await accountDialog
    .getByRole("button", { name: /Delete account/ })
    .click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete account?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  await expectNoAccessibilityViolations(page);

  // Deletion needs the exact display name typed to confirm, including spacing.
  const deleteButton = deleteDialog.getByRole("button", {
    name: "Delete account",
  });
  const confirmation = deleteDialog.getByRole("textbox", {
    name: "Type Web QA to confirm",
  });
  await expect(deleteButton).toBeDisabled();
  await confirmation.fill("wrong");
  await expect(deleteButton).toBeDisabled();
  await confirmation.fill(" Web QA ");
  await expect(deleteButton).toBeDisabled();
  await confirmation.fill("Web QA");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(page.locator('[class*="toastRegion"]')).toContainText(
    "Check your email",
  );
  expect(deleteRequested).toBe(true);
});

test("keeps account management usable as nested mobile sheets", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Manage account" }).click();
  const accountSheet = page.getByRole("dialog", { name: "Account" });
  await accountSheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );

  const accountBox = (await accountSheet.boundingBox())!;
  expect(accountBox.x).toBe(0);
  expect(Math.round(accountBox.width)).toBe(390);
  expect(accountBox.height).toBeLessThanOrEqual(700 + 1);

  const deleteAction = accountSheet.getByRole("button", {
    name: /Delete account/,
  });
  await deleteAction.scrollIntoViewIfNeeded();
  await deleteAction.click();

  const deleteSheet = page.getByRole("dialog", { name: "Delete account?" });
  await deleteSheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const deleteBox = (await deleteSheet.boundingBox())!;
  expect(deleteBox.x).toBe(0);
  expect(Math.round(deleteBox.width)).toBe(390);
  await expect(deleteSheet.getByRole("textbox")).toBeFocused();
  await expectNoAccessibilityViolations(page);

  await page.keyboard.press("Escape");
  await expect(deleteSheet).toBeHidden();
  await expect(accountSheet).toBeVisible();
  await expect(deleteAction).toBeFocused();
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
  // The pill being created is drawn across the range while dragging, the same
  // way the time grid paints the block it is about to make.
  await expect(page.locator("[data-live]")).toHaveCount(3);
  await page.mouse.up();

  // Quick create opens pre-filled as an all-day event spanning the range.
  await expect(page.getByRole("button", { name: /^Date:/ })).toContainText(
    "Tuesday, July 28, 2026",
  );
  await expect(page.getByRole("button", { name: /^Ends:/ })).toContainText(
    "Thursday, July 30, 2026",
  );
  // The same pill stays put, now grabbable and owned by the open draft.
  await expect(page.locator("[data-live]")).toHaveCount(0);
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

  await expect(page.getByRole("button", { name: /^Date:/ })).toContainText(
    "Tuesday, July 28, 2026",
  );
  await expect(page.getByRole("button", { name: /^Ends:/ })).toContainText(
    "Thursday, July 30, 2026",
  );
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
  await expectNoAccessibilityViolations(page);

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
  expect(
    await sheet.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBe(0);

  // It is still the same layer: Escape dismisses it and focus is handled.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expectNoAccessibilityViolations(page);
});

test("keeps desktop event details full-sized beside their trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const leftTrigger = page
    .getByRole("button", { name: /Studio retreat/ })
    .first();
  const leftTriggerBox = (await leftTrigger.boundingBox())!;
  await leftTrigger.click();
  const leftDetails = page.getByRole("dialog", { name: "Studio retreat" });
  await leftDetails.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    ),
  );
  const leftDetailsBox = (await leftDetails.boundingBox())!;
  expect(leftDetailsBox.x).toBeGreaterThanOrEqual(
    leftTriggerBox.x + leftTriggerBox.width + 7,
  );
  expect(
    await leftDetails.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight,
    })),
  ).toEqual({ horizontal: 0, vertical: 0 });
  await page.keyboard.press("Escape");

  const rightTrigger = page.getByRole("button", {
    name: /Theatre night/,
  });
  const rightTriggerBox = (await rightTrigger.boundingBox())!;
  await rightTrigger.click();
  const rightDetails = page.getByRole("dialog", { name: "Theatre night" });
  await rightDetails.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    ),
  );
  const rightDetailsBox = (await rightDetails.boundingBox())!;
  expect(rightDetailsBox.x + rightDetailsBox.width).toBeLessThanOrEqual(
    rightTriggerBox.x - 7,
  );
  expect(
    await rightDetails.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBe(0);
});

test("chooses event calendars from an accessible mobile list", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "Event", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Create event" });
  const trigger = editor.getByRole("button", {
    name: /^Choose calendars/,
  });
  await trigger.click();

  const selection = editor.locator('[data-ui="calendar-placement"]');
  await expect(selection).toBeVisible();
  await expect(
    selection.getByRole("checkbox", { name: "Show event in Personal" }),
  ).toBeChecked();
  await selection
    .getByRole("radio", { name: "Studio as home calendar" })
    .click();
  await expect(
    selection.getByRole("checkbox", { name: "Show event in Studio" }),
  ).toBeChecked();

  const accessibility = await new AxeBuilder({ page })
    .include('[data-ui="calendar-placement"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await trigger.click();
  await expect(selection).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(trigger).toHaveAccessibleName(
    /Studio is home\. Event appears in 1 calendar/,
  );
});

test("opens the calendar color picker as the top mobile sheet", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Calendars" }).click();
  const trigger = page.getByRole("button", {
    name: "New calendar color: #B3A48A",
  });
  await trigger.click();

  const sheet = page.getByRole("dialog", { name: "Choose color" });
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(721);

  const accessibility = await new AxeBuilder({ page })
    .include('[data-ui="color-picker-popover"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("option", { name: "Custom color" }).click();
  await expect(
    page.getByRole("textbox", { name: "Hex color" }),
  ).toBeFocused();
  const expandedBox = (await sheet.boundingBox())!;
  expect(Math.round(expandedBox.y + expandedBox.height)).toBeLessThanOrEqual(
    721,
  );
  const customAccessibility = await new AxeBuilder({ page })
    .include('[data-ui="color-picker-popover"]')
    .analyze();
  expect(customAccessibility.violations).toEqual([]);

  // Escape dismisses only the top layer and restores the initiating control.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Calendars" }),
  ).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("opens an event's details as a sheet on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  // A phone folds a busy day into "+2 more", so the event under test has to be
  // one the compact grid still shows. Same calendar and length as before.
  const eventButton = page
    .getByRole("button", { name: /Client presentation/ })
    .first();
  await eventButton.click();
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
    page.getByRole("heading", { name: "Client presentation" }),
  ).toBeVisible();
  await expect(sheet.getByText("1 hr", { exact: true })).toBeVisible();
  await expect(
    sheet.getByRole("list", { name: "Calendars" }).getByText("Studio"),
  ).toBeVisible();

  const titleBox = (await sheet
    .getByRole("heading", { name: "Client presentation" })
    .boundingBox())!;
  const dateBox = (await sheet.getByText("Date", { exact: true }).boundingBox())!;
  const timeBox = (await sheet.getByText("Time", { exact: true }).boundingBox())!;
  const calendarBox = (await sheet
    .getByRole("list", { name: "Calendars" })
    .boundingBox())!;
  expect([titleBox.y, dateBox.y, timeBox.y, calendarBox.y]).toEqual(
    [titleBox.y, dateBox.y, timeBox.y, calendarBox.y].sort((a, b) => a - b),
  );

  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { exact: true, name: "Link" }).click();
  await expect(
    page.getByRole("button", { name: "Link to Personal" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { exact: true, name: "Link" }),
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(eventButton).toBeFocused();
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
    page.getByRole("button", { exact: true, name: "My calendar" }),
  ).toBeVisible();

  // Renaming lives in the page's own settings dialog, never in the chrome.
  await expect(page.getByLabel("Page name")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit My calendar" })
    .click();
  await expect(page.getByLabel("Page name")).toHaveValue("My calendar");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Page name")).toHaveCount(0);
});

test("keeps calendar chrome consistent and keyboard operable", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  const navigation = page.getByRole("complementary", {
    name: "Workspace navigation",
  });
  const filters = page.getByRole("button", { name: "Filters" });
  await filters.click();

  // Visibility lives on the shelf only: the sidebar used to carry a second copy
  // of the same switches, which was a column of chrome for a filter.
  const shelf = page.getByRole("region", { name: "Visible calendars" });
  await expect(shelf).toBeVisible();
  await expect(navigation.getByRole("switch")).toHaveCount(0);

  const shelfStudio = shelf.getByRole("button", { name: "Studio" });
  await expect(shelfStudio).toHaveAttribute("aria-pressed", "true");
  await shelfStudio.click();
  await expect(shelfStudio).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /Studio retreat/ })).toHaveCount(
    0,
  );

  const month = page.getByRole("radio", { name: "Month" });
  await month.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(
    `/app/p/${DEFAULT_PAGE_ID}/agenda?date=2026-07-26`,
  );
  await expect(
    page.getByRole("radio", { name: "Agenda" }),
  ).toHaveAttribute("aria-checked", "true");
  await expectNoAccessibilityViolations(page);
  expect(runtimeErrors).toEqual([]);
});

test("moves focus through the mobile navigation drawer", async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const main = page.locator("main#main-content");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();

  const navigation = page.getByRole("complementary", {
    name: "Workspace navigation",
  });
  const close = navigation.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeFocused();
  await expect(main).toHaveAttribute("inert", "");
  await navigation.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  // Touch targets in the drawer: the page rows are what it carries now that the
  // calendar switches moved to the filter shelf.
  const pageRow = navigation.getByRole("button", {
    exact: true,
    name: "My calendar",
  });
  expect((await pageRow.boundingBox())!.height).toBeGreaterThanOrEqual(38);
  await expectNoAccessibilityViolations(page);

  // Medium keeps the overlay drawer; 1024 is the first permanent-sidebar
  // width. CSS owns that boundary and JS reads its flag, so the two cannot
  // silently drift apart.
  await page.setViewportSize({ height: 720, width: 800 });
  await expect(main).toHaveAttribute("inert", "");
  await page.setViewportSize({ height: 720, width: 1024 });
  await expect(main).not.toHaveAttribute("inert", "");
  await page.setViewportSize({ height: 720, width: 800 });
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(main).not.toHaveAttribute("inert", "");
  await expect(trigger).toBeFocused();
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
  await expect(page.getByRole("button", { name: /^Date:/ })).toContainText(
    "Tuesday, July 28, 2026",
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

  await expect(page.getByRole("button", { name: /^Date:/ })).toContainText(
    "Wednesday, July 29, 2026",
  );
  await expect(page.getByRole("button", { name: /^Ends:/ })).toContainText(
    "Friday, July 31, 2026",
  );
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
  await expect(page.getByRole("button", { name: /^Date:/ })).toBeVisible();
  await expect(page.getByLabel("Start time")).toBeVisible();
  await expect(
    bubble.getByRole("button", { name: /^Choose calendars/ }),
  ).toBeVisible();
  await bubble.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  expect(
    await bubble.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight,
    })),
  ).toEqual({ horizontal: 0, vertical: 0 });
  await expectNoAccessibilityViolations(page);
  // Everything else is out of the way until asked for.
  await expect(page.getByPlaceholder("Add location")).toHaveCount(0);
  await expect(page.getByPlaceholder("Add notes")).toHaveCount(0);
  await expect(page.getByLabel("Repeat")).toHaveCount(0);
  await expect(
    bubble.locator('[data-ui="calendar-placement"]'),
  ).toHaveCount(0);

  // The documented keyboard path submits without leaving the title field.
  await page.getByRole("textbox", { name: "Event title" }).fill("Studio time");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("status")).toContainText("Event created.");
});

test("keeps event edits focused and moves details to a full page", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: /Client call/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  // The popover is for the high-frequency edits, matching quick create.
  await expect(page.getByRole("button", { name: "More options" })).toBeVisible();
  await expect(page.getByPlaceholder("Add location")).toHaveCount(0);
  await expect(page.getByLabel("Repeat")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Choose calendars/ }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Client call revised");
  await expectNoAccessibilityViolations(page);

  await page.getByRole("button", { name: "More options" }).click();
  await expect(page).toHaveURL(/\/event\/client-call\?/);
  await expect(page).toHaveURL(/title=Client\+call\+revised/);
  await expect(page.getByRole("heading", { name: "Edit event" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toHaveValue("Client call revised");

  // The page is the deliberate, complete layer and survives a reload.
  await expect(page.getByPlaceholder("Add location")).toBeVisible();
  await expect(page.getByLabel("Repeat")).toBeVisible();
  await expect(page.getByRole("button", { name: "More options" })).toHaveCount(
    0,
  );
  await expectNoAccessibilityViolations(page);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toHaveValue("Client call revised");

  await page.getByPlaceholder("Add location").fill("Studio C");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page).toHaveURL(/\/month\?date=2026-07-26/);
  await expect(
    page.getByRole("button", { name: /Client call revised/ }).first(),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test("makes the scope of a recurring event edit explicit", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  await page.getByRole("button", { name: /Weekly review/ }).first().click();
  // The popover badges the series and its Edit is one word; "series" is spelled
  // out again by the editor it opens.
  await page.getByRole("button", { exact: true, name: "Edit" }).click();
  await page.getByRole("button", { name: "More options" }).click();

  await expect(page).toHaveURL(/\/event\/weekly-review\?/);
  await expect(page.getByRole("heading", { name: "Edit series" })).toBeVisible();
  await expect(
    page.getByText("Changes here apply to the recurring series."),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
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
  await expectNoAccessibilityViolations(page);

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
  await page.getByRole("button", { exact: true, name: "Create" }).click();

  // Saving lands back on the view and date it started from.
  await expect(page).toHaveURL(/\/week\?date=2026-07-30/);
  expect(writes[0]!.title).toBe("Quarterly review");
  await expect(
    page.getByRole("button", { name: /Quarterly review/ }).first(),
  ).toBeVisible();
});

test("uses the desktop event editor as a fixed multi-column workspace", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { exact: true, name: "Event" }).click();
  await page.getByRole("button", { name: "More options" }).click();

  const editor = page.locator("[data-event-editor-page]");
  const surface = page.locator("[data-event-editor-surface]");
  const form = surface.locator('form[data-layout="page"]');
  const when = form.locator('[data-editor-section="when"]');
  const details = form.locator('[data-editor-section="details"]');
  const calendarSection = form.locator(
    '[data-editor-section="calendars"]',
  );
  const [whenBox, detailsBox, calendarBox] = await Promise.all([
    when.boundingBox(),
    details.boundingBox(),
    calendarSection.boundingBox(),
  ]);

  expect(whenBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(calendarBox).not.toBeNull();
  expect(Math.abs(whenBox!.y - detailsBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(detailsBox!.y - calendarBox!.y)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth - window.innerWidth,
      vertical:
        document.documentElement.scrollHeight - window.innerHeight,
    })),
  ).toEqual({ horizontal: 0, vertical: 0 });
  expect(
    await editor.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight,
    })),
  ).toEqual({ horizontal: 0, vertical: 0 });
  expect(
    await form
      .locator('[data-ui="calendar-placement"]')
      .evaluate((element) => element.scrollHeight - element.clientHeight),
  ).toBeLessThanOrEqual(1);

  await page.getByPlaceholder("Add location").fill("Studio B");
  await page.getByPlaceholder("Add notes").fill("Bring the roadmap.");
  await expect(
    page.getByRole("button", { exact: true, name: "Create" }),
  ).toBeInViewport();

  await page.setViewportSize({ height: 768, width: 1024 });
  const create = page.getByRole("button", {
    exact: true,
    name: "Create",
  });
  const [compactSurfaceBox, compactActionsBox, compactWhenBox] =
    await Promise.all([
      surface.boundingBox(),
      create.locator("..").boundingBox(),
      when.boundingBox(),
    ]);
  expect(compactSurfaceBox).not.toBeNull();
  expect(compactActionsBox).not.toBeNull();
  expect(compactWhenBox).not.toBeNull();
  expect(compactSurfaceBox!.x).toBeGreaterThanOrEqual(28);
  expect(
    Math.abs(
      compactSurfaceBox!.x -
        (1024 - compactSurfaceBox!.x - compactSurfaceBox!.width),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(compactActionsBox!.x - (compactSurfaceBox!.x + 12)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      compactActionsBox!.x +
        compactActionsBox!.width -
        (compactSurfaceBox!.x + compactSurfaceBox!.width - 12),
    ),
  ).toBeLessThanOrEqual(2);

  const [dateBox, startTimeBox, repeatBox] = await Promise.all([
    form.getByRole("button", { name: /^Date:/ }).boundingBox(),
    form.getByLabel("Start time").boundingBox(),
    form.getByLabel("Repeat").boundingBox(),
  ]);
  expect(dateBox).not.toBeNull();
  expect(startTimeBox).not.toBeNull();
  expect(repeatBox).not.toBeNull();
  expect(Math.abs(dateBox!.x - startTimeBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(startTimeBox!.x - repeatBox!.x)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth - window.innerWidth,
      vertical:
        document.documentElement.scrollHeight - window.innerHeight,
    })),
  ).toEqual({ horizontal: 0, vertical: 0 });
  expect(
    await form
      .locator('[data-ui="calendar-placement"]')
      .evaluate((element) => element.scrollHeight - element.clientHeight),
  ).toBeLessThanOrEqual(1);
  await expect(
    create,
  ).toBeInViewport();
  await expectNoAccessibilityViolations(page);
});

test("keeps the full event editor usable on a narrow viewport", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.setViewportSize({ height: 720, width: 390 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { exact: true, name: "Event" }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Mobile planning");
  await page.getByRole("button", { name: "More options" }).click();

  await expect(page).toHaveURL(/\/event\/new\?/);
  await expect(page.getByRole("heading", { name: "New event" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Event title" }),
  ).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Event editor" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "When" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Event calendars" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page);

  const create = page.getByRole("button", {
    exact: true,
    name: "Create",
  });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeVisible();
  await page.getByRole("button", { name: "Back to calendar" }).click();
  await expect(page).toHaveURL(/\/month\?date=2026-07-26/);
  expect(runtimeErrors).toEqual([]);
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
  await expect(page.getByRole("button", { name: /^Date:/ })).toContainText(
    "Wednesday, July 15, 2026",
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
  await page.setViewportSize({ width: 800, height: 720 });
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const calendarArea = page.locator("[data-calendar-area]");
  const initialScrollTop = await calendarArea.evaluate(
    (element) => element.scrollTop,
  );
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
  expect(
    await calendarArea.evaluate((element) => element.scrollTop),
  ).toBe(initialScrollTop);

  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
});



test("parks a stuck agenda day below the year band, not under it", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/agenda?date=2026-07-26`);
  await expect(page.locator("[data-agenda-date]").first()).toBeVisible();

  const scroller = page.locator('[class*="calendarArea"]');
  await scroller.evaluate((element) => {
    element.scrollTop = 90;
  });

  // Both are sticky and the year sits above, so a shared stop would slide the
  // day label out of sight underneath it.
  const geometry = await page.evaluate(() => {
    const area = document
      .querySelector('[class*="calendarArea"]')!
      .getBoundingClientRect();
    const year = document
      .querySelector('[class*="agendaYear"]')!
      .getBoundingClientRect();
    const resting = [...document.querySelectorAll("[data-agenda-date]")]
      .map((date) => date.getBoundingClientRect().top - area.top)
      .filter((top) => top >= 0 && top < 60);

    return { resting, yearBottom: year.bottom - area.top };
  });

  expect(geometry.resting.length).toBeGreaterThan(0);
  for (const top of geometry.resting) {
    expect(top).toBeGreaterThanOrEqual(geometry.yearBottom - 1);
  }
});

test("keeps a page's settings button on its row, not under it", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  const row = page.getByRole("button", { name: "My calendar", exact: true });
  const settings = page.getByRole("button", { name: "Edit My calendar" });
  await expect(row).toBeVisible();
  const rowBox = (await row.boundingBox())!;
  const settingsBox = (await settings.boundingBox())!;

  // Overlaid on the row's right edge and centred on it — the row stays one line.
  expect(settingsBox.x).toBeGreaterThan(rowBox.x + rowBox.width / 2);
  expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(
    rowBox.x + rowBox.width + 1,
  );
  expect(
    Math.abs(
      settingsBox.y + settingsBox.height / 2 - (rowBox.y + rowBox.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
});

test("offers the drawer toggle only where there is a drawer", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

  // Desktop keeps the sidebar in place, so a toggle for it opens nothing.
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeHidden();

  await page.setViewportSize({ height: 720, width: 390 });
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Close navigation" }).first(),
  ).toBeVisible();
});


test("asks which occurrences an edited series applies to", async ({ page }) => {
  await mockAuthenticatedReads(page);
  const writes: Array<{ body: Record<string, unknown>; method: string }> = [];
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
  await page.getByRole("button", { name: /Weekly review/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Weekly retro");
  await page.getByRole("button", { name: "Save" }).click();

  // Editing one occurrence of a series is the same question dragging one asks.
  const scope = page.getByRole("dialog", { name: "Change recurring event" });
  await expect(scope).toBeVisible();
  await expect(scope).toContainText("Which events should take the changes");
  expect(writes).toHaveLength(0);

  await scope.getByRole("button", { name: "This event" }).click();

  // The series keeps its own title minus this date; the edit becomes a
  // standalone event.
  await expect(page.getByRole("status")).toContainText("Occurrence updated.");
  const updated = writes.find((write) => write.method === "PUT")!;
  expect(updated.body.title).toBe("Weekly review");
  expect(updated.body.recurrence).toContain("EXDATE:");
  const created = writes.find((write) => write.method === "POST")!;
  expect(created.body.title).toBe("Weekly retro");
  expect(created.body.recurrence).toBeNull();
});

test("edits a whole series without moving it onto one date", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  const writes: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON() as Record<string, unknown>);
    }
    return route.fallback();
  });

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: /Weekly review/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Event title" })
    .fill("Weekly retro");
  await page.getByRole("button", { name: "Save" }).click();
  await page
    .getByRole("dialog", { name: "Change recurring event" })
    .getByRole("button", { name: "All events" })
    .click();

  await expect(page.getByRole("status")).toContainText(
    "Recurring series updated.",
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]!.title).toBe("Weekly retro");
  // The master keeps its own first occurrence rather than jumping to the one
  // that was edited.
  expect(new Date(writes[0]!.start as string).toISOString()).toContain(
    "2026-07-06",
  );
});



test("asks the scope question above the layer that raised it", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: /Weekly review/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();

  const scope = page.getByRole("dialog", { name: "Change recurring event" });
  await expect(scope).toBeVisible();

  // The editor stays mounted so nothing typed is lost, but a popover paints
  // above dialogs by default and would hide the question it just asked.
  const box = (await scope.boundingBox())!;
  const topmost = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return Boolean(element?.closest('[role="dialog"][data-state="open"]'));
    },
    [box.x + box.width / 2, box.y + 20],
  );
  expect(topmost).toBe(true);

  // Dismissing it leaves the edit where it was rather than writing anything.
  await scope.getByRole("button", { name: "Cancel" }).click();
  await expect(scope).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Edit series" }),
  ).toBeVisible();
});

test("says what a failed write left behind", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.route("**/api/v1/users/me/settings", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          body: JSON.stringify({ error: "server", requestId: "req-1" }),
          contentType: "application/json",
          status: 500,
        })
      : route.fallback(),
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.getByRole("radio", { name: "12 hour" }).click();

  // An error has to answer what happened to the thing the user just touched —
  // "could not be saved" alone leaves them guessing whether it stuck.
  await expect(settingsDialog.getByRole("alert")).toContainText(
    "could not be saved",
  );
  await expect(settingsDialog.getByRole("alert")).toContainText(
    "went back to its previous value",
  );
  await expect(
    settingsDialog.getByRole("radio", { name: "24 hour" }),
  ).toHaveAttribute("aria-checked", "true");
});



test("brings the calendar forward when the live stream comes back", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  let eventReads = 0;
  await page.route("**/api/v1/events", (route) => {
    if (route.request().method() === "GET") eventReads += 1;
    return route.fallback();
  });
  // The stream is down before the app opens it, so it starts out reconnecting.
  const streamDown = (route: Route) => route.abort();
  await page.route("**/api/stream", streamDown);

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();
  const whileDown = eventReads;

  await page.unroute("**/api/stream", streamDown);
  await page.route("**/api/stream", (route) =>
    route.fulfill({ body: ":ok\n\n", contentType: "text/event-stream" }),
  );

  // Nothing arrives over the stream to say what changed, so a reopen has to
  // refetch: anything that happened while it was down is otherwise invisible.
  await expect(async () => {
    expect(eventReads).toBeGreaterThan(whileDown);
  }).toPass({ timeout: 10_000 });
});

/** Which snapshots the browser is holding, if any. */
function snapshotKeys(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open("musubi-offline");
        request.onsuccess = () => {
          const database = request.result;
          if (![...database.objectStoreNames].includes("query-cache")) {
            return resolve([]);
          }
          const read = database
            .transaction("query-cache")
            .objectStore("query-cache")
            .getAllKeys();
          read.onsuccess = () => resolve(read.result.map(String));
          read.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      }),
  );
}

test("starts from its snapshot with no server, then catches up", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();
  // The snapshot is written on a throttle, so wait for it to land rather than
  // reloading into an empty store.
  await expect(async () => {
    expect(
      await page.evaluate(() => window.localStorage.getItem("musubi:last-session")),
    ).toBeTruthy();
    expect(await snapshotKeys(page)).not.toHaveLength(0);
  }).toPass({ timeout: 5_000 });

  // Everything the app talks to is gone — not refusing, unreachable, which is
  // what a laptop off the network and a self-hosted server that is down both
  // look like. `/src/**` has to keep loading or Vite itself cannot serve the app.
  const dead = (route: Route) => route.abort();
  for (const pattern of ["**/api/v1/**", "**/api/auth/**", "**/api/stream"]) {
    await page.route(pattern, dead);
  }
  await page.reload();

  // The five guarantees of offline v1 (`07-realtime-offline-federation.md:88-92`),
  // seen from the outside: the calendar is there, it says how old it is, and it
  // refuses to pretend a write went through.
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();
  const banner = page.getByRole("status").filter({ hasText: "Offline" });
  await expect(banner).toContainText(/showing the calendar as it was .+ago|just now/);
  await expect(banner).toContainText("Changes cannot be saved");

  await page.getByRole("button", { name: /Client call/ }).first().click();
  await page.getByRole("button", { exact: true, name: "Edit" }).click();
  const title = page.getByRole("textbox", { name: "Event title" });
  await title.fill("Renamed while offline");
  await expect(
    page.getByRole("button", { name: "No connection" }),
  ).toBeDisabled();
  // The typing survives — a draft is worth more than a cleared form.
  await expect(title).toHaveValue("Renamed while offline");
  await page.keyboard.press("Escape");

  for (const pattern of ["**/api/v1/**", "**/api/auth/**", "**/api/stream"]) {
    await page.unroute(pattern, dead);
  }
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // Back online the banner has to go, or a fresh calendar keeps apologising for
  // being stale.
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();
});

test("leaves nothing of the last account on a shared computer", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();

  await page.getByRole("button", { name: "Sign out Web QA" }).click();
  await expect(page).toHaveURL(/\/login/);
  // Not "eventually gone" — never rendered. `06-settings-pages-sync.md:175` is
  // explicit that the login screen must not flash the previous user's data.
  await expect(page.getByRole("button", { name: /Client call/ })).toHaveCount(0);
  await expect(page.getByText("Web QA")).toHaveCount(0);

  expect(
    await page.evaluate(() => window.localStorage.getItem("musubi:last-session")),
  ).toBeNull();
  expect(await snapshotKeys(page)).toEqual([]);

  // The next person, with the server unreachable, must reach the login page and
  // not a snapshot: nothing local is left to restore.
  const dead = (route: Route) => route.abort();
  for (const pattern of ["**/api/v1/**", "**/api/auth/**", "**/api/stream"]) {
    await page.route(pattern, dead);
  }
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByRole("button", { name: /Client call/ })).toHaveCount(0);
});

test("carries one session's edit into the other over the stream", async ({
  browser,
}) => {
  // One context, one mock, two pages: two tabs of the same account against the
  // same backend, which is what the server's SSE fan-out is for.
  const context = await browser.newContext();
  await mockAuthenticatedReads(context);

  // Frames the second session is waiting for. Playwright cannot push into an
  // open response, so instead its stream request parks until there is something
  // to say, then delivers that frame and ends — the client reconnects on its own.
  const pending: string[] = [];
  await context.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "PUT") {
      pending.push("event_updated");
    }
    return route.fallback();
  });

  const first = await context.newPage();
  const second = await context.newPage();
  await second.route("**/api/stream", async (route) => {
    for (let waited = 0; pending.length === 0 && waited < 10_000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const type = pending.shift();
    if (!type) return route.abort();
    return route.fulfill({
      body: `data: ${JSON.stringify({ payload: {}, type })}\n\n`,
      contentType: "text/event-stream",
    });
  });

  const url = `/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`;
  await first.goto(url);
  await second.goto(url);
  await expect(
    second.getByRole("button", { name: /Client call/ }).first(),
  ).toBeVisible();

  await first.getByRole("button", { name: /Client call/ }).first().click();
  await first.getByRole("button", { exact: true, name: "Edit" }).click();
  await first
    .getByRole("textbox", { name: "Event title" })
    .fill("Renamed in the first tab");
  await first.getByRole("button", { name: "Save" }).click();
  await expect(first.getByRole("status")).toContainText("Event updated.");

  // The frame carries no event data — `07-realtime-offline-federation.md:35` is
  // explicit that there is no durable log to replay, so a notification is a cue
  // to refetch, not the change itself. The second tab must land on the new title
  // without anybody reloading it.
  await expect(
    second.getByRole("button", { name: /Renamed in the first tab/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(second.getByRole("button", { name: /Client call/ })).toHaveCount(0);

  await context.close();
});

// 200% is where a person with low vision lives all day; 320 CSS px is what WCAG
// 1.4.10 actually demands (400% of a 1280 px viewport). Both, because a layout
// can survive one step and break at the next.
for (const { label, width } of [
  { label: "200%", width: 640 },
  { label: "400%", width: 320 },
]) {
  test(`stays usable at ${label} zoom`, async ({ page }) => {
    await mockAuthenticatedReads(page);
    await page.setViewportSize({ height: 512, width });

    await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
    await expect(
      page.getByRole("heading", { name: "My calendar" }),
    ).toBeVisible();

    // Nothing may scroll the document sideways: a reader who has to pan left and
    // right to read one row is the exact failure the criterion is about.
    const overflow = await page.evaluate(() => {
      const { documentElement: root } = document;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    // And the controls are still reachable, not merely present.
    await page.getByRole("button", { name: "Today" }).click();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("button", { name: "Sign out Web QA" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await expectNoAccessibilityViolations(page);
  });
}

test("explains an unconfirmed address instead of blaming the passphrase", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));
  // What a server with REQUIRE_EMAIL_VERIFICATION answers: a 403 carrying a code,
  // not a message the client has to pattern-match.
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      body: JSON.stringify({
        code: "EMAIL_NOT_VERIFIED",
        message: "Email not verified",
      }),
      contentType: "application/json",
      status: 403,
    }),
  );
  let resends = 0;
  await page.route("**/api/auth/send-verification-email", (route) => {
    resends += 1;
    return respond(route, { status: true });
  });

  await page.goto("/login");
  // Until React has taken the form over, the browser submits it natively and
  // reloads the page — the same trap the narrow-screen sign-in test waits out.
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Email" }).fill("unconfirmed@example.com");
  await page.getByLabel("Passphrase").fill("supersecret123");
  await page.getByRole("button", { name: "Continue" }).click();

  // The passphrase was right. Saying "check your details" here sends someone to
  // reset a password that works.
  await expect(
    page.getByRole("heading", { name: "Check your email." }),
  ).toBeVisible();
  await expect(page.getByText("unconfirmed@example.com")).toBeVisible();
  // And the form is gone: nothing typed here can move this forward.
  await expect(page.getByLabel("Passphrase")).toHaveCount(0);

  await page.getByRole("button", { name: "Send the link again" }).click();
  await expect(
    page.getByRole("button", { name: "Link sent again" }),
  ).toBeDisabled();
  expect(resends).toBe(1);

  await expectNoAccessibilityViolations(page);
});

test("says a new account is waiting on its confirmation link", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));
  // Sign-up succeeds but creates no session — `token: null` is how Better Auth
  // says "verified addresses only".
  await page.route("**/api/auth/sign-up/email", (route) =>
    respond(route, {
      token: null,
      user: { email: "new@example.com", emailVerified: false, id: "u1", name: "New Person" },
    }),
  );

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Name").fill("New Person");
  await page.getByLabel("Email").fill("new@example.com");
  await page.getByLabel("Passphrase", { exact: true }).fill("supersecret123");
  await page.getByLabel("Confirm passphrase").fill("supersecret123");
  await page.getByRole("button", { name: "Create account" }).click();

  // Redirecting instead would bounce off the session gate straight back to the
  // login form, which reads as "it did not work".
  await expect(
    page.getByRole("heading", { name: "Check your email." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("offers the sign-in providers this server can actually finish", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));
  await page.route("**/api/v1/server", (route) =>
    respond(route, {
      email: true,
      emailVerificationRequired: false,
      minClientVersion: "0.1.2",
      // Apple is advertised for the phone, which uses the native token flow —
      // and deliberately not for the browser, which needs its own registration.
      socials: ["google", "microsoft", "apple"],
      socialsWeb: ["google", "microsoft"],
      syncProviders: [],
    }),
  );
  let social: unknown;
  await page.route("**/api/auth/sign-in/social", (route) => {
    social = route.request().postDataJSON();
    // Stop before the real provider: a redirect off-origin ends the test.
    return respond(route, { redirect: false, url: "https://accounts.example.com/oauth" });
  });

  await page.goto("/login?redirect=%2Fapp%2Fp%2Fmy-calendar%2Fweek");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Microsoft" }),
  ).toBeVisible();
  // A browser has nowhere to send an Apple sign-in on this server, so offering
  // it would open a page that cannot come back.
  await expect(page.getByRole("button", { name: /Apple/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => social).toEqual(
    expect.objectContaining({
      // The page someone was interrupted for has to survive the round trip.
      callbackURL: "/app/p/my-calendar/week",
      provider: "google",
    }),
  );

  await expectNoAccessibilityViolations(page);
});

test("shows only the passphrase form on a server with no OAuth", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));
  await page.route("**/api/v1/server", (route) =>
    respond(route, {
      email: false,
      emailVerificationRequired: false,
      minClientVersion: "0.1.2",
      socials: [],
      syncProviders: [],
    }),
  );

  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  // Self-hosted Musubi without credentials: no dead buttons, no lonely divider.
  await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
  await expect(page.getByText("or", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("says so when a provider sign-in does not come back", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));

  // Where Better Auth returns the browser after a failed round trip.
  await page.goto("/login?error=oauth");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("alert")).toContainText("did not come back");
});

test("offers Apple once the server has its browser registration", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));
  await page.route("**/api/v1/server", (route) =>
    respond(route, {
      email: true,
      emailVerificationRequired: false,
      minClientVersion: "0.1.2",
      socials: ["google", "apple"],
      // A Services ID and a .p8 key are configured, so the redirect can come back.
      socialsWeb: ["google", "apple"],
      syncProviders: [],
    }),
  );
  let social: unknown;
  await page.route("**/api/auth/sign-in/social", (route) => {
    social = route.request().postDataJSON();
    return respond(route, { redirect: false, url: "https://appleid.apple.com/auth/authorize" });
  });

  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Continue with Apple" }).click();
  await expect.poll(() => social).toEqual(
    expect.objectContaining({ provider: "apple" }),
  );
});

test("hides Apple on an API too old to say what a browser can finish", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));
  await page.route("**/api/v1/server", (route) =>
    respond(route, {
      email: true,
      minClientVersion: "0.1.2",
      // No socialsWeb: this list mixes the phone's flows in, and Apple's is one
      // of them. Offering it would open a page with nowhere to return to.
      socials: ["google", "apple"],
      syncProviders: [],
    }),
  );

  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Apple/ })).toHaveCount(0);
});

test("imports the calendars of an account the moment it comes back linked", async ({
  page,
}) => {
  // The provider consent screen is a full page load away, so what the app sees
  // on the way back is a fresh boot with a marker in session storage.
  let imported = false;
  const googleCalendar = {
    accountId: "google-account-1",
    accountLabel: "qa@gmail.com",
    color: "#4285f4",
    creatorID: "user-web-qa",
    id: "g-cal-1",
    members: [],
    name: "Work (Google)",
    provider: "google",
    role: "owner",
    syncStatus: "active",
  };
  await mockAuthenticatedReads(page);
  // After the fixture, not before: Playwright matches the most recently
  // registered handler first, so registering this earlier would let the
  // fixture's own calendars route answer and the import would look like a no-op.
  await page.route("**/api/v1/calendars", (route) =>
    route.request().method() === "GET"
      ? respond(route, imported ? [...calendars, googleCalendar] : calendars)
      : route.fallback(),
  );
  // The sync endpoint is what actually pulls the provider's calendars in; until
  // it runs, Better Auth has an account and the app has nothing to show for it.
  let syncCalls = 0;
  await page.route("**/api/v1/calendars/google", (route) => {
    syncCalls += 1;
    imported = true;
    return respond(route, {});
  });

  // The real sequence: the marker is written while the app is still running,
  // then the browser leaves for the provider and comes back to a fresh boot.
  // (A reload stands in for that trip; session storage survives both.)
  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();
  await page.evaluate(() =>
    window.sessionStorage.setItem("musubi:linking-provider", "google"),
  );
  await page.reload();

  // The dialog reopens itself onto the imported account: landing on a plain
  // calendar after consenting is what reads as "nothing happened".
  const dialog = page.getByRole("dialog", { name: "Connections" });
  await expect(dialog.getByRole("button", { name: /Disconnect qa@gmail.com/ })).toBeVisible();
  expect(syncCalls).toBe(1);

  // One import per return trip. The marker is consumed on read, so a later
  // reload of the same tab must not talk to Google again — nor pop the dialog.
  await page.reload();
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Connections" })).toHaveCount(0);
  expect(syncCalls).toBe(1);
});

test("says so when the import fails instead of showing an empty list", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.route("**/api/v1/calendars/google", (route) =>
    route.fulfill({
      body: JSON.stringify({
        error: "ProviderUnavailable",
        message: "Google could not be reached.",
        requestId: "sync-failed",
      }),
      contentType: "application/json",
      status: 502,
    }),
  );

  await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
  await expect(page.getByRole("button", { name: /Client call/ })).toBeVisible();
  await page.evaluate(() =>
    window.sessionStorage.setItem("musubi:linking-provider", "google"),
  );
  await page.reload();

  // The account IS linked — the calendars are what failed. "No connected
  // accounts" alone would send someone to connect it a second time.
  await expect(
    page.getByRole("dialog", { name: "Connections" }),
  ).toContainText("could not be fetched");
});

const INVITE_TOKEN = "8f14e45fceea167a5a36dedd4bea2543";

function invitePreview() {
  return {
    color: "#6f7f6a",
    events: [
      {
        end: new Date(Date.now() + 90 * 60_000).toISOString(),
        id: "shared-1",
        isAllDay: false,
        start: new Date(Date.now() + 60 * 60_000).toISOString(),
        title: "Team lunch",
      },
    ],
    id: "shared-calendar",
    members: [{ id: "owner-1", image: null, name: "Mika" }],
    name: "Studio",
  };
}

test("shows an invitation in the browser and joins it", async ({ page }) => {
  await mockAuthenticatedReads(page);
  await page.route(`**/api/v1/calendars/tokens/${INVITE_TOKEN}`, (route) =>
    respond(route, invitePreview()),
  );
  let joined: unknown;
  await page.route("**/api/v1/calendars/members/*", (route) => {
    joined = { body: route.request().postDataJSON(), url: route.request().url() };
    return respond(route, { id: "shared-calendar", joined: true });
  });

  await page.goto(`/invite/${INVITE_TOKEN}`);

  // The point of a preview: what you are joining and who is already on it,
  // before you decide — not a deep link to an app you may not have.
  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
  await expect(page.getByText("Mika shared a calendar with you.")).toBeVisible();
  await expect(page.getByText("Team lunch")).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await page.getByRole("button", { name: "Join this calendar" }).click();
  await expect(page).toHaveURL(/\/app\/p\/default\/month/);
  expect(joined).toMatchObject({
    body: { token: INVITE_TOKEN },
    url: expect.stringContaining("/calendars/members/shared-calendar"),
  });
});

test("carries an invitation through sign in", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => respond(route, null));
  await page.route(`**/api/v1/calendars/tokens/${INVITE_TOKEN}`, (route) =>
    respond(route, invitePreview()),
  );

  await page.goto(`/invite/${INVITE_TOKEN}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();

  // Joining writes membership, so it needs an account here — and the invitation
  // has to survive that detour, or the person lands on an empty calendar and the
  // link is already spent.
  await page.getByRole("button", { name: "Create an account to join" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/login\\?redirect=%2Finvite%2F${INVITE_TOKEN}`),
  );
});

test("says an invitation is spent rather than showing an empty page", async ({
  page,
}) => {
  await mockAuthenticatedReads(page);
  await page.route(`**/api/v1/calendars/tokens/${INVITE_TOKEN}`, (route) =>
    route.fulfill({
      body: JSON.stringify({ error: "NotFound", message: "Invite not found." }),
      contentType: "application/json",
      status: 404,
    }),
  );

  await page.goto(`/invite/${INVITE_TOKEN}`);

  await expect(
    page.getByRole("heading", { name: "This invitation is no longer open." }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
});
