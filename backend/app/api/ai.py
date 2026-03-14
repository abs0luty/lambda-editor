from __future__ import annotations
import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.document import Document
from app.models.ai_chat import AIChatMessage
from app.api.auth import get_current_user
from app.api.projects import _require_project
from app.database import get_db
from app.services import ai_service

router = APIRouter(prefix="/ai", tags=["ai"])


class GenerateRequest(BaseModel):
    prompt: str
    document_context: Optional[str] = ""
    project_id: Optional[str] = None
    doc_id: Optional[str] = None
    action_id: Optional[str] = None


class RewriteRequest(BaseModel):
    text: str
    style: str  # academic | simplify | expand | continue | summarize | translate:{lang} | restructure
    document_context: Optional[str] = ""
    project_id: Optional[str] = None
    doc_id: Optional[str] = None
    action_id: Optional[str] = None


class FixLatexRequest(BaseModel):
    code: str
    error_log: str


class EquationRequest(BaseModel):
    description: str


class ConvertRequest(BaseModel):
    plain_text: str


class ExplainErrorRequest(BaseModel):
    error_log: str


class SuggestChangesRequest(BaseModel):
    instruction: str
    document_content: str
    variation_request: Optional[str] = ""
    project_id: Optional[str] = None
    doc_id: Optional[str] = None
    action_id: Optional[str] = None


class TranslateDiffRequest(BaseModel):
    language: str
    document_content: str
    variation_request: Optional[str] = ""
    project_id: Optional[str] = None
    doc_id: Optional[str] = None
    action_id: Optional[str] = None


class RewriteDiffRequest(BaseModel):
    text: str = ""
    style: str
    document_content: str
    variation_request: Optional[str] = ""
    project_id: Optional[str] = None
    doc_id: Optional[str] = None
    action_id: Optional[str] = None


class LocationContext(BaseModel):
    line: int
    text: str = ""
    beforeText: str = ""
    afterText: str = ""


class EquationDiffRequest(BaseModel):
    description: str
    document_content: str
    location: Optional[LocationContext] = None
    variation_request: Optional[str] = ""
    project_id: Optional[str] = None
    doc_id: Optional[str] = None
    action_id: Optional[str] = None


class ChatHistoryMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    action_type: Optional[str] = None
    action_prompt: Optional[str] = None
    quotes: Optional[list[dict]] = None
    diff: Optional[dict] = None
    retry_action: Optional[dict] = None
    accepted: Optional[list[str]] = None
    rejected: Optional[list[str]] = None
    from_user: Optional[str] = None
    created_at: Optional[str] = None


class ReviewStateUpdateRequest(BaseModel):
    accepted: list[str] = []
    rejected: list[str] = []


async def _require_document_access(project_id: str, doc_id: str, user_id: str, db: AsyncSession):
    await _require_project(project_id, user_id, db)
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    return result.scalar_one_or_none()


def _loads(payload: Optional[str], fallback):
    if not payload:
        return fallback
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return fallback


async def _persist_assistant_message(
    db: AsyncSession,
    user_id: str,
    project_id: Optional[str],
    doc_id: Optional[str],
    message_id: Optional[str],
    *,
    content: str = "",
    diff: Optional[dict] = None,
    retry_action: Optional[dict] = None,
):
    if not project_id or not doc_id or not message_id:
        return

    doc = await _require_document_access(project_id, doc_id, user_id, db)
    if not doc:
        return

    existing = await db.get(AIChatMessage, message_id)
    if existing:
        return

    db.add(AIChatMessage(
        id=message_id,
        document_id=doc_id,
        user_id=user_id,
        role="assistant",
        content=content,
        diff_json=json.dumps(diff) if diff is not None else None,
        retry_action_json=json.dumps(retry_action) if retry_action is not None else None,
    ))
    await db.commit()


def _sse(generator, *, on_complete=None):
    async def generate():
        collected = []
        async for chunk in generator:
            collected.append(chunk)
            yield f"data: {chunk}\n\n"
        if on_complete is not None:
            await on_complete("".join(collected))
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/generate")
async def generate(
    req: GenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return _sse(
        ai_service.generate_text(req.prompt, req.document_context or ""),
        on_complete=lambda content: _persist_assistant_message(
            db,
            current_user.id,
            req.project_id,
            req.doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            content=content,
        ),
    )


@router.post("/rewrite")
async def rewrite(
    req: RewriteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return _sse(
        ai_service.rewrite_text(req.text, req.style, req.document_context or ""),
        on_complete=lambda content: _persist_assistant_message(
            db,
            current_user.id,
            req.project_id,
            req.doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            content=content,
        ),
    )


@router.post("/fix-latex")
async def fix_latex(req: FixLatexRequest, current_user: User = Depends(get_current_user)):
    return _sse(ai_service.fix_latex(req.code, req.error_log))


@router.post("/equation")
async def equation(req: EquationRequest, current_user: User = Depends(get_current_user)):
    return _sse(ai_service.generate_equation(req.description))


@router.post("/convert")
async def convert(req: ConvertRequest, current_user: User = Depends(get_current_user)):
    return _sse(ai_service.convert_to_latex(req.plain_text))


@router.post("/explain-error")
async def explain_error(req: ExplainErrorRequest, current_user: User = Depends(get_current_user)):
    return _sse(ai_service.explain_error(req.error_log))


@router.post("/suggest-changes")
async def suggest_changes(
    req: SuggestChangesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a structured JSON diff: explanation + list of hunks with old_text/new_text."""
    result = await ai_service.suggest_changes(req.instruction, req.document_content, req.variation_request or "")
    await _persist_assistant_message(
        db,
        current_user.id,
        req.project_id,
        req.doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        diff=result,
        retry_action={"type": "suggest", "instruction": req.instruction},
    )
    return result


@router.post("/rewrite-diff")
async def rewrite_diff(
    req: RewriteDiffRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await ai_service.rewrite_diff(req.text, req.style, req.document_content, req.variation_request or "")
    await _persist_assistant_message(
        db,
        current_user.id,
        req.project_id,
        req.doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        diff=result,
        retry_action={"type": req.style, "text": req.text},
    )
    return result


@router.post("/translate-diff")
async def translate_diff(
    req: TranslateDiffRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await ai_service.translate_diff(req.language, req.document_content, req.variation_request or "")
    await _persist_assistant_message(
        db,
        current_user.id,
        req.project_id,
        req.doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        diff=result,
        retry_action={"type": "translate", "language": req.language},
    )
    return result


@router.post("/equation-diff")
async def equation_diff(
    req: EquationDiffRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await ai_service.equation_diff(
        req.description,
        req.document_content,
        req.location.model_dump() if req.location else None,
        req.variation_request or "",
    )
    await _persist_assistant_message(
        db,
        current_user.id,
        req.project_id,
        req.doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        diff=result,
        retry_action={
            "type": "equation",
            "description": req.description,
            "location": req.location.model_dump() if req.location else None,
        },
    )
    return result


@router.get("/history/{project_id}/{doc_id}", response_model=list[ChatHistoryMessageResponse])
async def get_history(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _require_document_access(project_id, doc_id, current_user.id, db)
    if not doc:
        return []

    result = await db.execute(
        select(AIChatMessage, User.username)
        .join(User, AIChatMessage.user_id == User.id)
        .where(AIChatMessage.document_id == doc_id)
        .order_by(AIChatMessage.created_at.asc())
    )
    rows = result.all()
    return [
        ChatHistoryMessageResponse(
            id=message.id,
            role=message.role,
            content=message.content,
            action_type=message.action_type,
            action_prompt=message.action_prompt,
            quotes=_loads(message.quotes_json, None),
            diff=_loads(message.diff_json, None),
            retry_action=_loads(message.retry_action_json, None),
            accepted=_loads(message.accepted_json, []),
            rejected=_loads(message.rejected_json, []),
            from_user=username if message.role == "user" else None,
            created_at=message.created_at.isoformat() if message.created_at else None,
        )
        for message, username in rows
    ]


@router.patch("/history/{project_id}/{doc_id}/{message_id}/review")
async def update_review_state(
    project_id: str,
    doc_id: str,
    message_id: str,
    req: ReviewStateUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    result = await db.execute(
        select(AIChatMessage).where(
            AIChatMessage.id == message_id,
            AIChatMessage.document_id == doc_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return {"ok": False}

    message.accepted_json = json.dumps(req.accepted)
    message.rejected_json = json.dumps(req.rejected)
    await db.commit()
    return {"ok": True}
