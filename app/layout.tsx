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
    icon: '/dtc-app-icon-light.svg',
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
