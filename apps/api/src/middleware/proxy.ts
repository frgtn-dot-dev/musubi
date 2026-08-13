import type { Application } from "express";

/** Trust forwarding headers only when the immediate peer is infrastructure. */
export function trustPrivateProxies(app: Application) {
	app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
}
