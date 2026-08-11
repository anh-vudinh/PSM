import { NextResponse } from "next/server";
const dbm = require("@/lib/db");
const sup = require("@/lib/supervisor");
const ue4ss = require("@/lib/ue4ss");
const palnames = require("@/lib/palnames");
const ra = require("@/lib/remoteauth");
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: recent deaths + whether the PSMDeathRelay mod / UE4SS are installed for this world.
export async function GET(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const denied = ra.guardResponse(req, { worldId: params.id, tab: "deaths" });
  if (denied) return denied;
  // Ensure the death tailer is running for this world if it's up — covers servers the app
  // adopted (never spawned) so opening this tab alone is enough to start catching deaths.
  try {
    if (sup.isRunning(params.id) || sup.pidAlive(w.process_id)) sup.ensureDeathTail(params.id, w.install_dir);
  } catch {}
  let ue4ssInstalled = false;
  try { ue4ssInstalled = ue4ss.detect(w.install_dir).installed; } catch {}

  // Re-resolve each death's killer name from its raw codename through the current
  // world -> global -> default override chain, so renaming a Pal (or naming a new one)
  // re-labels past deaths in the feed. Rows predating killer_raw keep their stored name;
  // player killers are always their own name.
  let worldMap = {};
  try { worldMap = JSON.parse(w.pal_name_overrides || "{}") || {}; } catch {}
  const globalMap = dbm.getSetting("palNameOverrides", {}) || {};
  const deaths = dbm.listDeaths(params.id, 100).map((d) =>
    d.killer_raw && d.killer_kind !== "player"
      ? { ...d, killer: palnames.resolve(d.killer_raw, worldMap, globalMap) }
      : d
  );

  return NextResponse.json({
    ok: true,
    deaths,
    counts: dbm.deathCounts(params.id, 50),
    modInstalled: sup.deathModInstalled(w.install_dir),
    ue4ssInstalled,
    bundledAvailable: !!sup.bundledDeathModDir(),
  });
}

// POST: install the bundled PSMDeathRelay UE4SS mod into this world's server.
export async function POST(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const denied = ra.guardResponse(req, { worldId: params.id, tab: "deaths", action: "deaths.installMod", mutating: true });
  if (denied) return denied;
  if (sup.isRunning(params.id)) return NextResponse.json({ ok: false, error: "Stop the server before changing mods." }, { status: 409 });
  try {
    const res = sup.installDeathMod(w.install_dir);
    dbm.logEvent(params.id, "mods", "Installed death tracking mod (PSMDeathRelay)");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

// DELETE: remove the death relay mod (escape hatch if a Palworld update breaks it).
export async function DELETE(req, { params }) {
  const w = dbm.getWorld(params.id);
  if (!w) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const denied = ra.guardResponse(req, { worldId: params.id, tab: "deaths", action: "deaths.removeMod", mutating: true });
  if (denied) return denied;
  if (sup.isRunning(params.id)) return NextResponse.json({ ok: false, error: "Stop the server before changing mods." }, { status: 409 });
  try {
    const res = sup.uninstallDeathMod(w.install_dir);
    dbm.logEvent(params.id, "mods", "Removed death tracking mod (PSMDeathRelay)");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
