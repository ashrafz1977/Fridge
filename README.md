# The Family Fridge

A shared refrigerator door. Everyone in the house sticks their own notes,
reminders, appointments, announcements, lists and photo-memories onto it,
drags them wherever they like, and sees everyone else's changes.

It is built to look and behave like the real thing: brushed steel, a chrome
handle, paper scraps at slight angles, and a magnet in your own colour holding
up everything you wrote. It is built for the phone first, which is where a
fridge app actually gets used — on a narrow screen the door is a column you
scroll and notes open in a bottom sheet; from 761px up it becomes a surface
you arrange by dragging.

Accounts are real: sign in with Google, with Apple, or with an email address
and a password. A fridge belongs to a **family group**, and the only way into
one is an invitation sent to your email address.

```
web/       the fridge itself, the sign-in, start and invitation pages
server/    sessions, family groups, invitations, the notes API
supabase/  the Postgres schema and its row level security policies
scripts/   generates the Apple client secret
```

## What goes on the door

Six magnets sit in the tray at the bottom. Tap one to stick something up.

| Magnet | What it is | Behaves like |
| --- | --- | --- |
| **Note** | A post-it in any of six paper colours | Free text, handwriting |
| **Reminder** | A notepad slip with a red flag | Optional due date, tick it off when done |
| **Appointment** | An index card with a clip | Date and time; shows on the calendar |
| **Announcement** | A printed notice held on with tape | Big condensed type for things nobody may miss |
| **List** | A lined pad | A running checklist — groceries, packing, chores |
| **Photo** | A polaroid | A real photo or a sticker, turned by hand |

Every note also carries:

- **A pen.** Seven faces to write with — Pen, Neat, Loopy, Marker, Biro, Typed
  and Printed — chosen per note and previewed as you pick it.
- **A last-updated tag.** "Added 20m ago", or "Updated 2h ago" once someone has
  changed it. Relative times refresh on the minute.
- **Replies.** Anyone in the group can reply on a note, signed with their own
  magnet colour. A reply is a conversation about the note, not an edit of it,
  so it leaves the note's own last-updated tag alone.
- **Add to calendar**, on anything with a date. See below.
- **An angle.** Every note sits at one. Drag the chrome handle on a
  polaroid's corner to turn it, or use the slider in any note's editor —
  with a **Straighten** button for when you have had enough of the charm.

## Photos

A **Photo** note is a polaroid: a white card with the picture inside its
border. Add one from the camera or the library, crop it square, landscape or
portrait, and turn it to whatever angle looks right.

Pictures are scaled down in the browser before they go anywhere — a phone
camera's 4000px, 6MB original is nobody's idea of a fridge magnet — and then
stored according to which build you are running:

| Build | Where the picture lives |
| --- | --- |
| This server | A private Supabase Storage bucket, served back through `/api/photos` after a membership check |
| Artifact | The Artifact `assets` capability; the note holds only the asset id |
| Offline | Scaled harder and kept in `localStorage` on that one device |

The bucket is private and has no policies granting the `authenticated` role
anything: only the server touches it, and it checks household membership on
every read and write. Signed URLs are avoided deliberately — they expire, and
a photo on a fridge is meant to stay there. Replacing a photo or taking the
note down deletes the old object, so the bucket does not fill with pictures
nothing points at.

## The door

Eight finishes, from the name plate: brushed steel, white enamel, graphite,
slate, retro mint, retro butter, retro coral, and an oak panel — each with its
own grain and its own trim, chrome or brass.

The finish belongs to the **household**, not to the person, because it is the
fridge everybody looks at. A finish supplies two colours, a grain and a trim;
the light or dark theme then lays a scrim over whichever one is chosen, so one
rule dims all eight rather than each finish needing a dark twin.

A month calendar hangs on the door as a seventh, permanent sheet, with a
coloured pip on every day that has something on it — one pip per person. On a
phone the grid folds away by default, leaving the day's own agenda, so the
notes are not pushed below the fold.

## Accounts and family groups

```
                      ┌────────────────────────────────┐
  Google ────┐        │  Supabase Auth                 │
  Apple  ────┼───────►│  passwords, OAuth, verification│
  Email  ────┘        │  emails, password resets       │
                      └───────────────┬────────────────┘
                                      │ access token
                              httpOnly cookies
                                      │
  browser ◄──────────────── server/ ──┴──► Postgres (row level security)
            no token ever         holds the session,      households
            reaches page          sends invitations       memberships
            scripts                                       invitations
                                                          notes, replies
```

**Signing up** happens three ways and always ends in the same place: a row in
`auth.users` and a matching `profiles` row created by a trigger. Google and
Apple hand over a name; Apple often does not, and hides the email behind a
private relay address, so the display name falls back to the local part of the
address and can be edited afterwards.

**A family group** is one fridge door. Anyone can start one and becomes its
owner. There is no directory, no search, no public group — the only route in is
an invitation.

**An invitation** is a 32-byte random token emailed as a link. Only its
SHA-256 hash is stored, so a copy of the database is not a set of working
invitations. It is single-use, expires after 14 days, and by default only works
for someone signed in with the address it was sent to. That last rule is
relaxable per invitation, because Apple's private relay means the address
somebody signs in with is often not the address you invited — the invite form
has a checkbox for exactly that case.

You can belong to several groups (your own home and your parents', say) and
switch between them from the name chip.

### Where the security actually lives

The row level security policies in `supabase/schema.sql` are the boundary, not
the API handlers. Every policy reduces to *are you a member of this
household?*, and the server queries Postgres **as the signed-in user**, so a
bug in a route handler cannot reach another family's door. The handlers are
convenience; the database is the rule.

Two deliberate exceptions, both narrow:

- Redeeming an invitation uses the `service_role` key, because the invitee
  matches no policy yet — they are not a member of anything. Every check a
  policy would have made is therefore explicit in `server/src/routes/invites.js`.
- The `service_role` key exists only in the server process and is never sent
  to the browser.

Session tokens live in **httpOnly cookies**, so no page script can read them.
The cost of that choice is real and worth naming: the browser cannot open a
Supabase Realtime socket without a token it is allowed to read, so the fridge
polls every 8 seconds (and immediately on focus, and after each of your own
writes) instead of streaming. For a family fridge that is a fair trade. If you
would rather have instant updates, the swap is a server-sent-events endpoint
fed by a Realtime subscription on the server.

## Setting it up

You need a Supabase project (the free tier is plenty for a household) and, for
the social buttons, a Google OAuth client and an Apple Services ID. The
email-and-password route works with none of that.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL editor**, paste in all of `supabase/schema.sql`, and run it.
   It is written to be re-runnable, so applying it again later is harmless.
3. Photos need the storage bucket, which `schema.sql` creates for you. If
   you would rather check: **Storage** should list a private bucket called
   `fridge-photos`.
4. **Settings → API** gives you three values for `server/.env`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
5. **Authentication → URL Configuration**: set the Site URL to your `APP_URL`
   and add `<APP_URL>/auth/callback` to the redirect allow-list.
6. **Authentication → Providers → Email** is on by default. Leave "Confirm
   email" on unless you are just testing; the app handles both settings.

Supabase's built-in email sender is rate-limited to a handful per hour and is
not intended for production, so set up **Authentication → SMTP Settings** with
your own provider before real people use this. That covers verification and
password-reset mail. Invitation mail is separate and configured below.

### 2. Google

1. In the [Google Cloud console](https://console.cloud.google.com), create an
   OAuth 2.0 Client ID of type **Web application**.
2. Authorised redirect URI — this points at **Supabase**, not at your app:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Paste the client ID and secret into Supabase → **Authentication → Providers
   → Google**.

### 3. Apple

Apple is more work than Google, and the credential expires.

1. In the Apple Developer portal, register a **Services ID** (not an App ID) —
   for example `com.example.fridge.web`. Enable *Sign in with Apple* on it.
2. Its **Return URL** is your Supabase callback:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Under **Keys**, create a key with *Sign in with Apple* enabled and download
   the `.p8`. Apple lets you download it **once**.
4. Turn the key into the JWT that Supabase wants:

   ```sh
   node scripts/apple-secret.mjs \
     --team ABCDE12345 \
     --key-id XYZ9876543 \
     --service com.example.fridge.web \
     --p8 ./AuthKey_XYZ9876543.p8
   ```

5. Paste the Services ID and that JWT into Supabase → **Authentication →
   Providers → Apple**.

**Apple caps the secret at six months.** When it expires, Apple sign-in stops
working with an unhelpful error. Re-run the script and paste the new value —
and put a reminder on the fridge.

### 4. Invitation email

`MAIL_TRANSPORT` picks how invitations go out:

- `resend` — set `RESEND_API_KEY`. Easiest to get working.
- `smtp` — set `SMTP_URL`, or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`.
- `console` — prints the invitation link to the server log and sends nothing.
  The link also comes back to the invite form on screen, so development needs
  no mail provider at all.

If sending fails, the invitation is still created and the API returns the link
so you can pass it on another way, rather than the invitation silently going
nowhere.

### 5. Run it

```sh
cp .env.example server/.env     # then fill it in
cd server && npm install
npm run dev                     # http://localhost:3000
```

## Deploying

Nothing is stored on disk, so any Node host works and redeploys lose nothing.

- **Docker / your own VPS** — `docker compose up -d --build`. Put your
  hostname in `Caddyfile`; Caddy gets and renews the TLS certificate itself.
- **Fly, Render, Railway** — point them at the `Dockerfile`, set the env vars,
  done.
- **Vercel and other serverless hosts** — works, since sessions are cookies
  and there is no local state. The 8-second poll is a plain request, not a
  long-lived connection.

Whatever you pick: `APP_URL` must be the real https URL and must match the
redirect you registered with Supabase, or sign-in will bounce.

## Add to calendar

Dated notes offer Google Calendar and Outlook deep links, plus the event
details on the clipboard for anything else.

There is deliberately no `.ics` download. Apple exposes no URL scheme for
adding an event, so an iPhone user who keeps everything in Apple Calendar gets
the copyable details; everyone else gets a working deep link. (In the artifact
build below there is a second reason: the viewer sandbox makes download links
inert and its allowlist has no `ics` in it.)

## Two builds of the same fridge

The storage layer sits behind one small interface with three implementations,
so the fridge itself does not know or care which one it got:

| `web/fridge.html` | This server's API, Postgres, real accounts and groups |
| `web/index.html` | The Artifact `db` capability — no accounts, shared by link |
| either, offline | `localStorage`, so the page still works on its own |

`web/index.html` is the no-account version that runs as a published Claude
Artifact. It is a genuinely different trust model — anyone who can open the
link is trusted, and identity is a name you pick — and it exists because it
needs no infrastructure at all. The hosted build in `web/fridge.html` is the
one with sign-up, groups and invitations.

## Using it

- **Tap** a note to write on it. On a phone it opens as a bottom sheet; on a
  wide screen it opens in place. `Esc` or **Stick it up** closes it.
- **Drag** a note anywhere on the wide door. Positions are shared, so the door
  looks the same for the whole family, like a real fridge.
- **Keyboard**: `Tab` to a note, `Enter` to edit, arrow keys to move it (hold
  `Shift` to move further).
- The **name chip** in the plate opens your family: who is in the group, who
  has been invited, your other groups, and signing out.

All note and reply text is written to the DOM with `textContent`, never
`innerHTML`, because shared data is untrusted input. Confirmations are drawn
in the page rather than with `window.confirm`, which a sandboxed frame ignores
outright — it returns false without prompting, which once made every "take it
off the fridge" button a silent no-op. The server sends a strict
`Content-Security-Policy` with no inline script and no inline style, which is
why every page links a separate `.js` file and styles go through the CSSOM.
