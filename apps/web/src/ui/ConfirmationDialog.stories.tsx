import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Button } from "./Button";
import {
  ConfirmationDialog,
  ConfirmationNotice,
  DialogError,
} from "./ConfirmationDialog";
import { Field } from "./Field";

function DeleteCalendarExample({ withError = false }: { withError?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open confirmation
      </Button>
      <ConfirmationDialog
        closeLabel="Close calendar deletion"
        confirmLabel="Delete calendar"
        description="The calendar and every event in it will be permanently removed."
        onConfirm={() => setOpen(false)}
        onOpenChange={setOpen}
        open={open}
        title="Delete “Family”?"
      >
        <ConfirmationNotice
          icon={<AlertTriangle size={19} strokeWidth={1.6} />}
        >
          <p>
            This can’t be undone. Shared members will also lose access to{" "}
            <strong>Family</strong>.
          </p>
        </ConfirmationNotice>
        {withError ? (
          <DialogError requestId="request-8f21">
            The calendar could not be deleted.
          </DialogError>
        ) : null}
      </ConfirmationDialog>
    </>
  );
}

function TypedConfirmationExample() {
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open typed confirmation
      </Button>
      <ConfirmationDialog
        closeLabel="Close account deletion"
        confirmDisabled={confirmation !== "Aiko Mori"}
        confirmForm="delete-account-story-form"
        confirmLabel="Delete account"
        description="Permanently removes your account after email confirmation."
        initialFocus={inputRef}
        onOpenChange={setOpen}
        open={open}
        title="Delete account?"
      >
        <form
          id="delete-account-story-form"
          onSubmit={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <Field label="Type Aiko Mori to confirm" variant="plain">
            <input
              autoComplete="off"
              ref={inputRef}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
        </form>
      </ConfirmationDialog>
    </>
  );
}

const meta = {
  args: {
    children: null,
    closeLabel: "Close confirmation",
    confirmLabel: "Confirm",
    description: "Describe the consequence before the user commits.",
    onConfirm: () => undefined,
    onOpenChange: () => undefined,
    open: false,
    title: "Confirm action",
  },
  component: ConfirmationDialog,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  title: "Patterns/Confirmation Dialog",
} satisfies Meta<typeof ConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const openDeleteDialog: NonNullable<Story["play"]> = async ({
  canvasElement,
}) => {
  const canvas = within(canvasElement);
  await userEvent.click(
    canvas.getByRole("button", { name: "Open confirmation" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Delete “Family”?",
  });
  await waitFor(() => expect(dialog).toBeVisible());
  await expect(
    within(dialog).getByRole("button", { name: "Cancel" }),
  ).toHaveFocus();
};

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: openDeleteDialog,
  render: () => <DeleteCalendarExample />,
};

export const ErrorState: Story = {
  play: openDeleteDialog,
  render: () => <DeleteCalendarExample withError />,
};

export const TypedConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Open typed confirmation" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Delete account?",
    });
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(within(dialog).getByRole("textbox")).toHaveFocus();
  },
  render: () => <TypedConfirmationExample />,
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
  play: openDeleteDialog,
  render: () => <DeleteCalendarExample />,
};
