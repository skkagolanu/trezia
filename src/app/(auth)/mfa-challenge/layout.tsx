import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Two-factor verification · Trezia', description: 'Verify your authenticator code to continue.', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
