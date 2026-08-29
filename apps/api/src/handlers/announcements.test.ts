import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  createCreateAnnouncementHandler,
  createDeleteAnnouncementHandler,
  createGetAnnouncementsHandler,
  createUpdateAnnouncementHandler,
} from "./announcements";

function responseRecorder() {
  let statusCode = 0;
  let payload: any;
  const response = {
    json(body: unknown) {
      payload = body;
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
  } as unknown as Response;

  return { response, result: () => ({ payload, statusCode }) };
}

const row = (id: string, minVersion: string | null = null) => ({
  id,
  title: `t-${id}`,
  body: "b",
  minVersion,
  createdAt: new Date("2026-08-29T10:00:00.000Z"),
  updatedAt: new Date("2026-08-29T10:00:00.000Z"),
});

async function run() {
  // --- Vrací jen to, co je novější než značka, a nese příznak isAdmin ---
  {
    let askedAfter: string | undefined;
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "2026-08-10" }) as any,
      isAdmin: () => true,
      listAfter: async (afterId: string) => {
        askedAfter = afterId;
        return [row("2026-08-20"), row("2026-08-15")];
      },
      listNewest: async () => [row("2026-08-20")],
    })(
      { user: { id: "user-1", email: "owner@example.com" } } as Request,
      recorder.response,
    );

    assert.equal(askedAfter, "2026-08-10");
    const { payload, statusCode } = recorder.result();
    assert.equal(statusCode, 200);
    assert.equal(payload.isAdmin, true);
    assert.deepEqual(
      payload.announcements.map((a: { id: string }) => a.id),
      ["2026-08-20", "2026-08-15"],
    );
    // Časy se ven neposílají: klient je nepoužívá a wire kontrakt je pak menší.
    assert.equal("createdAt" in payload.announcements[0], false);
  }

  // --- Ne-admin dostane isAdmin: false ---
  {
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "" }) as any,
      isAdmin: () => false,
      listAfter: async () => [],
      listNewest: async () => [],
    })(
      { user: { id: "user-2", email: "someone@example.com" } } as Request,
      recorder.response,
    );
    assert.equal(recorder.result().payload.isAdmin, false);
  }

  // --- První pohled: uživatel bez značky nedostane NIC ---
  // Jinak by nový účet (a v den nasazení každý stávající) dostal celou historii
  // produktu naráz. Vrací se prázdno; klient si značku posune na `markTo`.
  {
    let listAfterCalled = false;
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "" }) as any,
      isAdmin: () => false,
      listAfter: async () => {
        listAfterCalled = true;
        return [row("2026-08-20"), row("2026-08-01")];
      },
      listNewest: async () => [row("2026-08-20")],
    })(
      { user: { id: "user-3", email: "new@example.com" } } as Request,
      recorder.response,
    );

    const { payload } = recorder.result();
    assert.equal(listAfterCalled, false);
    assert.deepEqual(payload.announcements, []);
    assert.equal(payload.markTo, "2026-08-20");
  }

  // --- Prázdný server: první pohled bez jediné zprávy neposílá značku ---
  {
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "" }) as any,
      isAdmin: () => false,
      listAfter: async () => [],
      listNewest: async () => [],
    })(
      { user: { id: "user-4", email: "new@example.com" } } as Request,
      recorder.response,
    );
    assert.equal(recorder.result().payload.markTo, undefined);
  }

  // --- Vytvoření: id se razí z dnešního data ---
  {
    let inserted: any;
    const recorder = responseRecorder();
    await createCreateAnnouncementHandler({
      idsOn: async () => [],
      insert: async (values: any) => {
        inserted = values;
        return { ...values, createdAt: new Date(), updatedAt: new Date() };
      },
      today: () => "2026-08-29",
    })(
      {
        body: { title: "New", body: "Body", minVersion: "0.1.7" },
        user: { id: "user-1", email: "owner@example.com" },
      } as Request,
      recorder.response,
    );

    assert.equal(recorder.result().statusCode, 201);
    assert.equal(inserted.id, "2026-08-29");
    assert.equal(inserted.minVersion, "0.1.7");
  }

  // --- Druhá zpráva téhož dne dostane příponu ---
  {
    let inserted: any;
    await createCreateAnnouncementHandler({
      idsOn: async () => ["2026-08-29"],
      insert: async (values: any) => {
        inserted = values;
        return { ...values, createdAt: new Date(), updatedAt: new Date() };
      },
      today: () => "2026-08-29",
    })(
      {
        body: { title: "Second", body: "Body" },
        user: { id: "user-1", email: "owner@example.com" },
      } as Request,
      responseRecorder().response,
    );
    assert.equal(inserted.id, "2026-08-29-2");
    // Nevyplněná verze se ukládá jako NULL, ne jako prázdný řetězec — jinak by
    // se prázdno pokoušelo porovnávat jako verze.
    assert.equal(inserted.minVersion, null);
  }

  // --- Nevalidní vstup je odmítnutý, ne uložený ---
  {
    await assert.rejects(
      () =>
        createCreateAnnouncementHandler({
          idsOn: async () => [],
          insert: async () => {
            throw new Error("must not be called");
          },
          today: () => "2026-08-29",
        })(
          {
            body: { title: "", body: "Body" },
            user: { id: "user-1", email: "owner@example.com" },
          } as Request,
          responseRecorder().response,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Announcement needs a title and a body.",
    );
  }

  // --- Oprava: vrací wire tvar, žádné časy ---
  {
    let updatedWith: any;
    const recorder = responseRecorder();
    await createUpdateAnnouncementHandler({
      update: async (id: string, values: any) => {
        updatedWith = values;
        return { id, ...values, createdAt: new Date(), updatedAt: new Date() };
      },
    })(
      {
        params: { id: "2026-08-20" },
        body: { title: "Fixed", body: "Body" },
        user: { id: "user-1", email: "owner@example.com" },
      } as unknown as Request,
      recorder.response,
    );

    const { payload, statusCode } = recorder.result();
    assert.equal(statusCode, 200);
    assert.deepEqual(payload, {
      id: "2026-08-20",
      title: "Fixed",
      body: "Body",
      minVersion: null,
    });
    assert.equal("createdAt" in payload, false);
    assert.equal(updatedWith.title, "Fixed");
    assert.equal(updatedWith.body, "Body");
    // Nevyplněná verze se ukládá jako NULL, ne jako prázdný řetězec — stejné
    // pravidlo jako u vytváření.
    assert.equal(updatedWith.minVersion, null);
  }

  // --- Oprava neexistujícího id: 404, ne tichý úspěch ---
  {
    const recorder = responseRecorder();
    await assert.rejects(
      () =>
        createUpdateAnnouncementHandler({
          update: async () => undefined,
        })(
          {
            params: { id: "no-such-id" },
            body: { title: "Fixed", body: "Body" },
            user: { id: "user-1", email: "owner@example.com" },
          } as unknown as Request,
          recorder.response,
        ),
      (error: unknown) =>
        error instanceof Error && error.message === "No such announcement.",
    );
    // Chyba se propaguje k `wrap`/error handleru — handler sám nic neposílá.
    assert.equal(recorder.result().statusCode, 0);
  }

  // --- Oprava s nevalidním vstupem je odmítnutá, update se nevolá ---
  {
    await assert.rejects(
      () =>
        createUpdateAnnouncementHandler({
          update: async () => {
            throw new Error("must not be called");
          },
        })(
          {
            params: { id: "2026-08-20" },
            body: { title: "", body: "Body" },
            user: { id: "user-1", email: "owner@example.com" },
          } as unknown as Request,
          responseRecorder().response,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Announcement needs a title and a body.",
    );
  }

  // --- Smazání: vrací potvrzení ---
  {
    const recorder = responseRecorder();
    await createDeleteAnnouncementHandler({
      remove: async () => true,
    })(
      {
        params: { id: "2026-08-20" },
        user: { id: "user-1", email: "owner@example.com" },
      } as unknown as Request,
      recorder.response,
    );

    const { payload, statusCode } = recorder.result();
    assert.equal(statusCode, 200);
    assert.deepEqual(payload, { deleted: true });
  }

  // --- Smazání neexistujícího id: 404, ne tichý úspěch ---
  {
    const recorder = responseRecorder();
    await assert.rejects(
      () =>
        createDeleteAnnouncementHandler({
          remove: async () => false,
        })(
          {
            params: { id: "no-such-id" },
            user: { id: "user-1", email: "owner@example.com" },
          } as unknown as Request,
          recorder.response,
        ),
      (error: unknown) =>
        error instanceof Error && error.message === "No such announcement.",
    );
    assert.equal(recorder.result().statusCode, 0);
  }

  console.log("announcements handler tests passed");
}

void run();
