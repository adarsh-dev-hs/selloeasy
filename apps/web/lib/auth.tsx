'use client';
import type { MeResponse, Permission } from '@selloeasy/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext } from 'react';
import { get, post } from './api';

export function useMeQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => get<MeResponse>('/auth/me'), staleTime: 60_000 });
}

const MeContext = createContext<MeResponse | null>(null);
export const MeProvider = MeContext.Provider;

/** Current user — only valid inside an authenticated shell. */
export function useMe(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() used outside an authenticated layout');
  return me;
}

export function useCan() {
  const me = useContext(MeContext);
  return (p: Permission) => !!me?.permissions.includes(p);
}

/** UI-only permission gate (the API is the enforcement point). */
export function Can({ permission, children, fallback = null }: { permission: Permission; children: React.ReactNode; fallback?: React.ReactNode }) {
  const can = useCan();
  return <>{can(permission) ? children : fallback}</>;
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
}
