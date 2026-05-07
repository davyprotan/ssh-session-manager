// Suggest the most-likely-correct profile for a new session, based on the
// hostname pattern of existing sessions.
//
// Idea: a fleet usually has device families with similar naming —
//   `XN-XSVM-S-67-LDP02-GB`, `XN-XSVM-S-454-LDPVM-GB`, …  → probably the same auth profile
//   `MR-OSV8-C-1-ALC0G-US`, `MR-OSV8-C-2-ALC0G-US`, …      → probably a different one
// We split the hostname into segments (on `-`, `.`, `_`), find existing sessions whose
// hostname shares the longest leading run of segments, and return the profile most-used
// among those neighbours.

export interface SuggestSessionInput {
  host: string;
  profile_id: number | null;
}

export interface SuggestResult {
  profileId: number | null;
  /** How many leading segments matched. 0 = no match. Larger = more confident. */
  matchedSegments: number;
  /** How many existing sessions matched at that depth. */
  matchedCount: number;
  /** The shared prefix that matched (for UI display, e.g. "XN-XSVM-S-"). */
  matchedPrefix: string;
}

const SEGMENT_RE = /[-._]/;
const MIN_SCORE = 2; // need at least 2 segments matching for a confident suggestion

function splitSegments(host: string): string[] {
  return host.split(SEGMENT_RE).filter(Boolean);
}

/**
 * Score two segment arrays by counting matching leading segments + matching
 * trailing segments (without double-counting overlap). This handles both
 * dash-named gear ("XN-XSVM-S-67-LDP02-GB" — meaningful prefix and suffix)
 * and FQDNs ("foo.sohonet.internal" — meaningful suffix).
 */
function similarityScore(a: string[], b: string[]): { score: number; leading: number; trailing: number } {
  const minLen = Math.min(a.length, b.length);
  let leading = 0;
  while (leading < minLen && a[leading].toLowerCase() === b[leading].toLowerCase()) leading++;
  let trailing = 0;
  while (
    trailing < minLen - leading &&
    a[a.length - 1 - trailing].toLowerCase() === b[b.length - 1 - trailing].toLowerCase()
  ) trailing++;
  return { score: leading + trailing, leading, trailing };
}

/**
 * Return the suggested profile_id for `host`, or `null` if there's no
 * confident match. Pure function — no I/O, easy to test.
 */
export function suggestProfileForHost(
  host: string,
  sessions: SuggestSessionInput[],
): SuggestResult {
  const empty: SuggestResult = { profileId: null, matchedSegments: 0, matchedCount: 0, matchedPrefix: "" };
  if (!host) return empty;

  const target = splitSegments(host);
  if (target.length < 2) return empty;

  let bestScore = 0;
  let bestLeading = 0;
  let bestProfiles: Array<number | null> = [];

  for (const s of sessions) {
    if (!s.host) continue;
    const segs = splitSegments(s.host);
    const { score, leading } = similarityScore(target, segs);
    if (score < MIN_SCORE) continue;
    if (score > bestScore) {
      bestScore = score;
      bestLeading = leading;
      bestProfiles = [s.profile_id];
    } else if (score === bestScore) {
      bestProfiles.push(s.profile_id);
    }
  }

  if (bestScore === 0 || bestProfiles.length === 0) return empty;

  // Pick the modal profile_id (most common among neighbours).
  const counts = new Map<number | null, number>();
  for (const id of bestProfiles) counts.set(id, (counts.get(id) ?? 0) + 1);
  let topId: number | null = null;
  let topCount = -1;
  for (const [id, c] of counts) {
    if (c > topCount) { topId = id; topCount = c; }
  }
  if (topId == null) return empty;

  // Pick a representative prefix-string for display. Prefer the leading
  // segments if there's a leading match, else the trailing.
  const matchedPrefix = bestLeading > 0
    ? target.slice(0, bestLeading).join("-")
    : target.slice(target.length - (bestScore - bestLeading)).join("-");

  return {
    profileId: topId,
    matchedSegments: bestScore,
    matchedCount: bestProfiles.length,
    matchedPrefix,
  };
}
