## Palworld Server Manager

A desktop app for Windows and Linux that makes running one or more **Palworld dedicated
servers** simple — no command line, no editing config files by hand. Install it, point it at
a server (new or existingn), and manage everything from a clean interface.

---

## Foundation of Code

https://github.com/PrakashMandal-IV/palworld-server-manager/releases#release-v2.8.11
https://github.com/kevinnio/palworld-monitor/releases#release-v0.1.0

## Concept

Merging the functionality of Kevinnio's concept of the server wakeup listener to the schedule section of PrakashMandal-IV's GUI interface and code which acts as the foundaiton. Leaving PMIV's GUI version intact with minimal changes. Adding Headless functionality to app for linux.

## Additionally Added Concepts

- **Headless Launch** launch server and app functionality through terminal without invoking PrakashMandal-IV's GUI interface
  - psm-headless <command>

- **Headless System-wide Resource Monitor** see system-wide resource usage
  - psm-monitor <command>

## Must Do Before To Use Commands From Any Location


## Important Things to Note

- **Additional Features Were Made For Linux Server** currently untested with other OS

- **Users Must First Setup Through GUI** If running without a desktop environment, to acces the GUI install wayland or a version that can initiate the display.Requirement from PMIV's base code Nextjs expects a display. (for wayland)**cage -- "./AppImage_PATH"**

- **Headless Mode Can Not Edit Server Settings** Editing Server Parameters Must be Done Through GUI or directly through PalWorldSettings.ini

- **Headless Mode Actions Are Limited In Scope** Initiates the worlds, activate all tasks scheduled, allow for interactive admin powers..etc

**SERVER HOST COMMANDS(affects all worlds together)**
```
psm-headless start
psm-headless stop
psm-headless restart
psm-headless status
```

**PER WORLD COMMANDS**
```
psm-headless players list <world_id>
psm-headless players kick <player_id> <world_id>
psm-headless players ban <player_id> <world_id>
psm-headless players unban <player_id> <world_id>

Warning: bUseAuth must be enabled or bans may not be enforced.
```

```
psm-headless worlds list
psm-headless worlds status <world_id>
psm-headless worlds graceful-stop <world_id | all> <wait_time_seconds> "<message>"
psm-headless worlds start <world_id | all>
psm-headless worlds stop <world_id | all>
psm-headless worlds restart <world_id | all>
psm-headless worlds update <world_id | all>
```

```
psm-headless backup <world_id>  | all
```

```
psm-headless schedules list <world_id>
psm-headless schedules enable <schedule_id>
psm-headless schedules disable <schedule_id>
```

```
psm-headless broadcast <world_id> "<message>"
```

**RESOURCE MONITOR**

```
psm-monitor start
psm-monitor stop
psm-monitor help
```

> The Windows builds are not yet code-signed, so SmartScreen may show an
> "unrecognized app" warning. Click **More info → Run anyway** to proceed.

---

## Getting started

1. **Install** the app using the provided installer (Windows) or AppImage (Linux).
2. On first launch you'll see **Your worlds**. Click **New world** to create one, or use
   **Use existing** to adopt a server you already have (for example under
   `Steam\steamapps\common\PalServer`).
3. Once a world is listed, click **Start**. The first launch may take a moment while the
   server initializes.
4. Open a world and use the tabs — Overview, Players, Broadcast, Chat, Console, Settings,
   Backups, Schedule, Mods, Discord, Admin — to manage it.

---

## Connecting to your server

Open a world and look at the **Connect** box on the Overview tab. On the same PC, players
join with:

```
127.0.0.1:<game port>     (e.g. 127.0.0.1:8211)
```

In Palworld: **Join Multiplayer → Connect via IP** and paste the address.

### Letting friends join over the internet
By default your server is only reachable on your local network. To open it up you can port
forward on your router, or use a free tunneling service. The app includes a step-by-step
guide for **playit.gg** (a free option that needs no router changes) under the **Info**
section. This is a recommendation, not a requirement.

---

## Dedicated vs community servers

A **community server** is the same as a dedicated server, except it also appears in
Palworld's in-game public server browser so anyone can find and join it. It's toggled with
a launch flag. A **private/dedicated** server is joined by IP only. Either way, the app manages it the same — toggle it per world in the Admin tab.

---

## A note on settings

Palworld only applies server settings **when the server boots**, so after changing settings
you must **restart** the world for them to take effect. The app writes a minimal config
(only what you change), matching how Palworld itself stores settings — so your existing
values and any in-game choices are preserved.

Ports, the REST API, and the admin password are managed by the app automatically and aren't
shown in the settings editor, so they can't be broken by accident.

---

## Data & storage

The app stores its registry (your list of worlds and their metadata) in your user data
folder:

- **Windows (installer):** `%APPDATA%\palworld-server-manager\`
- **Windows (portable):** a `PSM-Data` folder next to the portable `.exe`
- **Linux:** `~/.config/palworld-server-manager/`

Your actual Palworld worlds, saves, and settings stay in each server's own install folder —
the app never moves them.

---

## Requirements

- Windows 10/11 (64-bit) or a modern 64-bit Linux distribution.
- Enough disk space for the Palworld dedicated server and its saves.
- For provisioning new servers: an internet connection (SteamCMD downloads the server).

---

## Building from source

Requires Node.js 22.5+.

```bash
npm install
npm run dist:win      # Windows installer + portable .exe -> release/
npm run dist:linux    # Linux AppImage                    -> release/
npm run pack          # unpacked build for testing        -> release/
```

On Windows, run the first packaging build from a terminal opened **as Administrator** (or
with Developer Mode enabled) so electron-builder can extract its tooling.

---

## Tech

Electron shell wrapping a self-contained Next.js server (App Router). Data is stored in
SQLite via a pure-WASM backend, so the app needs no native modules or database install.
All Palworld administration uses the official REST API; the deprecated RCON protocol is off
by default and opt-in only.
