import { AccountStatusCard } from '@/components/auth/AccountStatusCard';

export const dynamic = 'force-dynamic';

export default function RejectedPage() {
  return <AccountStatusCard expectedState="REJECTED" />;
}
