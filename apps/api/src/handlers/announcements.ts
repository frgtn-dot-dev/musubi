import {
  deleteAnnouncement,
  getUserSettings,
  insertAnnouncement,
  listAnnouncementIdsOn,
  listAnnouncements,
  listAnnouncementsAfter,
  updateAnnouncement,
  type AnnouncementRow,
} from "@musubi/db";
import {
  AnnouncementInputSchema,
  BadRequestError,
  mintAnnouncementId,
  NotFoundError,
} from "@musubi/types";
import type { Request, Response } from "express";
import { isAdminEmail } from "../middleware/require_admin";

/** Jen to, co klient potřebuje. Časy nikdo nečte a kontrakt je bez nich menší. */
function toWire(row: AnnouncementRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    minVersion: row.minVersion,
  };
}

/** Dnešek jako `YYYY-MM-DD` v UTC — id musí být stejné bez ohledu na zónu serveru. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createGetAnnouncementsHandler(
  dependencies: {
    getSettings?: typeof getUserSettings;
    isAdmin?: typeof isAdminEmail;
    listAfter?: typeof listAnnouncementsAfter;
    listNewest?: typeof listAnnouncements;
  } = {},
) {
  const getSettings = dependencies.getSettings ?? getUserSettings;
  const admin = dependencies.isAdmin ?? isAdminEmail;
  const listAfter = dependencies.listAfter ?? listAnnouncementsAfter;
  const listNewest = dependencies.listNewest ?? listAnnouncements;

  return async function getAnnouncements(req: Request, res: Response) {
    const settings = await getSettings(req.user!.id);
    const isAdmin = admin(req.user!.email);
    const seen = settings.lastSeenAnnouncement ?? "";

    // První pohled: účet, který ještě nic neviděl — nově registrovaný i každý
    // stávající v den nasazení této featury. Nedostane NIC k zobrazení, jen
    // `markTo`, kam si má posunout značku. Bez toho by dostal modal se všemi
    // novinkami za celou historii produktu, ke kterým se nemá jak vztáhnout.
    if (!seen) {
      const [newest] = await listNewest();
      // An empty table (deploy day, before the admin has written anything)
      // still needs a truthy `markTo`: omitting it here would leave every
      // user's mark at `""`, still first-sight, so the FIRST announcement
      // ever published would also hit this branch and get silently marked
      // seen instead of shown. "0000-00-00" sorts below every real
      // `YYYY-MM-DD[-N]` id, so it satisfies `gt(id, afterId)` in
      // listAnnouncementsAfter (any real id compares greater) and fits
      // `z.string().max(64)` in SettingsSchema/SettingsPatchSchema.
      res.status(200).json({
        announcements: [],
        isAdmin,
        markTo: newest?.id ?? "0000-00-00",
      });
      return;
    }

    const rows = await listAfter(seen);
    res.status(200).json({ announcements: rows.map(toWire), isAdmin });
  };
}

export const handlerGetAnnouncements = createGetAnnouncementsHandler();

export function createListAllAnnouncementsHandler(
  dependencies: { list?: typeof listAnnouncements } = {},
) {
  const list = dependencies.list ?? listAnnouncements;
  return async function listAll(_req: Request, res: Response) {
    const rows = await list();
    res.status(200).json({ announcements: rows.map(toWire) });
  };
}

export const handlerListAllAnnouncements = createListAllAnnouncementsHandler();

function parseInput(body: unknown) {
  const parsed = AnnouncementInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError("Announcement needs a title and a body.");
  }
  return parsed.data;
}

export function createCreateAnnouncementHandler(
  dependencies: {
    idsOn?: typeof listAnnouncementIdsOn;
    insert?: typeof insertAnnouncement;
    today?: () => string;
  } = {},
) {
  const idsOn = dependencies.idsOn ?? listAnnouncementIdsOn;
  const insert = dependencies.insert ?? insertAnnouncement;
  const today = dependencies.today ?? todayKey;

  return async function createAnnouncement(req: Request, res: Response) {
    const input = parseInput(req.body);
    const dateKey = today();
    const id = mintAnnouncementId(dateKey, await idsOn(dateKey));

    const created = await insert({
      id,
      title: input.title,
      body: input.body,
      // Nevyplněné pole je NULL, ne prázdný řetězec: prázdno se nedá porovnávat
      // jako verze a `null` je jediná podoba "týká se všech".
      minVersion: input.minVersion || null,
    });

    res.status(201).json(toWire(created));
  };
}

export const handlerCreateAnnouncement = createCreateAnnouncementHandler();

export function createUpdateAnnouncementHandler(
  dependencies: { update?: typeof updateAnnouncement } = {},
) {
  const update = dependencies.update ?? updateAnnouncement;

  return async function patchAnnouncement(req: Request, res: Response) {
    const input = parseInput(req.body);
    // `id` se nemění: je to značka, kterou už mají uživatelé uloženou. Oprava
    // překlepu se nikomu neukáže znovu, a to je zamýšlené — nová informace je
    // nová zpráva.
    const updated = await update(req.params.id as string, {
      title: input.title,
      body: input.body,
      minVersion: input.minVersion || null,
    });

    if (!updated) throw new NotFoundError("No such announcement.");
    res.status(200).json(toWire(updated));
  };
}

export const handlerUpdateAnnouncement = createUpdateAnnouncementHandler();

export function createDeleteAnnouncementHandler(
  dependencies: { remove?: typeof deleteAnnouncement } = {},
) {
  const remove = dependencies.remove ?? deleteAnnouncement;

  return async function removeAnnouncement(req: Request, res: Response) {
    const removed = await remove(req.params.id as string);
    if (!removed) throw new NotFoundError("No such announcement.");
    res.status(200).json({ deleted: true });
  };
}

export const handlerDeleteAnnouncement = createDeleteAnnouncementHandler();
