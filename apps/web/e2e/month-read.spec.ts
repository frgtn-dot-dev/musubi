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
      { location: "Studio B" },
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

function respond(route: Route, body: unknown) {
  return route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    headers: { "x-request-id": "playwright-fixture" },
    status: 200,
  });
}

async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function mockAuthenticatedReads(
  page: Page,
  eventResponse: typeof events = events,
) {
  let authenticated = true;

  await page.route("**/api/auth/get-session", (route) =>
    respond(route, authenticated ? session : null),
  );
  await page.route("**/api/auth/sign-out", (route) => {
    authenticated = false;
    return respond(route, { success: true });
  });
  await page.route("**/api/v1/calendars", (route) =>
    respond(route, calendars),
  );
  await page.route("**/api/v1/events", (route) =>
    respond(route, eventResponse),
  );
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
  await expect(page.getByRole("status")).toContainText(
    "next authenticated write slice",
  );

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
