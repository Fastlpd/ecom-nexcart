"""Public chat endpoint for Nexcartia Assist."""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.services.faq import answer_question

router = APIRouter(prefix="/assistant", tags=["assistant"])

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)

class ChatResponse(BaseModel):
    intent: str
    reply: str

@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    result = answer_question(payload.message)
    return ChatResponse(intent=result.intent, reply=result.reply)
