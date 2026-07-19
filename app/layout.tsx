import type { Metadata, Viewport } from 'next';
import '../tokens.css';
import './globals.css';
import './industrial.css';
import PwaRegistration from './_components/PwaRegistration';

export const metadata: Metadata = {
  title: 'DTC E-Lock',
  applicationName: 'DTC E-Lock',
  description: 'DTC fleet e-lock operations console',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/dtc-elock-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/dtc-elock-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/dtc-elock-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'DTC E-Lock',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#efefea' },
    { media: '(prefers-color-scheme: dark)', color: '#efefea' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
