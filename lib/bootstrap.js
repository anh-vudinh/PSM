// lib/bootstrap.js
// Called by API routes to make sure background engines are running.

const dbm = require("./db");
const sup = require("./supervisor");
const { ensureScheduler } = require("./scheduler");
const { ensureSampler } = require("./metrics");
const { ensurePresence } = require("./presence");
const { ensureBots } = require("./discordbot");
const { ensureAutoStart } = require("./autostart");

const g = globalThis;

function boot() {
    if (g.__PAL_BOOTED) {
        return;
    }

    try {
        /*
         * Install auto-start hooks BEFORE any configured autostart world
         * is launched.
         */
        ensureAutoStart();

        sup.ensureGuardian();
        ensureScheduler();
        ensureSampler();
        ensurePresence();

        /*
         * Reconnect configured Discord bots.
         * A bot failure must never prevent PSM from booting.
         */
        try {
            ensureBots();
        } catch (e) {
            console.error(
                "discord bot boot",
                e && e.message
                    ? e.message
                    : e
            );
        }

        /*
         * Autostart worlds configured in PSM.
         *
         * autostart = start when PSM launches
         * UDP wake  = start when a player connects to a stopped world
         */
        for (const w of dbm.listWorlds()) {
            if (w.autostart) {
                sup.startWorld(w.world_id)
                    .catch((e) => {
                        console.error(
                            `autostart world ${w.world_id}`,
                            e && e.message
                                ? e.message
                                : e
                        );
                    });

                continue;
            }

            /*
             * Recover stale database state if PSM was restarted while
             * the actual server process was not running.
             */
            if (
				(w.status === "running" ||
				 w.status === "stopping") &&
				!sup.pidAlive(w.process_id)
            ) {
                dbm.updateWorld(
                    w.world_id,
                    {
                        status: "stopped",
                        process_id: null,
                    }
                );
            }
        }

        /*
         * The stale-status cleanup above may have converted worlds to
         * "stopped". Run one final pass so they receive their UDP
         * wake listener.
         */
        ensureAutoStart();

        /*
         * Only mark booted after all background engines and registry
         * initialization have completed.
         */
        g.__PAL_BOOTED = true;
    } catch (e) {
        console.error(
            "bootstrap error",
            e && e.message
                ? e.message
                : e
        );

        /*
         * Leave __PAL_BOOTED unset so a later request can retry.
         */
    }
}

module.exports = {
    boot,
};