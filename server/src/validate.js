/* Request body shapes. Anything that reaches the database goes through
   one of these first; the schema's own constraints are the backstop. */

import { z } from "zod";

export const Email = z.string().trim().toLowerCase().email("That does not look like an email address.").max(254);

export const Password = z.string()
  .min(10, "Use at least 10 characters — length beats cleverness.")
  .max(200, "That password is longer than 200 characters.");

export const DisplayName = z.string().trim().min(1, "Tell us what to call you.").max(40);

export const SignUp = z.object({
  email: Email,
  password: Password,
  displayName: DisplayName,
  token: z.string().trim().max(200).optional(),
});

export const SignIn = z.object({ email: Email, password: z.string().min(1).max(200) });
export const ForgotPassword = z.object({ email: Email });
export const NewPassword = z.object({ password: Password });
export const UpdateMe = z.object({ displayName: DisplayName });

export const Finish = z.enum(["steel", "enamel", "graphite", "slate", "mint", "butter", "coral", "oak"]);

export const NewHousehold = z.object({ name: z.string().trim().min(1, "Give the group a name.").max(60) });
export const RenameHousehold = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(60).optional(),
  finish: Finish.optional(),
}).refine((v) => v.name !== undefined || v.finish !== undefined, {
  message: "Nothing to change.",
});

export const NewInvitation = z.object({
  email: Email,
  /* Apple's private relay means the address someone signs in with is
     often not the address you invited. This lets the inviter say "any
     signed-in person with this link may join" on purpose. */
  anyEmail: z.boolean().optional().default(false),
});

export const AcceptInvitation = z.object({ token: z.string().trim().min(20).max(200) });
export const MemberColor = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours look like #c0392f.") });

const NoteId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Bad note id.");

const noteShape = {
  kind: z.enum(["sticky", "reminder", "event", "announce", "list", "memory", "calendar"]),
  body: z.string().max(4000).optional(),
  title: z.string().max(120).nullish(),
  pen: z.enum(["pen", "neat", "loopy", "marker", "biro", "typed", "printed"]).nullish(),
  paper: z.enum(["canary", "rose", "mint", "sky", "peach", "lilac", "white", "card"]).nullish(),
  sticker: z.string().max(16).nullish(),
  tilt: z.number().min(-15).max(15).optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  raised: z.number().int().min(0).max(1e15).optional(),
  done: z.boolean().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  items: z.array(z.object({ t: z.string().max(120), done: z.boolean() })).max(200).optional(),
  shape: z.enum(["", "wide", "tall"]).nullish(),
  tint: z.enum(["canary", "rose", "mint", "sky", "peach", "lilac", "white", "card"]).nullish(),
  /* A client may clear a photo but never name one: the photo route is
     the only thing that writes an image path. */
  image: z.null().optional(),
};

export const NewNote = z.object(noteShape);
export const PatchNote = z.object(noteShape).partial();
export const NewReply = z.object({ body: z.string().trim().min(1, "Write something first.").max(400) });

export { NoteId };

/* Turns a zod failure into one plain sentence a person can act on. */
export function parseOr400(schema, value, res) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  res.status(400).json({
    error: "bad_request",
    field: first.path.join(".") || undefined,
    message: first.message,
  });
  return null;
}
