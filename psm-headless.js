#!/usr/bin/env node

const net = require("net");

const SOCKET =
    "/home/palworld/.config/palworld-server-manager/headless.sock";

function request(payload) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(SOCKET);

        let buffer = "";
        let settled = false;

        socket.setEncoding("utf8");

        function fail(error) {
            if (settled) {
                return;
            }

            settled = true;
            reject(error);
        }

        socket.on("connect", () => {
            socket.write(
                JSON.stringify(payload) + "\n"
            );
        });

        socket.on("data", (chunk) => {
            buffer += chunk;
        });

        socket.on("end", () => {
            if (settled) {
                return;
            }

            if (!buffer) {
                fail(
                    new Error(
                        "PSM closed the connection without a response"
                    )
                );
                return;
            }

            try {
                settled = true;
                resolve(JSON.parse(buffer));
            } catch (error) {
                fail(
                    new Error(
                        `Invalid response from PSM: ${buffer}`
                    )
                );
            }
        });

        socket.on("error", (error) => {
            fail(error);
        });
    });
}

function usage() {
    console.error(
        "Usage:"
    );

    console.error(
        "  ./psm-headless.js players <psm-world-id>"
    );

    console.error(
        "  ./psm-headless.js worlds list"
    );

    console.error(
        "  ./psm-headless.js worlds status <psm-world-id>"
    );

    console.error(
        "  ./psm-headless.js worlds start <psm-world-id|all>"
    );

    console.error(
        "  ./psm-headless.js worlds stop <psm-world-id|all>"
    );

    console.error(
    "  ./psm-headless.js worlds graceful-stop <psm-world-id|all> <waittime> \"<message>\""
    );

    console.error(
        "  ./psm-headless.js worlds restart <psm-world-id|all>"
    );

    console.error(
        "  ./psm-headless.js worlds update <psm-world-id|all>"
    );

    console.error(
        "  ./psm-headless.js backup <psm-world-id|all>"
    );

    console.error(
    "  ./psm-headless.js schedules list <psm-world-id>"
    );

    console.error(
    "  ./psm-headless.js broadcast <psm-world-id> \"<message>\""
    );
    
}

async function players(worldId) {
    const response = await request({
        action: "players",
        world_id: worldId,
    });

    if (!response.ok) {
        throw new Error(
            response.error ||
            "Failed to get players"
        );
    }

    const result =
        response.result || {};

    const players =
        Array.isArray(result.players)
            ? result.players
            : [];

    console.log(
        `Players Online: ${players.length}`
    );

    console.log("");

    if (players.length === 0) {
        console.log("No players online.");
        return;
    }

    for (const player of players) {
        console.log(
            player.name || "Unknown"
        );

        if (player.accountName) {
            console.log(
                `  Account: ${player.accountName}`
            );
        }

        if (player.userId) {
            console.log(
                `  Player ID: ${player.userId}`
            );
        }

        if (player.iP) {
            console.log(
                `  IP: ${player.iP}`
            );
        }

        if (
            player.ping !== undefined &&
            player.ping !== null
        ) {
            console.log(
                `  Ping: ${Number(
                    player.ping
                ).toFixed(2)} ms`
            );
        }

        if (
            player.level !== undefined &&
            player.level !== null
        ) {
            console.log(
                `  Level: ${player.level}`
            );
        }

        console.log("");
    }
}

async function worldsList() {
    const response = await request({
        action: "worlds",
    });

    if (!response.ok) {
        throw new Error(
            response.error ||
            "Failed to list worlds"
        );
    }

    const worlds =
        Array.isArray(response.result?.worlds)
            ? response.result.worlds
            : [];

    if (worlds.length === 0) {
        console.log("No worlds found.");
        return;
    }

    console.log(
        `Worlds: ${worlds.length}`
    );

    console.log("");

    for (const world of worlds) {
        console.log(
            `${world.display_name || "Unnamed World"}`
        );

        console.log(
            `  World ID: ${world.world_id}`
        );

        console.log(
            `  Status: ${world.status || "unknown"}`
        );

        if (
            world.process_id !== undefined &&
            world.process_id !== null
        ) {
            console.log(
                `  Process ID: ${world.process_id}`
            );
        }

        if (
            world.game_port !== undefined &&
            world.game_port !== null
        ) {
            console.log(
                `  Game Port: ${world.game_port}`
            );
        }

        if (
            world.query_port !== undefined &&
            world.query_port !== null
        ) {
            console.log(
                `  Query Port: ${world.query_port}`
            );
        }

        if (
            world.rest_api_port !== undefined &&
            world.rest_api_port !== null
        ) {
            console.log(
                `  REST API Port: ${world.rest_api_port}`
            );
        }

        console.log(
            `  REST API Enabled: ${
                world.rest_api_enabled ? "yes" : "no"
            }`
        );

        console.log(
            `  Autostart: ${
                world.autostart ? "yes" : "no"
            }`
        );

        console.log("");
    }
}

async function worldsStatus(worldId) {
    const response = await request({
        action: "status",
        world_id: worldId,
    });

    if (!response.ok) {
        throw new Error(
            response.error ||
            "Failed to get world status"
        );
    }

    const result =
        response.result || {};

    const world =
        result.world || {};

    console.log(
        `World: ${world.display_name || "Unnamed World"}`
    );

    console.log(
        `World ID: ${world.world_id || worldId}`
    );

    console.log(
        `Status: ${world.status || "unknown"}`
    );

    console.log(
        `Running: ${result.running ? "yes" : "no"}`
    );

    console.log(
        `Alive: ${result.alive ? "yes" : "no"}`
    );

    console.log(
        `PID Alive: ${result.pidAlive ? "yes" : "no"}`
    );

    if (
        world.process_id !== undefined &&
        world.process_id !== null
    ) {
        console.log(
            `Process ID: ${world.process_id}`
        );
    }

    if (
        world.game_port !== undefined &&
        world.game_port !== null
    ) {
        console.log(
            `Game Port: ${world.game_port}`
        );
    }

    if (
        world.query_port !== undefined &&
        world.query_port !== null
    ) {
        console.log(
            `Query Port: ${world.query_port}`
        );
    }

    if (
        world.rest_api_port !== undefined &&
        world.rest_api_port !== null
    ) {
        console.log(
            `REST API Port: ${world.rest_api_port}`
        );
    }
}

async function worldsAction(action, worldId) {
    const response = await request({
        action,
        world_id: worldId,
    });

    if (!response.ok) {
        throw new Error(
            response.error ||
            `Failed to ${action} world`
        );
    }

    const result =
        response.result || {};

    if (
        result.all &&
        Array.isArray(
            result.results
        )
    ) {
        const verb = {
            start: "Started",
            stop: "Stopped",
            restart: "Restarted",
            update: "Updated",
        }[action] || action;

        console.log(
            `${verb} ${result.results.length} world(s)`
        );

        console.log("");

        for (const world of result.results) {
            const displayName =
                world.display_name ||
                world.worldName ||
                "Unknown World";

            const worldId =
                world.world_id ||
                world.worldId ||
                "Unknown";

            console.log(
                `[${world.ok ? "OK" : "FAIL"}] ${displayName}`
            );

            console.log(
                `  World ID: ${worldId}`
            );

            if (
                action === "update" &&
                world.build
            ) {
                console.log(
                    `  Build: ${world.build}`
                );
            }

            if (
                !world.ok &&
                world.error
            ) {
                console.log(
                    `  Error: ${world.error}`
                );
            }

            console.log("");
        }

        return;
    }

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}

async function backupAction(worldId) {
    const response = await request({
        action: "backup",
        world_id: worldId,
    });

    if (!response.ok) {
        throw new Error(
            response.error ||
            "Failed to create backup"
        );
    }

    const result =
        response.result || {};

    if (
        result.all &&
        Array.isArray(result.results)
    ) {
        console.log(
            `Backups completed for ${result.results.length} world(s)`
        );

        console.log("");

        for (const world of result.results) {
            const displayName =
                world.display_name ||
                "Unknown World";

            const worldId =
                world.world_id ||
                "Unknown";

            console.log(
                `[${world.ok ? "OK" : "FAIL"}] ${displayName}`
            );

            console.log(
                `  World ID: ${worldId}`
            );

            if (
                world.ok &&
                world.result
            ) {
                if (world.result.file) {
                    console.log(
                        `  File: ${world.result.file}`
                    );
                }

                if (
                    world.result.size !== undefined &&
                    world.result.size !== null
                ) {
                    console.log(
                        `  Size: ${(world.result.size / 1e6).toFixed(1)} MB`
                    );
                }
            }

            if (
                !world.ok &&
                world.error
            ) {
                console.log(
                    `  Error: ${world.error}`
                );
            }

            console.log("");
        }

        return;
    }

    console.log(
        "Backup created successfully."
    );

    console.log(
        `  World: ${result.display_name || "Unknown World"}`
    );

    console.log(
        `  World ID: ${result.world_id || worldId}`
    );

    if (result.result?.file) {
        console.log(
            `  File: ${result.result.file}`
        );
    }

    if (
        result.result?.size !== undefined &&
        result.result?.size !== null
    ) {
        console.log(
            `  Size: ${(result.result.size / 1e6).toFixed(1)} MB`
        );
    }
}

async function schedulesAction(subcommand, value) {
    const payload = {
        action: "schedules",
        subcommand,
    };

    if (subcommand === "list") {
        payload.world_id = value;
    } else {
        payload.schedule_id = value;
    }

    const response =
        await request(payload);

    if (!response.ok) {
        throw new Error(
            response.error ||
            `Failed to ${subcommand} schedule`
        );
    }

    const result =
        response.result || {};

    if (subcommand === "list") {
        const schedules =
            Array.isArray(result.schedules)
                ? result.schedules
                : [];

        if (schedules.length === 0) {
            console.log(
                "No schedules found."
            );
            return;
        }

        console.log(
            `Schedules: ${schedules.length}`
        );

        console.log("");

        for (const schedule of schedules) {
            console.log(
                `[${schedule.enabled ? "ENABLED" : "DISABLED"}] ${schedule.job_type}`
            );

            console.log(
                `  Schedule ID: ${schedule.id}`
            );

            if (
                schedule.interval_minutes !== null &&
                schedule.interval_minutes !== undefined
            ) {
                console.log(
                    `  Interval: Every ${schedule.interval_minutes} minute${
                        Number(schedule.interval_minutes) === 1
                            ? ""
                            : "s"
                    }`
                );
            } else if (
                schedule.interval_hours !== null &&
                schedule.interval_hours !== undefined
            ) {
                console.log(
                    `  Interval: Every ${schedule.interval_hours} hour${
                        Number(schedule.interval_hours) === 1
                            ? ""
                            : "s"
                    }`
                );
            } else if (schedule.time_of_day) {
                console.log(
                    `  Time: ${schedule.time_of_day}`
                );
            }

            console.log(
                `  Last Run: ${
                    schedule.last_run
                        ? new Date(
                            schedule.last_run
                        ).toLocaleString()
                        : "Never"
                }`
            );

            console.log("");
        }

        return;
    }

    const schedule =
        result.schedule || {};

    console.log(
        `Schedule ${subcommand}d successfully.`
    );

    console.log(
        `  Schedule ID: ${
            schedule.id || value
        }`
    );

    console.log(
        `  Enabled: ${
            schedule.enabled
                ? "yes"
                : "no"
        }`
    );
}

async function playersAction(action, playerId, worldId) {
    const response = await request({
        action,
        world_id: worldId,
        userid: playerId,
    });

    if (!response.ok) {
        throw new Error(
            response.error ||
            `Failed to ${action} player`
        );
    }

    const messages = {
        kick: "Player kicked successfully.",
        ban: "Player banned successfully.",
        unban: "Player unbanned successfully.",
    };

    console.log(
        messages[action] ||
        `Player ${action} completed successfully.`
    );

    console.log(
        `  Player ID: ${playerId}`
    );

    console.log(
        `  World ID: ${worldId}`
    );
}

async function broadcastAction(worldId, message) {
    const response = await request({
        action: "broadcast",
        world_id: worldId,
        message,
    });

    if (!response.ok) {
        throw new Error(
            response.error ||
            "Failed to send broadcast"
        );
    }

    const result =
        response.result || {};

    console.log(
        "Broadcast sent successfully."
    );

    console.log(
        `  World ID: ${worldId}`
    );

    if (result.via) {
        console.log(
            `  Via: ${result.via}`
        );
    }
}

async function main() {
    const action = process.argv[2];

    if (!action) {
        usage();
        process.exitCode = 1;
        return;
    }

    try {
        if (action === "broadcast") {
            const worldId =
                process.argv[3];

            const message =
                process.argv[4];

            if (!worldId) {
                console.error(
                    "Missing PSM world ID"
                );

                console.error("");

                console.error(
                    "Usage: ./psm-headless.js broadcast <psm-world-id> \"<message>\""
                );

                process.exitCode = 1;
                return;
            }

            if (!message) {
                console.error(
                    "Missing broadcast message"
                );

                console.error("");

                console.error(
                    "Usage: ./psm-headless.js broadcast <psm-world-id> \"<message>\""
                );

                process.exitCode = 1;
                return;
            }

            await broadcastAction(
                worldId,
                message
            );

            return;
        }

        if (action === "players") {
            const subcommand =
                process.argv[3];

            if (!subcommand) {
                console.error(
                    "Missing players subcommand"
                );

                console.error("");

                console.error(
                    "Usage:"
                );

                console.error(
                    "  ./psm-headless.js players list <psm-world-id>"
                );

                console.error(
                    "  ./psm-headless.js players kick <player-id> <psm-world-id>"
                );

                console.error(
                    "  ./psm-headless.js players ban <player-id> <psm-world-id>"
                );

                console.error(
                    "  ./psm-headless.js players unban <player-id> <psm-world-id>"
                );

                process.exitCode = 1;
                return;
            }

            if (subcommand === "list") {
                const worldId =
                    process.argv[4];

                if (!worldId) {
                    console.error(
                        "Missing PSM world ID"
                    );

                    console.error("");

                    console.error(
                        "Usage: ./psm-headless.js players list <psm-world-id>"
                    );

                    process.exitCode = 1;
                    return;
                }

                await players(worldId);
                return;
            }

            if (
                subcommand === "kick" ||
                subcommand === "ban" ||
                subcommand === "unban"
            ) {
                const playerId =
                    process.argv[4];

                const worldId =
                    process.argv[5];

                if (!playerId) {
                    console.error(
                        `Missing player ID for players ${subcommand}`
                    );

                    console.error("");

                    console.error(
                        `Usage: ./psm-headless.js players ${subcommand} <player-id> <psm-world-id>`
                    );

                    process.exitCode = 1;
                    return;
                }

                if (!worldId) {
                    console.error(
                        `Missing PSM world ID for players ${subcommand}`
                    );

                    console.error("");

                    console.error(
                        `Usage: ./psm-headless.js players ${subcommand} <player-id> <psm-world-id>`
                    );

                    process.exitCode = 1;
                    return;
                }

                await playersAction(
                    subcommand,
                    playerId,
                    worldId
                );

                return;
            }

            console.error(
                `Unknown players action: ${subcommand}`
            );

            console.error("");

            console.error(
                "Usage:"
            );

            console.error(
                "  ./psm-headless.js players list <psm-world-id>"
            );

            console.error(
                "  ./psm-headless.js players kick <player-id> <psm-world-id>"
            );

            console.error(
                "  ./psm-headless.js players ban <player-id> <psm-world-id>"
            );

            console.error(
                "  ./psm-headless.js players unban <player-id> <psm-world-id>"
            );

            process.exitCode = 1;
            return;
        }

        if (action === "worlds") {
            const subcommand =
                process.argv[3];

            if (!subcommand) {
                usage();
                process.exitCode = 1;
                return;
            }

            if (subcommand === "list") {
                await worldsList();
                return;
            }

            if (subcommand === "graceful-stop") {
                const worldId =
                    process.argv[4];

                const waittimeArg =
                    process.argv[5];

                const waittime =
                    Number(waittimeArg);

                const message =
                    process.argv.slice(6).join(" ").trim();

                if (!worldId) {
                    console.error(
                        "Missing PSM world ID"
                    );

                    console.error("");

                    console.error(
                        'Usage: ./psm-headless.js worlds graceful-stop <psm-world-id|all> <waittime> "<message>"'
                    );

                    process.exitCode = 1;
                    return;
                }

                if (
                    waittimeArg === undefined ||
                    waittimeArg === ""
                ) {
                    console.error(
                        "Missing graceful stop waittime"
                    );

                    console.error("");

                    console.error(
                        'Usage: ./psm-headless.js worlds graceful-stop <psm-world-id|all> <waittime> "<message>"'
                    );

                    process.exitCode = 1;
                    return;
                }

                if (
                    !Number.isFinite(waittime) ||
                    !Number.isInteger(waittime) ||
                    waittime < 1
                ) {
                    console.error(
                        "Graceful stop waittime must be a positive whole number of seconds"
                    );

                    console.error("");

                    console.error(
                        'Usage: ./psm-headless.js worlds graceful-stop <psm-world-id|all> <waittime> "<message>"'
                    );

                    process.exitCode = 1;
                    return;
                }

                if (!message) {
                    console.error(
                        "Missing graceful stop message"
                    );

                    console.error("");

                    console.error(
                        'Usage: ./psm-headless.js worlds graceful-stop <psm-world-id|all> <waittime> "<message>"'
                    );

                    process.exitCode = 1;
                    return;
                }

                const response =
                    await request({
                        action: "graceful-stop",
                        world_id: worldId,
                        waittime:
                            Number(waittime),
                        message,
                    });

                if (!response.ok) {
                    throw new Error(
                        response.error ||
                        "Failed to gracefully stop world"
                    );
                }

                const result =
                    response.result || {};

                if (
                    result.all &&
                    Array.isArray(
                        result.results
                    )
                ) {
                    console.log(
                        `Graceful shutdown scheduled for ${result.results.length} world(s)`
                    );

                    console.log("");

                    for (
                        const world of result.results
                    ) {
                        const displayName =
                            world.display_name ||
                            "Unknown World";

                        const id =
                            world.world_id ||
                            "Unknown";

                        console.log(
                            `[${world.ok ? "OK" : "FAIL"}] ${displayName}`
                        );

                        console.log(
                            `  World ID: ${id}`
                        );

                        if (world.ok) {
                            console.log(
                                `  Wait Time: ${world.result.waittime}s`
                            );

                            console.log(
                                `  Message: ${world.result.message}`
                            );
                        } else {
                            console.log(
                                `  Error: ${world.error}`
                            );
                        }

                        console.log("");
                    }

                    return;
                }

                console.log(
                    "Graceful shutdown scheduled"
                );

                console.log(
                    `Wait Time: ${result.waittime}s`
                );

                console.log(
                    `Message: ${result.message}`
                );

                return;
            }

            if (
                subcommand === "status" ||
                subcommand === "start" ||
                subcommand === "stop" ||
                subcommand === "restart" ||
                subcommand === "update"
            ) {
                const worldId =
                    process.argv[4];

                if (!worldId) {
                    console.error(
                        `Missing PSM world ID for worlds ${subcommand}`
                    );

                    console.error("");

                    if (
                        subcommand === "start" ||
                        subcommand === "stop" ||
                        subcommand === "restart" ||
                        subcommand === "update"
                    ) {
                        console.error(
                            `Usage: ./psm-headless.js worlds ${subcommand} <psm-world-id|all>`
                        );
                    } else {
                        console.error(
                            `Usage: ./psm-headless.js worlds ${subcommand} <psm-world-id>`
                        );
                    }

                    process.exitCode = 1;
                    return;
                }

                if (subcommand === "status") {
                    await worldsStatus(worldId);
                    return;
                }

                await worldsAction(
                    subcommand,
                    worldId
                );

                return;
            }

            console.error(
                `Unknown worlds action: ${subcommand}`
            );

            usage();

            process.exitCode = 1;
            return;
        }

        if (action === "backup") {
            const worldId =
                process.argv[3];

            if (!worldId) {
                console.error(
                    "Missing PSM world ID"
                );

                console.error("");

                console.error(
                    "Usage: ./psm-headless.js backup <psm-world-id|all>"
                );

                process.exitCode = 1;
                return;
            }

            await backupAction(worldId);
            return;
        }

        if (action === "schedules") {
            const subcommand =
                process.argv[3];

            if (!subcommand) {
                console.error(
                    "Missing schedules subcommand"
                );

                console.error("");

                console.error(
                    "Usage:"
                );

                console.error(
                    "  ./psm-headless.js schedules list <psm-world-id>"
                );

                console.error(
                    "  ./psm-headless.js schedules enable <schedule-id>"
                );

                console.error(
                    "  ./psm-headless.js schedules disable <schedule-id>"
                );

                process.exitCode = 1;
                return;
            }

            if (
                subcommand === "list" ||
                subcommand === "enable" ||
                subcommand === "disable"
            ) {
                const value =
                    process.argv[4];

                if (!value) {
                    console.error(
                        `Missing ${
                            subcommand === "list"
                                ? "PSM world ID"
                                : "schedule ID"
                        }`
                    );

                    console.error("");

                    console.error(
                        `Usage: ./psm-headless.js schedules ${subcommand} ${
                            subcommand === "list"
                                ? "<psm-world-id>"
                                : "<schedule-id>"
                        }`
                    );

                    process.exitCode = 1;
                    return;
                }

                await schedulesAction(
                    subcommand,
                    value
                );

                return;
            }

            console.error(
                `Unknown schedules action: ${subcommand}`
            );

            console.error("");

            console.error(
                "Usage:"
            );

            console.error(
                "  ./psm-headless.js schedules list <psm-world-id>"
            );

            console.error(
                "  ./psm-headless.js schedules enable <schedule-id>"
            );

            console.error(
                "  ./psm-headless.js schedules disable <schedule-id>"
            );

            process.exitCode = 1;
            return;
        }

        console.error(
            `Unknown action: ${action}`
        );

        usage();

        process.exitCode = 1;
    } catch (error) {
        console.error(
            `Error: ${error?.message || error}`
        );

        process.exitCode = 1;
    }
}

main();