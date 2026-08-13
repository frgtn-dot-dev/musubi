import assert from "node:assert/strict";
import { normalizeServerUrl, serverStoragePrefix } from "./serverUrl";

assert.equal(normalizeServerUrl(" HTTPS://Dev.Musubi.Pro/path/ "), "https://dev.musubi.pro");
assert.equal(serverStoragePrefix("https://dev.musubi.pro"), "musubi_dev_musubi_pro");
assert.notEqual(
	serverStoragePrefix("https://dev.musubi.pro"),
	serverStoragePrefix("https://musubi.pro"),
);
assert.throws(() => normalizeServerUrl("ftp://musubi.pro"), /HTTP/);

console.log("server URL self-check: OK");
