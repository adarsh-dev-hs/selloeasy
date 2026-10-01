'use client';
import { INDUSTRY_LABELS, type LeadVisibilityMode, type OrgDetail } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Eye, Lock, Send, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatList, parseList } from '@/components/intelligence/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, get, patch } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { cn } from '@/lib/utils';

const SIZE_BANDS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10000+'];
const isUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

function useTimezones(current?: string) {
  return useMemo(() => {
    let zones: string[] = [];
    try {
      zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      /* older browsers */
    }
    if (!zones.length) zones = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];
    if (current && !zones.includes(current)) zones = [current, ...zones];
    return zones;
  }, [current]);
}

function BasicsCard({ org }: { org: OrgDetail }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: org.name,
    websiteUrl: org.websiteUrl ?? '',
    hq: org.hq ?? '',
    regions: formatList(org.regions),
    companySize: org.companySize ?? '',
    description: org.description ?? '',
  });
  const [errors, setErrors] = useState<{ name?: string; websiteUrl?: string }>({});
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const sizes = org.companySize && !SIZE_BANDS.includes(org.companySize) ? [org.companySize, ...SIZE_BANDS] : SIZE_BANDS;

  const save = useMutation({
    mutationFn: () =>
      patch<OrgDetail>('/org', {
        name: f.name.trim(),
        websiteUrl: f.websiteUrl.trim(),
        hq: f.hq.trim(),
        regions: parseList(f.regions),
        companySize: f.companySize,
        description: f.description.trim(),
      }),
    onSuccess: (o) => {
      toast.success('Organization details saved');
      qc.setQueryData(['org'], o);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (f.name.trim().length < 2) errs.name = 'At least 2 characters';
    if (f.websiteUrl.trim() && !isUrl(f.websiteUrl.trim())) errs.websiteUrl = 'Enter a full URL, e.g. https://example.com';
    setErrors(errs);
    if (!Object.keys(errs).length) save.mutate();
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> Organization
          </CardTitle>
          <CardDescription>Basics used across your knowledge profile and AI-generated outreach.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name}>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Industry" hint="Set by the platform — determines your industry signal templates.">
            <Input value={INDUSTRY_LABELS[org.industry]} readOnly disabled />
          </Field>
          <Field label="Website" error={errors.websiteUrl}>
            <Input type="url" value={f.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Headquarters">
            <Input value={f.hq} onChange={(e) => set('hq', e.target.value)} placeholder="City, Country" maxLength={120} />
          </Field>
          <Field label="Regions served" hint="Comma-separated">
            <Input value={f.regions} onChange={(e) => set('regions', e.target.value)} placeholder="India, Middle East" />
          </Field>
          <Field label="Company size">
            <NativeSelect value={f.companySize} onChange={(e) => set('companySize', e.target.value)}>
              <option value="">Not set</option>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s} employees
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} placeholder="What you sell and to whom" />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" loading={save.isPending}>
            Save details
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function OutreachCard({ org, canToggleVisibility }: { org: OrgDetail; canToggleVisibility: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    calendlyUrl: org.settings.calendlyUrl ?? '',
    senderName: org.settings.senderName ?? '',
    timezone: org.settings.timezone ?? 'Asia/Kolkata',
    leadVisibility: (org.settings.leadVisibility ?? 'ALL') as LeadVisibilityMode,
  });
  const [error, setError] = useState<string>();
  const zones = useTimezones(f.timezone);

  const save = useMutation({
    mutationFn: () =>
      patch<OrgDetail>('/org', {
        settings: {
          calendlyUrl: f.calendlyUrl.trim(),
          senderName: f.senderName.trim(),
          timezone: f.timezone,
          ...(canToggleVisibility ? { leadVisibility: f.leadVisibility } : {}),
        },
      }),
    onSuccess: (o) => {
      toast.success('Outreach settings saved');
      qc.setQueryData(['org'], o);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (f.calendlyUrl.trim() && !isUrl(f.calendlyUrl.trim())) {
      setError('Enter a full URL, e.g. https://calendly.com/your-team/30min');
      return;
    }
    setError(undefined);
    save.mutate();
  };

  const options: { value: LeadVisibilityMode; title: string; body: string; icon: typeof Eye }[] = [
    { value: 'ALL', title: 'All org leads', body: 'SDRs can browse every lead and claim unassigned ones.', icon: Eye },
    { value: 'ASSIGNED_ONLY', title: 'Assigned only', body: 'SDRs only see leads assigned to them by a manager.', icon: Lock },
  ];

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-4 text-primary" /> Outreach & access
          </CardTitle>
          <CardDescription>Defaults for outreach drafts, plus who can see which leads.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Default Calendly link" error={error} hint="Used in meeting invites when a rep hasn’t set their own link.">
            <Input type="url" value={f.calendlyUrl} onChange={(e) => setF((p) => ({ ...p, calendlyUrl: e.target.value }))} placeholder="https://calendly.com/your-team/30min" />
          </Field>
          <Field label="Sender name" hint="Shown as the From name on outreach emails.">
            <Input value={f.senderName} onChange={(e) => setF((p) => ({ ...p, senderName: e.target.value }))} maxLength={120} placeholder={org.name} />
          </Field>
          <Field label="Timezone" hint="Used for task due dates and scheduled pipeline runs.">
            <NativeSelect value={f.timezone} onChange={(e) => setF((p) => ({ ...p, timezone: e.target.value }))}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
              Lead visibility for SDRs {!canToggleVisibility && <Badge variant="secondary">Read-only</Badge>}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((o) => {
                const checked = f.leadVisibility === o.value;
                return (
                  <label
                    key={o.value}
                    className={cn(
                      'flex gap-3 rounded-lg border p-3 text-sm transition-colors',
                      checked && 'border-primary/50 bg-primary/5',
                      canToggleVisibility ? 'cursor-pointer hover:bg-muted/40' : 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <input
                      type="radio"
                      name="leadVisibility"
                      className="mt-0.5 accent-primary"
                      value={o.value}
                      checked={checked}
                      disabled={!canToggleVisibility}
                      onChange={() => setF((p) => ({ ...p, leadVisibility: o.value }))}
                    />
                    <span>
                      <span className="flex items-center gap-1.5 font-medium">
                        <o.icon className="size-3.5" /> {o.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">{o.body}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {!canToggleVisibility && (
              <p className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                SDRs currently see all org leads; assigned-only mode can be enabled by the platform (FEATURE_LEAD_VISIBILITY_TOGGLE).
              </p>
            )}
          </fieldset>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" loading={save.isPending}>
            Save settings
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function OrganizationSettingsPage() {
  const me = useMe();
  const can = useCan();
  const allowed = can('org:profile:write');
  const org = useQuery({ queryKey: ['org'], queryFn: () => get<OrgDetail>('/org'), enabled: allowed });

  return (
    <>
      <PageHeader title="Organization settings" description="Company details, outreach defaults and access rules for your team." />
      {!allowed ? (
        <EmptyState icon={Lock} title="Org Admins only" description="Ask an Org Admin to change organization settings." />
      ) : org.error ? (
        <ErrorState error={org.error} retry={() => org.refetch()} />
      ) : !org.data ? (
        <div className="grid gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="grid gap-6">
          <BasicsCard key={`b-${org.data.id}`} org={org.data} />
          <OutreachCard key={`o-${org.data.id}`} org={org.data} canToggleVisibility={me.features.leadVisibilityToggle} />
        </div>
      )}
    </>
  );
}
