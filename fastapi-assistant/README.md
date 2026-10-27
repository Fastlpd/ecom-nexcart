# Nexcartia Assist — FastAPI

A public FAQ assistant for the Nexcartia Shopify storefront. It does not access Shopify Admin APIs or return private order data.

## Endpoints
- `GET /health` — health check
- `POST /assistant/chat` — public FAQ response; body: `{"message":"Where is my order?"}`

## Local development
From this directory:

```bash
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Set `STORE_ORIGINS` to a comma-separated list of trusted storefront origins. The default is `https://nexcartia.com`.

## Tests
Run `pytest -q` from this directory.

## Render
This project is intentionally nested under `fastapi-assistant/` so the repository root and existing Render configuration remain untouched. To deploy this folder as a separate Render web service, set Root Directory to `fastapi-assistant`, Build Command to `pip install -r requirements.txt`, and Start Command to `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `STORE_ORIGINS` in Render environment settings. Do not change the existing service's root directory or start command unless that service is intended to run this assistant.
