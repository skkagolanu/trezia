import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import type { UIMessage } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { requireFinancialReader } from '@/lib/supabase/require-auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { agentTools } from '@/lib/agent/tools';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { getDemoReply } from '@/lib/agent/demo-responses';
import { check } from '@/lib/utils/rate-limit';
import { isDemoSession } from '@/lib/demo/session.server';

export const maxDuration = 60;
export const runtime    = 'nodejs';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

// runaway client retry loop could burn the whole daily budget in seconds.
// Keyed per admin user, well under the RPM ceiling so legitimate bursts
// (rapid follow-up questions) still pass.
const AGENT_RATE_LIMIT = 15;
const AGENT_RATE_WINDOW_MS = 60_000;


const AGENT_GLOBAL_DAILY_LIMIT = Number(process.env.AGENT_GLOBAL_DAILY_LIMIT ?? 800);

// Demo mode: a MockLanguageModelV3 emitting a single canned text response,
// computed from DEMO_DATA (demo-responses.ts) — never calls Groq, so
// GROQ_API_KEY is never read. Goes through the exact same
// streamText()/toUIMessageStreamResponse() pipeline as the real model, so
// the client-side protocol is identical; only the "model" differs.
function buildDemoModel(replyText: string): MockLanguageModelV3 {
  const id = 'demo-text';
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id },
          { type: 'text-delta', id, delta: replyText },
          { type: 'text-end', id },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: undefined, text: undefined, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

export async function POST(req: Request) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const rate = check(`agent:${auth.societyId}:${auth.userId}`, AGENT_RATE_LIMIT, AGENT_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return new Response('Too many requests — please wait a moment.', {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
    });
  }

  let messages: UIMessage[];
  let pageUnitId: string | undefined;
  try {
    const body = await req.json();
    messages   = body.messages as UIMessage[];
    pageUnitId = (body.pageContext as { unitId?: string } | undefined)?.unitId;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('messages must be a non-empty array', { status: 400 });
  }

  if (await isDemoSession()) {
    const lastUser = messages.findLast(m => m.role === 'user');
    const text = (lastUser?.parts ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join(' ');
    const demoResult = streamText({ model: buildDemoModel(getDemoReply(text)), prompt: 'demo' });
    return demoResult.toUIMessageStreamResponse();
  }

  // Read live maintenance amount so the prompt stays in sync with Settings changes
  const sb = await createClient();
  const [{ data: config }, { data: unit }] = await Promise.all([
    sb.from('society_config')
      .select('monthly_maintenance_amount, agent_enabled, agent_daily_user_limit, agent_daily_society_limit')
      .eq('society_id', auth.societyId).single(),
    pageUnitId
      ? sb.from('units').select('flat_number').eq('id', pageUnitId).eq('society_id', auth.societyId).single()
      : Promise.resolve({ data: null }),
  ]);

  // The assistant is opt-in per society. A disabled society never reaches Groq
  // and its AgentBar is not rendered, so this is defence-in-depth.
  const agentConfig = config as {
    agent_enabled?: boolean;
    agent_daily_user_limit?: number;
    agent_daily_society_limit?: number;
  } | null;
  if (!agentConfig?.agent_enabled) {
    return new Response('The assistant is turned off for this society.', { status: 403 });
  }

  // Durable daily quota: consume user/society/deployment budget atomically
  // before calling the model, so a failed provider call still counts and a
  // throttled client cannot burn the shared free-tier allowance.
  const service = await createServiceClient();
  const { data: exhausted, error: quotaError } = await service.rpc('consume_agent_quota', {
    p_user_id: auth.userId,
    p_society_id: auth.societyId,
    p_user_limit: agentConfig.agent_daily_user_limit ?? 20,
    p_society_limit: agentConfig.agent_daily_society_limit ?? 100,
    p_deployment_limit: AGENT_GLOBAL_DAILY_LIMIT,
  });
  if (quotaError) {
    console.error('[api/agent] consume_agent_quota failed:', quotaError);
    return new Response('The assistant is temporarily unavailable.', { status: 503 });
  }
  if (typeof exhausted === 'string' && exhausted.length > 0) {
    const scope = exhausted === 'user' ? 'your' : exhausted === 'society' ? "this society's" : "the platform's";
    return new Response(`You've reached ${scope} daily assistant limit. Please try again tomorrow.`, { status: 429 });
  }
  // Read-only assistant must never 500 the chat over missing config — degrade
  // gracefully by omitting the amount rather than fabricating a number.
  const maintenanceAmount = (config as { monthly_maintenance_amount?: number } | null)
    ?.monthly_maintenance_amount ?? null;
  const flatContext = unit ? { flatNumber: (unit as { flat_number: string }).flat_number } : undefined;

  // Trim to last 10 messages — stabilises input token cost regardless of conversation length
  const modelMessages = await convertToModelMessages(messages.slice(-10));

  const result = streamText({
    model:       groq('llama-3.3-70b-versatile'),
    system:      buildSystemPrompt(maintenanceAmount, flatContext),
    messages:    modelMessages,
    tools:       agentTools,
    stopWhen:    stepCountIs(4),
    temperature: 0.1,
    maxOutputTokens: 2048,
  });

  return result.toUIMessageStreamResponse();
}
