'use client';
import { LEAD_STAGE_LABELS, ROLE_LABELS, type OrgDashboard } from '@selloeasy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarCheck2, Clock, Handshake, IndianRupee, Percent, Send, Target, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton, Stat, Table, TBody, THead, TR } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatMoney, formatNumber, titleCase } from '@/lib/utils';

const RANGES: { value: string; label: string; days: number | null }[] = [
  { value: 'all', label: 'All time', days: null },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '180', label: 'Last 6 months', days: 180 },
];

const tooltipStyle = {
  contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--popover-foreground)' },
  labelStyle: { color: 'var(--muted-foreground)' },
  cursor: { fill: 'var(--muted)', opacity: 0.5 },
};

export default function DashboardPage() {
  const me = useMe();
  const [range, setRange] = useState('all');
  const days = RANGES.find((r) => r.value === range)?.days;
  const from = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : undefined;
  const q = useQuery({
    queryKey: ['dashboard', from],
    queryFn: () => get<OrgDashboard & { scope: 'org' | 'me' }>('/dashboard', { from }),
    placeholderData: keepPreviousData,
  });

  const d = q.data;
  const funnel = d
    ? d.funnel
        .filter((f) => f.stage !== 'LOST')
        .map((f, i, arr) => ({
          stage: LEAD_STAGE_LABELS[f.stage],
          // Cumulative "reached at least this stage" funnel; LOST leads count as having been contacted.
          reached: arr.slice(i).reduce((a, x) => a + x.count, 0) + (i <= 1 ? (d.funnel.find((x) => x.stage === 'LOST')?.count ?? 0) : 0),
        }))
    : [];

  return (
    <>
      <PageHeader
        title={d?.scope === 'me' ? 'My stats' : 'Dashboard'}
        description={
          d?.scope === 'me'
            ? `Your pipeline at ${me.org?.name} — leads you own and touches you made.`
            : `How ${me.org?.name ?? 'your team'} is turning signals into revenue.`
        }
        actions={
          <NativeSelect className="w-40" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </NativeSelect>
        }
      />

      {q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : d.summary.leads === 0 ? (
        <EmptyState
          icon={Target}
          title="No leads captured yet"
          description={me.org?.status === 'ACTIVE' ? 'Run the pipeline to scan market events against your signals.' : 'Finish onboarding to start capturing leads.'}
          action={
            <Link className="text-sm font-medium text-primary hover:underline" href={me.org?.status === 'ACTIVE' ? '/app/pipeline' : '/app/onboarding'}>
              {me.org?.status === 'ACTIVE' ? 'Open pipeline →' : 'Continue onboarding →'}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Leads captured" value={formatNumber(d.summary.leads)} icon={Target} hint={`${d.summary.hot} hot · ${d.summary.warm} warm · ${d.summary.cold} cold`} />
            <Stat label="Approached" value={formatNumber(d.summary.approached)} icon={Send} hint={`${Math.round((d.summary.approached / Math.max(1, d.summary.leads)) * 100)}% of leads contacted`} />
            <Stat label="Meetings" value={formatNumber(d.summary.meetings)} icon={CalendarCheck2} hint={`${d.summary.engaged} engaged`} tone="warning" />
            <Stat label="Converted (won)" value={formatNumber(d.summary.converted)} icon={Trophy} hint={`${d.summary.lost} lost`} tone="success" />
            <Stat label="Conversion rate" value={`${d.summary.conversionRate}%`} icon={Percent} hint="Won ÷ approached" tone="success" />
            <Stat label="Avg. time to first touch" value={d.summary.avgHoursToFirstTouch === null ? '—' : d.summary.avgHoursToFirstTouch < 48 ? `${d.summary.avgHoursToFirstTouch}h` : `${Math.round(d.summary.avgHoursToFirstTouch / 24)}d`} icon={Clock} hint="From first signal to first outreach" />
            <Stat label="Won pipeline value" value={formatMoney(d.summary.pipelineValueWon)} icon={IndianRupee} tone="success" />
            <Stat label="Hot leads open" value={formatNumber(d.summary.hot)} icon={Handshake} hint="Score ≥ 75" tone="hot" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Funnel</CardTitle>
                <CardDescription>Leads that reached each stage</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnel} layout="vertical" margin={{ left: 24, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke="var(--border)" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                    <YAxis type="category" dataKey="stage" width={120} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="reached" name="Leads" fill="var(--chart-1)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Leads over time</CardTitle>
                <CardDescription>New leads per week by score band (first signal date)</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.timeseries.map((p) => ({ ...p, week: p.week.slice(5) }))}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="HOT" stackId="a" fill="var(--hot)" name="Hot" />
                    <Bar dataKey="WARM" stackId="a" fill="var(--warm)" name="Warm" />
                    <Bar dataKey="COLD" stackId="a" fill="var(--cold)" name="Cold" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Leads by signal</CardTitle>
                <CardDescription>Which buying signals produce leads — and which convert</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <tr>
                      <th>Signal</th>
                      <th className="text-right">Leads</th>
                      <th className="text-right">Approached</th>
                      <th className="text-right">Won</th>
                    </tr>
                  </THead>
                  <TBody>
                    {d.bySignal.map((s) => (
                      <TR key={s.signalId}>
                        <td>
                          <Link href={`/app/leads?signalId=${s.signalId}`} className="hover:text-primary">{s.signalName}</Link>
                          <div className="mt-1 h-1.5 max-w-64 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${(s.leads / Math.max(...d.bySignal.map((x) => x.leads), 1)) * 100}%` }} />
                          </div>
                        </td>
                        <td className="text-right tabular-nums">{s.leads}</td>
                        <td className="text-right tabular-nums">{s.approached}</td>
                        <td className="text-right tabular-nums">{s.converted}</td>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Channel effectiveness</CardTitle>
                <CardDescription>Touches and how many led to engagement</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                {d.channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No outreach logged yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.channels.map((c) => ({ ...c, channel: titleCase(c.channel) }))}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="channel" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                      <Tooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="leadsTouched" name="Leads touched" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="engagedAfter" name="Engaged after" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {d.team.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{d.scope === 'me' ? 'My activity' : 'Team leaderboard'}</CardTitle>
                <CardDescription>Owned leads, outbound touches, meetings booked and wins</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <tr>
                      <th>Member</th>
                      <th className="text-right">Owned</th>
                      <th className="text-right">Touches</th>
                      <th className="text-right">Meetings</th>
                      <th className="text-right">Won</th>
                    </tr>
                  </THead>
                  <TBody>
                    {d.team.map((m) => (
                      <TR key={m.userId}>
                        <td>
                          <span className="flex items-center gap-2">
                            <Avatar name={m.name} className="size-7 text-[10px]" />
                            <span>
                              {m.name}
                              <span className="block text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
                            </span>
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{m.owned}</td>
                        <td className="text-right tabular-nums">{m.touches}</td>
                        <td className="text-right tabular-nums">{m.meetings}</td>
                        <td className="text-right font-medium tabular-nums">{m.won}</td>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
