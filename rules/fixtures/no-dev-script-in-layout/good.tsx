// CLEAN equivalent: the root layout only loads a legitimate production script
// (analytics). No dev/design tooling injected.
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-XXX"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
