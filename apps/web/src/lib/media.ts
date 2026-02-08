import { createHash, createHmac, randomUUID } from 'node:crypto';

export type MediaItem = {
  key: string;
  bytes: Buffer;
  contentType: string;
};

export type MediaStore = {
  put(item: MediaItem): Promise<{ key: string }>;
  get(key: string): Promise<{ key: string; bytes: Buffer; contentType: string } | null>;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function buildS3BaseUrl(endpoint: string, bucket: string, forcePathStyle: boolean): string {
  const normalized = endpoint.replace(/\/$/, '');
  if (forcePathStyle) {
    return `${normalized}/${bucket}`;
  }
  const url = new URL(normalized);
  const host = url.host;
  url.host = `${bucket}.${host}`;
  return url.toString().replace(/\/$/, '');
}

function getS3Config() {
  const endpoint = requireEnv('S3_ENDPOINT');
  const bucket = requireEnv('S3_BUCKET');
  const accessKey = requireEnv('S3_ACCESS_KEY');
  const secretKey = requireEnv('S3_SECRET_KEY');
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE || '').trim().toLowerCase() === 'true';
  const baseUrl = buildS3BaseUrl(endpoint, bucket, forcePathStyle);
  return { endpoint, bucket, accessKey, secretKey, forcePathStyle, baseUrl };
}

function toAmzDate(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function signV4(input: {
  method: 'GET' | 'PUT';
  url: URL;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  payloadHash: string;
  headers: Record<string, string>;
  now: Date;
}): { headers: Record<string, string> } {
  const { method, url, region, service, accessKey, secretKey, payloadHash, now } = input;
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = url.pathname || '/';
  const canonicalQuery = url.searchParams
    .toString()
    .split('&')
    .filter(Boolean)
    .sort()
    .join('&');

  const headersLower: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) {
    headersLower[k.toLowerCase()] = String(v).trim();
  }
  headersLower.host = url.host;
  headersLower['x-amz-date'] = amzDate;
  headersLower['x-amz-content-sha256'] = payloadHash;

  const signedHeaderNames = Object.keys(headersLower)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headersLower[k]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const canonicalRequestHash = sha256Hex(canonicalRequest);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n');

  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    headers: {
      ...headersLower,
      authorization,
    },
  };
}

export function createS3MediaStore(): MediaStore {
  const { accessKey, secretKey, baseUrl } = getS3Config();
  const region = (process.env.S3_REGION || 'us-east-1').trim() || 'us-east-1';
  const service = 's3';

  return {
    async put(item: MediaItem) {
      const key = item.key || `media/${randomUUID()}`;
      const url = new URL(`${baseUrl}/${encodeURIComponent(key).replace(/%2F/g, '/')}`);
      const now = new Date();
      const payloadHash = sha256Hex(item.bytes);
      const signed = signV4({
        method: 'PUT',
        url,
        region,
        service,
        accessKey,
        secretKey,
        payloadHash,
        now,
        headers: {
          'content-type': item.contentType,
        },
      });

      const res = await fetch(url, {
        method: 'PUT',
        headers: signed.headers,
        body: new Uint8Array(item.bytes),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`S3 PUT failed (${res.status}): ${text}`);
      }
      return { key };
    },

    async get(key: string) {
      const url = new URL(`${baseUrl}/${encodeURIComponent(key).replace(/%2F/g, '/')}`);
      const now = new Date();
      const payloadHash = sha256Hex('');
      const signed = signV4({
        method: 'GET',
        url,
        region,
        service,
        accessKey,
        secretKey,
        payloadHash,
        now,
        headers: {},
      });
      const res = await fetch(url, {
        method: 'GET',
        headers: signed.headers,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`S3 GET failed (${res.status}): ${text}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'application/octet-stream';
      return { key, bytes: buf, contentType };
    },
  };
}
