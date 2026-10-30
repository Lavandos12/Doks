import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface R2Config {
  endpoint: string;       // e.g. https://<account_id>.r2.cloudflarestorage.com
  bucket: string;         // e.g. doks-vault
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;        // default: 'auto'
}

export class R2Storage {
  private config: R2Config | null = null;

  constructor() {
    const endpoint = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT;
    const bucket = process.env.R2_BUCKET || process.env.S3_BUCKET;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.R2_REGION || process.env.AWS_REGION || 'auto';

    if (endpoint && bucket && accessKeyId && secretAccessKey) {
      this.config = { endpoint: endpoint.replace(/\/+$/, ''), bucket, accessKeyId, secretAccessKey, region };
      console.log(`[R2Storage] Initialized remote persistence with bucket: ${bucket}`);
    } else {
      console.log('[R2Storage] Remote S3/R2 persistence disabled (local disk mode).');
    }
  }

  public isConfigured(): boolean {
    return this.config !== null;
  }

  private hmac(key: Buffer | string, stringToSign: string): Buffer {
    return crypto.createHmac('sha256', key).update(stringToSign).digest();
  }

  private hash(content: Buffer | string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = this.hmac('AWS4' + key, dateStamp);
    const kRegion = this.hmac(kDate, regionName);
    const kService = this.hmac(kRegion, serviceName);
    return this.hmac(kService, 'aws4_request');
  }

  public async uploadFile(remoteKey: string, localFilePath: string): Promise<boolean> {
    if (!this.config || !fs.existsSync(localFilePath)) return false;

    try {
      const fileData = fs.readFileSync(localFilePath);
      const url = new URL(`${this.config.endpoint}/${this.config.bucket}/${remoteKey}`);
      const method = 'PUT';
      const service = 's3';
      const region = this.config.region || 'auto';

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const payloadHash = this.hash(fileData);

      const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonicalRequest = `${method}\n/${this.config.bucket}/${encodeURIComponent(remoteKey)}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${this.hash(canonicalRequest)}`;

      const signingKey = this.getSignatureKey(this.config.secretAccessKey, dateStamp, region, service);
      const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

      const authHeader = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(url.toString(), {
        method,
        headers: {
          'Host': url.host,
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          'Authorization': authHeader,
          'Content-Type': 'application/octet-stream'
        },
        body: fileData
      });

      if (!res.ok) {
        console.error(`[R2Storage] Upload error (${res.status}): ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[R2Storage] Failed to upload snapshot:', err);
      return false;
    }
  }

  public async downloadFile(remoteKey: string, targetPath: string): Promise<boolean> {
    if (!this.config) return false;

    try {
      const url = new URL(`${this.config.endpoint}/${this.config.bucket}/${remoteKey}`);
      const method = 'GET';
      const service = 's3';
      const region = this.config.region || 'auto';

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const payloadHash = this.hash('');

      const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonicalRequest = `${method}\n/${this.config.bucket}/${encodeURIComponent(remoteKey)}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${this.hash(canonicalRequest)}`;

      const signingKey = this.getSignatureKey(this.config.secretAccessKey, dateStamp, region, service);
      const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

      const authHeader = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(url.toString(), {
        method,
        headers: {
          'Host': url.host,
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          'Authorization': authHeader
        }
      });

      if (res.status === 404) return false;
      if (!res.ok) {
        console.error(`[R2Storage] Download error (${res.status}): ${await res.text()}`);
        return false;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, buffer);
      return true;
    } catch (err) {
      console.error('[R2Storage] Failed to download snapshot:', err);
      return false;
    }
  }
}
