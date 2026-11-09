/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const layoutPath = resolve(process.cwd(), 'src/app/(app)/layout.tsx');
const myFlatPath = resolve(process.cwd(), 'src/app/(app)/my-flat/page.tsx');

describe('authenticated app layout runtime boundaries', () => {
  it('lazy-loads capability-gated client enhancements from the shared layout', () => {
    const source = readFileSync(layoutPath, 'utf8');

    expect(source).toContain("import dynamic from 'next/dynamic';");
    expect(source).toContain("const AgentBar = dynamic(() => import('@/components/agent/AgentBar').then(module => module.AgentBar));");
    expect(source).toContain("const CommandPalette = dynamic(() => import('@/components/layout/CommandPalette'));");
    expect(source).toContain("const NotificationOptIn = dynamic(() => import('@/components/notifications/NotificationOptIn'));");
    expect(source).toContain('{showNotificationOptIn && (');
    expect(source).toContain("(role === 'resident' || hasCapability(role, 'finance_read'))");
    expect(source).toContain('{showAgentBar && <AgentBar />}');
    expect(source).toContain('{!isDemo && hasAgentCapability && <CommandPalette />}');
  });

  it('renders the notification opt-in only from the shared layout', () => {
    const source = readFileSync(myFlatPath, 'utf8');

    expect(source).not.toContain("@/components/notifications/NotificationOptIn");
    expect(source).not.toContain('<NotificationOptIn />');
  });
});
