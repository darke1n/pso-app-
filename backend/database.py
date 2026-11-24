import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "pso_app.db"
UPLOADS_DIR = BASE_DIR / "uploads"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS checkins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                skin_score INTEGER NOT NULL CHECK(skin_score BETWEEN 1 AND 10),
                stress_level INTEGER NOT NULL CHECK(stress_level BETWEEN 1 AND 10),
                sleep_quality INTEGER NOT NULL CHECK(sleep_quality BETWEEN 1 AND 10),
                triggers TEXT NOT NULL DEFAULT '[]',
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                skin_zone TEXT NOT NULL,
                file_path TEXT NOT NULL,
                original_name TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(date)"
        )
        conn.commit()
