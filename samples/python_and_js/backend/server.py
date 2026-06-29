from backend.db import connect_db, close_db
from backend.auth import verify_token


def start_server(host="localhost", port=8000):
    conn = connect_db()
    print(f"Server started on {host}:{port}")
    return conn


def shutdown(conn):
    close_db()
    print("Server stopped")
