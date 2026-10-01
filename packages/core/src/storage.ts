import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from './config';

/**
 * StorageProvider — one interface, two drivers selected by STORAGE_DRIVER (ADR-0012):
 * - `minio`: local S3-compatible storage with static keys and path-style URLs.
 * - `s3`: AWS S3 using the default credential chain (ECS task role) — no static keys.
 */
export interface StorageProvider {
  readonly driver: 'minio' | 's3';
  readonly bucket: string;
  putObject(key: string, body: Buffer | string, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  presignPut(key: string, contentType: string, expiresInSec?: number): Promise<string>;
  presignGet(key: string, expiresInSec?: number): Promise<string>;
  ensureBucket(): Promise<void>;
}

function clientConfig(endpoint: string | undefined): S3ClientConfig {
  const c = getConfig();
  const cfg: S3ClientConfig = {
    region: c.S3_REGION,
    forcePathStyle: c.S3_FORCE_PATH_STYLE,
  };
  if (endpoint) cfg.endpoint = endpoint;
  if (c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY) {
    cfg.credentials = { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY };
  }
  return cfg;
}

class S3Storage implements StorageProvider {
  readonly driver: 'minio' | 's3';
  readonly bucket: string;
  private readonly client: S3Client;
  /** Presigned URLs must use an endpoint the *browser* can reach (MinIO's public port locally). */
  private readonly presignClient: S3Client;

  constructor() {
    const c = getConfig();
    this.driver = c.STORAGE_DRIVER;
    this.bucket = c.S3_BUCKET;
    const endpoint = c.STORAGE_DRIVER === 'minio' ? c.S3_ENDPOINT : c.S3_ENDPOINT || undefined;
    this.client = new S3Client(clientConfig(endpoint));
    this.presignClient = new S3Client(clientConfig(c.S3_PUBLIC_ENDPOINT ?? endpoint));
  }

  async putObject(key: string, body: Buffer | string, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async getObject(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  presignPut(key: string, contentType: string, expiresInSec = 600) {
    return getSignedUrl(this.presignClient, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), {
      expiresIn: expiresInSec,
    });
  }

  presignGet(key: string, expiresInSec = 300) {
    return getSignedUrl(this.presignClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }

  /** Local only: create the MinIO bucket + CORS. In AWS the bucket is created by CDK. */
  async ensureBucket() {
    if (this.driver !== 'minio') return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    await this.client
      .send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ['PUT', 'GET'],
                AllowedOrigins: getConfig().CORS_ORIGINS.split(',').map((s) => s.trim()),
                AllowedHeaders: ['*'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        }),
      )
      .catch(() => undefined); // MinIO accepts CORS via global config too; non-fatal.
  }
}

let storage: StorageProvider | undefined;
export function getStorage(): StorageProvider {
  if (!storage) storage = new S3Storage();
  return storage;
}
export function setStorageForTests(s: StorageProvider | undefined) {
  storage = s;
}
