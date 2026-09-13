#!/usr/bin/env node
/* Generates the "client secret" that Sign in with Apple wants.
 *
 * Apple is the odd one out: where Google gives you a client secret
 * string, Apple makes you sign a short-lived ES256 JWT with a private
 * key it issues once and will not show you again. Supabase asks for the
 * finished JWT, so this script turns your .p8 into one.
 *
 * Usage:
 *   node scripts/apple-secret.mjs \
 *     --team    ABCDE12345 \
 *     --key-id  XYZ9876543 \
 *     --service com.example.fridge.web \
 *     --p8      ./AuthKey_XYZ9876543.p8
 *
 * Paste the result into Supabase → Authentication → Providers → Apple →
 * "Secret Key (for OAuth)".
 *
 * Apple caps the lifetime at six months, so this is a recurring chore.
 * Put a reminder in the fridge's own calendar — that is the joke and
 * also genuinely the advice.
 */

import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import { importPKCS8, SignJWT } from "jose";

const SIX_MONTHS = 15777000;          // Apple's hard maximum, in seconds

function arg(name) {
  const at = argv.indexOf(`--${name}`);
  return at > -1 ? argv[at + 1] : undefined;
}

const team = arg("team");
const keyId = arg("key-id");
const service = arg("service");
const p8Path = arg("p8");
const days = Number(arg("days") || "180");

if (!team || !keyId || !service || !p8Path) {
  console.error(`
Missing arguments. All four are required:

  --team     Your Apple Team ID          (Apple Developer → Membership)
  --key-id   The Key ID of the .p8       (Certificates, Identifiers & Profiles → Keys)
  --service  Your Services ID            (the identifier you registered for the web,
                                          e.g. com.example.fridge.web — NOT the app bundle id)
  --p8       Path to the AuthKey_*.p8 file you downloaded when you made the key

Optional:
  --days     Lifetime in days, at most 180 (default 180)
`);
  exit(1);
}

const lifetime = Math.min(Math.round(days * 86400), SIX_MONTHS);

let pem;
try {
  pem = await readFile(p8Path, "utf8");
} catch (error) {
  console.error(`Could not read ${p8Path}: ${error.message}`);
  exit(1);
}

let key;
try {
  key = await importPKCS8(pem.trim(), "ES256");
} catch (error) {
  console.error(`That does not look like an Apple .p8 private key: ${error.message}`);
  exit(1);
}

const now = Math.floor(Date.now() / 1000);
const secret = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: keyId })
  .setIssuer(team)
  .setIssuedAt(now)
  .setExpirationTime(now + lifetime)
  .setAudience("https://appleid.apple.com")
  .setSubject(service)
  .sign(key);

const expires = new Date((now + lifetime) * 1000);

console.log(`
Apple client secret (expires ${expires.toISOString().slice(0, 10)}):

${secret}

Next:
  1. Supabase → Authentication → Providers → Apple → enable it.
  2. Client IDs:  ${service}
  3. Secret Key:  the JWT above.
  4. In the Apple Developer portal, the Services ID's "Return URLs" must
     include your Supabase callback:
       https://<your-project-ref>.supabase.co/auth/v1/callback
  5. Diarise ${expires.toISOString().slice(0, 10)} — Apple will stop accepting this secret then.
`);
