// lib/headless-control.js
//
// Local IPC control interface for the true headless PSM daemon.
//
// Linux:
//   Unix socket inside the PSM data directory.
//
// Windows:
//   Named pipe.
//
// One connection = one JSON request.
// The daemon sends exactly one JSON response, then closes the connection.
// No Next.js server or API route is involved.

const fs = require("fs");
const net = require("net");
const path = require("path");

const dbm = require("./db");
const sup = require("./supervisor");
const rest = require("./restclient");
const { createBackup } = require("./backups");
const {
    ensureScheduler,
    checkUpdates,
    updateWorld,
    updateAll,
} = require("./scheduler");

const g = globalThis;

if (!g.__PAL_HEADLESS_CONTROL) {
    g.__PAL_HEADLESS_CONTROL = {
        server: null,
        socketPath: null,
    };
}

const S = g.__PAL_HEADLESS_CONTROL;

function getSocketPath(dataDir) {
    if (process.platform === "win32") {
        return "\\\\.\\pipe\\palworld-server-manager";
    }

    return path.join(dataDir, "headless.sock");
}

function findWorld(worldId) {
    const world = dbm.getWorld(worldId);

    if (!world) {
        throw new Error(`World not found: ${worldId}`);
    }

    return world;
}

function publicWorld(world) {
    return {
        world_id: world.world_id,
        display_name: world.display_name,
        status: world.status,
        process_id: world.process_id,
        game_port: world.game_port,
        query_port: world.query_port,
        rest_api_port: world.rest_api_port,
        rest_api_enabled: !!world.rest_api_enabled,
        autostart: !!world.autostart,
    };
}

function numericOption(value, fallback) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

async function command(request) {
    const action = String(
        request?.action || ""
    ).trim();

    if (!action) {
        throw new Error("Missing action");
    }

    switch (action) {
        case "worlds":
            return {
                worlds: dbm
                    .listWorlds()
                    .map(publicWorld),
            };

        case "status": {
            const world = findWorld(
                request.world_id
            );

            return {
                world: publicWorld(world),
                alive: sup.isAlive(
                    world.world_id
                ),
                running: sup.isRunning(
                    world.world_id
                ),
                pidAlive: sup.pidAlive(
                    world.process_id
                ),
            };
        }

        case "start": {
            if (request.world_id === "all") {
                const worlds = dbm.listWorlds();
                const results = [];

                for (const world of worlds) {
                    try {
                        const result =
                            await sup.startWorld(
                                world.world_id
                            );

                        results.push({
                            world_id: world.world_id,
                            display_name: world.display_name,
                            ok: true,
                            result,
                        });
                    } catch (error) {
                        results.push({
                            world_id: world.world_id,
                            display_name: world.display_name,
                            ok: false,
                            error:
                                error?.message ||
                                String(error),
                        });
                    }
                }

                return {
                    all: true,
                    results,
                };
            }

            const world = findWorld(
                request.world_id
            );

            return await sup.startWorld(
                world.world_id
            );
        }


        case "stop": {
            const options = {
                graceful:
                    request.graceful !== false,
                waittime: numericOption(
                    request.waittime,
                    30
                ),
            };

            if (request.world_id === "all") {
                const worlds = dbm.listWorlds();
                const results = [];

                for (const world of worlds) {
                    try {
                        const result =
                            await sup.stopWorld(
                                world.world_id,
                                options
                            );

                        results.push({
                            world_id: world.world_id,
                            display_name: world.display_name,
                            ok: true,
                            result,
                        });
                    } catch (error) {
                        results.push({
                            world_id: world.world_id,
                            display_name: world.display_name,
                            ok: false,
                            error:
                                error?.message ||
                                String(error),
                        });
                    }
                }

                return {
                    all: true,
                    results,
                };
            }

            const world = findWorld(
                request.world_id
            );

            return await sup.stopWorld(
                world.world_id,
                options
            );
        }


        case "restart": {
            const waittime = numericOption(
                request.waittime,
                30
            );

            if (request.world_id === "all") {
                const worlds = dbm.listWorlds();
                const results = [];

                for (const world of worlds) {
                    try {
                        const result =
                            await sup.restartWorld(
                                world.world_id,
                                {
                                    waittime,
                                }
                            );

                        results.push({
                            world_id: world.world_id,
                            display_name: world.display_name,
                            ok: true,
                            result,
                        });
                    } catch (error) {
                        results.push({
                            world_id: world.world_id,
                            display_name: world.display_name,
                            ok: false,
                            error:
                                error?.message ||
                                String(error),
                        });
                    }
                }

                return {
                    all: true,
                    results,
                };
            }

            const world = findWorld(
                request.world_id
            );

            return await sup.restartWorld(
                world.world_id,
                {
                    waittime,
                }
            );
        }

        case "update": {
            ensureScheduler();

            if (request.world_id === "all") {
                const results =
                    await updateAll();

                return {
                    all: true,
                    results,
                };
            }

            const world = findWorld(
                request.world_id
            );

            const updateCheck =
                await checkUpdates();

            if (!updateCheck.worlds.includes(
                world.world_id
            )) {
                return {
                    world_id: world.world_id,
                    display_name: world.display_name,
                    ok: true,
                    updated: false,
                    up_to_date: true,
                    build:
                        world.build_id ||
                        null,
                    latest:
                        updateCheck.latest ||
                        null,
                };
            }

            return {
                world_id: world.world_id,
                display_name: world.display_name,
                ...(await updateWorld(
                    world.world_id
                )),
            };
        }

        case "backup": {
            if (request.world_id === "all") {
                const worlds = dbm.listWorlds();
                const results = [];

                for (const world of worlds) {
                    try {
                        const result =
                            await createBackup(
                                world.world_id,
                                "manual"
                            );

                        results.push({
                            world_id: world.world_id,
                            display_name:
                                world.display_name,
                            ok: true,
                            result,
                        });
                    } catch (error) {
                        results.push({
                            world_id: world.world_id,
                            display_name:
                                world.display_name,
                            ok: false,
                            error:
                                error?.message ||
                                String(error),
                        });
                    }
                }

                return {
                    all: true,
                    results,
                };
            }

            const world = findWorld(
                request.world_id
            );

            const result =
                await createBackup(
                    world.world_id,
                    "manual"
                );

            return {
                world_id: world.world_id,
                display_name:
                    world.display_name,
                ok: true,
                result,
            };
        }
        
        case "players": {
            const world = findWorld(
                request.world_id
            );

            if (!sup.isAlive(world.world_id)) {
                return {
                    players: [],
                    online: false,
                };
            }

            if (!world.rest_api_enabled) {
                throw new Error(
                    "REST API is disabled for this world"
                );
            }

            const result = await rest.players(
                world
            );

            return {
                online: true,
                players:
                    result &&
                    Array.isArray(result.players)
                        ? result.players
                        : [],
            };
        }

        case "announce": {
            const world = findWorld(
                request.world_id
            );

            const message = String(
                request.message || ""
            ).trim();

            if (!message) {
                throw new Error(
                    "Announce message is empty"
                );
            }

            if (!sup.isRunning(world.world_id)) {
                throw new Error(
                    "World is not running"
                );
            }

            if (!world.rest_api_enabled) {
                throw new Error(
                    "REST API is disabled for this world"
                );
            }

            await rest.announce(
                world,
                message
            );

            dbm.logEvent(
                world.world_id,
                "announce",
                `Sent native announce: ${message}`
            );

            return {
                sent: true,
                via: "rest",
            };
        }

        case "broadcast": {
            const world = findWorld(
                request.world_id
            );

            const message = String(
                request.message || ""
            ).trim();

            if (!message) {
                throw new Error(
                    "Broadcast message is empty"
                );
            }

            if (!sup.isRunning(world.world_id)) {
                throw new Error(
                    "World is not running"
                );
            }

            let via;

            if (
                sup.broadcastModInstalled(
                    world.install_dir
                )
            ) {
                sup.enqueueBroadcast(
                    world.install_dir,
                    message
                );

                via = "mod";
            } else {
                if (!world.rest_api_enabled) {
                    throw new Error(
                        "REST API is disabled and PSMBroadcast is not installed"
                    );
                }

                await rest.announce(
                    world,
                    message
                );

                via = "rest";
            }

            dbm.logEvent(
                world.world_id,
                "broadcast",
                `Sent broadcast (${via}): ${message}`
            );

            return {
                sent: true,
                via,
            };
        }

        case "kick": {
            const world = findWorld(
                request.world_id
            );

            if (!sup.isAlive(world.world_id)) {
                throw new Error(
                    "World is not running"
                );
            }

            if (!world.rest_api_enabled) {
                throw new Error(
                    "REST API is disabled for this world"
                );
            }

            const userid = String(
                request.userid || ""
            ).trim();

            if (!userid) {
                throw new Error(
                    "Missing userid"
                );
            }

            return await rest.kick(
                world,
                userid,
                request.message ||
                    "You have been kicked."
            );
        }

        case "ban": {
            const world = findWorld(
                request.world_id
            );

            if (!sup.isAlive(world.world_id)) {
                throw new Error(
                    "World is not running"
                );
            }

            if (!world.rest_api_enabled) {
                throw new Error(
                    "REST API is disabled for this world"
                );
            }

            const userid = String(
                request.userid || ""
            ).trim();

            if (!userid) {
                throw new Error(
                    "Missing userid"
                );
            }

            console.warn(
                `Warning: Palworld bUseAuth must be enabled or bans may not be enforced.`
            );

            return await rest.ban(
                world,
                userid,
                request.message ||
                    "You have been banned."
            );
        }

        case "unban": {
            const world = findWorld(
                request.world_id
            );

            if (!world.rest_api_enabled) {
                throw new Error(
                    "REST API is disabled for this world"
                );
            }

            const userid = String(
                request.userid || ""
            ).trim();

            if (!userid) {
                throw new Error(
                    "Missing userid"
                );
            }

            return await rest.unban(
                world,
                userid
            );
        }

        case "schedules": {
            const subcommand =
                String(request.subcommand || "")
                    .trim()
                    .toLowerCase();

            if (subcommand === "list") {
                const worldId =
                    request.world_id != null
                        ? String(request.world_id)
                        : null;

                return {
                    schedules: worldId
                        ? dbm.listSchedules(worldId)
                        : dbm.listSchedules(),
                };
            }

            if (
                subcommand === "enable" ||
                subcommand === "disable"
            ) {
                const scheduleId =
                    String(request.schedule_id || "")
                        .trim();

                if (!scheduleId) {
                    throw new Error(
                        "Missing schedule ID"
                    );
                }

                const schedules =
                    dbm.listSchedules();

                const schedule =
                    schedules.find(
                        (s) => s.id === scheduleId
                    );

                if (!schedule) {
                    throw new Error(
                        `Schedule not found: ${scheduleId}`
                    );
                }

                dbm.setScheduleEnabled(
                    scheduleId,
                    subcommand === "enable"
                );

                const updated =
                    dbm.listSchedules()
                        .find(
                            (s) => s.id === scheduleId
                        );

                return {
                    schedule: updated,
                };
            }

            throw new Error(
                `Unknown schedules action: ${subcommand}`
            );
        }

        default:
            throw new Error(
                `Unknown headless action: ${action}`
            );
    }
}

function send(socket, payload) {
    const data =
        JSON.stringify(payload) + "\n";

    try {
        socket.end(data);
    } catch {}
}

function handleConnection(socket) {
    let buffer = "";
    let handled = false;

    socket.setEncoding("utf8");

    socket.on("data", async (chunk) => {
        if (handled) {
            return;
        }

        buffer += chunk;

        const newline = buffer.indexOf("\n");

        if (newline === -1) {
            return;
        }

        handled = true;

        const line = buffer
            .slice(0, newline)
            .trim();

        if (!line) {
            send(socket, {
                ok: false,
                error: "Empty request",
            });
            return;
        }

        let request;

        try {
            request = JSON.parse(line);
        } catch {
            send(socket, {
                ok: false,
                error: "Invalid JSON",
            });
            return;
        }

        try {
            const result =
                await command(request);

            send(socket, {
                ok: true,
                result,
            });
        } catch (error) {
            send(socket, {
                ok: false,
                error:
                    error?.message ||
                    String(error),
            });
        }
    });

    socket.on("error", () => {});
}

function start(dataDir) {
    if (S.server) {
        return;
    }

    const target = getSocketPath(dataDir);

    S.socketPath = target;

    if (
        process.platform !== "win32" &&
        fs.existsSync(target)
    ) {
        try {
            fs.unlinkSync(target);
        } catch {}
    }

    const server = net.createServer(
        handleConnection
    );

    S.server = server;

    server.on("error", (error) => {
        console.error(
            "[headless-control] socket error:",
            error?.message || error
        );
    });

    server.listen(target, () => {
        if (process.platform !== "win32") {
            try {
                fs.chmodSync(
                    target,
                    0o600
                );
            } catch {}
        }

        console.log(
            `[headless-control] listening on ${target}`
        );
    });
}

async function stop() {
    const server = S.server;

    S.server = null;

    if (server) {
        await new Promise((resolve) => {
            try {
                server.close(resolve);
            } catch {
                resolve();
            }
        });
    }

    if (
        process.platform !== "win32" &&
        S.socketPath &&
        fs.existsSync(S.socketPath)
    ) {
        try {
            fs.unlinkSync(
                S.socketPath
            );
        } catch {}
    }

    S.socketPath = null;
}

module.exports = {
    start,
    stop,
    command,
};