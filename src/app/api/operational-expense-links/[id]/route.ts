import { itemHandlers } from '@/lib/operations/api';
import { expenseLinksResource } from '@/lib/operations/resources';
export const { PATCH } = itemHandlers(expenseLinksResource);
