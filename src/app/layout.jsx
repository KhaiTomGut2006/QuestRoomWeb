import "./globals.css";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";

export const metadata = {
  title: "Quest Room",
  description: "Cozy multiplayer quest room",
  icons: {
    icon: `${basePath}/favicon.png`
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
