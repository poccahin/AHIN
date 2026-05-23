import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ahin.io — Life++ Admission Gate',
  description:
    'Active Hashed Interaction Networks — a multi-agent zero-trust protocol gateway.',
};

export const viewport: Viewport = {
  themeColor: '#05060a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
