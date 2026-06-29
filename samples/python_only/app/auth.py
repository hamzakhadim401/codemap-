"""Authentication logic -- the kind of module a new hire is always nervous to touch."""
import hashlib

from app.models import User

_SESSIONS = {}


def hash_password(raw_password):
    return hashlib.sha256(raw_password.encode()).hexdigest()


def register(username, raw_password, email):
    user = User(username, hash_password(raw_password), email)
    return user.save()


def login(username, raw_password):
    user = User.find_by_username(username)
    if not user:
        return None
    if user["password_hash"] != hash_password(raw_password):
        return None
    token = create_session(user)
    return token


def create_session(user):
    token = hashlib.sha256(f"{user['username']}-session".encode()).hexdigest()[:16]
    _SESSIONS[token] = user
    return token


def current_user(token):
    return _SESSIONS.get(token)


def logout(token):
    _SESSIONS.pop(token, None)
