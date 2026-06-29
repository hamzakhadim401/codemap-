_connection = None


def connect_db(url="sqlite:///app.db"):
    global _connection
    _connection = {"url": url, "connected": True}
    return _connection


def query(sql, params=None):
    if not _connection:
        connect_db()
    return {"rows": [], "sql": sql}


def close_db():
    global _connection
    _connection = None
