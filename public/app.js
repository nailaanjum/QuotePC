// Base URL for the API. On Vercel, the frontend and API share an origin,
// so a relative "/api" path works. If you run the API separately (e.g.
// `uvicorn api.index:app --reload` on a different port), change this to
// something like "http://127.0.0.1:8000/api".
const API_BASE = "/api";

const statusMsg = document.getElementById("statusMsg");

function setStatus(text, isError = false) {
  statusMsg.textContent = text;
  statusMsg.style.color = isError ? "#b5721f" : "";
}

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed: ${path} (${res.status})`);
  }
  return res.json();
}

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    tabPanels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");

    if (btn.dataset.tab === "how") {
      loadHowItWorks();
    }
  });
});

// ---------------------------------------------------------------------
// Predict tab
// ---------------------------------------------------------------------
const ram = document.getElementById("ram");
const speed = document.getElementById("speed");
const hd = document.getElementById("hd");
const screen = document.getElementById("screen");

const ramVal = document.getElementById("ramVal");
const speedVal = document.getElementById("speedVal");
const hdVal = document.getElementById("hdVal");
const screenVal = document.getElementById("screenVal");

const predictedPrice = document.getElementById("predictedPrice");
const predictedCaption = document.getElementById("predictedCaption");

let predictTimer = null;

function fmtUSD(n) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

async function runPrediction() {
  ramVal.textContent = ram.value;
  speedVal.textContent = speed.value;
  hdVal.textContent = hd.value;
  screenVal.textContent = screen.value;

  try {
    const params = new URLSearchParams({
      ram: ram.value,
      speed: speed.value,
      hd: hd.value,
      screen: screen.value,
    });
    const data = await getJSON(`/predict?${params.toString()}`);
    predictedPrice.textContent = fmtUSD(data.predicted_price);
    predictedCaption.textContent =
      `We're fairly confident the real price would fall somewhere between ` +
      `${fmtUSD(data.ci_lower)} and ${fmtUSD(data.ci_upper)}.`;
    setStatus("");
  } catch (err) {
    setStatus("Couldn't reach the prediction API. Is the backend running?", true);
    console.error(err);
  }
}

function debouncedPredict() {
  clearTimeout(predictTimer);
  predictTimer = setTimeout(runPrediction, 120);
}

[ram, speed, hd, screen].forEach((el) => el.addEventListener("input", debouncedPredict));

// ---------------------------------------------------------------------
// How It Works tab
// ---------------------------------------------------------------------
const paramsTable = document.getElementById("paramsTable");
const flagsBox = document.getElementById("flagsBox");
const maeVal = document.getElementById("maeVal");
const rmseVal = document.getElementById("rmseVal");
const breakdownTable = document.getElementById("breakdownTable");

let residualChart = null;

function currentModelChoice() {
  return document.querySelector('input[name="modelChoice"]:checked').value;
}

function renderParamsTable(params) {
  const rows = Object.entries(params)
    .map(
      ([feature, value]) =>
        `<tr><td>${feature}</td><td class="num">${value.toFixed(2)}</td></tr>`
    )
    .join("");
  paramsTable.innerHTML = `
    <thead><tr><th>Feature</th><th class="num">Effect on price</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderFlags(flags) {
  if (flags.length === 0) {
    flagsBox.innerHTML = `
      <div class="flag-box ok">
        <p>All features behave the way you'd expect — more of each raises the price.</p>
      </div>`;
    return;
  }
  const items = flags
    .map((f) => `<p><strong>${f.feature}</strong>: ${f.message}</p>`)
    .join("");
  flagsBox.innerHTML = `
    <div class="flag-box">
      <p><strong>A few things came out backwards from what we'd normally expect:</strong></p>
      ${items}
    </div>`;
}

function renderMetrics(metrics) {
  maeVal.textContent = fmtUSD(metrics.mae);
  rmseVal.textContent = fmtUSD(metrics.rmse);
}

function renderBreakdown(breakdown) {
  const rows = breakdown
    .map(
      (row) => `
      <tr>
        <td>${row.tier}</td>
        <td class="num">${fmtUSD(row.mean)}</td>
        <td class="num">${fmtUSD(row.std)}</td>
        <td class="num">${row.count}</td>
      </tr>`
    )
    .join("");
  breakdownTable.innerHTML = `
    <thead><tr><th>Price tier</th><th class="num">Mean error</th><th class="num">Std dev</th><th class="num">Count</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderResidualChart(points) {
  const ctx = document.getElementById("residualChart").getContext("2d");
  const data = points.map((p) => ({ x: p.predicted, y: p.residual }));

  if (residualChart) {
    residualChart.data.datasets[0].data = data;
    residualChart.update();
    return;
  }

  residualChart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Predicted vs. error",
          data,
          backgroundColor: "rgba(47, 143, 91, 0.45)",
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        annotationLine: false,
      },
      scales: {
        x: { title: { display: true, text: "Predicted price" } },
        y: { title: { display: true, text: "Error (actual − predicted)" } },
      },
    },
    plugins: [
      {
        id: "zeroLine",
        afterDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          const y0 = scales.y.getPixelForValue(0);
          ctx.save();
          ctx.strokeStyle = "#b5721f";
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y0);
          ctx.lineTo(chartArea.right, y0);
          ctx.stroke();
          ctx.restore();
        },
      },
    ],
  });
}

async function loadHowItWorks() {
  const model = currentModelChoice();
  setStatus("Loading model details…");
  try {
    const [paramsData, flagsData, metricsData, residualsData, breakdownData] =
      await Promise.all([
        getJSON(`/params?model=${model}`),
        getJSON(`/flags?model=${model}`),
        getJSON(`/metrics?model=${model}`),
        getJSON(`/residuals?model=${model}`),
        getJSON(`/price_breakdown?model=${model}`),
      ]);

    renderParamsTable(paramsData.params);
    renderFlags(flagsData.flags);
    renderMetrics(metricsData);
    renderResidualChart(residualsData.points);
    renderBreakdown(breakdownData.breakdown);
    setStatus("");
  } catch (err) {
    setStatus("Couldn't reach the API. Is the backend running?", true);
    console.error(err);
  }
}

document.querySelectorAll('input[name="modelChoice"]').forEach((radio) => {
  radio.addEventListener("change", loadHowItWorks);
});

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
runPrediction();
