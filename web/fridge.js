/* ============================================================
   The Family Fridge
   A shared refrigerator door: notes, reminders, appointments,
   announcements, lists and memories, each held on by a magnet.

   Built for the phone first. On a narrow screen the door is a
   column you scroll and notes open in a bottom sheet; from 761px
   up it becomes a surface you arrange by dragging.

   Storage has two back ends behind one interface:
     - the artifact `db` capability, so the whole family sees the
       same door, live;
     - localStorage, so the page still works on its own.
   All note and reply text is written with textContent — never
   innerHTML — because shared data is untrusted.
   ============================================================ */

(() => {
  "use strict";

  /* ---------------- vocabulary ---------------- */

  const PAPERS = ["canary", "rose", "mint", "sky", "peach", "lilac"];
  const PAPER_HEX = {
    canary: "#fdf0a4", rose: "#ffc2d4", mint: "#bff0d7",
    sky: "#b8dcf8", peach: "#ffd4a9", lilac: "#dcccf6",
    white: "#ffffff", card: "#fdfbf4",
  };

  const MAGNET_COLORS = [
    "#c0392f", "#2f6fa8", "#3f8f5a", "#dd9022",
    "#7a52a8", "#1f8f92", "#d4568c", "#5c6675",
  ];

  /* The pens you can write with. `size` is the body size in rem —
     each face has its own natural weight on the page. */
  const PENS = {
    pen:     { name: "Pen",     stack: '"Caveat", cursive',              size: 1.34 },
    neat:    { name: "Neat",    stack: '"Patrick Hand", cursive',        size: 1.16 },
    loopy:   { name: "Loopy",   stack: '"Gloria Hallelujah", cursive',   size: 0.98 },
    marker:  { name: "Marker",  stack: '"Permanent Marker", cursive',    size: 1.06 },
    biro:    { name: "Biro",    stack: '"Kalam", cursive',               size: 1.08 },
    typed:   { name: "Typed",   stack: '"Archivo", sans-serif',          size: 0.94 },
    printed: { name: "Printed", stack: '"Oswald", sans-serif',           size: 1.14 },
  };
  const PEN_ORDER = ["pen", "neat", "loopy", "marker", "biro", "typed", "printed"];

  const KINDS = {
    sticky:   { label: "Note",         glyph: "📝", tray: "#fdf0a4", fast: "magnet", w: 212, pen: "pen",     paper: "canary" },
    reminder: { label: "Reminder",     glyph: "⏰", tray: "#ff9a8f", fast: "magnet", w: 212, pen: "pen",     paper: "white" },
    event:    { label: "Appointment",  short: "Date", glyph: "📅", tray: "#b8dcf8", fast: "clip", w: 212, pen: "neat", paper: "card" },
    announce: { label: "Announcement", short: "Notice", glyph: "📣", tray: "#ffd4a9", fast: "tape", w: 250, pen: "printed", paper: "white" },
    list:     { label: "List",         glyph: "🛒", tray: "#bff0d7", fast: "magnet", w: 212, pen: "neat",    paper: "white" },
    memory:   { label: "Memory",       glyph: "📷", tray: "#dcccf6", fast: "tape",   w: 190, pen: "pen",     paper: "sky" },
    calendar: { label: "Calendar",     glyph: "🗓", tray: "#ffffff", fast: "magnet", w: 312, pen: "typed",   paper: "white" },
  };

  const STICKERS = ["🎂", "🏆", "🎄", "🏖", "⚽", "🐶", "🎸", "🍕", "🎓", "❤️", "🎉", "🚗"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  const DATED = { event: true, reminder: true };

  /* ---------------- small helpers ---------------- */

  const $ = (sel) => document.querySelector(sel);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

  /* Note positions are fractions of this canvas. It is pinned to the
     viewport rather than to the door's own height, so growing the door
     to reach a low note can never shift everything else downward. */
  const baseW = () => Math.max(320, document.getElementById("door").clientWidth);
  const baseH = () => Math.max(420, window.innerHeight - 210);

  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      /* Applied through the CSSOM rather than as a style attribute:
         the server's Content-Security-Policy allows no inline style
         attributes, and setProperty is not subject to it. */
      else if (k === "style") {
        for (const rule of String(v).split(";")) {
          const at = rule.indexOf(":");
          if (at < 1) continue;
          node.style.setProperty(rule.slice(0, at).trim(), rule.slice(at + 1).trim());
        }
      }
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(typeof kid === "object" ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const TODAY = isoOf(new Date());

  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function prettyDate(iso) {
    const d = parseISO(iso);
    if (!d) return "";
    const days = Math.round((d - parseISO(TODAY)) / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";
    const base = `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
    return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
  }

  function prettyTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    if (!m) return "";
    const hr = +m[1], ap = hr < 12 ? "am" : "pm";
    return `${((hr + 11) % 12) + 1}:${m[2]}${ap}`;
  }

  function urgency(iso) {
    const d = parseISO(iso);
    if (!d) return "";
    const days = Math.round((d - parseISO(TODAY)) / 86400000);
    if (days < 0) return "late";
    if (days <= 1) return "soon";
    return "";
  }

  /* How long ago, in the words you would actually use. */
  function ago(ts) {
    if (!ts) return "";
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m ago";
    if (s < 86400) return Math.max(1, Math.floor(s / 3600)) + "h ago";
    const days = Math.max(1, Math.floor(s / 86400));
    if (days < 7) return days + "d ago";
    const d = new Date(ts);
    const y = d.getFullYear() === new Date().getFullYear() ? "" : " " + d.getFullYear();
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${y}`;
  }

  function fullStamp(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, `
      + `${((d.getHours() + 11) % 12) + 1}:${pad2(d.getMinutes())}${d.getHours() < 12 ? "am" : "pm"}`;
  }

  /* ---------------- state ---------------- */

  const state = {
    notes: new Map(),
    roster: new Map(),
    meta: { name: "The Family Fridge" },
    me: localStorage.getItem("family-fridge/me") || null,
    shared: false,
    notesLoaded: false,
    editing: null,
    drafts: new Map(),
    replying: null,
    expanded: new Set(),
    cal: { ym: TODAY.slice(0, 7), sel: TODAY },
    calOpen: localStorage.getItem("family-fridge/cal") === "1",
    peers: [],
    account: null,        // the signed-in person, when there are accounts
    households: [],       // every family group they belong to
    household: null,      // the one whose door this is
  };

  const els = new Map();          // note id -> element
  let dragId = null;

  /* With accounts, who you are is the session — never a pick that can
     go stale, and never the name picker, which does not exist there.
     The roster is authoritative once it arrives; until then the
     signed-in account stands in for it. */
  const meMember = () => {
    const listed = state.me ? state.roster.get(state.me) : null;
    if (listed) return listed;
    if (store.account && state.account) {
      return {
        name: state.account.displayName,
        color: (state.household && state.household.color) || "#5c6675",
      };
    }
    return null;
  };
  const penOf = (note) => PENS[note.pen] || PENS[(KINDS[note.kind] || KINDS.sticky).pen] || PENS.pen;
  const repliesOf = (note) => (Array.isArray(note.replies) ? note.replies : []);

  /* ---------------- storage ---------------- */

  /* Both stores expose the same shape so the app never branches on
     which one it got. Writes are fire-and-forget; reads arrive
     through subscriptions. */

  function localStore() {
    const KEY = "family-fridge/v1";
    const read = () => {
      try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
    };
    let data = read();
    data.notes = data.notes || {};
    data.roster = data.roster || {};
    data.meta = data.meta || {};
    const subs = { notes: [], roster: [], meta: [] };

    const save = (which) => {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* full or blocked */ }
      subs[which].forEach((fn) => fn(which === "meta" ? { ...data.meta } : { ...data[which] }));
    };

    return {
      shared: false,
      onNotes(fn)  { subs.notes.push(fn);  fn({ ...data.notes }); },
      onRoster(fn) { subs.roster.push(fn); fn({ ...data.roster }); },
      onMeta(fn)   { subs.meta.push(fn);   fn({ ...data.meta }); },
      setNote(id, v)   { data.notes[id] = v; save("notes"); },
      patchNote(id, v) { data.notes[id] = { ...(data.notes[id] || {}), ...v }; save("notes"); },
      delNote(id)      { delete data.notes[id]; save("notes"); },
      setMember(id, v) { data.roster[id] = v; save("roster"); },
      delMember(id)    { delete data.roster[id]; save("roster"); },
      patchMeta(v)     { data.meta = { ...data.meta, ...v }; save("meta"); },
      addReply(id, reply) {
        const note = data.notes[id];
        if (!note) return;
        note.replies = [...(note.replies || []), reply].slice(-60);
        save("notes");
      },
      delReply(id, replyId) {
        const note = data.notes[id];
        if (!note) return;
        note.replies = (note.replies || []).filter((r) => r.id !== replyId);
        save("notes");
      },
      seed(notes, roster, meta) {
        if (Object.keys(data.notes).length) return false;
        data.notes = notes; data.roster = roster; data.meta = meta;
        save("notes"); save("roster"); save("meta");
        return true;
      },
    };
  }

  function dbStore(db) {
    const shout = (e) => console.warn("fridge/db", e && e.code, e && e.message);
    /* Snapshots are frozen and shared; the app works on its own copies. */
    const thaw = (v) => { try { return JSON.parse(JSON.stringify(v || {})); } catch { return {}; } };
    const collect = (snap) => {
      const out = {};
      for (const d of snap.docs) out[d.id] = thaw(d.data());
      return out;
    };
    return {
      shared: true,
      onNotes(fn)  { db.collection("notes").onSnapshot((s) => fn(collect(s)), shout); },
      onRoster(fn) { db.collection("roster").onSnapshot((s) => fn(collect(s)), shout); },
      onMeta(fn)   { db.doc("fridge/door").onSnapshot((s) => fn(s.exists ? thaw(s.data()) : {}), shout); },
      setNote(id, v)   { db.doc("notes/" + id).set(v).catch(shout); },
      patchNote(id, v) { db.doc("notes/" + id).update(v).catch(shout); },
      delNote(id)      { db.doc("notes/" + id).delete().catch(shout); },
      setMember(id, v) { db.doc("roster/" + id).set(v).catch(shout); },
      delMember(id)    { db.doc("roster/" + id).delete().catch(shout); },
      patchMeta(v)     { db.doc("fridge/door").set({ ...state.meta, ...v }).catch(shout); },
      addReply(id, reply) {
        const note = state.notes.get(id);
        if (!note) return;
        db.doc("notes/" + id).update({ replies: [...repliesOf(note), reply].slice(-60) }).catch(shout);
      },
      delReply(id, replyId) {
        const note = state.notes.get(id);
        if (!note) return;
        db.doc("notes/" + id).update({ replies: repliesOf(note).filter((r) => r.id !== replyId) }).catch(shout);
      },
      seed()           { return false; },
    };
  }

  /* Talks to the server in supabase/ + server/: real accounts, real
     family groups, one door per group. Reads are polled rather than
     streamed because the session lives in httpOnly cookies, which the
     page cannot read and so cannot hand to a realtime socket — a fair
     trade for keeping the access token out of reach of any script. */
  function apiStore() {
    const subs = { notes: [], roster: [], meta: [] };
    let csrf = "";
    let inFlight = 0;
    let quietUntil = 0;          // ignore polls just after our own write
    let timer = null;
    let lastJson = "";

    const headers = () => ({ "content-type": "application/json", "x-fridge-csrf": csrf });

    async function call(method, url, body) {
      inFlight += 1;
      quietUntil = Date.now() + 1500;
      try {
        const response = await fetch(url, {
          method,
          headers: headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: "same-origin",
        });
        if (response.status === 401) { window.location.href = "/signin"; return null; }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast(payload.message || "That did not save. Try again.");
          return null;
        }
        return payload;
      } catch {
        toast("No connection to the fridge. Your change is not saved yet.");
        return null;
      } finally {
        inFlight -= 1;
        refresh();
      }
    }

    async function refresh() {
      if (inFlight > 0) return;
      let payload;
      try {
        const response = await fetch("/api/notes", { credentials: "same-origin" });
        if (response.status === 401) { window.location.href = "/signin"; return; }
        if (response.status === 409) { window.location.href = "/start"; return; }
        if (!response.ok) return;
        payload = await response.json();
      } catch { return; }

      if (inFlight > 0 || Date.now() < quietUntil) return;

      const fingerprint = JSON.stringify(payload);
      if (fingerprint === lastJson) return;
      lastJson = fingerprint;

      state.household = payload.household || null;
      const roster = {};
      for (const m of payload.members || []) roster[m.id] = { name: m.name, color: m.color, createdAt: 0 };
      subs.roster.forEach((fn) => fn(roster));
      subs.meta.forEach((fn) => fn({ name: (payload.household && payload.household.name) || "The Family Fridge" }));
      subs.notes.forEach((fn) => fn(payload.notes || {}));
    }

    function poll() {
      clearTimeout(timer);
      timer = setTimeout(async () => { await refresh(); poll(); }, 8000);
    }

    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    window.addEventListener("focus", () => refresh());

    return {
      shared: true,
      account: true,
      async open() {
        const response = await fetch("/api/me", { credentials: "same-origin" });
        const me = await response.json();
        if (!me.signedIn) { window.location.href = "/signin"; return false; }
        csrf = me.csrf;
        state.account = me.user;
        state.households = me.households || [];
        state.me = me.user.id;
        if (!me.current) { window.location.href = "/start"; return false; }
        state.household = me.current;
        await refresh();
        poll();
        return true;
      },
      onNotes(fn)  { subs.notes.push(fn); },
      onRoster(fn) { subs.roster.push(fn); },
      onMeta(fn)   { subs.meta.push(fn); },
      setNote(id, v)   { call("PUT", `/api/notes/${encodeURIComponent(id)}`, apiNote(v)); },
      patchNote(id, v) { call("PATCH", `/api/notes/${encodeURIComponent(id)}`, apiNote(v)); },
      delNote(id)      { call("DELETE", `/api/notes/${encodeURIComponent(id)}`); },
      setMember() {},
      delMember() {},
      patchMeta(v) {
        if (!v.name || !state.household) return;
        call("PATCH", `/api/households/${state.household.id}`, { name: v.name });
      },
      addReply(id, reply) { call("POST", `/api/notes/${encodeURIComponent(id)}/replies`, { body: reply.text }); },
      delReply(id, replyId) { call("DELETE", `/api/replies/${encodeURIComponent(replyId)}`); },
      seed() { return false; },
      refresh,
      request: call,
      csrf: () => csrf,
    };
  }

  /* Fields the server owns are not the browser's to send. */
  function apiNote(note) {
    const out = {};
    for (const key of ["kind", "body", "title", "pen", "paper", "sticker", "tilt", "x", "y", "raised", "done", "date", "time", "items"]) {
      if (note[key] !== undefined) out[key] = note[key];
    }
    if (out.raised !== undefined) out.raised = Math.round(out.raised);
    return out;
  }

  let store = localStore();
  let room = null;

  /* ---------------- the example fridge (this device only) ---------------- */

  /* Only ever used when this device has no fridge of its own and the
     shared store is unavailable, so the door is never an empty shell. */
  function exampleFridge() {
    const soon = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
    const t = Date.now();
    const people = {
      ex1: { name: "Sam", color: MAGNET_COLORS[0], createdAt: 1 },
      ex2: { name: "Nadia", color: MAGNET_COLORS[1], createdAt: 2 },
      ex3: { name: "Theo", color: MAGNET_COLORS[2], createdAt: 3 },
    };
    const by = (k) => ({ by: k, byName: people[k].name, byColor: people[k].color });
    const notes = {
      calendar: { kind: "calendar", x: 0.63, y: 0.02, raised: 1, tilt: -1, createdAt: 1 },
      ex_a: { kind: "sticky", body: "Bin day moved to Thursday this week!", paper: "canary", pen: "pen",
              x: 0.03, y: 0.02, raised: 3, tilt: -3, ...by("ex2"),
              createdAt: t - 5400e3, updatedAt: t - 5400e3, example: true,
              replies: [{ id: "r1", by: "ex1", byName: "Sam", byColor: MAGNET_COLORS[0],
                          text: "Bins are already out, don't worry", at: t - 1800e3 }] },
      ex_b: { kind: "list", title: "Groceries", pen: "neat", x: 0.03, y: 0.44, raised: 4, tilt: 2,
              items: [{ t: "Oat milk", done: false }, { t: "Bread", done: true },
                      { t: "Lemons", done: false }, { t: "Dog food", done: false }],
              ...by("ex1"), createdAt: t - 86400e3, updatedAt: t - 900e3, example: true },
      ex_c: { kind: "reminder", body: "Theo — hand in the permission slip", date: soon(1), pen: "pen",
              done: false, x: 0.22, y: 0.02, raised: 5, tilt: 2, ...by("ex1"),
              createdAt: t - 7200e3, updatedAt: t - 7200e3, example: true },
      ex_d: { kind: "event", body: "Grandma's birthday lunch", date: soon(5), time: "12:30", pen: "neat",
              x: 0.22, y: 0.44, raised: 6, tilt: -2, ...by("ex2"),
              createdAt: t - 172800e3, updatedAt: t - 172800e3, example: true },
      ex_e: { kind: "announce", body: "Nobody touch the cake", pen: "printed",
              x: 0.42, y: 0.42, raised: 7, tilt: 1.5, ...by("ex3"),
              createdAt: t - 3600e3, updatedAt: t - 3600e3, example: true,
              replies: [{ id: "r2", by: "ex2", byName: "Nadia", byColor: MAGNET_COLORS[1],
                          text: "Too late", at: t - 600e3 }] },
      ex_f: { kind: "memory", body: "Beach, last August", sticker: "🏖", paper: "sky", pen: "pen",
              x: 0.64, y: 0.62, raised: 8, tilt: -4, ...by("ex3"),
              createdAt: t - 604800e3, updatedAt: t - 604800e3, example: true },
      ex_g: { kind: "event", body: "Swim club pickup", date: soon(0), time: "17:00", pen: "neat",
              x: 0.42, y: 0.02, raised: 9, tilt: -1.5, ...by("ex3"),
              createdAt: t - 1200e3, updatedAt: t - 1200e3, example: true },
    };
    return { notes, roster: people, meta: { name: "The Family Fridge" } };
  }

  /* ---------------- status chrome ---------------- */

  function paintStatus() {
    const s = $("#status");
    s.dataset.live = store.shared ? "1" : "0";
    if (store.account) {
      const count = state.roster.size;
      s.textContent = count > 1 ? `Shared with ${count - 1} other${count > 2 ? "s" : ""}` : "Only you so far";
      s.title = count > 1
        ? "Everyone in this family group sees this door."
        : "Invite your family from the name chip above.";
      return;
    }
    s.textContent = store.shared ? "Shared with the family" : "Saved on this device";
    s.title = store.shared
      ? "Everyone with the link sees this door, and changes show up live."
      : "This door lives in this browser only. Nobody else can see it.";
  }

  function paintMe() {
    const me = meMember();
    const dot = $("#me-dot"), name = $("#me-name");
    if (me) {
      dot.style.setProperty("--c", me.color);
      dot.textContent = me.name.slice(0, 1).toUpperCase();
      name.textContent = me.name;
      $("#whoami").title = store.account ? "Your family, invitations and account" : "Change who's at the fridge";
    } else if (store.account && state.account) {
      dot.style.setProperty("--c", "#9aa2ad");
      dot.textContent = state.account.displayName.slice(0, 1).toUpperCase();
      name.textContent = state.account.displayName;
    } else {
      dot.style.setProperty("--c", "#9aa2ad");
      dot.textContent = "?";
      name.textContent = "Who's at the fridge?";
    }
  }

  function paintHere() {
    const box = $("#here");
    box.textContent = "";
    if (!state.peers.length) return;
    const seen = new Set();
    for (const p of state.peers) {
      const who = String((p.presence && p.presence.who) || "").slice(0, 24);
      const color = /^#[0-9a-f]{6}$/i.test(String((p.presence && p.presence.color) || ""))
        ? p.presence.color : "#9aa2ad";
      const key = p.isMe ? "me" : who + color;
      if (seen.has(key)) continue;
      seen.add(key);
      box.append(h("span", {
        class: "dot" + (p.isMe ? " is-me" : ""),
        style: `--c:${color}`,
        title: p.isMe ? (who || "You") + " (you)" : (who || "Someone") + " is at the fridge",
        text: (who || "?").slice(0, 1).toUpperCase(),
      }));
    }
  }

  function publishPresence() {
    if (!room) return;
    const me = meMember();
    room.presence({ who: me ? me.name : "Someone", color: me ? me.color : "#9aa2ad" }).catch(() => {});
  }

  let toastTimer = null;
  function toast(message) {
    const old = $(".toast");
    if (old) old.remove();
    const el = h("div", { class: "toast", role: "status", text: message });
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2800);
  }

  /* ---------------- the tray of magnets ---------------- */

  function buildTray() {
    const tray = $("#tray");
    tray.textContent = "";
    for (const kind of ["sticky", "reminder", "event", "announce", "list", "memory"]) {
      const k = KINDS[kind];
      tray.append(h("button", {
        class: "magnet", type: "button", onclick: () => addNote(kind),
        title: `Stick a new ${k.label.toLowerCase()} on the fridge`,
      },
        h("span", { class: "magnet-disc", style: `--mc:${k.tray}`, "aria-hidden": "true", text: k.glyph }),
        h("span", { text: k.short || k.label })));
    }
  }

  /* ---------------- placing a new note ---------------- */

  function freeSpot(kind) {
    const dw = baseW(), dh = baseH();
    const w = KINDS[kind].w, ht = 190;
    const taken = [...state.notes.values()].map((n) => ({
      x: (n.x || 0) * dw, y: (n.y || 0) * dh,
      w: KINDS[n.kind] ? KINDS[n.kind].w : 212, h: n.kind === "calendar" ? 330 : 190,
    }));
    let best = null;
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * Math.max(1, dw - w);
      const y = Math.random() * Math.max(1, dh - ht);
      let cost = 0;
      for (const t of taken) {
        const ox = Math.max(0, Math.min(x + w, t.x + t.w) - Math.max(x, t.x));
        const oy = Math.max(0, Math.min(y + ht, t.y + t.h) - Math.max(y, t.y));
        cost += ox * oy;
      }
      if (!best || cost < best.cost) best = { x, y, cost };
      if (cost === 0) break;
    }
    return { x: best.x / dw, y: best.y / dh };
  }

  function addNote(kind, extra) {
    const me = meMember();
    if (!me) {
      if (store.account) { toast("Still opening the fridge — try again in a second."); return; }
      openRoster(() => addNote(kind, extra));
      return;
    }
    const id = uid();
    const spot = freeSpot(kind);
    const now = Date.now();
    const note = {
      kind,
      body: "",
      pen: KINDS[kind].pen,
      paper: kind === "sticky" ? PAPERS[Math.floor(Math.random() * PAPERS.length)] : KINDS[kind].paper,
      tilt: Math.round((Math.random() * 6 - 3) * 10) / 10,
      x: spot.x, y: spot.y, raised: now,
      by: state.me, byName: me.name, byColor: me.color,
      createdAt: now, updatedAt: now,
      replies: [],
      ...(kind === "list" ? { title: "List", items: [] } : null),
      ...(kind === "reminder" ? { date: "", done: false } : null),
      ...(kind === "event" ? { date: TODAY, time: "" } : null),
      ...(kind === "memory" ? { sticker: STICKERS[Math.floor(Math.random() * STICKERS.length)] } : null),
      ...extra,
    };
    state.notes.set(id, note);
    store.setNote(id, note);
    layout();
    openEditor(id);
    const el = els.get(id);
    if (el && !isPhone()) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* ---------------- painting one note ---------------- */

  /* The paper, the pen and the author's magnet colour, as CSS
     custom properties — used by the note itself and by its editor. */
  function dressUp(el, note) {
    const kind = KINDS[note.kind] ? note.kind : "sticky";
    const pen = penOf(note);
    el.dataset.kind = kind;
    el.dataset.pen = note.pen || KINDS[kind].pen;
    el.style.setProperty("--paper", PAPER_HEX[note.paper] || PAPER_HEX[KINDS[kind].paper] || "#ffffff");
    el.style.setProperty("--pen", pen.stack);
    el.style.setProperty("--pen-size", pen.size + "rem");
    el.style.setProperty("--c", note.byColor || "#c0392f");
  }

  function noteTools(id, note) {
    const kids = [];
    if (note.kind === "calendar") return null;
    if (!isPhone() && state.editing !== id) {
      kids.push(h("button", {
        type: "button", title: "Write on this note", "aria-label": "Write on this note",
        onclick: (e) => { e.stopPropagation(); openEditor(id); }, text: "✎",
      }));
    }
    kids.push(h("button", {
      type: "button", title: "Take this off the fridge", "aria-label": "Take this off the fridge",
      onclick: (e) => { e.stopPropagation(); removeNote(id); }, text: "✕",
    }));
    return h("div", { class: "n-tools" }, kids);
  }

  /* The signature line, with the last-updated tag. */
  function signature(note) {
    const when = note.updatedAt || note.createdAt;
    const edited = note.updatedAt && note.createdAt && note.updatedAt - note.createdAt > 60000;
    const stamp = when
      ? h("span", {
          class: "stamp" + (note.byName ? "" : " bare"),
          "data-at": when, "data-prefix": edited ? "Updated " : "Added ",
          title: (edited ? "Last updated " : "Added ") + fullStamp(when),
          text: (edited ? "Updated " : "Added ") + ago(when),
        })
      : null;
    if (!note.byName && !stamp) return null;
    return h("div", { class: "n-sign" },
      note.byName
        ? h("span", { class: "who" },
            h("span", { class: "seal", style: `--c:${note.byColor || "#c0392f"}`, "aria-hidden": "true" }),
            note.byName)
        : null,
      stamp,
      note.example ? h("span", { class: "tag", title: "A starter note — delete it any time", text: "example" }) : null);
  }

  function dueChip(note) {
    if (!note.date) return null;
    return h("span", { class: "when " + urgency(note.date) },
      h("span", { text: prettyDate(note.date) }),
      note.time ? h("span", { text: prettyTime(note.time) }) : null);
  }

  /* ---------------- replies ---------------- */

  function threadBlock(id, note) {
    const replies = repliesOf(note);
    const out = [];
    if (replies.length) {
      const showAll = state.expanded.has(id) || replies.length <= 3;
      const shown = showAll ? replies : replies.slice(-3);
      const thread = h("div", { class: "thread" });
      if (!showAll) {
        thread.append(h("button", {
          class: "earlier", type: "button",
          onclick: (e) => { e.stopPropagation(); state.expanded.add(id); repaint(id); },
          text: `+ ${replies.length - 3} earlier`,
        }));
      }
      for (const r of shown) {
        thread.append(h("div", { class: "reply" },
          h("span", { class: "seal", style: `--c:${r.byColor || "#c0392f"}`, "aria-hidden": "true" }),
          h("p", { class: "reply-text", text: r.text || "" }),
          h("span", { class: "reply-who" },
            h("span", { text: r.byName || "Someone" }),
            h("span", { class: "stamp", "data-at": r.at || 0, title: fullStamp(r.at), text: ago(r.at) }),
            r.by && r.by === state.me
              ? h("button", {
                  class: "rm", type: "button", "aria-label": "Delete your reply",
                  onclick: (e) => { e.stopPropagation(); removeReply(id, r.id); }, text: "✕",
                })
              : null)));
      }
      out.push(thread);
    }

    if (state.replying === id) {
      out.push(h("form", {
        class: "reply-form",
        onsubmit: (e) => {
          e.preventDefault();
          const input = e.currentTarget.querySelector(".reply-input");
          const v = input.value.trim();
          if (v) addReply(id, v);
          else { state.replying = null; repaint(id); }
        },
      },
        h("input", {
          class: "reply-input", type: "text", maxlength: "400", autocomplete: "off",
          placeholder: "Say something…", "aria-label": "Your reply",
          onkeydown: (e) => { if (e.key === "Escape") { e.stopPropagation(); state.replying = null; repaint(id); } },
        }),
        h("button", { class: "btn", type: "submit", text: "Add" })));
    } else {
      out.push(h("button", {
        class: "say", type: "button",
        onclick: (e) => { e.stopPropagation(); startReply(id); },
      },
        "Reply",
        replies.length ? h("span", { class: "count", text: String(replies.length) }) : null));
    }
    return out;
  }

  function paintNote(el, id, note) {
    dressUp(el, note);
    el.classList.toggle("done", !!note.done);
    const inlineEdit = state.editing === id && !isPhone();
    el.classList.toggle("editing", inlineEdit);
    el.textContent = "";

    if (inlineEdit) { paintEditor(el, id, note); return; }

    const kind = el.dataset.kind;
    const tools = noteTools(id, note);
    if (tools) el.append(tools);

    if (kind === "calendar") { paintCalendar(el); return; }

    if (kind === "reminder") {
      el.append(h("span", { class: "flag", "aria-hidden": "true" }));
      el.append(h("div", { class: "r-line" },
        h("button", {
          class: "tick", type: "button", role: "checkbox",
          "aria-checked": note.done ? "true" : "false",
          "aria-label": note.done ? "Mark as still to do" : "Mark as done",
          onclick: (e) => { e.stopPropagation(); patch(id, { done: !note.done }); },
          text: note.done ? "✓" : "",
        }),
        h("div", { style: "flex:1;min-width:0" },
          h("p", { class: "n-body", text: note.body || "" }),
          note.date ? h("div", { style: "margin-top:6px" }, dueChip(note)) : null)));
    } else if (kind === "event") {
      el.append(h("p", { class: "e-date", text: [prettyDate(note.date), prettyTime(note.time)].filter(Boolean).join(" · ") || "No date yet" }));
      el.append(h("p", { class: "n-body", text: note.body || "" }));
    } else if (kind === "announce") {
      el.append(h("span", { class: "n-kind", text: "Announcement" }));
      el.append(h("p", { class: "n-body", text: note.body || "" }));
    } else if (kind === "list") {
      const items = Array.isArray(note.items) ? note.items : [];
      el.append(h("div", { class: "n-head" },
        h("span", { class: "n-kind", text: note.title || "List" }),
        h("span", { class: "n-kind", style: "margin-left:auto", text: `${items.filter((i) => !i.done).length} left` })));
      el.append(h("ul", { class: "items" }, items.map((item, i) =>
        h("li", { class: item.done ? "off" : "" },
          h("button", {
            class: "tick", type: "button", role: "checkbox",
            "aria-checked": item.done ? "true" : "false",
            "aria-label": (item.done ? "Uncheck " : "Check off ") + item.t,
            onclick: (e) => { e.stopPropagation(); toggleItem(id, i); },
            text: item.done ? "✓" : "",
          }),
          h("span", { class: "txt", text: item.t }),
          h("button", {
            class: "rm", type: "button", "aria-label": "Remove " + item.t,
            onclick: (e) => { e.stopPropagation(); removeItem(id, i); }, text: "✕",
          })))));
      el.append(h("input", {
        class: "add-item", type: "text", placeholder: "Add an item…", autocomplete: "off",
        "aria-label": "Add an item to " + (note.title || "the list"),
        onclick: (e) => e.stopPropagation(),
        onkeydown: (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const v = e.currentTarget.value.trim();
          if (!v) return;
          e.currentTarget.value = "";
          addItem(id, v);
        },
      }));
    } else if (kind === "memory") {
      el.append(h("div", { class: "frame", style: `--shade:${PAPER_HEX[note.paper] || "#b8dcf8"}`, "aria-hidden": "true", text: note.sticker || "📷" }));
      el.append(h("p", { class: "n-body", text: note.body || "" }));
    } else {
      el.append(h("p", { class: "n-body", text: note.body || "" }));
    }

    el.append(h("div", { class: "n-foot" }, signature(note), threadBlock(id, note)));
  }

  /* ---------------- the editor ---------------- */

  /* Rendered inline into the note on a wide screen, and into a bottom
     sheet on a phone. Same markup either way — the CSS keys off
     data-kind and data-pen, which both hosts carry. */
  function paintEditor(host, id, note) {
    const kind = host.dataset.kind;
    const draft = state.drafts.get(id) || {};
    const val = (k, fallback) => (draft[k] !== undefined ? draft[k] : (note[k] !== undefined ? note[k] : fallback));
    const set = (k, v) => { state.drafts.set(id, { ...(state.drafts.get(id) || {}), [k]: v }); };
    const live = () => {                       // so the pen and paper change under your hand
      const merged = { ...note, ...(state.drafts.get(id) || {}) };
      dressUp(host, merged);
      const preview = host.querySelector(".frame");
      if (preview) {
        preview.style.setProperty("--shade", PAPER_HEX[merged.paper] || "#b8dcf8");
        preview.textContent = merged.sticker || "📷";
      }
      host.querySelectorAll(".pen-pick").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.pen === (merged.pen || KINDS[kind].pen) ? "true" : "false");
        b.style.setProperty("--pen", PENS[b.dataset.pen].stack);
      });
      host.querySelectorAll(".swatch").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.paper === merged.paper ? "true" : "false");
      });
      host.querySelectorAll(".stickers button").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.sticker === merged.sticker ? "true" : "false");
      });
    };

    if (isPhone()) {
      host.append(h("div", { class: "sheet-head" },
        h("h2", { text: KINDS[kind].label }),
        h("button", { class: "x-close", type: "button", "aria-label": "Close", onclick: () => closeEditor(true), text: "✕" })));
    } else {
      host.append(h("div", { class: "n-tools" },
        h("button", {
          type: "button", title: "Take this off the fridge", "aria-label": "Take this off the fridge",
          onclick: (e) => { e.stopPropagation(); removeNote(id); }, text: "✕",
        })));
      host.append(h("span", { class: "n-kind", text: KINDS[kind].label }));
    }

    if (kind === "list") {
      host.append(h("input", {
        class: "pen", style: "min-height:0;font-weight:600", type: "text", id: "pen-" + id,
        value: val("title", ""), placeholder: "What list is this?", "aria-label": "List name",
        oninput: (e) => set("title", e.currentTarget.value),
      }));
    } else if (kind === "memory") {
      host.append(h("div", {
        class: "frame", style: `--shade:${PAPER_HEX[val("paper", "sky")] || "#b8dcf8"}`,
        "aria-hidden": "true", text: val("sticker", "📷"),
      }));
      host.append(h("textarea", {
        class: "pen", id: "pen-" + id, style: "min-height:2.8em;margin-top:9px",
        placeholder: "What was this?", "aria-label": "Caption",
        oninput: (e) => set("body", e.currentTarget.value),
      }, val("body", "")));
      host.append(h("div", { class: "field-row" },
        h("label", { text: "Sticker" }),
        h("div", { class: "stickers" }, STICKERS.map((s) =>
          h("button", {
            type: "button", "aria-label": "Use " + s, text: s, "data-sticker": s,
            "aria-pressed": val("sticker", "") === s ? "true" : "false",
            onclick: () => { set("sticker", s); live(); },
          })))));
    } else {
      host.append(h("textarea", {
        class: "pen", id: "pen-" + id,
        placeholder: kind === "announce" ? "What does everyone need to know?"
          : kind === "reminder" ? "What needs doing?"
          : kind === "event" ? "What's happening?"
          : "Write something…",
        "aria-label": KINDS[kind].label + " text",
        oninput: (e) => set("body", e.currentTarget.value),
      }, val("body", "")));
    }

    if (DATED[kind]) {
      const fields = h("div", { class: "fields" },
        h("div", {},
          h("label", { for: "date-" + id, text: kind === "event" ? "Date" : "Due" }),
          h("input", {
            type: "date", id: "date-" + id, value: val("date", ""),
            oninput: (e) => { set("date", e.currentTarget.value); refreshCalLinks(host, id, note); },
          })));
      if (kind === "event") {
        fields.append(h("div", {},
          h("label", { for: "time-" + id, text: "Time" }),
          h("input", {
            type: "time", id: "time-" + id, value: val("time", ""),
            oninput: (e) => { set("time", e.currentTarget.value); refreshCalLinks(host, id, note); },
          })));
      }
      host.append(h("div", { class: "field-row" }, fields));
    }

    host.append(h("div", { class: "field-row" },
      h("label", { text: "Written with" }),
      h("div", { class: "pens", role: "group", "aria-label": "Choose a pen" },
        PEN_ORDER.map((key) => h("button", {
          class: "pen-pick", type: "button", "data-pen": key,
          style: `--pen:${PENS[key].stack}`,
          "aria-pressed": val("pen", KINDS[kind].pen) === key ? "true" : "false",
          "aria-label": "Write with " + PENS[key].name,
          onclick: () => { set("pen", key); live(); },
        },
          h("span", { class: "glyph", style: `font-family:${PENS[key].stack}`, "aria-hidden": "true", text: "Aa" }),
          h("span", { class: "nm", text: PENS[key].name })))))); 

    if (kind === "sticky" || kind === "memory") {
      host.append(h("div", { class: "field-row" },
        h("label", { text: kind === "memory" ? "Photo tint" : "Paper" }),
        h("div", { class: "swatches", role: "group", "aria-label": "Paper colour" },
          PAPERS.map((p) => h("button", {
            class: "swatch", type: "button", style: `--s:${PAPER_HEX[p]}`, "data-paper": p,
            "aria-label": p + " paper", title: p,
            "aria-pressed": val("paper", "") === p ? "true" : "false",
            onclick: () => { set("paper", p); live(); },
          })))));
    }

    if (kind === "list") {
      const items = Array.isArray(note.items) ? note.items : [];
      host.append(h("ul", { class: "items" }, items.map((item, i) =>
        h("li", { class: item.done ? "off" : "" },
          h("span", { class: "txt", text: item.t }),
          h("button", {
            class: "rm", type: "button", "aria-label": "Remove " + item.t,
            onclick: () => removeItem(id, i), text: "✕",
          })))));
      host.append(h("input", {
        class: "add-item", type: "text", placeholder: "Add an item…", "aria-label": "Add an item",
        autocomplete: "off",
        onkeydown: (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const v = e.currentTarget.value.trim();
          if (!v) return;
          e.currentTarget.value = "";
          addItem(id, v);
        },
      }));
    }

    if (DATED[kind]) {
      host.append(h("div", { class: "cal-slot" },
        h("button", {
          class: "to-cal", type: "button",
          disabled: !val("date", ""),
          onclick: () => openCalendarSheet({ ...note, ...(state.drafts.get(id) || {}) }),
        }, "📅", h("span", { text: "Add to calendar" }))));
    }

    host.append(h("div", { class: "editor-foot" },
      h("span", { class: "hint", text: isPhone() ? "Saves when you close it" : "Esc to close" }),
      h("button", {
        class: "btn" + (isPhone() ? " wide" : ""), type: "button",
        onclick: () => closeEditor(true), text: "Stick it up",
      })));
  }

  function refreshCalLinks(host, id, note) {
    const slot = host.querySelector(".cal-slot .to-cal");
    if (!slot) return;
    const merged = { ...note, ...(state.drafts.get(id) || {}) };
    slot.disabled = !merged.date;
  }

  function openEditor(id) {
    if (state.editing && state.editing !== id) closeEditor(true);
    const note = state.notes.get(id);
    if (!note || note.kind === "calendar") return;
    state.editing = id;
    state.drafts.delete(id);
    state.replying = null;
    raise(id);

    if (isPhone()) {
      const back = h("div", { class: "sheet-back", role: "dialog", "aria-modal": "true", "aria-label": "Write on this note" });
      back.dataset.for = id;
      back.addEventListener("pointerdown", (e) => { if (e.target === back) closeEditor(true); });
      const sheet = h("div", { class: "sheet note-editor" });
      back.append(sheet);
      document.body.append(back);
      dressUp(sheet, note);
      paintEditor(sheet, id, note);
      const pen = sheet.querySelector(".pen");
      if (pen && !note.body && !note.title) pen.focus();
      repaint(id);
      return;
    }

    repaint(id);
    const el = els.get(id);
    const pen = el && el.querySelector(".pen");
    if (pen) { pen.focus(); if (pen.setSelectionRange) pen.setSelectionRange(pen.value.length, pen.value.length); }
  }

  function closeEditor(save) {
    const id = state.editing;
    if (!id) return;
    state.editing = null;
    const back = document.querySelector('.sheet-back[data-for]');
    if (back) back.remove();
    const draft = state.drafts.get(id);
    state.drafts.delete(id);
    const note = state.notes.get(id);
    if (save && draft && note && Object.keys(draft).length) {
      const fields = { ...draft, updatedAt: Date.now(), example: false };
      Object.assign(note, fields);
      store.patchNote(id, fields);
    }
    if (note && !note.body && !note.title && !(note.items || []).length) {
      removeNote(id, true);
      return;
    }
    repaint(id);
  }

  /* ---------------- add to calendar ---------------- */

  /* No calendar file can reach the phone from inside the viewer, so
     these are the deep links that do work: Google Calendar (which the
     Android and iOS apps both open), Outlook, and the plain details to
     paste anywhere else. */
  function calendarPlan(note) {
    const d = parseISO(note.date);
    if (!d) return null;
    const title = (note.body || note.title || "Family fridge").trim().slice(0, 180);
    const allDay = !note.time;
    const tm = /^(\d{1,2}):(\d{2})$/.exec(note.time || "");
    const start = new Date(d);
    if (tm) start.setHours(+tm[1], +tm[2], 0, 0);
    const end = new Date(start);
    if (allDay) end.setDate(end.getDate() + 1);
    else end.setHours(end.getHours() + 1);

    const details = `From the family fridge${note.byName ? `, added by ${note.byName}` : ""}.`;
    const stampDay = (x) => `${x.getFullYear()}${pad2(x.getMonth() + 1)}${pad2(x.getDate())}`;
    const stampFull = (x) => `${stampDay(x)}T${pad2(x.getHours())}${pad2(x.getMinutes())}00`;
    const iso = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
    const isoFull = (x) => `${iso(x)}T${pad2(x.getHours())}:${pad2(x.getMinutes())}:00`;
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* older engine */ }

    const google = new URL("https://calendar.google.com/calendar/render");
    google.searchParams.set("action", "TEMPLATE");
    google.searchParams.set("text", title);
    google.searchParams.set("details", details);
    google.searchParams.set("dates", allDay
      ? `${stampDay(start)}/${stampDay(end)}`
      : `${stampFull(start)}/${stampFull(end)}`);
    if (tz && !allDay) google.searchParams.set("ctz", tz);

    const outlook = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
    outlook.searchParams.set("path", "/calendar/action/compose");
    outlook.searchParams.set("rru", "addevent");
    outlook.searchParams.set("subject", title);
    outlook.searchParams.set("body", details);
    if (allDay) {
      outlook.searchParams.set("allday", "true");
      outlook.searchParams.set("startdt", iso(start));
      outlook.searchParams.set("enddt", iso(end));
    } else {
      outlook.searchParams.set("startdt", isoFull(start));
      outlook.searchParams.set("enddt", isoFull(end));
    }

    const when = allDay
      ? `${DOW[start.getDay()]} ${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}, all day`
      : `${DOW[start.getDay()]} ${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}, ${prettyTime(note.time)}`;

    return { title, when, details, google: google.toString(), outlook: outlook.toString() };
  }

  function openCalendarSheet(note) {
    const plan = calendarPlan(note);
    if (!plan) { toast("Give this note a date first."); return; }

    const back = h("div", { class: "sheet-back", role: "dialog", "aria-modal": "true", "aria-label": "Add to calendar" });
    const close = () => back.remove();
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });

    const sheet = h("div", { class: "sheet mini" },
      h("div", { class: "sheet-head" },
        h("h2", { text: "Add to calendar" }),
        h("button", { class: "x-close", type: "button", "aria-label": "Close", onclick: close, text: "✕" })),
      h("p", { text: `${plan.title} — ${plan.when}` }),
      h("div", { class: "cal-links" },
        h("a", { href: plan.google, target: "_blank", rel: "noopener noreferrer", onclick: () => setTimeout(close, 200) },
          h("span", { class: "glyph", "aria-hidden": "true", text: "📅" }),
          h("span", {}, "Google Calendar", h("span", { class: "sub", text: "Opens the Google Calendar app on Android and iOS" }))),
        h("a", { href: plan.outlook, target: "_blank", rel: "noopener noreferrer", onclick: () => setTimeout(close, 200) },
          h("span", { class: "glyph", "aria-hidden": "true", text: "📨" }),
          h("span", {}, "Outlook", h("span", { class: "sub", text: "Opens Outlook calendar in the browser" }))),
        h("button", { type: "button", onclick: () => { copyPlan(plan); close(); } },
          h("span", { class: "glyph", "aria-hidden": "true", text: "📋" }),
          h("span", {}, "Copy the details", h("span", { class: "sub", text: "Paste into Apple Calendar or any other app" })))));
    back.append(sheet);
    document.body.append(back);
  }

  function copyPlan(plan) {
    const text = `${plan.title}\n${plan.when}\n${plan.details}`;
    const fallback = () => {
      const ta = h("textarea", { style: "position:fixed;top:-200px;left:0;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
      toast(ok ? "Copied — paste it into your calendar." : "Couldn't copy. Long-press the note text instead.");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast("Copied — paste it into your calendar."))
        .catch(fallback);
    } else fallback();
  }

  /* ---------------- mutations ---------------- */

  function patch(id, fields, opts) {
    const note = state.notes.get(id);
    if (!note) return;
    const touch = !opts || opts.touch !== false;
    const full = touch ? { ...fields, updatedAt: Date.now() } : { ...fields };
    Object.assign(note, full);
    store.patchNote(id, full);
    repaint(id);
  }

  function removeNote(id, quiet) {
    const note = state.notes.get(id);
    if (!note || note.kind === "calendar") return;
    const label = note.title || note.body || "this note";
    const written = note.body || note.title || (note.items || []).length || repliesOf(note).length;
    if (!quiet && written && !window.confirm(`Take “${String(label).slice(0, 60)}” off the fridge?`)) return;
    if (state.editing === id) {
      state.editing = null;
      state.drafts.delete(id);
      const back = document.querySelector(".sheet-back[data-for]");
      if (back) back.remove();
    }
    state.notes.delete(id);
    store.delNote(id);
    const el = els.get(id);
    if (el) { el.remove(); els.delete(id); }
    layout();
  }

  const itemsOf = (note) => (Array.isArray(note.items) ? note.items.map((i) => ({ ...i })) : []);

  function addItem(id, text) {
    const note = state.notes.get(id);
    if (!note) return;
    const items = itemsOf(note);
    items.push({ t: text.slice(0, 120), done: false });
    patch(id, { items, example: false });
    if (state.editing === id && isPhone()) reopenSheet(id);
    const host = document.querySelector(".sheet-back[data-for] .add-item")
      || (els.get(id) && els.get(id).querySelector(".add-item"));
    if (host) host.focus();
  }

  function toggleItem(id, i) {
    const note = state.notes.get(id);
    if (!note) return;
    const items = itemsOf(note);
    if (!items[i]) return;
    items[i].done = !items[i].done;
    patch(id, { items });
  }

  function removeItem(id, i) {
    const note = state.notes.get(id);
    if (!note) return;
    const items = itemsOf(note);
    items.splice(i, 1);
    patch(id, { items });
    if (state.editing === id && isPhone()) reopenSheet(id);
  }

  function startReply(id) {
    if (!meMember()) {
      if (store.account) { toast("Still opening the fridge — try again in a second."); return; }
      openRoster(() => startReply(id));
      return;
    }
    state.replying = id;
    state.expanded.add(id);
    repaint(id);
    const el = els.get(id);
    const input = el && el.querySelector(".reply-input");
    if (input) input.focus();
  }

  function addReply(id, text) {
    const note = state.notes.get(id);
    const me = meMember();
    if (!note || !me) return;
    const reply = {
      id: uid(), by: state.me, byName: me.name, byColor: me.color,
      text: text.slice(0, 400), at: Date.now(),
    };
    /* Drawn at once, then persisted. A reply is a conversation about the
       note, not an edit of it, so it leaves the note's own last-updated
       tag alone. */
    note.replies = [...repliesOf(note), reply].slice(-60);
    state.replying = id;
    store.addReply(id, reply);
    repaint(id);
    const el = els.get(id);
    const input = el && el.querySelector(".reply-input");
    if (input) input.focus();
  }

  function removeReply(id, replyId) {
    const note = state.notes.get(id);
    if (!note) return;
    note.replies = repliesOf(note).filter((r) => r.id !== replyId);
    store.delReply(id, replyId);
    repaint(id);
  }

  /* ---------------- the calendar sheet ---------------- */

  function onDay(iso) {
    const out = [];
    for (const [id, n] of state.notes) {
      if (n.date !== iso) continue;
      if (n.kind === "event") out.push({ id, n });
      else if (n.kind === "reminder" && !n.done) out.push({ id, n });
    }
    return out.sort((a, b) => String(a.n.time || "99").localeCompare(String(b.n.time || "99")));
  }

  function paintCalendar(el) {
    const [y, m] = state.cal.ym.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const startDow = first.getDay();
    const days = new Date(y, m, 0).getDate();
    const prevDays = new Date(y, m - 1, 0).getDate();

    const step = (delta) => {
      const d = new Date(y, m - 1 + delta, 1);
      state.cal.ym = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      repaintCalendar();
    };

    el.append(h("div", { class: "cal-top" },
      h("span", { class: "cal-month" }, MONTHS[m - 1], h("span", { text: String(y) })),
      h("div", { class: "cal-nav" },
        h("button", { type: "button", "aria-label": "Previous month", onclick: () => step(-1), text: "‹" }),
        h("button", { type: "button", "aria-label": "This month", title: "This month", onclick: () => { state.cal.ym = TODAY.slice(0, 7); state.cal.sel = TODAY; repaintCalendar(); }, text: "•" }),
        h("button", { type: "button", "aria-label": "Next month", onclick: () => step(1), text: "›" }))));

    /* On a phone the month grid is a third of the screen, so it folds
       away by default and the day's own list carries the view. */
    const showGrid = !isPhone() || state.calOpen;

    const cell = (dayNum, iso, pad) => {
      const items = pad ? [] : onDay(iso);
      const colors = [...new Set(items.map((i) => i.n.byColor || "#c0392f"))].slice(0, 3);
      return h("button", {
        class: ["cal-day", pad ? "pad" : "", iso === TODAY ? "today" : "", iso === state.cal.sel ? "sel" : ""].filter(Boolean).join(" "),
        type: "button",
        "aria-label": `${prettyDate(iso)}${items.length ? `, ${items.length} thing${items.length > 1 ? "s" : ""} on` : ""}`,
        onclick: (e) => { e.stopPropagation(); state.cal.sel = iso; state.cal.ym = iso.slice(0, 7); repaintCalendar(); },
      },
        h("span", { text: String(dayNum) }),
        colors.length ? h("span", { class: "pips", "aria-hidden": "true" },
          colors.map((c) => h("span", { class: "pip", style: `--c:${c}` }))) : null);
    };

    if (showGrid) {
      const grid = h("div", { class: "cal-grid" });
      for (const d of DOW) grid.append(h("span", { class: "cal-dow", text: d.slice(0, 1) }));
      for (let i = startDow - 1; i >= 0; i--) {
        const d = new Date(y, m - 2, prevDays - i);
        grid.append(cell(prevDays - i, isoOf(d), true));
      }
      for (let d = 1; d <= days; d++) grid.append(cell(d, `${y}-${pad2(m)}-${pad2(d)}`, false));
      const tail = (7 - ((startDow + days) % 7)) % 7;
      for (let d = 1; d <= tail; d++) grid.append(cell(d, isoOf(new Date(y, m, d)), true));
      el.append(grid);
    }

    if (isPhone()) {
      el.append(h("button", {
        class: "cal-fold", type: "button",
        "aria-expanded": showGrid ? "true" : "false",
        onclick: (e) => {
          e.stopPropagation();
          state.calOpen = !showGrid;
          try { localStorage.setItem("family-fridge/cal", state.calOpen ? "1" : "0"); } catch { /* blocked */ }
          repaintCalendar();
        },
        text: showGrid ? "Hide the month ▴" : "Show the whole month ▾",
      }));
    }

    const sel = state.cal.sel;
    const items = onDay(sel);
    const list = h("div", { class: "cal-day-list" },
      h("h4", { text: prettyDate(sel) }),
      items.length
        ? items.map(({ id, n }) => h("button", {
            class: "cal-item", type: "button", title: "Find this note on the door",
            onclick: (e) => { e.stopPropagation(); spotlight(id); },
          },
          h("b", { text: n.kind === "event" ? (prettyTime(n.time) || "All day") : "To do" }),
          h("span", { text: n.body || "(untitled)" })))
        : h("p", { class: "cal-none", text: "Nothing on this day." }));
    list.append(h("button", {
      class: "cal-add", type: "button",
      onclick: (e) => { e.stopPropagation(); addNote("event", { date: sel }); },
      text: "+ Appointment on " + prettyDate(sel),
    }));
    el.append(list);
  }

  function repaintCalendar() {
    for (const [id, n] of state.notes) if (n.kind === "calendar") repaint(id);
  }

  function spotlight(id) {
    const el = els.get(id);
    if (!el) return;
    const note = state.notes.get(id);
    raise(id);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rest = `rotate(${(note ? note.tilt || 0 : 0) * (isPhone() ? 0.35 : 1)}deg)`;
    el.animate(
      [{ transform: `${rest} scale(1)` }, { transform: "rotate(0deg) scale(1.06)" }, { transform: `${rest} scale(1)` }],
      { duration: 620, easing: "ease-in-out" });
  }

  /* ---------------- layout on the door ---------------- */

  function repaint(id) {
    const note = state.notes.get(id);
    const el = els.get(id);
    if (!note || !el) { layout(); return; }
    paintNote(el, id, note);
    place(el, note);
    stampsNow();
  }

  function reopenSheet(id) {
    const back = document.querySelector(".sheet-back[data-for]");
    if (!back) return;
    const sheet = back.querySelector(".sheet");
    const note = state.notes.get(id);
    if (!sheet || !note) return;
    const scroll = sheet.scrollTop;
    sheet.textContent = "";
    dressUp(sheet, note);
    paintEditor(sheet, id, note);
    sheet.scrollTop = scroll;
  }

  function place(el, note) {
    if (isPhone()) { el.style.left = el.style.top = ""; el.style.zIndex = ""; return; }
    const dw = baseW(), dh = baseH();
    const w = el.offsetWidth || (KINDS[note.kind] || KINDS.sticky).w;
    el.style.left = clamp((note.x || 0) * dw, 0, Math.max(0, dw - w)) + "px";
    el.style.top = clamp((note.y || 0) * dh, 0, Math.max(0, dh - 60)) + "px";
  }

  /* Stacking is a rank over "last touched", never a growing counter, so
     a note can never climb above the name plate or the magnet tray. */
  function restack() {
    if (isPhone()) return;
    [...state.notes.entries()]
      .sort((a, b) => (a[1].raised || a[1].createdAt || 0) - (b[1].raised || b[1].createdAt || 0))
      .forEach(([id], i) => {
        const el = els.get(id);
        if (el && id !== dragId) el.style.zIndex = String(i + 1);
      });
  }

  function raise(id) {
    const note = state.notes.get(id);
    if (!note) return;
    note.raised = Date.now();
    store.patchNote(id, { raised: note.raised });
    restack();
  }

  function layout() {
    const door = $("#door");
    const phone = isPhone();

    for (const id of [...els.keys()]) {
      if (!state.notes.has(id)) { els.get(id).remove(); els.delete(id); }
    }

    /* On the phone the door is a column, so the newest note belongs at
       the top where you can see it — under the calendar, which stays
       the anchor. On the wide door, order in the DOM does not matter. */
    const order = [...state.notes.entries()].sort((a, b) => {
      if (phone) {
        if (a[1].kind === "calendar") return -1;
        if (b[1].kind === "calendar") return 1;
        return (b[1].createdAt || 0) - (a[1].createdAt || 0);
      }
      return (a[1].createdAt || 0) - (b[1].createdAt || 0);
    });

    const active = document.activeElement;
    const typing = (el) => active && active !== el && el.contains(active);

    order.forEach(([id, note], i) => {
      let el = els.get(id);
      if (!el) {
        el = h("div", { class: "note", tabindex: "0", "data-id": id });
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("click", onNoteClick);
        el.addEventListener("keydown", onNoteKey);
        els.set(id, el);
        paintNote(el, id, note);
      } else if (id !== dragId && !(state.editing === id && !phone) && !typing(el)) {
        paintNote(el, id, note);
      }
      if (door.children[i] !== el) door.insertBefore(el, door.children[i] || null);
      if (id !== dragId) place(el, note);
    });

    restack();

    if (!phone) {
      let lowest = 0;
      for (const [, el] of els) lowest = Math.max(lowest, el.offsetTop + el.offsetHeight);
      door.style.minHeight = Math.max(baseH(), lowest + 56) + "px";
    } else {
      door.style.minHeight = "";
    }
    stampsNow();
  }

  /* Keep every "2h ago" honest without repainting the door. */
  function stampsNow() {
    document.querySelectorAll(".stamp[data-at]").forEach((el) => {
      const at = +el.dataset.at;
      if (!at) return;
      el.textContent = (el.dataset.prefix || "") + ago(at);
    });
  }

  /* ---------------- touch and drag ---------------- */

  function onNoteClick(e) {
    if (!isPhone()) return;                  // the wide door opens on pointerup
    if (e.target.closest("button, input, textarea, select, a, label, .pen")) return;
    const id = e.currentTarget.dataset.id;
    const note = state.notes.get(id);
    if (note && note.kind !== "calendar") openEditor(id);
  }

  function onPointerDown(e) {
    if (isPhone()) return;                   // let the page scroll
    const el = e.currentTarget;
    const id = el.dataset.id;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest("button, input, textarea, select, a, label, .pen")) return;
    if (state.editing === id) return;

    const note = state.notes.get(id);
    if (!note) return;

    const startX = e.clientX, startY = e.clientY;
    const from = { left: el.offsetLeft, top: el.offsetTop };
    let moved = false;

    el.style.zIndex = "999";
    el.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; dragId = id; el.classList.add("dragging"); }
      const dw = baseW(), dh = baseH();
      el.style.left = clamp(from.left + dx, 0, Math.max(0, dw - el.offsetWidth)) + "px";
      el.style.top = clamp(from.top + dy, 0, Math.max(0, dh - 40)) + "px";
    };

    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("dragging");
      dragId = null;
      if (!moved) {
        if (note.kind !== "calendar") openEditor(id);
        else raise(id);
        return;
      }
      const dw = baseW(), dh = baseH();
      note.x = clamp(el.offsetLeft / dw, 0, 1);
      note.y = clamp(el.offsetTop / dh, 0, 0.94);
      note.raised = Date.now();
      store.patchNote(id, { x: note.x, y: note.y, raised: note.raised });
      layout();
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function onNoteKey(e) {
    const id = e.currentTarget.dataset.id;
    const note = state.notes.get(id);
    if (!note) return;
    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && note.kind !== "calendar") {
      e.preventDefault();
      openEditor(id);
      return;
    }
    if (isPhone() || note.kind === "calendar") return;
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!nudge || state.editing === id || e.target !== e.currentTarget) return;
    e.preventDefault();
    const stepPx = e.shiftKey ? 40 : 12;
    note.x = clamp(note.x + (nudge[0] * stepPx) / baseW(), 0, 1);
    note.y = clamp(note.y + (nudge[1] * stepPx) / baseH(), 0, 0.94);
    place(e.currentTarget, note);
    clearTimeout(onNoteKey.t);
    onNoteKey.t = setTimeout(() => store.patchNote(id, { x: note.x, y: note.y }), 400);
  }

  /* ---------------- who's at the fridge ---------------- */

  let rosterThen = null;

  function openRoster(then) {
    rosterThen = then || null;
    closeEditor(true);
    const back = h("div", { class: "sheet-back", role: "dialog", "aria-modal": "true", "aria-label": "Who's at the fridge?" });
    back.dataset.roster = "1";
    back.addEventListener("pointerdown", (e) => { if (e.target === back) closeRoster(); });
    const sheet = h("div", { class: "sheet" });
    back.append(sheet);
    document.body.append(back);
    paintRoster(sheet);
  }

  function closeRoster() {
    const back = document.querySelector(".sheet-back[data-roster]");
    if (back) back.remove();
    rosterThen = null;
  }

  function paintRoster(sheet) {
    sheet.textContent = "";
    sheet.append(h("div", { class: "sheet-head" },
      h("h2", { text: "Who's at the fridge?" }),
      h("button", { class: "x-close", type: "button", "aria-label": "Close", onclick: closeRoster, text: "✕" })));
    sheet.append(h("p", { text: "Pick your name so the family knows who wrote what. Your magnet colour signs every note and reply you add." }));

    const people = [...state.roster.entries()].sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const roster = h("div", { class: "roster" });
    if (!people.length) {
      roster.append(h("p", { class: "cal-none", text: "Nobody yet. Add the first name below." }));
    }
    for (const [id, p] of people) {
      roster.append(h("div", { class: "roster-row" },
        h("button", {
          class: "pick", type: "button", "aria-pressed": state.me === id ? "true" : "false",
          onclick: () => pickMe(id),
        },
          h("span", { class: "dot", style: `--c:${p.color}`, "aria-hidden": "true", text: p.name.slice(0, 1).toUpperCase() }),
          h("span", { text: p.name }),
          state.me === id ? h("span", { class: "tag", text: "that's me" }) : null),
        h("button", {
          class: "rm", type: "button", "aria-label": "Remove " + p.name + " from the fridge",
          title: "Remove " + p.name,
          onclick: () => {
            if (!window.confirm(`Remove ${p.name}? Their notes stay on the fridge.`)) return;
            state.roster.delete(id);
            store.delMember(id);
            if (state.me === id) { state.me = null; localStorage.removeItem("family-fridge/me"); paintMe(); }
            paintRoster(sheet);
          },
        }, "✕")));
    }
    sheet.append(roster);

    sheet.append(h("form", { class: "new-person", onsubmit: (e) => { e.preventDefault(); addPerson(sheet); } },
      h("input", { id: "new-name", type: "text", placeholder: "Add a name", maxlength: "22", "aria-label": "New person's name", autocomplete: "off" }),
      h("button", { class: "btn", type: "submit", text: "Add" })));
    sheet.append(h("div", { class: "editor-foot" },
      h("span", { class: "hint", text: "Only the family can open this fridge." }),
      h("button", { class: "btn ghost", type: "button", onclick: closeRoster, text: "Done" })));
  }

  function addPerson(sheet) {
    const input = sheet.querySelector("#new-name");
    const name = input.value.trim().slice(0, 22);
    if (!name) return;
    const used = new Set([...state.roster.values()].map((p) => p.color));
    const color = MAGNET_COLORS.find((c) => !used.has(c)) || MAGNET_COLORS[state.roster.size % MAGNET_COLORS.length];
    const id = uid();
    const person = { name, color, createdAt: Date.now() };
    state.roster.set(id, person);
    store.setMember(id, person);
    input.value = "";
    pickMe(id);
  }

  function pickMe(id) {
    state.me = id;
    localStorage.setItem("family-fridge/me", id);
    paintMe();
    publishPresence();
    const then = rosterThen;
    closeRoster();
    if (then) then();
  }

  /* ---------------- your family (accounts mode) ---------------- */

  /* Stands in for the name picker once there are real accounts: who is
     in this family group, who has been invited, and which group's door
     you are looking at. */
  function openFamily() {
    closeEditor(true);
    const back = h("div", { class: "sheet-back", role: "dialog", "aria-modal": "true", "aria-label": "Your family" });
    back.dataset.family = "1";
    back.addEventListener("pointerdown", (e) => { if (e.target === back) back.remove(); });
    const sheet = h("div", { class: "sheet" });
    back.append(sheet);
    document.body.append(back);
    paintFamily(sheet);
  }

  const closeFamily = () => {
    const back = document.querySelector(".sheet-back[data-family]");
    if (back) back.remove();
  };

  async function paintFamily(sheet) {
    const home = state.household;
    const iOwn = home && home.role === "owner";

    sheet.textContent = "";
    sheet.append(h("div", { class: "sheet-head" },
      h("h2", { text: "Your family" }),
      h("button", { class: "x-close", type: "button", "aria-label": "Close", onclick: closeFamily, text: "✕" })));

    sheet.append(h("p", {}, "You are signed in as ",
      h("strong", { text: (state.account && state.account.displayName) || "someone" }),
      state.account && state.account.email ? ` (${state.account.email})` : "",
      ". Only people you invite can open this door."));

    /* --- who is here --- */
    const list = h("div", { class: "roster" });
    sheet.append(h("div", { class: "field-row" }, h("label", { text: (home && home.name) || "This group" }), list));
    list.append(h("p", { class: "cal-none", text: "Loading the family…" }));

    /* --- invite someone --- */
    const inviteNote = h("p", { class: "hint", style: "margin-top:6px" });
    const inviteForm = h("form", { class: "new-person", onsubmit: (e) => { e.preventDefault(); sendInvite(sheet, inviteNote); } },
      h("input", { id: "invite-email", type: "email", placeholder: "their@email.com", "aria-label": "Email address to invite", autocomplete: "off", required: true }),
      h("button", { class: "btn", type: "submit", text: "Invite" }));

    sheet.append(h("div", { class: "field-row" },
      h("label", { for: "invite-email", text: "Invite someone by email" }),
      inviteForm,
      h("label", { class: "check" },
        h("input", { type: "checkbox", id: "invite-any" }),
        h("span", { text: "Any address may use this link — needed if they sign in with Apple and hide their email" })),
      inviteNote));

    const pending = h("div", { class: "roster" });
    sheet.append(h("div", { class: "field-row", id: "pending-wrap" }, h("label", { text: "Invitations waiting" }), pending));

    /* --- other groups --- */
    if (state.households.length > 1) {
      const others = h("div", { class: "roster" });
      for (const hh of state.households) {
        others.append(h("div", { class: "roster-row" },
          h("button", {
            class: "pick", type: "button", "aria-pressed": home && hh.id === home.id ? "true" : "false",
            onclick: () => switchHousehold(hh.id),
          },
            h("span", { class: "dot", style: `--c:${hh.color}`, "aria-hidden": "true", text: hh.name.slice(0, 1).toUpperCase() }),
            h("span", { text: hh.name }),
            home && hh.id === home.id ? h("span", { class: "tag", text: "open" }) : null)));
      }
      sheet.append(h("div", { class: "field-row" }, h("label", { text: "Your other family groups" }), others));
    }

    sheet.append(h("div", { class: "editor-foot" },
      h("button", { class: "btn ghost", type: "button", onclick: () => { window.location.href = "/start"; }, text: "Start another group" }),
      h("button", { class: "btn ghost", type: "button", onclick: signOut, text: "Sign out" })));

    await Promise.all([paintMembers(list, iOwn), paintInvitations(pending)]);
  }

  async function paintMembers(list, iOwn) {
    const home = state.household;
    if (!home) return;
    let members = [];
    try {
      const response = await fetch(`/api/households/${home.id}/members`, { credentials: "same-origin" });
      if (response.ok) members = (await response.json()).members || [];
    } catch { /* offline; the list just stays empty */ }

    list.textContent = "";
    if (!members.length) {
      list.append(h("p", { class: "cal-none", text: "Could not load the family just now." }));
      return;
    }
    for (const m of members) {
      list.append(h("div", { class: "roster-row" },
        h("div", { class: "pick", style: "cursor:default" },
          h("span", { class: "dot", style: `--c:${m.color}`, "aria-hidden": "true", text: m.name.slice(0, 1).toUpperCase() }),
          h("span", { text: m.name }),
          h("span", { class: "tag", text: m.isMe ? "you" : m.role === "owner" ? "owner" : "" })),
        iOwn && !m.isMe
          ? h("button", {
              class: "rm", type: "button", "aria-label": `Remove ${m.name} from this group`, title: `Remove ${m.name}`,
              onclick: () => removeMember(m),
            }, "✕")
          : null));
    }
  }

  async function paintInvitations(box) {
    const home = state.household;
    box.textContent = "";
    if (!home) return;
    let invitations = [];
    try {
      const response = await fetch(`/api/households/${home.id}/invitations`, { credentials: "same-origin" });
      if (response.ok) invitations = (await response.json()).invitations || [];
    } catch { /* offline */ }

    const waiting = invitations.filter((i) => i.status === "pending");
    const wrap = document.getElementById("pending-wrap");
    if (wrap) wrap.hidden = waiting.length === 0;
    if (!waiting.length) return;

    for (const inv of waiting) {
      box.append(h("div", { class: "roster-row" },
        h("div", { class: "pick", style: "cursor:default" },
          h("span", { class: "dot", style: "--c:#9aa2ad", "aria-hidden": "true", text: "✉" }),
          h("span", {}, inv.email,
            h("span", { class: "sub", text: inv.anyEmail ? "any address may use the link" : "this address only" })),
          h("span", { class: "tag", text: "waiting" })),
        h("button", {
          class: "rm", type: "button", "aria-label": `Withdraw the invitation to ${inv.email}`, title: "Withdraw",
          onclick: async () => {
            if (!await store.request("DELETE", `/api/invitations/${inv.id}`)) return;
            toast(`Invitation to ${inv.email} withdrawn.`);
            paintInvitations(box);
          },
        }, "✕")));
    }
  }

  async function sendInvite(sheet, noteEl) {
    const input = sheet.querySelector("#invite-email");
    const anyEmail = sheet.querySelector("#invite-any").checked;
    const email = input.value.trim();
    if (!email || !state.household) return;

    noteEl.textContent = "Sending…";
    const result = await store.request("POST", `/api/households/${state.household.id}/invitations`, { email, anyEmail });
    if (!result) { noteEl.textContent = ""; return; }

    input.value = "";
    noteEl.textContent = result.message || `Invitation sent to ${email}.`;
    /* In development nothing is emailed, so the link has to be
       reachable from the screen. */
    if (result.link) {
      noteEl.append(h("br"), h("a", { href: result.link, class: "raw-link", text: result.link }));
    }
    const pending = document.querySelector("#pending-wrap .roster");
    if (pending) paintInvitations(pending);
  }

  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.name} from this group? Their notes stay on the door.`)) return;
    const home = state.household;
    if (!await store.request("DELETE", `/api/households/${home.id}/members/${member.id}`)) return;
    toast(`${member.name} was removed.`);
    const sheet = document.querySelector(".sheet-back[data-family] .sheet");
    if (sheet) paintFamily(sheet);
    store.refresh();
  }

  async function switchHousehold(id) {
    if (!await store.request("POST", `/api/households/${id}/select`)) return;
    window.location.reload();
  }

  async function signOut() {
    await store.request("POST", "/api/auth/signout");
    window.location.href = "/signin";
  }

  /* ---------------- wiring ---------------- */

  function applyNotes(obj) {
    const keep = state.editing;
    state.notes = new Map(Object.entries(obj || {}));
    state.notesLoaded = true;
    if (keep && !state.notes.has(keep)) {
      state.editing = null;
      state.drafts.delete(keep);
      const back = document.querySelector(".sheet-back[data-for]");
      if (back) back.remove();
    }
    layout();
  }

  function applyRoster(obj) {
    state.roster = new Map(Object.entries(obj || {}));
    /* With accounts, who you are is settled by the session, not by a
       pick that can go stale. */
    if (!store.account && state.me && !state.roster.has(state.me)) {
      state.me = null;
      localStorage.removeItem("family-fridge/me");
    }
    if (store.account) paintStatus();
    paintMe();
    const sheet = document.querySelector(".sheet-back[data-roster] .sheet");
    if (sheet) paintRoster(sheet);
  }

  function applyMeta(obj) {
    state.meta = { name: "The Family Fridge", ...(obj || {}) };
    if (store.account && state.household) state.household.name = state.meta.name;
    const input = $("#household-name");
    if (document.activeElement !== input) input.value = state.meta.name;
    fitName();
  }

  function subscribe() {
    store.onNotes(applyNotes);
    store.onRoster(applyRoster);
    store.onMeta(applyMeta);
    paintStatus();
  }

  function ensureCalendar() {
    if (!state.notesLoaded) return;
    for (const n of state.notes.values()) if (n.kind === "calendar") return;
    const note = { kind: "calendar", x: 0.6, y: 0.02, raised: 1, tilt: -1, createdAt: 1 };
    state.notes.set("calendar", note);
    store.setNote("calendar", note);
    layout();
  }

  /* The plate is only as wide as the name on it. */
  function fitName() {
    const input = $("#household-name");
    let rule = document.getElementById("name-measure");
    if (!rule) {
      rule = h("span", {
        id: "name-measure", "aria-hidden": "true",
        style: "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre",
      });
      document.body.append(rule);
    }
    const cs = getComputedStyle(input);
    for (const prop of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "textTransform"]) {
      rule.style[prop] = cs[prop];
    }
    rule.textContent = input.value || " ";
    input.style.width = Math.max(90, Math.ceil(rule.getBoundingClientRect().width) + 12) + "px";
  }

  async function start() {
    buildTray();
    fitName();
    const accounts = window.FRIDGE_MODE === "api";

    if (accounts) {
      store = apiStore();
      paintMe();
      paintStatus();
      subscribe();
      const ready = await store.open();
      if (!ready) return;                  // already redirecting to /signin or /start
      paintMe();
      paintStatus();
      ensureCalendar();
    } else {
      paintMe();
      paintStatus();
      // The local door renders at once, so the page is never an empty shell.
      const ex = exampleFridge();
      store.seed(ex.notes, ex.roster, ex.meta);
      subscribe();
      ensureCalendar();
    }

    $("#whoami").addEventListener("click", () => (accounts ? openFamily() : openRoster()));

    const nameInput = $("#household-name");
    const saveName = () => {
      const v = nameInput.value.trim().slice(0, 28) || "The Family Fridge";
      nameInput.value = v;
      fitName();
      if (v !== state.meta.name) { state.meta.name = v; store.patchMeta({ name: v }); }
    };
    if (accounts && state.household && state.household.role !== "owner") {
      nameInput.readOnly = true;
      nameInput.title = "Only the person who started this group can rename it.";
    }
    nameInput.addEventListener("input", fitName);
    nameInput.addEventListener("change", saveName);
    nameInput.addEventListener("blur", saveName);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); } });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const cal = document.querySelector('.sheet-back[aria-label="Add to calendar"]');
      if (cal) { cal.remove(); return; }
      if (document.querySelector(".sheet-back[data-family]")) { closeFamily(); return; }
      if (document.querySelector(".sheet-back[data-roster]")) { closeRoster(); return; }
      if (state.editing) { closeEditor(true); return; }
      if (state.replying) { const was = state.replying; state.replying = null; repaint(was); }
    });

    document.addEventListener("pointerdown", (e) => {
      if (state.editing && !isPhone() && !e.target.closest(".note.editing, .sheet-back, .tray")) closeEditor(true);
      if (state.replying && !e.target.closest(".reply-form, .say, .sheet-back")) {
        const was = state.replying;
        state.replying = null;
        repaint(was);
      }
    });

    let t;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (state.editing) closeEditor(true);      // the editor host changes across the breakpoint
        layout();
      }, 140);
    });

    setInterval(stampsNow, 60000);

    /* Shared storage, if this view can have it and has no server. */
    if (!accounts && window.claude && typeof window.claude.use === "function") {
      window.claude.use("db").then((db) => {
        if (!db) return;
        store = dbStore(db);
        state.notesLoaded = false;
        state.notes = new Map();
        state.roster = new Map();
        els.forEach((el) => el.remove());
        els.clear();
        subscribe();
        setTimeout(ensureCalendar, 1200);   // only if the shared door really is bare
      }).catch(() => {});

    }

    if (!accounts && window.claude && typeof window.claude.use === "function") {
      window.claude.use("room").then((r) => {
        if (!r) return;
        room = r;
        r.onPeers((change) => { state.peers = change.peers; paintHere(); }, () => {});
        publishPresence();
      }).catch(() => {});
    }
  }

  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === "function") {
    hot.snapshot(() => ({ cal: state.cal }));
  }
  const boot = (carried) => {
    if (carried && carried.cal) state.cal = carried.cal;
    start().catch((e) => console.error("fridge boot:", e));
  };
  if (hot && typeof hot.ready === "function") hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
