import assert from "node:assert/strict";
import { createServer } from "node:net";

async function main() {
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP\r\n");
    socket.on("data", (data) => {
      for (const line of String(data).split("\r\n")) {
        if (line.startsWith("EHLO")) socket.write("250 localhost\r\n");
        if (line === "QUIT") socket.end("221 bye\r\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(address.port);
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";
  process.env.ENVIRONMENT = "dev";

  const { canSendEmail, initializeEmailCapability, smtpTransportOptions } =
    await import("./index");
  assert.equal(
    smtpTransportOptions({
      host: "smtp.example",
      port: 587,
      user: "",
      pass: "",
      from: "",
    }).requireTLS,
    true,
  );
  assert.equal(
    smtpTransportOptions({
      host: "smtp.example",
      port: 465,
      user: "",
      pass: "",
      from: "",
    }).requireTLS,
    false,
  );
  assert.equal(canSendEmail(), false);
  // The local plaintext stand-in cannot negotiate STARTTLS: refusing it proves
  // a configured submission port cannot silently downgrade.
  assert.equal(await initializeEmailCapability(), false);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert.equal(canSendEmail(), false);

  // The mark has to actually be on disk. A missing file is not fatal at
  // runtime — the alt text still says Musubi — but it would mean every email
  // ships without a logo and nothing louder than one warn line ever says so.
  const { logoAttachment } = await import("./brand");
  const [attachment, ...rest] = logoAttachment();
  assert.ok(attachment, "the email logo is missing from the package");
  assert.equal(rest.length, 0);
  assert.equal(attachment.cid, "musubi-logo");
  // PNG, not SVG: Gmail drops SVG outright and the header would silently go.
  assert.equal(attachment.content.subarray(1, 4).toString(), "PNG");

  console.log("SMTP startup capability self-check: OK");
}

void main();
