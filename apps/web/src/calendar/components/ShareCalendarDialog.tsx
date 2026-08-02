import { can, type Calendar } from "@musubi/types";
import {
  Copy,
  Link2,
  ShieldCheck,
  Trash2,
  UserRoundMinus,
} from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import type { CalendarMember } from "~/api/contracts";
import { useCalendarSharing } from "~/calendar/calendar-sharing";
import { Avatar } from "~/ui/Avatar";
import { Button, IconButton } from "~/ui/Button";
import {
  ConfirmationDialog,
  ConfirmationNotice,
  DialogError,
} from "~/ui/ConfirmationDialog";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";
import { Segmented } from "~/ui/Segmented";
import { SectionLabel } from "~/ui/SectionLabel";
import { useAsyncAction } from "~/ui/useAsyncAction";
import styles from "./styles/sharing.module.css";

type ShareCalendarDialogProps = {
  calendar: Calendar | null;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  userId: string;
};

type MemberAccess = "editor" | "viewer";

const MEMBER_ACCESS_OPTIONS = [
  { label: "Viewer", value: "viewer" },
  { label: "Editor", value: "editor" },
] as const;

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
  const [transferMember, setTransferMember] = useState<CalendarMember>();
  const transferReturnFocusRef = useRef<HTMLButtonElement>(null);

  const open = Boolean(calendar);
  const canManage = can(calendar?.role, "manageMembers");
  const isOwner = calendar?.role === "owner";
  const members = sharing.members.data ?? [];
  const invites = sharing.invites.data ?? [];
  const canTransfer = Boolean(
    calendar && isOwner && !calendar.isDefault && !calendar.provider,
  );

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setError("");
      setTransferMember(undefined);
    }
    onOpenChange(nextOpen);
  }

  async function copyLink(inviteId: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(inviteId));
      onNotice("Invite link copied.");
    } catch {
      setError("Could not copy the link. Select and copy it instead.");
    }
  }

  async function changeRole(member: CalendarMember, role: MemberAccess) {
    const changed = await run(async () => {
      await sharing.setMemberRole({ role, userId: member.id });
      return true;
    }, "Could not change the role.");

    if (changed) {
      onNotice(
        `${member.name} is now ${
          role === "editor" ? "an editor" : "a viewer"
        }.`,
      );
    }
  }

  async function removeMember(member: CalendarMember) {
    const removed = await run(async () => {
      await sharing.removeMember(member.id);
      return true;
    }, "Could not remove the member.");

    if (removed) onNotice(`${member.name} no longer has access.`);
  }

  async function createInvite() {
    const created = await run(async () => {
      await sharing.createInvite({
        expiresAt: null,
        maxUses: null,
      });
      return true;
    }, "Could not create an invite link.");

    if (created) onNotice("Invite link created.");
  }

  async function revokeInvite(inviteId: string) {
    const revoked = await run(async () => {
      await sharing.revokeInvite(inviteId);
      return true;
    }, "Could not revoke the link.");

    if (revoked) onNotice("Invite link revoked.");
  }

  async function leaveCalendar() {
    if (!calendar) return;
    const left = await run(async () => {
      await sharing.leaveCalendar();
      return true;
    }, "Could not leave the calendar.");

    if (left) {
      onNotice(`You left ${calendar.name}.`);
      onOpenChange(false);
    }
  }

  return (
    <>
      <Dialog
        bodyClassName={styles.body}
        bodyLayout="flush"
        closeLabel="Close sharing"
        description="Choose who can view or edit this calendar, and manage links for new members."
        footer={
          <>
            {!isOwner && calendar ? (
              <Button
                className={styles.leaveButton}
                disabled={busy}
                icon={<UserRoundMinus size={16} strokeWidth={1.7} />}
                variant="ghost"
                onClick={() => void leaveCalendar()}
              >
                Leave calendar
              </Button>
            ) : null}
            <DialogClose>
              <Button disabled={busy} variant="secondary">
                Done
              </Button>
            </DialogClose>
            {sharing.canInvite ? (
              <Button
                icon={<Link2 size={16} strokeWidth={1.7} />}
                loading={busy}
                onClick={() => void createInvite()}
              >
                Create invite link
              </Button>
            ) : null}
          </>
        }
        onOpenChange={handleOpenChange}
        open={open}
        title={`Share ${calendar?.name ?? "calendar"}`}
      >
        <div aria-busy={busy || undefined}>
          <section
            aria-labelledby="sharing-members-title"
            className={styles.section}
          >
            <div className={styles.sectionHeading}>
              <div>
                <SectionLabel id="sharing-members-title">Members</SectionLabel>
                <p>People who already have access to this calendar.</p>
              </div>
              <span className={styles.count}>
                {members.length} {members.length === 1 ? "person" : "people"}
              </span>
            </div>

            {sharing.members.isPending ? (
              <p aria-live="polite" className={styles.loading}>
                Loading members…
              </p>
            ) : sharing.members.isError ? (
              <div className={styles.sectionError} role="alert">
                Members could not be loaded. Close the dialog and try again.
              </div>
            ) : (
              <ul aria-label="Calendar members" className={styles.memberList}>
                {members.map((member) => {
                  const memberIsOwner = member.role === "owner";
                  const removable =
                    canManage && !memberIsOwner && member.id !== userId;
                  const access: MemberAccess =
                    member.role === "editor" ? "editor" : "viewer";

                  return (
                    <li className={styles.memberRow} key={member.id}>
                      <div className={styles.memberIdentity}>
                        <Avatar
                          image={member.image}
                          name={member.name}
                          size={34}
                        />
                        <span className={styles.memberCopy}>
                          <strong>
                            {member.name}
                            {member.id === userId ? " (you)" : ""}
                          </strong>
                          <span>
                            {memberIsOwner
                              ? "Calendar owner"
                              : access === "editor"
                                ? "Can change events"
                                : "Can view events"}
                          </span>
                        </span>
                      </div>

                      {canManage && !memberIsOwner ? (
                        <div className={styles.memberActions}>
                          <Segmented
                            className={styles.roleControl}
                            disabled={busy}
                            label={`${member.name} role`}
                            options={MEMBER_ACCESS_OPTIONS}
                            value={access}
                            onChange={(role) => void changeRole(member, role)}
                          />
                          {canTransfer ? (
                            <Button
                              className={styles.transferButton}
                              disabled={busy}
                              size="compact"
                              variant="ghost"
                              onClick={(event) => {
                                transferReturnFocusRef.current =
                                  event.currentTarget;
                                setError("");
                                setTransferMember(member);
                              }}
                            >
                              Make owner
                            </Button>
                          ) : null}
                          {removable ? (
                            <IconButton
                              className={styles.removeButton}
                              disabled={busy}
                              label={`Remove ${member.name}`}
                              size="compact"
                              onClick={() => void removeMember(member)}
                            >
                              <Trash2 size={15} strokeWidth={1.7} />
                            </IconButton>
                          ) : null}
                        </div>
                      ) : (
                        <span className={styles.roleBadge}>
                          {memberIsOwner ? "Owner" : access}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {sharing.canInvite ? (
            <section
              aria-labelledby="sharing-invites-title"
              className={styles.section}
            >
              <div className={styles.sectionHeading}>
                <div>
                  <SectionLabel id="sharing-invites-title">
                    Invite links
                  </SectionLabel>
                  <p>Anyone with a link joins as a viewer.</p>
                </div>
              </div>

              {sharing.invites.isPending ? (
                <p aria-live="polite" className={styles.loading}>
                  Loading invite links…
                </p>
              ) : sharing.invites.isError ? (
                <div className={styles.sectionError} role="alert">
                  Invite links could not be loaded.
                </div>
              ) : invites.length > 0 ? (
                <ul
                  aria-label="Active invite links"
                  className={styles.inviteList}
                >
                  {invites.map((invite) => (
                    <li className={styles.inviteRow} key={invite.id}>
                      <span className={styles.inviteIcon} aria-hidden="true">
                        <Link2 size={16} strokeWidth={1.7} />
                      </span>
                      <input
                        aria-label="Invite link"
                        readOnly
                        value={inviteLink(invite.id)}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <IconButton
                        label="Copy invite link"
                        size="compact"
                        onClick={() => void copyLink(invite.id)}
                      >
                        <Copy size={15} strokeWidth={1.7} />
                      </IconButton>
                      <IconButton
                        className={styles.revokeButton}
                        disabled={busy}
                        label="Revoke invite link"
                        size="compact"
                        onClick={() => void revokeInvite(invite.id)}
                      >
                        <Trash2 size={15} strokeWidth={1.7} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty
                  className={styles.empty}
                  description="Create a link when you want to invite someone without entering their details."
                  icon={<Link2 size={18} strokeWidth={1.7} />}
                  title="No active invite links"
                />
              )}
            </section>
          ) : null}

          {error ? (
            <div className={styles.error} role="alert">
              <p>{error}</p>
            </div>
          ) : null}
        </div>
      </Dialog>

      {calendar && transferMember ? (
        <TransferOwnershipDialog
          calendar={calendar}
          member={transferMember}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setTransferMember(undefined);
          }}
          onTransferred={() => {
            setTransferMember(undefined);
            onNotice(
              `${transferMember.name} is now the owner of ${calendar.name}.`,
            );
            onOpenChange(false);
          }}
          returnFocus={transferReturnFocusRef}
          setOwner={sharing.setMemberRole}
        />
      ) : null}
    </>
  );
}

function TransferOwnershipDialog({
  calendar,
  member,
  onOpenChange,
  onTransferred,
  returnFocus,
  setOwner,
}: {
  calendar: Calendar;
  member: CalendarMember;
  onOpenChange: (open: boolean) => void;
  onTransferred: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  setOwner: (input: { role: string; userId: string }) => Promise<unknown>;
}) {
  const { busy, error, run } = useAsyncAction();

  async function transferOwnership() {
    const transferred = await run(async () => {
      await setOwner({ role: "owner", userId: member.id });
      return true;
    }, "Ownership could not be transferred. You are still the owner — try again.");

    if (transferred) onTransferred();
  }

  return (
    <ConfirmationDialog
      closeLabel="Close ownership transfer"
      confirmLabel="Transfer ownership"
      description={`You will become an editor and lose access to sharing controls for ${calendar.name}.`}
      loading={busy}
      onConfirm={() => void transferOwnership()}
      onOpenChange={onOpenChange}
      open
      returnFocus={returnFocus}
      title={`Make ${member.name} the owner?`}
    >
      <ConfirmationNotice icon={<ShieldCheck size={19} strokeWidth={1.7} />}>
        <p>
          <strong>{member.name}</strong> will control members, invite links, and
          calendar settings. This change takes effect immediately.
        </p>
      </ConfirmationNotice>
      {error ? <DialogError>{error}</DialogError> : null}
    </ConfirmationDialog>
  );
}
