import { CLIENT_VERSION_HEADER, isCompatibleVersion, MIN_CLIENT_VERSION } from "@musubi/types";
import type { NextFunction, Request, Response } from "express";

/** Compatibility only, never authentication/authorization or event CAS.
 * Every requireAuth product route uses this, including member-token callers.
 * The sole authenticated exemption is credential rotation, whose handler still
 * requires an external member token. Public discovery/auth routes do not use it.
 */
export function requireClientVersion(req: Request, res: Response, next: NextFunction) {
  if (req.method === "POST" && /^\/api\/v1\/federation\/token\/rotate\/?$/.test(req.path)) return next();
  // Browser EventSource cannot set headers. Only this stream accepts the query
  // spelling; it is a public build identifier, not a credential.
  const version = req.get(CLIENT_VERSION_HEADER) ??
    (/^\/api\/stream\/?$/.test(req.path) ? req.query.clientVersion : undefined);
  if (!isCompatibleVersion(version, MIN_CLIENT_VERSION)) {
    return res.status(426).json({
      error: "ClientUpgradeRequired",
      message: `Update Musubi to ${MIN_CLIENT_VERSION} or newer to continue. Your open draft has not been submitted.`,
      minClientVersion: MIN_CLIENT_VERSION,
      requestId: req.requestId,
    });
  }
  return next();
}
