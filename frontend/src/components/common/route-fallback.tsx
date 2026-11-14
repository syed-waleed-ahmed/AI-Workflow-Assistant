import { PageContainer } from "@/components/common/page-header";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/** Shown while a page that depends on the URL (an id or query string) is being resolved. */
export function RouteFallback({ label }: { label: string }) {
  return (
    <PageContainer>
      <LoadingRegion label={label} className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-1/2" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </LoadingRegion>
    </PageContainer>
  );
}
