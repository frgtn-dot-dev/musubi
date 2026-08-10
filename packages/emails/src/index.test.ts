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

  const { canSendEmail, initializeEmailCapability } = await import("./index");
  assert.equal(canSendEmail(), false);
  assert.equal(await initializeEmailCapability(), true);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert.equal(canSendEmail(), true);
  console.log("SMTP startup capability self-check: OK");
}

void main();
