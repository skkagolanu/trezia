type Color = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple';

const colorClass: Record<Color, string> = {
  green:  'bg-[color-mix(in_srgb,var(--sf-label)_12%,transparent)] text-[var(--sf-label)]',
  red:    'bg-[color-mix(in_srgb,var(--sf-blue)_14%,transparent)] text-[var(--sf-blue)]',
  yellow: 'bg-[color-mix(in_srgb,var(--sf-label3)_20%,transparent)] text-[var(--sf-label)]',
  blue:   'bg-[color-mix(in_srgb,var(--sf-blue)_12%,transparent)] text-[var(--sf-blue)]',
  gray:   'bg-[color-mix(in_srgb,var(--sf-label3)_20%,transparent)] text-[var(--sf-label3)]',
  purple: 'bg-[color-mix(in_srgb,var(--sf-label2)_12%,transparent)] text-[var(--sf-label2)]',
};

interface Props {
  color?: Color;
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ color = 'gray', children, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-semibold ${colorClass[color]} ${className}`}>
      {children}
    </span>
  );
}

export function paymentModeBadge(mode: string): Color {
  switch (mode) {
    case 'UPI':              return 'blue';
    case 'CASH':             return 'green';
    case 'CHEQUE':           return 'yellow';
    case 'ADVANCE':          return 'gray';
    case 'BANK_TRANSFER':
    case 'NEFT':
    case 'IMPS':             return 'blue';
    default:                 return 'gray';
  }
}

export function billStatusBadge(status: string): Color {
  switch (status) {
    case 'PAID':      return 'green';
    case 'OVERDUE':   return 'red';
    case 'ISSUED':    return 'yellow';
    case 'DRAFT':     return 'gray';
    case 'CANCELLED': return 'red';
    default:          return 'gray';
  }
}
