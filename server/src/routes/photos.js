/* Photos on the fridge door.

   The bytes live in a private Supabase Storage bucket; the notes table
   holds only a pointer, "<household id>/<file>". Both directions run
   through the service-role client, with household membership checked
   first by requireHousehold using the caller's own credentials — the
   same check the note policies make, applied here because storage
   objects are not rows and so no policy covers them.

   Signed URLs are deliberately not used: they expire, and a photo on a
   fridge is meant to stay there. */

import crypto from "node:crypto";
import { Router } from "express";
import express from "express";
import { adminClient } from "../supabase.js";
import { requireHousehold, requireUser } from "../session.js";
import { NoteId } from "../validate.js";

const BUCKET = "fridge-photos";
const MAX_BYTES = 8 * 1024 * 1024;

const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const EXTENSIONS = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export const photoRouter = Router();

/* Uploading replaces whatever the note had. */
photoRouter.put(
  "/notes/:noteId/photo",
  requireUser,
  requireHousehold,
  express.raw({ type: Object.keys(TYPES), limit: MAX_BYTES }),
  async (req, res, next) => {
    const id = NoteId.safeParse(req.params.noteId);
    if (!id.success) return res.status(400).json({ error: "bad_id", message: "Bad note id." });

    const extension = TYPES[(req.get("content-type") || "").split(";")[0].trim()];
    if (!extension) {
      return res.status(415).json({
        error: "bad_type",
        message: "Photos have to be a JPEG, a PNG or a WebP.",
      });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: "empty", message: "That photo arrived empty. Try again." });
    }

    /* The note has to exist in this household before it gets a photo. */
    const { data: note, error: lookupError } = await req.supabase
      .from("notes")
      .select("id, image")
      .eq("household_id", req.household.id)
      .eq("id", id.data)
      .maybeSingle();
    if (lookupError) return next(lookupError);
    if (!note) return res.status(404).json({ error: "gone", message: "That note is no longer on the fridge." });

    const admin = adminClient();
    /* A fresh name each time, so a replaced photo is never served from
       a cache under the old one. */
    const objectPath = `${req.household.id}/${crypto.randomBytes(12).toString("hex")}.${extension}`;

    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, req.body, {
      contentType: EXTENSIONS[extension],
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) {
      console.error("photo upload:", uploadError.message);
      return res.status(502).json({
        error: "upload_failed",
        message: "The photo could not be stored. Try again in a moment.",
      });
    }

    const { error: saveError } = await req.supabase
      .from("notes")
      .update({ image: objectPath })
      .eq("household_id", req.household.id)
      .eq("id", id.data);
    if (saveError) {
      /* Do not leave an orphan behind if the pointer never landed. */
      await admin.storage.from(BUCKET).remove([objectPath]).catch(() => {});
      return next(saveError);
    }

    /* The one it replaced is nobody's now. */
    if (note.image && note.image !== objectPath) {
      await admin.storage.from(BUCKET).remove([note.image]).catch(() => {});
    }

    return res.status(201).json({ ok: true, image: "photo:" + objectPath });
  },
);

/* Serving one back. The path carries the household, so membership is
   checked against that rather than against whatever door the browser
   happens to have selected. */
photoRouter.get("/photos/:householdId/:file", requireUser, requireHousehold, async (req, res, next) => {
  const file = String(req.params.file);
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(file) || file.includes("..")) {
    return res.status(400).type("text/plain").send("Bad photo name.");
  }

  const objectPath = `${req.household.id}/${file}`;
  const admin = adminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(objectPath);
  if (error || !data) {
    return res.status(404).type("text/plain").send("No such photo.");
  }

  const extension = file.split(".").pop().toLowerCase();
  res.setHeader("Content-Type", EXTENSIONS[extension] || "application/octet-stream");
  /* Private, but immutable: the name changes whenever the photo does. */
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(Buffer.from(await data.arrayBuffer()));
});

/* Called when a note goes, so the bucket does not fill with photos
   nothing points at. Best effort: a note must still be removable when
   storage is having a bad day. */
export async function forgetPhoto(imagePath) {
  if (!imagePath) return;
  try {
    await adminClient().storage.from(BUCKET).remove([imagePath]);
  } catch (error) {
    console.warn("orphaned photo", imagePath, error.message);
  }
}
