# ChatDocs — AI-Powered Document Intelligence System

ChatDocs is a full-stack **Retrieval-Augmented Generation (RAG)** platform that allows users to upload PDFs, extract insights and chat directly with their documents using advanced AI models and vector search powered by Pinecone.

It combines AI reasoning, semantic search and document management to create an intelligent assistant that understands and answers questions based on user-provided documents.

---

## 1. Overview

ChatDocs is designed for **AI engineers, software developers and researchers** who want to build or deploy **production-grade RAG systems**.  
It provides a seamless experience for intelligent document interaction through context-aware retrieval and real-time response generation.

---

## 2. Core Features

- **AI Document Chat** – Ask questions and receive contextual answers from uploaded PDFs.  
- **PDF Chunking and Vectorization** – Converts document text into embeddings using OpenRouter and stores them in Pinecone for semantic retrieval.  
- **RAG Pipeline** – Retrieval-Augmented Generation with context-aware LLM prompting.  
- **Secure Authentication** – JWT-based auth with automatic token expiry handling.  
- **Modern UI** – React frontend built with Tailwind CSS and route-based authentication.  
- **Persistent Data Storage** – MongoDB used for users, chat history and metadata.  
- **Streaming Responses** – Real-time, token-by-token LLM responses via Server-Sent Events.  
- **Session Management** – Automatic logout on JWT expiration.

---

## 3. Tech Stack

| **Layer** | **Technology** | **Description** |
|:----------:|:--------------:|:----------------:|
| **Frontend** | React + TailwindCSS | Responsive UI with authentication routing |
| **Backend** | FastAPI | Async Python API with CORS, JWT and streaming |
| **Database** | MongoDB | Stores users, documents and chat data |
| **Vector DB** | Pinecone | Vector storage for semantic document retrieval |
| **AI Models** | OpenRouter <br> (GPT-OSS-20B, text-embedding-3-small) | Used for embeddings and chat completions |
| **Auth** | JWT | Secure token-based authentication |
| **PDF Parsing** | PyMuPDF (fitz) | Text extraction from PDFs |
| **Async Client** | httpx | Non-blocking API requests to OpenRouter |

