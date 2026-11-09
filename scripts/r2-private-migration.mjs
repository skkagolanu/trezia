import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const societyIndex = args.indexOf('--society');
const societyId = societyIndex >= 0 ? args[societyIndex + 1] : undefined;
const execute = args.includes('--execute');
const includeUnscopedLegacy = args.includes('--include-unscoped-legacy');
if (!societyId || societyId.startsWith('-')) {
  throw new Error('Usage: node scripts/r2-private-migration.mjs --society <society-id> [--include-unscoped-legacy] [--execute]');
}

const accountId = process.env.R2_ACCOUNT_ID;
const legacyJurisdiction = (process.env.R2_LEGACY_JURISDICTION ?? process.env.R2_JURISDICTION)?.trim().toLowerCase();
const privateJurisdiction = (process.env.R2_PRIVATE_JURISDICTION ?? process.env.R2_JURISDICTION)?.trim().toLowerCase();
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const sourceBucket = process.env.R2_BUCKET_NAME;
const destinationBucket = process.env.R2_PRIVATE_BUCKET_NAME;
if (!accountId || !accessKeyId || !secretAccessKey || !sourceBucket || !destinationBucket) {
  throw new Error('R2 credentials, R2_BUCKET_NAME, and R2_PRIVATE_BUCKET_NAME are required');
}
if (legacyJurisdiction && !['eu', 'fedramp', 'us'].includes(legacyJurisdiction)) {
  throw new Error('R2_LEGACY_JURISDICTION must be eu, fedramp, or us');
}
if (privateJurisdiction && !['eu', 'fedramp', 'us'].includes(privateJurisdiction)) {
  throw new Error('R2_PRIVATE_JURISDICTION must be eu, fedramp, or us');
}
if (sourceBucket === destinationBucket) throw new Error('Legacy and private buckets must differ');

const clientFor = jurisdiction => new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}${jurisdiction ? `.${jurisdiction}` : ''}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});
const sourceClient = clientFor(legacyJurisdiction);
const destinationClient = clientFor(privateJurisdiction);
const prefixes = ['receipts', 'bills', 'levy-receipts', 'snapshots', 'claims'].map(prefix => `${prefix}/${societyId}/`);

async function bytes(client, bucket, key) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Missing body for ${bucket}/${key}`);
  return result.Body.transformToByteArray();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function contentTypeFor(key) {
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.jpe?g$/i.test(key)) return 'image/jpeg';
  return 'application/json';
}

async function destinationExists(key) {
  try {
    await destinationClient.send(new HeadObjectCommand({ Bucket: destinationBucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

async function migrateObject(sourceKey, destinationKey) {
  const source = await bytes(sourceClient, sourceBucket, sourceKey);
  const sourceHash = sha256(source);
  if (await destinationExists(destinationKey)) {
    const destinationHash = sha256(await bytes(destinationClient, destinationBucket, destinationKey));
    if (sourceHash !== destinationHash) throw new Error(`Refusing conflicting destination at ${destinationKey}`);
    console.log(`VERIFIED EXISTING ${sourceKey} -> ${destinationKey} sha256=${sourceHash}`);
    return;
  }
  if (!execute) {
    console.log(`DRY RUN ${sourceKey} -> ${destinationKey} sha256=${sourceHash}`);
    return;
  }
  await destinationClient.send(new PutObjectCommand({
    Bucket: destinationBucket,
    Key: destinationKey,
    Body: source,
    ContentType: contentTypeFor(sourceKey),
    CacheControl: 'private, no-store',
  }));
  const destination = await bytes(destinationClient, destinationBucket, destinationKey);
  if (sourceHash !== sha256(destination)) throw new Error(`SHA-256 verification failed for ${destinationKey}`);
  console.log(`COPIED ${sourceKey} -> ${destinationKey} sha256=${sourceHash}`);
}

async function listPrivateClaimObjects() {
  const prefix = `claims/${societyId}/`;
  let continuationToken;
  do {
    const page = await destinationClient.send(new ListObjectsV2Command({
      Bucket: destinationBucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      if (object.Key) console.log(`PRIVATE CLAIM INVENTORY ${object.Key} (review only; never deleted)`);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

await listPrivateClaimObjects();

for (const prefix of prefixes) {
  let continuationToken;
  do {
    const page = await sourceClient.send(new ListObjectsV2Command({
      Bucket: sourceBucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      await migrateObject(object.Key, object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

if (includeUnscopedLegacy) {
  for (const base of ['receipts', 'bills', 'levy-receipts', 'snapshots']) {
    const prefix = `${base}/`;
    let continuationToken;
    do {
      const page = await sourceClient.send(new ListObjectsV2Command({ Bucket: sourceBucket, Prefix: prefix, ContinuationToken: continuationToken }));
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        const filename = object.Key.slice(prefix.length);
        if (!filename || filename.includes('/')) continue;
        await migrateObject(object.Key, `${prefix}${societyId}/${filename}`);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}

console.log(execute ? 'Copy complete. No public objects were deleted or modified.' : 'Dry run complete. Re-run with --execute to copy.');
