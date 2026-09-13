# The Family Fridge

A shared refrigerator door. Everyone in the house sticks their own notes,
reminders, appointments, announcements, lists and photo-memories onto it,
drags them wherever they like, and sees everyone else's changes live.

It is built to look and behave like the real thing: brushed steel, a chrome
handle, paper scraps at slight angles, and a magnet in your own colour
holding up everything you wrote.

It is built for the phone first, which is where a fridge app actually gets
used. On a narrow screen the door is a column you scroll, notes open in a
bottom sheet, and every target is thumb-sized. From 761px up it becomes a
surface you arrange by dragging.

## What goes on the door

Six magnets sit in the tray at the bottom. Click one to stick something up.

| Magnet | What it is | Behaves like |
| --- | --- | --- |
| **Note** | A post-it in any of six paper colours | Free text, handwriting |
| **Reminder** | A notepad slip with a red flag | Optional due date, tick it off when done |
| **Appointment** | An index card with a clip | Date and time; shows up on the calendar |
| **Announcement** | A printed notice held on with tape | Big condensed type for things nobody may miss |
| **List** | A lined pad | A running checklist — groceries, packing, chores |
| **Memory** | A polaroid | A sticker and a caption |

Every note also carries:

- **A pen.** Seven faces to write with — Pen, Neat, Loopy, Marker, Biro,
  Typed and Printed — chosen per note and previewed as you pick it.
- **A last-updated tag.** "Added 20m ago", or "Updated 2h ago" once someone
  has changed it. Relative times refresh on the minute.
- **Replies.** Anyone in the family can reply on a note, signed with their
  own magnet colour. The last three show on the note; the rest unfold. A
  reply is a conversation about the note, not an edit of it, so it leaves
  the note's own last-updated tag alone.
- **Add to calendar**, on anything with a date. See below.

A month calendar hangs on the door as a seventh, permanent sheet. It shows a
coloured pip on every day that has something on it — one pip per person — and
its day list links back to the note on the door. `+ Appointment` on any day
creates a dated card for it. On a phone the month grid folds away by default,
leaving the day's own agenda, so the notes are not pushed below the fold.

## Using it

- **Tap** a note to write on it. On a phone it opens as a bottom sheet; on a
  wide screen it opens in place. `Esc` or **Stick it up** closes it.
- **Drag** a note anywhere on the wide door. Positions are shared, so the
  door looks the same for the whole family, like a real fridge.
- **Keyboard**: `Tab` to a note, `Enter` to edit, arrow keys to move it
  (hold `Shift` to move further).
- **Who's at the fridge?** in the name plate is how you sign your notes.
  Each person gets their own magnet colour. Nothing here needs an account.
- On a phone the door is a single scrolling column, newest note first, with
  the calendar at the top.

## How it is shared

Storage sits behind one small interface with two implementations
(`app/fridge.js`):

- **Shared** — the Artifact `db` capability. Every family member with the
  link reads and writes the same documents, and `onSnapshot` pushes each
  change to everyone who has the door open. The `room` capability adds the
  presence dots, so you can see who is standing at the fridge right now.
- **On this device** — `localStorage`, used whenever the shared store is not
  available. The door still works, it just isn't shared. The name plate says
  which of the two you are looking at.

Documents live at `notes/<id>`, `roster/<id>` and `fridge/door`. Replies are
stored on the note document they belong to. Note positions are fractions of a
viewport-sized canvas, so a note keeps its place on the door across different
screen sizes.

## Add to calendar

Dated notes offer Google Calendar and Outlook deep links, plus the event
details on the clipboard for anything else.

There is deliberately no `.ics` file. Two things rule it out inside the
Artifact viewer: the `downloads` capability's extension allowlist does not
include `ics`, and the viewer sandbox makes ordinary download links — `<a
download>`, `data:` and `blob:` hrefs included — inert. The Google Calendar
link is the one route that reaches a phone's calendar app on both Android and
iOS; iPhone users who keep everything in Apple Calendar get the copyable
details instead, because iOS exposes no URL scheme for adding an event.

All note text is written to the DOM with `textContent`, never `innerHTML`,
because shared data is untrusted input.

## Running it

No build step and no dependencies.

```sh
# open it directly
open app/index.html          # macOS  (xdg-open on Linux)

# or serve it
python3 -m http.server -d app 8000
```

Opened this way it runs in its own-device mode against `localStorage`. To get
the shared fridge, publish `app/index.html` as an Artifact with the `db` and
`room` capabilities declared, and share the link with the family.

## Layout

```
app/index.html   the door, the name plate, the magnet tray
app/fridge.css   tokens, materials (steel, paper, tape, magnets), both themes
app/fridge.js    storage, notes, dragging, the calendar, presence
```
