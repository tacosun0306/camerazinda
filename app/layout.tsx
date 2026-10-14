import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Camera Store OS | 店內營運管理',
  description: '相機店內部營運管理平台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}