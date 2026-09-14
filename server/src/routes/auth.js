/* Signing up and signing in, three ways.

   Supabase Auth owns the credentials in every case: it runs the OAuth
   handshake with Google and Apple on its own domain, stores the
   password verifier, and sends the verification and reset emails. This
   file's whole job is to start those flows, land the result in httpOnly
   cookies, and hand back sentences a person can act on. */

import { Router } from "express";
import { config } from "../config.js";
import { currentHouseholdId, requireUser } from "../session.js";
import { clearCookie, readCookies, writeCookie } from "../supabase.js";
import { SignUp, SignIn, ForgotPassword, NewPassword, UpdateMe, parseOr400 } from "../validate.js";

export const authRouter = Router();

const PROVIDERS = { google: "google", apple: "apple" };
const PENDING_INVITE = "fridge_invite";

/* Only ever redirect inside this app. */
function safeNext(value) {
  const next = String(value || "/");
  return /^\/(?!\/)[A-Za-z0-9/_\-.?=&%]*$/.test(next) ? next : "/";
}

/* Supabase's messages are written for developers. These are the ones a
   family member might actually trip over, in words that say what to do. */
function readable(error) {
  const raw = (error && error.message) || "";
  const code = (error && error.code) || "";
  if (/Invalid login credentials/i.test(raw)) {
    return "That email and password do not match. Try again, or reset your password.";
  }
  if (/Email not confirmed/i.test(raw)) {
    return "Confirm your email address first — check your inbox for the link we sent.";
  }
  if (code === "user_already_exists" || /already registered/i.test(raw)) {
    return "There is already an account with that address. Sign in instead, or reset the password.";
  }
  if (/Password should be/i.test(raw)) return raw;
  if (/fetch failed|Failed to fetch|ENOTFOUND|ECONNREFUSED|network/i.test(raw) || code === "unexpected_failure") {
    return "We cannot reach the sign-in service right now. Try again in a moment.";
  }
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(raw)) {
    return "Too many attempts just now. Wait a minute and try again.";
  }
  if (/provider is not enabled/i.test(raw)) {
    return "That sign-in method is not switched on for this fridge yet.";
  }
  return raw || "Something went wrong. Try again.";
}

/* ---------- Google and Apple ---------- */

authRouter.get("/start/:provider", async (req, res, next) => {
  const provider = PROVIDERS[req.params.provider];
  if (!provider) return res.status(404).send("Unknown sign-in provider.");

  /* An invitation token survives the round trip to the provider in its
     own cookie, so accepting an invite and signing up with Google is
     one gesture rather than two. */
  if (req.query.invite) {
    writeCookie(res, PENDING_INVITE, String(req.query.invite).slice(0, 200), { maxAge: 60 * 60 * 24 });
  }

  const { data, error } = await req.supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${config.appUrl}/auth/callback?next=${encodeURIComponent(safeNext(req.query.next))}`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data || !data.url) {
    const why = encodeURIComponent(readable(error));
    return res.redirect(`/signin?error=${why}`);
  }
  /* signInWithOAuth has just stored the PKCE verifier through the
     cookie adapter; the redirect carries only the public challenge. */
  return res.redirect(data.url);
});

/* Where Google, Apple, email confirmation and password resets all land. */
authRouter.get("/callback", async (req, res, next) => {
  const { code, error_description: providerError } = req.query;
  if (providerError) {
    return res.redirect(`/signin?error=${encodeURIComponent(String(providerError).slice(0, 200))}`);
  }
  if (!code) return res.redirect("/signin?error=" + encodeURIComponent("That sign-in link is incomplete."));

  const { error } = await req.supabase.auth.exchangeCodeForSession(String(code));
  if (error) {
    return res.redirect(`/signin?error=${encodeURIComponent(readable(error))}`);
  }

  const pending = readCookies(req)[PENDING_INVITE];
  if (pending) {
    clearCookie(res, PENDING_INVITE);
    return res.redirect(`/invite/${encodeURIComponent(pending)}`);
  }
  return res.redirect(safeNext(req.query.next));
});

/* ---------- Email and password ---------- */

authRouter.post("/signup", async (req, res, next) => {
  const body = parseOr400(SignUp, req.body, res);
  if (!body) return undefined;

  if (body.token) writeCookie(res, PENDING_INVITE, body.token, { maxAge: 60 * 60 * 24 });

  const { data, error } = await req.supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      data: { display_name: body.displayName },
      emailRedirectTo: `${config.appUrl}/auth/callback`,
    },
  });

  if (error) return res.status(400).json({ error: "signup_failed", message: readable(error) });

  /* With email confirmation switched on there is a user but no session
     yet, which is not a failure — it means go and check your inbox. */
  const signedIn = Boolean(data && data.session);
  return res.json({
    ok: true,
    signedIn,
    message: signedIn
      ? "Welcome to the fridge."
      : `Check ${body.email} for a link to confirm your address, then come back and sign in.`,
  });
});

authRouter.post("/signin", async (req, res, next) => {
  const body = parseOr400(SignIn, req.body, res);
  if (!body) return undefined;

  const { error } = await req.supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  if (error) return res.status(401).json({ error: "signin_failed", message: readable(error) });
  return res.json({ ok: true, signedIn: true });
});

authRouter.post("/forgot", async (req, res, next) => {
  const body = parseOr400(ForgotPassword, req.body, res);
  if (!body) return undefined;

  const { error } = await req.supabase.auth.resetPasswordForEmail(body.email, {
    redirectTo: `${config.appUrl}/auth/callback?next=/signin%3Fmode%3Dnew-password`,
  });
  /* Whether or not that address has an account is not this endpoint's
     news to share, so the answer is the same either way. */
  if (error && !/rate limit/i.test(error.message || "")) console.warn("reset mail:", error.message);
  return res.json({
    ok: true,
    message: `If there is an account for ${body.email}, a reset link is on its way.`,
  });
});

authRouter.post("/password", requireUser, async (req, res, next) => {
  const body = parseOr400(NewPassword, req.body, res);
  if (!body) return undefined;

  const { error } = await req.supabase.auth.updateUser({ password: body.password });
  if (error) return res.status(400).json({ error: "password_failed", message: readable(error) });
  return res.json({ ok: true, message: "Password changed." });
});

authRouter.post("/signout", async (req, res, next) => {
  await req.supabase.auth.signOut();
  clearCookie(res, "fridge_home");
  return res.json({ ok: true });
});

/* ---------- Who am I ---------- */

export const meRouter = Router();

meRouter.get("/", async (req, res, next) => {
  if (!req.user) return res.json({ signedIn: false, csrf: req.csrfToken });

  const [{ data: profile, error: profileError }, { data: rows, error: listError }] = await Promise.all([
    req.supabase.from("profiles").select("id, display_name, email").eq("id", req.user.id).maybeSingle(),
    req.supabase
      .from("memberships")
      .select("role, color, joined_at, households(id, name, finish, created_at)")
      .order("joined_at", { ascending: true }),
  ]);
  if (profileError) return next(profileError);
  if (listError) return next(listError);

  const households = (rows || [])
    .filter((r) => r.households)
    .map((r) => ({
      id: r.households.id, name: r.households.name,
      finish: r.households.finish || "steel", role: r.role, color: r.color,
    }));

  const cookieHome = currentHouseholdId(req);
  const current = households.find((hh) => hh.id === cookieHome) || households[0] || null;

  return res.json({
    signedIn: true,
    csrf: req.csrfToken,
    user: {
      id: req.user.id,
      email: req.user.email || null,
      displayName: (profile && profile.display_name) || "Someone",
      /* How they got in, so the account screen can say so. */
      via: (req.user.app_metadata && req.user.app_metadata.provider) || "email",
    },
    households,
    current,
  });
});

meRouter.patch("/", requireUser, async (req, res, next) => {
  const body = parseOr400(UpdateMe, req.body, res);
  if (!body) return undefined;

  const { error } = await req.supabase
    .from("profiles")
    .update({ display_name: body.displayName })
    .eq("id", req.user.id);
  if (error) return next(error);
  return res.json({ ok: true, displayName: body.displayName });
});
