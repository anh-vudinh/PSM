"use strict";

const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const REFRESH_MS = 1000;

let windowsGpuStaticInfo = null;
let previousCpu = null;
let running = true;
let started = false;

const PLATFORM = process.platform;

/* -------------------------------------------------------------------------- */
/* General helpers                                                            */
/* -------------------------------------------------------------------------- */

function commandExists(command) {
    try {
        if (PLATFORM === "win32") {
            execFileSync("where.exe", [command], {
                stdio: "ignore",
                windowsHide: true,
            });
        } else {
            execFileSync("sh", ["-c", `command -v "${command}"`], {
                stdio: "ignore",
            });
        }

        return true;
    } catch {
        return false;
    }
}

function runPowerShell(script) {
    if (PLATFORM !== "win32") {
        return "";
    }

    try {
        return execFileSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ],
            {
                encoding: "utf8",
                windowsHide: true,
                stdio: ["ignore", "pipe", "ignore"],
                maxBuffer: 4 * 1024 * 1024,
            }
        ).trim();
    } catch {
        return "";
    }
}

function parseNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

/* -------------------------------------------------------------------------- */
/* CPU                                                                        */
/* -------------------------------------------------------------------------- */

function readCpuLinux() {
    try {
        const stat = fs.readFileSync("/proc/stat", "utf8");

        const line = stat
            .split("\n")
            .find((entry) => /^cpu\s/.test(entry));

        if (!line) {
            return null;
        }

        const values = line
            .trim()
            .split(/\s+/)
            .slice(1)
            .map(Number);

        const user = values[0] || 0;
        const nice = values[1] || 0;
        const system = values[2] || 0;
        const idle = values[3] || 0;
        const iowait = values[4] || 0;
        const irq = values[5] || 0;
        const softirq = values[6] || 0;
        const steal = values[7] || 0;

        return {
            total:
                user +
                nice +
                system +
                idle +
                iowait +
                irq +
                softirq +
                steal,

            idle: idle + iowait,
        };
    } catch {
        return null;
    }
}

function getCpuUsageLinux() {
    const current = readCpuLinux();

    if (!current) {
        return 0;
    }

    if (!previousCpu) {
        previousCpu = current;
        return 0;
    }

    const totalDelta =
        current.total - previousCpu.total;

    const idleDelta =
        current.idle - previousCpu.idle;

    previousCpu = current;

    if (totalDelta <= 0) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            100 * (1 - idleDelta / totalDelta)
        )
    );
}

function getCpuUsageWindows() {
    const output = runPowerShell(
        "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue"
    );

    const value = parseNumber(output);

    return value === null
        ? 0
        : Math.max(0, Math.min(100, value));
}

function getCpuUsage() {
    if (PLATFORM === "win32") {
        return getCpuUsageWindows();
    }

    return getCpuUsageLinux();
}

/* -------------------------------------------------------------------------- */
/* Memory                                                                     */
/* -------------------------------------------------------------------------- */

function readMemoryLinux() {
    try {
        const meminfo = fs.readFileSync(
            "/proc/meminfo",
            "utf8"
        );

        const values = {};

        for (const line of meminfo.split("\n")) {
            const match = line.match(
                /^(\w+):\s+(\d+)/
            );

            if (match) {
                values[match[1]] =
                    Number(match[2]) * 1024;
            }
        }

        const total = values.MemTotal || 0;

        const available =
            values.MemAvailable ??
            (
                (values.MemFree || 0) +
                (values.Buffers || 0) +
                (values.Cached || 0)
            );

        return {
            used: Math.max(
                0,
                total - available
            ),
            total,
        };
    } catch {
        return {
            used: 0,
            total: 0,
        };
    }
}

function readMemoryWindows() {
    /*
     * RAM usage remains live.
     *
     * Total system RAM is hardware information, so cache it in
     * windowsGpuStaticInfo after the first successful read.
     */

    const output = runPowerShell(`
        $os = Get-CimInstance Win32_OperatingSystem

        [PSCustomObject]@{
            Total = [int64]$os.TotalVisibleMemorySize * 1024
            Free = [int64]$os.FreePhysicalMemory * 1024
        } | ConvertTo-Json -Compress
    `);

    try {
        const data = JSON.parse(output);

        const total = Number(data.Total);
        const free = Number(data.Free);

        /*
         * Initialize the static Windows information object if the
         * GPU information has not populated it yet.
         */
        if (!windowsGpuStaticInfo) {
            getWindowsGpuStaticInfo();
        }
        /*
         * Cache total RAM only once.
         */
        if (
            !windowsGpuStaticInfo.systemMemoryTotal &&
            Number.isFinite(total) &&
            total > 0
        ) {
            windowsGpuStaticInfo.systemMemoryTotal = total;
        }

        return {
            used: Math.max(
                0,
                total - free
            ),

            total:
                windowsGpuStaticInfo.systemMemoryTotal ||
                total,
        };
    } catch {
        return {
            used: 0,

            total:
                windowsGpuStaticInfo?.systemMemoryTotal ||
                0,
        };
    }
}

function readMemory() {
    if (PLATFORM === "win32") {
        return readMemoryWindows();
    }

    return readMemoryLinux();
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes) {
    if (
        bytes === null ||
        bytes === undefined ||
        !Number.isFinite(bytes)
    ) {
        return "N/A";
    }

    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB",
    ];

    let value = bytes;
    let index = 0;

    while (
        value >= 1024 &&
        index < units.length - 1
    ) {
        value /= 1024;
        index++;
    }

    if (index === 0) {
        return `${Math.round(value)} ${units[index]}`;
    }

    return `${value.toFixed(2)} ${units[index]}`;
}

/* -------------------------------------------------------------------------- */
/* GPU information                                                            */
/* -------------------------------------------------------------------------- */

let gpuInfo = null;

function cleanGpuName(name) {
    if (!name) {
        return "Unknown GPU";
    }

    let result = String(name).trim();

    /*
     * Remove common Windows prefixes.
     */
    result = result.replace(
        /^.*?:\s*/,
        (match) => {
            if (
                /VGA compatible controller/i.test(
                    match
                ) ||
                /3D controller/i.test(match)
            ) {
                return "";
            }

            return match;
        }
    );

    /*
     * Linux lspci names often contain:
     *
     * Intel Corporation Kaby Lake-R GT2
     * [UHD Graphics 620] [8086:5917]
     *
     * Prefer the useful graphics model inside
     * square brackets when it exists.
     */
    const bracketMatches = [
        ...result.matchAll(/\[([^\]]+)\]/g),
    ].map((match) => match[1]);

    const graphicsBracket =
        bracketMatches.find((value) =>
            /graphics|radeon|geforce|quadro|arc|uhd|iris|hd graphics/i.test(
                value
            )
        );

    if (graphicsBracket) {
        result = graphicsBracket;
    }

    /*
     * Remove PCI IDs / revision information.
     */
    result = result
        .replace(
            /\s*\[[0-9a-f]{4}:[0-9a-f]{4}\]/gi,
            ""
        )
        .replace(
            /\s*\(rev\s+[0-9a-f]+\)/gi,
            ""
        )
        .replace(/\s+/g, " ")
        .trim();

    return result || "Unknown GPU";
}

function getWindowsGpuInfo() {
    const output = runPowerShell(`
    Get-CimInstance Win32_VideoController |
    Select-Object Name,PNPDeviceID |
    ConvertTo-Json -Compress
    `);

    try {
        const parsed = JSON.parse(output);

        const adapters = Array.isArray(parsed)
            ? parsed
            : [parsed];

        const valid = adapters.filter(
            (adapter) =>
                adapter &&
                adapter.Name
        );

        if (valid.length === 0) {
            return null;
        }

        /*
         * Prefer a physical AMD/NVIDIA/Intel adapter over
         * Microsoft's virtual/display-only adapters.
         */
        const preferred =
            valid.find((adapter) =>
                /AMD|Radeon|NVIDIA|GeForce|Intel/i.test(
                    adapter.Name
                )
            ) || valid[0];

        const name = cleanGpuName(
            preferred.Name
        );

        /*
         * Determine whether this is likely an iGPU.
         *
         * AMD/NVIDIA discrete cards are treated as dedicated.
         * Intel UHD/Iris graphics are treated as integrated.
         */
        const isIntelIntegrated =
            /Intel/i.test(preferred.Name) &&
            /UHD|Iris|HD Graphics|Iris Xe/i.test(
                preferred.Name
            );

        const isDiscrete =
            /Radeon RX|Radeon PRO|GeForce|RTX|GTX|Quadro|NVIDIA|Arc A|Arc B/i.test(
                preferred.Name
            ) ||
            /AMD/i.test(preferred.Name) &&
            !isIntelIntegrated;

        return {
            name,
            dedicated: isDiscrete,
            pnpDeviceId:
                preferred.PNPDeviceID || "",
        };
    } catch {
        return null;
    }
}

function getLinuxGpuInfo() {
    if (!commandExists("lspci")) {
        return {
            name: "Unknown GPU",
            dedicated: false,
        };
    }

    try {
        const output = execFileSync(
            "lspci",
            ["-nn"],
            {
                encoding: "utf8",
            }
        );

        const lines = output
            .split("\n")
            .filter((line) =>
                /VGA compatible controller|3D controller|Display controller/i.test(
                    line
                )
            );

        if (lines.length === 0) {
            return {
                name: "Unknown GPU",
                dedicated: false,
            };
        }

        const line = lines[0];

        return {
            name: cleanGpuName(line),
            dedicated:
                /AMD|ATI|NVIDIA/i.test(line) &&
                !/integrated|UHD|Iris|HD Graphics/i.test(
                    line
                ),
        };
    } catch {
        return {
            name: "Unknown GPU",
            dedicated: false,
        };
    }
}

function getGpuInfo() {
    if (gpuInfo) {
        return gpuInfo;
    }

    if (PLATFORM === "win32") {
        const staticInfo = getWindowsGpuStaticInfo();

        const detected = getWindowsGpuInfo();

        gpuInfo = {
            name:
                staticInfo.name ||
                detected?.name ||
                "Unknown GPU",

            dedicated:
                detected?.dedicated || false,

            pnpDeviceId:
                detected?.pnpDeviceId || "",
        };
    } else {
        gpuInfo = getLinuxGpuInfo();
    }

    if (!gpuInfo) {
        gpuInfo = {
            name: "Unknown GPU",
            dedicated: false,
        };
    }

    return gpuInfo;
}

/* -------------------------------------------------------------------------- */
/* Windows dedicated GPU memory capacity                                      */
/* -------------------------------------------------------------------------- */

function getWindowsDedicatedVramCapacity() {
    /*
     * We deliberately do NOT use:
     *
     * Win32_VideoController.AdapterRAM
     *
     * That property is effectively limited to 32 bits and can report
     * approximately 4 GB on a GPU that actually has 16 GB or more.
     *
     * We first try the Windows GPU Adapter Memory performance counter.
     * If the driver doesn't expose Dedicated Limit, we read the
     * display driver's HardwareInformation.MemorySize registry value.
     */

    /*
     * ----------------------------------------------------------------------
     * Method 1:
     * GPU Adapter Memory -> Dedicated Limit
     * ----------------------------------------------------------------------
     */

    const counterOutput = runPowerShell(`
    $counter = Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Limit' -ErrorAction SilentlyContinue

    if ($counter) {
        $values = @(
            $counter.CounterSamples |
            Where-Object {
                $_.InstanceName -match '_phys_0$'
            } |
            ForEach-Object {
                [double]$_.CookedValue
            }
        )

        if ($values.Count -gt 0) {
            ($values | Measure-Object -Maximum).Maximum
        }
    }
    `);

    const counterValue =
        parseNumber(counterOutput);

    if (
        counterValue !== null &&
        counterValue > 0
    ) {
        return counterValue;
    }

    /*
     * ----------------------------------------------------------------------
     * Method 2:
     * Read HardwareInformation.MemorySize directly from the display
     * driver registry keys.
     *
     * Some drivers expose this as:
     *
     *   REG_QWORD
     *
     * while others expose it as:
     *
     *   REG_BINARY
     *
     * We handle both.
     * ----------------------------------------------------------------------
     */

    const registryOutput = runPowerShell(`
$base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'

$results = @()

for ($i = 0; $i -le 99; $i++) {
    $subKey = '{0:D4}' -f $i
    $path = Join-Path $base $subKey

    try {
        $key = Get-Item $path -ErrorAction Stop

        $description = $key.GetValue(
            'DriverDesc',
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        )

        if (-not $description) {
            continue
        }

        $raw = $key.GetValue(
            'HardwareInformation.MemorySize',
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        )

        if ($null -eq $raw) {
            continue
        }

        $size = $null

        if ($raw -is [byte[]]) {
            if ($raw.Length -ge 8) {
                $size = [BitConverter]::ToUInt64($raw, 0)
            }
            elseif ($raw.Length -ge 4) {
                $size = [BitConverter]::ToUInt32($raw, 0)
            }
        }
        elseif ($raw -is [uint64]) {
            $size = [uint64]$raw
        }
        elseif ($raw -is [int64]) {
            $size = [uint64]$raw
        }
        elseif ($raw -is [uint32]) {
            $size = [uint64]$raw
        }
        elseif ($raw -is [int32]) {
            $size = [uint64]$raw
        }
        elseif ($raw -is [string]) {
            $parsed = 0L

            if ([Int64]::TryParse(
                $raw,
                [ref]$parsed
            )) {
                $size = [uint64]$parsed
            }
        }

        if (
            $null -ne $size -and
            $size -gt 0
        ) {
            $results += [PSCustomObject]@{
                Description = [string]$description
                MemorySize = [uint64]$size
            }
        }
    }
    catch {
        continue
    }
}

$match = $results |
    Where-Object {
        $_.Description -match 'Radeon|AMD|GeForce|NVIDIA|RTX|GTX|Quadro'
    } |
    Select-Object -First 1

if ($match) {
    $match.MemorySize
}
`);

    const registryValue =
        parseNumber(registryOutput);

    if (
        registryValue !== null &&
        registryValue > 0
    ) {
        return registryValue;
    }

    /*
     * ----------------------------------------------------------------------
     * Method 3:
     * reg.exe fallback.
     *
     * This is useful on systems where PowerShell's registry provider has
     * trouble exposing the driver's binary value.
     * ----------------------------------------------------------------------
     */

    try {
        const output = execFileSync(
            "reg.exe",
            [
                "query",
                "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}",
                "/s",
                "/v",
                "HardwareInformation.MemorySize",
            ],
            {
                encoding: "utf8",
                windowsHide: true,
                stdio: [
                    "ignore",
                    "pipe",
                    "ignore",
                ],
                maxBuffer: 4 * 1024 * 1024,
            }
        );

        /*
         * reg.exe output can contain either:
         *
         * REG_QWORD    0x400000000
         *
         * or
         *
         * REG_BINARY   00 00 ...
         *
         * We parse QWORD directly first.
         */

        const qwordMatch = output.match(
            /HardwareInformation\.MemorySize\s+REG_QWORD\s+0x([0-9a-f]+)/i
        );

        if (qwordMatch) {
            const value = parseInt(
                qwordMatch[1],
                16
            );

            if (
                Number.isFinite(value) &&
                value > 0
            ) {
                return value;
            }
        }

        /*
         * Handle REG_BINARY.
         *
         * Windows stores the little-endian integer as bytes.
         */

        const binaryMatch = output.match(
            /HardwareInformation\.MemorySize\s+REG_BINARY\s+((?:[0-9a-f]{2}\s*)+)/i
        );

        if (binaryMatch) {
            const bytes = binaryMatch[1]
                .trim()
                .split(/\s+/)
                .map((value) =>
                    parseInt(value, 16)
                );

            if (bytes.length >= 4) {
                let value = 0;

                /*
                 * Read up to 8 bytes, little endian.
                 *
                 * JavaScript Number is safe for the memory sizes
                 * we're dealing with here.
                 */

                const count = Math.min(
                    bytes.length,
                    8
                );

                for (
                    let i = 0;
                    i < count;
                    i++
                ) {
                    value +=
                        bytes[i] *
                        Math.pow(
                            256,
                            i
                        );
                }

                if (
                    Number.isFinite(value) &&
                    value > 0
                ) {
                    return value;
                }
            }
        }
    } catch {
        /*
         * Nothing else to try.
         */
    }

    return null;
}

/* -------------------------------------------------------------------------- */
/* Windows GPU utilization                                                    */
/* -------------------------------------------------------------------------- */

function getWindowsGpuUtilization() {
    /*
     * Windows exposes utilization per GPU engine.
     *
     * Task Manager effectively focuses on the busiest active engine
     * rather than adding unrelated engine percentages together.
     *
     * Taking the maximum engine utilization prevents:
     *
     * 3D = 2%
     * Copy = 1%
     * Video = 2%
     *
     * becoming an incorrect 5% "GPU utilization".
     */

    const output = runPowerShell(`
    $values = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty CounterSamples |
        Where-Object {
            $_.InstanceName -match '_phys_0_'
        } |
        ForEach-Object {
            [double]$_.CookedValue
        }

    if ($values) {
        ($values | Measure-Object -Maximum).Maximum
    } else {
        0
    }
    `);

    const value = parseNumber(output);

    if (value === null) {
        return 0;
    }

    /*
     * Performance counter values are percentages already.
     */
    return Math.max(
        0,
        Math.min(100, value)
    );
}

/* -------------------------------------------------------------------------- */
/* Windows adapter memory                                                     */
/* -------------------------------------------------------------------------- */

function getWindowsGpuStaticInfo() {
    if (windowsGpuStaticInfo !== null) {
        return windowsGpuStaticInfo;
    }

    const output = runPowerShell(`
        $dxdiagFile = Join-Path $env:TEMP 'psm-dxdiag.txt'

        $name = "Unknown GPU"
        $dedicatedTotal = 0

        try {
            Start-Process -FilePath "$env:WINDIR\\System32\\dxdiag.exe" -ArgumentList '/dontskip', '/t', $dxdiagFile -Wait -WindowStyle Hidden
            Start-Sleep -Milliseconds 500

            if (Test-Path $dxdiagFile) {
                $dxdiag = Get-Content $dxdiagFile -Raw

                $nameMatch = [regex]::Match(
                    $dxdiag,
                    'Card name:\\s*(.+)',
                    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
                )

                if ($nameMatch.Success) {
                    $name = $nameMatch.Groups[1].Value.Trim()
                }

                $memoryMatch = [regex]::Match(
                    $dxdiag,
                    'Dedicated Memory:\\s*([\\d,]+)\\s*MB',
                    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
                )

                if ($memoryMatch.Success) {
                    $dedicatedTotal =
                        [double]($memoryMatch.Groups[1].Value -replace ',', '') * 1MB
                }

                Remove-Item $dxdiagFile -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
            $dedicatedTotal = 0
        }

        [PSCustomObject]@{
            DedicatedTotal = $dedicatedTotal
        } | ConvertTo-Json -Compress
    `);

    try {
        const data = JSON.parse(output);

        windowsGpuStaticInfo = {
            dedicatedTotal:
                Number(data.DedicatedTotal) || 0,

            name:
                getWindowsGpuInfo()?.name || "Unknown GPU",
        };
    } catch {
        windowsGpuStaticInfo = {
            dedicatedTotal: 0,
            name: "Unknown GPU",
        };
    }

    return windowsGpuStaticInfo;
}

function getWindowsAdapterMemory() {
    /*
     * GPU Adapter Memory gives us the CURRENT usage:
     *
     * Dedicated Usage = VRAM currently being used
     * Shared Usage    = system RAM currently being used by the GPU
     *
     * DXDiag gives us the ACTUAL hardware capacity:
     *
     * Dedicated Memory = total physical VRAM
     *
     * We keep the existing working usage detection and only
     * add DXDiag for the missing dedicated VRAM capacity.
     */

    const output = runPowerShell(`
        $dedicated = Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty CounterSamples

        $shared = Get-Counter '\\GPU Adapter Memory(*)\\Shared Usage' -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty CounterSamples

        $dedicatedValue = 0
        $sharedValue = 0

        if ($dedicated) {
            $dedicatedValue = ($dedicated |
                Where-Object {
                    $_.InstanceName -match '_phys_0$'
                } |
                Measure-Object -Property CookedValue -Sum).Sum
        }

        if ($shared) {
            $sharedValue = ($shared |
                Where-Object {
                    $_.InstanceName -match '_phys_0$'
                } |
                Measure-Object -Property CookedValue -Sum).Sum
        }

        [PSCustomObject]@{
            Dedicated = [double]$dedicatedValue
            Shared = [double]$sharedValue
        } | ConvertTo-Json -Compress
    `);

    try {
        const data = JSON.parse(output);

        try {
    const data = JSON.parse(output);

    return {
        dedicated:
            Number(data.Dedicated) || 0,

        shared:
            Number(data.Shared) || 0,
    };
} catch {
    return {
        dedicated: 0,
        shared: 0,
    };
}

        return {
            dedicated:
                Number(data.Dedicated) || 0,

            shared:
                Number(data.Shared) || 0,

            dedicatedTotal:
                Number(data.DedicatedTotal) || 0,
        };
    } catch {
        return {
            dedicated: 0,
            shared: 0,
            dedicatedTotal: 0,
        };
    }
}

/* -------------------------------------------------------------------------- */
/* Linux Intel GPU                                                            */
/* -------------------------------------------------------------------------- */

let intelGpuTopAvailable = null;

function hasIntelGpuTop() {
    if (intelGpuTopAvailable !== null) {
        return intelGpuTopAvailable;
    }

    intelGpuTopAvailable =
        commandExists("intel_gpu_top");

    return intelGpuTopAvailable;
}

function getLinuxIntelGpu() {
    if (!hasIntelGpuTop()) {
        return {
            utilization: null,
            memoryUsed: null,
            memoryTotal: null,
            shared: null,
        };
    }

    try {
        const output = execFileSync(
            "intel_gpu_top",
            [
                "-J",
                "-s",
                "1000",
                "-n",
                "1",
            ],
            {
                encoding: "utf8",
                timeout: 10000,
                maxBuffer: 4 * 1024 * 1024,
                stdio: [
                    "ignore",
                    "pipe",
                    "ignore",
                ],
            }
        );

        const data = JSON.parse(output);

        const sample =
            Array.isArray(data)
                ? data[data.length - 1]
                : data;

        if (!sample) {
            return {
                utilization: null,
                memoryUsed: null,
                memoryTotal: null,
                shared: null,
            };
        }

        const engines =
            sample.engines || {};

        const render =
            Number(
                engines["Render/3D"]?.busy
            ) || 0;

        const video =
            Number(
                engines["Video"]?.busy
            ) || 0;

        const blitter =
            Number(
                engines["Blitter"]?.busy
            ) || 0;

        const enhance =
            Number(
                engines["VideoEnhance"]?.busy
            ) || 0;

        /*
         * Use the busiest engine instead of adding them.
         */
        const utilization = Math.max(
            render,
            video,
            blitter,
            enhance
        );

        console.error(
            "LINUX GPU DEBUG:",
            JSON.stringify({
                render,
                video,
                blitter,
                enhance,
                utilization,
            })
        );

        return {
            utilization,
            memoryUsed: null,
            memoryTotal: null,
            shared: null,
        };
    } catch {
        return {
            utilization: null,
            memoryUsed: null,
            memoryTotal: null,
            shared: null,
        };
    }
}

/* -------------------------------------------------------------------------- */
/* Linux GPU                                                                  */
/* -------------------------------------------------------------------------- */

function getLinuxGpu() {
    const info = getGpuInfo();

    if (
        /Intel|UHD Graphics|Iris|HD Graphics/i.test(info.name) &&
        hasIntelGpuTop()
    ) {
        return getLinuxIntelGpu();
    }

    /*
     * No universal GPU utilization interface exists across all Linux
     * vendors. We intentionally return N/A instead of inventing data.
     */
    return {
        utilization: null,
        memoryUsed: null,
        memoryTotal: null,
        shared: null,
    };
}

/* -------------------------------------------------------------------------- */
/* GPU state                                                                  */
/* -------------------------------------------------------------------------- */

function getGpu() {
    const info = getGpuInfo();

    if (PLATFORM === "win32") {
        const utilization =
            getWindowsGpuUtilization();

        const memory =
            getWindowsAdapterMemory();

        const systemMemory =
            readMemoryWindows();

        if (info.dedicated) {
            return {
                name: info.name,
                dedicated: true,

                utilization,

                memoryUsed:
                    memory.dedicated,

                memoryTotal:
                    getWindowsGpuStaticInfo().dedicatedTotal,

                shared:
                    memory.shared,

                systemMemory,
            };
        }

        /*
        * Integrated GPU:
        *
        * There is normally no meaningful dedicated VRAM.
        * GPU memory comes from system RAM.
        */
        return {
            name: info.name,
            dedicated: false,

            utilization,

            memoryUsed:
                memory.shared,

            memoryTotal:
                systemMemory.total,

            shared:
                memory.shared,

            systemMemory,
        };
    }

    const linuxGpu =
        getLinuxGpu();

    return {
        name: info.name,
        dedicated: info.dedicated,
        ...linuxGpu,
    };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function render() {
    const cpu = getCpuUsage();
    const memory = readMemory();
    const gpu = getGpu();

    const lines = [
        `SYSTEM RESOURCE MONITOR — ${gpu.name}`,
        "────────────────────────────────────────",
        `CPU   ${cpu.toFixed(1)}%`,
        `RAM   ${formatBytes(memory.used)} / ${formatBytes(memory.total)}`,
    ];

    if (gpu.dedicated) {
        lines.push(
            `GPU   ${
                gpu.utilization !== null
                    ? `${gpu.utilization.toFixed(1)}%`
                    : "N/A"
            }`
        );

        lines.push(
            `VRAM  ${
                gpu.memoryUsed !== null
                    ? formatBytes(gpu.memoryUsed)
                    : "N/A"
            } / ${
                gpu.memoryTotal !== null
                    ? formatBytes(gpu.memoryTotal)
                    : "N/A"
            }`
        );

        lines.push(
            `SHRD  ${
                gpu.shared !== null
                    ? formatBytes(gpu.shared)
                    : "N/A"
            }`
        );
    } else {
        lines.push(
            `GPU   ${
                gpu.utilization !== null
                    ? `${gpu.utilization.toFixed(1)}%`
                    : "N/A"
            }`
        );

        lines.push(
            `SHRD  ${
                gpu.shared !== null
                    ? formatBytes(gpu.shared)
                    : "N/A"
            }`
        );
    }

    process.stdout.write("\x1b[2J\x1b[H");

    for (const line of lines) {
        process.stdout.write(line + "\n");
    }

    started = true;
}

/* -------------------------------------------------------------------------- */
/* Shutdown                                                                   */
/* -------------------------------------------------------------------------- */

function stop() {
    if (!running) {
        return;
    }

    running = false;

    /*
     * Clear the current line before exiting.
     */
    process.stdout.write(
        "\x1b[2K\r"
    );

    process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

render();

setInterval(() => {
    if (running) {
        render();
    }
}, REFRESH_MS);