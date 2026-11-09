import { itemHandlers } from '@/lib/operations/api';
import { documentsResource } from '@/lib/operations/resources';
export const { PATCH } = itemHandlers(documentsResource);
