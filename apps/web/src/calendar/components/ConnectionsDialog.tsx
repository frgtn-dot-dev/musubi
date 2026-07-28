import * as Dialog from "@radix-ui/react-dialog";
import {
  providerDisplayName,
  type Calendar,
} from "@musubi/types";
import { Link2, Plus, RefreshCw, Unlink, Users, X } from "lucide-react";
import { type FormEvent, useState } from "react";
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
} from "~/calendar/connections";
import { useFederatedWorkspace } from "~/calendar/federated-workspace";
import { useAsyncAction } from "~/ui/useAsyncAction";
import styles from "./workspace.module.css";

type ConnectionsDialogProps = {
  calendars: Calendar[];
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  userId: string;
};

type ConnectedAccount = {
  accountId: string;
  label: string;
  provider: string;
  reconnect: boolean;
};

const APPLE_CALDAV_URL = "https://caldav.icloud.com";

function connectedAccounts(calendars: Calendar[]): ConnectedAccount[] {
  const map = new Map<string, ConnectedAccount>();
  for (const calendar of calendars) {
    // Federated servers are listed from their own status source below, so they
    // show up even when the server is unreachable and returns no calendars.
    if (calendar.provider === "musubi") continue;
    if (!calendar.provider || !calendar.accountId) continue;
    const key = `${calendar.provider}:${calendar.accountId}`;
    const reconnect = calendar.syncStatus === "reconnect_required";
    const existing = map.get(key);
    if (existing) {
      existing.reconnect = existing.reconnect || reconnect;
    } else {
      map.set(key, {
        accountId: calendar.accountId,
        label:
          calendar.accountLabel ?? providerDisplayName(calendar),
        provider: calendar.provider,
        reconnect,
      });
    }
  }
  return [...map.values()];
}

export function ConnectionsDialog({
  calendars,
  onNotice,
  onOpenChange,
  open,
  userId,
}: ConnectionsDialogProps) {
  const connections = useConnections(userId);
  const federated = useFederatedWorkspace(userId);
  const { busy, error, run, setError } = useAsyncAction();
  const [caldav, setCaldav] = useState<{
    apple: boolean;
    password: string;
    serverUrl: string;
    username: string;
  }>();
  const [inviteValue, setInviteValue] = useState("");
  const [invite, setInvite] = useState<{
    parsed: ParsedInvite;
    preview: InvitePreview;
  }>();

  const providers = connections.capabilities.data?.syncProviders ?? [];
  const accounts = connectedAccounts(calendars);
  const federatedServers = federated.data?.servers ?? [];

  async function connectSocial(
    provider: "google" | "microsoft",
    scopes: string[],
  ) {
    // Better Auth redirects the whole page to the provider and back to
    // callbackURL, so a success never returns here — only an early error does.
    await run(async () => {
      const result = await authClient.linkSocial({
        callbackURL: window.location.href,
        provider,
        scopes,
      });
      if (result?.error) throw new Error(result.error.message);
    }, "Could not start the connection.");
  }

  function reconnect(account: ConnectedAccount) {
    if (account.provider === "google") {
      void connectSocial("google", GOOGLE_CALENDAR_SCOPES);
    } else if (account.provider === "microsoft") {
      void connectSocial("microsoft", MICROSOFT_CALENDAR_SCOPES);
    } else {
      setCaldav({
        apple: false,
        password: "",
        serverUrl: "",
        username: "",
      });
    }
  }

  async function previewInvite(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const parsed = parseInviteLink(inviteValue, window.location.origin);
    if (!parsed) {
      setError("Paste a Musubi invite link.");
      return;
    }
    await run(async () => {
      const preview = parsed.server
        ? await getFederatedInvitePreview(parsed.server, parsed.token)
        : await getInvitePreview(parsed.token);
      setInvite({ parsed, preview });
    }, "That invite could not be opened. It may have expired.");
  }

  async function acceptInvite() {
    if (!invite) return;
    await run(async () => {
      await connections.acceptInvite(invite.parsed);
      onNotice(`Joined ${invite.preview.name}.`);
      setInvite(undefined);
      setInviteValue("");
    }, "Could not join that calendar.");
  }

  async function submitCaldav(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caldav) return;
    const serverUrl = caldav.apple ? APPLE_CALDAV_URL : caldav.serverUrl.trim();
    if (!serverUrl || !caldav.username.trim() || !caldav.password) {
      setError("Fill in the server, username and password.");
      return;
    }
    await run(async () => {
      await connections.connectCaldav({
        password: caldav.password,
        serverUrl,
        username: caldav.username.trim(),
      });
      onNotice("Calendar connected.");
      setCaldav(undefined);
    }, "Could not connect. Check the server and credentials.");
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          aria-describedby="connections-description"
          className={styles.manageDialog}
        >
          <header className={styles.manageDialogHeader}>
            <div>
              <Dialog.Title>Connections</Dialog.Title>
              <Dialog.Description id="connections-description">
                Sync calendars from Google, Outlook and Apple or CalDAV servers.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close connections"
                className={styles.iconButton}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </header>

          <section className={styles.transferSection}>
            <div className={styles.transferHeading}>
              <div>
                <h3>Connected accounts</h3>
                <p>Calendars from these accounts stay in sync both ways.</p>
              </div>
            </div>
            {accounts.length === 0 ? (
              <p className={styles.dialogLoading}>No connected accounts yet.</p>
            ) : (
              <ul className={styles.calendarManageList}>
                {accounts.map((account) => (
                  <li
                    className={styles.calendarManageRow}
                    key={`${account.provider}:${account.accountId}`}
                  >
                    <span className={styles.calendarManageName}>
                      {account.label}
                    </span>
                    <span className={styles.calendarBadge}>
                      {providerDisplayName({ provider: account.provider })}
                    </span>
                    {account.reconnect ? (
                      <button
                        className={styles.iconButton}
                        disabled={busy}
                        type="button"
                        aria-label={`Reconnect ${account.label}`}
                        onClick={() => reconnect(account)}
                      >
                        <RefreshCw aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                    <button
                      aria-label={`Disconnect ${account.label}`}
                      className={styles.iconButton}
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await connections.disconnectAccount({
                            accountId: account.accountId,
                            provider: account.provider,
                          });
                          onNotice(`${account.label} disconnected.`);
                        }, "Could not disconnect the account.")
                      }
                    >
                      <Unlink aria-hidden="true" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.transferSection}>
            <div className={styles.transferHeading}>
              <Users aria-hidden="true" size={17} />
              <div>
                <h3>Join a shared calendar</h3>
                <p>
                  Paste an invite link. If it belongs to another Musubi server,
                  your server connects to it for you.
                </p>
              </div>
            </div>
            {invite ? (
              <div className={styles.caldavForm}>
                <div className={styles.calendarManageRow}>
                  <span
                    className={styles.calendarDot}
                    style={{ backgroundColor: invite.preview.color }}
                  />
                  <span className={styles.calendarManageName}>
                    {invite.preview.name}
                  </span>
                  <span className={styles.calendarBadge}>
                    {invite.parsed.server
                      ? new URL(invite.parsed.server).host
                      : "This server"}
                  </span>
                </div>
                <p className={styles.caldavHint}>
                  {invite.preview.members.length} member
                  {invite.preview.members.length === 1 ? "" : "s"} ·{" "}
                  {invite.preview.events.length} event
                  {invite.preview.events.length === 1 ? "" : "s"} in the next 30
                  days. You join as a viewer.
                </p>
                <div className={styles.transferControls}>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    type="button"
                    onClick={() => setInvite(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.primaryButton}
                    disabled={busy}
                    type="button"
                    onClick={() => void acceptInvite()}
                  >
                    {busy ? "Joining…" : "Join calendar"}
                  </button>
                </div>
              </div>
            ) : (
              <form className={styles.transferControls} onSubmit={previewInvite}>
                <label>
                  <span className={styles.srOnly}>Invite link</span>
                  <input
                    disabled={busy}
                    placeholder="https://server/invite/…"
                    value={inviteValue}
                    onChange={(event) => setInviteValue(event.target.value)}
                  />
                </label>
                <button
                  className={styles.secondaryButton}
                  disabled={busy || !inviteValue.trim()}
                  type="submit"
                >
                  {busy ? "Opening…" : "Open invite"}
                </button>
              </form>
            )}
          </section>

          {federatedServers.length > 0 ? (
            <section className={styles.transferSection}>
              <div className={styles.transferHeading}>
                <div>
                  <h3>Musubi servers</h3>
                  <p>
                    Calendars shared with you from another Musubi server. Your
                    server talks to them for you.
                  </p>
                </div>
              </div>
              <ul className={styles.calendarManageList}>
                {federatedServers.map((server) => (
                  <li
                    className={styles.calendarManageRow}
                    key={server.connectionId}
                  >
                    <span className={styles.calendarManageName}>
                      {server.label}
                    </span>
                    <span className={styles.calendarBadge}>
                      {server.state === "active"
                        ? "Connected"
                        : server.state === "unauthorized"
                          ? "Needs a new invite"
                          : "Unreachable"}
                    </span>
                    {server.state === "unreachable" ? (
                      <button
                        aria-label={`Retry ${server.label}`}
                        className={styles.iconButton}
                        disabled={busy}
                        type="button"
                        onClick={() => void federated.refetch()}
                      >
                        <RefreshCw aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                    <button
                      aria-label={`Disconnect ${server.label}`}
                      className={styles.iconButton}
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await connections.disconnectFederatedServer(
                            server.server,
                          );
                          onNotice(`${server.label} disconnected.`);
                        }, "Could not disconnect the server.")
                      }
                    >
                      <Unlink aria-hidden="true" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={styles.transferSection}>
            <div className={styles.transferHeading}>
              <Link2 aria-hidden="true" size={17} />
              <div>
                <h3>Add a connection</h3>
                <p>Google and Outlook open a secure sign-in; you’ll return here after authorizing.</p>
              </div>
            </div>
            <div className={styles.connectionButtons}>
              {providers.includes("google") ? (
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void connectSocial("google", GOOGLE_CALENDAR_SCOPES)
                  }
                >
                  Connect Google Calendar
                </button>
              ) : null}
              {providers.includes("microsoft") ? (
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void connectSocial(
                      "microsoft",
                      MICROSOFT_CALENDAR_SCOPES,
                    )
                  }
                >
                  Connect Outlook
                </button>
              ) : null}
              {providers.includes("caldav") ? (
                <>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      setCaldav({
                        apple: true,
                        password: "",
                        serverUrl: APPLE_CALDAV_URL,
                        username: "",
                      })
                    }
                  >
                    Connect Apple / iCloud
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      setCaldav({
                        apple: false,
                        password: "",
                        serverUrl: "",
                        username: "",
                      })
                    }
                  >
                    Connect other (CalDAV)
                  </button>
                </>
              ) : null}
            </div>

            {caldav ? (
              <form className={styles.caldavForm} onSubmit={submitCaldav}>
                {caldav.apple ? (
                  <p className={styles.caldavHint}>
                    Use an app-specific password from appleid.apple.com — not
                    your Apple ID password.
                  </p>
                ) : (
                  <label>
                    <span className={styles.srOnly}>CalDAV server URL</span>
                    <input
                      disabled={busy}
                      placeholder="https://caldav.example.com"
                      value={caldav.serverUrl}
                      onChange={(event) =>
                        setCaldav({ ...caldav, serverUrl: event.target.value })
                      }
                    />
                  </label>
                )}
                <label>
                  <span className={styles.srOnly}>Username</span>
                  <input
                    autoComplete="username"
                    disabled={busy}
                    placeholder={caldav.apple ? "Apple ID email" : "Username"}
                    value={caldav.username}
                    onChange={(event) =>
                      setCaldav({ ...caldav, username: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span className={styles.srOnly}>Password</span>
                  <input
                    autoComplete="current-password"
                    disabled={busy}
                    placeholder="Password"
                    type="password"
                    value={caldav.password}
                    onChange={(event) =>
                      setCaldav({ ...caldav, password: event.target.value })
                    }
                  />
                </label>
                <div className={styles.transferControls}>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    type="button"
                    onClick={() => setCaldav(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.primaryButton}
                    disabled={busy}
                    type="submit"
                  >
                    <Plus aria-hidden="true" size={16} />
                    <span>{busy ? "Connecting…" : "Connect"}</span>
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          {error ? (
            <div className={styles.formError} role="alert">
              <p>{error}</p>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
