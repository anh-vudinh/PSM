import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const palnames = require("@/lib/palnames");
const ra = require("@/lib/remoteauth");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function worldOverrides(w) {
  try { return JSON.parse(w.pal_name_overrides || "{}") || {}; } catch { return {}; }
}

// Per-world Pal display-name overrides. `globalOverrides` is returned too so the editor can
// show what each name inherits when left blank, and `unmapped` lists this world's
// unnamed Pals (not known and not covered by the world OR global override).
export async function GET(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const denied = ra.guardResponse(req, { worldId: params.id, tab: "deaths" });
  if (denied) return denied;
  const overrides = worldOverrides(w);
  const globalOverrides = dbm.getSetting("palNameOverrides", {}) || {};
  const unmapped = palnames.unmapped(dbm.seenKillers(params.id), { ...globalOverrides, ...overrides });
  return NextResponse.json({ ok: true, overrides, globalOverrides, unmapped });
}

export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const denied = ra.guardResponse(req, { worldId: params.id, tab: "deaths", action: "palnames.save", mutating: true });
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const clean = palnames.sanitizeOverrides(body && body.overrides);
  dbm.updateWorld(params.id, { pal_name_overrides: JSON.stringify(clean) });
  const globalOverrides = dbm.getSetting("palNameOverrides", {}) || {};
  const unmapped = palnames.unmapped(dbm.seenKillers(params.id), { ...globalOverrides, ...clean });
  return NextResponse.json({ ok: true, overrides: clean, globalOverrides, unmapped });
}
