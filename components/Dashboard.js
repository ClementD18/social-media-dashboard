import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import Papa from "papaparse";
import _ from "lodash";
import * as XLSX from "xlsx";

/* ─── HELPERS ─── */
const fmt = v => {
  if (v === null || v === undefined || v === "") return "\u2014";
  const n = Number(v);
  if (isNaN(n)) return "\u2014";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("fr-FR");
};
const fmtDate = v => { if (!v) return "\u2014"; try { const d = new Date(v); return isNaN(d) ? "\u2014" : d.toLocaleDateString("fr-FR"); } catch { return "\u2014"; } };
const typeIcon = t => { if (!t && t !== 0) return "\ud83d\udcdd"; const l = String(t).toLowerCase(); if (l.includes("video") || l.includes("reel") || l.includes("short")) return "\ud83c\udfac"; if (l.includes("sidecar") || l.includes("carousel")) return "\ud83d\udcf8"; return "\ud83d\uddbc"; };
const isVideo = t => { if (!t && t !== 0) return false; const l = String(t).toLowerCase(); return l.includes("video") || l.includes("reel") || l.includes("short"); };
const calcEng = r => { const v = Number(r.views) || 0, l = Number(r.likes) || 0, c = Number(r.comments) || 0; return v > 0 ? (l + c) / v : 0; };
const renderEng = r => { const e = calcEng(r); return e > 0 ? <span style={{ color: "#34d399", fontWeight: 600 }}>{(e * 100).toFixed(2)}%</span> : "\u2014"; };
const cleanCap = c => String(c || "").replace(/[^\w\s\u00e0-\u00ff\u0152\u0153.,!?:()@#%\u20ac$&+\-'/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

/* ─── PLATFORM ICONS (Instagram + TikTok) ─── */
const platformIcon = p => { if (p === "tiktok") return "\ud83c\udfb5"; if (p === "youtube") return "\u25b6\ufe0f"; if (p === "facebook") return "\ud83d\udc4d"; return "\ud83d\udcf8"; };
const platformColor = p => {
  switch (p) {
    case "tiktok": return { bg: "rgba(255,255,255,0.1)", color: "#fff" };
    case "youtube": return { bg: "rgba(255,0,0,0.12)", color: "#FF0000" };
    case "facebook": return { bg: "rgba(24,119,242,0.15)", color: "#1877F2" };
    default: return { bg: "rgba(225,48,108,0.15)", color: "#E1306C" };
  }
};

function getWeekLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return "S" + w;
}

/* ──────────────────────────────────────────────────────────────
   CLASSIFICATION AUTOMATIQUE CHAUD / FROID PAR MOTS-CLÉS
   ────────────────────────────────────────────────────────────── */

const HOT_KEYWORDS = [
  /* ── Politique ── */
  "macron", "\u00e9lection", "\u00e9lections", "municipales", "l\u00e9gislatives",
  "assembl\u00e9e nationale", "assembl\u00e9e", "s\u00e9nat", "gouvernement", "ministre",
  "premier ministre", "r\u00e9forme", "manifestation", "gr\u00e8ve", "gr\u00e8ves",
  "politique", "vote", "scrutin", "pr\u00e9sident de la r\u00e9publique",
  "parti politique", "lfi", "rassemblement national",
  "renaissance", "nupes", "d\u00e9put\u00e9", "d\u00e9put\u00e9s", "remaniement",
  "motion de censure", "49.3", "dissolution", "r\u00e9f\u00e9rendum",
  "extr\u00eame droite", "extr\u00eame gauche", "m\u00e9lenchon", "le pen",
  "bardella", "attal", "borne", "bayrou",

  /* ── Faits divers / Justice ── */
  "meurtre", "meurtrier", "homicide", "assassinat", "assassin",
  "agression", "agresseur", "viol", "violeur", "proc\u00e8s", "tribunal",
  "garde \u00e0 vue", "garde a vue", "mis en examen", "condamn\u00e9", "condamnation",
  "arr\u00eat\u00e9", "arrestation", "interpell\u00e9", "interpellation",
  "suspect", "soup\u00e7onn\u00e9", "enqu\u00eate", "gendarmerie", "police judiciaire",
  "crime", "criminel", "enl\u00e8vement", "kidnapping", "disparition inqui\u00e9tante",
  "fugitif", "cavale", "fusillade", "braquage", "cambriolage",
  "trafic de drogue", "trafiquant", "narcotrafic", "narcotrafiquant",
  "f\u00e9minicide", "infanticide", "p\u00e9docriminalit\u00e9", "p\u00e9dophile",
  "terrorisme", "terroriste", "attentat", "radicalisation",
  "coups de couteau", "poignard\u00e9", "bless\u00e9 par balle",
  "incarc\u00e9r\u00e9", "prison", "d\u00e9tenu", "\u00e9vasion",
  "cour d'assises", "cour d assises", "perp\u00e9tuit\u00e9", "r\u00e9cidiviste",

  /* ── Guerre / Actu internationale ── */
  "ukraine", "gaza", "isra\u00ebl", "israel", "palestine", "palestinien",
  "russie", "guerre", "conflit arm\u00e9", "bombardement", "missile",
  "otage", "otages", "hamas", "hezbollah", "poutine", "zelensky",
  "otan", "offensive", "cessez-le-feu", "cessez le feu",
  "trump", "biden", "kamala", "sanctions internationales",
  "syrie", "iran", "cor\u00e9e du nord", "coree du nord", "ta\u00efwan", "taiwan",
  "coup d'\u00e9tat", "coup d etat", "g\u00e9nocide", "massacre",
  "r\u00e9fugi\u00e9s", "migrants", "immigration clandestine",
  "drone militaire", "frappe a\u00e9rienne", "frappe aerienne",

  /* ── Décès / Hommages ── */
  "d\u00e9c\u00e8s", "deces", "d\u00e9c\u00e9d\u00e9", "decede", "mort de", "est mort",
  "est d\u00e9c\u00e9d\u00e9", "est decede", "hommage", "fun\u00e9railles", "funerailles",
  "obs\u00e8ques", "obseques", "rip", "repose en paix",
  "disparition de", "nous quitte", "a perdu la vie",

  /* ── Sport (résultats / actu chaude) ── */
  "score final", "victoire de", "d\u00e9faite de", "defaite de",
  "match nul", "finale", "demi-finale", "demi finale",
  "quart de finale", "champion", "championnat",
  "ligue 1", "ligue des champions", "champions league",
  "euro 2026", "coupe du monde", "coupe de france",
  "jeux olympiques", "m\u00e9daille d'or", "m\u00e9daille d or",
  "m\u00e9daille d'argent", "m\u00e9daille de bronze", "podium",
  "transfert", "mercato", "ballon d'or", "ballon d or",
  "\u00e9liminatoires", "qualifications",
  "carton rouge", "penalty", "prolongation",

  /* ── Catastrophes / Météo extrême ── */
  "inondation", "inondations", "crue", "crues", "d\u00e9crue",
  "s\u00e9isme", "seisme", "tremblement de terre",
  "incendie", "feux de for\u00eat", "feux de foret",
  "temp\u00eate", "tempete", "ouragan", "cyclone", "typhon",
  "canicule", "alerte m\u00e9t\u00e9o", "alerte meteo", "vigilance rouge",
  "vigilance orange", "tsunami", "\u00e9ruption volcanique",
  "glissement de terrain", "avalanche", "tornade",
  "s\u00e9cheresse", "secheresse",

  /* ── Accidents / Urgences ── */
  "accident mortel", "accident de la route", "collision",
  "d\u00e9raillement", "crash", "naufrage", "explosion",
  "effondrement", "\u00e9boulement",
];

const normalizeText = (text) => {
  if (text === null || text === undefined) return "";
  return String(text).toLowerCase().replace(/[\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
};
const isHotCaption = (caption) => { const n = normalizeText(caption); if (!n) return false; return HOT_KEYWORDS.some(kw => n.includes(kw)); };
const getHotKeywords = (caption) => { const n = normalizeText(caption); if (!n) return []; return HOT_KEYWORDS.filter(kw => n.includes(kw)); };

/* ─── Parse "4.6K", "386K", "1.2M" → number (pour Facebook) ─── */
function parseRoundedCount(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  const s = String(val).trim().toUpperCase();
  const m = s.match(/^([\d.,]+)\s*([KMB]?)$/);
  if (!m) return Number(val) || null;
  let num = parseFloat(m[1].replace(",", "."));
  if (m[2] === "K") num *= 1e3;
  if (m[2] === "M") num *= 1e6;
  if (m[2] === "B") num *= 1e9;
  return Math.round(num);
}

/* ─── MAP ROW (Instagram + TikTok + YouTube + Facebook) ─── */
function mapRow(row) {
  const keys = Object.keys(row);
  const g = k => { const v = row[k]; return (v !== undefined && v !== null && v !== "") ? v : null; };
  const str = v => (v === null || v === undefined) ? "" : String(v); // force string

  /* ── TikTok ── */
  const isTikTok = keys.some(k => k.includes("authorMeta") || k === "playCount" || k === "diggCount");
  if (isTikTok) {
    const dateVal = g("createTimeISO");
    return {
      compte: str(g("authorMeta.name")) || "\u2014",
      date: dateVal,
      week: getWeekLabel(dateVal),
      type: "Video",
      caption: str(g("text")) || "\u2014",
      views: g("playCount"),
      likes: g("diggCount"),
      comments: g("commentCount"),
      shares: g("shareCount"),
      url: str(g("webVideoUrl")),
      isPaid: null,
      platform: "tiktok"
    };
  }

  /* ── YouTube (détection stricte : colonnes channelName/channelUsername + viewCount) ── */
  const hasYTCols = keys.includes("channelName") || keys.includes("channelUsername");
  const hasViewCount = keys.includes("viewCount");
  if (hasYTCols && hasViewCount) {
    const dateVal = g("date");
    const caption = [g("title"), g("text")].filter(Boolean).map(String).join(" \u2014 ") || "\u2014";
    return {
      compte: str(g("channelName") || g("channelUsername")) || "\u2014",
      date: dateVal,
      week: getWeekLabel(dateVal),
      type: str(g("type")) || "shorts",
      caption: caption,
      views: g("viewCount"),
      likes: g("likes"),
      comments: g("commentsCount"),
      shares: null,
      url: str(g("url")),
      isPaid: g("isPaidContent") === true || g("isPaidContent") === "true" ? true : null,
      platform: "youtube"
    };
  }

  /* ── Facebook (2 formats de scraper Apify) ── */
  /* Format 1 : facebook-reels-and-page-profile-scraper (actors/0/name, reactionCount, playCountRounded) */
  const isFbReels = keys.some(k => k === "actors/0/name" || k === "reactionCount" || k === "playCountRounded");
  if (isFbReels) {
    const ts = g("creation_time");
    const dateVal = ts ? new Date(Number(ts) * 1000).toISOString() : null;
    return {
      compte: str(g("actors/0/name")) || "\u2014",
      date: dateVal,
      week: getWeekLabel(dateVal),
      type: str(g("type")) || "reel",
      caption: str(g("text") || g("message/text")) || "\u2014",
      views: parseRoundedCount(g("playCountRounded")),
      likes: g("reactionCount"),
      comments: g("commentCount"),
      shares: g("shareCount"),
      url: str(g("url")),
      isPaid: null,
      platform: "facebook"
    };
  }
  /* Format 2 : facebook-posts-scraper (pageName, viewsCount) — on ne garde que les vidéos */
  const isFbPosts = keys.includes("pageName") && (keys.includes("viewsCount") || keys.includes("videoPostViewCount"));
  if (isFbPosts) {
    const views = Math.max(Number(g("viewsCount")) || 0, Number(g("videoPostViewCount")) || 0);
    if (views === 0) return null; /* Pas de vues = pas une vidéo → on skip */
    const dateVal = g("time") || null;
    return {
      compte: str(g("pageName")) || "\u2014",
      date: dateVal,
      week: getWeekLabel(dateVal),
      type: "reel",
      caption: str(g("text")) || "\u2014",
      views: views,
      likes: g("likes"),
      comments: g("comments"),
      shares: g("shares"),
      url: str(g("url") || g("topLevelUrl")),
      isPaid: null,
      platform: "facebook"
    };
  }

  /* ── Instagram (default) ── */
  const paid = g("isPaidPartnership") || g("paidPartnership") || g("is_paid_partnership") || g("paid_partnership") || g("brandedContentTagName") || g("branded_content_tag_name") || g("sponsorTags/0") || g("sponsor_tags/0");
  const dateVal = g("timestamp");
  return {
    compte: str(g("ownerUsername") || g("ownerFullName")) || "\u2014",
    date: dateVal,
    week: getWeekLabel(dateVal),
    type: str(g("type") || g("productType")),
    caption: str(g("caption")) || "\u2014",
    views: Math.max(Number(g("videoViewCount")) || 0, Number(g("videoPlayCount")) || 0) || null,
    likes: g("likesCount"),
    comments: g("commentsCount"),
    shares: g("sharesCount"),
    url: str(g("url")),
    isPaid: paid,
    platform: "instagram"
  };
}

/* ─── MANUAL EXCLUDE (chaud URLs — override manuel, priorité max) ─── */
const MANUAL_EXCLUDE = [
  "https://www.instagram.com/p/DXEJYTTgP7j/","https://www.instagram.com/p/DWuNt9uCTYP/","https://www.instagram.com/p/DWwDoH2kccQ/",
  "https://www.instagram.com/p/DXE3vlCjxJR/","https://www.instagram.com/p/DXEhh-LEQ4w/","https://www.instagram.com/p/DWtc3aLkWZY/",
  "https://www.instagram.com/p/DW9YSNTiBas/","https://www.instagram.com/p/DW9MyLHADzl/","https://www.instagram.com/p/DXH0icfCtO3/",
  "https://www.instagram.com/p/DXJhyrSkb8R/","https://www.instagram.com/p/DW6oQokgA-K/","https://www.instagram.com/p/DW4bgLtmsux/",
  "https://www.instagram.com/p/DWoVFs6D9Tn/","https://www.instagram.com/p/DXG7m7HjZiI/","https://www.instagram.com/p/DW8ckyYkXpl/",
  "https://www.instagram.com/p/DW8m-fHl0zo/","https://www.instagram.com/p/DW0_eKkkoPX/","https://www.instagram.com/p/DXJYFHbFMU8/",
  "https://www.instagram.com/p/DWxqmgfjgox/","https://www.instagram.com/p/DMfyPiyywEL/",
  "https://www.instagram.com/p/DRDO4GAAM83/","https://www.instagram.com/p/DWySn1ikX3K/",
  "https://www.instagram.com/p/DWmZu1ID32u/","https://www.instagram.com/p/DWlfDf3Daiv/",
  "https://www.instagram.com/p/DXEb3yyAmnP/","https://www.instagram.com/p/DXB-UB6lbwv/",
  "https://www.instagram.com/p/DWIvDRtj20p/","https://www.instagram.com/p/DXCZwlZkfj9/",
  "https://www.instagram.com/p/DXCRj8aj-ai/","https://www.instagram.com/p/DW3_p1PjYX4/",
  "https://www.instagram.com/p/DXB1jsgicHX/","https://www.instagram.com/p/DUlGE3EjY1a/",
  "https://www.instagram.com/p/DW8gor_Cgb1/","https://www.instagram.com/p/DW9aeQZCj9_/",
  "https://www.instagram.com/p/DW8aaWPFPOn/","https://www.instagram.com/p/DXHOw0YgHm4/",
  "https://www.instagram.com/p/DW09w2fD2Yz/","https://www.instagram.com/p/DXBi6x0CWyC/",
  "https://www.instagram.com/p/DXKcviIgNBK/","https://www.instagram.com/p/DW9kw98lLaH/",
  "https://www.instagram.com/p/DWjxinHCWEI/","https://www.instagram.com/p/DXE3uoJid7w/",
  "https://www.instagram.com/p/DWpFg6JEZxL/","https://www.instagram.com/p/DWoq6xtkxy6/",
  "https://www.instagram.com/p/DXFTMVdFPEy/","https://www.instagram.com/p/DWlTUBZDZCj/",
  "https://www.instagram.com/p/DWzDCNCgY7r/","https://www.instagram.com/p/DWlrL9TAU5g/",
  "https://www.instagram.com/p/DXH1GVYgKIH/","https://www.instagram.com/p/DW4LbArCAjF/",
  "https://www.instagram.com/p/DW09kE7lIbh/","https://www.instagram.com/p/DXFZp8bk6O1/",
  "https://www.instagram.com/p/DWo-C4TkUml/","https://www.instagram.com/p/DWrllqvk_7A/",
  "https://www.instagram.com/p/DWqzJxdjjiZ/","https://www.instagram.com/p/DWrS1hdDJTB/",
  "https://www.instagram.com/p/DXHZITEidY8/","https://www.instagram.com/p/DW9gNx4gm9V/",
  "https://www.instagram.com/p/DWyJtH5inQK/","https://www.instagram.com/p/DWwo5OADidl/",
  "https://www.instagram.com/p/DXJ5g7Sklgh/","https://www.instagram.com/p/DWmBdjgkfMF/",
  "https://www.instagram.com/p/DW5rEZmCb2b/","https://www.instagram.com/p/DWmTf8sCLKP/",
  "https://www.instagram.com/p/DW1jfs8jC2L/","https://www.instagram.com/p/DW9aeKvgO2a/",
  "https://www.instagram.com/p/DW1frk6lLgW/","https://www.instagram.com/p/DWzK0f1iV1x/",
  "https://www.instagram.com/p/DW1y_8ekZWj/","https://www.instagram.com/p/DXE1aGvAATH/",
  "https://www.instagram.com/p/DWrJ31FDh0h/","https://www.instagram.com/p/DW-3KwSjTGr/",
  "https://www.instagram.com/p/DXEuZOUinTA/","https://www.instagram.com/p/DW9oeDvjiIZ/",
  "https://www.instagram.com/p/DXJVGuCCkkq/","https://www.instagram.com/p/DW9Pg-llBVk/",
  "https://www.instagram.com/p/DXE3tShhQCz/","https://www.instagram.com/p/DWmZo1ZAQv4/",
  "https://www.instagram.com/p/DWt5rfdDp-t/","https://www.instagram.com/p/DW9XDyEFPjJ/",
  "https://www.instagram.com/p/DXH3p-FCl_4/",
  "https://www.instagram.com/p/DW8fnkvkqBh/",
  "https://www.instagram.com/p/DW4fGfZCT9_/",
  "https://www.instagram.com/p/DUBmzk0jlZM/",
];

/* ─── EXCEL EXPORT ─── */
function exportXLSX(data, headers, sheetName, fileName) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

/* ─── SORT TABLE ─── */
function SortTable({ data, columns, gridCols, exportData, exportHeaders, exportName, searchPlaceholder }) {
  const [sc, setSc] = useState(null);
  const [sa, setSa] = useState(false);
  const [q, setQ] = useState("");
  const doSort = k => { if (sc === k) setSa(!sa); else { setSc(k); setSa(false); } };
  let list = [...data];
  if (q) { const s = q.toLowerCase(); list = list.filter(r => columns.some(c => String(r[c.key] || "").toLowerCase().includes(s))); }
  if (sc) { list.sort((a, b) => { let va = a[sc] ?? -Infinity, vb = b[sc] ?? -Infinity; const na = Number(va), nb = Number(vb); if (!isNaN(na) && !isNaN(nb)) return sa ? na - nb : nb - na; return sa ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va)); }); }
  const handleExport = () => { if (!exportData) return; exportXLSX(exportData(list), exportHeaders, exportName || "Export", (exportName || "export") + ".xlsx"); };
  return (<>
    <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder || "\ud83d\udd0d Rechercher..."} style={{ flex: 1, padding: 7, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 13, outline: "none" }} />
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{list.length} r\u00e9sultats</span>
      {exportData && <button onClick={handleExport} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)", color: "#4ade80", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>\ud83d\udce5 Export Excel</button>}
    </div>
    <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "rgba(255,255,255,0.07)", padding: "8px 10px", gap: 4 }}>
        {columns.map(c => (<div key={c.key} onClick={() => doSort(c.key)} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", cursor: "pointer", userSelect: "none" }}>{c.label}{sc === c.key ? (sa ? " \u2191" : " \u2193") : ""}</div>))}
      </div>
      <div style={{ maxHeight: 460, overflowY: "auto" }}>
        {list.map((r, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: gridCols, padding: "7px 10px", gap: 4, borderTop: "1px solid rgba(255,255,255,0.04)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent", alignItems: "center" }}>
          {columns.map(c => (<div key={c.key} style={{ fontSize: 12, fontWeight: c.bold ? 600 : 400, color: c.color || "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.title ? String(r[c.key] || "") : undefined}>{c.render ? c.render(r) : (c.fmt ? fmt(r[c.key]) : r[c.key])}</div>))}
        </div>))}
      </div>
    </div>
  </>);
}

const linkCol = { key: "url", label: "\ud83d\udd17", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>\ud83d\udd17</a> : "\u2014" };
const platCol = { key: "platform", label: "Plat.", render: r => <span title={r.platform}>{platformIcon(r.platform)}</span> };
const KPI = ({ items }) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginBottom: 12 }}>{items.map(([l,v,c]) => <div key={l} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px" }}><div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{l}</div><div style={{ fontSize: 18, fontWeight: 700, color: c }}>{v}</div></div>)}</div>;

/* ─── EXPORT BUILDERS ─── */
const expContenus = rows => rows.map(r => { const e = calcEng(r); return [r.platform, r.compte, fmtDate(r.date), r.week || "", r.tempType || "", r.type, cleanCap(r.caption), r.views ?? "", r.likes ?? "", r.comments ?? "", r.shares ?? "", e > 0 ? (e*100).toFixed(2)+"%" : "", r.url]; });
const expMarques = rows => rows.map(b => [b.compte, b.platforms?.join("+"), b.nbVideos, b.nbWeeks, b.avgVidsPerWeek, b.avgFroidPerWeek, b.avgChaudPerWeek, Math.round(b.avgViews), Math.round(b.avgViewsHot), Math.round(b.medianCold), (b.avgEngCold*100).toFixed(2)+"%", (b.avgEngHot*100).toFixed(2)+"%", b.nbViral, b.nbFroid, b.nbChaud, b.lastWeek]);
const expViraux = rows => rows.map(r => { const e = calcEng(r); return [r.platform, r.compte, fmtDate(r.date), r.week || "", cleanCap(r.caption), r.views ?? "", r.avgCompte ?? "", r.ratio ?? "", e > 0 ? (e*100).toFixed(2)+"%" : "", r.tempType || "", r.hotKeywordsFound || "", r.url]; });
const expSuspects = rows => rows.map(r => [r.platform, r.compte, fmtDate(r.date), cleanCap(r.caption), r.views ?? "", r.ratioVues ?? "", (r.eng*100).toFixed(2)+"%", (r.avgEngCompte*100).toFixed(2)+"%", r.url]);
const expSponso = rows => rows.map(r => { const e = calcEng(r); return [r.platform, r.compte, fmtDate(r.date), r.type, cleanCap(r.caption), r.views ?? "", r.likes ?? "", r.comments ?? "", r.shares ?? "", e > 0 ? (e*100).toFixed(2)+"%" : "", r.url]; });

const hContenus = ["Plateforme","Compte","Date","Semaine","Chaud/Froid","Type","Caption","Vues","Likes","Com.","Partages","Engagement","URL"];
const hMarques = ["Compte","Plateformes","Vid\u00e9os","Semaines","Pub/Sem.","Froid/Sem.","Chaud/Sem.","Moy. vues froid","Moy. vues chaud","M\u00e9diane froid","Eng. froid","Eng. chaud","Virales","Froid","Chaud","Derni\u00e8re sem."];
const hViraux = ["Plateforme","Compte","Date","Semaine","Caption","Vues","Moy.","Ratio","Engagement","Type","Mots-cl\u00e9s","URL"];
const hSuspects = ["Plateforme","Compte","Date","Caption","Vues","Ratio","Engagement","Moy. eng.","URL"];
const hSponso = ["Plateforme","Compte","Date","Type","Caption","Vues","Likes","Com.","Partages","Engagement","URL"];

/* ─── STORAGE HELPERS ─── */
const storageKey = (env, suffix) => `dashboard-${env}-${suffix}`;

async function saveToStorage(key, data) {
  try {
    if (window.storage) await window.storage.set(key, JSON.stringify(data));
  } catch (e) { console.error("Storage save error:", e); }
}

async function loadFromStorage(key) {
  try {
    if (window.storage) {
      const result = await window.storage.get(key);
      return result ? JSON.parse(result.value) : null;
    }
  } catch (e) { console.error("Storage load error:", e); }
  return null;
}

async function loadEnvData(env) {
  const [r, f, ex, inc] = await Promise.all([
    loadFromStorage(storageKey(env, "rows")),
    loadFromStorage(storageKey(env, "files")),
    loadFromStorage(storageKey(env, "manual-exclude")),
    loadFromStorage(storageKey(env, "manual-include")),
  ]);
  return { rows: r || [], files: f || [], exclude: ex || MANUAL_EXCLUDE, include: inc || [] };
}

async function saveEnvData(env, rows, files, exclude, include) {
  await Promise.all([
    saveToStorage(storageKey(env, "rows"), rows),
    saveToStorage(storageKey(env, "files"), files),
    saveToStorage(storageKey(env, "manual-exclude"), exclude),
    saveToStorage(storageKey(env, "manual-include"), include),
  ]);
}

async function clearEnvData(env) {
  try {
    if (window.storage) {
      await window.storage.delete(storageKey(env, "rows"));
      await window.storage.delete(storageKey(env, "files"));
      await window.storage.delete(storageKey(env, "manual-exclude"));
      await window.storage.delete(storageKey(env, "manual-include"));
    }
  } catch (e) { console.error("Storage clear error:", e); }
}

/* ─── MAIN DASHBOARD ─── */
export default function Dashboard({ env = "prod" }) {
  const [rows, setRows] = useState([]);
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState([]);
  const [page, setPage] = useState("contenus");
  const [manualExclude, setManualExclude] = useState(MANUAL_EXCLUDE);
  const [manualInclude, setManualInclude] = useState([]);
  const [viralFilter, setViralFilter] = useState("froid");
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);
  const isPreprod = env === "preprod";

  /* ── Load data for this env on mount ── */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const d = await loadEnvData(env);
      setRows(d.rows); setFiles(d.files);
      setManualExclude(d.exclude); setManualInclude(d.include);
      setLoading(false);
    })();
  }, [env]);

  /* ── Persist whenever data changes ── */
  useEffect(() => {
    if (loading) return;
    saveEnvData(env, rows, files, manualExclude, manualInclude);
  }, [rows, files, manualExclude, manualInclude, loading, env]);

  /* ── Import direct avec dédoublonnage (plus hautes vues) ── */
  const loadFile = useCallback((f) => {
    Papa.parse(f, { header: true, dynamicTyping: true, skipEmptyLines: true, complete: (r) => {
      const mapped = r.data.map(mapRow).filter(x => x && (x.date || x.caption !== "\u2014"));
      setRows(prev => {
        const byUrl = new Map();
        prev.forEach(r => { const u = (r.url || "").replace(/\/$/, ""); if (u) byUrl.set(u, r); });
        const noUrl = prev.filter(r => !(r.url || "").replace(/\/$/, ""));
        mapped.forEach(r => {
          const u = (r.url || "").replace(/\/$/, "");
          if (!u) { noUrl.push(r); return; }
          const ex = byUrl.get(u);
          if (!ex) { byUrl.set(u, r); }
          else {
            const nv = Number(r.views) || 0, ov = Number(ex.views) || 0;
            if (nv > ov) byUrl.set(u, { ...ex, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares });
          }
        });
        return [...noUrl, ...byUrl.values()];
      });
      setFiles(prev => [...prev, f.name]);
    }});
  }, []);

  const handleDrop = useCallback((e) => { e.preventDefault(); setDrag(false); const fl = e.dataTransfer?.files; if (fl) Array.from(fl).forEach(f => loadFile(f)); }, [loadFile]);
  const handleFileInput = useCallback((e) => { const fl = e.target.files; if (fl) Array.from(fl).forEach(f => loadFile(f)); }, [loadFile]);

  const platformCounts = useMemo(() => ({
    instagram: rows.filter(r => r.platform === "instagram").length,
    tiktok: rows.filter(r => r.platform === "tiktok").length,
    youtube: rows.filter(r => r.platform === "youtube").length,
    facebook: rows.filter(r => r.platform === "facebook").length,
  }), [rows]);

  /* ─── Classification function ─── */
  const classifyHotCold = useCallback((row) => {
    const url = (row.url || "").replace(/\/$/, "");
    if (manualExclude.some(u => u.replace(/\/$/, "") === url)) return { type: "chaud", source: "manuel", keywords: [] };
    if (manualInclude.some(u => u.replace(/\/$/, "") === url)) return { type: "froid", source: "manuel", keywords: [] };
    const foundKw = getHotKeywords(row.caption);
    if (foundKw.length > 0) return { type: "chaud", source: "auto", keywords: foundKw };
    return { type: "froid", source: "default", keywords: [] };
  }, [manualExclude, manualInclude]);

  const rowsWithType = useMemo(() => rows.map(r => {
    const c = classifyHotCold(r);
    return { ...r, tempType: c.type, classSource: c.source, hotKeywordsFound: c.keywords.slice(0, 3).join(", ") };
  }), [rows, classifyHotCold]);

  const { brands, viralRows, suspectRows } = useMemo(() => {
    const videos = rows.filter(r => isVideo(r.type) || r.platform === "tiktok");
    const grouped = _.groupBy(videos, "compte");
    const brandsArr = Object.entries(grouped).filter(([c, vids]) => vids.length >= 3).map(([compte, vids]) => {
      const coldVids = vids.filter(v => classifyHotCold(v).type === "froid");
      const hotVids = vids.filter(v => classifyHotCold(v).type === "chaud");
      const nbChaud = hotVids.length;
      const nbFroid = coldVids.length;

      /* Moyennes de vues froid / chaud */
      const coldViews = coldVids.map(v => Number(v.views) || 0);
      const hotViews = hotVids.map(v => Number(v.views) || 0);
      const avgCold = coldViews.length ? _.mean(coldViews) : 0;
      const avgHot = hotViews.length ? _.mean(hotViews) : 0;
      const medianCold = coldViews.length ? coldViews.sort((a, b) => a - b)[Math.floor(coldViews.length / 2)] : 0;

      /* Engagement froid / chaud */
      const engsCold = coldVids.map(v => calcEng(v));
      const engsHot = hotVids.map(v => calcEng(v));
      const avgEngCold = engsCold.length ? _.mean(engsCold) : 0;
      const avgEngHot = engsHot.length ? _.mean(engsHot) : 0;

      /* Seuil viral basé sur le froid */
      const thr = avgCold * 2.5;
      const nv = vids.map(v => Number(v.views) || 0).filter(v => v >= thr).length;

      /* Engagement global */
      const engs = vids.map(v => calcEng(v));
      const ae = engs.length ? _.mean(engs) : 0;

      const platforms = _.uniq(vids.map(v => v.platform));

      /* Volume / fréquence */
      const weeks = _.uniq(vids.map(v => v.week).filter(Boolean)).sort();
      const nbWeeks = weeks.length;
      const avgVidsPerWeek = nbWeeks > 0 ? Math.round(vids.length / nbWeeks * 10) / 10 : vids.length;
      const avgFroidPerWeek = nbWeeks > 0 ? Math.round(nbFroid / nbWeeks * 10) / 10 : nbFroid;
      const avgChaudPerWeek = nbWeeks > 0 ? Math.round(nbChaud / nbWeeks * 10) / 10 : nbChaud;
      const lastWeek = weeks.length > 0 ? weeks[weeks.length - 1] : "\u2014";

      return {
        compte, nbVideos: vids.length, avgViews: avgCold, avgViewsHot: avgHot, medianCold,
        nbViral: nv, avgEngagement: ae, avgEngCold, avgEngHot,
        vids, platforms, avgVidsPerWeek, avgFroidPerWeek, avgChaudPerWeek,
        nbChaud, nbFroid, nbWeeks, lastWeek
      };
    });
    const viral = [];
    brandsArr.forEach(b => { const thr = b.avgViews * 2.5; b.vids.forEach(v => { const views = Number(v.views) || 0; if (views >= thr) viral.push({ ...v, avgCompte: Math.round(b.avgViews), ratio: b.avgViews > 0 ? (views / b.avgViews).toFixed(1) : "\u2014" }); }); });
    const suspect = [];
    brandsArr.forEach(b => { if (b.nbVideos < 3) return; const thr = b.avgViews * 1.5; b.vids.forEach(v => { const vw = Number(v.views) || 0; const eng = calcEng(v); if (vw >= thr && eng < 0.01) suspect.push({ ...v, avgCompte: Math.round(b.avgViews), avgEngCompte: b.avgEngagement, eng, ratioVues: b.avgViews > 0 ? (vw / b.avgViews).toFixed(1) : "\u2014" }); }); });
    return { brands: brandsArr, viralRows: viral, suspectRows: suspect };
  }, [rows, classifyHotCold]);

  const viralWithType = useMemo(() => viralRows.map(r => {
    const classification = classifyHotCold(r);
    return { ...r, tempType: classification.type, classSource: classification.source, hotKeywordsFound: classification.keywords.slice(0, 3).join(", ") };
  }), [viralRows, classifyHotCold]);

  const filteredViral = useMemo(() => {
    if (viralFilter === "all") return viralWithType;
    return viralWithType.filter(r => r.tempType === viralFilter);
  }, [viralWithType, viralFilter]);

  const nbFroid = viralWithType.filter(r => r.tempType === "froid").length;
  const nbChaud = viralWithType.filter(r => r.tempType === "chaud").length;
  const nbAutoChaud = viralWithType.filter(r => r.tempType === "chaud" && r.classSource === "auto").length;
  const nbManuelChaud = viralWithType.filter(r => r.tempType === "chaud" && r.classSource === "manuel").length;

  const handleManualExclude = url => {
    setManualExclude(prev => [...prev, url]);
    setManualInclude(prev => prev.filter(u => u.replace(/\/$/, "") !== url.replace(/\/$/, "")));
  };
  const handleManualInclude = url => {
    setManualInclude(prev => [...prev, url]);
    setManualExclude(prev => prev.filter(u => u.replace(/\/$/, "") !== url.replace(/\/$/, "")));
  };

  const sponsoRows = useMemo(() => {
    const kw = ["partenariat r\u00e9mun\u00e9r\u00e9", "partenariat remunere", "collaboration commerciale", "partenariat"];
    return rows.filter(r => { const c = String(r.caption || "").toLowerCase(); return kw.some(k => c.includes(k)) || !!r.isPaid; });
  }, [rows]);

  const tot = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const TABS = [["contenus","\ud83d\udcdd Contenus"],["marques","\ud83c\udfe2 Marques"],["viraux","\ud83d\udd25 Viraux"],["suspects","\ud83e\udd14 Suspects"],["sponso","\ud83e\udd1d Sponsos"]];
  const badge = k => { const map = { viraux: [nbFroid+"/"+viralRows.length,"#fbbf24"], suspects: [suspectRows.length,"#f472b6"], sponso: [sponsoRows.length,"#34d399"] }; const m = map[k]; if (!m) return null; return <span style={{ marginLeft: 6, padding: "2px 7px", borderRadius: 10, background: m[1]+"33", color: m[1], fontSize: 11 }}>{m[0]}</span>; };

  /* ── Reset l'env courant ── */
  const handleReset = async () => {
    setRows([]); setFiles([]);
    setManualExclude(MANUAL_EXCLUDE);
    setManualInclude([]);
    await clearEnvData(env);
  };

  /* ─── LOADING SCREEN ─── */
  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0f0f23,#1a1a3e)", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>\u23f3</div>
        <p style={{ fontSize: 14 }}>Chargement des donn\u00e9es...</p>
      </div>
    </div>
  );

  /* ─── UPLOAD SCREEN ─── */
  if (!rows.length) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: isPreprod ? "linear-gradient(135deg,#1a1a0f,#2e2e1a)" : "linear-gradient(135deg,#0f0f23,#1a1a3e)", fontFamily: "system-ui", padding: 20 }}>
      {isPreprod && <div style={{ position: "absolute", top: 20, left: 20, padding: "6px 14px", borderRadius: 8, background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", fontSize: 12, fontWeight: 700 }}>{"\ud83d\udfe1"} PREPROD</div>}
      <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={handleDrop} onClick={() => document.getElementById("up").click()}
        style={{ border: drag ? "2px dashed #6366f1" : "2px dashed rgba(255,255,255,0.15)", background: drag ? "rgba(99,102,241,0.1)" : "rgba(255,255,255,0.04)", borderRadius: 20, padding: "56px 40px", maxWidth: 520, width: "100%", textAlign: "center", cursor: "pointer" }}>
        <div style={{ fontSize: 52, marginBottom: 14 }}>\ud83d\udcc2</div>
        <h1 style={{ color: "#fff", fontSize: 20, margin: "0 0 8px" }}>Importe tes fichiers</h1>
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, margin: "0 0 22px", lineHeight: 1.5 }}>Glisse tes CSV ici (Instagram + TikTok + YouTube)</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 16, flexWrap: "wrap" }}>
          {[["instagram","\ud83d\udcf8 Instagram"],["tiktok","\ud83c\udfb5 TikTok"],["youtube","\u25b6\ufe0f YouTube"],["facebook","\ud83d\udc4d Facebook"]].map(([p, l]) => {
            const c = platformColor(p);
            return <span key={p} style={{ padding: "6px 14px", borderRadius: 8, background: c.bg, color: c.color, fontSize: 13 }}>{l}</span>;
          })}
        </div>
        <div style={{ display: "inline-block", padding: "10px 24px", borderRadius: 10, background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600 }}>\ud83d\udce5 Choisir des fichiers</div>
        <input id="up" type="file" accept=".csv" multiple onChange={handleFileInput} style={{ display: "none" }} />
      </div>
    </div>
  );

  /* ─── MAIN ─── */
  return (
    <div style={{ minHeight: "100vh", background: isPreprod ? "linear-gradient(135deg,#1a1a0f,#2e2e1a)" : "linear-gradient(135deg,#0f0f23,#1a1a3e)", fontFamily: "system-ui", color: "#fff", padding: "20px 16px" }}>
      <div style={{ maxWidth: 1150, margin: "0 auto" }}>
        {/* ── ENV BADGE ── */}
        {isPreprod && (
          <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 10, padding: "8px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600 }}>{"\ud83d\udfe1"} PREPROD \u2014 Environnement de test. Ces donn\u00e9es n'affectent pas la production.</span>
            <a href="/" style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textDecoration: "none" }}>\u2192 Aller en prod</a>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 18, margin: 0 }}>\ud83d\udcca Social Media Dashboard {isPreprod && <span style={{ fontSize: 12, color: "#fbbf24", fontWeight: 400 }}>(preprod)</span>}</h1>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, margin: 0 }}>
              {files.map((f, i) => <span key={i}>\ud83d\udcc4 {f}{i < files.length - 1 ? " \u00b7 " : ""}</span>)}
              {" \u2014 "}{rows.length} posts \u00b7 {brands.length} comptes
              {["instagram","tiktok","youtube","facebook"].map(p => {
                const count = platformCounts[p];
                if (!count) return null;
                const c = platformColor(p);
                return <span key={p} style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 6, background: c.bg, color: c.color, fontSize: 11 }}>{platformIcon(p)} {count}</span>;
              })}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => document.getElementById("up2").click()} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.1)", color: "#818cf8", fontSize: 12, cursor: "pointer" }}>\u2795 Ajouter CSV</button>
            <input id="up2" type="file" accept=".csv" multiple onChange={handleFileInput} style={{ display: "none" }} />
            <button onClick={handleReset} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}>{isPreprod ? "\ud83d\uddd1 Vider preprod" : "\ud83d\udd04 Reset"}</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setPage(k)} style={{ padding: "9px 20px", borderRadius: "10px 10px 0 0", border: "1px solid " + (page === k ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"), borderBottom: page === k ? "2px solid #6366f1" : "1px solid rgba(255,255,255,0.08)", background: page === k ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.03)", color: page === k ? "#fff" : "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: page === k ? 700 : 400, cursor: "pointer" }}>
              {l}{badge(k)}
            </button>
          ))}
        </div>

        {/* CONTENUS */}
        {page === "contenus" && (<>
          <KPI items={[["\ud83d\udcdd Posts", rows.length, "#a78bfa"], ["\ud83c\udfac Vid\u00e9os", rows.filter(r => isVideo(r.type) || r.platform === "tiktok").length, "#c084fc"], ["\ud83d\udc41 Vues", fmt(tot("views")), "#818cf8"], ["\u2764\ufe0f Likes", fmt(tot("likes")), "#f472b6"], ["\u2744\ufe0f Froid", rowsWithType.filter(r => r.tempType === "froid").length, "#60a5fa"], ["\ud83d\udd25 Chaud", rowsWithType.filter(r => r.tempType === "chaud").length, "#ef4444"]]} />
          <SortTable data={rowsWithType} gridCols="30px 85px 65px 40px 28px 30px 1fr 65px 50px 45px 50px 58px" exportData={expContenus} exportHeaders={hContenus} exportName="contenus"
            columns={[
              platCol,
              { key: "compte", label: "Compte", bold: true, color: "#fff" },
              { key: "date", label: "Date", render: r => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
              { key: "week", label: "Sem.", color: "rgba(255,255,255,0.4)" },
              { key: "tempType", label: "", render: r => r.tempType === "chaud" ? <span title={"Chaud" + (r.hotKeywordsFound ? " : " + r.hotKeywordsFound : "")} style={{ cursor: "help" }}>{"\ud83d\udd25"}</span> : <span title="Froid">{"\u2744\ufe0f"}</span> },
              { key: "type", label: "", render: r => typeIcon(r.type) },
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{String(r.caption || "").slice(0, 100)}</a> : String(r.caption || "").slice(0, 100) },
              { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
              { key: "likes", label: "Likes", fmt: true, color: "#f472b6" },
              { key: "comments", label: "Com.", fmt: true, color: "#60a5fa" },
              { key: "shares", label: "Part.", fmt: true, color: "#a78bfa" },
              { key: "engagement", label: "Eng.", render: renderEng, color: "#34d399" },
            ]} />
        </>)}

        {/* MARQUES */}
        {page === "marques" && (<>
          <KPI items={[
            ["\ud83c\udfe2 Comptes", brands.length, "#a78bfa"],
            ["\ud83c\udfac Vid\u00e9os", fmt(_.sumBy(brands, "nbVideos")), "#818cf8"],
            ["\u2744\ufe0f Moy. froid", fmt(Math.round(_.meanBy(brands, "avgViews") || 0)), "#60a5fa"],
            ["\ud83d\udd25 Moy. chaud", fmt(Math.round(_.meanBy(brands.filter(b => b.avgViewsHot > 0), "avgViewsHot") || 0)), "#ef4444"],
            ["\ud83d\udcc5 Sem. couvertes", Math.round(_.meanBy(brands, "nbWeeks") || 0), "#fbbf24"],
            ["\ud83d\udd25 Virales", fmt(_.sumBy(brands, "nbViral")), "#f59e0b"],
          ]} />
          <SortTable data={brands} gridCols="1fr 55px 50px 60px 80px 80px 70px 70px 55px 55px 55px 50px" exportData={expMarques} exportHeaders={hMarques} exportName="marques" searchPlaceholder="\ud83d\udd0d Rechercher un compte..."
            columns={[
              { key: "compte", label: "Compte", bold: true, color: "#fff", render: r => <span>{r.platforms?.map(p => platformIcon(p)).join(" ")} {r.compte}</span> },
              { key: "nbVideos", label: "Vid.", bold: true, color: "#818cf8" },
              { key: "nbWeeks", label: "Sem.", render: r => <span title={r.nbWeeks + " semaines couvertes \u2014 derni\u00e8re : " + r.lastWeek} style={{ color: "#fbbf24", cursor: "help" }}>{r.nbWeeks}</span> },
              { key: "avgVidsPerWeek", label: "Pub/S", render: r => <span title={"Froid: " + r.avgFroidPerWeek + "/sem \u00b7 Chaud: " + r.avgChaudPerWeek + "/sem"} style={{ color: "#a78bfa", cursor: "help" }}>{r.avgVidsPerWeek}</span> },
              { key: "avgViews", label: "\u2744\ufe0f Moy.", render: r => <span title="Moyenne vues froid">{fmt(Math.round(r.avgViews))}</span>, bold: true, color: "#60a5fa" },
              { key: "avgViewsHot", label: "\ud83d\udd25 Moy.", render: r => r.avgViewsHot > 0 ? <span title="Moyenne vues chaud">{fmt(Math.round(r.avgViewsHot))}</span> : <span style={{ color: "rgba(255,255,255,0.2)" }}>\u2014</span>, bold: true, color: "#ef4444" },
              { key: "avgEngCold", label: "\u2744\ufe0f Eng.", render: r => r.avgEngCold > 0 ? <span style={{ color: "#34d399" }}>{(r.avgEngCold * 100).toFixed(1)}%</span> : <span style={{ color: "rgba(255,255,255,0.2)" }}>\u2014</span> },
              { key: "avgEngHot", label: "\ud83d\udd25 Eng.", render: r => r.avgEngHot > 0 ? <span style={{ color: "#f472b6" }}>{(r.avgEngHot * 100).toFixed(1)}%</span> : <span style={{ color: "rgba(255,255,255,0.2)" }}>\u2014</span> },
              { key: "nbViral", label: ">2.5x", render: r => r.nbViral > 0 ? <span style={{ color: "#fbbf24" }}>{r.nbViral}</span> : <span style={{ color: "rgba(255,255,255,0.25)" }}>0</span> },
              { key: "nbFroid", label: "\u2744\ufe0f", render: r => <span style={{ color: "#60a5fa" }}>{r.nbFroid}</span> },
              { key: "nbChaud", label: "\ud83d\udd25", render: r => <span style={{ color: "#f59e0b" }}>{r.nbChaud}</span> },
              { key: "lastWeek", label: "Dern.", render: r => <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{r.lastWeek}</span> },
            ]} />
        </>)}

        {/* VIRAUX */}
        {page === "viraux" && (<>
          <KPI items={[
            ["\ud83d\udd25 Total", viralRows.length, "#fbbf24"],
            ["\u2744\ufe0f Froid", nbFroid, "#60a5fa"],
            ["\ud83d\udd25 Chaud", nbChaud, "#ef4444"],
            ["\ud83e\udd16 Auto-class\u00e9", nbAutoChaud, "#f59e0b"],
            ["\u270b Manuel", nbManuelChaud, "#a78bfa"],
          ]} />
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
            <strong style={{ color: "#fff" }}>Classification auto par mots-cl\u00e9s :</strong> la caption est scann\u00e9e pour d\u00e9tecter politique, faits divers, guerre, d\u00e9c\u00e8s, r\u00e9sultats sportifs, catastrophes.
            {" "}Pas de match = froid. Tu peux corriger manuellement avec les boutons \u2715 et \u21a9\ufe0f.
            {" "}<span style={{ color: "#f59e0b" }}>\ud83e\udd16 = class\u00e9 auto</span> \u00b7 <span style={{ color: "#a78bfa" }}>\u270b = class\u00e9 manuellement</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            {[["froid", "\u2744\ufe0f Froid", "#60a5fa"], ["chaud", "\ud83d\udd25 Chaud", "#ef4444"], ["all", "Tous", "rgba(255,255,255,0.5)"]].map(([k, l, c]) => (
              <button key={k} onClick={() => setViralFilter(k)} style={{ padding: "7px 14px", borderRadius: 8, border: viralFilter === k ? "1px solid " + c : "1px solid rgba(255,255,255,0.1)", background: viralFilter === k ? c + "22" : "transparent", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: viralFilter === k ? 600 : 400 }}>{l}</button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>\u2715 = marquer chaud \u00b7 \u21a9\ufe0f = remettre froid</span>
          </div>
          <SortTable data={filteredViral} gridCols="30px 90px 65px 40px 1fr 75px 70px 45px 60px 45px 55px 30px 25px" exportData={expViraux} exportHeaders={hViraux} exportName="viraux"
            columns={[
              platCol,
              { key: "compte", label: "Compte", bold: true, color: "#fff" },
              { key: "date", label: "Date", render: r => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
              { key: "week", label: "Sem.", color: "rgba(255,255,255,0.4)" },
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{String(r.caption || "").slice(0, 80)}</a> : String(r.caption || "").slice(0, 80) },
              { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
              { key: "avgCompte", label: "Moy.", fmt: true, color: "rgba(255,255,255,0.4)" },
              { key: "ratio", label: "Ratio", render: r => <span style={{ color: "#fbbf24", fontWeight: 700 }}>{r.ratio}x</span> },
              { key: "engagement", label: "Eng.", render: renderEng, color: "#34d399" },
              { key: "tempType", label: "Type", render: r => r.tempType === "froid" ? <span style={{ color: "#60a5fa" }}>\u2744\ufe0f</span> : <span style={{ color: "#ef4444" }}>\ud83d\udd25</span> },
              { key: "classSource", label: "Source", render: r => {
                if (r.tempType === "froid" && r.classSource === "default") return <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>\u2014</span>;
                if (r.classSource === "auto") return <span title={"Mots-cl\u00e9s : " + r.hotKeywordsFound} style={{ color: "#f59e0b", fontSize: 10, cursor: "help" }}>\ud83e\udd16 auto</span>;
                return <span style={{ color: "#a78bfa", fontSize: 10 }}>\u270b</span>;
              }},
              { key: "action", label: "", render: r => r.tempType === "chaud"
                ? <button onClick={() => handleManualInclude(r.url)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#60a5fa" }} title="Remettre en froid">\u21a9\ufe0f</button>
                : <button onClick={() => handleManualExclude(r.url)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#ef4444" }} title="Marquer comme chaud">\u2715</button>
              },
              linkCol,
            ]} />
        </>)}

        {/* SUSPECTS */}
        {page === "suspects" && (<>
          <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 16px", marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0 }}>\ud83e\udd14 Vues &gt; 1.5x la moyenne du compte et engagement &lt; 1% \u2014 <strong style={{ color: "#fff" }}>{suspectRows.length} vid\u00e9os</strong></p>
          </div>
          <KPI items={[["\ud83e\udd14 Suspects", suspectRows.length, "#f472b6"], ["\ud83c\udfe2 Comptes", _.uniqBy(suspectRows, "compte").length, "#a78bfa"], ["\ud83d\udc41 Vues moy.", fmt(Math.round(_.meanBy(suspectRows, r => Number(r.views) || 0) || 0)), "#818cf8"]]} />
          <SortTable data={suspectRows} gridCols="30px 95px 70px 1fr 80px 60px 70px 70px 30px" exportData={expSuspects} exportHeaders={hSuspects} exportName="suspects"
            columns={[
              platCol,
              { key: "compte", label: "Compte", bold: true, color: "#fff" },
              { key: "date", label: "Date", render: r => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{String(r.caption || "").slice(0, 90)}</a> : String(r.caption || "").slice(0, 90) },
              { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
              { key: "ratioVues", label: "x moy.", render: r => <span style={{ color: "#818cf8" }}>{r.ratioVues}x</span> },
              { key: "eng", label: "Engage.", render: r => <span style={{ color: "#f472b6", fontWeight: 600 }}>{(r.eng * 100).toFixed(2)}%</span> },
              { key: "avgEngCompte", label: "Moy. eng.", render: r => <span style={{ color: "rgba(255,255,255,0.35)" }}>{(r.avgEngCompte * 100).toFixed(2)}%</span> },
              linkCol,
            ]} />
        </>)}

        {/* SPONSOS */}
        {page === "sponso" && (<>
          <KPI items={[["\ud83e\udd1d Sponsos", sponsoRows.length, "#34d399"], ["\ud83c\udfe2 Comptes", _.uniqBy(sponsoRows, "compte").length, "#a78bfa"], ["\ud83d\udc41 Vues moy.", fmt(Math.round(_.meanBy(sponsoRows, r => Number(r.views) || 0) || 0)), "#818cf8"], ["\u2764\ufe0f Likes moy.", fmt(Math.round(_.meanBy(sponsoRows, r => Number(r.likes) || 0) || 0)), "#f472b6"]]} />
          <SortTable data={sponsoRows} gridCols="30px 90px 70px 35px 1fr 70px 55px 50px 50px 60px 30px" exportData={expSponso} exportHeaders={hSponso} exportName="sponso"
            columns={[
              platCol,
              { key: "compte", label: "Compte", bold: true, color: "#fff" },
              { key: "date", label: "Date", render: r => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
              { key: "type", label: "", render: r => typeIcon(r.type) },
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{String(r.caption || "").slice(0, 100)}</a> : String(r.caption || "").slice(0, 100) },
              { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
              { key: "likes", label: "Likes", fmt: true, color: "#f472b6" },
              { key: "comments", label: "Com.", fmt: true, color: "#60a5fa" },
              { key: "shares", label: "Part.", fmt: true, color: "#a78bfa" },
              { key: "engagement", label: "Eng.", render: renderEng, color: "#34d399" },
              linkCol,
            ]} />
        </>)}

        {/* FOOTER */}
        <div style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", textAlign: "center" }}>
          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, margin: 0 }}>\u00a9 2026 Cl\u00e9ment Dubois \u2014 Tous droits r\u00e9serv\u00e9s</p>
        </div>
      </div>
    </div>
  );
}
