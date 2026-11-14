"use client";

import { Database, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { errorMessage } from "@/lib/api/client";
import type { DatasetSummary } from "@/lib/api/types";
import { formatBytes, formatDate, formatInteger } from "@/lib/format";
import { useDatasets, useDeleteDataset } from "@/lib/query/hooks";
import { QualityBadge } from "./badges";
import { UploadDialog } from "./upload-dialog";

const PAGE_SIZE = 20;

export function DatasetLibrary() {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<DatasetSummary | null>(null);
  const datasets = useDatasets({ limit: PAGE_SIZE, offset });
  const remove = useDeleteDataset();

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(`Deleted “${deleting.name}”`);
        setDeleting(null);
        if (datasets.data && datasets.data.items.length === 1 && offset > 0) {
          setOffset(Math.max(0, offset - PAGE_SIZE));
        }
      },
      onError: (error) => {
        toast.error(errorMessage(error, "The dataset could not be deleted."));
        setDeleting(null);
      },
    });
  };

  let body: React.ReactNode;
  if (datasets.isPending) {
    body = (
      <LoadingRegion label="Loading datasets" className="space-y-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </LoadingRegion>
    );
  } else if (datasets.isError) {
    body = (
      <ErrorState
        error={datasets.error}
        title="Your datasets could not be loaded"
        onRetry={() => void datasets.refetch()}
        retrying={datasets.isFetching}
      />
    );
  } else if (datasets.data.total === 0) {
    body = (
      <EmptyState
        icon={Database}
        title="No datasets yet"
        description="Upload a CSV, TSV or Excel file to profile it and start asking questions. You can also try the bundled sample dataset."
        action={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus aria-hidden="true" />
            Upload a dataset
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        <TableScroll label="Datasets">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Columns</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.data.items.map((dataset) => (
                <TableRow key={dataset.id} className="transition-colors hover:bg-muted/50">
                  <TableCell className="max-w-72 min-w-48">
                    <Link
                      href={`/app/datasets/${dataset.id}`}
                      className="block truncate rounded-sm font-medium underline-offset-4 hover:underline"
                    >
                      {dataset.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {dataset.file_format.toUpperCase()}
                      {dataset.sheet_name ? ` · sheet “${dataset.sheet_name}”` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatInteger(dataset.row_count)}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatInteger(dataset.column_count)}
                  </TableCell>
                  <TableCell className="tabular text-right whitespace-nowrap">
                    {formatBytes(dataset.original_size_bytes)}
                  </TableCell>
                  <TableCell>
                    <QualityBadge score={dataset.quality_score} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(dataset.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${dataset.name}`}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => router.push(`/app/analyses/new?dataset=${dataset.id}`)}
                        >
                          <Sparkles aria-hidden="true" />
                          Analyse
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleting(dataset)}>
                          <Trash2 aria-hidden="true" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
        <Pagination
          total={datasets.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          noun="datasets"
          disabled={datasets.isFetching}
        />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Datasets"
        description="Files you have uploaded. Each one is private to your account."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus aria-hidden="true" />
            Upload dataset
          </Button>
        }
      />
      {body}
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(dataset) => {
          toast.success(`Uploaded “${dataset.name}”`);
          router.push(`/app/datasets/${dataset.id}`);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description="The stored file and its profile will be permanently deleted. Existing analyses and reports are kept, but you will not be able to ask follow-up questions on them."
        confirmLabel="Delete dataset"
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </PageContainer>
  );
}
