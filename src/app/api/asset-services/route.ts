import { collectionHandlers } from '@/lib/operations/api';
import { serviceRecordsResource } from '@/lib/operations/resources';
export const runtime = 'nodejs';
export const { GET, POST } = collectionHandlers(serviceRecordsResource);
