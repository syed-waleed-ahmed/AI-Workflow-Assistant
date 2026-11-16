"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

/*
 * A command palette built on cmdk (MIT), styled to match the rest of the UI kit. cmdk handles
 * filtering, ranking and keyboard navigation; these wrappers only add the design tokens.
 */

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl bg-popover text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-xl p-0 shadow-lg sm:top-[18vh]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command loop>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-4">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <CommandPrimitive.Input
        className={cn(
          "h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50",
          // The field is the dialog's only text box and is clearly framed; no extra ring.
          "focus-visible:outline-none",
          className,
        )}
        {...props}
      />
      <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground sm:inline">
        Esc
      </kbd>
    </div>
  );
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        "max-h-[min(24rem,60dvh)] scroll-py-2 overflow-x-hidden overflow-y-auto p-2",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("py-10 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden py-1 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-1.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:tracking-wider **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:uppercase",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator className={cn("-mx-2 my-1 h-px bg-border", className)} {...props} />
  );
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-muted data-[selected=true]:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("ml-auto text-xs tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
