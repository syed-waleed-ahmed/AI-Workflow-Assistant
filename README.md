# 🧠 AI Workflow Assistant (ReAct Framework + LangGraph + Groq)

An **AI-powered workflow automation assistant** that can **plan**, **reason**, and **act** using tools to analyze **raw CSV data** and generate structured analytical reports.

This project demonstrates true **ReAct-style reasoning**, **LangGraph agent loops**, **tool calling**, and **Groq LLM integration** — making it a perfect portfolio-ready example of building real-world AI systems.

---

## 🚀 Features

### 🔹 ReAct (Reason + Act) Agent  
Uses LangGraph’s state machine to plan → call tools → observe results → think → act again… until a final answer is produced.

### 🔹 Tool-Calling Capabilities
Includes 3 built-in data tools:

- `load_csv_overview` — summarize dataset  
- `describe_column` — statistics for numeric columns  
- `filter_rows` — Pandas-powered conditional filtering  

Agents intelligently choose when to call tools.

### 🔹 Structured Final Report
The agent outputs a **Markdown report** with sections:

1. Overview of Data  
2. Key Metrics & Trends  
3. Detailed Insights  
4. Anomalies / Data Quality Notes  
5. Recommendations  

### 🔹 Groq LLM Integration
Fast & cost-efficient inference using **ChatGroq** (e.g., Llama-3.3-70B, Llama-3.1, Gemma 2, etc.)

---

## 📂 Project Structure
```text
ai-workflow-assistant/
├── .env
├── requirements.txt
├── data/
│ └── sample_data.csv
└── src/
├── init.py
├── config.py
├── tools.py
├── state.py
├── graph.py
└── main.py
```

## ▶️ Usage

1. Place your CSV file in the data/ folder or use an absolute path.
2. Run the agent:

python -m src.main --data sample_data.csv --task "Analyze regional sales performance."


3. Example output:
```text
-------------------------------
     Running AI Workflow Assistant
-------------------------------

Final Report:
# Sales Analysis Report
...
```

## 🧩 How It Works (Architecture)

1. This project implements the ReAct Framework using LangGraph.

- Agent Node
- Receives messages
- Calls the Groq LLM
- Determines if a tool should be used

2. 🔸 Tool Node

- Executes actual Python functions (Pandas-backed tools).

3. 🔸 Conditional Edge

should_continue decides:

- If tool calls exist → run tools
- Otherwise → stop and produce final answer

This creates a loop:
```text
Think → Act (Tool) → Observe → Think → ... → Final Answer
```

## 🛠️ Tech Stack

- LangGraph – agent orchestration & state machine
- LangChain – messages, tools, LLM interface
- Groq API – ultra-fast inference with Llama models
- Python
- Pandas – data operations
- Rich – nice terminal output

## 📈 Future Enhancements

- Add planning node (separate plan → execute graph)
- Support Excel, Parquet, SQL sources
- Add more data analysis tools (outliers, trends, clustering)
- Web UI using Streamlit or FastAPI
- Export final report to Markdown/PDF

## Author

Created by Syed Waleed Ahmed
