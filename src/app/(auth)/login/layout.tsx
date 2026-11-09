import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Sign in · Trezia', description: 'Sign in securely to your Trezia society workspace.', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
