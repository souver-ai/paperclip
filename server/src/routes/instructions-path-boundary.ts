import path from "node:path";

/**
 * Returns true when `candidateAbsolutePath` resolves to a location inside one of
 * `allowedRoots` (each an absolute directory).
 *
 * Used to constrain the instructions file path set by non board-authenticated
 * callers (agent / ancestor-manager) so a compromised or over-permissive agent
 * key cannot point its instructions path at host-sensitive files such as
 * `/etc/passwd`, `.env`, or `.paperclip.env` outside the agent workspace and
 * have a local adapter stage that file into model context (SOU-1015).
 *
 * Board-authenticated admins are intentionally NOT subject to this check (they
 * may set explicit external absolute paths); the caller decides whether to call
 * this guard based on the actor type.
 */
export function isInstructionsPathWithinRoots(
  candidateAbsolutePath: string,
  allowedRoots: ReadonlyArray<string | null | undefined>,
): boolean {
  const normalized = path.resolve(candidateAbsolutePath);
  return allowedRoots.some((root) => {
    if (!root) return false;
    const normalizedRoot = path.resolve(root);
    // Exact match, or a real descendant (the trailing separator prevents a
    // sibling like `/ws-evil` from matching the root `/ws`).
    return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep);
  });
}
