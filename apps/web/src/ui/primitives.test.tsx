import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "./Button";
import { Empty } from "./Empty";
import { Field } from "./Field";
import { SectionLabel } from "./SectionLabel";

describe("Button primitives", () => {
  it("uses a safe default type and invokes its action", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect((button as HTMLButtonElement).type).toBe("button");
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("blocks interaction and exposes a busy state while loading", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("requires and renders an accessible name for icon-only actions", () => {
    render(
      <IconButton label="Close">
        <span>×</span>
      </IconButton>,
    );

    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
  });
});

describe("Field", () => {
  it("connects its label, description and error to the control", () => {
    render(
      <Field
        description="Visible to people you invite."
        error="Enter a title."
        label="Event title"
      >
        <input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Event title" });
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy).toContain("-description");
    expect(describedBy).toContain("-error");
    expect(screen.getByRole("alert").textContent).toBe("Enter a title.");
  });
});

describe("static primitives", () => {
  it("keeps section labels in the heading outline", () => {
    render(<SectionLabel level={3}>Appearance</SectionLabel>);
    expect(
      screen.getByRole("heading", { level: 3, name: "Appearance" }),
    ).not.toBeNull();
  });

  it("renders a useful empty state with its optional action", () => {
    render(
      <Empty
        action={<Button>Connect account</Button>}
        description="Connect a calendar provider to see events here."
        title="No calendars yet"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No calendars yet" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Connect account" }),
    ).not.toBeNull();
  });
});
