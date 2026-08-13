import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "dev";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

async function main() {
  const { parseEnvironment, validateAuthSecret } = await import("./index");

  assert.equal(parseEnvironment("dev"), "dev");
  assert.equal(parseEnvironment("test"), "test");
  assert.equal(parseEnvironment("prod"), "prod");
  assert.throws(
    () => parseEnvironment("production"),
    /Expected dev, test, or prod/,
  );

  assert.doesNotThrow(() => validateAuthSecret("dev", "short"));
  assert.doesNotThrow(() => validateAuthSecret("test", "your_secret_here"));
  assert.throws(() => validateAuthSecret("prod", "short"), /at least 32/);
  assert.doesNotThrow(() =>
    validateAuthSecret("prod", "0123456789abcdef0123456789abcdef"),
  );

  console.log("config security self-check: OK");
}

void main();
