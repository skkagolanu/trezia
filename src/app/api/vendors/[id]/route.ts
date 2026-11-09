import { itemHandlers } from '@/lib/operations/api';
import { vendorsResource } from '@/lib/operations/resources';
export const { PATCH } = itemHandlers(vendorsResource);
