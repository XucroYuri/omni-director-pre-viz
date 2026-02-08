import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { mimeFromPath, resolveUrlToPath } from './mediaService';

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];
  let start = startStr ? Number(startStr) : NaN;
  let end = endStr ? Number(endStr) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    const suffix = end;
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

export function registerMediaProtocol() {
  protocol.handle('omni-media', async (request) => {
    try {
      const absPath = resolveUrlToPath(request.url);
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        return new Response('Not found', { status: 404 });
      }

      const contentType = mimeFromPath(absPath);
      const size = stat.size;
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const range = parseRange(rangeHeader, size);
        if (!range) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${size}`,
            },
          });
        }

        const nodeStream = createReadStream(absPath, { start: range.start, end: range.end });
        const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
        const chunkSize = range.end - range.start + 1;
        return new Response(webStream, {
          status: 206,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Type': contentType,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
            'Cache-Control': 'no-store',
          },
        });
      }

      const nodeStream = createReadStream(absPath);
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
      return new Response(webStream, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
          'Content-Length': String(size),
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
