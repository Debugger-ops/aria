import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aria — Your AI Companion',
  description:
    'Chat with Aria, a warm and emotionally intelligent AI companion built with Next.js 16.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
