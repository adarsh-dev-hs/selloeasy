import { setStorageForTests } from '@selloeasy/core';
import { applyTestEnv } from './env';
import { memoryStorage } from './memory-storage';

applyTestEnv();
setStorageForTests(memoryStorage());
