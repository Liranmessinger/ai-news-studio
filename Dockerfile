FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV RUN_BACKGROUND_WORKER=1

EXPOSE 8000

CMD ["gunicorn", "--chdir", "src", "--bind", "0.0.0.0:8000", "app:app", "--workers", "1", "--threads", "6", "--timeout", "120"]
