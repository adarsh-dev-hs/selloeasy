'use client';
import type { OrgDetail, OrgSource, Plan, Policy, Product } from '@selloeasy/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Eye,
  FileText,
  Globe,
  Layers,
  Package,
  ScrollText,
  Sparkles,
  StickyNote,
  UploadCloud,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PlansManager, PoliciesManager, ProductsManager } from '@/components/knowledge/catalog';
import { ProfilePanel } from '@/components/knowledge/profile';
import { Callout, KQ, VisibilityNote } from '@/components/knowledge/shared';
import {
  DocumentUploader,
  SourcesTable,
  TextSourceDialog,
  WebsiteSourceDialog,
  useSources,
} from '@/components/knowledge/sources';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader, Stat } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { get } from '@/lib/api';
import { useCan } from '@/lib/auth';

const TABS = ['profile', 'sources', 'products', 'plans', 'policies'] as const;
type Tab = (typeof TABS)[number];

function useTab(): [Tab, (t: Tab) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = sp.get('tab');
  const tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'profile';
  return [tab, (t) => router.replace(t === 'profile' ? pathname : `${pathname}?tab=${t}`, { scroll: false })];
}

function Count({ n }: { n: number | undefined }) {
  return n === undefined ? null : (
    <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px]">
      {n}
    </Badge>
  );
}

function SourcesTab({ canWrite, websiteUrl }: { canWrite: boolean; websiteUrl?: string | null }) {
  const sources = useSources();
  const [dialog, setDialog] = useState<'website' | 'text' | 'upload' | null>(null);
  const data = sources.data ?? [];
  const ready = data.filter((s) => s.status === 'READY');
  const chunks = ready.reduce((n, s) => n + s.chunkCount, 0);
  const processing = data.filter((s) => s.status === 'PENDING' || s.status === 'PROCESSING').length;
  const failed = data.filter((s) => s.status === 'FAILED').length;
  const pub = data.filter((s: OrgSource) => s.visibility === 'PUBLIC').length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sources" value={data.length} hint={`${ready.length} ready`} icon={FileText} />
        <Stat label="Indexed chunks" value={chunks} hint="Searchable passages" icon={Layers} tone="success" />
        <Stat
          label="Processing"
          value={processing}
          hint={failed ? `${failed} failed` : 'All caught up'}
          icon={Sparkles}
          tone={failed ? 'hot' : 'warning'}
        />
        <Stat label="Public" value={pub} hint={`${data.length - pub} internal`} icon={Globe} />
      </div>
      <VisibilityNote />
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog('upload')}>
            <UploadCloud /> Upload documents
          </Button>
          <Button variant="outline" onClick={() => setDialog('website')}>
            <Globe /> Add website
          </Button>
          <Button variant="outline" onClick={() => setDialog('text')}>
            <StickyNote /> Paste text
          </Button>
        </div>
      )}
      <SourcesTable
        canWrite={canWrite}
        emptyAction={
          canWrite && (
            <Button size="sm" onClick={() => setDialog('upload')}>
              <UploadCloud /> Upload documents
            </Button>
          )
        }
      />
      <WebsiteSourceDialog
        open={dialog === 'website'}
        onOpenChange={(o) => setDialog(o ? 'website' : null)}
        defaultUrl={websiteUrl}
      />
      <TextSourceDialog open={dialog === 'text'} onOpenChange={(o) => setDialog(o ? 'text' : null)} />
      <Dialog open={dialog === 'upload'} onOpenChange={(o) => setDialog(o ? 'upload' : null)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>Upload documents</DialogTitle>
            <DialogDescription>
              Files upload directly to secure storage, then get parsed and indexed. You can close this dialog
              — progress continues in the table.
            </DialogDescription>
          </DialogHeader>
          <DocumentUploader />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KnowledgePage() {
  const can = useCan();
  const canWrite = can('org:profile:write');
  const [tab, setTab] = useTab();
  const org = useQuery({ queryKey: KQ.org, queryFn: () => get<OrgDetail>('/org') });
  const sources = useSources();
  const products = useQuery({ queryKey: KQ.products, queryFn: () => get<Product[]>('/org/products') });
  const plans = useQuery({ queryKey: KQ.plans, queryFn: () => get<Plan[]>('/org/plans') });
  const policies = useQuery({ queryKey: KQ.policies, queryFn: () => get<Policy[]>('/org/policies') });
  const readySources = sources.data?.filter((s) => s.status === 'READY').length;

  return (
    <>
      <PageHeader
        title="Knowledge profile"
        description="Everything SelloEasy knows about your company — the grounding for signal matching, lead scoring and outreach."
      />
      {!canWrite && (
        <Callout icon={Eye} className="mb-5">
          <p>You have read-only access. Ask an Org Admin to add sources or edit the profile.</p>
        </Callout>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            <TabsTrigger value="profile">
              <Sparkles className="size-3.5" /> Profile
            </TabsTrigger>
            <TabsTrigger value="sources">
              <FileText className="size-3.5" /> Sources <Count n={sources.data?.length} />
            </TabsTrigger>
            <TabsTrigger value="products">
              <Package className="size-3.5" /> Products <Count n={products.data?.length} />
            </TabsTrigger>
            <TabsTrigger value="plans">
              <Layers className="size-3.5" /> Plans <Count n={plans.data?.length} />
            </TabsTrigger>
            <TabsTrigger value="policies">
              <ScrollText className="size-3.5" /> Policies <Count n={policies.data?.length} />
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="profile">
          <ProfilePanel canWrite={canWrite} readySources={readySources} />
        </TabsContent>
        <TabsContent value="sources">
          <SourcesTab canWrite={canWrite} websiteUrl={org.data?.websiteUrl} />
        </TabsContent>
        <TabsContent value="products" className="space-y-4">
          <VisibilityNote compact />
          <ProductsManager canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="plans" className="space-y-4">
          <VisibilityNote compact />
          <PlansManager canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="policies" className="space-y-4">
          <VisibilityNote compact />
          <PoliciesManager canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <KnowledgePage />
    </Suspense>
  );
}
