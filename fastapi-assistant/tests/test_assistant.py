from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_order_tracking_uses_secure_account_page():
    response = client.post("/assistant/chat", json={"message": "Where is my order?"})
    assert response.status_code == 200
    data = response.json()
    assert data["intent"] == "order_tracking"
    assert "Shopify customer account" in data["reply"]

def test_message_length_is_limited():
    response = client.post("/assistant/chat", json={"message": "x" * 501})
    assert response.status_code == 422

def test_empty_message_is_rejected():
    response = client.post("/assistant/chat", json={"message": ""})
    assert response.status_code == 422
