/* ============================================================
   The Family Fridge
   A shared refrigerator door: notes, reminders, appointments,
   announcements, lists and memories, each held on by a magnet.

   Storage has two backs ends behind one interface:
     - the artifact `db` capability, so the whole family sees the
       same door, live;
     - localStorage, so the page still works on its own.
   All note text is written with textContent — never innerHTML —
   because shared data is untrusted.
   ============================================================ */

(() => {
  "use strict";

  /* ---------------- vocabulary ---------------- */

  const PAPERS = ["canary", "rose", "mint", "sky", "peach", "lilac"];
  const PAPER_HEX = {
    canary: "#fdf0a4", rose: "#ffc2d4", mint: "#bff0d7",
    sky: "#b8dcf8", peach: "#ffd4a9", lilac: "#dcccf6",
  };

  const MAGNET_COLORS = [
    "#c0392f", "#2f6fa8", "#3f8f5a", "#dd9022",
    "#7a52a8", "#1f8f92", "#d4568c", "#5c6675",
  ];

  const KINDS = {
    sticky:   { label: "Note",         glyph: "📝", tray: "#fdf0a4", fast: "magnet", w: 212 },
    reminder: { label: "Reminder",     glyph: "⏰", tray: "#ff9a8f", fast: "magnet", w: 212 },
    event:    { label: "Appointment", short: "Date", glyph: "📅", tray: "#b8dcf8", fast: "clip", w: 212 },
    announce: { label: "Announcement", short: "Notice", glyph: "📣", tray: "#ffd4a9", fast: "tape", w: 250 },
    list:     { label: "List",     glyph: "🛒", tray: "#bff0d7", fast: "magnet", w: 212 },
    memory:   { label: "Memory",   glyph: "📷", tray: "#dcccf6", fast: "tape",   w: 190 },
    calendar: { label: "Calendar", glyph: "🗓", tray: "#ffffff", fast: "magnet", w: 312 },
  };

  const STICKERS = ["🎂", "🏆", "🎄", "🏖", "⚽", "🐶", "🎸", "🍕", "🎓", "❤️", "🎉", "🚗"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

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
      else if (k === "style") node.setAttribute("style", v);
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
    cal: { ym: TODAY.slice(0, 7), sel: TODAY },
    peers: [],
  };

  const els = new Map();          // note id -> element
  let dragId = null;

  const meMember = () => (state.me ? state.roster.get(state.me) : null) || null;

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
      onMeta(fn)   {
        db.doc("fridge/door").onSnapshot((s) => fn(s.exists ? thaw(s.data()) : {}), shout);
      },
      setNote(id, v)   { db.doc("notes/" + id).set(v).catch(shout); },
      patchNote(id, v) { db.doc("notes/" + id).update(v).catch(shout); },
      delNote(id)      { db.doc("notes/" + id).delete().catch(shout); },
      setMember(id, v) { db.doc("roster/" + id).set(v).catch(shout); },
      delMember(id)    { db.doc("roster/" + id).delete().catch(shout); },
      patchMeta(v)     { db.doc("fridge/door").set({ ...state.meta, ...v }).catch(shout); },
      seed()           { return false; },
    };
  }

  let store = localStore();
  let room = null;

  /* ---------------- the example fridge (offline only) ---------------- */

  /* Only ever used when this device has no fridge of its own and the
     shared store is unavailable, so the door is never an empty shell. */
  function exampleFridge() {
    const soon = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
    const people = {
      ex1: { name: "Sam",  color: MAGNET_COLORS[0], createdAt: 1 },
      ex2: { name: "Nadia", color: MAGNET_COLORS[1], createdAt: 2 },
      ex3: { name: "Theo", color: MAGNET_COLORS[2], createdAt: 3 },
    };
    const by = (k) => ({ by: k, byName: people[k].name, byColor: people[k].color });
    const notes = {
      calendar: { kind: "calendar", x: 0.63, y: 0.02, raised: 1, tilt: -1, createdAt: 1 },
      ex_a: { kind: "sticky", body: "Bin day moved to Thursday this week!", paper: "canary",
              x: 0.03, y: 0.03, raised: 3, tilt: -3, ...by("ex2"), createdAt: 2, example: true },
      ex_b: { kind: "list", title: "Groceries", x: 0.03, y: 0.33, raised: 4, tilt: 2,
              items: [{ t: "Oat milk", done: false }, { t: "Bread", done: true },
                      { t: "Lemons", done: false }, { t: "Dog food", done: false }],
              ...by("ex1"), createdAt: 3, example: true },
      ex_c: { kind: "reminder", body: "Theo — hand in the permission slip", date: soon(1),
              done: false, x: 0.21, y: 0.05, raised: 5, tilt: 2, ...by("ex1"), createdAt: 4, example: true },
      ex_d: { kind: "event", body: "Grandma's birthday lunch", date: soon(5), time: "12:30",
              x: 0.21, y: 0.36, raised: 6, tilt: -2, ...by("ex2"), createdAt: 5, example: true },
      ex_e: { kind: "announce", body: "Nobody touch the cake", x: 0.43, y: 0.44, raised: 7, tilt: 1.5,
              ...by("ex3"), createdAt: 6, example: true },
      ex_f: { kind: "memory", body: "Beach, last August", sticker: "🏖", paper: "sky",
              x: 0.05, y: 0.68, raised: 8, tilt: -4, ...by("ex3"), createdAt: 7, example: true },
      ex_g: { kind: "event", body: "Swim club pickup", date: soon(0), time: "17:00",
              x: 0.42, y: 0.04, raised: 9, tilt: -1.5, ...by("ex3"), createdAt: 8, example: true },
    };
    return { notes, roster: people, meta: { name: "The Family Fridge" } };
  }

  /* ---------------- status chrome ---------------- */

  function paintStatus() {
    const s = $("#status");
    s.dataset.live = state.shared ? "1" : "0";
    s.textContent = state.shared ? "Shared with the family" : "Saved on this device";
    s.title = state.shared
      ? "Everyone with the link sees this door, and changes show up live."
      : "This door lives in this browser only. Nobody else can see it.";
  }

  /* The plate is only as wide as the name on it. */
  function fitName() {
    const input = $("#household-name");
    input.style.width = Math.max(8, input.value.length + 1) + "ch";
  }

  function paintMe() {
    const me = meMember();
    const dot = $("#me-dot"), name = $("#me-name");
    if (me) {
      dot.style.setProperty("--c", me.color);
      dot.textContent = me.name.slice(0, 1).toUpperCase();
      name.textContent = me.name;
      $("#whoami").title = "Change who's at the fridge";
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
      const who = String(p.presence && p.presence.who || "").slice(0, 24);
      const color = /^#[0-9a-f]{6}$/i.test(String(p.presence && p.presence.color || ""))
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
    room.presence({ who: me ? me.name : "Someone", color: me ? me.color : "#9aa2ad" })
      .catch(() => {});
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
    if (!me && !extra) { openRoster(() => addNote(kind, extra)); return; }
    const id = uid();
    const spot = freeSpot(kind);
    const note = {
      kind,
      body: "",
      paper: kind === "sticky" ? PAPERS[Math.floor(Math.random() * PAPERS.length)]
        : kind === "memory" ? "sky" : "white",
      tilt: Math.round((Math.random() * 6 - 3) * 10) / 10,
      x: spot.x, y: spot.y, raised: Date.now(),
      by: me ? state.me : null,
      byName: me ? me.name : "",
      byColor: me ? me.color : "#9aa2ad",
      createdAt: Date.now(),
      ...(kind === "list" ? { title: "List", items: [] } : null),
      ...(kind === "reminder" ? { date: "", done: false } : null),
      ...(kind === "event" ? { date: TODAY, time: "" } : null),
      ...(kind === "memory" ? { sticker: STICKERS[Math.floor(Math.random() * STICKERS.length)] } : null),
      ...extra,
    };
    state.notes.set(id, note);
    store.setNote(id, note);
    state.editing = id;
    layout();
    const el = els.get(id);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const pen = el.querySelector(".pen");
      if (pen) pen.focus();
    }
  }

  /* ---------------- painting one note ---------------- */

  function noteTools(id, note) {
    const kids = [];
    if (state.editing !== id && note.kind !== "calendar") {
      kids.push(h("button", {
        type: "button", title: "Edit this note", "aria-label": "Edit this note",
        onclick: (e) => { e.stopPropagation(); openEditor(id); }, text: "✎",
      }));
    }
    if (note.kind !== "calendar") {
      kids.push(h("button", {
        type: "button", title: "Take this off the fridge", "aria-label": "Take this off the fridge",
        onclick: (e) => { e.stopPropagation(); removeNote(id); }, text: "✕",
      }));
    }
    return kids.length ? h("div", { class: "n-tools" }, kids) : null;
  }

  function signature(note) {
    if (!note.byName) return null;
    return h("div", { class: "n-sign" },
      h("span", { class: "who", text: "— " + note.byName }),
      note.example ? h("span", { text: "example", title: "A starter note — delete it any time" }) : null);
  }

  function dueChip(note) {
    if (!note.date) return null;
    return h("span", { class: "when " + urgency(note.date) },
      h("span", { text: prettyDate(note.date) }),
      note.time ? h("span", { text: prettyTime(note.time) }) : null);
  }

  function paintNote(el, id, note) {
    const kind = KINDS[note.kind] ? note.kind : "sticky";
    el.dataset.kind = kind;
    el.dataset.fast = KINDS[kind].fast;
    el.style.setProperty("--tilt", (note.tilt || 0) + "deg");
    el.style.setProperty("--paper", PAPER_HEX[note.paper] || "#ffffff");
    el.style.setProperty("--c", note.byColor || "#c0392f");
    el.classList.toggle("done", !!note.done);
    el.classList.toggle("editing", state.editing === id);
    el.textContent = "";

    if (state.editing === id) { paintEditor(el, id, note); return; }

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
        h("div", {},
          h("p", { class: "n-body", text: note.body || "" }),
          note.date ? h("div", { style: "margin-top:5px" }, dueChip(note)) : null)));
      el.append(signature(note) || "");
      return;
    }

    if (kind === "event") {
      el.append(h("p", { class: "e-date", text: [prettyDate(note.date), prettyTime(note.time)].filter(Boolean).join(" · ") || "No date yet" }));
      el.append(h("p", { class: "n-body", text: note.body || "" }));
      el.append(signature(note) || "");
      return;
    }

    if (kind === "announce") {
      el.append(h("span", { class: "n-kind", text: "Announcement" }));

      el.append(h("p", { class: "n-body", text: note.body || "" }));
      el.append(signature(note) || "");
      return;
    }

    if (kind === "list") {
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
        class: "add-item", type: "text", placeholder: "Add an item…",
        "aria-label": "Add an item to " + (note.title || "the list"),
        onkeydown: (e) => {
          if (e.key !== "Enter") return;
          const v = e.currentTarget.value.trim();
          if (!v) return;
          e.currentTarget.value = "";
          addItem(id, v);
        },
        onpointerdown: (e) => e.stopPropagation(),
      }));
      el.append(signature(note) || "");
      return;
    }

    if (kind === "memory") {
      el.append(h("div", { class: "frame", style: `--shade:${PAPER_HEX[note.paper] || "#b8dcf8"}`, "aria-hidden": "true", text: note.sticker || "📷" }));
      el.append(h("p", { class: "n-body", text: note.body || "" }));
      el.append(signature(note) || "");
      return;
    }

    el.append(h("p", { class: "n-body", text: note.body || "" }));
    el.append(signature(note) || "");
  }

  /* ---------------- editing ---------------- */

  function paintEditor(el, id, note) {
    const kind = note.kind;
    const draft = state.drafts.get(id) || {};
    const set = (k, v) => { state.drafts.set(id, { ...(state.drafts.get(id) || {}), [k]: v }); };

    el.append(h("div", { class: "n-tools" },
      h("button", {
        type: "button", title: "Take this off the fridge", "aria-label": "Take this off the fridge",
        onclick: (e) => { e.stopPropagation(); removeNote(id); }, text: "✕",
      })));

    el.append(h("span", { class: "n-kind", text: KINDS[kind].label }));

    if (kind === "list") {
      el.append(h("input", {
        class: "pen", style: "min-height:0;font-weight:600", type: "text", id: "pen-" + id,
        value: draft.title !== undefined ? draft.title : (note.title || ""),
        placeholder: "What list is this?", "aria-label": "List name",
        oninput: (e) => set("title", e.currentTarget.value),
      }));
    } else if (kind === "memory") {
      el.append(h("div", { class: "frame", style: `--shade:${PAPER_HEX[draft.paper || note.paper] || "#b8dcf8"}`, "aria-hidden": "true", text: draft.sticker || note.sticker || "📷" }));
      el.append(h("textarea", {
        class: "pen", id: "pen-" + id, style: "min-height:2.6em;margin-top:8px",
        placeholder: "What was this?", "aria-label": "Caption",
        oninput: (e) => set("body", e.currentTarget.value),
      }, draft.body !== undefined ? draft.body : (note.body || "")));
      el.append(h("div", { class: "stickers" }, STICKERS.map((s) =>
        h("button", {
          type: "button", "aria-label": "Use " + s, text: s,
          "aria-pressed": (draft.sticker || note.sticker) === s ? "true" : "false",
          onclick: () => { set("sticker", s); repaint(id); },
        }))));
    } else {
      el.append(h("textarea", {
        class: "pen", id: "pen-" + id,
        placeholder: kind === "announce" ? "What does everyone need to know?"
          : kind === "reminder" ? "What needs doing?"
          : kind === "event" ? "What's happening?"
          : "Write something…",
        "aria-label": KINDS[kind].label + " text",
        oninput: (e) => set("body", e.currentTarget.value),
      }, draft.body !== undefined ? draft.body : (note.body || "")));
    }

    if (kind === "reminder" || kind === "event") {
      const fields = h("div", { class: "fields" },
        h("input", {
          type: "date", "aria-label": kind === "event" ? "Date" : "Due date",
          value: draft.date !== undefined ? draft.date : (note.date || ""),
          oninput: (e) => set("date", e.currentTarget.value),
        }));
      if (kind === "event") {
        fields.append(h("input", {
          type: "time", "aria-label": "Time",
          value: draft.time !== undefined ? draft.time : (note.time || ""),
          oninput: (e) => set("time", e.currentTarget.value),
        }));
      }
      el.append(fields);
    }

    if (kind === "sticky" || kind === "memory") {
      el.append(h("div", { class: "swatches", role: "group", "aria-label": "Paper colour" },
        PAPERS.map((p) => h("button", {
          class: "swatch", type: "button", style: `--s:${PAPER_HEX[p]}`,
          "aria-label": p + " paper", title: p,
          "aria-pressed": (draft.paper || note.paper) === p ? "true" : "false",
          onclick: () => { set("paper", p); repaint(id); },
        }))));
    }

    if (kind === "list") {
      const items = Array.isArray(note.items) ? note.items : [];
      el.append(h("ul", { class: "items" }, items.map((item, i) =>
        h("li", { class: item.done ? "off" : "" },
          h("span", { class: "txt", text: item.t }),
          h("button", {
            class: "rm", type: "button", "aria-label": "Remove " + item.t,
            onclick: () => removeItem(id, i), text: "✕",
          })))));
      el.append(h("input", {
        class: "add-item", type: "text", placeholder: "Add an item…", "aria-label": "Add an item",
        onkeydown: (e) => {
          if (e.key !== "Enter") return;
          const v = e.currentTarget.value.trim();
          if (!v) return;
          e.currentTarget.value = "";
          addItem(id, v);
        },
      }));
    }

    el.append(h("div", { class: "editor-foot" },
      h("span", { class: "hint", text: "Esc to close" }),
      h("button", { class: "btn", type: "button", onclick: () => closeEditor(true), text: "Stick it up" })));
  }

  function openEditor(id) {
    if (state.editing && state.editing !== id) closeEditor(true);
    state.editing = id;
    state.drafts.delete(id);
    raise(id);
    repaint(id);
    const el = els.get(id);
    const pen = el && el.querySelector(".pen");
    if (pen) { pen.focus(); if (pen.setSelectionRange) pen.setSelectionRange(pen.value.length, pen.value.length); }
  }

  function closeEditor(save) {
    const id = state.editing;
    if (!id) return;
    state.editing = null;
    const draft = state.drafts.get(id);
    state.drafts.delete(id);
    const note = state.notes.get(id);
    if (save && draft && note && Object.keys(draft).length) {
      Object.assign(note, draft, { updatedAt: Date.now(), example: false });
      store.patchNote(id, { ...draft, updatedAt: note.updatedAt, example: false });
    }
    if (note && !note.body && !note.title && !(note.items || []).length && note.kind !== "calendar") {
      removeNote(id, true);
      return;
    }
    repaint(id);
  }

  /* ---------------- mutations ---------------- */

  function patch(id, fields) {
    const note = state.notes.get(id);
    if (!note) return;
    Object.assign(note, fields, { updatedAt: Date.now() });
    store.patchNote(id, { ...fields, updatedAt: note.updatedAt });
    repaint(id);
  }

  function removeNote(id, quiet) {
    const note = state.notes.get(id);
    if (!note || note.kind === "calendar") return;
    const label = note.title || note.body || "this note";
    if (!quiet && (note.body || note.title || (note.items || []).length)) {
      const ok = window.confirm(`Take “${String(label).slice(0, 60)}” off the fridge?`);
      if (!ok) return;
    }
    if (state.editing === id) { state.editing = null; state.drafts.delete(id); }
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
    const el = els.get(id);
    const input = el && el.querySelector(".add-item");
    if (input) input.focus();
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
        h("button", { type: "button", "aria-label": "This month", title: "This month", onclick: () => { state.cal.ym = TODAY.slice(0, 7); repaintCalendar(); }, text: "•" }),
        h("button", { type: "button", "aria-label": "Next month", onclick: () => step(1), text: "›" }))));

    const grid = h("div", { class: "cal-grid" });
    for (const d of DOW) grid.append(h("span", { class: "cal-dow", text: d.slice(0, 1) }));

    const cell = (dayNum, iso, pad) => {
      const items = pad ? [] : onDay(iso);
      const colors = [...new Set(items.map((i) => i.n.byColor || "#c0392f"))].slice(0, 3);
      return h("button", {
        class: ["cal-day", pad ? "pad" : "", iso === TODAY ? "today" : "", iso === state.cal.sel ? "sel" : ""].filter(Boolean).join(" "),
        type: "button",
        "aria-label": `${prettyDate(iso)}${items.length ? `, ${items.length} thing${items.length > 1 ? "s" : ""} on` : ""}`,
        onclick: () => { state.cal.sel = iso; state.cal.ym = iso.slice(0, 7); repaintCalendar(); },
      },
        h("span", { text: String(dayNum) }),
        colors.length ? h("span", { class: "pips", "aria-hidden": "true" },
          colors.map((c) => h("span", { class: "pip", style: `--c:${c}` }))) : null);
    };

    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(y, m - 2, prevDays - i);
      grid.append(cell(prevDays - i, isoOf(d), true));
    }
    for (let d = 1; d <= days; d++) grid.append(cell(d, `${y}-${pad2(m)}-${pad2(d)}`, false));
    const tail = (7 - ((startDow + days) % 7)) % 7;
    for (let d = 1; d <= tail; d++) grid.append(cell(d, isoOf(new Date(y, m, d)), true));
    el.append(grid);

    const sel = state.cal.sel;
    const items = onDay(sel);
    const list = h("div", { class: "cal-day-list" },
      h("h4", { text: prettyDate(sel) }),
      items.length
        ? items.map(({ id, n }) => h("button", {
            class: "cal-item", type: "button", title: "Find this note on the door",
            onclick: () => spotlight(id),
          },
          h("b", { text: n.kind === "event" ? (prettyTime(n.time) || "All day") : "To do" }),
          h("span", { text: n.body || "(untitled)" })))
        : h("p", { class: "cal-none", text: "Nothing on this day." }));
    list.append(h("button", {
      class: "cal-add", type: "button",
      onclick: () => addNote("event", { date: sel }),
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
    el.animate(
      [{ transform: `rotate(${note ? note.tilt || 0 : 0}deg) scale(1)` },
       { transform: `rotate(0deg) scale(1.08)` },
       { transform: `rotate(${note ? note.tilt || 0 : 0}deg) scale(1)` }],
      { duration: 620, easing: "ease-in-out" });
  }

  /* ---------------- layout on the door ---------------- */

  function repaint(id) {
    const note = state.notes.get(id);
    const el = els.get(id);
    if (!note || !el) { layout(); return; }
    paintNote(el, id, note);
    place(el, note);
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

    for (const id of [...els.keys()]) {
      if (!state.notes.has(id)) { els.get(id).remove(); els.delete(id); }
    }

    const order = [...state.notes.entries()].sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    for (const [id, note] of order) {
      let el = els.get(id);
      if (!el) {
        el = h("div", { class: "note", tabindex: "0", "data-id": id });
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("keydown", onNoteKey);
        els.set(id, el);
        door.append(el);
        paintNote(el, id, note);
      } else if (id !== dragId && state.editing !== id) {
        paintNote(el, id, note);
      }
      if (id !== dragId) place(el, note);
    }

    restack();

    // Let the door grow so a low note stays reachable.
    if (!isPhone()) {
      let lowest = 0;
      for (const [, el] of els) lowest = Math.max(lowest, el.offsetTop + el.offsetHeight);
      door.style.minHeight = Math.max(baseH(), lowest + 56) + "px";
    } else {
      door.style.minHeight = "";
    }
  }

  /* ---------------- dragging ---------------- */

  function onPointerDown(e) {
    const el = e.currentTarget;
    const id = el.dataset.id;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest("button, input, textarea, select, a, .pen")) return;
    if (state.editing === id) return;
    if (isPhone()) {
      const note = state.notes.get(id);
      if (note && note.kind !== "calendar") openEditor(id);
      return;
    }

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
    back.addEventListener("pointerdown", (e) => { if (e.target === back) closeRoster(); });
    const sheet = h("div", { class: "sheet" });
    back.append(sheet);
    document.body.append(back);
    paintRoster(sheet);
    const input = sheet.querySelector("#new-name");
    if (input) input.focus();
  }

  function closeRoster() {
    const back = $(".sheet-back");
    if (back) back.remove();
    rosterThen = null;
  }

  function paintRoster(sheet) {
    sheet.textContent = "";
    sheet.append(h("h2", { text: "Who's at the fridge?" }));
    sheet.append(h("p", { text: "Pick your name so the family knows who wrote what. Your magnet colour signs every note you stick up." }));

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

    const form = h("form", { class: "new-person", onsubmit: (e) => { e.preventDefault(); addPerson(sheet); } },
      h("input", { id: "new-name", type: "text", placeholder: "Add a name", maxlength: "22", "aria-label": "New person's name", autocomplete: "off" }),
      h("button", { class: "btn", type: "submit", text: "Add" }));
    sheet.append(form);
    sheet.append(h("div", { class: "editor-foot" },
      h("span", { class: "hint", text: "Only the family can open this fridge." }),
      h("button", { class: "btn", type: "button", style: "background:transparent;color:var(--ink-soft);box-shadow:inset 0 0 0 1px var(--ink-faint)", onclick: closeRoster, text: "Done" })));
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
    pickMe(id, sheet);
  }

  function pickMe(id, sheet) {
    state.me = id;
    localStorage.setItem("family-fridge/me", id);
    paintMe();
    publishPresence();
    if (sheet) paintRoster(sheet);
    const then = rosterThen;
    closeRoster();
    if (then) then();
  }

  /* ---------------- wiring ---------------- */

  function applyNotes(obj) {
    const keep = state.editing;
    state.notes = new Map(Object.entries(obj || {}));
    state.notesLoaded = true;
    if (keep && !state.notes.has(keep)) { state.editing = null; state.drafts.delete(keep); }
    layout();
  }

  function applyRoster(obj) {
    state.roster = new Map(Object.entries(obj || {}));
    if (state.me && !state.roster.has(state.me)) {
      state.me = null;
      localStorage.removeItem("family-fridge/me");
    }
    paintMe();
    const sheet = $(".sheet");
    if (sheet) paintRoster(sheet);
    layout();
  }

  function applyMeta(obj) {
    state.meta = { name: "The Family Fridge", ...(obj || {}) };
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

  function start() {
    buildTray();
    fitName();
    paintMe();
    paintStatus();

    // The local door renders at once, so the page is never an empty shell.
    const ex = exampleFridge();
    store.seed(ex.notes, ex.roster, ex.meta);
    subscribe();
    ensureCalendar();

    $("#whoami").addEventListener("click", () => openRoster());

    const nameInput = $("#household-name");
    const saveName = () => {
      const v = nameInput.value.trim().slice(0, 28) || "The Family Fridge";
      nameInput.value = v;
      fitName();
      if (v !== state.meta.name) { state.meta.name = v; store.patchMeta({ name: v }); }
    };
    nameInput.addEventListener("input", fitName);
    nameInput.addEventListener("change", saveName);
    nameInput.addEventListener("blur", saveName);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); } });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if ($(".sheet-back")) { closeRoster(); return; }
      if (state.editing) closeEditor(true);
    });

    document.addEventListener("pointerdown", (e) => {
      if (!state.editing) return;
      if (e.target.closest(".note.editing, .sheet-back, .tray")) return;
      closeEditor(true);
    });

    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(layout, 120); });

    /* Shared storage, if this view can have it. */
    if (window.claude && typeof window.claude.use === "function") {
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
    hot.snapshot(() => ({ cal: state.cal, editing: state.editing }));
  }
  const boot = (carried) => {
    if (carried && carried.cal) state.cal = carried.cal;
    start();
  };
  if (hot && typeof hot.ready === "function") hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
