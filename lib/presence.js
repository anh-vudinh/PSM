// lib/presence.js
//
// Background player-presence tracker.
//
// Polls each running, REST-enabled world, diffs the current player list against
// the previous snapshot, records join/leave sessions, and sends Discord
// notifications through the centralized notify() pipeline.
//
// This is the single source of truth for presence diffing. API routes do not
// perform their own player diffing, preventing duplicate sessions and
// notifications from overlapping polls.
//

const dbm = require("./db");
const sup = require("./supervisor");
const rest = require("./restclient");
const { notify } = require("./notify");
const { fireJoinSchedules } = require("./scheduler");
const idlestop = require("./idlestop");

const PRESENCE_MS = 10_000;
const GRACE_POLLS = 3;

const g = globalThis;

if (!g.__PAL_PRESENCE) {
  g.__PAL_PRESENCE = new Map();
}

if (!g.__PAL_PENDING) {
  g.__PAL_PENDING = new Map();
}

const PRESENCE = g.__PAL_PRESENCE;
const PENDING = g.__PAL_PENDING;

// -----------------------------------------------------------------------------
// Player helpers
// -----------------------------------------------------------------------------

function keyOf(player) {
  return String(
    player?.userId ||
    player?.playerId ||
    player?.name ||
    ""
  ).trim();
}

function nameOf(player, uid) {
  return (
    String(player?.name || "").trim() ||
    uid
  );
}

/**
 * Palworld may initially report the platform account name and later replace it
 * with the player's in-game character name.
 *
 * A name is considered settled when:
 *   - it differs from the reported accountName, or
 *   - it differs from the first name observed during the grace period.
 */
function nameSettled(player, firstName) {
  const name = String(
    player?.name || ""
  ).trim();

  if (!name) {
    return false;
  }

  const accountName = String(
    player?.accountName || ""
  ).trim();

  if (
    accountName &&
    name !== accountName
  ) {
    return true;
  }

  if (
    firstName != null &&
    name !== firstName
  ) {
    return true;
  }

  return false;
}

// -----------------------------------------------------------------------------
// Presence diffing
// -----------------------------------------------------------------------------

/**
 * Diff one world's current player list against its previous snapshot.
 *
 * New players enter a short grace period so their join is recorded with the
 * settled in-game name rather than the temporary platform account name.
 *
 * The first observation establishes a silent baseline and intentionally does
 * not generate join notifications.
 */
function observe(world, players) {
  const worldId = world.world_id;

  const hadBaseline =
    PRESENCE.has(worldId);

  const confirmed =
    PRESENCE.get(worldId) ||
    new Map();

  const pending =
    PENDING.get(worldId) ||
    new Map();

  const current = new Map();

  for (const player of players || []) {
    const uid = keyOf(player);

    if (uid) {
      current.set(uid, player);
    }
  }

  // ---------------------------------------------------------------------------
  // Initial baseline
  // ---------------------------------------------------------------------------

  if (!hadBaseline) {
    for (const [uid, player] of current) {
      confirmed.set(
        uid,
        nameOf(player, uid)
      );
    }

    PRESENCE.set(worldId, confirmed);
    PENDING.set(worldId, pending);

    return;
  }

  const joined = [];
  const left = [];

  // ---------------------------------------------------------------------------
  // Detect leaves
  // ---------------------------------------------------------------------------

  for (const [uid, name] of confirmed) {
    if (current.has(uid)) {
      continue;
    }

    dbm.logSession(
      worldId,
      uid,
      name,
      "leave"
    );

    left.push(name);
    confirmed.delete(uid);
  }

  // A pending player who disappears before being confirmed was only a
  // transient connection. Do not create a join/leave pair for it.
  for (const uid of [...pending.keys()]) {
    if (!current.has(uid)) {
      pending.delete(uid);
    }
  }

  // ---------------------------------------------------------------------------
  // Keep confirmed player names current
  // ---------------------------------------------------------------------------

  for (const [uid, player] of current) {
    if (confirmed.has(uid)) {
      confirmed.set(
        uid,
        nameOf(player, uid)
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Confirm pending joins
  // ---------------------------------------------------------------------------

  for (const [uid, pendingPlayer] of pending) {
    const player = current.get(uid);

    if (!player) {
      continue;
    }

    pendingPlayer.ticks += 1;

    const settled =
      nameSettled(
        player,
        pendingPlayer.firstName
      );

    const graceExpired =
      pendingPlayer.ticks >= GRACE_POLLS;

    if (!settled && !graceExpired) {
      continue;
    }

    const name = nameOf(
      player,
      uid
    );

    confirmed.set(uid, name);
    pending.delete(uid);

    dbm.logSession(
      worldId,
      uid,
      name,
      "join"
    );

    joined.push(name);
  }

  // ---------------------------------------------------------------------------
  // Detect new players
  // ---------------------------------------------------------------------------

  for (const [uid, player] of current) {
    if (
      confirmed.has(uid) ||
      pending.has(uid)
    ) {
      continue;
    }

    pending.set(uid, {
      firstName: nameOf(player, uid),
      ticks: 0,
    });
  }

  PRESENCE.set(worldId, confirmed);
  PENDING.set(worldId, pending);

  // ---------------------------------------------------------------------------
  // Notifications and join schedules
  // ---------------------------------------------------------------------------

  for (const name of joined) {
    notify(
      worldId,
      "join",
      `${name} joined ${world.display_name}`,
      { player: name }
    ).catch(() => {});

    fireJoinSchedules(
      worldId,
      name
    ).catch(() => {});
  }

  for (const name of left) {
    notify(
      worldId,
      "leave",
      `${name} left ${world.display_name}`,
      { player: name }
    ).catch(() => {});
  }
}

// -----------------------------------------------------------------------------
// Polling
// -----------------------------------------------------------------------------

async function tick() {
  if (g.__PAL_PRESENCE_BUSY) {
    return;
  }

  g.__PAL_PRESENCE_BUSY = true;

  try {
    for (const world of dbm.listWorlds()) {
      const worldId = world.world_id;

      const running =
        sup.isRunning(worldId) ||
        sup.pidAlive(world.process_id);

      // Keep the death relay alive for every running world, including worlds
      // that PSM adopted rather than launched itself.
      if (running) {
        try {
          sup.ensureDeathTail(
            worldId,
            world.install_dir
          );
        } catch {}
      } else {
        sup.stopDeathTail(worldId);
      }

      // No REST polling for stopped or REST-disabled worlds.
      if (
        !running ||
        !world.rest_api_enabled
      ) {
        // The next start should establish a fresh silent baseline.
        PRESENCE.delete(worldId);
        PENDING.delete(worldId);

        // A stopped world cannot be idle-stopped.
        idlestop.clear(worldId);

        continue;
      }

      let response;

      try {
        response = await rest.players(world);
      } catch {
        // A transient REST failure must not create false leave events.
        // Preserve the existing baseline and try again on the next poll.
        continue;
      }

      const players =
        response &&
        Array.isArray(response.players)
          ? response.players
          : [];

      observe(
        world,
        players
      );

      // Reuse the exact player snapshot instead of issuing another REST request.
      try {
        idlestop.evaluate(
          world,
          players
        );
      } catch (error) {
        dbm.logEvent(
          worldId,
          "scheduler",
          `Idle auto-stop check failed: ${error.message}`
        );
      }
    }
  } finally {
    g.__PAL_PRESENCE_BUSY = false;
  }
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

function ensurePresence() {
  if (g.__PAL_PRESENCE_TIMER) {
    return;
  }

  g.__PAL_PRESENCE_TIMER = setInterval(
    () => {
      tick().catch(() => {});
    },
    PRESENCE_MS
  );

  // Establish baselines immediately instead of waiting for the first interval.
  tick().catch(() => {});
}

// -----------------------------------------------------------------------------
// Snapshot helpers
// -----------------------------------------------------------------------------

/**
 * Check whether a player exists in the latest presence snapshot.
 *
 * Pending players are considered online as well because they may still be
 * completing their join grace period.
 */
function isOnline(worldId, name) {
  const wanted = String(
    name || ""
  ).trim().toLowerCase();

  if (!wanted) {
    return false;
  }

  const snapshot =
    PRESENCE.get(worldId);

  if (snapshot) {
    for (const playerName of snapshot.values()) {
      if (
        String(playerName)
          .trim()
          .toLowerCase() === wanted
      ) {
        return true;
      }
    }
  }

  const pending =
    PENDING.get(worldId);

  if (pending) {
    for (const player of pending.values()) {
      if (
        String(player.firstName)
          .trim()
          .toLowerCase() === wanted
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Return the number of players in the latest snapshot.
 *
 * Pending players count as online so idle-stop cannot shut down a server while
 * someone is still completing the connection process.
 */
function onlineCount(worldId) {
  const snapshot =
    PRESENCE.get(worldId);

  const pending =
    PENDING.get(worldId);

  return (
    (snapshot?.size || 0) +
    (pending?.size || 0)
  );
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  ensurePresence,
  observe,
  isOnline,
  onlineCount,
};