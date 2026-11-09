'use client';

interface Props {
  onSend:      (text: string) => void;
  disabled?:   boolean;
  flatNumber?: string;
}

export function ToolCards({ onSend, disabled, flatNumber }: Props) {
  const chips = flatNumber
    ? [
        { label: 'Dues',    icon: '📊', text: `What are the dues for flat ${flatNumber}?` },
        { label: 'History', icon: '📅', text: `Show me the last 10 payments for flat ${flatNumber}` },
      ]
    : [
        { label: 'Dues',       icon: '📊', text: 'Who has pending maintenance dues?' },
        { label: 'This Month', icon: '📅', text: "What's this month's collection and expense summary?" },
      ];

  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
      {chips.map(chip => (
        <button
          key={chip.label}
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => onSend(chip.text)}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full
                     border border-[var(--sf-border)] bg-[var(--sf-bg)]
                     px-2.5 py-1 text-[11px] font-medium text-[var(--sf-label2)]
                     hover:border-[var(--sf-blue)] hover:text-[var(--sf-blue)]
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span aria-hidden="true">{chip.icon}</span>
          {chip.label}
        </button>
      ))}
    </div>
  );
}
