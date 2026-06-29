"""Domain models for the sample app."""
from app import db


class User:
    def __init__(self, username, password_hash, email):
        self.username = username
        self.password_hash = password_hash
        self.email = email

    def save(self):
        return db.insert("users", self.__dict__)

    @staticmethod
    def find_by_username(username):
        return db.find_one("users", username=username)


class Post:
    def __init__(self, author_id, title, body):
        self.author_id = author_id
        self.title = title
        self.body = body

    def save(self):
        return db.insert("posts", self.__dict__)

    @staticmethod
    def all_by_author(author_id):
        return db.query("posts", author_id=author_id)
