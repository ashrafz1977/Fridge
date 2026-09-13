/* Redeeming an invitation. The token is in the path, never a query
   string, so it does not end up in a server access log.

   The page works in two shapes: signed in, it is one button; signed
   out, it is the three ways in, each carrying the token so that
   creating an account and joining the group is a single step. */

import { api, busy, say, whoami } from "./common.js";

const token = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
const heading = document.getElementById("heading");
const lede = document.getElementById("lede");
const notice = document.getElementById("notice");
const acceptBox = document.getElementById("accept");
const gateBox = document.getElementById("gate");
const foot = document.getElementById("foot");

function dead(message) {
  heading.textContent = "This invitation cannot be used";
  lede.textContent = "";
  say(notice, message);
  acceptBox.hidden = true;
  gateBox.hidden = true;
  const back = document.createElement("a");
  back.className = "btn ghost wide";
  back.href = "/signin";
  back.textContent = "Go to the fridge";
  back.style.display = "block";
  back.style.textAlign = "center";
  back.style.textDecoration = "none";
  notice.after(back);
}

let invitation;
try {
  invitation = await api("GET", `/api/invitations/preview?token=${encodeURIComponent(token)}`);
} catch (error) {
  dead(error.message);
}

if (invitation) {
  const who = invitation.invitedBy || "Someone";
  heading.textContent = `${who} added you to the ${invitation.householdName} fridge`;
  lede.textContent = "It is a shared fridge door: notes, reminders, appointments, announcements, "
    + "shopping lists and photos, in one place, for your family only.";
  foot.textContent = invitation.emailLocked
    ? `This invitation is for ${invitation.invitedEmail}. Sign in with that address.`
    : "Any address can use this invitation.";

  const me = await whoami();

  if (me.signedIn) {
    acceptBox.hidden = false;
    document.getElementById("who-name").textContent = me.user.email
      ? `${me.user.displayName} · ${me.user.email}`
      : me.user.displayName;
    const dot = document.getElementById("who-dot");
    dot.style.setProperty("--c", "#5c6675");
    dot.textContent = me.user.displayName.slice(0, 1).toUpperCase();

    document.getElementById("join").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Joining…";
      say(notice, "");
      try {
        const result = await api("POST", "/api/invitations/accept", { token });
        button.textContent = `Welcome to ${result.household.name}`;
        location.href = "/";
      } catch (error) {
        say(notice, error.message);
        button.disabled = false;
        button.textContent = "Join the fridge";
      }
    });

    document.getElementById("signout").addEventListener("click", async () => {
      try { await api("POST", "/api/auth/signout"); } catch { /* going anyway */ }
      location.reload();
    });
  } else {
    gateBox.hidden = false;
    for (const id of ["google", "apple"]) {
      document.getElementById(id).href = `/auth/start/${id}?invite=${encodeURIComponent(token)}`;
    }
    document.getElementById("to-signin").addEventListener("click", () => {
      location.href = `/signin?invite=${encodeURIComponent(token)}`;
    });

    const form = document.getElementById("form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      say(notice, "");
      busy(form, true, "Creating…");
      try {
        const result = await api("POST", "/api/auth/signup", {
          displayName: document.getElementById("displayName").value.trim(),
          email: document.getElementById("email").value.trim(),
          password: document.getElementById("password").value,
          token,
        });
        if (result.signedIn) {
          await api("POST", "/api/invitations/accept", { token });
          location.href = "/";
          return;
        }
        /* Email confirmation is switched on, so they have to come back
           through the link in their inbox. The invitation is still
           waiting for them when they do. */
        say(notice, `${result.message} The invitation stays open until you do.`, "good");
        busy(form, false);
      } catch (error) {
        say(notice, error.message);
        busy(form, false);
      }
    });
  }
}
