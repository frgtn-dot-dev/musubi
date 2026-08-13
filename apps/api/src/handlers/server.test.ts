import assert from "node:assert/strict";
import { handlerServer, handlerServerStatus } from "./server";

function response() {
  let status = 0;
  let body: unknown;
  return {
    res: {
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    },
    result: () => ({ status, body }),
  };
}

const health = response();
handlerServerStatus({} as never, health.res as never);
assert.deepEqual(health.result(), { status: 200, body: { ok: true, version: "0.1.3" } });

const discovery = response();
handlerServer({} as never, discovery.res as never);
assert.equal((discovery.result().body as { version: string }).version, "0.1.3");

console.log("server identity tests passed");
