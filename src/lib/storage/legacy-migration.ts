import { createHash } from 'crypto';

export type ListedObject = { key: string; size: number; lastModified?: Date };
export type ObjectPage = {
  objects: ListedObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
};

export async function collectPaginatedObjects(
  prefix: string,
  listPage: (continuationToken?: string) => Promise<ObjectPage>,
): Promise<ListedObject[]> {
  const objects: ListedObject[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await listPage(continuationToken);
    objects.push(...page.objects);
    continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
    if (page.isTruncated && !continuationToken) {
      throw new Error(`R2 returned a truncated listing for ${prefix} without a continuation token`);
    }
  } while (continuationToken);
  return objects;
}

export type LegacySnapshotMigrationResult = {
  source: string;
  target: string;
  size: number;
  sha256: string;
  action: 'would-copy' | 'copied' | 'already-verified';
};

export type LegacySnapshotStore = {
  list: () => Promise<ListedObject[]>;
  exists: (key: string) => Promise<boolean>;
  read: (key: string) => Promise<Uint8Array>;
  copy: (source: string, target: string) => Promise<void>;
};

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function migrateLegacySnapshots(
  store: LegacySnapshotStore,
  societyId: string,
  options: { dryRun: boolean },
): Promise<LegacySnapshotMigrationResult[]> {
  const legacy = (await store.list()).filter(object => {
    const remainder = object.key.slice('snapshots/'.length);
    return object.key.startsWith('snapshots/') && remainder.length > 0 && !remainder.includes('/');
  });
  const results: LegacySnapshotMigrationResult[] = [];

  for (const object of legacy) {
    const source = object.key;
    const target = `snapshots/${societyId}/${source.slice('snapshots/'.length)}`;
    const sourceBytes = await store.read(source);
    if (object.size !== sourceBytes.byteLength) {
      throw new Error(`Source size changed while inventorying ${source}; legacy source retained`);
    }
    const sourceHash = digest(sourceBytes);
    const destinationExists = await store.exists(target);

    if (destinationExists) {
      const targetBytes = await store.read(target);
      if (sourceBytes.byteLength !== targetBytes.byteLength || sourceHash !== digest(targetBytes)) {
        throw new Error(`Destination ${target} conflicts with ${source}; legacy source retained`);
      }
      results.push({ source, target, size: targetBytes.byteLength, sha256: sourceHash, action: 'already-verified' });
      continue;
    }

    if (options.dryRun) {
      results.push({ source, target, size: sourceBytes.byteLength, sha256: sourceHash, action: 'would-copy' });
      continue;
    }

    await store.copy(source, target);
    const targetBytes = await store.read(target);
    if (sourceBytes.byteLength !== targetBytes.byteLength || sourceHash !== digest(targetBytes)) {
      throw new Error(`Destination ${target} failed verification against ${source}; legacy source retained`);
    }
    results.push({ source, target, size: targetBytes.byteLength, sha256: sourceHash, action: 'copied' });
  }

  return results;
}

export function compatibleObjectCandidates(
  legacyStorageLayout: string | null,
  scopedKey: string,
  legacyKey: string,
): string[] {
  return legacyStorageLayout === 'unscoped-v1' ? [scopedKey, legacyKey] : [scopedKey];
}
