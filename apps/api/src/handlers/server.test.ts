import assert from "node:assert/strict";
import { MIN_CLIENT_VERSION, PRODUCT_VERSION } from "@musubi/types";
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
assert.deepEqual(health.result(), {
  status: 200,
  body: { ok: true, version: PRODUCT_VERSION },
});

const discovery = response();
handlerServer({} as never, discovery.res as never);
const identity = discovery.result().body as {
  minClientVersion: string;
  version: string;
};
assert.equal(identity.version, PRODUCT_VERSION);
assert.equal(identity.minClientVersion, MIN_CLIENT_VERSION);

console.log("server identity tests passed");
