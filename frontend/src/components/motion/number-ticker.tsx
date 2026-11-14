"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface ParsedNumber {
  prefix: string;
  number: number;
  suffix: string;
  decimals: number;
  grouped: boolean;
}

/** Splits a formatted figure such as "4,851,042.44", "-49.08%" or "$1.2" into its parts. */
export function parseFigure(value: string): ParsedNumber | null {
  const match = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(value.trim());
  if (!match) return null;
  const [, prefix = "", digits = "", suffix = ""] = match;
  const number = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  const decimals = digits.includes(".") ? (digits.split(".")[1]?.length ?? 0) : 0;
  return { prefix, number, suffix, decimals, grouped: digits.includes(",") };
}

function format(parsed: ParsedNumber, current: number): string {
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
    useGrouping: parsed.grouped,
  }).format(current);
  return `${parsed.prefix}${text}${parsed.suffix}`;
}

/**
 * Counts a figure up from zero the first time it scrolls into view (in the style of Magic
 * UI's NumberTicker, MIT). The real value is always available to assistive technology, and
 * visitors who prefer reduced motion see it straight away.
 */
export function NumberTicker({ value, className }: { value: string; className?: string }) {
  const parsed = parseFigure(value);
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" });
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(() => (parsed ? format(parsed, 0) : value));

  useEffect(() => {
    if (!parsed || !inView || reduceMotion) return;
    const controls = animate(0, parsed.number, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(format(parsed, latest)),
      onComplete: () => setDisplay(value),
    });
    return () => controls.stop();
    // `parsed` is derived from `value`; depending on it would restart the animation each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduceMotion, value]);

  if (!parsed) return <span className={className}>{value}</span>;
  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">{reduceMotion ? value : display}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
