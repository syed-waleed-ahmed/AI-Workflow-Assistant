# src/graph.py
from __future__ import annotations
from typing import Dict, Literal

from langchain_core.messages import BaseMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from .config import llm
from .state import AgentState
from .tools import all_tools

# Bind tools to the LLM so it can call them
model_with_tools = llm.bind_tools(all_tools)
tool_node = ToolNode(all_tools)


def agent_node(state: AgentState) -> Dict:
    """Call the LLM with the current messages."""
    messages = state["messages"]
    response: BaseMessage = model_with_tools.invoke(messages)
    return {"messages": [response]}


def should_continue(state: AgentState) -> Literal["tools", "__end__"]:
    """
    Decide whether to:
    - call tools (if the last assistant message includes tool calls), or
    - end the graph (return final answer).
    """
    last_message = state["messages"][-1]

    # LangChain messages expose tool calls as .tool_calls (list) if present
    tool_calls = getattr(last_message, "tool_calls", None)
    if tool_calls:
        return "tools"
    return END


def build_graph():
    """
    Create and compile the ReAct graph.
    """
    graph = StateGraph(AgentState)

    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)

    graph.set_entry_point("agent")

    # Agent → either tools or end
    graph.add_conditional_edges("agent", should_continue)

    # Tools → back to agent (ReAct loop)
    graph.add_edge("tools", "agent")

    app = graph.compile()
    return app
