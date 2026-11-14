import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Chart } from "@/lib/api/types";
import { heatmapChart, histogramChart, pieChart, sampleChart, scatterChart } from "@/test/fixtures";
import { describeChart, heatColor, shouldFacet } from "./chart-model";
import { ChartRenderer } from "./chart-renderer";

const count = (container: HTMLElement, selector: string) =>
  container.querySelectorAll(selector).length;

describe("ChartRenderer", () => {
  it("draws one bar per data point for a single-series bar chart from the sample report", () => {
    const chart = sampleChart("E1");
    const { container } = render(<ChartRenderer chart={chart} />);

    expect(screen.getByText("Sum of revenue by region")).toBeInTheDocument();
    expect(count(container, ".recharts-bar-rectangle")).toBe(chart.data!.length);
    // A single series is named by the title, so there is no legend.
    expect(screen.queryByRole("list", { name: "Legend" })).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /^Bar chart: Sum of revenue by region\. 4 region values from North America to LATAM\. .+ ranges from /,
    );
  });

  it("draws grouped bars with a legend when the series share a scale", () => {
    // Shape of the backend's pivot chart (sum of revenue by region and channel).
    const chart: Chart = {
      type: "bar",
      title: "Sum of revenue by region and channel",
      x_key: "region",
      x_label: "region",
      y_label: "sum of revenue",
      series: [
        { key: "Online", label: "Online" },
        { key: "Retail", label: "Retail" },
        { key: "Partner", label: "Partner" },
      ],
      data: [
        { region: "North America", Online: 2_210_000, Retail: 1_520_000, Partner: 1_120_000 },
        { region: "Europe", Online: 1_560_000, Retail: 1_100_000, Partner: 610_000 },
        { region: "APAC", Online: 1_170_000, Retail: 730_000, Partner: 480_000 },
        { region: "LATAM", Online: 540_000, Retail: 310_000, Partner: 150_000 },
      ],
    };
    const { container } = render(<ChartRenderer chart={chart} />);

    expect(count(container, ".recharts-bar-rectangle")).toBe(
      chart.data!.length * chart.series!.length,
    );
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Online", "Retail", "Partner"]);
    expect(container.querySelector("[data-faceted]")).not.toBeInTheDocument();
  });

  it("splits measures of very different scale into separate panels instead of sharing an axis", () => {
    // The backend avoids sending this shape, but older reports contain it: total revenue
    // (millions) and mean unit price (hundreds) in one chart.
    const chart: Chart = {
      type: "bar",
      title: "sum_revenue, mean_unit_price by region",
      x_key: "group",
      x_label: "region",
      y_label: "",
      series: [
        { key: "sum_revenue", label: "sum revenue" },
        { key: "mean_unit_price", label: "mean unit price" },
      ],
      data: [
        { group: "North America", sum_revenue: 4851042.44, mean_unit_price: 250.2222 },
        { group: "Europe", sum_revenue: 3266861.56, mean_unit_price: 250.077 },
        { group: "APAC", sum_revenue: 2384029.35, mean_unit_price: 249.7263 },
        { group: "LATAM", sum_revenue: 1002437.59, mean_unit_price: 255.6669 },
      ],
    };
    expect(shouldFacet(chart)).toBe(true);
    const { container } = render(<ChartRenderer chart={chart} />);

    expect(container.querySelector("[data-faceted]")).toBeInTheDocument();
    const panels = screen.getAllByRole("img");
    expect(panels).toHaveLength(2);
    expect(panels[0]).toHaveAccessibleName(/sum revenue/);
    expect(panels[1]).toHaveAccessibleName(/mean unit price/);
    // Every value is still drawn: one bar per region in each panel.
    expect(count(container, ".recharts-bar-rectangle")).toBe(chart.data!.length * 2);
  });

  it("draws one line per series for a time series", () => {
    const chart = sampleChart("E3");
    const { container } = render(<ChartRenderer chart={chart} />);

    expect(count(container, ".recharts-line-curve")).toBe(4);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["North America", "Europe", "APAC", "LATAM"]);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /Line chart: .* 18 Month values from 2024-01 to 2025-06\./,
    );
  });

  it("leaves a gap in a line where the API sent null", () => {
    const chart: Chart = {
      type: "line",
      title: "Revenue per month",
      x_key: "period",
      x_label: "Month",
      y_label: "revenue",
      series: [{ key: "revenue", label: "Revenue" }],
      data: [
        { period: "2024-01", revenue: 10 },
        { period: "2024-02", revenue: 12 },
        { period: "2024-03", revenue: null },
        { period: "2024-04", revenue: 14 },
        { period: "2024-05", revenue: 15 },
      ],
    };
    const { container } = render(<ChartRenderer chart={chart} />);

    // Two separate sub-paths (two "M" commands): the null is not bridged or drawn as zero.
    const path = container.querySelector(".recharts-line-curve")?.getAttribute("d") ?? "";
    expect(path.match(/M/g)).toHaveLength(2);
    expect(count(container, ".recharts-line-dot")).toBe(4);
  });

  it("draws a histogram bar for every bin", () => {
    const { container } = render(<ChartRenderer chart={histogramChart} />);
    expect(count(container, ".recharts-bar-rectangle")).toBe(4);
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Histogram: Distribution of revenue\./);
    expect(
      screen.getByText("x: revenue · y: Rows", { collapseWhitespace: true }),
    ).toBeInTheDocument();
  });

  it("draws a pie sector for every category and lists the categories in a legend", () => {
    const { container } = render(<ChartRenderer chart={pieChart} />);

    expect(count(container, ".recharts-pie-sector")).toBe(3);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Online", "Retail", "Partner"]);
  });

  it("plots scatter points using x_key and y_label as the data keys", () => {
    const { container } = render(<ChartRenderer chart={scatterChart} />);

    expect(count(container, ".recharts-scatter-symbol")).toBe(scatterChart.data!.length);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Scatter plot: revenue vs units. 5 points. units ranges from 8 to 31. revenue ranges from 1,684.94 to 7,267.11. The underlying table is in the Methodology section.",
    );
  });

  it("renders a correlation heatmap as a grid with the values in the cells", () => {
    const { container } = render(<ChartRenderer chart={heatmapChart} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(
      /^Heatmap: Pearson correlation matrix\. 3 by 3 grid/,
    );
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "units",
      "revenue",
      "discount_pct",
    ]);
    const row = screen.getByRole("row", { name: /^revenue/ });
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["0.82", "1.00", "-0.12"]);
    expect(count(container, "td[data-value]")).toBe(9);
    expect(container.querySelector('td[data-value="-0.45"]')).toHaveAttribute(
      "title",
      "units × discount_pct: -0.45",
    );
  });

  it("says so when a chart has no data instead of drawing empty axes", () => {
    render(<ChartRenderer chart={{ ...histogramChart, data: [] }} />);
    expect(screen.getByText("This chart has no data points.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("chart model", () => {
  it("keeps series on one axis when their scales are comparable", () => {
    expect(shouldFacet(sampleChart("E5"))).toBe(false);
    expect(shouldFacet(sampleChart("E3"))).toBe(false);
    expect(shouldFacet(pieChart)).toBe(false);
  });

  it("colours correlations from a neutral midpoint towards opposite poles", () => {
    expect(heatColor(0)).toContain("0%");
    expect(heatColor(1)).toBe("color-mix(in oklab, var(--heat-positive) 70%, var(--heat-neutral))");
    expect(heatColor(-0.5)).toBe(
      "color-mix(in oklab, var(--heat-negative) 35%, var(--heat-neutral))",
    );
    expect(heatColor(null)).toBe("transparent");
  });

  it("describes an empty chart honestly", () => {
    expect(describeChart({ ...histogramChart, data: [] })).toBe(
      "Histogram: Distribution of revenue. No data points.",
    );
  });
});
