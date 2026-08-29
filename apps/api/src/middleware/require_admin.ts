import { config } from "@musubi/config";
import { ForbiddenError } from "@musubi/types";
import type { NextFunction, Request, Response } from "express";

/**
 * Je tenhle e-mail na seznamu adminů?
 *
 * Obě strany se normalizují: e-mail ze sociálního přihlášení dorazí v jiném
 * psaní, než jaký si majitel serveru napsal do `.env`, a rozhodovat o právech
 * podle velikosti písmen by byla past.
 *
 * Prázdný seznam neuzná nikoho. "Server bez adminů" musí znamenat, že admin
 * endpointy jsou zavřené — ne otevřené všem.
 */
export function isAdminEmailIn(
  adminEmails: readonly string[],
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return adminEmails.includes(email.trim().toLowerCase());
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return isAdminEmailIn(config.security.adminEmails, email);
}

/** Testovatelná varianta — seznam se vstříkne místo čtení konfigurace. */
export function createRequireAdmin(adminEmails: readonly string[]) {
  return function requireAdminWith(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    if (!isAdminEmailIn(adminEmails, req.user?.email)) {
      throw new ForbiddenError("Admin only");
    }
    next();
  };
}

/**
 * Běží VŽDY za `requireAuth`. Sám o sobě neautentizuje — jen se ptá, jestli
 * ten, koho `requireAuth` už poznal, je na seznamu.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  return createRequireAdmin(config.security.adminEmails)(req, res, next);
}
