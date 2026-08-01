import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
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

export const Overview: Story = {
  render: () => <DialogExample />,
};

export const NarrowSheet: Story = {
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile1",
    },
  },
  render: () => <DialogExample />,
};
