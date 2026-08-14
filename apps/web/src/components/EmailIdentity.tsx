import { useState, type FormEvent, type ReactNode } from "react";
import { authClient } from "~/auth/auth-client";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import styles from "./email-identity.module.css";

/**
 * "Who are you?", for somebody who has never heard of Musubi.
 *
 * A code to an address, and the account behind it is made on the way past — no
 * password to invent for one poll. Nothing is written before the address is
 * confirmed, so a name and an answer always belong to somebody who proved they
 * can read that inbox.
 *
 * The disclosure is a prop rather than copy of its own: what is about to be sent
 * differs per page, and the PRD asks for it to be said before it happens, not
 * discovered afterwards (§18.2, §19.1).
 */
export function EmailIdentity({
  askName = false,
  busy = false,
  confirmLabel = "Confirm",
  disclosure,
  onIdentified,
}: {
  /** Ask for a name here. Skip it when the page collects one of its own. */
  askName?: boolean;
  busy?: boolean;
  confirmLabel?: string;
  disclosure?: ReactNode;
  /** Signed in. The name is whatever they typed, empty if it was not asked. */
  onIdentified: (name: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function requestCode() {
    setMessage("");
    setPending(true);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim().toLowerCase(),
      type: "sign-in",
    });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "That code could not be sent.");
      return;
    }
    setSent(true);
  }

  async function confirmCode() {
    setMessage("");
    setPending(true);
    const result = await authClient.signIn.emailOtp({
      email: email.trim().toLowerCase(),
      otp: code.trim(),
    });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "That code did not work.");
      return;
    }
    onIdentified(name.trim());
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void (sent ? confirmCode() : requestCode());
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {disclosure}

      {sent ? (
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
        <>
          {askName ? (
            <Field label="Your name">
              <input
                autoComplete="name"
                name="name"
                placeholder="How other people know you"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          ) : null}
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
        </>
      )}

      {message ? (
        <p className={styles.error} role="alert">
          {message}
        </p>
      ) : null}

      <Button loading={busy || pending} type="submit">
        {sent ? confirmLabel : "Send me a code"}
      </Button>
    </form>
  );
}
