/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Modal from '@/components/ui/Modal';

jest.mock('focus-trap-react', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open modal</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirm action">
        <button type="button">Dialog action</button>
      </Modal>
    </>
  );
}

describe('Modal focus restoration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['Escape', 'close button', 'backdrop'] as const)('returns focus to its trigger after %s closes the dialog', (closePath) => {
    render(<ModalHarness />);

    const trigger = screen.getByRole('button', { name: 'Open modal' });
    trigger.focus();
    fireEvent.click(trigger);

    if (closePath === 'Escape') {
      fireEvent.keyDown(document, { key: 'Escape' });
    } else if (closePath === 'close button') {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    } else {
      fireEvent.click(screen.getByRole('dialog').parentElement!);
    }

    act(() => { jest.advanceTimersByTime(90); });
    expect(trigger).toHaveFocus();
  });
});
