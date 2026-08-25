import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "musubi-media-"));
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.ENVIRONMENT = "test";
  process.env.BETTER_AUTH_URL = "http://localhost:7531";
  process.env.MEDIA_DIR = root;
  process.env.S3_BUCKET = "";
  process.env.S3_REGION = "";
  process.env.S3_ENDPOINT = "";
  process.env.S3_ACCESS_KEY_ID = "";
  process.env.S3_SECRET_ACCESS_KEY = "";

  try {
    const { deleteMedia, getMedia, putMedia, withMediaLock } =
      await import("./media_storage");
    const data = Buffer.from("image bytes");

    assert.equal(await readFile(path.join(root, ".backend"), "utf8"), "local");
    assert.equal(await getMedia("avatars/missing"), null);
    await putMedia("avatars/user-1", data, "image/png");
    assert.deepEqual(await getMedia("avatars/user-1"), {
      data,
      mimeType: "image/png",
    });
    await deleteMedia("avatars/user-1");
    assert.equal(await getMedia("avatars/user-1"), null);
    await assert.rejects(
      putMedia("../outside", data, "image/png"),
      /Invalid media key/,
    );

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const first = withMediaLock("avatars/race", async () => {
      order.push("first-start");
      firstStarted();
      await firstGate;
      order.push("first-end");
    });
    await started;
    const second = withMediaLock("avatars/race", async () => {
      order.push("second");
    });
    await Promise.resolve();
    assert.deepEqual(order, ["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first-start", "first-end", "second"]);

    console.log("media storage self-check: OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
