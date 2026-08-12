#!/usr/bin/env bash

set -euo pipefail

# ------------------------------------------------------------
# PSM PATH CREATION SCRIPT
#
# Creates user-local commands:
#
#   psm-headless
#   psm-monitor
#
# The actual PSM directory is detected dynamically from the
# location of this script.
# ------------------------------------------------------------

SOURCE="${BASH_SOURCE[0]}"

while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"

    if [[ "$SOURCE" != /* ]]; then
        SOURCE="$DIR/$SOURCE"
    fi
done

PSM_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

BIN_DIR="$HOME/.local/bin"

PSM_HEADLESS="$PSM_DIR/psm-headless.js"
HEADLESS="$PSM_DIR/headless.sh"
PSM_MONITOR="$PSM_DIR/psm-monitor"

HEADLESS_WRAPPER="$BIN_DIR/psm-headless"
MONITOR_WRAPPER="$BIN_DIR/psm-monitor"

PATH_MARKER="# PSM PATH - managed by createpaths.sh"

echo
echo "========================================"
echo " PSM Command Path Setup"
echo "========================================"
echo
echo "PSM directory:"
echo "  $PSM_DIR"
echo
echo "Command directory:"
echo "  $BIN_DIR"
echo

# ------------------------------------------------------------
# Verify PSM files exist
# ------------------------------------------------------------

if [[ ! -f "$HEADLESS" ]]; then
    echo "ERROR: headless.sh was not found:"
    echo "  $HEADLESS"
    exit 1
fi

if [[ ! -f "$PSM_HEADLESS" ]]; then
    echo "ERROR: psm-headless.js was not found:"
    echo "  $PSM_HEADLESS"
    exit 1
fi

if [[ ! -f "$PSM_MONITOR" ]]; then
    echo "ERROR: psm-monitor was not found:"
    echo "  $PSM_MONITOR"
    exit 1
fi

# ------------------------------------------------------------
# Create ~/.local/bin
# ------------------------------------------------------------

mkdir -p "$BIN_DIR"

# ------------------------------------------------------------
# Create psm-headless wrapper
#
# start/stop/status/restart belong to headless.sh.
#
# Everything else belongs to psm-headless.js.
# ------------------------------------------------------------

cat > "$HEADLESS_WRAPPER" <<EOF
#!/usr/bin/env bash

set -e

PSM_DIR="$PSM_DIR"

HEADLESS="\$PSM_DIR/headless.sh"
PSM_HEADLESS="\$PSM_DIR/psm-headless.js"

case "\${1:-}" in
    start|stop|status|restart)
        exec "\$HEADLESS" "\$@"
        ;;
    *)
        exec node "\$PSM_HEADLESS" "\$@"
        ;;
esac
EOF

chmod +x "$HEADLESS_WRAPPER"

# ------------------------------------------------------------
# Create psm-monitor wrapper
# ------------------------------------------------------------

cat > "$MONITOR_WRAPPER" <<EOF
#!/usr/bin/env bash

set -e

PSM_DIR="$PSM_DIR"

exec "\$PSM_DIR/psm-monitor" "\$@"
EOF

chmod +x "$MONITOR_WRAPPER"

# ------------------------------------------------------------
# Add ~/.local/bin to PATH if necessary
#
# We inspect the user's shell configuration files.
# We only add our own PATH line if ~/.local/bin is not already
# represented there.
# ------------------------------------------------------------

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'

add_path_to_file() {
    local file="$1"

    if [[ ! -f "$file" ]]; then
        return 1
    fi

    if grep -Fq '$HOME/.local/bin' "$file" || \
       grep -Fq '${HOME}/.local/bin' "$file"; then
        return 0
    fi

    if grep -Fq "$PATH_MARKER" "$file"; then
        return 0
    fi

    {
        echo
        echo "$PATH_MARKER"
        echo "$PATH_LINE"
    } >> "$file"

    echo "Added ~/.local/bin to:"
    echo "  $file"

    return 0
}

PATH_ALREADY_AVAILABLE=false

case ":$PATH:" in
    *":$BIN_DIR:"*)
        PATH_ALREADY_AVAILABLE=true
        ;;
esac

if [[ "$PATH_ALREADY_AVAILABLE" == false ]]; then

    SHELL_NAME="$(basename "${SHELL:-bash}")"

    case "$SHELL_NAME" in

        zsh)
            SHELL_FILE="$HOME/.zshrc"

            touch "$SHELL_FILE"

            if ! grep -Fq '$HOME/.local/bin' "$SHELL_FILE" && \
               ! grep -Fq '${HOME}/.local/bin' "$SHELL_FILE"; then

                {
                    echo
                    echo "$PATH_MARKER"
                    echo "$PATH_LINE"
                } >> "$SHELL_FILE"

                echo "Added ~/.local/bin to:"
                echo "  $SHELL_FILE"
            fi
            ;;

        fish)
            FISH_CONFIG="$HOME/.config/fish/config.fish"

            mkdir -p "$(dirname "$FISH_CONFIG")"
            touch "$FISH_CONFIG"

            if ! grep -Fq '.local/bin' "$FISH_CONFIG"; then

                {
                    echo
                    echo "$PATH_MARKER"
                    echo 'fish_add_path "$HOME/.local/bin"'
                } >> "$FISH_CONFIG"

                echo "Added ~/.local/bin to:"
                echo "  $FISH_CONFIG"
            fi
            ;;

        bash|*)
            # Prefer ~/.bashrc for interactive bash shells.
            SHELL_FILE="$HOME/.bashrc"

            touch "$SHELL_FILE"

            if ! grep -Fq '$HOME/.local/bin' "$SHELL_FILE" && \
               ! grep -Fq '${HOME}/.local/bin' "$SHELL_FILE"; then

                {
                    echo
                    echo "$PATH_MARKER"
                    echo "$PATH_LINE"
                } >> "$SHELL_FILE"

                echo "Added ~/.local/bin to:"
                echo "  $SHELL_FILE"
            fi
            ;;
    esac
fi

# ------------------------------------------------------------
# Make the commands available immediately in this shell
# ------------------------------------------------------------

export PATH="$BIN_DIR:$PATH"

# ------------------------------------------------------------
# Finished
# ------------------------------------------------------------

echo
echo "========================================"
echo " PSM PATH SETUP COMPLETE"
echo "========================================"
echo
echo "Commands created:"
echo "  $HEADLESS_WRAPPER"
echo "  $MONITOR_WRAPPER"
echo
echo "You can now run:"
echo
echo "  psm-headless start"
echo "  psm-headless stop"
echo "  psm-headless status"
echo "  psm-headless restart"
echo
echo "  psm-headless worlds list"
echo "  psm-headless worlds status"
echo "  psm-headless players list <world_id>"
echo "  psm-headless backup <world_id>"
echo
echo "  psm-monitor start"
echo "  psm-monitor stop"
echo "  psm-monitor help"
echo
echo "These commands can be run from anywhere."
echo
echo
echo "============================================================"
echo -e "\033[1;33m  !!! ACTION REQUIRED !!!\033[0m"
echo "============================================================"
echo
echo -e "\033[1;37m  PSM commands have been installed.\033[0m"
echo -e "\033[1;91m  IMPORTANT:\033[0m\033[1;37m  To activate them in THIS terminal, run:\033[0m"
echo
echo -e "\033[1;32m      source ~/.bashrc\033[0m"
echo
echo -e "\033[1;37m  OR close this terminal and open a new one.\033[0m"
echo
echo "============================================================"
echo
