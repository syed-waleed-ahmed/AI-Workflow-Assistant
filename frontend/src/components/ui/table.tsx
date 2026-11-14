import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A table inside its own horizontal scroller, so wide data never scrolls the page. */
function TableScroll({
  className,
  label,
  children,
  ...props
}: ComponentProps<"div"> & { label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      // "relative" keeps visually hidden (absolutely positioned) text inside the scroller, so it
      // cannot widen the page.
      className={cn("relative w-full overflow-auto rounded-md border border-border", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table className={cn("w-full caption-bottom border-collapse text-sm", className)} {...props} />
  );
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("sticky top-0 z-10 bg-muted", className)} {...props} />;
}

function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border", className)} {...props} />;
}

function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll };
