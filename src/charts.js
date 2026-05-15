import {
  Chart,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  DoughnutController,
  BarController,
} from "chart.js";

Chart.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  DoughnutController,
  BarController,
);

const partyColor = (hex) => {
  if (!hex || typeof hex !== "string") return "#6b7280";
  const h = hex.replace(/^#/, "");
  if (h.length === 6) return `#${h}`;
  return `#${h}`;
};

/**
 * @param {HTMLElement} canvas
 * @param {{ labels: string[]; data: number[]; colors: string[] }} opts
 */
export function renderPartyPie(canvas, { labels, data, colors }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 1,
          borderColor: "#0c0f14",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#e8ecf4", boxWidth: 12, font: { size: 11 } },
        },
        title: {
          display: true,
          text: "Ballots by party (recent votes combined)",
          color: "#8b98b0",
          font: { size: 13 },
        },
      },
    },
  });
}

/**
 * @param {HTMLElement} canvas
 * @param {string} posLabel
 * @param {string} negLabel
 * @param {number} pos
 * @param {number} neg
 */
export function renderTotalsBar(canvas, posLabel, negLabel, pos, neg) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Totals across selected votes"],
      datasets: [
        {
          label: posLabel,
          data: [pos],
          backgroundColor: "rgba(129, 199, 132, 0.75)",
        },
        {
          label: negLabel,
          data: [neg],
          backgroundColor: "rgba(229, 115, 115, 0.75)",
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#8b98b0" },
          grid: { color: "rgba(42,53,72,0.6)" },
        },
        y: {
          stacked: true,
          ticks: { color: "#8b98b0" },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#e8ecf4", font: { size: 11 } },
        },
        title: {
          display: true,
          text: "Combined official totals",
          color: "#8b98b0",
          font: { size: 13 },
        },
      },
    },
  });
}

/**
 * @param {any} division
 */
export function aggregatePartiesForDivision(division) {
  /** @type {Map<string, { party: string; color: string; content: number; notContent: number }>} */
  const map = new Map();
  const add = (m, side) => {
    const party = m.party || "Unknown";
    const color = partyColor(m.partyColour);
    if (!map.has(party)) {
      map.set(party, { party, color, content: 0, notContent: 0 });
    }
    const row = map.get(party);
    if (side === "content") row.content += 1;
    else row.notContent += 1;
  };
  for (const m of division.contents || []) add(m, "content");
  for (const m of division.notContents || []) add(m, "notContent");
  return [...map.values()].sort((a, b) => b.content + b.notContent - (a.content + a.notContent));
}

/**
 * @param {HTMLElement} canvas
 * @param {any} division
 */
export function renderDivisionPartyStacked(canvas, division) {
  const rows = aggregatePartiesForDivision(division);
  const labels = rows.map((r) => r.party);
  const posLabel = division.positiveLabel || "Content";
  const negLabel = division.negativeLabel || "Not content";
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: posLabel,
          data: rows.map((r) => r.content),
          backgroundColor: rows.map((r) => `${r.color}cc`),
        },
        {
          label: negLabel,
          data: rows.map((r) => r.notContent),
          backgroundColor: rows.map((r) => `${r.color}55`),
          borderColor: rows.map((r) => r.color),
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#8b98b0" },
          grid: { color: "rgba(42,53,72,0.6)" },
        },
        y: {
          stacked: true,
          ticks: { color: "#e8ecf4", font: { size: 10 } },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { labels: { color: "#e8ecf4", font: { size: 11 } } },
        title: {
          display: true,
          text: "Votes by party",
          color: "#8b98b0",
          font: { size: 13 },
        },
      },
    },
  });
}

/**
 * @param {HTMLElement} canvas
 * @param {any} division
 */
export function renderDivisionSplitDoughnut(canvas, division) {
  const pos =
    division.authoritativeContentCount ??
    division.memberContentCount ??
    0;
  const neg =
    division.authoritativeNotContentCount ??
    division.memberNotContentCount ??
    0;
  const posLabel = division.positiveLabel || "Content";
  const negLabel = division.negativeLabel || "Not content";
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [posLabel, negLabel],
      datasets: [
        {
          data: [pos, neg],
          backgroundColor: ["rgba(129, 199, 132, 0.85)", "rgba(229, 115, 115, 0.85)"],
          borderWidth: 1,
          borderColor: "#0c0f14",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#e8ecf4", font: { size: 11 } },
        },
        title: {
          display: true,
          text: "Official division totals",
          color: "#8b98b0",
          font: { size: 13 },
        },
      },
    },
  });
}

export { partyColor };
