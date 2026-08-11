import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const palnames = require("@/lib/palnames");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Global (all-worlds) Pal display-name overrides. These sit below any per-world override
// and above the built-in default map (see lib/palnames.resolve). `unmapped` lists Pals
// seen across every world's deaths that still have no name — surfaced for the user to fill.
export async function GET() {
  const overrides = dbm.getSetting("palNameOverrides", {}) || {};
  const unmapped = palnames.unmapped(dbm.allSeenKillers(), overrides);
  return NextResponse.json({ ok: true, overrides, unmapped });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const clean = palnames.sanitizeOverrides(body && body.overrides);
  dbm.setSetting("palNameOverrides", clean);
  const unmapped = palnames.unmapped(dbm.allSeenKillers(), clean);
  return NextResponse.json({ ok: true, overrides: clean, unmapped });
}
