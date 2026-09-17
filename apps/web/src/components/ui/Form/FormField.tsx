'use client';
import { cn } from '@/lib/utils';
import { useId, cloneElement, isValidElement } from 'react';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, hint, error, required, children, className }: FormFieldProps) {
  const hintId = useId();
  const errorId = useId();
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const enhancedChild = (() => {
    if (!isValidElement(children)) return children;
    const extra: Record<string, any> = {};
    if (describedBy) extra['aria-describedby'] = describedBy;
    if (error) extra['aria-invalid'] = true;
    if (!(children.props as any).id) extra.id = htmlFor;
    return cloneElement(children as React.ReactElement<any>, extra);
  })();

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text-secondary">
        {label} {required && <span className="text-status-error" aria-hidden="true">*</span>}
      </label>
      {enhancedChild}
      {hint && !error && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}
