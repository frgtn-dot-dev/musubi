import AxeBuilder from "@axe-core/playwright";
import type { Calendar } from "@musubi/types";
import {
	expect,
	test,
	type BrowserContext,
	type Locator,
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
		// A profile photo, so the sidebar has one to lose.
		image:
			"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
		name: "Web QA",
		updatedAt: "2026-07-26T14:00:00.000Z",
	},
};

const calendars: Calendar[] = [
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

/**
 * A crowded account. Twenty calendars is where lists stop being short enough to
 * lay out however they like: Page settings and every calendar picker have to
 * stay inside their box.
 */
const manyCalendars = [
	...calendars,
	...Array.from({ length: 17 }, (_, index) => ({
		color: ["#b3492f", "#d6b76b", "#365a92", "#7a9e7e", "#8a6fa8"][index % 5]!,
		creatorID: "user-web-qa",
		id: `bulk-${index}`,
		members: [],
		name: `Calendar number ${index + 4}`,
		role: "owner",
	})),
];

async function chooseSelectOption(page: Page, label: string, option: string) {
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
		recurrence: (extra.recurrence as string | undefined) ?? null,
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

/** Page visibility is edited with the Page's other saved settings. */
async function openPageFilters(page: Page) {
	await page.getByRole("button", { name: "Edit My calendar" }).click();
	const dialog = page.getByRole("dialog", { name: "Page settings" });
	await expect(dialog).toBeVisible();
	const filters = dialog.getByRole("heading", { name: "Filters" }).locator("..");
	return { dialog, filters };
}

async function setCalendarVisibility(
	page: Page,
	calendar: string,
	visible: boolean,
) {
	const { dialog, filters } = await openPageFilters(page);
	const button = filters.getByRole("button", { name: calendar });
	if ((await button.getAttribute("aria-pressed")) !== String(visible)) {
		await button.click();
	}
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function expectCalendarVisibility(
	page: Page,
	calendar: string,
	visible: boolean,
) {
	const { dialog, filters } = await openPageFilters(page);
	await expect(filters.getByRole("button", { name: calendar })).toHaveAttribute(
		"aria-pressed",
		String(visible),
	);
	await dialog.getByRole("button", { name: "Close page settings" }).click();
}

/**
 * Wait for anything moving to stop.
 *
 * A colour-contrast check on a half-faded element is a coin toss: axe reads the
 * computed background through it and flags not just that element but everything
 * visible underneath. One toast caught mid-fade produced sixty-four violations
 * across a dialog that was fine.
 *
 * Looping animations (spinners) are skipped — they never finish, and waiting on
 * one would hang the suite. A stuck animation degrades to scanning anyway
 * rather than failing, because this is a guard, not an assertion.
 */
async function settleAnimations(page: Page) {
	await page
		.waitForFunction(
			() =>
				document
					.getAnimations()
					.filter(
						(animation) =>
							animation.effect?.getComputedTiming().iterations !== Infinity,
					)
					.every((animation) => animation.playState !== "running"),
			undefined,
			{ timeout: 2_000 },
		)
		.catch(() => undefined);
}

async function expectNoAccessibilityViolations(page: Page) {
	await settleAnimations(page);
	let results;
	try {
		results = await new AxeBuilder({ page }).analyze();
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!error.message.includes("Execution context was destroyed")
		) {
			throw error;
		}
		await page.waitForLoadState("domcontentloaded");
		results = await new AxeBuilder({ page }).analyze();
	}
	expect(results.violations).toEqual([]);
}

function recordHydrationErrors(page: Page) {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() === "error" &&
			/Hydration failed|hydrated but/.test(message.text())
		) {
			errors.push(message.text());
		}
	});
	return errors;
}

function pragueTime(value: string) {
	return new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		timeZone: "Europe/Prague",
	}).format(new Date(value));
}

// Takes a Page or a whole BrowserContext: the mock is nothing but route handlers
// over one closure of state, so registering it on a context gives every page in it
// the SAME backend — which is what a two-session test needs.
async function mockAuthenticatedReads(
	page: Page | BrowserContext,
	eventResponse: typeof events = events,
	calendarResponse: typeof calendars = calendars,
	failWritesForCalendarId?: string,
	bypassMobileBlocker = true,
) {
	if (bypassMobileBlocker) {
		await page.addInitScript(() =>
			sessionStorage.setItem("musubi-mobile-web-test-bypass", "true"),
		);
	}

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
		{ id: "guest-1", image: null, name: "Guest One", status: "going" },
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
			calendarState = calendarState.filter((calendar) => calendar.id !== body.id);
			return respond(route, { ...body, members: [] });
		}
		return respond(route, calendarState);
	});
	// Asked for on every load since reminders landed. Unmocked they 500 against
	// the dev server, and a test that only asserts "no console errors" then fails
	// for a reason that has nothing to do with what it is testing.
	await page.route("**/api/v1/server", (route) =>
		respond(route, {
			email: true,
			// No VAPID keys: the "notify me when this browser is closed" toggle
			// stays hidden, which is the state most tests should see.
			pushPublicKey: null,
			socials: [],
			socialsWeb: [],
			syncProviders: ["google"],
		}),
	);
	await page.route("**/api/v1/reminders", (route) =>
		respond(route, {
			calendars: { work: { allDay: null, minutesBefore: 60 } },
			default: {
				allDay: { atMinute: 1080, daysBefore: 1 },
				minutesBefore: 10,
			},
			events: {},
		}),
	);
	await page.route("**/api/v1/reminders/**", (route) =>
		route.fulfill({ body: "", status: 204 }),
	);
	await page.route("**/api/v1/pages", (route) => respond(route, [defaultPage]));
	await page.route("**/api/v1/scheduling/polls/calendar", (route) =>
		respond(route, []),
	);
	await page.route("**/api/v1/pages/*", (route) => {
		const body = route.request().postDataJSON() as {
			config: typeof defaultPage.config;
			name: string;
		};
		return respond(route, {
			...defaultPage,
			config: body.config,
			name: body.name,
			revision: defaultPage.revision + 1,
		});
	});
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
	await page.route(/\/api\/v1\/events(?:\?.*)?$/, async (route) => {
		const method = route.request().method();

		if (method === "GET") {
			const url = new URL(route.request().url());
			const start = url.searchParams.get("start");
			const end = url.searchParams.get("end");
			if (!start || !end) return respond(route, eventState);
			const startTime = new Date(start).getTime();
			const endTime = new Date(end).getTime();
			return respond(route, {
				...eventState,
				events: eventState.events.filter(
					(event) =>
						event.recurrence ||
						(new Date(event.start).getTime() < endTime &&
							new Date(event.end).getTime() > startTime),
				),
			});
		}

		const body = route.request().postDataJSON() as (typeof events.events)[number];
		const homeCalendarId = body.originCalendarID ?? body.calendars[0];

		if (failWritesForCalendarId && homeCalendarId === failWritesForCalendarId) {
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
				events: eventState.events.filter((item) => item.id !== body.id),
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
		const { status } = route.request().postDataJSON() as { status: string };
		attendeeState = attendeeState.filter((item) => item.id !== session.user.id);
		if (status !== "none") {
			attendeeState.push({
				id: session.user.id,
				image: null,
				name: session.user.name,
				status,
			});
		}
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

test("opens a calendar for a bare /app request", async ({ page }) => {
	// The URL the marketing site links to. It matches the layout and no child,
	// so without an index route a signed-in visitor gets an empty outlet.
	await mockAuthenticatedReads(page);

	await page.goto("/app");

	await expect(page).toHaveURL(/\/app\/p\/[^/]+\/month\?date=/);
	await expect(page.getByRole("heading", { name: "My calendar" })).toBeVisible();
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
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Enter a valid email address.",
	);

	const createAccount = page.getByRole("button", { name: "Create one" });
	await createAccount.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "Begin simply." }),
	).toBeVisible();
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
	await expect(page.getByRole("button", { name: /Studio retreat/ })).toHaveCount(
		5,
	);
	await expect(page.getByRole("button", { name: /Family holiday/ })).toHaveCount(
		6,
	);
	await expect(page.getByRole("button", { name: /Weekly review/ })).toHaveCount(
		5,
	);

	await page
		.getByRole("button", { name: /Studio retreat/ })
		.first()
		.click();
	await expect(
		page.getByText(/Monday, July 6, 2026.*Friday, July 10, 2026/),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await setCalendarVisibility(page, "Studio", false);
	await expect(page.getByRole("button", { name: /Studio retreat/ })).toHaveCount(
		0,
	);

	await page.getByRole("button", { name: "Event", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Create event" })).toBeVisible();
	await page.keyboard.press("Escape");

	await expectNoAccessibilityViolations(page);

	// The profile row carries the photo, not just an initial: the session's
	// `image` used to be dropped on the way from the session to the sidebar.
	await expect(page.locator('img[src^="data:image/gif"]')).toBeVisible();

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
	await overflowDialog.getByRole("button", { name: /Crowded event 1/ }).click();
	await expect(
		page.getByRole("heading", { name: "Crowded event 1" }),
	).toBeVisible();
	expect(
		await area.evaluate((element) => element.scrollHeight - element.clientHeight),
	).toBeLessThanOrEqual(1);
});

test("reads, filters and continuously loads the authenticated Agenda", async ({
	page,
}) => {
	await page.clock.setFixedTime(new Date("2026-08-13T10:00:00Z"));
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
	await expect(page.getByRole("button", { name: /Design review/ })).toHaveCount(
		1,
	);
	await expect(
		page.getByRole("button", { name: /Studio open day/ }),
	).toHaveCount(1);

	const tomorrowRow = page.locator('[data-agenda-date="2026-08-14"]');
	await expect(tomorrowRow).toContainText("Tomorrow");
	const todayHeights = await tomorrowRow.evaluate((row) => ({
		events: row.children[1]!.getBoundingClientRect().height,
		row: row.getBoundingClientRect().height,
	}));
	expect(todayHeights.row - todayHeights.events).toBeLessThanOrEqual(1);

	await page.getByRole("button", { name: /Design review/ }).click();
	// Scoped to the preview: the agenda row shows the location too.
	const agendaPreview = page.getByRole("dialog", { name: "Design review" });
	await expect(agendaPreview.getByText("Studio B")).toBeVisible();
	await expect(agendaPreview.getByText("16:00 – 17:00")).toBeVisible();
	await page.keyboard.press("Escape");

	await page
		.getByRole("region", { name: /From Jul 26, 2026 agenda/ })
		.evaluate((agenda) => {
			agenda.parentElement?.scrollTo({
				top: agenda.parentElement.scrollHeight,
			});
		});
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

	await setCalendarVisibility(page, "Family", false);
	await expect(page.getByRole("button", { name: /Design review/ })).toHaveCount(
		0,
	);

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
	await expect(page.getByRole("button", { name: /Weekly review/ })).toHaveCount(
		1,
	);
	await expect(
		page.getByRole("button", { name: /Project check-in/ }),
	).toHaveCount(1);
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
	expect(ppp.x + ppp.width).toBeGreaterThan(columnBox.x + columnBox.width - 14);
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
	await expect(
		page.getByRole("button", { name: /Project check-in/ }),
	).toHaveCount(1);
	await expect(page.getByRole("button", { name: /Partner call/ })).toHaveCount(
		1,
	);

	await page.getByRole("button", { name: "Next day" }).click();
	await expect(page).toHaveURL(/[?&]date=2026-07-24/);
	await expect(page.getByText("Friday, July 24, 2026")).toBeVisible();
});

test("keeps Day event details beside the event inside the calendar workspace", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await mockAuthenticatedReads(page);
	await page.goto("/app/p/my-calendar/day?date=2026-07-23");

	const calendarArea = page.locator("[data-calendar-area]");
	const trigger = page.getByRole("button", { name: /Project check-in/ });
	const areaBox = (await calendarArea.boundingBox())!;
	const triggerBox = (await trigger.boundingBox())!;
	await trigger.click();

	const details = page.getByRole("dialog", { name: "Project check-in" });
	await details.evaluate((element) =>
		Promise.all(
			element
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished),
		),
	);
	const detailsBox = (await details.boundingBox())!;

	await expect(details).toHaveAttribute("data-side", /left|right/);
	expect(detailsBox.x).toBeGreaterThanOrEqual(areaBox.x);
	expect(detailsBox.y).toBeGreaterThanOrEqual(areaBox.y);
	expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(
		areaBox.x + areaBox.width,
	);
	expect(detailsBox.y + detailsBox.height).toBeLessThanOrEqual(
		areaBox.y + areaBox.height,
	);
	// Day events use the whole column, so the side placement intentionally sits
	// over the event layer instead of escaping above or below the trigger.
	expect(detailsBox.x).toBeGreaterThanOrEqual(triggerBox.x);
	expect(detailsBox.x).toBeLessThan(triggerBox.x + triggerBox.width);
});

test("creates across chosen calendars, then edits and deletes through confirmed API writes", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.goto("/app/p/my-calendar/month?date=2026-07-26");

	await page.getByRole("button", { name: "Event", exact: true }).click();
	await page.getByRole("textbox", { name: "Event title" }).fill("Release check");
	await page.getByRole("button", { name: /^Choose calendars/ }).click();
	await expect(
		page.getByRole("checkbox", { name: "Show event in Personal" }),
	).toBeChecked();
	await page.getByRole("radio", { name: "Studio as home calendar" }).click();
	await page.getByRole("checkbox", { name: "Show event in Family" }).check();
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
	await page.getByRole("button", { exact: true, name: "Delete" }).click();
	await page.getByRole("button", { exact: true, name: "Delete" }).click();

	await expect(page.getByRole("status")).toContainText("Event deleted.");
	await expect(
		page.getByRole("button", { name: /Release readiness/ }),
	).toHaveCount(0);

	await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
});

test("creates an event with an exact custom recurrence rule", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.goto(
		"/app/p/my-calendar/event/new?date=2026-07-08&returnDate=2026-07-08&view=month",
	);

	await page.getByRole("textbox", { name: "Event title" }).fill("Rotation");
	await page.getByRole("combobox", { name: "Repeat" }).click();
	await page.getByRole("option", { name: "Custom recurrence" }).click();
	await page.getByRole("spinbutton", { name: "Recurrence interval" }).fill("2");
	await page.getByRole("button", { name: "Monday" }).click();
	await page.getByRole("radio", { name: "After" }).click();
	await page.getByRole("spinbutton", { name: "Occurrence count" }).fill("5");
	await expectNoAccessibilityViolations(page);

	const createRequest = page.waitForRequest(
		(request) =>
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/api/v1/events",
	);
	await page.getByRole("button", { name: "Create" }).click();

	expect((await createRequest).postDataJSON().recurrence).toBe(
		"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5",
	);
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
	await page.getByRole("textbox", { name: "Event title" }).fill("Planning day");
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
	await startOptions.getByRole("option", { name: "13:15", exact: true }).click();
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
	expect(pragueTime(writes[0]!.start)).toBe("13:15");
	expect(
		new Date(writes[0]!.end).getTime() - new Date(writes[0]!.start).getTime(),
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
	const datePickers = [
		page.getByRole("button", { name: /^Date:/ }),
		page.getByRole("button", { name: /^Ends:/ }),
	];
	await expect(datePickers[1]).toBeVisible();
	for (const picker of datePickers) {
		const [pickerBox, chevronBox] = await Promise.all([
			picker.boundingBox(),
			picker.locator("svg").boundingBox(),
		]);
		expect(
			Math.abs(
				pickerBox!.x + pickerBox!.width - (chevronBox!.x + chevronBox!.width),
			),
		).toBeLessThanOrEqual(1);
	}
	// All-day swaps the time range for an end date in the same slot, so the toggle
	// under it does not hop a row.
	expect((await toggle.boundingBox())!.y).toBe(timed);

	await label.click();
	await expect(page.getByRole("combobox", { name: "Start time" })).toBeVisible();
	expect((await toggle.boundingBox())!.y).toBe(timed);
});

test("scrolls a long calendar list inside quick create", async ({ page }) => {
	await page.setViewportSize({ width: 1890, height: 962 });
	const manyCalendars = [
		...calendars,
		...Array.from({ length: 12 }, (_, index) => ({
			...calendars[0]!,
			color: index % 2 ? "#3f6f8f" : "#8b5f79",
			id: `project-${index}`,
			isDefault: false,
			name: `Project calendar ${index + 1}`,
		})),
	];
	await mockAuthenticatedReads(page, events, manyCalendars);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-08-11`);
	await page.getByRole("button", { name: "Event", exact: true }).click();
	await page.getByRole("button", { name: /Choose calendars/ }).click();

	const calendarList = page.getByRole("group", {
		name: "Calendars for this event",
	});
	await expect(calendarList).toBeVisible();
	expect(
		await calendarList.evaluate(
			(element) => element.scrollHeight > element.clientHeight,
		),
	).toBe(true);
	await calendarList.hover();
	await page.mouse.wheel(0, 420);
	await expect
		.poll(() => calendarList.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);

	const popoverBox = (await page
		.locator('[class*="createPopover"]')
		.boundingBox())!;
	const actionsBox = (await page
		.getByRole("button", { name: "More options" })
		.locator("xpath=..")
		.boundingBox())!;
	expect(actionsBox.y).toBeGreaterThanOrEqual(popoverBox.y);
	expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(
		popoverBox.y + popoverBox.height,
	);
});

test("keeps provider failures actionable without assuming a write succeeded", async ({
	page,
}) => {
	const providerCalendars = calendars.map((calendar) =>
		calendar.id === "studio" ? { ...calendar, provider: "google" } : calendar,
	);
	await mockAuthenticatedReads(page, events, providerCalendars, "studio");
	await page.goto("/app/p/my-calendar/month?date=2026-07-26");

	await page.getByRole("button", { name: "Event", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Event title" })
		.fill("Provider check");
	await page.getByRole("button", { name: /^Choose calendars/ }).click();
	await page.getByRole("radio", { name: "Studio as home calendar" }).click();
	await page.getByRole("button", { name: "Create" }).click();

	await expect(page.getByRole("alert")).toContainText(
		"Google Calendar did not confirm this change",
	);
	await expect(page.getByRole("alert")).toContainText("provider-write-failed");
	await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue(
		"Provider check",
	);
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
	await page.getByRole("button", { name: "Attendees · 1" }).click();
	await expect(page.getByText("Guest One")).toBeVisible();
	await page.getByRole("button", { exact: true, name: "Answer" }).click();
	await page.getByRole("menuitem", { name: "Going" }).click();
	await expect(page.getByRole("button", { name: "Going" })).toBeVisible();

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
	await page.getByRole("button", { exact: true, name: "Copy" }).click();
	await expect(
		page.getByRole("heading", { name: "Make an independent copy" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Make copy in Studio" }).click();
	await expect(page.locator('[class*="toastRegion"]')).toContainText(
		"Independent event copy created.",
	);
	await expect(page.getByRole("button", { name: /Design review/ })).toHaveCount(
		2,
	);

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
	await expect(page.getByRole("button", { name: /Weekly review/ })).toHaveCount(
		0,
	);
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

	await page.getByLabel("Choose .ics file").setInputFiles({
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
	await expectCalendarVisibility(page, "Roadmap", true);
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
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

	const settingsDialog = page.getByRole("dialog", { name: "Settings" });
	const sectionHeadings = ["Appearance", "Reminders", "Help & About", "Account"];
	const sectionTops = await Promise.all(
		sectionHeadings.map(
			async (name) =>
				(await settingsDialog
					.getByRole("heading", { exact: true, name })
					.boundingBox())!.y,
		),
	);
	expect(sectionTops).toEqual([...sectionTops].sort((a, b) => a - b));

	// Timed and all-day events are asked about separately: an offset cannot
	// answer for a birthday, and the control must not pretend it can.
	// `SettingsSection` is a labelled <section>, which is a region.
	const remindersSection = settingsDialog.getByRole("region").filter({
		has: page.getByRole("heading", { exact: true, name: "Reminders" }),
	});
	await expect(
		remindersSection.getByRole("radiogroup", { name: "Timed events" }),
	).toBeVisible();
	await expect(
		remindersSection.getByRole("radio", { name: "10 min" }),
	).toHaveAttribute("aria-checked", "true");
	await expect(
		remindersSection.getByRole("radio", { name: "Evening before" }),
	).toHaveAttribute("aria-checked", "true");

	// Settings answers for events in general. What one calendar does is a fact
	// about that calendar, and is asked there.
	await expect(settingsDialog).not.toContainText("Reminders by calendar");

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
	await page.route("**/api/v1/users/settings/document", async (route) => {
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
	});

	await page.goto("/app/p/my-calendar/week?date=2026-07-26");
	await page.getByRole("button", { name: "Settings" }).click();

	// The HTTP status text never reaches the reader: "Not Found" named the
	// transport and told nobody what to do about it.
	await expect(page.getByRole("alert")).toContainText(
		"Settings could not be loaded.",
	);
	await expect(page.getByRole("alert")).not.toContainText("Not Found");
	await expect(page.getByText("Loading settings…")).toHaveCount(0);
	await page.getByRole("button", { name: "Retry" }).click();
	await expect(page.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
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
	await expect(sheet.getByRole("heading", { name: "Appearance" })).toBeVisible();
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
	await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
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
	await expect(page).toHaveURL(new RegExp(`/app/p/${DEFAULT_PAGE_ID}/month`));
	await expect(page).toHaveURL(/[?&]date=2026-07-26/);

	// Both pages are listed; selecting one uses its saved view without losing date.
	await expect(
		page.getByRole("button", { exact: true, name: "My calendar" }),
	).toBeVisible();
	await page.getByRole("button", { exact: true, name: "Work" }).click();
	await expect(page).toHaveURL(new RegExp(`/app/p/${workPageId}/week`));
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
	await page.getByRole("button", { name: "Edit Work" }).click();
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
	expect(new Date(moved.end).getTime() - new Date(moved.start).getTime()).toBe(
		60 * 60_000,
	);

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
	await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height - 6, {
		steps: 8,
	});
	await expect(page.locator("[data-live]")).toHaveCount(3);
	await expect(page.locator("[data-draft]")).toHaveCount(0);
	await expect(page.getByRole("dialog", { name: "Create event" })).toHaveCount(
		0,
	);

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

	await page
		.getByRole("button", { name: /Design review/ })
		.first()
		.click();
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
		await page.locator("[data-calendar-area]").evaluate((el) => {
			const style = getComputedStyle(el);
			return style.userSelect || style.getPropertyValue("-webkit-user-select");
		}),
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
	await rows
		.nth(1)
		.getByRole("button", { exact: true, name: "My calendar" })
		.focus();
	await page.keyboard.press("Alt+ArrowUp");
	await expect.poll(() => writes[1]).toEqual([DEFAULT_PAGE_ID, workPageId]);
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
	const chip = page.getByRole("button", { name: /Project check-in/ }).first();
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
	expect(new Date(moved.end).getTime() - new Date(moved.start).getTime()).toBe(
		60 * 60_000,
	);
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
	const canvasHeight = async () => (await canvas.boundingBox())?.height ?? 0;

	const comfortable = await canvasHeight();
	expect(comfortable).toBeGreaterThan(0);

	await page.getByRole("button", { name: "Edit My calendar" }).click();
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

test("keeps transient views out of saved Page filters", async ({ page }) => {
	await mockAuthenticatedReads(page);
	let saved:
		| { config?: { calendarVisibility?: unknown; view?: unknown } }
		| undefined;
	const workPageId = "22222222-2222-4222-8222-222222222222";
	const workPage = {
		...defaultPage,
		config: {
			...defaultPage.config,
			icon: "briefcase" as const,
			view: {
				configVersion: 1 as const,
				density: "comfortable" as const,
				id: "week" as const,
				weekend: true,
			},
		},
		id: workPageId,
		isDefault: false,
		name: "Work",
		position: 1,
	};
	await page.route("**/api/v1/pages", (route) =>
		respond(route, [defaultPage, workPage]),
	);
	await page.route(`**/api/v1/pages/${DEFAULT_PAGE_ID}`, async (route) => {
		saved = route.request().postDataJSON() as typeof saved;
		return respond(route, {
			...defaultPage,
			config: saved?.config,
			revision: 2,
		});
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await setCalendarVisibility(page, "Studio", false);
	await page.getByRole("radio", { name: "Agenda" }).click();

	await page.getByRole("button", { exact: true, name: "Work" }).click();
	await expect(page).toHaveURL(`/app/p/${workPageId}/week?date=2026-07-26`);
	await page.getByRole("button", { exact: true, name: "My calendar" }).click();
	await expect(page).toHaveURL(
		`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`,
	);

	expect(saved?.config?.calendarVisibility).toEqual({
		hiddenCalendarIds: ["studio"],
		mode: "all",
	});
	expect(saved?.config?.view).toEqual({
		configVersion: 1,
		id: "month",
		showAdjacentDays: true,
	});
	await expect(
		page.getByRole("region", { name: "Unsaved Page changes" }),
	).toHaveCount(0);
});

test("edits and saves a page's calendar visibility", async ({ page }) => {
	await mockAuthenticatedReads(page);
	let saved: { config?: { calendarVisibility?: unknown } } | undefined;
	await page.route(`**/api/v1/pages/${DEFAULT_PAGE_ID}`, async (route) => {
		const body = route.request().postDataJSON() as {
			config?: { calendarVisibility?: unknown };
			name: string;
		};
		saved = body;
		return respond(route, {
			...defaultPage,
			config: body.config,
			name: body.name,
			revision: 2,
		});
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await expect(page.getByRole("button", { name: "Filters" })).toHaveCount(0);

	await page.getByRole("button", { name: "Edit My calendar" }).click();
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
	// Reopening Page settings reflects the saved visibility.
	await expectCalendarVisibility(page, "Studio", false);
});

test("surfaces a page save conflict without overwriting", async ({ page }) => {
	await mockAuthenticatedReads(page);
	await page.route(`**/api/v1/pages/${DEFAULT_PAGE_ID}`, (route) =>
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
	await page.getByRole("button", { name: "Edit My calendar" }).click();
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
		(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
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
	await page.evaluate(
		(data) => {
			const sockets = (
				window as unknown as {
					__sse?: Array<{ onmessage: ((e: { data: string }) => void) | null }>;
				}
			).__sse;
			sockets?.[sockets.length - 1]?.onmessage?.({ data });
		},
		JSON.stringify({ payload: { page: sharedPage }, type: "page_created" }),
	);

	// The page created elsewhere shows up without a manual refresh.
	await expect(
		page.getByRole("button", { exact: true, name: "Shared plan" }),
	).toBeVisible();
});

test("creates, renames and deletes a calendar", async ({ page }) => {
	await mockAuthenticatedReads(page);
	await page.emulateMedia({ reducedMotion: "reduce" });
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

	const sourceIcon = calendarDialog
		.locator('[class*="groupHeader"] [data-provider="musubi"]')
		.first();
	const calendarSwatch = calendarDialog
		.locator("[data-calendar-swatch]")
		.first();
	const [sourceBox, swatchBox] = await Promise.all([
		sourceIcon.boundingBox(),
		calendarSwatch.boundingBox(),
	]);
	expect(sourceBox).not.toBeNull();
	expect(swatchBox).not.toBeNull();
	expect(
		Math.abs(
			sourceBox!.x + sourceBox!.width / 2 - (swatchBox!.x + swatchBox!.width / 2),
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
	// Export and Import are a matched pair. They used to sit side by side, which
	// made the test a row alignment; in the side column of the wide dialog they are
	// stacked, so the alignment that matters is the left edge and the width — two
	// cards of different widths read as two unrelated things.
	expect(Math.abs(exportSelectBox!.x - fileControlBox!.x)).toBeLessThanOrEqual(
		1,
	);
	expect(
		Math.abs(exportSelectBox!.width - fileControlBox!.width),
	).toBeLessThanOrEqual(1);
	expect(
		Math.abs(exportButtonBox!.height - importButtonBox!.height),
	).toBeLessThanOrEqual(1);

	// Create
	await page.getByPlaceholder("New calendar").fill("Travel");
	await page
		.getByRole("button", { name: "New calendar color: #B3A48A" })
		.click();
	await expect(page.getByRole("dialog", { name: "Choose color" })).toBeVisible();
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
	const travelRow = page.getByRole("listitem").filter({ hasText: "Travel" });
	await expect(travelRow).toBeVisible();
	await expect(travelRow.locator("[data-calendar-swatch]")).toHaveCSS(
		"background-color",
		"rgb(168, 181, 160)",
	);

	// Rename
	await page.getByRole("button", { name: "Settings for Travel" }).click();
	await page.getByRole("textbox", { name: "Rename Travel" }).fill("Trips");
	await page
		.getByRole("dialog", { name: "Calendar settings" })
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
	await deleteDialog.getByRole("button", { name: "Delete calendar" }).click();
	await expect(page.locator('[class*="toastRegion"]')).toContainText(
		"Trips deleted.",
	);
	await expect(
		page.getByRole("listitem").filter({ hasText: "Trips" }),
	).toHaveCount(0);
});

test("creates a calendar inside a connected account", async ({ page }) => {
	const withAccount = [
		calendars[0]!,
		{
			...calendars[1]!,
			accountId: "google-work",
			accountLabel: "work@example.com",
			provider: "google",
		},
	];
	await mockAuthenticatedReads(page, events, withAccount);
	let created: { accountId?: string; provider?: string } | undefined;
	await page.route("**/api/v1/calendars", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		created = route.request().postDataJSON();
		return respond(
			route,
			{
				accountId: "google-work",
				accountLabel: "work@example.com",
				color: "#B3A48A",
				creatorID: "web-qa",
				id: "cal-new",
				isDefault: false,
				members: [],
				name: "Studio hours",
				provider: "google",
				role: "owner",
			},
			201,
		);
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.getByRole("button", { name: "Calendars" }).click();
	const dialog = page.getByRole("dialog", { name: "Calendars" });

	await dialog.getByPlaceholder("New calendar").fill("Studio hours");
	// The destination is offered because an account is connected; with none, the
	// control is not there at all.
	await dialog.getByRole("combobox", { name: "Account", exact: true }).click();
	await page.getByRole("option", { name: "work@example.com" }).click();
	await dialog.getByRole("button", { name: "Add", exact: true }).click();

	// Provider and account go with it, which is what makes the server create it on
	// Google first and import the mirror. The cleared field is the flow finishing:
	// an error would have left the name where it was, with a message under it.
	await expect(dialog.getByPlaceholder("New calendar")).toHaveValue("");
	await expect(dialog.getByRole("alert")).toHaveCount(0);
	expect(created).toMatchObject({
		accountId: "google-work",
		name: "Studio hours",
		provider: "google",
	});
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
	// A synced calendar is a calendar: it can be renamed, recoloured and shared
	// with people here, the same as one kept on this server. The server renames it
	// on the provider first and refuses if the account is somebody else's.
	await expect(
		googleGroup.getByRole("button", { name: "Settings for Studio" }),
	).toBeVisible();
	await expect(
		googleGroup.getByRole("button", { name: "Share Studio" }),
	).toBeVisible();
	// Deleting is not offered, because on a provider it is not reversible. The
	// reversible thing — stop syncing — is in its place.
	await expect(
		googleGroup.getByRole("button", { name: "Delete Studio" }),
	).toHaveCount(0);
	await expect(
		googleGroup.getByRole("button", { name: "Stop syncing Studio" }),
	).toBeVisible();

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

test("keeps a calendar's reminder on the calendar, viewer or not", async ({
	page,
}) => {
	const saved: Array<{ body: unknown; url: string }> = [];
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/reminders/calendars/**", (route) => {
		saved.push({
			body: route.request().postDataJSON() as unknown,
			url: route.request().url(),
		});
		return route.fulfill({ body: "", status: 204 });
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.getByRole("button", { name: "Calendars" }).click();
	const dialog = page.getByRole("dialog", { name: "Calendars" });
	await expect(dialog).toBeVisible();

	// Family is shared with this account as an editor rather than owned, and the
	// row still offers its settings: when your own phone rings is not the
	// owner's call.
	await dialog.getByRole("button", { name: "Settings for Family" }).click();
	const sheet = page.getByRole("dialog", { name: "Calendar settings" });
	await expect(sheet).toBeVisible();

	const choices = sheet.getByRole("radiogroup", { name: "Remind me" });
	await expect(choices).toBeVisible();
	// No rule of its own yet, so it follows the account default.
	await expect(sheet.getByRole("radio", { name: "Default" })).toHaveAttribute(
		"aria-checked",
		"true",
	);

	await sheet.getByRole("radio", { name: "Evening before" }).click();
	await expect(page.locator('[class*="toastRegion"]')).toContainText(
		"Reminder saved.",
	);
	expect(saved).toHaveLength(1);
	expect(saved[0]?.url).toContain("/api/v1/reminders/calendars/family");
	expect(saved[0]?.body).toEqual({
		rule: { allDay: { atMinute: 1080, daysBefore: 1 }, minutesBefore: null },
	});

	// The label sits above the choices, so a five-option bar gets the full width
	// instead of being squeezed into the half a row leaves it.
	const [labelBox, choiceBox] = await Promise.all([
		sheet.getByText("Remind me", { exact: true }).boundingBox(),
		choices.boundingBox(),
	]);
	expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(choiceBox!.y + 1);
	// Every option readable: an option clipped to less than its text is the bug
	// this row had when the label sat beside it.
	for (const label of ["Off", "10 min", "1 hour", "Evening before"]) {
		const option = choices.getByRole("radio", { exact: true, name: label });
		const fits = await option.evaluate(
			(node) => node.scrollWidth <= node.clientWidth + 1,
		);
		expect(fits, `${label} is clipped`).toBe(true);
	}

	const accessibility = await new AxeBuilder({ page })
		.include('[role="dialog"]')
		.analyze();
	expect(accessibility.violations).toEqual([]);
});

test("offers a reload when the server has moved past this tab", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	// Registered after the helper's, so this one answers.
	await page.route("**/api/v1/server", (route) =>
		respond(route, {
			email: true,
			pushPublicKey: null,
			socials: [],
			socialsWeb: [],
			syncProviders: ["google"],
			version: "9.9.9",
		}),
	);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	const banner = page.getByRole("status").filter({ hasText: "A newer Musubi" });
	await expect(banner).toBeVisible();

	// Offers, never takes over: someone may be mid-sentence in an event.
	await expect(banner.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("stays quiet when the server is behind this tab", async ({ page }) => {
	await mockAuthenticatedReads(page);
	// The self-hosting case: a server older than the app it serves. Reloading
	// fetches the same bundle again, so there is nothing to offer.
	await page.route("**/api/v1/server", (route) =>
		respond(route, {
			email: true,
			pushPublicKey: null,
			socials: [],
			socialsWeb: [],
			syncProviders: ["google"],
			version: "0.0.1",
		}),
	);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await expect(page.getByRole("heading", { name: "My calendar" })).toBeVisible();

	await expect(
		page.getByRole("status").filter({ hasText: "A newer Musubi" }),
	).toHaveCount(0);
});

test("does not ask twice for a reload that changed nothing", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/server", (route) =>
		respond(route, {
			email: true,
			pushPublicKey: null,
			socials: [],
			socialsWeb: [],
			syncProviders: ["google"],
			version: "9.9.9",
		}),
	);
	// Releases land API first, web second. Between the two the reload lands on
	// the same bundle, and a bar that returns each time reads as a broken app.
	await page.addInitScript(() =>
		sessionStorage.setItem("musubi-reloaded-for", "9.9.9"),
	);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await expect(page.getByRole("heading", { name: "My calendar" })).toBeVisible();

	await expect(
		page.getByRole("status").filter({ hasText: "A newer Musubi" }),
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
	const empty = (route: Route) => route.fulfill({ body: "", status: 200 });

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
	let inviteRequest:
		| { expiresAt: null | string; maxUses: null | number }
		| undefined;
	await page.route("**/api/v1/calendars/invites", (route) => {
		inviteSeq += 1;
		inviteRequest = route.request().postDataJSON();
		const created = {
			calendarID: "44444444-4444-4444-8444-444444444444",
			expiresAt: inviteRequest!.expiresAt,
			id: `invite-${inviteSeq}`,
			maxUses: inviteRequest!.maxUses,
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
	await expect(roleGroup.getByRole("radio", { name: "Editor" })).toHaveAttribute(
		"aria-checked",
		"true",
	);

	// Create then revoke an invite link. Both limits are fillable rather than a
	// short preset list, and the header close makes a second Done footer redundant.
	await expect(sharingDialog.getByRole("button", { name: "Done" })).toHaveCount(
		0,
	);
	await expect(sharingDialog.locator("footer")).toHaveCount(0);
	const expiryInput = sharingDialog.getByRole("spinbutton", {
		name: "Expires after days",
	});
	const peopleInput = sharingDialog.getByRole("spinbutton", {
		name: "How many people",
	});
	await expect(expiryInput).toHaveValue("7");
	await expect(
		expiryInput.locator("xpath=..").getByText("days", { exact: true }),
	).toBeVisible();
	await expiryInput.fill("1");
	await expect(
		expiryInput.locator("xpath=..").getByText("day", { exact: true }),
	).toBeVisible();
	await expiryInput.fill("10");
	await peopleInput.fill("5");
	const createInviteButton = sharingDialog.getByRole("button", {
		name: "Create invite link",
	});
	const limitsBox = (await peopleInput.boundingBox())!;
	const createBox = (await createInviteButton.boundingBox())!;
	const optionsBox = (await createInviteButton
		.locator("xpath=..")
		.boundingBox())!;
	expect(createBox.x - (limitsBox.x + limitsBox.width)).toBeGreaterThanOrEqual(
		24,
	);
	expect(
		optionsBox.x + optionsBox.width - (createBox.x + createBox.width),
	).toBeCloseTo(24, 0);
	await createInviteButton.click();
	await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveValue(
		/\/invite\/invite-1$/,
	);
	expect(inviteRequest).toMatchObject({ maxUses: 5 });
	// Ten days as entered, counted from now rather than left open forever.
	const expiry = new Date(inviteRequest!.expiresAt!).getTime() - Date.now();
	expect(expiry).toBeGreaterThan(9.5 * 24 * 60 * 60_000);
	expect(expiry).toBeLessThan(10.5 * 24 * 60 * 60_000);
	await page.getByRole("button", { name: "Revoke invite link" }).click();
	await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveCount(
		0,
	);

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
	await expect(page.getByRole("dialog", { name: "Share Studio" })).toHaveCount(
		0,
	);
	expect(transferredRole).toBe("owner");
});

test("connects and disconnects calendar providers", async ({ page }) => {
	const runtimeErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") runtimeErrors.push(message.text());
	});
	page.on("pageerror", (error) => runtimeErrors.push(error.message));

	const withExternal: Calendar[] = [
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
	await expect(connectionsDialog.locator("footer")).toHaveCount(0);
	await expect(
		connectionsDialog.getByRole("button", { name: "Done" }),
	).toHaveCount(0);
	const accessibility = await new AxeBuilder({ page })
		.include('[role="dialog"]')
		.analyze();
	expect(accessibility.violations).toEqual([]);

	for (const title of [
		"Connected accounts",
		"Join a shared calendar",
	] as const) {
		const titleBox = await connectionsDialog
			.getByRole("heading", { name: title })
			.locator("..")
			.boundingBox();
		expect(titleBox!.height).toBeLessThanOrEqual(60);
	}

	// Capability-gated add buttons.
	await expect(
		page.getByRole("button", { exact: true, name: "Google Calendar" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { exact: true, name: "Apple / iCloud" }),
	).toBeVisible();

	// Connected account shows and disconnects.
	await expect(page.getByText("work@gmail.com")).toBeVisible();
	await page.getByRole("button", { name: "Disconnect work@gmail.com" }).click();
	await expect(page.locator('[class*="toastRegion"]')).toContainText(
		"work@gmail.com disconnected.",
	);
	expect(disconnectBody).toEqual({ accountId: "acc-1", provider: "google" });

	// CalDAV/Apple connect form.
	await page
		.getByRole("button", { exact: true, name: "Apple / iCloud" })
		.click();
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
	await expect(account.getByRole("button", { name: "Reconnect" })).toBeVisible();

	const apple = sheet.getByRole("button", {
		exact: true,
		name: "Apple / iCloud",
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
			{
				id: "conn-1",
				label: "friends.example",
				remoteUserID: "fed_1",
				server: "https://friends.example",
			},
			{
				id: "conn-2",
				label: "dead.example",
				remoteUserID: "fed_2",
				server: "https://dead.example",
			},
		]),
	);
	await page.route("**/api/v1/federation/s/conn-1/api/v1/server", (route) =>
		respond(route, {
			email: true,
			pushPublicKey: null,
			socials: [],
			socialsWeb: [],
			syncProviders: [],
			version: "0.1.4",
		}),
	);
	// Reachable server: one shared calendar with one event.
	await page.route("**/api/v1/federation/s/conn-1/api/v1/calendars", (route) =>
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
	await expectCalendarVisibility(page, "Book club", true);
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
	const deadRow = page.getByRole("listitem").filter({ hasText: "dead.example" });
	await expect(deadRow).toContainText("Unreachable");
	// Transient failures offer a retry, not a re-invite.
	await expect(
		page.getByRole("button", { name: "Retry dead.example" }),
	).toBeVisible();
	const friendsRow = page
		.getByRole("listitem")
		.filter({ hasText: "friends.example" });
	await expect(friendsRow).toContainText("Connected");
	// Federation is the one clock nobody here winds, so what that server runs
	// has to be readable rather than guessed at.
	await expect(friendsRow).toContainText("0.1.4");
	// A server that will not say stays unlabelled instead of claiming a version.
	await expect(deadRow).not.toContainText("·");

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
			{
				id: "conn-1",
				label: "friends.example",
				remoteUserID: "fed_1",
				server: "https://friends.example",
			},
		]),
	);
	await page.route("**/api/v1/federation/s/conn-1/api/v1/calendars", (route) =>
		respond(route, [remoteCalendar]),
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
			{
				id: "conn-1",
				label: "revoked.example",
				remoteUserID: "fed_1",
				server: "https://revoked.example",
			},
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

	const row = page.getByRole("listitem").filter({ hasText: "revoked.example" });
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
		(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
	});

	await mockAuthenticatedReads(page);
	let remoteName = "Book club";
	await page.route("**/api/v1/federation/connections", (route) =>
		respond(route, [
			{
				id: "conn-1",
				label: "friends.example",
				remoteUserID: "fed_1",
				server: "https://friends.example",
			},
		]),
	);
	await page.route("**/api/v1/federation/s/conn-1/api/v1/calendars", (route) =>
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
	await expectCalendarVisibility(page, "Book club", true);

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

	await expectCalendarVisibility(page, "Book club (Thursdays)", true);
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
		return respond(route, {
			calendar: null,
			server: "https://friends.example",
		});
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.getByRole("button", { name: "Connections" }).click();
	await expect(
		page.getByRole("heading", { name: "Join a shared calendar" }),
	).toBeVisible();

	const inviteInput = page.getByRole("textbox", { name: "Invite link" });
	const openInvite = page.getByRole("button", { name: "Open invite" });
	const [inputBox, buttonBox] = await Promise.all([
		inviteInput.boundingBox(),
		openInvite.boundingBox(),
	]);
	expect(
		Math.abs(
			inputBox!.y + inputBox!.height / 2 - (buttonBox!.y + buttonBox!.height / 2),
		),
	).toBeLessThanOrEqual(1);

	await inviteInput.fill(`https://friends.example/invite/${token}`);
	await openInvite.click();

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

test("joins a calendar from an invite link on this server", async ({
	page,
}) => {
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

	const sectionHeadings = ["Profile", "Security", "Leaving Musubi"];
	const sectionTops = await Promise.all(
		sectionHeadings.map(
			async (name) =>
				(await accountDialog.getByRole("heading", { name }).boundingBox())!.y,
		),
	);
	expect(sectionTops).toEqual([...sectionTops].sort((a, b) => a - b));

	await accountDialog.getByLabel("Change profile photo").setInputFiles({
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

	await accountDialog.getByRole("button", { name: /Reset passphrase/ }).click();
	await expect(page.locator('[class*="toastRegion"]')).toContainText(
		"Check your email for a link to set a new passphrase.",
	);

	await accountDialog.getByRole("button", { name: /Delete account/ }).click();
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
	await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height - 6, {
		steps: 8,
	});
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
	await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height - 6, {
		steps: 8,
	});
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

	// "/" opens the same search palette as the toolbar button and puts the caret
	// straight in its query.
	await page.keyboard.press("/");
	const search = page.getByRole("dialog", { name: "Search Musubi" });
	await expect(search.getByRole("searchbox")).toBeFocused();
	await page.keyboard.type("client");
	const clientResult = search.getByRole("button", { name: /Client call/ });
	await expect(clientResult).toBeVisible();
	await page.keyboard.press("ArrowDown");
	await expect(clientResult).toBeFocused();
	await page.keyboard.press("Escape");

	// Radix returns focus to the toolbar trigger. Slash must remain global there;
	// treating every focused button as text entry made every second opening fail.
	const searchTrigger = page.getByRole("button", {
		name: "Search events and actions",
	});
	await expect(searchTrigger).toBeFocused();
	await page.keyboard.press("/");
	const searchbox = search.getByRole("searchbox");
	await expect(searchbox).toBeFocused();
	await page.keyboard.press("ArrowDown");
	const newEventResult = search.getByRole("button", { name: "New event" });
	const todayResult = search.getByRole("button", { name: "Go to today" });
	await expect(newEventResult).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(todayResult).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(newEventResult).toBeFocused();
	await page.keyboard.press("Escape");

	const switcherBox = await page
		.getByRole("radiogroup", { name: "Calendar view" })
		.boundingBox();
	const eventBox = await page
		.getByRole("button", { name: "Event", exact: true })
		.boundingBox();
	expect(
		eventBox!.x - (switcherBox!.x + switcherBox!.width),
	).toBeLessThanOrEqual(12);
	expect(
		Math.abs(
			eventBox!.y +
				eventBox!.height / 2 -
				(switcherBox!.y + switcherBox!.height / 2),
		),
	).toBeLessThanOrEqual(1);

	// "?" opens the overlay listing the same shortcuts.
	await searchTrigger.blur();
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
	await expect(page.getByText("Refreshing saved data…")).toBeVisible();
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

test("blocks the phone web app with a full-screen app download", async ({
	page,
}) => {
	await page.setViewportSize({ height: 720, width: 390 });
	await mockAuthenticatedReads(page, events, calendars, undefined, false);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	const blocker = page.getByRole("dialog", { name: "Musubi on mobile" });
	await expect(blocker).toContainText(
		"The web app is not fully optimized for phones yet.",
	);
	await expect(
		blocker.getByRole("button", { name: "Get the Android app" }),
	).toBeVisible();
	const box = (await blocker.locator("..").boundingBox())!;
	expect(box).toMatchObject({ height: 720, width: 390, x: 0, y: 0 });
	await expect(
		page.getByRole("button", { name: "Event", exact: true }),
	).toHaveCount(0);

	await page.keyboard.press("Escape");
	await expect(blocker).toBeVisible();
	await page.reload();
	await expect(blocker).toBeVisible();
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
		await sheet.evaluate((element) => element.scrollWidth - element.clientWidth),
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
	await expect(page.getByRole("textbox", { name: "Hex color" })).toBeFocused();
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
	await expect(page.getByRole("dialog", { name: "Calendars" })).toBeVisible();
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
	const dateBox = (await sheet
		.getByText("Date", { exact: true })
		.boundingBox())!;
	const timeBox = (await sheet
		.getByText("Time", { exact: true })
		.boundingBox())!;
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
	await expect(page.getByRole("button", { name: /theme/i })).toHaveCount(0);
	// The page name is the sidebar's job; the heading stays for structure only.
	await expect(
		page.getByRole("button", { exact: true, name: "My calendar" }),
	).toBeVisible();

	// Renaming lives in the page's own settings dialog, never in the chrome.
	await expect(page.getByLabel("Page name")).toHaveCount(0);
	await page.getByRole("button", { name: "Edit My calendar" }).click();
	await expect(page.getByLabel("Page name")).toHaveValue("My calendar");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Close page settings" })
		.click();
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
	// Page filters are settings, not permanent calendar chrome.
	await expect(page.getByRole("button", { name: "Filters" })).toHaveCount(0);
	await expect(navigation.getByRole("switch")).toHaveCount(0);
	await setCalendarVisibility(page, "Studio", false);
	await expect(page.getByRole("button", { name: /Studio retreat/ })).toHaveCount(
		0,
	);

	const month = page.getByRole("radio", { name: "Month" });
	await month.focus();
	await page.keyboard.press("ArrowRight");
	await expect(page).toHaveURL(
		`/app/p/${DEFAULT_PAGE_ID}/agenda?date=2026-07-26`,
	);
	await expect(page.getByRole("radio", { name: "Agenda" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
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
	// Touch targets in the drawer: filters live in each Page's settings, so the
	// drawer only carries the Page rows.
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
	await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue(
		"Deep work",
	);

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
	expect(pragueTime(writes[0]!.start)).toBe("03:00");
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
	await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue(
		"Retreat",
	);
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
	await expect(bubble.locator('[data-ui="calendar-placement"]')).toHaveCount(0);

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

	await page
		.getByRole("button", { name: /Client call/ })
		.first()
		.click();
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
	await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue(
		"Client call revised",
	);

	// The page is the deliberate, complete layer and survives a reload.
	await expect(page.getByPlaceholder("Add location")).toBeVisible();
	await expect(page.getByLabel("Repeat")).toBeVisible();
	await expect(page.getByRole("button", { name: "More options" })).toHaveCount(
		0,
	);
	await expectNoAccessibilityViolations(page);
	await page.reload();
	await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue(
		"Client call revised",
	);

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

	await page
		.getByRole("button", { name: /Weekly review/ })
		.first()
		.click();
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
	await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue(
		"Quarterly review",
	);
	// The full set of fields is here, with no disclosure left.
	await expect(page.getByPlaceholder("Add location")).toBeVisible();
	await expect(page.getByLabel("Repeat")).toBeVisible();
	await expect(page.getByRole("button", { name: "More options" })).toHaveCount(
		0,
	);
	await expectNoAccessibilityViolations(page);

	await page.reload();
	await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue(
		"Quarterly review",
	);

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
	const calendarSection = form.locator('[data-editor-section="calendars"]');
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
			horizontal: document.documentElement.scrollWidth - window.innerWidth,
			vertical: document.documentElement.scrollHeight - window.innerHeight,
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
			horizontal: document.documentElement.scrollWidth - window.innerWidth,
			vertical: document.documentElement.scrollHeight - window.innerHeight,
		})),
	).toEqual({ horizontal: 0, vertical: 0 });
	expect(
		await form
			.locator('[data-ui="calendar-placement"]')
			.evaluate((element) => element.scrollHeight - element.clientHeight),
	).toBeLessThanOrEqual(1);
	await expect(create).toBeInViewport();
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
	await expect(page.getByRole("textbox", { name: "Event title" })).toBeFocused();
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
	expect(clamped.x + clamped.width).toBeLessThanOrEqual(area.x + area.width + 1);
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
	expect(await calendarArea.evaluate((element) => element.scrollTop)).toBe(
		initialScrollTop,
	);

	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
});

test("previews a dragged all-day event across the days it would land on", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await mockAuthenticatedReads(page);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	// Family holiday runs Friday 17 to Wednesday 22, so a day forward lands it on
	// 18 to 23 and crosses the week edge on the way.
	const bar = page.getByRole("button", { name: /Family holiday/ }).first();
	await expect(bar).toBeVisible();
	const from = (await bar.boundingBox())!;
	const nextDay = page.locator('[data-day-key="2026-07-18"]');
	const to = (await nextDay.boundingBox())!;

	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
		steps: 10,
	});

	// Six days previewed, one block per cell — not a single chip under the pointer
	// that would read as the event shrinking to a day.
	await expect(page.locator("[data-drag-preview]")).toHaveCount(6);
	for (const day of [18, 19, 20, 21, 22, 23]) {
		await expect(
			page.locator(`[data-day-key="2026-07-${day}"] [data-drag-preview]`),
		).toHaveCount(1);
	}
	await expect(
		page.locator('[data-day-key="2026-07-17"] [data-drag-preview]'),
	).toHaveCount(0);

	// Its own colour and its own shape: the family calendar's blue, titled where
	// the range starts and blank where it is continuing.
	await expect(nextDay.locator("[data-drag-preview]")).toContainText(
		"Family holiday",
	);
	await expect(
		page.locator('[data-day-key="2026-07-19"] [data-drag-preview]'),
	).toHaveText("");
	expect(
		await nextDay
			.locator("[data-drag-preview]")
			.evaluate((element) => getComputedStyle(element).backgroundColor),
	).toBe("rgb(54, 90, 146)");

	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
});

test("moves a bar grabbed by its middle to where the preview drew it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
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

	// Family holiday runs 17 to 22. Grab it on the 19th and drop on the 21st:
	// two days, so it lands on 19 to 24 — the drop day does not become the start.
	const middle = page
		.locator('[data-day-key="2026-07-19"]')
		.getByRole("button", { name: /Family holiday/ });
	await expect(middle).toBeVisible();
	const from = (await middle.boundingBox())!;
	const target = page.locator('[data-day-key="2026-07-21"]');
	const to = (await target.boundingBox())!;

	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
		steps: 10,
	});

	await expect(page.locator("[data-drag-preview]")).toHaveCount(6);
	await expect(
		page.locator('[data-day-key="2026-07-19"] [data-drag-preview]'),
	).toHaveCount(1);
	await expect(
		page.locator('[data-day-key="2026-07-24"] [data-drag-preview]'),
	).toHaveCount(1);
	await expect(
		page.locator('[data-day-key="2026-07-18"] [data-drag-preview]'),
	).toHaveCount(0);

	await page.mouse.up();

	// What was previewed is what was written: no jump on release.
	await expect(page.locator('[class*="toastRegion"]')).toContainText(
		"Event moved.",
	);
	expect(writes).toHaveLength(1);
	expect(writes[0]!.start).toContain("2026-07-19");
	expect(writes[0]!.end).toContain("2026-07-24");
});

test("steps a whole week aside for a dragged bar and leaves its ghost in line", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await mockAuthenticatedReads(page);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	const bar = page.getByRole("button", { name: /Family holiday/ }).first();
	await expect(bar).toBeVisible();
	const from = (await bar.boundingBox())!;
	const nextDay = page.locator('[data-day-key="2026-07-18"]');
	const to = (await nextDay.boundingBox())!;

	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
		steps: 10,
	});

	// The bar it left behind keeps the line the preview carries on, so the two
	// read as one thing rather than a step.
	const ghost = page.locator('[data-day-key="2026-07-17"] [data-ghost]');
	await expect(ghost).toHaveCount(1);
	const ghostBox = (await ghost.boundingBox())!;
	const previewBox = (await nextDay
		.locator("[data-drag-preview]")
		.boundingBox())!;
	expect(Math.abs(ghostBox.y - previewBox.y)).toBeLessThanOrEqual(1);

	// The week below is covered from Monday to Thursday only, yet every cell in it
	// steps aside by the same line — otherwise a chip a day past the range would
	// sit higher than its neighbours.
	const covered = (await page
		.locator('[data-day-key="2026-07-20"]')
		.getByRole("button", { name: /Weekly review/ })
		.boundingBox())!;
	const beyond = (await page
		.locator('[data-day-key="2026-07-24"]')
		.getByRole("button", { name: /Client presentation/ })
		.boundingBox())!;
	expect(Math.abs(covered.y - beyond.y)).toBeLessThanOrEqual(1);

	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
	await expect(page.locator("[data-ghost]")).toHaveCount(0);
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
	await page
		.getByRole("button", { name: /Weekly review/ })
		.first()
		.click();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await page.getByRole("textbox", { name: "Event title" }).fill("Weekly retro");
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
	const recurrence =
		"RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20261231T225959Z\nEXDATE:20260803T090000Z\nRDATE:20260804T090000Z";
	await mockAuthenticatedReads(page, {
		...events,
		events: events.events.map((item) =>
			item.id === "weekly-review" ? { ...item, recurrence } : item,
		),
	});
	const writes: Array<Record<string, unknown>> = [];
	await page.route("**/api/v1/events", async (route) => {
		if (route.request().method() === "PUT") {
			writes.push(route.request().postDataJSON() as Record<string, unknown>);
		}
		return route.fallback();
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page
		.getByRole("button", { name: /Weekly review/ })
		.first()
		.click();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await page.getByRole("textbox", { name: "Event title" }).fill("Weekly retro");
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
	expect(writes[0]!.recurrence).toBe(recurrence);
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
	await page
		.getByRole("button", { name: /Weekly review/ })
		.first()
		.click();
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
	await scope
		.getByRole("button", { name: "Close change recurring event dialog" })
		.click();
	await expect(scope).toHaveCount(0);
	await expect(page.getByRole("dialog", { name: "Edit series" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Save" })).toBeFocused();
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
	await page.route(/\/api\/v1\/events(?:\?.*)?$/, (route) => {
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
			await page.evaluate(() =>
				window.localStorage.getItem("musubi:last-session"),
			),
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
	const offlineState = page.getByText(/Offline — saved (.+ago|just now)/);
	await expect(offlineState).toBeVisible();

	await page
		.getByRole("button", { name: /Client call/ })
		.first()
		.click();
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
	await expect(offlineState).toHaveCount(0, { timeout: 10_000 });
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
	browserName,
}) => {
	test.skip(
		browserName === "firefox",
		"Playwright Firefox does not reliably dispatch finite mocked SSE responses.",
	);
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

	await first
		.getByRole("button", { name: /Client call/ })
		.first()
		.click();
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
	await expect(second.getByRole("button", { name: /Client call/ })).toHaveCount(
		0,
	);

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
	await page
		.getByRole("textbox", { name: "Email" })
		.fill("unconfirmed@example.com");
	await page.getByLabel("Passphrase").fill("supersecret123");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();

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
			user: {
				email: "new@example.com",
				emailVerified: false,
				id: "u1",
				name: "New Person",
			},
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
		return respond(route, {
			redirect: false,
			url: "https://accounts.example.com/oauth",
		});
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
	await expect
		.poll(() => social)
		.toEqual(
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
	await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(
		0,
	);
	await expect(page.getByText("or", { exact: true })).toHaveCount(0);
	await expect(
		page.getByRole("button", { exact: true, name: "Continue" }),
	).toBeVisible();
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
		return respond(route, {
			redirect: false,
			url: "https://appleid.apple.com/auth/authorize",
		});
	});

	await page.goto("/login");
	await page.waitForLoadState("networkidle");

	await page.getByRole("button", { name: "Continue with Apple" }).click();
	await expect
		.poll(() => social)
		.toEqual(expect.objectContaining({ provider: "apple" }));
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
	await expect(
		dialog.getByRole("button", { name: /Disconnect qa@gmail.com/ }),
	).toBeVisible();
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
	await expect(page.getByRole("dialog", { name: "Connections" })).toContainText(
		"could not be fetched",
	);
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
		joined = {
			body: route.request().postDataJSON(),
			url: route.request().url(),
		};
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

test("moves an account to a new address, asking the old one to approve", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	let changeBody: unknown;
	await page.route("**/api/auth/change-email", (route) => {
		changeBody = route.request().postDataJSON();
		return respond(route, { status: true });
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.getByRole("button", { name: "Manage account" }).click();
	const accountDialog = page.getByRole("dialog", { name: "Account" });
	await accountDialog.getByRole("button", { name: /^Email/ }).click();

	const editor = page.getByRole("dialog", { name: "Change email" });
	await expect(editor).toContainText("Currently web-qa@example.invalid");
	// The same address is not a change, and neither is half of one.
	await editor
		.getByRole("textbox", { name: "New email" })
		.fill("web-qa@example.invalid");
	await expect(
		editor.getByRole("button", { name: "Send the link" }),
	).toBeDisabled();
	await editor.getByRole("textbox", { name: "New email" }).fill("moved@");
	await expect(
		editor.getByRole("button", { name: "Send the link" }),
	).toBeDisabled();

	await editor
		.getByRole("textbox", { name: "New email" })
		.fill("Moved@Example.invalid");
	await editor.getByRole("button", { name: "Send the link" }).click();

	// Lowercased before it leaves, so the address the server stores matches the
	// one the person will type at the login screen.
	expect(changeBody).toMatchObject({ newEmail: "moved@example.invalid" });
	// Which inbox to look in is the whole answer here — and for a verified
	// account it is the OLD one, so a stolen session cannot move the account
	// somewhere the owner can't reach.
	await expect(page.getByRole("status")).toContainText("web-qa@example.invalid");
});

function multiWeekPage(weeks: number) {
	return {
		...defaultPage,
		config: {
			...defaultPage.config,
			view: { configVersion: 1, id: "multi-week", weeks },
		},
	};
}

test("keeps multi-week out of the switcher while it is still a concept", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	// Reachable by URL and by Page config, but not offered: the view works and
	// its tests run, it is simply not in front of people yet.
	const switcher = page.getByRole("radiogroup", { name: "Calendar view" });
	await expect(switcher.getByRole("radio", { name: "Month" })).toBeVisible();
	await expect(switcher.getByRole("radio", { name: "Weeks" })).toHaveCount(0);

	// The shortcut overlay lists the same set, so it must not advertise it either.
	await page.keyboard.press("?");
	const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
	await expect(shortcuts).toContainText("Month");
	await expect(shortcuts.getByText("Weeks")).toHaveCount(0);
});

test("lays weeks out as a matrix and pages a screen at a time", async ({
	page,
}) => {
	await page.setViewportSize({ height: 900, width: 1440 });
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/pages", (route) =>
		respond(route, [multiWeekPage(8)]),
	);

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/multi-week?date=2026-07-26`);

	// Eight separate week calendars, not eight rows of one grid — the whole point
	// is comparing weeks side by side.
	const blocks = page.getByRole("region", { name: /^Week of/ });
	await expect(blocks).toHaveCount(8);
	await expect(page.getByText("Jul 20 – Sep 13")).toBeVisible();

	// A matrix: on a wide screen the first blocks share a row.
	const first = (await blocks.nth(0).boundingBox())!;
	const second = (await blocks.nth(1).boundingBox())!;
	expect(second.x).toBeGreaterThan(first.x);
	expect(Math.abs(second.y - first.y)).toBeLessThan(4);

	// A page is a screen, not a week: eight weeks forward lands on the next span.
	await page.getByRole("main").getByRole("button", { name: "Next" }).click();
	await expect(page).toHaveURL(/date=2026-09-20/);
	await expect(page.getByText("Sep 14 – Nov 8")).toBeVisible();

	await expectNoAccessibilityViolations(page);
});

test("stacks the matrix into one column when it cannot fit", async ({
	page,
}) => {
	await page.setViewportSize({ height: 720, width: 430 });
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/pages", (route) =>
		respond(route, [multiWeekPage(4)]),
	);

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/multi-week?date=2026-07-26`);

	const blocks = page.getByRole("region", { name: /^Week of/ });
	await expect(blocks).toHaveCount(4);
	// Seven day columns need room; on a phone that means one week per row rather
	// than four unreadable slivers.
	const first = (await blocks.nth(0).boundingBox())!;
	const second = (await blocks.nth(1).boundingBox())!;
	expect(second.y).toBeGreaterThan(first.y);
	expect(Math.abs(second.x - first.x)).toBeLessThan(4);
});

test("opens the same event popover from a week block", async ({ page }) => {
	await page.setViewportSize({ height: 900, width: 1440 });
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/pages", (route) =>
		respond(route, [multiWeekPage(4)]),
	);

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/multi-week?date=2026-07-26`);
	await page
		.getByRole("button", { name: /Weekly review/ })
		.first()
		.click();

	// The block is a reader, but the event behind it is the same event — the
	// popover, and everything it can do, comes from the one implementation.
	const popover = page.getByRole("dialog").filter({ hasText: "Weekly review" });
	await expect(
		popover.getByRole("heading", { name: "Weekly review" }),
	).toBeVisible();
	await expect(
		popover.getByRole("button", { exact: true, name: "Edit" }),
	).toBeVisible();
});

const SHARE_TOKEN = "c89f06867c4b99bddc0fe7fd83244b11";

function publicEvent(overrides: Record<string, unknown> = {}) {
	return {
		content: {
			agenda: [],
			cover: { focalX: 50, focalY: 50, source: "preset" },
			tags: [],
		},
		coverUrl: null,
		description: "Come see the presses.",
		end: "2026-08-20T16:00:00.000Z",
		indexable: false,
		isAllDay: false,
		isCanceled: false,
		location: "Brno",
		mapImageUrl: null,
		organizer: {
			avatarUrl: "http://127.0.0.1:3000/api/v1/users/organizer/avatar",
			name: "Mika",
		},
		recurrence: null,
		start: "2026-08-20T13:00:00.000Z",
		theme: { cover: "none", font: "serif", layout: "classic", palette: "sand" },
		title: "Studio open day",
		url: null,
		...overrides,
	};
}

test("publishes an event as a page and can take it back", async ({ page }) => {
	await mockAuthenticatedReads(page);
	let share: { indexable: boolean; mode: string } | null = null;
	await page.route("**/api/v1/events/*/share", (route) => {
		const method = route.request().method();
		if (method === "PUT") {
			share = route.request().postDataJSON() as typeof share;
			return respond(route, {
				...share,
				coverUrl: null,
				token: SHARE_TOKEN,
				url: `http://127.0.0.1:3000/e/${SHARE_TOKEN}`,
			});
		}
		if (method === "DELETE") {
			share = null;
			return route.fulfill({ body: "", status: 204 });
		}
		return respond(
			route,
			share
				? {
						...share,
						coverUrl: null,
						token: SHARE_TOKEN,
						url: `http://127.0.0.1:3000/e/${SHARE_TOKEN}`,
					}
				: null,
		);
	});

	// Somebody has already answered, and the organizer must be able to read that
	// whatever the page is set to show its readers.
	await page.route("**/api/v1/events/*/rsvps", (route) =>
		respond(route, {
			counts: { declined: 1, going: 2, maybe: 0 },
			declined: ["Cyril"],
			going: ["Adam", "Zoe"],
			maybe: [],
		}),
	);

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page
		.getByRole("button", { name: /Client call/ })
		.first()
		.click();
	await page.getByRole("button", { name: "Share event" }).click();

	const dialog = page.getByRole("dialog", { name: "Share event" });
	await expect(dialog.getByLabel("Palette")).toHaveCount(0);
	await expect(dialog.getByLabel("Typography")).toHaveCount(0);
	// Private until somebody says otherwise — an event is not published by
	// existing, and the dialog has to open on that truth.
	await expect(dialog.getByRole("radio", { name: /Private/ })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await expect(dialog.getByRole("textbox", { name: "Public link" })).toHaveCount(
		0,
	);

	await dialog.getByRole("radio", { name: "Anyone with the link" }).click();
	await expect(dialog.getByRole("textbox", { name: "Public link" })).toHaveValue(
		new RegExp(SHARE_TOKEN),
	);
	expect(share).toMatchObject({
		attendeeVisibility: "counts",
		indexable: false,
		mode: "link",
	});

	await dialog.getByLabel("Tags").fill("Workshop, Community");
	await dialog.getByRole("button", { name: "Add item" }).click();
	await dialog.getByLabel("Title").fill("Doors open");
	await dialog.getByRole("button", { name: "Save page" }).click();
	await expect(page.getByRole("status")).toContainText("Event page updated");
	expect(share).toMatchObject({
		content: {
			agenda: [expect.objectContaining({ time: "18:00", title: "Doors open" })],
			tags: ["Workshop", "Community"],
		},
	});
	// The link mode's promise is that it stays out of search, so it must not even
	// offer the indexing choice.
	await expect(
		dialog.getByRole("checkbox", { name: /search engines/ }),
	).toHaveCount(0);

	await dialog.getByRole("radio", { name: "Show names" }).click();
	await dialog.getByRole("radio", { name: "Public" }).click();
	// Clicking the label, not the input: the visible box sits over the 1px input,
	// which is exactly how a person toggles it too.
	await dialog.getByText("Allow search engines to list this page").click();
	await expect(
		dialog.getByRole("checkbox", { name: /search engines/ }),
	).toBeChecked();
	expect(share).toMatchObject({
		attendeeVisibility: "names",
		indexable: true,
		mode: "public",
	});

	await expectNoAccessibilityViolations(page);

	await dialog.getByRole("radio", { name: "Show nothing" }).click();
	expect(share).toMatchObject({ attendeeVisibility: "hidden" });

	await dialog.getByRole("radio", { name: /Private/ }).click();
	await expect(page.getByRole("status")).toContainText("no longer opens");
	await expect(dialog.getByRole("textbox", { name: "Public link" })).toHaveCount(
		0,
	);
});

test("shows a published event to someone with no account", async ({ page }) => {
	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}`, (route) =>
		respond(
			route,
			publicEvent({
				description:
					"Details at https://events.example.com/studio/open-day/very-long-path",
				url: "https://example.com/studio-open-day",
			}),
		),
	);

	await page.goto(`/e/${SHARE_TOKEN}`);

	await expect(
		page.getByRole("heading", { name: "Studio open day" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Organized by" }),
	).toBeVisible();
	await expect(page.getByText("Mika", { exact: true })).toBeVisible();
	const hero = page.locator("header");
	await expect(hero.getByText("Brno")).toBeVisible();
	await expect(hero.getByRole("link", { name: "Event link" })).toBeVisible();
	const noteLink = page.getByRole("link", {
		name: "Open https://events.example.com/studio/open-day/very-long-path",
	});
	await expect(noteLink).toHaveText("events.example.com");
	const sidebar = page.locator("aside");
	await expect(
		sidebar.getByRole("heading", { name: "Keep the date" }),
	).toBeVisible();
	await expect(sidebar.getByRole("button", { name: "Share" })).toBeVisible();
	// The reader's timezone, spelled out: the organizer is often somewhere else,
	// and a bare "3 pm" is a trap.
	await expect(page.getByText("Europe/Prague")).toBeVisible();
	await expect(page.getByText(/15:00–18:00|3:00/)).toBeVisible();

	// No app around it, and nothing that needs a session.
	await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Add to calendar" }),
	).toBeVisible();

	// Not indexable: the page must say so itself, because the markup is identical
	// to a public one.
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		"content",
		"noindex, nofollow",
	);

	await expectNoAccessibilityViolations(page);
});

test("uses the reader's shared theme instead of organizer styling", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.addInitScript(() => localStorage.setItem("musubi-theme", "light"));
	await page.route("**/api/auth/get-session", (route) =>
		respond(route, {
			session: { id: "s1" },
			user: { email: "reader@example.com", id: "reader-1", name: "Reader" },
		}),
	);
	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}`, (route) =>
		respond(
			route,
			publicEvent({
				content: {
					agenda: [],
					cover: { focalX: 50, focalY: 50, source: "upload" },
					tags: [],
				},
				coverUrl: "https://example.com/cover.jpg",
				description: "Presses running.",
				theme: { cover: "grid", font: "sans", layout: "poster", palette: "ink" },
			}),
		),
	);

	await page.goto(`/e/${SHARE_TOKEN}`);
	const main = page.getByRole("main");
	await expect(main).not.toHaveAttribute("data-font");
	await expect(main).not.toHaveAttribute("data-layout");
	const hero = page.locator("header[data-cover='grid']");
	await expect(hero).toBeVisible();
	const brand = hero.locator('svg[aria-label="Musubi"]').locator("..");
	const date = hero.locator("time");
	const toggle = hero
		.getByRole("button", { name: /Use dark theme/ })
		.locator("..");
	const [heroBox, brandBox, dateBox, toggleBox] = await Promise.all([
		hero.boundingBox(),
		brand.boundingBox(),
		date.boundingBox(),
		toggle.boundingBox(),
	]);
	expect(Math.abs(dateBox!.x - brandBox!.x)).toBeLessThanOrEqual(1);
	expect(
		Math.abs(
			brandBox!.y + brandBox!.height / 2 - (toggleBox!.y + toggleBox!.height / 2),
		),
	).toBeLessThanOrEqual(1);
	expect(
		Math.abs(
			brandBox!.x -
				heroBox!.x -
				(heroBox!.x + heroBox!.width - toggleBox!.x - toggleBox!.width),
		),
	).toBeLessThanOrEqual(1);
	expect(
		await date.locator("strong").evaluate((node) => getComputedStyle(node).color),
	).toBe("rgb(28, 27, 24)");
	expect(
		await brand
			.locator("path")
			.first()
			.evaluate((node) => getComputedStyle(node).fill),
	).toBe("rgb(28, 27, 24)");

	const going = page.getByRole("button", { name: "Going" });
	const idleBackground = await going.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await going.hover();
	await going.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished)),
	);
	expect(
		await going.evaluate((element) => getComputedStyle(element).backgroundColor),
	).not.toBe(idleBackground);
	await page.getByRole("button", { name: /Use dark theme/ }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	expect(await page.evaluate(() => localStorage.getItem("musubi-theme"))).toBe(
		"light",
	);

	await going.click();
	await expect(going).toHaveAttribute("aria-pressed", "true");

	await expectNoAccessibilityViolations(page);
});

test("says a withdrawn page is gone rather than showing an empty shell", async ({
	page,
}) => {
	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}`, (route) =>
		route.fulfill({
			body: JSON.stringify({ error: "NotFound", message: "gone" }),
			contentType: "application/json",
			status: 404,
		}),
	);

	await page.goto(`/e/${SHARE_TOKEN}`);

	await expect(
		page.getByRole("heading", { name: "This page is not available." }),
	).toBeVisible();
});

test("hides RSVP controls from an organizer", async ({ page }) => {
	await page.route("**/api/auth/get-session", (route) =>
		respond(route, {
			session: { id: "s1" },
			user: { email: "organizer@example.com", id: "organizer-1", name: "Mika" },
		}),
	);
	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}`, (route) =>
		respond(route, publicEvent()),
	);
	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}/rsvp`, (route) =>
		respond(route, {
			attendees: [],
			counts: { declined: 0, going: 1, maybe: 0 },
			isOrganizer: true,
			mine: null,
			names: [],
			visibility: "counts",
		}),
	);

	await page.goto(`/e/${SHARE_TOKEN}`);
	await expect(
		page.getByRole("heading", { name: "Are you coming?" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Add to calendar" }),
	).toBeVisible();
});

test("lets a stranger answer after confirming their address", async ({
	page,
}) => {
	let rsvp: unknown;
	let signedIn = false;
	let name = "";
	await page.route("**/api/auth/get-session", (route) =>
		respond(
			route,
			signedIn
				? {
						session: { id: "s1" },
						user: { email: "guest@example.com", id: "guest-1", name },
					}
				: null,
		),
	);
	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}`, (route) =>
		respond(route, publicEvent({ description: null, location: null })),
	);
	let codeRequest: unknown;
	await page.route("**/api/auth/email-otp/send-verification-otp", (route) => {
		codeRequest = route.request().postDataJSON();
		return respond(route, { success: true });
	});
	await page.route("**/api/auth/sign-in/email-otp", (route) => {
		signedIn = true;
		return respond(route, {
			token: "session",
			user: { id: "guest-1", name: "" },
		});
	});
	await page.route("**/api/auth/update-user", (route) => {
		name = route.request().postDataJSON().name;
		return respond(route, { user: { id: "guest-1", name } });
	});
	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}/rsvp`, (route) => {
		const answered = route.request().method() === "PUT";
		if (answered) rsvp = route.request().postDataJSON();
		return respond(route, {
			attendees: [],
			counts: { declined: 0, going: answered ? 1 : 0, maybe: 0 },
			mine: answered ? "going" : null,
			names: [],
			visibility: "counts",
		});
	});

	await page.goto(`/e/${SHARE_TOKEN}`);
	await page.waitForLoadState("networkidle");

	// Choose an answer first; identity opens only for that answer.
	await expect(page.getByRole("button", { name: "Going" })).toBeVisible();
	await expect(page.getByLabel("Email")).toHaveCount(0);
	await page.getByRole("button", { name: "Going" }).click();
	await expect(
		page.getByText(/creates a Musubi account with no password/),
	).toBeVisible();
	await page.getByLabel("Email").fill("guest@example.com");
	await page.getByRole("button", { name: "Send me a code" }).click();
	expect(codeRequest).toMatchObject({
		email: "guest@example.com",
		type: "sign-in",
	});

	// Nothing is recorded until the address is confirmed — no half-answered row
	// exists to be cleaned up, and a count is always a count of real people.
	expect(rsvp).toBeUndefined();

	await page.getByLabel("Code from your email").fill("123456");
	await page.getByRole("button", { name: "Confirm" }).click();
	await page.getByLabel("Your name").fill("Jana K.");
	await page.getByRole("button", { name: "Continue" }).click();

	await expect(page.getByText("You’re on the list.")).toBeVisible();
	expect(rsvp).toEqual({ name: "Jana K.", status: "going" });
	await expect(page.getByText("1 going")).toBeVisible();
});

test("opens a day-view preview on screen, not over the sidebar", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-23`);

	await page
		.getByRole("button", { name: /Project check-in/ })
		.first()
		.click();
	const preview = page.getByRole("dialog").first();
	await expect(preview).toBeVisible();

	// A day column is as wide as the grid, so there is no room to the right of a
	// block: the preview used to flip left, across the sidebar and off the screen.
	const box = (await preview.boundingBox())!;
	const width = page.viewportSize()!.width;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(width);
});

test("a press that dismisses a preview does not also start a draft", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/day?date=2026-07-23`);

	await page
		.getByRole("button", { name: /Project check-in/ })
		.first()
		.click();
	await expect(page.getByRole("dialog").first()).toBeVisible();

	// Press on empty grid, far below the events: that press is dismissing the
	// preview, and it used to leave a draft flashing up behind it.
	// Empty grid, well clear of the morning events. The column is taller than the
	// viewport, so the point comes from the viewport rather than from its box.
	const column = page.locator("[data-time-grid-column]").first();
	const bounds = (await column.boundingBox())!;
	const x = bounds.x + bounds.width / 2;
	const y = page.viewportSize()!.height - 120;
	await page.mouse.click(x, y);

	// Nothing is open at all: no preview, and no composer for a draft nobody asked
	// for — that draft flashing up behind the preview was the bug.
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// The same press with nothing open does open the composer, so the guard is
	// about dismissal and not about the gesture.
	await page.mouse.click(x, y);
	await expect(page.getByRole("dialog", { name: "Create event" })).toBeVisible();

	// The month grid creates from a click on a cell, so it had the same hole.
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page
		.getByRole("button", { name: /Project check-in/ })
		.first()
		.click();
	await expect(page.getByRole("dialog").first()).toBeVisible();
	const cell = page
		.getByRole("grid")
		.first()
		.getByRole("gridcell", { name: /July 17, 2026/ });
	const cellBox = (await cell.boundingBox())!;
	// Dragging out a range, which is the month grid's create gesture: the press
	// that dismisses a preview must not begin one.
	await page.mouse.move(cellBox.x + 20, cellBox.y + cellBox.height - 12);
	await page.mouse.down();
	await page.mouse.move(
		cellBox.x + cellBox.width * 2,
		cellBox.y + cellBox.height - 12,
		{
			steps: 6,
		},
	);
	await page.mouse.up();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a press that closes a dialog does not also create an event", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/events/*/share", (route) => respond(route, null));
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	await page
		.getByRole("button", { name: /Client call/ })
		.first()
		.click();
	await page.getByRole("button", { name: "Share event" }).click();
	const shareDialog = page.getByRole("dialog", { name: "Share event" });
	await expect(shareDialog).toBeVisible();

	// Dismissing the wide share dialog must not create an event underneath.
	const box = (await shareDialog.boundingBox())!;
	await page.mouse.click(Math.max(10, box.x - 60), box.y + 40);
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("stays inside its box with twenty calendars", async ({ page }) => {
	await mockAuthenticatedReads(page, events, manyCalendars);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	/** Nothing may push the page sideways, whatever is open. */
	async function expectNoSidewaysScroll(what: string) {
		const overflow = await page.evaluate(() => ({
			body: document.body.scrollWidth - document.body.clientWidth,
			root:
				document.documentElement.scrollWidth - document.documentElement.clientWidth,
		}));
		expect(overflow, what).toEqual({ body: 0, root: 0 });
	}

	await expect(page.getByRole("grid").first()).toBeVisible();
	await expectNoSidewaysScroll("month grid");

	// Page filters hold every calendar without introducing page-level overflow.
	const { dialog: pageSettings, filters: pageFilters } =
		await openPageFilters(page);
	await expect(pageFilters.getByRole("button")).toHaveCount(
		manyCalendars.length,
	);
	await expectNoSidewaysScroll("Page filters");
	await expectNoAccessibilityViolations(page);
	await pageSettings
		.getByRole("button", { name: "Close page settings" })
		.click();

	// The manage dialog holds the same twenty rows and scrolls its own body.
	await page.getByRole("button", { name: "Calendars" }).click();
	const dialog = page.getByRole("dialog", { name: "Calendars" });
	await expect(dialog).toBeVisible();
	const dialogBox = (await dialog.boundingBox())!;
	expect(dialogBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await expectNoSidewaysScroll("calendars dialog");
	const calendarAccessibility = await new AxeBuilder({ page })
		.include('[role="dialog"]')
		.analyze();
	expect(calendarAccessibility.violations).toEqual([]);
	await page.keyboard.press("Escape");

	// And the composer, which lists every writable calendar.
	await page.getByRole("button", { name: "Event", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Create event" })).toBeVisible();
	await expectNoSidewaysScroll("quick create");
});

/**
 * Every page and every modal, written out as PNGs for design review.
 *
 * Skipped unless a target directory is given, because it is not a test — it
 * asserts nothing. It reuses the mocks above so the shots contain the same
 * calendar the suite exercises rather than an empty one.
 *
 *   UI_SHOTS=ui-catalog pnpm exec playwright test -g "ui catalogue"
 *   UI_SHOTS=ui-catalog UI_SHOTS_THEME=dark pnpm exec playwright test -g "ui catalogue"
 */
const UI_SHOTS = process.env.UI_SHOTS;
const UI_SHOTS_THEME = process.env.UI_SHOTS_THEME === "dark" ? "dark" : "light";

test("ui catalogue", async ({ browser, page }) => {
	test.skip(!UI_SHOTS, "Set UI_SHOTS=<directory> to write the catalogue.");
	test.setTimeout(600_000);

	await page.setViewportSize({ height: 900, width: 1440 });

	let index = 0;
	// Reported alongside each shot: on a laptop the page itself should not scroll.
	const overflow: string[] = [];
	const shot = async (name: string, target?: Locator, on: Page = page) => {
		index += 1;
		const file = `${UI_SHOTS}/${UI_SHOTS_THEME}/${String(index).padStart(2, "0")}-${name}.png`;
		// Let motion settle: every layer here fades and lifts on open.
		await on.waitForTimeout(350);
		await (target ?? on).screenshot({
			path: file,
			...(target ? {} : { fullPage: true }),
		});
		const size = await on.evaluate(() => ({
			client: window.document.documentElement.clientHeight,
			scroll: window.document.documentElement.scrollHeight,
		}));
		if (size.scroll > size.client + 2) {
			overflow.push(`${name}: ${size.scroll}px in ${size.client}px`);
		}
	};
	// The theme is a stored preference, so it has to be there before first paint.
	await page.addInitScript(
		(theme) => window.localStorage.setItem("musubi-theme", theme),
		UI_SHOTS_THEME,
	);

	// ── Public pages, nobody signed in ────────────────────────────────────────
	await page.route("**/api/auth/get-session", (route) => respond(route, null));
	await page.route("**/api/v1/server", (route) =>
		respond(route, { syncProviders: ["google", "microsoft", "caldav"] }),
	);
	await page.clock.setFixedTime(new Date("2026-08-03T10:00:00"));

	await page.goto("/login");
	await page.waitForLoadState("networkidle");
	await shot("login");

	await page.goto("/find-a-time");
	await page.waitForLoadState("networkidle");
	await shot("public-find-a-time");
	await page.getByLabel("Email").fill("z@example.com");
	await shot("public-find-a-time-ready");

	await page.goto("/new-event");
	await page.waitForLoadState("networkidle");
	await shot("public-new-event");

	await page.route(`**/api/v1/calendars/tokens/${INVITE_TOKEN}`, (route) =>
		respond(route, invitePreview()),
	);
	await page.goto(`/invite/${INVITE_TOKEN}`);
	await page.waitForLoadState("networkidle");
	await shot("public-invite");

	await page.route(`**/api/v1/public/events/${SHARE_TOKEN}`, (route) =>
		respond(
			route,
			publicEvent({
				content: {
					agenda: [
						{
							description: "Coffee and introductions",
							id: "doors",
							time: "18:00",
							title: "Doors open",
						},
						{
							description: "A tour of the presses",
							id: "tour",
							time: "19:00",
							title: "Studio tour",
						},
					],
					cover: { focalX: 50, focalY: 50, source: "preset" },
					tags: ["Studio", "Community"],
				},
				description: "Doors at six. Presses running all evening.",
				location: "Studio, Brno",
				organizer: {
					avatarUrl: "http://127.0.0.1:3000/api/v1/users/mika/avatar",
					name: "Mika Novotná",
				},
				theme: { cover: "wash", font: "serif", layout: "classic", palette: "sand" },
			}),
		),
	);
	await page.goto(`/e/${SHARE_TOKEN}`);
	await page.waitForLoadState("networkidle");
	await shot("public-event-page");

	const pollSlots: MockPollSlot[] = [];
	for (const day of [10, 11, 12]) {
		for (const hour of [13, 17]) {
			pollSlots.push({
				end: `2026-08-${day}T${hour + 1}:00:00.000Z`,
				id: `s${day}-${hour}`,
				ifNeeded: hour === 17 ? ["Adam"] : [],
				no: day === 12 ? ["Mika Novotná"] : [],
				start: `2026-08-${day}T${hour}:00:00.000Z`,
				yes: day === 10 ? ["Mika Novotná", "Adam"] : [],
			});
		}
	}
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, {
			chosenSlotID: null,
			closed: false,
			description: "Which afternoon suits the studio session?",
			durationMinutes: 60,
			mine: {},
			mineID: null,
			people: [
				{
					answers: { "s10-13": "yes", "s10-17": "if-needed", "s12-13": "no" },
					id: "1",
					name: "Mika Novotná",
				},
				{
					answers: { "s10-13": "yes", "s11-17": "if-needed" },
					id: "2",
					name: "Adam",
				},
			],
			respondents: 2,
			slots: pollSlots,
			title: "Studio planning",
		}),
	);
	await page.goto(`/s/${POLL_TOKEN}`);
	await page.waitForLoadState("networkidle");
	await shot("public-poll-grid");
	await page.getByRole("button", { name: /11 Aug, 15:00/ }).click();
	await shot("public-poll-answer-menu", page.getByRole("dialog").first());

	await page.goto("/s/deadbeefdeadbeefdeadbeefdeadbeef");
	await page.waitForLoadState("networkidle");
	await shot("public-poll-missing");

	// ── The app ───────────────────────────────────────────────────────────────
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/scheduling/polls", (route) =>
		respond(route, [
			{
				chosenSlotID: null,
				closed: false,
				closedAt: null,
				createdAt: "2026-07-26T09:00:00.000Z",
				deadline: "2026-08-08T21:59:59.000Z",
				durationMinutes: 60,
				id: "poll-1",
				title: "Studio planning",
				token: POLL_TOKEN,
				url: `http://127.0.0.1:3000/s/${POLL_TOKEN}`,
			},
		]),
	);

	// A date the fixtures have events on, so every view has something in it.
	for (const view of ["month", "week", "day", "agenda"]) {
		await page.goto(`/app/p/${DEFAULT_PAGE_ID}/${view}?date=2026-07-23`);
		await page.waitForLoadState("networkidle");
		await expect(
			page.getByRole("button", { name: /Project check-in/ }).first(),
		).toBeVisible();
		await shot(`app-${view}`);
	}

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page.waitForLoadState("networkidle");

	// The event preview, and the composer a press on empty grid opens.
	await page
		.getByRole("button", { name: /Project check-in/ })
		.first()
		.click();
	await shot("app-event-preview", page.getByRole("dialog").first());
	await page.keyboard.press("Escape");

	// Every layer, by the control that opens it. One that cannot be found is
	// reported and skipped rather than ending the run: this is a catalogue, and a
	// missing shot is better than nineteen missing ones.
	const missed: string[] = [];
	const layer = async (name: string, trigger: string) => {
		try {
			await page
				.getByRole("button", { exact: true, name: trigger })
				.first()
				.click({ timeout: 5_000 });
			const dialog = page.getByRole("dialog").first();
			await dialog.waitFor({ state: "visible", timeout: 5_000 });
			await shot(`app-${name}`, dialog);
		} catch {
			missed.push(`${name} (${trigger})`);
		} finally {
			await page.keyboard.press("Escape");
			await page.waitForTimeout(250);
		}
	};

	await layer("quick-create", "Event");
	await layer("dialog-settings", "Settings");

	await layer("dialog-calendars", "Calendars");

	// Connections with nothing connected shows none of what the layer is for, so
	// this one shot runs in its own context: two linked accounts, and a server
	// that offers every provider. Isolated storage, because the app hydrates the
	// calendar list from its own cache and would otherwise keep the empty one.
	const linkedContext = await browser.newContext({
		locale: "en-GB",
		timezoneId: "Europe/Prague",
		viewport: { height: 900, width: 1440 },
	});
	const linkedPage = await linkedContext.newPage();
	await linkedPage.addInitScript(
		(theme) => window.localStorage.setItem("musubi-theme", theme),
		UI_SHOTS_THEME,
	);
	await mockAuthenticatedReads(linkedPage, events, [
		...calendars,
		{
			accountId: "account-google",
			accountLabel: "work@gmail.com",
			color: "#4285f4",
			creatorID: session.user.id,
			id: "google-work",
			members: [],
			name: "Work",
			provider: "google",
			role: "owner",
			syncStatus: "active",
		},
		{
			accountId: "account-icloud",
			accountLabel: "home@icloud.com",
			color: "#7a8ba3",
			creatorID: session.user.id,
			id: "icloud-home",
			members: [],
			name: "Home",
			provider: "caldav",
			role: "owner",
			syncStatus: "active",
		},
	]);
	await linkedPage.route("**/api/v1/server", (route) =>
		respond(route, {
			email: true,
			pushPublicKey: null,
			socials: [],
			socialsWeb: [],
			syncProviders: ["google", "microsoft", "caldav"],
		}),
	);
	await linkedPage.clock.setFixedTime(new Date("2026-08-03T10:00:00"));
	await linkedPage.goto(
		`${new URL(page.url()).origin}/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`,
	);
	await linkedPage.waitForLoadState("networkidle");
	await linkedPage
		.getByRole("button", { exact: true, name: "Connections" })
		.first()
		.click();
	const linkedDialog = linkedPage.getByRole("dialog").first();
	await linkedDialog.waitFor({ state: "visible", timeout: 5_000 });
	await shot("app-dialog-connections", linkedDialog, linkedPage);
	await linkedContext.close();
	await layer("dialog-scheduling", "Find a time");

	// The results of a poll, and the same poll once it is decided: both are the
	// grid, so the person deciding reads what the answerers filled in.
	for (const [name, chosen] of [
		["dialog-poll-results", null],
		["dialog-poll-decided", "s10-13"],
	] as const) {
		await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
			respond(route, {
				chosenSlotID: chosen,
				closed: Boolean(chosen),
				durationMinutes: 60,
				mine: {},
				mineID: null,
				people: [
					{
						answers: { "s10-13": "yes", "s10-17": "if-needed", "s11-13": "no" },
						id: "1",
						name: "Mika Novotná",
					},
					{
						answers: {
							"s10-13": "yes",
							"s11-13": "yes",
							"s11-17": "if-needed",
						},
						id: "2",
						name: "Adam",
					},
				],
				respondents: 2,
				slots: [
					["s10-13", "10", 13],
					["s10-17", "10", 17],
					["s11-13", "11", 13],
					["s11-17", "11", 17],
				].map(([id, day, hour]) => ({
					end: `2026-08-${day}T${Number(hour) + 1}:00:00.000Z`,
					id: String(id),
					ifNeeded:
						id === "s10-17" ? ["Mika Novotná"] : id === "s11-17" ? ["Adam"] : [],
					no: id === "s11-13" ? ["Mika Novotná"] : [],
					start: `2026-08-${day}T${hour}:00:00.000Z`,
					yes:
						id === "s10-13"
							? ["Adam", "Mika Novotná"]
							: id === "s11-13"
								? ["Adam"]
								: [],
				})),
				title: "Studio planning",
			}),
		);
		try {
			// A fresh document between the two: the poll query is cached for half a
			// minute, so the second state would otherwise be a screenshot of the first.
			await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
			await page.waitForLoadState("networkidle");
			await page
				.getByRole("button", { exact: true, name: "Find a time" })
				.first()
				.click({ timeout: 5_000 });
			await page
				.getByRole("button", { name: /Studio planning/ })
				.click({ timeout: 5_000 });
			const dialog = page.getByRole("dialog", { name: "Studio planning" });
			await dialog.waitFor({ state: "visible", timeout: 5_000 });
			await shot(`app-${name}`, dialog);
		} catch {
			missed.push(name);
		} finally {
			await page.keyboard.press("Escape");
			await page.waitForTimeout(250);
		}
	}
	await layer("dialog-account", "Manage account");
	await layer("dialog-new-page", "New page");
	// The page each sidebar row edits, which is a hover action rather than a row.
	await layer("dialog-page-settings", "Edit My calendar");

	await page.getByRole("button", { name: "Search events and actions" }).click();
	const searchDialog = page.getByRole("dialog", { name: "Search Musubi" });
	await searchDialog.getByRole("searchbox").fill("review");
	await shot("app-search", searchDialog);

	// Keyboard shortcuts. A fresh page, because the handler is on the window and
	// the key means something else inside a field.
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page.waitForLoadState("networkidle");
	await page.locator("body").press("?");
	const shortcuts = page.getByRole("dialog").first();
	if (await shortcuts.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await shot("app-dialog-shortcuts", shortcuts);
		await page.keyboard.press("Escape");
	} else {
		missed.push("shortcuts (?)");
	}

	// The full editor is a route, not a layer.
	await page.goto(
		`/app/p/${DEFAULT_PAGE_ID}/event/new?date=2026-07-26&view=month`,
	);
	await page.waitForLoadState("networkidle");
	await shot("app-event-editor");

	// Publishing an event, from the preview it belongs to. Back to the calendar
	// first: the full editor above is a route, and it left the grid behind.
	// The share state has to answer, or the dialog stays disabled and the shot is
	// of a loading state at half opacity rather than of the choice on offer.
	await page.route("**/api/v1/events/*/share", (route) =>
		route.request().method() === "GET" ? respond(route, null) : route.fallback(),
	);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page.waitForLoadState("networkidle");
	try {
		await page
			.getByRole("button", { name: /Client call/ })
			.first()
			.click({ timeout: 5_000 });
		await page
			.getByRole("button", { name: "Share event" })
			.click({ timeout: 5_000 });
		// Settled, not loading: without this the shot was of three disabled rows at
		// half opacity, because the share state had nothing to resolve against.
		await expect(page.getByRole("radio", { name: /Private/ })).toBeEnabled({
			timeout: 5_000,
		});
		const share = page.getByRole("dialog", { name: "Share event" });
		await share.waitFor({ state: "visible", timeout: 5_000 });
		await shot("app-dialog-share-event", share);
	} catch {
		missed.push("share-event");
	} finally {
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
	}

	// ── Layers reached from inside another layer ──────────────────────────────
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page.waitForLoadState("networkidle");
	// Both are reached through the Calendars dialog, and closing one of them closes
	// it too — so each gets its own trip in from the calendar.
	for (const [name, row, dialog] of [
		["app-dialog-share-calendar", /^Share /, /Share/],
		["app-confirm-delete-calendar", /^Delete /, /Delete/],
	] as const) {
		try {
			await page
				.getByRole("button", { exact: true, name: "Calendars" })
				.click({ timeout: 5_000 });
			await page
				.getByRole("button", { name: row })
				.first()
				.click({ timeout: 5_000 });
			const layer = page.getByRole("dialog", { name: dialog });
			await layer.waitFor({ state: "visible", timeout: 5_000 });
			await shot(name, layer);
		} catch {
			missed.push(name);
		} finally {
			await page.keyboard.press("Escape");
			await page.keyboard.press("Escape");
			await page.waitForTimeout(250);
		}
	}

	// ── Feedback: the question before a write, and the answer after one ────────
	// Editing one date of a series asks which events it means. It is the only
	// question this product asks mid-write, so it is worth looking at.
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.waitForLoadState("networkidle");
	try {
		await page
			.getByRole("button", { name: /Weekly review/ })
			.first()
			.click({ timeout: 5_000 });
		await page
			.getByRole("button", { exact: true, name: "Edit" })
			.click({ timeout: 5_000 });
		await page
			.getByRole("textbox", { name: "Event title" })
			.fill("Weekly retro", { timeout: 5_000 });
		await page.getByRole("button", { name: "Save" }).click({ timeout: 5_000 });
		const scope = page.getByRole("dialog", { name: "Change recurring event" });
		await scope.waitFor({ state: "visible", timeout: 5_000 });
		await shot("app-dialog-recurrence-scope", scope);
	} catch {
		missed.push("recurrence-scope");
	} finally {
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		await page.waitForTimeout(250);
	}

	// A delete and its undo offer, then the same delete refused by the server.
	// Both are the toast, which is the only thing in the product that speaks
	// after the fact, and neither had a shot in this catalogue before.
	const toast = page.locator('[class*="workspaceToast"]');
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page.waitForLoadState("networkidle");
	try {
		await page
			.getByRole("button", { name: /Client call/ })
			.first()
			.click({ timeout: 5_000 });
		await page
			.getByRole("button", { exact: true, name: "Delete" })
			.click({ timeout: 5_000 });
		await toast.waitFor({ state: "visible", timeout: 5_000 });
		await shot("app-toast-undo", toast);
	} catch {
		missed.push("toast-undo");
	}

	// A write the server refuses. It is reported inside the popover the delete was
	// started from rather than as a toast, so that is what gets photographed.
	const refuse = (route: Route) =>
		route.request().method() === "DELETE"
			? respond(route, { message: "Nope" }, 500)
			: route.fallback();
	await page.route("**/api/v1/events**", refuse);
	try {
		await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
		await page.waitForLoadState("networkidle");
		await page
			.getByRole("button", { name: /Project check-in/ })
			.first()
			.click({ timeout: 5_000 });
		const popover = page.getByRole("dialog").first();
		await page
			.getByRole("button", { exact: true, name: "Delete" })
			.click({ timeout: 5_000 });
		await popover
			.getByRole("alert")
			.waitFor({ state: "visible", timeout: 5_000 });
		await shot("app-event-write-refused", popover);
	} catch {
		missed.push("event-write-refused");
	} finally {
		await page.unroute("**/api/v1/events**", refuse);
		await page.keyboard.press("Escape");
	}

	// ── Nothing yet: the states a new account actually opens on ───────────────
	const nothing = (route: Route) =>
		route.request().method() === "GET"
			? respond(route, { events: [], instances: [] })
			: route.fallback();
	await page.route("**/api/v1/events**", nothing);
	await page.route("**/api/v1/scheduling/polls", (route) => respond(route, []));
	try {
		await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
		await page.waitForLoadState("networkidle");
		await shot("app-empty-month");
		await page.goto(`/app/p/${DEFAULT_PAGE_ID}/schedule?date=2026-07-23`);
		await page.waitForLoadState("networkidle");
		await shot("app-empty-schedule");
		await page
			.getByRole("button", { exact: true, name: "Find a time" })
			.click({ timeout: 5_000 });
		const scheduling = page.getByRole("dialog").first();
		await scheduling.waitFor({ state: "visible", timeout: 5_000 });
		await shot("app-empty-polls", scheduling);
		await page.keyboard.press("Escape");
	} catch {
		missed.push("empty states");
	} finally {
		await page.unroute("**/api/v1/events**", nothing);
	}

	// Narrow: the sidebar becomes a drawer, and the grid becomes one column.
	await page.setViewportSize({ height: 844, width: 390 });
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.waitForLoadState("networkidle");
	await shot("app-mobile-month");
	await page
		.getByRole("button", { name: /navigation/i })
		.first()
		.click();
	await shot("app-mobile-navigation");

	// Last, because it takes the network away for good: the snapshot start and the
	// strip that says how old what you are looking at is.
	await page.setViewportSize({ height: 900, width: 1440 });
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page.waitForLoadState("networkidle");
	try {
		await expect(async () => {
			expect(
				await page.evaluate(() =>
					window.localStorage.getItem("musubi:last-session"),
				),
			).toBeTruthy();
			expect(await snapshotKeys(page)).not.toHaveLength(0);
		}).toPass({ timeout: 10_000 });
		const dead = (route: Route) => route.abort();
		for (const pattern of ["**/api/v1/**", "**/api/auth/**", "**/api/stream"]) {
			await page.route(pattern, dead);
		}
		await page.reload();
		await page
			.getByRole("button", { name: /Client call/ })
			.first()
			.waitFor({ timeout: 10_000 });
		await shot("app-offline-snapshot");
	} catch {
		missed.push("offline-snapshot");
	}

	// Said out loud, so a gap in the catalogue is never mistaken for a screen that
	// does not exist.
	if (missed.length > 0) console.log(`Not captured: ${missed.join(", ")}`);
	if (overflow.length > 0) {
		console.log(`Taller than the window:\n  ${overflow.join("\n  ")}`);
	}
	console.log(`${index} screenshots in ${UI_SHOTS}/${UI_SHOTS_THEME}`);
});

test("keeps the time on a chip while the cell can hold one", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	const chipState = () =>
		page.evaluate(() => {
			// The first cell with something in it: an empty day has no chip to read,
			// and the month opens on one.
			const cell = [...document.querySelectorAll('[class*="dayEvents"]')].find(
				(el) => el.querySelector('[class*="eventTime"]'),
			)!;
			const time = cell.querySelector('[class*="eventTime"]');

			return {
				cell: Math.round(cell.getBoundingClientRect().width),
				// One row per chip. The marks sit at `grid-column: -2`, so a
				// single-column chip pushes them under the title and doubles its height.
				heights: [
					...new Set(
						[...cell.querySelectorAll('[class*="eventChip"]')].map((el) =>
							Math.round(el.getBoundingClientRect().height),
						),
					),
				],
				timeShown: time ? window.getComputedStyle(time).display !== "none" : false,
			};
		});

	// 1023px is where the sidebar becomes a drawer, so the cells get *wider* than
	// they are on a 1200px desktop. Keyed to the viewport, the time was dropped
	// here (137px cells) and kept there (122px cells).
	for (const width of [1023, 760]) {
		await page.setViewportSize({ height: 900, width });
		await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
		await expect(
			page.getByRole("button", { name: /Weekly review/ }).first(),
		).toBeVisible();
		const state = await chipState();
		expect(state.cell).toBeGreaterThan(95);
		expect(state.timeShown).toBe(true);
		expect(state.heights).toHaveLength(1);
	}

	// Narrow enough that a time would leave no title: it goes, and the chip stays
	// one row tall.
	for (const width of [600, 390]) {
		await page.setViewportSize({ height: 844, width });
		await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
		await expect(
			page.getByRole("button", { name: /Weekly review/ }).first(),
		).toBeVisible();
		const state = await chipState();
		expect(state.cell).toBeLessThan(95);
		expect(state.timeShown).toBe(false);
		expect(state.heights).toHaveLength(1);
	}
});

test("shows participant polls as striped all-day calendar items", async ({
	page,
}) => {
	await mockAuthenticatedReads(page, {
		deletedIds: [],
		events: [
			event(
				"all-day-reference",
				"Reference event",
				"personal",
				"#b3492f",
				"2026-08-17T00:00:00.000Z",
				"2026-08-18T00:00:00.000Z",
				{ hasAttendees: true, isAllDay: true },
			),
			event(
				"later-reference",
				"Later reference",
				"personal",
				"#b3492f",
				"2026-08-19T00:00:00.000Z",
				"2026-08-19T00:00:00.000Z",
				{ isAllDay: true },
			),
		],
		serverTime: "2026-08-11T12:00:00.000Z",
	});
	const pollPage = {
		...defaultPage,
		config: { ...defaultPage.config, showPolls: true },
	};
	await page.route("**/api/v1/pages", (route) => respond(route, [pollPage]));
	await page.route("**/api/v1/scheduling/polls/calendar", (route) =>
		respond(route, [
			{
				approximateStartTime: null,
				chosenSlotID: null,
				closed: false,
				closedAt: null,
				createdAt: "2026-08-01T09:00:00.000Z",
				deadline: null,
				durationMinutes: 1440,
				id: "poll-calendar-1",
				respondents: 2,
				role: "participant",
				title: "Studio planning",
				token: POLL_TOKEN,
				url: `http://127.0.0.1:3000/s/${POLL_TOKEN}`,
				days: [
					{
						date: "2026-08-18",
						end: "2026-08-19T00:00:00.000Z",
						id: "s1",
						ifNeeded: 0,
						no: 0,
						start: "2026-08-18T00:00:00.000Z",
						yes: 2,
					},
					{
						date: "2026-08-19",
						end: "2026-08-20T00:00:00.000Z",
						id: "s2",
						ifNeeded: 0,
						no: 1,
						start: "2026-08-19T00:00:00.000Z",
						yes: 1,
					},
				],
			},
		]),
	);
	const detail = {
		approximateStartTime: null,
		chosenSlotID: null,
		closed: false,
		deadline: null,
		description: "Choose a studio day.",
		durationMinutes: 1440,
		mine: { s1: "yes" },
		mineID: "1",
		people: [
			{ answers: { s1: "yes" }, id: "1", name: "Web QA" },
			{ answers: { s1: "yes", s2: "no" }, id: "2", name: "Adam" },
		],
		respondents: 2,
		slots: [
			{
				end: "2026-08-19T00:00:00.000Z",
				id: "s1",
				ifNeeded: [],
				no: [],
				start: "2026-08-18T00:00:00.000Z",
				yes: ["Web QA", "Adam"],
			},
			{
				end: "2026-08-20T00:00:00.000Z",
				id: "s2",
				ifNeeded: [],
				no: ["Adam"],
				start: "2026-08-19T00:00:00.000Z",
				yes: ["Web QA"],
			},
		],
		title: "Studio planning",
	};
	let savedVotes: unknown;
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}/votes`, (route) => {
		savedVotes = route.request().postDataJSON();
		return respond(route, detail);
	});
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, detail),
	);

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-08-18`);
	const chips = page.locator('[data-poll-calendar="poll-calendar-1"]');
	await expect(chips).toHaveCount(2);
	await expect(chips.locator("span")).toHaveCount(1);
	await expect(chips.locator("svg")).toHaveCount(1);
	const paints = await chips.evaluateAll((elements) =>
		elements.map((element) => {
			const style = getComputedStyle(element);
			return { color: style.backgroundColor, image: style.backgroundImage };
		}),
	);
	expect(paints[0]!.image).toContain("repeating-linear-gradient");
	expect(paints[0]!.color).not.toBe(paints[1]!.color);
	expect(
		await chips.first().getAttribute("data-continues-after"),
	).not.toBeNull();
	expect(
		await chips.last().getAttribute("data-continues-before"),
	).not.toBeNull();
	const geometry = await page.evaluate(() => {
		const poll = document.querySelector<HTMLElement>(
			'[data-poll-calendar="poll-calendar-1"]',
		)!;
		const event = document.querySelector<HTMLElement>(
			'[data-event-id="all-day-reference"]',
		)!;
		const nextPoll = document.querySelectorAll<HTMLElement>(
			'[data-poll-calendar="poll-calendar-1"]',
		)[1]!;
		const later = document.querySelector<HTMLElement>(
			'[data-event-id="later-reference"]',
		)!;
		const pollBox = poll.getBoundingClientRect();
		const nextPollBox = nextPoll.getBoundingClientRect();
		return {
			eventFont: getComputedStyle(event.querySelector("[class*='eventTitle']")!)
				.fontSize,
			eventHeight: event.getBoundingClientRect().height,
			eventIcon: event.querySelector("svg")!.getBoundingClientRect().width,
			joinGap: nextPollBox.left - pollBox.right,
			laterTop: later.getBoundingClientRect().top,
			nextPollTop: nextPollBox.top,
			pollFont: getComputedStyle(poll.querySelector("span")!).fontSize,
			pollHeight: pollBox.height,
			pollIcon: poll.querySelector("svg")!.getBoundingClientRect().width,
			pollTop: pollBox.top,
		};
	});
	expect(geometry.pollHeight).toBe(geometry.eventHeight);
	expect(geometry.pollFont).toBe(geometry.eventFont);
	expect(geometry.pollIcon).toBe(geometry.eventIcon);
	expect(geometry.joinGap).toBeLessThanOrEqual(0);
	expect(geometry.pollTop).toBe(geometry.nextPollTop);
	expect(geometry.laterTop).toBeLessThan(geometry.nextPollTop);

	await chips.first().click();
	const dialog = page.getByRole("dialog", { name: "Studio planning" });
	await expect(dialog).toContainText("verified account");
	const ownAnswer = dialog
		.getByRole("button", { name: /Change your answer/ })
		.first();
	await ownAnswer.click();
	await page
		.getByRole("dialog", { name: /Your answer for/ })
		.getByRole("button", { name: "If needed" })
		.click();
	await dialog.getByRole("button", { name: "Save answers" }).click();
	await expect
		.poll(() => savedVotes)
		.toEqual({
			votes: [{ slotID: "s1", value: "if-needed" }],
		});
});

test("refreshes an SSR-anonymous poll after the browser session resolves", async ({
	page,
}) => {
	await page.addInitScript(() =>
		sessionStorage.setItem("musubi-mobile-web-test-bypass", "true"),
	);
	await page.route("**/api/auth/get-session", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 200));
		return respond(route, session);
	});
	let pollReads = 0;
	const detail = (authenticated: boolean) => ({
		chosenSlotID: null,
		closed: false,
		deadline: null,
		description: null,
		durationMinutes: 24 * 60,
		mine: {},
		mineID: authenticated ? "1" : null,
		people: authenticated ? [{ answers: {}, id: "1", name: "Web QA" }] : [],
		respondents: 0,
		slots: [
			{
				end: "2026-08-11T00:00:00.000Z",
				id: "owner-slot",
				ifNeeded: [],
				no: [],
				start: "2026-08-10T00:00:00.000Z",
				yes: [],
			},
		],
		title: "Team day",
		viewerRole: authenticated ? "organizer" : null,
	});
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) => {
		pollReads += 1;
		return respond(route, detail(pollReads > 1));
	});

	await page.goto(`/s/${POLL_TOKEN}`);
	await expect(page.getByText("You created this poll.")).toBeVisible();
	await expect(page.getByRole("row", { name: /^Web QA/ })).toBeVisible();
	expect(pollReads).toBeGreaterThanOrEqual(2);
});

test("lets the poll organizer answer from the calendar", async ({ page }) => {
	await mockAuthenticatedReads(page);
	const poll = {
		chosenSlotID: null,
		closedAt: null,
		createdAt: "2026-07-26T09:00:00.000Z",
		deadline: null,
		durationMinutes: 24 * 60,
		id: "poll-owner-vote",
		title: "Team day",
		token: POLL_TOKEN,
		url: `http://127.0.0.1:3000/s/${POLL_TOKEN}`,
	};
	const savedVotes: unknown[] = [];
	const detail = (answered: boolean) => ({
		chosenSlotID: null,
		closed: false,
		deadline: null,
		description: null,
		durationMinutes: 24 * 60,
		mine: answered ? { "owner-slot": "yes" } : {},
		mineID: "1",
		people: [
			{
				answers: answered ? { "owner-slot": "yes" } : {},
				id: "1",
				name: "Web QA",
			},
		],
		respondents: answered ? 1 : 0,
		slots: [
			{
				end: "2026-08-11T00:00:00.000Z",
				id: "owner-slot",
				ifNeeded: [],
				no: [],
				start: "2026-08-10T00:00:00.000Z",
				yes: answered ? ["Web QA"] : [],
			},
		],
		title: "Team day",
		viewerRole: "organizer",
	});
	await page.route("**/api/v1/scheduling/polls", (route) =>
		respond(route, [poll]),
	);
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, detail(savedVotes.length > 0)),
	);
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}/votes`, (route) => {
		savedVotes.push(route.request().postDataJSON());
		return respond(route, detail(true));
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-08-10`);
	await page.getByRole("button", { exact: true, name: "Find a time" }).click();
	await page.getByRole("button", { name: /Team day/ }).click();
	const dialog = page.getByRole("dialog", { name: "Team day" });
	await expect(dialog.getByRole("row", { name: /^Web QA/ })).toBeVisible();
	await dialog
		.getByRole("button", { name: /10 Aug.*have not answered/ })
		.click();
	await page
		.getByRole("dialog", { name: /Your answer for/ })
		.getByRole("button", { exact: true, name: "Yes" })
		.click();
	await dialog.getByRole("button", { name: "Save my answers" }).click();

	await expect(
		dialog.getByRole("button", { name: "Answers saved" }),
	).toBeDisabled();
	expect(savedVotes[0]).toEqual({
		votes: [{ slotID: "owner-slot", value: "yes" }],
	});

	// The same authenticated identity owns the row on the public link too.
	await page.goto(`/s/${POLL_TOKEN}`);
	await expect(page.getByText("You created this poll.")).toBeVisible();
	const ownAnswer = page.getByRole("button", {
		name: /10 Aug.*you answered yes/,
	});
	await ownAnswer.click();
	await page
		.getByRole("dialog", { name: /Your answer for/ })
		.getByRole("button", { exact: true, name: "No" })
		.click();
	await page.getByRole("button", { name: "Send my answers" }).click();
	expect(savedVotes[1]).toEqual({
		votes: [{ slotID: "owner-slot", value: "no" }],
	});
});

test("closes and deletes a poll", async ({ page }) => {
	await mockAuthenticatedReads(page);
	let closed = false;
	let deleted = false;
	const poll = (overrides: Record<string, unknown> = {}) => ({
		chosenSlotID: null,
		closed,
		closedAt: closed ? "2026-08-03T10:00:00.000Z" : null,
		createdAt: "2026-07-26T09:00:00.000Z",
		deadline: null,
		durationMinutes: 60,
		id: "poll-1",
		title: "Studio planning",
		token: POLL_TOKEN,
		url: `http://127.0.0.1:3000/s/${POLL_TOKEN}`,
		...overrides,
	});

	await page.route("**/api/v1/scheduling/polls", (route) =>
		respond(route, deleted ? [] : [poll()]),
	);
	await page.route(`**/api/v1/scheduling/polls/poll-1/close`, (route) => {
		closed = true;
		return respond(route, { closed: true });
	});
	await page.route(`**/api/v1/scheduling/polls/poll-1`, (route) => {
		deleted = true;
		return respond(route, undefined, 204);
	});
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, {
			chosenSlotID: null,
			closed,
			deadline: null,
			durationMinutes: 60,
			mine: {},
			mineID: null,
			people: [{ answers: { s1: "yes" }, id: "1", name: "Adam" }],
			respondents: 1,
			slots: [
				{
					end: "2026-08-10T14:00:00.000Z",
					id: "s1",
					ifNeeded: [],
					no: [],
					start: "2026-08-10T13:00:00.000Z",
					yes: ["Adam"],
				},
			],
			title: "Studio planning",
		}),
	);

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	await page.getByRole("button", { exact: true, name: "Find a time" }).click();
	await page.getByRole("button", { name: /Studio planning/ }).click();

	const pollActions = await Promise.all(
		["Delete poll", "Stop taking answers", "Answers saved"].map(async (name) =>
			page.getByRole("button", { name }).boundingBox(),
		),
	);
	expect(new Set(pollActions.map((box) => Math.round(box!.y))).size).toBe(1);
	expect(
		pollActions[1]!.x - (pollActions[0]!.x + pollActions[0]!.width),
	).toBeLessThanOrEqual(12);
	expect(pollActions[2]!.x).toBeGreaterThan(pollActions[1]!.x);

	// Deciding used to be the only way to shut a poll, so an organizer who sorted
	// the meeting out elsewhere had to invent an event or leave the link open.
	await page.getByRole("button", { name: "Stop taking answers" }).click();
	await expect(page.getByRole("status")).toContainText("Poll closed");
	await expect(
		page.getByRole("button", { name: /Studio planning/ }),
	).toContainText("Closed, no time picked");

	// Deleting says what goes with it, and takes a confirmation.
	await page.getByRole("button", { name: /Studio planning/ }).click();
	await expect(page.getByRole("button", { name: "Pick" })).toHaveCount(0);
	await page.getByRole("button", { name: "Delete poll" }).click();
	const confirm = page.getByRole("dialog", {
		name: /Delete “Studio planning”/,
	});
	await expect(confirm).toContainText("1 person has answered");
	await confirm.getByRole("button", { name: "Delete poll" }).click();

	await expect(page.getByRole("status")).toContainText("Poll deleted");
	await expect(page.getByText("No polls yet")).toBeVisible();
});

test("finds events and actions without filtering the calendar", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	const clientCall = page.getByRole("button", { name: /Client call/ });
	await expect(clientCall).toBeVisible();

	await page.getByRole("button", { name: "Search events and actions" }).click();
	const search = page.getByRole("dialog", { name: "Search Musubi" });
	await expect(
		search.getByRole("button", { name: "Go to today" }),
	).toBeVisible();
	await expectNoAccessibilityViolations(page);
	await search.getByRole("searchbox").fill("review");
	const reviewResult = search
		.getByRole("button", { name: /Weekly review/ })
		.first();
	await expect(reviewResult).toBeVisible();
	await reviewResult.click();

	// Selecting a result follows the same path as clicking its calendar block: it
	// moves to the date and opens the lightweight event preview, not the editor.
	await expect(
		page.getByRole("dialog", { name: "Weekly review" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(clientCall).toBeVisible();
});

test("draws the plus on the narrow create button", async ({ page }) => {
	await mockAuthenticatedReads(page);
	await page.setViewportSize({ height: 844, width: 390 });
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);

	// Measured, not looked at: the rule that hides the word on a phone used to
	// match the primitive's content wrapper — the button's only direct span — and
	// took the icon with it, leaving a plain dark circle with nothing in it.
	const plus = page
		.getByRole("button", { exact: true, name: "Event" })
		.locator("svg");
	await expect(plus).toBeVisible();
	const box = (await plus.boundingBox())!;
	expect(box.width).toBeGreaterThan(10);
	expect(box.height).toBeGreaterThan(10);
	// And the word is still gone, which is what the rule was for. `textContent`
	// would still read it, so this asks the layout instead.
	await expect(
		page.getByRole("button", { name: "Event" }).getByText("Event"),
	).toBeHidden();
});

test("puts an unknown view back in the address bar", async ({ page }) => {
	await mockAuthenticatedReads(page);
	// "schedule" is not a view: it renders the month, and the URL used to keep
	// claiming otherwise, so a copied link and the view picker disagreed.
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/schedule?date=2026-07-23`);
	await expect(page.getByRole("radio", { name: "Month" })).toBeChecked();
	await expect(page).toHaveURL(/\/month\?date=2026-07-23$/);
});

test("keeps the sidebar's Pages label off the first page row", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-23`);
	const label = page.getByRole("heading", { name: "Pages" });
	await label.waitFor();

	// Measured, not declared: the bottom margin this used to rely on never applied
	// once — `.sectionLabel` in the primitives sets `margin: 0` at the same
	// specificity and lands later in the bundle, so it won on order. The space is
	// the section's gap now, and this is what tells us if it goes away again.
	const gap = await page.evaluate(() => {
		const heading = window.document.querySelector("#pages-label")!;
		const list = window.document.querySelector('[class*="pageList"]')!;

		return (
			list.getBoundingClientRect().top - heading.getBoundingClientRect().bottom
		);
	});
	expect(gap).toBeGreaterThanOrEqual(8);
});

/**
 * Onboarding is a separate test because it needs an account that has never seen
 * the app, which the catalogue's mocks cannot be talked into mid-run. Its shot
 * numbers are written by hand and start past the catalogue's last one — they used
 * to be 30–32 and collided with the dialogs that now sit there.
 */
test("walks a new account through onboarding once", async ({ page }) => {
	if (UI_SHOTS) {
		await page.addInitScript(
			(theme) => window.localStorage.setItem("musubi-theme", theme),
			UI_SHOTS_THEME,
		);
	}
	await mockAuthenticatedReads(page);

	// Overrides after the shared mock, so these win: an account that has never
	// finished setting up.
	let revision = 1;
	let state = { ...settings, onboarded: false };
	let patched: unknown;
	let renamed: unknown;
	let named: unknown;
	await page.route("**/api/v1/server", (route) =>
		respond(route, { syncProviders: ["google"] }),
	);
	await page.route("**/api/auth/update-user", (route) => {
		named = route.request().postDataJSON();
		return respond(route, { status: true });
	});
	await page.route("**/api/v1/users/settings", (route) => respond(route, state));
	await page.route("**/api/v1/users/settings/document", (route) =>
		respond(route, {
			revision,
			updatedAt: "2026-07-26T14:00:00.000Z",
			value: state,
		}),
	);
	await page.route("**/api/v1/users/me/settings", (route) => {
		patched = route.request().postDataJSON();
		revision += 1;
		state = { ...state, onboarded: true };
		return respond(route, {
			revision,
			updatedAt: "2026-07-26T14:01:00.000Z",
			value: state,
		});
	});
	await page.route("**/api/v1/calendars", async (route) => {
		if (route.request().method() !== "PUT") return route.fallback();
		renamed = route.request().postDataJSON();
		return respond(route, renamed);
	});

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await expect(
		page.getByRole("heading", { level: 1, name: "Welcome to Musubi" }),
	).toBeVisible();
	// The step marks are dots; the sentence they replaced lives on their label.
	await expect(page.getByRole("img", { name: "Step 1 of 3" })).toBeVisible();

	if (UI_SHOTS) {
		await page.screenshot({
			fullPage: true,
			path: `${UI_SHOTS}/${UI_SHOTS_THEME}/40-app-onboarding-1-name.png`,
		});
	}
	await page.getByLabel("Your name").fill("Zoe Novák");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();

	// Step two renames the calendar the server already made — it never creates one.
	await expect(
		page.getByRole("heading", { level: 1, name: "Your calendar" }),
	).toBeVisible();
	if (UI_SHOTS) {
		await page.screenshot({
			fullPage: true,
			path: `${UI_SHOTS}/${UI_SHOTS_THEME}/41-app-onboarding-2-calendar.png`,
		});
	}
	await page.getByLabel("Calendar name").fill("Home");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: /Anything to bring/ }),
	).toBeVisible();
	// Offered because this server advertises it, not because it was hard-coded.
	await expect(
		page.getByRole("button", { name: /Connect Google Calendar/ }),
	).toBeVisible();
	if (UI_SHOTS) {
		await page.screenshot({
			fullPage: true,
			path: `${UI_SHOTS}/${UI_SHOTS_THEME}/42-app-onboarding-3-connect.png`,
		});
	}
	await page.getByRole("button", { name: "Not now" }).click();

	// Through to the calendar, and the flag is set so it never asks again.
	await expect(page.getByRole("grid").first()).toBeVisible();
	expect(named).toMatchObject({ name: "Zoe Novák" });
	expect(renamed).toMatchObject({ name: "Home" });
	expect(patched).toMatchObject({
		baseRevision: 1,
		patch: { onboarded: true },
	});

	await page.reload();
	await expect(page.getByRole("grid").first()).toBeVisible();
	await expect(page.getByRole("img", { name: "Step 1 of 3" })).toHaveCount(0);
});

const POLL_TOKEN = "192372d03aed90c2f5b0f0a5f8f0c1d2";
type MockPollSlot = {
	end: string;
	id: string;
	ifNeeded: string[];
	no: string[];
	start: string;
	yes: string[];
};

test("creates a poll, collects answers and turns one into an event", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	let created: unknown;
	let decided: unknown;
	const poll = {
		approximateStartTime: "15:00",
		closedAt: null,
		createdAt: "2026-07-26T09:00:00.000Z",
		durationMinutes: 24 * 60,
		id: "poll-1",
		title: "Studio planning",
		token: POLL_TOKEN,
		url: `http://127.0.0.1:3000/s/${POLL_TOKEN}`,
	};
	await page.route("**/api/v1/scheduling/polls", (route) => {
		if (route.request().method() === "POST") {
			created = route.request().postDataJSON();
			return respond(route, poll, 201);
		}
		return respond(route, [poll]);
	});
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, {
			approximateStartTime: "15:00",
			chosenSlotID: null,
			closed: false,
			description: null,
			durationMinutes: 24 * 60,
			mine: {},
			mineID: null,
			people: [
				{
					answers: { "slot-tue": "yes", "slot-wed": "if-needed" },
					id: "1",
					name: "Mika",
				},
				{
					answers: { "slot-tue": "no", "slot-wed": "yes" },
					id: "2",
					name: "Adam",
				},
				{ answers: { "slot-wed": "yes" }, id: "3", name: "Zoe" },
			],
			respondents: 2,
			slots: [
				{
					end: "2026-08-18T14:00:00.000Z",
					id: "slot-tue",
					ifNeeded: [],
					no: ["Adam"],
					start: "2026-08-18T13:00:00.000Z",
					yes: ["Mika"],
				},
				{
					end: "2026-08-19T14:00:00.000Z",
					id: "slot-wed",
					ifNeeded: ["Mika"],
					no: [],
					start: "2026-08-19T13:00:00.000Z",
					yes: ["Adam", "Zoe"],
				},
			],
			title: "Studio planning",
		}),
	);
	await page.route("**/api/v1/scheduling/polls/*/decide", (route) => {
		decided = route.request().postDataJSON();
		return respond(route, { eventId: "event-1", slotId: "slot-wed" });
	});

	// The day grid opens on the real current month, so the clock decides which
	// days are on screen. Pin it, or this test passes only in August.
	await page.clock.setFixedTime(new Date("2026-08-03T10:00:00"));
	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.getByRole("button", { name: "Find a time" }).click();
	const dialog = page.getByRole("dialog", { name: "Find a time" });

	await dialog.getByLabel("What is it about").fill("Studio planning");
	const approximateStart = dialog.getByLabel("Approximate start time");
	await expect(approximateStart).toHaveAttribute("placeholder", "Select time");
	await approximateStart.click();
	const timeOptions = page.getByRole("listbox", {
		name: "Approximate start time options",
	});
	await timeOptions.hover();
	await page.mouse.wheel(0, 240);
	await expect
		.poll(() => timeOptions.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
	await approximateStart.fill("15:00");
	await approximateStart.press("Tab");
	const firstDay = dialog.getByRole("button", { exact: true, name: "18" });
	const dayY = (await firstDay.boundingBox())?.y;
	await firstDay.click();
	await expect(
		dialog.getByRole("button", { name: "Clear 1 day" }),
	).toBeVisible();
	expect((await firstDay.boundingBox())?.y).toBe(dayY);
	await dialog.getByRole("button", { exact: true, name: "19" }).click();
	await expect(dialog.getByText("2 days", { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Create the poll" }).click();

	// The organizer types a wall clock where they are; the wire carries instants.
	// The dialog renames itself to the poll once it opens the results, so the
	// locator has to stop asking for "Find a time".
	const results = page.getByRole("dialog", { name: "Studio planning" });
	await expect(
		results.getByRole("textbox", { name: "Poll link" }),
	).toBeVisible();
	expect(created).toMatchObject({
		approximateStartTime: "15:00",
		title: "Studio planning",
	});
	expect(created).not.toHaveProperty("durationMinutes");
	const sent = (
		created as {
			slots: Array<{ date: string; start: string }>;
		}
	).slots;
	expect(sent).toHaveLength(2);
	// Date is the semantic value; UTC noon is only a timezone-stable carrier.
	expect(sent).toEqual([
		{ date: "2026-08-18", start: "2026-08-18T12:00:00.000Z" },
		{ date: "2026-08-19", start: "2026-08-19T12:00:00.000Z" },
	]);

	// The same grid the participants answered on, so the person deciding reads the
	// picture they filled in — Mika's row, and the count under each column.
	await expect(results.getByText("Around 15:00").first()).toBeVisible();
	await expect(results.getByRole("row", { name: /^Mika/ })).toContainText("✓");
	await expect(
		results.getByRole("row", { name: /1 can make it 2 can make it/ }),
	).toContainText("2");

	// Nothing is picked for them: two times can tie, and choosing is the
	// organizer's job. The leaders are marked, and Wednesday is the second column.
	await results.getByRole("button", { name: "Pick" }).nth(1).click();

	await expect(page.getByRole("status")).toContainText(
		"event is in your calendar",
	);
	expect(decided).toMatchObject({ slotId: "slot-wed" });
});

test("picks poll days by dragging a run and by taking a weekday column", async ({
	page,
}) => {
	await mockAuthenticatedReads(page);
	await page.route("**/api/v1/scheduling/polls", (route) => respond(route, []));
	await page.clock.setFixedTime(new Date("2026-08-03T10:00:00"));

	await page.goto(`/app/p/${DEFAULT_PAGE_ID}/month?date=2026-07-26`);
	await page.getByRole("button", { name: "Find a time" }).click();
	const dialog = page.getByRole("dialog", { name: "Find a time" });
	const day = (date: string) =>
		dialog.getByRole("button", { exact: true, name: date });

	// A run of days is one gesture. The direction comes from where the drag
	// started, so this must land on five days and not on one.
	await day("10").hover();
	await page.mouse.down();
	for (const date of ["11", "12", "13", "14"]) await day(date).hover();
	await page.mouse.up();
	await expect(dialog.getByText("5 days", { exact: true })).toBeVisible();

	await dialog.getByRole("button", { name: "Clear 5 days" }).click();
	await expect(dialog.getByText("Pick at least one day")).toBeVisible();

	// A weekday header takes every one of that weekday in view, and takes it back.
	const column = dialog.getByTitle(/^Select every/).first();
	await column.click();
	await expect(dialog.getByText(/^\d+ days$/)).toBeVisible();
	await dialog
		.getByTitle(/^Clear every/)
		.first()
		.click();
	await expect(dialog.getByText("Pick at least one day")).toBeVisible();
});

test("makes an event page from the public page with no account", async ({
	page,
}) => {
	const hydrationErrors = recordHydrationErrors(page);
	let signedIn = false;
	let created: { calendars: string[]; start: string; title: string } | undefined;
	let published: { mode: string; name?: string } | undefined;
	await page.route("**/api/auth/get-session", (route) =>
		respond(
			route,
			signedIn
				? {
						session: { id: "s" },
						user: { email: "z@example.com", id: "guest", name: "" },
					}
				: null,
		),
	);
	await page.route("**/api/auth/email-otp/send-verification-otp", (route) =>
		respond(route, { success: true }),
	);
	await page.route("**/api/auth/sign-in/email-otp", (route) => {
		signedIn = true;
		return respond(route, { token: "t", user: { id: "guest", name: "" } });
	});
	await page.route("**/api/auth/update-user", (route) =>
		respond(route, { user: { id: "guest", name: "Zoe" } }),
	);
	await page.route("**/api/v1/calendars", (route) =>
		respond(route, [
			{
				...calendars[0],
				id: "cal-personal",
				isDefault: true,
				name: "Personal",
			},
		]),
	);
	await page.route("**/api/v1/events", (route) => {
		created = route.request().postDataJSON();
		return respond(
			route,
			{ ...created, creatorID: "guest", id: "event-1", isCanceled: false },
			201,
		);
	});
	await page.route("**/api/v1/events/event-1/share", (route) => {
		published = route.request().postDataJSON();
		return respond(route, {
			attendeeVisibility: "counts",
			coverUrl: null,
			indexable: false,
			mode: "link",
			theme: {
				cover: "wash",
				font: "serif",
				layout: "classic",
				palette: "sand",
			},
			token: "abc",
			url: "http://127.0.0.1:3000/e/abc",
		});
	});
	await page.clock.setFixedTime(new Date("2026-08-03T10:00:00"));

	await page.goto("/new-event");
	await page.waitForLoadState("networkidle");
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		"content",
		"index, follow",
	);

	await page.getByLabel("What is happening").fill("Studio opening");
	// The date picker is a button and a mini calendar, not a text field.
	await page.getByRole("button", { name: /^Date:/ }).click();
	await page
		.getByRole("gridcell", { name: "Thursday, August 20, 2026" })
		.click();
	await page.getByLabel("From").fill("17:30");
	await page.getByLabel("Where (optional)").fill("Studio, Brno");
	// The length is kept when the start moves, rather than the event shrinking.
	await expect(page.getByLabel("To")).toHaveValue("18:30");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();

	// Still nothing on the server: the address comes first.
	expect(created).toBeUndefined();
	await page.getByLabel("Email").fill("z@example.com");
	await page.getByRole("button", { name: "Send me a code" }).click();
	await page.getByLabel("Code from your email").fill("123456");
	await page.getByRole("button", { name: "Confirm" }).click();
	await page.getByLabel("Your name").fill("Zoe");
	await page.getByRole("button", { name: "Confirm and publish" }).click();

	await expect(page.getByRole("textbox", { name: "Event link" })).toHaveValue(
		"http://127.0.0.1:3000/e/abc",
	);
	// Into the personal calendar the account already has, at the wall clock typed
	// in Europe/Prague, and unlisted rather than indexable.
	expect(created).toMatchObject({
		calendars: ["cal-personal"],
		location: "Studio, Brno",
		start: "2026-08-20T15:30:00.000Z",
		title: "Studio opening",
	});
	expect(published).toMatchObject({ mode: "link", name: "Zoe" });
	expect(hydrationErrors).toEqual([]);

	await expectNoAccessibilityViolations(page);
});

test("makes a poll from the public page with no account", async ({ page }) => {
	const hydrationErrors = recordHydrationErrors(page);
	let created:
		| {
				approximateStartTime?: string;
				email?: string;
				name?: string;
				slots: Array<{ start: string }>;
		  }
		| undefined;
	let signedIn = false;
	await page.route("**/api/auth/get-session", (route) =>
		respond(
			route,
			signedIn
				? {
						session: { id: "s" },
						user: { email: "z@example.com", id: "guest", name: "Zoe" },
					}
				: null,
		),
	);
	await page.route("**/api/auth/email-otp/send-verification-otp", (route) =>
		respond(route, { success: true }),
	);
	await page.route("**/api/auth/sign-in/email-otp", (route) => {
		signedIn = true;
		return respond(route, { token: "t", user: { id: "guest", name: "Zoe" } });
	});
	await page.route("**/api/v1/scheduling/polls", (route) => {
		if (route.request().method() !== "POST") return respond(route, []);
		created = route.request().postDataJSON();
		return respond(
			route,
			{
				closedAt: null,
				createdAt: "2026-08-03T09:00:00.000Z",
				durationMinutes: 45,
				id: "poll-1",
				title: "Studio planning",
				token: POLL_TOKEN,
				url: `http://127.0.0.1:3000/s/${POLL_TOKEN}`,
			},
			201,
		);
	});
	await page.clock.setFixedTime(new Date("2026-08-03T10:00:00"));

	await page.goto("/find-a-time");
	// Indexable, unlike the poll it makes: this page is the door.
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		"content",
		"index, follow",
	);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: /Find a time everyone can make/,
		}),
	).toBeVisible();

	// This page is server-rendered and the grid only answers once React is
	// attached, so a press before hydration lands on nothing.
	await page.waitForLoadState("networkidle");

	await page.getByLabel("Email").fill("z@example.com");
	await page.getByRole("button", { name: "Send me a code" }).click();
	await page.getByLabel("Code from your email").fill("123456");
	await page.getByRole("button", { name: "Confirm" }).click();
	await page.getByLabel("What is it about").fill("Studio planning");
	await page.getByRole("button", { exact: true, name: "10" }).click();
	await page.getByRole("button", { exact: true, name: "11" }).click();
	await page.getByRole("button", { name: "Create the poll" }).click();

	await expect(page.getByRole("textbox", { name: "Poll link" })).toHaveValue(
		`http://127.0.0.1:3000/s/${POLL_TOKEN}`,
	);
	// Identity comes from the verified session, never form fields.
	expect(created).not.toHaveProperty("email");
	expect(created).not.toHaveProperty("name");
	expect(created).not.toHaveProperty("approximateStartTime");
	expect(created!.slots).toHaveLength(2);
	expect(hydrationErrors).toEqual([]);

	await expectNoAccessibilityViolations(page);
});

test("keeps a wide poll grid inside its own scroller", async ({ page }) => {
	await page.route("**/api/auth/get-session", (route) => respond(route, null));
	const slots: MockPollSlot[] = [];
	for (let day = 3; day <= 24; day += 1) {
		for (const hour of [13, 17]) {
			slots.push({
				end: `2026-08-${String(day).padStart(2, "0")}T${hour + 1}:00:00.000Z`,
				id: `s${day}-${hour}`,
				ifNeeded: [],
				no: [],
				start: `2026-08-${String(day).padStart(2, "0")}T${hour}:00:00.000Z`,
				yes: [],
			});
		}
	}
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, {
			chosenSlotID: null,
			closed: false,
			durationMinutes: 60,
			mine: {},
			mineID: null,
			people: [{ answers: {}, id: "1", name: "Mika" }],
			respondents: 1,
			slots,
			title: "Studio planning",
		}),
	);

	await page.goto(`/s/${POLL_TOKEN}`);
	const title = page.getByRole("heading", { name: "Studio planning" });
	await expect(title).toBeVisible();
	const pollCard = title.locator("xpath=ancestor::article");
	const alignment = await pollCard.evaluate(
		(card, heading) => {
			const cardBox = card.getBoundingClientRect();
			const titleBox = (heading as HTMLElement).getBoundingClientRect();
			return {
				centerDelta: Math.abs(
					cardBox.left + cardBox.width / 2 - (titleBox.left + titleBox.width / 2),
				),
				pageCenterX: Math.abs(cardBox.left + cardBox.width / 2 - innerWidth / 2),
				textAlign: getComputedStyle(heading as HTMLElement).textAlign,
			};
		},
		await title.elementHandle(),
	);
	expect(alignment.centerDelta).toBeLessThanOrEqual(1);
	expect(alignment.pageCenterX).toBeLessThanOrEqual(1);
	expect(alignment.textAlign).toBe("center");

	// Forty-four columns: the table has to scroll inside its box and take nothing
	// else with it. A grid item's `min-width: auto` is what lets wide content push
	// its own container wider, and then the document scrolls sideways instead.
	const scroller = page.locator("[class*=scroller]");
	expect(
		await scroller.evaluate((node) => node.scrollWidth > node.clientWidth),
	).toBe(true);
	const documentWidth = await page.evaluate(() => ({
		client: window.document.documentElement.clientWidth,
		scroll: window.document.documentElement.scrollWidth,
	}));
	expect(documentWidth.scroll).toBeLessThanOrEqual(documentWidth.client);

	await page.setViewportSize({ height: 844, width: 390 });
	const themeBox = await page
		.getByRole("button", { name: /theme/ })
		.boundingBox();
	const mobileCardBox = await pollCard.boundingBox();
	expect(themeBox!.y + themeBox!.height).toBeLessThanOrEqual(mobileCardBox!.y);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
		390,
	);
});

test("answers a poll as somebody with no account", async ({ page }) => {
	let saved = false;
	let signedIn = false;
	const voteAttempts: unknown[] = [];
	await page.route("**/api/auth/get-session", (route) =>
		respond(
			route,
			signedIn
				? {
						session: { id: "s" },
						user: { email: "z@example.com", id: "guest", name: "Zoe" },
					}
				: null,
		),
	);
	await page.route("**/api/auth/email-otp/send-verification-otp", (route) =>
		respond(route, { success: true }),
	);
	await page.route("**/api/auth/sign-in/email-otp", (route) => {
		signedIn = true;
		return respond(route, { token: "t", user: { id: "guest", name: "Zoe" } });
	});
	const body = {
		chosenSlotID: null,
		closed: false,
		description: "Which afternoon?",
		durationMinutes: 60,
		mine: {},
		mineID: null,
		people: [
			{
				answers: { "slot-tue": "yes", "slot-wed": "no" },
				id: "1",
				name: "Mika",
			},
		],
		respondents: 1,
		slots: [
			{
				end: "2026-08-18T14:00:00.000Z",
				id: "slot-tue",
				ifNeeded: [],
				no: [],
				start: "2026-08-18T13:00:00.000Z",
				yes: ["Mika"],
			},
			{
				end: "2026-08-19T14:00:00.000Z",
				id: "slot-wed",
				ifNeeded: [],
				no: ["Mika"],
				start: "2026-08-19T13:00:00.000Z",
				yes: [],
			},
		],
		title: "Studio planning",
	};
	const answered = (mine: boolean) => ({
		...body,
		mine: mine ? { "slot-tue": "yes" } : {},
		mineID: mine ? "2" : null,
		people: [
			...body.people,
			{ answers: { "slot-tue": "yes" }, id: "2", name: "Zoe" },
		],
		respondents: 2,
	});
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, saved ? answered(signedIn) : body),
	);
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}/votes`, (route) => {
		voteAttempts.push(route.request().postDataJSON());
		if (saved && !signedIn) {
			return respond(
				route,
				{ message: "Sign in before changing these answers." },
				403,
			);
		}
		saved = true;
		return respond(route, answered(true));
	});

	await page.goto(`/s/${POLL_TOKEN}`);
	await page.waitForLoadState("networkidle");

	await expect(
		page.getByRole("heading", { name: "Studio planning" }),
	).toBeVisible();
	// Somebody else's row is readable before you have said who you are — the
	// whole point of the grid is seeing who can make what.
	const mika = page.getByRole("row", { name: /^Mika/ });
	await expect(mika).toContainText("✓");
	await expect(mika).toContainText("✕");

	// Email comes before a personal row becomes editable.
	await expect(page.getByText(/calendar is never read/)).toBeVisible();
	await page.getByLabel("Email").fill("z@example.com");
	await page.getByRole("button", { name: "Send me a code" }).click();
	await page.getByLabel("Code from your email").fill("123456");
	await page.getByRole("button", { name: "Confirm" }).click();
	await expect(page.getByLabel("Your name")).toHaveCount(0);

	// A cell opens a menu; the menu sets the answer.
	await page.getByRole("button", { name: /18 Aug.*have not answered/ }).click();
	await page.getByRole("button", { name: "Yes", exact: true }).click();
	await page.getByRole("button", { name: "Send my answers" }).click();
	const savedButton = page.getByRole("button", { name: "Answers saved" });
	await expect(savedButton).toBeDisabled();
	expect(voteAttempts).toEqual([
		{ votes: [{ slotID: "slot-tue", value: "yes" }] },
	]);
	const zoe = page.getByRole("row", { name: /^Zoe/ });
	await expect(zoe).toBeVisible();

	const rowHeights = await Promise.all(
		[mika, zoe].map(async (row) => (await row.boundingBox())!.height),
	);
	expect(Math.max(...rowHeights) - Math.min(...rowHeights)).toBeLessThanOrEqual(
		0.5,
	);
	for (const row of [mika, zoe]) {
		expect(
			await row.locator("th").evaluate((cell) => getComputedStyle(cell).textAlign),
		).toBe("center");
	}

	const legend = savedButton.locator("xpath=../preceding-sibling::p[1]");
	const legendBox = await legend.boundingBox();
	const buttonBox = await savedButton.boundingBox();
	expect(
		Math.abs(
			legendBox!.y +
				legendBox!.height / 2 -
				(buttonBox!.y + buttonBox!.height / 2),
		),
	).toBeLessThanOrEqual(1);
	expect(legendBox!.x).toBeLessThan(buttonBox!.x);

	// A table of coloured marks is exactly where contrast and headers go wrong.
	await expectNoAccessibilityViolations(page);
});

test("tapping from one poll cell to the next keeps the new menu open", async ({
	browser,
}) => {
	// A touch context on purpose: with a mouse the old menu dismissed on
	// pointerdown, before the new one existed. On touch the dismissal waits for the
	// click, so the closing menu pulled focus back to its own cell *after* the new
	// menu had opened — and a non-modal popover closes when focus leaves it. The
	// second menu flashed and vanished, and only on a touchscreen.
	const context = await browser.newContext({ hasTouch: true });
	const page = await context.newPage();
	const slot = (day: string, id: string) => ({
		end: `2026-08-${day}T14:00:00.000Z`,
		id,
		ifNeeded: [],
		no: [],
		start: `2026-08-${day}T13:00:00.000Z`,
		yes: [],
	});
	await page.route("**/api/auth/get-session", (route) =>
		respond(route, {
			session: { id: "s" },
			user: { email: "z@example.com", id: "guest", name: "Zoe" },
		}),
	);
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, {
			chosenSlotID: null,
			closed: false,
			durationMinutes: 60,
			mine: {},
			mineID: null,
			people: [],
			respondents: 0,
			slots: [slot("18", "slot-tue"), slot("19", "slot-wed")],
			title: "Studio planning",
		}),
	);

	await page.goto(`/s/${POLL_TOKEN}`);
	await page.getByRole("button", { name: /18 Aug/ }).tap();
	await expect(page.getByRole("dialog", { name: /18 Aug/ })).toBeVisible();
	await page.getByRole("button", { name: /19 Aug/ }).tap();
	// Settled, not sampled: a retrying assertion would happily catch the flash.
	await page.waitForTimeout(600);
	await expect(page.getByRole("dialog", { name: /19 Aug/ })).toBeVisible();
	await expect(page.getByRole("dialog", { name: /18 Aug/ })).toHaveCount(0);

	await context.close();
});

test("sets and clears a poll answer from the cell menu", async ({ page }) => {
	await page.route("**/api/auth/get-session", (route) =>
		respond(route, {
			session: { id: "s" },
			user: { email: "z@example.com", id: "guest", name: "Zoe" },
		}),
	);
	let sentVotes: { votes?: Array<{ value: string }> } | undefined;
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}`, (route) =>
		respond(route, {
			chosenSlotID: null,
			closed: false,
			durationMinutes: 60,
			mine: {},
			mineID: null,
			people: [],
			respondents: 0,
			slots: [
				{
					end: "2026-08-18T14:00:00.000Z",
					id: "slot-tue",
					ifNeeded: [],
					no: [],
					start: "2026-08-18T13:00:00.000Z",
					yes: [],
				},
				{
					end: "2026-08-19T14:00:00.000Z",
					id: "slot-wed",
					ifNeeded: [],
					no: [],
					start: "2026-08-19T13:00:00.000Z",
					yes: [],
				},
			],
			title: "Studio planning",
		}),
	);
	await page.route(`**/api/v1/public/polls/${POLL_TOKEN}/votes`, (route) => {
		sentVotes = route.request().postDataJSON();
		return route.fulfill({
			status: 500,
			body: "{}",
			contentType: "application/json",
		});
	});

	await page.goto(`/s/${POLL_TOKEN}`);
	const cell = () => page.getByRole("button", { name: /18 Aug/ });
	const choose = async (answer: string) => {
		await cell().click();
		// Scoped to this cell's own menu: a menu that is animating out is still in
		// the document for a moment, so "the Yes button" is briefly ambiguous.
		await page
			.getByRole("dialog", { name: /18 Aug/ })
			.getByRole("button", { exact: true, name: answer })
			.click();
	};

	await choose("If needed");
	await expect(cell()).toHaveAttribute("aria-label", /you answered if needed/);
	await choose("No");
	await expect(cell()).toHaveAttribute("aria-label", /you answered no/);

	// Clearing exists, and only once there is something to clear — a wrong click
	// must be undoable, not merely overwritable.
	await choose("Clear");
	await expect(cell()).toHaveAttribute("aria-label", /have not answered/);
	await cell().click();
	await expect(
		page
			.getByRole("dialog", { name: /18 Aug/ })
			.getByRole("button", { exact: true, name: "Clear" }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");

	await choose("Yes");
	const submit = page.getByRole("button", { name: "Send my answers" });
	await submit.click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(submit).toBeEnabled();
	expect(sentVotes?.votes).toEqual([{ slotID: "slot-tue", value: "yes" }]);

	// The page follows the reader's theme, and a grid of tinted marks is exactly
	// where a dark scheme goes quietly unreadable.
	await page.getByRole("button", { name: /Use dark theme/ }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.evaluate(() =>
		Promise.all(document.getAnimations().map((animation) => animation.finished)),
	);
	await expectNoAccessibilityViolations(page);
});
