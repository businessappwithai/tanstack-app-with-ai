import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { HeadingTitle } from "@/components/providers/HeadingTitle";
import { Providers } from "@/components/providers/Providers";
import "@/styles/globals.css";

function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground">
      <div className="text-6xl font-bold text-muted-foreground">404</div>
      <h1 className="text-2xl font-semibold">Page Not Found</h1>
      <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Link
        to="/projects"
        className="mt-2 px-4 py-2 rounded-lg text-slate-900 text-sm font-semibold"
        style={{ backgroundColor: "#FF8400" }}
      >
        Back to Projects
      </Link>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>APPWITHAI</title>
        <meta name="description" content="AI-Powered ERD Design Platform" />
        <HeadContent />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Providers>
          <HeadingTitle />
          <Outlet />
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
