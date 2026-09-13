/* The Family Fridge — server.

   Serves the app, keeps the Supabase session in httpOnly cookies, and
   exposes one small API for family groups, invitations and the door
   itself. Deliberately thin: identity is Supabase's job, and row level
   security in supabase/schema.sql is what actually keeps one family's
   door away from another's. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { config } from "./config.js";
import { attachUser, csrf, currentHouseholdId } from "./session.js";
import { authRouter, meRouter } from "./routes/auth.js";
import { householdRouter } from "./routes/households.js";
import { inviteRouter } from "./routes/invites.js";
import { noteRouter, replyRouter } from "./routes/notes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../web");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);          // behind Fly/Render/Vercel/nginx

app.use((req, res, next) => {
  /* The app loads its fonts from Google and nothing else from anywhere.
     No inline script is allowed, which is why every page here links a
     separate .js file. */
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  if (config.secureCookies) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(express.json({ limit: "128kb" }));
app.use(attachUser);
app.use(csrf);

/* ---------- API ---------- */

app.use("/api/me", meRouter);
app.use("/api/auth", authRouter);
app.use("/api/households", householdRouter);
app.use("/api", inviteRouter);                  // /api/households/:id/invitations, /api/invitations/*
app.use("/api/notes", noteRouter);
app.use("/api/replies", replyRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

/* OAuth and email links land on /auth/*, outside /api, because the
   provider redirects a browser here rather than fetching it. */
app.use("/auth", authRouter);

/* ---------- Pages ---------- */

app.get("/", (req, res) => {
  if (!req.user) return res.redirect("/signin");
  /* Somewhere to land when you have an account but no family yet. */
  return res.sendFile(path.join(webRoot, currentHouseholdId(req) ? "fridge.html" : "start.html"));
});

app.get("/signin", (req, res) => {
  if (req.user && !req.query.mode) return res.redirect("/");
  return res.sendFile(path.join(webRoot, "signin.html"));
});

/* A page, not an endpoint: someone signed out gets sent to sign in,
   not handed a 401 in JSON. */
app.get("/start", (req, res) => {
  if (!req.user) return res.redirect("/signin");
  return res.sendFile(path.join(webRoot, "start.html"));
});

/* The token stays in the path so it never reaches the server log as a
   query string, and the page reads it from location. Anything that is
   not shaped like a token falls through to the 404 handler rather than
   quietly rendering the invitation page. */
app.get("/invite/:token", (req, res, next) => {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(req.params.token)) return next();
  return res.sendFile(path.join(webRoot, "invite.html"));
});

app.use(express.static(webRoot, {
  index: false,
  maxAge: config.production ? "1h" : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
  },
}));

/* ---------- Endings ---------- */

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "not_found", message: "No such endpoint." });
  }
  /* Anything with a file extension is an asset request. Answering those
     with HTML makes a missing stylesheet look like a MIME-type problem
     instead of a missing file. */
  if (/\.[a-z0-9]{2,6}$/i.test(req.path)) {
    return res.status(404).type("text/plain").send("Not found.");
  }
  return res.status(404).sendFile(path.join(webRoot, "signin.html"));
});

app.use((error, req, res, next) => {
  /* Postgres and PostgREST errors carry codes worth keeping in the log
     and worth not showing to a family member. */
  console.error("unhandled:", error && (error.code || ""), error && error.message);
  if (res.headersSent) return next(error);
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({
      error: "server_error",
      message: "Something went wrong at our end. Try again in a moment.",
    });
  }
  return res.status(500).type("text/plain").send("Something went wrong at our end.");
});

app.listen(config.port, () => {
  console.log(`The Family Fridge is listening on ${config.appUrl} (${config.nodeEnv})`);
  if (config.mail.transport === "console") {
    console.log("MAIL_TRANSPORT=console — invitation emails will be printed here, not sent.");
  }
});
