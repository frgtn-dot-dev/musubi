import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import {
  AuthForm,
  AuthMessage,
  AuthShell,
  AuthSubmit,
  AuthSwitch,
} from "~/ui/AuthShell";
import { Field } from "~/ui/Field";
import { RouteState } from "~/ui/RouteState";

const loginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  component: LoginRoute,
});

function safeRedirect(value: string | undefined) {
  return value?.startsWith("/app/") ? value : "/app/p/default/month";
}

function errorMessage(error: { message?: string } | null | undefined) {
  return error?.message ?? "We could not sign you in. Check your details and try again.";
}

// The server refuses a sign-in until the address is confirmed, when the operator
// has asked for that. Better Auth answers with a code rather than only prose, so
// this one case can be explained instead of read as a wrong passphrase.
const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

function LoginRoute() {
  const session = authClient.useSession();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // The address a confirmation link went to, which is also the sign that the
  // form has nothing left to do: there is no password to retry, only an inbox.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState("");
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (session.data) {
      window.location.replace(safeRedirect(redirect));
    }
  }, [redirect, session.data]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setMessage("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setMessage("Your passphrase needs at least 8 characters.");
      return;
    }
    if (mode === "sign-up" && name.trim().length < 2) {
      setMessage("Enter at least two characters for your name.");
      return;
    }
    if (mode === "sign-up" && password !== confirmPassword) {
      setMessage("The passphrases do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({
              email: normalizedEmail,
              password,
            })
          : await authClient.signUp.email({
              email: normalizedEmail,
              name: name.trim(),
              password,
            });

      if (result.error) {
        if (
          (result.error as { code?: string }).code === EMAIL_NOT_VERIFIED
        ) {
          // The server sends a fresh link on every refused sign-in, so this is a
          // statement of fact rather than an instruction to do something.
          setAwaitingConfirmation(normalizedEmail);
          return;
        }
        setMessage(errorMessage(result.error));
        return;
      }

      // Signing up on a server that requires confirmation creates the account but
      // no session — `token` is null. Redirecting would bounce straight back to
      // this page with nothing said, which reads as a failure rather than a step.
      if (!result.data?.token) {
        setAwaitingConfirmation(normalizedEmail);
        return;
      }

      window.location.assign(safeRedirect(redirect));
    } catch {
      setMessage("The server could not be reached. Check the connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resendConfirmation() {
    setResent(true);
    // Nothing branches on the outcome on purpose: whether the address exists is
    // not this page's to reveal, and the person is told to check the inbox either
    // way. A failure to send is the server's to log.
    await authClient
      .sendVerificationEmail({
        callbackURL: "/",
        email: awaitingConfirmation,
      })
      .catch(() => undefined);
  }

  function switchMode() {
    setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
    setMessage("");
    setAwaitingConfirmation("");
    setResent(false);
    setPassword("");
    setConfirmPassword("");
  }

  const signingUp = mode === "sign-up";

  if (session.data) {
    return (
      <RouteState
        busy
        eyebrow="Signed in"
        title="Opening your calendar…"
      />
    );
  }

  // Nothing on the form can move this forward — the next step is in an inbox —
  // so the form goes away rather than inviting a retry that cannot work.
  if (awaitingConfirmation) {
    return (
      <AuthShell
        eyebrow="One more step"
        footer={
          <AuthSwitch action="Back to sign in" onAction={switchMode}>
            Confirmed it already?
          </AuthSwitch>
        }
        introduction={`This server asks you to confirm your address before signing in. We sent a link to ${awaitingConfirmation} — it expires in an hour.`}
        title="Check your email."
        utility={<ThemeToggle />}
      >
        <AuthSubmit
          disabled={resent}
          onClick={() => void resendConfirmation()}
          type="button"
          variant="secondary"
        >
          {resent ? "Link sent again" : "Send the link again"}
        </AuthSubmit>
        <AuthMessage>
          {resent ? "Give it a minute, then look in spam." : ""}
        </AuthMessage>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={signingUp ? "A new shared space" : "Welcome back"}
      footer={
        <AuthSwitch
          action={signingUp ? "Sign in" : "Create one"}
          onAction={switchMode}
        >
          {signingUp ? "Already have an account?" : "New to this server?"}
        </AuthSwitch>
      }
      introduction={
        signingUp
          ? "Your name, email and a private passphrase. That is all."
          : "Sign in to read the calendars held by this Musubi server."
      }
      title={signingUp ? "Begin simply." : "Pick up where you left off."}
      utility={<ThemeToggle />}
    >
      <AuthForm onSubmit={handleSubmit} noValidate>
        {signingUp ? (
          <Field label="Name" variant="plain">
            <input
              autoComplete="name"
              autoFocus
              name="name"
              placeholder="Your name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Email" variant="plain">
          <input
            autoCapitalize="none"
            autoComplete="email"
            autoFocus={!signingUp}
            inputMode="email"
            name="email"
            placeholder="you@example.com"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Passphrase" variant="plain">
          <input
            autoComplete={signingUp ? "new-password" : "current-password"}
            minLength={8}
            name="password"
            placeholder="At least 8 characters"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {signingUp ? (
          <Field label="Confirm passphrase" variant="plain">
            <input
              autoComplete="new-password"
              minLength={8}
              name="confirm-password"
              placeholder="Repeat your passphrase"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
        ) : null}

        <AuthMessage>{message}</AuthMessage>
        <AuthSubmit loading={submitting} type="submit">
          {submitting
            ? signingUp
              ? "Creating account…"
              : "Signing in…"
            : signingUp
              ? "Create account"
              : "Continue"}
        </AuthSubmit>
      </AuthForm>
    </AuthShell>
  );
}
