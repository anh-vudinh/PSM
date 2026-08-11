// lib/jobs.js
//
// Global registry for long-running install/update jobs.
//
// Jobs live on globalThis so all Next.js route handlers within the same
// process share a single registry. Finished jobs remain available briefly
// so the UI can display completion state in the downloads tray.
//

const crypto = require("crypto");

const g = globalThis;

if (!g.__PAL_JOBS2) {
  g.__PAL_JOBS2 = new Map();
}

const JOBS = g.__PAL_JOBS2;

const MAX_LINES = 2000;
const KEEP_FINISHED_MS = 10 * 60 * 1000;

const PHASE_LABELS = {
  starting: "Starting",
  steamcmd: "Updating SteamCMD",
  prepare: "Preparing",
  download: "Downloading server files",
  verify: "Verifying files",
  install: "Installing",
  backup: "Backing up",
  settings: "Writing settings",
  finalizing: "Finishing up",
  redist: "Installing prerequisites",
};

// -----------------------------------------------------------------------------
// Job lifecycle
// -----------------------------------------------------------------------------

function createJob({
  type,
  worldId = null,
  worldName = "",
}) {
  const id = crypto.randomUUID();

  JOBS.set(id, {
    id,
    type,
    worldId,
    worldName,

    status: "running",
    phase: "starting",
    percent: null,

    message: "Starting…",
    lines: [],
    error: null,

    startedAt: Date.now(),
    endedAt: null,
  });

  prune();

  return id;
}

function getJob(id) {
  return JOBS.get(id) || null;
}

function listJobs() {
  prune();

  return [...JOBS.values()].sort((a, b) => {
    const aRunning = a.status === "running" ? 1 : 0;
    const bRunning = b.status === "running" ? 1 : 0;

    if (aRunning !== bRunning) {
      return bRunning - aRunning;
    }

    return (
      (b.endedAt || b.startedAt) -
      (a.endedAt || a.startedAt)
    );
  });
}

function setPhase(id, phase, message) {
  const job = JOBS.get(id);

  if (!job) return;

  job.phase = phase;

  if (message != null) {
    job.message = message;
  }
}

function setProgress(id, percent, message) {
  const job = JOBS.get(id);

  if (!job) return;

  if (percent != null) {
    job.percent = Math.max(
      0,
      Math.min(100, percent)
    );
  }

  if (message != null) {
    job.message = message;
  }
}

function finishJob(
  id,
  ok,
  {
    error = null,
    worldId,
  } = {}
) {
  const job = JOBS.get(id);

  if (!job) return;

  job.status = ok ? "success" : "error";
  job.error = ok ? null : error;
  job.percent = ok ? 100 : job.percent;
  job.phase = "finalizing";
  job.message = ok
    ? "Complete"
    : error || "Failed";
  job.endedAt = Date.now();

  if (worldId !== undefined) {
    job.worldId = worldId;
  }
}

// -----------------------------------------------------------------------------
// SteamCMD output parsing
// -----------------------------------------------------------------------------

/**
 * Append a raw SteamCMD log line and update job progress when possible.
 */
function logJob(id, line) {
  const job = JOBS.get(id);

  if (!job) return;

  job.lines.push(line);

  if (job.lines.length > MAX_LINES) {
    job.lines.shift();
  }

  const progress = parseSteamProgress(line);

  if (!progress) return;

  if (progress.phase) {
    job.phase = progress.phase;
  }

  // `percent: null` intentionally switches the UI back to indeterminate.
  if ("percent" in progress) {
    job.percent =
      progress.percent == null
        ? null
        : Math.max(
            0,
            Math.min(100, progress.percent)
          );
  }

  if (progress.message) {
    job.message = progress.message;
  }
}

/**
 * Parse progress from one SteamCMD stdout line.
 *
 * SteamCMD exposes two separate progress formats:
 *
 * Bootstrapper:
 *   [ 96%] Downloading update (42,697 of 43,472 KB)...
 *   [----] Installing update...
 *
 * App/depot:
 *   Update state (0x61) downloading, progress: 1.51 (...)
 *   Update state (0x5) verifying, progress: 40.00 (...)
 *   Success! App '2394010' fully installed.
 */
function parseSteamProgress(line) {
  if (typeof line !== "string") {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Format B: Palworld app/depot download
  // ---------------------------------------------------------------------------

  const updateState = line.match(
    /Update state\s*\(0x[0-9a-f]+\)\s*([a-z ]+?)\s*,\s*progress:\s*([\d.]+)/i
  );

  if (updateState) {
    const state = updateState[1]
      .trim()
      .toLowerCase();

    const rawPercent = parseFloat(
      updateState[2]
    );

    const percent = Number.isFinite(rawPercent)
      ? Math.round(rawPercent)
      : null;

    if (state.includes("download")) {
      return {
        phase: "download",
        percent,
        message: "Downloading server files…",
      };
    }

    if (state.includes("verif")) {
      return {
        phase: "verify",
        percent,
        message: "Verifying files…",
      };
    }

    if (
      state.includes("commit") ||
      state.includes("stag") ||
      state.includes("alloc")
    ) {
      return {
        phase: "install",
        percent,
        message: "Installing files…",
      };
    }

    if (state.includes("reconfig")) {
      return {
        phase: "prepare",
        percent: null,
        message: "Preparing update…",
      };
    }

    return {
      phase: "install",
      percent,
      message:
        `${state.charAt(0).toUpperCase()}${state.slice(1)}…`,
    };
  }

  // ---------------------------------------------------------------------------
  // Format A: SteamCMD bootstrapper self-update
  // ---------------------------------------------------------------------------

  const downloading = line.match(
    /\[\s*(\d+)%\]\s*Downloading update/i
  );

  if (downloading) {
    return {
      phase: "steamcmd",
      percent: parseInt(
        downloading[1],
        10
      ),
      message: "Updating SteamCMD…",
    };
  }

  const validating = line.match(
    /\[\s*(\d+)%\]\s*Validating/i
  );

  if (validating) {
    return {
      phase: "verify",
      percent: parseInt(
        validating[1],
        10
      ),
      message: "Verifying files…",
    };
  }

  if (/Extracting package/i.test(line)) {
    return {
      phase: "install",
      percent: null,
      message: "Extracting package…",
    };
  }

  if (/Applying update/i.test(line)) {
    return {
      phase: "install",
      percent: null,
      message: "Applying update…",
    };
  }

  if (/Installing update/i.test(line)) {
    return {
      phase: "install",
      percent: null,
      message: "Installing update…",
    };
  }

  if (
    /Success!\s*App/i.test(line) ||
    /fully installed/i.test(line)
  ) {
    return {
      phase: "install",
      percent: 100,
      message: "Install complete",
    };
  }

  // SteamCMD itself finished downloading. This does NOT mean the Palworld
  // application finished downloading, so deliberately remain indeterminate.
  if (/Download complete/i.test(line)) {
    return {
      phase: "install",
      percent: null,
      message: "Preparing install…",
    };
  }

  return null;
}

function phaseLabel(phase) {
  return PHASE_LABELS[phase] || "Working";
}

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

function prune() {
  const now = Date.now();

  for (const [id, job] of JOBS) {
    if (
      job.status !== "running" &&
      job.endedAt &&
      now - job.endedAt > KEEP_FINISHED_MS
    ) {
      JOBS.delete(id);
    }
  }
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  createJob,
  getJob,
  listJobs,
  setPhase,
  setProgress,
  logJob,
  finishJob,
  parseSteamProgress,
  phaseLabel,
  PHASE_LABELS,
};