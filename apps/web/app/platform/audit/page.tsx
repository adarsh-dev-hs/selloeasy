'use client';
import { AuditLog } from '@/components/audit/audit-log';
import { PublicDataNote } from '@/components/platform/shared';
import { PageHeader } from '@/components/ui/misc';

export default function PlatformAuditPage() {
  return (
    <>
      <PageHeader title="Audit log" description="Every platform-level action: org lifecycle changes, invitations, template edits and org views." />
      <PublicDataNote className="mb-5">
        Only platform-scope events appear here. Activity inside an organization (leads, outreach, settings) is recorded in that organization&apos;s own audit log.
      </PublicDataNote>
      <AuditLog endpoint="/platform/audit" showOrg />
    </>
  );
}
