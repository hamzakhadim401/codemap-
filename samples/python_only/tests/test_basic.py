"""
Basic exercises for runtime tracing demo.
Drives the real call chains so tracer captures actual call_count data.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.db import connect_db, insert, query, find_one
from app.auth import hash_password, register, login, create_session, current_user, logout
from app.models import User, Post
from app.utils import format_date, slugify, truncate


def test_database():
    db = connect_db()
    assert db is not None
    insert("users", {"username": "alice", "password_hash": "abc", "email": "alice@test.com"})
    insert("users", {"username": "bob",   "password_hash": "xyz", "email": "bob@test.com"})
    rows = query("users")
    assert len(rows) == 2
    alice = find_one("users", username="alice")
    assert alice is not None


def test_auth():
    register("carol", "secret123", "carol@test.com")
    register("dave",  "hunter2",  "dave@test.com")
    # login calls hash_password + User.find_by_username + create_session
    token = login("carol", "secret123")
    assert token is not None
    user = current_user(token)
    assert user is not None
    logout(token)
    assert current_user(token) is None


def test_models():
    u = User("eve", hash_password("pass"), "eve@test.com")
    u.save()                               # -> db.insert
    found = User.find_by_username("eve")   # -> db.find_one -> db.query
    assert found is not None

    p = Post(found["id"], "Hello World", "First post content here.")
    p.save()                               # -> db.insert
    posts = Post.all_by_author(found["id"])  # -> db.query
    assert len(posts) == 1


def test_utils():
    assert format_date() is not None
    assert slugify("Hello World") == "hello-world"
    long_text = "x" * 200
    assert len(truncate(long_text)) <= 123   # 120 + "..."


if __name__ == "__main__":
    test_database()
    test_auth()
    test_models()
    test_utils()
    print("All tests passed.")
