import { InputHTMLAttributes } from 'react';

// UX-1A DEPRECATED: This primitive is a stub (no input-field, no htmlFor, no a11y).
// Zero consumers per audit (only ui/index.ts re-export). New code MUST use FormField + input-field / FormInput from AdminFormElements.
// Do NOT use <Input> — will be removed in UX-4 after migration audit.

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, ...props }: InputProps) {
  return (
    <div className="input-group">
      {label && <label>{label}</label>}
      <input {...props} />
    </div>
  );
}
