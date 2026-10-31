import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Artelier — A little curiosity. A world of art.', description: 'Discover art from the Cleveland Museum of Art. Explore, look closer, and build your own collection.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
