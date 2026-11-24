import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, field_validator

from backend.analytics import compute_analytics
from backend.database import BASE_DIR, UPLOADS_DIR, get_connection, init_db

app = FastAPI(title="Pso-App", version="0.1.0")

STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

init_db()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


class CheckinPayload(BaseModel):
    date: str = Field(..., description="YYYY-MM-DD")
    skin_score: int = Field(..., ge=1, le=10)
    stress_level: int = Field(..., ge=1, le=10)
    sleep_quality: int = Field(..., ge=1, le=10)
    triggers: list[str] = Field(default_factory=list)
    note: str = Field(default="", max_length=2000)

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("Дата должна быть в формате YYYY-MM-DD") from exc
        return v


def _row_to_checkin(row) -> dict:
    triggers = []
    try:
        triggers = json.loads(row["triggers"])
    except (json.JSONDecodeError, TypeError):
        triggers = []
    return {
        "id": row["id"],
        "date": row["date"],
        "skin_score": row["skin_score"],
        "stress_level": row["stress_level"],
        "sleep_quality": row["sleep_quality"],
        "triggers": triggers,
        "note": row["note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_photo(row) -> dict:
    return {
        "id": row["id"],
        "date": row["date"],
        "skin_zone": row["skin_zone"],
        "file_path": row["file_path"],
        "original_name": row["original_name"],
        "note": row["note"],
        "created_at": row["created_at"],
    }


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/checkins")
def list_checkins(days: Optional[int] = Query(default=None, ge=1, le=365)):
    with get_connection() as conn:
        if days is not None:
            cutoff = (date.today() - timedelta(days=days - 1)).isoformat()
            rows = conn.execute(
                "SELECT * FROM checkins WHERE date >= ? ORDER BY date DESC",
                (cutoff,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM checkins ORDER BY date DESC"
            ).fetchall()
    return {"items": [_row_to_checkin(r) for r in rows]}


@app.get("/api/checkins/by-date/{date_str}")
def get_checkin_by_date(date_str: str):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM checkins WHERE date = ?", (date_str,)
        ).fetchone()
    if not row:
        return {"item": None}
    return {"item": _row_to_checkin(row)}


@app.post("/api/checkins")
def upsert_checkin(payload: CheckinPayload):
    now = datetime.now(timezone.utc).isoformat()
    cleaned_triggers = []
    seen = set()
    for t in payload.triggers:
        item = t.strip()
        if item and item not in seen:
            seen.add(item)
            cleaned_triggers.append(item)

    triggers_json = json.dumps(cleaned_triggers, ensure_ascii=False)

    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id FROM checkins WHERE date = ?", (payload.date,)
        ).fetchone()

        if existing:
            conn.execute(
                """
                UPDATE checkins
                SET skin_score = ?, stress_level = ?, sleep_quality = ?,
                    triggers = ?, note = ?, updated_at = ?
                WHERE date = ?
                """,
                (
                    payload.skin_score,
                    payload.stress_level,
                    payload.sleep_quality,
                    triggers_json,
                    payload.note.strip(),
                    now,
                    payload.date,
                ),
            )
            row_id = existing["id"]
            action = "updated"
        else:
            cursor = conn.execute(
                """
                INSERT INTO checkins (
                    date, skin_score, stress_level, sleep_quality,
                    triggers, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.date,
                    payload.skin_score,
                    payload.stress_level,
                    payload.sleep_quality,
                    triggers_json,
                    payload.note.strip(),
                    now,
                    now,
                ),
            )
            row_id = cursor.lastrowid
            action = "created"

        conn.commit()
        row = conn.execute(
            "SELECT * FROM checkins WHERE id = ?", (row_id,)
        ).fetchone()

    return {"action": action, "item": _row_to_checkin(row)}


@app.delete("/api/checkins/{checkin_id}")
def delete_checkin(checkin_id: int):
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id FROM checkins WHERE id = ?", (checkin_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        conn.execute("DELETE FROM checkins WHERE id = ?", (checkin_id,))
        conn.commit()
    return {"deleted": True, "id": checkin_id}


@app.get("/api/photos")
def list_photos(zone: Optional[str] = Query(default=None)):
    with get_connection() as conn:
        if zone and zone != "Все":
            rows = conn.execute(
                "SELECT * FROM photos WHERE skin_zone = ? ORDER BY date DESC, id DESC",
                (zone,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM photos ORDER BY date DESC, id DESC"
            ).fetchall()
    return {"items": [_row_to_photo(r) for r in rows]}


@app.post("/api/photos")
async def upload_photo(
    photo_date: str = Form(..., alias="date"),
    skin_zone: str = Form(...),
    note: str = Form(default=""),
    file: UploadFile = File(...),
):
    try:
        datetime.strptime(photo_date, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Дата должна быть в формате YYYY-MM-DD"
        ) from exc

    zone_clean = skin_zone.strip()
    if not zone_clean:
        raise HTTPException(status_code=400, detail="Укажите зону кожи")

    original_name = file.filename or "photo.jpg"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        if file.content_type and file.content_type.startswith("image/"):
            ext = ".jpg"
        else:
            raise HTTPException(
                status_code=400,
                detail="Поддерживаются только изображения (JPG, PNG, WEBP, GIF)",
            )

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Файл пустой")
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=400, detail="Размер файла не должен превышать 10 МБ"
        )

    filename = f"{photo_date}_{uuid.uuid4().hex[:10]}{ext}"
    dest_path = UPLOADS_DIR / filename
    dest_path.write_bytes(content)

    rel_url = f"/uploads/{filename}"
    now = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO photos (date, skin_zone, file_path, original_name, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (photo_date, zone_clean, rel_url, original_name, note.strip(), now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM photos WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()

    return {"item": _row_to_photo(row)}


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM photos WHERE id = ?", (photo_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Фото не найдено")

        file_rel = row["file_path"]
        conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
        conn.commit()

    filename = Path(file_rel).name
    target = UPLOADS_DIR / filename
    if target.exists() and target.is_file():
        target.unlink()

    return {"deleted": True, "id": photo_id}


@app.get("/api/analytics")
def get_analytics():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM checkins ORDER BY date ASC"
        ).fetchall()
    data = [_row_to_checkin(r) for r in rows]
    return compute_analytics(data)


@app.post("/api/demo-seed")
def seed_demo_data():
    """Добавляет 14 дней демонстрационных чек-инов (не перезаписывая существующие даты)."""
    today = date.today()
    now = datetime.now(timezone.utc).isoformat()
    sample_pattern = [
        (7, 4, 8, ["Сухой воздух"], "Спокойный день, кожа без новых высыпаний."),
        (7, 3, 8, [], "Хороший сон и увлажнение кремом."),
        (6, 6, 6, ["Сахар / сладкое", "Кофеин"], "Немного потянуло кожу на локтях вечером."),
        (5, 8, 5, ["Сахар / сладкое", "Недосып", "Сухой воздух"], "Стресс на работе, усилился зуд."),
        (4, 8, 5, ["Алкоголь", "Недосып"], "Покраснение стало заметнее."),
        (5, 6, 7, ["Молочное"], "Начал(а) чаще наносить эмолент."),
        (6, 5, 7, [], "Стало спокойнее, шелушение меньше."),
        (7, 4, 8, [], "Заметное улучшение после спокойных выходных."),
        (6, 7, 6, ["Перепад погоды", "Кофеин"], "Резкое похолодание, кожа суше обычного."),
        (5, 7, 5, ["Перепад погоды", "Острое / копчёное", "Недосып"], "Лёгкое обострение на кистях."),
        (6, 5, 7, ["Сухой воздух"], "Включил(а) увлажнитель воздуха."),
        (7, 4, 8, [], "Кожа восстанавливается."),
        (8, 3, 9, [], "Отличное самочувствие, минимум покраснений."),
        (7, 5, 7, ["Сахар / сладкое"], "Небольшая сухость утром."),
    ]

    inserted = 0
    with get_connection() as conn:
        for idx, (skin, stress, sleep, trigs, note) in enumerate(sample_pattern):
            d = (today - timedelta(days=13 - idx)).isoformat()
            existing = conn.execute(
                "SELECT id FROM checkins WHERE date = ?", (d,)
            ).fetchone()
            if existing:
                continue
            conn.execute(
                """
                INSERT INTO checkins (
                    date, skin_score, stress_level, sleep_quality,
                    triggers, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    d,
                    skin,
                    stress,
                    sleep,
                    json.dumps(trigs, ensure_ascii=False),
                    note,
                    now,
                    now,
                ),
            )
            inserted += 1
        conn.commit()

    return {"inserted": inserted}
