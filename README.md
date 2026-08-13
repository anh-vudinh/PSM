## Palworld Server Manager w/ CLI

A desktop app for Windows and Linux that makes running one or more **Palworld dedicated
servers** simple — no command line, no editing config files by hand. Install it, point it at
a server (new or existing), and manage everything from a clean interface. You can also run it headless through CLI, with limited functions discussed in CLI.

---

## Foundation of Code

https://github.com/PrakashMandal-IV/palworld-server-manager/releases#release-v2.8.11
https://github.com/kevinnio/palworld-monitor/releases#release-v0.1.0

## Concept

Merging the functionality of Kevinnio's concept of the server wakeup listener to the schedule section of PrakashMandal-IV's GUI interface which acts as the foundaiton. Leaving PMIV's GUI version intact with minimal changes. Adding Headless functionality to run without the GUI for linux terminal only installations.

## Additionally Added Concepts

- **Headless Launch** launch server and app functionality through terminal without invoking PrakashMandal-IV's GUI interface
  - psm-headless <command>

- **Headless Admin Actions** run most admin actions necessary in headless.
  - Things that strictly still must be done in GUI: Binding World(server) to psm-gui, add or editing scheduled tasks, editing server parameters.
  - refer to CLI section for available features.

- **Headless System-wide Resource Monitor** see system-wide resource usage
  - psm-monitor <command>

## Important Things to Note

- **Additional Features Were Made For Linux Server** currently untested with other OS

- **Users Must First Setup Through GUI** If running without a desktop environment, to access the GUI install wayland or a version that can initiate the display requirement from PMIV's base code, Nextjs expects a display. [Example cage -- psm-gui start]

- **Headless Mode Can Not Edit Server Settings** Editing Server Parameters Must be Done Through GUI or directly through editing text of PalWorldSettings.ini

- **Headless Mode Actions Are Limited In Scope** Initiates the worlds, activate/deactivating all tasks scheduled, allow for interactive admin powers..etc. Refer to CLI section

## CLI

**SERVER HOST COMMANDS(affects all worlds together)**
```
psm-headless start
psm-headless stop
psm-headless restart
psm-headless status

controls the management program of all servers, if you stop this, all servers cease to be online.
```

**PER WORLD COMMANDS**
```
psm-headless players list <world_id>
psm-headless players kick <player_id> <world_id>
psm-headless players ban <player_id> <world_id>
psm-headless players unban <player_id> <world_id>

Warning: bUseAuth must be enabled or bans may not be enforced.
admin actions to players
```

```
psm-headless worlds list
psm-headless worlds status <world_id>
psm-headless worlds graceful-stop <world_id | all> <wait_time_seconds> "<message>"
psm-headless worlds start <world_id | all>
psm-headless worlds stop <world_id | all>
psm-headless worlds restart <world_id | all>
psm-headless worlds update <world_id | all>

controls the state of one world(server), or all worlds while the state of the management program psm-headless state is independent
```

```
psm-headless backup <world_id | all>

manually initiates a backup of the world or all worlds
```

```
psm-headless schedules list <world_id>
psm-headless schedules enable <schedule_id>
psm-headless schedules disable <schedule_id>

controls the active state of available schedule tasks already bound to the server through the initial setup on psm-gui
```

```
psm-headless broadcast <world_id> "<message>"

broadcasts a message to all players on the world
```

**RESOURCE MONITOR**

```
psm-monitor start
psm-monitor stop
psm-monitor help

gives a text table showing cpu,gpu,vram, ram utilization. Meant to just be used "as needed". Currently only configured for my specific two computers amd+windows11, intel+linux. If it works for you that's just bonus.
```

> The Windows builds are not yet code-signed, so SmartScreen may show an
> "unrecognized app" warning. Click **More info → Run anyway** to proceed.

---

## Getting started

(I am assuming you've already downloaded the palworld dedicated server files from steam or "another source".)

1. **Install** by downloading the source code, make sure you have the needed packages otherwise you'll need to install them as you get the errors of calling no existing commands

2. **Navigate** to the root folder of the source code where you see .gtattributes and .gitignore

3. **Run** npm run dist:linux, this will build the .AppImage in release 

4. **Run** createpaths.sh, this will establish the paths neccessary to call the program from anywhere (removepaths.sh will undo the paths made if you want to remove them in the future)

5. **Run** psm-gui start, you must use the GUI once to connect your game server file to the Palworld Server Manager. Create World or Add Exisiting World.

6. **Configure** configure your world, save all relevant fields that matter to you, add schedule tasks.
  - In schedule task you can choose shutdown server after idle in combination with the wakeup listener I created. This combo will shut down the server when no one is on it after X amount of time, and then the wakeup listener will turn the server back on instantly when any player tries to connect. Helps saves server resources and power. 

7. Fully **Close** psm-gui when you're done configuring through it. In the future you wont need the GUI portion other than to edit server settings or "adding/deleting/edit" scheduled tasks.

8. **Run the server headless** you can now use psm-headless start to get the servers operational through terminal only without wasting resources on the GUI manager. Look to the CLI section above for available commands.

---

## Some Packages Needed if Asked For
pacman -S npm | Needed to build the .AppImage
pacman -S cage | Runs psm-gui if you're on a terminal only OS like minimal Arch Linux
pacman -S fuse2 | To run .AppImage
pacman -S intel-gpu-tools | needed by psm-monitor to read vram or shared ram values of intel cpu/igpu
pacman -S noip | if you want to establish a ddns for your server
pacman -S openssh | if you want to remote into your game server's terminal
pacman -S ufw | firewall to block all ports other than the ones you allow
pacman -S steam | if you want the dedicated server files directly from steam. psm-GUI has an update feature of it's own
pacman -S thunar | if you want to acces a GUI file explorer
pacman -S xorg-xwayland | another different compositor that some may need


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
