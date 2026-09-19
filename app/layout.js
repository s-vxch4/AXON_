import './globals.css';

export const metadata = {
  title: 'Axon — API Change Detection',
  description: 'AI agent that detects API breaking changes and opens fix PRs automatically',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0a] text-white antialiased">{children}</body>
    </html>
  );
}
