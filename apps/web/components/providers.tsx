'use client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
        queryCache: new QueryCache({
          onError: (err) => {
            // Session fully expired (refresh failed) → back to login.
            if (err instanceof ApiError && err.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
              window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
            }
          },
        }),
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  );
}
