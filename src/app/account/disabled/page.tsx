import { AccountStatusCard } from '@/components/auth/AccountStatusCard';

export const dynamic = 'force-dynamic';

export default function DisabledPage() {
  return <AccountStatusCard expectedState="DISABLED" />;
}
