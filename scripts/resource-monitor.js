"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

const REFRESH_MS = 1000;

let previousCpu = null;
let running = true;
let started = false;

let gpuInfo = null;
let gpuLastUpdate = 0;

/*
 * ------------------------------------------------------------
 * CPU
 * ------------------------------------------------------------
 */

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

/*
 * ------------------------------------------------------------
 * MEMORY
 * ------------------------------------------------------------
 */

function readMemory() {
    const meminfo =
        fs.readFileSync(
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

/*
 * ------------------------------------------------------------
 * FORMATTING
 * ------------------------------------------------------------
 */

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

/*
 * ------------------------------------------------------------
 * COMMAND HELPERS
 * ------------------------------------------------------------
 */

function commandExists(command) {
    try {
        execFileSync(
            "sh",
            ["-c", `command -v ${command}`],
            {
                stdio: "ignore",
            }
        );

        return true;
    } catch {
        return false;
    }
}

function readCommand(
    command,
    args
) {
    try {
        return execFileSync(
            command,
            args,
            {
                encoding: "utf8",
                stdio: [
                    "ignore",
                    "pipe",
                    "ignore",
                ],
            }
        );
    } catch {
        return null;
    }
}

/*
 * ------------------------------------------------------------
 * GPU NAME
 * ------------------------------------------------------------
 */

function getGpuName() {
    const lspci = readCommand(
        "lspci",
        []
    );

    if (lspci) {
        const lines =
            lspci.split("\n");

        for (const line of lines) {
            if (
                !/VGA compatible controller|3D controller|Display controller/i.test(
                    line
                )
            ) {
                continue;
            }

            /*
             * First try to extract the model
             * from a bracketed name.
             *
             * Example:
             *
             * Intel Corporation Kaby Lake-R GT2
             * [UHD Graphics 620] [8086:5917]
             *
             * becomes:
             *
             * UHD Graphics 620
             */
            const bracketMatches =
                line.match(
                    /\[([^\]]+)\]/g
                );

            if (bracketMatches) {
                for (
                    const bracket
                    of bracketMatches
                ) {
                    const value =
                        bracket.slice(
                            1,
                            -1
                        );

                    /*
                     * Ignore PCI vendor/device
                     * identifiers such as 8086:5917.
                     */
                    if (
                        /^[0-9a-fA-F]{4}:[0-9a-fA-F]{2,4}$/.test(
                            value
                        )
                    ) {
                        continue;
                    }

                    /*
                     * Ignore generic controller
                     * classifications.
                     */
                    if (
                        /^(VGA|3D|Display)$/i.test(
                            value
                        )
                    ) {
                        continue;
                    }

                    return value.trim();
                }
            }

            /*
             * Fallback for systems whose lspci
             * output doesn't put the model in
             * brackets.
             */
            let name = line
                .replace(
                    /^[^:]+:\s*/,
                    ""
                )
                .replace(
                    /^(VGA compatible controller|3D controller|Display controller):\s*/i,
                    ""
                )
                .replace(
                    /\[[0-9a-fA-F]{4}:[0-9a-fA-F]{2,4}\]/g,
                    ""
                )
                .trim();

            if (name) {
                return name;
            }
        }
    }

    /*
     * NVIDIA fallback.
     */
    if (commandExists("nvidia-smi")) {
        const name =
            readCommand(
                "nvidia-smi",
                [
                    "--query-gpu=name",
                    "--format=csv,noheader",
                ]
            );

        if (name) {
            const first =
                name
                    .split("\n")[0]
                    .trim();

            if (first) {
                return first;
            }
        }
    }

    return "Unknown GPU";
}

/*
 * ------------------------------------------------------------
 * INTEL GPU
 * ------------------------------------------------------------
 */

function getIntelGpu() {
    if (
        !commandExists(
            "intel_gpu_top"
        )
    ) {
        return null;
    }

    const output =
        readCommand(
            "intel_gpu_top",
            [
                "-J",
                "-s",
                "1000",
                "-n",
                "2",
            ]
        );

    if (!output) {
        return null;
    }

    try {
        const data =
            JSON.parse(output);

        if (
            !Array.isArray(data) ||
            data.length === 0
        ) {
            return null;
        }

        const sample =
            data[data.length - 1];

        const engines =
            sample.engines || {};

        let utilization = 0;

        for (
            const engine
            of Object.values(engines)
        ) {
            const busy =
                Number(engine?.busy);

            if (
                Number.isFinite(busy)
            ) {
                utilization += busy;
            }
        }

        utilization =
            Math.min(
                100,
                utilization
            );

        let memoryUsed = null;
        let memoryTotal = null;

        try {
            const memory =
                readMemory();

            memoryTotal =
                memory.total;

            const clients =
                sample.clients || {};

            let totalClientMemory = 0;

            for (
                const client
                of Object.values(clients)
            ) {
                const value =
                    Number(
                        client?.memory?.system?.total
                    );

                if (
                    Number.isFinite(value) &&
                    value > 0
                ) {
                    totalClientMemory +=
                        value;
                }
            }

            if (
                totalClientMemory > 0
            ) {
                memoryUsed =
                    Math.min(
                        totalClientMemory,
                        memoryTotal
                    );
            }
        } catch {}

        return {
            utilization,
            memoryUsed,
            memoryTotal,
            shared: true,
        };
    } catch {
        return null;
    }
}

/*
 * ------------------------------------------------------------
 * NVIDIA GPU
 * ------------------------------------------------------------
 */

function getNvidiaGpu() {
    if (
        !commandExists("nvidia-smi")
    ) {
        return null;
    }

    const output =
        readCommand(
            "nvidia-smi",
            [
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ]
        );

    if (!output) {
        return null;
    }

    const line =
        output
            .split("\n")
            .find((line) =>
                line.trim()
            );

    if (!line) {
        return null;
    }

    const parts =
        line
            .split(",")
            .map((value) =>
                Number(value.trim())
            );

    if (parts.length < 3) {
        return null;
    }

    const utilization =
        parts[0];

    const memoryUsedMB =
        parts[1];

    const memoryTotalMB =
        parts[2];

    return {
        utilization:
            Number.isFinite(
                utilization
            )
                ? utilization
                : null,

        memoryUsed:
            Number.isFinite(
                memoryUsedMB
            )
                ? memoryUsedMB *
                    1024 *
                    1024
                : null,

        memoryTotal:
            Number.isFinite(
                memoryTotalMB
            )
                ? memoryTotalMB *
                    1024 *
                    1024
                : null,

        shared: false,
    };
}

/*
 * ------------------------------------------------------------
 * AMD GPU
 * ------------------------------------------------------------
 */

function getAmdGpu() {
    try {
        const cards =
            fs.readdirSync(
                "/sys/class/drm"
            )
            .filter((name) =>
                /^card\d+$/.test(name)
            );

        for (
            const card
            of cards
        ) {
            const devicePath =
                `/sys/class/drm/${card}/device`;

            const driverPath =
                `${devicePath}/driver`;

            if (
                !fs.existsSync(
                    driverPath
                )
            ) {
                continue;
            }

            let driver;

            try {
                driver =
                    fs.readlinkSync(
                        driverPath
                    );
            } catch {
                continue;
            }

            if (
                !driver.includes(
                    "amdgpu"
                )
            ) {
                continue;
            }

            let utilization = null;
            let memoryUsed = null;
            let memoryTotal = null;

            const busyPath =
                `${devicePath}/gpu_busy_percent`;

            if (
                fs.existsSync(
                    busyPath
                )
            ) {
                const value =
                    Number(
                        fs.readFileSync(
                            busyPath,
                            "utf8"
                        ).trim()
                    );

                if (
                    Number.isFinite(
                        value
                    )
                ) {
                    utilization = value;
                }
            }

            const vramUsedPath =
                `${devicePath}/mem_info_vram_used`;

            const vramTotalPath =
                `${devicePath}/mem_info_vram_total`;

            if (
                fs.existsSync(
                    vramUsedPath
                ) &&
                fs.existsSync(
                    vramTotalPath
                )
            ) {
                const used =
                    Number(
                        fs.readFileSync(
                            vramUsedPath,
                            "utf8"
                        ).trim()
                    );

                const total =
                    Number(
                        fs.readFileSync(
                            vramTotalPath,
                            "utf8"
                        ).trim()
                    );

                if (
                    Number.isFinite(
                        used
                    ) &&
                    Number.isFinite(
                        total
                    )
                ) {
                    memoryUsed =
                        used;

                    memoryTotal =
                        total;
                }
            }

            if (
                memoryTotal === null
            ) {
                const gttUsedPath =
                    `${devicePath}/mem_info_gtt_used`;

                const gttTotalPath =
                    `${devicePath}/mem_info_gtt_total`;

                if (
                    fs.existsSync(
                        gttUsedPath
                    ) &&
                    fs.existsSync(
                        gttTotalPath
                    )
                ) {
                    const used =
                        Number(
                            fs.readFileSync(
                                gttUsedPath,
                                "utf8"
                            ).trim()
                        );

                    const total =
                        Number(
                            fs.readFileSync(
                                gttTotalPath,
                                "utf8"
                            ).trim()
                        );

                    if (
                        Number.isFinite(
                            used
                        ) &&
                        Number.isFinite(
                            total
                        )
                    ) {
                        memoryUsed =
                            used;

                        memoryTotal =
                            total;
                    }
                }
            }

            return {
                utilization,
                memoryUsed,
                memoryTotal,
                shared:
                    memoryTotal ===
                    null,
            };
        }
    } catch {}

    return null;
}

/*
 * ------------------------------------------------------------
 * GPU
 * ------------------------------------------------------------
 */

function getGpu() {
    const now = Date.now();

    if (
        gpuInfo &&
        now - gpuLastUpdate < 900
    ) {
        return gpuInfo;
    }

    const nvidia =
        getNvidiaGpu();

    if (nvidia) {
        gpuInfo = nvidia;
        gpuLastUpdate = now;
        return gpuInfo;
    }

    const intel =
        getIntelGpu();

    if (intel) {
        gpuInfo = intel;
        gpuLastUpdate = now;
        return gpuInfo;
    }

    const amd =
        getAmdGpu();

    if (amd) {
        gpuInfo = amd;
        gpuLastUpdate = now;
        return gpuInfo;
    }

    gpuInfo = {
        utilization: null,
        memoryUsed: null,
        memoryTotal: null,
        shared: false,
    };

    gpuLastUpdate = now;

    return gpuInfo;
}

/*
 * ------------------------------------------------------------
 * DISPLAY
 * ------------------------------------------------------------
 */

const GPU_NAME =
    getGpuName();

function render() {
    const cpu =
        getCpuUsage();

    const memory =
        readMemory();

    const gpu =
        getGpu();

    const gpuUtil =
        gpu.utilization === null
            ? "N/A"
            : `${gpu.utilization.toFixed(1)}%`;

    let vram = "N/A";

    if (
        gpu.memoryUsed !== null &&
        gpu.memoryTotal !== null
    ) {
        vram =
            `${formatBytes(gpu.memoryUsed)} / ${formatBytes(gpu.memoryTotal)}`;

        if (gpu.shared) {
            vram += " (shared)";
        }
    }

    const lines = [
        `SYSTEM RESOURCE MONITOR — ${GPU_NAME}`,
        "────────────────────────",
        `CPU   ${cpu.toFixed(1)}%`,
        `RAM   ${formatBytes(memory.used)} / ${formatBytes(memory.total)}`,
        `GPU   ${gpuUtil}`,
        `VRAM  ${vram}`,
    ];

    /*
     * Move back exactly six lines before
     * redrawing the monitor.
     */
    if (started) {
        process.stdout.write(
            `\x1b[${lines.length}A`
        );
    }

    for (
        const line
        of lines
    ) {
        process.stdout.write(
            "\x1b[2K\r" +
            line +
            "\n"
        );
    }

    started = true;
}

/*
 * ------------------------------------------------------------
 * SHUTDOWN
 * ------------------------------------------------------------
 */

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

/*
 * ------------------------------------------------------------
 * START
 * ------------------------------------------------------------
 */

render();

setInterval(() => {
    if (running) {
        render();
    }
}, REFRESH_MS);