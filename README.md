# PC Quote Predictor — FastAPI + HTML/CSS/JS

- **Backend**: FastAPI (`api/index.py`) — fits the two OLS regression
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

1. Pushed this folder to a GitHub repo (or run `vercel` from inside it with the
   Vercel CLI installed).
2. `vercel.json` already routes:
   - `/api/*` → the Python serverless function (`api/index.py`, using the
     `@vercel/python` runtime, which reads `requirements.txt`)
   - everything else → static files in `public/`
3. Deployed:
   ```bash
   npm i -g vercel   # if you don't have it
   vercel             # first deploy / link project
   vercel --prod      # promote to production
   ```
4. Vercel built the Python function automatically. No environment
   variables are required — the dataset ships alongside `index.py`.


