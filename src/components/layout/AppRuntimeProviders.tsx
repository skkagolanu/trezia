'use client';
import { Toaster } from 'react-hot-toast';
import ProgressBarProvider from './ProgressBarProvider';
import ServiceWorkerRegister from './ServiceWorkerRegister';

export default function AppRuntimeProviders() {
  return <><ProgressBarProvider /><ServiceWorkerRegister /><Toaster position="top-right" toastOptions={{ duration: 3000, style: { background: 'var(--sf-surface)', color: 'var(--sf-label)', border: '1px solid var(--sf-border)', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)' } }} /></>;
}
