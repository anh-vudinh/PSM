"use strict";

const fs = require("fs");
const { spawn } = require("child_process");

const REFRESH_MS = 1000;

let previousCpu = null;
let running = true;
let started = false;

let gpuProcess = null;
let gpuUtilization = null;

function readCpu() {
    const stat = fs.readFileSync(
        "/proc/stat",
        "utf8"
    );

    const line = stat
        .split("\n")
        .find((line) => /^cpu\s/.test(line));

    if (!line) {
        return null;
    }

    const values = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map(Number);

    const user = values[0] || 0;
    const nice = values[1] || 0;
    const system = values[2] || 0;
    const idle = values[3] || 0;
    const iowait = values[4] || 0;
    const irq = values[5] || 0;
    const softirq = values[6] || 0;
    const steal = values[7] || 0;

    return {
        total:
            user +
            nice +
            system +
            idle +
            iowait +
            irq +
            softirq +
            steal,

        idle:
            idle +
            iowait,
    };
}

function getCpuUsage() {
    const current = readCpu();

    if (!current) {
        return 0;
    }

    if (!previousCpu) {
        previousCpu = current;
        return 0;
    }

    const totalDelta =
        current.total -
        previousCpu.total;

    const idleDelta =
        current.idle -
        previousCpu.idle;

    previousCpu = current;

    if (totalDelta <= 0) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            100 *
                (1 -
                    idleDelta /
                        totalDelta)
        )
    );
}

function readMemory() {
    const meminfo = fs.readFileSync(
        "/proc/meminfo",
        "utf8"
    );

    const values = {};

    for (const line of meminfo.split("\n")) {
        const match = line.match(
            /^(\w+):\s+(\d+)/
        );

        if (match) {
            values[match[1]] =
                Number(match[2]) * 1024;
        }
    }

    const total =
        values.MemTotal || 0;

    const available =
        values.MemAvailable ??
        (
            (values.MemFree || 0) +
            (values.Buffers || 0) +
            (values.Cached || 0)
        );

    return {
        used: Math.max(
            0,
            total - available
        ),
        total,
    };
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
        return "N/A";
    }

    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB",
    ];

    let value = bytes;
    let index = 0;

    while (
        value >= 1024 &&
        index < units.length - 1
    ) {
        value /= 1024;
        index++;
    }

    if (index === 0) {
        return `${Math.round(
            value
        )} ${units[index]}`;
    }

    return `${value.toFixed(
        2
    )} ${units[index]}`;
}

function startGpuMonitor() {
    try {
        gpuProcess = spawn(
            "intel_gpu_top",
            [
                "-J",
                "-s",
                String(REFRESH_MS),
            ],
            {
                stdio: [
                    "ignore",
                    "pipe",
                    "ignore",
                ],
            }
        );

        let buffer = "";

        gpuProcess.stdout.setEncoding(
            "utf8"
        );

        gpuProcess.stdout.on(
            "data",
            (chunk) => {
                buffer += chunk;

                /*
                 * intel_gpu_top -J outputs a
                 * continuous JSON array. Each
                 * object is one measurement.
                 *
                 * Find complete objects by
                 * looking for the end of the
                 * engines section.
                 */
                while (true) {
                    const start =
                        buffer.indexOf("{");

                    if (start === -1) {
                        buffer = "";
                        break;
                    }

                    const end =
                        findJsonObjectEnd(
                            buffer,
                            start
                        );

                    if (end === -1) {
                        if (start > 0) {
                            buffer =
                                buffer.slice(
                                    start
                                );
                        }

                        break;
                    }

                    const json =
                        buffer.slice(
                            start,
                            end + 1
                        );

                    buffer =
                        buffer.slice(
                            end + 1
                        );

                    try {
                        const sample =
                            JSON.parse(json);

                        updateGpuUsage(
                            sample
                        );
                    } catch {
                        // Ignore incomplete/
                        // malformed samples.
                    }
                }
            }
        );

        gpuProcess.on(
            "error",
            () => {
                gpuUtilization = null;
            }
        );

        gpuProcess.on(
            "exit",
            () => {
                gpuProcess = null;
                gpuUtilization = null;

                if (running) {
                    setTimeout(
                        startGpuMonitor,
                        1000
                    );
                }
            }
        );
    } catch {
        gpuProcess = null;
        gpuUtilization = null;
    }
}

function findJsonObjectEnd(
    text,
    start
) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (
        let i = start;
        i < text.length;
        i++
    ) {
        const char = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === "\\") {
                escaped = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === "{") {
            depth++;
        } else if (char === "}") {
            depth--;

            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function updateGpuUsage(sample) {
    const engines =
        sample?.engines;

    if (!engines) {
        return;
    }

    const values = Object.values(
        engines
    )
        .map((engine) =>
            Number(engine?.busy)
        )
        .filter(Number.isFinite);

    if (!values.length) {
        gpuUtilization = null;
        return;
    }

    /*
     * intel_gpu_top reports separate
     * engine utilization values.
     *
     * We use the busiest engine as the
     * overall GPU utilization rather
     * than adding them together, since
     * multiple engines can be active
     * simultaneously.
     */
    gpuUtilization = Math.max(
        ...values
    );

    gpuUtilization = Math.max(
        0,
        Math.min(
            100,
            gpuUtilization
        )
    );
}

function getGpu() {
    return {
        utilization:
            gpuUtilization,
        memoryUsed: null,
        memoryTotal: null,
    };
}

function render() {
    const cpu = getCpuUsage();
    const memory = readMemory();
    const gpu = getGpu();

    const lines = [
        "SYSTEM RESOURCE MONITOR",
        "────────────────────────",
        `CPU   ${cpu.toFixed(1)}%`,
        `RAM   ${formatBytes(
            memory.used
        )} / ${formatBytes(
            memory.total
        )}`,
        `GPU   ${
            gpu.utilization === null
                ? "N/A"
                : `${gpu.utilization.toFixed(
                      1
                  )}%`
        }`,
        `VRAM  ${
            gpu.memoryUsed !== null &&
            gpu.memoryTotal !== null
                ? `${formatBytes(
                      gpu.memoryUsed
                  )} / ${formatBytes(
                      gpu.memoryTotal
                  )}`
                : "N/A"
        }`,
    ];

    if (started) {
        process.stdout.write(
            `\x1b[${lines.length}A`
        );
    }

    for (const line of lines) {
        process.stdout.write(
            "\x1b[2K\r" +
                line +
                "\n"
        );
    }

    started = true;
}

function stop() {
    if (!running) {
        return;
    }

    running = false;

    if (gpuProcess) {
        gpuProcess.kill("SIGTERM");
        gpuProcess = null;
    }

    process.stdout.write(
        "\x1b[2K\r"
    );

    process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

startGpuMonitor();

render();

setInterval(() => {
    if (running) {
        render();
    }
}, REFRESH_MS);