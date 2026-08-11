const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = __dirname;

function argumentValue(name, fallback) {
    const index = process.argv.indexOf(name);

    if (index !== -1 && process.argv[index + 1]) {
        return process.argv[index + 1];
    }

    const prefix = `${name}=`;
    const inline = process.argv.find((arg) =>
        arg.startsWith(prefix)
    );

    return inline
        ? inline.slice(prefix.length)
        : fallback;
}

function hasArgument(name) {
    return process.argv.includes(name);
}

if (hasArgument("--help") || hasArgument("-h")) {
    console.log(`
Palworld Server Manager - HEADLESS DAEMON

Usage:
  npm run headless

Options:
  --data-dir <path>    PSM data directory
  --help               Show this help

The headless daemon does not start Next.js.
It directly runs the PSM backend engines.
`);

    process.exit(0);
}

const DEFAULT_DATA_DIR =
    process.platform === "linux"
        ? path.join(
            os.homedir(),
            ".config",
            "palworld-server-manager"
        )
        : path.join(
            os.homedir(),
            ".palworld-server-manager"
        );

const DATA_DIR = path.resolve(
    argumentValue(
        "--data-dir",
        process.env.PALWORLD_MANAGER_DATA_DIR ||
            DEFAULT_DATA_DIR
    )
);

const LOG_FILE = path.join(
    DATA_DIR,
    "headless.log"
);

let shuttingDown = false;

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, {
        recursive: true,
    });
}

function log(message) {
    const line =
        `[${new Date().toISOString()}] ${message}`;

    console.log(line);

    try {
        fs.appendFileSync(
            LOG_FILE,
            `${line}\n`
        );
    } catch {}
}

function installSignalHandlers() {
    const shutdown = async (signal) => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;

        log(
            `Received ${signal}. Shutting down headless PSM...`
        );

        try {
            const supervisor =
                require("./lib/supervisor");

            const worlds =
                require("./lib/db").listWorlds();

            for (const world of worlds) {
                try {
                    supervisor.stopWorld(
                        world.world_id,
                        {
                            graceful: true,
                            waittime: 0,
                        }
                    );
                } catch {}
            }
        } catch {}

        try {
            const headlessControl =
                require("./lib/headless-control");

            await headlessControl.stop();
        } catch {}

        process.exit(0);
    };

    process.on(
        "SIGINT",
        () => shutdown("SIGINT")
    );

    process.on(
        "SIGTERM",
        () => shutdown("SIGTERM")
    );

    process.on(
        "SIGHUP",
        () => shutdown("SIGHUP")
    );
}

async function main() {
    ensureDataDir();

    /*
     * These environment variables must be established BEFORE
     * any PSM library is loaded because db.js/paths.js resolve
     * their storage locations during module initialization.
     */
    process.env.PALWORLD_MANAGER_DATA_DIR =
        DATA_DIR;

    process.env.PSM_HEADLESS = "1";

    process.env.NODE_ENV =
        process.env.NODE_ENV || "production";

    if (!process.env.PALWORLD_SQLITE_BACKEND) {
        process.env.PALWORLD_SQLITE_BACKEND =
            "wasm";
    }

    if (!process.env.NODE_OPTIONS) {
        process.env.NODE_OPTIONS =
            "--no-warnings";
    } else if (
        !process.env.NODE_OPTIONS.includes(
            "--no-warnings"
        )
    ) {
        process.env.NODE_OPTIONS +=
            " --no-warnings";
    }

    installSignalHandlers();

    log("========================================");
    log(
        "Palworld Server Manager - HEADLESS DAEMON"
    );
    log("========================================");
    log(
        `Data directory: ${DATA_DIR}`
    );

    /*
     * This is the same backend bootstrap currently
     * used by /api/boot, but called directly.
     *
     * No Next.js server.
     * No HTTP request.
     * No API route.
     */
    const { boot } =
        require("./lib/bootstrap");

    boot();

    const headlessControl =
        require("./lib/headless-control");

    headlessControl.start(DATA_DIR);

    /*
     * Keep the process alive.
     *
     * The scheduler, wake-up listener, presence engine,
     * supervisor guardian, metrics sampler and Discord
     * engines all maintain their own timers/sockets.
     *
     * This interval is only a safety anchor so the daemon
     * itself remains alive even if every engine happens to
     * be temporarily idle.
     */
    setInterval(
        () => {},
        60 * 60 * 1000
    );

    log(
        "Headless daemon is fully operational."
    );

    log(
        "Next.js is NOT running."
    );

    log(
        "Wake-up listener, scheduler, supervisor, presence, metrics and Discord engines are active."
    );
}

main().catch((error) => {
    console.error(
        "HEADLESS DAEMON STARTUP FAILED"
    );

    console.error(
        error?.stack || error
    );

    try {
        ensureDataDir();

        log(
            `STARTUP FAILED: ${
                error?.message || error
            }`
        );
    } catch {}

    process.exit(1);
});