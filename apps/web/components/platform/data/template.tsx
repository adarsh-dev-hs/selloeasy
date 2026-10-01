'use client';
import {
  TEMPLATE_V1_FIELDS,
  TEMPLATE_VERSION,
  type FieldRequirement,
  type TemplateField,
} from '@selloeasy/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, THead, TR } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import { TemplateDownloads } from './imports';

type TemplateInfo = {
  version: number;
  fields: TemplateField[];
  limits: { maxMb: number; maxRows: number; maxInvalidRatio: number; maxAgeDays: number };
};

const REQ_VARIANT: Record<FieldRequirement, 'destructive' | 'default' | 'secondary' | 'warning'> = {
  required: 'destructive',
  recommended: 'default',
  conditional: 'warning',
  optional: 'secondary',
};
const GROUPS: { key: TemplateField['group']; title: string; description: string }[] = [
  { key: 'event', title: 'Event', description: 'The business-news event itself.' },
  {
    key: 'company',
    title: 'Subject company',
    description: 'The company that would buy — upserted into the directory by domain.',
  },
  {
    key: 'contact',
    title: 'Contact (optional)',
    description: 'One contact at the subject company. Needs a name plus an email or phone.',
  },
];

export function TemplateTab() {
  // Limits come from the server config; the field list is the shared source of truth.
  const q = useQuery({
    queryKey: ['platform', 'data', 'template'],
    queryFn: () => get<TemplateInfo>('/platform/data/template'),
  });
  const l = q.data?.limits;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Market Event Record — template v{q.data?.version ?? TEMPLATE_VERSION}</CardTitle>
          <CardDescription>
            One row = one event + its subject company + optionally one contact. CSV lists use <code>|</code>{' '}
            as a separator; JSON / JSONL use arrays.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <TemplateDownloads />
          {l && (
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <li>
                Max file size <strong className="text-foreground">{l.maxMb} MB</strong>
              </li>
              <li>
                Max rows <strong className="text-foreground">{formatNumber(l.maxRows)}</strong>
              </li>
              <li>
                Commit refused above{' '}
                <strong className="text-foreground">{Math.round(l.maxInvalidRatio * 100)}%</strong> invalid
                rows
              </li>
              <li>
                Events older than{' '}
                <strong className="text-foreground">{formatNumber(l.maxAgeDays)} days</strong> are rejected
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      {GROUPS.map((g) => (
        <section key={g.key} className="space-y-2" aria-labelledby={`tpl-${g.key}`}>
          <div>
            <h2 id={`tpl-${g.key}`} className="text-base font-semibold">
              {g.title}
            </h2>
            <p className="text-sm text-muted-foreground">{g.description}</p>
          </div>
          <Table>
            <THead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Required</th>
                <th className="min-w-64">Rules</th>
                <th>Example</th>
              </tr>
            </THead>
            <TBody>
              {TEMPLATE_V1_FIELDS.filter((f) => f.group === g.key).map((f) => (
                <TR key={f.name} className="align-top">
                  <td className="whitespace-nowrap font-mono text-xs font-medium">{f.name}</td>
                  <td className="text-xs text-muted-foreground">{f.type}</td>
                  <td>
                    <Badge variant={REQ_VARIANT[f.requirement]}>{f.requirement}</Badge>
                  </td>
                  <td className="text-sm">{f.rules}</td>
                  <td className="max-w-64 break-all font-mono text-xs text-muted-foreground">{f.example}</td>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
