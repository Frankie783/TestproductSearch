# AI Product Search Dashboard

This Vite + React dashboard helps connector manufacturers manage catalog spreadsheets, process client part requests, and generate AI-assisted proposal briefs.

## Features

- Upload and manage multiple catalog CSV/XLSX files with check, update, delete, and activate controls.
- Parse client bills of material and instantly highlight matched vs missing parts.
- Download a CSV report of coverage for rapid follow up.
- Surface duplicate requests, missing identifiers, and top catalog manufacturers and product families.
- Customize the agent workflow that guides the OpenAI-powered sourcing assistant.
- Generate a proposal brief through the OpenAI Responses API.

## Getting Started

```bash
npm install
npm run dev
```

Create a `.env` file with your API key to enable the AI brief:

```
VITE_OPENAI_API_KEY=sk-...
```

The project is built with Vite for quick self-deployment and includes PapaParse and SheetJS for spreadsheet ingestion.
