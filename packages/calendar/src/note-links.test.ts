import assert from "node:assert/strict";
import { noteParts, shortUrlLabel } from "./note-links";

assert.deepEqual(
  noteParts("Read https://www.example.com/a/very/long/path?x=1, then reply."),
  [
    { text: "Read " },
    {
      href: "https://www.example.com/a/very/long/path?x=1",
      text: "example.com",
    },
    { text: ", then reply." },
  ],
);

assert.deepEqual(noteParts("Docs: www.example.org/docs\nDone"), [
  { text: "Docs: " },
  { href: "https://www.example.org/docs", text: "example.org" },
  { text: "\nDone" },
]);

assert.deepEqual(noteParts("No links here."), [{ text: "No links here." }]);
assert.equal(shortUrlLabel("not a url"), "not a url");
