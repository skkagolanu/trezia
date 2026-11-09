import { collectionHandlers } from '@/lib/operations/api';
import { documentsResource } from '@/lib/operations/resources';
export const runtime = 'nodejs';
export const { GET, POST } = collectionHandlers(documentsResource);
