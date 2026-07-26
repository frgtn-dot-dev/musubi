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
      "2026-07-11T00:00:00.000Z",
      { isAllDay: true, location: "Kokořínsko" },
    ),
    event(
      "family-holiday",
      "Family holiday",
      "family",
      "#365a92",
      "2026-07-17T00:00:00.000Z",
      "2026-07-23T00:00:00.000Z",
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
  await expect(page.getByRole("button", { name: /Studio retreat/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Family holiday/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Weekly review/ })).toHaveCount(5);

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
