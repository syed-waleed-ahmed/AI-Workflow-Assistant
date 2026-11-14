"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Field, fieldDescribedBy } from "@/components/common/form-field";
import { InlineError } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/client";
import type { DatasetSummary } from "@/lib/api/types";
import { useRenameDataset } from "@/lib/query/hooks";
import { datasetNameSchema, type DatasetNameValues } from "@/lib/validation";

interface RenameDialogProps {
  dataset: DatasetSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameDatasetDialog({ dataset, open, onOpenChange }: RenameDialogProps) {
  const rename = useRenameDataset();
  const form = useForm<DatasetNameValues>({
    resolver: zodResolver(datasetNameSchema),
    values: { name: dataset.name },
  });
  const error = form.formState.errors.name?.message;

  const submit = form.handleSubmit((values) => {
    rename.mutate(
      { id: dataset.id, name: values.name },
      {
        onSuccess: () => {
          toast.success("Dataset renamed");
          onOpenChange(false);
        },
      },
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          rename.reset();
          form.reset({ name: dataset.name });
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename dataset</DialogTitle>
          <DialogDescription>
            The name is only a label. The stored data does not change.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field id="dataset-name" label="Name" error={error}>
            <Input
              id="dataset-name"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={fieldDescribedBy("dataset-name", error)}
              {...form.register("name")}
            />
          </Field>
          {rename.isError ? (
            <InlineError>
              {errorMessage(rename.error, "The dataset could not be renamed.")}
            </InlineError>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={rename.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={rename.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
