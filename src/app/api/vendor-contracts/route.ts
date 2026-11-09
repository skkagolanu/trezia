import { collectionHandlers } from '@/lib/operations/api';
import { contractsResource } from '@/lib/operations/resources';
export const runtime = 'nodejs';
export const { GET, POST } = collectionHandlers(contractsResource);
