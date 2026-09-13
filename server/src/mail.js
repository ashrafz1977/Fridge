/* Sending the one email this app sends: an invitation to a family
   group. Supabase handles its own account emails (verification,
   password reset); it does not send arbitrary mail, and its built-in
   sender is rate-limited and not meant for production, so invitations
   go out from here where the wording is ours. */

import nodemailer from "nodemailer";
import { config } from "./config.js";

let smtp = null;

function smtpTransport() {
  if (smtp) return smtp;
  const m = config.mail;
  smtp = m.smtpUrl
    ? nodemailer.createTransport(m.smtpUrl)
    : nodemailer.createTransport({
        host: m.smtpHost,
        port: m.smtpPort,
        secure: m.smtpPort === 465,
        auth: m.smtpUser ? { user: m.smtpUser, pass: m.smtpPass } : undefined,
      });
  return smtp;
}

async function sendViaResend({ to, subject, text, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.mail.resendKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: config.mail.from, to: [to], subject, text, html }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend refused the message (${response.status}): ${detail.slice(0, 300)}`);
  }
}

export async function send(message) {
  if (config.mail.transport === "console") {
    console.log(
      `\n──────── invitation email (MAIL_TRANSPORT=console, nothing was sent) ────────\n`
      + `to:      ${message.to}\n`
      + `subject: ${message.subject}\n\n`
      + `${message.text}\n`
      + `────────────────────────────────────────────────────────────────────────────\n`,
    );
    return;
  }
  if (config.mail.transport === "resend") return sendViaResend(message);
  await smtpTransport().sendMail({ from: config.mail.from, ...message });
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function inviteMessage({ to, householdName, inviterName, link, expiresAt }) {
  const home = escape(householdName);
  const from = escape(inviterName || "Someone");
  const until = new Date(expiresAt).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const text = [
    `${inviterName || "Someone"} has added you to the ${householdName} fridge.`,
    ``,
    `It is a shared fridge door: notes, reminders, appointments, announcements,`,
    `shopping lists and photos, all in one place, for your family only.`,
    ``,
    `Open it here:`,
    link,
    ``,
    `You can sign in with Google, with Apple, or with an email address and`,
    `password. The link works once and expires on ${until}.`,
    ``,
    `If you were not expecting this, you can ignore it — nothing happens until`,
    `you open the link.`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#d9dde3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#37332c">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;width:100%">
    <tr><td style="background:#fdf0a4;padding:28px 26px;border-radius:3px;box-shadow:0 3px 10px rgba(30,36,45,.2)">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6d665b">The Family Fridge</p>
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${from} has added you to the ${home} fridge</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55">
        It is a shared fridge door: notes, reminders, appointments, announcements,
        shopping lists and photos, all in one place, for your family only.
      </p>
      <p style="margin:0 0 20px">
        <a href="${escape(link)}" style="display:inline-block;background:#37332c;color:#fff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:14px 22px;border-radius:8px">Open the fridge</a>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6d665b">
        Sign in with Google, with Apple, or with an email address and password.
        The link works once and expires on ${escape(until)}.
      </p>
    </td></tr>
    <tr><td style="padding:16px 26px;font-size:12px;line-height:1.5;color:#5d6875">
      If you were not expecting this you can ignore it — nothing happens until you open the link.
    </td></tr>
  </table>
</body></html>`;

  return { to, subject: `${inviterName || "Someone"} added you to the ${householdName} fridge`, text, html };
}
