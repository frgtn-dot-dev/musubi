import { config, logger } from "@musubi/config";
import nodemailer from "nodemailer";

export { getPasswordResetHtml } from "./password_reset";
export { getDeleteAccountHtml } from "./delete_account";
export { getVerifyEmailHtml } from "./verify_email";
export { getChangeEmailHtml } from "./change_email";
export { getSignInCodeHtml } from "./sign_in_code";

export function smtpTransportOptions(smtp: typeof config.smtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 5_000,
  };
}

const transporter = config.smtp.host
  ? nodemailer.createTransport(smtpTransportOptions(config.smtp))
  : null;

let emailAvailable = false;

/** Check SMTP once before the API starts serving requests. */
export async function initializeEmailCapability() {
  if (!transporter) return false;
  try {
    await transporter.verify();
    emailAvailable = true;
    logger.info("email.smtp_available");
  } catch (error) {
    logger.warn("email.smtp_unavailable", { error });
  }
  return emailAvailable;
}

/** Instant startup snapshot for public capability responses. */
export function canSendEmail() {
  return emailAvailable;
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
    logger.info("email.sent", { messageId: info.messageId });
  } catch (error) {
    logger.error("email.send_failed", { error });
    throw error;
  }
}
