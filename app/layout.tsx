import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--nf-display", subsets: ["latin"], weight: ["600", "800"] });
const body = Inter({ variable: "--nf-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tuti Fruti",
  description: "Tuti Fruti para jugar con la oficina: ruleta de letras, ¡Basta! y puntaje automático.",
};

export const viewport: Viewport = { themeColor: "#e2462b" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
