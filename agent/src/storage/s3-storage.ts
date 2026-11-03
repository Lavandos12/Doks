import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface S3Config {
  endpoint: string;       // e.g. https://xyz.storage.supabase.co/s3
  bucket: string;         // e.g. doks-vault
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export type R2Config = S3Config;

export class S3Storage {
  private config: S3Config | null = null;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
    const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.S3_REGION || process.env.R2_REGION || process.env.AWS_REGION || 'us-east-1';

    if (endpoint && bucket && accessKeyId && secretAccessKey) {
      this.config = {
        endpoint: endpoint.replace(/\/+$/, ''),
        bucket,
        accessKeyId,
        secretAccessKey,
        region
      };
      console.log(`[S3Storage] Configured remote persistence with bucket "${bucket}" on ${endpoint}`);
    } else {
      console.log('[S3Storage] Remote S3 persistence disabled (operating in local disk mode).');
    }
  }

  public isConfigured(): boolean {
    return this.config !== null;
  }

  private hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  private hash(content: Buffer | string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
    const kDate = this.hmac('AWS4' + key, dateStamp);
    const kRegion = this.hmac(kDate, region);
    const kService = this.hmac(kRegion, service);
    return this.hmac(kService, 'aws4_request');
  }

  public async uploadFile(remoteKey: string, localFilePath: string): Promise<boolean> {
    if (!this.config || !fs.existsSync(localFilePath)) return false;

    try {
      const fileData = fs.readFileSync(localFilePath);
      const endpointUrl = new URL(this.config.endpoint);
      const cleanPath = endpointUrl.pathname.replace(/\/+$/, '');
      const encodedKey = remoteKey.split('/').map(encodeURIComponent).join('/');
    const fullPath = `${cleanPath}/${encodeURIComponent(this.config.bucket)}/${encodedKey}`;
      const targetUrl = `${endpointUrl.origin}${fullPath}`;

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const payloadHash = this.hash(fileData);

      const canonicalHeaders = `host:${endpointUrl.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonicalRequest = `PUT\n${fullPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

      const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${this.hash(canonicalRequest)}`;
      const signingKey = this.getSignatureKey(this.config.secretAccessKey, dateStamp, this.config.region, 's3');
      const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

      const authHeader = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
          'Host': endpointUrl.host,
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          'Authorization': authHeader,
          'Content-Type': 'application/octet-stream'
        },
        body: fileData
      });

      if (!res.ok) {
        console.error(`[S3Storage] Upload failed (${res.status}): ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[S3Storage] Error during file upload:', err);
      return false;
    }
  }

  public async downloadFile(remoteKey: string, targetLocalPath: string): Promise<boolean> {
    if (!this.config) return false;

    try {
      const endpointUrl = new URL(this.config.endpoint);
      const cleanPath = endpointUrl.pathname.replace(/\/+$/, '');
      const encodedKey = remoteKey.split('/').map(encodeURIComponent).join('/');
    const fullPath = `${cleanPath}/${encodeURIComponent(this.config.bucket)}/${encodedKey}`;
      const targetUrl = `${endpointUrl.origin}${fullPath}`;

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const payloadHash = this.hash('');

      const canonicalHeaders = `host:${endpointUrl.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonicalRequest = `GET\n${fullPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

      const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${this.hash(canonicalRequest)}`;
      const signingKey = this.getSignatureKey(this.config.secretAccessKey, dateStamp, this.config.region, 's3');
      const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

      const authHeader = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Host': endpointUrl.host,
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          'Authorization': authHeader
        }
      });

      if (res.status === 404) return false;
      if (!res.ok) {
        console.error(`[S3Storage] Download failed (${res.status}): ${await res.text()}`);
        return false;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(targetLocalPath), { recursive: true });
      fs.writeFileSync(targetLocalPath, buffer);
      return true;
    } catch (err) {
      console.error('[S3Storage] Error during file download:', err);
      return false;
    }
  }
}

export const R2Storage = S3Storage;
export type R2Storage = S3Storage;
