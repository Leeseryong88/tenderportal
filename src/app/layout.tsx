import type { Metadata } from 'next';
import { LanguageProvider } from '@/components/providers/LanguageProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'IICOMBINED Tender Portal',
  description: 'Secure multi-role global tender management and supplier submission portal.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <LanguageProvider>
          <ToastProvider>{children}</ToastProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
