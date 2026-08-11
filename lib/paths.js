// lib/paths.js
//
// Centralizes application data paths.
//
// Electron:
//   PALWORLD_MANAGER_DATA_DIR is injected with the user's writable data directory.
//
// Development:
//   Falls back to ./.data.
//
// Keep this module independent of the database to avoid circular dependencies.
//

const fs = require("fs");
const os = require("os");
const path = require("path");

// -----------------------------------------------------------------------------
// Base data directory
// -----------------------------------------------------------------------------

function ensure(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

function dataDir() {
  const injected = process.env.PALWORLD_MANAGER_DATA_DIR;

  const base =
    injected ||
    path.join(process.cwd(), ".data");

  return ensure(base);
}

// -----------------------------------------------------------------------------
// Backup paths
// -----------------------------------------------------------------------------

/**
 * Resolve the configured backup base directory.
 *
 * A custom location is supplied by Settings → Backups.
 * Falsy values fall back to the application's default data directory.
 */
function backupsBase(custom) {
  return custom
    ? path.resolve(custom)
    : path.join(dataDir(), "backups");
}

// -----------------------------------------------------------------------------
// Application paths
// -----------------------------------------------------------------------------

const P = {
  // Application data
  data: () => dataDir(),

  // Registry database
  db: () =>
    path.join(
      dataDir(),
      "registry.sqlite"
    ),

  // SteamCMD installation
  steamcmd: () =>
    ensure(
      path.join(
        dataDir(),
        "steamcmd"
      )
    ),

  // Application logs
  logs: () =>
    ensure(
      path.join(
        dataDir(),
        "logs"
      )
    ),

  // Backups
  backups: (custom) =>
    ensure(
      backupsBase(custom)
    ),

  defaultBackupsBase: () =>
    path.join(
      dataDir(),
      "backups"
    ),

  // Temporary/staging files
  staging: () =>
    ensure(
      path.join(
        dataDir(),
        "staging"
      )
    ),

  // Writable translation packs (*.json).
  //
  // Built-in packs are read-only and live under:
  //   <appRoot>/public/locales
  languagePacks: () =>
    ensure(
      path.join(
        dataDir(),
        "languagepacks"
      )
    ),

  // Uploaded DailyLoginRewards players.json files when the mod folder
  // is not locally reachable.
  loginRewards: () =>
    ensure(
      path.join(
        dataDir(),
        "loginrewards"
      )
    ),

  // Marker used by Remote Access configuration.
  //
  // Written by the Remote Access route and read by electron/main.js
  // when selecting the Next.js bind address:
  //
  //   127.0.0.1 = local only
  //   0.0.0.0   = LAN reachable
  remoteBind: () =>
    path.join(
      dataDir(),
      "remote-bind.json"
    ),

  // Per-world logs
  worldLogDir: (worldId) =>
    ensure(
      path.join(
        dataDir(),
        "logs",
        worldId
      )
    ),

  // Per-world backups
  worldBackupDir: (
    worldId,
    custom
  ) =>
    ensure(
      path.join(
        backupsBase(custom),
        worldId
      )
    ),

  // Default WINEPREFIX for Windows-targeted worlds running through Wine.
  //
  // Created only when actually needed by supervisor.js.
  worldWinePrefix: (worldId) =>
    path.join(
      dataDir(),
      "wine-prefixes",
      worldId
    ),
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  P,
  ensure,
  platform: os.platform(),
};