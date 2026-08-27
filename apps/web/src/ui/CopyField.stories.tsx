import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useEffect } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CopyField } from "./CopyField";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";

const EVENT_URL = "https://musubi.pro/e/8f21c407-studio-opening";

/* The real clipboard is not available to a headless browser, so each story says
   which outcome it is showing rather than depending on the host. */
function Clipboard({
  children,
  fails = false,
}: {
  children: React.ReactNode;
  fails?: boolean;
}) {
  useEffect(() => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          fails ? Promise.reject(new Error("denied")) : Promise.resolve(),
      },
    });

    return () => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: original,
      });
    };
  }, [fails]);

  return <>{children}</>;
}

const meta = {
  args: {
    label: "Event link",
    value: EVENT_URL,
  },
  component: CopyField,
  tags: ["autodocs"],
  title: "Primitives/CopyField",
} satisfies Meta<typeof CopyField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
};

export const Copied: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Copy" }));

    await expect(
      canvas.getByRole("button", { name: "Copied" }),
    ).toBeVisible();
  },
  render: (args) => (
    <Clipboard>
      <CopyField {...args} />
    </Clipboard>
  ),
};

/* Nothing reached the clipboard, so the button must not claim otherwise, and
   the link is left selected so one keystroke still finishes the job. */
export const CopyFailed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const value = canvas.getByRole("textbox", { name: "Event link" });

    await userEvent.click(canvas.getByRole("button", { name: "Copy" }));

    await expect(
      canvas.getByRole("button", { name: "Copy failed" }),
    ).toBeVisible();
    await expect(value).toHaveProperty("selectionStart", 0);
    await expect(value).toHaveProperty("selectionEnd", EVENT_URL.length);
  },
  render: (args) => (
    <Clipboard fails>
      <CopyField {...args} />
    </Clipboard>
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
};
