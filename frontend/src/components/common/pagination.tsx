import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  /** What is being paged, for the summary and button labels: "rows", "datasets"… */
  noun: string;
  disabled?: boolean;
  className?: string;
}

export function Pagination({
  total,
  limit,
  offset,
  onOffsetChange,
  noun,
  disabled = false,
  className,
}: PaginationProps) {
  if (total === 0) return null;
  const first = offset + 1;
  const last = Math.min(offset + limit, total);
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;
  return (
    <nav
      aria-label={`Pagination for ${noun}`}
      className={cn("flex flex-wrap items-center justify-between gap-2", className)}
    >
      <p className="tabular text-sm text-muted-foreground" aria-live="polite">
        {formatInteger(first)}–{formatInteger(last)} of {formatInteger(total)} {noun}
      </p>
      {hasPrevious || hasNext ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !hasPrevious}
            onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !hasNext}
            onClick={() => onOffsetChange(offset + limit)}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
