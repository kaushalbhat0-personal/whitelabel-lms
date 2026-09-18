'use client';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useEffect, useCallback, useRef, useId } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  footer?: React.ReactNode;
  className?: string;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw] max-h-[95vh]',
};

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  footer,
  className,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Keep latest onClose without changing handler identity — avoids
  // re-running focus effect when parent re-renders with inline onClose.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCloseRef.current();
  }, []);

  const handleTab = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusableElements(contentRef.current);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleTab);
    document.body.style.overflow = 'hidden';
    // Move focus into modal — first focusable or close button
    const timer = setTimeout(() => {
      const focusable = getFocusableElements(contentRef.current);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        contentRef.current?.focus();
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleTab);
      document.body.style.overflow = '';
      // Restore focus to opener
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function') {
        // Delay to ensure modal unmounted before focusing
        setTimeout(() => prev.focus(), 0);
      }
    };
  }, [isOpen, handleEscape, handleTab]);

  if (!isOpen) return null;

  const hasHeader = !!(title || description);
  const labelledBy = title ? titleId : undefined;
  const describedBy = description ? descId : undefined;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4 overflow-y-auto overscroll-contain"
      onClick={onClose}
      style={{ maxHeight: '100dvh' }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          'relative w-full bg-surface-card rounded-card-lg p-6 shadow-modal animate-scale-in outline-none',
          sizeClasses[size],
          'max-h-[calc(100dvh-2rem)] max-h-[calc(100svh-2rem)] overflow-y-auto overscroll-contain',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {hasHeader && (
          <div className="flex items-start justify-between mb-4">
            <div>
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-text-primary">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="text-sm text-text-muted mt-1">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="ml-4 rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {!hasHeader && (
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute top-4 right-4 rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <div className="overflow-y-auto overscroll-contain max-h-[calc(100dvh-200px)] max-h-[calc(100svh-200px)]">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-surface-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
