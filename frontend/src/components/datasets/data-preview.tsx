"use client";

import { useState } from "react";
import { Pagination } from "@/components/common/pagination";
import { ErrorState } from "@/components/common/states";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from "@/components/ui/table";
import type { Scalar } from "@/lib/api/types";
import { formatCell, formatInteger } from "@/lib/format";
import { useDatasetPreview } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

/** A paginated view of the stored rows, fetched page by page from the API. */
export function DataPreview({ datasetId }: { datasetId: string }) {
  const [offset, setOffset] = useState(0);
  const preview = useDatasetPreview(datasetId, { limit: PAGE_SIZE, offset });

  if (preview.isPending) {
    return (
      <LoadingRegion label="Loading the data preview" className="space-y-2">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </LoadingRegion>
    );
  }
  if (preview.isError) {
    return (
      <ErrorState
        error={preview.error}
        title="The preview could not be loaded"
        onRetry={() => void preview.refetch()}
        retrying={preview.isFetching}
      />
    );
  }

  const { columns, rows, total_rows: totalRows } = preview.data;
  const startRow = preview.data.offset;

  if (totalRows === 0) {
    return <p className="text-sm text-muted-foreground">This dataset has no rows.</p>;
  }

  return (
    <div className="space-y-3">
      <TableScroll
        label="Data preview"
        className={cn(
          "max-h-[32rem] transition-opacity",
          preview.isPlaceholderData && "opacity-60",
        )}
        aria-busy={preview.isFetching}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-px text-right">#</TableHead>
              {columns.map((column, index) => (
                <TableHead key={`${column}-${index}`}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={startRow + rowIndex}>
                <TableCell className="tabular text-right text-xs text-muted-foreground">
                  {formatInteger(startRow + rowIndex + 1)}
                </TableCell>
                {columns.map((column, index) => {
                  const value = row[index] as Scalar | undefined;
                  return (
                    <TableCell
                      key={`${column}-${index}`}
                      className={cn(
                        "max-w-64 truncate whitespace-nowrap",
                        typeof value === "number" && "tabular text-right",
                        (value === null || value === undefined) && "text-muted-foreground",
                      )}
                      title={typeof value === "string" && value.length > 30 ? value : undefined}
                    >
                      {formatCell(value)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      <Pagination
        total={totalRows}
        limit={PAGE_SIZE}
        offset={offset}
        onOffsetChange={setOffset}
        noun="rows"
        disabled={preview.isFetching}
      />
    </div>
  );
}
