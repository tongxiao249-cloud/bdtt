// CreatorDecision · AI 达人决策引擎
// 核心链路：达人数据 → 自动分类 → 画像洞察 → 勾选达人 → AI 生成个性化邮件 → 发送 → 状态追踪

// ---------- 数据 ----------
// 原始内置达人池（const 永不动），CREATORS 是可变副本，loadState 时按需删减
const DEFAULT_CREATORS = [
  {
    id: "rafadealss", name: "Rafa", handle: "@rafadealss",
    email: "rafacollabs03@gmail.com",
    fans: 11100, gmv: 43991, units: 540,
    category: "General", male: null, female: null, gpm: 129,
    trend: { value: 9.4, up: false }, status: "replied",
    insight: "月 GMV $44K、GPM 129，带货效率高但粉丝增长环比 -9.4%。用「收益空间」切入，强调高佣金样品。",
    source: "openboost", products: 14, avgViews: 1470, videos: 86
  },
  {
    id: "dodbao6666", name: "dodbao666", handle: "@dodbao6666",
    email: null,
    fans: 21900, gmv: 62347, units: 5622,
    category: "Phones & Electronics", male: 71.5, female: 14.6, gpm: 10.8,
    age: [
      { label: "18-24", pct: 13 },
      { label: "25-34", pct: 23 },
      { label: "35-44", pct: 24 },
      { label: "45+", pct: 40 }
    ],
    trend: { value: 200, up: true }, status: "new",
    insight: "月销 5,622 单、GMV $62K，男性科技受众 71.5%。客单仅 ~$11，$40 摄像头能显著拉高其 AOV 和 GMV。",
    source: "openboost", products: 79, avgViews: 4338, videos: 594
  },
  {
    id: "josiahfinds", name: "Josiah", handle: "@josiahfinds",
    email: "josiahfinds@gmail.com",
    fans: 6463, gmv: 2643, units: 391,
    category: "Home & Electronics", male: 21.6, female: 68.0, gpm: 88.4,
    age: [
      { label: "18-24", pct: 22 },
      { label: "25-34", pct: 15 },
      { label: "35-44", pct: 17 },
      { label: "45+", pct: 46 }
    ],
    trend: { value: 113.1, up: false }, status: "contacted",
    insight: "女性受众 68%、45+ 占 46%，与家用安防买家画像高度重合。用「家庭安全/安心」切入，避免技术参数。",
    source: "openboost", products: 84, avgViews: 345, videos: 106
  },
  {
    id: "alexahome", name: "Alexa", handle: "@alexahome",
    email: "alexa.collabs@alexahome.com",
    fans: 28400, gmv: 18400, units: 920,
    category: "Home & Living", male: 22, female: 78, gpm: 52,
    trend: { value: 6.5, up: true }, status: "new",
    insight: "Lifestyle-focused, high female ratio. Soft-sell angle around family safety works best."
  },
  {
    id: "techwithmike", name: "Mike", handle: "@techwithmike",
    email: "mike.collabs@techwithmike.com",
    fans: 51200, gmv: 94200, units: 3140,
    category: "Tech Reviews", male: 81, female: 17, gpm: 67,
    trend: { value: 15.1, up: true }, status: "replied",
    insight: "Top power seller with male tech audience. Pitch specs and night-vision performance."
  }
];

const AVATAR_COLORS = {
  rafadealss: "linear-gradient(135deg,#7c3aed,#a78bfa)",
  dodbao6666: "linear-gradient(135deg,#06b6d4,#22d3ee)",
  josiahfinds: "linear-gradient(135deg,#10b981,#34d399)",
  alexahome: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  techwithmike: "linear-gradient(135deg,#ef4444,#f87171)"
};

const DAYS = ["1/16", "1/17", "1/18", "1/19", "1/20", "1/21", "1/22"];
const STORE_KEY = "creatordecision.v1";

// 真正的可变 CREATORS 数组（loadState 启动时按 state.archived 删减）
let CREATORS = DEFAULT_CREATORS.slice();

// ---------- 状态（持久化到 localStorage） ----------
const DEFAULT_STATE = {
  view: "home",
  selected: [],            // 已勾选达人 id
  status: {},              // id -> status override
  sent: {},                // id -> true (已发送)
  brand: { name: "", email: "" },
  product: { name: "Home Security Camera", price: 40, commission: 14 },
  smtp: { provider: "gmail", host: "smtp.gmail.com", port: 587, ssl: false, user: "", password: "" },
  openboostKey: "",
  tone: "casual",
  channel: "email",
  edits: {},               // id -> { emailSubject, emailBody, dmBody }
  customCreators: [],      // 通过 @handle 分析新增的达人
  activeComposer: null,
  notes: {},               // id -> { status: "replied", at: 1234567890, text: "达人邮件原话..." }
  archived: []             // 移除的达人 id（防止误删后立即被回拽）
};

let state = loadState();

// 启动时应用持久化的删除：先按 archived 从默认池里清掉
{
  const archivedIds = new Set((state.archived || []).map((a) => a.id));
  if (archivedIds.size) {
    CREATORS = CREATORS.filter((c) => !archivedIds.has(c.id));
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign({}, DEFAULT_STATE, JSON.parse(raw));
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}

// ---------- 工具 ----------
function $(id) { return document.getElementById(id); }
function fmtMoney(n) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
  return "$" + n.toFixed(0);
}
function fmtNum(n) { return (n || 0).toLocaleString("en-US"); }
function fmtGPM(n) { return n ? n.toFixed(0) : "—"; }
function commissionUsd() {
  return state.product.price * state.product.commission / 100;
}
function commStr() { return "$" + commissionUsd().toFixed(2); }

function getCreator(id) { return CREATORS.find((c) => c.id === id); }
function effectiveStatus(c) { return state.status[c.id] || c.status || "new"; }
function effectiveNote(c) {
  const n = state.notes[c.id];
  if (!n) return null;
  return n.text || null;
}
const STATUS_CYCLE = ["new", "contacted", "sent", "replied", "dm", "whatsapp"];
function cycleStatus(id) {
  const cur = effectiveStatus({ id });
  const idx = STATUS_CYCLE.indexOf(cur);
  const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
  state.status[id] = next;
  // 切到「已回复」时引导填备注
  if (next === "replied" && !state.notes[id]) {
    editNote(id, "");
  } else {
    saveState();
  }
  renderPool(); renderKpis(); renderInsights();
}
function editNote(id, preset) {
  const cur = state.notes[id] || { text: "" };
  const text = prompt(
    "记录这条达人最近的状态（可写达人原话 / 跟进要点）\n\n" +
    "例：\n「Rafa 2026-09-01 回复：可以，发样品到我迈阿密地址」「3 天没回，准备 4 天后催」",
    preset !== undefined ? preset : cur.text
  );
  if (text === null) return; // 取消
  if (text.trim() === "") {
    delete state.notes[id];
  } else {
    state.notes[id] = { status: effectiveStatus({ id }), at: Date.now(), text: text.trim() };
  }
  saveState();
  renderPool();
}
// ---------- 删除达人（带自定义确认弹窗）----------
let _pendingDeleteId = null;
function openDeleteModal(id) {
  const c = CREATORS.find((x) => x.id === id);
  if (!c) return;
  _pendingDeleteId = id;
  const t = classify(c);
  const score = scoreCreator(c);
  const portrait = (c.male != null && c.female != null)
    ? `<span class="del-stat"><i style="color:#7C3AED">●</i> 男 ${c.male.toFixed(1)}%</span>
       <span class="del-stat"><i style="color:#EC4899">●</i> 女 ${(c.female || 0).toFixed(1)}%</span>`
    : `<span class="del-stat muted">暂无画像数据</span>`;
  const noteInfo = state.notes[id]
    ? `<span class="del-stat" style="color:#7856FF">💬 已记录 ${state.notes[id].text.length} 字回复</span>`
    : "";
  const archivedCount = state.archived.filter((a) => a.id === id).length;
  const archivedInfo = archivedCount
    ? `<span class="del-stat muted">历史归档 ${archivedCount} 次</span>`
    : "";

  $("delPreview").innerHTML = `
    <div class="del-preview-head">
      <div class="del-preview-avatar" style="background:${AVATAR_COLORS[c.id]}">${c.name.charAt(0).toUpperCase()}</div>
      <div class="del-preview-info">
        <div class="del-preview-name">${c.name}</div>
        <div class="del-preview-handle">${c.handle} · ${categoryZh(c.category)}</div>
      </div>
      <div class="del-preview-score">${scoreBadge(c)}</div>
    </div>
    <div class="del-preview-stats">
      <div class="del-stat-cell"><div class="lbl">粉丝</div><div class="val">${fmtNum(c.fans)}</div></div>
      <div class="del-stat-cell"><div class="lbl">30天 GMV</div><div class="val">${fmtMoney(c.gmv)}</div></div>
      <div class="del-stat-cell"><div class="lbl">销量</div><div class="val">${fmtNum(c.units)}</div></div>
      <div class="del-stat-cell"><div class="lbl">决策评分</div><div class="val" style="color:var(--primary)">${score}</div></div>
    </div>
    <div class="del-preview-extras">${portrait}${noteInfo}${archivedInfo}</div>
    <div class="del-preview-tag-row"><span class="badge ${t.cls}">${t.label}</span><span class="del-preview-status">${statusBadge(effectiveStatus(c))}</span></div>
  `;
  $("deleteConfirmModal").style.display = "flex";
  document.body.style.overflow = "hidden";
  // ESC 关闭
  const handler = (e) => {
    if (e.key === "Escape") {
      closeDeleteModal();
      document.removeEventListener("keydown", handler);
    }
  };
  document.addEventListener("keydown", handler);
  $("deleteConfirmModal").dataset.escBound = "1";
  $("deleteConfirmModal")._escHandler = handler;
}
function closeDeleteModal() {
  $("deleteConfirmModal").style.display = "none";
  _pendingDeleteId = null;
  document.body.style.overflow = "";
  if ($("deleteConfirmModal")._escHandler) {
    document.removeEventListener("keydown", $("deleteConfirmModal")._escHandler);
  }
}
function confirmDelete() {
  if (!_pendingDeleteId) return;
  const id = _pendingDeleteId;
  const c = CREATORS.find((x) => x.id === id);
  const name = c ? c.name : "该达人";
  // 渐隐动画后真正移除
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) {
    row.classList.add("row-fade-out");
    setTimeout(() => doDeleteCreator(id, name), 240);
  } else {
    doDeleteCreator(id, name);
  }
  closeDeleteModal();
}
function doDeleteCreator(id, name) {
  const c = CREATORS.find((x) => x.id === id);
  CREATORS = CREATORS.filter((x) => x.id !== id);
  state.customCreators = state.customCreators.filter((x) => x.id !== id);
  state.selected = state.selected.filter((x) => x !== id);
  state.archived.push({ id, at: Date.now(), snapshot: c });
  saveState();
  renderPool(); renderPoolSegments(); renderHomeTable(); renderKpis(); renderInsights();
  toast(`✓ 已从达人池移除 ${name}`, "success");
}
function isSelected(id) { return state.selected.includes(id); }

// ---------- 分类引擎 ----------
function classify(c) {
  const aov = c.units > 0 ? c.gmv / c.units : 0;
  if (c.gmv >= 15000 && aov >= 25) return { type: "power", label: "强带货", cls: "badge-power" };
  if (c.units >= 800 && aov < 25) return { type: "volume", label: "走量型", cls: "badge-volume" };
  if ((c.female || 0) >= 55) return { type: "audience", label: "受众契合", cls: "badge-audience" };
  return { type: "general", label: "泛类目", cls: "badge-general" };
}

// ---------- 决策优先级评分引擎 ----------
// 综合 7 个维度加权打分（0-100），可解释、可排序，是「决策」的核心。
// 权重：带货 GMV 25 / 销量规模 15 / 受众契合 20 / 带货效率 GPM 10 / 粉丝规模 10 / 增长趋势 10 / 热线索 10
function norm(v, min, max) {
  if (v == null || isNaN(v)) return 0;
  const x = (v - min) / (max - min);
  return Math.max(0, Math.min(1, x));
}

function scoreCreator(c) {
  // 1. 带货能力（GMV，0-25）
  const gmvScore = norm(c.gmv, 0, 100000) * 25;
  // 2. 销量规模（0-15）：走量型达人靠这里拿分
  const unitsScore = norm(c.units, 0, 5000) * 15;
  // 3. 受众契合（女性占比，0-20）：家用安防核心买家偏女性/家庭，45%-80% 最优
  let fit = 10; // 无画像数据给中性分
  const female = c.female;
  if (female != null) {
    if (female >= 45 && female <= 80) fit = 20;
    else if (female < 45) fit = norm(female, 0, 45) * 18;
    else fit = Math.max(4, 20 - (female - 80) * 0.6);
  }
  // 4. 带货效率（GPM，0-10）
  const gpmScore = norm(c.gpm || 0, 0, 150) * 10;
  // 5. 粉丝规模（0-10）
  const fansScore = norm(c.fans, 0, 100000) * 10;
  // 6. 增长趋势（0-10）
  let trendScore = 5;
  if (c.trend) {
    if (c.trend.up) trendScore = Math.min(10, 6 + Math.abs(c.trend.value) / 25);
    else trendScore = Math.max(2, 6 - Math.abs(c.trend.value) / 30);
  }
  // 7. 热线索加成（0-10）
  const st = effectiveStatus(c);
  const hot = st === "replied" ? 10 : (st === "sent" || st === "contacted") ? 5 : 0;

  return Math.round(gmvScore + unitsScore + fit + gpmScore + fansScore + trendScore + hot);
}

function gradeFor(s) {
  if (s >= 80) return { grade: "S", label: "优先合作", color: "#7c3aed", bg: "#EEEDFE" };
  if (s >= 65) return { grade: "A", label: "重点跟进", color: "#0369A1", bg: "#E0F2FE" };
  if (s >= 45) return { grade: "B", label: "值得测试", color: "#B45309", bg: "#FEF3C7" };
  return { grade: "C", label: "暂缓", color: "#6B7280", bg: "#F3F4F6" };
}

function scoreReason(c) {
  const parts = [];
  if (c.gmv >= 30000) parts.push(`月 GMV ${fmtMoney(c.gmv)} 带货能力强`);
  if ((c.units || 0) >= 800) parts.push(`月销 ${fmtNum(c.units)} 单、能跑量`);
  if (c.female != null && c.female >= 45 && c.female <= 80) parts.push(`${c.female}% 女性受众高度契合家用安防`);
  if ((c.gpm || 0) >= 60) parts.push(`GPM ${fmtGPM(c.gpm)} 转化效率高`);
  if (c.trend && c.trend.up) parts.push("粉丝增长向好");
  if (effectiveStatus(c) === "replied") parts.push("已回复（热线索）");
  if (!parts.length) return "数据有限，建议先低成本测试反应。";
  return parts.slice(0, 2).join("；") + "。";
}

function scoreBadge(c) {
  const s = scoreCreator(c);
  const g = gradeFor(s);
  return `<span class="score-cell"><span class="score-num">${s}</span><span class="score-grade" style="background:${g.bg};color:${g.color}">${g.grade} · ${g.label}</span></span>`;
}

const CATEGORY_ZH = {
  "General": "综合",
  "Phones & Electronics": "手机数码",
  "Home & Electronics": "家居电子",
  "Home & Living": "家居生活",
  "Tech Reviews": "科技测评",
  "Lifestyle": "生活方式",
  "Beauty & Care": "美妆个护"
};
function categoryZh(cat) { return CATEGORY_ZH[cat] || cat; }

function statusMeta(status) {
  const map = {
    new: { text: "新", cls: "status-new", color: "#9CA3AF" },
    selected: { text: "已选", cls: "status-selected", color: "#7856FF" },
    contacted: { text: "已联系", cls: "status-selected", color: "#7856FF" },
    sent: { text: "已发送", cls: "status-sent", color: "#06B6D4" },
    replied: { text: "已回复", cls: "status-replied", color: "#10B981" },
    dm: { text: "仅私信", cls: "status-dm", color: "#F59E0B" },
    whatsapp: { text: "WhatsApp", cls: "status-whatsapp", color: "#25D366" }
  };
  return map[status] || map.new;
}
function statusBadge(status) {
  const s = statusMeta(status);
  return `<span class="status ${s.cls}"><span class="status-dot" style="background:${s.color}"></span>${s.text}</span>`;
}

// ---------- @handle 达人分析器 ----------
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededRand(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COLOR_PALETTE = [
  "linear-gradient(135deg,#7c3aed,#a78bfa)",
  "linear-gradient(135deg,#06b6d4,#22d3ee)",
  "linear-gradient(135deg,#10b981,#34d399)",
  "linear-gradient(135deg,#f59e0b,#fbbf24)",
  "linear-gradient(135deg,#ef4444,#f87171)",
  "linear-gradient(135deg,#ec4899,#f472b6)",
  "linear-gradient(135deg,#6366f1,#818cf8)"
];
function colorFor(id) { return COLOR_PALETTE[hashString(id) % COLOR_PALETTE.length]; }

// 只有 source === "openboost" 才算真实数据；其余（内置示例 / 输入 @handle 生成的演示数据）一律标注为示例数据
function isRealData(c) { return c && c.source === "openboost"; }

function generateDemoCreator(handle) {
  const clean = handle.replace(/^@/, "").toLowerCase().trim();
  const rnd = seededRand(hashString(clean));
  const name = clean.charAt(0).toUpperCase() + clean.slice(1);
  const fans = Math.round(2500 + rnd() * 78000);
  const units = Math.round(80 + rnd() * 5800);
  const aov = Math.round((15 + rnd() * 58) * 10) / 10;
  const gmv = Math.round(units * aov);
  const gpm = Math.round((10 + rnd() * 115) * 10) / 10;
  const male = Math.round(22 + rnd() * 58);
  const female = 100 - male;
  const categories = ["Home & Living", "Tech Reviews", "Phones & Electronics", "Home & Electronics", "Lifestyle", "Beauty & Care"];
  const category = categories[Math.floor(rnd() * categories.length)];
  const hasEmail = rnd() > 0.45;
  const a0 = Math.round(10 + rnd() * 24);
  const a1 = Math.round(20 + rnd() * 24);
  const a2 = Math.round(15 + rnd() * 20);
  const a3 = Math.max(0, 100 - a0 - a1 - a2);
  return {
    id: clean, name, handle: "@" + clean,
    email: hasEmail ? `${clean}.collabs@gmail.com` : null,
    fans, gmv, units, category, male, female, gpm,
    age: [
      { label: "18-24", pct: a0 },
      { label: "25-34", pct: a1 },
      { label: "35-44", pct: a2 },
      { label: "45+", pct: a3 }
    ],
    trend: { value: Math.round(rnd() * 150) / 10, up: rnd() > 0.4 },
    status: "new",
    insight: "",
    whatsapp: rnd() > 0.4 ? "1" + String(Math.floor(100000000 + rnd() * 899999999)) : null,
    source: "demo"
  };
}

function insightFor(c) {
  const t = classify(c);
  const aov = c.units > 0 ? c.gmv / c.units : 0;
  if (t.type === "power") {
    return `强带货达人：月 GMV ${fmtMoney(c.gmv)}、${fmtNum(c.units)} 单、客单 $${aov.toFixed(0)}。适合用「收益空间」切入，直接谈佣金和分成。`;
  }
  if (t.type === "volume") {
    return `走量型达人：${fmtNum(c.units)} 单/月但客单仅 ~$${aov.toFixed(0)}。$${state.product.price} 摄像头能拉高他的客单和 GMV，用「同样的流量、更高的 GMV」切入。`;
  }
  if (t.type === "audience") {
    return `受众契合型：${c.female}% 女性、偏家庭/安防人群，正是家用摄像头的核心买家。用「安全/安心」切入，别讲技术参数。`;
  }
  return `泛类目达人（${c.category}）：用「免费样品 + ${state.product.commission}% 佣金」标准钩子先测反应，再决定是否深聊。`;
}

function ensureInPool(c) {
  if (CREATORS.find((x) => x.id === c.id)) return;
  CREATORS.push(c);
  state.customCreators.push(c);
  // 用户主动重新搜索 = 反悔，把 archived 里对应 id 也清掉
  state.archived = (state.archived || []).filter((a) => a.id !== c.id);
  AVATAR_COLORS[c.id] = colorFor(c.id);
  saveState();
}

let lastAnalyzed = null;

function openAnalyzer() {
  $("analyzerModal").style.display = "flex";
  $("analyzerInput").value = "";
  $("analyzerSteps").style.display = "none";
  $("analyzerResult").style.display = "none";
  $("analyzerHint").style.display = "block";
  $("analyzerRun").disabled = false;
  setTimeout(() => $("analyzerInput").focus(), 60);
}
function closeAnalyzer() {
  $("analyzerModal").style.display = "none";
}

// ---------- 批量导入 ----------
function parseBatchInput(text) {
  // 支持换行、逗号、空格分隔；自动去首尾 @；去重保序
  const tokens = (text || "").split(/[\s,;]+/).map((s) => s.trim().replace(/^@/, "")).filter(Boolean);
  const seen = new Set(); const out = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

function openBatchImport() {
  $("batchImportModal").style.display = "flex";
  $("batchImportTextarea").value = "";
  $("batchImportCount").textContent = "0";
  $("batchStepInput").style.display = "block";
  $("batchStepProgress").style.display = "none";
  $("batchStepResult").style.display = "none";
  setTimeout(() => $("batchImportTextarea").focus(), 60);
}

function closeBatchImport() {
  $("batchImportModal").style.display = "none";
}

function updateBatchCount() {
  const handles = parseBatchInput($("batchImportTextarea").value);
  const n = Math.min(handles.length, 50);
  $("batchImportCount").textContent = String(n);
  $("batchImportGo").disabled = n === 0;
}

async function runBatchImport(handles) {
  const key = (state.openboostKey || "").trim();
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-OpenBoost-Key"] = key;

  $("batchStepInput").style.display = "none";
  $("batchStepProgress").style.display = "block";
  $("batchStepResult").style.display = "none";
  $("batchProgressText").textContent = "正在并发拉取达人数据…";
  $("batchProgressRatio").textContent = `0 / ${handles.length}`;
  $("batchProgressFill").style.width = "4%";
  $("batchProgressResult").innerHTML = "";

  let res, data;
  try {
    res = await fetch("/api/openboost/batch-search", {
      method: "POST", headers, body: JSON.stringify({ handles })
    });
    data = await res.json();
  } catch (e) {
    $("batchProgressText").textContent = "请求失败：" + (e.message || e);
    showStepResult({ ok: false, results: handles.map((h) => ({ handle: h, ok: false, error: "网络错误" })) });
    return;
  }

  if (!data || !data.ok) {
    $("batchProgressText").textContent = data && data.error || "导入失败";
    return;
  }

  // 实时将成功的入池并刷新 KPI / 表格
  let added = 0;
  for (const r of data.results) {
    $("batchProgressRatio").textContent = `${(added + 0)} / ${data.total}`;
    if (r.ok && r.data) {
      ensureInPool(r.data);
      added++;
      const li = document.createElement("div");
      li.innerHTML = `<span class="ok">✓</span> @${r.handle} → ${r.data.name}（${fmtNum(r.data.fans)} 粉 / ${fmtMoney(r.data.gmv)}）`;
      $("batchProgressResult").appendChild(li);
    } else {
      const li = document.createElement("div");
      li.innerHTML = `<span class="err">×</span> @${r.handle}：${r.error || "未找到"}`;
      $("batchProgressResult").appendChild(li);
    }
    $("batchProgressFill").style.width = `${Math.round(((data.results.indexOf(r) + 1) / data.total) * 100)}%`;
  }
  $("batchProgressRatio").textContent = `${added} / ${data.total}`;

  if (added > 0) {
    renderPool(); renderPoolSegments(); renderKpis();
  }
  $("batchProgressText").textContent =
    added === data.total ? "全部完成 ✓" :
    added === 0 ? "全部失败，请检查 handle 或密钥配置" :
    `部分完成（${added}/${data.total}）`;

  showStepResult(data);
}

function showStepResult(data) {
  $("batchStepProgress").style.display = "none";
  $("batchStepResult").style.display = "block";
  $("batchSummarySuccess").textContent = String(data.success);
  $("batchSummaryFailed").textContent = String(data.failed);
  const failed = (data.results || []).filter((r) => !r.ok);
  const list = $("batchFailedList");
  if (failed.length) {
    list.innerHTML = failed.map((r) => `<li>@${r.handle} · ${r.error || "未找到"}</li>`).join("");
    $("batchResultRetry").style.display = "";
  } else {
    list.innerHTML = "";
    $("batchResultRetry").style.display = "none";
  }
}

async function retryFailedImport() {
  const failed = Array.from($("batchFailedList").querySelectorAll("li"))
    .map((li) => li.textContent.split("·")[0].trim().replace(/^@/, ""));
  if (!failed.length) return;
  $("batchImportTextarea").value = failed.join("\n");
  $("batchStepResult").style.display = "none";
  $("batchStepInput").style.display = "block";
  updateBatchCount();
  await runBatchImport(parseBatchInput($("batchImportTextarea").value));
}

function showLoading(text) {
  $("loadingText").textContent = text || "正在处理…";
  $("loadingOverlay").style.display = "flex";
}
function hideLoading() {
  $("loadingOverlay").style.display = "none";
}

async function runAnalyze() {
  const raw = $("analyzerInput").value.trim();
  if (!raw) { toast("请输入 TikTok handle", "info"); return; }
  const handle = raw.startsWith("@") ? raw : "@" + raw;
  const clean = handle.replace(/^@/, "").toLowerCase();

  $("analyzerHint").style.display = "none";
  $("analyzerResult").style.display = "none";
  $("analyzerRun").disabled = true;
  showLoading("正在查询达人数据…");

  const live = await queryCreatorLive(clean);

  let creator;
  if (live && live.ok && live.data) {
    creator = live.data;
    ensureInPool(creator);
  } else {
    const known = CREATORS.find((c) => c.id === clean || c.handle.toLowerCase() === handle.toLowerCase());
    creator = known || generateDemoCreator(clean);
    if (live && live.error) toast(live.error, "info");
  }
  lastAnalyzed = creator;

  hideLoading();
  renderAnalyzerResult(creator);
  $("analyzerResult").style.display = "block";
  $("analyzerRun").disabled = false;
}

async function queryCreatorLive(clean) {
  const key = (state.openboostKey || "").trim();
  try {
    // 前端填了 key 就用前端的；没填则不传，后端会尝试用 .env 里的默认 key 兜底
    const headers = key ? { "X-OpenBoost-Key": key } : {};
    const res = await fetch(`/api/openboost/search?handle=${encodeURIComponent(clean)}`, { headers });
    return await res.json();
  } catch (e) {
    return { ok: false, error: "无法连接后端服务，已回退示例数据。" };
  }
}

// 搜索框实时查询：本地无匹配时查 OpenBoost（首页/达人池共用）
async function liveSearchCreator(inputEl, renderFn) {
  const term = (inputEl.value || "").trim();
  if (!term) { renderFn(); return; }
  const clean = term.replace(/^@/, "").toLowerCase();
  const localMatch = CREATORS.some((c) =>
    [c.name, c.handle, c.category].some((s) => (s || "").toLowerCase().includes(clean))
  );
  if (localMatch) { renderFn(); return; }
  showLoading(`正在查找 @${clean} 的真实数据…`);
  const res = await queryCreatorLive(clean);
  hideLoading();
  if (res && res.ok && res.data) {
    ensureInPool(res.data);
    renderFn();
    toast(`已查到 @${(res.data.handle || "").replace(/^@/, "")} 的真实数据`, "success");
  } else {
    renderFn();
    toast(res && res.error ? res.error : "未找到该达人", "error");
  }
}

function renderAnalyzerSteps(steps) {
  $("analyzerSteps").innerHTML = steps.map((s, i) => `
    <div class="astep" data-step="${i}">
      <div class="astep-icon">${i + 1}</div>
      <div class="astep-label">${s}</div>
    </div>`).join("");
}
function markStep(i, status) {
  const el = $("analyzerSteps").querySelector(`[data-step="${i}"]`);
  if (!el) return;
  if (status === "active") { el.classList.add("active"); el.classList.remove("done"); }
  if (status === "done") {
    el.classList.remove("active"); el.classList.add("done");
    el.querySelector(".astep-icon").innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  }
}

function renderAnalyzerResult(c) {
  const t = classify(c);
  const aov = c.units > 0 ? Math.round(c.gmv / c.units) : 0;
  const isReal = isRealData(c);
  const dataBadge = isReal
    ? '<span class="badge badge-power" style="background:#E0F2FE;color:#0369A1">真实数据</span>'
    : '<span class="badge badge-general">示例数据</span>';
  const contact = c.email
    ? `<span style="color:var(--text-2)">✉ ${c.email}</span>`
    : `<span style="color:var(--amber);font-weight:600">无公开邮箱 · 走 TikTok DM</span>`;

  const gender = (c.male != null && c.female != null)
    ? `
      <div class="audience-gender">
        <div class="m" style="width:${c.male}%">男 ${c.male}%</div>
        <div class="f" style="width:${c.female}%">女 ${c.female}%</div>
      </div>
      <div class="audience-legend">
        <span><i style="background:#7856FF"></i>男性 ${c.male}%</span>
        <span><i style="background:#EC4899"></i>女性 ${c.female}%</span>
      </div>`
    : `<span style="color:var(--text-3);font-size:13px">暂无性别画像数据</span>`;

  const age = (c.age && c.age.length)
    ? `
      <div class="age-row">
        ${c.age.map((a) => `
          <div class="age-bar">
            <div class="bar"><div class="fill" style="height:${a.pct}%"></div></div>
            <div class="pct">${a.pct}%</div>
            <div class="lbl">${a.label}</div>
          </div>`).join("")}
      </div>`
    : "";

  $("analyzerResult").innerHTML = `
    <div class="result-card">
      <div class="result-head">
        <div class="c-avatar" style="background:${AVATAR_COLORS[c.id] || colorFor(c.id)}">${c.name.charAt(0).toUpperCase()}</div>
        <div class="meta">
          <div class="c-name">${c.name}</div>
          <div class="c-handle">${c.handle} · ${categoryZh(c.category)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          ${dataBadge}
          <span class="badge ${t.cls}">${t.label}</span>
        </div>
      </div>
      <div class="result-metrics">
        <div class="result-metric"><div class="v">${fmtNum(c.fans)}</div><div class="l">粉丝</div></div>
        <div class="result-metric"><div class="v">${fmtMoney(c.gmv)}</div><div class="l">30天 GMV</div></div>
        <div class="result-metric"><div class="v">${fmtNum(c.units)}</div><div class="l">销量</div></div>
        <div class="result-metric"><div class="v">$${aov}</div><div class="l">客单</div></div>
        <div class="result-metric"><div class="v">${fmtGPM(c.gpm)}</div><div class="l">GPM</div></div>
      </div>
      <div class="result-body">
        <div>
          <div class="result-section-title">受众画像</div>
          <div class="audience-row">${gender}${age}</div>
        </div>
        <div>
          <div class="result-section-title">联系方式</div>
          <div style="font-size:13px;margin-top:6px">${contact}</div>
        </div>
        <div class="result-insight">
          <strong>AI 洞察 · </strong>${insightFor(c)}
        </div>
        <div class="result-actions">
          <button class="secondary-btn" id="resultAddPool">加入达人池</button>
          <button class="primary-btn" id="resultPitch">一键生成建联文案 →</button>
        </div>
      </div>
    </div>`;

  $("resultAddPool").addEventListener("click", () => {
    ensureInPool(c);
    toast(`${c.name} 已加入达人池`, "success");
    renderPool();
    renderHome();
  });
  $("resultPitch").addEventListener("click", () => {
    ensureInPool(c);
    closeAnalyzer();
    openComposer(c.id);
  });
}

// ---------- AI 文案生成（钩子式，开头不提品牌） ----------
const TONES = {
  casual: { greet: (n) => `Hey ${n}! 👋`, close: `Reply "yes" and I'll get your sample out this week.` },
  direct: { greet: (n) => `Hi ${n},`, close: `If you're in, reply here and the sample ships this week.` },
  warm: { greet: (n) => `Hey ${n},`, close: `Would love to work with you — reply and I'll get a sample on its way this week.` }
};

function hookLine(c, t) {
  if (t.type === "power") {
    return `You did ${fmtNum(c.units)} units and ${fmtMoney(c.gmv)} GMV last month — so you already know how to move product. Here's one more, at a commission that actually pays.`;
  }
  if (t.type === "volume") {
    return `You're doing ${fmtNum(c.units)} units a month in ${c.category.toLowerCase()} — that's serious volume.`;
  }
  if (t.type === "audience") {
    return `Your ${c.category.toLowerCase()} content reaches exactly the people this is built for — about ${c.female}% of your audience is female, and that's the group that buys home security cameras most.`;
  }
  return `Love your ${c.category.toLowerCase()} content — our ${state.product.name.toLowerCase()} feels like a clean fit for your audience.`;
}

function offerLines(c, t) {
  const lines = [];
  lines.push(`What's in it for you:`);
  lines.push(`• FREE ${state.product.name} shipped to you (keep it, no cost)`);
  lines.push(`• ${state.product.commission}% commission on every sale (~${commStr()} at $${state.product.price})`);
  lines.push(`• Your own discount code for your audience`);
  if (t.type === "volume") {
    lines.push(`• A $${state.product.price} cam actually raises your per-sale earnings vs the lower-ticket items you usually run — same volume, bigger GMV`);
  }
  if (t.type === "audience") {
    lines.push(`• At $${state.product.price} it's an easy impulse buy for the ${c.female}% female, family-safety crowd you already reach`);
  }
  return lines.join("\n");
}

function buildEmail(c, tone) {
  const t = classify(c);
  const T = TONES[tone] || TONES.casual;
  const subject = `Free ${state.product.name} + ${state.product.commission}% — collab for ${c.name}`;
  const brand = state.brand.name || "Your Brand";
  const email = state.brand.email || "you@brand.com";
  const body = [
    `${T.greet(c.name)}`,
    ``,
    hookLine(c, t),
    ``,
    offerLines(c, t),
    ``,
    T.close,
    ``,
    `— ${brand}`,
    `${email}`
  ].join("\n");
  return { subject, body };
}

function buildDM(c, tone) {
  const t = classify(c);
  const T = TONES[tone] || TONES.casual;
  const dm = [
    `${T.greet(c.name)} Love your ${c.category.toLowerCase()} content.`,
    `Quick ask: we make a ${state.product.name.toLowerCase()} ($${state.product.price}) and we'd love to send you a FREE one + ${state.product.commission}% commission (~${commStr()} per sale).`,
    `${hookLine(c, t)}`,
    `Want the details? 😊`
  ].join("\n");
  return dm;
}

function buildWhatsApp(c, tone) {
  const t = classify(c);
  const T = TONES[tone] || TONES.casual;
  const brand = state.brand.name || "Your Brand";
  const msg = [
    `${T.greet(c.name)}`,
    ``,
    hookLine(c, t),
    ``,
    offerLines(c, t),
    ``,
    T.close,
    ``,
    `— ${brand}`
  ].join("\n");
  return msg;
}

// ---------- 视图路由 ----------
const VIEW_TITLES = {
  home: "首页", creators: "达人池", outreach: "建联工作台",
  performance: "效果分析", insights: "AI 洞察", settings: "设置"
};

function showView(name) {
  state.view = name;
  saveState();
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const el = $("view-" + name);
  if (el) el.classList.add("active");
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.nav === name));
  $("breadcrumbCurrent").textContent = VIEW_TITLES[name] || name;
  if (name === "home") { renderHome(); }
  if (name === "creators") { renderPool(); }
  if (name === "outreach") { renderOutreach(); }
  if (name === "performance") { renderPerformance(); }
  if (name === "insights") { renderInsights(); }
  if (name === "settings") { renderSettings(); }
  updateNavBadge();
  window.scrollTo(0, 0);
}

function updateNavBadge() {
  const badge = $("navOutreachBadge");
  const n = state.selected.length;
  badge.style.display = n ? "inline-flex" : "none";
  badge.textContent = n;
}

// ---------- Home ----------
function renderHome() {
  const pool = CREATORS.length;
  const sent = Object.keys(state.sent).filter((id) => state.sent[id]).length;
  const replied = CREATORS.filter((c) => effectiveStatus(c) === "replied").length;
  const totalGmv = CREATORS.reduce((s, c) => s + c.gmv, 0);
  $("kpiPool").textContent = pool;
  $("kpiSelected").textContent = state.selected.length;
  $("kpiSent").textContent = sent;
  $("kpiGmv").textContent = fmtMoney(totalGmv);
  $("kpiSentDelta").textContent = sent ? `${sent} 已发送 · ${replied} 已回复` : "本次会话";
  const realCount = CREATORS.filter(isRealData).length;
  $("kpiPoolDelta").textContent = `${realCount} 位真实数据`;
  $("kpiPoolDelta").className = "kpi-delta";
  $("kpiGmvDelta").textContent = `${pool} 位达人合计`;
  $("kpiGmvDelta").className = "kpi-delta";

  renderHomeTable();
  initMainChart();
}

function renderHomeTable(filterText = "") {
  const tbody = $("homeTable");
  const term = filterText.toLowerCase();
  const rows = CREATORS.filter((c) => {
    if (!term) return true;
    return [c.name, c.handle, c.category, classify(c).label].some((s) => s.toLowerCase().includes(term));
  });
  tbody.innerHTML = rows.map((c) => {
    const t = classify(c);
    return `
      <tr data-id="${c.id}">
        <td>
          <div class="creator-cell">
            <div class="c-avatar" style="background:${AVATAR_COLORS[c.id]}">${c.name.charAt(0).toUpperCase()}</div>
            <div><div class="c-name">${c.name}</div><div class="c-handle">${c.handle}</div></div>
          </div>
        </td>
        <td><span class="badge ${t.cls}">${t.label}</span></td>
        <td>${categoryZh(c.category)}</td>
        <td class="num">${fmtNum(c.fans)}</td>
        <td class="num">${fmtMoney(c.gmv)}</td>
        <td class="num">${fmtGPM(c.gpm)}</td>
        <td>${statusBadge(effectiveStatus(c))}</td>
        <td><button class="row-action-btn" data-id="${c.id}">建联 →</button></td>
      </tr>`;
  }).join("");
  tbody.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", () => openComposer(row.dataset.id));
  });
}

// ---------- Creator Pool ----------
let poolSegment = "all";
let poolSort = "score"; // 达人池排序：score(评分) / fans / gmv
const POOL_SORT_LABEL = { score: "评分", fans: "粉丝", gmv: "GMV" };
const SEGMENTS = [
  { key: "all", label: "全部" },
  { key: "power", label: "强带货" },
  { key: "volume", label: "走量型" },
  { key: "audience", label: "受众契合" },
  { key: "general", label: "泛类目" }
];

function renderPoolSegments() {
  $("poolSegments").innerHTML = SEGMENTS.map((s) =>
    `<button class="segment-chip ${poolSegment === s.key ? "active" : ""}" data-seg="${s.key}">${s.label}</button>`
  ).join("");
}

function updatePoolSortHeader() {
  document.querySelectorAll("#poolTable th.sortable").forEach((th) => {
    const active = th.dataset.sort === poolSort;
    th.classList.toggle("active", active);
    const arrow = th.querySelector(".sort-arrow");
    if (arrow) arrow.textContent = active ? "↓" : "";
  });
}

function renderPool() {
  renderPoolSegments();
  const term = ($("poolSearch").value || "").toLowerCase();
  let rows = CREATORS.filter((c) => {
    const seg = classify(c).type;
    if (poolSegment !== "all" && seg !== poolSegment) return false;
    if (term && ![c.name, c.handle, c.category].some((s) => s.toLowerCase().includes(term))) return false;
    return true;
  });
  // 排序：评分 / 粉丝 / GMV（均降序）
  if (poolSort === "score") rows = rows.slice().sort((a, b) => scoreCreator(b) - scoreCreator(a));
  else if (poolSort === "fans") rows = rows.slice().sort((a, b) => (b.fans || 0) - (a.fans || 0));
  else if (poolSort === "gmv") rows = rows.slice().sort((a, b) => (b.gmv || 0) - (a.gmv || 0));
  updatePoolSortHeader();

  const tbody = $("poolTable");
  tbody.innerHTML = rows.map((c) => {
    const t = classify(c);
    const checked = isSelected(c.id) ? "checked" : "";
    const contact = c.email ? `<span style="color:var(--text-2)">✉ ${c.email}</span>` : `<span style="color:var(--amber)">仅私信</span>`;
    const note = state.notes[c.id];
    const noteHtml = note
      ? `<span class="note-pill" data-id="${c.id}" data-note-edit="${c.id}" title="${escapeAttr(note.text)}${note.at ? '\n\n记录于 ' + new Date(note.at).toLocaleString() : ''}">💬 已记录</span>`
      : `<span class="note-empty" data-id="${c.id}" data-note-edit="${c.id}" title="点击记录达人回复 / 跟进要点">＋ 备注</span>`;
    return `
      <tr data-id="${c.id}" class="${isSelected(c.id) ? "selected" : ""}">
        <td class="check-col"><input type="checkbox" ${checked} data-check="${c.id}"></td>
        <td>
          <div class="creator-cell">
            <div class="c-avatar" style="background:${AVATAR_COLORS[c.id]}">${c.name.charAt(0).toUpperCase()}</div>
            <div><div class="c-name">${c.name}</div><div class="c-handle">${c.handle}</div></div>
          </div>
        </td>
        <td><span class="badge ${t.cls}">${t.label}</span></td>
        <td>${categoryZh(c.category)}</td>
        <td class="num">${fmtNum(c.fans)}</td>
        <td class="num">${fmtMoney(c.gmv)}</td>
        <td class="num">${fmtNum(c.units)}</td>
        <td class="num">${fmtGPM(c.gpm)}</td>
        <td class="num">${scoreBadge(c)}</td>
        <td>${contact}</td>
        <td><span class="status-pick" data-status-pick="${c.id}" title="点击切换：new → contacted → sent → replied → dm → whatsapp">${statusBadge(effectiveStatus(c))}</span></td>
        <td>${noteHtml}</td>
        <td class="row-actions">
          <button class="row-action-btn" data-id="${c.id}">建联 →</button>
          <button class="row-del-icon-btn" data-del="${c.id}" title="从达人池移除 ${c.name}" aria-label="移除 ${c.name}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6M14 11v6"></path>
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </td>
      </tr>`;
  }).join("");

  // checkbox events
  tbody.querySelectorAll("input[data-check]").forEach((cb) => {
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(cb.dataset.check);
    });
  });
  tbody.querySelectorAll(".row-action-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openComposer(btn.dataset.id);
    });
  });
  tbody.querySelectorAll(".row-del-icon-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteModal(btn.dataset.del);
    });
  });
  tbody.querySelectorAll("[data-status-pick]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      cycleStatus(el.dataset.statusPick);
    });
  });
  tbody.querySelectorAll("[data-note-edit]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      editNote(el.dataset.noteEdit);
    });
  });
  tbody.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("input, button")) return;
      if (e.target.closest("[data-status-pick], [data-note-edit]")) return;
      openComposer(row.dataset.id);
    });
  });

  updateBulkBar();
  updatePoolGenerate();
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function updateBulkBar() {
  const n = state.selected.length;
  $("bulkBar").style.display = n ? "flex" : "none";
  $("bulkCount").textContent = n;
  $("poolGenerateCount").textContent = n ? `(${n})` : "";
}
function updatePoolGenerate() {
  const n = state.selected.length;
  $("poolGenerate").disabled = n === 0;
}

function toggleSelect(id, force) {
  const idx = state.selected.indexOf(id);
  const shouldSelect = force !== undefined ? force : idx === -1;
  if (shouldSelect && idx === -1) state.selected.push(id);
  if (!shouldSelect && idx !== -1) state.selected.splice(idx, 1);
  saveState();
  renderPool();
  updateNavBadge();
}

// ---------- Outreach ----------
let composerId = null;
let composerChannel = "email";

function renderOutreach() {
  const selected = state.selected.map(getCreator).filter(Boolean);
  const list = $("recipientList");
  $("recipientsEmpty").style.display = selected.length ? "none" : "flex";
  list.style.display = selected.length ? "block" : "none";
  $("outreachSendCount").textContent = selected.length;
  $("outreachSendAll").disabled = selected.length === 0;

  // 如果列表为空，清空右侧面板
  if (!selected.length) {
    $("outreachDetail").style.display = "none";
    showComposerEmpty();
  }

  list.innerHTML = selected.map((c) => {
    const st = effectiveStatus(c);
    const active = c.id === composerId ? "active" : "";
    return `
      <div class="recipient-item ${active}" data-id="${c.id}">
        <div class="c-avatar" style="background:${AVATAR_COLORS[c.id]}">${c.name.charAt(0).toUpperCase()}</div>
        <div class="meta">
          <div class="c-name">${c.name}</div>
          <div class="c-handle">${c.handle}</div>
        </div>
        <div class="recipient-status">${statusBadge(st)}</div>
      </div>`;
  }).join("");

  list.querySelectorAll(".recipient-item").forEach((item) => {
    item.addEventListener("click", () => loadComposer(item.dataset.id));
  });

  // if active creator was removed, clear
  if (composerId && !isSelected(composerId)) {
    composerId = null;
    showComposerEmpty();
  }
  if (composerId) loadComposer(composerId, { keepChannel: true });

  // sync channel tabs
  document.querySelectorAll(".composer-tabs .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.channel === composerChannel)
  );
}

function showComposerEmpty() {
  $("composerEmpty").style.display = "flex";
  $("composerForm").style.display = "none";
  $("outreachDetail").style.display = "none";
}

const CHANNEL_LABEL = { email: "邮件", whatsapp: "WhatsApp", dm: "私信" };

function defaultChannelFor(c) {
  if (c.email) return "email";
  if (c.whatsapp) return "whatsapp";
  return "dm";
}

function loadComposer(id, opts = {}) {
  const c = getCreator(id);
  if (!c) return;
  composerId = id;
  state.activeComposer = id;
  // 默认通道：有邮箱→邮件；无邮箱有 WhatsApp→WhatsApp；否则私信
  if (!opts.keepChannel) composerChannel = defaultChannelFor(c);

  const t = classify(c);
  $("composerEmpty").style.display = "none";
  $("composerForm").style.display = "flex";
  $("outreachDetail").style.display = "flex";

  $("composerAvatar").style.background = AVATAR_COLORS[c.id];
  $("composerAvatar").textContent = c.name.charAt(0).toUpperCase();
  $("composerName").textContent = c.name;
  $("composerHandle").textContent = `${c.handle} · ${t.label} · ${fmtNum(c.fans)} 粉丝`;
  $("composerChannelTag").textContent = CHANNEL_LABEL[composerChannel];
  $("composerChannelTag").className = "channel-tag " + composerChannel;
  $("composerSendName").textContent = c.name;
  updateComposerHint(c);

  fillComposerFields(c);
  syncComposerTabs();
  renderDetailPanel(c);
}

function syncComposerTabs() {
  document.querySelectorAll(".composer-tabs .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.channel === composerChannel)
  );
}

function renderDetailPanel(c) {
  const t = classify(c);
  const isReal = isRealData(c);
  const aov = c.units > 0 ? Math.round(c.gmv / c.units) : 0;
  const sourceCls = isReal ? "real" : "demo";
  const sourceText = isReal ? "真实数据" : "示例数据";

  $("detailSource").textContent = sourceText;
  $("detailSource").className = "data-source-badge " + sourceCls;

  const gender = (c.male != null && c.female != null)
    ? `
      <div class="detail-gender">
        <div class="m" style="width:${c.male}%">男 ${c.male}%</div>
        <div class="f" style="width:${c.female}%">女 ${c.female}%</div>
      </div>
      <div class="detail-gender-legend">
        <span><i style="background:#7856FF"></i>男性 ${c.male}%</span>
        <span><i style="background:#EC4899"></i>女性 ${c.female}%</span>
      </div>`
    : `<span style="color:var(--text-3);font-size:13px">暂无性别画像数据</span>`;

  const age = (c.age && c.age.length)
    ? `
      <div class="detail-age">
        ${c.age.map((a) => `
          <div class="detail-age-bar">
            <div class="bar"><div class="fill" style="height:${Math.max(6, a.pct)}%"></div></div>
            <div class="pct">${a.pct}%</div>
            <div class="lbl">${a.label}</div>
          </div>`).join("")}
      </div>`
    : "";

  const trendHtml = c.trend
    ? `<span class="trend ${c.trend.up ? "up" : "down"}">${c.trend.up ? "↑" : "↓"} ${c.trend.value}%</span>`
    : "";

  const contactRows = [];
  if (c.email) {
    contactRows.push(`
      <div class="detail-contact-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        <span>${c.email}</span>
      </div>`);
  }
  if (c.whatsapp) {
    contactRows.push(`
      <div class="detail-contact-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <span>WhatsApp: +${c.whatsapp}</span>
      </div>`);
  }
  const tiktokHandle = (c.handle || "").replace(/^@/, "");
  contactRows.push(`
    <div class="detail-contact-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <a href="https://www.tiktok.com/@${tiktokHandle}" target="_blank">@${tiktokHandle}</a>
    </div>`);

  const activity = buildActivityLog(c);

  $("detailBody").innerHTML = `
    <div class="detail-profile">
      <div class="c-avatar" style="background:${AVATAR_COLORS[c.id]}">${c.name.charAt(0).toUpperCase()}</div>
      <div class="meta">
        <div class="c-name">${c.name}</div>
        <div class="c-handle">${c.handle}</div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">分类与状态</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="badge ${t.cls}">${t.label}</span>
        ${statusBadge(effectiveStatus(c))}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">带货数据 · 30天</div>
      <div class="detail-metrics">
        <div class="detail-metric"><div class="v">${fmtNum(c.fans)}</div><div class="l">粉丝</div></div>
        <div class="detail-metric"><div class="v">${fmtMoney(c.gmv)}</div><div class="l">GMV</div></div>
        <div class="detail-metric"><div class="v">${fmtNum(c.units)}</div><div class="l">销量</div></div>
        <div class="detail-metric"><div class="v">$${aov}</div><div class="l">客单</div></div>
        <div class="detail-metric"><div class="v">${fmtGPM(c.gpm)}</div><div class="l">GPM</div></div>
        <div class="detail-metric"><div class="v">${trendHtml || "—"}</div><div class="l">趋势</div></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">受众画像</div>
      <div class="audience-row">${gender}${age}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">联系方式</div>
      <div class="detail-contact">${contactRows.join("")}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">AI 洞察</div>
      <div class="detail-insight"><strong>AI 洞察 · </strong>${insightFor(c)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">建联活动</div>
      <div class="detail-activity">${activity}</div>
    </div>
  `;
}

function buildActivityLog(c) {
  const logs = [];
  const now = new Date();
  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  if (state.sent[c.id]) {
    const sentTime = new Date(now.getTime() - 1000 * 60 * 30);
    logs.push({ color: "#06B6D4", text: `已通过 ${CHANNEL_LABEL[composerChannel] || "邮件"} 发送建联文案`, time: fmt(sentTime) });
  }

  const st = effectiveStatus(c);
  if (st === "replied") {
    logs.push({ color: "#10B981", text: "达人已回复邮件", time: fmt(new Date(now.getTime() - 1000 * 60 * 60 * 2)) });
  } else if (st === "contacted" || st === "sent") {
    logs.push({ color: "#7856FF", text: "已标记为已联系", time: fmt(new Date(now.getTime() - 1000 * 60 * 60 * 5)) });
  }

  if (state.customCreators && state.customCreators.some((x) => x.id === c.id)) {
    logs.push({ color: "#F59E0B", text: `通过 AI 分析器加入达人池`, time: fmt(new Date(now.getTime() - 1000 * 60 * 60 * 24)) });
  }

  if (!logs.length) {
    logs.push({ color: "#9CA3AF", text: "暂无建联活动记录", time: "" });
  }

  return logs.map((l) => `
    <div class="detail-activity-item">
      <span class="detail-activity-dot" style="background:${l.color}"></span>
      <div>
        <div class="detail-activity-text">${l.text}</div>
        ${l.time ? `<div class="detail-activity-time">${l.time}</div>` : ""}
      </div>
    </div>`).join("");
}

function updateComposerHint(c) {
  if (composerChannel === "email") {
    $("composerHint").textContent = `将发送至 ${c.email}`;
  } else if (composerChannel === "whatsapp") {
    $("composerHint").textContent = c.whatsapp
      ? `将在 WhatsApp 打开与 ${c.whatsapp} 的对话（需手动点击发送）`
      : "请填写 WhatsApp 号码（含国家码，如 15551234567）";
  } else {
    $("composerHint").textContent = "无公开邮箱 — 请通过 TikTok 私信手动发送";
  }
}

function fillComposerFields(c) {
  const edits = state.edits[c.id] || {};
  const subjectField = $("composerSubject").parentElement;
  const waField = $("whatsappField");
  if (composerChannel === "dm") {
    waField.style.display = "none";
    subjectField.style.display = "none";
    $("composerSubject").value = "";
    $("composerBody").value = edits.dmBody || buildDM(c, state.tone);
  } else if (composerChannel === "whatsapp") {
    subjectField.style.display = "none";
    $("composerSubject").value = "";
    waField.style.display = "flex";
    $("composerWhatsapp").value = c.whatsapp || edits.whatsapp || "";
    $("composerBody").value = edits.waBody || buildWhatsApp(c, state.tone);
  } else {
    waField.style.display = "none";
    subjectField.style.display = "flex";
    const email = buildEmail(c, state.tone);
    $("composerSubject").value = edits.emailSubject || email.subject;
    $("composerBody").value = edits.emailBody || email.body;
  }
}

function persistComposerEdits() {
  if (!composerId) return;
  const c = getCreator(composerId);
  if (!c) return;
  const edits = state.edits[composerId] || {};
  if (composerChannel === "dm") {
    edits.dmBody = $("composerBody").value;
  } else if (composerChannel === "whatsapp") {
    edits.waBody = $("composerBody").value;
    edits.whatsapp = $("composerWhatsapp").value.trim();
  } else {
    edits.emailSubject = $("composerSubject").value;
    edits.emailBody = $("composerBody").value;
  }
  state.edits[composerId] = edits;
  saveState();
}

function regenerateCurrent() {
  if (!composerId) return;
  const c = getCreator(composerId);
  const edits = state.edits[composerId] || {};
  if (composerChannel === "dm") {
    edits.dmBody = buildDM(c, state.tone);
    $("composerBody").value = edits.dmBody;
  } else if (composerChannel === "whatsapp") {
    edits.waBody = buildWhatsApp(c, state.tone);
    $("composerBody").value = edits.waBody;
  } else {
    const email = buildEmail(c, state.tone);
    edits.emailSubject = email.subject;
    edits.emailBody = email.body;
    $("composerSubject").value = email.subject;
    $("composerBody").value = email.body;
  }
  state.edits[composerId] = edits;
  saveState();
  toast("文案已重新生成", "success");
}

// ---------- 发送 ----------
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sendToCreator(id) {
  const c = getCreator(id);
  if (!c) return;
  persistComposerEdits();

  if (composerChannel === "email") {
    await sendEmailViaBackend(id, c);
  } else if (composerChannel === "whatsapp") {
    sendViaWhatsApp(id, c);
  } else {
    sendViaTikTokDM(id, c);
  }
  saveState();
}

async function sendEmailViaBackend(id, c) {
  const smtp = state.smtp || {};
  if (!smtp.user || !smtp.password) {
    toast("请先在「设置」页填写发件邮箱和授权码", "error");
    return;
  }
  const subject = $("composerSubject").value;
  const body = $("composerBody").value;
  toast("正在发送邮件…", "info");
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: c.email,
        subject,
        body,
        smtp: {
          host: smtp.host,
          port: smtp.port,
          ssl: smtp.ssl,
          user: smtp.user,
          password: smtp.password
        }
      })
    });
    const data = await res.json();
    if (data.ok) {
      state.sent[id] = true;
      state.status[id] = "sent";
      toast(`已发送邮件给 ${c.name} ✉`, "success");
    } else {
      toast(data.error || "发送失败", "error");
    }
  } catch (e) {
    toast("网络错误：无法连接后端服务", "error");
  }
}

function sendViaWhatsApp(id, c) {
  const edits = state.edits[c.id] || {};
  const phone = ($("composerWhatsapp").value || c.whatsapp || "").trim().replace(/[^\d]/g, "");
  if (!phone) { toast("请先填写 WhatsApp 号码（含国家码）", "error"); return; }
  edits.whatsapp = phone;
  state.edits[c.id] = edits;
  const text = encodeURIComponent($("composerBody").value);
  window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
  state.status[id] = "whatsapp";
  toast(`已在 WhatsApp 打开与 ${c.name} 的对话 — 点击发送即可`, "success");
}

function sendViaTikTokDM(id, c) {
  const text = $("composerBody").value;
  state.status[id] = "dm";
  copyText(text, `已复制 ${c.name} 的私信 — 请手动发送`);
  const handle = (c.handle || "").replace(/^@/, "");
  if (handle) window.open(`https://www.tiktok.com/@${handle}`, "_blank");
}

async function sendAll() {
  const ids = state.selected.slice();
  if (!ids.length) return;
  $("outreachSendAll").disabled = true;
  $("sendProgress").style.display = "flex";
  const total = ids.length;
  for (let i = 0; i < ids.length; i++) {
    $("sendProgressText").textContent = `正在发送 ${i + 1} / ${total}…`;
    $("sendProgressFill").style.width = ((i + 1) / total * 100) + "%";
    await sendToCreator(ids[i]);
  }
  $("sendProgressText").textContent = "完成";
  await delay(600);
  $("sendProgress").style.display = "none";
  $("sendProgressFill").style.width = "0";
  $("outreachSendAll").disabled = false;
  renderOutreach();
  renderHome();
}

// ---------- Performance ----------
let perfChart;
function renderPerformance() {
  const names = CREATORS.map((c) => c.name);
  const gmvs = CREATORS.map((c) => c.gmv);
  if (!perfChart) {
    perfChart = echarts.init($("perfChart"));
    window.addEventListener("resize", () => perfChart.resize());
  }
  perfChart.setOption({
    grid: { left: 10, right: 20, top: 20, bottom: 24, containLabel: true },
    xAxis: {
      type: "category", data: names,
      axisLine: { lineStyle: { color: "#E5E7EB" } }, axisTick: { show: false },
      axisLabel: { color: "#9CA3AF", fontSize: 12 }
    },
    yAxis: {
      type: "value", axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: "#F3F4F6", type: "dashed" } },
      axisLabel: { color: "#9CA3AF", fontSize: 12, formatter: (v) => "$" + v }
    },
    tooltip: { trigger: "axis", formatter: (p) => `${p[0].name}<br/>GMV: $${fmtNum(p[0].value)}` },
    series: [{
      type: "bar", data: gmvs, barWidth: 36,
      itemStyle: { color: "#7856FF", borderRadius: [6, 6, 0, 0] }
    }]
  });

  const sent = Object.keys(state.sent).filter((id) => state.sent[id]).length;
  const replied = CREATORS.filter((c) => effectiveStatus(c) === "replied").length;
  const steps = [
    { label: "达人池", val: CREATORS.length },
    { label: "已选", val: state.selected.length },
    { label: "已发邮件", val: sent },
    { label: "已回复", val: replied }
  ];
  const max = Math.max(CREATORS.length, 1);
  $("funnelList").innerHTML = steps.map((s) => `
    <div class="funnel-step">
      <span style="width:90px;font-size:12px;color:var(--text-2)">${s.label}</span>
      <div class="funnel-bar">
        <div class="fill" style="width:${s.val / max * 100}%"></div>
        <span class="funnel-label" style="color:${s.val ? '#fff' : 'var(--text-2)'}"></span>
        <span class="funnel-val">${s.val}</span>
      </div>
    </div>`).join("");

  renderRepliesList();
}

function renderRepliesList() {
  const wrap = $("repliesList");
  if (!wrap) return;
  const entries = Object.keys(state.notes)
    .map((id) => {
      const c = CREATORS.find((x) => x.id === id) || state.customCreators.find((x) => x.id === id);
      return c ? { c, n: state.notes[id] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.n.at || 0) - (a.n.at || 0));
  if (!entries.length) {
    wrap.innerHTML = `<div class="replies-empty">还没有达人回复记录。<br>到达人池，把状态切到「已回复」并点「💬 备注」即可记录。</div>`;
    return;
  }
  wrap.innerHTML = entries.map(({ c, n }) => {
    const date = n.at ? new Date(n.at).toLocaleString() : "";
    return `<div class="reply-row" data-id="${c.id}">
      <div class="reply-avatar" style="background:${AVATAR_COLORS[c.id] || '#7c3aed'}">${(c.name || "?").charAt(0).toUpperCase()}</div>
      <div class="reply-body">
        <div class="reply-head"><b>${c.name}</b> <span class="reply-handle">${c.handle || ""}</span> <span class="reply-date">${date}</span></div>
        <div class="reply-text">${escapeAttr(n.text)}</div>
      </div>
      <button class="reply-jump" data-id="${c.id}" title="去达人池修改">编辑备注 →</button>
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".reply-jump")) return;
      editNote(el.dataset.id);
    });
  });
  wrap.querySelectorAll(".reply-jump").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      editNote(btn.dataset.id);
    });
  });
}

// ---------- Insights ----------
function renderInsights() {
  const items = [];

  // 1. 最高决策评分
  const scored = CREATORS.map((c) => ({ c, s: scoreCreator(c) })).sort((a, b) => b.s - a.s);
  if (scored.length) {
    const top = scored[0];
    items.push({
      tag: "优先级",
      title: `${top.c.name} 是你杠杆最高的合作对象`,
      body: `${fmtNum(top.c.fans)} 粉丝、月 GMV ${fmtMoney(top.c.gmv)}、决策评分 ${top.s} 分。${scoreReason(top.c)}`
    });
  }

  // 2. 走量型：销量最高
  const volume = CREATORS.filter((c) => c.units > 0).sort((a, b) => b.units - a.units)[0];
  if (volume) {
    const aov = volume.units > 0 ? volume.gmv / volume.units : 0;
    items.push({
      tag: "走量",
      title: `${volume.name} 把流量转化成 GMV`,
      body: `月销 ${fmtNum(volume.units)} 单、客单仅 ~$${aov.toFixed(0)}。$${state.product.price} 摄像头能拉高他的客单和 GMV——用「同样的流量、更高的 GMV」切入。`
    });
  }

  // 3. 受众契合：女性占比在 45%-80% 最优区间内最高者
  const audience = CREATORS
    .filter((c) => c.female != null && c.female >= 45 && c.female <= 80)
    .sort((a, b) => b.female - a.female)[0];
  if (audience) {
    items.push({
      tag: "受众",
      title: `${audience.name} 精准触达你的买家`,
      body: `${audience.female}% 女性受众——正是为家庭和安全买单的核心人群。用「安全安心」切入，别讲技术参数。`
    });
  }

  // 4. 热线索：已回复（带回复原话）
  const replied = CREATORS.filter((c) => effectiveStatus(c) === "replied");
  if (replied.length) {
    const withNotes = replied.filter((c) => state.notes[c.id]);
    const notesBody = withNotes.length
      ? `<div class="insight-notes">${withNotes.map((c) => {
          const n = state.notes[c.id];
          const date = n.at ? new Date(n.at).toLocaleDateString() : "";
          return `<div class="insight-note"><div class="nd-head"><b>${c.name}</b> <span class="nd-handle">${c.handle}</span> <span class="nd-date">${date}</span></div><div class="nd-body">${escapeAttr(n.text)}</div></div>`;
        }).join("")}</div>`
      : "";
    items.push({
      tag: "跟进",
      title: `有 ${replied.length} 位达人已经回复`,
      body: `${replied.map((c) => c.name).join("、")} 已回复过。优先推进成交，再扩冷启动建联——热线索先转化。${notesBody}`,
      rawNotes: withNotes.length
    });
  }

  if (!items.length) {
    items.push({ tag: "提示", title: "达人池为空", body: "去达人池搜索并添加达人，系统会自动生成洞察。" });
  }

  $("insightsList").innerHTML = items.map((i) => `
    <div class="insight-card">
      <div class="insight-tag">${i.tag}</div>
      <h3>${i.title}</h3>
      <p>${i.body}</p>
    </div>`).join("");
}

// ---------- Settings ----------
const SMTP_PRESETS = {
  gmail: { host: "smtp.gmail.com", port: 587, ssl: false },
  qq: { host: "smtp.qq.com", port: 465, ssl: true },
  "163": { host: "smtp.163.com", port: 465, ssl: true },
  outlook: { host: "smtp.office365.com", port: 587, ssl: false },
  custom: { host: "", port: 465, ssl: true }
};

function renderSettings() {
  $("setBrandName").value = state.brand.name || "";
  $("setBrandEmail").value = state.brand.email || "";
  $("setProductName").value = state.product.name;
  $("setPrice").value = state.product.price;
  $("setCommission").value = state.product.commission;
  const smtp = state.smtp || {};
  $("setSmtpProvider").value = smtp.provider || "gmail";
  $("setSmtpUser").value = smtp.user || "";
  $("setSmtpPassword").value = smtp.password || "";
  $("setSmtpHost").value = smtp.host || "";
  $("setSmtpPort").value = smtp.port || 587;
  $("setSmtpSsl").value = smtp.ssl ? "ssl" : "starttls";
  $("setOpenBoostKey").value = state.openboostKey || "";
  // 显示「已保存」徽章（遮罩状态下用户看不见值，需要明确告知）
  const obVal = (state.openboostKey || "").trim();
  $("obSavedBadge").style.display = obVal ? "inline-flex" : "none";
  const smtpPwdVal = ((state.smtp || {}).password || "").trim();
  $("smtpPwdSavedBadge").style.display = smtpPwdVal ? "inline-flex" : "none";
  updateObStatus();
}

// ---------- 密码字段眼睛切换 ----------
function bindPasswordToggles() {
  const EYE_OPEN = '<svg class="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg class="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  document.querySelectorAll(".pwd-toggle").forEach((btn) => {
    btn.innerHTML = EYE_OPEN; // 初始是"闭眼"（字段已遮罩）
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.target);
      if (!input) return;
      const revealed = input.type === "text";
      input.type = revealed ? "password" : "text";
      btn.innerHTML = revealed ? EYE_OPEN : EYE_OFF;
      btn.classList.toggle("revealed", !revealed);
      btn.title = revealed ? "显示" : "隐藏";
    });
  });
  // 用户开始输入时隐藏「已保存」徽章（避免误导）
  document.querySelectorAll(".pwd-input").forEach((input) => {
    input.addEventListener("input", () => {
      const badge = input.closest(".pwd-wrap").querySelector(".pwd-saved-badge");
      if (badge) badge.style.display = "none";
    });
  });
}

function updateObStatus() {
  const wrap = $("obStatus");
  if (!wrap) return;
  const dot = wrap.querySelector(".ob-dot");
  const txt = $("obStatusText");
  const key = (state.openboostKey || "").trim();
  if (key) {
    dot.className = "ob-dot on";
    txt.textContent = "密钥已配置 — 输入 @handle 将实时拉取真实数据";
  } else {
    dot.className = "ob-dot";
    txt.textContent = "尚未配置密钥 — 当前使用内置示例数据";
  }
}

// ---------- ECharts 主图（决策优先级评分条形图） ----------
let mainChart;

function renderScoreLegend() {
  const grades = [gradeFor(90), gradeFor(75), gradeFor(55), gradeFor(30)];
  $("scoreLegend").innerHTML = grades.map((g) =>
    `<span class="score-grade" style="background:${g.bg};color:${g.color}">${g.grade} · ${g.label}</span>`
  ).join("");
}

function initMainChart() {
  if (typeof echarts === "undefined") return;
  if (!mainChart) {
    mainChart = echarts.init($("mainChart"));
    window.addEventListener("resize", () => mainChart.resize());
  }
  renderScoreLegend();
  updateChart();
}

function updateChart() {
  if (!mainChart) return;
  const scored = CREATORS.map((c) => {
    const s = scoreCreator(c);
    return { c, s, g: gradeFor(s) };
  }).sort((a, b) => a.s - b.s); // 升序，横向条形图自下而上

  const names = scored.map((x) => x.c.name);
  const colors = scored.map((x) => x.g.color);

  mainChart.setOption({
    grid: { left: 8, right: 44, top: 10, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: "#fff", borderColor: "#E5E7EB",
      textStyle: { color: "#111827", fontSize: 12 },
      formatter: (p) => {
        const item = scored[p[0].dataIndex];
        return `<div style="font-weight:700;margin-bottom:4px">${item.c.name} ${item.c.handle}</div>` +
          `<div>评分 <b style="color:${item.g.color}">${item.s}</b> · ${item.g.grade} 级 ${item.g.label}</div>` +
          `<div style="color:#6B7280;margin-top:3px;max-width:240px">${scoreReason(item.c)}</div>`;
      }
    },
    xAxis: {
      type: "value", max: 100,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: "#F3F4F6", type: "dashed" } },
      axisLabel: { color: "#9CA3AF", fontSize: 11 }
    },
    yAxis: {
      type: "category", data: names,
      axisLine: { lineStyle: { color: "#E5E7EB" } }, axisTick: { show: false },
      axisLabel: { color: "#4B5563", fontSize: 12 }
    },
    series: [{
      type: "bar",
      data: scored.map((x, i) => ({ value: x.s, itemStyle: { color: colors[i], borderRadius: [0, 6, 6, 0] } })),
      barWidth: 18,
      label: { show: true, position: "right", color: "#6B7280", fontSize: 11, formatter: (p) => p.value }
    }]
  }, true);
}

// ---------- Toast ----------
function toast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast" + (type === "success" ? " success" : "");
  el.innerHTML = `<span class="toast-dot"></span>${msg}`;
  $("toastContainer").appendChild(el);
  setTimeout(() => {
    el.style.animation = "toastOut .25s ease forwards";
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

// 复制文本到剪贴板：优先现代 API，失败回退 execCommand（iframe 预览面板里更稳）
function copyText(text, okMsg) {
  const done = () => toast(okMsg || "已复制到剪贴板", "success");
  const fallback = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) { done(); return true; }
    } catch (e) { /* ignore */ }
    return false;
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { if (!fallback()) toast("复制失败，请手动全选复制", "error"); });
  } else if (!fallback()) {
    toast("复制失败，请手动全选复制", "error");
  }
}

// ---------- 打开 composer（从表格跳转） ----------
function openComposer(id) {
  if (!isSelected(id)) toggleSelect(id, true);
  showView("outreach");
  loadComposer(id);
}

function copyCurrent() {
  if (!composerId) return;
  persistComposerEdits();
  const c = getCreator(composerId);
  let text;
  if (composerChannel === "email") {
    text = "Subject: " + $("composerSubject").value + "\n\n" + $("composerBody").value;
  } else {
    text = $("composerBody").value;
  }
  copyText(text);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // nav
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.nav;
      if (name === "settings") { showView("settings"); return; }
      showView(name);
    });
  });

  // topbar
  $("topbarSave").addEventListener("click", () => { saveState(); toast("已保存", "success"); });
  $("topbarShare").addEventListener("click", () => toast("演示链接已就绪，可分享"));
  $("topbarSettings").addEventListener("click", () => showView("settings"));

  // analyzer
  $("openAnalyzerHome").addEventListener("click", openAnalyzer);
  $("openAnalyzerPool").addEventListener("click", openAnalyzer);
  $("analyzerClose").addEventListener("click", closeAnalyzer);
  $("analyzerModal").addEventListener("click", (e) => { if (e.target === $("analyzerModal")) closeAnalyzer(); });
  $("analyzerRun").addEventListener("click", runAnalyze);
  $("analyzerInput").addEventListener("keydown", (e) => { if (e.key === "Enter") runAnalyze(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAnalyzer(); });

  // batch import
  $("openBatchImport").addEventListener("click", openBatchImport);
  $("batchImportClose").addEventListener("click", closeBatchImport);
  $("batchImportCancel").addEventListener("click", closeBatchImport);
  $("batchImportModal").addEventListener("click", (e) => { if (e.target === $("batchImportModal")) closeBatchImport(); });
  $("batchImportTextarea").addEventListener("input", updateBatchCount);
  $("batchImportGo").addEventListener("click", () => {
    const handles = parseBatchInput($("batchImportTextarea").value).slice(0, 50);
    if (!handles.length) return;
    runBatchImport(handles);
  });
  $("batchResultDone").addEventListener("click", () => {
    closeBatchImport();
    // 切到达人池，让用户立刻看到刚导入的
    showView("creators");
  });

  // delete confirm
  $("delModalClose").addEventListener("click", closeDeleteModal);
  $("delModalCancel").addEventListener("click", closeDeleteModal);
  $("deleteConfirmModal").addEventListener("click", (e) => { if (e.target === $("deleteConfirmModal")) closeDeleteModal(); });
  $("delModalConfirm").addEventListener("click", confirmDelete);
  $("batchResultRetry").addEventListener("click", retryFailedImport);

  // home search：输入本地过滤，回车实时查新达人
  $("homeSearch").addEventListener("input", (e) => renderHomeTable(e.target.value));
  $("homeSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") liveSearchCreator($("homeSearch"), () => renderHomeTable($("homeSearch").value));
  });

  // export
  $("exportCSV").addEventListener("click", exportCSV);

  // pool
  document.querySelectorAll("#poolTable th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      poolSort = th.dataset.sort;
      renderPool();
    });
  });
  $("poolSearch").addEventListener("input", () => renderPool());
  $("poolSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") liveSearchCreator($("poolSearch"), () => renderPool()); });
  $("poolSearchBtn").addEventListener("click", () => liveSearchCreator($("poolSearch"), () => renderPool()));
  $("poolSegments").addEventListener("click", (e) => {
    if (e.target.dataset.seg) { poolSegment = e.target.dataset.seg; renderPool(); }
  });
  $("poolSelectAll").addEventListener("change", (e) => {
    CREATORS.forEach((c) => toggleSelect(c.id, e.target.checked));
  });
  $("bulkClear").addEventListener("click", () => {
    state.selected = []; saveState(); renderPool(); updateNavBadge();
  });
  $("bulkGenerate").addEventListener("click", () => showView("outreach"));
  $("poolGenerate").addEventListener("click", () => showView("outreach"));

  // outreach
  $("outreachClear").addEventListener("click", () => {
    state.selected = []; composerId = null; saveState();
    renderOutreach(); showComposerEmpty(); updateNavBadge();
  });
  $("outreachSendAll").addEventListener("click", sendAll);

  // composer channel tabs
  document.querySelectorAll(".composer-tabs .tab").forEach((t) => {
    t.addEventListener("click", () => {
      const c = getCreator(composerId);
      const ch = t.dataset.channel;
      if (ch === "email" && c && !c.email) { toast("该达人无公开邮箱", "info"); return; }
      composerChannel = ch;
      if (composerId) loadComposer(composerId, { keepChannel: true });
    });
  });

  // tone
  $("toneSelect").addEventListener("click", (e) => {
    if (!e.target.dataset.tone) return;
    state.tone = e.target.dataset.tone;
    document.querySelectorAll("#toneSelect button").forEach((b) => b.classList.toggle("active", b === e.target));
    saveState();
    regenerateCurrent();
  });
  // sync tone buttons
  document.querySelectorAll("#toneSelect button").forEach((b) => b.classList.toggle("active", b.dataset.tone === state.tone));

  // composer
  $("regeneratePitch").addEventListener("click", regenerateCurrent);
  $("composerCopy").addEventListener("click", copyCurrent);
  $("composerSend").addEventListener("click", async () => {
    if (!composerId) return;
    await sendToCreator(composerId);
    renderOutreach();
    renderHome();
  });

  // persist edits on input
  $("composerSubject").addEventListener("input", persistComposerEdits);
  $("composerBody").addEventListener("input", persistComposerEdits);
  $("composerWhatsapp").addEventListener("input", persistComposerEdits);

  // settings
  $("settingsSave").addEventListener("click", () => {
    state.brand.name = $("setBrandName").value.trim();
    state.brand.email = $("setBrandEmail").value.trim();
    state.product.name = $("setProductName").value.trim() || "Home Security Camera";
    state.product.price = parseFloat($("setPrice").value) || 40;
    state.product.commission = parseFloat($("setCommission").value) || 14;
    const preset = SMTP_PRESETS[$("setSmtpProvider").value] || SMTP_PRESETS.custom;
    state.smtp = {
      provider: $("setSmtpProvider").value,
      host: $("setSmtpHost").value.trim() || preset.host,
      port: parseInt($("setSmtpPort").value, 10) || preset.port,
      ssl: $("setSmtpSsl").value === "ssl",
      user: $("setSmtpUser").value.trim(),
      password: $("setSmtpPassword").value
    };
    state.openboostKey = $("setOpenBoostKey").value.trim();
    saveState();
    updateObStatus();
    toast("设置已保存", "success");
  });

  // SMTP provider 预设联动
  $("setSmtpProvider").addEventListener("change", () => {
    const preset = SMTP_PRESETS[$("setSmtpProvider").value] || SMTP_PRESETS.custom;
    $("setSmtpHost").value = preset.host;
    $("setSmtpPort").value = preset.port;
    $("setSmtpSsl").value = preset.ssl ? "ssl" : "starttls";
  });
}

function exportCSV() {
  const headers = ["达人", "Handle", "类型", "类目", "粉丝", "30天GMV", "销量", "客单", "GPM", "邮箱", "状态"];
  const rows = CREATORS.map((c) => {
    const t = classify(c);
    return [c.name, c.handle, t.label, c.category, c.fans, c.gmv, c.units, Math.round(c.gmv / c.units), c.gpm || "", c.email || "", effectiveStatus(c)].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "creators.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ---------- 启动 ----------
document.addEventListener("DOMContentLoaded", () => {
  // 恢复通过 @handle 分析新增的达人（已被归档移除的不再加回，除非用户重新搜索）
  const archivedIds = new Set((state.archived || []).map((a) => a.id));
  (state.customCreators || []).forEach((c) => {
    if (!CREATORS.find((x) => x.id === c.id) && !archivedIds.has(c.id)) {
      CREATORS.push(c);
      AVATAR_COLORS[c.id] = colorFor(c.id);
    }
  });
  bindEvents();
  bindPasswordToggles();
  updateNavBadge();
  showView(state.view || "home");
});
