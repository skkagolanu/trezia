import { collectionHandlers } from '@/lib/operations/api';
import { vendorsResource } from '@/lib/operations/resources';
export const runtime = 'nodejs';
export const { GET, POST } = collectionHandlers(vendorsResource);
