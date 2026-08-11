#!/usr/bin/env node

const net = require("net");

const SOCKET =
    "/home/palworld/.config/palworld-server-manager/headless.sock";

function request(payload) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(SOCKET);

        let buffer = "";

        socket.setEncoding("utf8");

        socket.on("connect", () => {
            socket.end(
                JSON.stringify(payload) + "\n"
            );
        });

        socket.on("data", (chunk) => {
            buffer += chunk;
        });

        socket.on("end", () => {
            try {
                resolve(JSON.parse(buffer));
            } catch (error) {
                reject(
                    new Error(
                        `Invalid response from PSM: ${buffer}`
                    )
                );
            }
        });

        socket.on("error", (error) => {
            reject(error);
        });
    });
}

async function main() {
    try {
        // Get the configured worlds.
        const worldsResponse = await request({
            action: "worlds",
        });

        if (!worldsResponse.ok) {
            throw new Error(
                worldsResponse.error ||
                "Failed to get worlds"
            );
        }

        const worlds =
            worldsResponse.result?.worlds || [];

        if (worlds.length === 0) {
            console.log("No worlds configured.");
            return;
        }

        // For this first version, use the first world.
        const world = worlds[0];

        const playersResponse = await request({
            action: "players",
            world_id: world.world_id,
        });

        if (!playersResponse.ok) {
            throw new Error(
                playersResponse.error ||
                "Failed to get players"
            );
        }

        const result =
            playersResponse.result || {};

        const players =
            Array.isArray(result.players)
                ? result.players
                : [];

        console.log(
            `World: ${world.display_name}`
        );

        console.log(
            `Players Online: ${players.length}`
        );

        console.log("");

        if (players.length === 0) {
            console.log("No players online.");
            return;
        }

        for (const player of players) {
            console.log(player.name || "Unknown");

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
                    `  Ping: ${Number(player.ping).toFixed(2)} ms`
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
    } catch (error) {
        console.error(
            `Error: ${error?.message || error}`
        );

        process.exitCode = 1;
    }
}

main();