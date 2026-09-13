import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { HelpTooltip } from "./HelpTooltip";
import { Row } from "./Row";
import { SettingsSection } from "./SettingsSection";
import styles from "./HelpTooltipStories.module.css";

const HELP = "Choose which calendar receives new events. You can choose a different calendar when creating an event.";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const gone = (phase = "dismissal") => waitFor(() => {
  if (screen.queryByRole("tooltip")) throw new Error(`Tooltip remained open after ${phase}`);
});
const shown = async () => {
  const tooltip = await screen.findByRole("tooltip");
  await waitFor(() => expect(tooltip).toBeVisible());
  return tooltip;
};
const expectTargetSize = (trigger: HTMLElement) => waitFor(() => {
  const touchLayout = matchMedia("(max-width: 599px), (pointer: coarse)").matches;
  const bounds = trigger.getBoundingClientRect();
  expect(bounds.width).toBe(touchLayout ? 44 : 24);
  expect(bounds.height).toBe(touchLayout ? 44 : 24);
});
const meta = {
  component: HelpTooltip,
  args: { label: "Help for Default calendar", children: HELP },
  parameters: { layout: "centered", chromatic: { modes: DESKTOP_MODES } },
  title: "Primitives/Help Tooltip",
  tags: ["autodocs"],
} satisfies Meta<typeof HelpTooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button");
    await expectTargetSize(trigger);
    const focusedBefore = document.activeElement;
    await userEvent.hover(trigger);
    await pause(150);
    await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    let tooltip = await shown();
    await expect(document.activeElement).toBe(focusedBefore);
    await expect(trigger).toHaveAccessibleDescription(HELP);
    await userEvent.unhover(trigger);
    await pause(70);
    await userEvent.hover(tooltip);
    await pause(200);
    await expect(tooltip).toBeVisible();
    // Escape while over content must not leave a stale hover reference.
    await userEvent.keyboard("{Escape}");
    await gone("Escape over content");
    await userEvent.hover(trigger);
    tooltip = await shown();
    await userEvent.unhover(trigger);
    await gone("reopen then leave trigger");
    await userEvent.hover(trigger);
    tooltip = await shown();
    await userEvent.unhover(trigger);
    await pause(70);
    await userEvent.hover(tooltip);
    await pause(200);
    await expect(tooltip).toBeVisible();
    // The leave grace also permits moving back from the content to its trigger.
    await userEvent.unhover(tooltip);
    await pause(70);
    await userEvent.hover(trigger);
    await pause(200);
    await expect(tooltip).toBeVisible();
    await userEvent.unhover(trigger);
    await pause(70);
    await userEvent.hover(tooltip);
    await pause(200);
    await expect(tooltip).toBeVisible();
    await userEvent.unhover(tooltip);
    await gone("leave tooltip content");
    await userEvent.hover(trigger);
    await shown();
    await userEvent.keyboard("{Escape}");
    await gone();
    await pause(450);
    await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await userEvent.unhover(trigger);
    await userEvent.hover(trigger);
    await shown();
  },
};

export const Keyboard: Story = {
  render: args => <div className={styles.controls}><Button>Before</Button><HelpTooltip {...args} /><Button>After</Button></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Before" }));
    await userEvent.tab();
    const trigger = canvas.getByRole("button", { name: "Help for Default calendar" });
    await shown();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await gone();
    await pause(450);
    await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "After" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    await shown();
    await expect(trigger).toHaveFocus();
  },
};

export const TouchAndClick: Story = {
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button");
    await expectTargetSize(trigger);
    await userEvent.pointer({ keys: "[TouchA]", target: trigger });
    let tooltip = await shown();
    await expect(tooltip.closest('[data-ui="popover-content"]')).toHaveAttribute("data-mobile-surface", "anchored");
    await userEvent.pointer({ keys: "[TouchA]", target: trigger });
    await gone();
    await userEvent.click(trigger);
    tooltip = await shown();
    await expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await gone();
  },
};

export const Collision: Story = {
  render: args => <div className={styles.corner}><HelpTooltip {...args} /></div>,
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole("button"));
    const tooltip = await shown();
    const surface = tooltip.closest('[data-ui="popover-content"]')!;
    const bounds = surface.getBoundingClientRect();
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(bounds.top).toBeGreaterThanOrEqual(0);
    await expect(surface).toHaveAttribute("data-side", "bottom");
  },
};
export const NarrowCollision: Story = {
  ...Collision,
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
};

function FormExample() {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen} title="Calendar settings" closeLabel="Close calendar settings"
    trigger={<Button>Open settings</Button>}>
    <Field label="Calendar name" help="The name helps you recognize this calendar." description="Visible to calendar members.">
      <input defaultValue="Family" />
    </Field>
    <SettingsSection inset={false} title="Display" help={HELP} description="Applies to this page only."><Row label="Default calendar" value="Family" /></SettingsSection>
  </Dialog>;
}
export const FormComposition: Story = {
  render: () => <FormExample />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Open settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Calendar settings" });
    const scope = within(dialog);
    const input = scope.getByRole("textbox", { name: "Calendar name" });
    await expect(input).toHaveAccessibleDescription("Visible to calendar members.");
    const help = scope.getByRole("button", { name: "Help for Calendar name" });
    await expect(help.closest("label")).toBeNull();
    await expectTargetSize(help);
    await userEvent.click(scope.getByText("Calendar name", { exact: true }));
    await expect(input).toHaveFocus();
    await userEvent.hover(help);
    await shown();
    await expect(input).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await gone();
    await expect(dialog).toBeVisible();
    await userEvent.click(scope.getByRole("button", { name: "Help for Display" }));
    await shown();
    await expect(scope.getByRole("heading", { name: "Display" })).toBeVisible();
  },
};

export const NarrowFormComposition: Story = {
  ...FormComposition,
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
};
