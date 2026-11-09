import { itemHandlers } from '@/lib/operations/api';
import { serviceRecordsResource } from '@/lib/operations/resources';
export const { PATCH } = itemHandlers(serviceRecordsResource);
