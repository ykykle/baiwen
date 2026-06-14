"""
AI Chat Assistant - Backend Server
FastAPI + LangChain ChatOpenAI integration with DeepSeek models.
"""
import os
import sys
import io
import json
import time
import base64
import uuid
import logging
import traceback
import mimetypes
from datetime import datetime
from typing import Optional
from pathlib import Path
import pdfplumber
import pytesseract
from PIL import Image
import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stderr,
)
logger = logging.getLogger("baiwen")

load_dotenv(Path(__file__).resolve().parent / ".env")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# 同时兼容 DEEPSEEK_API_KEY 和 ANTHROPIC_API_KEY 环境变量名
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", os.getenv("ANTHROPIC_API_KEY", ""))
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

# 配置 Tesseract OCR 路径（pytesseract 默认查 PATH，Windows 常需手动指定）
_TESSERACT_DIR = os.getenv("TESSERACT_DIR", r"D:\Program Files\Tesseract-OCR")
_TESSERACT_EXE = os.path.join(_TESSERACT_DIR, "tesseract.exe")
if os.path.exists(_TESSERACT_EXE):
    pytesseract.pytesseract.tesseract_cmd = _TESSERACT_EXE
    logger.info("Tesseract OCR: %s", _TESSERACT_EXE)
else:
    logger.warning("Tesseract OCR 未找到: %s（图片 OCR 将不可用）", _TESSERACT_EXE)

logger.info(".env path: %s", (Path(__file__).resolve().parent / ".env"))
logger.info("API Key loaded: %s (length: %d)", bool(DEEPSEEK_API_KEY), len(DEEPSEEK_API_KEY))
logger.info("API Base URL: %s", DEEPSEEK_BASE_URL)

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


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every HTTP request with method, path, status, and latency."""
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s → %d (%.1fms)",
        request.method, request.url.path, response.status_code, elapsed,
    )
    return response


# ---------------------------------------------------------------------------
# Persistent Conversation Store (JSON file)
# ---------------------------------------------------------------------------
DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_FILE = DATA_DIR / "conversations.json"


class ConversationStore:
    """Dict-like wrapper that persists all conversations to a JSON file.

    Every mutation (create, delete, and explicit ``save()`` calls after nested
    mutations like message append / rename) writes the full store to disk via
    an atomic temp-file + replace strategy.
    """

    def __init__(self, path: Path):
        self._path = path
        self._data: dict = {}
        self._load()

    # -- public dict interface (used by existing route code) ------------------

    def values(self):
        return self._data.values()

    def __contains__(self, key):
        return key in self._data

    def __getitem__(self, key):
        return self._data[key]

    def __setitem__(self, key, value):
        self._data[key] = value
        self._save()

    def __delitem__(self, key):
        del self._data[key]
        self._save()

    # -- explicit save (for nested mutations that bypass __setitem__) ---------

    def save(self):
        """Persist after mutating a nested field (e.g. ``conv[\"title\"] = …``)."""
        self._save()

    # -- internal helpers ----------------------------------------------------

    def _load(self):
        if self._path.exists():
            try:
                self._data = json.loads(self._path.read_text(encoding="utf-8"))
                logger.info("Loaded %d conversations from %s", len(self._data), self._path)
            except (json.JSONDecodeError, OSError):
                logger.error("Failed to load conversations:\n%s", traceback.format_exc())
                self._data = {}
        else:
            logger.info("No saved conversations file, starting empty: %s", self._path)

    def _save(self):
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".json.tmp")
            tmp.write_text(
                json.dumps(self._data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(tmp, self._path)  # atomic on same filesystem
        except OSError:
            logger.error("Failed to save conversations:\n%s", traceback.format_exc())


conversations = ConversationStore(DATA_FILE)


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

    DeepSeek only supports text content blocks (no image_url), so all
    attachments contribute their extracted ``content`` text appended to
    the user message.
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

    # Build the user message — append attachment text content
    text = new_message
    if attachments:
        parts = []
        for a in attachments:
            name = a.get("name", "unknown")
            content = a.get("content", "")
            a_type = a.get("type", "")
            if content:
                if a_type.startswith("image/"):
                    parts.append(f"[图片: {name}]\n图片内文字：\n{content}")
                else:
                    parts.append(f"[文件: {name}]\n{content}")
            else:
                parts.append(f"[文件: {name} (无可提取文字)]")
        if parts:
            text += "\n\n" + "\n\n".join(parts)

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
    logger.info("CREATE conv=%s", conv_id)
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
        logger.info("DELETE conv=%s", conv_id[:8])
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Conversation not found")


@app.patch("/api/conversations/{conv_id}")
async def rename_conversation(conv_id: str, req: RenameRequest):
    conv = get_or_create_conv(conv_id)
    conv["title"] = req.title
    conversations.save()
    return {"id": conv_id, "title": req.title}


@app.put("/api/conversations/{conv_id}/settings")
async def update_settings(conv_id: str, model: str = Form(None), mode: str = Form(None)):
    conv = get_or_create_conv(conv_id)
    if model and model in AVAILABLE_MODELS:
        conv["model"] = model
    if mode and mode in ("quick", "deep"):
        conv["mode"] = mode
    if model or mode:
        conversations.save()
    return {"model": conv["model"], "mode": conv["mode"]}


# --- File Upload ---
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    logger.info("UPLOAD %s (type=%s)", file.filename, file.content_type or "unknown")
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
            # Extract image dimensions + OCR text (best-effort)
            try:
                img = Image.open(io.BytesIO(content))
                w, h = img.size
                size_mb = len(content) / (1024 * 1024)
                meta = f"[图片: {file.filename} | 类型: {mime_type} | 尺寸: {w}x{h} | 大小: {size_mb:.1f}MB]"
                try:
                    ocr_text = pytesseract.image_to_string(img, lang="chi_sim+eng")
                    if ocr_text.strip():
                        result["content"] = f"{meta}\n图片内文字：\n{ocr_text.strip()[:5000]}"
                    else:
                        result["content"] = f"{meta}\n(图中无可识别文字)"
                except Exception:
                    logger.warning("Tesseract OCR 未安装 — 图片仅保留元信息，无法提取图中文字。安装: https://github.com/UB-Mannheim/tesseract/wiki")
                    result["content"] = f"{meta}\n(OCR 未安装，请将图片内容以文字形式描述给我)"
            except Exception:
                size_mb = len(content) / (1024 * 1024)
                result["content"] = f"[图片: {file.filename} | 类型: {mime_type} | 大小: {size_mb:.1f}MB]"
        elif mime_type == "application/pdf":
            # Extract text from PDF using pdfplumber
            try:
                text_parts = []
                with pdfplumber.open(io.BytesIO(content)) as pdf:
                    for page in pdf.pages:
                        page_text = page.extract_text()
                        if page_text:
                            text_parts.append(page_text)
                result["content"] = "\n".join(text_parts)[:10000] or "[PDF 无可提取文字]"
            except Exception:
                logger.warning("PDF extraction failed for %s:\n%s", file.filename, traceback.format_exc())
                result["content"] = "[PDF 解析失败]"
        elif mime_type in ALLOWED_TEXT_TYPES or mime_type.startswith("text/"):
            try:
                result["content"] = content.decode("utf-8")[:10000]
            except UnicodeDecodeError:
                result["content"] = "[二进制文件，无法预览]"

        return result
    except Exception as e:
        logger.error("Upload failed for %s:\n%s", file.filename, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# --- Chat (Streaming) ---
@app.post("/api/chat/{conv_id}")
async def chat(conv_id: str, req: ChatRequest):
    conv = get_or_create_conv(conv_id)
    model = req.model or conv.get("model", DEFAULT_MODEL)
    mode = req.mode or conv.get("mode", "quick")

    att_count = len(req.attachments) if req.attachments else 0
    logger.info("CHAT conv=%s model=%s mode=%s msg_len=%d attachments=%d",
                conv_id[:8], model, mode, len(req.message), att_count)

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
    conversations.save()

    # Auto-title
    if len(conv["messages"]) == 1 and conv["title"] == "新对话":
        conv["title"] = req.message[:30] + ("..." if len(req.message) > 30 else "")
        conversations.save()

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
            logger.error("LLM streaming error (conv=%s model=%s):\n%s",
                         conv_id[:8], model, traceback.format_exc())
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
        conversations.save()

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
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
