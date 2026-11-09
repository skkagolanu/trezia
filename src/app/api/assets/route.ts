import { collectionHandlers } from '@/lib/operations/api';
import { assetsResource } from '@/lib/operations/resources';
export const runtime = 'nodejs';
export const { GET, POST } = collectionHandlers(assetsResource);
