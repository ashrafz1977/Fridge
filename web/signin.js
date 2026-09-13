/* One card, four jobs: sign in, create an account, ask for a password
   reset, and set a new one after following the emailed link. Google and
   Apple are plain links to the server, which starts the OAuth flow. */

import { api, busy, say, whoami } from "./common.js";

const form = document.getElementById("form");
const notice = document.getElementById("notice");
const heading = document.getElementById("heading");
const lede = document.getElementById("lede");
const switcher = document.getElementById("switcher");
const submit = document.getElementById("submit");
const providers = document.getElementById("providers");
const rule = document.getElementById("rule");
const nameField = document.getElementById("name-field");
const emailField = document.getElementById("email-field");
const passwordField = document.getElementById("password-field");
const passwordTip = document.getElementById("password-tip");

const params = new URLSearchParams(location.search);
const invite = params.get("invite") || "";

/* Carry an invitation through the provider round trip, so accepting an
   invitation and signing up with Google is one gesture. */
if (invite) {
  for (const id of ["google", "apple"]) {
    const link = document.getElementById(id);
    link.href += `?invite=${encodeURIComponent(invite)}`;
  }
}

const MODES = {
  signin: {
    heading: ["A fridge door your ", "whole family", " writes on"],
    lede: "Notes, reminders, appointments, announcements, shopping lists and photos, all in one place. Sign in to open your family's door.",
    submit: "Sign in",
    fields: { name: false, email: true, password: true },
    providers: true,
    autocomplete: "current-password",
    links: [["Create an account", "signup"], ["Forgot your password?", "forgot"]],
  },
  signup: {
    heading: ["Start writing on the ", "family fridge"],
    lede: "An email address and a password is all it takes. You can also use Google or Apple above.",
    submit: "Create account",
    fields: { name: true, email: true, password: true },
    providers: true,
    autocomplete: "new-password",
    links: [["I already have an account", "signin"]],
  },
  forgot: {
    heading: ["Forgotten ", "password"],
    lede: "Tell us the address you signed up with and we will email you a link to set a new password.",
    submit: "Email me a link",
    fields: { name: false, email: true, password: false },
    providers: false,
    links: [["Back to signing in", "signin"]],
  },
  "new-password": {
    heading: ["Choose a ", "new password"],
    lede: "You followed the link from your email, so you are signed in. Pick something new.",
    submit: "Save password",
    fields: { name: false, email: false, password: true },
    providers: false,
    autocomplete: "new-password",
    links: [],
  },
};

let mode = MODES[params.get("mode")] ? params.get("mode") : "signin";

function render() {
  const spec = MODES[mode];
  heading.textContent = "";
  const [before, stress, after] = spec.heading;
  heading.append(before);
  if (stress) {
    const em = document.createElement("em");
    em.textContent = stress;
    heading.append(em);
  }
  if (after) heading.append(after);
  lede.textContent = spec.lede;
  submit.textContent = spec.submit;
  nameField.hidden = !spec.fields.name;
  emailField.hidden = !spec.fields.email;
  passwordField.hidden = !spec.fields.password;
  passwordTip.hidden = !(mode === "signup" || mode === "new-password");
  providers.hidden = !spec.providers;
  rule.hidden = !spec.providers;

  document.getElementById("email").required = spec.fields.email;
  document.getElementById("password").required = spec.fields.password;
  document.getElementById("password").autocomplete = spec.autocomplete || "current-password";
  document.getElementById("displayName").required = spec.fields.name;

  switcher.textContent = "";
  spec.links.forEach(([label, target], i) => {
    if (i) switcher.append(document.createTextNode(" · "));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => { mode = target; say(notice, ""); render(); });
    switcher.append(button);
  });
}

const failure = params.get("error");
if (failure) say(notice, failure);
if (mode === "new-password") {
  /* The recovery link lands here already signed in; if it did not, the
     link was stale. */
  whoami().then((me) => {
    if (!me.signedIn) {
      mode = "forgot";
      say(notice, "That reset link has expired. Ask for a new one.");
      render();
    }
  });
}

render();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  say(notice, "");

  const values = {
    displayName: document.getElementById("displayName").value.trim(),
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
  };

  busy(form, true);
  try {
    if (mode === "signin") {
      await api("POST", "/api/auth/signin", { email: values.email, password: values.password });
      location.href = invite ? `/invite/${encodeURIComponent(invite)}` : "/";
      return;
    }
    if (mode === "signup") {
      const result = await api("POST", "/api/auth/signup", { ...values, token: invite || undefined });
      if (result.signedIn) {
        location.href = invite ? `/invite/${encodeURIComponent(invite)}` : "/";
        return;
      }
      /* Email confirmation is on, so there is no session yet. */
      mode = "signin";
      render();
      say(notice, result.message, "good");
      return;
    }
    if (mode === "forgot") {
      const result = await api("POST", "/api/auth/forgot", { email: values.email });
      say(notice, result.message, "good");
      return;
    }
    await api("POST", "/api/auth/password", { password: values.password });
    location.href = "/";
  } catch (error) {
    say(notice, error.message);
  } finally {
    busy(form, false);
  }
});
