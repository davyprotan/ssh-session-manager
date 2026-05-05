import { NextRequest, NextResponse } from "next/server";
import { assertSafeOrigin } from "@/lib/api-guard";
import packageJson from "../../../../package.json";

const REPO_OWNER = "davyprotan";
const REPO_NAME = "ssh-session-manager";
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

function parseSemver(v: string): [number, number, number] | null {
  const m = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

export async function GET(req: NextRequest) {
  const guard = assertSafeOrigin(req);
  if (guard) return guard;

  const current = packageJson.version;

  try {
    // 5-second timeout — never block the UI on a flaky network
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const resp = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `ssh-manager/${current}`,
      },
      signal: ac.signal,
    });
    clearTimeout(timer);

    if (resp.status === 404 || resp.status === 401 || resp.status === 403) {
      // Private repo without auth — expected during the private phase. No-op.
      return NextResponse.json({
        available: false,
        current,
        reason: "release-feed-not-public",
        releases_page: RELEASES_PAGE,
      });
    }
    if (!resp.ok) {
      return NextResponse.json({
        available: false,
        current,
        reason: `github-api-error-${resp.status}`,
        releases_page: RELEASES_PAGE,
      });
    }

    const data = await resp.json();
    const tag = typeof data.tag_name === "string" ? data.tag_name : null;
    if (!tag) {
      return NextResponse.json({
        available: false,
        current,
        reason: "no-tag",
        releases_page: RELEASES_PAGE,
      });
    }

    const available = isNewer(tag, current);
    return NextResponse.json({
      available,
      current,
      latest: tag,
      release_url: typeof data.html_url === "string" ? data.html_url : RELEASES_PAGE,
      release_name: data.name || tag,
      published_at: data.published_at || null,
      releases_page: RELEASES_PAGE,
    });
  } catch (e: unknown) {
    return NextResponse.json({
      available: false,
      current,
      reason: e instanceof Error ? e.message : "fetch-failed",
      releases_page: RELEASES_PAGE,
    });
  }
}
