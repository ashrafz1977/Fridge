/* Shared by the sign-in, start and invitation pages. */

export function cookie(name) {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : "";
}

/* Every mutating request echoes the CSRF cookie back in a header. The
   cookie is readable on purpose: another site can make the browser send
   it, but cannot read it to build the matching header. */
export async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-fridge-csrf": cookie("fridge_csrf") },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Something went wrong. Try again.");
    error.code = payload.error;
    error.status = response.status;
    error.field = payload.field;
    throw error;
  }
  return payload;
}

export function say(el, message, kind = "bad") {
  el.textContent = message || "";
  el.hidden = !message;
  el.className = "notice " + kind;
}

export function busy(form, on, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (on) {
    button.dataset.idle = button.dataset.idle || button.textContent;
    button.textContent = label || "Working…";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.idle || button.textContent;
    button.disabled = false;
  }
}

/* A page that only makes sense signed in, or only signed out. */
export async function whoami() {
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    return await response.json();
  } catch {
    return { signedIn: false };
  }
}
