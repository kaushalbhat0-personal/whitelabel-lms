'use client';

import Link, { type LinkProps } from 'next/link';
import { useCallback } from 'react';
import { useNavigation } from '@/components/providers/NavigationProvider';

type NavigationLinkProps = LinkProps & {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
  target?: string;
  download?: boolean | string;
  style?: React.CSSProperties;
};

/**
 * Smallest shared wrapper for authenticated navigation that participates in
 * NavigationProvider pending state. Use instead of next/link for shell nav
 * when you want the top progress indicator to appear for slow transitions.
 * Existing <Link> usages remain valid — migrate incrementally.
 */
export function NavigationLink({ href, children, onClick, target, download, ...props }: NavigationLinkProps) {
  const { push, replace } = useNavigation();
  // Extract replace/scroll from props if provided via LinkProps
  const replaceProp = (props as { replace?: boolean }).replace;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Let modifier keys / new-tab still work natively
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      // Preserve native behavior for blank target and downloads
      if (target && target !== '_self') return;
      if (download) return;
      // External hrefs or non-string hrefs fall through to native Link
      if (typeof href !== 'string') return;
      if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
      e.preventDefault();
      onClick?.();
      if (replaceProp) {
        replace(href);
      } else {
        push(href);
      }
    },
    [href, onClick, push, replace, target, download, replaceProp],
  );

  return (
    <Link href={href} target={target} download={download} onClick={handleClick} {...props}>
      {children}
    </Link>
  );
}
