'use client';
import { Lock } from 'lucide-react';
import { AuditLog } from '@/components/audit/audit-log';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { Can } from '@/lib/auth';

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change in your organization — who did what, when, from where. Click a row to see the field-level diff."
      />
      <Can permission="audit:org:read" fallback={<EmptyState icon={Lock} title="Org Admins only" description="The audit log is visible to Org Admins." />}>
        <AuditLog endpoint="/audit" />
      </Can>
    </>
  );
}
