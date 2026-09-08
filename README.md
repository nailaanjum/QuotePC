# Computer Price Predictor — FastAPI + HTML/CSS/JS

This is a rewrite of the original Streamlit app into:
- **Backend**: FastAPI (`api/index.py`) — fits the same two OLS regression
  models (`simple`: ram/speed/hd/screen, `full`: + ads/trend) and exposes
  them as JSON endpoints.
- **Frontend**: plain HTML/CSS/JS (`public/`) — a spec-sheet-styled UI with
  live sliders (Predict tab) and a "How It Works" tab with a coefficients
  table, residual scatter chart (Chart.js), accuracy metrics, and a
  price-tier error breakdown — a 1:1 port of what the Streamlit tabs showed.

```
computer-price-app/
├── api/
│   ├── index.py        # FastAPI app + all analysis logic
│   └── Computers.csv    # dataset (must stay next to index.py)
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── requirements.txt
├── vercel.json
└── README.md
```

## API endpoints

| Method | Path                    | Purpose                                      |
|--------|--------------------------|-----------------------------------------------|
| GET    | `/api/health`            | Liveness check                                |
| GET    | `/api/predict`            | `?ram=&speed=&hd=&screen=` → predicted price + 95% interval |
| GET    | `/api/params`             | `?model=simple\|full` → regression coefficients |
| GET    | `/api/flags`              | `?model=simple\|full` → features with "backwards" signs |
| GET    | `/api/metrics`            | `?model=simple\|full` → MAE / RMSE            |
| GET    | `/api/residuals`          | `?model=simple\|full&sample=` → predicted/residual points for the scatter plot |
| GET    | `/api/price_breakdown`    | `?model=simple\|full` → mean/std/count of error by Low/Mid/High price tier |

## Run locally

```bash
pip install -r requirements.txt
uvicorn api.index:app --reload --port 8000
```

Then serve `public/` with any static server, e.g.:

```bash
cd public
python3 -m http.server 5500
```

Open `http://127.0.0.1:5500`. Since the frontend calls a **relative** `/api/...`
path (see the `API_BASE` constant at the top of `app.js`), if your API and
static files are on different ports locally, change `API_BASE` to
`http://127.0.0.1:8000/api` for local testing. On Vercel this isn't needed —
both are served from the same origin.

## Deploy to Vercel

1. Push this folder to a GitHub repo (or run `vercel` from inside it with the
   Vercel CLI installed).
2. `vercel.json` already routes:
   - `/api/*` → the Python serverless function (`api/index.py`, using the
     `@vercel/python` runtime, which reads `requirements.txt`)
   - everything else → static files in `public/`
3. Deploy:
   ```bash
   npm i -g vercel   # if you don't have it
   vercel             # first deploy / link project
   vercel --prod      # promote to production
   ```
4. Vercel will build the Python function automatically. No environment
   variables are required — the dataset ships alongside `index.py`.

**Note on Vercel serverless + `lru_cache`**: each serverless invocation may
spin up a fresh process, so the model gets refit on cold starts (it's a fast
OLS fit on ~6k rows, so this is not a performance concern). Within a warm
instance, `lru_cache` avoids refitting on every request.

## Alternative: keep it on Streamlit

If you'd rather deploy the original single-file Streamlit app instead of the
FastAPI/JS split (e.g., because Streamlit Community Cloud is free and simpler
for a personal/demo project), you can still do that — just keep the original
`app.py` + `Computers.csv` in a repo and deploy via
[share.streamlit.io](https://share.streamlit.io). The FastAPI+JS version in
this folder is the one to use if you want a fully custom-styled frontend or
plan to deploy on Vercel specifically, since Vercel doesn't run long-lived
Streamlit servers natively.
