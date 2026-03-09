# AI News Studio

מערכת מלאה שמריצה מנוע חדשות ברקע ומציגה את התוצרים באתר:
- סריקה מפידים (Rotter, Ynet, Calcalist, Reuters ועוד).
- סיכום לכל ידיעה.
- יצירת תמונה דרך OpenAI Images (ברירת מחדל: `gpt-image-1`) או שמירת פרומפט.
- שמירה ב־SQLite עם כותרת, מקור, קטגוריה, קישור, תאריך פרסום ותאריך יצירה.
- תצוגת אתר RTL מעוצבת + API לשימוש עתידי באפליקציה.

## מבנה
- `src/news_image_pipeline.py` מנוע הלוגיקה (פידים, סיכום, פרומפט, יצירת תמונה).
- `src/app.py` שרת Flask + scheduler ברקע + DB.
- `src/templates/index.html` ממשק האתר.
- `src/static/site.css` עיצוב האתר.
- `config.json` הגדרות מקורות, סגנונות, זמני ריצה וחיבורי API.
- `news.db` נוצר אוטומטית בהרצה הראשונה.
- `output/` נוצר אוטומטית ושומר תמונות/פרומפטים.

## התקנה מקומית
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## הגדרת API לתמונות (OpenAI Images)
1. הגדר `IMAGE_API_KEY`:
```powershell
$env:IMAGE_API_KEY = "YOUR_KEY"
```
2. ב־`config.json`, הגדר `image.endpoint` לכתובת ה־API שלך.

אם אין endpoint/key, המערכת תמשיך לעבוד ותשמור קבצי פרומפטים במקום תמונות.

## הפעלת האתר
```powershell
python src/app.py
```
האתר יעלה ב:
- `http://localhost:8000`

### מה קורה ברקע
- כל `scheduler_interval_minutes` (ברירת מחדל 15) המנוע סורק פידים.
- לכל ידיעה הוא מייצר תקציר + פרומפט + תמונה/קובץ פרומפט.
- כל תוצר נשמר ל־`news.db` ומוצג מיד באתר.

## API לאפליקציה עתידית
- `GET /api/news?limit=50&category=&style=`
- `POST /api/trigger` להרצת סבב ידני מיידי

## התאמה אישית
ב־`config.json`:
- `sources`: הוסף/הסר מקורות RSS.
- `styles`: הוסף סגנונות חדשים.
- `default_style`: סגנון ברירת מחדל.
- `source_style_map`: סגנון לפי מקור.
- `category_style_map`: סגנון לפי קטגוריה.

## פריסה ל־AWS
אפשר לפרוס בקלות ל־ECS/App Runner/Elastic Beanstalk באמצעות Docker.

### Build + run מקומי עם Docker
```powershell
docker build -t ai-news-studio .
docker run -p 8000:8000 --name ai-news-studio ai-news-studio
```

> ב־production מומלץ למפות volume כדי לשמור `news.db` ו־`output` גם אחרי restart.


