import { createHash, randomUUID } from 'node:crypto';
import { attachmentKey } from '@/lib/storage/r2';

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export function validateAttachment(bytes: Uint8Array, claimedType: string): { contentType: AttachmentType; sha256: string } {
  if (bytes.length < 4 || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('INVALID_ATTACHMENT_SIZE');
  const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((v, i) => bytes[i] === v);
  const detected = pdf ? 'application/pdf' : jpeg ? 'image/jpeg' : png ? 'image/png' : null;
  if (!detected || detected !== claimedType) throw new Error('INVALID_ATTACHMENT_TYPE');
  return { contentType: detected, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function newAttachmentIdentity(societyId: string): { id: string; key: string } {
  const id = randomUUID();
  return { id, key: attachmentKey(societyId, id) };
}

export function safeDownloadFilename(value: string): string {
  return value.replace(/[\r\n"\\/]/g, '_').slice(0, 255) || 'attachment';
}
