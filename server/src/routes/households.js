/* Family groups: making one, naming it, seeing who is in it, and
   leaving. A group is private by construction — there is no way to
   discover or join one except by being handed an invitation. */

import { Router } from "express";
import { MAGNET_COLORS } from "../config.js";
import { requireHousehold, requireUser, setCurrentHousehold } from "../session.js";
import { NewHousehold, RenameHousehold, MemberColor, parseOr400 } from "../validate.js";

export const householdRouter = Router();

householdRouter.use(requireUser);

/* The first colour this household has not handed out yet. */
export async function freeColor(supabase, householdId) {
  const { data } = await supabase.from("memberships").select("color").eq("household_id", householdId);
  const taken = new Set((data || []).map((r) => (r.color || "").toLowerCase()));
  return MAGNET_COLORS.find((c) => !taken.has(c.toLowerCase()))
    || MAGNET_COLORS[(data || []).length % MAGNET_COLORS.length];
}

householdRouter.post("/", async (req, res, next) => {
  const body = parseOr400(NewHousehold, req.body, res);
  if (!body) return undefined;

  /* Two steps on purpose: the memberships policy only lets you claim a
     founding membership in a household that already records you as its
     creator, so the household has to exist first. */
  const { data: home, error: createError } = await req.supabase
    .from("households")
    .insert({ name: body.name, created_by: req.user.id })
    .select("id, name")
    .single();
  if (createError) return next(createError);

  const { error: joinError } = await req.supabase.from("memberships").insert({
    household_id: home.id,
    user_id: req.user.id,
    role: "owner",
    color: MAGNET_COLORS[0],
  });
  if (joinError) {
    /* Without a membership the household is invisible even to its
       creator, so do not leave one stranded. */
    await req.supabase.from("households").delete().eq("id", home.id);
    return next(joinError);
  }

  setCurrentHousehold(res, home.id);
  return res.status(201).json({ ok: true, household: { id: home.id, name: home.name, role: "owner", color: MAGNET_COLORS[0] } });
});

householdRouter.post("/:householdId/select", requireHousehold, (req, res) => {
  setCurrentHousehold(res, req.household.id);
  res.json({ ok: true, household: req.household });
});

householdRouter.patch("/:householdId", requireHousehold, async (req, res, next) => {
  const body = parseOr400(RenameHousehold, req.body, res);
  if (!body) return undefined;
  if (req.household.role !== "owner") {
    return res.status(403).json({ error: "not_owner", message: "Only the person who started this group can rename it." });
  }
  const { error } = await req.supabase.from("households").update({ name: body.name }).eq("id", req.household.id);
  if (error) return next(error);
  return res.json({ ok: true, name: body.name });
});

householdRouter.get("/:householdId/members", requireHousehold, async (req, res, next) => {
  const { data, error } = await req.supabase
    .from("memberships")
    .select("user_id, role, color, joined_at, profiles(id, display_name, email)")
    .eq("household_id", req.household.id)
    .order("joined_at", { ascending: true });
  if (error) return next(error);

  return res.json({
    members: (data || []).map((row) => ({
      id: row.user_id,
      name: (row.profiles && row.profiles.display_name) || "Someone",
      /* Addresses are shown only to the household, and only so an
         owner can tell two people apart before removing one. */
      email: (row.profiles && row.profiles.email) || null,
      role: row.role,
      color: row.color,
      joinedAt: row.joined_at,
      isMe: row.user_id === req.user.id,
    })),
  });
});

householdRouter.patch("/:householdId/members/me", requireHousehold, async (req, res, next) => {
  const body = parseOr400(MemberColor, req.body, res);
  if (!body) return undefined;
  const { error } = await req.supabase
    .from("memberships")
    .update({ color: body.color })
    .eq("household_id", req.household.id)
    .eq("user_id", req.user.id);
  if (error) return next(error);
  return res.json({ ok: true, color: body.color });
});

householdRouter.delete("/:householdId/members/:userId", requireHousehold, async (req, res, next) => {
  const target = req.params.userId;
  const isSelf = target === req.user.id;
  if (!isSelf && req.household.role !== "owner") {
    return res.status(403).json({ error: "not_owner", message: "Only the person who started this group can remove somebody." });
  }

  if (isSelf && req.household.role === "owner") {
    const { count, error: countError } = await req.supabase
      .from("memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("household_id", req.household.id)
      .eq("role", "owner");
    if (countError) return next(countError);
    if ((count || 0) <= 1) {
      return res.status(409).json({
        error: "last_owner",
        message: "You are the only owner. Make somebody else an owner first, or delete the group.",
      });
    }
  }

  const { error } = await req.supabase
    .from("memberships")
    .delete()
    .eq("household_id", req.household.id)
    .eq("user_id", target);
  if (error) return next(error);
  if (isSelf) setCurrentHousehold(res, null);
  return res.json({ ok: true });
});

householdRouter.delete("/:householdId", requireHousehold, async (req, res, next) => {
  if (req.household.role !== "owner") {
    return res.status(403).json({ error: "not_owner", message: "Only the person who started this group can delete it." });
  }
  const { error } = await req.supabase.from("households").delete().eq("id", req.household.id);
  if (error) return next(error);
  setCurrentHousehold(res, null);
  return res.json({ ok: true });
});
