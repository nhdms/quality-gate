// KNOWN-BAD (from audit): a Figma MCP design-capture script injected into the
// root layout and shipped to production HTML.
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script src="https://mcp.figma.com/abc123/capture.js"></script>
      </head>
      <body>
        {children}
        <Script src="https://mcp.figma.com/abc123/capture.js" />
      </body>
    </html>
  );
}
