import { SelectHTMLAttributes } from 'react';

// UX-1A DEPRECATED: Stub primitive (no FormField wiring, no styling coherence).
// Zero direct consumers. New code MUST use FormField + FormSelect from AdminFormElements or canonical FormField pattern.
// Do NOT use <Select> — will be removed in UX-4 after migration audit.

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, options, ...props }: SelectProps) {
  return (
    <div className="select-group">
      {label && <label>{label}</label>}
      <select {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
