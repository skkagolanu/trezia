'use client';
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from 'ai';
import { isToolUIPart, getToolName } from 'ai';
import { DuesResultCard } from './DuesResultCard';
import { isDuesRowArray } from '@/lib/utils/agent-guards';

interface Props {
  messages: UIMessage[];
}

// Renders a tool-result part as a visual card when we recognise its shape.
// Everything else stays text-only by design — the agent is read-only and this
// is the one exception: a richer view of data the model already fetched, not
// a new capability. Returns null for tool parts we don't have a card for, so
// the model's own text summary (also rendered) is the fallback.
function ToolResultCard({ part }: { part: UIMessagePart<UIDataTypes, UITools> }) {
  if (!isToolUIPart(part) || part.state !== 'output-available') return null;
  if (getToolName(part) !== 'checkDues') return null;
  const rows = (part.output as { rows?: unknown } | undefined)?.rows;
  if (!isDuesRowArray(rows)) return null;
  return <DuesResultCard rows={rows} />;
}

export function MessageList({ messages }: Props) {
  return (
    <>
      {messages.map(msg => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          {msg.role === 'user' ? (
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--sf-blue)] text-white px-3 py-2 text-sm">
              {msg.parts
                .filter(p => p.type === 'text')
                .map((p, i) => <span key={i}>{(p as { type: 'text'; text: string }).text}</span>)}
            </div>
          ) : (
            <div className="max-w-[95%] w-full">
              {msg.parts?.map((part, i) => {
                if (part.type === 'text') {
                  return (
                    <div key={i} className="text-sm text-[var(--sf-label)] leading-relaxed whitespace-pre-wrap">
                      {part.text}
                    </div>
                  );
                }
                return <ToolResultCard key={i} part={part} />;
              })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
