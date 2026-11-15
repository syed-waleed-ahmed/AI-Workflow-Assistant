"use client";

import { ArrowUp } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { MAX_QUESTION_LENGTH, questionSchema } from "@/lib/validation";
import { cn } from "@/lib/utils";

export interface QuestionComposerProps {
  /** Called with the cleaned question. Reject to keep the text in the box. */
  onSubmit: (question: string) => Promise<unknown>;
  label: string;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  /** Explains why the composer is disabled. */
  disabledReason?: string;
  suggestions?: readonly string[];
  suggestionsLabel?: string;
  /** Keeps suggestions on one scrollable line, for a composer pinned to the bottom of the page. */
  compactSuggestions?: boolean;
  rows?: number;
  autoFocus?: boolean;
  /** Extra controls placed beside the submit button. */
  secondaryAction?: ReactNode;
  className?: string;
}

/** A question box with validation, Enter-to-send, and optional suggested questions. */
export function QuestionComposer({
  onSubmit,
  label,
  placeholder = "Ask a question about this dataset…",
  submitLabel = "Ask",
  pending = false,
  disabled = false,
  disabledReason,
  suggestions = [],
  suggestionsLabel = "Suggested questions",
  compactSuggestions = false,
  rows = 2,
  autoFocus = false,
  secondaryAction,
  className,
}: QuestionComposerProps) {
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const blocked = disabled || pending;

  const submit = async (text: string) => {
    if (blocked) return;
    const parsed = questionSchema.safeParse(text);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a question.");
      return;
    }
    setError(null);
    try {
      await onSubmit(parsed.data);
      setValue("");
    } catch {
      // The caller reports the failure; the text stays so it can be sent again.
    }
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(value);
    }
  };

  const remaining = MAX_QUESTION_LENGTH - value.length;
  const describedBy = [error ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {suggestions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground" id={`${id}-suggestions`}>
            {suggestionsLabel}
          </p>
          <ul
            className={cn("flex gap-2", compactSuggestions ? "overflow-x-auto pb-1" : "flex-wrap")}
            aria-labelledby={`${id}-suggestions`}
          >
            {suggestions.map((suggestion) => (
              <li key={suggestion} className={compactSuggestions ? "shrink-0" : "max-w-full"}>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => void submit(suggestion)}
                  title={compactSuggestions ? suggestion : undefined}
                  className={cn(
                    "rounded-full border border-border bg-background px-3.5 py-1.5 text-left text-[13px] leading-5 text-foreground shadow-sm transition-[color,background-color,border-color,transform] hover:-translate-y-px hover:border-ring hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-50",
                    compactSuggestions ? "block max-w-[min(22rem,75vw)] truncate" : "max-w-full",
                  )}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={onFormSubmit} noValidate className="flex flex-col gap-1.5">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 shadow-sm transition-shadow has-[textarea:focus-visible]:shadow-lg has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-ring">
          <Textarea
            id={id}
            value={value}
            rows={rows}
            autoFocus={autoFocus}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder={disabled && disabledReason ? disabledReason : placeholder}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKeyDown}
            className="max-h-48 min-h-10 flex-1 resize-none border-0 px-2 py-1.5 shadow-none focus-visible:outline-none"
          />
          <div className="flex shrink-0 items-center gap-2">
            {secondaryAction}
            <Button
              type="submit"
              size="sm"
              loading={pending}
              disabled={disabled || value.trim().length === 0}
            >
              {pending ? null : <ArrowUp aria-hidden="true" />}
              {submitLabel}
            </Button>
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 px-1 text-xs leading-5">
          {error ? (
            <p id={`${id}-error`} role="alert" className="font-medium text-destructive-text">
              {error}
            </p>
          ) : (
            <span />
          )}
          <p id={`${id}-hint`} className="shrink-0 text-muted-foreground">
            {remaining <= 200 ? (
              <span className="tabular">{remaining} characters left</span>
            ) : (
              "Enter to send · Shift+Enter for a new line"
            )}
          </p>
        </div>
      </form>
    </div>
  );
}
