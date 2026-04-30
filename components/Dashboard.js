import { useState, useCallback, useMemo } from "react";
import Papa from "papaparse";
import _ from "lodash";
import * as XLSX from "xlsx";

/* ───────────────────────────────────────────
   HELPERS
   ─────────────────────────────────────────── */

const fmt = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("fr-FR");
};

const fmtDate = (v) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    return isNaN(d) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "—"; }
};

const fmtPct = (v) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return (n * 100).toFixed(2) + "%";
};

/* ISO 8601 week number */
function getISOWeek(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
}

function getWeekLabel(dateStr) {
  const w = getISOWeek(dateStr);
  if (!w) return "";
  return `S${w}`;
}

function getWeekRange(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const f = (dt) => dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return `${f(monday)} – ${f(sunday)}`;
}

const typeIcon = (t) => {
  if (!t) return "";
  const l = String(t).toLowerCase();
  if (l === "video" || l === "reels" || l === "reel") return "🎬";
  if (l === "image" || l === "photo") return "🖼️";
  if (l === "sidecar" || l === "carousel" || l === "album") return "📑";
  return "📄";
};

const platformIcon = (p) => (p === "tiktok" ? "🎵" : "📸");

/* ───────────────────────────────────────────
   MANUAL EXCLUDE (chaud/froid system)
   URLs in this list are classified as "froid"
   ─────────────────────────────────────────── */
const MANUAL_EXCLUDE = [
  // Ajouter ici les URLs à exclure manuellement (vidéos froides)
  // "https://www.instagram.com/reel/xxx/",
  // "https://www.tiktok.com/@user/video/xxx",
];

/* ───────────────────────────────────────────
   SPONSO KEYWORDS
   ─────────────────────────────────────────── */
const SPONSO_KEYWORDS = [
  "sponsorisé", "sponsorise", "en collaboration", "partenariat", "partenaire",
  "partnership", "sponsored", "paid partnership", "collab ", "ad ", "#ad",
  "#pub", "#sponso", "#partenariat", "#sponsored",
];

/* ───────────────────────────────────────────
   CSV PLATFORM DETECTION + MAPPING
   ─────────────────────────────────────────── */

function detectPlatform(row) {
  if (row["ownerUsername"] || row["ownerFullName"] || row["videoViewCount"]) return "instagram";
  if (row["authorMeta.name"] || row["playCount"] || row["diggCount"]) return "tiktok";
  return "unknown";
}

function mapRow(row) {
  const g = (k) => {
    const v = row[k];
    return v !== undefined && v !== null && v !== "" ? v : null;
  };
  const platform = detectPlatform(row);

  if (platform === "tiktok") {
    const paid = g("isPaidPartnership") || g("paidPartnership");
    return {
      compte: g("authorMeta.name") || "—",
      date: g("createTimeISO"),
      type: "Video",
      caption: g("text") || "—",
      views: g("playCount"),
      likes: g("diggCount"),
      comments: g("commentCount"),
      shares: g("shareCount"),
      saves: g("collectCount"),
      duration: g("videoMeta.duration"),
      url: g("webVideoUrl") || "",
      isPaid: paid,
      platform: "tiktok",
    };
  }

  // Instagram
  const paid =
    g("isPaidPartnership") || g("paidPartnership") || g("is_paid_partnership") ||
    g("paid_partnership") || g("brandedContentTagName") || g("branded_content_tag_name") ||
    g("sponsorTags/0") || g("sponsor_tags/0");
  return {
    compte: g("ownerUsername") || g("ownerFullName") || "—",
    date: g("timestamp"),
    type: g("type") || g("productType") || "",
    caption: g("caption") || "—",
    views: g("videoViewCount") ?? g("videoPlayCount") ?? g("video_view_count") ?? null,
    likes: g("likesCount") ?? g("likes_count") ?? g("likesCount") ?? null,
    comments: g("commentsCount") ?? g("comments_count") ?? null,
    shares: g("sharesCount") ?? g("shares_count") ?? null,
    saves: g("savesCount") ?? g("saves_count") ?? null,
    duration: g("videoDuration") ?? g("video_duration") ?? null,
    url: g("url") || g("shortCode") ? `https://www.instagram.com/p/${g("shortCode")}/` : "",
    isPaid: paid,
    platform: "instagram",
  };
}

/* ───────────────────────────────────────────
   HOT / COLD classification
   - "froid" = URL is in MANUAL_EXCLUDE
   - "chaud" = everything else
   ─────────────────────────────────────────── */

function classifyHotCold(row) {
  if (!row.url) return "chaud";
  return MANUAL_EXCLUDE.some((u) => row.url.includes(u)) ? "froid" : "chaud";
}

/* ───────────────────────────────────────────
   SORTABLE TABLE COMPONENT
   ─────────────────────────────────────────── */

function SortTable({ data, columns, gridCols, builder, onAction }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");

  const toggle = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    let d = [...data];
    if (search) {
      const q = search.toLowerCase();
      d = d.filter((r) =>
        columns.some((c) => {
          const v = r[c.key];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
        })
      );
    }
    if (sortKey) {
      d.sort((a, b) => {
        let va = a[sortKey], vb = b[sortKey];
        const na = Number(va), nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb)) return sortDir === "desc" ? nb - na : na - nb;
        va = String(va || ""); vb = String(vb || "");
        return sortDir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb);
      });
    }
    return d;
  }, [data, sortKey, sortDir, search, columns]);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <input
          type="text" placeholder="🔍 Rechercher…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, color: "#fff", padding: "8px 14px", fontSize: 13, width: "100%",
            outline: "none",
          }}
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 4, padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.08)", position: "sticky", top: 0, background: "#0f0f13", zIndex: 2 }}>
          {columns.map((c) => (
            <div key={c.key} onClick={() => toggle(c.key)}
              style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", cursor: "pointer", userSelect: "none", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {c.label} {sortKey === c.key ? (sortDir === "desc" ? "▼" : "▲") : ""}
            </div>
          ))}
        </div>
        {/* Rows */}
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Aucun résultat</div>
          )}
          {filtered.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: gridCols, gap: 4, padding: "7px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center", fontSize: 13 }}>
              {columns.map((c) => {
                if (c.render) return <div key={c.key} style={{ color: c.color || "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.render(r, onAction)}</div>;
                const val = r[c.key];
                return (
                  <div key={c.key} style={{ color: c.color || "rgba(255,255,255,0.7)", fontWeight: c.bold ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.fmt ? fmt(val) : (val ?? "—")}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{filtered.length} résultats</div>
    </div>
  );
}

/* ───────────────────────────────────────────
   KPI CARD
   ─────────────────────────────────────────── */

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#fff" }}>{value}</div>
    </div>
  );
}

/* ───────────────────────────────────────────
   MAIN DASHBOARD
   ─────────────────────────────────────────── */

export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState("contenus");
  const [dragOver, setDragOver] = useState(false);
  const [runtimeExclude, setRuntimeExclude] = useState([]);

  // Combined exclusion list: MANUAL_EXCLUDE + runtime
  const allExcluded = useMemo(
    () => [...MANUAL_EXCLUDE, ...runtimeExclude],
    [runtimeExclude]
  );

  /* CSV parsing */
  const handleFiles = useCallback((files) => {
    const allFiles = Array.from(files).filter((f) => f.name.endsWith(".csv"));
    if (!allFiles.length) return;
    let pending = allFiles.length;
    const newRows = [];
    allFiles.forEach((file) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          res.data.forEach((row) => {
            const platform = detectPlatform(row);
            if (platform !== "unknown") newRows.push(mapRow(row));
          });
          pending--;
          if (pending === 0) setRows((prev) => [...prev, ...newRows]);
        },
      });
    });
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }, [handleFiles]);
  const onDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);

  /* Hot/Cold classification using allExcluded */
  const classifyRow = useCallback(
    (r) => {
      if (!r.url) return "chaud";
      return allExcluded.some((u) => r.url.includes(u)) ? "froid" : "chaud";
    },
    [allExcluded]
  );

  /* Engagement rate for a row */
  const engRate = (r) => {
    const v = Number(r.views) || 0;
    const l = Number(r.likes) || 0;
    const c = Number(r.comments) || 0;
    return v > 0 ? (l + c) / v : 0;
  };

  /* Render engagement */
  const renderEng = (r) => {
    const e = engRate(r);
    const color = e > 0.05 ? "#34d399" : e > 0.02 ? "#fbbf24" : "#f87171";
    return <span style={{ color }}>{fmtPct(e)}</span>;
  };

  /* Link column */
  const linkCol = {
    key: "_link", label: "🔗", render: (r) =>
      r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 12 }}>↗</a> : "—",
  };

  /* ───── COMPUTED DATA ───── */
  const computed = useMemo(() => {
    const byCompte = _.groupBy(rows, "compte");

    /* BRANDS */
    const brandsArr = Object.entries(byCompte).map(([compte, vids]) => {
      const views = vids.map((v) => Number(v.views) || 0);
      const avgViews = views.length ? _.mean(views) : 0;
      const totalViews = _.sum(views);
      const totalLikes = _.sumBy(vids, (v) => Number(v.likes) || 0);
      const totalComments = _.sumBy(vids, (v) => Number(v.comments) || 0);
      const engagements = vids.map((v) => engRate(v));
      const avgEng = engagements.length ? _.mean(engagements) : 0;

      // Distinct weeks
      const weeks = new Set(vids.map((v) => getWeekLabel(v.date)).filter(Boolean));
      const nbWeeks = weeks.size || 1;
      const avgVidsPerWeek = vids.length / nbWeeks;

      // Hot/cold counts
      const nbChaud = vids.filter((v) => classifyRow(v) === "chaud").length;
      const nbFroid = vids.filter((v) => classifyRow(v) === "froid").length;

      // Viral count (views > 2.5x avg)
      const nbViral = vids.filter((v) => (Number(v.views) || 0) > avgViews * 2.5).length;

      const platforms = [...new Set(vids.map((v) => v.platform))];

      return {
        compte, nbVideos: vids.length, avgViews: Math.round(avgViews), totalViews,
        totalLikes, totalComments, avgEng, nbViral, vids, platforms,
        nbWeeks, avgVidsPerWeek: Math.round(avgVidsPerWeek * 10) / 10,
        nbChaud, nbFroid,
      };
    }).filter((b) => b.nbVideos >= 3).sort((a, b) => b.totalViews - a.totalViews);

    /* VIRAUX: views > 2.5x account average */
    const viralArr = [];
    brandsArr.forEach((b) => {
      b.vids.forEach((v) => {
        if ((Number(v.views) || 0) > b.avgViews * 2.5) {
          viralArr.push({ ...v, avgCompte: b.avgViews, ratio: b.avgViews > 0 ? ((Number(v.views) || 0) / b.avgViews).toFixed(1) : "—", hotCold: classifyRow(v) });
        }
      });
    });
    viralArr.sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));

    /* SUSPECTS: views > 1.5x avg AND engagement < 50% of avg */
    const suspectArr = [];
    brandsArr.forEach((b) => {
      const engagements = b.vids.map((v) => engRate(v));
      const avgEngBrand = engagements.length ? _.mean(engagements) : 0;
      const viewThreshold = b.avgViews * 1.5;
      const engThreshold = avgEngBrand * 0.5;
      b.vids.forEach((v) => {
        const vw = Number(v.views) || 0;
        const eng = engRate(v);
        if (vw >= viewThreshold && eng <= engThreshold) {
          suspectArr.push({
            ...v, avgCompte: Math.round(b.avgViews), avgEngCompte: avgEngBrand, eng,
            ratioVues: b.avgViews > 0 ? (vw / b.avgViews).toFixed(1) : "—",
            ratioEng: avgEngBrand > 0 ? (eng / avgEngBrand).toFixed(1) : "—",
          });
        }
      });
    });
    suspectArr.sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));

    /* SPONSOS */
    const sponsoRows = rows.filter((r) => {
      const cap = (r.caption || "").toLowerCase();
      const hasPaid = r.isPaid && r.isPaid !== "false" && r.isPaid !== "0" && r.isPaid !== false;
      return hasPaid || SPONSO_KEYWORDS.some((k) => cap.includes(k));
    });

    return { brandsArr, viralArr, suspectArr, sponsoRows };
  }, [rows, classifyRow]);

  const { brandsArr, viralArr, suspectArr, sponsoRows } = computed;

  /* Global stats */
  const tot = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const nbInsta = rows.filter((r) => r.platform === "instagram").length;
  const nbTiktok = rows.filter((r) => r.platform === "tiktok").length;

  /* TABS */
  const TABS = [
    ["contenus", "📝 Contenus"],
    ["marques", "🏢 Marques"],
    ["viraux", "🔥 Viraux"],
    ["suspects", "🤔 Suspects"],
    ["sponso", "🤝 Sponsos"],
  ];

  /* ───── EXPORT EXCEL ───── */
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Contenus
    const contenusData = rows.map((r) => ({
      Plateforme: r.platform === "tiktok" ? "TikTok" : "Instagram",
      Compte: r.compte,
      Date: fmtDate(r.date),
      Semaine: getWeekLabel(r.date),
      Type: r.type,
      Caption: r.caption?.slice(0, 200),
      Vues: Number(r.views) || 0,
      Likes: Number(r.likes) || 0,
      Commentaires: Number(r.comments) || 0,
      Partages: Number(r.shares) || 0,
      "Taux Engagement": engRate(r),
      "Chaud/Froid": classifyRow(r),
      URL: r.url,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contenusData), "Contenus");

    // Sheet 2: Marques
    const marquesData = brandsArr.map((b) => ({
      Compte: b.compte,
      Plateformes: b.platforms.join(", "),
      "Nb Vidéos": b.nbVideos,
      "Moy. Vidéos/Semaine": b.avgVidsPerWeek,
      "Vues Moy.": b.avgViews,
      "Vues Total": b.totalViews,
      "Taux Engage. Moy.": b.avgEng,
      "Vidéos Virales": b.nbViral,
      "Vidéos Chaudes": b.nbChaud,
      "Vidéos Froides": b.nbFroid,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(marquesData), "Marques");

    // Sheet 3: Viraux
    const virauxData = viralArr.map((r) => ({
      Compte: r.compte, Date: fmtDate(r.date), Caption: r.caption?.slice(0, 200),
      Vues: Number(r.views) || 0, "Moy Compte": r.avgCompte, Ratio: r.ratio,
      "Chaud/Froid": r.hotCold, URL: r.url,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(virauxData), "Viraux");

    // Sheet 4: Suspects
    const suspectsData = suspectArr.map((r) => ({
      Compte: r.compte, Date: fmtDate(r.date), Caption: r.caption?.slice(0, 200),
      Vues: Number(r.views) || 0, "Moy Compte": r.avgCompte,
      "Ratio Vues": r.ratioVues, "Ratio Engage.": r.ratioEng, URL: r.url,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suspectsData), "Suspects");

    // Sheet 5: Sponsos
    const sponsosData = sponsoRows.map((r) => ({
      Compte: r.compte, Date: fmtDate(r.date), Caption: r.caption?.slice(0, 200),
      Vues: Number(r.views) || 0, Likes: Number(r.likes) || 0,
      Commentaires: Number(r.comments) || 0, URL: r.url,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sponsosData), "Sponsos");

    XLSX.writeFile(wb, "social-media-dashboard.xlsx");
  };

  /* ───── VIRAL FILTER (chaud / froid) ───── */
  const [viralFilter, setViralFilter] = useState("all"); // "all" | "chaud" | "froid"
  const filteredViraux = useMemo(() => {
    if (viralFilter === "all") return viralArr;
    return viralArr.filter((r) => r.hotCold === viralFilter);
  }, [viralArr, viralFilter]);

  /* Toggle exclude action for Viraux */
  const handleViralAction = (r, action) => {
    if (action === "exclude") {
      if (r.url && !runtimeExclude.includes(r.url)) {
        setRuntimeExclude((prev) => [...prev, r.url]);
      }
    } else if (action === "restore") {
      setRuntimeExclude((prev) => prev.filter((u) => u !== r.url));
    }
  };

  /* ───────── RENDER ───────── */
  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0f", color: "#fff",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>📊 Social Media Dashboard</h1>
            {rows.length > 0 && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                {rows.length} contenus — {nbInsta > 0 && `📸 ${nbInsta} Insta`}{nbInsta > 0 && nbTiktok > 0 && " · "}{nbTiktok > 0 && `🎵 ${nbTiktok} TikTok`}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {rows.length > 0 && (
              <>
                <button onClick={exportExcel} style={{
                  background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)",
                  color: "#34d399", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                }}>
                  📥 Export Excel
                </button>
                <label style={{
                  background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)",
                  color: "#60a5fa", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                }}>
                  ➕ Ajouter CSV
                  <input type="file" accept=".csv" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
                </label>
              </>
            )}
          </div>
        </div>

        {/* DROP ZONE (when empty) */}
        {rows.length === 0 && (
          <div
            onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
            style={{
              border: `2px dashed ${dragOver ? "#60a5fa" : "rgba(255,255,255,0.15)"}`,
              borderRadius: 16, padding: 60, textAlign: "center",
              background: dragOver ? "rgba(96,165,250,0.06)" : "rgba(255,255,255,0.02)",
              transition: "all 0.2s",
            }}
          >
            <p style={{ fontSize: 40, margin: "0 0 12px" }}>📂</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.7)", margin: "0 0 8px" }}>
              Glisse tes fichiers CSV ici
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", margin: "0 0 16px" }}>
              Instagram (Apify) + TikTok — détection automatique
            </p>
            <label style={{
              background: "rgba(96,165,250,0.2)", border: "1px solid rgba(96,165,250,0.3)",
              color: "#60a5fa", padding: "10px 24px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600,
            }}>
              Parcourir…
              <input type="file" accept=".csv" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
            </label>
          </div>
        )}

        {/* Hidden drop zone when data loaded */}
        {rows.length > 0 && (
          <div onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: dragOver ? 999 : -1, background: dragOver ? "rgba(96,165,250,0.08)" : "transparent", pointerEvents: dragOver ? "auto" : "none" }}>
            {dragOver && <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 20, fontWeight: 700, color: "#60a5fa" }}>Dépose tes CSV ici</div>}
          </div>
        )}

        {/* TABS */}
        {rows.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
              {TABS.map(([k, label]) => (
                <button key={k} onClick={() => setPage(k)} style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: page === k ? 700 : 500,
                  background: page === k ? "rgba(255,255,255,0.1)" : "transparent",
                  color: page === k ? "#fff" : "rgba(255,255,255,0.45)",
                  border: page === k ? "1px solid rgba(255,255,255,0.15)" : "1px solid transparent",
                  cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s",
                }}>
                  {label}
                  {k === "viraux" && <span style={{ marginLeft: 6, padding: "2px 7px", borderRadius: 10, background: "rgba(251,191,36,0.2)", color: "#fbbf24", fontSize: 11 }}>{viralArr.length}</span>}
                  {k === "suspects" && <span style={{ marginLeft: 6, padding: "2px 7px", borderRadius: 10, background: "rgba(248,113,113,0.2)", color: "#f87171", fontSize: 11 }}>{suspectArr.length}</span>}
                  {k === "sponso" && <span style={{ marginLeft: 6, padding: "2px 7px", borderRadius: 10, background: "rgba(52,211,153,0.2)", color: "#34d399", fontSize: 11 }}>{sponsoRows.length}</span>}
                </button>
              ))}
            </div>

            {/* KPI ROW */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 16 }}>
              <KpiCard label="Total Vues" value={fmt(tot("views"))} color="#818cf8" />
              <KpiCard label="Total Likes" value={fmt(tot("likes"))} color="#f472b6" />
              <KpiCard label="Total Com." value={fmt(tot("comments"))} color="#60a5fa" />
              <KpiCard label="Marques (≥3)" value={brandsArr.length} color="#fbbf24" />
              <KpiCard label="Viraux" value={viralArr.length} color="#f59e0b" />
              <KpiCard label="Suspects" value={suspectArr.length} color="#f87171" />
            </div>

            {/* ===== CONTENUS ===== */}
            {page === "contenus" && (
              <SortTable
                data={rows}
                gridCols="30px 90px 80px 65px 35px 1fr 75px 60px 55px 70px 35px"
                columns={[
                  { key: "platform", label: "🌐", render: (r) => platformIcon(r.platform) },
                  { key: "compte", label: "Compte", bold: true, color: "#fff" },
                  { key: "date", label: "Date", render: (r) => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
                  { key: "_week", label: "Semaine", render: (r) => {
                    const wl = getWeekLabel(r.date);
                    const wr = getWeekRange(r.date);
                    return wl ? <span title={wr} style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>{wl}</span> : "—";
                  }, color: "rgba(255,255,255,0.4)" },
                  { key: "type", label: "", render: (r) => typeIcon(r.type) },
                  { key: "caption", label: "Caption", color: "rgba(255,255,255,0.75)", render: (r) =>
                    r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 110)}</a> : r.caption?.slice(0, 110),
                  },
                  { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
                  { key: "likes", label: "Likes", fmt: true, color: "#f472b6" },
                  { key: "comments", label: "Com.", fmt: true, color: "#60a5fa" },
                  { key: "engagement", label: "Engage.", render: renderEng, color: "#34d399" },
                  linkCol,
                ]}
              />
            )}

            {/* ===== MARQUES ===== */}
            {page === "marques" && (
              <SortTable
                data={brandsArr}
                gridCols="1fr 55px 65px 80px 80px 85px 85px 70px 60px 55px"
                columns={[
                  { key: "compte", label: "Compte", bold: true, color: "#fff", render: (b) => (
                    <span>{b.platforms.map((p) => platformIcon(p)).join("")} {b.compte}</span>
                  )},
                  { key: "nbVideos", label: "Vidéos", bold: true, color: "#fff" },
                  { key: "avgVidsPerWeek", label: "Moy./Sem.", render: (b) => (
                    <span style={{ color: "#a78bfa" }}>{b.avgVidsPerWeek}</span>
                  ), color: "#a78bfa" },
                  { key: "avgViews", label: "Vues Moy.", fmt: true, color: "#818cf8" },
                  { key: "totalViews", label: "Vues Total", fmt: true, color: "#818cf8" },
                  { key: "avgEng", label: "Engage. Moy.", render: (b) => fmtPct(b.avgEng), color: "#34d399" },
                  { key: "nbViral", label: "> 2.5x moy.", render: (b) => (
                    <span>
                      {b.nbViral > 0 ? <span style={{ color: "#fbbf24" }}>{b.nbViral}</span> : <span style={{ color: "rgba(255,255,255,0.25)" }}>0</span>}
                      {b.nbViral > 0 && b.nbVideos > 0 && <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 4, fontSize: 11 }}>({Math.round(b.nbViral / b.nbVideos * 100)}%)</span>}
                    </span>
                  ), color: "#fbbf24" },
                  { key: "nbChaud", label: "🔥 Chaud", render: (b) => (
                    <span style={{ color: "#f59e0b" }}>{b.nbChaud}</span>
                  ), color: "#f59e0b" },
                  { key: "nbFroid", label: "❄️ Froid", render: (b) => (
                    <span style={{ color: "#60a5fa" }}>{b.nbFroid}</span>
                  ), color: "#60a5fa" },
                ]}
              />
            )}

            {/* ===== VIRAUX ===== */}
            {page === "viraux" && (<>
              {/* Filter bar */}
              <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginRight: 4 }}>Filtre :</span>
                {[["all", "Tous"], ["chaud", "🔥 Chaud"], ["froid", "❄️ Froid"]].map(([k, label]) => (
                  <button key={k} onClick={() => setViralFilter(k)} style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                    background: viralFilter === k ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                    color: viralFilter === k ? "#fff" : "rgba(255,255,255,0.45)",
                    border: viralFilter === k ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(255,255,255,0.06)",
                  }}>
                    {label}
                  </button>
                ))}
                {runtimeExclude.length > 0 && (
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: 8 }}>
                    ({runtimeExclude.length} exclu(es) manuellement)
                  </span>
                )}
              </div>
              <SortTable
                data={filteredViraux}
                gridCols="30px 90px 75px 1fr 75px 70px 55px 55px 35px"
                onAction={handleViralAction}
                columns={[
                  { key: "platform", label: "🌐", render: (r) => platformIcon(r.platform) },
                  { key: "compte", label: "Compte", bold: true, color: "#fff" },
                  { key: "date", label: "Date", render: (r) => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
                  { key: "caption", label: "Caption", color: "rgba(255,255,255,0.75)", render: (r) =>
                    r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 100)}</a> : r.caption?.slice(0, 100),
                  },
                  { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
                  { key: "avgCompte", label: "Moy. Compte", fmt: true, color: "rgba(255,255,255,0.4)" },
                  { key: "ratio", label: "Ratio", render: (r) => <span style={{ color: "#fbbf24" }}>{r.ratio}x</span>, color: "#fbbf24" },
                  { key: "hotCold", label: "🔥/❄️", render: (r, onAction) => {
                    const isFroid = r.hotCold === "froid";
                    return (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: isFroid ? "#60a5fa" : "#f59e0b" }}>{isFroid ? "❄️" : "🔥"}</span>
                        {r.url && (
                          <button
                            onClick={() => onAction && onAction(r, isFroid ? "restore" : "exclude")}
                            title={isFroid ? "Reclasser en chaud" : "Exclure (froid)"}
                            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, padding: 0 }}
                          >
                            {isFroid ? "↩️" : "✕"}
                          </button>
                        )}
                      </span>
                    );
                  }},
                  linkCol,
                ]}
              />
            </>)}

            {/* ===== SUSPECTS ===== */}
            {page === "suspects" && (
              <SortTable
                data={suspectArr}
                gridCols="30px 90px 75px 1fr 75px 70px 65px 65px 35px"
                columns={[
                  { key: "platform", label: "🌐", render: (r) => platformIcon(r.platform) },
                  { key: "compte", label: "Compte", bold: true, color: "#fff" },
                  { key: "date", label: "Date", render: (r) => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
                  { key: "caption", label: "Caption", color: "rgba(255,255,255,0.75)", render: (r) =>
                    r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 100)}</a> : r.caption?.slice(0, 100),
                  },
                  { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
                  { key: "avgCompte", label: "Moy. Compte", fmt: true, color: "rgba(255,255,255,0.4)" },
                  { key: "ratioVues", label: "Ratio Vues", render: (r) => <span style={{ color: "#f87171" }}>{r.ratioVues}x</span>, color: "#f87171" },
                  { key: "ratioEng", label: "Ratio Eng.", render: (r) => <span style={{ color: "#f87171" }}>{r.ratioEng}x</span>, color: "#f87171" },
                  linkCol,
                ]}
              />
            )}

            {/* ===== SPONSOS ===== */}
            {page === "sponso" && (<>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
                <KpiCard label="🤝 Contenus sponso" value={sponsoRows.length} color="#34d399" />
                <KpiCard label="🏢 Comptes" value={_.uniqBy(sponsoRows, "compte").length} color="#a78bfa" />
                <KpiCard label="👁 Vues moy." value={fmt(sponsoRows.length ? Math.round(_.meanBy(sponsoRows, (r) => Number(r.views) || 0)) : 0)} color="#818cf8" />
                <KpiCard label="💬 Engage. moy." value={fmtPct(sponsoRows.length ? _.meanBy(sponsoRows, (r) => engRate(r)) : 0)} color="#34d399" />
              </div>
              <SortTable
                data={sponsoRows}
                gridCols="30px 90px 75px 35px 1fr 75px 60px 55px 70px 35px"
                columns={[
                  { key: "platform", label: "🌐", render: (r) => platformIcon(r.platform) },
                  { key: "compte", label: "Compte", bold: true, color: "#fff" },
                  { key: "date", label: "Date", render: (r) => fmtDate(r.date), color: "rgba(255,255,255,0.5)" },
                  { key: "type", label: "", render: (r) => typeIcon(r.type) },
                  { key: "caption", label: "Caption", color: "rgba(255,255,255,0.75)", render: (r) =>
                    r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{r.caption?.slice(0, 110)}</a> : r.caption?.slice(0, 110),
                  },
                  { key: "views", label: "Vues", fmt: true, bold: true, color: "#818cf8" },
                  { key: "likes", label: "Likes", fmt: true, color: "#f472b6" },
                  { key: "comments", label: "Com.", fmt: true, color: "#60a5fa" },
                  { key: "engagement", label: "Engage.", render: renderEng, color: "#34d399" },
                  linkCol,
                ]}
              />
            </>)}
          </>
        )}

        {/* FOOTER */}
        <div style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", textAlign: "center" }}>
          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, margin: 0 }}>
            © 2026 Clément Dubois — Tous droits réservés
          </p>
        </div>
      </div>
    </div>
  );
}
