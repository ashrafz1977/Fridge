/* Invitations.

   An invitation is a random 32-byte token emailed as a link. Only its
   SHA-256 hash is stored, so a copy of the database is not a set of
   working invitations. Redeeming one runs through the service-role
   client because the invitee matches no row level security policy yet
   — they are not a member of anything. Every check that would
   otherwise be a policy is therefore explicit and in one place below. */

import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { adminClient } from "../supabase.js";
import { requireHousehold, requireUser, setCurrentHousehold } from "../session.js";
import { NewInvitation, AcceptInvitation, parseOr400 } from "../validate.js";
import { inviteMessage, send } from "../mail.js";
import { freeColor } from "./households.js";

export const inviteRouter = Router();

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const mintToken = () => crypto.randomBytes(32).toString("base64url");

/* n****@example.com — enough for the invitee to recognise which of
   their addresses was used, without publishing it to whoever holds
   the link. */
function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "an email address";
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

/* ---------- Inside a household ---------- */

inviteRouter.get("/households/:householdId/invitations", requireUser, requireHousehold, async (req, res, next) => {
  const { data, error } = await req.supabase
    .from("invitations")
    .select("id, email, role, email_locked, created_at, expires_at, accepted_at, revoked_at, profiles:invited_by(display_name)")
    .eq("household_id", req.household.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return next(error);

  const now = Date.now();
  return res.json({
    invitations: (data || []).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      anyEmail: !row.email_locked,
      invitedBy: (row.profiles && row.profiles.display_name) || null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.revoked_at ? "revoked"
        : row.accepted_at ? "accepted"
        : new Date(row.expires_at).getTime() < now ? "expired"
        : "pending",
    })),
  });
});

inviteRouter.post("/households/:householdId/invitations", requireUser, requireHousehold, async (req, res, next) => {
  const body = parseOr400(NewInvitation, req.body, res);
  if (!body) return undefined;

  /* Already in the family? Say so instead of sending a link that will
     bounce off the "already a member" check later. */
  const { data: existing, error: lookupError } = await req.supabase
    .from("memberships")
    .select("user_id, profiles!inner(email)")
    .eq("household_id", req.household.id)
    .ilike("profiles.email", body.email);
  if (lookupError) return next(lookupError);
  if (existing && existing.length) {
    return res.status(409).json({ error: "already_member", message: `${body.email} is already in this group.` });
  }

  const token = mintToken();
  const expiresAt = new Date(Date.now() + config.inviteTtlDays * 86400_000).toISOString();

  const { data: invitation, error } = await req.supabase
    .from("invitations")
    .insert({
      household_id: req.household.id,
      email: body.email,
      token_hash: hash(token),
      email_locked: !body.anyEmail,
      invited_by: req.user.id,
      expires_at: expiresAt,
    })
    .select("id, email, expires_at")
    .single();

  if (error) {
    if (error.code === "23505" || error.code === "23P01" || /invitations_pending_idx/.test(error.message || "")) {
      return res.status(409).json({
        error: "already_invited",
        message: `${body.email} already has an invitation waiting. Revoke it first to send a new one.`,
      });
    }
    return next(error);
  }

  const { data: profile } = await req.supabase
    .from("profiles").select("display_name").eq("id", req.user.id).maybeSingle();

  const link = `${config.appUrl}/invite/${token}`;
  try {
    await send(inviteMessage({
      to: invitation.email,
      householdName: req.household.name,
      inviterName: profile && profile.display_name,
      link,
      expiresAt: invitation.expires_at,
    }));
  } catch (mailError) {
    /* The invitation exists and the link works; only the delivery
       failed. Hand the link back so it can be passed on by any other
       means rather than silently going nowhere. */
    console.error("invitation mail failed:", mailError.message);
    return res.status(202).json({
      ok: true,
      delivered: false,
      invitationId: invitation.id,
      link,
      message: `The invitation is ready but the email could not be sent (${mailError.message}). Send this link to ${invitation.email} yourself.`,
    });
  }

  return res.status(201).json({
    ok: true,
    delivered: config.mail.transport !== "console",
    invitationId: invitation.id,
    /* In development nothing was actually emailed, so the link has to
       be reachable from somewhere. */
    link: config.mail.transport === "console" ? link : undefined,
    message: config.mail.transport === "console"
      ? `Invitation created. MAIL_TRANSPORT is "console", so nothing was emailed — the link is in the server log and below.`
      : `Invitation sent to ${invitation.email}.`,
  });
});

inviteRouter.delete("/invitations/:id", requireUser, async (req, res, next) => {
  /* RLS restricts this to invitations belonging to a household the
     caller is in, so no membership check is needed here. */
  const { data, error } = await req.supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .is("accepted_at", null)
    .select("id");
  if (error) return next(error);
  if (!data || !data.length) {
    return res.status(404).json({ error: "not_found", message: "That invitation is already used or gone." });
  }
  return res.json({ ok: true });
});

/* ---------- Redeeming one ---------- */

async function loadInvitation(token) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("invitations")
    .select("id, household_id, email, role, email_locked, expires_at, accepted_at, revoked_at, households(name), profiles:invited_by(display_name)")
    .eq("token_hash", hash(token))
    .maybeSingle();
  if (error) throw error;
  return data;
}

function invitationProblem(invitation) {
  if (!invitation) return { code: "unknown", message: "This invitation link is not valid. Ask for a new one." };
  if (invitation.revoked_at) return { code: "revoked", message: "This invitation was withdrawn. Ask for a new one." };
  if (invitation.accepted_at) return { code: "used", message: "This invitation has already been used." };
  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    return { code: "expired", message: "This invitation has expired. Ask for a new one." };
  }
  return null;
}

/* Shown before sign-in, so the page can name the family doing the
   inviting. Deliberately says nothing about the household beyond its
   name and nothing about the address beyond its shape. */
inviteRouter.get("/invitations/preview", async (req, res, next) => {
  const token = String(req.query.token || "");
  if (token.length < 20) return res.status(400).json({ error: "bad_token", message: "That link is incomplete." });

  const invitation = await loadInvitation(token);
  const problem = invitationProblem(invitation);
  if (problem) return res.status(410).json({ error: problem.code, message: problem.message });

  return res.json({
    householdName: (invitation.households && invitation.households.name) || "a family",
    invitedBy: (invitation.profiles && invitation.profiles.display_name) || null,
    invitedEmail: maskEmail(invitation.email),
    emailLocked: invitation.email_locked,
    expiresAt: invitation.expires_at,
  });
});

inviteRouter.post("/invitations/accept", requireUser, async (req, res, next) => {
  const body = parseOr400(AcceptInvitation, req.body, res);
  if (!body) return undefined;

  const invitation = await loadInvitation(body.token);
  const problem = invitationProblem(invitation);
  if (problem) return res.status(410).json({ error: problem.code, message: problem.message });

  const signedInAs = (req.user.email || "").toLowerCase();
  if (invitation.email_locked && signedInAs !== invitation.email.toLowerCase()) {
    return res.status(403).json({
      error: "wrong_email",
      message: `This invitation was sent to ${maskEmail(invitation.email)}, but you are signed in as `
        + `${signedInAs || "another account"}. Sign in with the invited address, or ask for an invitation `
        + `that any address can use — which is what you need if you sign in with Apple and hide your email.`,
    });
  }

  const admin = adminClient();

  const { data: already, error: alreadyError } = await admin
    .from("memberships")
    .select("household_id")
    .eq("household_id", invitation.household_id)
    .eq("user_id", req.user.id)
    .maybeSingle();
  if (alreadyError) return next(alreadyError);

  if (!already) {
    const { error: joinError } = await admin.from("memberships").insert({
      household_id: invitation.household_id,
      user_id: req.user.id,
      role: invitation.role,
      color: await freeColor(admin, invitation.household_id),
    });
    if (joinError) return next(joinError);
  }

  /* Spend the token. Conditioned on it still being unspent so two
     simultaneous clicks cannot both count as the acceptance. */
  const { error: spendError } = await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_by: req.user.id })
    .eq("id", invitation.id)
    .is("accepted_at", null);
  if (spendError) return next(spendError);

  setCurrentHousehold(res, invitation.household_id);
  return res.json({
    ok: true,
    household: { id: invitation.household_id, name: (invitation.households && invitation.households.name) || "your family" },
  });
});
