# src/state.py
from __future__ import annotations
from typing import Annotated, Sequence, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """
    Shared state for the ReAct agent.

    - messages: conversation history (system, user, assistant, tool messages)
    """
    messages: Annotated[Sequence[BaseMessage], add_messages]
