'use client';
import { INDUSTRY_LABELS, type PlatformDashboard } from '@selloeasy/shared';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, Building2, CircleDollarSign, Handshake, Percent, Send, Target, Users } from 'lucide-react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPct, formatUsd, OrgStatusBadge, PublicDataNote, RunStatusBadge } from '@/components/platform/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, Skeleton, Stat, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { get } from '@/lib/api';
import { formatNumber, timeAgo } from '@/lib/utils';

function formatDuration(sec: number | null) {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}

const SERIES = [
  { key: 'leads', label: 'Leads', color: 'var(--chart-1)' },
  { key: 'approached', label: 'Approached', color: 'var(--chart-2)' },
  { key: 'converted', label: 'Converted', color: 'var(--chart-3)' },
] as const;

function IndustryChart({ data }: { data: PlatformDashboard['byIndustry'] }) {
  const rows = data.map((d) => ({ ...d, name: INDUSTRY_LABELS[d.industry] }));
  return (
    <div className="h-72 w-full" role="img" aria-label="Grouped bar chart of leads, approached and converted by industry">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} interval={0} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)' }}
            labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PlatformOverviewPage() {
  const dash = useQuery({ queryKey: ['platform', 'dashboard'], queryFn: () => get<PlatformDashboard>('/platform/dashboard') });
  const d = dash.data;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Cross-organization health: adoption, pipeline outcomes and LLM usage."
        actions={
          <Button variant="outline" asChild>
            <Link href="/platform/orgs">
              <Building2 /> Manage organizations
            </Link>
          </Button>
        }
      />
      <PublicDataNote className="mb-5" />

      {dash.error ? (
        <ErrorState error={dash.error} retry={() => dash.refetch()} />
      ) : !d ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-80" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Organizations" value={formatNumber(d.totals.orgs)} hint={`${formatNumber(d.totals.activeOrgs)} active`} icon={Building2} />
            <Stat label="Users" value={formatNumber(d.totals.users)} hint="Across all organizations" icon={Users} />
            <Stat label="Leads" value={formatNumber(d.totals.leads)} hint="Total generated" icon={Target} />
            <Stat label="Approached" value={formatNumber(d.totals.approached)} hint="Leads contacted" icon={Send} tone="warning" />
            <Stat label="Converted" value={formatNumber(d.totals.converted)} hint="Closed won" icon={Handshake} tone="success" />
            <Stat label="Conversion rate" value={formatPct(d.totals.conversionRate)} hint="Converted ÷ approached" icon={Percent} tone="success" />
            <Stat
              label="LLM usage (30d)"
              value={formatUsd(d.totals.llmCost30dUsd)}
              hint={`${formatNumber(d.totals.llmCalls30d)} calls`}
              icon={CircleDollarSign}
              tone="hot"
            />
            <Stat
              label="LLM model"
              value={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-base font-semibold" title={d.model ?? undefined}>
                    {d.model ?? (d.llmMode === 'mock' ? 'Mock responses' : 'Not configured')}
                  </span>
                </span>
              }
              hint={
                d.llmMode === 'mock' ? (
                  <Badge variant="warning">Mock mode — no live LLM calls</Badge>
                ) : (
                  <Badge variant="success">Live via OpenRouter</Badge>
                )
              }
              icon={Bot}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Outcomes by industry</CardTitle>
                <CardDescription>Leads, approached and converted, summed across organizations in each industry.</CardDescription>
              </CardHeader>
              <CardContent>
                {d.byIndustry.every((r) => r.leads + r.approached + r.converted === 0) ? (
                  <EmptyState icon={Target} title="No leads yet" description="Once organizations run the pipeline, results appear here." />
                ) : (
                  <IndustryChart data={d.byIndustry} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-4 text-primary" aria-hidden /> Pipeline health
                </CardTitle>
                <CardDescription>Intelligence pipeline runs in the last 30 days.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-sm text-muted-foreground">Runs</dt>
                    <dd className="text-lg font-semibold">{formatNumber(d.pipelineHealth.runs30d)}</dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-sm text-muted-foreground">Failed</dt>
                    <dd className="flex items-center gap-2 text-lg font-semibold">
                      {formatNumber(d.pipelineHealth.failed30d)}
                      {d.pipelineHealth.runs30d > 0 && (
                        <Badge variant={d.pipelineHealth.failed30d > 0 ? 'destructive' : 'success'}>
                          {formatPct((d.pipelineHealth.failed30d / d.pipelineHealth.runs30d) * 100)}
                        </Badge>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-sm text-muted-foreground">Avg duration</dt>
                    <dd className="text-lg font-semibold">{formatDuration(d.pipelineHealth.avgDurationSec)}</dd>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <dt className="text-sm text-muted-foreground">Success rate</dt>
                    <dd className="text-lg font-semibold">
                      {d.pipelineHealth.runs30d ? formatPct(((d.pipelineHealth.runs30d - d.pipelineHealth.failed30d) / d.pipelineHealth.runs30d) * 100) : '—'}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          <section aria-labelledby="orgs-heading" className="space-y-3">
            <h2 id="orgs-heading" className="text-base font-semibold">
              Organizations
            </h2>
            {d.orgs.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No organizations yet"
                description="Create the first organization and invite its admin."
                action={
                  <Button asChild>
                    <Link href="/platform/orgs">Go to organizations</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <th>Organization</th>
                    <th>Industry</th>
                    <th>Status</th>
                    <th className="!text-right">Users</th>
                    <th className="!text-right">Leads</th>
                    <th className="!text-right">Approached</th>
                    <th className="!text-right">Converted</th>
                    <th className="!text-right">Conv. %</th>
                    <th>Last pipeline run</th>
                    <th className="!text-right">LLM cost 30d</th>
                  </tr>
                </THead>
                <TBody>
                  {d.orgs.map((o) => (
                    <TR key={o.id}>
                      <td>
                        <Link href={`/platform/orgs/${o.id}`} className="font-medium hover:text-primary">
                          {o.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">{INDUSTRY_LABELS[o.industry]}</td>
                      <td>
                        <OrgStatusBadge status={o.status} />
                      </td>
                      <td className="text-right tabular-nums">{formatNumber(o.userCount)}</td>
                      <td className="text-right tabular-nums">{formatNumber(o.leads)}</td>
                      <td className="text-right tabular-nums">{formatNumber(o.approached)}</td>
                      <td className="text-right tabular-nums">{formatNumber(o.converted)}</td>
                      <td className="text-right tabular-nums">{formatPct(o.conversionRate)}</td>
                      <td className="whitespace-nowrap">
                        {o.lastPipelineRun ? (
                          <span className="flex items-center gap-2">
                            {o.lastPipelineRun.error ? (
                              <Tip content={o.lastPipelineRun.error}>
                                <span>
                                  <RunStatusBadge status={o.lastPipelineRun.status} />
                                </span>
                              </Tip>
                            ) : (
                              <RunStatusBadge status={o.lastPipelineRun.status} />
                            )}
                            <span className="text-xs text-muted-foreground">{timeAgo(o.lastPipelineRun.finishedAt)}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Never run</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatUsd(o.llmCost30dUsd)}
                        <p className="text-xs text-muted-foreground">{formatNumber(o.llmCalls30d)} calls</p>
                      </td>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </>
  );
}
