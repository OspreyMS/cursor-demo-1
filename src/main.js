import "./styles.css";
import {
  searchDivisions,
  getDivision,
  memberVoting,
  searchMembersByName,
} from "./api.js";
import {
  renderPartyPie,
  renderTotalsBar,
  renderDivisionPartyStacked,
  renderDivisionSplitDoughnut,
  partyColor,
} from "./charts.js";

/** @type {import('chart.js').Chart[]} */
let activeCharts = [];

function destroyCharts() {
  for (const c of activeCharts) {
    try {
      c.destroy();
    } catch {
      /* ignore */
    }
  }
  activeCharts = [];
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

/** @param {string} html */
function stripHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").trim();
}

/**
 * Surname sort key: prefers `listAs` ("Smith, J.") when comma-separated, else last token of display name.
 * @param {{ listAs?: string; name?: string; displayName?: string }} m
 */
function sortKeyBySurname(m) {
  const listAs = (m.listAs || "").trim();
  if (listAs.includes(",")) {
    return listAs.split(",")[0].trim().toLowerCase();
  }
  const name = (m.name || m.displayName || "").trim();
  if (!name) return "\uffff";
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length ? parts[parts.length - 1] : name).toLowerCase();
}

/**
 * @template T
 * @param {T[]} members
 * @returns {T[]}
 */
function sortMembersBySurname(members) {
  return [...members].sort((a, b) =>
    sortKeyBySurname(a).localeCompare(sortKeyBySurname(b), "en", {
      sensitivity: "base",
    }),
  );
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * @param {{ party: string; count: number; color: string }[]} rows
 */
function buildPartyPieData(rows) {
  const labels = rows.map((r) => r.party);
  const data = rows.map((r) => r.count);
  const colors = rows.map((r) => partyColor(r.color));
  return { labels, data, colors };
}

/**
 * @param {any[]} divisions
 */
function aggregatePartyBallots(divisions) {
  /** @type {Map<string, { party: string; count: number; color: string }>} */
  const map = new Map();
  for (const d of divisions) {
    const lists = [
      ...(d.contents || []),
      ...(d.notContents || []),
    ];
    for (const m of lists) {
      const party = m.party || "Unknown";
      const color = m.partyColour || "";
      if (!map.has(party)) {
        map.set(party, { party, count: 0, color });
      }
      const row = map.get(party);
      row.count += 1;
      if (!row.color && color) row.color = color;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function parseRoute() {
  const h = (window.location.hash || "#/").replace(/^#/, "") || "/";
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  return { parts, params };
}

function setHash(hash) {
  window.location.hash = hash;
}

function headerHtml(active) {
  return `
    <header class="site-header">
      <div>
        <h1>UK Parliament votes</h1>
        <p>Live divisions from the official Commons and Lords Votes APIs, with charts and member search.</p>
      </div>
      <nav class="main-nav">
        <a href="#/" class="${active === "home" ? "active" : ""}">Home</a>
        <a href="#/search/motion" class="${active === "motion" ? "active" : ""}">Search divisions</a>
        <a href="#/search/member" class="${active === "member" ? "active" : ""}">Search by name</a>
      </nav>
    </header>
  `;
}

function footerHtml() {
  return `
    <footer class="site-footer">
      Data sources:
      <a href="https://commonsvotes-api.parliament.uk/swagger/ui/index" target="_blank" rel="noopener noreferrer">Commons Votes API</a>
      and
      <a href="https://lordsvotes-api.parliament.uk/index.html" target="_blank" rel="noopener noreferrer">Lords Votes API</a>
      (UK Parliament). Member lookup uses the
      <a href="https://members-api.parliament.uk/" target="_blank" rel="noopener noreferrer">Members API</a>.
    </footer>
  `;
}

function voteCardHtml(house, d) {
  const pos = d.positiveLabel || "Content";
  const neg = d.negativeLabel || "Not content";
  const py = d.authoritativeContentCount ?? d.memberContentCount ?? 0;
  const pn = d.authoritativeNotContentCount ?? d.memberNotContentCount ?? 0;
  return `
    <article class="vote-card" data-nav="vote" data-house="${house}" data-id="${d.divisionId}">
      <h3>${esc(d.title || "Division")}</h3>
      <div class="meta">${formatDate(d.date)} · Division ${d.number ?? ""}</div>
      <div class="counts">
        <span class="yes">${esc(pos)}: ${py}</span>
        <span class="no">${esc(neg)}: ${pn}</span>
      </div>
    </article>
  `;
}

async function loadRecent(house) {
  try {
    const list = await searchDivisions(house, { take: 3, skip: 0 });
    return { house, ok: true, list };
  } catch (e) {
    return {
      house,
      ok: false,
      list: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function renderHome(app) {
  destroyCharts();
  app.innerHTML = `
    ${headerHtml("home")}
    <div id="home-content" class="loading">Loading recent divisions…</div>
    ${footerHtml()}
  `;

  const [commons, lords] = await Promise.all([
    loadRecent("commons"),
    loadRecent("lords"),
  ]);

  const allOkDivisions = [
    ...(commons.ok ? commons.list : []),
    ...(lords.ok ? lords.list : []),
  ];

  const alerts = [];
  if (!commons.ok) {
    alerts.push(
      `<div class="alert">Commons Votes API could not be reached (${esc(commons.error)}). If this persists, check the service status at <a href="https://commonsvotes-api.parliament.uk/swagger/ui/index" target="_blank" rel="noopener noreferrer">Commons Votes API</a>.</div>`,
    );
  }
  if (!lords.ok) {
    alerts.push(
      `<div class="alert">Lords Votes API error: ${esc(lords.error)}</div>`,
    );
  }

  const partyRows = aggregatePartyBallots(allOkDivisions);
  const pieData = buildPartyPieData(partyRows.slice(0, 18));
  let posTotal = 0;
  let negTotal = 0;
  let posLabel = "Content / Aye";
  let negLabel = "Not content / No";
  for (const d of allOkDivisions) {
    posTotal +=
      d.authoritativeContentCount ?? d.memberContentCount ?? 0;
    negTotal +=
      d.authoritativeNotContentCount ?? d.memberNotContentCount ?? 0;
    if (d.positiveLabel === "Aye") {
      posLabel = "Aye";
      negLabel = "No";
    }
  }

  const homeContent = document.getElementById("home-content");
  if (!homeContent) return;

  homeContent.classList.remove("loading");
  homeContent.innerHTML = `
    ${alerts.join("")}
    <div class="vote-grid two-col">
      <section class="panel">
        <h2><span class="badge commons">Commons</span> Latest three divisions</h2>
        <div class="vote-grid">
          ${commons.ok && commons.list.length
            ? commons.list.map((d) => voteCardHtml("commons", d)).join("")
            : `<p class="loading">No Commons data.</p>`}
        </div>
      </section>
      <section class="panel">
        <h2><span class="badge lords">Lords</span> Latest three divisions</h2>
        <div class="vote-grid">
          ${lords.ok && lords.list.length
            ? lords.list.map((d) => voteCardHtml("lords", d)).join("")
            : `<p class="loading">No Lords data.</p>`}
        </div>
      </section>
    </div>
    <section class="panel">
      <h2>Charts for the six divisions above</h2>
      <div class="charts-row">
        <div class="chart-wrap"><canvas id="chart-party" width="400" height="280"></canvas></div>
        <div class="chart-wrap"><canvas id="chart-totals" width="400" height="280"></canvas></div>
      </div>
      <p style="margin:0;font-size:0.85rem;color:var(--muted)">
        The doughnut counts each named vote cast in those divisions by party. The bar uses each division’s official totals (tellers where used).
      </p>
    </section>
  `;

  wireVoteCards(app);

  const c1 = /** @type {HTMLCanvasElement} */ (document.getElementById("chart-party"));
  const c2 = /** @type {HTMLCanvasElement} */ (document.getElementById("chart-totals"));
  if (c1 && pieData.labels.length) {
    const ch = renderPartyPie(c1, pieData);
    if (ch) activeCharts.push(ch);
  }
  if (c2 && (posTotal || negTotal)) {
    const ch2 = renderTotalsBar(c2, posLabel, negLabel, posTotal, negTotal);
    if (ch2) activeCharts.push(ch2);
  }
}

function wireVoteCards(root) {
  root.querySelectorAll(".vote-card[data-nav='vote']").forEach((el) => {
    el.addEventListener("click", () => {
      const house = el.getAttribute("data-house");
      const id = el.getAttribute("data-id");
      if (house && id) setHash(`/vote/${house}/${id}`);
    });
  });
}

async function renderVoteDetail(app, house, idStr) {
  destroyCharts();
  const id = Number(idStr);
  app.innerHTML = `
    ${headerHtml("")}
    <div class="loading">Loading division…</div>
    ${footerHtml()}
  `;
  const loadingEl = app.querySelector(".loading");
  try {
    const division = await getDivision(
      house === "commons" ? "commons" : "lords",
      id,
    );
    loadingEl?.remove();
    const posL = division.positiveLabel || "Content";
    const negL = division.negativeLabel || "Not content";
    const badge =
      house === "commons"
        ? `<span class="badge commons">Commons</span>`
        : `<span class="badge lords">Lords</span>`;
    const motionPlain = stripHtml(
      division.amendmentMotionNotes || division.notes || "",
    );
    app.innerHTML = `
      ${headerHtml("")}
      <section class="panel division-detail">
        <p style="margin:0 0 0.5rem">${badge}</p>
        <h2>${esc(division.title || "Division")}</h2>
        <div class="stats-row">
          <div class="stat">${formatDate(division.date)}</div>
          <div class="stat">Division ${division.number ?? ""}</div>
          <div class="stat">${esc(posL)}: <strong>${division.authoritativeContentCount ?? 0}</strong></div>
          <div class="stat">${esc(negL)}: <strong>${division.authoritativeNotContentCount ?? 0}</strong></div>
        </div>
        ${motionPlain ? `<div class="motion-html" style="white-space:pre-wrap">${esc(motionPlain)}</div>` : ""}
        <p><a href="#/">← Back to home</a></p>
        <div class="charts-row">
          <div class="chart-wrap"><canvas id="d-split"></canvas></div>
          <div class="chart-wrap"><canvas id="d-party"></canvas></div>
        </div>
        <div class="member-columns">
          <details class="collapsible" open>
            <summary>${esc(posL)} (${(division.contents || []).length})</summary>
            <div class="member-list">${memberListHtml(division.contents || [])}</div>
          </details>
          <details class="collapsible" open>
            <summary>${esc(negL)} (${(division.notContents || []).length})</summary>
            <div class="member-list">${memberListHtml(division.notContents || [])}</div>
          </details>
        </div>
      </section>
      ${footerHtml()}
    `;
    const c1 = /** @type {HTMLCanvasElement} */ (document.getElementById("d-split"));
    const c2 = /** @type {HTMLCanvasElement} */ (document.getElementById("d-party"));
    if (c1) {
      const ch = renderDivisionSplitDoughnut(c1, division);
      if (ch) activeCharts.push(ch);
    }
    if (c2) {
      const ch = renderDivisionPartyStacked(c2, division);
      if (ch) activeCharts.push(ch);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (loadingEl) loadingEl.remove();
    app.innerHTML = `
      ${headerHtml("")}
      <div class="alert">Could not load this division (${esc(msg)}).</div>
      <p><a href="#/">← Back to home</a></p>
      ${footerHtml()}
    `;
  }
}

function memberListHtml(members) {
  if (!members.length) return "<em>No individual entries returned.</em>";
  return sortMembersBySurname(members)
    .map((m) => {
      const line = `${m.name || m.listAs || "Member"} — ${m.party || ""}${m.memberFrom ? ` · ${m.memberFrom}` : ""}`;
      return `<div>${esc(line)}</div>`;
    })
    .join("");
}

function renderMotionSearch(app) {
  destroyCharts();
  app.innerHTML = `
    ${headerHtml("motion")}
    <section class="panel">
      <h2>Search divisions by keyword</h2>
      <p style="color:var(--muted);font-size:0.9rem;margin-top:0">Matches motion titles and supporting text exposed by the API <code>SearchTerm</code> parameter.</p>
      <form class="search-form" id="motion-form">
        <input type="search" name="q" placeholder="e.g. housing, amendment, bill name…" autocomplete="off" />
        <button type="submit">Search both houses</button>
      </form>
      <div id="motion-results"></div>
    </section>
    ${footerHtml()}
  `;
  const form = /** @type {HTMLFormElement} */ (document.getElementById("motion-form"));
  const results = document.getElementById("motion-results");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const q = String(fd.get("q") || "").trim();
    if (!q || !results) return;
    results.innerHTML = `<p class="loading">Searching…</p>`;
    const [c, l] = await Promise.all([
      searchDivisions("commons", { SearchTerm: q, take: 15 }).catch(
        () => ({ error: true }),
      ),
      searchDivisions("lords", { SearchTerm: q, take: 15 }).catch(
        () => ({ error: true }),
      ),
    ]);
    const bits = [];
    if (Array.isArray(c)) {
      bits.push(
        `<h3 style="margin:1rem 0 0.5rem"><span class="badge commons">Commons</span></h3>`,
      );
      if (!c.length) bits.push("<p class=\"loading\">No Commons matches.</p>");
      else
        bits.push(
          `<div class="vote-grid">${c.map((d) => voteCardHtml("commons", d)).join("")}</div>`,
        );
    } else {
      bits.push(
        `<div class="alert">Commons search failed — the Commons Votes endpoint may be unavailable.</div>`,
      );
    }
    if (Array.isArray(l)) {
      bits.push(
        `<h3 style="margin:1rem 0 0.5rem"><span class="badge lords">Lords</span></h3>`,
      );
      if (!l.length) bits.push("<p class=\"loading\">No Lords matches.</p>");
      else
        bits.push(
          `<div class="vote-grid">${l.map((d) => voteCardHtml("lords", d)).join("")}</div>`,
        );
    } else {
      bits.push(`<div class="alert">Lords search failed.</div>`);
    }
    results.innerHTML = bits.join("");
    wireVoteCards(app);
  });
}

function renderMemberSearch(app) {
  destroyCharts();
  app.innerHTML = `
    ${headerHtml("member")}
    <section class="panel">
      <h2>Find a member and their voting record</h2>
      <p style="color:var(--muted);font-size:0.9rem;margin-top:0">Uses the Members API name search, then loads divisions from the Votes API for the correct house.</p>
      <form class="search-form" id="member-form">
        <input type="search" name="name" placeholder="Surname or full name…" autocomplete="off" />
        <button type="submit">Search members</button>
      </form>
      <div id="member-pick"></div>
      <div id="member-votes"></div>
    </section>
    ${footerHtml()}
  `;
  const form = /** @type {HTMLFormElement} */ (document.getElementById("member-form"));
  const pick = document.getElementById("member-pick");
  const votesEl = document.getElementById("member-votes");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    if (!name || !pick || !votesEl) return;
    pick.innerHTML = `<p class="loading">Searching directory…</p>`;
    votesEl.innerHTML = "";
    try {
      const members = await searchMembersByName(name);
      if (!members.length) {
        pick.innerHTML = `<p class="loading">No members matched.</p>`;
        return;
      }
      pick.innerHTML = `
        <p style="font-size:0.9rem;color:var(--muted)">Select a member:</p>
        <ul class="member-results">
          ${sortMembersBySurname(members)
            .map(
              (m) => `
            <li>
              <button type="button" data-mid="${m.id}" data-house="${m.house ?? ""}" ${m.house !== 1 && m.house !== 2 ? "disabled" : ""}>
                <strong>${esc(m.displayName)}</strong>
                <span style="color:var(--muted)"> · ${esc(m.houseLabel)} · ${esc(m.party || "")}</span>
              </button>
            </li>`,
            )
            .join("")}
        </ul>`;
      pick.querySelectorAll("button[data-mid]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const mid = Number(btn.getAttribute("data-mid"));
          const houseNum = Number(btn.getAttribute("data-house"));
          const house = houseNum === 1 ? "commons" : "lords";
          votesEl.innerHTML = `<p class="loading">Loading divisions…</p>`;
          try {
            const records = await memberVoting(house, mid, 40, 0);
            if (!records.length) {
              votesEl.innerHTML = `<p class="loading">No divisions returned for this member in the ${house === "commons" ? "Commons" : "Lords"} API.</p>`;
              return;
            }
            votesEl.innerHTML = `
              <h3 style="margin-top:1rem">Recent divisions</h3>
              <div class="vote-grid">
                ${records
                  .map((r) => {
                    const d = r.publishedDivision;
                    if (!d || !d.divisionId) return "";
                    return voteCardHtml(house, d);
                  })
                  .join("")}
              </div>`;
            wireVoteCards(app);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            votesEl.innerHTML = `<div class="alert">${esc(msg)}</div>`;
          }
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pick.innerHTML = `<div class="alert">${esc(msg)}</div>`;
    }
  });
}

async function route() {
  const app = document.getElementById("app");
  if (!app) return;
  const { parts } = parseRoute();
  if (parts[0] === "vote" && parts[1] && parts[2]) {
    await renderVoteDetail(app, parts[1], parts[2]);
    return;
  }
  if (parts[0] === "search" && parts[1] === "motion") {
    renderMotionSearch(app);
    return;
  }
  if (parts[0] === "search" && parts[1] === "member") {
    renderMemberSearch(app);
    return;
  }
  await renderHome(app);
}

window.addEventListener("hashchange", () => {
  route();
});

route();
