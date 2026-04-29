import { useState, useCallback, useMemo } from "react";
import Papa from "papaparse";
import _ from "lodash";
import * as XLSX from "xlsx";

/* ──────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────── */
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
    return isNaN(d) ? v : d.toLocaleDateString("fr-FR");
  } catch {
    return v;
  }
};

const fmtPct = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return n.toFixed(2) + "%";
};

/* ISO week number */
const getWeekNumber = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
};

const getWeekLabel = (dateStr) => {
  const w = getWeekNumber(dateStr);
  return w ? `S${w}` : "";
};

const getWeekRange = (dateStr) => {
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
};

/* ──────────────────────────────────────────────
   MANUAL EXCLUDE LIST (hot content URLs)
   ────────────────────────────────────────────── */
const MANUAL_EXCLUDE = [
  // ── Instagram ──
  // Ajouter ici les URLs Instagram classées "chaud"
  // "https://www.instagram.com/reel/XXXXX/",

  // ── TikTok ──
  // Ajouter ici les URLs TikTok classées "chaud"
  // "https://www.tiktok.com/@user/video/XXXXX",
];

/* ──────────────────────────────────────────────
   COLUMN AUTO-DETECTION (Instagram + TikTok)
   ────────────────────────────────────────────── */
const COLUMN_MAPS = {
  instagram: {
    url: ["url", "inputUrl", "input_url", "postUrl", "post_url", "shortCode"],
    date: ["timestamp", "date", "createDate", "created_at", "takenAt"],
    caption: ["caption", "text", "description", "alt"],
    likes: ["likesCount", "likes", "like_count", "diggCount"],
    comments: ["commentsCount", "comments", "comment_count", "commentCount"],
    views: ["videoViewCount", "views", "view_count", "playCount", "videoPlayCount"],
    shares: ["sharesCount", "shares", "share_count", "shareCount"],
    saves: ["savesCount", "saves", "save_count", "collectCount"],
    owner: ["ownerUsername", "owner", "username", "author", "authorMeta/name", "uniqueId"],
    followers: ["followersCount", "followers", "follower_count", "authorMeta/fans"],
    type: ["type", "mediaType", "media_type"],
    music: ["musicMeta/musicName", "music", "audio", "musicName"],
    hashtags: ["hashtags", "challenges", "tags"],
    sponsored: ["isSponsored", "isPaidPartnership", "branded", "is_paid_partnership"],
    duration: ["videoDuration", "duration", "video_duration"],
    er: ["engagementRate", "er", "engagement_rate"],
  },
  tiktok: {
    url: ["webVideoUrl", "url", "video_url", "inputUrl", "input_url"],
    date: ["createTimeISO", "createTime", "date", "created_at", "timestamp"],
    caption: ["text", "desc", "caption", "description"],
    likes: ["diggCount", "likes", "likesCount", "like_count", "stats/diggCount"],
    comments: ["commentCount", "comments", "commentsCount", "comment_count", "stats/commentCount"],
    views: ["playCount", "views", "videoViewCount", "view_count", "stats/playCount"],
    shares: ["shareCount", "shares", "sharesCount", "share_count", "stats/shareCount"],
    saves: ["collectCount", "saves", "savesCount", "save_count", "stats/collectCount"],
    owner: ["authorMeta/name", "uniqueId", "author", "ownerUsername", "username", "authorMeta/uniqueId"],
    followers: ["authorMeta/fans", "followers", "followersCount", "follower_count", "authorMeta/followers"],
    type: ["type", "mediaType"],
    music: ["musicMeta/musicName", "music", "audio", "musicName"],
    hashtags: ["challenges", "hashtags", "tags"],
    sponsored: ["isAd", "isPaidPartnership", "isSponsored", "branded"],
    duration: ["videoMeta/duration", "duration", "videoDuration", "video_duration"],
    er: ["engagementRate", "er", "engagement_rate"],
  },
};

const detectPlatform = (headers) => {
  const h = headers.map((c) => c.toLowerCase());
  const tiktokSignals = ["diggcount", "playcountcount", "collectcount", "createtimeiso", "authormeta/name", "webvideourl", "uniqueid"];
  const matchCount = tiktokSignals.filter((s) => h.some((hh) => hh.includes(s.toLowerCase()))).length;
  return matchCount >= 2 ? "tiktok" : "instagram";
};

const resolveCol = (row, candidates) => {
  for (const c of candidates) {
    if (c.includes("/")) {
      const parts = c.split("/");
      let val = row;
      for (const p of parts) {
        val = val?.[p];
        if (val === undefined) break;
      }
      if (val !== undefined) return val;
    }
    if (row[c] !== undefined && row[c] !== null && row[c] !== "") return row[c];
  }
  return null;
};

const mapRow = (row, colMap) => ({
  url: resolveCol(row, colMap.url) || "",
  date: resolveCol(row, colMap.date) || "",
  caption: resolveCol(row, colMap.caption) || "",
  likes: Number(resolveCol(row, colMap.likes)) || 0,
  comments: Number(resolveCol(row, colMap.comments)) || 0,
  views: Number(resolveCol(row, colMap.views)) || 0,
  shares: Number(resolveCol(row, colMap.shares)) || 0,
  saves: Number(resolveCol(row, colMap.saves)) || 0,
  owner: resolveCol(row, colMap.owner) || "Inconnu",
  followers: Number(resolveCol(row, colMap.followers)) || 0,
  type: resolveCol(row, colMap.type) || "",
  music: resolveCol(row, colMap.music) || "",
  hashtags: resolveCol(row, colMap.hashtags) || "",
  sponsored: resolveCol(row, colMap.sponsored),
  duration: Number(resolveCol(row, colMap.duration)) || 0,
  er: Number(resolveCol(row, colMap.er)) || 0,
});

/* ──────────────────────────────────────────────
   SUSPECT / SPONSO DETECTION
   ────────────────────────────────────────────── */
const SUSPECT_KEYWORDS = [
  "pub", "partenariat", "collaboration", "sponsor", "sponsorisé",
  "gifted", "offert", "collab", "promo", "ambassador", "ambassadeur",
  "ambassadrice", "#ad", "#pub", "#sponsorisé", "#partenariat",
  "lien en bio", "code promo", "link in bio", "discount code",
  "affiliated", "affilié",
];

const isSuspectSponso = (row) => {
  const txt = (row.caption || "").toLowerCase();
  return SUSPECT_KEYWORDS.some((kw) => txt.includes(kw.toLowerCase()));
};

const isConfirmedSponso = (row) => {
  const v = row.sponsored;
  return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
};

/* ──────────────────────────────────────────────
   HOT/COLD CLASSIFICATION
   ────────────────────────────────────────────── */
const isHot = (row) => MANUAL_EXCLUDE.includes(row.url);
const isCold = (row) => !isHot(row);

/* ──────────────────────────────────────────────
   VIRAL THRESHOLD
   ────────────────────────────────────────────── */
const VIRAL_THRESHOLD = 2;

const isViral = (row) => {
  if (!row.followers || row.followers === 0) return row.views > 100000;
  const ratio = row.views / row.followers;
  return ratio >= VIRAL_THRESHOLD;
};

/* ──────────────────────────────────────────────
   STYLES
   ────────────────────────────────────────────── */
const COLORS = {
  bg: "#0f1117",
  card: "#1a1d27",
  cardHover: "#22263a",
  border: "#2a2e3f",
  accent: "#6c5ce7",
  accentLight: "#a29bfe",
  text: "#e2e8f0",
  textDim: "#94a3b8",
  textMuted: "#64748b",
  green: "#00b894",
  red: "#e17055",
  orange: "#fdcb6e",
  blue: "#74b9ff",
  pink: "#fd79a8",
  white: "#ffffff",
};

const S = {
  page: {
    minHeight: "100vh",
    background: `linear-gradient(135deg, ${COLORS.bg} 0%, #1a1025 50%, ${COLORS.bg} 100%)`,
    color: COLORS.text,
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    padding: "0",
  },
  container: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: "24px 20px",
  },
  header: {
    textAlign: "center",
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    background: `linear-gradient(135deg, ${COLORS.accentLight}, ${COLORS.pink})`,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textDim,
  },
  dropzone: {
    border: `2px dashed ${COLORS.border}`,
    borderRadius: 16,
    padding: "48px 24px",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.3s ease",
    background: COLORS.card,
    marginBottom: 24,
  },
  dropzoneActive: {
    borderColor: COLORS.accent,
    background: "rgba(108, 92, 231, 0.1)",
  },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 24,
    background: COLORS.card,
    borderRadius: 12,
    padding: 4,
    flexWrap: "wrap",
  },
  tab: {
    padding: "10px 18px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    transition: "all 0.2s ease",
    background: "transparent",
    color: COLORS.textDim,
    whiteSpace: "nowrap",
  },
  tabActive: {
    background: COLORS.accent,
    color: COLORS.white,
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 13,
  },
  th: {
    padding: "12px 14px",
    textAlign: "left",
    fontWeight: 700,
    color: COLORS.textDim,
    borderBottom: `2px solid ${COLORS.border}`,
    position: "sticky",
    top: 0,
    background: COLORS.card,
    zIndex: 1,
    whiteSpace: "nowrap",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  td: {
    padding: "10px 14px",
    borderBottom: `1px solid ${COLORS.border}`,
    verticalAlign: "middle",
    maxWidth: 260,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tr: {
    transition: "background 0.15s ease",
  },
  btn: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    transition: "all 0.2s ease",
  },
  btnPrimary: {
    background: COLORS.accent,
    color: COLORS.white,
  },
  btnSmall: {
    padding: "4px 10px",
    fontSize: 12,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
    marginBottom: 24,
  },
  kpiCard: {
    background: COLORS.card,
    borderRadius: 12,
    padding: "18px 20px",
    border: `1px solid ${COLORS.border}`,
  },
  kpiLabel: {
    fontSize: 11,
    color: COLORS.textDim,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: 800,
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
  },
  filterBar: {
    display: "flex",
    gap: 8,
    marginBottom: 16,
    flexWrap: "wrap",
    alignItems: "center",
  },
  select: {
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${COLORS.border}`,
    background: COLORS.card,
    color: COLORS.text,
    fontSize: 13,
  },
  footer: {
    textAlign: "center",
    padding: "24px 0 12px",
    color: COLORS.textMuted,
    fontSize: 12,
    borderTop: `1px solid ${COLORS.border}`,
    marginTop: 40,
  },
  tableWrap: {
    overflowX: "auto",
    background: COLORS.card,
    borderRadius: 12,
    border: `1px solid ${COLORS.border}`,
  },
  platformBadge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    marginLeft: 8,
  },
};

/* ──────────────────────────────────────────────
   EXPORT EXCEL
   ────────────────────────────────────────────── */
const exportExcel = (data, platform, tab) => {
  const wb = XLSX.utils.book_new();

  const makeSheet = (rows, name) => {
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        URL: r.url,
        Date: fmtDate(r.date),
        Semaine: getWeekLabel(r.date),
        Compte: r.owner,
        Caption: r.caption,
        Vues: r.views,
        Likes: r.likes,
        Commentaires: r.comments,
        Partages: r.shares,
        Saves: r.saves,
        Followers: r.followers,
        "Ratio V/F": r.followers ? (r.views / r.followers).toFixed(2) : "—",
        "Chaud/Froid": isHot(r) ? "Chaud" : "Froid",
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  if (tab === "all") {
    makeSheet(data, "Contenus");
    const viraux = data.filter(isViral);
    makeSheet(viraux.filter(isCold), "Viraux Froid");
    makeSheet(viraux.filter(isHot), "Viraux Chaud");
    makeSheet(data.filter(isSuspectSponso), "Suspects");
    makeSheet(data.filter(isConfirmedSponso), "Sponsos");
  } else {
    makeSheet(data, tab);
  }

  XLSX.writeFile(wb, `dashboard_${platform}_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

/* ──────────────────────────────────────────────
   MAIN COMPONENT
   ────────────────────────────────────────────── */
export default function Dashboard() {
  const [data, setData] = useState([]);
  const [platform, setPlatform] = useState(null);
  const [activeTab, setActiveTab] = useState("contenus");
  const [dragOver, setDragOver] = useState(false);
  const [sortCol, setSortCol] = useState("views");
  const [sortDir, setSortDir] = useState("desc");
  const [viralFilter, setViralFilter] = useState("froid");
  const [searchTerm, setSearchTerm] = useState("");
  const [localExclude, setLocalExclude] = useState([]);

  /* Combined exclude list (MANUAL_EXCLUDE + session removals) */
  const allExclude = useMemo(
    () => new Set([...MANUAL_EXCLUDE, ...localExclude]),
    [localExclude]
  );

  const isHotLive = useCallback(
    (row) => allExclude.has(row.url),
    [allExclude]
  );
  const isColdLive = useCallback(
    (row) => !allExclude.has(row.url),
    [allExclude]
  );

  /* Parse CSV */
  const handleFile = useCallback((file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const detected = detectPlatform(headers);
        setPlatform(detected);
        const colMap = COLUMN_MAPS[detected];
        const mapped = results.data
          .map((row) => mapRow(row, colMap))
          .filter((r) => r.url);
        setData(mapped);
        setActiveTab("contenus");
      },
    });
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  /* Sort */
  const doSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sortData = useCallback(
    (arr) =>
      _.orderBy(arr, [(r) => (typeof r[sortCol] === "number" ? r[sortCol] : 0)], [sortDir]),
    [sortCol, sortDir]
  );

  const filterSearch = useCallback(
    (arr) => {
      if (!searchTerm) return arr;
      const q = searchTerm.toLowerCase();
      return arr.filter(
        (r) =>
          (r.caption || "").toLowerCase().includes(q) ||
          (r.owner || "").toLowerCase().includes(q) ||
          (r.url || "").toLowerCase().includes(q)
      );
    },
    [searchTerm]
  );

  /* Tab data */
  const contenus = useMemo(() => sortData(filterSearch(data)), [data, sortData, filterSearch]);
  const viraux = useMemo(() => {
    const v = data.filter(isViral);
    if (viralFilter === "froid") return sortData(filterSearch(v.filter(isColdLive)));
    if (viralFilter === "chaud") return sortData(filterSearch(v.filter(isHotLive)));
    return sortData(filterSearch(v));
  }, [data, sortData, filterSearch, viralFilter, isColdLive, isHotLive]);

  const suspects = useMemo(() => sortData(filterSearch(data.filter(isSuspectSponso))), [data, sortData, filterSearch]);
  const sponsos = useMemo(() => sortData(filterSearch(data.filter(isConfirmedSponso))), [data, sortData, filterSearch]);

  /* ── MARQUES TAB DATA ── */
  const marquesData = useMemo(() => {
    const groups = _.groupBy(data, "owner");
    /* Distinct weeks in dataset */
    const allWeeks = new Set(data.map((r) => getWeekLabel(r.date)).filter(Boolean));
    const nbWeeks = Math.max(allWeeks.size, 1);

    return Object.entries(groups)
      .map(([owner, rows]) => {
        const totalViews = _.sumBy(rows, "views");
        const totalLikes = _.sumBy(rows, "likes");
        const totalComments = _.sumBy(rows, "comments");
        const totalShares = _.sumBy(rows, "shares");
        const totalSaves = _.sumBy(rows, "saves");
        const avgFollowers = Math.round(_.meanBy(rows, "followers"));
        const nbVideos = rows.length;
        const nbVirales = rows.filter(isViral).length;
        const nbHot = rows.filter(isHotLive).length;
        const nbCold = rows.filter(isColdLive).length;
        const avgViewsPerVideo = Math.round(totalViews / nbVideos);
        const avgVideosPerWeek = (nbVideos / nbWeeks).toFixed(1);

        /* ER moyen */
        const avgER =
          avgFollowers > 0
            ? (((totalLikes + totalComments) / nbVideos / avgFollowers) * 100).toFixed(2)
            : 0;

        return {
          owner,
          nbVideos,
          totalViews,
          totalLikes,
          totalComments,
          totalShares,
          totalSaves,
          avgFollowers,
          avgViewsPerVideo,
          avgER,
          nbVirales,
          nbHot,
          nbCold,
          avgVideosPerWeek,
        };
      })
      .filter((m) => m.nbVideos >= 3)
      .sort((a, b) => b.totalViews - a.totalViews);
  }, [data, isHotLive, isColdLive]);

  /* ── TOGGLE HOT/COLD in session ── */
  const toggleHot = (url) => {
    setLocalExclude((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  /* ── RENDER HELPERS ── */
  const SortHeader = ({ col, label }) => (
    <th
      style={{ ...S.th, cursor: "pointer", userSelect: "none" }}
      onClick={() => doSort(col)}
    >
      {label} {sortCol === col ? (sortDir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  const KPI = ({ label, value, color }) => (
    <div style={S.kpiCard}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color: color || COLORS.accentLight }}>{value}</div>
    </div>
  );

  /* ── UPLOAD SCREEN ── */
  if (data.length === 0) {
    return (
      <div style={S.page}>
        <div style={S.container}>
          <div style={S.header}>
            <div style={S.title}>Social Media Dashboard</div>
            <div style={S.subtitle}>Instagram & TikTok — Analyse de contenus</div>
          </div>
          <div
            style={{ ...S.dropzone, ...(dragOver ? S.dropzoneActive : {}) }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById("csv-input").click()}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Importe ton fichier Apify
            </div>
            <div style={{ color: COLORS.textDim, fontSize: 14 }}>
              Glisse ton CSV ici ou clique pour parcourir
            </div>
            <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 8 }}>
              Détection automatique Instagram / TikTok
            </div>
            <input
              id="csv-input"
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files[0]) handleFile(e.target.files[0]);
              }}
            />
          </div>
          <div style={S.footer}>© 2026 Clément Dubois — Tous droits réservés</div>
        </div>
      </div>
    );
  }

  /* ── KPI SUMMARY ── */
  const totalViews = _.sumBy(data, "views");
  const totalLikes = _.sumBy(data, "likes");
  const totalViraux = data.filter(isViral).length;
  const nbBrands = new Set(data.map((r) => r.owner)).size;

  const TABS = [
    { id: "contenus", label: "📋 Contenus", count: data.length },
    { id: "marques", label: "🏷️ Marques", count: marquesData.length },
    { id: "viraux", label: "🔥 Viraux", count: totalViraux },
    { id: "suspects", label: "🔍 Suspects", count: suspects.length },
    { id: "sponsos", label: "💰 Sponsos", count: sponsos.length },
  ];

  /* ── CONTENUS TABLE ── */
  const renderContenus = () => (
    <>
      <div style={S.kpiGrid}>
        <KPI label="Total vidéos" value={fmt(data.length)} color={COLORS.blue} />
        <KPI label="Total vues" value={fmt(totalViews)} color={COLORS.green} />
        <KPI label="Total likes" value={fmt(totalLikes)} color={COLORS.pink} />
        <KPI label="Viraux" value={fmt(totalViraux)} color={COLORS.orange} />
        <KPI label="Marques" value={fmt(nbBrands)} color={COLORS.accentLight} />
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Semaine</th>
              <th style={S.th}>Compte</th>
              <SortHeader col="views" label="Vues" />
              <SortHeader col="likes" label="Likes" />
              <SortHeader col="comments" label="Com." />
              <SortHeader col="shares" label="Part." />
              <SortHeader col="saves" label="Saves" />
              <th style={S.th}>Ratio V/F</th>
              <th style={S.th}>Caption</th>
            </tr>
          </thead>
          <tbody>
            {contenus.map((r, i) => (
              <tr
                key={r.url + i}
                style={{
                  ...S.tr,
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.cardHover)}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)")
                }
              >
                <td style={{ ...S.td, color: COLORS.textMuted }}>{i + 1}</td>
                <td style={S.td}>{fmtDate(r.date)}</td>
                <td style={S.td}>
                  <span
                    style={{
                      ...S.badge,
                      background: "rgba(108,92,231,0.15)",
                      color: COLORS.accentLight,
                    }}
                  >
                    {getWeekLabel(r.date)}
                  </span>
                  <span
                    style={{ fontSize: 10, color: COLORS.textMuted, marginLeft: 4 }}
                  >
                    {getWeekRange(r.date)}
                  </span>
                </td>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: COLORS.accentLight, textDecoration: "none" }}
                  >
                    {r.owner}
                  </a>
                </td>
                <td style={{ ...S.td, fontWeight: 700 }}>{fmt(r.views)}</td>
                <td style={S.td}>{fmt(r.likes)}</td>
                <td style={S.td}>{fmt(r.comments)}</td>
                <td style={S.td}>{fmt(r.shares)}</td>
                <td style={S.td}>{fmt(r.saves)}</td>
                <td style={S.td}>
                  <span
                    style={{
                      ...S.badge,
                      background:
                        r.followers && r.views / r.followers >= VIRAL_THRESHOLD
                          ? "rgba(0,184,148,0.15)"
                          : "transparent",
                      color:
                        r.followers && r.views / r.followers >= VIRAL_THRESHOLD
                          ? COLORS.green
                          : COLORS.textDim,
                    }}
                  >
                    {r.followers ? (r.views / r.followers).toFixed(2) : "—"}
                  </span>
                </td>
                <td
                  style={{ ...S.td, maxWidth: 200, color: COLORS.textDim, fontSize: 12 }}
                  title={r.caption}
                >
                  {r.caption?.slice(0, 60)}
                  {r.caption?.length > 60 ? "…" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  /* ── MARQUES TABLE ── */
  const renderMarques = () => (
    <>
      <div style={S.kpiGrid}>
        <KPI label="Total marques (≥3 vidéos)" value={marquesData.length} color={COLORS.blue} />
        <KPI
          label="Moy. vidéos/semaine"
          value={
            marquesData.length
              ? (marquesData.reduce((s, m) => s + parseFloat(m.avgVideosPerWeek), 0) / marquesData.length).toFixed(1)
              : "—"
          }
          color={COLORS.green}
        />
        <KPI
          label="Total vidéos actu chaude"
          value={fmt(marquesData.reduce((s, m) => s + m.nbHot, 0))}
          color={COLORS.red}
        />
        <KPI
          label="Total vidéos froides"
          value={fmt(marquesData.reduce((s, m) => s + m.nbCold, 0))}
          color={COLORS.blue}
        />
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>Marque</th>
              <th style={S.th}>Vidéos</th>
              <th style={S.th}>Moy./sem</th>
              <th style={S.th}>Vues totales</th>
              <th style={S.th}>Moy. vues</th>
              <th style={S.th}>Likes</th>
              <th style={S.th}>Com.</th>
              <th style={S.th}>Part.</th>
              <th style={S.th}>Saves</th>
              <th style={S.th}>Followers</th>
              <th style={S.th}>ER moy.</th>
              <th style={S.th}>Virales</th>
              <th style={S.th}>🔥 Chaud</th>
              <th style={S.th}>❄️ Froid</th>
            </tr>
          </thead>
          <tbody>
            {marquesData.map((m, i) => (
              <tr
                key={m.owner}
                style={{
                  ...S.tr,
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.cardHover)}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)")
                }
              >
                <td style={{ ...S.td, color: COLORS.textMuted }}>{i + 1}</td>
                <td style={{ ...S.td, fontWeight: 700 }}>{m.owner}</td>
                <td style={S.td}>{m.nbVideos}</td>
                <td style={S.td}>
                  <span
                    style={{
                      ...S.badge,
                      background: "rgba(0,184,148,0.15)",
                      color: COLORS.green,
                    }}
                  >
                    {m.avgVideosPerWeek}
                  </span>
                </td>
                <td style={{ ...S.td, fontWeight: 700 }}>{fmt(m.totalViews)}</td>
                <td style={S.td}>{fmt(m.avgViewsPerVideo)}</td>
                <td style={S.td}>{fmt(m.totalLikes)}</td>
                <td style={S.td}>{fmt(m.totalComments)}</td>
                <td style={S.td}>{fmt(m.totalShares)}</td>
                <td style={S.td}>{fmt(m.totalSaves)}</td>
                <td style={S.td}>{fmt(m.avgFollowers)}</td>
                <td style={S.td}>{fmtPct(m.avgER)}</td>
                <td style={S.td}>
                  <span
                    style={{
                      ...S.badge,
                      background: "rgba(253,203,110,0.15)",
                      color: COLORS.orange,
                    }}
                  >
                    {m.nbVirales}
                  </span>
                </td>
                <td style={S.td}>
                  <span
                    style={{
                      ...S.badge,
                      background: "rgba(225,112,85,0.15)",
                      color: COLORS.red,
                    }}
                  >
                    {m.nbHot}
                  </span>
                </td>
                <td style={S.td}>
                  <span
                    style={{
                      ...S.badge,
                      background: "rgba(116,185,255,0.15)",
                      color: COLORS.blue,
                    }}
                  >
                    {m.nbCold}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  /* ── VIRAUX TABLE ── */
  const renderViraux = () => (
    <>
      <div style={S.filterBar}>
        <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.textDim }}>Filtre :</span>
        {["froid", "chaud", "tous"].map((f) => (
          <button
            key={f}
            style={{
              ...S.btnSmall,
              background: viralFilter === f ? COLORS.accent : COLORS.card,
              color: viralFilter === f ? COLORS.white : COLORS.textDim,
              border: `1px solid ${COLORS.border}`,
            }}
            onClick={() => setViralFilter(f)}
          >
            {f === "froid" ? "❄️ Froid" : f === "chaud" ? "🔥 Chaud" : "📊 Tous"}
          </button>
        ))}
        <span style={{ fontSize: 12, color: COLORS.textMuted, marginLeft: 8 }}>
          {viraux.length} vidéos
        </span>
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Semaine</th>
              <th style={S.th}>Compte</th>
              <SortHeader col="views" label="Vues" />
              <SortHeader col="likes" label="Likes" />
              <SortHeader col="comments" label="Com." />
              <th style={S.th}>Ratio V/F</th>
              <th style={S.th}>Type</th>
              <th style={S.th}>Caption</th>
              <th style={S.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {viraux.map((r, i) => {
              const hot = isHotLive(r);
              return (
                <tr
                  key={r.url + i}
                  style={{
                    ...S.tr,
                    background: hot
                      ? "rgba(225,112,85,0.06)"
                      : i % 2 === 0
                      ? "transparent"
                      : "rgba(255,255,255,0.02)",
                  }}
                >
                  <td style={{ ...S.td, color: COLORS.textMuted }}>{i + 1}</td>
                  <td style={S.td}>{fmtDate(r.date)}</td>
                  <td style={S.td}>
                    <span
                      style={{
                        ...S.badge,
                        background: "rgba(108,92,231,0.15)",
                        color: COLORS.accentLight,
                      }}
                    >
                      {getWeekLabel(r.date)}
                    </span>
                  </td>
                  <td style={{ ...S.td, fontWeight: 600 }}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: COLORS.accentLight, textDecoration: "none" }}
                    >
                      {r.owner}
                    </a>
                  </td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{fmt(r.views)}</td>
                  <td style={S.td}>{fmt(r.likes)}</td>
                  <td style={S.td}>{fmt(r.comments)}</td>
                  <td style={S.td}>
                    <span style={{ ...S.badge, background: "rgba(0,184,148,0.15)", color: COLORS.green }}>
                      {r.followers ? (r.views / r.followers).toFixed(2) : "—"}
                    </span>
                  </td>
                  <td style={S.td}>
                    <span
                      style={{
                        ...S.badge,
                        background: hot ? "rgba(225,112,85,0.15)" : "rgba(116,185,255,0.15)",
                        color: hot ? COLORS.red : COLORS.blue,
                      }}
                    >
                      {hot ? "🔥 Chaud" : "❄️ Froid"}
                    </span>
                  </td>
                  <td
                    style={{ ...S.td, maxWidth: 180, color: COLORS.textDim, fontSize: 12 }}
                    title={r.caption}
                  >
                    {r.caption?.slice(0, 50)}
                    {r.caption?.length > 50 ? "…" : ""}
                  </td>
                  <td style={S.td}>
                    <button
                      style={{
                        ...S.btnSmall,
                        background: hot ? "rgba(0,184,148,0.15)" : "rgba(225,112,85,0.15)",
                        color: hot ? COLORS.green : COLORS.red,
                      }}
                      title={hot ? "Remettre en froid" : "Marquer comme chaud"}
                      onClick={() => toggleHot(r.url)}
                    >
                      {hot ? "↩️" : "✕"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  /* ── GENERIC TABLE (Suspects / Sponsos) ── */
  const renderGenericTable = (rows, label) => (
    <>
      <div style={S.kpiGrid}>
        <KPI label={`Total ${label}`} value={rows.length} color={COLORS.orange} />
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Semaine</th>
              <th style={S.th}>Compte</th>
              <SortHeader col="views" label="Vues" />
              <SortHeader col="likes" label="Likes" />
              <th style={S.th}>Ratio V/F</th>
              <th style={S.th}>Caption</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.url + i}
                style={{
                  ...S.tr,
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.cardHover)}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)")
                }
              >
                <td style={{ ...S.td, color: COLORS.textMuted }}>{i + 1}</td>
                <td style={S.td}>{fmtDate(r.date)}</td>
                <td style={S.td}>
                  <span
                    style={{
                      ...S.badge,
                      background: "rgba(108,92,231,0.15)",
                      color: COLORS.accentLight,
                    }}
                  >
                    {getWeekLabel(r.date)}
                  </span>
                </td>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: COLORS.accentLight, textDecoration: "none" }}
                  >
                    {r.owner}
                  </a>
                </td>
                <td style={{ ...S.td, fontWeight: 700 }}>{fmt(r.views)}</td>
                <td style={S.td}>{fmt(r.likes)}</td>
                <td style={S.td}>
                  {r.followers ? (r.views / r.followers).toFixed(2) : "—"}
                </td>
                <td
                  style={{ ...S.td, maxWidth: 240, color: COLORS.textDim, fontSize: 12 }}
                  title={r.caption}
                >
                  {r.caption?.slice(0, 80)}
                  {r.caption?.length > 80 ? "…" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  /* ── MAIN RENDER ── */
  return (
    <div style={S.page}>
      <div style={S.container}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.title}>Social Media Dashboard</div>
          <div style={S.subtitle}>
            {platform === "tiktok" ? "TikTok" : "Instagram"} — {data.length} contenus chargés
            <span
              style={{
                ...S.platformBadge,
                background:
                  platform === "tiktok" ? "rgba(0,0,0,0.4)" : "rgba(225,48,108,0.15)",
                color: platform === "tiktok" ? "#fff" : "#e1306c",
              }}
            >
              {platform === "tiktok" ? "♪ TikTok" : "📷 Instagram"}
            </span>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ ...S.filterBar, justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              placeholder="🔍 Rechercher..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                ...S.select,
                width: 220,
              }}
            />
            <button
              style={{ ...S.btn, ...S.btnPrimary, fontSize: 12, padding: "8px 16px" }}
              onClick={() => exportExcel(data, platform, "all")}
            >
              📥 Export Excel
            </button>
          </div>
          <button
            style={{
              ...S.btnSmall,
              background: "rgba(225,112,85,0.15)",
              color: COLORS.red,
              border: `1px solid ${COLORS.border}`,
              padding: "6px 12px",
            }}
            onClick={() => {
              setData([]);
              setPlatform(null);
              setLocalExclude([]);
              setSearchTerm("");
            }}
          >
            🔄 Nouveau CSV
          </button>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              style={{
                ...S.tab,
                ...(activeTab === t.id ? S.tabActive : {}),
              }}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "contenus" && renderContenus()}
        {activeTab === "marques" && renderMarques()}
        {activeTab === "viraux" && renderViraux()}
        {activeTab === "suspects" && renderGenericTable(suspects, "Suspects")}
        {activeTab === "sponsos" && renderGenericTable(sponsos, "Sponsos")}

        {/* Footer */}
        <div style={S.footer}>© 2026 Clément Dubois — Tous droits réservés</div>
      </div>
    </div>
  );
}
