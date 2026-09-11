import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, within } from "storybook/test";
import { DatePicker } from "./DatePicker";
import { TimePicker } from "./TimePicker";
import { Field } from "./Field";

const meta = {
  component: Field,
  decorators: [
    (Story) => (
      <div className="sb-field-width">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
  title: "Primitives/Field",
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  args: {
    children: <input defaultValue="Design review" />,
    description: "Visible to everyone with access to this calendar.",
    label: "Event title",
  },
};

export const Error: Story = {
  args: {
    children: <input defaultValue="" />,
    error: "Enter a title before saving.",
    label: "Event title",
  },
};

export const Inline: Story = {
  args: {
    children: <input defaultValue="Europe/Prague" />,
    label: "Time zone",
    layout: "inline",
  },
};

export const DateAndTimeControls: Story = {
  args: { label: "Task schedule", children: <input /> },
  render: () => <>
    <Field label="Due date" description="Use the calendar date of the deadline."><DatePicker label="Due date" value="2026-09-11" weekStartsOn="monday" onChange={() => {}} /></Field>
    <Field label="Due time"><TimePicker label="Due time" value="09:30" timeFormat="24h" onChange={() => {}} /></Field>
    <Field label="Start time" error="Choose a time before the due time."><TimePicker label="Start time" value="10:30" timeFormat="24h" onChange={() => {}} /></Field>
    <Field label="Unavailable time"><TimePicker label="Unavailable time" value="12:00" disabled timeFormat="24h" onChange={() => {}} /></Field>
  </>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const date = canvas.getByRole("button", { name: /^Due date:/ });
    const time = canvas.getByRole("combobox", { name: "Due time" });
    const dateStyle = getComputedStyle(date);
    const timeStyle = getComputedStyle(time);
    await expect(date).toHaveAccessibleDescription("Use the calendar date of the deadline.");
    await expect(canvas.getByLabelText("Due date", { exact: true })).toBe(date);
    for (const property of ["minHeight", "borderRadius", "backgroundColor", "borderTopWidth", "fontSize"] as const) {
      await expect(timeStyle[property]).toBe(dateStyle[property]);
    }
    const invalid = canvas.getByRole("combobox", { name: "Start time" });
    await expect(invalid).toHaveAttribute("aria-invalid", "true");
    await expect(invalid).toHaveAccessibleDescription(expect.stringContaining("Choose a time before the due time."));
    await expect(canvas.getByRole("combobox", { name: "Unavailable time" })).toBeDisabled();
  },
};
