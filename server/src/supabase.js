/* Two kinds of Supabase client.

   `userClient` acts as the signed-in person: it reads and writes the
   session through httpOnly cookies, and every query it makes is subject
   to the row level security policies in supabase/schema.sql. Route
   handlers use this one, so a mistake in a handler cannot reach another
   household's door.

   `adminClient` bypasses row level security and exists for exactly one
   job: redeeming an invitation. The invitee is not a member of the
   household yet, so no policy can match them — somebody with a wider
   view has to let them in. It is never handed a request's cookies and
   never reaches the browser. */

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { parse, serialize } from "cookie";
import { config } from "./config.js";

function cookieDefaults() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
  };
}

export function readCookies(req) {
  return parse(req.headers.cookie || "");
}

export function writeCookie(res, name, value, options = {}) {
  res.append("Set-Cookie", serialize(name, value, { ...cookieDefaults(), ...options }));
}

export function clearCookie(res, name) {
  res.append("Set-Cookie", serialize(name, "", { ...cookieDefaults(), maxAge: 0 }));
}

export function userClient(req, res) {
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        const jar = readCookies(req);
        return Object.entries(jar).map(([name, value]) => ({ name, value }));
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          /* httpOnly is forced on: the browser never needs to read an
             access token, and not reading it is the point of this
             whole arrangement. */
          writeCookie(res, name, value, { ...options, httpOnly: true });
        }
      },
    },
  });
}

let admin = null;

export function adminClient() {
  if (!admin) {
    admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  return admin;
}
