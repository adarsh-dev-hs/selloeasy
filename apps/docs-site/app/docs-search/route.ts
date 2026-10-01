import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

// Docs search lives outside /api/* so the AWS ALB can route /api/* to the API service untouched.
export const { GET } = createFromSource(source);
