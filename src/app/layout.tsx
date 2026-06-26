import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "스피어스 ERP - 종합관리",
  description: "(주)스피어스 자회사 종합관리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
