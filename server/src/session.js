/* Who is asking, which door they are looking at, and proof that they
   meant to ask. */

import crypto from "node:crypto";
import { config } from "./config.js";
import { userClient, readCookies, writeCookie, clearCookie } from "./supabase.js";

const CSRF_COOKIE = "fridge_csrf";
const CSRF_HEADER = "x-fridge-csrf";
const HOME_COOKIE = "fridge_home";

function sign(value) {
  return crypto.createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

function mintCsrf() {
  const nonce = crypto.randomBytes(18).toString("base64url");
  return `${nonce}.${sign(nonce)}`;
}

function csrfIsWellFormed(token) {
  const [nonce, mac] = String(token || "").split(".");
  if (!nonce || !mac) return false;
  const expected = sign(nonce);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* The CSRF cookie is deliberately readable by scripts: the page has to
   echo it back in a header. That is the whole double-submit trick — an
   attacker's site can make the browser send our cookies, but cannot
   read them to build the matching header. */
export function csrf(req, res, next) {
  const jar = readCookies(req);
  let token = jar[CSRF_COOKIE];
  if (!csrfIsWellFormed(token)) {
    token = mintCsrf();
    writeCookie(res, CSRF_COOKIE, token, { httpOnly: false });
  }
  req.csrfToken = token;

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const offered = req.get(CSRF_HEADER);
  if (!offered || !csrfIsWellFormed(offered) || offered !== token) {
    return res.status(403).json({
      error: "csrf",
      message: "This request could not be verified. Reload the page and try again.",
    });
  }
  return next();
}

export async function attachUser(req, res, next) {
  req.supabase = userClient(req, res);
  /* getUser, not getSession: it verifies the token with the auth server
     instead of trusting whatever is in the cookie. */
  const { data, error } = await req.supabase.auth.getUser();
  req.user = error ? null : (data && data.user) || null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "signed_out", message: "Sign in to open the fridge." });
  }
  return next();
}

export function currentHouseholdId(req) {
  const value = readCookies(req)[HOME_COOKIE];
  return /^[0-9a-f-]{36}$/i.test(value || "") ? value : null;
}

export function setCurrentHousehold(res, id) {
  if (id) writeCookie(res, HOME_COOKIE, id, { maxAge: 60 * 60 * 24 * 365 });
  else clearCookie(res, HOME_COOKIE);
}

/* Resolves the household this request is about and proves membership
   through the user's own client, so RLS — not this function — is what
   actually enforces it. */
export async function requireHousehold(req, res, next) {
  const wanted = req.params.householdId || req.get("x-fridge-household") || currentHouseholdId(req);
  if (!wanted) {
    return res.status(409).json({ error: "no_household", message: "Choose or create a family group first." });
  }
  const { data, error } = await req.supabase
    .from("memberships")
    .select("household_id, role, color, households(id, name, finish)")
    .eq("household_id", wanted)
    .maybeSingle();

  if (error) return next(error);
  if (!data) {
    return res.status(404).json({ error: "not_a_member", message: "This family group is not yours to open." });
  }
  req.household = {
    id: data.household_id,
    name: data.households && data.households.name,
    finish: (data.households && data.households.finish) || "steel",
    role: data.role,
    color: data.color,
  };
  return next();
}
