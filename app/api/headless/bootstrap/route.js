import { NextResponse } from "next/server";

const crypto = require("crypto");
const ra = require("@/lib/remoteauth");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let bootstrapUsed = false;

export async function GET(req) {
  if (process.env.PSM_HEADLESS !== "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "Headless mode is not active."
      },
      { status: 404 }
    );
  }

  if (bootstrapUsed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The headless bootstrap token has already been used."
      },
      { status: 410 }
    );
  }

  const configuredToken =
    process.env.PSM_HEADLESS_BOOTSTRAP_TOKEN ||
    "";

  const suppliedToken =
    req.nextUrl.searchParams.get("token") ||
    "";

  if (
    !configuredToken ||
    !suppliedToken ||
    !timingSafeEqual(
      suppliedToken,
      configuredToken
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Invalid headless bootstrap token."
      },
      { status: 401 }
    );
  }

  /*
   * Consume the one-time credential immediately.
   * It cannot be reused after this point.
   */
  bootstrapUsed = true;

  /*
   * Headless mode is deliberately LAN-accessible.
   * Use PSM's existing Remote Access authentication.
   */
  ra.setEnabled(true);
  ra.setLanBind(true);

  const adminToken =
    ra.ensureAdminToken();

  if (!adminToken) {
    bootstrapUsed = false;

    return NextResponse.json(
      {
        ok: false,
        error:
          "Unable to initialize the administrator token."
      },
      { status: 500 }
    );
  }

  /*
   * The browser that opened this URL becomes the trusted
   * PSM administrator.
   */
  const response = NextResponse.redirect(
    new URL("/", req.url)
  );

  ra.setAdminCookie(
    response,
    req
  );

  return response;
}

function timingSafeEqual(a, b) {
  try {
    const aa =
      Buffer.from(a, "utf8");

    const bb =
      Buffer.from(b, "utf8");

    if (aa.length !== bb.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      aa,
      bb
    );
  } catch {
    return false;
  }
}