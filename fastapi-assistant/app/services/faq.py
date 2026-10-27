"""Safe public FAQ responses for Nexcartia."""
from dataclasses import dataclass

@dataclass(frozen=True)
class FAQResult:
    intent: str
    reply: str

def answer_question(message: str) -> FAQResult:
    text = " ".join(message.lower().strip().split())
    if any(word in text for word in ("track", "tracking", "where is my order", "order status")):
        return FAQResult("order_tracking", "Check your order status securely through your Shopify customer account. Never send payment details or passwords in chat.")
    if any(word in text for word in ("return", "refund", "exchange", "cancel")):
        return FAQResult("returns", "Please review the Nexcartia Refund and Returns Policy for eligibility and next steps, or contact our support team.")
    if any(word in text for word in ("shipping", "delivery", "arrive", "dispatch")):
        return FAQResult("shipping", "Delivery times depend on destination and item. Please review the Nexcartia Shipping Policy for details.")
    if any(word in text for word in ("pay", "payment", "card", "paystack")):
        return FAQResult("payments", "Use the payment methods shown at checkout. Never share card numbers, PINs, passwords, or one-time codes in chat.")
    if any(word in text for word in ("human", "agent", "support", "contact", "person")):
        return FAQResult("human_support", "Please reach the Nexcartia team through the official Contact page.")
    if any(word in text for word in ("hi", "hello", "hey", "good morning", "good afternoon")):
        return FAQResult("greeting", "Hi! Welcome to Nexcartia. I can help with shipping, returns, payments, products, and order tracking.")
    if any(word in text for word in ("product", "recommend", "collection", "looking for", "item")):
        return FAQResult("products", "Browse Nexcartia collections for useful everyday, pet, travel, and smart-accessory products. Tell me what problem you want to solve and I can guide you.")
    return FAQResult("general", "I can help with shipping, returns, payments, product discovery, and order tracking. For account-specific help, use the official Contact page.")
