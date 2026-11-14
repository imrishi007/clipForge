import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'ClipForge Studio',description:'A local-first workspace for thoughtful short-form editing.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;}
