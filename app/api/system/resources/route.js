import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let previousCpu = null;
let previousGpu = null;

export async function GET() {
  if (process.env.PSM_HEADLESS !== "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "System resource monitoring is available only in headless mode."
      },
      { status: 404 }
    );
  }

  try {
    const cpu = getCpuUsage();
    const memory = getMemoryUsage();
    const gpu = getGpuUsage();

    return NextResponse.json(
      {
        ok: true,
        cpu,
        memory,
        gpu
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Unable to read system resources."
      },
      { status: 500 }
    );
  }
}

function getCpuUsage() {
  const stat = fs.readFileSync("/proc/stat", "utf8");
  const line = stat.split("\n").find((line) => /^cpu\s/.test(line));

  if (!line) {
    return 0;
  }

  const values = line.trim().split(/\s+/).slice(1).map(Number);

  const user = values[0] || 0;
  const nice = values[1] || 0;
  const system = values[2] || 0;
  const idle = values[3] || 0;
  const iowait = values[4] || 0;
  const irq = values[5] || 0;
  const softirq = values[6] || 0;
  const steal = values[7] || 0;

  const total =
    user +
    nice +
    system +
    idle +
    iowait +
    irq +
    softirq +
    steal;

  const idleTotal = idle + iowait;

  if (!previousCpu) {
    previousCpu = {
      total,
      idle: idleTotal
    };

    return 0;
  }

  const totalDelta = total - previousCpu.total;
  const idleDelta = idleTotal - previousCpu.idle;

  previousCpu = {
    total,
    idle: idleTotal
  };

  if (totalDelta <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      ((totalDelta - idleDelta) / totalDelta) * 100
    )
  );
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    used,
    total,
    percent: total > 0 ? (used / total) * 100 : 0
  };
}

function getGpuUsage() {
  const drmPath = "/sys/class/drm";

  if (!fs.existsSync(drmPath)) {
    return {
      available: false,
      utilization: null,
      memoryUsed: null,
      memoryTotal: null,
      memoryShared: true,
      vendor: null,
      model: null
    };
  }

  const cards = fs
    .readdirSync(drmPath)
    .filter((name) => /^card\d+$/.test(name));

  for (const card of cards) {
    const devicePath = path.join(
      drmPath,
      card,
      "device"
    );

    if (!fs.existsSync(devicePath)) {
      continue;
    }

    const vendor = readFile(
      path.join(devicePath, "vendor")
    );

    if (vendor !== "0x8086") {
      continue;
    }

    const deviceId = readFile(
      path.join(devicePath, "device")
    );

    const utilization = getIntelEngineUsage(
      devicePath
    );

    return {
      available: utilization !== null,
      utilization,
      memoryUsed: null,
      memoryTotal: null,
      memoryShared: true,
      vendor: "Intel",
      model: deviceId === "0x5917"
        ? "UHD Graphics 620"
        : "Intel Integrated Graphics"
    };
  }

  return {
    available: false,
    utilization: null,
    memoryUsed: null,
    memoryTotal: null,
    memoryShared: true,
    vendor: null,
    model: null
  };
}

function getIntelEngineUsage(devicePath) {
  const enginePath = path.join(
    devicePath,
    "engine"
  );

  if (!fs.existsSync(enginePath)) {
    return null;
  }

  let engines;

  try {
    engines = fs
      .readdirSync(enginePath)
      .filter((name) => fs.statSync(path.join(enginePath, name)).isDirectory());
  } catch {
    return null;
  }

  if (!engines.length) {
    return null;
  }

  const samples = [];

  for (const engine of engines) {
    const busyPath = path.join(
      enginePath,
      engine,
      "busy"
    );

    if (!fs.existsSync(busyPath)) {
      continue;
    }

    const busy = readFile(busyPath);

    if (busy === null) {
      continue;
    }

    const value = Number(busy);

    if (Number.isFinite(value)) {
      samples.push({
        engine,
        busy: value
      });
    }
  }

  if (!samples.length) {
    return null;
  }

  const now = Date.now();

  if (!previousGpu) {
    previousGpu = {
      time: now,
      engines: new Map(
        samples.map((sample) => [
          sample.engine,
          sample.busy
        ])
      )
    };

    return 0;
  }

  const elapsed = now - previousGpu.time;

  if (elapsed <= 0) {
    return 0;
  }

  let totalBusy = 0;
  let count = 0;

  for (const sample of samples) {
    const previous = previousGpu.engines.get(
      sample.engine
    );

    if (previous === undefined) {
      continue;
    }

    const delta = sample.busy - previous;

    if (delta < 0) {
      continue;
    }

    const utilization =
      (delta / (elapsed * 1000000)) * 100;

    totalBusy += Math.max(
      0,
      Math.min(
        100,
        utilization
      )
    );

    count++;
  }

  previousGpu = {
    time: now,
    engines: new Map(
      samples.map((sample) => [
        sample.engine,
        sample.busy
      ])
    )
  };

  if (!count) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      totalBusy / count
    )
  );
}

function readFile(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .trim();
  } catch {
    return null;
  }
}