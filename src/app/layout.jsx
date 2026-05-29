import "./globals.css";
import Providers from "@/components/Providers";

export const metadata = {
  title: "Quest Room",
  description: "Cozy multiplayer quest room"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
