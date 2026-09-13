/* Configuration, read once from the environment.
   Missing or nonsensical settings fail here with an explanation
   rather than three layers deeper with a stack trace. */

import crypto from "node:crypto";

const env = process.env;
const problems = [];

function need(key, hint) {
  const value = (env[key] || "").trim();
  if (!value) problems.push(`${key} is not set — ${hint}`);
  return value;
}

function optional(key, fallback = "") {
  const value = (env[key] || "").trim();
  return value || fallback;
}

const nodeEnv = optional("NODE_ENV", "development");
const production = nodeEnv === "production";
const port = Number(optional("PORT", "3000"));

let appUrl = optional("APP_URL", production ? "" : `http://localhost:${port}`);
if (!appUrl) {
  problems.push("APP_URL is not set — the public base URL of this app, e.g. https://fridge.example.com. "
    + "It has to match the redirect URL you registered with Supabase.");
} else {
  appUrl = appUrl.replace(/\/+$/, "");
  if (production && !appUrl.startsWith("https://")) {
    problems.push(`APP_URL is ${appUrl} — in production it must be https, or the session cookies will not be sent.`);
  }
}

const supabaseUrl = need("SUPABASE_URL", "your project URL from Supabase → Settings → API");
const supabaseAnonKey = need("SUPABASE_ANON_KEY", "the anon/publishable key from Supabase → Settings → API");
const serviceRoleKey = need("SUPABASE_SERVICE_ROLE_KEY",
  "the service_role key from Supabase → Settings → API. It is needed only to redeem an invitation, "
  + "because the invitee is not a member yet. Never expose it to the browser.");

/* Signs the CSRF token. Generated per boot if unset, which is fine for
   one process but logs people out on every restart and breaks with more
   than one instance — so production insists on a real one. */
let sessionSecret = optional("SESSION_SECRET");
if (!sessionSecret) {
  if (production) {
    problems.push("SESSION_SECRET is not set — 32+ random bytes, e.g. `openssl rand -hex 32`. "
      + "Without a stable value, CSRF tokens stop matching whenever the server restarts or scales out.");
  } else {
    sessionSecret = crypto.randomBytes(32).toString("hex");
  }
} else if (sessionSecret.length < 32) {
  problems.push("SESSION_SECRET is shorter than 32 characters — use `openssl rand -hex 32`.");
}

const mailTransport = optional("MAIL_TRANSPORT", production ? "" : "console").toLowerCase();
const mailFrom = optional("MAIL_FROM", "The Family Fridge <fridge@localhost>");

if (!mailTransport) {
  problems.push("MAIL_TRANSPORT is not set — one of `resend`, `smtp` or `console`. "
    + "`console` prints invitation links to the log instead of emailing them, which is fine for "
    + "development and useless in production.");
} else if (!["resend", "smtp", "console"].includes(mailTransport)) {
  problems.push(`MAIL_TRANSPORT is "${mailTransport}" — expected one of resend, smtp, console.`);
}

if (mailTransport === "resend" && !optional("RESEND_API_KEY")) {
  problems.push("MAIL_TRANSPORT is resend but RESEND_API_KEY is not set.");
}
if (mailTransport === "smtp" && !optional("SMTP_URL") && !optional("SMTP_HOST")) {
  problems.push("MAIL_TRANSPORT is smtp but neither SMTP_URL nor SMTP_HOST is set.");
}

if (problems.length) {
  console.error("\nThe Family Fridge cannot start. " + problems.length
    + (problems.length === 1 ? " setting needs attention:\n" : " settings need attention:\n"));
  for (const p of problems) console.error("  • " + p);
  console.error("\nSee README.md → Setting it up. A .env.example is in the repository root.\n");
  process.exit(1);
}

export const config = {
  nodeEnv,
  production,
  port,
  appUrl,
  supabaseUrl,
  supabaseAnonKey,
  serviceRoleKey,
  sessionSecret,
  mail: {
    transport: mailTransport,
    from: mailFrom,
    resendKey: optional("RESEND_API_KEY"),
    smtpUrl: optional("SMTP_URL"),
    smtpHost: optional("SMTP_HOST"),
    smtpPort: Number(optional("SMTP_PORT", "587")),
    smtpUser: optional("SMTP_USER"),
    smtpPass: optional("SMTP_PASS"),
  },
  /* Secure cookies need https; in local development they would simply
     never be sent, so they are relaxed there and nowhere else. */
  secureCookies: appUrl.startsWith("https://"),
  inviteTtlDays: Number(optional("INVITE_TTL_DAYS", "14")),
};

/* The magnet colours a household hands out, in order. */
export const MAGNET_COLORS = [
  "#c0392f", "#2f6fa8", "#3f8f5a", "#dd9022",
  "#7a52a8", "#1f8f92", "#d4568c", "#5c6675",
];
