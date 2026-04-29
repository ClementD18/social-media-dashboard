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
   ──────────────────────────────────────────────
   Règles CHAUD : politique, faits divers, actu
   internationale, guerres, décès, procès,
   municipales, résultats sportifs, crues/inondations
   
   Règle FROID : tout le reste (lifestyle, culture,
   témoignages intemporels, recettes, science, humour)
   
   En cas de doute → FROID
   ────────────────────────────────────────────── */
const MANUAL_EXCLUDE = [
  // ══════════════════════════════════════════════
  // INSTAGRAM — CHAUD
  // ══════════════════════════════════════════════
  "https://www.instagram.com/p/DXEJYTTgP7j/",
  "https://www.instagram.com/p/DWuNt9uCTYP/",
  "https://www.instagram.com/p/DWwDoH2kccQ/",
  "https://www.instagram.com/p/DXE3vlCjxJR/",
  "https://www.instagram.com/p/DXEhh-LEQ4w/",
  "https://www.instagram.com/p/DWtc3aLkWZY/",
  "https://www.instagram.com/p/DW9YSNTiBas/",
  "https://www.instagram.com/p/DW9MyLHADzl/",
  "https://www.instagram.com/p/DXH0icfCtO3/",
  "https://www.instagram.com/p/DXJhyrSkb8R/",
  "https://www.instagram.com/p/DW6oQokgA-K/",
  "https://www.instagram.com/p/DW4bgLtmsux/",
  "https://www.instagram.com/p/DWoVFs6D9Tn/",
  "https://www.instagram.com/p/DXG7m7HjZiI/",
  "https://www.instagram.com/p/DW8ckyYkXpl/",
  "https://www.instagram.com/p/DW8m-fHl0zo/",
  "https://www.instagram.com/p/DW0_eKkkoPX/",
  "https://www.instagram.com/p/DXJYFHbFMU8/",
  "https://www.instagram.com/p/DWxqmgfjgox/",
  "https://www.instagram.com/p/DMfyPiyywEL/",
  "https://www.instagram.com/p/DRDO4GAAM83/",
  "https://www.instagram.com/p/DWySn1ikX3K/",
  "https://www.instagram.com/p/DWmZu1ID32u/",
  "https://www.instagram.com/p/DWlfDf3Daiv/",
  "https://www.instagram.com/p/DXEb3yyAmnP/",
  "https://www.instagram.com/p/DXB-UB6lbwv/",
  "https://www.instagram.com/p/DWIvDRtj20p/",
  "https://www.instagram.com/p/DXCZwlZkfj9/",
  "https://www.instagram.com/p/DXCRj8aj-ai/",
  "https://www.instagram.com/p/DW3_p1PjYX4/",
  "https://www.instagram.com/p/DXB1jsgicHX/",
  "https://www.instagram.com/p/DUlGE3EjY1a/",
  "https://www.instagram.com/p/DW8gor_Cgb1/",
  "https://www.instagram.com/p/DW9aeQZCj9_/",
  "https://www.instagram.com/p/DW8aaWPFPOn/",
  "https://www.instagram.com/p/DXHOw0YgHm4/",
  "https://www.instagram.com/p/DW09w2fD2Yz/",
  "https://www.instagram.com/p/DXBi6x0CWyC/",
  "https://www.instagram.com/p/DXKcviIgNBK/",
  "https://www.instagram.com/p/DW9kw98lLaH/",
  "https://www.instagram.com/p/DWjxinHCWEI/",
  "https://www.instagram.com/p/DXE3uoJid7w/",
  "https://www.instagram.com/p/DWpFg6JEZxL/",
  "https://www.instagram.com/p/DWoq6xtkxy6/",
  "https://www.instagram.com/p/DXFTMVdFPEy/",
  "https://www.instagram.com/p/DWlTUBZDZCj/",
  "https://www.instagram.com/p/DWzDCNCgY7r/",
  "https://www.instagram.com/p/DWlrL9TAU5g/",
  "https://www.instagram.com/p/DXH1GVYgKIH/",
  "https://www.instagram.com/p/DW4LbArCAjF/",
  "https://www.instagram.com/p/DW09kE7lIbh/",
  "https://www.instagram.com/p/DXFZp8bk6O1/",
  "https://www.instagram.com/p/DWo-C4TkUml/",
  "https://www.instagram.com/p/DWrllqvk_7A/",
  "https://www.instagram.com/p/DWqzJxdjjiZ/",
  "https://www.instagram.com/p/DWrS1hdDJTB/",
  "https://www.instagram.com/p/DXHZITEidY8/",
  "https://www.instagram.com/p/DW9gNx4gm9V/",
  "https://www.instagram.com/p/DWyJtH5inQK/",
  "https://www.instagram.com/p/DWwo5OADidl/",
  "https://www.instagram.com/p/DXJ5g7Sklgh/",
  "https://www.instagram.com/p/DWmBdjgkfMF/",
  "https://www.instagram.com/p/DW5rEZmCb2b/",
  "https://www.instagram.com/p/DWmTf8sCLKP/",
  "https://www.instagram.com/p/DW1jfs8jC2L/",
  "https://www.instagram.com/p/DW9aeKvgO2a/",
  "https://www.instagram.com/p/DW1frk6lLgW/",
  "https://www.instagram.com/p/DWzK0f1iV1x/",
  "https://www.instagram.com/p/DW1y_8ekZWj/",
  "https://www.instagram.com/p/DXE1aGvAATH/",
  "https://www.instagram.com/p/DWrJ31FDh0h/",
  "https://www.instagram.com/p/DW-3KwSjTGr/",
  "https://www.instagram.com/p/DXEuZOUinTA/",
  "https://www.instagram.com/p/DW9oeDvjiIZ/",
  "https://www.instagram.com/p/DXJVGuCCkkq/",
  "https://www.instagram.com/p/DW9Pg-llBVk/",
  "https://www.instagram.com/p/DXE3tShhQCz/",
  "https://www.instagram.com/p/DWmZo1ZAQv4/",
  "https://www.instagram.com/p/DWt5rfdDp-t/",
  "https://www.instagram.com/p/DW9XDyEFPjJ/",
  "https://www.instagram.com/p/DXH3p-FCl_4/",
  "https://www.instagram.com/p/DW8fnkvkqBh/",
  "https://www.instagram.com/p/DW4fGfZCT9_/",
  "https://www.instagram.com/p/DUBmzk0jlZM/",

  // ══════════════════════════════════════════════
  // TIKTOK — Politique / Municipales
  // ══════════════════════════════════════════════
  "https://www.tiktok.com/@leberryrepublicain/video/7610839452038040854",
  "https://www.tiktok.com/@leberryrepublicain/video/7608266037099777302",
  "https://www.tiktok.com/@france3paris_idf/video/7631625585793568022",
  "https://www.tiktok.com/@france3paris_idf/video/7620499504172666114",
  "https://www.tiktok.com/@france3paris_idf/video/7620226031147928854",
  "https://www.tiktok.com/@france3paris_idf/video/7620205898668985622",
  "https://www.tiktok.com/@france3bfc/video/7620460979834473750",
  "https://www.tiktok.com/@france3bfc/video/7616425702904139030",
  "https://www.tiktok.com/@f3cvdl/video/7627045065529117974",
  "https://www.tiktok.com/@france_3_aura/video/7618619305864793366",
  "https://www.tiktok.com/@nice_matin/video/7620146464475352352",
  "https://www.tiktok.com/@presseocean/video/7618247047354797345",
  "https://www.tiktok.com/@france3grandest/video/7633394259319622945",
  "https://www.tiktok.com/@guyanela1ere/video/7620263045964598550",
  "https://www.tiktok.com/@mayotte_la1ere/video/7620121970490838294",
  "https://www.tiktok.com/@mayotte_la1ere/video/7617566311257853206",
  "https://www.tiktok.com/@martiniquela1ere/video/7613862466275052822",
  "https://www.tiktok.com/@vert_le_media/video/7620197107013635350",
  "https://www.tiktok.com/@publicsenat/video/7633415524239559968",
  "https://www.tiktok.com/@publicsenat/video/7633391388171717921",
  "https://www.tiktok.com/@publicsenat/video/7629022820927851809",
  "https://www.tiktok.com/@lcp_an/video/7633506803971624214",
  "https://www.tiktok.com/@lcp_an/video/7629405524206882070",
  "https://www.tiktok.com/@lcp_an/video/7628936274145070358",
  "https://www.tiktok.com/@lcp_an/video/7627071925310983446",
  "https://www.tiktok.com/@lcp_an/video/7626801588618726678",
  "https://www.tiktok.com/@lcp_an/video/7626427140946365719",
  "https://www.tiktok.com/@lcp_an/video/7626411653105585430",
  "https://www.tiktok.com/@quotidienofficiel/video/7631160806117412119",
  "https://www.tiktok.com/@lalsacefr/video/7626998813688876320",
  "https://www.tiktok.com/@slatefr/video/7623421208188521750",
  "https://www.tiktok.com/@mediapartfr/video/7603080506258771222",
  "https://www.tiktok.com/@bonpoteofficiel/video/7624260322794196246",
  "https://www.tiktok.com/@bonpoteofficiel/video/7623087828053855510",
  "https://www.tiktok.com/@france3pdl/video/7627121216612076822",

  // ══════════════════════════════════════════════
  // TIKTOK — Guerre / Actu internationale
  // ══════════════════════════════════════════════
  "https://www.tiktok.com/@france24/video/7633389529398824225",
  "https://www.tiktok.com/@france24/video/7631903644610268449",
  "https://www.tiktok.com/@france24/video/7630794750517398816",
  "https://www.tiktok.com/@france24/video/7626755995364117793",
  "https://www.tiktok.com/@france24/video/7626273399660236064",
  "https://www.tiktok.com/@rfi/video/7633450539665100064",
  "https://www.tiktok.com/@rfi/video/7632016390852988192",
  "https://www.tiktok.com/@afpfr/video/7633386630237179168",
  "https://www.tiktok.com/@afpfr/video/7631598626363493664",
  "https://www.tiktok.com/@lemondefr/video/7632721117618195745",
  "https://www.tiktok.com/@lemondefr/video/7632611639543581984",
  "https://www.tiktok.com/@m6info_/video/7611976512387992854",
  "https://www.tiktok.com/@m6info_/video/7612224093676490006",
  "https://www.tiktok.com/@tf1info/video/7633412640009653526",
  "https://www.tiktok.com/@tf1info/video/7633000751064714518",
  "https://www.tiktok.com/@tf1info/video/7632967246033194262",
  "https://www.tiktok.com/@tf1info/video/7632959527763102998",
  "https://www.tiktok.com/@tf1info/video/7632340338190912790",
  "https://www.tiktok.com/@cnews/video/7632326054442503426",
  "https://www.tiktok.com/@cnews/video/7631872318519708950",
  "https://www.tiktok.com/@quotidienofficiel/video/7632299425490062614",
  "https://www.tiktok.com/@quotidienofficiel/video/7631185001958198550",
  "https://www.tiktok.com/@france.inter/video/7616803817056701718",
  "https://www.tiktok.com/@france.inter/video/7594203974325062934",
  "https://www.tiktok.com/@lehuffpostfr/video/7620046573619154198",
  "https://www.tiktok.com/@alter_eco/video/7600860831315741974",
  "https://www.tiktok.com/@lexpress/video/7626690577739894049",
  "https://www.tiktok.com/@lexpress/video/7625893282999995680",
  "https://www.tiktok.com/@lesechos.fr/video/7620520004328443158",
  "https://www.tiktok.com/@mariannelemag/video/7612712245595786518",
  "https://www.tiktok.com/@brutofficiel/video/7633513953645088022",
  "https://www.tiktok.com/@brutofficiel/video/7632927394923400470",
  "https://www.tiktok.com/@brutofficiel/video/7632914180223421718",
  "https://www.tiktok.com/@franceinfo/video/7633321088021286177",
  "https://www.tiktok.com/@franceinfo/video/7633058203047103766",
  "https://www.tiktok.com/@franceinfo/video/7633012537059003670",
  "https://www.tiktok.com/@bfmtv/video/7633351871633132822",
  "https://www.tiktok.com/@bfmtv/video/7633311317675265302",
  "https://www.tiktok.com/@bfmtv/video/7632981364928761110",
  "https://www.tiktok.com/@bfmtv/video/7632916314889162006",
  "https://www.tiktok.com/@bfmtv/video/7633100330263219478",
  "https://www.tiktok.com/@sellmeparis/video/7628543896225697046",
  "https://www.tiktok.com/@le20hfrancetelevisions/video/7633686669694127392",
  "https://www.tiktok.com/@bonpoteofficiel/video/7622669972388580630",
  "https://www.tiktok.com/@ladepechedumidi/video/7613726644091489558",

  // ══════════════════════════════════════════════
  // TIKTOK — Faits divers (actu chaude)
  // ══════════════════════════════════════════════
  "https://www.tiktok.com/@france3grandest/video/7629002715707788577",
  "https://www.tiktok.com/@france3normandie/video/7631182829015026966",
  "https://www.tiktok.com/@france3occitanie/video/7626811857889676576",
  "https://www.tiktok.com/@france3pdl/video/7631124594455285014",
  "https://www.tiktok.com/@france3pdl/video/7627162781720120598",
  "https://www.tiktok.com/@leparisien/video/7629354105072291094",
  "https://www.tiktok.com/@leparisien/video/7632729029623254294",
  "https://www.tiktok.com/@leparisien/video/7630893311032593686",
  "https://www.tiktok.com/@lemondefr/video/7631103307838197025",
  "https://www.tiktok.com/@france3paca/video/7632727867616546081",
  "https://www.tiktok.com/@polynesiela1ere/video/7634017584429616400",
  "https://www.tiktok.com/@polynesiela1ere/video/7633274591888100626",
  "https://www.tiktok.com/@polynesiela1ere/video/7631802032634055957",
  "https://www.tiktok.com/@polynesiela1ere/video/7619965872853028097",
  "https://www.tiktok.com/@ncla1ere/video/7626636762449743125",
  "https://www.tiktok.com/@lefigaro/video/7633477375723867424",

  // ══════════════════════════════════════════════
  // TIKTOK — Procès / Justice (actu)
  // ══════════════════════════════════════════════
  "https://www.tiktok.com/@septahuit_off/video/7628521240591944982",
  "https://www.tiktok.com/@bfmbusiness/video/7628237841675472150",
  "https://www.tiktok.com/@corsematin/video/7620945076704906528",

  // ══════════════════════════════════════════════
  // TIKTOK — Décès (actu)
  // ══════════════════════════════════════════════
  "https://www.tiktok.com/@tv5monde/video/7632238039103704342",
  "https://www.tiktok.com/@nice_matin/video/7627051571745918241",
  "https://www.tiktok.com/@nice_matin/video/7627044897077464353",
  "https://www.tiktok.com/@nouvelobs/video/7621902151811337505",
  "https://www.tiktok.com/@slatefr/video/7608923214730890518",

  // ══════════════════════════════════════════════
  // TIKTOK — Résultats sportifs (actu)
  // ══════════════════════════════════════════════
  "https://www.tiktok.com/@lequipe/video/7633114097067773216",
  "https://www.tiktok.com/@lequipe/video/7632310113763593505",
  "https://www.tiktok.com/@lequipe/video/7631945981642181921",
  "https://www.tiktok.com/@lequipe/video/7630938183240322336",
  "https://www.tiktok.com/@laprovence_/video/7633196331946806561",
  "https://www.tiktok.com/@laprovence_/video/7630158996199968022",
  "https://www.tiktok.com/@lavoixdunord/video/7631616549576756483",
  "https://www.tiktok.com/@france3grandest/video/7630833042642193696",
  "https://www.tiktok.com/@bfmbusiness/video/7633470590065724694",

  // ══════════════════════════════════════════════
  // TIKTOK — Crues / Inondations
  // ══════════════════════════════════════════════
  "https://www.tiktok.com/@leberryrepublicain/video/7608619058497408278",
  "https://www.tiktok.com/@ici.officiel/video/7608529465123163424",
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
      for (const p of parts) { val = val?.[p]; if (val === undefined) break; }
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

const SUSPECT_KEYWORDS = ["pub","partenariat","collaboration","sponsor","sponsorisé","gifted","offert","collab","promo","ambassador","ambassadeur","ambassadrice","#ad","#pub","#sponsorisé","#partenariat","lien en bio","code promo","link in bio","discount code","affiliated","affilié"];
const isSuspectSponso = (row) => { const txt = (row.caption || "").toLowerCase(); return SUSPECT_KEYWORDS.some((kw) => txt.includes(kw.toLowerCase())); };
const isConfirmedSponso = (row) => { const v = row.sponsored; return v === true || v === "true" || v === 1 || v === "1" || v === "yes"; };

const isHot = (row) => MANUAL_EXCLUDE.includes(row.url);
const isCold = (row) => !isHot(row);

const VIRAL_THRESHOLD = 2;
const isViral = (row) => { if (!row.followers || row.followers === 0) return row.views > 100000; return row.views / row.followers >= VIRAL_THRESHOLD; };

const COLORS = { bg:"#0f1117", card:"#1a1d27", cardHover:"#22263a", border:"#2a2e3f", accent:"#6c5ce7", accentLight:"#a29bfe", text:"#e2e8f0", textDim:"#94a3b8", textMuted:"#64748b", green:"#00b894", red:"#e17055", orange:"#fdcb6e", blue:"#74b9ff", pink:"#fd79a8", white:"#ffffff" };

const S = {
  page: { minHeight:"100vh", background:`linear-gradient(135deg, ${COLORS.bg} 0%, #1a1025 50%, ${COLORS.bg} 100%)`, color:COLORS.text, fontFamily:"'Segoe UI', system-ui, -apple-system, sans-serif", padding:"0" },
  container: { maxWidth:1400, margin:"0 auto", padding:"24px 20px" },
  header: { textAlign:"center", marginBottom:32 },
  title: { fontSize:28, fontWeight:800, background:`linear-gradient(135deg, ${COLORS.accentLight}, ${COLORS.pink})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:8 },
  subtitle: { fontSize:14, color:COLORS.textDim },
  dropzone: { border:`2px dashed ${COLORS.border}`, borderRadius:16, padding:"48px 24px", textAlign:"center", cursor:"pointer", transition:"all 0.3s ease", background:COLORS.card, marginBottom:24 },
  dropzoneActive: { borderColor:COLORS.accent, background:"rgba(108,92,231,0.1)" },
  tabs: { display:"flex", gap:4, marginBottom:24, background:COLORS.card, borderRadius:12, padding:4, flexWrap:"wrap" },
  tab: { padding:"10px 18px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, transition:"all 0.2s ease", background:"transparent", color:COLORS.textDim, whiteSpace:"nowrap" },
  tabActive: { background:COLORS.accent, color:COLORS.white },
  table: { width:"100%", borderCollapse:"separate", borderSpacing:0, fontSize:13 },
  th: { padding:"12px 14px", textAlign:"left", fontWeight:700, color:COLORS.textDim, borderBottom:`2px solid ${COLORS.border}`, position:"sticky", top:0, background:COLORS.card, zIndex:1, whiteSpace:"nowrap", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em" },
  td: { padding:"10px 14px", borderBottom:`1px solid ${COLORS.border}`, verticalAlign:"middle", maxWidth:260, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  tr: { transition:"background 0.15s ease" },
  btn: { padding:"10px 20px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13, transition:"all 0.2s ease" },
  btnPrimary: { background:COLORS.accent, color:COLORS.white },
  btnSmall: { padding:"4px 10px", fontSize:12, borderRadius:6, border:"none", cursor:"pointer", fontWeight:600 },
  kpiGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:16, marginBottom:24 },
  kpiCard: { background:COLORS.card, borderRadius:12, padding:"18px 20px", border:`1px solid ${COLORS.border}` },
  kpiLabel: { fontSize:11, color:COLORS.textDim, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 },
  kpiValue: { fontSize:24, fontWeight:800 },
  badge: { display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:700 },
  filterBar: { display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" },
  select: { padding:"8px 12px", borderRadius:8, border:`1px solid ${COLORS.border}`, background:COLORS.card, color:COLORS.text, fontSize:13 },
  footer: { textAlign:"center", padding:"24px 0 12px", color:COLORS.textMuted, fontSize:12, borderTop:`1px solid ${COLORS.border}`, marginTop:40 },
  tableWrap: { overflowX:"auto", background:COLORS.card, borderRadius:12, border:`1px solid ${COLORS.border}` },
  platformBadge: { display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:700, marginLeft:8 },
  infoBanner: { background:"rgba(116,185,255,0.08)", border:"1px solid rgba(116,185,255,0.2)", borderRadius:12, padding:"14px 18px", marginBottom:20, fontSize:13, color:COLORS.textDim, lineHeight:1.5 },
};

const exportExcel = (data, platform, tab) => {
  const wb = XLSX.utils.book_new();
  const makeSheet = (rows, name) => { const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({ URL:r.url, Date:fmtDate(r.date), Semaine:getWeekLabel(r.date), Compte:r.owner, Caption:r.caption, Vues:r.views, Likes:r.likes, Commentaires:r.comments, Partages:r.shares, Saves:r.saves, Followers:r.followers, "Ratio V/F":r.followers?(r.views/r.followers).toFixed(2):"—", "Chaud/Froid":isHot(r)?"Chaud":"Froid" }))); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
  if (tab === "all") { makeSheet(data, "Contenus"); const viraux = data.filter(isViral); makeSheet(viraux.filter(isCold), "Viraux Froid"); makeSheet(viraux.filter(isHot), "Viraux Chaud"); makeSheet(data.filter(isSuspectSponso), "Suspects"); makeSheet(data.filter(isConfirmedSponso), "Sponsos"); } else { makeSheet(data, tab); }
  XLSX.writeFile(wb, `dashboard_${platform}_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

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

  const allExclude = useMemo(() => new Set([...MANUAL_EXCLUDE, ...localExclude]), [localExclude]);
  const isHotLive = useCallback((row) => allExclude.has(row.url), [allExclude]);
  const isColdLive = useCallback((row) => !allExclude.has(row.url), [allExclude]);

  const handleFile = useCallback((file) => {
    Papa.parse(file, { header:true, skipEmptyLines:true, dynamicTyping:true, complete:(results) => {
      const headers = results.meta.fields || [];
      const detected = detectPlatform(headers);
      setPlatform(detected);
      const colMap = COLUMN_MAPS[detected];
      const mapped = results.data.map((row) => mapRow(row, colMap)).filter((r) => r.url);
      setData(mapped);
      setActiveTab("contenus");
    }});
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0]; if (f) handleFile(f); }, [handleFile]);

  const doSort = (col) => { if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc")); else { setSortCol(col); setSortDir("desc"); } };
  const sortData = useCallback((arr) => _.orderBy(arr, [(r) => (typeof r[sortCol] === "number" ? r[sortCol] : 0)], [sortDir]), [sortCol, sortDir]);
  const filterSearch = useCallback((arr) => { if (!searchTerm) return arr; const q = searchTerm.toLowerCase(); return arr.filter((r) => (r.caption||"").toLowerCase().includes(q) || (r.owner||"").toLowerCase().includes(q) || (r.url||"").toLowerCase().includes(q)); }, [searchTerm]);

  const contenus = useMemo(() => sortData(filterSearch(data)), [data, sortData, filterSearch]);
  const viraux = useMemo(() => { const v = data.filter(isViral); if (viralFilter === "froid") return sortData(filterSearch(v.filter(isColdLive))); if (viralFilter === "chaud") return sortData(filterSearch(v.filter(isHotLive))); return sortData(filterSearch(v)); }, [data, sortData, filterSearch, viralFilter, isColdLive, isHotLive]);
  const froidRows = useMemo(() => sortData(filterSearch(data.filter(isViral).filter(isColdLive))), [data, sortData, filterSearch, isColdLive]);
  const suspects = useMemo(() => sortData(filterSearch(data.filter(isSuspectSponso))), [data, sortData, filterSearch]);
  const sponsos = useMemo(() => sortData(filterSearch(data.filter(isConfirmedSponso))), [data, sortData, filterSearch]);

  const marquesData = useMemo(() => {
    const groups = _.groupBy(data, "owner");
    const allWeeks = new Set(data.map((r) => getWeekLabel(r.date)).filter(Boolean));
    const nbWeeks = Math.max(allWeeks.size, 1);
    return Object.entries(groups).map(([owner, rows]) => {
      const totalViews = _.sumBy(rows,"views"); const totalLikes = _.sumBy(rows,"likes"); const totalComments = _.sumBy(rows,"comments"); const totalShares = _.sumBy(rows,"shares"); const totalSaves = _.sumBy(rows,"saves");
      const avgFollowers = Math.round(_.meanBy(rows,"followers")); const nbVideos = rows.length; const nbVirales = rows.filter(isViral).length;
      const nbHot = rows.filter(isHotLive).length; const nbCold = rows.filter(isColdLive).length;
      const avgViewsPerVideo = Math.round(totalViews / nbVideos); const avgVideosPerWeek = (nbVideos / nbWeeks).toFixed(1);
      const avgER = avgFollowers > 0 ? (((totalLikes + totalComments) / nbVideos / avgFollowers) * 100).toFixed(2) : 0;
      return { owner, nbVideos, totalViews, totalLikes, totalComments, totalShares, totalSaves, avgFollowers, avgViewsPerVideo, avgER, nbVirales, nbHot, nbCold, avgVideosPerWeek };
    }).filter((m) => m.nbVideos >= 3).sort((a, b) => b.totalViews - a.totalViews);
  }, [data, isHotLive, isColdLive]);

  const toggleHot = (url) => { setLocalExclude((prev) => prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]); };

  const SortHeader = ({ col, label }) => (<th style={{ ...S.th, cursor:"pointer", userSelect:"none" }} onClick={() => doSort(col)}>{label} {sortCol === col ? (sortDir === "desc" ? "▼" : "▲") : ""}</th>);
  const KPI = ({ label, value, color }) => (<div style={S.kpiCard}><div style={S.kpiLabel}>{label}</div><div style={{ ...S.kpiValue, color: color || COLORS.accentLight }}>{value}</div></div>);

  if (data.length === 0) {
    return (<div style={S.page}><div style={S.container}><div style={S.header}><div style={S.title}>Social Media Dashboard</div><div style={S.subtitle}>Instagram & TikTok — Analyse de contenus</div></div>
      <div style={{ ...S.dropzone, ...(dragOver ? S.dropzoneActive : {}) }} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} onClick={() => document.getElementById("csv-input").click()}>
        <div style={{ fontSize:48, marginBottom:16 }}>📂</div><div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Importe ton fichier Apify</div><div style={{ color:COLORS.textDim, fontSize:14 }}>Glisse ton CSV ici ou clique pour parcourir</div><div style={{ color:COLORS.textMuted, fontSize:12, marginTop:8 }}>Détection automatique Instagram / TikTok</div>
        <input id="csv-input" type="file" accept=".csv" style={{ display:"none" }} onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
      </div><div style={S.footer}>© 2026 Clément Dubois — Tous droits réservés</div></div></div>);
  }

  const totalViews = _.sumBy(data,"views"); const totalLikes = _.sumBy(data,"likes"); const totalViraux = data.filter(isViral).length;
  const totalFroid = data.filter(isViral).filter(isColdLive).length; const totalChaud = data.filter(isViral).filter(isHotLive).length;
  const nbBrands = new Set(data.map((r) => r.owner)).size;

  const TABS = [
    { id:"contenus", label:"📋 Contenus", count:data.length },
    { id:"marques", label:"🏷️ Marques", count:marquesData.length },
    { id:"froid", label:"❄️ Froid", count:totalFroid },
    { id:"viraux", label:"🔥 Viraux", count:totalViraux },
    { id:"suspects", label:"🔍 Suspects", count:suspects.length },
    { id:"sponsos", label:"💰 Sponsos", count:sponsos.length },
  ];

  const RowHover = ({ children, i, hot }) => {
    const bg = hot ? "rgba(225,112,85,0.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)";
    return (<tr style={{ ...S.tr, background:bg }} onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.cardHover)} onMouseLeave={(e) => (e.currentTarget.style.background = bg)}>{children}</tr>);
  };

  const renderContenus = () => (<><div style={S.kpiGrid}><KPI label="Total vidéos" value={fmt(data.length)} color={COLORS.blue} /><KPI label="Total vues" value={fmt(totalViews)} color={COLORS.green} /><KPI label="Total likes" value={fmt(totalLikes)} color={COLORS.pink} /><KPI label="Viraux" value={fmt(totalViraux)} color={COLORS.orange} /><KPI label="Marques" value={fmt(nbBrands)} color={COLORS.accentLight} /></div>
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th style={S.th}>#</th><th style={S.th}>Date</th><th style={S.th}>Semaine</th><th style={S.th}>Compte</th><SortHeader col="views" label="Vues" /><SortHeader col="likes" label="Likes" /><SortHeader col="comments" label="Com." /><SortHeader col="shares" label="Part." /><SortHeader col="saves" label="Saves" /><th style={S.th}>Ratio V/F</th><th style={S.th}>Caption</th></tr></thead>
    <tbody>{contenus.map((r, i) => (<RowHover key={r.url+i} i={i}><td style={{ ...S.td, color:COLORS.textMuted }}>{i+1}</td><td style={S.td}>{fmtDate(r.date)}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(108,92,231,0.15)", color:COLORS.accentLight }}>{getWeekLabel(r.date)}</span><span style={{ fontSize:10, color:COLORS.textMuted, marginLeft:4 }}>{getWeekRange(r.date)}</span></td><td style={{ ...S.td, fontWeight:600 }}><a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color:COLORS.accentLight, textDecoration:"none" }}>{r.owner}</a></td><td style={{ ...S.td, fontWeight:700 }}>{fmt(r.views)}</td><td style={S.td}>{fmt(r.likes)}</td><td style={S.td}>{fmt(r.comments)}</td><td style={S.td}>{fmt(r.shares)}</td><td style={S.td}>{fmt(r.saves)}</td><td style={S.td}><span style={{ ...S.badge, background:r.followers && r.views/r.followers>=VIRAL_THRESHOLD?"rgba(0,184,148,0.15)":"transparent", color:r.followers && r.views/r.followers>=VIRAL_THRESHOLD?COLORS.green:COLORS.textDim }}>{r.followers?(r.views/r.followers).toFixed(2):"—"}</span></td><td style={{ ...S.td, maxWidth:200, color:COLORS.textDim, fontSize:12 }} title={r.caption}>{r.caption?.slice(0,60)}{r.caption?.length>60?"…":""}</td></RowHover>))}</tbody></table></div></>);

  const renderMarques = () => (<><div style={S.kpiGrid}><KPI label="Total marques (≥3 vidéos)" value={marquesData.length} color={COLORS.blue} /><KPI label="Moy. vidéos/semaine" value={marquesData.length?(marquesData.reduce((s,m)=>s+parseFloat(m.avgVideosPerWeek),0)/marquesData.length).toFixed(1):"—"} color={COLORS.green} /><KPI label="Total vidéos actu chaude" value={fmt(marquesData.reduce((s,m)=>s+m.nbHot,0))} color={COLORS.red} /><KPI label="Total vidéos froides" value={fmt(marquesData.reduce((s,m)=>s+m.nbCold,0))} color={COLORS.blue} /></div>
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th style={S.th}>#</th><th style={S.th}>Marque</th><th style={S.th}>Vidéos</th><th style={S.th}>Moy./sem</th><th style={S.th}>Vues totales</th><th style={S.th}>Moy. vues</th><th style={S.th}>Likes</th><th style={S.th}>Com.</th><th style={S.th}>Part.</th><th style={S.th}>Saves</th><th style={S.th}>Followers</th><th style={S.th}>ER moy.</th><th style={S.th}>Virales</th><th style={S.th}>🔥 Chaud</th><th style={S.th}>❄️ Froid</th></tr></thead>
    <tbody>{marquesData.map((m, i) => (<RowHover key={m.owner} i={i}><td style={{ ...S.td, color:COLORS.textMuted }}>{i+1}</td><td style={{ ...S.td, fontWeight:700 }}>{m.owner}</td><td style={S.td}>{m.nbVideos}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(0,184,148,0.15)", color:COLORS.green }}>{m.avgVideosPerWeek}</span></td><td style={{ ...S.td, fontWeight:700 }}>{fmt(m.totalViews)}</td><td style={S.td}>{fmt(m.avgViewsPerVideo)}</td><td style={S.td}>{fmt(m.totalLikes)}</td><td style={S.td}>{fmt(m.totalComments)}</td><td style={S.td}>{fmt(m.totalShares)}</td><td style={S.td}>{fmt(m.totalSaves)}</td><td style={S.td}>{fmt(m.avgFollowers)}</td><td style={S.td}>{fmtPct(m.avgER)}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(253,203,110,0.15)", color:COLORS.orange }}>{m.nbVirales}</span></td><td style={S.td}><span style={{ ...S.badge, background:"rgba(225,112,85,0.15)", color:COLORS.red }}>{m.nbHot}</span></td><td style={S.td}><span style={{ ...S.badge, background:"rgba(116,185,255,0.15)", color:COLORS.blue }}>{m.nbCold}</span></td></RowHover>))}</tbody></table></div></>);

  const renderFroid = () => (<>
    <div style={S.infoBanner}>❄️ Contenu <strong style={{ color:COLORS.blue }}>intemporel</strong> : vidéos virales hors actu chaude (politique, guerres, faits divers, résultats sportifs, décès, procès, municipales, crues/inondations). <strong style={{ color:COLORS.white }}>{froidRows.length} vidéos</strong> sur {totalViraux} virales. Règle : en cas de doute → FROID.</div>
    <div style={S.kpiGrid}><KPI label="❄️ Froid" value={froidRows.length} color={COLORS.blue} /><KPI label="🏷️ Comptes" value={new Set(froidRows.map((r)=>r.owner)).size} color={COLORS.accentLight} /><KPI label="👁 Vues moy." value={fmt(Math.round(_.meanBy(froidRows,"views")||0))} color={COLORS.green} /><KPI label="🔥 Chaud exclu" value={totalChaud} color={COLORS.red} /></div>
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th style={S.th}>#</th><th style={S.th}>Date</th><th style={S.th}>Semaine</th><th style={S.th}>Compte</th><SortHeader col="views" label="Vues" /><SortHeader col="likes" label="Likes" /><SortHeader col="comments" label="Com." /><th style={S.th}>Ratio V/F</th><th style={S.th}>Caption</th></tr></thead>
    <tbody>{froidRows.map((r, i) => (<RowHover key={r.url+i} i={i}><td style={{ ...S.td, color:COLORS.textMuted }}>{i+1}</td><td style={S.td}>{fmtDate(r.date)}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(108,92,231,0.15)", color:COLORS.accentLight }}>{getWeekLabel(r.date)}</span></td><td style={{ ...S.td, fontWeight:600 }}><a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color:COLORS.accentLight, textDecoration:"none" }}>{r.owner}</a></td><td style={{ ...S.td, fontWeight:700 }}>{fmt(r.views)}</td><td style={S.td}>{fmt(r.likes)}</td><td style={S.td}>{fmt(r.comments)}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(116,185,255,0.15)", color:COLORS.blue }}>{r.followers?(r.views/r.followers).toFixed(2):"—"}</span></td><td style={{ ...S.td, maxWidth:220, color:COLORS.textDim, fontSize:12 }} title={r.caption}>{r.caption?.slice(0,70)}{r.caption?.length>70?"…":""}</td></RowHover>))}</tbody></table></div></>);

  const renderViraux = () => (<><div style={S.filterBar}><span style={{ fontWeight:700, fontSize:13, color:COLORS.textDim }}>Filtre :</span>
    {["froid","chaud","tous"].map((f) => (<button key={f} style={{ ...S.btnSmall, background:viralFilter===f?COLORS.accent:COLORS.card, color:viralFilter===f?COLORS.white:COLORS.textDim, border:`1px solid ${COLORS.border}` }} onClick={() => setViralFilter(f)}>{f==="froid"?"❄️ Froid":f==="chaud"?"🔥 Chaud":"📊 Tous"}</button>))}
    <span style={{ fontSize:12, color:COLORS.textMuted, marginLeft:8 }}>{viraux.length} vidéos</span></div>
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th style={S.th}>#</th><th style={S.th}>Date</th><th style={S.th}>Semaine</th><th style={S.th}>Compte</th><SortHeader col="views" label="Vues" /><SortHeader col="likes" label="Likes" /><SortHeader col="comments" label="Com." /><th style={S.th}>Ratio V/F</th><th style={S.th}>Type</th><th style={S.th}>Caption</th><th style={S.th}>Action</th></tr></thead>
    <tbody>{viraux.map((r, i) => { const hot = isHotLive(r); return (<RowHover key={r.url+i} i={i} hot={hot}><td style={{ ...S.td, color:COLORS.textMuted }}>{i+1}</td><td style={S.td}>{fmtDate(r.date)}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(108,92,231,0.15)", color:COLORS.accentLight }}>{getWeekLabel(r.date)}</span></td><td style={{ ...S.td, fontWeight:600 }}><a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color:COLORS.accentLight, textDecoration:"none" }}>{r.owner}</a></td><td style={{ ...S.td, fontWeight:700 }}>{fmt(r.views)}</td><td style={S.td}>{fmt(r.likes)}</td><td style={S.td}>{fmt(r.comments)}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(0,184,148,0.15)", color:COLORS.green }}>{r.followers?(r.views/r.followers).toFixed(2):"—"}</span></td><td style={S.td}><span style={{ ...S.badge, background:hot?"rgba(225,112,85,0.15)":"rgba(116,185,255,0.15)", color:hot?COLORS.red:COLORS.blue }}>{hot?"🔥 Chaud":"❄️ Froid"}</span></td><td style={{ ...S.td, maxWidth:180, color:COLORS.textDim, fontSize:12 }} title={r.caption}>{r.caption?.slice(0,50)}{r.caption?.length>50?"…":""}</td><td style={S.td}><button style={{ ...S.btnSmall, background:hot?"rgba(0,184,148,0.15)":"rgba(225,112,85,0.15)", color:hot?COLORS.green:COLORS.red }} title={hot?"Remettre en froid":"Marquer comme chaud"} onClick={() => toggleHot(r.url)}>{hot?"↩️":"✕"}</button></td></RowHover>); })}</tbody></table></div></>);

  const renderGenericTable = (rows, label) => (<><div style={S.kpiGrid}><KPI label={`Total ${label}`} value={rows.length} color={COLORS.orange} /></div>
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th style={S.th}>#</th><th style={S.th}>Date</th><th style={S.th}>Semaine</th><th style={S.th}>Compte</th><SortHeader col="views" label="Vues" /><SortHeader col="likes" label="Likes" /><th style={S.th}>Ratio V/F</th><th style={S.th}>Caption</th></tr></thead>
    <tbody>{rows.map((r, i) => (<RowHover key={r.url+i} i={i}><td style={{ ...S.td, color:COLORS.textMuted }}>{i+1}</td><td style={S.td}>{fmtDate(r.date)}</td><td style={S.td}><span style={{ ...S.badge, background:"rgba(108,92,231,0.15)", color:COLORS.accentLight }}>{getWeekLabel(r.date)}</span></td><td style={{ ...S.td, fontWeight:600 }}><a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color:COLORS.accentLight, textDecoration:"none" }}>{r.owner}</a></td><td style={{ ...S.td, fontWeight:700 }}>{fmt(r.views)}</td><td style={S.td}>{fmt(r.likes)}</td><td style={S.td}>{r.followers?(r.views/r.followers).toFixed(2):"—"}</td><td style={{ ...S.td, maxWidth:240, color:COLORS.textDim, fontSize:12 }} title={r.caption}>{r.caption?.slice(0,80)}{r.caption?.length>80?"…":""}</td></RowHover>))}</tbody></table></div></>);

  return (<div style={S.page}><div style={S.container}>
    <div style={S.header}><div style={S.title}>Social Media Dashboard</div><div style={S.subtitle}>{platform === "tiktok" ? "TikTok" : "Instagram"} — {data.length} contenus chargés<span style={{ ...S.platformBadge, background:platform==="tiktok"?"rgba(0,0,0,0.4)":"rgba(225,48,108,0.15)", color:platform==="tiktok"?"#fff":"#e1306c" }}>{platform === "tiktok" ? "♪ TikTok" : "📷 Instagram"}</span></div></div>

    <div style={{ ...S.filterBar, justifyContent:"space-between" }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <input type="text" placeholder="🔍 Rechercher..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ ...S.select, width:220 }} />
        <button style={{ ...S.btn, ...S.btnPrimary, fontSize:12, padding:"8px 16px" }} onClick={() => exportExcel(data, platform, "all")}>📥 Export Excel</button>
      </div>
      <button style={{ ...S.btnSmall, background:"rgba(225,112,85,0.15)", color:COLORS.red, border:`1px solid ${COLORS.border}`, padding:"6px 12px" }} onClick={() => { setData([]); setPlatform(null); setLocalExclude([]); setSearchTerm(""); }}>🔄 Nouveau CSV</button>
    </div>

    <div style={S.tabs}>{TABS.map((t) => (<button key={t.id} style={{ ...S.tab, ...(activeTab===t.id?S.tabActive:{}) }} onClick={() => setActiveTab(t.id)}>{t.label} ({t.count})</button>))}</div>

    {activeTab === "contenus" && renderContenus()}
    {activeTab === "marques" && renderMarques()}
    {activeTab === "froid" && renderFroid()}
    {activeTab === "viraux" && renderViraux()}
    {activeTab === "suspects" && renderGenericTable(suspects, "Suspects")}
    {activeTab === "sponsos" && renderGenericTable(sponsos, "Sponsos")}

    <div style={S.footer}>© 2026 Clément Dubois — Tous droits réservés</div>
  </div></div>);
}
