// Scheduled snapshots are stored gzip-compressed with a stable SHA-256 of the
// society payload so an unchanged day can be skipped without re-uploading.
// The hash deliberately ignores `exported_at` (which changes every run) so two
// runs over identical data hash equal.

import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Deterministic JSON: object keys sorted recursively, arrays left in order
// (query results are already ordered by a stable key + id tie-breaker).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Stable content hash of a snapshot, ignoring the volatile `exported_at` field. */
export function snapshotContentHash(snapshot: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== 'exported_at') rest[key] = value;
  }
  return createHash('sha256').update(stableStringify(rest)).digest('hex');
}

export interface SerializedSnapshot {
  gzipped: Buffer;
  sha256: string;
  gzippedSize: number;
  rawSize: number;
  /** gzipped / raw — closer to 0 means better compression. */
  ratio: number;
}

/** Gzip a snapshot to its stored form and compute its content hash + size metadata. */
export function serializeSnapshot(snapshot: Record<string, unknown>): SerializedSnapshot {
  const json = JSON.stringify(snapshot, null, 2);
  const rawSize = Buffer.byteLength(json);
  const gzipped = gzipSync(Buffer.from(json), { level: 9 });
  return {
    gzipped,
    sha256: snapshotContentHash(snapshot),
    gzippedSize: gzipped.length,
    rawSize,
    ratio: rawSize === 0 ? 1 : gzipped.length / rawSize,
  };
}

/** Inverse of serializeSnapshot's gzip step — parse a stored `.json.gz` back to an object. */
export function deserializeSnapshot(gzipped: Buffer): unknown {
  return JSON.parse(gunzipSync(gzipped).toString('utf8'));
}
