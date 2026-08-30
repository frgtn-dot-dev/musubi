import { config } from "@musubi/config";
import { ForbiddenError } from "@musubi/types";

/**
 * Whether this server can hold an address against the person using it.
 *
 * Verification only means anything where a confirmation can actually be sent.
 * `REQUIRE_EMAIL_VERIFICATION` refuses to turn on without SMTP, so a
 * self-hosted install without mail boots with it off — and every account there
 * carries `emailVerified: false` through no fault of its own. Reading the
 * column alone then locks scheduling behind a message nobody can ever receive,
 * while sign-in itself lets the same account straight through.
 *
 * The flag is the operator's answer to "can I prove who owns an address", so
 * every gate asks it first and the column second.
 */
export function requireVerifiedEmail<T extends { emailVerified?: boolean }>(
  user: T | undefined,
  message: string,
): T {
  // Not an address question: the routes behind this all run `requireAuth`, and
  // a missing session must stay refused whatever the operator configured.
  if (!user) throw new ForbiddenError(message);
  if (config.security.requireEmailVerification && !user.emailVerified) {
    throw new ForbiddenError(message);
  }
  return user;
}
