// lib/db.js
//
// The single registry every module reads/writes through (spec §1).
// Uses the configured SQLite backend (synchronous, embedded).

const Database = require("./sqlite");
const { P } = require("./paths");
const os = require("os");

let _db = null;

function db() {
    if (_db) {
        return _db;
    }

    _db = new Database(P.db());
    _db.pragma("journal_mode = WAL");

    migrate(_db);

    return _db;
}

/*
 * Close the database cleanly on shutdown so the WASM backend
 * releases its lock directory instead of leaving a stale one
 * behind and deadlocking the next launch.
 */
function closeDb() {
    if (!_db) {
        return;
    }

    try {
        _db.close();
    } catch {}

    _db = null;
}

if (!globalThis.__PAL_DB_EXIT_HOOK) {
    globalThis.__PAL_DB_EXIT_HOOK = true;

    for (const signal of [
        "exit",
        "SIGINT",
        "SIGTERM",
        "SIGHUP",
    ]) {
        try {
            process.on(signal, () => {
                closeDb();

                if (signal !== "exit") {
                    process.exit(0);
                }
            });
        } catch {}
    }
}

/*
 * SQLite has no "ADD COLUMN IF NOT EXISTS".
 *
 * Next.js can prerender multiple pages in parallel during
 * `next build`, and each worker may independently open this
 * database and run migrations.
 *
 * Two workers can therefore pass the column check at the
 * same time. The ALTER itself is made race-safe here.
 */
function addColumnIfMissing(database, sql) {
    try {
        database.exec(sql);
    } catch (error) {
        if (
            !/duplicate column name/i.test(
                error.message
            )
        ) {
            throw error;
        }
    }
}

function migrate(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS worlds (
            world_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            install_dir TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'linux',
            env_vars TEXT NOT NULL DEFAULT '{}',
            wine_binary TEXT NOT NULL DEFAULT 'wine',
            wine_prefix TEXT,
            wine_launch_flags TEXT NOT NULL DEFAULT '',
            game_port INTEGER NOT NULL,
            query_port INTEGER NOT NULL,
            rest_api_port INTEGER NOT NULL,
            rcon_port INTEGER NOT NULL,
            admin_password TEXT NOT NULL DEFAULT '',
            rest_api_enabled INTEGER NOT NULL DEFAULT 1,
            rcon_enabled INTEGER NOT NULL DEFAULT 0,
            process_id INTEGER,
            status TEXT NOT NULL DEFAULT 'stopped',
            autostart INTEGER NOT NULL DEFAULT 0,
            crash_guard INTEGER NOT NULL DEFAULT 1,
            build_id TEXT,
            latest_known_build_id TEXT,
            crash_count INTEGER NOT NULL DEFAULT 0,
            extra_args TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            last_started_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id TEXT,
            kind TEXT NOT NULL,
            message TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS discord_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            action TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_name TEXT,
            guild_id TEXT,
            result TEXT NOT NULL,
            detail TEXT
        );

        CREATE INDEX IF NOT EXISTS
            idx_discord_actions_world_at
            ON discord_actions(world_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS backups (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER,
            reason TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            job_type TEXT NOT NULL,
            mode TEXT NOT NULL,
            interval_hours REAL,
            interval_minutes REAL,
            time_of_day TEXT,
            message TEXT,
            join_match TEXT,
            join_delay_seconds INTEGER,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_run INTEGER,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id TEXT NOT NULL,
            user_id TEXT,
            player_name TEXT,
            event TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS deaths (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id TEXT NOT NULL,
            victim TEXT NOT NULL,
            cause TEXT,
            killer TEXT,
            killer_raw TEXT,
            killer_kind TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS ini_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id TEXT NOT NULL,
            content TEXT NOT NULL,
            note TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS broadcasts (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            message TEXT NOT NULL,
            fire_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS mods (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            package_name TEXT NOT NULL,
            display_name TEXT,
            workshop_id TEXT,
            version TEXT,
            source TEXT,
            folder TEXT,
            is_server INTEGER DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS remote_codes (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            label TEXT,
            scope TEXT NOT NULL,
            world_id TEXT,
            tabs TEXT NOT NULL DEFAULT '[]',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS remote_sessions (
            token TEXT PRIMARY KEY,
            code_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            ip TEXT,
            user_agent TEXT
        );

        CREATE INDEX IF NOT EXISTS
            idx_remote_sessions_code
            ON remote_sessions(code_id);

        CREATE TABLE IF NOT EXISTS remote_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_id TEXT,
            code_snapshot TEXT,
            ts INTEGER NOT NULL,
            action TEXT NOT NULL,
            world_id TEXT,
            detail TEXT,
            ip TEXT
        );

        CREATE INDEX IF NOT EXISTS
            idx_remote_audit_code_at
            ON remote_audit(code_id, ts DESC);
    `);

    // ---- worlds migrations ----

    let worldColumns = database
        .prepare("PRAGMA table_info(worlds)")
        .all()
        .map((column) => column.name);

    function hasWorldColumn(name) {
        return worldColumns.includes(name);
    }

    function addWorldColumn(name, sql) {
        if (hasWorldColumn(name)) {
            return;
        }

        addColumnIfMissing(database, sql);
        worldColumns.push(name);
    }

    addWorldColumn(
        "rcon_enabled",
        "ALTER TABLE worlds ADD COLUMN rcon_enabled INTEGER NOT NULL DEFAULT 0"
    );

    addWorldColumn(
        "mods_enabled",
        "ALTER TABLE worlds ADD COLUMN mods_enabled INTEGER NOT NULL DEFAULT 0"
    );

    addWorldColumn(
        "icon_data",
        "ALTER TABLE worlds ADD COLUMN icon_data TEXT"
    );

    addWorldColumn(
        "banner_data",
        "ALTER TABLE worlds ADD COLUMN banner_data TEXT"
    );

    addWorldColumn(
        "accent_color",
        "ALTER TABLE worlds ADD COLUMN accent_color TEXT"
    );

    addWorldColumn(
        "community_server",
        "ALTER TABLE worlds ADD COLUMN community_server INTEGER NOT NULL DEFAULT 0"
    );

    if (!hasWorldColumn("platform")) {
        const hostPlatform =
            os.platform() === "win32"
                ? "windows"
                : "linux";

        addWorldColumn(
            "platform",
            `ALTER TABLE worlds ADD COLUMN platform TEXT NOT NULL DEFAULT '${hostPlatform}'`
        );
    }

    addWorldColumn(
        "env_vars",
        "ALTER TABLE worlds ADD COLUMN env_vars TEXT NOT NULL DEFAULT '{}'"
    );

    addWorldColumn(
        "wine_binary",
        "ALTER TABLE worlds ADD COLUMN wine_binary TEXT NOT NULL DEFAULT 'wine'"
    );

    addWorldColumn(
        "wine_prefix",
        "ALTER TABLE worlds ADD COLUMN wine_prefix TEXT"
    );

    addWorldColumn(
        "wine_launch_flags",
        "ALTER TABLE worlds ADD COLUMN wine_launch_flags TEXT NOT NULL DEFAULT ''"
    );

    addWorldColumn(
        "legacy_perf_flags",
        "ALTER TABLE worlds ADD COLUMN legacy_perf_flags INTEGER NOT NULL DEFAULT 1"
    );

    addWorldColumn(
        "discord_webhook",
        "ALTER TABLE worlds ADD COLUMN discord_webhook TEXT NOT NULL DEFAULT ''"
    );

    addWorldColumn(
        "notify_events",
        "ALTER TABLE worlds ADD COLUMN notify_events TEXT"
    );

    addWorldColumn(
        "discord_relay_chat",
        "ALTER TABLE worlds ADD COLUMN discord_relay_chat INTEGER NOT NULL DEFAULT 0"
    );

    /*
     * Multiple Discord webhooks with per-event routing.
     *
     * JSON:
     * {
     *     hooks: [{ id, name, url }],
     *     routes: { start, stop, restart, crash, backup, update, chat }
     * }
     */
    if (!hasWorldColumn("discord_webhooks")) {
        addWorldColumn(
            "discord_webhooks",
            "ALTER TABLE worlds ADD COLUMN discord_webhooks TEXT"
        );

        try {
            const rows = database
                .prepare(`
                    SELECT
                        world_id,
                        discord_webhook,
                        discord_relay_chat,
                        notify_events
                    FROM worlds
                    WHERE discord_webhook IS NOT NULL
                      AND discord_webhook <> ''
                `)
                .all();

            for (const row of rows) {
                const url = String(
                    row.discord_webhook || ""
                ).trim();

                if (!url) {
                    continue;
                }

                let events = {};

                try {
                    events =
                        row.notify_events
                            ? JSON.parse(
                                row.notify_events
                            )
                            : null;

                    events = events || {};
                } catch {
                    events = {};
                }

                const routes = {};

                for (const kind of [
                    "start",
                    "stop",
                    "restart",
                    "crash",
                    "backup",
                    "update",
                ]) {
                    routes[kind] =
                        events[kind] === false
                            ? ""
                            : "default";
                }

                routes.chat =
                    row.discord_relay_chat
                        ? "default"
                        : "";

                const config = {
                    hooks: [
                        {
                            id: "default",
                            name: "Default Channel",
                            url,
                        },
                    ],
                    routes,
                };

                database
                    .prepare(
                        "UPDATE worlds SET discord_webhooks=? WHERE world_id=?"
                    )
                    .run(
                        JSON.stringify(config),
                        row.world_id
                    );
            }
        } catch {
            /*
             * Non-fatal. The read-time fallback still
             * covers un-migrated worlds.
             */
        }
    }

    /*
     * Remove obsolete global Discord settings.
     */
    try {
        database.exec(`
            DELETE FROM app_settings
            WHERE key IN (
                'discordWebhook',
                'notifyEvents',
                'discordRelayChat'
            )
        `);
    } catch {}

    addWorldColumn(
        "server_password",
        "ALTER TABLE worlds ADD COLUMN server_password TEXT NOT NULL DEFAULT ''"
    );

    addWorldColumn(
        "warn_enabled",
        "ALTER TABLE worlds ADD COLUMN warn_enabled INTEGER NOT NULL DEFAULT 0"
    );

    addWorldColumn(
        "warn_lead_minutes",
        "ALTER TABLE worlds ADD COLUMN warn_lead_minutes INTEGER NOT NULL DEFAULT 10"
    );

    addWorldColumn(
        "warn_interval_minutes",
        "ALTER TABLE worlds ADD COLUMN warn_interval_minutes INTEGER NOT NULL DEFAULT 2"
    );

    addWorldColumn(
        "warn_message",
        "ALTER TABLE worlds ADD COLUMN warn_message TEXT NOT NULL DEFAULT 'The server will restart in {minutes} minute(s). Please get to a safe place.'"
    );

    addWorldColumn(
        "discord_bot",
        "ALTER TABLE worlds ADD COLUMN discord_bot TEXT"
    );

    addWorldColumn(
        "notify_templates",
        "ALTER TABLE worlds ADD COLUMN notify_templates TEXT NOT NULL DEFAULT '{}'"
    );

    addWorldColumn(
        "pal_name_overrides",
        "ALTER TABLE worlds ADD COLUMN pal_name_overrides TEXT NOT NULL DEFAULT '{}'"
    );

    // ---- deaths migrations ----

    const deathColumns = database
        .prepare("PRAGMA table_info(deaths)")
        .all()
        .map((column) => column.name);

    if (!deathColumns.includes("killer_raw")) {
        addColumnIfMissing(
            database,
            "ALTER TABLE deaths ADD COLUMN killer_raw TEXT"
        );
    }

    // ---- broadcasts migrations ----

    const broadcastColumns = database
        .prepare("PRAGMA table_info(broadcasts)")
        .all()
        .map((column) => column.name);

    if (!broadcastColumns.includes("status")) {
        addColumnIfMissing(
            database,
            "ALTER TABLE broadcasts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"
        );
    }

    // ---- schedules migrations ----

    const scheduleColumns = database
        .prepare("PRAGMA table_info(schedules)")
        .all()
        .map((column) => column.name);

    function addScheduleColumn(name, sql) {
        if (!scheduleColumns.includes(name)) {
            addColumnIfMissing(database, sql);
            scheduleColumns.push(name);
        }
    }

    addScheduleColumn(
        "interval_minutes",
        "ALTER TABLE schedules ADD COLUMN interval_minutes REAL"
    );

    addScheduleColumn(
        "message",
        "ALTER TABLE schedules ADD COLUMN message TEXT"
    );

    addScheduleColumn(
        "join_match",
        "ALTER TABLE schedules ADD COLUMN join_match TEXT"
    );

    addScheduleColumn(
        "join_delay_seconds",
        "ALTER TABLE schedules ADD COLUMN join_delay_seconds INTEGER"
    );

    addScheduleColumn(
        "skip_next",
        "ALTER TABLE schedules ADD COLUMN skip_next INTEGER NOT NULL DEFAULT 0"
    );
}

// ---- generic settings kv ----

function getSetting(key, fallback = null) {
    const row = db()
        .prepare(
            "SELECT value FROM app_settings WHERE key=?"
        )
        .get(key);

    if (!row) {
        return fallback;
    }

    try {
        return JSON.parse(row.value);
    } catch {
        return row.value;
    }
}

function setSetting(key, value) {
    db()
        .prepare(`
            INSERT INTO app_settings(key, value)
            VALUES(?, ?)
            ON CONFLICT(key)
            DO UPDATE SET value=excluded.value
        `)
        .run(
            key,
            JSON.stringify(value)
        );
}

// ---- worlds ----

function listWorlds() {
    return db()
        .prepare(
            "SELECT * FROM worlds ORDER BY created_at ASC"
        )
        .all();
}

function getWorld(id) {
    return db()
        .prepare(
            "SELECT * FROM worlds WHERE world_id=?"
        )
        .get(id);
}

function insertWorld(world) {
    db()
        .prepare(`
            INSERT INTO worlds (
                world_id,
                display_name,
                install_dir,
                platform,
                env_vars,
                wine_binary,
                wine_prefix,
                wine_launch_flags,
                game_port,
                query_port,
                rest_api_port,
                rcon_port,
                admin_password,
                rest_api_enabled,
                status,
                autostart,
                crash_guard,
                build_id,
                extra_args,
                created_at
            )
            VALUES (
                @world_id,
                @display_name,
                @install_dir,
                @platform,
                @env_vars,
                @wine_binary,
                @wine_prefix,
                @wine_launch_flags,
                @game_port,
                @query_port,
                @rest_api_port,
                @rcon_port,
                @admin_password,
                @rest_api_enabled,
                @status,
                @autostart,
                @crash_guard,
                @build_id,
                @extra_args,
                @created_at
            )
        `)
        .run(world);

    return getWorld(world.world_id);
}

function updateWorld(id, patch) {
    const current = getWorld(id);

    if (!current) {
        return null;
    }

    const merged = {
        ...current,
        ...patch,
    };

    const defaults = {
        icon_data: null,
        banner_data: null,
        accent_color: null,
        community_server: 0,
        discord_webhook: "",
        notify_events: null,
        discord_relay_chat: 0,
        discord_webhooks: null,
        discord_bot: null,
        notify_templates: "{}",
        pal_name_overrides: "{}",
        server_password: "",
        warn_enabled: 0,
        warn_lead_minutes: 10,
        warn_interval_minutes: 2,
        warn_message:
            "The server will restart in {minutes} minute(s). Please get to a safe place.",
        platform: "linux",
        env_vars: "{}",
        wine_binary: "wine",
        wine_prefix: null,
        wine_launch_flags: "",
        legacy_perf_flags: 1,
    };

    for (const [key, value] of Object.entries(defaults)) {
        if (
            merged[key] === undefined ||
            (
                merged[key] === null &&
                key !== "wine_prefix"
            )
        ) {
            merged[key] = value;
        }
    }

    db()
        .prepare(`
            UPDATE worlds SET
                display_name=@display_name,
                install_dir=@install_dir,
                game_port=@game_port,
                query_port=@query_port,
                rest_api_port=@rest_api_port,
                rcon_port=@rcon_port,
                admin_password=@admin_password,
                rest_api_enabled=@rest_api_enabled,
                rcon_enabled=@rcon_enabled,
                mods_enabled=@mods_enabled,
                process_id=@process_id,
                status=@status,
                autostart=@autostart,
                crash_guard=@crash_guard,
                build_id=@build_id,
                latest_known_build_id=@latest_known_build_id,
                crash_count=@crash_count,
                extra_args=@extra_args,
                last_started_at=@last_started_at,
                icon_data=@icon_data,
                banner_data=@banner_data,
                accent_color=@accent_color,
                community_server=@community_server,
                discord_webhook=@discord_webhook,
                notify_events=@notify_events,
                discord_relay_chat=@discord_relay_chat,
                discord_webhooks=@discord_webhooks,
                discord_bot=@discord_bot,
                notify_templates=@notify_templates,
                pal_name_overrides=@pal_name_overrides,
                server_password=@server_password,
                warn_enabled=@warn_enabled,
                warn_lead_minutes=@warn_lead_minutes,
                warn_interval_minutes=@warn_interval_minutes,
                warn_message=@warn_message,
                platform=@platform,
                env_vars=@env_vars,
                wine_binary=@wine_binary,
                wine_prefix=@wine_prefix,
                wine_launch_flags=@wine_launch_flags,
                legacy_perf_flags=@legacy_perf_flags
            WHERE world_id=@world_id
        `)
        .run(merged);

    return getWorld(id);
}

function deleteWorld(id) {
    const database = db();

    database
        .prepare(
            "DELETE FROM worlds WHERE world_id=?"
        )
        .run(id);

    database
        .prepare(
            "DELETE FROM backups WHERE world_id=?"
        )
        .run(id);

    database
        .prepare(
            "DELETE FROM schedules WHERE world_id=?"
        )
        .run(id);

    database
        .prepare(
            "DELETE FROM events WHERE world_id=?"
        )
        .run(id);

    database
        .prepare(
            "DELETE FROM sessions WHERE world_id=?"
        )
        .run(id);

    database
        .prepare(
            "DELETE FROM ini_versions WHERE world_id=?"
        )
        .run(id);

    database
        .prepare(
            "DELETE FROM broadcasts WHERE world_id=?"
        )
        .run(id);
}

// ---- scheduled broadcasts ----

function listBroadcasts(worldId) {
    return db()
        .prepare(
            "SELECT * FROM broadcasts WHERE world_id=? ORDER BY fire_at ASC"
        )
        .all(worldId);
}

function insertBroadcast(broadcast) {
    db()
        .prepare(`
            INSERT INTO broadcasts (
                id,
                world_id,
                message,
                fire_at,
                created_at
            )
            VALUES (
                @id,
                @world_id,
                @message,
                @fire_at,
                @created_at
            )
        `)
        .run(broadcast);

    return db()
        .prepare(
            "SELECT * FROM broadcasts WHERE id=?"
        )
        .get(broadcast.id);
}

function updateBroadcast(id, patch) {
    const current = db()
        .prepare(
            "SELECT * FROM broadcasts WHERE id=?"
        )
        .get(id);

    if (!current) {
        return null;
    }

    const merged = {
        ...current,
        ...patch,
    };

    db()
        .prepare(`
            UPDATE broadcasts
            SET
                message=@message,
                fire_at=@fire_at,
                status=@status
            WHERE id=@id
        `)
        .run(merged);

    return db()
        .prepare(
            "SELECT * FROM broadcasts WHERE id=?"
        )
        .get(id);
}

function markBroadcastMissed(id) {
    db()
        .prepare(
            "UPDATE broadcasts SET status='missed' WHERE id=?"
        )
        .run(id);
}

function deleteBroadcast(id) {
    db()
        .prepare(
            "DELETE FROM broadcasts WHERE id=?"
        )
        .run(id);
}

function dueBroadcasts(now) {
    return db()
        .prepare(`
            SELECT *
            FROM broadcasts
            WHERE fire_at<=?
              AND status='pending'
            ORDER BY fire_at ASC
        `)
        .all(now);
}

// ---- ini version history ----

const INI_HISTORY_MAX = 100;

function insertIniVersion(
    worldId,
    content,
    note
) {
    db()
        .prepare(`
            INSERT INTO ini_versions (
                world_id,
                content,
                note,
                created_at
            )
            VALUES (?, ?, ?, ?)
        `)
        .run(
            worldId,
            content,
            note || "",
            Date.now()
        );

    db()
        .prepare(`
            DELETE FROM ini_versions
            WHERE world_id=?
              AND id NOT IN (
                  SELECT id
                  FROM ini_versions
                  WHERE world_id=?
                  ORDER BY id DESC
                  LIMIT ?
              )
        `)
        .run(
            worldId,
            worldId,
            INI_HISTORY_MAX
        );
}

function listIniVersions(
    worldId,
    limit = 100
) {
    return db()
        .prepare(`
            SELECT
                id,
                note,
                created_at,
                length(content) AS size
            FROM ini_versions
            WHERE world_id=?
            ORDER BY id DESC
            LIMIT ?
        `)
        .all(worldId, limit);
}

function getIniVersion(
    worldId,
    versionId
) {
    return db()
        .prepare(
            "SELECT * FROM ini_versions WHERE world_id=? AND id=?"
        )
        .get(worldId, versionId);
}

// ---- events ----

function logEvent(
    worldId,
    kind,
    message
) {
    db()
        .prepare(`
            INSERT INTO events (
                world_id,
                kind,
                message,
                created_at
            )
            VALUES (?, ?, ?, ?)
        `)
        .run(
            worldId,
            kind,
            message || "",
            Date.now()
        );
}

function listEvents(
    worldId,
    limit = 100
) {
    if (worldId) {
        return db()
            .prepare(`
                SELECT *
                FROM events
                WHERE world_id=?
                ORDER BY id DESC
                LIMIT ?
            `)
            .all(worldId, limit);
    }

    return db()
        .prepare(`
            SELECT *
            FROM events
            ORDER BY id DESC
            LIMIT ?
        `)
        .all(limit);
}

// ---- Discord audit ----

function logDiscordAction(row) {
    db()
        .prepare(`
            INSERT INTO discord_actions (
                world_id,
                created_at,
                action,
                user_id,
                user_name,
                guild_id,
                result,
                detail
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
            row.worldId,
            row.at || Date.now(),
            row.action,
            String(row.userId || ""),
            row.userName || "",
            row.guildId || "",
            row.result || "ok",
            row.detail || ""
        );
}

function listDiscordActions(
    worldId,
    opts = {}
) {
    const where = [
        "world_id = ?",
    ];

    const args = [
        worldId,
    ];

    if (opts.from) {
        where.push(
            "created_at >= ?"
        );
        args.push(
            Number(opts.from)
        );
    }

    if (opts.to) {
        where.push(
            "created_at <= ?"
        );
        args.push(
            Number(opts.to)
        );
    }

    if (opts.userId) {
        where.push(
            "user_id = ?"
        );
        args.push(
            String(opts.userId)
        );
    }

    if (opts.action) {
        where.push(
            "action = ?"
        );
        args.push(
            String(opts.action)
        );
    }

    if (opts.result) {
        where.push(
            "result = ?"
        );
        args.push(
            String(opts.result)
        );
    }

    const limit = Math.min(
        Math.max(
            Number(opts.limit) || 200,
            1
        ),
        1000
    );

    args.push(limit);

    return db()
        .prepare(`
            SELECT *
            FROM discord_actions
            WHERE ${where.join(" AND ")}
            ORDER BY id DESC
            LIMIT ?
        `)
        .all(...args);
}

function listDiscordActors(worldId) {
    return db()
        .prepare(`
            SELECT
                user_id,
                MAX(user_name) AS user_name,
                COUNT(*) AS n,
                MAX(created_at) AS last_at
            FROM discord_actions
            WHERE world_id=?
            GROUP BY user_id
            ORDER BY last_at DESC
        `)
        .all(worldId);
}

// ---- backups ----

function insertBackup(backup) {
    db()
        .prepare(`
            INSERT INTO backups (
                id,
                world_id,
                file_path,
                size_bytes,
                reason,
                created_at
            )
            VALUES (
                @id,
                @world_id,
                @file_path,
                @size_bytes,
                @reason,
                @created_at
            )
        `)
        .run(backup);
}

function listBackups(worldId) {
    return db()
        .prepare(`
            SELECT *
            FROM backups
            WHERE world_id=?
            ORDER BY created_at DESC
        `)
        .all(worldId);
}

function deleteBackupRow(id) {
    db()
        .prepare(
            "DELETE FROM backups WHERE id=?"
        )
        .run(id);
}

// ---- schedules ----

function listSchedules(worldId) {
    if (worldId) {
        return db()
            .prepare(`
                SELECT *
                FROM schedules
                WHERE world_id=?
                ORDER BY created_at ASC
            `)
            .all(worldId);
    }

    return db()
        .prepare(`
            SELECT *
            FROM schedules
            ORDER BY created_at ASC
        `)
        .all();
}

function insertSchedule(schedule) {
    db()
        .prepare(`
            INSERT INTO schedules (
                id,
                world_id,
                job_type,
                mode,
                interval_hours,
                interval_minutes,
                time_of_day,
                message,
                join_match,
                join_delay_seconds,
                enabled,
                created_at
            )
            VALUES (
                @id,
                @world_id,
                @job_type,
                @mode,
                @interval_hours,
                @interval_minutes,
                @time_of_day,
                @message,
                @join_match,
                @join_delay_seconds,
                @enabled,
                @created_at
            )
        `)
        .run(schedule);
}

function updateScheduleRun(id, timestamp) {
    db()
        .prepare(
            "UPDATE schedules SET last_run=? WHERE id=?"
        )
        .run(timestamp, id);
}

function setScheduleSkipNext(
    id,
    enabled
) {
    db()
        .prepare(
            "UPDATE schedules SET skip_next=? WHERE id=?"
        )
        .run(
            enabled ? 1 : 0,
            id
        );
}

function deleteSchedule(id) {
    db()
        .prepare(
            "DELETE FROM schedules WHERE id=?"
        )
        .run(id);
}

// ---- sessions ----

function logSession(
    worldId,
    userId,
    name,
    event
) {
    db()
        .prepare(`
            INSERT INTO sessions (
                world_id,
                user_id,
                player_name,
                event,
                created_at
            )
            VALUES (?, ?, ?, ?, ?)
        `)
        .run(
            worldId,
            userId,
            name,
            event,
            Date.now()
        );
}

function listSessions(
    worldId,
    limit = 50
) {
    return db()
        .prepare(`
            SELECT *
            FROM sessions
            WHERE world_id=?
              AND event IN ('join', 'leave')
            ORDER BY id DESC
            LIMIT ?
        `)
        .all(worldId, limit);
}

function allJoinSessions(
    worldId,
    sinceMs = 0
) {
    return db()
        .prepare(`
            SELECT
                user_id,
                player_name,
                created_at
            FROM sessions
            WHERE world_id=?
              AND event='join'
              AND created_at>=?
            ORDER BY created_at ASC
        `)
        .all(worldId, sinceMs);
}

// ---- deaths ----

function logDeath(worldId, death) {
    db()
        .prepare(`
            INSERT INTO deaths (
                world_id,
                victim,
                cause,
                killer,
                killer_raw,
                killer_kind,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
            worldId,
            death.victim,
            death.cause || null,
            death.killer || null,
            death.killerRaw || null,
            death.killerKind || null,
            death.at || Date.now()
        );
}

function listDeaths(
    worldId,
    limit = 50
) {
    return db()
        .prepare(`
            SELECT *
            FROM deaths
            WHERE world_id=?
            ORDER BY id DESC
            LIMIT ?
        `)
        .all(worldId, limit);
}

function seenKillers(worldId) {
    return db()
        .prepare(`
            SELECT
                killer_raw AS codename,
                killer_kind AS kind,
                COUNT(*) AS n,
                MAX(created_at) AS last_at
            FROM deaths
            WHERE world_id=?
              AND killer_raw IS NOT NULL
              AND killer_kind IN ('pal', 'npc')
            GROUP BY
                killer_raw,
                killer_kind
            ORDER BY
                n DESC,
                last_at DESC
        `)
        .all(worldId);
}

function allSeenKillers() {
    return db()
        .prepare(`
            SELECT
                killer_raw AS codename,
                killer_kind AS kind,
                COUNT(*) AS n,
                MAX(created_at) AS last_at
            FROM deaths
            WHERE killer_raw IS NOT NULL
              AND killer_kind IN ('pal', 'npc')
            GROUP BY
                killer_raw,
                killer_kind
            ORDER BY
                n DESC,
                last_at DESC
        `)
        .all();
}

function deathCounts(
    worldId,
    limit = 50
) {
    return db()
        .prepare(`
            SELECT
                victim,
                COUNT(*) AS deaths,
                MAX(created_at) AS last_at
            FROM deaths
            WHERE world_id=?
            GROUP BY victim
            ORDER BY
                deaths DESC,
                last_at DESC
            LIMIT ?
        `)
        .all(worldId, limit);
}

// ---- mods ----

function listMods(worldId) {
    return db()
        .prepare(`
            SELECT *
            FROM mods
            WHERE world_id=?
            ORDER BY created_at ASC
        `)
        .all(worldId);
}

function getMod(id) {
    return db()
        .prepare(
            "SELECT * FROM mods WHERE id=?"
        )
        .get(id);
}

function insertMod(mod) {
    db()
        .prepare(`
            INSERT INTO mods (
                id,
                world_id,
                package_name,
                display_name,
                workshop_id,
                version,
                source,
                folder,
                is_server,
                enabled,
                created_at
            )
            VALUES (
                @id,
                @world_id,
                @package_name,
                @display_name,
                @workshop_id,
                @version,
                @source,
                @folder,
                @is_server,
                @enabled,
                @created_at
            )
        `)
        .run(mod);

    return getMod(mod.id);
}

function updateMod(id, patch) {
    const current = getMod(id);

    if (!current) {
        return null;
    }

    const merged = {
        ...current,
        ...patch,
    };

    db()
        .prepare(`
            UPDATE mods SET
                package_name=@package_name,
                display_name=@display_name,
                workshop_id=@workshop_id,
                version=@version,
                source=@source,
                folder=@folder,
                is_server=@is_server,
                enabled=@enabled
            WHERE id=@id
        `)
        .run(merged);

    return getMod(id);
}

function deleteMod(id) {
    db()
        .prepare(
            "DELETE FROM mods WHERE id=?"
        )
        .run(id);
}

// ---- remote access ----

function insertRemoteCode(code) {
    db()
        .prepare(`
            INSERT INTO remote_codes (
                id,
                code,
                label,
                scope,
                world_id,
                tabs,
                enabled,
                created_at
            )
            VALUES (
                @id,
                @code,
                @label,
                @scope,
                @world_id,
                @tabs,
                @enabled,
                @created_at
            )
        `)
        .run(code);

    return getRemoteCode(code.id);
}

function listRemoteCodes() {
    return db()
        .prepare(
            "SELECT * FROM remote_codes ORDER BY created_at DESC"
        )
        .all();
}

function getRemoteCode(id) {
    return db()
        .prepare(
            "SELECT * FROM remote_codes WHERE id=?"
        )
        .get(id);
}

function getRemoteCodeByCode(code) {
    return db()
        .prepare(
            "SELECT * FROM remote_codes WHERE code=? AND enabled=1"
        )
        .get(String(code));
}

function updateRemoteCode(
    id,
    patch
) {
    const current =
        getRemoteCode(id);

    if (!current) {
        return null;
    }

    const merged = {
        ...current,
        ...patch,
    };

    if (
        merged.enabled === undefined ||
        merged.enabled === null
    ) {
        merged.enabled = 1;
    }

    db()
        .prepare(`
            UPDATE remote_codes SET
                label=@label,
                scope=@scope,
                world_id=@world_id,
                tabs=@tabs,
                enabled=@enabled,
                last_used_at=@last_used_at
            WHERE id=@id
        `)
        .run(merged);

    return getRemoteCode(id);
}

function touchRemoteCode(
    id,
    timestamp
) {
    db()
        .prepare(
            "UPDATE remote_codes SET last_used_at=? WHERE id=?"
        )
        .run(
            timestamp || Date.now(),
            id
        );
}

function deleteRemoteCode(id) {
    db()
        .prepare(
            "DELETE FROM remote_sessions WHERE code_id=?"
        )
        .run(id);

    db()
        .prepare(
            "DELETE FROM remote_codes WHERE id=?"
        )
        .run(id);
}

function createRemoteSession(session) {
    db()
        .prepare(`
            INSERT INTO remote_sessions (
                token,
                code_id,
                created_at,
                last_seen_at,
                ip,
                user_agent
            )
            VALUES (
                @token,
                @code_id,
                @created_at,
                @last_seen_at,
                @ip,
                @user_agent
            )
        `)
        .run(session);

    return db()
        .prepare(
            "SELECT * FROM remote_sessions WHERE token=?"
        )
        .get(session.token);
}

function getRemoteSession(token) {
    return db()
        .prepare(
            "SELECT * FROM remote_sessions WHERE token=?"
        )
        .get(
            String(token || "")
        );
}

function touchRemoteSession(
    token,
    timestamp
) {
    db()
        .prepare(
            "UPDATE remote_sessions SET last_seen_at=? WHERE token=?"
        )
        .run(
            timestamp || Date.now(),
            String(token || "")
        );
}

function deleteRemoteSession(token) {
    db()
        .prepare(
            "DELETE FROM remote_sessions WHERE token=?"
        )
        .run(
            String(token || "")
        );
}

function deleteSessionsForCode(codeId) {
    db()
        .prepare(
            "DELETE FROM remote_sessions WHERE code_id=?"
        )
        .run(codeId);
}

function countActiveSessions(
    codeId,
    sinceMs
) {
    const row = db()
        .prepare(`
            SELECT COUNT(*) AS n
            FROM remote_sessions
            WHERE code_id=?
              AND last_seen_at>=?
        `)
        .get(
            codeId,
            sinceMs
        );

    return row
        ? row.n
        : 0;
}

function logRemoteAudit(row) {
    db()
        .prepare(`
            INSERT INTO remote_audit (
                code_id,
                code_snapshot,
                ts,
                action,
                world_id,
                detail,
                ip
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
            row.codeId || null,
            row.codeSnapshot || null,
            row.ts || Date.now(),
            String(row.action || ""),
            row.worldId || null,
            row.detail || null,
            row.ip || null
        );
}

function listRemoteAudit(
    codeId,
    limit = 200
) {
    const count = Math.min(
        Math.max(
            Number(limit) || 200,
            1
        ),
        1000
    );

    return db()
        .prepare(`
            SELECT *
            FROM remote_audit
            WHERE code_id=?
            ORDER BY id DESC
            LIMIT ?
        `)
        .all(
            codeId,
            count
        );
}

module.exports = {
    db,
    getSetting,
    setSetting,

    listWorlds,
    getWorld,
    insertWorld,
    updateWorld,
    deleteWorld,

    logEvent,
    listEvents,

    logDiscordAction,
    listDiscordActions,
    listDiscordActors,

    insertBackup,
    listBackups,
    deleteBackupRow,

    listSchedules,
    insertSchedule,
    updateScheduleRun,
    setScheduleSkipNext,
    deleteSchedule,

    logSession,
    listSessions,
    allJoinSessions,

    logDeath,
    listDeaths,
    deathCounts,
    seenKillers,
    allSeenKillers,

    insertIniVersion,
    listIniVersions,
    getIniVersion,

    listBroadcasts,
    insertBroadcast,
    updateBroadcast,
    markBroadcastMissed,
    deleteBroadcast,
    dueBroadcasts,

    listMods,
    getMod,
    insertMod,
    updateMod,
    deleteMod,

    insertRemoteCode,
    listRemoteCodes,
    getRemoteCode,
    getRemoteCodeByCode,
    updateRemoteCode,
    touchRemoteCode,
    deleteRemoteCode,

    createRemoteSession,
    getRemoteSession,
    touchRemoteSession,
    deleteRemoteSession,
    deleteSessionsForCode,
    countActiveSessions,

    logRemoteAudit,
    listRemoteAudit,
};