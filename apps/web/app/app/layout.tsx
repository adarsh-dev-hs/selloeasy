import { AppShell } from '@/components/app-shell';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="org">{children}</AppShell>;
}
