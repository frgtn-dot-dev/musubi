import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

const { alertEmailNotVerified, isAwaitingConfirmation, isEmailNotVerified } =
  await import("@/lib/emailVerification");
const { Alert } = await import("react-native");

describe("email verification", () => {
  it("tells the one refusal that is not about the passphrase apart", () => {
    expect(isEmailNotVerified({ code: "EMAIL_NOT_VERIFIED" })).toBe(true);
    // A wrong password must keep its own message, or people reset a working one.
    expect(isEmailNotVerified({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(false);
    expect(isEmailNotVerified({ message: "Email not verified" })).toBe(false);
    expect(isEmailNotVerified(null)).toBe(false);
  });

  it("offers a second link without saying whether the account exists", async () => {
    const resend = vi.fn().mockResolvedValue(undefined);
    alertEmailNotVerified("someone@example.com", resend);

    const [title, body, buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(title).toBe("Confirm your email");
    expect(body).toContain("someone@example.com");
    // Nothing in the wording distinguishes a typo from a real address.
    expect(body).not.toMatch(/exists|no account|unknown/i);

    const again = (buttons as { onPress?: () => void; text: string }[]).find(
      (button) => button.text === "Send again",
    );
    again?.onPress?.();
    expect(resend).toHaveBeenCalledWith("someone@example.com");
  });

  it("treats a sessionless sign-up as waiting on the inbox", () => {
    expect(isAwaitingConfirmation({ token: null })).toBe(true);
    expect(isAwaitingConfirmation(undefined)).toBe(true);
    expect(isAwaitingConfirmation({ token: "session-token" })).toBe(false);
  });
});
