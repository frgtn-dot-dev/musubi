import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementBody } from "./AnnouncementDialog";

describe("AnnouncementBody", () => {
  it("renders paragraphs as separate blocks", () => {
    render(<AnnouncementBody body={"first line\n\nsecond line"} />);
    expect(document.body.contains(screen.getByText("first line"))).toBe(true);
    expect(document.body.contains(screen.getByText("second line"))).toBe(
      true,
    );
  });

  it("turns an http url into a link that opens safely", () => {
    render(<AnnouncementBody body="join us at https://discord.gg/example now" />);
    const link = screen.getByRole("link", { name: "https://discord.gg/example" });
    expect(link.getAttribute("href")).toBe("https://discord.gg/example");
    expect(link.getAttribute("target")).toBe("_blank");
    // noopener: obsah píše majitel serveru, ale odkaz ven nesmí dostat
    // window.opener na Musubi.
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("leaves a javascript url as plain text", () => {
    render(<AnnouncementBody body="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      document.body.contains(screen.getByText("javascript:alert(1)")),
    ).toBe(true);
  });
});
