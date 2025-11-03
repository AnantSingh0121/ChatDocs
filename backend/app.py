from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
import fitz  
import json
import asyncio
import httpx
from pinecone import Pinecone, ServerlessSpec

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
load_dotenv()
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

pc = Pinecone(api_key=os.environ['PINECONE_API_KEY'])
index_name = os.environ['PINECONE_INDEX_NAME']

if not pc.has_index(index_name):
    pc.create_index(
        name=index_name,
        dimension=1536,  
        metric="cosine",
        spec=ServerlessSpec(
            cloud="aws",
            region=os.environ.get('PINECONE_ENVIRONMENT', 'us-east-1')
        )
    )

pinecone_index = pc.Index(index_name)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

UPLOADS_DIR = Path(__file__).parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()
api_router = APIRouter(prefix="/api")

class UserCreate(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Document(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    filename: str
    file_path: str
    upload_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    chunk_count: int = 0

class ChatMessage(BaseModel):
    role: str  
    content: str

class ChatRequest(BaseModel):
    document_id: str
    message: str
    conversation_history: List[ChatMessage] = []

class ChatHistory(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    document_id: str
    messages: List[Dict[str, Any]]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=int(os.environ.get('JWT_EXPIRATION_MINUTES', 1440)))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, os.environ['JWT_SECRET_KEY'], algorithm=os.environ['JWT_ALGORITHM'])
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    try:
        token = credentials.credentials
        payload = jwt.decode(token, os.environ['JWT_SECRET_KEY'], algorithms=[os.environ['JWT_ALGORITHM']])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

async def get_embedding(text: str):
    """Generate embedding using OpenRouter"""
    try:
        url = "https://openrouter.ai/api/v1/embeddings"
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        }
        json_data = {
            "model": "text-embedding-3-small",  
            "input": text,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=json_data)
            response.raise_for_status()
            data = response.json()
            embedding = data["data"][0]["embedding"]
            logging.info(f"Embedding length: {len(embedding)}")
            return embedding

    except Exception as e:
        logging.error(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail="Embedding generation failed")

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = start + chunk_size
        chunk = text[start:end]
        
        if chunk.strip():
            chunks.append(chunk)
        
        start += chunk_size - overlap
    
    return chunks

def extract_text_from_pdf(file_path: str) -> str:
    try:
        doc = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text
    except Exception as e:
        logging.error(f"PDF extraction error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text from PDF: {str(e)}")


@api_router.get("/")
async def root():
    return {"message": "ChatDocs API is running"}

@api_router.post("/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate):
    existing_user = await db.users.find_one({"username": user_data.username})
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "username": user_data.username,
        "hashed_password": hash_password(user_data.password),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.users.insert_one(user)
    
    access_token = create_access_token({"sub": user_id})
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.post("/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    user = await db.users.find_one({"username": user_data.username})
    if not user or not verify_password(user_data.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token({"sub": user["id"]})
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.get("/auth/me", response_model=User)
async def get_me(user_id: str = Depends(get_current_user)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "hashed_password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if isinstance(user['created_at'], str):
        user['created_at'] = datetime.fromisoformat(user['created_at'])
    
    return user

@api_router.post("/documents/upload", response_model=Document, status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    doc_id = str(uuid.uuid4())
    file_path = UPLOADS_DIR / f"{doc_id}_{file.filename}"
    
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    text = extract_text_from_pdf(str(file_path))
    
    chunks = chunk_text(text)
    
    for i, chunk in enumerate(chunks):
        try:
            embedding = await get_embedding(chunk)
            logging.info(f"Chunk {i} embedding length: {len(embedding)}")

            
            pinecone_index.upsert(
                vectors=[{
                    "id": f"{doc_id}#chunk_{i}",
                    "values": embedding,
                    "metadata": {
                        "document_id": doc_id,
                        "user_id": user_id,
                        "chunk_number": i,
                        "text": chunk[:1000]
                    }
                }],
                namespace=user_id
            )
            logging.info(f"Upserted chunk {i} for document {doc_id}")

        except Exception as e:
            logging.error(f"Error processing chunk {i}: {e}")
            continue
    try:
        stats = pinecone_index.describe_index_stats()
        logging.info(f"Pinecone index stats after upload: {stats}")
    except Exception as e:
        logging.warning(f"Could not fetch Pinecone stats: {e}")
    doc = {
        "id": doc_id,
        "user_id": user_id,
        "filename": file.filename,
        "file_path": str(file_path),
        "upload_date": datetime.now(timezone.utc).isoformat(),
        "chunk_count": len(chunks)
    }
    
    await db.documents.insert_one(doc)
    
    doc['upload_date'] = datetime.fromisoformat(doc['upload_date'])
    return doc

@api_router.get("/documents", response_model=List[Document])
async def get_documents(user_id: str = Depends(get_current_user)):
    docs = await db.documents.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
    
    for doc in docs:
        if isinstance(doc['upload_date'], str):
            doc['upload_date'] = datetime.fromisoformat(doc['upload_date'])
    
    return docs

@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user_id: str = Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id, "user_id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    try:
        pinecone_index.delete(filter={"document_id": doc_id}, namespace=user_id)
    except Exception as e:
        logging.warning(f"Failed to delete from Pinecone: {e}")
    
    try:
        Path(doc['file_path']).unlink(missing_ok=True)
    except Exception as e:
        logging.warning(f"Failed to delete file: {e}")
    
    await db.documents.delete_one({"id": doc_id})
    
    return {"message": "Document deleted successfully"}

@api_router.post("/chat")
async def chat(request: ChatRequest, user_id: str = Depends(get_current_user)):
    assistant_response = ""  
    doc = await db.documents.find_one({"id": request.document_id, "user_id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    query_embedding = await get_embedding(request.message)

    try:
        search_results = pinecone_index.query(
            vector=query_embedding,
            top_k=5,
            namespace=user_id,
            filter={"document_id": request.document_id},
            include_metadata=True
        )
        print(f"Search results: {search_results}")
        print(f"Matches found: {len(search_results.get('matches', []))}")
        for m in search_results.get('matches', []):
            print(m['metadata']['text'][:200])
    except Exception as e:
        logging.error(f"Pinecone query error: {e}")
        raise HTTPException(status_code=500, detail="Search failed")
    matches = search_results.get('matches', [])
    context = "\n\n".join([m['metadata']['text'] for m in matches]) if matches else ""

    if not context.strip():
        logging.info("⚠️ No matching content found — using fallback reasoning mode.")
        system_message = {
            "role": "system",
            "content": f"""You are an expert research assistant.
The user's question could not be answered directly from the document.

Task:
- Provide a thoughtful, general answer based on academic and technical best practices.
- If relevant, suggest possible improvements, additions or analysis approaches.
- Be concise and professional."""
        }
    else:
        system_message = {
            "role": "system",
            "content": f"""You are a helpful AI assistant that answers questions based on the provided document context.

Document Context:
{context}

Instructions:
- Use the context above as your main reference.
- If the answer isn't clearly stated, infer the most likely explanation.
- If absolutely nothing relevant is present, politely say so.
- Be concise and clear."""
        }
    print(f"Search results: {search_results}")

    messages = [system_message]
    for msg in request.conversation_history[-5:]:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": request.message})

    from openai import AsyncOpenAI
    client = AsyncOpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    )

    async def generate():
        assistant_response = ""
        try:
            response = await client.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-oss-20b"),
                messages=messages,
                stream=True,
            )

            async for chunk in response:
                try:
                    choice = chunk.choices[0]
                    delta = getattr(choice, "delta", None)
                    if not delta:
                        continue  

                    if isinstance(delta, dict):
                        content = delta.get("content")
                    else:
                        content = getattr(delta, "content", None)

                    if content:
                        assistant_response += content
                        yield f"data: {json.dumps({'content': content})}\n\n"

                except Exception as inner_e:
                    logging.warning(f"Chunk parse error: {inner_e}")
                    continue
            chat_id = str(uuid.uuid4())
            await db.chat_history.insert_one({
                "id": chat_id,
                "user_id": user_id,
                "document_id": request.document_id,
                "messages": (
                    [msg.dict() for msg in request.conversation_history]
                    + [
                        {"role": "user", "content": request.message},
                        {"role": "assistant", "content": assistant_response},
                    ]
                ),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })


            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            logging.error(f"Chat error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()