import { AccountStatusCard } from '@/components/auth/AccountStatusCard';

export const dynamic = 'force-dynamic';

export default function PendingPage() {
  return <AccountStatusCard expectedState="PENDING" />;
}
