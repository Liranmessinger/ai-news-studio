import html
import json
import hashlib
import logging
import os
import re
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
from apscheduler.schedulers.background import BackgroundScheduler
from dateutil import parser as date_parser
from flask import Flask, Response, jsonify, render_template, request, send_from_directory

try:
    import redis
except Exception:
    redis = None

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
DEFAULT_HERO_IMAGE_URL = "https://storage.googleapis.com/assets_dilush/%D7%91%D7%99%D7%A0%D7%94%20%D7%91%20%D7%A7%D7%9C%D7%99%D7%A7/Assets/hero2.png"

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
ENRICH_EXECUTOR = ThreadPoolExecutor(max_workers=max(2, int(os.getenv("ENRICH_WORKERS", "4"))))
ENRICH_INFLIGHT: set[str] = set()
ENRICH_LOCK = threading.Lock()
ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
HTML_REFRESH_LOCK = threading.Lock()
NEWS_CLEANUP_LOCK = threading.Lock()
CHAT_CLEANUP_LOCK = threading.Lock()
REDIS_LOCK = threading.Lock()
REDIS_CLIENT: Any | None = None
REDIS_CONNECT_ATTEMPTED = False


def env_int(name: str, default: int, minimum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except Exception:
        value = default
    return max(minimum, value)


CACHE_PREFIX = (os.getenv("CACHE_PREFIX", "ainews") or "ainews").strip() or "ainews"
NEWS_CACHE_TTL_SECONDS = env_int("NEWS_CACHE_TTL_SECONDS", 30, 5)
TAXONOMY_CACHE_TTL_SECONDS = env_int("TAXONOMY_CACHE_TTL_SECONDS", 300, 30)
COUNT_CACHE_TTL_SECONDS = env_int("COUNT_CACHE_TTL_SECONDS", 30, 5)


def get_redis_client() -> Any | None:
    global REDIS_CLIENT, REDIS_CONNECT_ATTEMPTED

    redis_url = (os.getenv("REDIS_URL", "") or "").strip()
    if not redis_url:
        return None
    if redis is None:
        logger.warning("REDIS_URL is set but redis package is not installed")
        return None

    with REDIS_LOCK:
        if REDIS_CLIENT is not None:
            return REDIS_CLIENT
        if REDIS_CONNECT_ATTEMPTED:
            return None

        REDIS_CONNECT_ATTEMPTED = True
        try:
            client = redis.from_url(redis_url, decode_responses=True)
            client.ping()
            REDIS_CLIENT = client
            logger.info("Redis cache connected")
        except Exception as exc:
            logger.warning("Redis connection failed (%s)", exc)
            REDIS_CLIENT = None

    return REDIS_CLIENT


def redis_get_json(key: str) -> Any | None:
    client = get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(key)
        if not raw:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis GET failed for key=%s (%s)", key, exc)
        return None


def redis_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    client = get_redis_client()
    if client is None:
        return
    try:
        payload = json.dumps(value, ensure_ascii=False)
        client.setex(key, int(ttl_seconds), payload)
    except Exception as exc:
        logger.warning("Redis SET failed for key=%s (%s)", key, exc)


def cache_version(bucket: str) -> int:
    client = get_redis_client()
    if client is None:
        return 1
    key = f"{CACHE_PREFIX}:version:{bucket}"
    try:
        current = client.get(key)
        if current is None:
            client.set(key, "1")
            return 1
        return max(1, int(current))
    except Exception:
        return 1


def bump_cache_version(bucket: str) -> None:
    client = get_redis_client()
    if client is None:
        return
    key = f"{CACHE_PREFIX}:version:{bucket}"
    try:
        client.incr(key)
    except Exception:
        return


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



def resolve_manual_hero_image() -> str | None:
    direct_url = DEFAULT_HERO_IMAGE_URL
    if direct_url:
        return direct_url
        direct_url = DEFAULT_HERO_IMAGE_URL
    if direct_url:
        return direct_url

    for filename in ("hero.jpg", "hero.jpeg", "hero.png", "hero.webp"):
        root_candidate = STORAGE_DIR / filename
        if root_candidate.exists() and root_candidate.is_file():
            return f"/files/{filename}"

    hero_dir = STORAGE_DIR / "hero"
    for filename in ("hero.jpg", "hero.jpeg", "hero.png", "hero.webp"):
        candidate = hero_dir / filename
        if candidate.exists() and candidate.is_file():
            return f"/files/hero/{filename}"
    return None
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



def to_israel_time_iso(value: str | None) -> str:
    if not value:
        return ""
    dt = parse_dt(value)
    if dt == datetime.min.replace(tzinfo=UTC):
        return value
    return dt.astimezone(ISRAEL_TZ).isoformat(timespec="seconds")
def israel_date_time_parts(value: str | None) -> tuple[str, str]:
    if not value:
        return "", ""
    dt = parse_dt(value)
    if dt == datetime.min.replace(tzinfo=UTC):
        return value, ""
    local_dt = dt.astimezone(ISRAEL_TZ)
    return local_dt.strftime("%d-%m-%Y"), local_dt.strftime("%H:%M")

TRACKING_QUERY_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "gclid",
    "fbclid",
    "mc_cid",
    "mc_eid",
}


def canonicalize_url(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    try:
        parts = urlsplit(value)
        netloc = parts.netloc.lower()
        if netloc.endswith(":80"):
            netloc = netloc[:-3]
        if netloc.endswith(":443"):
            netloc = netloc[:-4]
        path = re.sub(r"/{2,}", "/", parts.path or "/")
        path = path.rstrip("/") or "/"
        filtered_query = [(k, v) for (k, v) in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in TRACKING_QUERY_KEYS]
        query = urlencode(filtered_query, doseq=True)
        return urlunsplit((parts.scheme.lower() or "https", netloc, path, query, ""))
    except Exception:
        return value


def build_content_hash(title: str, summary: str) -> str:
    normalized = normalized_for_compare(f"{title} {summary}")
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

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
                canonical_url TEXT NOT NULL DEFAULT '',
                content_hash TEXT NOT NULL DEFAULT '',
                prompt_text TEXT NOT NULL,
                UNIQUE(link, style_name)
            )
            """
        )
        cols = [r[1] for r in conn.execute("PRAGMA table_info(news_items)").fetchall()]
        if "model_name" not in cols:
            conn.execute("ALTER TABLE news_items ADD COLUMN model_name TEXT NOT NULL DEFAULT ''")
        if "canonical_url" not in cols:
            conn.execute("ALTER TABLE news_items ADD COLUMN canonical_url TEXT NOT NULL DEFAULT ''")
        if "content_hash" not in cols:
            conn.execute("ALTER TABLE news_items ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_created_at ON news_items(created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_style ON news_items(style_name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_model ON news_items(model_name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_canonical_url ON news_items(canonical_url)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_news_content_hash ON news_items(content_hash)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        chat_cols = [r[1] for r in conn.execute("PRAGMA table_info(chat_messages)").fetchall()]
        if "user_color" not in chat_cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN user_color TEXT NOT NULL DEFAULT '#4ea1ff'")
        if "ip_address" not in chat_cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN ip_address TEXT NOT NULL DEFAULT ''")
        if "session_id" not in chat_cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at DESC)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_presence (
                session_id TEXT PRIMARY KEY,
                user_name TEXT NOT NULL,
                user_color TEXT NOT NULL DEFAULT '#4ea1ff',
                ip_address TEXT NOT NULL DEFAULT '',
                last_seen TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_presence_seen ON chat_presence(last_seen DESC)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_moderation (
                session_id TEXT PRIMARY KEY,
                warnings INTEGER NOT NULL DEFAULT 0,
                is_blocked INTEGER NOT NULL DEFAULT 0,
                last_reason TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                ip_address TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_moderation_blocked ON chat_moderation(is_blocked, updated_at DESC)")


def sanitize_chat_name(name: str) -> str:
    value = normalize_text(name)
    if not value:
        return "אורח"
    value = re.sub(r"[^\w\u0590-\u05ff ._-]", "", value).strip()
    if not value:
        return "אורח"
    return value[:24]


def sanitize_chat_message(message: str) -> str:
    value = normalize_text(message)
    value = re.sub(r"\s+", " ", value).strip()
    return value[:600]


def sanitize_chat_color(color: str) -> str:
    value = str(color or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value.lower()
    return "#4ea1ff"


CHAT_BAD_WORDS_EN = {
    "fuck", "fucking", "shit", "bitch", "bastard", "asshole", "motherfucker", "dick", "slut", "whore",
}

CHAT_BAD_WORDS_HE = {
    "בן זונה", "בת זונה", "זונה", "מזדיין", "מזדיינת", "כוס אמק", "כוסעמק", "כוס אמא", "כוסאמא",
    "יא בן זונה", "מטומטם", "מטומטמת", "דביל", "דפוק", "שרמוטה", "מניאק", "כלבה", "נאצי",
}

CHAT_INCITEMENT_TERMS = {
    "kill", "murder", "burn them", "death to", "rape", "lynch", "shoot them",
    "להרוג", "לרצוח", "לשרוף", "מוות ל", "לאנוס", "לינץ", "תירו בהם", "שיישרפו",
}


def normalize_chat_text(text: str) -> str:
    value = normalize_text(text).lower()
    value = re.sub(r"\s+", " ", value).strip()
    return value


def contains_arabic_text(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text or ""))


def has_forbidden_phrase(text: str, terms: set[str]) -> bool:
    value = normalize_chat_text(text)
    if not value:
        return False
    for term in terms:
        t = term.strip().lower()
        if not t:
            continue
        if t in value:
            return True
    return False


def get_chat_moderation_state(session_id: str) -> dict[str, Any]:
    sid = str(session_id or "").strip()[:64]
    if not sid:
        return {"warnings": 0, "is_blocked": False}

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT warnings, is_blocked FROM chat_moderation WHERE session_id = ? LIMIT 1",
            (sid,),
        ).fetchone()

    if not row:
        return {"warnings": 0, "is_blocked": False}

    return {
        "warnings": int(row["warnings"] or 0),
        "is_blocked": bool(int(row["is_blocked"] or 0)),
    }


def set_chat_moderation_state(session_id: str, warnings: int, is_blocked: bool, reason: str, ip_address: str) -> None:
    sid = str(session_id or "").strip()[:64]
    if not sid:
        return

    now_iso = utc_now_iso()
    ip = str(ip_address or "").strip()[:64]
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO chat_moderation (session_id, warnings, is_blocked, last_reason, updated_at, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                warnings = excluded.warnings,
                is_blocked = excluded.is_blocked,
                last_reason = excluded.last_reason,
                updated_at = excluded.updated_at,
                ip_address = excluded.ip_address
            """,
            (sid, max(0, int(warnings)), 1 if is_blocked else 0, (reason or "")[:200], now_iso, ip),
        )


def moderate_chat_message(session_id: str, message: str, ip_address: str) -> dict[str, Any]:
    sid = str(session_id or "").strip()[:64]
    if not sid:
        sid = f"ip:{str(ip_address or '').strip()[:48]}"

    state = get_chat_moderation_state(sid)
    if state["is_blocked"]:
        return {
            "allow": False,
            "error": "chat_blocked",
            "message": "נחסמת מהצ'אט בסשן הזה בגלל הודעות פוגעניות.",
            "blocked": True,
            "warnings": int(state["warnings"]),
            "session_id": sid,
        }

    reason = ""
    value = normalize_chat_text(message)
    if contains_arabic_text(message):
        reason = "arabic_text"
    elif has_forbidden_phrase(value, CHAT_INCITEMENT_TERMS):
        reason = "incitement"
    elif has_forbidden_phrase(value, CHAT_BAD_WORDS_HE) or has_forbidden_phrase(value, CHAT_BAD_WORDS_EN):
        reason = "abusive_language"

    if not reason:
        return {
            "allow": True,
            "blocked": False,
            "warnings": int(state["warnings"]),
            "session_id": sid,
        }

    warnings = int(state["warnings"]) + 1
    blocked = warnings >= 2
    set_chat_moderation_state(sid, warnings=warnings, is_blocked=blocked, reason=reason, ip_address=ip_address)

    if blocked:
        return {
            "allow": False,
            "error": "chat_blocked",
            "message": "נחסמת מהצ'אט בסשן הזה בגלל הודעות פוגעניות.",
            "blocked": True,
            "warnings": warnings,
            "session_id": sid,
        }

    return {
        "allow": False,
        "error": "chat_warning",
        "message": "ההודעה נחסמה: זוהתה שפה לא הולמת. באזהרה הבאה תיחסם מהצ'אט בסשן זה.",
        "blocked": False,
        "warnings": warnings,
        "session_id": sid,
    }
def get_client_ip() -> str:
    forwarded = (request.headers.get("X-Forwarded-For", "") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    remote = (request.remote_addr or "").strip()
    return remote[:64]


def cleanup_chat_presence(active_seconds: int = 90) -> None:
    cutoff = (datetime.now(UTC) - timedelta(seconds=max(10, int(active_seconds)))).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM chat_presence WHERE last_seen < ?", (cutoff,))


def upsert_chat_presence(session_id: str, user_name: str, user_color: str, ip_address: str, create_if_missing: bool = True) -> None:
    sid = str(session_id or "").strip()[:64]
    if not sid:
        return
    name = sanitize_chat_name(user_name)
    color = sanitize_chat_color(user_color)
    ip = str(ip_address or "").strip()[:64]
    now_iso = utc_now_iso()

    with sqlite3.connect(DB_PATH) as conn:
        if create_if_missing:
            conn.execute(
                """
                INSERT INTO chat_presence (session_id, user_name, user_color, ip_address, last_seen)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    user_name = excluded.user_name,
                    user_color = excluded.user_color,
                    ip_address = excluded.ip_address,
                    last_seen = excluded.last_seen
                """
                , (sid, name, color, ip, now_iso)
            )
        else:
            conn.execute(
                """
                UPDATE chat_presence
                SET user_name = ?, user_color = ?, ip_address = ?, last_seen = ?
                WHERE session_id = ?
                """
                , (name, color, ip, now_iso, sid)
            )

def get_connected_chat_users(active_seconds: int = 90) -> list[dict[str, Any]]:
    cleanup_chat_presence(active_seconds=active_seconds)
    cutoff = (datetime.now(UTC) - timedelta(seconds=max(10, int(active_seconds)))).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT session_id, user_name, user_color, ip_address, last_seen
            FROM chat_presence
            WHERE last_seen >= ?
            ORDER BY last_seen DESC
            """
            , (cutoff,)
        ).fetchall()

    users = []
    seen: set[str] = set()
    for row in rows:
        d = dict(row)
        unique_key = f"{d.get('user_name', '')}|{d.get('ip_address', '')}"
        if unique_key in seen:
            continue
        seen.add(unique_key)
        users.append({
            "user_name": d.get("user_name", "אורח"),
            "user_color": sanitize_chat_color(d.get("user_color", "#4ea1ff")),
            "ip_address": d.get("ip_address", ""),
        })

    return users


def add_chat_message(user_name: str, message: str, user_color: str, session_id: str, ip_address: str) -> dict[str, Any] | None:
    name = sanitize_chat_name(user_name)
    text = sanitize_chat_message(message)
    color = sanitize_chat_color(user_color)
    sid = str(session_id or "").strip()[:64]
    ip = str(ip_address or "").strip()[:64]
    if not text:
        return None

    created_at = utc_now_iso()
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            """
            INSERT INTO chat_messages (user_name, message, created_at, user_color, ip_address, session_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """
            , (name, text, created_at, color, ip, sid)
        )
        new_id = int(cur.lastrowid or 0)
        conn.execute(
            "DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 10)"
        )

    upsert_chat_presence(sid, name, color, ip)
    return {
        "id": new_id,
        "user_name": name,
        "message": text,
        "user_color": color,
        "created_at": to_israel_time_iso(created_at),
    }


def get_chat_messages(limit: int = 100, since_id: int = 0) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 100))
    since_id = max(0, int(since_id))

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        if since_id > 0:
            rows = conn.execute(
                """
                SELECT id, user_name, message, user_color, created_at
                FROM chat_messages
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
                """
                , (since_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, user_name, message, user_color, created_at
                FROM chat_messages
                ORDER BY id DESC
                LIMIT ?
                """
                , (limit,)
            ).fetchall()
            rows = list(reversed(rows))

    items = []
    for row in rows:
        d = dict(row)
        d["user_color"] = sanitize_chat_color(d.get("user_color", "#4ea1ff"))
        d["created_at"] = to_israel_time_iso(d.get("created_at"))
        items.append(d)
    return items

def news_exists(
    link: str,
    style_name: str,
    source_name: str,
    title: str,
    published_at: str | None,
    canonical_url: str = "",
    content_hash: str = "",
) -> bool:
    with sqlite3.connect(DB_PATH) as conn:
        if canonical_url:
            row = conn.execute(
                "SELECT 1 FROM news_items WHERE canonical_url = ? AND style_name = ? LIMIT 1",
                (canonical_url, style_name),
            ).fetchone()
            if row:
                return True

        if content_hash:
            row = conn.execute(
                "SELECT 1 FROM news_items WHERE content_hash = ? AND style_name = ? AND source_name = ? LIMIT 1",
                (content_hash, style_name, source_name),
            ).fetchone()
            if row:
                return True

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
                    style_name, model_name, image_path, prompt_path, canonical_url, content_hash, prompt_text
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    item.get("canonical_url", ""),
                    item.get("content_hash", ""),
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




def _enrich_key(link: str, style_name: str, source_name: str, title: str, published_at: str | None) -> str:
    if link:
        return f"link:{link}|style:{style_name}"
    return f"src:{source_name}|title:{title}|pub:{published_at or ''}|style:{style_name}"


def _claim_enrich_task(key: str) -> bool:
    with ENRICH_LOCK:
        if key in ENRICH_INFLIGHT:
            return False
        ENRICH_INFLIGHT.add(key)
        return True


def _release_enrich_task(key: str) -> None:
    with ENRICH_LOCK:
        ENRICH_INFLIGHT.discard(key)


def update_news_item_enrichment(
    link: str,
    style_name: str,
    source_name: str,
    title: str,
    published_at: str | None,
    summary: str,
    model_name: str,
    image_path: str | None,
    prompt_path: str | None,
    prompt_text: str,
) -> None:
    summary = (summary or "אין תקציר זמין כרגע.").strip()
    prompt_text = (prompt_text or "").strip()
    content_hash = build_content_hash(title, summary)

    with sqlite3.connect(DB_PATH) as conn:
        if link:
            conn.execute(
                """
                UPDATE news_items
                SET summary = ?,
                    model_name = ?,
                    prompt_text = ?,
                    content_hash = COALESCE(?, content_hash),
                    prompt_path = COALESCE(?, prompt_path),
                    image_path = COALESCE(?, image_path)
                WHERE link = ? AND style_name = ?
                """,
                (summary, model_name, prompt_text, content_hash, prompt_path, image_path, link, style_name),
            )
            return

        conn.execute(
            """
            UPDATE news_items
            SET summary = ?,
                model_name = ?,
                prompt_text = ?,
                content_hash = COALESCE(?, content_hash),
                prompt_path = COALESCE(?, prompt_path),
                image_path = COALESCE(?, image_path)
            WHERE source_name = ?
              AND title = ?
              AND COALESCE(published_at, '') = COALESCE(?, '')
              AND style_name = ?
            """,
            (summary, model_name, prompt_text, content_hash, prompt_path, image_path, source_name, title, published_at, style_name),
        )

def _enrich_inserted_article(
    article: Any,
    style_name: str,
    style_desc: str,
    config: dict[str, Any],
    output_dir: Path,
    timeout: int,
    model_name: str,
) -> None:
    link = article.link or ""
    title = article.title or "ללא כותרת"
    published_at = article.published_at.isoformat() if article.published_at else None
    enrich_key = _enrich_key(link, style_name, article.source_name, title, published_at)
    if not _claim_enrich_task(enrich_key):
        return

    try:
        source_image_url = getattr(article, "source_image_url", None) or extract_article_page_image(link, min(timeout, 8))

        summary_mode = config.get("summarization", {}).get("mode", "llm")
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

        update_news_item_enrichment(
            link=link,
            style_name=style_name,
            source_name=article.source_name,
            title=title,
            published_at=published_at,
            summary=summary,
            model_name=model_name,
            image_path=image_path,
            prompt_path=prompt_path,
            prompt_text=prompt,
        )

        if source_image_url:
            update_missing_image(link, style_name, article.source_name, title, published_at, source_image_url)
    except Exception:
        logger.exception("Background enrichment failed for %s", title)
    finally:
        _release_enrich_task(enrich_key)


def _schedule_enrichment(
    article: Any,
    style_name: str,
    style_desc: str,
    config: dict[str, Any],
    output_dir: Path,
    timeout: int,
    model_name: str,
) -> None:
    ENRICH_EXECUTOR.submit(
        _enrich_inserted_article,
        article,
        style_name,
        style_desc,
        config,
        output_dir,
        timeout,
        model_name,
    )
def get_news(
    limit: int = 100,
    category: str | None = None,
    style: str | None = None,
    hours: int | None = 24,
) -> list[dict[str, Any]]:
    news_version = cache_version("news")
    cache_key = f"{CACHE_PREFIX}:news:v{news_version}:limit={int(limit)}:category={category or ''}:style={style or ''}:hours={int(hours or 0)}"
    cached_items = redis_get_json(cache_key)
    if isinstance(cached_items, list):
        return cached_items

    sql = """
        SELECT id, source_name, title, summary, category, link, published_at, created_at,
               style_name, model_name, image_path, prompt_path, canonical_url, content_hash
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
        item["summary"] = re.sub(r"^🇮🇱\s*", "", item.get("summary", "")).strip()
        item["title"] = hebrew_title_from_summary(item.get("title", ""), item.get("summary", ""))
        emoji = emoji_for_item(item.get("category", ""), item.get("title", ""), item.get("summary", ""))
        if item.get("summary") and not item["summary"].startswith(emoji):
            item["summary"] = f"{emoji} {item['summary']}"

        item["category_label"] = category_label(item.get("category", ""))
        item["style_label"] = style_label(item.get("style_name", ""))

        sort_dt = parse_dt(item.get("published_at") or item.get("created_at"))
        if cutoff and sort_dt < cutoff:
            continue

        if item.get("published_at"):
            item["published_at"] = to_israel_time_iso(item.get("published_at"))
        if item.get("created_at"):
            item["created_at"] = to_israel_time_iso(item.get("created_at"))

        published_dt = parse_dt(item.get("published_at")) if item.get("published_at") else datetime.min.replace(tzinfo=UTC)
        max_future = now + timedelta(minutes=30)
        if item.get("published_at") and published_dt <= max_future:
            display_src = item.get("published_at")
        else:
            display_src = item.get("created_at") or item.get("published_at")
        display_date, display_time = israel_date_time_parts(display_src)
        item["display_date"] = display_date
        item["display_time"] = display_time

        item["sort_dt"] = sort_dt
        items.append(item)

    items.sort(key=lambda x: x["sort_dt"], reverse=True)

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        key = item.get("content_hash", "") or normalized_for_compare(item.get("title", ""))
        if not key:
            key = "id:" + str(item.get("id", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    items = deduped[:limit]
    for item in items:
        item.pop("sort_dt", None)

    redis_set_json(cache_key, items, NEWS_CACHE_TTL_SECONDS)
    return items

def count_news() -> int:
    count_version = cache_version("count")
    cache_key = f"{CACHE_PREFIX}:count:v{count_version}"
    cached_count = redis_get_json(cache_key)
    if isinstance(cached_count, int):
        return cached_count

    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT COUNT(*) FROM news_items").fetchone()
    total = int(row[0]) if row else 0
    redis_set_json(cache_key, total, COUNT_CACHE_TTL_SECONDS)
    return total

def cleanup_old_news(hours: int = 24, output_dir: Path | None = None) -> dict[str, int]:
    """Delete stale DB rows and generated image files older than `hours`."""
    cutoff = datetime.now(UTC) - timedelta(hours=hours)
    cutoff_iso = cutoff.isoformat()
    removed_files = 0
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "DELETE FROM news_items WHERE created_at < ?",
            (cutoff_iso,),
        )
        removed_rows = int(cur.rowcount or 0)

    target_dir = output_dir if output_dir is not None else (STORAGE_DIR / "output")
    try:
        target_dir = Path(target_dir).resolve()
    except Exception:
        target_dir = STORAGE_DIR / "output"

    image_suffixes = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    if target_dir.exists() and target_dir.is_dir():
        for file_path in target_dir.iterdir():
            if not file_path.is_file():
                continue
            if file_path.suffix.lower() not in image_suffixes:
                continue
            try:
                modified = datetime.fromtimestamp(file_path.stat().st_mtime, tz=UTC)
                if modified < cutoff:
                    file_path.unlink(missing_ok=True)
                    removed_files += 1
            except Exception as exc:
                logger.warning("cleanup skipped file %s (%s)", file_path, exc)

    if removed_rows > 0:
        bump_cache_version("news")
        bump_cache_version("taxonomy")
        bump_cache_version("count")

    return {"rows": removed_rows, "files": removed_files}


def run_chat_cleanup(retention_minutes: int = 10, max_messages: int = 10) -> dict[str, int]:
    retention_minutes = max(1, int(retention_minutes))
    max_messages = max(1, int(max_messages))

    cutoff_iso = (datetime.now(UTC) - timedelta(minutes=retention_minutes)).isoformat()
    deleted_old = 0
    deleted_overflow = 0
    deleted_presence = 0

    with sqlite3.connect(DB_PATH) as conn:
        cur_old = conn.execute(
            "DELETE FROM chat_messages WHERE created_at < ?",
            (cutoff_iso,),
        )
        deleted_old = int(cur_old.rowcount or 0)

        cur_overflow = conn.execute(
            "DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT ?)",
            (max_messages,),
        )
        deleted_overflow = int(cur_overflow.rowcount or 0)

        cur_presence = conn.execute(
            "DELETE FROM chat_presence WHERE last_seen < ?",
            (cutoff_iso,),
        )
        deleted_presence = int(cur_presence.rowcount or 0)

    total_deleted = deleted_old + deleted_overflow
    return {
        "deleted_old": deleted_old,
        "deleted_overflow": deleted_overflow,
        "deleted_presence": deleted_presence,
        "deleted_total": total_deleted,
    }


def safe_news_cleanup(hours: int, output_dir: Path | None = None) -> dict[str, int]:
    if not NEWS_CLEANUP_LOCK.acquire(blocking=False):
        logger.info("Skipping news cleanup because previous run is still active")
        return {"rows": 0, "files": 0}
    try:
        result = cleanup_old_news(hours=hours, output_dir=output_dir)
        logger.info("News cleanup complete. rows=%s files=%s", result.get("rows", 0), result.get("files", 0))
        return result
    except Exception:
        logger.exception("News cleanup failed")
        return {"rows": 0, "files": 0}
    finally:
        NEWS_CLEANUP_LOCK.release()


def safe_chat_cleanup(retention_minutes: int = 10, max_messages: int = 10) -> dict[str, int]:
    if not CHAT_CLEANUP_LOCK.acquire(blocking=False):
        logger.info("Skipping chat cleanup because previous run is still active")
        return {"deleted_total": 0, "deleted_old": 0, "deleted_overflow": 0, "deleted_presence": 0}
    try:
        result = run_chat_cleanup(retention_minutes=retention_minutes, max_messages=max_messages)
        logger.info(
            "Chat cleanup complete. deleted_total=%s old=%s overflow=%s presence=%s",
            result.get("deleted_total", 0),
            result.get("deleted_old", 0),
            result.get("deleted_overflow", 0),
            result.get("deleted_presence", 0),
        )
        return result
    except Exception:
        logger.exception("Chat cleanup failed")
        return {"deleted_total": 0, "deleted_old": 0, "deleted_overflow": 0, "deleted_presence": 0}
    finally:
        CHAT_CLEANUP_LOCK.release()
def get_taxonomy() -> dict[str, list[dict[str, str]]]:
    taxonomy_version = cache_version("taxonomy")
    cache_key = f"{CACHE_PREFIX}:taxonomy:v{taxonomy_version}"
    cached_taxonomy = redis_get_json(cache_key)
    if isinstance(cached_taxonomy, dict):
        return cached_taxonomy

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
    payload = {"categories": categories, "styles": styles}
    redis_set_json(cache_key, payload, TAXONOMY_CACHE_TTL_SECONDS)
    return payload

def resolve_style_for_article(config: dict[str, Any], article: Any) -> str:
    source_style_map = config.get("source_style_map", {})
    if article.source_name in source_style_map:
        return source_style_map[article.source_name]
    category_style_map = config.get("category_style_map", {})
    if article.category in category_style_map:
        return category_style_map[article.category]
    return config.get("default_style", "breaking")



def should_fetch_page_image_now(source: dict[str, Any], article: Any) -> bool:
    source_url = str(source.get("url", "")).lower()
    source_name = str(source.get("name", "")).lower()
    link = str(getattr(article, "link", "") or "").lower()

    if "news.google.com" in source_url or "google news" in source_name:
        return True
    if source_url and all(token not in source_url for token in ["/rss", ".xml", "feed"]):
        return True
    if link and "news.google.com" in link:
        return True
    return False
def run_generation_cycle() -> dict[str, int]:
    config = load_config(CONFIG_PATH)
    output_dir = resolve_output_dir(config)
    output_dir.mkdir(parents=True, exist_ok=True)

    timeout = int(config.get("timeout_seconds", 20))
    max_items = int(config.get("max_items_per_source", 5))
    model_name = config.get("image", {}).get("model", "")
    scan_workers = max(2, int(config.get("scan_parallel_workers", 8)))
    enrich_in_background = bool(config.get("enable_background_enrichment", True))

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

    if not sources:
        return {"scanned": 0, "added": 0}

    workers = min(len(sources), scan_workers)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(scan_feed, source, max_items): source
            for source in sources
        }

        for future in as_completed(future_map):
            source = future_map[future]
            source_name = str(source.get("name", source.get("url", "source")))
            try:
                articles = future.result()
            except Exception as exc:
                logger.warning("Source scan failed: %s (%s)", source_name, exc)
                continue

            scanned += len(articles)
            logger.info("Source scanned: %s items=%s", source_name, len(articles))

            for article in articles:
                style_name = resolve_style_for_article(config, article)
                style_desc = config["styles"].get(style_name)
                if not style_desc:
                    style_name = "breaking"
                    style_desc = config["styles"][style_name]

                link = article.link or ""
                title = article.title or "ללא כותרת"
                published_at = article.published_at.isoformat() if article.published_at else None
                canonical_url = canonicalize_url(link)

                quick_summary = extractive_summary(article)
                content_hash = build_content_hash(title, quick_summary)

                if news_exists(
                    link,
                    style_name,
                    article.source_name,
                    title,
                    published_at,
                    canonical_url=canonical_url,
                    content_hash=content_hash,
                ):
                    continue

                quick_image = getattr(article, "source_image_url", None)
                if not quick_image and should_fetch_page_image_now(source, article):
                    quick_image = extract_article_page_image(link, min(timeout, 8))

                inserted = insert_news_item(
                    {
                        "source_name": article.source_name,
                        "title": title,
                        "summary": quick_summary,
                        "category": article.category,
                        "link": link,
                        "published_at": published_at,
                        "created_at": utc_now_iso(),
                        "style_name": style_name,
                        "model_name": model_name,
                        "image_path": quick_image,
                        "prompt_path": None,
                        "canonical_url": canonical_url,
                        "content_hash": content_hash,
                        "prompt_text": "",
                    }
                )
                if not inserted:
                    continue

                added += 1

                if enrich_in_background:
                    _schedule_enrichment(
                        article=article,
                        style_name=style_name,
                        style_desc=style_desc,
                        config=config,
                        output_dir=output_dir,
                        timeout=timeout,
                        model_name=model_name,
                    )
                else:
                    _enrich_inserted_article(
                        article=article,
                        style_name=style_name,
                        style_desc=style_desc,
                        config=config,
                        output_dir=output_dir,
                        timeout=timeout,
                        model_name=model_name,
                    )

    if added > 0:
        bump_cache_version("news")
        bump_cache_version("taxonomy")
        bump_cache_version("count")

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



def run_html_refresh_cycle(limit: int = 40, timeout: int = 8) -> dict[str, int]:
    cutoff = (datetime.now(UTC) - timedelta(hours=24)).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, link, image_path
            FROM news_items
            WHERE created_at >= ?
              AND COALESCE(link, '') <> ''
              AND (image_path IS NULL OR image_path = '')
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (cutoff, limit),
        ).fetchall()

        refreshed = 0
        checked = 0
        for row in rows:
            checked += 1
            link = (row["link"] or "").strip()
            if not link:
                continue
            image_url = extract_article_page_image(link, timeout)
            if not image_url:
                continue
            conn.execute("UPDATE news_items SET image_path = ? WHERE id = ?", (image_url, int(row["id"])))
            refreshed += 1

    if refreshed > 0:
        bump_cache_version("news")

    return {"checked": checked, "refreshed": refreshed}


def safe_html_refresh() -> None:
    if not HTML_REFRESH_LOCK.acquire(blocking=False):
        logger.info("Skipping HTML refresh because previous run is still active")
        return
    try:
        result = run_html_refresh_cycle()
        logger.info("HTML refresh complete. checked=%s refreshed=%s", result["checked"], result["refreshed"])
    except Exception:
        logger.exception("HTML refresh failed")
    finally:
        HTML_REFRESH_LOCK.release()
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
        api_home = ((match.get("Home") or {}).get("Name") or {}).get("Main", "")
        api_away = ((match.get("Away") or {}).get("Name") or {}).get("Main", "")
        if not api_home or not api_away:
          continue

        api_home_score = ((match.get("Home") or {}).get("Score") or {}).get("Match", -1)
        api_away_score = ((match.get("Away") or {}).get("Score") or {}).get("Match", -1)
        # ONE live payload appears reversed in our Hebrew presentation.
        # Swap sides so בית/חוץ and score align with the displayed teams.
        home = api_away
        away = api_home
        home_score = api_away_score
        away_score = api_home_score
        state = ((match.get("TextStates") or {}).get("State") or "").strip()
        minutes = ((match.get("TextStates") or {}).get("MinutesLive") or "").strip()
        sport_type = match.get("SportType", -1)
        sport_name = "Soccer" if sport_type == 0 else ("Basketball" if sport_type == 1 else "Sports")
        is_live = bool(match.get("IsLive"))
        start_time = match.get("DateStart") or ""

        score_text = "-" if int(home_score) < 0 or int(away_score) < 0 else f"{home_score}:{away_score}"
        if ":" in score_text:
            left, right = score_text.split(":", 1)
            left = left.strip()
            right = right.strip()
            if left.isdigit() and right.isdigit():
                score_text = f"{right}:{left}"
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
        output_dir = resolve_output_dir(config)

        rss_interval_seconds = int(config.get("rss_interval_seconds", config.get("scheduler_interval_seconds", 30)))
        if rss_interval_seconds <= 0:
            rss_interval_seconds = 30

        html_refresh_interval_seconds = int(config.get("html_refresh_interval_seconds", 300))
        if html_refresh_interval_seconds <= 0:
            html_refresh_interval_seconds = 300

        retention_hours = int(config.get("retention_hours", 24))

        chat_cleanup_interval_seconds = int(config.get("chat_cleanup_interval_seconds", 600))
        if chat_cleanup_interval_seconds <= 0:
            chat_cleanup_interval_seconds = 600

        chat_retention_minutes = int(config.get("chat_retention_minutes", 10))
        if chat_retention_minutes <= 0:
            chat_retention_minutes = 10

        chat_max_messages = int(config.get("chat_max_messages", 10))
        if chat_max_messages <= 0:
            chat_max_messages = 10

        # Run cleanup once on startup so stale rows do not accumulate after frequent restarts.
        safe_news_cleanup(retention_hours, output_dir=output_dir)
        safe_chat_cleanup(retention_minutes=chat_retention_minutes, max_messages=chat_max_messages)

        scheduler = BackgroundScheduler(timezone="UTC")
        scheduler.add_job(
            safe_cycle,
            "interval",
            seconds=rss_interval_seconds,
            id="news_cycle",
            max_instances=1,
        )
        scheduler.add_job(
            safe_html_refresh,
            "interval",
            seconds=html_refresh_interval_seconds,
            id="news_html_refresh",
            max_instances=1,
        )
        scheduler.add_job(
            lambda: safe_news_cleanup(retention_hours, output_dir=output_dir),
            "interval",
            hours=1,
            id="news_cleanup",
            max_instances=1,
        )
        scheduler.add_job(
            lambda: safe_chat_cleanup(retention_minutes=chat_retention_minutes, max_messages=chat_max_messages),
            "interval",
            seconds=chat_cleanup_interval_seconds,
            id="chat_cleanup",
            max_instances=1,
        )
        scheduler.start()

        if config.get("run_first_cycle_on_start", True):
            # Run first sync in background so app can start serving immediately.
            threading.Thread(target=safe_cycle, daemon=True).start()
            threading.Thread(target=safe_html_refresh, daemon=True).start()

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
        return render_template("index.html", items=items, taxonomy=taxonomy, stats=stats, manual_hero_image=resolve_manual_hero_image())

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


    @app.route("/api/chat/messages", methods=["GET"])
    def api_chat_messages() -> Any:
        limit_raw = request.args.get("limit", "100").strip()
        since_raw = request.args.get("since_id", "0").strip()
        session_id = str(request.args.get("session_id", "")).strip()[:64]
        user_name = str(request.args.get("user_name", "")).strip()
        user_color = str(request.args.get("user_color", "")).strip()
        try:
            limit = int(limit_raw)
        except Exception:
            limit = 100
        try:
            since_id = int(since_raw)
        except Exception:
            since_id = 0

        client_ip = get_client_ip()
        effective_session_id = session_id or f"ip:{client_ip[:48]}"
        if session_id:
            upsert_chat_presence(session_id, user_name or "אורח", user_color or "#4ea1ff", client_ip, create_if_missing=False)

        moderation_state = get_chat_moderation_state(effective_session_id)
        items = get_chat_messages(limit=limit, since_id=since_id)
        connected_users = get_connected_chat_users(active_seconds=90)
        last_id = items[-1]["id"] if items else since_id
        return jsonify({
            "items": items,
            "count": len(items),
            "last_id": last_id,
            "connected_count": len(connected_users),
            "connected_users": connected_users,
            "chat_blocked": bool(moderation_state.get("is_blocked", False)),
            "chat_warnings": int(moderation_state.get("warnings", 0)),
        })


    @app.route("/api/chat/messages", methods=["POST"])
    def api_chat_post_message() -> Any:
        payload = request.get_json(silent=True) or {}
        user_name = str(payload.get("user_name", "")).strip()
        message = str(payload.get("message", "")).strip()
        user_color = str(payload.get("user_color", "")).strip()
        session_id = str(payload.get("session_id", "")).strip()[:64]
        client_ip = get_client_ip()

        moderation = moderate_chat_message(session_id, message, client_ip)
        if not moderation.get("allow", False):
            connected_users = get_connected_chat_users(active_seconds=90)
            status_code = 403 if moderation.get("blocked", False) else 400
            return jsonify({
                "ok": False,
                "error": moderation.get("error", "chat_moderation"),
                "message": moderation.get("message", "ההודעה נחסמה."),
                "blocked": bool(moderation.get("blocked", False)),
                "chat_warnings": int(moderation.get("warnings", 0)),
                "connected_count": len(connected_users),
                "connected_users": connected_users,
            }), status_code

        effective_session_id = str(moderation.get("session_id") or session_id).strip()[:64]
        created = add_chat_message(
            user_name=user_name,
            message=message,
            user_color=user_color,
            session_id=effective_session_id,
            ip_address=client_ip,
        )
        if not created:
            return jsonify({"ok": False, "error": "empty_message", "message": "לא ניתן לשלוח הודעה ריקה."}), 400
        connected_users = get_connected_chat_users(active_seconds=90)
        return jsonify({
            "ok": True,
            "item": created,
            "connected_count": len(connected_users),
            "connected_users": connected_users,
            "chat_blocked": False,
            "chat_warnings": int(moderation.get("warnings", 0)),
        })

    @app.route("/api/trigger", methods=["POST"])
    def trigger() -> Any:
        safe_cycle()
        return jsonify({"ok": True})


    @app.route("/robots.txt")
    def robots() -> Any:
        base = request.url_root.rstrip("/")
        content = (
            "User-agent: *\n"
            "Allow: /\n"
            "Disallow: /api/\n"
            f"Sitemap: {base}/sitemap.xml\n"
        )
        return Response(content, mimetype="text/plain; charset=utf-8")

    @app.route("/sitemap.xml")
    def sitemap() -> Any:
        base = request.url_root.rstrip("/")
        taxonomy = get_taxonomy()
        items = get_news(limit=1, hours=24)
        lastmod = items[0].get("created_at") if items else utc_now_iso()

        urls = [f"{base}/"]
        for cat in taxonomy.get("categories", []):
            value = str(cat.get("value", "")).strip()
            if not value:
                continue
            urls.append(f"{base}/?{urlencode({'category': value})}")

        nodes = []
        for u in urls:
            nodes.append(
                "  <url>\n"
                f"    <loc>{html.escape(u)}</loc>\n"
                f"    <lastmod>{html.escape(lastmod)}</lastmod>\n"
                "    <changefreq>always</changefreq>\n"
                "    <priority>0.8</priority>\n"
                "  </url>"
            )

        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(nodes)
            + "\n</urlset>\n"
        )
        return Response(xml, mimetype="application/xml; charset=utf-8")
    @app.route("/files/<path:filename>")
    def files(filename: str) -> Any:
        return send_from_directory(STORAGE_DIR, filename)

    return app


app = create_app()


if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "0").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="0.0.0.0", port=8080, debug=debug_mode, use_reloader=False)



























































































