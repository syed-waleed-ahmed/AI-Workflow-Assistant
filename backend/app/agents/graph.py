"""The analysis workflow as a LangGraph state machine.

    START → plan → agent ⇄ tools → verify → report → ground → END
                     ▲               │        ▲         │
                     └── evidence ───┘        └─ fix ───┘
                         missing                unverified numbers

The `agent ⇄ tools` cycle is the ReAct loop of the original CLI (`agent_node`, `should_continue`
and a tool node), kept as the core. Around it:

- plan: the model states its steps and picks the tools it needs (fewer bound tools means
  smaller requests, which matters under tight provider token limits).
- verify: deterministic check that results were actually computed; sends the agent back once
  if not.
- report: the model writes a structured draft that cites evidence ids.
- ground: deterministic check of every stated number against tool results; sends the draft
  back once for correction, then records anything still unverified in the report itself.

Loops are bounded three ways: a cap on agent rounds, a cap on tool calls, and LangGraph's
recursion limit as a backstop. A wall-clock deadline and cancellation are checked before every
model request and tool execution.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph

from app.agents import prompts, toolkit
from app.agents.evidence import Evidence
from app.agents.llm import LLMError, estimate_message_tokens, estimate_tokens
from app.agents.state import AgentState, AnalysisFailed, Plan, RunDeps
from app.agents.verification import (
    check_evidence_references,
    check_grounding,
    evidence_gaps,
    strip_inline_references,
)
from app.schemas.report import ReportDraft
from app.tools.types import ToolInputError

logger = logging.getLogger(__name__)

PLAN_MAX_TOKENS = 700
AGENT_MAX_TOKENS = 1100
REPORT_MAX_TOKENS = 2800
REPORT_SCHEMA_TOKENS = 650  # the JSON schema sent with a structured-output request
MAX_VERIFY_ATTEMPTS = 1
MAX_GROUNDING_ATTEMPTS = 1


def _bound_tools(plan: Plan | None) -> list[str]:
    chosen = [name for name in (plan.tools if plan else []) if name in toolkit.TOOLS]
    names = list(dict.fromkeys(chosen)) or list(toolkit.DEFAULT_TOOLS)
    return names[:8]


def _fit_to_budget(messages: list[BaseMessage], deps: RunDeps, tools: list[dict[str, Any]]) -> list[BaseMessage]:
    """Shrink older tool results until the request fits the provider's per-request token limit.

    Tool messages remember which evidence they showed, so they can be re-rendered with fewer
    table rows instead of being dropped; the full results stay in the ledger for the report.
    """
    budget = deps.limits.request_token_budget - AGENT_MAX_TOKENS
    by_id = {item.id: item for item in deps.ledger.items}
    for max_rows in (12, 6, 3, 0):
        fitted: list[BaseMessage] = []
        for message in messages:
            if isinstance(message, ToolMessage) and (shown := message.additional_kwargs.get("evidence_ids")):
                text = "\n".join(by_id[ref].render(max_rows) for ref in shown if ref in by_id)
                fitted.append(ToolMessage(content=text, tool_call_id=message.tool_call_id))
            else:
                fitted.append(message)
        if estimate_message_tokens(fitted, tools) <= budget:
            return fitted
    return fitted


def build_graph(deps: RunDeps) -> Any:
    """Compile the workflow for one analysis run."""

    def plan_node(_state: AgentState) -> dict[str, Any]:
        deps.emit("status", "Planning the analysis", None)
        messages: list[BaseMessage] = [
            SystemMessage(prompts.PLANNER_SYSTEM),
            HumanMessage(
                "\n\n".join(
                    part
                    for part in [
                        prompts.dataset_brief(deps.dataset_name, deps.profile),
                        prompts.conversation_brief(deps.history),
                        "Available tools:\n" + toolkit.catalog_text(),
                        f"Question: {deps.question}",
                    ]
                    if part
                )
            ),
        ]
        try:
            plan = deps.gateway.structured(messages, Plan, max_tokens=PLAN_MAX_TOKENS, control=deps.control)
        except LLMError:
            # Planning is an optimisation, not a requirement: fall back to the default toolset.
            logger.warning("planning failed; continuing with default tools")
            plan = Plan(objective=deps.question, steps=[], tools=list(toolkit.DEFAULT_TOOLS))
        plan.steps = [step.strip() for step in plan.steps if step.strip()][:6]
        plan.tools = _bound_tools(plan)
        deps.emit("plan", "Analysis plan ready", {"objective": plan.objective, "steps": plan.steps})

        plan_text = "\n".join(f"{index}. {step}" for index, step in enumerate(plan.steps, 1)) or "(no explicit steps)"
        opening = [
            SystemMessage(prompts.AGENT_SYSTEM),
            HumanMessage(
                "\n\n".join(
                    part
                    for part in [
                        prompts.dataset_brief(deps.dataset_name, deps.profile),
                        prompts.conversation_brief(deps.history),
                        f"Plan:\n{plan_text}",
                        f"Question: {deps.question}",
                    ]
                    if part
                )
            ),
        ]
        return {"plan": plan, "messages": opening, "rounds": 0, "verify_attempts": 0, "grounding_attempts": 0}

    def agent_node(state: AgentState) -> dict[str, Any]:
        """Call the model with the transcript so far; it either requests tools or says it is done."""
        out_of_budget = (
            state.get("rounds", 0) >= deps.limits.max_agent_rounds or deps.tool_calls >= deps.limits.max_tool_calls
        )
        if out_of_budget:
            # Stop the loop without spending a model call the limits no longer allow.
            return {"messages": [AIMessage("DONE")]}
        tools = toolkit.tool_schemas(_bound_tools(state.get("plan")))
        messages = _fit_to_budget(list(state["messages"]), deps, tools)
        response = deps.gateway.chat(messages, tools=tools, max_tokens=AGENT_MAX_TOKENS, control=deps.control)
        return {"messages": [response]}

    def should_continue(state: AgentState) -> Literal["tools", "verify"]:
        """Route to the tools when the last assistant message requests them, otherwise move on."""
        last = state["messages"][-1]
        return "tools" if getattr(last, "tool_calls", None) else "verify"

    def _run_one(name: str, raw_args: dict[str, Any]) -> Evidence:
        deps.control.check()
        evidence_id = deps.ledger.next_id()
        if deps.tool_calls >= deps.limits.max_tool_calls:
            return Evidence(
                id=evidence_id, tool=name, label=name, arguments=raw_args, ok=False,
                error="Tool-call limit reached for this analysis. Finish with the results you have.",
            )  # fmt: skip
        deps.tool_calls += 1
        try:
            call = toolkit.parse_call(name, raw_args)
        except ToolInputError as exc:
            return Evidence(id=evidence_id, tool=name, label=name, arguments=raw_args, ok=False, error=str(exc))

        arguments = call.args.model_dump(exclude_none=True, exclude_defaults=True)
        if duplicate := deps.ledger.find_duplicate(name, arguments):
            return Evidence(
                id=evidence_id, tool=name, label=call.label, arguments=arguments, ok=False,
                error=f"This exact call was already made; see result {duplicate.id}.",
            )  # fmt: skip
        deps.emit("tool", call.label, {"tool": name, "evidence_id": evidence_id, "state": "running"})
        try:
            result = toolkit.execute(call, deps.frame)
        except ToolInputError as exc:
            return Evidence(id=evidence_id, tool=name, label=call.label, arguments=arguments, ok=False, error=str(exc))
        except Exception:
            # A defect in a tool must not take the run down or leak internals to the model.
            logger.exception("tool raised unexpectedly", extra={"tool": name})
            return Evidence(
                id=evidence_id, tool=name, label=call.label, arguments=arguments, ok=False,
                error="This tool failed on this data. Try a different approach.",
            )  # fmt: skip
        return Evidence(id=evidence_id, tool=name, label=call.label, arguments=arguments, ok=True, result=result)

    def tools_node(state: AgentState) -> dict[str, Any]:
        """Execute the requested tool calls and record each result in the evidence ledger."""
        last = state["messages"][-1]
        replies: list[ToolMessage] = []
        for tool_call in getattr(last, "tool_calls", []):
            name, args = tool_call["name"], tool_call.get("args") or {}
            if name == toolkit.BATCH_TOOL_NAME:
                # The model's JSON is untrusted in shape as well as content: keep only well-formed entries.
                listed = args.get("calls")
                raw_calls: list[Any] = listed if isinstance(listed, list) else []
                requests: list[tuple[str, dict[str, Any]]] = []
                for item in raw_calls[: toolkit.MAX_BATCH_CALLS]:
                    if isinstance(item, dict):
                        sub = item.get("args")
                        requests.append((str(item.get("tool", "")), sub if isinstance(sub, dict) else {}))
            else:
                requests = [(name, args)]

            produced: list[Evidence] = []
            for sub_name, sub_args in requests:
                evidence = _run_one(sub_name, sub_args)
                deps.ledger.add(evidence)
                produced.append(evidence)
                if evidence.ok:
                    deps.emit("tool", evidence.label, {"tool": sub_name, "evidence_id": evidence.id, "state": "done"})
                else:
                    logger.info("tool call rejected: %s: %s", sub_name, (evidence.error or "")[:300])
            content = (
                "\n".join(item.render() for item in produced) or "ERROR: run_batch needs a non-empty 'calls' list."
            )
            replies.append(
                ToolMessage(
                    content=content,
                    tool_call_id=tool_call["id"],
                    additional_kwargs={"evidence_ids": [item.id for item in produced]},
                )
            )
        return {"messages": replies, "rounds": state.get("rounds", 0) + 1}

    def verify_node(state: AgentState) -> dict[str, Any]:
        """Check that the evidence can support a report before one is written."""
        deps.emit("status", "Checking the evidence", None)
        gap = evidence_gaps(deps.ledger)
        attempts = state.get("verify_attempts", 0)
        if gap is None:
            return {"verify_attempts": attempts}
        can_retry = (
            attempts < MAX_VERIFY_ATTEMPTS
            and state.get("rounds", 0) < deps.limits.max_agent_rounds
            and deps.tool_calls < deps.limits.max_tool_calls
        )
        if not can_retry:
            raise AnalysisFailed(
                "The analysis could not compute results for this question with the available columns. "
                "Try rephrasing it or naming the columns to use."
            )
        deps.emit("verification", "More evidence needed; continuing the analysis", None)
        return {"verify_attempts": attempts + 1, "messages": [HumanMessage(f"Verification: {gap}")]}

    def after_verify(state: AgentState) -> Literal["agent", "report"]:
        return "agent" if isinstance(state["messages"][-1], HumanMessage) else "report"

    def report_node(state: AgentState) -> dict[str, Any]:
        """Write the structured report draft from the evidence ledger."""
        revising = bool(state.get("report_feedback"))
        deps.emit("status", "Correcting the report" if revising else "Writing the report", None)
        plan = state.get("plan")
        charts = [item.id for item in deps.ledger.successful if item.result and item.result.chart]
        fixed_parts = [
            prompts.dataset_brief(deps.dataset_name, deps.profile, max_columns=25),
            prompts.conversation_brief(deps.history, max_turns=2),
            f"Question: {deps.question}",
            "Plan followed:\n" + "\n".join(f"- {step}" for step in (plan.steps if plan else [])),
            f"Evidence ids that have a chart: {', '.join(charts) or 'none'}",
            state.get("report_feedback", ""),
        ]
        fixed = "\n\n".join(part for part in fixed_parts if part)
        evidence_budget = (
            deps.limits.request_token_budget
            - REPORT_MAX_TOKENS
            - REPORT_SCHEMA_TOKENS
            - estimate_tokens(prompts.REPORT_SYSTEM)
            - estimate_tokens(fixed)
            - 150
        )
        evidence_text = deps.ledger.render(max(evidence_budget, 400))
        messages = [
            SystemMessage(prompts.REPORT_SYSTEM),
            HumanMessage(f"{fixed}\n\nEvidence:\n{evidence_text}"),
        ]
        draft = deps.gateway.structured(messages, ReportDraft, max_tokens=REPORT_MAX_TOKENS, control=deps.control)
        return {"draft": draft}

    def ground_node(state: AgentState) -> dict[str, Any]:
        """Verify every number in the draft against computed results."""
        deps.emit("status", "Verifying figures against computed results", None)
        draft = strip_inline_references(check_evidence_references(state["draft"], deps.ledger))
        result = check_grounding(draft, deps.ledger, deps.profile, deps.question)
        attempts = state.get("grounding_attempts", 0)
        update: dict[str, Any] = {
            "draft": draft,
            "unverified_numbers": result.unverified,
            "numbers_checked": result.checked,
            "report_feedback": "",
        }
        if result.unverified and attempts < MAX_GROUNDING_ATTEMPTS and deps.control.remaining() > 45:
            deps.emit(
                "verification",
                f"{len(result.unverified)} figure(s) could not be traced to a computation; correcting",
                None,
            )
            update["grounding_attempts"] = attempts + 1
            update["report_feedback"] = (
                "Your previous draft stated these numbers, which do not appear in the evidence: "
                + ", ".join(result.unverified[:20])
                + ". Rewrite the report using only values present in the evidence; remove any figure "
                "you cannot copy from it."
            )
        elif result.unverified:
            deps.emit("verification", f"{len(result.unverified)} figure(s) remain unverified and are flagged", None)
        else:
            deps.emit("verification", f"All {result.checked} figures traced to computed results", None)
        return update

    def after_ground(state: AgentState) -> Literal["report", "__end__"]:
        return "report" if state.get("report_feedback") else "__end__"

    # Typed as Any: LangGraph's add_node overloads do not accept nodes over a partial TypedDict.
    graph: Any = StateGraph(AgentState)
    graph.add_node("plan", plan_node)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tools_node)
    graph.add_node("verify", verify_node)
    graph.add_node("report", report_node)
    graph.add_node("ground", ground_node)

    graph.add_edge(START, "plan")
    graph.add_edge("plan", "agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", "verify": "verify"})
    graph.add_edge("tools", "agent")  # the ReAct loop
    graph.add_conditional_edges("verify", after_verify, {"agent": "agent", "report": "report"})
    graph.add_edge("report", "ground")
    graph.add_conditional_edges("ground", after_ground, {"report": "report", END: END})
    return graph.compile()


def recursion_limit(max_agent_rounds: int) -> int:
    """Upper bound on graph steps: plan + 2 per round + verify/report/ground with one retry each."""
    return 2 * (max_agent_rounds + MAX_VERIFY_ATTEMPTS + 1) + 10
