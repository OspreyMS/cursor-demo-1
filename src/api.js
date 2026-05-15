/** @typedef {'commons' | 'lords'} House */

export const COMMONS_BASE = "https://commonsvotes-api.parliament.uk";
export const LORDS_BASE = "https://lordsvotes-api.parliament.uk";
export const MEMBERS_API = "https://members-api.parliament.uk/api";

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** @param {House} house */
export function votesBase(house) {
  return house === "commons" ? COMMONS_BASE : LORDS_BASE;
}

/** @param {any} m */
function mapCommonsMember(m) {
  if (!m || typeof m !== "object") return m;
  return {
    memberId: m.MemberId ?? m.memberId,
    name: m.Name ?? m.name,
    listAs: m.ListAs ?? m.listAs,
    memberFrom: m.MemberFrom ?? m.memberFrom,
    party: m.Party ?? m.party,
    partyColour: m.PartyColour ?? m.partyColour,
    partyAbbreviation: m.PartyAbbreviation ?? m.partyAbbreviation,
  };
}

/**
 * Normalise division JSON so downstream code can use content/notContent labels.
 * Lords: Content / Not content. Commons: `divisions.json` / `division/{id}.json` use PascalCase and Aye/No.
 * @param {any} raw
 */
export function normalizeDivision(raw) {
  if (!raw || typeof raw !== "object") return raw;

  // Commons divisions.json / division/{id}.json (PascalCase, Aye/No)
  if (raw.DivisionId != null) {
    const ayes = raw.Ayes ?? raw.ayes ?? [];
    const noes = raw.Noes ?? raw.noes ?? [];
    return {
      ...raw,
      divisionId: raw.DivisionId,
      date: raw.Date ?? raw.date,
      title: raw.Title ?? raw.title,
      number: raw.Number ?? raw.number,
      positiveLabel: "Aye",
      negativeLabel: "No",
      authoritativeContentCount: raw.AyeCount ?? 0,
      authoritativeNotContentCount: raw.NoCount ?? 0,
      contents: (Array.isArray(ayes) ? ayes : []).map(mapCommonsMember),
      notContents: (Array.isArray(noes) ? noes : []).map(mapCommonsMember),
      contentTellers: (raw.AyeTellers ?? raw.ayeTellers ?? []).map(mapCommonsMember),
      notContentTellers: (raw.NoTellers ?? raw.noTellers ?? []).map(mapCommonsMember),
      amendmentMotionNotes:
        raw.FriendlyDescription ?? raw.amendmentMotionNotes ?? null,
      notes: raw.FriendlyTitle ?? raw.notes ?? null,
    };
  }

  const hasLordsShape =
    raw.authoritativeContentCount != null ||
    Array.isArray(raw.contents) ||
    Array.isArray(raw.notContents);

  const hasCommonsAyeShape =
    Array.isArray(raw.ayes) ||
    Array.isArray(raw.noes) ||
    raw.ayeCount != null ||
    raw.noCount != null;

  if (hasCommonsAyeShape && !hasLordsShape) {
    const ayeC =
      raw.authoritativeAyeCount ??
      raw.ayeCount ??
      raw.tellerAyeCount ??
      raw.memberAyeCount ??
      0;
    const noC =
      raw.authoritativeNoCount ??
      raw.noCount ??
      raw.tellerNoCount ??
      raw.memberNoCount ??
      0;
    return {
      ...raw,
      positiveLabel: "Aye",
      negativeLabel: "No",
      authoritativeContentCount: raw.authoritativeContentCount ?? ayeC,
      authoritativeNotContentCount: raw.authoritativeNotContentCount ?? noC,
      contents: raw.contents ?? raw.ayes ?? [],
      notContents: raw.notContents ?? raw.noes ?? [],
      contentTellers: raw.contentTellers ?? raw.ayeTellers ?? [],
      notContentTellers: raw.notContentTellers ?? raw.noTellers ?? [],
    };
  }

  return {
    ...raw,
    positiveLabel: "Content",
    negativeLabel: "Not content",
  };
}

/**
 * @param {House} house
 * @param {string} path
 * @param {Record<string, string | number | boolean | undefined>} query
 */
function buildUrl(house, path, query) {
  const u = new URL(path, votesBase(house));
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * @param {House} house
 * @param {{ take?: number; skip?: number; SearchTerm?: string; MemberId?: number; IncludeWhenMemberWasTeller?: boolean; StartDate?: string; EndDate?: string; DivisionNumber?: number }} [query]
 */
export async function searchDivisions(house, query = {}) {
  const path =
    house === "commons"
      ? "/data/divisions.json/search"
      : "/data/Divisions/search";
  const url = buildUrl(house, path, {
    take: query.take ?? 25,
    skip: query.skip ?? 0,
    SearchTerm: query.SearchTerm,
    MemberId: query.MemberId,
    IncludeWhenMemberWasTeller: query.IncludeWhenMemberWasTeller,
    StartDate: query.StartDate,
    EndDate: query.EndDate,
    DivisionNumber: query.DivisionNumber,
  });
  const data = await fetchJson(url);
  return Array.isArray(data) ? data.map(normalizeDivision) : [];
}

/**
 * @param {House} house
 * @param {number} divisionId
 */
export async function getDivision(house, divisionId) {
  const url =
    house === "commons"
      ? `${COMMONS_BASE}/data/division/${divisionId}.json`
      : `${LORDS_BASE}/data/Divisions/${divisionId}`;
  const data = await fetchJson(url);
  return normalizeDivision(data);
}

/**
 * @param {House} house
 * @param {number} memberId
 */
export async function memberVoting(house, memberId, take = 50, skip = 0) {
  const path =
    house === "commons"
      ? "/data/divisions.json/membervoting"
      : "/data/Divisions/membervoting";
  const url = buildUrl(house, path, {
    MemberId: memberId,
    take,
    skip,
  });
  const data = await fetchJson(url);
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const pub = row.PublishedDivision ?? row.publishedDivision;
    return {
      ...row,
      memberId: row.MemberId ?? row.memberId,
      memberWasContent: row.memberWasContent ?? row.MemberVotedAye,
      memberWasTeller: row.memberWasTeller ?? row.MemberWasTeller,
      publishedDivision: normalizeDivision(pub),
    };
  });
}

/**
 * @param {string} name
 */
export async function searchMembersByName(name) {
  const u = new URL("/Members/Search", MEMBERS_API);
  u.searchParams.set("Name", name);
  u.searchParams.set("skip", "0");
  u.searchParams.set("take", "20");
  const data = await fetchJson(u.toString());
  const items = data.items ?? [];
  return items.map((wrap) => {
    const v = wrap.value;
    const house = v.latestHouseMembership?.house;
    return {
      id: v.id,
      displayName: v.nameDisplayAs,
      listAs: v.nameListAs,
      house,
      houseLabel: house === 1 ? "Commons" : house === 2 ? "Lords" : "Unknown",
      party: v.latestParty?.name,
    };
  });
}
