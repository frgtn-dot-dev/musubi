import {
  createPage,
  ensureDefaultPage,
  getPage,
  getUserSettings,
  listPages,
  reorderPages,
  savePage,
  softDeletePage,
  type PageRow,
} from "@musubi/db";
import {
  BadRequestError,
  CreatePageRequestSchema,
  defaultPageConfig,
  NotFoundError,
  PageDocumentSchema,
  ReorderPagesRequestSchema,
  SavePageRequestSchema,
  type PageDocument,
  type PageViewId,
} from "@musubi/types";
import { Request, Response } from "express";
import { notifyCalendarMembers } from "./stream";

// Pages are per-user; realtime updates only fan out to the same user's other
// sessions. The originating client dedupes by revision.
function notifyPages(userID: string, type: string, payload: Record<string, unknown>) {
  notifyCalendarMembers([userID], type, payload);
}

function pageDocument(row: PageRow): PageDocument {
  return PageDocumentSchema.parse({
    id: row.id,
    name: row.name,
    position: row.position,
    isDefault: row.isDefault,
    config: row.config,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

// Settings keep the agenda view under the legacy id "schedule"; the Page view
// registry calls it "agenda".
function defaultView(settingsView: string): PageViewId {
  if (settingsView === "schedule") return "agenda";
  if (settingsView === "week" || settingsView === "day" || settingsView === "month") {
    return settingsView;
  }
  return "month";
}

export async function handlerListPages(req: Request, res: Response) {
  const settings = await getUserSettings(req.user!.id);
  const rows = await ensureDefaultPage(req.user!.id, {
    name: "My calendar",
    config: defaultPageConfig(defaultView(settings.defaultCalendarView)),
  });
  res.status(200).json(rows.map(pageDocument));
}

export async function handlerGetPage(req: Request, res: Response) {
  const row = await getPage(req.user!.id, req.params.id as string);
  if (!row) throw new NotFoundError("Page not found.");
  res.status(200).json(pageDocument(row));
}

export async function handlerCreatePage(req: Request, res: Response) {
  const parsed = CreatePageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError("Request is missing valid page data.");
  }

  const row = await createPage(req.user!.id, parsed.data);
  const page = pageDocument(row);
  notifyPages(req.user!.id, "page_created", { page });
  res.status(201).json(page);
}

export async function handlerSavePage(req: Request, res: Response) {
  const parsed = SavePageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError("Request is missing a valid page document.");
  }

  const result = await savePage(
    req.user!.id,
    req.params.id as string,
    parsed.data.baseRevision,
    { name: parsed.data.name, config: parsed.data.config },
  );

  if (result.status === "not_found") {
    throw new NotFoundError("Page not found.");
  }

  if (result.status === "conflict") {
    return res.status(409).json({
      current: pageDocument(result.page),
      error: "PAGE_CONFLICT",
      message: "Page changed on another device.",
      requestId: req.requestId,
    });
  }

  const page = pageDocument(result.page);
  notifyPages(req.user!.id, "page_updated", { page });
  return res.status(200).json(page);
}

export async function handlerDeletePage(req: Request, res: Response) {
  const id = req.params.id as string;
  const result = await softDeletePage(req.user!.id, id);
  if (result.status === "not_found") {
    throw new NotFoundError("Page not found.");
  }

  notifyPages(req.user!.id, "page_removed", { id });
  if (result.nextDefault) {
    notifyPages(req.user!.id, "page_updated", {
      page: pageDocument(result.nextDefault),
    });
  }
  res.status(200).json({ id });
}

export async function handlerReorderPages(req: Request, res: Response) {
  const parsed = ReorderPagesRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError("Request is missing a valid page order.");
  }

  const result = await reorderPages(
    req.user!.id,
    parsed.data.pageIds,
    parsed.data.defaultPageId,
  );
  if (result.status === "invalid_order") {
    throw new BadRequestError(
      "Page order must contain every active page exactly once.",
    );
  }

  const pages = result.pages.map(pageDocument);
  for (const page of pages) {
    notifyPages(req.user!.id, "page_updated", { page });
  }
  res.status(200).json(pages);
}
