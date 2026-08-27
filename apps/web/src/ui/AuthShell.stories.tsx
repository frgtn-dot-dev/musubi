import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState, type FormEvent } from "react";
import { expect, userEvent, within } from "storybook/test";
import { MOBILE_MODES } from "../../.storybook/modes";
import { Button } from "./Button";
import { Field } from "./Field";
import {
  AuthAsideLead,
  AuthForm,
  AuthHint,
  AuthMessage,
  AuthProviders,
  AuthShell,
  AuthSubmit,
  AuthSwitch,
} from "./AuthShell";

function SignInExample({ initialError = "" }: { initialError?: string }) {
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
  }

  return (
    <AuthShell
      aside={
        <>
          <AuthAsideLead>
            You can also continue with an account you already have.
          </AuthAsideLead>
          <AuthProviders>
            <Button variant="secondary">Continue with Google</Button>
            <Button variant="secondary">Continue with Microsoft</Button>
            <Button variant="secondary">Continue with Apple</Button>
          </AuthProviders>
        </>
      }
      eyebrow="Private by default"
      introduction="Open your calendars from your own Musubi server."
      title="Welcome back"
      utility={
        <Button size="compact" variant="ghost">
          Dark theme
        </Button>
      }
      footer={
        <AuthSwitch action="Create account" onAction={() => undefined}>
          New to Musubi?
        </AuthSwitch>
      }
    >
      <AuthForm onSubmit={submit}>
        <Field label="Server URL" variant="plain">
          <input defaultValue="https://calendar.example.com" type="url" />
        </Field>
        <Field label="Email" variant="plain">
          <input defaultValue="mika@example.com" type="email" />
        </Field>
        <Field label="Password" variant="plain">
          <input defaultValue="correct horse battery staple" type="password" />
        </Field>
        <AuthHint>
          <Button size="compact" variant="secondary">
            Forgotten your passphrase?
          </Button>
        </AuthHint>
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        <AuthSubmit loading={pending} type="submit">
          Sign in
        </AuthSubmit>
      </AuthForm>
    </AuthShell>
  );
}

const meta = {
  args: {
    children: null,
    eyebrow: "Private by default",
    introduction: "Open your calendars from your own Musubi server.",
    title: "Welcome back",
  },
  component: AuthShell,
  parameters: {
    layout: "fullscreen",
  },
  title: "Screens/Authentication",
} satisfies Meta<typeof AuthShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
    await expect(
      canvas.getByRole("button", { name: "Sign in" }),
    ).toHaveAttribute("aria-busy", "true");
  },
  render: () => <SignInExample />,
};

export const ServerError: Story = {
  render: () => (
    <SignInExample initialError="We could not reach this Musubi server." />
  ),
};

/** One column at every width — what onboarding's short steps use. */
export const Stacked: Story = {
  render: () => (
    <AuthShell
      eyebrow="Step 1 of 3"
      introduction="Two questions and you are in. Everything here can be changed later in settings."
      layout="stacked"
      title="Welcome to Musubi"
    >
      <Field label="Your name">
        <input defaultValue="Mika" />
      </Field>
      <Button>Continue</Button>
    </AuthShell>
  ),
};

export const Narrow: Story = {
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile1",
    },
  },
  parameters: {
    chromatic: {
      modes: MOBILE_MODES,
    },
  },
  render: () => <SignInExample />,
};
