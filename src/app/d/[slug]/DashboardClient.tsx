'use client';

import dynamic from 'next/dynamic';

const Dashboard = dynamic(
  () => import('@/components/dashboard').then((mod) => ({ default: mod.Dashboard })),
  { loading: () => <div className="min-h-screen bg-background" /> }
);

export function DashboardSlugClient({ slug }: { slug: string }) {
  return <Dashboard slug={slug} />;
}
