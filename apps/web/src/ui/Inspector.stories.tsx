import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { X } from "lucide-react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Button, IconButton } from "./Button";
import { Field } from "./Field";
import { Inspector, InspectorClose, InspectorContent, InspectorHeaderActions, InspectorTrigger } from "./Inspector";
import type { InspectorPresentation } from "./inspector-preferences";
import styles from "./primitives.module.css";

function Example({ initialPresentation = "panel" }: { initialPresentation?: InspectorPresentation }) {
  const [open, setOpen] = useState(true);
  const [presentation, setPresentation] = useState(initialPresentation);
  return <Inspector open={open} onOpenChange={setOpen} presentation={presentation} onPresentationChange={setPresentation}
    onRequestClose={after => { setOpen(false); after(); }}>
    <InspectorTrigger asChild><Button variant="secondary">Weekend plans</Button></InspectorTrigger>
    <InspectorContent accessibleTitle="Edit event" onFocusOutside={event => event.preventDefault()}>
      <header data-inspector-header="" className={styles.dialogHeader}>
        <h2 className={styles.dialogTitle}>Edit event</h2>
        <InspectorHeaderActions><InspectorClose asChild><IconButton label="Close event editor" size="compact"><X size={17} /></IconButton></InspectorClose></InspectorHeaderActions>
      </header>
      <div className={`${styles.dialogBody} ${styles.dialogBody_padded} ${styles.inspectorFormBody}`}>
        <Field label="Event title"><input defaultValue="A walk by the river" /></Field>
        <Field label="Location"><input defaultValue="Meet at the footbridge" /></Field>
        <Field label="Notes"><textarea defaultValue="Bring something for a picnic." /></Field>
      </div>
      <footer className={styles.dialogFooter}><InspectorClose asChild><Button variant="secondary">Cancel</Button></InspectorClose><Button onClick={() => setOpen(false)}>Save</Button></footer>
    </InspectorContent>
  </Inspector>;
}

const meta = { title: "Primitives/Inspector", parameters: { layout: "fullscreen" }, render: () => <Example /> } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const SidePanel: Story = { parameters: { chromatic: { modes: DESKTOP_MODES } } };
export const FloatingWindow: Story = { parameters: { chromatic: { modes: DESKTOP_MODES } }, render: () => <Example initialPresentation="floating" /> };
export const NarrowPanel: Story = {
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
  render: () => <Example initialPresentation="floating" />,
};
export const PreserveDraft: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Edit event" });
    const field = within(dialog).getByRole("textbox", { name: "Event title" });
    await userEvent.clear(field);
    await userEvent.type(field, "Picnic with Alex");
    await userEvent.click(within(dialog).getByRole("button", { name: "Float window" }));
    await expect(dialog).toHaveAttribute("data-presentation", "floating");
    await expect(field).toHaveValue("Picnic with Alex");
    await userEvent.click(within(dialog).getByRole("button", { name: "Dock to side" }));
    await expect(dialog).toHaveAttribute("data-presentation", "panel");
    await expect(field).toHaveValue("Picnic with Alex");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close event editor" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Weekend plans" })).toHaveFocus());
  },
};
