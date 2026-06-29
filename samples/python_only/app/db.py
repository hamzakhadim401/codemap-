"""Lightweight in-memory data layer standing in for a real database."""

_TABLES = {"users": [], "posts": []}


def connect_db():
    return _TABLES


def insert(table, record):
    db = connect_db()
    record["id"] = len(db[table]) + 1
    db[table].append(record)
    return record


def query(table, **filters):
    db = connect_db()
    rows = db[table]
    for key, value in filters.items():
        rows = [r for r in rows if r.get(key) == value]
    return rows


def find_one(table, **filters):
    rows = query(table, **filters)
    return rows[0] if rows else None
