"""Entry point -- this is normally the file a new hire reads first and
understands least, because it just calls into everything else."""
from app.routes import handle_register, handle_login, handle_create_post, handle_list_posts


def main():
    handle_register({"username": "ada", "password": "secret", "email": "ada@example.com"})
    login_result = handle_login({"username": "ada", "password": "secret"})
    token = login_result["token"]
    handle_create_post({"title": "Hello world", "body": "My first post on this platform."}, token)
    print(handle_list_posts(1))


if __name__ == "__main__":
    main()
