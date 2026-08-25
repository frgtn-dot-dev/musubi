import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "@musubi/config";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type StoredMedia = { data: Buffer; mimeType: string };

const s3Config = config.media.s3;
const s3 = s3Config
  ? new S3Client({
      region: s3Config.region,
      endpoint: s3Config.endpoint,
      forcePathStyle: s3Config.forcePathStyle,
      credentials: s3Config.accessKeyId
        ? {
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey!,
          }
        : undefined,
    })
  : null;

const backendID = s3Config
  ? `s3:${s3Config.endpoint ?? "aws"}:${s3Config.region}:${s3Config.bucket}`
  : "local";
const markerPath = path.resolve(config.media.localDir, ".backend");
mkdirSync(config.media.localDir, { recursive: true });
let previousBackend: string | null = null;
try {
  previousBackend = readFileSync(markerPath, "utf8");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (
  previousBackend &&
  previousBackend !== "local" &&
  previousBackend !== backendID
) {
  throw new Error(
    `Media backend changed from ${previousBackend} to ${backendID}. Migrate media before changing S3 settings.`,
  );
}
if (previousBackend !== backendID) writeFileSync(markerPath, backendID);

// ponytail: process-local locks match API's enforced single-replica model;
// replace with distributed locks before supporting multiple API replicas.
const locks = new Map<string, Promise<void>>();

export async function withMediaLock<T>(key: string, action: () => Promise<T>) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function localPath(key: string) {
  const root = path.resolve(config.media.localDir);
  const target = path.resolve(root, key);
  if (!key || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Invalid media key: ${key}`);
  }
  return target;
}

function isMissing(error: unknown) {
  const value = error as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value?.name === "NoSuchKey" ||
    value?.code === "ENOENT" ||
    value?.$metadata?.httpStatusCode === 404
  );
}

export async function putMedia(key: string, data: Buffer, mimeType: string) {
  if (s3 && s3Config) {
    await s3.send(
      new PutObjectCommand({
        Bucket: s3Config.bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
      }),
    );
    return;
  }

  const target = localPath(key);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, data);
  await writeFile(`${temporary}.content-type`, mimeType);
  await rename(temporary, target);
  await rename(`${temporary}.content-type`, `${target}.content-type`);
}

async function getLocalMedia(key: string): Promise<StoredMedia | null> {
  const target = localPath(key);
  try {
    const [data, mimeType] = await Promise.all([
      readFile(target),
      readFile(`${target}.content-type`, "utf8"),
    ]);
    return { data, mimeType };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function getMedia(key: string): Promise<StoredMedia | null> {
  if (!s3 || !s3Config) return getLocalMedia(key);

  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: s3Config.bucket, Key: key }),
    );
    if (!result.Body) return null;
    return {
      data: Buffer.from(await result.Body.transformToByteArray()),
      mimeType: result.ContentType ?? "application/octet-stream",
    };
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const local = await getLocalMedia(key);
  if (local) await putMedia(key, local.data, local.mimeType);
  return local;
}

export async function deleteMedia(key: string) {
  if (s3 && s3Config) {
    await s3.send(
      new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: key }),
    );
  }

  const target = localPath(key);
  await Promise.all([
    rm(target, { force: true }),
    rm(`${target}.content-type`, { force: true }),
  ]);
}
