import { useState, useCallback, useMemo } from "react";
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
const typeIcon = t => { if (!t) return "\ud83d\udcdd"; const l = t.toLowerCase(); if (l.includes("video") || l.includes("reel")) return "\ud83c\udfac"; if (l.includes("sidecar") || l.includes("carousel")) return "\ud83d\udcf8"; return "\ud83d\uddbc"; };
const isVideo = t => { if (!t) return false; const l = t.toLowerCase(); return l.includes("video") || l.includes("reel"); };
const calcEng = r => { const v = Number(r.views) || 0, l = Number(r.likes) || 0, c = Number(r.comments) || 0; return v > 0 ? (l + c) / v : 0; };
const renderEng = r => { const e = calcEng(r); return e > 0 ? <span style={{ color: "#34d399", fontWeight: 600 }}>{(e * 100).toFixed(2)}%</span> : "\u2014"; };
const cleanCap = c => (c || "").replace(/[^\w\s\u00e0-\u00ff\u0152\u0153.,!?:()@#%\u20ac$&+\-'/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
const platformIcon = p => p === "tiktok" ? "\ud83c\udfb5" : "\ud83d\udcf8";

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

/* ─── MAP ROW ─── */
function mapRow(row) {
  const keys = Object.keys(row);
  const g = k => { const v = row[k]; return (v !== undefined && v !== null && v !== "") ? v : null; };
  const isTikTok = keys.some(k => k.includes("authorMeta") || k === "playCount" || k === "diggCount");

  if (isTikTok) {
    const dateVal = g("createTimeISO");
    return {
      compte: g("authorMeta.name") || "\u2014",
      date: dateVal,
      week: getWeekLabel(dateVal),
      type: "Video",
      caption: g("text") || "\u2014",
      views: g("playCount"),
      likes: g("diggCount"),
      comments: g("commentCount"),
      shares: g("shareCount"),
      url: g("webVideoUrl") || "",
      isPaid: null,
      platform: "tiktok"
    };
  }

  const paid = g("isPaidPartnership") || g("paidPartnership") || g("is_paid_partnership") || g("paid_partnership") || g("brandedContentTagName") || g("branded_content_tag_name") || g("sponsorTags/0") || g("sponsor_tags/0");
  const dateVal = g("timestamp");
  return {
    compte: g("ownerUsername") || g("ownerFullName") || "\u2014",
    date: dateVal,
    week: getWeekLabel(dateVal),
    type: g("type") || g("productType") || "",
    caption: g("caption") || "\u2014",
    views: g("videoViewCount") ?? g("videoPlayCount"),
    likes: g("likesCount"),
    comments: g("commentsCount"),
    shares: g("sharesCount"),
    url: g("url") || "",
    isPaid: paid,
    platform: "instagram"
  };
}

/* ─── MANUAL EXCLUDE (chaud URLs) ─── */
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
const expContenus = rows => rows.map(r => { const e = calcEng(r); return [r.platform, r.compte, fmtDate(r.date), r.week || "", r.type, cleanCap(r.caption), r.views ?? "", r.likes ?? "", r.comments ?? "", e > 0 ? (e*100).toFixed(2)+"%" : "", r.url]; });
const expMarques = rows => rows.map(b => [b.compte, b.platforms?.join("+"), b.nbVideos, b.avgVidsPerWeek, Math.round(b.avgViews), (b.avgEngagement*100).toFixed(2)+"%", b.nbViral, b.nbChaud, b.nbFroid]);
const expViraux = rows => rows.map(r => { const e = calcEng(r); return [r.platform, r.compte, fmtDate(r.date), cleanCap(r.caption), r.views ?? "", r.avgCompte ?? "", r.ratio ?? "", e > 0 ? (e*100).toFixed(2)+"%" : "", r.tempType || "", r.url]; });
const expSuspects = rows => rows.map(r => [r.platform, r.compte, fmtDate(r.date), cleanCap(r.caption), r.views ?? "", r.ratioVues ?? "", (r.eng*100).toFixed(2)+"%", (r.avgEngCompte*100).toFixed(2)+"%", r.url]);
const expSponso = rows => rows.map(r => { const e = calcEng(r); return [r.platform, r.compte, fmtDate(r.date), r.type, cleanCap(r.caption), r.views ?? "", r.likes ?? "", r.comments ?? "", e > 0 ? (e*100).toFixed(2)+"%" : "", r.url]; });

const hContenus = ["Plateforme","Compte","Date","Semaine","Type","Caption","Vues","Likes","Com.","Engagement","URL"];
const hMarques = ["Compte","Plateformes","Vid\u00e9os","Moy./Sem.","Moy. vues","Engagement","Virales","Chaud","Froid"];
const hViraux = ["Plateforme","Compte","Date","Caption","Vues","Moy.","Ratio","Engagement","Type","URL"];
const hSuspects = ["Plateforme","Compte","Date","Caption","Vues","Ratio","Engagement","Moy. eng.","URL"];
const hSponso = ["Plateforme","Compte","Date","Type","Caption","Vues","Likes","Com.","Engagement","URL"];

/* ─── MAIN DASHBOARD ─── */
export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState([]);
  const [page, setPage] = useState("contenus");
  const [manualExclude, setManualExclude] = useState(MANUAL_EXCLUDE);
  const [viralFilter, setViralFilter] = useState("froid");

  const loadFile = useCallback((f) => {
    Papa.parse(f, { header: true, dynamicTyping: true, skipEmptyLines: true, complete: (r) => {
      const mapped = r.data.map(mapRow).filter(x => x.date || x.caption !== "\u2014");
      setRows(prev => [...prev, ...mapped]);
      setFiles(prev => [...prev, f.name]);
    }});
  }, []);

  const handleDrop = useCallback((e) => { e.preventDefault(); setDrag(false); const fl = e.dataTransfer?.files; if (fl) Array.from(fl).forEach(f => loadFile(f)); }, [loadFile]);
  const handleFileInput = useCallback((e) => { const fl = e.target.files; if (fl) Array.from(fl).forEach(f => loadFile(f)); }, [loadFile]);

  const platformCounts = useMemo(() => ({ instagram: rows.filter(r => r.platform === "instagram").length, tiktok: rows.filter(r => r.platform === "tiktok").length }), [rows]);

  const { brands, viralRows, suspectRows } = useMemo(() => {
    const videos = rows.filter(r => isVideo(r.type) || r.platform === "tiktok");
    const grouped = _.groupBy(videos, "compte");
    const brandsArr = Object.entries(grouped).filter(([c, vids]) => vids.length >= 3).map(([compte, vids]) => {
      const vl = vids.map(v => Number(v.views) || 0);
      const avg = vl.length ? _.mean(vl) : 0;
      const thr = avg * 2.5;
      const nv = vl.filter(v => v >= thr).length;
      const engs = vids.map(v => calcEng(v));
      const ae = engs.length ? _.mean(engs) : 0;
      const platforms = _.uniq(vids.map(v => v.platform));
      const weeks = _.uniq(vids.map(v => v.week).filter(Boolean));
      const avgVidsPerWeek = weeks.length > 0 ? Math.round(vids.length / weeks.length * 10) / 10 : vids.length;
      const nbChaud = vids.filter(v => manualExclude.some(u => u.replace(/\/$/, "") === (v.url || "").replace(/\/$/, ""))).length;
      const nbFroid = vids.length - nbChaud;
      return { compte, nbVideos: vids.length, avgViews: avg, nbViral: nv, avgEngagement: ae, vids, platforms, avgVidsPerWeek, nbChaud, nbFroid };
    });
    const viral = [];
    brandsArr.forEach(b => { const thr = b.avgViews * 2.5; b.vids.forEach(v => { const views = Number(v.views) || 0; if (views >= thr) viral.push({ ...v, avgCompte: Math.round(b.avgViews), ratio: b.avgViews > 0 ? (views / b.avgViews).toFixed(1) : "\u2014" }); }); });
    const suspect = [];
    brandsArr.forEach(b => { if (b.nbVideos < 3) return; const thr = b.avgViews * 1.5; b.vids.forEach(v => { const vw = Number(v.views) || 0; const eng = calcEng(v); if (vw >= thr && eng < 0.01) suspect.push({ ...v, avgCompte: Math.round(b.avgViews), avgEngCompte: b.avgEngagement, eng, ratioVues: b.avgViews > 0 ? (vw / b.avgViews).toFixed(1) : "\u2014" }); }); });
    return { brands: brandsArr, viralRows: viral, suspectRows: suspect };
  }, [rows, manualExclude]);

  const viralWithType = useMemo(() => viralRows.map(r => {
    const url = (r.url || "").replace(/\/$/, "");
    if (manualExclude.some(u => u.replace(/\/$/, "") === url)) return { ...r, tempType: "chaud" };
    return { ...r, tempType: "froid" };
  }), [viralRows, manualExclude]);

  const filteredViral = useMemo(() => {
    if (viralFilter === "all") return viralWithType;
    return viralWithType.filter(r => r.tempType === viralFilter);
  }, [viralWithType, viralFilter]);

  const nbFroid = viralWithType.filter(r => r.tempType === "froid").length;
  const nbChaud = viralWithType.filter(r => r.tempType === "chaud").length;
  const handleManualExclude = url => setManualExclude(prev => [...prev, url]);
  const handleManualInclude = url => setManualExclude(prev => prev.filter(u => u.replace(/\/$/, "") !== url.replace(/\/$/, "")));

  const sponsoRows = useMemo(() => {
    const kw = ["partenariat r\u00e9mun\u00e9r\u00e9", "partenariat remunere", "collaboration commerciale", "partenariat"];
    return rows.filter(r => { const c = (r.caption || "").toLowerCase(); return kw.some(k => c.includes(k)) || !!r.isPaid; });
  }, [rows]);

  const tot = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const TABS = [["contenus","\ud83d\udcdd Contenus"],["marques","\ud83c\udfe2 Marques"],["viraux","\ud83d\udd25 Viraux"],["suspects","\ud83e\udd14 Suspects"],["sponso","\ud83e\udd1d Sponsos"]];
  const badge = k => { const map = { viraux: [nbFroid+"/"+viralRows.length,"#fbbf24"], suspects: [suspectRows.length,"#f472b6"], sponso: [sponsoRows.length,"#34d399"] }; const m = map[k]; if (!m) return null; return <span style={{ marginLeft: 6, padding: "2px 7px", borderRadius: 10, background: m[1]+"33", color: m[1], fontSize: 11 }}>{m[0]}</span>; };

  /* ─── UPLOAD SCREEN ─── */
  if (!rows.length) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0f0f23,#1a1a3e)", fontFamily: "system-ui", padding: 20 }}>
      <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={handleDrop} onClick={() => document.getElementById("up").click()}
        style={{ border: drag ? "2px dashed #6366f1" : "2px dashed rgba(255,255,255,0.15)", background: drag ? "rgba(99,102,241,0.1)" : "rgba(255,255,255,0.04)", borderRadius: 20, padding: "56px 40px", maxWidth: 520, width: "100%", textAlign: "center", cursor: "pointer" }}>
        <div style={{ fontSize: 52, marginBottom: 14 }}>\ud83d\udcc2</div>
        <h1 style={{ color: "#fff", fontSize: 20, margin: "0 0 8px" }}>Importe tes fichiers</h1>
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, margin: "0 0 22px", lineHeight: 1.5 }}>Glisse tes CSV ici (Instagram + TikTok)</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
          <span style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(225,48,108,0.15)", color: "#E1306C", fontSize: 13 }}>\ud83d\udcf8 Instagram</span>
          <span style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "#fff", fontSize: 13 }}>\ud83c\udfb5 TikTok</span>
        </div>
        <div style={{ display: "inline-block", padding: "10px 24px", borderRadius: 10, background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600 }}>\ud83d\udce5 Choisir des fichiers</div>
        <input id="up" type="file" accept=".csv" multiple onChange={handleFileInput} style={{ display: "none" }} />
      </div>
    </div>
  );

  /* ─── MAIN ─── */
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f0f23,#1a1a3e)", fontFamily: "system-ui", color: "#fff", padding: "20px 16px" }}>
      <div style={{ maxWidth: 1150, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 18, margin: 0 }}>\ud83d\udcca Social Media Dashboard</h1>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, margin: 0 }}>
              {files.map((f, i) => <span key={i}>\ud83d\udcc4 {f}{i < files.length - 1 ? " \u00b7 " : ""}</span>)}
              {" \u2014 "}{rows.length} posts \u00b7 {brands.length} comptes
              {platformCounts.instagram > 0 && <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 6, background: "rgba(225,48,108,0.15)", color: "#E1306C", fontSize: 11 }}>\ud83d\udcf8 {platformCounts.instagram}</span>}
              {platformCounts.tiktok > 0 && <span style={{ marginLeft: 4, padding: "1px 6px", borderRadius: 6, background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 11 }}>\ud83c\udfb5 {platformCounts.tiktok}</span>}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => document.getElementById("up2").click()} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.1)", color: "#818cf8", fontSize: 12, cursor: "pointer" }}>\u2795 Ajouter CSV</button>
            <input id="up2" type="file" accept=".csv" multiple onChange={handleFileInput} style={{ display: "none" }} />
            <button onClick={() => { setRows([]); setFiles([]); }} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}>\ud83d\udd04 Reset</button>
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
          <KPI items={[["\ud83d\udcdd Posts", rows.length, "#a78bfa"], ["\ud83c\udfac Vid\u00e9os", rows.filter(r => isVideo(r.type) || r.platform === "tiktok").length, "#c084fc"], ["\ud83d\udc41 Vues", fmt(tot("views")), "#818cf8"], ["\u2764\ufe0f Likes", fmt(tot("likes")), "#f472b6"], ["\ud83d\udcac Com.", fmt(tot("comments")), "#60a5fa"]]} />
          <SortTable data={rows} gridCols="30px 95px 75px 50px 35px 1fr 75px 60px 55px 70px" exportData={expContenus} exportHeaders={hContenus} exportName="contenus"
            columns={[
              platCol,
              { key: "compte", label: "Compte", bold: true, color: "#fff" },
              { key: "date", label: "Date", render: r => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
              { key: "week", label: "Sem.", color: "rgba(255,255,255,0.4)" },
              { key: "type", label: "", render: r => typeIcon(r.type) },
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 120)}</a> : r.caption?.slice(0, 120) },
              { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
              { key: "likes", label: "Likes", fmt: true, color: "#f472b6" },
              { key: "comments", label: "Com.", fmt: true, color: "#60a5fa" },
              { key: "engagement", label: "Engage.", render: renderEng, color: "#34d399" },
            ]} />
        </>)}

        {/* MARQUES */}
        {page === "marques" && (<>
          <KPI items={[["\ud83c\udfe2 Comptes", brands.length, "#a78bfa"], ["\ud83c\udfac Vid\u00e9os", fmt(_.sumBy(brands, "nbVideos")), "#818cf8"], ["\ud83d\udc41 Moy. vues", fmt(Math.round(_.meanBy(brands, "avgViews") || 0)), "#f472b6"], ["\ud83d\udd25 Virales", fmt(_.sumBy(brands, "nbViral")), "#fbbf24"]]} />
          <SortTable data={brands} gridCols="1fr 80px 65px 80px 110px 95px 80px 65px 55px 55px" exportData={expMarques} exportHeaders={hMarques} exportName="marques" searchPlaceholder="\ud83d\udd0d Rechercher un compte..."
            columns={[
              { key: "compte", label: "Compte", bold: true, color: "#fff", render: r => <span>{r.platforms?.map(p => platformIcon(p)).join(" ")} {r.compte}</span> },
              { key: "nbVideos", label: "Vid\u00e9os", bold: true, color: "#818cf8" },
              { key: "avgVidsPerWeek", label: "Moy./Sem.", render: r => <span style={{ color: "#a78bfa" }}>{r.avgVidsPerWeek}</span> },
              { key: "avgViews", label: "Moy. vues", render: r => fmt(Math.round(r.avgViews)), bold: true, color: "#f472b6" },
              { key: "avgEngagement", label: "Engage.", render: r => <span style={{ color: "#34d399", fontWeight: 600 }}>{(r.avgEngagement * 100).toFixed(2)}%</span> },
              { key: "nbViral", label: "> 2.5x", render: r => <span>{r.nbViral > 0 ? <span style={{ color: "#fbbf24" }}>{r.nbViral}</span> : <span style={{ color: "rgba(255,255,255,0.25)" }}>0</span>}{r.nbViral > 0 && r.nbVideos > 0 && <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 4, fontSize: 11 }}>({Math.round(r.nbViral / r.nbVideos * 100)}%)</span>}</span> },
              { key: "nbChaud", label: "\ud83d\udd25 Chaud", render: r => <span style={{ color: "#f59e0b" }}>{r.nbChaud}</span> },
              { key: "nbFroid", label: "\u2744\ufe0f Froid", render: r => <span style={{ color: "#60a5fa" }}>{r.nbFroid}</span> },
            ]} />
        </>)}

        {/* VIRAUX */}
        {page === "viraux" && (<>
          <KPI items={[["\ud83d\udd25 Total", viralRows.length, "#fbbf24"], ["\u2744\ufe0f Froid", nbFroid, "#60a5fa"], ["\ud83d\udd25 Chaud", nbChaud, "#ef4444"]]} />
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            {[["froid", "\u2744\ufe0f Froid", "#60a5fa"], ["chaud", "\ud83d\udd25 Chaud", "#ef4444"], ["all", "Tous", "rgba(255,255,255,0.5)"]].map(([k, l, c]) => (
              <button key={k} onClick={() => setViralFilter(k)} style={{ padding: "7px 14px", borderRadius: 8, border: viralFilter === k ? "1px solid " + c : "1px solid rgba(255,255,255,0.1)", background: viralFilter === k ? c + "22" : "transparent", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: viralFilter === k ? 600 : 400 }}>{l}</button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Clique \u2715 pour exclure</span>
          </div>
          <SortTable data={filteredViral} gridCols="30px 95px 70px 1fr 80px 75px 50px 65px 45px 30px 30px" exportData={expViraux} exportHeaders={hViraux} exportName="viraux"
            columns={[
              platCol,
              { key: "compte", label: "Compte", bold: true, color: "#fff" },
              { key: "date", label: "Date", render: r => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 90)}</a> : r.caption?.slice(0, 90) },
              { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
              { key: "avgCompte", label: "Moy.", fmt: true, color: "rgba(255,255,255,0.4)" },
              { key: "ratio", label: "Ratio", render: r => <span style={{ color: "#fbbf24", fontWeight: 700 }}>{r.ratio}x</span> },
              { key: "engagement", label: "Eng.", render: renderEng, color: "#34d399" },
              { key: "tempType", label: "Type", render: r => r.tempType === "froid" ? <span style={{ color: "#60a5fa" }}>\u2744\ufe0f</span> : <span style={{ color: "#ef4444" }}>\ud83d\udd25</span> },
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
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 90)}</a> : r.caption?.slice(0, 90) },
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
          <SortTable data={sponsoRows} gridCols="30px 95px 75px 35px 1fr 75px 60px 55px 70px 30px" exportData={expSponso} exportHeaders={hSponso} exportName="sponso"
            columns={[
              platCol,
              { key: "compte", label: "Compte", bold: true, color: "#fff" },
              { key: "date", label: "Date", render: r => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
              { key: "type", label: "", render: r => typeIcon(r.type) },
              { key: "caption", label: "Caption", title: true, color: "rgba(255,255,255,0.75)", render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 110)}</a> : r.caption?.slice(0, 110) },
              { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
              { key: "likes", label: "Likes", fmt: true, color: "#f472b6" },
              { key: "comments", label: "Com.", fmt: true, color: "#60a5fa" },
              { key: "engagement", label: "Engage.", render: renderEng, color: "#34d399" },
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
