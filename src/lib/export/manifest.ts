import type { ResidentPaymentClaim, SocietyAttachment } from '@/types/database';

export const EXPORT_FORMAT = 'trezia-offboarding';
// 4: added society_import_batches / society_import_records to the snapshot, and
// declared the derived usage tables as deliberate exclusions. Additive — restore
// discovers columns dynamically and only logs this value, so a v3 snapshot still
// restores unchanged.
export const EXPORT_VERSION = 4;

export type AttachmentInventoryItem = {
  id: string;
  object_key: string;
  filename: string;
  content_type: string;
  expected_bytes: number;
  stored_bytes: number | null;
  sha256: string;
  last_modified: string | null;
  status: 'VERIFIED_PRESENT' | 'MISSING' | 'SIZE_MISMATCH';
};

export type ClaimObjectInventoryItem = {
  object_key: string;
  claim_id: string | null;
  stored_bytes: number | null;
  last_modified: string | null;
  status: 'LINKED' | 'MISSING' | 'ORPHAN';
};

export type RestorationExpectations = {
  data_rehydration: string;
  object_mapping: string;
  limitations: string[];
  excluded_data: { tables: string[]; reason: string };
};

export function buildRestorationExpectations(): RestorationExpectations {
  return {
    data_rehydration:
      'Every top-level table field in this export (units, residents, payments, expenditures, bills, etc.) is a full row dump for this society, keyed by table name and paginated past the 1,000-row PostgREST cap. Rehydrating means inserting these rows into a database with this repository\'s schema migrations already applied, in an order that satisfies foreign keys (for example units before residents and payments, vendors before vendor_contracts and assets).',
    object_mapping:
      'Records that reference stored files (society_attachments, and other rows carrying an object_key) map back to R2 objects by that key. When includeAttachmentInventory is requested, attachment_inventory and object_inventory list each object alongside its expected size and sha256, and its VERIFIED_PRESENT / MISSING / SIZE_MISMATCH status, so a missing or altered object is detectable before it is relied on.',
    limitations: [
      'This export contains table data only; it does not create a database. Apply this repository\'s schema migrations first, then replay these rows with `npm run restore:snapshot -- <file> --database-url <url> --execute` (dry-run without --execute). That path is exercised end-to-end by `npm run restore:drill`, which restores a snapshot into a wiped database and requires the rebuilt snapshot to hash identically to the original.',
      'This export carries no authentication identities, because they are global rather than society-scoped. Restore creates placeholder auth.users rows only to satisfy foreign keys such as society_notices.created_by; they are NOT working logins. Restore the real identities from the authentication backup before anyone can sign in.',
      'Generated/derived columns (bills.cgst_amount, bills.sgst_amount, bills.total_amount, bills.payable_amount) and DB-level behaviour (audit logging, hard-delete prevention, receipt numbering) come from applying this repository\'s schema migrations, not from this export. Restore excludes generated columns and suppresses application triggers per table so replaying rows cannot fabricate a duplicate audit history or reassign receipt numbers.',
      'attachment_inventory and object_inventory are only present when includeAttachmentInventory is requested; their absence is not a claim that no R2 objects exist for this society.',
      'push_subscriptions are intentionally excluded: they are ephemeral user-device credentials, not society records suitable for restoration.',
      'usage_counters is intentionally excluded: it is a per-day rate-limit count that is not worth restoring once the day it was measured has rolled over.',
      'society_usage_current is intentionally excluded: it is derived measurement, rebuilt by the next scheduled run. Restoring it would be actively misleading, because it would carry a stale last_snapshot_at into a freshly restored database and make it report itself as recently backed up.',
    ],
    excluded_data: {
      tables: ['push_subscriptions', 'usage_counters', 'society_usage_current'],
      reason: 'Push subscriptions are ephemeral user-device credentials. usage_counters is a per-day rate-limit count that is not worth restoring once the day rolls over. society_usage_current is derived backup measurement that the next scheduled run rebuilds, and restoring a stale last_snapshot_at would misreport a restored database as backed up. Private artifact inventory includes claims/{society}/ objects for offboarding and orphan review, but never deletes them.',
    },
  };
}

export function buildAttachmentInventory(
  attachments: SocietyAttachment[],
  objects: Array<{ key: string; size: number; lastModified?: Date }>,
): AttachmentInventoryItem[] {
  const byKey = new Map(objects.map(object => [object.key, object]));
  return attachments.map(attachment => {
    const object = byKey.get(attachment.object_key);
    return {
      id: attachment.id,
      object_key: attachment.object_key,
      filename: attachment.filename,
      content_type: attachment.content_type,
      expected_bytes: attachment.byte_size,
      stored_bytes: object?.size ?? null,
      sha256: attachment.sha256,
      last_modified: object?.lastModified?.toISOString() ?? null,
      status: !object ? 'MISSING' : object.size === attachment.byte_size ? 'VERIFIED_PRESENT' : 'SIZE_MISMATCH',
    };
  });
}

export function buildClaimObjectInventory(
  claims: ResidentPaymentClaim[],
  objects: Array<{ key: string; size: number; lastModified?: Date }>,
): ClaimObjectInventoryItem[] {
  const claimByKey = new Map(claims.map(claim => [claim.screenshot_object_key, claim]));
  const objectByKey = new Map(objects.map(object => [object.key, object]));
  const linkedOrMissing = claims.map(claim => {
    const object = objectByKey.get(claim.screenshot_object_key);
    return {
      object_key: claim.screenshot_object_key,
      claim_id: claim.id,
      stored_bytes: object?.size ?? null,
      last_modified: object?.lastModified?.toISOString() ?? null,
      status: object ? 'LINKED' as const : 'MISSING' as const,
    };
  });
  const orphans = objects.filter(object => !claimByKey.has(object.key)).map(object => ({
    object_key: object.key,
    claim_id: null,
    stored_bytes: object.size,
    last_modified: object.lastModified?.toISOString() ?? null,
    status: 'ORPHAN' as const,
  }));
  return [...linkedOrMissing, ...orphans].sort((a, b) => a.object_key.localeCompare(b.object_key));
}
