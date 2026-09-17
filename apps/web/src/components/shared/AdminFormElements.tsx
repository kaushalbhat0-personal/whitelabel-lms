'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';
import { FormField as CanonicalFormField } from '@/components/ui/Form/FormField';

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <section className={cn('rounded-xl border border-surface-border bg-surface-card p-6', className)}>
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {description && <p className="mt-1 text-xs text-text-muted">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface FormRowProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

export function FormRow({ children, columns = 2, className }: FormRowProps) {
  return (
    <div className={cn(
      'grid gap-4',
      columns === 1 && 'grid-cols-1',
      columns === 2 && 'grid-cols-1 sm:grid-cols-2',
      columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      columns === 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
      className,
    )}>
      {children}
    </div>
  );
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}

export function FormField({ label, required, error, children, hint, className }: FormFieldProps) {
  const generatedId = useId();
  // Try to reuse child's id if present, otherwise use generated
  const childId = (children as any)?.props?.id ?? `field-${generatedId.replace(/:/g, '')}`;
  return (
    <CanonicalFormField
      label={label}
      htmlFor={childId}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {children}
    </CanonicalFormField>
  );
}

interface FormActionsProps {
  onCancel?: () => void;
  onSubmit?: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}

export function FormActions({
  onCancel,
  onSubmit,
  cancelLabel = 'Cancel',
  submitLabel = 'Save',
  loading = false,
  disabled = false,
  danger = false,
  className,
}: FormActionsProps) {
  return (
    <div className={cn('flex items-center justify-end gap-3 pt-4 border-t border-surface-border', className)}>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-surface-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted transition-colors"
        >
          {cancelLabel}
        </button>
      )}
      <button
        type={onSubmit ? 'button' : 'submit'}
        onClick={onSubmit}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-all duration-200',
          danger ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-300' : 'bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300',
          (disabled || loading) && 'opacity-50 cursor-not-allowed',
        )}
      >
        {loading && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        )}
        {submitLabel}
      </button>
    </div>
  );
}

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export function FormInput({ error, className, ...props }: FormInputProps) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all duration-200',
        error
          ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
          : 'border-surface-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
    />
  );
}

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  options: { value: string; label: string }[];
}

export function FormSelect({ error, options, className, ...props }: FormSelectProps) {
  return (
    <select
      {...props}
      className={cn(
        'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-text-primary outline-none transition-all duration-200',
        error
          ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
          : 'border-surface-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

export function FormTextarea({ error, className, ...props }: FormTextareaProps) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all duration-200 resize-vertical min-h-[80px]',
        error
          ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
          : 'border-surface-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
    />
  );
}
