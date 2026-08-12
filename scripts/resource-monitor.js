"use strict";

const fs = require("fs");
const { execFile } = require("child_process");

const REFRESH_MS = 1000;
const GPU_SAMPLE_MS = 1000;

let previousCpu = null;
let running = true;
let started = false;

let gpuUtilization = null;
let gpuReading = false;

function readCpu() {
    const stat = fs.readFileSync("/proc/stat", "utf8");
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
        current.total - previousCpu.total;

    const idleDelta =
        current.idle - previousCpu.idle;

    previousCpu = current;

    if (totalDelta <= 0) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            100 * (1 - idleDelta / totalDelta)
        )
    );
}

function readMemory() {
    const meminfo =
        fs.readFileSync(
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
        return `${Math.round(value)} ${units[index]}`;
    }

    return `${value.toFixed(2)} ${units[index]}`;
}

function updateGpu() {
    if (gpuReading) {
        return;
    }

    gpuReading = true;

    execFile(
        "intel_gpu_top",
        [
            "-J",
            "-s",
            String(GPU_SAMPLE_MS),
            "-n",
            "2",
        ],
        {
            maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
            gpuReading = false;

            if (error) {
                gpuUtilization = null;
                return;
            }

            try {
                const data =
                    JSON.parse(stdout);

                if (
                    !Array.isArray(data) ||
                    data.length === 0
                ) {
                    gpuUtilization = null;
                    return;
                }

                const sample =
                    data[data.length - 1];

                const engines =
                    sample?.engines || {};

                const values = Object.values(
                    engines
                )
                    .map(
                        (engine) =>
                            Number(engine?.busy)
                    )
                    .filter(
                        Number.isFinite
                    );

                if (values.length === 0) {
                    gpuUtilization = null;
                    return;
                }

                /*
                 * Intel exposes separate engine
                 * utilization values.
                 *
                 * Use the busiest engine as the
                 * overall GPU utilization.
                 *
                 * For example:
                 *
                 * Render/3D = 4.5%
                 * Video     = 15.2%
                 *
                 * GPU = 15.2%
                 */
                gpuUtilization =
                    Math.max(...values);

            } catch {
                gpuUtilization = null;
            }
        }
    );
}

function getGpu() {
    return {
        utilization:
            gpuUtilization,

        /*
         * UHD 620 is an integrated GPU.
         * It does not have dedicated VRAM.
         */
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
                : `${gpu.utilization.toFixed(1)}%`
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

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

updateGpu();
render();

setInterval(() => {
    if (!running) {
        return;
    }

    updateGpu();
    render();
}, REFRESH_MS);