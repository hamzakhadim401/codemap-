import hashlib
from backend.db import query


def verify_token(token):
    rows = query("SELECT user_id FROM sessions WHERE token = ?", [token])
    return bool(rows["rows"])


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()
