import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const readJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, root), "utf8"));
const fail = (message) => {
  console.error(`Release metadata error: ${message}`);
  process.exitCode = 1;
};

const rootPackage = readJson("package.json");
const expectedVersion = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(rootPackage.version ?? "")) {
  fail(`root package.json version must be X.Y.Z, received ${rootPackage.version ?? "nothing"}`);
}

if (expectedVersion && expectedVersion !== rootPackage.version) {
  fail(`requested ${expectedVersion}, but package.json declares ${rootPackage.version}`);
}

if (!/^pnpm@\d+\.\d+\.\d+$/.test(rootPackage.packageManager ?? "")) {
  fail("root packageManager must pin an exact pnpm version");
}

for (const workspaceRoot of ["apps", "packages"]) {
  const directory = new URL(`${workspaceRoot}/`, root);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const relativePath = `${workspaceRoot}/${entry.name}/package.json`;
    if (!existsSync(new URL(relativePath, root))) continue;

    const manifest = readJson(relativePath);
    if (manifest.private !== true) {
      fail(`${relativePath} must be private`);
    }
    if ("version" in manifest) {
      fail(`${relativePath} must inherit the product version instead of declaring its own`);
    }
    if ("packageManager" in manifest) {
      fail(`${relativePath} must inherit packageManager from the repository root`);
    }
  }
}

const distributionFiles = [
  "apps/client/app.config.ts",
  "apps/client/components/UpdateRequiredModal.tsx",
  "apps/client/eas.json",
];
const placeholderPattern = /<APP_ID>|YOUR[_-]APP[_-]ID|REPLACE[_-]ME/i;

for (const relativePath of distributionFiles) {
  const source = readFileSync(new URL(relativePath, root), "utf8");
  if (placeholderPattern.test(source)) {
    fail(`${relativePath} contains a distribution placeholder`);
  }
}

const appConfig = readFileSync(new URL("apps/client/app.config.ts", root), "utf8");
if (!/version:\s*rootPackage\.version/.test(appConfig)) {
  fail("apps/client/app.config.ts must read the product version from the root manifest");
}

const workspaceConfig = readFileSync(new URL("pnpm-workspace.yaml", root), "utf8");
if (!/^autoInstallPeers:\s+false\s*$/m.test(workspaceConfig)) {
  fail("pnpm-workspace.yaml must keep autoInstallPeers disabled");
}

for (const relativePath of ["apps/api/Dockerfile", "packages/docs/Dockerfile"]) {
  const source = readFileSync(new URL(relativePath, root), "utf8");
  if (/pnpm@\d/.test(source)) {
    fail(`${relativePath} must inherit pnpm from the root manifest through Corepack`);
  }
  if (!source.includes("--frozen-lockfile")) {
    fail(`${relativePath} must install with --frozen-lockfile`);
  }
  if (!/FROM node:[^\s]+@sha256:[a-f0-9]{64}/.test(source)) {
    fail(`${relativePath} must pin the Node base image by digest`);
  }
}

if (!process.exitCode) {
  console.log(
    `Release metadata verified: Musubi ${rootPackage.version}, ${rootPackage.packageManager}`,
  );
}
