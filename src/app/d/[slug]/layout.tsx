import { db } from '@/lib/db/client';
import { layouts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface Props {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function SlugLayout({ children, params }: Props) {
  const { slug } = await params;

  let fontScale = 100;
  try {
    const layout = await db.query.layouts.findFirst({
      where: (l, { eq: eqFn }) => eqFn(l.slug, slug),
      columns: { fontScale: true },
    });
    fontScale = layout?.fontScale ?? 100;
  } catch {
    // DB unavailable — use default scale
  }

  return <div style={fontScale !== 100 ? { zoom: fontScale / 100 } : undefined}>{children}</div>;
}
