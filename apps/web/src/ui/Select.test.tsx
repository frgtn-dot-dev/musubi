import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Select } from "./Select";

afterEach(cleanup);

function SavingPreference({ save }: { save: () => Promise<void> }) {
  const [value, setValue] = useState("off");
  const [saving, setSaving] = useState(false);
  return <>
    <Select label="Reminder" value={value} disabled={saving}
      options={[{ value: "off", label: "Off" }, { value: "ten", label: "10 minutes" }]}
      onChange={next => {
        setValue(next);
        setSaving(true);
        void save().finally(() => setSaving(false));
      }} />
    <button type="button">Another setting</button>
  </>;
}

describe("Select focus after an asynchronous choice", () => {
  for (const moveFocus of [false, true]) {
    it(moveFocus ? "does not reclaim focus after the person moves on" : "returns to the trigger once saving enables it", async () => {
      let finish!: () => void;
      const saved = new Promise<void>(resolve => { finish = resolve; });
      const user = userEvent.setup();
      render(<SavingPreference save={() => saved} />);
      const trigger = screen.getByRole("combobox", { name: "Reminder" });
      await user.click(trigger);
      await user.click(await screen.findByRole("option", { name: "10 minutes" }));
      await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(true));
      const other = screen.getByRole("button", { name: "Another setting" });
      if (moveFocus) await user.click(other);
      await act(async () => { finish(); await saved; });
      await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
      await waitFor(() => expect(document.activeElement).toBe(moveFocus ? other : trigger));
    });
  }
});
