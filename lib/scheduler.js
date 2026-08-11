// lib/scheduler.js  (spec §7 scheduler, §8 update all)

const dbm = require("./db");
const steam = require("./steamcmd");
const sup = require("./supervisor");
const jobs = require("./jobs");
const warn = require("./warn");
const rest = require("./restclient");
const appver = require("./appversion");
const { createBackup } = require("./backups");
const { notify } = require("./notify");

const g = globalThis;

if (!g.__PAL_SCHED) {
  g.__PAL_SCHED = {
    timer: null,
    bcastTimer: null,
    bcastBusy: false,
    updating: new Set(),
    joinTimers: new Set(),
    backupSkipped: new Set(),
    autoUpdating: false,
  };
}

const ST = g.__PAL_SCHED;

if (!ST.joinTimers) ST.joinTimers = new Set();
if (!ST.backupSkipped) ST.backupSkipped = new Set();

function ensureScheduler() {
  if (!ST.timer) {
    ST.timer = setInterval(tick, 60 * 1000);
    tick();
  }

  if (!ST.bcastTimer) {
    ST.bcastTimer = setInterval(broadcastTick, 2000);
  }
}

async function broadcastTick() {
  if (ST.bcastBusy) return;

  ST.bcastBusy = true;

  try {
    await fireDueBroadcasts(Date.now());
  } catch {
    // logged per-broadcast inside
  } finally {
    ST.bcastBusy = false;
  }
}

function due(sched, now) {
  if (!sched.enabled) return false;

  // Wake-up Listener is event-driven by lib/autostart.js.
  if (
    sched.job_type === "wakeup_listener" ||
    sched.mode === "listener"
  ) {
    return false;
  }

  if (sched.mode === "on_join") {
    return false;
  }

  if (sched.job_type === "idle_stop") {
    return false;
  }

  const last = sched.last_run || 0;

  if (sched.mode === "interval" && sched.interval_hours) {
    return (
      now - last >=
      sched.interval_hours * 3600 * 1000
    );
  }

  if (sched.mode === "minutes" && sched.interval_minutes) {
    return (
      now - last >=
      sched.interval_minutes * 60 * 1000
    );
  }

  if (sched.mode === "daily" && sched.time_of_day) {
    const [h, m] = sched.time_of_day
      .split(":")
      .map(Number);

    const d = new Date(now);
    const target = new Date(d);

    target.setHours(h, m, 0, 0);

    const ranToday =
      last &&
      new Date(last).toDateString() ===
        d.toDateString();

    return (
      !ranToday &&
      d >= target &&
      d - target < 90 * 1000
    );
  }

  return false;
}

async function tick() {
  const now = Date.now();

  await maybeAutoCheckUpdates(now);

  appver
    .refreshIfStale(now)
    .catch(() => {});

  runAutoUpdates().catch(() => {});

  for (const s of dbm.listSchedules()) {
    if (!due(s, now)) continue;

    if (s.skip_next) {
      dbm.updateScheduleRun(s.id, now);

      dbm.setScheduleSkipNext(
        s.id,
        false
      );

      ST.backupSkipped.delete(s.id);

      dbm.logEvent(
        s.world_id,
        "scheduler",
        `Skipped scheduled ${s.job_type} — cancelled by admin`
      );

      continue;
    }

    if (
      s.job_type === "backup" &&
      !sup.isAlive(s.world_id)
    ) {
      if (!ST.backupSkipped.has(s.id)) {
        ST.backupSkipped.add(s.id);

        dbm.logEvent(
          s.world_id,
          "scheduler",
          "Skipped scheduled backup — the server isn't running"
        );
      }

      continue;
    }

    ST.backupSkipped.delete(s.id);

    dbm.updateScheduleRun(
      s.id,
      now
    );

    try {
      if (s.job_type === "backup") {
        await createBackup(
          s.world_id,
          "scheduled"
        );
      } else if (s.job_type === "restart") {
        await scheduledRestart(
          s.world_id
        );
      } else if (s.job_type === "stop") {
        await scheduledStop(
          s.world_id
        );
      } else if (s.job_type === "update") {
        await updateWorld(
          s.world_id
        );
      } else if (
        s.job_type === "system_message"
      ) {
        await sendSystemMessage(
          s.world_id,
          s.message
        );
      } else if (
        s.job_type === "onscreen_notice"
      ) {
        await sendOnScreenNotice(
          s.world_id,
          s.message
        );
      }

      dbm.logEvent(
        s.world_id,
        "scheduler",
        `Ran ${s.job_type} job`
      );
    } catch (e) {
      dbm.logEvent(
        s.world_id,
        "scheduler",
        `Job ${s.job_type} failed: ${e.message}`
      );
    }
  }
}

const BROADCAST_GRACE_MS =
  2 * 60 * 1000;

async function fireDueBroadcasts(now) {
  for (const b of dbm.dueBroadcasts(now)) {
    const w = dbm.getWorld(
      b.world_id
    );

    const tooLate =
      now - b.fire_at >
      BROADCAST_GRACE_MS;

    const canSend =
      w &&
      sup.isAlive(b.world_id) &&
      (
        sup.broadcastModInstalled(
          w.install_dir
        ) ||
        w.rest_api_enabled
      );

    if (tooLate || !canSend) {
      dbm.markBroadcastMissed(
        b.id
      );

      dbm.logEvent(
        b.world_id,
        "broadcast",
        tooLate
          ? `Missed scheduled broadcast (app was closed): ${b.message}`
          : `Missed scheduled broadcast (server offline): ${b.message}`
      );

      continue;
    }

    try {
      if (
        sup.broadcastModInstalled(
          w.install_dir
        )
      ) {
        sup.enqueueBroadcast(
          w.install_dir,
          b.message
        );

        dbm.logEvent(
          b.world_id,
          "broadcast",
          `Sent scheduled broadcast (mod): ${b.message}`
        );
      } else {
        await rest.announce(
          w,
          b.message
        );

        dbm.logEvent(
          b.world_id,
          "broadcast",
          `Sent scheduled broadcast (rest): ${b.message}`
        );
      }

      dbm.deleteBroadcast(
        b.id
      );
    } catch (e) {
      dbm.markBroadcastMissed(
        b.id
      );

      dbm.logEvent(
        b.world_id,
        "broadcast",
        `Scheduled broadcast failed, kept as missed: ${e.message}`
      );
    }
  }
}

async function scheduledRestart(worldId) {
  const w = dbm.getWorld(
    worldId
  );

  if (!w) return;

  await createBackup(
    worldId,
    "pre-restart-safety"
  ).catch(() => {});

  await notify(
    worldId,
    "restart",
    `Scheduled restart of ${w.display_name}`,
    {}
  );

  const {
    finalWaittime,
  } = await warn.runPreShutdownWarning(
    worldId,
    sup.isAlive
  );

  await sup.restartWorld(
    worldId,
    {
      waittime: finalWaittime,
    }
  );
}

async function scheduledStop(worldId) {
  const w = dbm.getWorld(
    worldId
  );

  if (!w) return;

  if (!sup.isAlive(worldId)) return;

  await createBackup(
    worldId,
    "pre-stop-safety"
  ).catch(() => {});

  await notify(
    worldId,
    "stop",
    `Scheduled stop of ${w.display_name}`,
    {}
  );

  const {
    finalWaittime,
  } = await warn.runPreShutdownWarning(
    worldId,
    sup.isAlive
  );

  await sup.stopWorld(
    worldId,
    {
      graceful: true,
      waittime: finalWaittime,
    }
  );
}

function personalize(
  message,
  playerName
) {
  if (!message) return message;

  return message.replace(
    /{player}/gi,
    playerName || ""
  );
}

async function sendSystemMessage(
  worldId,
  message
) {
  const w = dbm.getWorld(
    worldId
  );

  if (
    !w ||
    !String(message || "").trim()
  ) {
    return;
  }

  if (!sup.isAlive(worldId)) return;

  await rest.announce(
    w,
    message
  );
}

async function sendOnScreenNotice(
  worldId,
  message
) {
  const w = dbm.getWorld(
    worldId
  );

  if (
    !w ||
    !String(message || "").trim()
  ) {
    return;
  }

  if (!sup.isAlive(worldId)) return;

  if (
    sup.broadcastModInstalled(
      w.install_dir
    )
  ) {
    sup.enqueueBroadcast(
      w.install_dir,
      message
    );
  } else {
    await rest.announce(
      w,
      message
    );
  }
}

async function deliverJoinMessage(
  worldId,
  s,
  name
) {
  const msg = personalize(
    s.message,
    name
  );

  if (
    s.job_type ===
    "system_message"
  ) {
    await sendSystemMessage(
      worldId,
      msg
    );
  } else {
    await sendOnScreenNotice(
      worldId,
      msg
    );
  }

  dbm.updateScheduleRun(
    s.id,
    Date.now()
  );

  dbm.logEvent(
    worldId,
    "scheduler",
    `Sent on-join ${s.job_type} for ${name || "any player"}`
  );
}

function scheduleJoinMessage(
  worldId,
  s,
  name,
  delaySec
) {
  const skip = (why) =>
    dbm.logEvent(
      worldId,
      "scheduler",
      `Skipped on-join ${s.job_type} for ${name || "any player"} — ${why} during the ${delaySec}s delay`
    );

  const timer = setTimeout(
    async () => {
      ST.joinTimers.delete(
        timer
      );

      const fresh = dbm
        .listSchedules(worldId)
        .find(
          (x) => x.id === s.id
        );

      if (
        !fresh ||
        !fresh.enabled
      ) {
        return skip(
          "the schedule was removed or turned off"
        );
      }

      if (!sup.isAlive(worldId)) {
        return skip(
          "the server stopped"
        );
      }

      if (
        name &&
        !require("./presence").isOnline(
          worldId,
          name
        )
      ) {
        return skip(
          "they left"
        );
      }

      try {
        await deliverJoinMessage(
          worldId,
          fresh,
          name
        );
      } catch (e) {
        dbm.logEvent(
          worldId,
          "scheduler",
          `On-join job failed: ${e.message}`
        );
      }
    },
    delaySec * 1000
  );

  if (timer.unref) {
    timer.unref();
  }

  ST.joinTimers.add(timer);
}

async function fireJoinSchedules(
  worldId,
  playerName
) {
  const name = String(
    playerName || ""
  ).trim();

  for (const s of dbm.listSchedules(
    worldId
  )) {
    if (
      !s.enabled ||
      s.mode !== "on_join"
    ) {
      continue;
    }

    if (
      s.job_type !==
        "system_message" &&
      s.job_type !==
        "onscreen_notice"
    ) {
      continue;
    }

    const matcher = String(
      s.join_match || ""
    ).trim();

    if (
      matcher &&
      matcher.toLowerCase() !==
        name.toLowerCase()
    ) {
      continue;
    }

    const delaySec = Math.max(
      0,
      Math.round(
        Number(
          s.join_delay_seconds
        ) || 0
      )
    );

    if (delaySec > 0) {
      scheduleJoinMessage(
        worldId,
        s,
        name,
        delaySec
      );

      continue;
    }

    try {
      await deliverJoinMessage(
        worldId,
        s,
        name
      );
    } catch (e) {
      dbm.logEvent(
        worldId,
        "scheduler",
        `On-join job failed: ${e.message}`
      );
    }
  }
}

const LAST_CHECK_SETTING =
  "lastUpdateCheck";

const CHECK_INTERVAL_SETTING =
  "updateCheckIntervalMinutes";

const DEFAULT_CHECK_MIN = 30;
const MIN_CHECK_MIN = 5;

function updateCheckMs() {
  const n = parseInt(
    dbm.getSetting(
      CHECK_INTERVAL_SETTING,
      DEFAULT_CHECK_MIN
    ),
    10
  );

  const minutes =
    Number.isFinite(n) && n > 0
      ? Math.max(
          MIN_CHECK_MIN,
          n
        )
      : DEFAULT_CHECK_MIN;

  return minutes * 60 * 1000;
}

async function maybeAutoCheckUpdates(
  now = Date.now()
) {
  const last =
    Number(
      dbm.getSetting(
        LAST_CHECK_SETTING,
        0
      )
    ) || 0;

  if (
    now - last <
    updateCheckMs()
  ) {
    return;
  }

  dbm.setSetting(
    LAST_CHECK_SETTING,
    now
  );

  try {
    await checkUpdates();
  } catch {
    // offline — try again next window
  }
}

const AUTO_UPDATE_WARN = {
  leadMinutes: 5,
  intervalMinutes: 1,
};

async function runAutoUpdates() {
  if (
    dbm.getSetting(
      "autoUpdateEnabled",
      false
    ) !== true
  ) {
    return;
  }

  if (ST.autoUpdating) return;

  ST.autoUpdating = true;

  try {
    for (const w of dbm.listWorlds()) {
      if (
        !w.build_id ||
        !w.latest_known_build_id
      ) {
        continue;
      }

      if (
        w.build_id ===
        w.latest_known_build_id
      ) {
        continue;
      }

      if (
        ST.updating.has(
          w.world_id
        )
      ) {
        continue;
      }

      dbm.logEvent(
        w.world_id,
        "update",
        `Auto-update: new build ${w.latest_known_build_id} detected — warning players for 5 minutes, then updating`
      );

      try {
        await notify(
          w.world_id,
          "update",
          `${w.display_name}: a new Palworld build is out — auto-updating in 5 minutes`
        );
      } catch {}

      try {
        await updateWorld(
          w.world_id,
          () => {},
          null,
          {
            warn: AUTO_UPDATE_WARN,
          }
        );
      } catch (e) {
        dbm.logEvent(
          w.world_id,
          "update",
          `Auto-update failed: ${e.message}`
        );
      }
    }
  } finally {
    ST.autoUpdating = false;
  }
}

async function checkUpdates() {
  const latest =
    await steam.fetchLatestBuildId();

  if (!latest) {
    return {
      latest: null,
      worlds: [],
    };
  }

  dbm.setSetting(
    LAST_CHECK_SETTING,
    Date.now()
  );

  const flagged = [];

  for (const w of dbm.listWorlds()) {
    dbm.updateWorld(
      w.world_id,
      {
        latest_known_build_id:
          latest,
      }
    );

    if (
      w.build_id &&
      w.build_id !== latest
    ) {
      flagged.push(
        w.world_id
      );
    }
  }

  return {
    latest,
    worlds: flagged,
  };
}

async function updateWorld(
  worldId,
  onLog = () => {},
  jobId = null,
  opts = {}
) {
  const emit = (l) => {
    onLog(l);

    if (jobId) {
      jobs.logJob(
        jobId,
        l
      );
    }
  };

  const phase = (p, m) => {
    if (jobId) {
      jobs.setPhase(
        jobId,
        p,
        m
      );
    }
  };

  if (
    ST.updating.has(worldId)
  ) {
    if (jobId) {
      jobs.finishJob(
        jobId,
        false,
        {
          worldId,
          error: "Already updating",
        }
      );
    }

    return {
      skipped:
        "already updating",
    };
  }

  ST.updating.add(worldId);

  const w = dbm.getWorld(
    worldId
  );

  try {
    const wasRunning =
      sup.isAlive(worldId);

    if (wasRunning) {
      const {
        finalWaittime,
      } =
        await warn.runPreShutdownWarning(
          worldId,
          sup.isAlive,
          opts.warn || null
        );

      phase(
        "finalizing",
        "Saving and shutting down…"
      );

      emit(
        "Saving and shutting down..."
      );

      await sup.stopWorld(
        worldId,
        {
          graceful: true,
          waittime:
            finalWaittime,
        }
      );
    }

    dbm.updateWorld(
      worldId,
      {
        status: "updating",
      }
    );

    phase(
      "backup",
      "Creating safety backup…"
    );

    emit(
      "Creating safety backup..."
    );

    await createBackup(
      worldId,
      "pre-update-safety"
    ).catch(() => {});

    if (
      !steam.steamcmdInstalled()
    ) {
      phase(
        "steamcmd",
        "Installing SteamCMD…"
      );

      emit(
        "SteamCMD not found — installing it first..."
      );

      await steam.ensureSteamCmd(
        emit
      );
    }

    phase(
      "steamcmd",
      "Running SteamCMD update…"
    );

    emit(
      "Running SteamCMD update..."
    );

    const res =
      await steam.installOrUpdate(
        w.install_dir,
        emit,
        w.platform
      );

    if (!res.ok) {
      throw new Error(
        `SteamCMD failed (code ${res.code})${
          res.detail
            ? `: ${res.detail}`
            : ""
        }`
      );
    }

    const bid =
      res.buildId ||
      steam.readInstalledBuildId(
        w.install_dir
      );

    if (bid) {
      dbm.updateWorld(
        worldId,
        {
          build_id: bid,
        }
      );
    }

    dbm.updateWorld(
      worldId,
      {
        status: "stopped",
      }
    );

    if (wasRunning) {
      phase(
        "finalizing",
        "Relaunching…"
      );

      emit("Relaunching...");

      await sup.startWorld(
        worldId
      );
    }

    dbm.logEvent(
      worldId,
      "update",
      `Updated to build ${bid || "?"}`
    );

    await notify(
      worldId,
      "update",
      `${w.display_name} updated to build ${bid || "?"}`,
      {
        build: bid || "?",
      }
    );

    if (jobId) {
      jobs.finishJob(
        jobId,
        true,
        { worldId }
      );
    }

    return {
      ok: true,
      build: bid,
    };
  } catch (e) {
    dbm.updateWorld(
      worldId,
      {
        status: "stopped",
      }
    );

    if (jobId) {
      jobs.finishJob(
        jobId,
        false,
        {
          worldId,
          error: e.message,
        }
      );
    }

    return {
      ok: false,
      error: e.message,
    };
  } finally {
    ST.updating.delete(
      worldId
    );
  }
}

async function updateAll(
  onLog = () => {}
) {
  const { worlds } =
    await checkUpdates();

  const results = [];

  for (const id of worlds) {
    const w = dbm.getWorld(id);

    const jobId =
      jobs.createJob({
        type: "update",
        worldId: id,
        worldName:
          w?.display_name || "",
      });

    onLog(
      `Updating world ${id}...`
    );

    results.push({
      worldId: id,
      ...(await updateWorld(
        id,
        onLog,
        jobId
      )),
    });
  }

  return results;
}

function startUpdateJob(worldId) {
  const w = dbm.getWorld(
    worldId
  );

  if (!w) return null;

  const jobId =
    jobs.createJob({
      type: "update",
      worldId,
      worldName:
        w.display_name || "",
    });

  updateWorld(
    worldId,
    () => {},
    jobId
  );

  return jobId;
}

module.exports = {
  ensureScheduler,
  tick,
  checkUpdates,
  maybeAutoCheckUpdates,
  runAutoUpdates,
  updateWorld,
  updateAll,
  startUpdateJob,
  fireJoinSchedules,
};