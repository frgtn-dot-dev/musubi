import { useState, type FormEvent, type ReactNode } from "react";
import { authClient } from "~/auth/auth-client";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import styles from "./email-identity.module.css";

type Identity = { email: string; name: string };

/**
 * Passwordless identity without revealing whether an email already has an
 * account. An existing account supplies its saved name after the code; a new
 * account asks for one only then.
 */
export function EmailIdentity({
  busy = false,
  confirmLabel = "Continue",
  disclosure,
  onIdentified,
  onStart,
}: {
  busy?: boolean;
  confirmLabel?: string;
  disclosure?: ReactNode;
  onIdentified: (identity: Identity) => void;
  onStart?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [needsName, setNeedsName] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const normalizedEmail = email.trim().toLowerCase();

  function identified(savedName: string) {
    onIdentified({ email: normalizedEmail, name: savedName });
  }

  async function requestCode() {
    setMessage("");
    setPending(true);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: normalizedEmail,
      type: "sign-in",
    });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "That code could not be sent.");
      return;
    }
    onStart?.();
    setSent(true);
  }

  async function confirmCode() {
    setMessage("");
    setPending(true);
    const result = await authClient.signIn.emailOtp({
      email: normalizedEmail,
      otp: code.trim(),
    });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "That code did not work.");
      return;
    }

    const savedName = result.data?.user.name?.trim();
    if (savedName) {
      identified(savedName);
      return;
    }
    setNeedsName(true);
  }

  async function saveName() {
    const savedName = name.trim();
    if (!savedName) return;

    setMessage("");
    setPending(true);
    const result = await authClient.updateUser({ name: savedName });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "That name could not be saved.");
      return;
    }
    identified(savedName);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void (needsName ? saveName() : sent ? confirmCode() : requestCode());
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {disclosure}

      {needsName ? (
        <Field label="Your name">
          <input
            autoComplete="name"
            name="name"
            placeholder="How other people know you"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      ) : sent ? (
        <Field label="Code from your email">
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            name="code"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
      ) : (
        <Field label="Email">
          <input
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            name="email"
            placeholder="you@example.com"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      )}

      {message ? (
        <p className={styles.error} role="alert">
          {message}
        </p>
      ) : null}

      <Button
        disabled={needsName && !name.trim()}
        loading={busy || pending}
        type="submit"
      >
        {needsName ? confirmLabel : sent ? "Confirm" : "Send me a code"}
      </Button>
    </form>
  );
}
