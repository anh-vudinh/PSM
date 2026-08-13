#!/usr/bin/env bash

set -euo pipefail

# ------------------------------------------------------------
# PSM PATH REMOVAL SCRIPT
#
# Removes only the commands and PATH entries created by
# createpaths.sh.
# ------------------------------------------------------------

BIN_DIR="$HOME/.local/bin"

HEADLESS_WRAPPER="$BIN_DIR/psm-headless"
MONITOR_WRAPPER="$BIN_DIR/psm-monitor"
GUI_WRAPPER="$BIN_DIR/psm-gui"

PATH_MARKER="# PSM PATH - managed by createpaths.sh"

echo
echo "========================================"
echo " PSM Command Path Removal"
echo "========================================"
echo

# ------------------------------------------------------------
# Remove generated command wrappers
# ------------------------------------------------------------

REMOVED_ANY=false

if [[ -f "$HEADLESS_WRAPPER" ]]; then
    rm -f "$HEADLESS_WRAPPER"
    echo "Removed:"
    echo "  $HEADLESS_WRAPPER"
    REMOVED_ANY=true
else
    echo "Not found:"
    echo "  $HEADLESS_WRAPPER"
fi

if [[ -f "$MONITOR_WRAPPER" ]]; then
    rm -f "$MONITOR_WRAPPER"
    echo "Removed:"
    echo "  $MONITOR_WRAPPER"
    REMOVED_ANY=true
else
    echo "Not found:"
    echo "  $MONITOR_WRAPPER"
fi

if [[ -f "$GUI_WRAPPER" ]]; then
    rm -f "$GUI_WRAPPER"
    echo "Removed:"
    echo "  $GUI_WRAPPER"
    REMOVED_ANY=true
else
    echo "Not found:"
    echo "  $GUI_WRAPPER"
fi

# ------------------------------------------------------------
# Remove ONLY the PATH entry managed by createpaths.sh
#
# We do this only when our marker is present.
# Existing user PATH configuration is left alone.
# ------------------------------------------------------------

remove_path_from_file() {
    local file="$1"

    [[ -f "$file" ]] || return 0

    if ! grep -Fq "$PATH_MARKER" "$file"; then
        return 0
    fi

    local temp_file
    temp_file="$(mktemp)"

    awk '
        $0 == "# PSM PATH - managed by createpaths.sh" {
            skip=2
            next
        }

        skip > 0 {
            skip--
            next
        }

        { print }
    ' "$file" > "$temp_file"

    mv "$temp_file" "$file"

    echo "Removed PSM PATH entry from:"
    echo "  $file"
}

remove_path_from_file "$HOME/.bashrc"
remove_path_from_file "$HOME/.zshrc"
remove_path_from_file "$HOME/.config/fish/config.fish"

# ------------------------------------------------------------
# Do NOT remove ~/.local/bin itself.
#
# It may contain other user commands.
# ------------------------------------------------------------

echo
echo "========================================"
echo " PSM PATH REMOVAL COMPLETE"
echo "========================================"
echo
echo "The following PSM-created commands were removed:"
echo
echo "  psm-headless"
echo "  psm-monitor"
echo "  psm-gui"
echo
echo "Your PSM files were NOT modified."
echo "Your ~/.local/bin directory was NOT removed."
echo
echo
echo "============================================================"
echo -e "\033[1;33m  !!! ACTION REQUIRED !!!\033[0m"
echo "============================================================"
echo
echo -e "\033[1;37m  The PSM commands have been removed.\033[0m"
echo -e "\033[1;91m  IMPORTANT!\033[0m\033[1;37m The current terminal still has the old PATH loaded.\033[0m"
echo
echo -e "\033[1;32m  Close this terminal and open a new one.\033[0m"
echo
echo -e "\033[1;37m  After that, psm will no longer be available\033[0m"
echo
echo "============================================================"
echo
