import {
  getUserSettings,
  patchUserSettings,
  saveUserSettings,
} from "@musubi/db";
import {
  BadRequestError,
  PatchSettingsRequestSchema,
  Settings,
  SettingsSchema,
  type SettingsDocument,
} from "@musubi/types";
import { Request, Response } from "express";
import { notifyCalendarMembers } from "./stream";

function settingsDocument(
  row: Awaited<ReturnType<typeof getUserSettings>>,
): SettingsDocument {
  return {
    revision: row.revision,
    updatedAt: row.updatedAt,
    value: SettingsSchema.parse(row),
  };
}

export async function handlerGetSettings(req: Request, res: Response) {
  const result = await getUserSettings(req.user!.id);

  res.status(200).json(result);
}

export async function handlerGetSettingsDocument(
  req: Request,
  res: Response,
) {
  const result = await getUserSettings(req.user!.id);
  res.status(200).json(settingsDocument(result));
}

export async function handlerSaveSettings(req: Request, res: Response) {
  let settings: Settings;

  try {
    settings = SettingsSchema.parse(req.body);
  } catch (err) {
    throw new BadRequestError("Request is missing valid settings data...");
  }

  const result = await saveUserSettings(req.user!.id, settings);
  notifyCalendarMembers([req.user!.id], "settings_updated", {
    revision: result.revision,
  });

  res.status(200).json(result);
}

export function createPatchSettingsHandler(
  dependencies: {
    notify?: typeof notifyCalendarMembers;
    patch?: typeof patchUserSettings;
  } = {},
) {
  const notify = dependencies.notify ?? notifyCalendarMembers;
  const patch = dependencies.patch ?? patchUserSettings;

  return async function patchSettings(req: Request, res: Response) {
    const parsed = PatchSettingsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        "Request is missing a valid settings patch.",
      );
    }

    const result = await patch(
      req.user!.id,
      parsed.data.baseRevision,
      parsed.data.patch,
    );
    const current = settingsDocument(result.settings);

    if (result.conflict) {
      return res.status(409).json({
        current,
        error: "SettingsConflict",
        message: "Settings changed on another device.",
        requestId: req.requestId,
      });
    }

    notify([req.user!.id], "settings_updated", {
      revision: current.revision,
    });
    return res.status(200).json(current);
  };
}

export const handlerPatchSettings = createPatchSettingsHandler();
