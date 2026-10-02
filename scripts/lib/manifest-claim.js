// @ts-check
// scripts/lib/manifest-claim.js - the one "most specific claim wins" rule, read by two manifest readers.
//
// WHAT. scripts/build-online-template.mjs's PLAN step and scripts/lib/validate/shipped.js's
// kitManifestDropClaim() each decide the same question over the same shape of input: given a repo-
// relative path and a flat list of claims (each a directory prefix or an exact name, saying what that
// path becomes online), which claim governs this one path. claimFor is generic over both callers: it
// reads only a claim's `.prefix` and `.isDir`, and returns the claim object unchanged, so a caller that
// also carries other fields (the builder's claims carry `.id`; the validator's do not) gets exactly what
// it built back.
//
// HOW. claimFor(relPath, claims) walks the claims array once. A directory claim (isDir: true) matches
// every path starting with its prefix; a file claim matches only the exact name. Among every match, the
// LONGEST prefix wins (a file inside a claimed subdirectory overrides that directory's own claim); a tie
// is broken by array order, since no caller's manifest declares two claims of equal length over the same
// path.
//
// NEVER. Reads a file, an environment variable or system/kit-manifest.json itself: every claim it judges
// comes from the caller's own array. Normalizes a path or a prefix: both callers' own readers already
// produce repo-relative, forward-slash text, and claimFor trusts it as given. Mutates the claims array or
// a claim object it is given.
//
// Usage: module only - const { claimFor } = require('./manifest-claim');
'use strict';

/**
 * @typedef {{ prefix: string, isDir: boolean, [key: string]: any }} Claim
 */

/**
 * The most specific claim for a path, or null. An exact name beats a directory; a longer prefix beats a
 * shorter one.
 * @param {string} relPath
 * @param {Claim[]} claims
 * @returns {Claim | null}
 */
function claimFor(relPath, claims) {
  let best = null;
  for (const c of claims) {
    const hit = c.isDir ? relPath.startsWith(c.prefix) : relPath === c.prefix;
    if (hit && (!best || c.prefix.length > best.prefix.length)) best = c;
  }
  return best;
}

module.exports = { claimFor };
