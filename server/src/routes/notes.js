/* What is on the door. Every query is scoped to one household by
   requireHousehold and again by the row level security policies, so a
   note can only ever be read or written by the family it belongs to. */

import { Router } from "express";
import { requireHousehold, requireUser } from "../session.js";
import { NewNote, PatchNote, NewReply, NoteId, parseOr400 } from "../validate.js";

export const noteRouter = Router();

noteRouter.use(requireUser, requireHousehold);

const ms = (iso) => (iso ? Date.parse(iso) : 0);

/* The API speaks the shape the fridge already draws, so the browser
   does no translating. */
function toNote(row, people, replies) {
  const who = people.get(row.author_id) || null;
  return {
    id: row.id,
    kind: row.kind,
    body: row.body || "",
    title: row.title || undefined,
    pen: row.pen || undefined,
    paper: row.paper || undefined,
    sticker: row.sticker || undefined,
    tilt: Number(row.tilt) || 0,
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    raised: Number(row.raised) || 0,
    done: Boolean(row.done),
    date: row.date || "",
    time: row.time || "",
    items: Array.isArray(row.items) ? row.items : [],
    by: row.author_id || null,
    byName: who ? who.name : "",
    byColor: who ? who.color : "#5c6675",
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    replies: replies.get(row.id) || [],
  };
}

/* Author names and colours come from the membership, not from the note,
   so renaming yourself or changing your magnet colour updates every
   note you ever wrote. */
async function peopleOf(supabase, householdId) {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, color, profiles(display_name)")
    .eq("household_id", householdId);
  if (error) throw error;
  const people = new Map();
  for (const row of data || []) {
    people.set(row.user_id, {
      name: (row.profiles && row.profiles.display_name) || "Someone",
      color: row.color,
    });
  }
  return people;
}

noteRouter.get("/", async (req, res, next) => {
  const people = await peopleOf(req.supabase, req.household.id);

  const [{ data: noteRows, error: noteError }, { data: replyRows, error: replyError }] = await Promise.all([
    req.supabase.from("notes").select("*").eq("household_id", req.household.id),
    req.supabase
      .from("replies")
      .select("id, note_id, author_id, body, created_at")
      .eq("household_id", req.household.id)
      .order("created_at", { ascending: true }),
  ]);
  if (noteError) return next(noteError);
  if (replyError) return next(replyError);

  const replies = new Map();
  for (const row of replyRows || []) {
    const who = people.get(row.author_id) || null;
    if (!replies.has(row.note_id)) replies.set(row.note_id, []);
    replies.get(row.note_id).push({
      id: row.id,
      by: row.author_id,
      byName: who ? who.name : "Someone",
      byColor: who ? who.color : "#5c6675",
      text: row.body,
      at: ms(row.created_at),
    });
  }

  const notes = {};
  for (const row of noteRows || []) notes[row.id] = toNote(row, people, replies);

  return res.json({
    household: { id: req.household.id, name: req.household.name, role: req.household.role },
    me: { id: req.user.id, color: req.household.color },
    members: [...people.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color })),
    notes,
  });
});

/* Columns a client is allowed to set. `author_id` and `household_id`
   are decided here, never sent. */
function columnsFrom(body) {
  const row = {};
  for (const key of ["kind", "body", "title", "pen", "paper", "sticker", "tilt", "x", "y", "raised", "done", "date", "time", "items"]) {
    if (body[key] !== undefined) row[key] = body[key];
  }
  if (row.date === "") row.date = null;
  if (row.time === "") row.time = null;
  return row;
}

noteRouter.put("/:noteId", async (req, res, next) => {
  const id = NoteId.safeParse(req.params.noteId);
  if (!id.success) return res.status(400).json({ error: "bad_id", message: "Bad note id." });

  const body = parseOr400(NewNote, req.body, res);
  if (!body) return undefined;

  const { data: existing, error: lookupError } = await req.supabase
    .from("notes")
    .select("id")
    .eq("household_id", req.household.id)
    .eq("id", id.data)
    .maybeSingle();
  if (lookupError) return next(lookupError);

  if (existing) {
    const { error } = await req.supabase
      .from("notes")
      .update(columnsFrom(body))
      .eq("household_id", req.household.id)
      .eq("id", id.data);
    if (error) return next(error);
    return res.json({ ok: true, created: false });
  }

  const { error } = await req.supabase.from("notes").insert({
    ...columnsFrom(body),
    id: id.data,
    household_id: req.household.id,
    author_id: req.user.id,
  });
  if (error) return next(error);
  return res.status(201).json({ ok: true, created: true });
});

noteRouter.patch("/:noteId", async (req, res, next) => {
  const id = NoteId.safeParse(req.params.noteId);
  if (!id.success) return res.status(400).json({ error: "bad_id", message: "Bad note id." });

  const body = parseOr400(PatchNote, req.body, res);
  if (!body) return undefined;

  const columns = columnsFrom(body);
  if (!Object.keys(columns).length) return res.json({ ok: true, changed: false });

  const { data, error } = await req.supabase
    .from("notes")
    .update(columns)
    .eq("household_id", req.household.id)
    .eq("id", id.data)
    .select("id");
  if (error) return next(error);
  if (!data || !data.length) {
    return res.status(404).json({ error: "gone", message: "That note is no longer on the fridge." });
  }
  return res.json({ ok: true, changed: true });
});

noteRouter.delete("/:noteId", async (req, res, next) => {
  const id = NoteId.safeParse(req.params.noteId);
  if (!id.success) return res.status(400).json({ error: "bad_id", message: "Bad note id." });

  const { error } = await req.supabase
    .from("notes")
    .delete()
    .eq("household_id", req.household.id)
    .eq("id", id.data);
  if (error) return next(error);
  return res.json({ ok: true });
});

noteRouter.post("/:noteId/replies", async (req, res, next) => {
  const id = NoteId.safeParse(req.params.noteId);
  if (!id.success) return res.status(400).json({ error: "bad_id", message: "Bad note id." });

  const body = parseOr400(NewReply, req.body, res);
  if (!body) return undefined;

  const { data, error } = await req.supabase
    .from("replies")
    .insert({
      household_id: req.household.id,
      note_id: id.data,
      author_id: req.user.id,
      body: body.body,
    })
    .select("id, created_at")
    .single();

  if (error) {
    /* The composite foreign key refused it: there is no such note in
       this household. */
    if (error.code === "23503") {
      return res.status(404).json({ error: "gone", message: "That note is no longer on the fridge." });
    }
    return next(error);
  }
  return res.status(201).json({ ok: true, id: data.id, at: ms(data.created_at) });
});

export const replyRouter = Router();

replyRouter.use(requireUser, requireHousehold);

replyRouter.delete("/:replyId", async (req, res, next) => {
  /* The policy allows this only for your own reply, or an owner's
     tidying up, so a refusal reads as "not there". */
  const { data, error } = await req.supabase
    .from("replies")
    .delete()
    .eq("household_id", req.household.id)
    .eq("id", req.params.replyId)
    .select("id");
  if (error) return next(error);
  if (!data || !data.length) {
    return res.status(404).json({ error: "not_yours", message: "That reply is not yours to delete." });
  }
  return res.json({ ok: true });
});
