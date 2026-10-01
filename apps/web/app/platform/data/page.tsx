'use client';
import { Suspense } from 'react';
import { DataSourcePage } from '@/components/platform/data/data-source';
import { Skeleton } from '@/components/ui/misc';

export default function PlatformDataPage() {
  // useSearchParams (URL-synced tabs/filters) needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <DataSourcePage />
    </Suspense>
  );
}
