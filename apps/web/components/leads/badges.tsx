import { LEAD_STAGE_LABELS, type LeadStage, type ScoreBand } from '@selloeasy/shared';
import { Flame, Snowflake, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function ScoreBadge({ score, band, size = 'md' }: { score: number; band: ScoreBand; size?: 'sm' | 'md' }) {
  const Icon = band === 'HOT' ? Flame : band === 'WARM' ? Sun : Snowflake;
  const variant = band === 'HOT' ? 'hot' : band === 'WARM' ? 'warm' : 'cold';
  return (
    <Badge variant={variant} className={cn(size === 'md' && 'px-2.5 py-1 text-sm')}>
      <Icon className={size === 'md' ? 'size-3.5' : 'size-3'} />
      {score}
      <span className="font-normal opacity-80">{band.toLowerCase()}</span>
    </Badge>
  );
}

const STAGE_STYLE: Record<LeadStage, string> = {
  NEW: 'bg-secondary text-secondary-foreground',
  CONTACTED: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  ENGAGED: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  MEETING_SCHEDULED: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  QUALIFIED: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  PROPOSAL: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  WON: 'bg-success/15 text-success',
  LOST: 'bg-destructive/10 text-destructive',
};

export function StageBadge({ stage }: { stage: LeadStage }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', STAGE_STYLE[stage])}>{LEAD_STAGE_LABELS[stage]}</span>;
}

/** Compact BANT bars (0–10 each). */
export function BantBars({ bant }: { bant: { budget: number; authority: number; need: number; timeline: number } }) {
  const items: [string, number][] = [
    ['B', bant.budget],
    ['A', bant.authority],
    ['N', bant.need],
    ['T', bant.timeline],
  ];
  return (
    <div className="grid grid-cols-4 gap-2" aria-label="BANT scores">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-1" title={`${k}: ${v}/10`}>
          <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
            <span>{k}</span>
            <span>{v.toFixed(1)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, v * 10)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
