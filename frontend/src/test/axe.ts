import { configureAxe } from "vitest-axe";

/**
 * axe configured for jsdom. Colour contrast cannot be computed without a rendering engine, so
 * that rule is off here; contrast of the design tokens is checked separately.
 */
export const axe = configureAxe({ rules: { "color-contrast": { enabled: false } } });
