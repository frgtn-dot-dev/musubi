import * as Dialog from "@radix-ui/react-dialog";
import { can, type Calendar } from "@musubi/types";
import { Copy, Link2, Trash2, X } from "lucide-react";
import { useCalendarSharing } from "~/calendar/calendar-sharing";
import { Avatar } from "~/ui/Avatar";
import { useAsyncAction } from "~/ui/useAsyncAction";
import styles from "./workspace.module.css";

type ShareCalendarDialogProps = {
  calendar: Calendar | null;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  userId: string;
};

function inviteLink(inviteId: string) {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/invite/${inviteId}`;
}

export function ShareCalendarDialog({
  calendar,
  onNotice,
  onOpenChange,
  userId,
}: ShareCalendarDialogProps) {
  const sharing = useCalendarSharing(userId, calendar);
  const { busy, error, run, setError } = useAsyncAction();

  const open = Boolean(calendar);
  const canManage = can(calendar?.role, "manageMembers");
  const isOwner = calendar?.role === "owner";

  async function copyLink(inviteId: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(inviteId));
      onNotice("Invite link copied.");
    } catch {
      setError("Could not copy the link. Copy it from the field instead.");
    }
  }

  const members = sharing.members.data ?? [];
  const invites = sharing.invites.data ?? [];
  // Personal and provider-backed calendars can't change hands (the server
  // rejects it), so only offer the transfer where it can actually happen.
  const canTransfer = Boolean(
    calendar && !calendar.isDefault && !calendar.provider,
  );

  function changeRole(memberId: string, memberName: string, role: string) {
    if (
      role === "owner" &&
      !window.confirm(
        `Make ${memberName} the owner? You’ll become an editor and lose management access.`,
      )
    ) {
      return;
    }
    void run(
      () => sharing.setMemberRole({ role, userId: memberId }),
      "Could not change the role.",
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          aria-describedby="share-calendar-description"
          className={styles.manageDialog}
        >
          <header className={styles.manageDialogHeader}>
            <div>
              <Dialog.Title>Share {calendar?.name}</Dialog.Title>
              <Dialog.Description id="share-calendar-description">
                Manage who can see and edit this calendar.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close sharing"
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
                <h3>Members</h3>
                <p>Everyone with access to this calendar.</p>
              </div>
            </div>

            {sharing.members.isPending ? (
              <p className={styles.dialogLoading}>Loading members…</p>
            ) : (
              <ul className={styles.calendarManageList}>
                {members.map((member) => {
                  const memberIsOwner = member.role === "owner";
                  const removable =
                    canManage && !memberIsOwner && member.id !== userId;

                  return (
                    <li
                      className={styles.calendarManageRow}
                      key={member.id}
                    >
                      <Avatar
                        image={member.image}
                        name={member.name}
                        size={32}
                      />
                      <span className={styles.calendarManageName}>
                        {member.name}
                        {member.id === userId ? " (you)" : ""}
                      </span>
                      {canManage && !memberIsOwner ? (
                        <label>
                          <span className={styles.srOnly}>
                            {member.name} role
                          </span>
                          <select
                            disabled={busy}
                            value={member.role}
                            onChange={(event) =>
                              changeRole(
                                member.id,
                                member.name,
                                event.target.value,
                              )
                            }
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                            {canTransfer ? (
                              <option value="owner">Owner</option>
                            ) : null}
                          </select>
                        </label>
                      ) : (
                        <span className={styles.calendarBadge}>
                          {memberIsOwner ? "Owner" : member.role}
                        </span>
                      )}
                      {removable ? (
                        <button
                          aria-label={`Remove ${member.name}`}
                          className={styles.iconButton}
                          disabled={busy}
                          type="button"
                          onClick={() =>
                            void run(
                              () => sharing.removeMember(member.id),
                              "Could not remove the member.",
                            )
                          }
                        >
                          <Trash2 aria-hidden="true" size={15} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {!isOwner && calendar ? (
              <button
                className={styles.secondaryButton}
                disabled={busy}
                type="button"
                onClick={() =>
                  void run(async () => {
                    await sharing.leaveCalendar();
                    onNotice(`You left ${calendar.name}.`);
                    onOpenChange(false);
                  }, "Could not leave the calendar.")
                }
              >
                Leave calendar
              </button>
            ) : null}
          </section>

          {sharing.canInvite ? (
            <section className={styles.transferSection}>
              <div className={styles.transferHeading}>
                <Link2 aria-hidden="true" size={17} />
                <div>
                  <h3>Invite links</h3>
                  <p>Anyone with a link joins as a viewer you can promote.</p>
                </div>
              </div>

              {invites.map((invite) => (
                <div className={styles.transferControls} key={invite.id}>
                  <input
                    aria-label="Invite link"
                    readOnly
                    value={inviteLink(invite.id)}
                  />
                  <button
                    aria-label="Copy invite link"
                    className={styles.iconButton}
                    type="button"
                    onClick={() => void copyLink(invite.id)}
                  >
                    <Copy aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label="Revoke invite link"
                    className={styles.iconButton}
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      void run(
                        () => sharing.revokeInvite(invite.id),
                        "Could not revoke the link.",
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              ))}

              <button
                className={styles.primaryButton}
                disabled={busy}
                type="button"
                onClick={() =>
                  void run(async () => {
                    await sharing.createInvite({
                      expiresAt: null,
                      maxUses: null,
                    });
                    onNotice("Invite link created.");
                  }, "Could not create an invite link.")
                }
              >
                Create invite link
              </button>
            </section>
          ) : null}

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
