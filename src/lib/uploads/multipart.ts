import { Readable, Transform } from 'node:stream';
import busboy from 'busboy';

type UploadedFile = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type BoundedMultipart = {
  fields: Record<string, string>;
  file: UploadedFile;
};

export class MultipartLimitError extends Error {}

export async function parseBoundedMultipart(
  request: Request,
  options: { fileField: string; maxFileBytes: number; maxFields?: number; maxFieldBytes?: number },
): Promise<BoundedMultipart> {
  const maxFields = options.maxFields ?? 8;
  const maxFieldBytes = options.maxFieldBytes ?? 8_192;
  const maxRequestBytes = options.maxFileBytes + (maxFields * maxFieldBytes) + 65_536;
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    throw new MultipartLimitError('Multipart request is too large');
  }
  if (!request.body) throw new Error('Multipart request has no body');

  return new Promise<BoundedMultipart>((resolve, reject) => {
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let uploaded: Omit<UploadedFile, 'bytes'> | null = null;
    let limited = false;

    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: Object.fromEntries(request.headers.entries()),
        limits: {
          files: 1,
          fields: maxFields,
          parts: maxFields + 1,
          fileSize: options.maxFileBytes,
          fieldSize: maxFieldBytes,
        },
      });
    } catch (error) {
      reject(error);
      return;
    }

    parser.on('field', (name, value, info) => {
      if (info.valueTruncated) limited = true;
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      if (name !== options.fileField || uploaded) {
        limited = true;
        stream.resume();
        return;
      }
      uploaded = { filename: info.filename, contentType: info.mimeType };
      stream.on('limit', () => { limited = true; });
      stream.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    });
    parser.on('filesLimit', () => { limited = true; });
    parser.on('fieldsLimit', () => { limited = true; });
    parser.on('partsLimit', () => { limited = true; });
    parser.on('error', reject);
    parser.on('close', () => {
      if (limited) {
        reject(new MultipartLimitError('Multipart limits exceeded'));
        return;
      }
      if (!uploaded) {
        reject(new Error(`Missing ${options.fileField} file`));
        return;
      }
      resolve({ fields, file: { ...uploaded, bytes: new Uint8Array(Buffer.concat(chunks)) } });
    });

    let receivedBytes = 0;
    const requestLimit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > maxRequestBytes) {
          callback(new MultipartLimitError('Multipart request is too large'));
          return;
        }
        callback(null, chunk);
      },
    });

    Readable.from(request.body as unknown as AsyncIterable<Uint8Array>)
      .on('error', reject)
      .pipe(requestLimit)
      .on('error', reject)
      .pipe(parser);
  });
}
