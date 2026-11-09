import { MultipartLimitError, parseBoundedMultipart } from '@/lib/uploads/multipart';

function streamingMultipart(fileBytes: Uint8Array): Request {
  const boundary = 'trezia-test-boundary';
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\nok\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\n`
    + 'Content-Type: image/png\r\n\r\n',
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
      controller.enqueue(fileBytes);
      controller.enqueue(suffix);
      controller.close();
    },
  });
  return new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('parseBoundedMultipart', () => {
  it('parses one streamed file and bounded fields', async () => {
    const result = await parseBoundedMultipart(streamingMultipart(Uint8Array.from([1, 2, 3, 4])), {
      fileField: 'file',
      maxFileBytes: 8,
    });

    expect(result.fields).toEqual({ label: 'ok' });
    expect(result.file.filename).toBe('proof.png');
    expect([...result.file.bytes]).toEqual([1, 2, 3, 4]);
  });

  it('rejects oversized streamed files without relying on Content-Length', async () => {
    await expect(parseBoundedMultipart(streamingMultipart(new Uint8Array(32)), {
      fileField: 'file',
      maxFileBytes: 8,
    })).rejects.toBeInstanceOf(MultipartLimitError);
  });
});
