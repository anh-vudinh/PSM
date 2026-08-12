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
        "  ./psm-headless.js worlds restart <psm-world-id|all>"
    );

    console.error(
        "  ./psm-headless.js worlds update <psm-world-id|all>"
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
                `  Steam ID: ${player.userId.replace(
                    "steam_",
                    ""
                )}`
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

async function main() {
    const action = process.argv[2];

    if (!action) {
        usage();
        process.exitCode = 1;
        return;
    }

    try {
        if (action === "players") {
            const subcommand =
                process.argv[3];

            if (!subcommand) {
                console.error(
                    "Missing players subcommand"
                );

                console.error("");

                console.error(
                    "Usage: ./psm-headless.js players list <psm-world-id>"
                );

                process.exitCode = 1;
                return;
            }

            if (subcommand !== "list") {
                console.error(
                    `Unknown players action: ${subcommand}`
                );

                console.error("");

                console.error(
                    "Usage: ./psm-headless.js players list <psm-world-id>"
                );

                process.exitCode = 1;
                return;
            }

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