"""Route handlers -- the layer where everything else in the app converges."""
from app import auth
from app.models import Post
from app.utils import format_date, slugify, truncate


def handle_register(req):
    return auth.register(req["username"], req["password"], req["email"])


def handle_login(req):
    token = auth.login(req["username"], req["password"])
    if not token:
        return {"error": "invalid credentials"}
    return {"token": token}


def handle_create_post(req, token):
    user = auth.current_user(token)
    if not user:
        return {"error": "not authenticated"}
    post = Post(user["id"], req["title"], req["body"])
    saved = post.save()
    return render_post(saved)


def handle_list_posts(author_id):
    posts = Post.all_by_author(author_id)
    return [render_post(p) for p in posts]


def render_post(post):
    return {
        "title": post["title"],
        "slug": slugify(post["title"]),
        "preview": truncate(post["body"]),
        "date": format_date(),
    }
