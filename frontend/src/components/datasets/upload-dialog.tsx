"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Dataset } from "@/lib/api/types";
import { DatasetUploader } from "./dataset-uploader";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (dataset: Dataset) => void;
}

export function UploadDialog({ open, onOpenChange, onUploaded }: UploadDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        hideClose={busy}
        onInteractOutside={(event) => (busy ? event.preventDefault() : undefined)}
      >
        <DialogHeader>
          <DialogTitle>Upload a dataset</DialogTitle>
          <DialogDescription>
            The file is parsed and profiled on upload, then stored privately in your account.
          </DialogDescription>
        </DialogHeader>
        <DatasetUploader
          onBusyChange={setBusy}
          onUploaded={(dataset) => {
            onOpenChange(false);
            onUploaded(dataset);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
