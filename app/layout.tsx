import './globals.css';

export const metadata = {
  title: 'DTC E-Lock',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
