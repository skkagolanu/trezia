import { newAttachmentIdentity, safeDownloadFilename, validateAttachment } from '@/lib/operations/attachments';

describe('private attachments', () => {
  it('accepts matching PDF magic bytes and hashes content', () => {
    const result = validateAttachment(new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31]), 'application/pdf');
    expect(result.contentType).toBe('application/pdf');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a spoofed content type', () => {
    expect(() => validateAttachment(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), 'application/pdf')).toThrow('INVALID_ATTACHMENT_TYPE');
  });

  it('creates opaque society-scoped keys and safe download names', () => {
    expect(newAttachmentIdentity('society-1').key).toMatch(/^attachments\/society-1\/[0-9a-f-]{36}$/);
    expect(safeDownloadFilename('bad\r\n"/name.pdf')).toBe('bad____name.pdf');
  });
});
