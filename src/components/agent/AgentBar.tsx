'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { X, ChevronUp, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { MessageList } from './MessageList';
import { ToolCards } from './ToolCards';
import { societyApiPath } from '@/lib/society-path';

const SESSION_KEY = 'trezia-agent-messages';
function saveMessages(msgs: object[]) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(msgs)); } catch {}
}

export function AgentBar() {
  const pathname = usePathname();
  const [input,       setInput]       = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [flatNumber,  setFlatNumber]  = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);

  // Extract unit UUID if on a flat detail page
  const flatUnitId = useMemo(() => {
    const parts = pathname.split('/').filter(Boolean);
    const residentIndex = parts.lastIndexOf('residents');
    const candidate = residentIndex >= 0 ? parts[residentIndex + 1] : null;
    const uuidChars = '0123456789abcdef-';
    return candidate?.length === 36 && [...candidate.toLowerCase()].every(char => uuidChars.includes(char))
      ? candidate
      : null;
  }, [pathname]);

  // Resolve flat number for chips + placeholder text
  useEffect(() => {
    if (!flatUnitId) { setFlatNumber(null); return; }
    const sb = createClient();
    sb.from('units').select('flat_number').eq('id', flatUnitId).single()
      .then(({ data }) => setFlatNumber(data?.flat_number ?? null));
  }, [flatUnitId]);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: societyApiPath(pathname, '/api/agent'),
      ...(flatUnitId ? { body: { pageContext: { unitId: flatUnitId } } } : {}),
    }),
    [flatUnitId, pathname],
  );

  // Every failure gets visible feedback — a bare 429-only alert() left every
  // other error (network blip, Groq outage, a 500) silently doing nothing,
  // which reads as "the chatbot is broken" and invites a duplicate retry.
  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    onError: (err) => {
      toast.error(err.message.includes('429')
        ? 'Too many requests — please wait a moment.'
        : 'Something went wrong — please try again.');
    },
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => { saveMessages(messages); }, [messages]);

  useEffect(() => {
    if (messages.length > 0) setHistoryOpen(true);
  }, [messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const doSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage({ text });
  }, [input, isLoading, sendMessage]);

  const handleSubmit  = (e: React.FormEvent) => { e.preventDefault(); doSend(); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  };

  const handleChip = (text: string) => { if (!isLoading) sendMessage({ text }); };

  return (
    <div data-agent-bar className="fixed bottom-0 left-0 right-0 z-50">
      <div className="px-4 pb-3">

        {/* ── Conversation thread ──────────────────────────────────────────── */}
        {historyOpen && (
          <div className="max-w-2xl md:max-w-3xl xl:max-w-4xl mx-auto mb-1
                          rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-bg)]
                          shadow-[0_8px_32px_rgba(0,0,0,0.08)] px-3 pt-2 pb-1">

            <div className="flex justify-end mb-1 pr-0.5">
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close conversation"
                className="flex h-7 w-7 items-center justify-center rounded-lg
                           text-[var(--sf-label3)] hover:text-[var(--sf-label)]
                           hover:bg-[var(--sf-surface)] border border-transparent
                           hover:border-[var(--sf-border)] transition-colors"
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>

            <div className="relative">
              <div
                role="log"
                aria-live="polite"
                aria-atomic="false"
                aria-label="Assistant conversation"
                className={`max-h-[52vh] overflow-y-auto space-y-3 px-1 ${messages.length > 0 ? 'pb-8' : 'pb-2'}`}
              >
                {messages.length === 0 && (
                  <p className="py-6 text-center text-xs text-[var(--sf-label3)]">
                    Tap a chip or type to ask about dues, payments, or how to use the app.
                  </p>
                )}
                <MessageList messages={messages} />
                {isLoading && (
                  <div className="flex gap-1 pl-1 py-1" aria-hidden="true">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--sf-label3)] animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--sf-label3)] animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--sf-label3)] animate-bounce [animation-delay:300ms]" />
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {messages.length > 0 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 left-0 right-0 h-10
                             bg-gradient-to-t from-[var(--sf-bg)] to-transparent"
                />
              )}
            </div>
          </div>
        )}

        {/* "Show history" pill */}
        {!historyOpen && messages.length > 0 && (
          <div className="max-w-2xl md:max-w-3xl xl:max-w-4xl mx-auto mb-2 flex justify-center">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--sf-border)]
                         bg-[var(--sf-surface)] px-3 py-1 text-xs text-[var(--sf-label3)]
                         hover:text-[var(--sf-label2)] hover:bg-[var(--sf-bg)] transition-colors"
            >
              <ChevronUp size={11} />
              {messages.length} message{messages.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* Persistent (not just a toast) so it's still visible if the user looks back later */}
        {error && !isLoading && (
          <div className="max-w-2xl md:max-w-3xl xl:max-w-4xl mx-auto mb-1.5 flex items-center gap-1.5
                          rounded-xl border border-[var(--sf-red)]/30 bg-[var(--sf-red)]/[0.06]
                          px-3 py-1.5 text-xs text-[var(--sf-red)]">
            <AlertCircle size={13} className="shrink-0" />
            {error.message.includes('429') ? 'Too many requests — please wait a moment.' : 'That message failed to send — please try again.'}
          </div>
        )}

        {/* ── Composer box ─────────────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          className="max-w-2xl md:max-w-3xl xl:max-w-4xl mx-auto overflow-hidden rounded-2xl
                     border border-[var(--sf-border)] bg-[var(--sf-surface)]
                     shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <textarea
            ref={textareaRef}
            id="agent-input"
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={flatNumber ? `Ask about flat ${flatNumber} — dues, payments, AMC…` : "Ask about dues, a flat's payments, or how to use the app…"}
            disabled={isLoading}
            aria-label="Message to assistant"
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2
                       text-sm leading-snug text-[var(--sf-label)]
                       placeholder:text-[var(--sf-label3)]
                       focus:outline-none max-h-32 overflow-y-auto
                       disabled:opacity-50"
          />

          <div className="flex items-center gap-2 px-3 pb-3 pt-0.5">
            <ToolCards onSend={handleChip} disabled={isLoading} flatNumber={flatNumber ?? undefined} />
            <div className="ml-auto shrink-0">
              {isLoading ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop generation"
                  className="flex h-8 w-8 items-center justify-center rounded-xl
                             border border-[var(--sf-red)] text-[var(--sf-red)]
                             hover:bg-[color-mix(in_srgb,var(--sf-red)_8%,transparent)]
                             transition-colors"
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Send message"
                  className="flex h-8 w-8 items-center justify-center rounded-xl
                             bg-[var(--sf-blue)] text-white
                             disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  →
                </button>
              )}
            </div>
          </div>
        </form>

        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} aria-hidden="true" />
      </div>
    </div>
  );
}
