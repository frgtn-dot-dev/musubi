import { Alert } from "react-native";

/**
 * The one sign-in refusal that is not about the passphrase.
 *
 * A server run with REQUIRE_EMAIL_VERIFICATION answers an unconfirmed account
 * with 403 and this code. Showing "check your email and passphrase" there sends
 * someone to reset a password that works perfectly.
 */
export const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

export function isEmailNotVerified(error: unknown) {
  return (error as { code?: string } | null)?.code === EMAIL_NOT_VERIFIED;
}

/**
 * Tell the person where the next step actually is, and offer a second link.
 *
 * The server already sends one on every refused sign-in; the button is for the
 * mail that never arrives. Whether the address exists is not revealed either
 * way — the wording is the same for a typo as for a real account.
 */
export function alertEmailNotVerified(
  email: string,
  resend: (email: string) => Promise<unknown>,
) {
  Alert.alert(
    "Confirm your email",
    `This server asks you to confirm your address before signing in. We sent a link to ${email} — it expires in an hour.`,
    [
      { style: "cancel", text: "OK" },
      {
        onPress: () => void resend(email).catch(() => undefined),
        text: "Send again",
      },
    ],
  );
}

/**
 * Sign-up on a server that requires confirmation creates the account but no
 * session, which Better Auth reports as a null token. Routing into the app on
 * that would land on the auth guard and bounce back with nothing said.
 */
export function isAwaitingConfirmation(data: { token?: string | null } | null | undefined) {
  return !data?.token;
}
