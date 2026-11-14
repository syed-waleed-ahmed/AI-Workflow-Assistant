import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const fieldClasses =
  "w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive-text";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return <input type={type ?? "text"} className={cn(fieldClasses, "h-9", className)} {...props} />;
}

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldClasses, "min-h-20 resize-y py-2 leading-6", className)}
      {...props}
    />
  );
}

function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(fieldClasses, "h-9 appearance-auto pr-2", className)} {...props}>
      {children}
    </select>
  );
}

export { Input, NativeSelect, Textarea };
