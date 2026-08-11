// lib/autostart.js
//
// Palworld connection-triggered auto-start.
//
// While a world is stopped AND the Wake-up Listener schedule is enabled,
// PSM temporarily owns the world's game UDP port.
//
// When a Palworld client sends the connection packet beginning with
// 09 08 00, the listener closes the socket and asks the existing PSM
// supervisor to start the world.
//
// Auto-stop is NOT implemented here. PSM's existing presence/idle-stop
// system remains responsible for stopping empty servers.
//
// MIT-derived implementation attribution:
// Copyright (c) 2024 Nomomo
// Copyright (c) 2026 Kevin Perez - Modified work
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject
// to the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//

const dgram = require("dgram");

const dbm = require("./db");
const sup = require("./supervisor");

const GLOBAL_KEY = "__PAL_AUTOSTART";

if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
        worlds: new Map(),
        hooksInstalled: false,
    };
}

const stateStore = globalThis[GLOBAL_KEY];

const RETRY_MS = 2000;
const START_DELAY_MS = 500;

const PLAYER_PACKET_PREFIX = Buffer.from([
    0x09,
    0x08,
    0x00,
]);

const WAKEUP_JOB_TYPE = "wakeup_listener";
const WAKEUP_MODE = "listener";

/**
 * Return the persistent state object for a world.
 */
function getState(worldId) {
    let state = stateStore.worlds.get(worldId);

    if (!state) {
        state = {
            worldId,
            socket: null,
            retryTimer: null,
            wanted: false,
            starting: false,
            binding: false,
        };

        stateStore.worlds.set(
            worldId,
            state
        );
    }

    return state;
}

/**
 * Determine whether a UDP packet is a Palworld
 * player connection packet.
 */
function isPlayerConnectionPacket(data) {
    return (
        Buffer.isBuffer(data) &&
        data.length >= PLAYER_PACKET_PREFIX.length &&
        data
            .subarray(
                0,
                PLAYER_PACKET_PREFIX.length
            )
            .equals(PLAYER_PACKET_PREFIX)
    );
}

/**
 * Cancel a pending retry timer.
 */
function clearRetry(state) {
    if (!state.retryTimer) {
        return;
    }

    clearTimeout(state.retryTimer);
    state.retryTimer = null;
}

/**
 * Close the UDP listener for a world.
 */
function closeSocket(state) {
    const socket = state.socket;

    state.socket = null;
    state.binding = false;

    if (!socket) {
        return;
    }

    try {
        socket.removeAllListeners();
    } catch {}

    try {
        socket.close();
    } catch {}
}

/**
 * Check whether the world has an enabled
 * Wake-up Listener schedule.
 */
function hasWakeupSchedule(worldId) {
    return dbm
        .listSchedules(worldId)
        .some(
            (schedule) =>
                schedule.enabled &&
                schedule.job_type ===
                    WAKEUP_JOB_TYPE &&
                schedule.mode === WAKEUP_MODE
        );
}

/**
 * Determine whether the auto-start listener
 * should own the world's game port.
 */
function shouldListen(world) {
    if (!world) {
        return false;
    }

    if (
        !hasWakeupSchedule(
            world.world_id
        )
    ) {
        return false;
    }

    if (world.status !== "stopped") {
        return false;
    }

    if (sup.isAlive(world.world_id)) {
        return false;
    }

    const port = Number(
        world.game_port
    );

    return (
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65535
    );
}

/**
 * Schedule a listener retry.
 */
function scheduleRetry(worldId) {
    const state = getState(worldId);

    if (
        !state.wanted ||
        state.retryTimer
    ) {
        return;
    }

    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;

        if (state.wanted) {
            startListening(worldId);
        }
    }, RETRY_MS);

    if (state.retryTimer.unref) {
        state.retryTimer.unref();
    }
}

/**
 * Start listening for a player connection
 * on the world's game UDP port.
 */
function startListening(worldId) {
    const world = dbm.getWorld(worldId);
    const state = getState(worldId);

    if (!world) {
        return false;
    }

    state.wanted = true;

    if (!shouldListen(world)) {
        closeSocket(state);
        clearRetry(state);

        state.wanted =
            hasWakeupSchedule(worldId);

        return false;
    }

    if (
        state.socket ||
        state.binding ||
        state.starting
    ) {
        return true;
    }

    const port = Number(
        world.game_port
    );

    state.binding = true;

    /*
     * Do NOT use SO_REUSEPORT here.
     *
     * Palworld and this listener must never share
     * ownership of the game port.
     *
     * The listener owns the port while the server
     * is stopped, then closes it before Palworld
     * starts.
     */
    const socket =
        dgram.createSocket("udp4");

    state.socket = socket;

    socket.on(
        "message",
        (data, remote) => {
            if (
                !state.wanted ||
                state.starting
            ) {
                return;
            }

            if (
                !isPlayerConnectionPacket(
                    data
                )
            ) {
                return;
            }

            handlePlayerConnection(
                worldId,
                remote
            );
        }
    );

    socket.on(
        "error",
        (err) => {
            state.binding = false;

            if (
                state.socket === socket
            ) {
                state.socket = null;
            }

            try {
                socket.close();
            } catch {}

            if (!state.wanted) {
                return;
            }

            console.error(
                `[autostart] UDP listener error for ` +
                `${world.display_name} on ${port}: ` +
                `${
                    err && err.message
                        ? err.message
                        : err
                }`
            );

            scheduleRetry(worldId);
        }
    );

    socket.once(
        "listening",
        () => {
            state.binding = false;

            if (
                !state.wanted ||
                state.socket !== socket
            ) {
                try {
                    socket.close();
                } catch {}

                return;
            }

            const address =
                socket.address();

            console.log(
                `[autostart] ${world.display_name}: ` +
                `waiting for player connection on ` +
                `UDP ${address.address}:${address.port}`
            );
        }
    );

    try {
        socket.bind(
            port,
            "0.0.0.0"
        );
    } catch (err) {
        state.binding = false;
        state.socket = null;

        try {
            socket.close();
        } catch {}

        console.error(
            `[autostart] Could not bind ` +
            `${world.display_name} UDP ${port}: ` +
            `${
                err && err.message
                    ? err.message
                    : err
            }`
        );

        scheduleRetry(worldId);
    }

    return true;
}

/**
 * Stop listening for player connections.
 */
function stopListening(worldId) {
    const state = getState(worldId);

    state.wanted = false;
    state.starting = false;

    clearRetry(state);
    closeSocket(state);
}

/**
 * Synchronize the listener state with a world.
 */
function syncWorld(world) {
    if (!world) {
        return;
    }

    const state = getState(
        world.world_id
    );

    if (shouldListen(world)) {
        state.wanted = true;

        startListening(
            world.world_id
        );
    } else {
        stopListening(
            world.world_id
        );
    }
}

/**
 * Handle a detected Palworld player connection.
 */
function handlePlayerConnection(
    worldId,
    remote
) {
    const state = getState(worldId);

    if (
        !state.wanted ||
        state.starting
    ) {
        return;
    }

    const world = dbm.getWorld(worldId);

    if (
        !world ||
        !shouldListen(world)
    ) {
        stopListening(worldId);
        return;
    }

    state.starting = true;

    console.log(
        `[autostart] ${world.display_name}: ` +
        `player connection detected from ` +
        `${
            remote && remote.address
                ? remote.address
                : "unknown"
        }; starting server`
    );

    /*
     * Release the game port before asking the
     * supervisor to start Palworld.
     */
    stopListening(worldId);

    setTimeout(() => {
        const current =
            dbm.getWorld(worldId);

        if (!current) {
            state.starting = false;
            return;
        }

        if (sup.isAlive(worldId)) {
            state.starting = false;
            return;
        }

        sup
            .startWorld(worldId)
            .then(() => {
                const currentState =
                    getState(worldId);

                currentState.starting = false;

                console.log(
                    `[autostart] ${current.display_name}: ` +
                    `server start requested`
                );
            })
            .catch((err) => {
                const currentState =
                    getState(worldId);

                currentState.starting = false;

                console.error(
                    `[autostart] ${current.display_name}: ` +
                    `failed to start server:`,
                    err && err.message
                        ? err.message
                        : err
                );

                const latest =
                    dbm.getWorld(worldId);

                if (
                    latest &&
                    shouldListen(latest)
                ) {
                    currentState.wanted = true;
                    scheduleRetry(
                        worldId
                    );
                }
            });
    }, START_DELAY_MS);
}

/**
 * Initialize auto-start for all worlds.
 */
function ensureAutoStart() {
    installSupervisorHooks();

    for (const world of dbm.listWorlds()) {
        syncWorld(world);
    }
}

/**
 * Wrap supervisor lifecycle methods so the
 * auto-start listener follows server state.
 */
function installSupervisorHooks() {
    if (stateStore.hooksInstalled) {
        return;
    }

    stateStore.hooksInstalled = true;

    const originalStartWorld =
        sup.startWorld;

    const originalStopWorld =
        sup.stopWorld;

    const originalRestartWorld =
        sup.restartWorld;

    sup.startWorld =
        async function autoStartWrappedStartWorld(
            worldId,
            ...args
        ) {
            stopListening(worldId);

            try {
                const result =
                    await originalStartWorld.call(
                        this,
                        worldId,
                        ...args
                    );

                const state =
                    getState(worldId);

                state.starting = false;

                return result;
            } catch (err) {
                const state =
                    getState(worldId);

                state.starting = false;

                const world =
                    dbm.getWorld(worldId);

                if (
                    world &&
                    shouldListen(world)
                ) {
                    state.wanted = true;

                    scheduleRetry(
                        worldId
                    );
                }

                throw err;
            }
        };

    sup.stopWorld =
        async function autoStartWrappedStopWorld(
            worldId,
            ...args
        ) {
            stopListening(worldId);

            try {
                const result =
                    await originalStopWorld.call(
                        this,
                        worldId,
                        ...args
                    );

                const world =
                    dbm.getWorld(worldId);

                if (
                    world &&
                    shouldListen(world)
                ) {
                    startListening(
                        worldId
                    );
                }

                return result;
            } catch (err) {
                const world =
                    dbm.getWorld(worldId);

                if (
                    world &&
                    shouldListen(world)
                ) {
                    startListening(
                        worldId
                    );
                }

                throw err;
            }
        };

    sup.restartWorld =
        async function autoStartWrappedRestartWorld(
            worldId,
            ...args
        ) {
            stopListening(worldId);

            try {
                const result =
                    await originalRestartWorld.call(
                        this,
                        worldId,
                        ...args
                    );

                const world =
                    dbm.getWorld(worldId);

                if (
                    world &&
                    shouldListen(world)
                ) {
                    startListening(
                        worldId
                    );
                }

                return result;
            } catch (err) {
                const world =
                    dbm.getWorld(worldId);

                if (
                    world &&
                    shouldListen(world)
                ) {
                    startListening(
                        worldId
                    );
                }

                throw err;
            }
        };
}

/**
 * Shut down every active listener.
 */
function shutdown() {
    for (const state of stateStore.worlds.values()) {
        state.wanted = false;
        state.starting = false;

        clearRetry(state);
        closeSocket(state);
    }
}

module.exports = {
    ensureAutoStart,
    startListening,
    stopListening,
    syncWorld,
    shutdown,
    isPlayerConnectionPacket,
};