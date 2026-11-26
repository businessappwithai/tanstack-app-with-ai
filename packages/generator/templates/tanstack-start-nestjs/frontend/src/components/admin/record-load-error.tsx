import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api-client";

/** A failed read must never look like a successful, empty list. */
export function RecordLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const denied = isApiError(error) && error.statusCode === 403;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center">
      <h2 className="text-lg font-semibold">{denied ? "Access denied" : "Unable to load records"}</h2>
      <p className="text-sm text-muted-foreground">
        {denied
          ? "Your account does not have permission to read these records."
          : "The records could not be loaded. Please try again."}
      </p>
      <Button type="button" variant="outline" onClick={onRetry}>Try again</Button>
      <Link to="/dashboard" className="text-sm text-primary hover:underline">Back to dashboard</Link>
    </div>
  );
}
