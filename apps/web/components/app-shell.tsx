'use client';
import type { MeResponse, Permission } from '@selloeasy/shared';
import { INDUSTRY_LABELS, ROLE_LABELS } from '@selloeasy/shared';
import {
  Activity,
  BookOpenText,
  Building2,
  ClipboardList,
  Database,
  FileSearch,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  Radar,
  Rocket,
  ScrollText,
  Settings,
  Sparkles,
  Sun,
  Target,
  User,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MeProvider, useLogout, useMeQuery } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown';
import { Avatar, Skeleton } from './ui/misc';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  when?: (me: MeResponse) => boolean;
}

const ORG_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Sell',
    items: [
      { href: '/app/onboarding', label: 'Onboarding', icon: Rocket, permission: 'org:profile:write', when: (me) => me.org?.status !== 'ACTIVE' },
      { href: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/app/leads', label: 'Leads', icon: Target, permission: 'leads:read' },
      { href: '/app/tasks', label: 'My tasks', icon: ListChecks, permission: 'tasks:write' },
    ],
  },
  {
    section: 'Intelligence',
    items: [
      { href: '/app/pipeline', label: 'Pipeline runs', icon: Workflow, permission: 'pipeline:read' },
      { href: '/app/signals', label: 'Signals', icon: Radar, permission: 'signals:read' },
      { href: '/app/icps', label: 'ICPs', icon: Sparkles, permission: 'icps:read' },
      { href: '/app/knowledge', label: 'Knowledge profile', icon: FileSearch, permission: 'org:profile:read' },
    ],
  },
  {
    section: 'Organization',
    items: [
      { href: '/app/settings/team', label: 'Team', icon: Users, permission: 'org:profile:read' },
      { href: '/app/settings/organization', label: 'Settings', icon: Settings, permission: 'org:profile:write' },
      { href: '/app/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:org:read' },
    ],
  },
];

const PLATFORM_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Platform',
    items: [
      { href: '/platform', label: 'Overview', icon: Gauge },
      { href: '/platform/orgs', label: 'Organizations', icon: Building2 },
      { href: '/platform/signal-templates', label: 'Signal templates', icon: Radar },
      { href: '/platform/data', label: 'Data source', icon: Database },
      { href: '/platform/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
      {mounted && resolvedTheme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

function Nav({ me, area, onNavigate }: { me: MeResponse; area: 'org' | 'platform'; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = area === 'org' ? ORG_NAV : PLATFORM_NAV;
  return (
    <nav className="flex flex-col gap-5 px-3" aria-label="Main">
      {groups.map((g) => {
        const items = g.items.filter((i) => (!i.permission || me.permissions.includes(i.permission)) && (!i.when || i.when(me)));
        if (!items.length) return null;
        return (
          <div key={g.section}>
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.section}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => {
                const active = i.href === '/platform' ? pathname === '/platform' : pathname === i.href || pathname.startsWith(`${i.href}/`);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <i.icon className="size-4" />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-5 py-4">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Activity className="size-4" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">SelloEasy</span>
    </Link>
  );
}

export function AppShell({ area, children }: { area: 'org' | 'platform'; children: React.ReactNode }) {
  const { data: me, error, isLoading } = useMeQuery();
  const router = useRouter();
  const pathname = usePathname();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);
  useEffect(() => {
    if (!me) return;
    // Super Admins live in /platform; org members in /app (ADR-0010).
    if (area === 'org' && me.user.isSuperAdmin) router.replace('/platform');
    if (area === 'platform' && !me.user.isSuperAdmin) router.replace('/app/dashboard');
  }, [me, area, router]);

  if (isLoading || !me || (area === 'org') === me.user.isSuperAdmin) {
    return (
      <div className="app-surface flex min-h-screen">
        <div className="hidden w-60 border-r bg-sidebar p-4 md:block">
          <Skeleton className="h-8 w-32" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
      </div>
    );
  }

  const sidebar = (
    <>
      <Brand />
      {area === 'org' && me.org && (
        <div className="mx-3 mb-4 rounded-lg border bg-card px-3 py-2">
          <p className="truncate text-sm font-medium">{me.org.name}</p>
          <p className="text-xs text-muted-foreground">{INDUSTRY_LABELS[me.org.industry]}</p>
        </div>
      )}
      {area === 'platform' && (
        <div className="mx-3 mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-sm font-medium text-primary">Platform admin</p>
          <p className="text-xs text-muted-foreground">Public data & aggregates only</p>
        </div>
      )}
      <Nav me={me} area={area} onNavigate={() => setMobileOpen(false)} />
      <div className="mt-auto px-3 pb-4 pt-6">
        <Link href="/docs" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <BookOpenText className="size-4" /> Documentation
        </Link>
      </div>
    </>
  );

  return (
    <MeProvider value={me}>
      <div className="app-surface flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r bg-sidebar md:flex">{sidebar}</aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <aside className="app-surface absolute inset-y-0 left-0 flex w-64 flex-col overflow-y-auto border-r bg-sidebar">
              <Button variant="ghost" size="icon" className="absolute right-2 top-3" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X />
              </Button>
              {sidebar}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-6">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu />
            </Button>
            {area === 'org' && me.org && me.org.status !== 'ACTIVE' && (
              <Link href="/app/onboarding" className="hidden items-center gap-1.5 rounded-full bg-warning/20 px-3 py-1 text-xs font-medium text-amber-700 sm:flex dark:text-amber-300">
                <Rocket className="size-3.5" /> Onboarding in progress — finish setup to start capturing leads
              </Link>
            )}
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex cursor-pointer items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-accent" aria-label="Account menu">
                    <Avatar name={me.user.name} className="size-7" />
                    <span className="hidden text-sm font-medium sm:inline">{me.user.name.split(' ')[0]}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>
                    <span className="block text-sm font-medium text-foreground">{me.user.name}</span>
                    <span className="block font-normal">{me.user.email}</span>
                    <span className="mt-1 block font-normal">{ROLE_LABELS[me.role]}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {area === 'org' && (
                    <DropdownMenuItem onSelect={() => router.push('/app/me')}>
                      <User /> My profile
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => router.push('/docs')}>
                    <ClipboardList /> Documentation
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void logout()} className="text-destructive focus:text-destructive">
                    <LogOut /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </MeProvider>
  );
}
