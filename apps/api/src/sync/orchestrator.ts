export type ProviderSyncOptions = {
  /** Limit a strict, user-triggered sync to one provider/account. */
  provider?: string;
  accountId?: string;
  /** Scheduled sync stays best-effort; connect flows fail loudly. */
  throwOnError?: boolean;
};

export type ProviderSyncFailure = {
  stage: "discovery" | "account";
  provider: string;
  accountId?: string;
  error: unknown;
};

type ProviderAccountSource = {
  provider: string;
  listAccounts(userID: string): Promise<{ id: string; label: string }[]>;
};

/**
 * Provider/account fault boundary shared by scheduled and user-triggered sync.
 * It contains no database or logging dependencies, so failure and retry
 * semantics can be tested with deterministic fake adapters.
 */
export async function runProviderSyncs<TAdapter extends ProviderAccountSource>(
  adapters: readonly TAdapter[],
  userID: string,
  options: ProviderSyncOptions,
  hooks: {
    syncAccount(
      adapter: TAdapter,
      userID: string,
      account: { id: string; label: string },
    ): Promise<string[]>;
    onFailure(failure: ProviderSyncFailure): void;
  },
) {
  const changedCalendarIDs: string[] = [];

  for (const adapter of adapters) {
    if (options.provider && adapter.provider !== options.provider) continue;

    let accounts: { id: string; label: string }[];
    try {
      accounts = await adapter.listAccounts(userID);
    } catch (error) {
      hooks.onFailure({
        stage: "discovery",
        provider: adapter.provider,
        error,
      });
      if (options.throwOnError) throw error;
      continue;
    }

    for (const account of accounts) {
      if (options.accountId && account.id !== options.accountId) continue;
      try {
        changedCalendarIDs.push(
          ...await hooks.syncAccount(adapter, userID, account),
        );
      } catch (error) {
        hooks.onFailure({
          stage: "account",
          provider: adapter.provider,
          accountId: account.id,
          error,
        });
        if (options.throwOnError) throw error;
      }
    }
  }

  return changedCalendarIDs;
}
