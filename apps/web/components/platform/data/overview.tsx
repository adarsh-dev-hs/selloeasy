'use client';
import { DATA_SOURCE_TYPES, type DataOverview } from '@selloeasy/shared';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarClock, Database, Newspaper, Plug, Rss, Undo2, UserRound } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton, Stat } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { formatDate, formatNumber, timeAgo } from '@/lib/utils';
import { SOURCE_TYPE_COLORS, SOURCE_TYPE_LABELS } from './shared';

const tooltipStyle = {
  contentStyle: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--foreground)',
  },
  labelStyle: { color: 'var(--foreground)', fontWeight: 600 },
  cursor: { fill: 'var(--muted)', opacity: 0.5 },
};
const tick = { fontSize: 12, fill: 'var(--muted-foreground)' };

export function useDataOverview() {
  return useQuery({
    queryKey: ['platform', 'data', 'overview'],
    queryFn: () => get<DataOverview>('/platform/data/overview'),
  });
}

function WeeklyChart({ data }: { data: DataOverview['weekly'] }) {
  const rows = data.map((w) => ({ ...w, label: formatDate(w.week, { day: 'numeric', month: 'short' }) }));
  const present = DATA_SOURCE_TYPES.filter((t) => data.some((w) => w[t] > 0));
  return (
    <div
      className="h-72 w-full"
      role="img"
      aria-label="Stacked bar chart of events added per week, by source type"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} minTickGap={12} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={tick} />
          <Tooltip {...tooltipStyle} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {present.map((t, i) => (
            <Bar
              key={t}
              dataKey={t}
              name={SOURCE_TYPE_LABELS[t]}
              stackId="w"
              fill={SOURCE_TYPE_COLORS[t]}
              maxBarSize={36}
              radius={i === present.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TagChart({ data }: { data: DataOverview['byTag'] }) {
  const rows = [...data].sort((a, b) => b.count - a.count).slice(0, 12);
  return (
    <div
      className="w-full"
      style={{ height: Math.max(160, rows.length * 28 + 24) }}
      role="img"
      aria-label="Bar chart of events per industry tag"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={tick} />
          <YAxis type="category" dataKey="tag" width={130} tickLine={false} axisLine={false} tick={tick} />
          <Tooltip {...tooltipStyle} />
          <Bar dataKey="count" name="Events" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OverviewTab() {
  const q = useDataOverview();
  if (q.error) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  if (!d)
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Events" value={formatNumber(d.events)} hint="Live (not retracted)" icon={Newspaper} />
        <Stat
          label="Added last 7 days"
          value={formatNumber(d.eventsLast7d)}
          hint={`${formatNumber(d.eventsLast30d)} in the last 30 days`}
          icon={CalendarClock}
          tone="success"
        />
        <Stat label="Companies" value={formatNumber(d.companies)} hint="Directory entries" icon={Building2} />
        <Stat label="Contacts" value={formatNumber(d.contacts)} hint="Directory contacts" icon={UserRound} />
        <Stat label="Sources" value={formatNumber(d.sources)} hint="Distinct publishers / feeds" icon={Rss} />
        <Stat
          label="Newest event"
          value={<span className="text-xl">{formatDate(d.newestPublishedAt)}</span>}
          hint={d.newestPublishedAt ? `Published ${timeAgo(d.newestPublishedAt)}` : 'No events yet'}
          icon={Database}
        />
        <Stat
          label="Connectors"
          value={formatNumber(d.connectors)}
          hint={d.lastIngestionAt ? `Last ingestion ${timeAgo(d.lastIngestionAt)}` : 'Never run'}
          icon={Plug}
          tone="warning"
        />
        <Stat
          label="Retracted events"
          value={formatNumber(d.retractedEvents)}
          hint="Rolled back — skipped by org pipelines"
          icon={Undo2}
          tone="hot"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Events per week by source</CardTitle>
            <CardDescription>
              Live events by publication week (last 26 weeks), split by how they entered: seed, file import or connector.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.weekly.length === 0 ? (
              <EmptyState icon={Newspaper} title="No events yet" />
            ) : (
              <WeeklyChart data={d.weekly} />
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Events by industry tag</CardTitle>
            <CardDescription>Top tags across live events (an event can carry up to 4 tags).</CardDescription>
          </CardHeader>
          <CardContent>
            {d.byTag.length === 0 ? <EmptyState title="No tagged events" /> : <TagChart data={d.byTag} />}
          </CardContent>
        </Card>
      </div>

      {d.bySourceType.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {d.bySourceType.map((s) => (
            <span
              key={s.sourceType}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5"
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: SOURCE_TYPE_COLORS[s.sourceType] }}
                aria-hidden
              />
              {SOURCE_TYPE_LABELS[s.sourceType]}
              <span className="font-semibold tabular-nums">{formatNumber(s.count)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
