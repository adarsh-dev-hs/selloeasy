---
name: frontend-feature
description: Builds UI in apps/web (Next.js 16 App Router) using TanStack Query with the @/lib/api client, the components/ui kit, <Can> permission gating and complete loading/empty/error states. Use when asked to "add a page", "build the UI for", "add a dialog/table/form", or change anything under apps/web.
---

# frontend-feature

## Step 0 — Next.js 16 first

Read `apps/web/AGENTS.md`: this Next.js version has breaking changes. Before using any routing/data/config API,
check the guide in `apps/web/node_modules/next/dist/docs/` and heed deprecations (e.g. middleware is
`apps/web/proxy.ts`). Do not rely on memory of Next 13–15.

## Layout of apps/web

- `app/(auth)/*` — login, accept-invite, forgot/reset password
- `app/app/*` — org area (`/app/...`), shell in `app/app/layout.tsx`
- `app/platform/*` — super-admin area (public data only, ADR-0010)
- `app/docs/[[...slug]]` — Fumadocs, content from root `docs/`
- `app/api/[...path]/route.ts` — same-origin proxy to the Fastify API
- `components/ui/*` — kit: `button`, `input` (`Input`, `NativeSelect`), `card`, `dialog`, `dropdown`, `tabs`,
  `badge`, `tooltip` (`Tip`), `pagination`, `misc` (`PageHeader`, `EmptyState`, `ErrorState`, `Skeleton`, `Table`, `THead`, `TBody`, `TR`, `Avatar`, `Stat`)
- `components/<feature>/*` — feature components (`leads/`, `intelligence/`, `platform/`, `audit/`)
- `lib/api.ts` — `get/post/patch/del`, `api()`, `qs()`, `ApiError`, `errorMessage()`
- `lib/auth.tsx` — `useMe()`, `useCan()`, `<Can permission>`; `lib/utils.ts` — `cn`, `formatDate`, `timeAgo`…

## Steps

1. Types come from `@selloeasy/shared` (DTOs, enums, labels like `LEAD_STAGE_LABELS`). Never redefine API shapes.
2. Client pages start with `'use client'`; wrap `useSearchParams` users in `<Suspense>` (see `app/app/leads/page.tsx`).
3. Data: `useQuery({ queryKey: ['widgets', filters], queryFn: () => get<Page<Widget>>('/widgets', filters), placeholderData: keepPreviousData })`.
   Mutations: `useMutation` → `toast.success(...)` / `toast.error(errorMessage(e))` (sonner) → `qc.invalidateQueries({ queryKey: ['widgets'] })`.
4. Filters and pagination live in the URL (`router.replace(..., { scroll: false })`), page size 6 for leads.
5. Gate controls with `<Can permission="widgets:write">` / `useCan()`. This only hides UI; the API enforces.
6. Every data view renders: `Skeleton` while loading, `ErrorState error={q.error} retry={q.refetch}`, `EmptyState` when empty.
7. Forms: show field errors from `ApiError.fieldErrors`; disable submit while pending.
8. Platform pages show only public/aggregate data (`PublicDataNote` in `components/platform/shared.tsx`).
9. Accessibility: labelled inputs, buttons with text or `aria-label`, focus-trapped dialogs (use `components/ui/dialog`),
   keyboard reachable actions. Responsive: check ~400px width (stack/wrap, tables in `overflow-x-auto`).

## Skeleton

```tsx
'use client';
import type { Page, Widget } from '@selloeasy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, get, post } from '@/lib/api';
import { Can } from '@/lib/auth';

export default function WidgetsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['widgets'],
    queryFn: () => get<Page<Widget>>('/widgets'),
    placeholderData: keepPreviousData,
  });
  const create = useMutation({
    mutationFn: () => post<Widget>('/widgets', { name: 'New widget' }),
    onSuccess: () => {
      toast.success('Widget created');
      qc.invalidateQueries({ queryKey: ['widgets'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Widgets"
        actions={
          <Can permission="widgets:write">
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              New
            </Button>
          </Can>
        }
      />
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="No widgets yet" />
      ) : /* list */ null}
    </>
  );
}
```

## Verify

```bash
pnpm --filter @selloeasy/web typecheck
pnpm dev     # then exercise the page as ORG_ADMIN and as VIEWER (controls hidden), and as super admin (no tenant data)
```

## Checklist

- [ ] Next 16 docs consulted for any framework API used
- [ ] Types from `@selloeasy/shared`; calls via `@/lib/api`
- [ ] Loading / empty / error states; toasts on mutations; cache invalidated
- [ ] `<Can>` gating matches server permission
- [ ] Accessible + responsive at ~400px
- [ ] User-visible feature documented (doc-keeper)
