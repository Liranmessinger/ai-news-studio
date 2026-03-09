import argparse
import base64
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import feedparser
import httpx
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

logger = logging.getLogger("news_image_pipeline")


DEFAULT_STYLES = {
    "breaking": "Breaking-news editorial poster, sharp typography, urgency, red accents, high contrast, newsroom visuals.",
    "finance": "Financial-news infographic style, clean grid, market motifs, blue and gold palette, professional tone.",
    "tech": "Futuristic technology news card, neon accents, UI overlays, modern minimalism, crisp composition.",
    "dramatic": "Cinematic dramatic news visual, deep shadows, bold headline area, emotional atmosphere.",
    "clean": "Clean modern newspaper cover style, clear hierarchy, neutral colors, highly readable layout.",
}


@dataclass
class Article:
    source_name: str
    title: str
    link: str
    published_at: datetime | None
    content_text: str
    category: str
    source_image_url: str | None = None


def load_config(config_path: Path) -> dict[str, Any]:
    raw = config_path.read_text(encoding="utf-8-sig")
    config = json.loads(raw)
    if "sources" not in config or not config["sources"]:
        raise ValueError("config.sources is required and cannot be empty")

    config.setdefault("styles", DEFAULT_STYLES)
    config.setdefault("output_dir", "output")
    config.setdefault("max_items_per_source", 5)
    config.setdefault("timeout_seconds", 20)

    config.setdefault("image", {})
    config["image"].setdefault("provider", "generic")
    config["image"].setdefault("model", "nano-banana-2")
    config["image"].setdefault("size", "1024x1024")
    config["image"].setdefault("quality", "medium")
    config["image"].setdefault("endpoint", "")
    config["image"].setdefault("api_key_env", "OPENAI_API_KEY")

    config.setdefault("summarization", {})
    config["summarization"].setdefault("mode", "llm")
    config["summarization"].setdefault("endpoint", "https://api.openai.com/v1/chat/completions")
    config["summarization"].setdefault("api_key_env", "OPENAI_API_KEY")
    config["summarization"].setdefault("model", "gpt-4o-mini")
    return config


def clean_html(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_published(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return date_parser.parse(value)
    except Exception:
        return None



def extract_entry_image_url(entry: Any) -> str | None:
    try:
        media_content = getattr(entry, "media_content", None)
        if media_content and isinstance(media_content, list):
            for item in media_content:
                if isinstance(item, dict) and item.get("url"):
                    return str(item["url"]).strip()

        media_thumbnail = getattr(entry, "media_thumbnail", None)
        if media_thumbnail and isinstance(media_thumbnail, list):
            for item in media_thumbnail:
                if isinstance(item, dict) and item.get("url"):
                    return str(item["url"]).strip()

        links = getattr(entry, "links", None)
        if links and isinstance(links, list):
            for l in links:
                if not isinstance(l, dict):
                    continue
                href = str(l.get("href", "")).strip()
                rel = str(l.get("rel", "")).lower()
                typ = str(l.get("type", "")).lower()
                if href and ("image" in typ or rel == "enclosure"):
                    return href
    except Exception:
        return None

    return None
def scan_feed(source: dict[str, Any], max_items: int) -> list[Article]:
    parsed = feedparser.parse(source["url"])
    source_name = source.get("name", source["url"])
    category = source.get("category", "general")
    results: list[Article] = []

    for entry in parsed.entries[:max_items]:
        content_parts = []
        if getattr(entry, "summary", None):
            content_parts.append(clean_html(entry.summary))
        if getattr(entry, "content", None):
            for block in entry.content:
                value = block.get("value", "")
                content_parts.append(clean_html(value))

        body = " ".join(part for part in content_parts if part).strip()
        results.append(
            Article(
                source_name=source_name,
                title=getattr(entry, "title", "").strip(),
                link=getattr(entry, "link", "").strip(),
                published_at=parse_published(getattr(entry, "published", None)),
                content_text=body,
                category=category,
                source_image_url=extract_entry_image_url(entry),
            )
        )
    return results


def _clean_duplicate_summary(summary: str, title: str) -> str:
    s = (summary or "").strip()
    t = (title or "").strip()
    if not s:
        return "אין תקציר זמין כרגע."
    if t and s.lower() == t.lower():
        return "אין תקציר זמין כרגע."
    if t and t.lower() in s.lower():
        s = re.sub(re.escape(t), "", s, flags=re.IGNORECASE).strip(" -:|\t")
    s = re.sub(r"\s+", " ", s).strip()
    return s or "אין תקציר זמין כרגע."


def extractive_summary(article: Article, max_chars: int = 420) -> str:
    seed = article.content_text.strip()
    if not seed:
        return "אין תקציר זמין כרגע."
    if len(seed) <= max_chars:
        return _clean_duplicate_summary(seed, article.title)
    clipped = seed[: max_chars + 1]
    last_punct = max(clipped.rfind("."), clipped.rfind("!"), clipped.rfind("?"))
    if last_punct > 120:
        return _clean_duplicate_summary(clipped[: last_punct + 1], article.title)
    return _clean_duplicate_summary(clipped[:max_chars].rstrip() + "...", article.title)


def llm_summary(article: Article, config: dict[str, Any], timeout: int) -> str:
    endpoint = config["summarization"]["endpoint"]
    api_key = os.getenv(config["summarization"]["api_key_env"], "") or os.getenv("OPENAI_API_KEY", "")
    model = config["summarization"]["model"]
    if not endpoint or not api_key or not model:
        return extractive_summary(article)

    prompt = (
        "כתוב תקציר חדשות בעברית ברורה לידיעה, גם אם המקור באנגלית. "
        "אל תחזור על הכותרת כפי שהיא, ואל תעתיק מילה במילה. "
        "החזר תקציר תמציתי עם עובדות בלבד, עד 65 מילים.\n\n"
        f"כותרת מקור: {article.title}\n"
        f"תוכן מקור: {article.content_text}\n"
        f"קטגוריה: {article.category}\n"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "אתה עורך חדשות עברי תמציתי ומדויק."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.warning("llm_summary failed (%s), fallback to extractive", exc)
        return extractive_summary(article)

    choice = data.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content", "")
    if isinstance(content, list):
        text_parts = [c.get("text", "") for c in content if isinstance(c, dict)]
        content = " ".join(text_parts).strip()
    return _clean_duplicate_summary(content.strip() or extractive_summary(article), article.title)


def build_image_prompt(article: Article, summary: str, style_name: str, style_desc: str) -> str:
    published = article.published_at.isoformat() if article.published_at else "N/A"
    return (
        f"Create a detailed Hebrew news image in style '{style_name}'. "
        f"Style direction: {style_desc}\n"
        f"Headline (Hebrew): {article.title}\n"
        f"Summary (Hebrew): {summary}\n"
        f"Source badge: {article.source_name}\n"
        f"Category tag: {article.category}\n"
        f"Published at: {published}\n"
        "Layout requirements: large headline area, readable Hebrew typography, subtitle block, "
        "small source/date footer, editorial-quality composition, no gibberish text."
    )


def _model_slug(model: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", (model or "image-model").lower()).strip("-")[:30] or "image-model"


def write_prompt_file(output_dir: Path, article: Article, style_name: str, prompt: str, model: str) -> Path:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", article.title.lower()).strip("-")[:60] or "news-item"
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{_model_slug(model)}_{style_name}_{slug}.txt"
    path = output_dir / filename
    path.write_text(prompt, encoding="utf-8")
    return path


def save_image_bytes(image_bytes: bytes, output_dir: Path, article: Article, style_name: str, model: str) -> Path:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", article.title.lower()).strip("-")[:60] or "news-item"
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{_model_slug(model)}_{style_name}_{slug}.png"
    path = output_dir / filename
    path.write_bytes(image_bytes)
    return path


def generate_image(
    prompt: str, article: Article, style_name: str, config: dict[str, Any], output_dir: Path, timeout: int
) -> Path:
    image_cfg = config["image"]
    endpoint = image_cfg["endpoint"]
    api_key = os.getenv(image_cfg["api_key_env"], "") or os.getenv("OPENAI_API_KEY", "") or os.getenv("IMAGE_API_KEY", "")
    model = image_cfg["model"]
    size = image_cfg["size"]
    provider = image_cfg.get("provider", "generic").lower().strip()
    quality = image_cfg.get("quality", "medium")

    if not endpoint or not api_key:
        return write_prompt_file(output_dir, article, style_name, prompt, model)

    if provider == "openai":
        payload = {
            "model": model,
            "prompt": prompt,
            "size": size,
            "quality": quality,
        }
    else:
        payload = {
            "model": model,
            "prompt": prompt,
            "size": size,
        }

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    with httpx.Client(timeout=timeout) as client:
        try:
            response = client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            body = ""
            try:
                body = exc.response.text[:500]
            except Exception:
                body = ""

            if provider == "openai":
                fallback_payload = {
                    "model": model,
                    "prompt": prompt,
                    "size": "1024x1024",
                }
                try:
                    retry = client.post(endpoint, headers=headers, json=fallback_payload)
                    retry.raise_for_status()
                    data = retry.json()
                except Exception:
                    logger.warning("Image generation failed (%s). Returning prompt file. body=%s", exc, body)
                    return write_prompt_file(output_dir, article, style_name, prompt, model)
            else:
                logger.warning("Image generation failed (%s). Returning prompt file. body=%s", exc, body)
                return write_prompt_file(output_dir, article, style_name, prompt, model)
        except Exception as exc:
            logger.warning("Image generation error (%s). Returning prompt file.", exc)
            return write_prompt_file(output_dir, article, style_name, prompt, model)

        if isinstance(data, dict) and isinstance(data.get("data"), list) and data["data"]:
            first = data["data"][0]
            if isinstance(first, dict) and first.get("b64_json"):
                image_bytes = base64.b64decode(first["b64_json"])
                return save_image_bytes(image_bytes, output_dir, article, style_name, model)
            if isinstance(first, dict) and first.get("url"):
                image_resp = client.get(first["url"])
                image_resp.raise_for_status()
                return save_image_bytes(image_resp.content, output_dir, article, style_name, model)

        if "image_base64" in data:
            image_bytes = base64.b64decode(data["image_base64"])
            return save_image_bytes(image_bytes, output_dir, article, style_name, model)

        if "url" in data:
            image_resp = client.get(data["url"])
            image_resp.raise_for_status()
            return save_image_bytes(image_resp.content, output_dir, article, style_name, model)

    return write_prompt_file(output_dir, article, style_name, prompt, model)


def process(config_path: Path, style: str, dry_run: bool) -> None:
    config = load_config(config_path)
    output_dir = Path(config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    timeout = int(config["timeout_seconds"])

    style_desc = config["styles"].get(style)
    if not style_desc:
        available = ", ".join(sorted(config["styles"].keys()))
        raise ValueError(f"Unknown style '{style}'. Available: {available}")

    all_articles: list[Article] = []
    for source in config["sources"]:
        items = scan_feed(source, int(config["max_items_per_source"]))
        all_articles.extend(items)

    all_articles.sort(key=lambda a: a.published_at or datetime.min, reverse=True)
    run_report = []

    for article in all_articles:
        summary_mode = config["summarization"]["mode"]
        if summary_mode == "llm":
            summary = llm_summary(article, config, timeout)
        else:
            summary = extractive_summary(article)

        prompt = build_image_prompt(article, summary, style, style_desc)
        model_name = config["image"]["model"]

        if dry_run:
            output_path = write_prompt_file(output_dir, article, style, prompt, model_name)
        else:
            output_path = generate_image(prompt, article, style, config, output_dir, timeout)

        run_report.append(
            {
                "title": article.title,
                "source": article.source_name,
                "link": article.link,
                "category": article.category,
                "output": str(output_path),
                "model": model_name,
            }
        )

    report_path = output_dir / f"run_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_path.write_text(json.dumps(run_report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. Processed {len(run_report)} news items. Report: {report_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="News-to-image pipeline (RSS -> summary -> image prompt/image)")
    parser.add_argument("--config", default="config.json", help="Path to config JSON")
    parser.add_argument("--style", default="breaking", help="Visual style key from config.styles")
    parser.add_argument("--dry-run", action="store_true", help="Only create prompt text files, do not call image API")
    args = parser.parse_args()
    process(Path(args.config), args.style, args.dry_run)


if __name__ == "__main__":
    main()



