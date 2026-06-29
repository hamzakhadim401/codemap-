"""Small helpers reused across the app -- the kind of file that quietly
ends up with the highest blast radius in any real codebase."""
import datetime


def format_date(dt=None):
    dt = dt or datetime.datetime.utcnow()
    return dt.strftime("%Y-%m-%d")


def slugify(text):
    return text.strip().lower().replace(" ", "-")


def truncate(text, length=120):
    return text if len(text) <= length else text[:length].rstrip() + "..."
