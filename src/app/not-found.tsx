import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <h2 className="text-2xl font-bold">Page not found</h2>
        <p className="text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
