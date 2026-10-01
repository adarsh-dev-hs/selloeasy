'use client';
import { Building2, FileCode2, FileUp, Gauge, Newspaper, Plug, UserRound } from 'lucide-react';
import { PublicDataNote } from '@/components/platform/shared';
import { PageHeader } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectorsTab } from './connectors';
import { CompaniesTab, ContactsTab } from './directory';
import { EventsTab } from './events';
import { ImportsTab } from './imports';
import { OverviewTab } from './overview';
import { type DataTab, useDataParams } from './shared';
import { TemplateTab } from './template';

const TAB_META: { key: DataTab; label: string; icon: typeof Gauge }[] = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'events', label: 'Events', icon: Newspaper },
  { key: 'companies', label: 'Companies', icon: Building2 },
  { key: 'contacts', label: 'Contacts', icon: UserRound },
  { key: 'imports', label: 'Imports', icon: FileUp },
  { key: 'connectors', label: 'Connectors', icon: Plug },
  { key: 'template', label: 'Template', icon: FileCode2 },
];

/** Super Admin "Data source" explorer (plan2 §8). Tabs and filters are URL-synced for deep links. */
export function DataSourcePage() {
  const { tab, setTab } = useDataParams();
  return (
    <>
      <PageHeader
        title="Data source"
        description="The platform-wide market events, company directory and contacts that org pipelines match against — with imports, connectors and the record template."
      />
      <PublicDataNote className="mb-5">
        Platform-owned data only. The distribution views show which organizations matched an event (names and
        counts) — never their leads, contacts or scores.
      </PublicDataNote>
      <Tabs value={tab} onValueChange={(v) => setTab(v as DataTab)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            {TAB_META.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                <t.icon className="size-4" aria-hidden /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">{tab === 'overview' && <OverviewTab />}</TabsContent>
        <TabsContent value="events">{tab === 'events' && <EventsTab />}</TabsContent>
        <TabsContent value="companies">{tab === 'companies' && <CompaniesTab />}</TabsContent>
        <TabsContent value="contacts">{tab === 'contacts' && <ContactsTab />}</TabsContent>
        <TabsContent value="imports">{tab === 'imports' && <ImportsTab />}</TabsContent>
        <TabsContent value="connectors">{tab === 'connectors' && <ConnectorsTab />}</TabsContent>
        <TabsContent value="template">{tab === 'template' && <TemplateTab />}</TabsContent>
      </Tabs>
    </>
  );
}
