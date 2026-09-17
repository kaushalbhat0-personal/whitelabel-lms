'use client';
import { cn } from '@/lib/utils';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { useState } from 'react';

type AlertVariant = 'error' | 'warning' | 'info' | 'success';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  action?: React.ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}

const variantConfig: Record<AlertVariant, { bg: string; border: string; icon: typeof AlertCircle; iconColor: string; text: string }> = {
  error: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: AlertCircle,
    iconColor: 'text-red-600',
    text: 'text-red-700',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: AlertTriangle,
    iconColor: 'text-amber-600',
    text: 'text-amber-800',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: Info,
    iconColor: 'text-blue-600',
    text: 'text-blue-800',
  },
  success: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: CheckCircle,
    iconColor: 'text-green-600',
    text: 'text-green-800',
  },
};

export function Alert({
  variant = 'error',
  title,
  children,
  dismissible = false,
  onDismiss,
  action,
  className,
  role = 'alert',
}: AlertProps) {
  const [visible, setVisible] = useState(true);
  const config = variantConfig[variant];
  const Icon = config.icon;

  if (!visible) return null;

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  return (
    <div
      role={role}
      className={cn(
        'flex gap-3 rounded-xl border p-3 text-sm',
        config.bg,
        config.border,
        config.text,
        className,
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', config.iconColor)} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold leading-tight">{title}</p>}
        <div className={cn(title ? 'mt-1' : '', 'leading-relaxed')}>{children}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss alert"
          className="shrink-0 rounded-lg p-1 hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center -mr-1 -mt-1"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
