import assert from "node:assert/strict";
import {
  ProviderSyncFailure,
  runProviderSyncs,
} from "./orchestrator";

let retryableAttempts = 0;
const adapters = [
  {
    provider: "broken-discovery",
    async listAccounts() {
      throw new Error("discovery unavailable");
    },
  },
  {
    provider: "working-provider",
    async listAccounts() {
      return [
        { id: "retryable", label: "Retryable account" },
        { id: "healthy", label: "Healthy account" },
      ];
    },
  },
];

async function main() {
  const failures: ProviderSyncFailure[] = [];
  const syncAccount = async (
    adapter: (typeof adapters)[number],
    _userID: string,
    account: { id: string },
  ) => {
    assert.equal(adapter.provider, "working-provider");
    if (account.id === "retryable" && retryableAttempts++ === 0) {
      throw new Error("temporary provider outage");
    }
    return [`calendar-${account.id}`];
  };

  const first = await runProviderSyncs(adapters, "user-1", {}, {
    syncAccount,
    onFailure: (failure) => failures.push(failure),
  });
  assert.deepEqual(first, ["calendar-healthy"]);
  assert.deepEqual(
    failures.map(({ stage, provider, accountId }) => ({ stage, provider, accountId })),
    [
      { stage: "discovery", provider: "broken-discovery", accountId: undefined },
      { stage: "account", provider: "working-provider", accountId: "retryable" },
    ],
  );

  // Retryable failures are not disabled or swallowed permanently: the next
  // scheduled cycle attempts the account again and still runs healthy siblings.
  failures.length = 0;
  const second = await runProviderSyncs(adapters, "user-1", {}, {
    syncAccount,
    onFailure: (failure) => failures.push(failure),
  });
  assert.deepEqual(second, ["calendar-retryable", "calendar-healthy"]);
  assert.deepEqual(
    failures.map(({ stage, provider }) => ({ stage, provider })),
    [{ stage: "discovery", provider: "broken-discovery" }],
  );

  const scoped = await runProviderSyncs(adapters, "user-1", {
    provider: "working-provider",
    accountId: "healthy",
  }, {
    syncAccount,
    onFailure: (failure) => failures.push(failure),
  });
  assert.deepEqual(scoped, ["calendar-healthy"]);

  await assert.rejects(
    runProviderSyncs(adapters, "user-1", { throwOnError: true }, {
      syncAccount,
      onFailure: () => {},
    }),
    /discovery unavailable/,
  );

  console.log("provider orchestration self-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
