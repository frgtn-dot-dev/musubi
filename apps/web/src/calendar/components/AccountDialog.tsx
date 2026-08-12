import {
  Camera,
  KeyRound,
  Mail,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useId,
  useRef,
  useState,
} from "react";
import { deleteAccount, uploadAvatar } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { Avatar } from "~/ui/Avatar";
import { Button } from "~/ui/Button";
import {
  ConfirmationDialog,
  ConfirmationNotice,
  DialogError,
} from "~/ui/ConfirmationDialog";
import { Dialog } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { RowAction } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import { useAsyncAction } from "~/ui/useAsyncAction";
import styles from "./styles/account.module.css";

type AccountDialogProps = {
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

type AccountUser = {
  email: string;
  // Decides who is asked to approve a change of address, so the copy can say
  // which inbox to look in rather than guessing.
  emailVerified?: boolean;
  image?: null | string;
  name: string;
};

const AVATAR_MAX_BYTES = 256 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Strip the `data:<mime>;base64,` prefix — the API wants raw base64.
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(file);
  });
}

export function AccountDialog({
  onNotice,
  onOpenChange,
  open,
}: AccountDialogProps) {
  const session = authClient.useSession();
  const user = session.data?.user;
  const avatarInputId = useId();
  const nameActionRef = useRef<HTMLButtonElement>(null);
  const emailActionRef = useRef<HTMLButtonElement>(null);
  const deleteActionRef = useRef<HTMLButtonElement>(null);
  const [nameEditorOpen, setNameEditorOpen] = useState(false);
  const [emailEditorOpen, setEmailEditorOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { busy, error, run, setError } = useAsyncAction();

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setError("");
      setNameEditorOpen(false);
      setEmailEditorOpen(false);
      setDeleteDialogOpen(false);
    }
    onOpenChange(nextOpen);
  }

  async function changeAvatar(file: File) {
    if (!AVATAR_TYPES.has(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError("Choose an image up to 256 KB.");
      return;
    }

    await run(async () => {
      const { url } = await uploadAvatar(await toBase64(file));
      const result = await authClient.updateUser({ image: url });
      if (result.error) throw new Error(result.error.message);
      await session.refetch();
      onNotice("Photo updated.");
    }, "Could not update your photo.");
  }

  async function resetPassword() {
    if (!user?.email) return;
    await run(async () => {
      const result = await authClient.requestPasswordReset({
        email: user.email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) throw new Error(result.error.message);
      onNotice("Check your email for a link to set a new passphrase.");
    }, "Could not start a passphrase reset.");
  }

  return (
    <>
      <Dialog
        bodyLayout="flush"
        closeLabel="Close account"
        description="Your profile is visible to people you share calendars with."
        onOpenChange={handleOpenChange}
        open={open}
        title="Account"
      >
        <div aria-busy={busy || undefined} className={styles.content}>
          <div className={styles.identity}>
            <input
              accept="image/png,image/jpeg,image/webp"
              aria-label="Change profile photo"
              className={styles.visuallyHidden}
              disabled={busy}
              id={avatarInputId}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void changeAvatar(file);
              }}
            />
            <label
              className={styles.avatarControl}
              htmlFor={avatarInputId}
            >
              <Avatar
                image={user?.image}
                name={user?.name ?? "Musubi"}
                size={64}
              />
              <span className={styles.cameraBadge} aria-hidden="true">
                <Camera size={13} strokeWidth={2} />
              </span>
            </label>
            <div className={styles.identityCopy}>
              <strong>{user?.name ?? "Your profile"}</strong>
              <span>{user?.email ?? "Loading account…"}</span>
              <label
                className={styles.changePhotoControl}
                htmlFor={avatarInputId}
              >
                Change photo
              </label>
            </div>
          </div>

          <SettingsSection title="Profile">
            <RowAction
              disabled={!user || busy}
              icon={<Pencil size={17} strokeWidth={1.7} />}
              label="Display name"
              ref={nameActionRef}
              value={user?.name}
              onClick={() => {
                setError("");
                setNameEditorOpen(true);
              }}
            />
            <RowAction
              detail={
                user?.emailVerified
                  ? "We’ll ask the current address to approve it"
                  : "We’ll send a confirmation to the new address"
              }
              disabled={!user || busy}
              icon={<Mail size={17} strokeWidth={1.7} />}
              label="Email"
              ref={emailActionRef}
              value={user?.email}
              onClick={() => {
                setError("");
                setEmailEditorOpen(true);
              }}
            />
          </SettingsSection>

          <SettingsSection title="Security">
            <RowAction
              detail="We’ll email you a link to set a new one"
              disabled={!user?.email || busy}
              icon={<KeyRound size={17} strokeWidth={1.7} />}
              label="Reset passphrase"
              showChevron={false}
              onClick={() => void resetPassword()}
            />
          </SettingsSection>

          <SettingsSection title="Leaving Musubi">
            <RowAction
              detail="Requires an email confirmation before anything is removed"
              disabled={!user || busy}
              icon={<Trash2 size={17} strokeWidth={1.7} />}
              label="Delete account"
              ref={deleteActionRef}
              tone="destructive"
              onClick={() => {
                setError("");
                setDeleteDialogOpen(true);
              }}
            />
          </SettingsSection>

          {error ? (
            <div className={styles.error} role="alert">
              <p>{error}</p>
            </div>
          ) : null}
        </div>
      </Dialog>

      {user && nameEditorOpen ? (
        <EditNameDialog
          key={user.name}
          onNotice={onNotice}
          onOpenChange={setNameEditorOpen}
          onRefetch={() => session.refetch()}
          open
          returnFocus={nameActionRef}
          user={user}
        />
      ) : null}

      {user && emailEditorOpen ? (
        <EditEmailDialog
          key={user.email}
          onNotice={onNotice}
          onOpenChange={setEmailEditorOpen}
          open
          returnFocus={emailActionRef}
          user={user}
        />
      ) : null}

      {user && deleteDialogOpen ? (
        <DeleteAccountDialog
          onDeleted={() => {
            setDeleteDialogOpen(false);
            onNotice(
              "Check your email — open the link we sent to permanently delete your account.",
            );
            onOpenChange(false);
          }}
          onOpenChange={setDeleteDialogOpen}
          open
          returnFocus={deleteActionRef}
          userName={user.name}
        />
      ) : null}
    </>
  );
}

function EditNameDialog({
  onNotice,
  onOpenChange,
  onRefetch,
  open,
  returnFocus,
  user,
}: {
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onRefetch: () => Promise<unknown>;
  open: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  user: AccountUser;
}) {
  const [name, setName] = useState(user.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useAsyncAction();
  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && trimmedName !== user.name;

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    const saved = await run(async () => {
      const result = await authClient.updateUser({ name: trimmedName });
      if (result.error) throw new Error(result.error.message);
      await onRefetch();
      return true;
    }, "Could not update your name.");

    if (saved) {
      onNotice("Name updated.");
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      closeLabel="Close display name"
      description="This is how other people will recognize you in shared calendars."
      footer={
        <>
          <Button
            disabled={!canSave}
            form="display-name-form"
            loading={busy}
            type="submit"
          >
            Save
          </Button>
        </>
      }
      initialFocus={inputRef}
      onOpenChange={onOpenChange}
      open={open}
      returnFocus={returnFocus}
      size="compact"
      title="Display name"
    >
      <form
        className={styles.dialogForm}
        id="display-name-form"
        onSubmit={(event) => void saveName(event)}
      >
        <Field
          description="Use the name people already know you by."
          label="Display name"
        >
          <input
            autoComplete="name"
            disabled={busy}
            maxLength={80}
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {error ? (
          <div className={styles.dialogError} role="alert">
            <p>{error}</p>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

function DeleteAccountDialog({
  onDeleted,
  onOpenChange,
  open,
  returnFocus,
  userName,
}: {
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  userName: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useAsyncAction();
  const matches = confirmation === userName;

  async function removeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    const deleted = await run(async () => {
      await deleteAccount();
      return true;
    }, "Your account could not be deleted. It is still active — try again.");
    if (deleted) onDeleted();
  }

  return (
    <ConfirmationDialog
      closeLabel="Close account deletion"
      confirmDisabled={!matches}
      confirmForm="delete-account-form"
      confirmLabel="Delete account"
      description="Permanently removes your account and data after you open the final confirmation link we email you."
      initialFocus={inputRef}
      loading={busy}
      onOpenChange={onOpenChange}
      open={open}
      returnFocus={returnFocus}
      title="Delete account?"
    >
      <form
        className={styles.dialogForm}
        id="delete-account-form"
        onSubmit={(event) => void removeAccount(event)}
      >
        <ConfirmationNotice
          icon={<UserRound size={19} strokeWidth={1.6} />}
        >
          <p>
            Type <strong>{userName}</strong> exactly to continue.
          </p>
        </ConfirmationNotice>
        <Field label={`Type ${userName} to confirm`}>
          <input
            autoComplete="off"
            disabled={busy}
            placeholder={userName}
            ref={inputRef}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        {error ? <DialogError>{error}</DialogError> : null}
      </form>
    </ConfirmationDialog>
  );
}

function EditEmailDialog({
  onNotice,
  onOpenChange,
  open,
  returnFocus,
  user,
}: {
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  user: AccountUser;
}) {
  const [email, setEmail] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useAsyncAction();
  const next = email.trim().toLowerCase();
  const canSave =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) && next !== user.email.toLowerCase();

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    const sent = await run(async () => {
      const result = await authClient.changeEmail({
        callbackURL: "/",
        newEmail: next,
      });
      if (result.error) throw new Error(result.error.message);
      return true;
    }, "Could not start the email change.");

    if (sent) {
      // Deliberately the same sentence whether or not the address is already
      // taken: the server answers identically for that reason, and saying more
      // here would turn this form into a way to test who has an account.
      onNotice(
        user.emailVerified
          ? `Check ${user.email} — approve the change from there.`
          : `Check ${next} for a link to confirm the new address.`,
      );
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      closeLabel="Close email"
      description={
        user.emailVerified
          ? "Your current address has to approve the move, so a stolen session cannot take the account somewhere you can't reach."
          : "We'll send a link to the new address. The change happens when you open it."
      }
      footer={
        <>
          <Button disabled={!canSave} form="email-form" loading={busy} type="submit">
            Send the link
          </Button>
        </>
      }
      initialFocus={inputRef}
      onOpenChange={onOpenChange}
      open={open}
      returnFocus={returnFocus}
      size="compact"
      title="Change email"
    >
      <form
        className={styles.dialogForm}
        id="email-form"
        onSubmit={(event) => void saveEmail(event)}
      >
        <Field description={`Currently ${user.email}.`} label="New email">
          <input
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            ref={inputRef}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </Dialog>
  );
}
