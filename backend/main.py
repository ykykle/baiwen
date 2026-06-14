"""
AI Chat Assistant - Backend Server
FastAPI + LangChain ChatOpenAI integration with DeepSeek models.
"""
import os
import json
import base64
import uuid
import mimetypes
from datetime import datetime
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

load_dotenv(Path(__file__).resolve().parent / ".env")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# 同时兼容 DEEPSEEK_API_KEY 和 ANTHROPIC_API_KEY 环境变量名
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", os.getenv("ANTHROPIC_API_KEY", ""))
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

print(f"[启动] .env 路径: {(Path(__file__).resolve().parent / '.env')}")
print(f"[启动] API Key 已加载: {bool(DEEPSEEK_API_KEY)} (长度: {len(DEEPSEEK_API_KEY)})")
print(f"[启动] API Base URL: {DEEPSEEK_BASE_URL}")

DEFAULT_MODEL = "deepseek-v4-flash"
AVAILABLE_MODELS = {
    "deepseek-v4-flash": {
        "name": "DeepSeek V4 Flash",
        "description": "最快速度，适合日常对话",
        "max_tokens": 4096,
    },
    "deepseek-v4-pro": {
        "name": "DeepSeek V4 Pro",
        "description": "最强推理能力，适合复杂任务",
        "max_tokens": 16384,
    },
}

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(title="AI Chat Assistant", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-Memory Store
# ---------------------------------------------------------------------------
conversations: dict = {}


def get_or_create_conv(conv_id: str) -> dict:
    if conv_id not in conversations:
        conversations[conv_id] = {
            "id": conv_id,
            "title": "新对话",
            "messages": [],
            "model": DEFAULT_MODEL,
            "mode": "quick",
            "created_at": datetime.now().isoformat(),
        }
    return conversations[conv_id]


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str
    model: Optional[str] = None
    mode: Optional[str] = "quick"
    attachments: Optional[list] = None


class RenameRequest(BaseModel):
    title: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def build_system_prompt(mode: str) -> str:
    base = "你是一个智能AI助手，能够回答各种问题、分析文件、编写代码。请用中文回复，除非用户使用其他语言。"
    if mode == "deep":
        return (
            base
            + "\n\n请进行深入、全面的思考和分析。在回答前，请：\n"
            "1. 仔细理解问题的各个方面\n"
            "2. 考虑多种可能的解决方案\n"
            "3. 提供详细的推理过程\n"
            "4. 指出潜在的陷阱和注意事项\n"
            "5. 给出结构化、有条理的最终答案"
        )
    return base + "\n请给出简洁、清晰的回答。"


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_TEXT_TYPES = {
    "text/plain", "text/markdown", "text/csv",
    "application/json", "application/pdf",
    "application/x-python", "text/x-python",
}


def build_langchain_messages(
    history: list,
    new_message: str,
    attachments: list | None,
    system_prompt: str,
) -> list:
    """
    Build a list of LangChain message objects suitable for ChatOpenAI.
    Supports text + image attachments via OpenAI vision format.
    """
    lc_messages = []

    # System prompt
    if system_prompt:
        lc_messages.append(SystemMessage(content=system_prompt))

    # Conversation history (plain text)
    for msg in history:
        role = msg["role"]
        content = msg.get("content", "")
        if role == "user":
            lc_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))

    # Build the new user message — may include images
    image_attachments = [
        a for a in (attachments or [])
        if a.get("type", "").startswith("image/") and a.get("data_url")
    ]
    text_attachments = [
        a for a in (attachments or [])
        if not a.get("type", "").startswith("image/")
    ]

    if image_attachments:
        # Multimodal message: list of content blocks
        content_blocks = [{"type": "text", "text": new_message}]
        for att in image_attachments:
            content_blocks.append({
                "type": "image_url",
                "image_url": {"url": att["data_url"]},
            })
        # Append text file contents to the text block
        if text_attachments:
            extra = "\n\n".join(
                f"[文件: {a.get('name', 'unknown')}]\n{a.get('content', '')}"
                for a in text_attachments if a.get("content")
            )
            if extra:
                content_blocks[0]["text"] += "\n\n" + extra
        lc_messages.append(HumanMessage(content=content_blocks))
    else:
        # Text-only message
        text = new_message
        if text_attachments:
            extra = "\n\n".join(
                f"[文件: {a.get('name', 'unknown')}]\n{a.get('content', '')}"
                for a in text_attachments if a.get("content")
            )
            if extra:
                text += "\n\n" + extra
        lc_messages.append(HumanMessage(content=text))

    return lc_messages


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "has_api_key": bool(DEEPSEEK_API_KEY)}


@app.get("/api/models")
async def list_models():
    return {"models": AVAILABLE_MODELS, "default": DEFAULT_MODEL}


# --- Conversations ---
@app.get("/api/conversations")
async def list_conversations():
    convs = sorted(
        conversations.values(),
        key=lambda c: c.get("created_at", ""),
        reverse=True,
    )
    return {
        "conversations": [
            {
                "id": c["id"],
                "title": c["title"],
                "model": c["model"],
                "mode": c["mode"],
                "message_count": len(c["messages"]),
                "created_at": c["created_at"],
            }
            for c in convs
        ]
    }


@app.post("/api/conversations")
async def create_conversation():
    conv_id = uuid.uuid4().hex[:12]
    conv = get_or_create_conv(conv_id)
    return {"id": conv["id"], "title": conv["title"], "created_at": conv["created_at"]}


@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conv = get_or_create_conv(conv_id)
    return {
        "id": conv["id"],
        "title": conv["title"],
        "messages": conv["messages"],
        "model": conv["model"],
        "mode": conv["mode"],
        "created_at": conv["created_at"],
    }


@app.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    if conv_id in conversations:
        del conversations[conv_id]
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Conversation not found")


@app.patch("/api/conversations/{conv_id}")
async def rename_conversation(conv_id: str, req: RenameRequest):
    conv = get_or_create_conv(conv_id)
    conv["title"] = req.title
    return {"id": conv_id, "title": req.title}


@app.put("/api/conversations/{conv_id}/settings")
async def update_settings(conv_id: str, model: str = Form(None), mode: str = Form(None)):
    conv = get_or_create_conv(conv_id)
    if model and model in AVAILABLE_MODELS:
        conv["model"] = model
    if mode and mode in ("quick", "deep"):
        conv["mode"] = mode
    return {"model": conv["model"], "mode": conv["mode"]}


# --- File Upload ---
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        content = await file.read()
        mime_type = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"

        file_id = uuid.uuid4().hex[:8]
        ext = Path(file.filename).suffix if file.filename else ""
        saved_name = f"{file_id}{ext}"
        saved_path = UPLOAD_DIR / saved_name
        saved_path.write_bytes(content)

        result = {
            "id": file_id,
            "name": file.filename,
            "type": mime_type,
            "size": len(content),
        }

        if mime_type in ALLOWED_IMAGE_TYPES:
            b64 = base64.b64encode(content).decode("utf-8")
            result["data_url"] = f"data:{mime_type};base64,{b64}"
        elif mime_type in ALLOWED_TEXT_TYPES or mime_type.startswith("text/"):
            try:
                result["content"] = content.decode("utf-8")[:10000]
            except UnicodeDecodeError:
                result["content"] = "[二进制文件，无法预览]"

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Chat (Streaming) ---
@app.post("/api/chat/{conv_id}")
async def chat(conv_id: str, req: ChatRequest):
    conv = get_or_create_conv(conv_id)
    model = req.model or conv.get("model", DEFAULT_MODEL)
    mode = req.mode or conv.get("mode", "quick")

    if model not in AVAILABLE_MODELS:
        model = DEFAULT_MODEL

    if not DEEPSEEK_API_KEY:
        return JSONResponse(
            status_code=500,
            content={"error": "未配置 API Key — 请在 .env 中设置 DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY"},
        )

    # Save user message
    user_msg = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": req.message,
        "attachments": req.attachments,
        "timestamp": datetime.now().isoformat(),
    }
    conv["messages"].append(user_msg)

    # Auto-title
    if len(conv["messages"]) == 1 and conv["title"] == "新对话":
        conv["title"] = req.message[:30] + ("..." if len(req.message) > 30 else "")

    # Build LangChain messages
    history = conv["messages"][:-1]
    system_prompt = build_system_prompt(mode)
    lc_messages = build_langchain_messages(history, req.message, req.attachments, system_prompt)

    # Create LLM client
    model_config = AVAILABLE_MODELS[model]
    max_tokens = model_config["max_tokens"]

    llm = ChatOpenAI(
        model=model,
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
        temperature=0.7,
        max_tokens=max_tokens,
        streaming=True,
    )

    async def stream_response():
        assistant_text = ""

        try:
            async for chunk in llm.astream(lc_messages):
                if chunk.content:
                    text = chunk.content
                    assistant_text += text
                    yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
        except Exception as e:
            error_msg = str(e)
            yield f"data: {json.dumps({'type': 'error', 'text': error_msg})}\n\n"

        # Save assistant message
        assistant_msg = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": assistant_text,
            "timestamp": datetime.now().isoformat(),
        }
        conv["messages"].append(assistant_msg)

        yield f"data: {json.dumps({'type': 'done', 'message_id': assistant_msg['id']})}\n\n"

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# --- Serve Frontend Static Files ---
frontend_dir = Path(__file__).parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=False)
