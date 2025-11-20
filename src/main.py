# src/main.py
from __future__ import annotations
import argparse

from rich.console import Console
from rich.markdown import Markdown
from langchain_core.messages import SystemMessage, HumanMessage

from .graph import build_graph

console = Console()


SYSTEM_PROMPT = """
You are an AI Workflow Assistant that plans, reasons, and acts using tools
to generate analytical reports from raw tabular data (CSV files).

Goals:
- Understand the business question and what the user wants from the data.
- Use the available tools to inspect the dataset, compute statistics,
  and slice/filter the data as needed.
- Follow a ReAct loop: think (internally), act via tools, observe results,
  then think again until you have enough information.
- Finally, produce a clear, well-structured report in Markdown with sections:

  1. Overview of Data
  2. Key Metrics & Trends
  3. Detailed Insights
  4. Anomalies or Data Quality Notes (if any)
  5. Recommendations / Next Steps

Important:
- Always reference the dataset path explicitly in your reasoning.
- If the user is vague, infer reasonable analysis steps and explain them.
- Keep the final report concise but insightful.
""".strip()


def run_cli():
    parser = argparse.ArgumentParser(
        description="AI Workflow Assistant (ReAct + LangGraph + Groq)"
    )
    parser.add_argument(
        "--data",
        required=True,
        help="Path to the CSV file (relative to 'data/' or absolute).",
    )
    parser.add_argument(
        "--task",
        required=False,
        help="High-level task, e.g. 'Analyze sales performance by region'.",
    )

    args = parser.parse_args()
    data_path = args.data
    task = args.task or "Generate a general analytical report for this dataset."

    app = build_graph()

    # Initial conversation messages
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(
            content=(
                f"Dataset path: {data_path}\n\n"
                f"Task: {task}\n\n"
                "Use your tools to inspect the data and then create the report."
            )
        ),
    ]

    console.rule("[bold cyan]Running AI Workflow Assistant[/bold cyan]")

    # Invoke the graph (single run)
    final_state = app.invoke({"messages": messages})

    # LangGraph merges state; final assistant answer is the last assistant message
    all_messages = list(final_state["messages"])
    assistant_messages = [m for m in all_messages if m.type == "ai"]

    if not assistant_messages:
        console.print("[red]No assistant response produced.[/red]")
        return

    final_answer = assistant_messages[-1].content
    console.print("\n[bold green]Final Report:[/bold green]\n")
    console.print(Markdown(final_answer))


if __name__ == "__main__":
    run_cli()
