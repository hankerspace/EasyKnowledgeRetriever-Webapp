# EasyKnowledgeRetriever WebApp

This project is a complete web application (Backend + Frontend) serving as a graphical interface for the [EasyKnowledgeRetriever](https://github.com/hankerspace/EasyKnowledgeRetriever) library.

It allows you to easily configure your RAG pipeline, ingest documents, visualize your knowledge base (Graph and Vectors), and interact with it via a chat interface.

## Architecture

The project is divided into two parts:

- **Backend (`app/`)**: A REST API developed with **FastAPI**. It manages RAG orchestration, database access, and exposes endpoints for the frontend.
- **Frontend (`frontend/`)**: A modern user interface developed with **React** and **Vite**. It uses TailwindCSS for styling and enables fluid interaction with the API.

## Features

- ⚙️ **Configuration Management**: Interface to configure LLM models, embedding models, and storage types (Graph, Vector, KV).
- 📄 **Document Ingestion**: Automatic scanning and ingestion of files from the source directory.
- 💬 **Chat Interface**: Ask questions to your knowledge base using different modes (Mixed, Local, Global).
- 🕸️ **Graph Visualization**: Visually explore nodes and relationships in your knowledge base.
- 📊 **Data Explorer**: Visualize vector data and Key-Value storage.

## Prerequisites

- **Python** 3.10 or higher
- **Node.js** 18 or higher
- API Keys for LLM services (OpenAI, or compatible)

## Installation and Startup

It is recommended to open two terminals to run the backend and frontend simultaneously.

### 1. Backend (API)

From the project root:

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configuration:**
   Copy the example `.env.example` file to `.env` and fill in your API keys.
   ```bash
   cp .env.example .env
   # Edit .env with your keys (EKR_LLM_API_KEY, etc.)
   ```

3. **Start the server:**
   ```bash
   uvicorn app.main:app --reload
   ```
   The API will be accessible at [http://localhost:8000](http://localhost:8000).
   Swagger documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs).

### 2. Frontend (User Interface)

From the `frontend` directory:

1. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install Node dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   The interface will be accessible at [http://localhost:5173](http://localhost:5173) (or the port indicated by Vite).

## Project Structure

```
.
├── app/                 # Backend source code (FastAPI)
├── frontend/            # Frontend source code (React + Vite)
├── rag_data/            # Default working directory for RAG data
├── documents/           # Default source directory for file ingestion
├── requirements.txt     # Python dependencies
└── README.md            # This file
```

## License

MIT
