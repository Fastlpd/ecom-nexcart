"""Nexcartia Assist API entry point."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.assistant import router as assistant_router

app = FastAPI(title="Nexcartia Assist API", description="Public FAQ assistant for the Nexcartia Shopify storefront.", version="1.0.0")
_origins = os.getenv("STORE_ORIGINS", os.getenv("STORE_ORIGIN", "https://nexcartia.com"))
allowed_origins = [origin.strip().rstrip("/") for origin in _origins.split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type"])

@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "nexcartia-assist"}

app.include_router(assistant_router)
