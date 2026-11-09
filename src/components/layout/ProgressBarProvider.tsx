'use client';

import { AppProgressBar as ProgressBar } from 'next-nprogress-bar';

export default function ProgressBarProvider() {
  return (
    <ProgressBar
      height="3px"
      color="var(--sf-blue)"
      options={{ showSpinner: false }}
      shallowRouting
    />
  );
}
