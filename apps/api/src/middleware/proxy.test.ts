import assert from "node:assert/strict";
import express from "express";
import { trustPrivateProxies } from "./proxy";

const app = express();
trustPrivateProxies(app);
const trust = app.get("trust proxy fn") as (
	address: string,
	index: number,
) => boolean;

assert.equal(trust("127.0.0.1", 0), true);
assert.equal(trust("10.0.0.4", 0), true);
assert.equal(trust("172.16.0.4", 0), true);
assert.equal(trust("192.168.1.4", 0), true);
assert.equal(trust("169.254.1.4", 0), true);
assert.equal(trust("203.0.113.10", 0), false);

console.log("proxy trust self-check: OK");
