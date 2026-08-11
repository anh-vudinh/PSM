#!/usr/bin/env bash

set -u

SOURCE="${BASH_SOURCE[0]}"

while [ -L "$SOURCE" ]; do
DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
SOURCE="$(readlink "$SOURCE")"

if [[ "$SOURCE" != /* ]]; then
    SOURCE="$DIR/$SOURCE"
fi


done

SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

PID_FILE="$SCRIPT_DIR/headless.pid"
LOG_FILE="$SCRIPT_DIR/headless-console.log"

HEADLESS_JS="$SCRIPT_DIR/headless.js"
MONITOR_PID_FILE="$SCRIPT_DIR/resource-monitor.pid"

is_running() {
if [[ ! -f "$PID_FILE" ]]; then
return 1
fi

local pid
pid="$(cat "$PID_FILE" 2>/dev/null || true)"

if [[ -z "$pid" ]]; then
    return 1
fi

if kill -0 "$pid" 2>/dev/null; then
    return 0
fi

rm -f "$PID_FILE"
return 1


}

get_pid() {
if [[ -f "$PID_FILE" ]]; then
cat "$PID_FILE" 2>/dev/null || true
fi
}

kill_tree() {
local pid="$1"
local child

[[ -n "$pid" ]] || return

while read -r child; do
    [[ -n "$child" ]] || continue
    kill_tree "$child"
done < <(pgrep -P "$pid" 2>/dev/null || true)

kill -TERM "$pid" 2>/dev/null || true


}

kill_tree_force() {
local pid="$1"
local child

[[ -n "$pid" ]] || return

while read -r child; do
    [[ -n "$child" ]] || continue
    kill_tree_force "$child"
done < <(pgrep -P "$pid" 2>/dev/null || true)

kill -KILL "$pid" 2>/dev/null || true


}

stop_monitor() {
if [[ ! -f "$MONITOR_PID_FILE" ]]; then
return 0
fi

local monitor_pid
monitor_pid="$(cat "$MONITOR_PID_FILE" 2>/dev/null || true)"

if [[ -n "$monitor_pid" ]] &&
   kill -0 "$monitor_pid" 2>/dev/null; then
    kill -TERM "$monitor_pid" 2>/dev/null || true

    for _ in {1..10}; do
        if ! kill -0 "$monitor_pid" 2>/dev/null; then
            break
        fi

        sleep 0.1
    done

    if kill -0 "$monitor_pid" 2>/dev/null; then
        kill -KILL "$monitor_pid" 2>/dev/null || true
    fi
fi

rm -f "$MONITOR_PID_FILE"


}

start() {
if [[ ! -f "$HEADLESS_JS" ]]; then
echo "ERROR: headless.js was not found:"
echo " $HEADLESS_JS"
exit 1
fi

if is_running; then
    echo "Palworld Server Manager headless is already running."
    echo "PID: $(get_pid)"
    return 0
fi

rm -f "$PID_FILE"

echo "Starting Palworld Server Manager headless..."
echo "psm-headless stop | psm-monitor on | psm-monitor off | ctrl+c closes resource monitor"

nohup node "$HEADLESS_JS" \
    >> "$LOG_FILE" 2>&1 &

local pid=$!

echo "$pid" > "$PID_FILE"

sleep 1

if kill -0 "$pid" 2>/dev/null; then
    echo "Palworld Server Manager headless started."
    echo "PID: $pid"
    echo "Log: $LOG_FILE"
else
    echo "ERROR: Headless PSM failed to start."
    rm -f "$PID_FILE"

    echo
    echo "Check the log:"
    echo "  $LOG_FILE"

    exit 1
fi


}

stop() {
stop_monitor

if ! is_running; then
    echo "Palworld Server Manager headless is not running."
    rm -f "$PID_FILE"
    return 0
fi

local pid
pid="$(get_pid)"

echo "Stopping Palworld Server Manager headless..."
echo "PID: $pid"

kill_tree "$pid"

for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "Palworld Server Manager headless stopped."
        return 0
    fi

    sleep 0.5
done

echo "Headless PSM did not stop gracefully."
echo "Sending SIGKILL to the entire process tree..."

kill_tree_force "$pid"

sleep 0.5

rm -f "$PID_FILE"

echo "Palworld Server Manager headless stopped."


}

restart() {
stop
sleep 1
start
}

status() {
if is_running; then
local pid
pid="$(get_pid)"

    echo "Palworld Server Manager headless is RUNNING."
    echo "PID: $pid"
    echo "Log: $LOG_FILE"
else
    echo "Palworld Server Manager headless is NOT running."
fi


}

usage() {
echo "Palworld Server Manager - Headless"
echo
echo "Usage:"
echo " psm-headless"
echo " psm-headless start"
echo " psm-headless stop"
echo " psm-headless restart"
echo " psm-headless status"
echo
echo "Commands:"
echo " start Start headless PSM in the background"
echo " stop Stop headless PSM and its entire process tree"
echo " restart Restart headless PSM"
echo " status Show whether headless PSM is running"
}

case "${1:-start}" in
start)
start
;;

stop)
    stop
    ;;

restart)
    restart
    ;;

status)
    status
    ;;

help|-h|--help)
    usage
    ;;

*)
    echo "Unknown command: $1"
    echo
    usage
    exit 1
    ;;


esac