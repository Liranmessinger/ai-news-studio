import html
import logging
import os
import re
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from apscheduler.schedulers.background import BackgroundScheduler
from dateutil import parser as date_parser
from flask import Flask, jsonify, render_template, request, send_from_directory

from news_image_pipeline import (
    build_image_prompt,
    extractive_summary,
    extract_article_page_image,
    generate_image,
    llm_summary,
    load_config,
    scan_feed,
)

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR))).resolve()
CONFIG_PATH = BASE_DIR / "config.json"
DB_PATH = Path(os.getenv("NEWS_DB_PATH", str(STORAGE_DIR / "news.db"))).resolve()

CATEGORY_LABELS = {
    "israel-general": "ישראל - כללי",
    
    "israel-politics": "ישראל - פוליטיקה",
    "israel-security": "ישראל - ביטחון",
    "israel-economy": "ישראל - כלכלה",
    "israel-sports": "ישראל - ספורט",
    "israel-football": "כדורגל ישראלי",
    "nba": "כדורסל - NBA",
    "world-football": "כדורגל עולמי",
    "world-general": "עולם - כללי",
    "world-politics": "עולם - פוליטיקה",
    "world-economy": "עולם - כלכלה",
    "world-tech": "עולם - טכנולוגיה",
    "science": "מדע",
    "health": "בריאות",
    "sports": "ספורט",
    "climate": "אקלים",
    "culture": "תרבות",
    "crypto": "קריפטו",
}

STYLE_LABELS = {
    "breaking": "מבזק",
    "finance": "כלכלי",
    "tech": "טכנולוגי",
    "dramatic": "דרמטי",
    "clean": "נקי",
}

logger = logging.getLogger("ai_news")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

LIVE_SPORTS_CACHE: dict[str, Any] = {"ts": None, "items": []}
LIVE_SPORTS_LOCK = threading.Lock()


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def category_label(value: str) -> str:
    return CATEGORY_LABELS.get(value, value.replace("-", " "))


def style_label(value: str) -> str:
    return STYLE_LABELS.get(value, value)


def resolve_output_dir(config: dict[str, Any]) -> Path:
    raw = str(os.getenv("OUTPUT_DIR", config.get("output_dir", "output"))).strip()
    path = Path(raw)
    if not path.is_absolute():
        path = STORAGE_DIR / path
    return path.resolve()


def to_storage_relative(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(STORAGE_DIR).as_posix()
    except Exception:
        return resolved.name


def fallback_subtitle(title: str, category: str) -> str:
    t = normalize_text(title)
    if not t:
        return "עדכון קצר יתעדכן בהמשך."

    parts = re.split(r"\s[-:|]\s", t, maxsplit=1)
    core = parts[1].strip() if len(parts) > 1 and len(parts[1].strip()) > 10 else t

    core = re.sub(r"\b(ynet|mako|rotter|reuters|bbc|calcalist|haaretz|walla)\b.*$", "", core, flags=re.IGNORECASE).strip()
    core = core.strip(" -:|")
    words = core.split()
    if len(words) > 16:
        core = " ".join(words[:16]) + "..."

    if not core:
        return "עדכון קצר יתעדכן בהמשך."
    if category.startswith("israel"):
        return f"בתמצית: {core}"
    return f"ברקע הדיווח: {core}"


def remove_summary_dup(summary: str, title: str, category: str) -> str:
    s = normalize_text(summary)
    t = normalize_text(title)
    if not s:
        return fallback_subtitle(t, category)
    if "אין תקציר זמין" in s:
        return fallback_subtitle(t, category)
    if t and summary_too_similar(s, t):
        return fallback_subtitle(t, category)
    if t and s.lower().startswith(t.lower()):
        s = s[len(t):].strip(" -:|\t")
    if t and summary_too_similar(s, t):
        return fallback_subtitle(t, category)
    if len(s) < 12:
        return fallback_subtitle(t, category)
    return s


def normalize_text(text: str) -> str:
    value = html.unescape((text or "").strip())
    value = re.sub(r"&#\d+;?", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value



def clean_summary_artifacts(summary: str, title: str, category: str) -> str:
    s = normalize_text(summary)
    if not s:
        return s

    raw = s
    s = re.sub(r"(^|[.!?]\s+)IL\b\s*[:,-]?\s*", r"\1", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip(" -:|")

    # If the source leaked "IL" in Israel items, surface the Israel flag instead.
    if category.startswith("israel") and re.search(r"\bIL\b", raw, flags=re.IGNORECASE):
        if not s.startswith("🇮🇱"):
            s = f"🇮🇱 {s}".strip()

    if "�" in s:
        return fallback_subtitle(title, category)
    return s
def normalized_for_compare(text: str) -> str:
    value = normalize_text(text).lower()
    value = re.sub(r"[^0-9a-z\u0590-\u05ff ]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def summary_too_similar(summary: str, title: str) -> bool:
    s = normalized_for_compare(summary)
    t = normalized_for_compare(title)
    if not s or not t:
        return False
    if s == t or s in t or t in s:
        return True

    s_tokens = [x for x in s.split() if len(x) > 1]
    t_tokens = [x for x in t.split() if len(x) > 1]
    if not s_tokens or not t_tokens:
        return False

    s_set = set(s_tokens)
    t_set = set(t_tokens)
    overlap = len(s_set & t_set) / max(1, len(t_set))
    return overlap >= 0.7


def emoji_for_item(category: str, title: str, summary: str) -> str:
    c = (category or "").lower()
    t = f"{title} {summary}".lower()

    if "nba" in c or "basketball" in c or any(k in t for k in ["nba", "כדורסל"]):
        return "🏀"
    if "football" in c or "soccer" in c or any(k in t for k in ["כדורגל", "ליגה", "premier league", "champions league"]):
        return "⚽"
    if "sports" in c or "ספורט" in t:
        return "⚽"
    if "economy" in c or "finance" in c or any(k in t for k in ["כלכלה", "בורסה", "שוק", "דולר", "ריבית"]):
        return "💹"
    if "tech" in c or any(k in t for k in ["טכנולוג", "ai", "בינה", "אפליקציה", "סייבר"]):
        return "💻"
    if "security" in c or "politics" in c or any(k in t for k in ["ביטחון", "מלחמה", "צבא", "מדיני", "פוליט"]):
        return "🛡️"
    if "health" in c or any(k in t for k in ["בריאות", "רפואה", "חיסון", "בית חולים"]):
        return "🩺"
    if "climate" in c or any(k in t for k in ["אקלים", "מזג אוויר", "סביבה", "התחממות"]):
        return "🌍"
    if "culture" in c or any(k in t for k in ["תרבות", "קולנוע", "מוזיקה", "תיאטרון"]):
        return "🎭"
    if "crypto" in c or any(k in t for k in ["קריפטו", "ביטקוין", "בלוקצ'יין"]):
        return "🪙"
    if c.startswith("israel"):
        return "🗞️"
    return "📰"


def looks_hebrew(text: str) -> bool:
    return bool(text and any("\u0590" <= ch <= "\u05FF" for ch in text))


def hebrew_title_from_summary(title: str, summary: str) -> str:
    t = (title or "").strip()
    if looks_hebrew(t):
        return t
    s = (summary or "").strip()
    if not looks_hebrew(s):
        return t
    cut = re.split(r"[.!?]", s)[0].strip()
    if not cut:
        return t
    return (cut[:96] + "...") if len(cut) > 96 else cut


def parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=UTC)
    try:
        dt = date_parser.parse(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except Exception:
        return datetime.min.replace(tzinfo=UTC)


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
                model_name TEXT NOT NULL DEFAULT '',
                image_path TEXT,
                prompt_path TEXT,
                prompt_text TEXT NOT NULL,
                UNIQUE(link, style_name)
            )
            """
        )
        cols = [r[1] for r in conn.execute("PRAGMA table_info(news_items)").fetchall()]
        if "model_name" not in cols:
            conn.execute("ALTER TABLE news_items ADD COLUMN model_name TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_created_at ON news_items(created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_style ON news_items(style_name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_model ON news_items(model_name)")


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
                    style_name, model_name, image_path, prompt_path, prompt_text
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    item["model_name"],
                    item["image_path"],
                    item["prompt_path"],
                    item["prompt_text"],
                ),
            )
            return True
        except sqlite3.IntegrityError:
            return False


def update_missing_image(
    link: str,
    style_name: str,
    source_name: str,
    title: str,
    published_at: str | None,
    image_url: str | None,
) -> None:
    if not image_url:
        return

    with sqlite3.connect(DB_PATH) as conn:
        if link:
            conn.execute(
                """
                UPDATE news_items
                SET image_path = ?
                WHERE link = ? AND style_name = ?
                  AND (image_path IS NULL OR image_path = '')
                """,
                (image_url, link, style_name),
            )
            return

        conn.execute(
            """
            UPDATE news_items
            SET image_path = ?
            WHERE source_name = ?
              AND title = ?
              AND COALESCE(published_at, '') = COALESCE(?, '')
              AND style_name = ?
              AND (image_path IS NULL OR image_path = '')
            """,
            (image_url, source_name, title, published_at, style_name),
        )


def get_news(
    limit: int = 100,
    category: str | None = None,
    style: str | None = None,
    hours: int | None = 24,
) -> list[dict[str, Any]]:
    sql = """
        SELECT id, source_name, title, summary, category, link, published_at, created_at,
               style_name, model_name, image_path, prompt_path
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

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()

    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=hours) if hours and hours > 0 else None

    items = []
    for r in rows:
        item = dict(r)
        item["title"] = normalize_text(item.get("title", ""))
        item["summary"] = normalize_text(item.get("summary", ""))
        item["summary"] = remove_summary_dup(item.get("summary", ""), item.get("title", ""), item.get("category", ""))
        item["summary"] = clean_summary_artifacts(
            item.get("summary", ""),
            item.get("title", ""),
            item.get("category", ""),
        )
        item["summary"] = re.sub(r"^דגל ישראל\s*", "", item.get("summary", "")).strip()
        item["title"] = hebrew_title_from_summary(item.get("title", ""), item.get("summary", ""))
        emoji = emoji_for_item(item.get("category", ""), item.get("title", ""), item.get("summary", ""))
        if item.get("summary") and not item["summary"].startswith(emoji):
            item["summary"] = f"{emoji} {item['summary']}"

        item["category_label"] = category_label(item.get("category", ""))
        item["style_label"] = style_label(item.get("style_name", ""))

        sort_dt = parse_dt(item.get("published_at") or item.get("created_at"))
        if cutoff and sort_dt < cutoff:
            continue

        item["sort_dt"] = sort_dt
        items.append(item)

    items.sort(key=lambda x: x["sort_dt"], reverse=True)
    items = items[:limit]
    for item in items:
        item.pop("sort_dt", None)
    return items


def count_news() -> int:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT COUNT(*) FROM news_items").fetchone()
    return int(row[0]) if row else 0


def get_taxonomy() -> dict[str, list[dict[str, str]]]:
    cfg = load_config(CONFIG_PATH)
    cfg_categories = [s.get("category", "") for s in cfg.get("sources", []) if s.get("category")]
    cfg_styles = list(cfg.get("styles", {}).keys())

    with sqlite3.connect(DB_PATH) as conn:
        db_categories = [r[0] for r in conn.execute("SELECT DISTINCT category FROM news_items ORDER BY category").fetchall()]
        db_styles = [r[0] for r in conn.execute("SELECT DISTINCT style_name FROM news_items ORDER BY style_name").fetchall()]

    raw_categories = sorted(set(cfg_categories + db_categories), key=lambda c: (0 if c.startswith("israel") else 1, c))
    raw_styles = sorted(set(cfg_styles + db_styles))

    categories = [{"value": c, "label": category_label(c)} for c in raw_categories]
    styles = [{"value": s, "label": style_label(s)} for s in raw_styles]
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
    output_dir = resolve_output_dir(config)
    output_dir.mkdir(parents=True, exist_ok=True)

    timeout = int(config.get("timeout_seconds", 20))
    max_items = int(config.get("max_items_per_source", 5))
    model_name = config.get("image", {}).get("model", "")
    added = 0
    scanned = 0

    priority_categories = {
        "nba": 0,
        "israel-football": 1,
        "world-football": 2,
        "israel-sports": 3,
    }
    sources = sorted(
        config["sources"],
        key=lambda s: (priority_categories.get(str(s.get("category", "")).strip(), 100), str(s.get("name", ""))),
    )

    for source in sources:
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

            source_image_url = getattr(article, "source_image_url", None) or extract_article_page_image(link, min(timeout, 8))

            summary_mode = config["summarization"]["mode"]
            if summary_mode == "llm":
                summary = llm_summary(article, config, timeout)
            else:
                summary = extractive_summary(article)

            prompt = build_image_prompt(article, summary, style_name, style_desc)
            output_path = generate_image(prompt, article, style_name, config, output_dir, timeout)
            suffix = output_path.suffix.lower()
            rel_path = to_storage_relative(output_path)
            image_path = rel_path if suffix in {".png", ".jpg", ".jpeg", ".webp"} else None
            prompt_path = rel_path if suffix == ".txt" else None
            if not image_path and source_image_url:
                image_path = source_image_url

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
                    "model_name": model_name,
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


def fetch_one_live_scores(limit: int = 20, timeout: int = 12) -> list[dict[str, Any]]:
    date_key = datetime.now().strftime("%d-%m-%Y")
    url = f"https://api.one.co.il/json/v6/live/date/{date_key}"

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
      data = client.get(url).json()

    leagues = ((data or {}).get("Data") or {}).get("Live", {}).get("Leagues", [])
    rows: list[dict[str, Any]] = []

    for league in leagues:
      for match in league.get("Matches", []) or []:
        home = ((match.get("Home") or {}).get("Name") or {}).get("Main", "")
        away = ((match.get("Away") or {}).get("Name") or {}).get("Main", "")
        if not home or not away:
          continue

        home_score = ((match.get("Home") or {}).get("Score") or {}).get("Match", -1)
        away_score = ((match.get("Away") or {}).get("Score") or {}).get("Match", -1)
        state = ((match.get("TextStates") or {}).get("State") or "").strip()
        minutes = ((match.get("TextStates") or {}).get("MinutesLive") or "").strip()
        sport_type = match.get("SportType", -1)
        sport_name = "Soccer" if sport_type == 0 else ("Basketball" if sport_type == 1 else "Sports")
        is_live = bool(match.get("IsLive"))
        start_time = match.get("DateStart") or ""

        score_text = "-" if int(home_score) < 0 or int(away_score) < 0 else f"{home_score}:{away_score}"
        status_parts = [x for x in [state, minutes] if x]
        status_text = " | ".join(status_parts) if status_parts else ("LIVE" if is_live else "Not started")

        rows.append({
          "provider": "ONE",
          "league": league.get("Name", ""),
          "sport": sport_name,
          "home": home,
          "away": away,
          "score": score_text,
          "status": status_text,
          "is_live": is_live,
          "start_time": start_time,
          "url": ((match.get("URL") or {}).get("PC") or "https://www.one.co.il/Live/#.match"),
        })

    rows.sort(key=lambda r: (0 if r.get("is_live") else 1, r.get("start_time") or ""))
    return rows[:limit]


def get_live_sports(limit: int = 20) -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    with LIVE_SPORTS_LOCK:
      ts = LIVE_SPORTS_CACHE.get("ts")
      cached = LIVE_SPORTS_CACHE.get("items", [])
      if isinstance(ts, datetime) and (now - ts) < timedelta(seconds=20):
        return cached[:limit]

    items: list[dict[str, Any]] = []
    try:
      items = fetch_one_live_scores(limit=limit)
    except Exception as exc:
      logger.warning("live sports fetch failed from ONE (%s)", exc)

    with LIVE_SPORTS_LOCK:
      if items:
        LIVE_SPORTS_CACHE["items"] = items
        LIVE_SPORTS_CACHE["ts"] = now
      elif LIVE_SPORTS_CACHE.get("items"):
        items = LIVE_SPORTS_CACHE["items"]

    return items[:limit]


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    init_db()

    if should_run_scheduler():
        config = load_config(CONFIG_PATH)
        interval_seconds = int(config.get("scheduler_interval_seconds", 0))
        if interval_seconds <= 0:
            interval_seconds = int(config.get("scheduler_interval_minutes", 10)) * 60

        scheduler = BackgroundScheduler(timezone="UTC")
        scheduler.add_job(
            safe_cycle,
            "interval",
            seconds=interval_seconds,
            id="news_cycle",
            max_instances=1,
        )
        scheduler.start()

        if config.get("run_first_cycle_on_start", True):
            # Run first sync in background so app can start serving immediately.
            threading.Thread(target=safe_cycle, daemon=True).start()

    @app.route("/")
    def index() -> Any:
        hours_param = request.args.get("hours", "").strip()
        if hours_param.isdigit() and int(hours_param) > 0:
            hours = min(int(hours_param), 24)
        else:
            hours = 24
        items = get_news(limit=120, hours=hours)
        taxonomy = get_taxonomy()
        stats = {"total_items": count_news(), "last_update": items[0]["created_at"] if items else None}
        return render_template("index.html", items=items, taxonomy=taxonomy, stats=stats)

    @app.route("/api/news")
    def api_news() -> Any:
        category = request.args.get("category")
        style = request.args.get("style")
        hours_param = request.args.get("hours", "").strip()
        if hours_param.isdigit() and int(hours_param) > 0:
            hours = min(int(hours_param), 24)
        else:
            hours = 24
        limit = int(request.args.get("limit", "50"))
        items = get_news(limit=limit, category=category, style=style, hours=hours)
        return jsonify({"items": items, "count": len(items)})

    @app.route("/api/live-sports")
    def api_live_sports() -> Any:
        limit = int(request.args.get("limit", "16"))
        limit = max(1, min(limit, 40))
        items = get_live_sports(limit=limit)
        return jsonify({"items": items, "count": len(items), "provider": "ONE"})

    @app.route("/api/trigger", methods=["POST"])
    def trigger() -> Any:
        safe_cycle()
        return jsonify({"ok": True})

    @app.route("/files/<path:filename>")
    def files(filename: str) -> Any:
        return send_from_directory(STORAGE_DIR, filename)

    return app


app = create_app()


if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "0").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="0.0.0.0", port=8080, debug=debug_mode, use_reloader=False)















