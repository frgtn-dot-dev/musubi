import * as Dialog from "@radix-ui/react-dialog";
import { Camera, X } from "lucide-react";
import { useState } from "react";
import { authClient } from "~/auth/auth-client";
import { deleteAccount, uploadAvatar } from "~/api/resources";
import { useAsyncAction } from "~/ui/useAsyncAction";
import styles from "./workspace.module.css";

type AccountDialogProps = {
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const AVATAR_MAX_BYTES = 256 * 1024;

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
  const [name, setName] = useState(user?.name ?? "");
  const [confirmName, setConfirmName] = useState("");
  const { busy, error, run, setError } = useAsyncAction();

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.name) return;
    await run(async () => {
      const result = await authClient.updateUser({ name: trimmed });
      if (result.error) throw new Error(result.error.message);
      await session.refetch();
      onNotice("Name updated.");
    }, "Could not update your name.");
  }

  async function changeAvatar(file: File) {
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
      onNotice("Check your email for a link to reset your password.");
    }, "Could not start a password reset.");
  }

  async function removeAccount() {
    await run(async () => {
      await deleteAccount();
      onNotice(
        "Check your email — open the link we sent to permanently delete your account.",
      );
      onOpenChange(false);
    }, "Your account could not be deleted.");
  }

  const nameDirty = name.trim().length > 0 && name.trim() !== user?.name;
  const confirmMatches = Boolean(user) && confirmName.trim() === user?.name;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          aria-describedby="account-description"
          className={styles.manageDialog}
        >
          <header className={styles.manageDialogHeader}>
            <div>
              <Dialog.Title>Account</Dialog.Title>
              <Dialog.Description id="account-description">
                Your name and photo appear to people you share calendars with.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close account"
                className={styles.iconButton}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </header>

          <section className={styles.transferSection}>
            <div className={styles.accountIdentity}>
              <span className={styles.accountAvatar} aria-hidden="true">
                {user?.image ? (
                  <img alt="" src={user.image} />
                ) : (
                  (user?.name?.trim().charAt(0).toLocaleUpperCase() ?? "M")
                )}
              </span>
              <label className={styles.secondaryButton}>
                <Camera aria-hidden="true" size={15} />
                <span>Change photo</span>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className={styles.srOnly}
                  disabled={busy}
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void changeAvatar(file);
                  }}
                />
              </label>
            </div>

            <label className={styles.settingRow}>
              <span>Display name</span>
              <input
                aria-label="Display name"
                disabled={busy}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className={styles.transferControls}>
              <span className={styles.accountEmail}>{user?.email}</span>
              <button
                className={styles.secondaryButton}
                disabled={busy}
                type="button"
                onClick={() => void resetPassword()}
              >
                Reset password
              </button>
              <button
                className={styles.primaryButton}
                disabled={busy || !nameDirty}
                type="button"
                onClick={() => void saveName()}
              >
                Save name
              </button>
            </div>
          </section>

          <section className={styles.transferSection}>
            <div className={styles.transferHeading}>
              <div>
                <h3>Delete account</h3>
                <p>
                  Permanently removes your account and data. Type your name to
                  confirm — we’ll email you a final confirmation link.
                </p>
              </div>
            </div>
            <div className={styles.transferControls}>
              <label>
                <span className={styles.srOnly}>
                  Type your name to confirm deletion
                </span>
                <input
                  disabled={busy}
                  placeholder={user?.name ?? "Your name"}
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                />
              </label>
              <button
                className={styles.dangerButton}
                disabled={busy || !confirmMatches}
                type="button"
                onClick={() => void removeAccount()}
              >
                Delete account
              </button>
            </div>
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
