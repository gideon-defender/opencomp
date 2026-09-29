import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trust Center',
  description: 'Security, compliance, and trust documentation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main>{children}</main>
        <Toaster richColors />
      </body>
    </html>
  );
}
