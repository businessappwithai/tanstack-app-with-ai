import { Link } from "@tanstack/react-router";
import { FileQuestion } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { useBusEntityLevel } from "@/hooks/use-bus-entity-level";
import { ADDetailShell } from "./ad-detail-shell";

interface BusEntityDetailPageProps {
  entityName: string;
  recordId: string;
}

/**
 * Metadata-driven detail/edit page for any bus_ entity record.
 * Reads the ADLevel (fields, labels, endpoint) entirely from the Application Dictionary.
 *
 * Generated route files import this and pass entityName + recordId — if you need
 * a fully custom window for a specific entity, replace the component body in the
 * route file instead of modifying this shared component.
 */
export function BusEntityDetailPage({ entityName, recordId }: BusEntityDetailPageProps) {
  const { level, isLoading, isUnknownEntity } = useBusEntityLevel(entityName);

  /*
   * `/$entity/$id` catches any two-segment path, so `/bus/bus_flight` reads
   * `bus` as the entity. The list page answers an address that names no entity
   * with a notice; without the same here this one drew a record shell titled
   * with the second segment, "0 of 0" and two 404s in the console.
   */
  if (isUnknownEntity) {
    return (
      <div className="p-6">
        <div className="swiss-card mx-auto max-w-md p-8 text-center">
          <FileQuestion className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">No screen at this address</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This application has no entity called{" "}
            <span className="font-mono-display text-foreground">{entityName}</span>. It may have
            been renamed, or the address may be mistyped.
          </p>
          <Link to="/dashboard" className={`${buttonVariants({ size: "sm" })} mt-6`}>
            Back to the dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !level) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  return <ADDetailShell level={level} recordId={recordId} parentContext={[]} initialMode="view" />;
}
