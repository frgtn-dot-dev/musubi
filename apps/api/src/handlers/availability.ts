import type { Request, Response } from "express";
import { listAvailabilitySources, setAvailabilitySelection } from "@musubi/db";
import { AvailabilitySourcesSchema } from "@musubi/types";
import { z } from "zod";
import { readGoogleAvailability, requireAvailabilityEnabled } from "../sync/google_availability";
export async function handlerAvailabilitySources(req: Request, res: Response) {
  requireAvailabilityEnabled(); res.setHeader("Cache-Control", "no-store");
  res.json(AvailabilitySourcesSchema.parse({ sources: await listAvailabilitySources(req.user!.id) }));
}
export async function handlerAvailabilitySelection(req: Request, res: Response) {
  requireAvailabilityEnabled(); res.setHeader("Cache-Control", "no-store");
  await setAvailabilitySelection(req.user!.id, z.uuid().parse(req.params.id), req.body);
  res.json(AvailabilitySourcesSchema.parse({ sources: await listAvailabilitySources(req.user!.id) }));
}
export async function handlerAvailability(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store"); res.json(await readGoogleAvailability(req.user!.id, req.body));
}
