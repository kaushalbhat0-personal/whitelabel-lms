import { type LucideIcon } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';

interface AdminStatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: LucideIcon;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  onClick?: () => void;
  className?: string;
}

export function AdminStatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  iconColor,
  trend,
  onClick,
  className,
}: AdminStatCardProps) {
  const iconNode = Icon ? <Icon className="h-5 w-5" /> : undefined;
  return (
    <StatCard
      label={label}
      value={value}
      sublabel={sublabel}
      icon={iconNode}
      iconColor={iconColor}
      trend={trend}
      onClick={onClick}
      className={className}
    />
  );
}
