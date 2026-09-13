/* Where you land with an account but no family group yet: make one, or
   open one you already belong to. */

import { api, busy, say, whoami } from "./common.js";

const form = document.getElementById("form");
const notice = document.getElementById("notice");
const groups = document.getElementById("groups");
const existing = document.getElementById("existing");

const me = await whoami();
if (!me.signedIn) location.href = "/signin";

document.getElementById("who-name").textContent = me.user
  ? `${me.user.displayName}${me.user.email ? ` · ${me.user.email}` : ""}`
  : "Signed in";
const dot = document.getElementById("who-dot");
dot.style.setProperty("--c", "#5c6675");
dot.textContent = (me.user ? me.user.displayName : "?").slice(0, 1).toUpperCase();

if ((me.households || []).length) {
  existing.hidden = false;
  for (const home of me.households) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "group-open";

    const bullet = document.createElement("span");
    bullet.className = "dot";
    bullet.setAttribute("aria-hidden", "true");
    bullet.style.setProperty("--c", home.color);
    bullet.textContent = home.name.slice(0, 1).toUpperCase();

    const label = document.createElement("span");
    label.textContent = home.name;
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = home.role === "owner" ? "you started this one" : "you were invited";
    label.append(sub);

    open.append(bullet, label);
    open.addEventListener("click", async () => {
      try {
        await api("POST", `/api/households/${home.id}/select`);
        location.href = "/";
      } catch (error) {
        say(notice, error.message);
      }
    });
    groups.append(open);
  }
}

document.getElementById("signout").addEventListener("click", async () => {
  try { await api("POST", "/api/auth/signout"); } catch { /* going anyway */ }
  location.href = "/signin";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  say(notice, "");
  busy(form, true, "Creating…");
  try {
    await api("POST", "/api/households", { name: document.getElementById("name").value.trim() });
    location.href = "/";
  } catch (error) {
    say(notice, error.message);
    busy(form, false);
  }
});
