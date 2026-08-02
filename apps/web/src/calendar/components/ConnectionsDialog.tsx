import {
  providerDisplayName,
  providerFlavor,
  type Calendar,
} from "@musubi/types";
import {
  Link2,
  Plus,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import type { InvitePreview } from "~/api/contracts";
import {
  getFederatedInvitePreview,
  getInvitePreview,
} from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import {
  parseInviteLink,
  type ParsedInvite,
} from "~/calendar/invite-link";
import {
  GOOGLE_CALENDAR_SCOPES,
  MICROSOFT_CALENDAR_SCOPES,
  useConnections,
  rememberProviderLink,
} from "~/calendar/connections";
import { useFederatedWorkspace } from "~/calendar/federated-workspace";
import { Button, IconButton } from "~/ui/Button";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";
import { Field } from "~/ui/Field";
import { Row } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import { useAsyncAction } from "~/ui/useAsyncAction";
import { ProviderIcon } from "./ProviderIcon";
import styles from "./styles/connections.module.css";

type ConnectionsDialogProps = {
  calendars: Calendar[];
  /** Why the import of a just-linked account failed, if it did. */
  importFailed?: string;
  /** A provider link is still importing its calendars, started before this opened. */
  importing?: boolean;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  userId: string;
};

type ConnectedAccount = {
  accountId: string;
  flavor: string | null;
  label: string;
  provider: string;
  providerName: string;
  reconnect: boolean;
  serverUrl?: string | null;
};

type CaldavDraft = {
  apple: boolean;
  password: string;
  serverUrl: string;
  username: string;
};

const APPLE_CALDAV_URL = "https://caldav.icloud.com";

function connectedAccounts(calendars: Calendar[]): ConnectedAccount[] {
  const map = new Map<string, ConnectedAccount>();
  for (const calendar of calendars) {
    // Federated servers have their own status source below, which remains
    // available even when a remote server cannot return its calendars.
    if (calendar.provider === "musubi") continue;
    if (!calendar.provider || !calendar.accountId) continue;
    const key = `${calendar.provider}:${calendar.accountId}`;
    const reconnect = calendar.syncStatus === "reconnect_required";
    const existing = map.get(key);
    if (existing) {
      existing.reconnect = existing.reconnect || reconnect;
      continue;
    }
    map.set(key, {
      accountId: calendar.accountId,
      flavor: providerFlavor(calendar),
      label: calendar.accountLabel ?? providerDisplayName(calendar),
      provider: calendar.provider,
      providerName: providerDisplayName(calendar),
      reconnect,
      serverUrl: calendar.serverUrl,
    });
  }
  return [...map.values()];
}

function accountStatus(reconnect: boolean) {
  return reconnect ? "Needs attention" : "Connected";
}

export function ConnectionsDialog({
  calendars,
  importFailed,
  importing,
  onNotice,
  onOpenChange,
  open,
  userId,
}: ConnectionsDialogProps) {
  const connections = useConnections(userId);
  const federated = useFederatedWorkspace(userId);
  const { busy, error, run, setError } = useAsyncAction();
  const caldavReturnFocusRef = useRef<HTMLButtonElement>(null);
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const [caldav, setCaldav] = useState<CaldavDraft>();
  const [inviteValue, setInviteValue] = useState("");
  const [invite, setInvite] = useState<{
    parsed: ParsedInvite;
    preview: InvitePreview;
  }>();

  const providers = connections.capabilities.data?.syncProviders ?? [];
  const accounts = connectedAccounts(calendars);
  const federatedServers = federated.data?.servers ?? [];

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setCaldav(undefined);
      setInvite(undefined);
      setInviteValue("");
      setError("");
      caldavReturnFocusRef.current = null;
    }
    onOpenChange(nextOpen);
  }

  async function connectSocial(
    provider: "google" | "microsoft",
    scopes: string[],
  ) {
    // Better Auth redirects the page to the provider. Only an early error
    // returns to this dialog.
    await run(async () => {
      // Before the page leaves, so the version of the app that comes back knows
      // to import the calendars instead of showing an empty list.
      rememberProviderLink(provider);
      const result = await authClient.linkSocial({
        callbackURL: window.location.href,
        provider,
        scopes,
      });
      if (result?.error) throw new Error(result.error.message);
    }, "Could not start the connection.");
  }

  function openCaldav(draft: CaldavDraft, trigger: HTMLButtonElement) {
    caldavReturnFocusRef.current = trigger;
    setError("");
    setCaldav(draft);
  }

  function closeCaldav() {
    setCaldav(undefined);
    setError("");
    caldavReturnFocusRef.current?.focus();
  }

  function focusInviteInput() {
    requestAnimationFrame(() => inviteInputRef.current?.focus());
  }

  function reconnect(
    account: ConnectedAccount,
    trigger: HTMLButtonElement,
  ) {
    if (account.provider === "google") {
      void connectSocial("google", GOOGLE_CALENDAR_SCOPES);
      return;
    }
    if (account.provider === "microsoft") {
      void connectSocial("microsoft", MICROSOFT_CALENDAR_SCOPES);
      return;
    }
    openCaldav(
      {
        apple: account.flavor === "apple",
        password: "",
        serverUrl:
          account.flavor === "apple"
            ? APPLE_CALDAV_URL
            : (account.serverUrl ?? ""),
        username: "",
      },
      trigger,
    );
  }

  async function disconnectAccount(account: ConnectedAccount) {
    const disconnected = await run(async () => {
      await connections.disconnectAccount({
        accountId: account.accountId,
        provider: account.provider,
      });
      return true;
    }, "Could not disconnect the account.");

    if (disconnected) onNotice(`${account.label} disconnected.`);
  }

  async function previewInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseInviteLink(inviteValue, window.location.origin);
    if (!parsed) {
      setInvite(undefined);
      setError("Paste a Musubi invite link.");
      return;
    }
    await run(async () => {
      const preview = parsed.server
        ? await getFederatedInvitePreview(parsed.server, parsed.token)
        : await getInvitePreview(parsed.token);
      setInvite({ parsed, preview });
    }, "That invite could not be opened — it may have expired. Nothing was joined; ask for a fresh link.");
  }

  async function acceptInvite() {
    if (!invite) return;
    const joined = await run(async () => {
      await connections.acceptInvite(invite.parsed);
      return true;
    }, "Could not join that calendar.");

    if (joined) {
      onNotice(`Joined ${invite.preview.name}.`);
      setInvite(undefined);
      setInviteValue("");
      focusInviteInput();
    }
  }

  async function submitCaldav(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caldav) return;
    const serverUrl = caldav.apple ? APPLE_CALDAV_URL : caldav.serverUrl.trim();
    if (!serverUrl || !caldav.username.trim() || !caldav.password) {
      setError("Fill in the server, username and password.");
      return;
    }
    const connected = await run(async () => {
      await connections.connectCaldav({
        password: caldav.password,
        serverUrl,
        username: caldav.username.trim(),
      });
      return true;
    }, "Could not connect. Check the server and credentials.");

    if (connected) {
      onNotice("Calendar connected.");
      setCaldav(undefined);
      caldavReturnFocusRef.current?.focus();
    }
  }

  return (
    <Dialog
      bodyClassName={styles.body}
      bodyLayout="flush"
      closeLabel="Close connections"
      description="Keep outside calendars in sync or join one shared through Musubi."
      footer={
        <DialogClose>
          <Button disabled={busy} variant="secondary">
            Done
          </Button>
        </DialogClose>
      }
      onOpenChange={handleOpenChange}
      open={open}
      size="wide"
      title="Connections"
    >
      <div aria-busy={busy || undefined}>
        <section
          aria-labelledby="connections-accounts-title"
          className={styles.section}
        >
          <SectionHeading
            description="Calendars from these accounts stay in sync both ways."
            id="connections-accounts-title"
            title="Connected accounts"
          />
          {accounts.length > 0 ? (
            <ul aria-label="Connected accounts" className={styles.list}>
              {accounts.map((account) => (
                <li key={`${account.provider}:${account.accountId}`}>
                  <Row
                    className={styles.connectionRow}
                    detail={account.providerName}
                    icon={<ProviderIcon flavor={account.flavor} />}
                    label={
                      <span className={styles.rowLabel}>
                        <span>{account.label}</span>
                        <StatusBadge
                          label={accountStatus(account.reconnect)}
                          tone={account.reconnect ? "warning" : "positive"}
                        />
                      </span>
                    }
                    trailing={
                      <span className={styles.rowActions}>
                        {account.reconnect ? (
                          <Button
                            disabled={busy}
                            icon={
                              <RefreshCw size={14} strokeWidth={1.8} />
                            }
                            size="compact"
                            variant="secondary"
                            onClick={(event) =>
                              reconnect(account, event.currentTarget)
                            }
                          >
                            Reconnect
                          </Button>
                        ) : null}
                        <IconButton
                          className={styles.disconnectButton}
                          disabled={busy}
                          label={`Disconnect ${account.label}`}
                          size="compact"
                          title="Disconnect account"
                          onClick={() => void disconnectAccount(account)}
                        >
                          <Unlink size={15} strokeWidth={1.7} />
                        </IconButton>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              className={styles.empty}
              // An account whose calendars are still being fetched is not a
              // missing account, and saying "none" while one is arriving is how
              // someone concludes the connection failed and does it again.
              description={
                importing
                  ? "Fetching the calendars from the account you just connected."
                  : importFailed
                    ? `The account is linked, but its calendars could not be fetched. ${importFailed}`
                    : "Connect an account below to see its calendars in Musubi."
              }
              icon={<Link2 size={18} strokeWidth={1.7} />}
              title={
                importing
                  ? "Importing…"
                  : importFailed
                    ? "Nothing imported yet"
                    : "No connected accounts"
              }
            />
          )}
        </section>

        <section
          aria-labelledby="connections-invite-title"
          className={styles.section}
        >
          <SectionHeading
            description="Use an invite from this or another Musubi server."
            id="connections-invite-title"
            title="Join a shared calendar"
          />
          {invite ? (
            <InvitePreview
              busy={busy}
              invite={invite}
              onCancel={() => {
                setInvite(undefined);
                setError("");
                focusInviteInput();
              }}
              onJoin={() => void acceptInvite()}
            />
          ) : (
            <form
              className={styles.inviteForm}
              onSubmit={(event) => void previewInvite(event)}
            >
              <Field
                className={styles.inviteField}
                description="Paste the full link or just its invite token."
                label="Invite link"
              >
                <input
                  disabled={busy}
                  placeholder="https://server/invite/…"
                  ref={inviteInputRef}
                  value={inviteValue}
                  onChange={(event) => setInviteValue(event.target.value)}
                />
              </Field>
              <Button
                className={styles.inviteSubmit}
                disabled={!inviteValue.trim()}
                loading={busy}
                type="submit"
              >
                Open invite
              </Button>
            </form>
          )}
        </section>

        {federatedServers.length > 0 ? (
          <section
            aria-labelledby="connections-servers-title"
            className={styles.section}
          >
            <SectionHeading
              description="Remote calendars stay connected through your home server."
              id="connections-servers-title"
              title="Musubi servers"
            />
            <ul aria-label="Connected Musubi servers" className={styles.list}>
              {federatedServers.map((server) => {
                const status =
                  server.state === "active"
                    ? "Connected"
                    : server.state === "unauthorized"
                      ? "Needs a new invite"
                      : "Unreachable";
                return (
                  <li key={server.connectionId}>
                    <Row
                      className={styles.connectionRow}
                      detail="Shared calendars on another Musubi server"
                      icon={<ProviderIcon flavor={null} />}
                      label={
                        <span className={styles.rowLabel}>
                          <span>{server.label}</span>
                          <StatusBadge
                            label={status}
                            tone={
                              server.state === "active"
                                ? "positive"
                                : "warning"
                            }
                          />
                        </span>
                      }
                      trailing={
                        <span className={styles.rowActions}>
                          {server.state === "unreachable" ? (
                            <Button
                              disabled={busy}
                              icon={
                                <RefreshCw size={14} strokeWidth={1.8} />
                              }
                              size="compact"
                              variant="secondary"
                              onClick={() => void federated.refetch()}
                            >
                              Retry
                              <span className={styles.visuallyHidden}>
                                {" "}
                                {server.label}
                              </span>
                            </Button>
                          ) : null}
                          <IconButton
                            className={styles.disconnectButton}
                            disabled={busy}
                            label={`Disconnect ${server.label}`}
                            size="compact"
                            title="Disconnect server"
                            onClick={() =>
                              void run(async () => {
                                await connections.disconnectFederatedServer(
                                  server.server,
                                );
                                onNotice(`${server.label} disconnected.`);
                              }, "Could not disconnect the server.")
                            }
                          >
                            <Unlink size={15} strokeWidth={1.7} />
                          </IconButton>
                        </span>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section
          aria-labelledby="connections-add-title"
          className={styles.section}
        >
          <SectionHeading
            description="Choose where your other calendars live."
            id="connections-add-title"
            title="Add a connection"
          />
          {connections.capabilities.isPending ? (
            <p aria-live="polite" className={styles.loading}>
              Loading connection options…
            </p>
          ) : connections.capabilities.isError ? (
            <p className={styles.sectionError} role="alert">
              Connection options could not be loaded.
            </p>
          ) : providers.length > 0 ? (
            <div className={styles.providerButtons}>
              {providers.includes("google") ? (
                <Button
                  disabled={busy}
                  icon={<ProviderIcon flavor="google" />}
                  variant="secondary"
                  onClick={() =>
                    void connectSocial("google", GOOGLE_CALENDAR_SCOPES)
                  }
                >
                  Connect Google Calendar
                </Button>
              ) : null}
              {providers.includes("microsoft") ? (
                <Button
                  disabled={busy}
                  icon={<ProviderIcon flavor="microsoft" />}
                  variant="secondary"
                  onClick={() =>
                    void connectSocial(
                      "microsoft",
                      MICROSOFT_CALENDAR_SCOPES,
                    )
                  }
                >
                  Connect Outlook
                </Button>
              ) : null}
              {providers.includes("caldav") ? (
                <>
                  <Button
                    disabled={busy}
                    icon={<ProviderIcon flavor="apple" />}
                    variant="secondary"
                    onClick={(event) =>
                      openCaldav(
                        {
                          apple: true,
                          password: "",
                          serverUrl: APPLE_CALDAV_URL,
                          username: "",
                        },
                        event.currentTarget,
                      )
                    }
                  >
                    Connect Apple / iCloud
                  </Button>
                  <Button
                    disabled={busy}
                    icon={<ProviderIcon flavor="caldav" />}
                    variant="secondary"
                    onClick={(event) =>
                      openCaldav(
                        {
                          apple: false,
                          password: "",
                          serverUrl: "",
                          username: "",
                        },
                        event.currentTarget,
                      )
                    }
                  >
                    Connect other (CalDAV)
                  </Button>
                </>
              ) : null}
            </div>
          ) : (
            <p className={styles.loading}>
              This server does not offer external calendar connections.
            </p>
          )}

          {caldav ? (
            <CaldavForm
              busy={busy}
              draft={caldav}
              onCancel={closeCaldav}
              onChange={setCaldav}
              onSubmit={(event) => void submitCaldav(event)}
            />
          ) : null}
        </section>

        {error ? (
          <div className={styles.error} role="alert">
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function SectionHeading({
  description,
  id,
  title,
}: {
  description: string;
  id: string;
  title: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <SectionLabel id={id}>{title}</SectionLabel>
      <p>{description}</p>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "positive" | "warning";
}) {
  return (
    <span className={styles.status} data-tone={tone}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function InvitePreview({
  busy,
  invite,
  onCancel,
  onJoin,
}: {
  busy: boolean;
  invite: { parsed: ParsedInvite; preview: InvitePreview };
  onCancel: () => void;
  onJoin: () => void;
}) {
  const memberCount = invite.preview.members.length;
  const eventCount = invite.preview.events.length;
  const source = invite.parsed.server
    ? new URL(invite.parsed.server).host
    : "This server";

  return (
    <div
      aria-label="Invite preview"
      className={styles.invitePreview}
      role="region"
    >
      <Row
        className={styles.previewRow}
        detail={`${memberCount} member${memberCount === 1 ? "" : "s"} · ${eventCount} event${eventCount === 1 ? "" : "s"} in the next 30 days`}
        icon={
          <span
            className={styles.calendarSwatch}
            style={{ backgroundColor: invite.preview.color }}
          />
        }
        label={invite.preview.name}
        value={source}
      />
      <p>You will join as a viewer.</p>
      <div className={styles.formActions}>
        <Button
          autoFocus
          disabled={busy}
          variant="secondary"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button loading={busy} onClick={onJoin}>
          Join calendar
        </Button>
      </div>
    </div>
  );
}

function CaldavForm({
  busy,
  draft,
  onCancel,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  draft: CaldavDraft;
  onCancel: () => void;
  onChange: (draft: CaldavDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className={styles.caldavForm} onSubmit={onSubmit}>
      <header className={styles.formHeading}>
        <ProviderIcon flavor={draft.apple ? "apple" : "caldav"} />
        <div>
          <h3>
            {draft.apple ? "Connect Apple / iCloud" : "Connect a CalDAV server"}
          </h3>
          <p>
            {draft.apple
              ? "Use an app-specific password, not your Apple ID password."
              : "Your credentials are sent securely to the CalDAV server."}
          </p>
        </div>
      </header>
      {!draft.apple ? (
        <Field label="Server address" variant="section">
          <input
            autoFocus
            disabled={busy}
            placeholder="https://caldav.example.com"
            type="url"
            value={draft.serverUrl}
            onChange={(event) =>
              onChange({ ...draft, serverUrl: event.target.value })
            }
          />
        </Field>
      ) : null}
      <Field
        label={draft.apple ? "Apple ID email" : "Username"}
        variant="section"
      >
        <input
          autoComplete="username"
          autoFocus={draft.apple}
          disabled={busy}
          placeholder={draft.apple ? "name@icloud.com" : "Username"}
          value={draft.username}
          onChange={(event) =>
            onChange({ ...draft, username: event.target.value })
          }
        />
      </Field>
      <Field
        label={draft.apple ? "App-specific password" : "Password"}
        variant="section"
      >
        <input
          autoComplete="current-password"
          disabled={busy}
          placeholder="Password"
          type="password"
          value={draft.password}
          onChange={(event) =>
            onChange({ ...draft, password: event.target.value })
          }
        />
      </Field>
      <div className={styles.formActions}>
        <Button disabled={busy} variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          icon={<Plus size={16} strokeWidth={1.7} />}
          loading={busy}
          type="submit"
        >
          Connect
        </Button>
      </div>
    </form>
  );
}
