"""
FastAPI backend for the Computer Price Predictor.

This replaces the original Streamlit app's logic with a set of JSON API
endpoints that a static HTML/CSS/JS frontend (in /public) can call.

Endpoints
---------
GET  /api/health                          -> simple liveness check
GET  /api/predict                         -> predicted price + interval for given specs
GET  /api/params?model=simple|full        -> model coefficients ("what drives price")
GET  /api/flags?model=simple|full         -> features whose sign is "backwards"
GET  /api/metrics?model=simple|full       -> MAE / RMSE for the model
GET  /api/residuals?model=simple|full     -> predicted vs residual points (for scatter plot)
GET  /api/price_breakdown?model=simple|full -> mean/std/count of residuals by price tier
"""

import os
from functools import lru_cache

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sklearn.metrics import mean_absolute_error, mean_squared_error

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(title="Computer Price Predictor API")

# Allow the static frontend (served from anywhere, incl. localhost during dev)
# to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_PATH = os.path.join(os.path.dirname(__file__), "Computers.csv")

SIMPLE_COLS = ["ram", "speed", "hd", "screen"]
FULL_COLS = ["ram", "speed", "hd", "screen", "ads", "trend"]
EXPECTED_SIGNS = {"ram": "+", "speed": "+", "hd": "+", "screen": "+"}


# ---------------------------------------------------------------------------
# Data + model loading (cached so we only fit each model once per process)
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def load_data() -> pd.DataFrame:
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"Could not find data file at {DATA_PATH}")
    return pd.read_csv(DATA_PATH)


def _cols_for(model_name: str):
    if model_name == "simple":
        return SIMPLE_COLS
    if model_name == "full":
        return FULL_COLS
    raise HTTPException(status_code=400, detail="model must be 'simple' or 'full'")


def prepare_features(df: pd.DataFrame, cols: list[str]):
    X = sm.add_constant(df[cols])
    y = df["price"]
    return X, y


@lru_cache(maxsize=2)
def fit_model(model_name: str):
    df = load_data()
    cols = _cols_for(model_name)
    X, y = prepare_features(df, cols)
    return sm.OLS(y, X).fit()


# ---------------------------------------------------------------------------
# Analysis helpers (ported directly from the original Streamlit script)
# ---------------------------------------------------------------------------
def get_metrics(model, X, y):
    preds = model.predict(X)
    mae = mean_absolute_error(y, preds)
    rmse = float(np.sqrt(mean_squared_error(y, preds)))
    return {"mae": mae, "rmse": rmse}


def get_residual_df(model, X, y):
    preds = model.predict(X)
    return pd.DataFrame({"predicted": preds, "residual": model.resid, "actual": y})


def flag_unintuitive_signs(model, expected_signs):
    flags = []
    for feature, expected in expected_signs.items():
        coef = model.params.get(feature)
        if coef is None:
            continue
        actual = "+" if coef > 0 else "-"
        if actual != expected:
            flags.append(
                {
                    "feature": feature,
                    "coefficient": float(coef),
                    "message": (
                        f"You'd expect price to go up with more {feature}, "
                        f"but the model says it actually goes down "
                        f"(coefficient: {coef:.2f})."
                    ),
                }
            )
    return flags


def price_range_breakdown(residual_df, bins=3):
    residual_df = residual_df.copy()
    residual_df["price_bin"] = pd.qcut(
        residual_df["actual"], bins, labels=["Low", "Mid", "High"]
    )
    grouped = residual_df.groupby("price_bin", observed=True)["residual"].agg(
        ["mean", "std", "count"]
    )
    return grouped


def predict_single(model, ram, speed, hd, screen):
    input_row = pd.DataFrame(
        {"const": [1], "ram": [ram], "speed": [speed], "hd": [hd], "screen": [screen]}
    )
    pred_summary = model.get_prediction(input_row).summary_frame(alpha=0.05)
    return pred_summary


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/predict")
def predict(
    ram: float = Query(8, ge=2, le=64, description="RAM in MB"),
    speed: float = Query(50, ge=25, le=100, description="CPU speed in MHz"),
    hd: float = Query(500, ge=80, le=2100, description="Hard drive size in MB"),
    screen: float = Query(15, ge=14, le=17, description="Screen size in inches"),
):
    model = fit_model("simple")
    result = predict_single(model, ram, speed, hd, screen)
    row = result.iloc[0]
    return {
        "predicted_price": float(row["mean"]),
        "ci_lower": float(row["obs_ci_lower"]),
        "ci_upper": float(row["obs_ci_upper"]),
    }


@app.get("/api/params")
def params(model: str = Query("simple")):
    m = fit_model(model)
    return {"params": {k: float(v) for k, v in m.params.items()}}


@app.get("/api/flags")
def flags(model: str = Query("simple")):
    m = fit_model(model)
    return {"flags": flag_unintuitive_signs(m, EXPECTED_SIGNS)}


@app.get("/api/metrics")
def metrics(model: str = Query("simple")):
    df = load_data()
    cols = _cols_for(model)
    m = fit_model(model)
    X, y = prepare_features(df, cols)
    return get_metrics(m, X, y)


@app.get("/api/residuals")
def residuals(model: str = Query("simple"), sample: int = Query(400, ge=10, le=6000)):
    df = load_data()
    cols = _cols_for(model)
    m = fit_model(model)
    X, y = prepare_features(df, cols)
    resid_df = get_residual_df(m, X, y)
    if len(resid_df) > sample:
        resid_df = resid_df.sample(sample, random_state=42)
    return {
        "points": [
            {"predicted": float(p), "residual": float(r)}
            for p, r in zip(resid_df["predicted"], resid_df["residual"])
        ]
    }


@app.get("/api/price_breakdown")
def price_breakdown(model: str = Query("simple")):
    df = load_data()
    cols = _cols_for(model)
    m = fit_model(model)
    X, y = prepare_features(df, cols)
    resid_df = get_residual_df(m, X, y)
    breakdown = price_range_breakdown(resid_df)
    return {
        "breakdown": [
            {
                "tier": tier,
                "mean": float(row["mean"]),
                "std": float(row["std"]),
                "count": int(row["count"]),
            }
            for tier, row in breakdown.iterrows()
        ]
    }
