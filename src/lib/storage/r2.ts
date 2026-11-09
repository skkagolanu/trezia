// Cloudflare R2 via S3-compatible API.
// Requires: npm install @aws-sdk/client-s3
// R2_BUCKET_NAME is private legacy compatibility storage; all new objects use
// R2_PRIVATE_BUCKET_NAME and are delivered only through authenticated routes.

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { isDemoSession } from '@/lib/demo/session.server';
import { r2JurisdictionEndpoint } from '@/lib/storage/r2-config';
import {
  collectPaginatedObjects,
  compatibleObjectCandidates,
  migrateLegacySnapshots,
  type LegacySnapshotMigrationResult,
  type ListedObject,
} from '@/lib/storage/legacy-migration';
export type { LegacySnapshotMigrationResult } from '@/lib/storage/legacy-migration';

function getClient(storage: 'legacy' | 'private'): S3Client {
  const jurisdiction = storage === 'private'
    ? process.env.R2_PRIVATE_JURISDICTION ?? process.env.R2_JURISDICTION
    : process.env.R2_LEGACY_JURISDICTION ?? process.env.R2_JURISDICTION;
  return new S3Client({
    region: 'auto',
    endpoint: r2JurisdictionEndpoint(
      process.env.R2_ACCOUNT_ID,
      jurisdiction,
      storage === 'private' ? 'R2_PRIVATE_JURISDICTION' : 'R2_LEGACY_JURISDICTION',
    ),
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function privateBucket(): string {
  const bucket = process.env.R2_PRIVATE_BUCKET_NAME;
  if (!bucket) throw new Error('R2_PRIVATE_BUCKET_NAME is not configured');
  return bucket;
}

// — no real R2 credentials read, no network call attempted. PDFs/backups
// just don't exist in demo; callers get a placeholder URL or empty result
// instead of a real upload.
export async function uploadPdf(key: string, buffer: Buffer): Promise<string> {
  if (await isDemoSession()) return `demo://${key}`;
  const client = getClient('private');
  await client.send(
    new PutObjectCommand({
      Bucket: privateBucket(),
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
      CacheControl: 'private, no-store',
    })
  );
  return key;
}

export function receiptKey(societyId: string, receiptNumber: string): string {
  return `receipts/${societyId}/${safeDocumentName(receiptNumber)}.pdf`;
}

export function billKey(societyId: string, invoiceNumber: string): string {
  return `bills/${societyId}/${safeDocumentName(invoiceNumber)}.pdf`;
}

function safeDocumentName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, '_');
}

export function legacyReceiptKey(receiptNumber: string): string {
  return `receipts/${safeDocumentName(receiptNumber)}.pdf`;
}

export function legacyBillKey(invoiceNumber: string): string {
  return `bills/${safeDocumentName(invoiceNumber)}.pdf`;
}

export function levyReceiptKey(societyId: string, collectionId: string): string {
  return `levy-receipts/${societyId}/${collectionId}.pdf`;
}

export function snapshotKey(societyId: string, timestamp: string): string {
  return `snapshots/${societyId}/${timestamp}.json`;
}

export function snapshotKeyGz(societyId: string, timestamp: string): string {
  return `snapshots/${societyId}/${timestamp}.json.gz`;
}

export function attachmentKey(societyId: string, attachmentId: string): string {
  return `attachments/${societyId}/${attachmentId}`;
}

// Uuid-suffixed so a replacement upload writes a new object rather than
// overwriting in place — the previous key is deleted only after the new
// object is confirmed written, so a failed write never destroys the live QR.
export function upiQrKey(societyId: string, extension: string): string {
  return `society/${societyId}/upi-qr-${randomUUID()}.${extension}`;
}

export async function uploadPrivateAttachment(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (await isDemoSession()) return;
  await getClient('private').send(new PutObjectCommand({
    Bucket: privateBucket(), Key: key, Body: body, ContentType: contentType,
    CacheControl: 'private, no-store',
  }));
}

export async function readPrivateAttachment(key: string): Promise<Uint8Array> {
  if (await isDemoSession()) return new Uint8Array();
  const response = await getClient('private').send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }));
  if (!response.Body) throw new Error('Attachment object has no body');
  return response.Body.transformToByteArray();
}

export async function deletePrivateAttachment(key: string): Promise<void> {
  if (await isDemoSession()) return;
  await getClient('private').send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
}

export async function listPrivateAttachmentObjects(societyId: string): Promise<ListedObject[]> {
  if (await isDemoSession()) return [];
  const client = getClient('private');
  const prefix = `attachments/${societyId}/`;
  return collectPaginatedObjects(prefix, async continuationToken => {
    const page = await client.send(new ListObjectsV2Command({ Bucket: privateBucket(), Prefix: prefix, ContinuationToken: continuationToken }));
    return { objects: (page.Contents ?? []).filter(o => !!o.Key).map(o => ({ key: o.Key!, size: o.Size ?? 0, lastModified: o.LastModified })), isTruncated: page.IsTruncated ?? false, nextContinuationToken: page.NextContinuationToken };
  });
}

// Staged import CSV — a temporary private object deleted on a successful commit
// resident.
export function importCsvKey(societyId: string, batchId: string): string {
  return `imports/${societyId}/${batchId}.csv`;
}

export async function uploadImportCsv(key: string, body: Uint8Array): Promise<void> {
  if (await isDemoSession()) return;
  await getClient('private').send(new PutObjectCommand({
    Bucket: privateBucket(), Key: key, Body: body, ContentType: 'text/csv; charset=utf-8',
    CacheControl: 'private, no-store',
  }));
}

export async function readImportCsv(key: string): Promise<Uint8Array> {
  if (await isDemoSession()) return new Uint8Array();
  const response = await getClient('private').send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }));
  if (!response.Body) throw new Error('Import object has no body');
  return response.Body.transformToByteArray();
}

export async function deleteImportCsv(key: string): Promise<void> {
  if (await isDemoSession()) return;
  await getClient('private').send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
}

export async function listImportObjects(societyId: string): Promise<ListedObject[]> {
  if (await isDemoSession()) return [];
  const client = getClient('private');
  const prefix = `imports/${societyId}/`;
  return collectPaginatedObjects(prefix, async continuationToken => {
    const page = await client.send(new ListObjectsV2Command({ Bucket: privateBucket(), Prefix: prefix, ContinuationToken: continuationToken }));
    return { objects: (page.Contents ?? []).filter(o => !!o.Key).map(o => ({ key: o.Key!, size: o.Size ?? 0, lastModified: o.LastModified })), isTruncated: page.IsTruncated ?? false, nextContinuationToken: page.NextContinuationToken };
  });
}

export type ArtifactStorage = 'PRIVATE_ARTIFACTS' | 'PRIVATE_ATTACHMENTS' | 'PUBLIC_ARTIFACTS';

const privateArtifactPrefixes = (societyId: string) => [
  `receipts/${societyId}/`, `bills/${societyId}/`, `levy-receipts/${societyId}/`,
  `snapshots/${societyId}/`, `claims/${societyId}/`,
];

export async function listSocietyArtifactObjects(societyId: string): Promise<Array<ListedObject & { storage: ArtifactStorage }>> {
  if (await isDemoSession()) return [];
  const privateClient = getClient('private');
  const legacyClient = getClient('legacy');
  const prefixes = privateArtifactPrefixes(societyId);
  const privatePages = await Promise.all(prefixes.map(prefix => listAllObjects(privateClient, prefix, privateBucket())));
  // The public bucket is read-only compatibility storage. New artifacts never enter it.
  const publicPages = await Promise.all(prefixes.slice(0, 4).map(prefix => listAllObjects(legacyClient, prefix)));
  const privateObjects = await listPrivateAttachmentObjects(societyId);
  return [
    ...privatePages.flat().map(object => ({ ...object, storage: 'PRIVATE_ARTIFACTS' as const })),
    ...publicPages.flat().map(object => ({ ...object, storage: 'PUBLIC_ARTIFACTS' as const })),
    ...privateObjects.map(object => ({ ...object, storage: 'PRIVATE_ATTACHMENTS' as const })),
  ].sort((a, b) => a.key.localeCompare(b.key));
}

export async function readSocietyArtifactObject(args: {
  societyId: string;
  key: string;
  storage: ArtifactStorage;
}): Promise<Uint8Array> {
  const allowed = args.storage === 'PRIVATE_ATTACHMENTS'
    ? [`attachments/${args.societyId}/`]
    : privateArtifactPrefixes(args.societyId);
  if (!allowed.some(prefix => args.key.startsWith(prefix))) throw new Error('ARTIFACT_OUTSIDE_SOCIETY');
  if (await isDemoSession()) return new Uint8Array();
  const client = args.storage === 'PUBLIC_ARTIFACTS' ? getClient('legacy') : getClient('private');
  const response = await client.send(new GetObjectCommand({
    Bucket: args.storage === 'PUBLIC_ARTIFACTS' ? process.env.R2_BUCKET_NAME! : privateBucket(),
    Key: args.key,
  }));
  if (!response.Body) throw new Error('ARTIFACT_BODY_MISSING');
  return response.Body.transformToByteArray();
}

export async function uploadJson(key: string, data: unknown): Promise<string> {
  if (await isDemoSession()) return `demo://${key}`;
  const client = getClient('private');
  await client.send(
    new PutObjectCommand({
      Bucket: privateBucket(),
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
      CacheControl: 'private, no-store',
    })
  );
  return key;
}

export async function uploadGzip(key: string, body: Buffer): Promise<string> {
  if (await isDemoSession()) return `demo://${key}`;
  await getClient('private').send(
    new PutObjectCommand({
      Bucket: privateBucket(),
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
      CacheControl: 'private, no-store',
    })
  );
  return key;
}

export async function listSnapshotObjects(societyId?: string): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  if (await isDemoSession()) return [];
  const client = getClient('private');
  const prefix = societyId ? `snapshots/${societyId}/` : 'snapshots/';
  const objects = await listAllObjects(client, prefix, privateBucket());
  return objects
    .filter(o => !!o.lastModified)
    .map(o => ({
      key:          o.key,
      size:         o.size,
      lastModified: o.lastModified!,
    }))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

export async function deleteObject(key: string): Promise<void> {
  if (await isDemoSession()) return;
  const client = getClient('private');
  await client.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
}

async function listAllObjects(client: S3Client, prefix: string, bucket = process.env.R2_BUCKET_NAME!): Promise<ListedObject[]> {
  return collectPaginatedObjects(prefix, async continuationToken => {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    return {
      objects: (page.Contents ?? []).filter(object => !!object.Key).map(object => ({ key: object.Key!, size: object.Size ?? 0, lastModified: object.LastModified })),
      isTruncated: page.IsTruncated ?? false,
      nextContinuationToken: page.NextContinuationToken,
    };
  });
}

async function objectBytes(client: S3Client, key: string): Promise<Uint8Array> {
  const response = await client.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  }));
  if (!response.Body) throw new Error(`R2 object ${key} has no body`);
  return response.Body.transformToByteArray();
}

async function objectExists(client: S3Client, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}

export async function copyLegacySnapshotsToSociety(
  societyId: string,
  options: { dryRun: boolean }
): Promise<LegacySnapshotMigrationResult[]> {
  if (await isDemoSession()) return [];
  const client = getClient('legacy');
  const bucket = process.env.R2_BUCKET_NAME!;
  return migrateLegacySnapshots({
    list: () => listAllObjects(client, 'snapshots/'),
    exists: key => objectExists(client, key),
    read: key => objectBytes(client, key),
    copy: async (source, target) => {
      await client.send(new CopyObjectCommand({ Bucket: bucket, Key: target, CopySource: `${bucket}/${source}` }));
    },
  }, societyId, options);
}

export async function resolveCompatibleObjectUrl(args: {
  societyId: string;
  legacyStorageLayout: string | null;
  scopedKey: string;
  legacyKey: string;
}): Promise<string | null> {
  if (await isDemoSession()) return null;
  const privateClient = getClient('private');
  const legacyClient = getClient('legacy');
  if (await objectExistsInBucket(privateClient, privateBucket(), args.scopedKey)) return args.scopedKey;
  for (const key of compatibleObjectCandidates(args.legacyStorageLayout, args.scopedKey, args.legacyKey)) {
    if (await objectExists(legacyClient, key)) return key;
  }
  return null;
}

async function objectExistsInBucket(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}
