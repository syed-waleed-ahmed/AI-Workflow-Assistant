"use client";

import { Download, FileSpreadsheet, FileText, FileType, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage } from "@/lib/api/client";
import { downloadReportExport } from "@/lib/api/download";
import type { ExportFormat } from "@/lib/api/types";

const FORMATS: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
  { format: "md", label: "Markdown (.md)", icon: FileText },
  { format: "pdf", label: "PDF (.pdf)", icon: FileType },
  { format: "xlsx", label: "Excel (.xlsx)", icon: FileSpreadsheet },
];

interface ReportExportMenuProps {
  reportId: string;
  /** Adds a "Print" entry; only useful on the full report page. */
  allowPrint?: boolean;
  size?: "sm" | "default";
  /** A compact icon button for dense lists; the label moves to aria-label. */
  iconOnly?: boolean;
  /** Names the report in the icon button's label when several are on one page. */
  reportLabel?: string;
}

export function ReportExportMenu({
  reportId,
  allowPrint = false,
  size = "sm",
  iconOnly = false,
  reportLabel,
}: ReportExportMenuProps) {
  const [pending, setPending] = useState<ExportFormat | null>(null);

  const exportAs = async (format: ExportFormat) => {
    setPending(format);
    try {
      const filename = await downloadReportExport(reportId, format);
      toast.success(`Downloaded ${filename}`);
    } catch (error) {
      toast.error(errorMessage(error, "The export failed. Please try again."));
    } finally {
      setPending(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {iconOnly ? (
          <Button
            variant="ghost"
            size="icon-sm"
            loading={pending !== null}
            aria-label={reportLabel ? `Export report: ${reportLabel}` : "Export report"}
          >
            {pending === null ? <Download aria-hidden="true" /> : null}
          </Button>
        ) : (
          <Button variant="outline" size={size} loading={pending !== null}>
            {pending === null ? <Download aria-hidden="true" /> : null}
            Export
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Download report as</DropdownMenuLabel>
        {FORMATS.map(({ format, label, icon: Icon }) => (
          <DropdownMenuItem key={format} onSelect={() => void exportAs(format)}>
            <Icon aria-hidden="true" />
            {label}
          </DropdownMenuItem>
        ))}
        {allowPrint ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setTimeout(() => window.print(), 100)}>
              <Printer aria-hidden="true" />
              Print
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
