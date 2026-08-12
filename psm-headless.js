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
            if (!buffer) {
                reject(
                    new Error(
                        "PSM closed the connection without a response"
                    )
                );
                return;
            }

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
    const action = process.argv[2];

    if (!action) {
        console.error(
            "Usage: ./psm-headless.js players <psm-world-id>"
        );

        process.exitCode = 1;
        return;
    }

    if (action !== "players") {
        console.error(
            `Unknown action: ${action}`
        );

        process.exitCode = 1;
        return;
    }

    const worldId = process.argv[3];

    if (!worldId) {
        console.error(
            "Missing PSM world ID"
        );

        console.error(
            "Usage: ./psm-headless.js players <psm-world-id>"
        );

        process.exitCode = 1;
        return;
    }

    try {
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
    } catch (error) {
        console.error(
            `Error: ${error?.message || error}`
        );

        process.exitCode = 1;
    }
}

main();