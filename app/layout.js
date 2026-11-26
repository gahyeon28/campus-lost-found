import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import Nav from '@/components/Nav';

export const metadata = {
  title: '교내 분실물 스마트 찾기',
  description: '학교 메일로 로그인하는 교내 습득물 공유·분실 알림 서비스',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children, modal }) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" />
      </head>
      <body>
        <AuthProvider>
          <Nav />
          <main className="container">{children}</main>
          {modal}
        </AuthProvider>
      </body>
    </html>
  );
}
