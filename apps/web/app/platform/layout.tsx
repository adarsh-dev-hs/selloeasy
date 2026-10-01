import { AppShell } from '@/components/app-shell';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="platform">{children}</AppShell>;
}
