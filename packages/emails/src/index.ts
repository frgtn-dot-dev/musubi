import { config, logger } from "@musubi/config";
import nodemailer from "nodemailer";

export { getPasswordResetHtml } from "./password_reset";
export { getDeleteAccountHtml } from "./delete_account";
export { getVerifyEmailHtml } from "./verify_email";
export { getChangeEmailHtml } from "./change_email";
export { getSignInCodeHtml } from "./sign_in_code";

const transporter = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
    })
  : null;

let emailHealth: { until: number; value: boolean } | undefined;
let healthCheck: Promise<boolean> | undefined;

/** A configured SMTP host is not a capability until it accepts a connection. */
export async function canSendEmail() {
  if (!transporter) return false;
  if (emailHealth && emailHealth.until > Date.now()) return emailHealth.value;
  if (healthCheck) return healthCheck;

  healthCheck = transporter
    .verify()
    .then(() => true)
    .catch((error) => {
      logger.warn("email.smtp_unavailable", { error });
      return false;
    })
    .then((value) => {
      emailHealth = { until: Date.now() + 30_000, value };
      return value;
    })
    .finally(() => {
      healthCheck = undefined;
    });
  return healthCheck;
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!transporter) throw new Error("SMTP is not configured");
  try {
    const info = await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
    });
    emailHealth = { until: Date.now() + 30_000, value: true };
    logger.info("email.sent", { messageId: info.messageId });
  } catch (error) {
    emailHealth = { until: Date.now() + 30_000, value: false };
    logger.error("email.send_failed", { error });
    throw error;
  }
}
