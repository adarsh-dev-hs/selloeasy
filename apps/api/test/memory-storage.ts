import type { StorageProvider } from '@selloeasy/core';

/** In-memory StorageProvider so tests and CI need no S3/MinIO. */
export function memoryStorage(): StorageProvider {
  const objects = new Map<string, Buffer>();
  return {
    driver: 'minio',
    bucket: 'test',
    async putObject(key, body) {
      objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
    async getObject(key) {
      const o = objects.get(key);
      if (!o) throw new Error(`missing ${key}`);
      return o;
    },
    async deleteObject(key) {
      objects.delete(key);
    },
    async presignPut(key) {
      return `http://storage.test/${key}?put`;
    },
    async presignGet(key) {
      return `http://storage.test/${key}`;
    },
    async ensureBucket() {},
  };
}
