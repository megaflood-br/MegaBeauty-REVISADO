import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MegaBeauty",
  description:
    "CRM e gestão multi-tenant para salões de beleza: agenda, clientes, anamnese, comandas, financeiro, comissões, estoque e WhatsApp.",
  openGraph: {
    title: "MegaBeauty",
    description:
      "CRM e gestão multi-tenant para salões de beleza: agenda, clientes, anamnese, comandas, financeiro, comissões, estoque e WhatsApp.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className={`${inter.className} min-h-full bg-cream text-ink`}>{children}</body>
    </html>
  );
}
