// Runtime guards for agent tool-result JSON arriving over the wire (AI SDK v6
// UIMessage tool parts type `output` as `unknown` for an untyped tool set —
// see MessageList.tsx / DuesResultCard.tsx).

export interface DuesRow {
  flat: string;
  resident: string | null;
  monthsOverdue: number;
  totalDue: number;
}

export function isDuesRowArray(v: unknown): v is DuesRow[] {
  return Array.isArray(v) && v.every(r =>
    r && typeof r === 'object'
    && typeof (r as Record<string, unknown>).flat === 'string'
    && typeof (r as Record<string, unknown>).monthsOverdue === 'number'
    && typeof (r as Record<string, unknown>).totalDue === 'number',
  );
}
