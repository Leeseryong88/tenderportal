import { redirect } from 'next/navigation';
import { resolveHomeRedirect } from '@/lib/server/pageGuard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const dest = await resolveHomeRedirect();
  redirect(dest);
}
