# src/config.py
import os
from dotenv import load_dotenv
from langchain_groq import ChatGroq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is not set in .env")

# Core LLM used by the agent
llm = ChatGroq(
    model=GROQ_MODEL,
    temperature=0.1,   # low temperature → more deterministic reasoning
    max_tokens=2048,
)
