"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

const REFRESH_MS = 1000;

let previousCpu = null;
let running = true;
let started = false;

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

        idle: idle + iowait,
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
        const match =
            line.match(
                /^(\w+):\s+(\d+)/
            );

        if (match) {
            values[match[1]] =
                Number(match[2]) *
                1024;
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
        return `${Math.round(value)} ${units[index]}`;
    }

    return `${value.toFixed(2)} ${units[index]}`;
}

function getGpu() {
    try {
        const output =
            execFileSync(
                "intel_gpu_top",
                [
                    "-J",
                    "-s",
                    "1000",
                    "-n",
                    "2",
                ],
                {
                    encoding: "utf8",
                    timeout: 5000,
                    stdio: [
                        "ignore",
                        "pipe",
                        "ignore",
                    ],
                }
            );

        const samples =
            JSON.parse(output);

        if (
            !Array.isArray(samples) ||
            samples.length === 0
        ) {
            return {
                utilization: null,
                memoryUsed: null,
                memoryTotal: null,
            };
        }

        /*
         * The first intel_gpu_top sample can be
         * very short. Use the final sample, which
         * represents approximately one second.
         */
        const sample =
            samples[samples.length - 1];

        if (
            !sample ||
            typeof sample !== "object"
        ) {
            return {
                utilization: null,
                memoryUsed: null,
                memoryTotal: null,
            };
        }

        const engines =
            sample.engines;

        if (
            !engines ||
            typeof engines !== "object"
        ) {
            return {
                utilization: null,
                memoryUsed: null,
                memoryTotal: null,
            };
        }

        const busyValues = [];

        for (const engine of Object.values(
            engines
        )) {
            if (
                !engine ||
                typeof engine !== "object"
            ) {
                continue;
            }

            const busy =
                Number(engine.busy);

            if (
                Number.isFinite(busy)
            ) {
                busyValues.push(busy);
            }
        }

        if (busyValues.length === 0) {
            return {
                utilization: null,
                memoryUsed: null,
                memoryTotal: null,
            };
        }

        /*
         * Engine percentages represent separate
         * GPU engines. Do not add them together.
         *
         * Use the busiest engine as the displayed
         * GPU utilization.
         */
        const utilization =
            Math.max(...busyValues);

        return {
            utilization:
                Number.isFinite(
                    utilization
                )
                    ? Math.max(
                        0,
                        Math.min(
                            100,
                            utilization
                        )
                    )
                    : null,

            /*
             * Intel UHD 620 uses shared system
             * memory rather than dedicated VRAM.
             */
            memoryUsed: null,
            memoryTotal: null,
        };
    } catch {
        return {
            utilization: null,
            memoryUsed: null,
            memoryTotal: null,
        };
    }
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

    process.stdout.write(
        "\x1b[2K\r"
    );

    process.exit(0);
}

process.on(
    "SIGTERM",
    stop
);

process.on(
    "SIGINT",
    stop
);

render();

setInterval(() => {
    if (running) {
        render();
    }
}, REFRESH_MS);