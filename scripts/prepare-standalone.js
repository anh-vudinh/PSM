// scripts/prepare-standalone.js
//
// Assembles a self-contained Next.js standalone server into
// ./dist-standalone with the exact layout the server expects:
//
//   dist-standalone/
//     server.js
//     headless.js
//     .next/
//       (standalone server chunks)
//       static/             (client assets)
//     public/               (static files)
//     node_modules/         (minimal traced dependencies)
//     psm-mods/             (first-party UE4SS mods)
//
// electron-builder then copies this whole folder to resources/app,
// and electron/main.js runs resources/app/server.js.

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const standalone = path.join(
    root,
    ".next",
    "standalone"
);
const out = path.join(
    root,
    "dist-standalone"
);

function rmrf(target) {
    if (fs.existsSync(target)) {
        fs.rmSync(target, {
            recursive: true,
            force: true,
        });
    }
}

function copyDir(src, dst) {
    if (!fs.existsSync(src)) {
        return;
    }

    fs.mkdirSync(dst, {
        recursive: true,
    });

    for (const item of fs.readdirSync(src, {
        withFileTypes: true,
    })) {
        const source = path.join(
            src,
            item.name
        );

        const destination = path.join(
            dst,
            item.name
        );

        if (item.isDirectory()) {
            copyDir(source, destination);
        } else if (item.isSymbolicLink()) {
            try {
                fs.symlinkSync(
                    fs.readlinkSync(source),
                    destination
                );
            } catch {
                fs.copyFileSync(
                    source,
                    destination
                );
            }
        } else {
            fs.copyFileSync(
                source,
                destination
            );
        }
    }
}

if (!fs.existsSync(standalone)) {
    console.error(
        "ERROR: .next/standalone not found. " +
        "Run `next build` (output:'standalone') first."
    );

    process.exit(1);
}

console.log(
    "Assembling standalone app -> dist-standalone/"
);

rmrf(out);

/*
 * 1. Copy the complete Next.js standalone tree.
 *
 * This includes:
 *   - server.js
 *   - traced node_modules
 *   - Next.js server chunks
 */
copyDir(standalone, out);

/*
 * 1b. Guarantee that no local runtime data ships
 * with the packaged application.
 *
 * Next's file tracer can sweep project-root runtime
 * directories into the standalone tree.
 *
 * These directories must be recreated fresh on the
 * end user's machine.
 */
const localOnlyDirs = [
    ".data",
    "release",
    "dist-standalone",
];

for (const junk of localOnlyDirs) {
    const target = path.join(
        out,
        junk
    );

    if (fs.existsSync(target)) {
        rmrf(target);

        console.log(
            `Scrubbed local-only dir from build: ${junk}/`
        );
    }
}

/*
 * 2. Copy client-side Next.js static assets.
 *
 * Next standalone does not include .next/static.
 */
copyDir(
    path.join(
        root,
        ".next",
        "static"
    ),
    path.join(
        out,
        ".next",
        "static"
    )
);

/*
 * 3. Copy public/ assets.
 */
copyDir(
    path.join(
        root,
        "public"
    ),
    path.join(
        out,
        "public"
    )
);

/*
 * 4. Guarantee that the pure-WASM SQLite backend
 * is included.
 *
 * Next's file tracer can miss the runtime-loaded
 * .wasm binary, so copy the entire package.
 */
const wasmSrc = path.join(
    root,
    "node_modules",
    "node-sqlite3-wasm"
);

const wasmDst = path.join(
    out,
    "node_modules",
    "node-sqlite3-wasm"
);

if (fs.existsSync(wasmSrc)) {
    copyDir(
        wasmSrc,
        wasmDst
    );

    const wasmBin = path.join(
        wasmDst,
        "dist",
        "node-sqlite3-wasm.wasm"
    );

    console.log(
        "node-sqlite3-wasm bundled:",
        fs.existsSync(wasmBin)
            ? "OK (.wasm present)"
            : "WARN (.wasm missing)"
    );
} else {
    console.warn(
        "WARNING: node-sqlite3-wasm not found in " +
        "node_modules — install it before packaging."
    );
}

/*
 * 5. Bundle the first-party UE4SS chat-relay mod.
 *
 * These mods are copied to psm-mods and resolved
 * by the server at runtime.
 */
const modsSrc = path.join(
    root,
    "resources",
    "mods"
);

const modsDst = path.join(
    out,
    "psm-mods"
);

if (fs.existsSync(modsSrc)) {
    copyDir(
        modsSrc,
        modsDst
    );

    console.log(
        "Bundled UE4SS mods: OK (psm-mods/)"
    );
}

/*
 * 6. Include the headless launcher.
 */
const headlessSrc = path.join(
    root,
    "headless.js"
);

const headlessDst = path.join(
    out,
    "headless.js"
);

if (fs.existsSync(headlessSrc)) {
    fs.copyFileSync(
        headlessSrc,
        headlessDst
    );

    console.log(
        "Bundled headless launcher: OK"
    );
} else {
    console.warn(
        "WARNING: headless.js not found — " +
        "headless launcher will not be packaged."
    );
}

/*
 * 7. Final sanity check.
 */
const serverJs = path.join(
    out,
    "server.js"
);

if (!fs.existsSync(serverJs)) {
    console.error(
        "ERROR: server.js missing from assembled output."
    );

    process.exit(1);
}

console.log(
    "Standalone app ready:",
    out
);