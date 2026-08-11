// lib/steamlibrary.js
// Locate Steam Workshop content across every Steam library on the machine, so
// Workshop mods resolve no matter which drive Steam lives on.
//
// Palworld's Steam *client* app id (the app that owns its Workshop content) is
// 1623730. A subscribed Workshop item lives at:
//   <library>/steamapps/workshop/content/1623730/<workshopId>/Info.json
// Steam can spread libraries across several drives; they're enumerated in
//   <steamRoot>/steamapps/libraryfolders.vdf   (current format)
//   <steamRoot>/config/libraryfolders.vdf      (legacy format)
// We discover the Steam root(s) from the Windows registry and the common install
// locations, parse those vdf files for every library path, and fold in any
// user-supplied override. The result is the union of places to look — no more
// hardcoding C:.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PALWORLD_STEAM_APPID = "1623730";

// Read a single string value out of the Windows registry, or null on any failure
// (wrong OS, missing key, no reg.exe). Never throws.
function regValue(hive, key, name) {
  try {
    const out = execFileSync("reg", ["query", `${hive}\\${key}`, "/v", name], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // A value line looks like:  "    SteamPath    REG_SZ    c:/program files (x86)/steam"
    const m = out.match(new RegExp(name + "\\s+REG_\\w+\\s+(.+)", "i"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Steam install roots reported by the registry (Windows only).
function registrySteamRoots() {
  const roots = [];
  const hkcu = regValue("HKCU", "Software\\Valve\\Steam", "SteamPath");
  const hklm = regValue("HKLM", "SOFTWARE\\Wow6432Node\\Valve\\Steam", "InstallPath");
  for (const r of [hkcu, hklm]) if (r) roots.push(path.normalize(r));
  return roots;
}

// Every Steam install root we can find: registry first, then the well-known
// default locations. Only directories that actually exist are returned.
function discoverSteamRoots() {
  const guesses = [
    ...registrySteamRoots(),
    path.join("C:", "Program Files (x86)", "Steam"),
    path.join("C:", "Program Files", "Steam"),
  ];
  return uniqueExistingDirs(guesses);
}

// Pull every library path out of a libraryfolders.vdf. Handles both the current
// format (`"path"  "D:\\SteamLibrary"`) and the legacy one (`"1"  "D:\\..."`).
function parseLibraryFoldersVdf(vdfPath) {
  let raw;
  try { raw = fs.readFileSync(vdfPath, "utf8"); } catch { return []; }
  const out = [];
  const unescape = (s) => s.replace(/\\\\/g, "\\");
  let m;
  const pathRe = /"path"\s+"([^"]+)"/gi;          // current format
  while ((m = pathRe.exec(raw))) out.push(unescape(m[1]));
  const legacyRe = /^\s*"\d+"\s+"([^"]+)"/gim;     // legacy numeric keys
  while ((m = legacyRe.exec(raw))) out.push(unescape(m[1]));
  return out;
}

// The union of Steam library folders on the machine, plus any user override.
// Each returned entry is a directory that (usually) contains a `steamapps` folder.
function discoverLibraries(override) {
  const libs = [];
  if (override) libs.push(path.normalize(override));
  for (const root of discoverSteamRoots()) {
    libs.push(root);
    for (const vdf of [
      path.join(root, "steamapps", "libraryfolders.vdf"),
      path.join(root, "config", "libraryfolders.vdf"),
    ]) {
      for (const lib of parseLibraryFoldersVdf(vdf)) libs.push(path.normalize(lib));
    }
  }
  return uniqueExistingDirs(libs);
}

// Given a base the caller pointed us at (a Steam root, a library folder, the
// workshop content dir, or the item folder itself), enumerate the concrete item
// directories worth checking. Being generous here means the user can pick almost
// anything sensible in the folder picker and it still resolves.
function itemCandidates(base, workshopId) {
  const id = String(workshopId);
  return [
    base,                                                                         // already the item folder
    path.join(base, id),                                                          // base = .../content/1623730
    path.join(base, "workshop", "content", PALWORLD_STEAM_APPID, id),             // base = .../steamapps
    path.join(base, "steamapps", "workshop", "content", PALWORLD_STEAM_APPID, id),// base = library/steam root
  ];
}

// Resolve a subscribed Workshop item to its on-disk folder. Searches the override
// (if any) first, then every discovered Steam library. Returns the folder that
// exists and holds an Info.json, plus the full list of places we looked (handy for
// a precise "not found, here's where I searched" error).
function resolveWorkshopItem(workshopId, override) {
  const searched = [];
  for (const base of discoverLibraries(override)) {
    for (const cand of itemCandidates(base, workshopId)) {
      searched.push(cand);
      if (fs.existsSync(path.join(cand, "Info.json"))) return { path: cand, searched };
    }
  }
  return { path: null, searched };
}

function uniqueExistingDirs(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p) continue;
    const key = path.normalize(p).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try { if (fs.statSync(p).isDirectory()) out.push(path.normalize(p)); } catch { /* skip */ }
  }
  return out;
}

module.exports = {
  PALWORLD_STEAM_APPID,
  discoverSteamRoots,
  discoverLibraries,
  resolveWorkshopItem,
};
