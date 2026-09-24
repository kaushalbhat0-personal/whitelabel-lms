'use client';

import { useEffect, useState } from 'react';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardGreeting() {
  const { locale, timezone } = useBusinessConfig();
  const [greeting, setGreeting] = useState('');
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    setGreeting(getGreeting());
    setDateStr(
      new Date().toLocaleDateString(locale, { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'short' }),
    );
  }, [locale, timezone]);

  return (
    <div className="rounded-card bg-brand-navy p-5 text-white">
      <h2 className="text-lg font-bold">{greeting} 👋</h2>
      <p className="mt-1 text-sm text-white/70">{dateStr}</p>
    </div>
  );
}
