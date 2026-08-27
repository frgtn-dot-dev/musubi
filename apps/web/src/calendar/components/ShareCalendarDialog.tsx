import { can, type Calendar } from "@musubi/types";
import {
  Copy,
  Link2,
  Send,
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
} from "~/ui/ConfirmationDialog";
import { Dialog } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";
import { InlineError } from "~/ui/InlineError";
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
  const [inviteEmail, setInviteEmail] = useState("");
  // What the next link will allow. It expires by default; the people cap stays
  // empty until the organizer needs one.
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [maxUses, setMaxUses] = useState("");
  const validLimits = [expiresInDays, maxUses].every(
    (value) => value === "" || (Number.isInteger(Number(value)) && Number(value) > 0),
  );
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

  /**
   * Email an invitation, making a link first if there is not one already.
   *
   * The API sends an EXISTING invite, so revoking still kills every copy of a
   * link however it travelled. Whether one existed already is not something the
   * person typing an address should have to think about.
   */
  async function emailInvite() {
    const address = inviteEmail.trim();
    if (!address) return;

    const sent = await run(async () => {
      const existing = invites[0];
      const target =
        existing ??
        (await sharing.createInvite({
          expiresAt: expiresInDays
            ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
            : null,
          maxUses: maxUses ? Number(maxUses) : null,
        }));
      await sharing.sendInvite({ email: address, inviteId: target.id });
      return true;
    }, "Could not send that invitation.");

    if (sent) {
      setInviteEmail("");
      onNotice(`Invitation sent to ${address}.`);
    }
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
    const days = Number(expiresInDays);
    const created = await run(async () => {
      await sharing.createInvite({
        // A relative day count keeps this compact while allowing any expiry.
        expiresAt:
          days > 0 ? new Date(Date.now() + days * 24 * 60 * 60_000) : null,
        maxUses: maxUses === "" ? null : Number(maxUses),
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
              <SectionLabel id="sharing-members-title">Members</SectionLabel>
              {/* Nothing rather than "0 people" while the list is on its way:
                  a count is a fact about the calendar, and zero is the one
                  answer that changes what someone does next. */}
              {sharing.members.isPending ? null : (
                <span className={styles.count}>
                  {members.length} {members.length === 1 ? "person" : "people"}
                </span>
              )}
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
                              variant="secondary"
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
            {!isOwner && calendar ? (
              <div className={styles.leaveRow}>
                <Button
                  className={styles.leaveButton}
                  disabled={busy}
                  icon={<UserRoundMinus size={16} strokeWidth={1.7} />}
                  variant="secondary"
                  onClick={() => void leaveCalendar()}
                >
                  Leave calendar
                </Button>
              </div>
            ) : null}
          </section>

          {sharing.canInvite ? (
            <section
              aria-labelledby="sharing-invites-title"
              className={styles.section}
            >
              <div className={styles.sectionHeading}>
                <SectionLabel id="sharing-invites-title">
                  Invite links
                </SectionLabel>
              </div>

              {/* Empty means no limit; positive whole numbers are sent as-is. */}
              <div className={styles.inviteOptions}>
                <label className={styles.inviteLimit}>
                  <span>Expires after</span>
                  <span className={styles.inviteNumber}>
                    <input
                      aria-label="Expires after days"
                      disabled={busy}
                      inputMode="numeric"
                      min="1"
                      placeholder="Never"
                      step="1"
                      type="number"
                      value={expiresInDays}
                      onChange={(event) => setExpiresInDays(event.target.value)}
                    />
                    {expiresInDays ? (
                      <span aria-hidden="true">
                        {expiresInDays === "1" ? "day" : "days"}
                      </span>
                    ) : null}
                  </span>
                </label>
                <label className={styles.inviteLimit}>
                  <span>People limit</span>
                  <input
                    aria-label="How many people"
                    disabled={busy}
                    inputMode="numeric"
                    min="1"
                    placeholder="No limit"
                    step="1"
                    type="number"
                    value={maxUses}
                    onChange={(event) => setMaxUses(event.target.value)}
                  />
                </label>
                <label className={styles.inviteLimit}>
                  <span>Invite by email</span>
                  <input
                    aria-label="Email an invitation"
                    disabled={busy}
                    placeholder="name@example.com"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void emailInvite();
                    }}
                  />
                </label>
                <Button
                  disabled={!validLimits || !inviteEmail.trim()}
                  icon={<Send size={16} strokeWidth={1.7} />}
                  loading={busy}
                  size="compact"
                  onClick={() => void emailInvite()}
                >
                  Send
                </Button>
                <Button
                  className={styles.createInviteButton}
                  disabled={!validLimits}
                  icon={<Link2 size={16} strokeWidth={1.7} />}
                  loading={busy}
                  size="compact"
                  onClick={() => void createInvite()}
                >
                  Create invite link
                </Button>
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
            <InlineError className={styles.error}>{error}</InlineError>
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
      {error ? <InlineError>{error}</InlineError> : null}
    </ConfirmationDialog>
  );
}
