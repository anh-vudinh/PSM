import { NextResponse } from "next/server";

const crypto = require("crypto");
const dbm = require("@/lib/db");
const { ensureScheduler } = require("@/lib/scheduler");
const ra = require("@/lib/remoteauth");
const autostart = require("@/lib/autostart");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WAKEUP_JOB = "wakeup_listener";
const WAKEUP_MODE = "listener";

const JOB_TYPES = [
  "restart",
  "stop",
  "backup",
  "update",
  "system_message",
  "onscreen_notice",
  "idle_stop",
  WAKEUP_JOB,
];

const MODES = [
  "interval",
  "daily",
  "minutes",
  "on_join",
  WAKEUP_MODE,
];

const MESSAGE_JOBS = [
  "system_message",
  "onscreen_notice",
];

export async function GET(req, { params }) {
  const denied = ra.guardResponse(req, {
    worldId: params.id,
    tab: "schedule",
  });

  if (denied) return denied;

  return NextResponse.json({
    ok: true,
    schedules: dbm.listSchedules(params.id),
  });
}

export async function POST(req, { params }) {
  const denied = ra.guardResponse(req, {
    worldId: params.id,
    tab: "schedule",
    action: "schedule.create",
    mutating: true,
  });

  if (denied) return denied;

  const b = await req.json();

  const job_type = String(b.job_type || "");
  const mode = String(b.mode || "");

  if (!JOB_TYPES.includes(job_type)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid job type.",
      },
      { status: 400 }
    );
  }

  if (!MODES.includes(mode)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid schedule mode.",
      },
      { status: 400 }
    );
  }

  const isWakeupJob = job_type === WAKEUP_JOB;

  if (isWakeupJob && mode !== WAKEUP_MODE) {
    return NextResponse.json(
      {
        ok: false,
        error: "Wake-up Listener uses the listener mode.",
      },
      { status: 400 }
    );
  }

  if (!isWakeupJob && mode === WAKEUP_MODE) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The listener mode is only available for the Wake-up Listener.",
      },
      { status: 400 }
    );
  }

  const isMessageJob = MESSAGE_JOBS.includes(job_type);

  const message = String(b.message ?? "").trim();

  if (isMessageJob && !message) {
    return NextResponse.json(
      {
        ok: false,
        error: "A message is required for message jobs.",
      },
      { status: 400 }
    );
  }

  if (mode === "on_join" && !isMessageJob) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The join trigger is only available for message jobs.",
      },
      { status: 400 }
    );
  }

  if (
    job_type === "idle_stop" &&
    !["interval", "minutes"].includes(mode)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Idle auto-stop uses an hours or minutes threshold.",
      },
      { status: 400 }
    );
  }

  const join_delay_seconds =
    mode === "on_join"
      ? Math.min(
          3600,
          Math.max(
            0,
            Math.round(Number(b.join_delay_seconds) || 0)
          )
        )
      : null;

  const interval_hours =
    mode === "interval"
      ? Math.max(1, Number(b.interval_hours) || 0)
      : null;

  const interval_minutes =
    mode === "minutes"
      ? Math.max(1, Number(b.interval_minutes) || 0)
      : null;

  const time_of_day =
    mode === "daily"
      ? b.time_of_day ?? null
      : null;

  if (mode === "interval" && !interval_hours) {
    return NextResponse.json(
      {
        ok: false,
        error: "Interval hours must be at least 1.",
      },
      { status: 400 }
    );
  }

  if (mode === "minutes" && !interval_minutes) {
    return NextResponse.json(
      {
        ok: false,
        error: "Interval minutes must be at least 1.",
      },
      { status: 400 }
    );
  }

  if (
    mode === "daily" &&
    !/^\d{1,2}:\d{2}$/.test(String(time_of_day || ""))
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "A valid time is required for a daily schedule.",
      },
      { status: 400 }
    );
  }

  /*
   * Wake-up Listener is a singleton per world.
   * There is only one UDP listener per world/game port, so adding another
   * identical schedule would have no useful meaning.
   */
  if (isWakeupJob) {
    const existing = dbm
      .listSchedules(params.id)
      .find(
        (s) =>
          s.job_type === WAKEUP_JOB &&
          s.mode === WAKEUP_MODE
      );

    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A Wake-up Listener is already configured for this world.",
        },
        { status: 409 }
      );
    }
  }

  const s = {
    id: crypto.randomUUID(),
    world_id: params.id,
    job_type,
    mode,

    interval_hours: isWakeupJob
      ? null
      : interval_hours,

    interval_minutes: isWakeupJob
      ? null
      : interval_minutes,

    time_of_day: isWakeupJob
      ? null
      : time_of_day,

    message: isMessageJob
      ? message
      : null,

    join_match:
      mode === "on_join"
        ? String(b.join_match ?? "").trim() || null
        : null,

    join_delay_seconds,

    enabled: b.enabled === false ? 0 : 1,

    created_at: Date.now(),
  };

  dbm.insertSchedule(s);

  ensureScheduler();

  /*
   * Wake-up Listener is event-driven rather than handled by
   * scheduler.tick(). Sync immediately so adding the schedule
   * takes effect without waiting for the next background cycle.
   */
  if (isWakeupJob) {
    const world = dbm.getWorld(params.id);

    if (world) {
      autostart.syncWorld(world);
    }
  }

  return NextResponse.json({
    ok: true,
    schedule: s,
  });
}

export async function PATCH(req, { params }) {
  const denied = ra.guardResponse(req, {
    worldId: params.id,
    tab: "schedule",
    action: "schedule.update",
    mutating: true,
  });

  if (denied) return denied;

  const b = await req.json();

  const sid = String(
    b.id ??
      new URL(req.url).searchParams.get("sid") ??
      ""
  );

  if (!sid) {
    return NextResponse.json(
      {
        ok: false,
        error: "A schedule id is required.",
      },
      { status: 400 }
    );
  }

  const owned = dbm
    .listSchedules(params.id)
    .some((s) => s.id === sid);

  if (!owned) {
    return NextResponse.json(
      {
        ok: false,
        error: "not found",
      },
      { status: 404 }
    );
  }

  if (typeof b.skipNext === "boolean") {
    dbm.setScheduleSkipNext(sid, b.skipNext);
  }

  /*
   * The current PATCH API only exposes skipNext, so there is no
   * enable/disable path here. Keep the listener synchronized anyway
   * in case the database layer or future schedule mutation changes
   * the enabled state.
   */
  const world = dbm.getWorld(params.id);

  if (world) {
    autostart.syncWorld(world);
  }

  return NextResponse.json({
    ok: true,
  });
}

export async function DELETE(req, { params }) {
  const denied = ra.guardResponse(req, {
    worldId: params.id,
    tab: "schedule",
    action: "schedule.delete",
    mutating: true,
  });

  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("sid");

  if (id) {
    const owned = dbm
      .listSchedules(params.id)
      .some((s) => s.id === id);

    if (!owned) {
      return NextResponse.json(
        {
          ok: false,
          error: "not found",
        },
        { status: 404 }
      );
    }

    const schedule = dbm
      .listSchedules(params.id)
      .find((s) => s.id === id);

    dbm.deleteSchedule(id);

    /*
     * Removing the Wake-up Listener schedule must immediately
     * release the UDP game port if the world is currently stopped.
     */
    if (
      schedule &&
      schedule.job_type === WAKEUP_JOB
    ) {
      const world = dbm.getWorld(params.id);

      if (world) {
        autostart.syncWorld(world);
      }
    }
  }

  return NextResponse.json({
    ok: true,
  });
}