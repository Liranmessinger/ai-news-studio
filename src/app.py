import logging
import os
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, jsonify, render_template, request, send_from_directory

from news_image_pipeline import (
    build_image_prompt,
    extractive_summary,
    generate_image,
    llm_summary,
    load_config,
    scan_feed,
)

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.json"
DB_PATH = BASE_DIR / "news.db"

logger = logging.getLogger("ai_news")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS news_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_name TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                category TEXT NOT NULL,
                link TEXT NOT NULL,
                published_at TEXT,
                created_at TEXT NOT NULL,
                style_name TEXT NOT NULL,
                image_path TEXT,
                prompt_path TEXT,
                prompt_text TEXT NOT NULL,
                UNIQUE(link, style_name)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_created_at ON news_items(created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_style ON news_items(style_name)")


def news_exists(link: str, style_name: str, source_name: str, title: str, published_at: str | None) -> bool:
    with sqlite3.connect(DB_PATH) as conn:
        if link:
            row = conn.execute(
                "SELECT 1 FROM news_items WHERE link = ? AND style_name = ? LIMIT 1",
                (link, style_name),
            ).fetchone()
            if row:
                return True

        row = conn.execute(
            """
            SELECT 1
            FROM news_items
            WHERE source_name = ? AND title = ? AND COALESCE(published_at, '') = COALESCE(?, '') AND style_name = ?
            LIMIT 1
            """,
            (source_name, title, published_at, style_name),
        ).fetchone()
        return bool(row)


def insert_news_item(item: dict[str, Any]) -> bool:
    with sqlite3.connect(DB_PATH) as conn:
        try:
            conn.execute(
                """
                INSERT INTO news_items (
                    source_name, title, summary, category, link, published_at, created_at,
                    style_name, image_path, prompt_path, prompt_text
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["source_name"],
                    item["title"],
                    item["summary"],
                    item["category"],
                    item["link"],
                    item["published_at"],
                    item["created_at"],
                    item["style_name"],
                    item["image_path"],
                    item["prompt_path"],
                    item["prompt_text"],
                ),
            )
            return True
        except sqlite3.IntegrityError:
            return False


def get_news(limit: int = 60, category: str | None = None, style: str | None = None) -> list[dict[str, Any]]:
    sql = """
        SELECT id, source_name, title, summary, category, link, published_at, created_at,
               style_name, image_path, prompt_path
        FROM news_items
    """
    where = []
    params: list[Any] = []
    if category:
        where.append("category = ?")
        params.append(category)
    if style:
        where.append("style_name = ?")
        params.append(style)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()

    return [dict(r) for r in rows]


def count_news() -> int:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT COUNT(*) FROM news_items").fetchone()
    return int(row[0]) if row else 0


def get_taxonomy() -> dict[str, list[str]]:
    with sqlite3.connect(DB_PATH) as conn:
        categories = [r[0] for r in conn.execute("SELECT DISTINCT category FROM news_items ORDER BY category").fetchall()]
        styles = [r[0] for r in conn.execute("SELECT DISTINCT style_name FROM news_items ORDER BY style_name").fetchall()]
    return {"categories": categories, "styles": styles}


def resolve_style_for_article(config: dict[str, Any], article: Any) -> str:
    source_style_map = config.get("source_style_map", {})
    if article.source_name in source_style_map:
        return source_style_map[article.source_name]
    category_style_map = config.get("category_style_map", {})
    if article.category in category_style_map:
        return category_style_map[article.category]
    return config.get("default_style", "breaking")


def run_generation_cycle() -> dict[str, int]:
    config = load_config(CONFIG_PATH)
    output_dir = BASE_DIR / config.get("output_dir", "output")
    output_dir.mkdir(parents=True, exist_ok=True)

    timeout = int(config.get("timeout_seconds", 20))
    max_items = int(config.get("max_items_per_source", 5))
    added = 0
    scanned = 0

    for source in config["sources"]:
        articles = scan_feed(source, max_items)
        scanned += len(articles)

        for article in articles:
            style_name = resolve_style_for_article(config, article)
            style_desc = config["styles"].get(style_name)
            if not style_desc:
                style_name = "breaking"
                style_desc = config["styles"][style_name]

            link = article.link or ""
            title = article.title or "ללא כותרת"
            published_at = article.published_at.isoformat() if article.published_at else None

            if news_exists(link, style_name, article.source_name, title, published_at):
                continue

            summary_mode = config["summarization"]["mode"]
            if summary_mode == "llm":
                summary = llm_summary(article, config, timeout)
            else:
                summary = extractive_summary(article)

            prompt = build_image_prompt(article, summary, style_name, style_desc)
            output_path = generate_image(prompt, article, style_name, config, output_dir, timeout)
            suffix = output_path.suffix.lower()
            rel_path = output_path.relative_to(BASE_DIR).as_posix()
            image_path = rel_path if suffix in {".png", ".jpg", ".jpeg", ".webp"} else None
            prompt_path = rel_path if suffix == ".txt" else None

            inserted = insert_news_item(
                {
                    "source_name": article.source_name,
                    "title": title,
                    "summary": summary,
                    "category": article.category,
                    "link": link,
                    "published_at": published_at,
                    "created_at": utc_now_iso(),
                    "style_name": style_name,
                    "image_path": image_path,
                    "prompt_path": prompt_path,
                    "prompt_text": prompt,
                }
            )
            if inserted:
                added += 1

    return {"scanned": scanned, "added": added}


cycle_lock = threading.Lock()


def safe_cycle() -> None:
    if not cycle_lock.acquire(blocking=False):
        logger.info("Skipping cycle because previous run is still active")
        return
    try:
        result = run_generation_cycle()
        logger.info("Cycle complete. scanned=%s added=%s", result["scanned"], result["added"])
    except Exception:
        logger.exception("Cycle failed")
    finally:
        cycle_lock.release()


def should_run_scheduler() -> bool:
    value = os.getenv("RUN_BACKGROUND_WORKER", "1").strip().lower()
    return value in {"1", "true", "yes", "on"}


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    init_db()

    if should_run_scheduler():
        config = load_config(CONFIG_PATH)
        scheduler = BackgroundScheduler(timezone="UTC")
        scheduler.add_job(
            safe_cycle,
            "interval",
            minutes=int(config.get("scheduler_interval_minutes", 10)),
            id="news_cycle",
            max_instances=1,
        )
        scheduler.start()

        if config.get("run_first_cycle_on_start", True):
            safe_cycle()

    @app.route("/")
    def index() -> Any:
        category = request.args.get("category")
        style = request.args.get("style")
        items = get_news(limit=100, category=category, style=style)
        taxonomy = get_taxonomy()
        stats = {"total_items": count_news(), "last_update": items[0]["created_at"] if items else None}
        return render_template(
            "index.html",
            items=items,
            taxonomy=taxonomy,
            stats=stats,
            selected_category=category,
            selected_style=style,
        )

    @app.route("/api/news")
    def api_news() -> Any:
        category = request.args.get("category")
        style = request.args.get("style")
        limit = int(request.args.get("limit", "50"))
        items = get_news(limit=limit, category=category, style=style)
        return jsonify({"items": items, "count": len(items)})

    @app.route("/api/trigger", methods=["POST"])
    def trigger() -> Any:
        safe_cycle()
        return jsonify({"ok": True})

    @app.route("/files/<path:filename>")
    def files(filename: str) -> Any:
        return send_from_directory(BASE_DIR, filename)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
