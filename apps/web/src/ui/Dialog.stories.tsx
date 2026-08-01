import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Button } from "./Button";
import { Dialog, DialogClose } from "./Dialog";
import { Field } from "./Field";

function DialogExample() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      closeLabel="Close page settings"
      description="Choose the name used in the sidebar."
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={() => setOpen(false)}>Save changes</Button>
        </>
      }
      open={open}
      title="Page settings"
      trigger={<Button variant="secondary">Open dialog</Button>}
      onOpenChange={setOpen}
    >
      <Field label="Page name" variant="plain">
        <input defaultValue="Work" />
      </Field>
    </Dialog>
  );
}

function FlushDialogExample() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      bodyLayout="flush"
      closeLabel="Close calendar settings"
      description="These settings apply to everyone using this calendar."
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={() => setOpen(false)}>Save changes</Button>
        </>
      }
      open={open}
      title="Calendar settings"
      trigger={<Button variant="secondary">Open flush dialog</Button>}
      onOpenChange={setOpen}
    >
      <Field label="Calendar name" variant="section">
        <input defaultValue="Family" />
      </Field>
      <Field label="Description" variant="section">
        <input defaultValue="Plans everyone can see" />
      </Field>
    </Dialog>
  );
}

const meta = {
  args: {
    children: null,
    closeLabel: "Close dialog",
    description: "Dialog description",
    onOpenChange: () => undefined,
    open: false,
    title: "Dialog title",
  },
  component: Dialog,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  title: "Primitives/Dialog",
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const openDialog: NonNullable<Story["play"]> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(
    canvas.getByRole("button", { name: "Open dialog" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Page settings" });
  await waitFor(() => expect(dialog).toBeVisible());
};

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: openDialog,
  render: () => <DialogExample />,
};

export const NarrowSheet: Story = {
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
  play: openDialog,
  render: () => <DialogExample />,
};

export const FlushBody: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Open flush dialog" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Calendar settings",
    });
    await waitFor(() => expect(dialog).toBeVisible());
  },
  render: () => <FlushDialogExample />,
};
