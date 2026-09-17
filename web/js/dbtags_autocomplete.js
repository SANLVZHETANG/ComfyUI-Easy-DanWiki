import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";
import { $el } from "../../../scripts/ui.js";

/*
  Danbooru bilingual autocomplete (P3: core completion).
  ...same doc...
*/

// stylesheet: load dbtags_autocomplete.css (same dir as this file)
/* versioning follows semver: MAJOR = incompatible changes,
MINOR = new features, PATCH = fixes (current scheme set at v0.1.1) */
const VERSION = "v0.2.6";
{
	const url = new URL("./dbtags_autocomplete.css", import.meta.url);
	url.search = "?v=" + VERSION;
	$el("link", { parent: document.head, rel: "stylesheet", type: "text/css", href: url });
	const themeUrl = new URL("./dbtags_themes.css", import.meta.url);
	themeUrl.search = "?v=" + VERSION;
	$el("link", { parent: document.head, rel: "stylesheet", type: "text/css", href: themeUrl });
}

const ID = "dbtags.autocomplete";
const SKIP_WIDGETS = new Set(["ttN xyPlot.x_values", "ttN xyPlot.y_values"]);
// cache-busting: rebuilds of tags_index.json REQUIRE bumping VERSION above
// (the index URL rides on it), see README 构建/部署命令
const INDEX_URL = new URL("./data/tags_index.json", import.meta.url).href + "?v=" + VERSION;
const PYSSSSS_AUTO = "/extensions/comfyui-custom-scripts/js/common/autocomplete.js";
const SEPARATOR = ", ";
const BODY_IDLE_MS = 300; // typing pause before the (expensive) wiki-body scan runs
const DEBUG = new URLSearchParams(location.search).has("dbtags_debug") ||
		localStorage.getItem(ID + ".debug") === "true";

let index = null;
const _indexReadyCbs = [];
function onIndexReady(cb) {
	if (index) cb();
	else _indexReadyCbs.push(cb);
}

/* ---- local font files served from the plugin fonts/ dir ----
   listing is cheap; loading is lazy (a bundled CJK font is ~17MB, and the
   default config uses none of them) */
const _fontNames = [];
const _loadedFams = new Set();
const _fontsReadyCbs = [];
function onFontsReady(cb) {
	if (_fontsListed) cb();
	else _fontsReadyCbs.push(cb);
}
let _fontsListed = false;
async function listFonts() {
	if (_fontsListed) return;
	_fontsListed = true;
	try {
		const resp = await fetch("/dbtags/fonts");
		if (resp.ok) {
			for (const n of await resp.json()) _fontNames.push(n);
		}
	} catch {
		void 0;
	}
	dlog("C", `font list: ${_fontNames.join(", ") || "none"}`);
	for (const cb of _fontsReadyCbs.splice(0)) {
		try {
			cb();
		} catch {
			void 0;
		}
	}
}
async function ensureFont(fam) {
	if (!fam || _loadedFams.has(fam)) return _loadedFams.has(fam);
	await listFonts();
	const name = _fontNames.find((n) => n.replace(/\.[a-z0-9]+$/i, "") === fam);
	if (!name) return false;
	try {
		const ff = new FontFace(fam, `url("/dbtags/font?name=${encodeURIComponent(name)}")`);
		await ff.load();
		document.fonts.add(ff);
		_loadedFams.add(fam);
		dlog("C", `font loaded: ${fam}`);
	} catch (e) {
		dlog("C", `font load failed: ${fam}`, e);
	}
	return _loadedFams.has(fam);
}
async function loadFonts() {
	await listFonts();
	// preload ONLY the selected family; others load when picked in the styler
	const sel = Config.get("fontFamily", "").replace(/"/g, "");
	if (sel) await ensureFont(sel);
}
let TAG_MAP = null;

function getTagMap() {
	if (!TAG_MAP) {
		TAG_MAP = new Map(index.tags.map((t) => [t.name, t]));
	}
	return TAG_MAP;
}

function normName(s) {
	// normalize a [[target]] from wiki text to the canonical tag name
	return s.toLowerCase().replace(/\s+/g, "_");
}

/* ---- config / theme (P6) ---- */
const Config = {
	get(k, dflt) {
		const v = localStorage.getItem(ID + "." + k);
		return v === null ? dflt : v;
	},
	set(k, v) {
		localStorage.setItem(ID + "." + k, String(v));
	},
	getNum(k, dflt) {
		const v = parseInt(Config.get(k, ""), 10);
		return Number.isFinite(v) && v >= 0 ? v : dflt;
	},
};

/* HUD keeps its own translucency; unset ("" ) => follow the global 不透明度 */
function hudOpacityVal() {
	const raw = Config.get("hudOpacity", "");
	const glob = Math.min(100, Math.max(25, Config.getNum("opacity", 100)));
	if (raw === "") return glob;
	return Math.min(100, Math.max(25, parseInt(raw, 10) || glob));
}

// HUD-only font size; "" = follow the global font size (mirrors hudOpacityVal)
function hudFontVal() {
	const raw = Config.get("hudFont", "");
	const glob = Math.min(28, Math.max(9, Config.getNum("font", 13)));
	if (raw === "") return glob;
	return Math.min(28, Math.max(9, parseInt(raw, 10) || glob));
}

/* ---- custom theme (color picker vars, stored as hex JSON in customVars) ---- */
const CUSTOM_DEFAULT = {
	bg: "#f8e7ee",
	bg2: "#fdf0f5",
	border: "#e38fba",
	text: "#53263e",
	sub: "#8b4e6d",
	summary: "#8b4e6d",
	highlight: "#ec62a1",
	count: "#c34e81",
	fuzzy: "#d77160",
};
const CUSTOM_INLINE_VARS = [
	"--dbtags-ac-bg", "--dbtags-ac-bg-rgb", "--dbtags-ac-bg2", "--dbtags-ac-bg2-rgb",
	"--dbtags-ac-border", "--dbtags-ac-text", "--dbtags-ac-sub", "--dbtags-ac-zh",
	"--dbtags-ac-summary",
	"--dbtags-ac-highlight", "--dbtags-ac-selected", "--dbtags-ac-count",
	"--dbtags-ac-fuzzy", "--dbtags-ac-fuzzy-bg",
];

function isLightHex(hex) {
	const rgb = hexRgb(hex);
	if (!rgb) return false;
	const [r, g, b] = rgb.split(",").map((x) => parseInt(x, 10));
	return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

function hexRgb(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
	if (!m) return null;
	const n = parseInt(m[1], 16);
	return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function getCustomColors() {
	if (getCustomColors.cache) return getCustomColors.cache;
	let c = null;
	try {
		c = JSON.parse(Config.get("customVars", ""));
	} catch {
		c = null;
	}
	if (!c || typeof c !== "object") c = { ...CUSTOM_DEFAULT };
	getCustomColors.cache = { ...CUSTOM_DEFAULT, ...c };
	return getCustomColors.cache;
}

function saveCustomColors(c) {
	getCustomColors.cache = { ...CUSTOM_DEFAULT, ...c };
	Config.set("customVars", JSON.stringify(getCustomColors.cache));
	applyConfig();
	refreshAllInstances();
}

/* user-imported/saved theme presets: [{ id, name, colors:{...} }] */
function getUserThemes() {
	let list = [];
	try {
		list = JSON.parse(Config.get("userThemes", ""));
	} catch {
		list = [];
	}
	return Array.isArray(list) ? list : [];
}

function saveUserThemes(list) {
	Config.set("userThemes", JSON.stringify(list));
}

const REMOVED_THEMES = { "amber-mono": "amber-close", "amber-pick": "amber-close", "pink2": "pink", "terminal-green": "dark", "soft-candy": "pink", "glass": "light", "cyberpunk": "modern-dark", "material-you": "modern" };

function findUserTheme(id) {
	return getUserThemes().find((p) => p && p.id === id) || null;
}

// bumped on every applyConfig(); lets the HUD detect a theme/color swap and
// re-capture its native background instead of trusting a stale inline override
let _themeEpoch = 0;
function applyConfig() {
	_langZh = Config.get("lang", "zh") === "zh";	_insNoUnder = Config.get("insNoUnder", "true") !== "false";
	_showNoUnder = Config.get("showNoUnder", "false") === "true";
	_escParens = Config.get("escParens", "true") !== "false";
	_hudOn = Config.get("hudMode", "false") === "true";
	const root = document.documentElement;
	const storedTheme = Config.get("theme", "dark");
	const theme = REMOVED_THEMES[storedTheme] || storedTheme;
	const isUserTheme = typeof theme === "string" && theme.startsWith("up");
	root.classList.toggle("dbtags-theme-dark", theme === "dark");
	root.classList.toggle("dbtags-theme-light", theme === "light");
	root.classList.toggle("dbtags-theme-pink", theme === "pink");
	root.classList.toggle("dbtags-theme-mint", theme === "mint");
	root.classList.toggle("dbtags-theme-amber-close", theme === "amber-close");
	root.classList.toggle("dbtags-theme-retro-apple", theme === "retro-apple");
	root.classList.toggle("dbtags-theme-winxp", theme === "winxp");
	root.classList.toggle("dbtags-theme-winxp-olive", theme === "winxp-olive");
	root.classList.toggle("dbtags-theme-winxp-silver", theme === "winxp-silver");
	root.classList.toggle("dbtags-theme-winxp-classic", theme === "winxp-classic");
	root.classList.toggle("dbtags-theme-modern", theme === "modern");
	root.classList.toggle("dbtags-theme-modern-dark", theme === "modern-dark");
	root.classList.toggle("dbtags-theme-eye-care", theme === "eye-care");
	root.classList.toggle("dbtags-theme-eye-care-dark", theme === "eye-care-dark");
	root.classList.toggle("dbtags-theme-nord", theme === "nord");
	root.classList.toggle("dbtags-theme-solarized", theme === "solarized");
	root.classList.toggle("dbtags-theme-custom", theme === "custom" || isUserTheme);
	root.classList.toggle("dbtags-width-fixed", Config.get("widthMode", "fit") === "fixed");
	// inline custom vars beat any theme class block; wipe first so built-ins stay clean
	for (const v of CUSTOM_INLINE_VARS) root.style.removeProperty(v);
	const applyColors = (c) => {
		const set = (v, val) => val && root.style.setProperty(v, val);
		set("--dbtags-ac-bg", c.bg);
		set("--dbtags-ac-bg-rgb", hexRgb(c.bg));
		set("--dbtags-ac-bg2", c.bg2);
		set("--dbtags-ac-bg2-rgb", hexRgb(c.bg2));
		set("--dbtags-ac-border", c.border);
		set("--dbtags-ac-text", c.text);
		set("--dbtags-ac-sub", c.sub);
		set("--dbtags-ac-zh", c.sub);
		set("--dbtags-ac-summary", c.summary);
		set("--dbtags-ac-highlight", c.highlight);
		set("--dbtags-ac-selected", hexRgb(c.highlight) ? `rgba(${hexRgb(c.highlight)}, 0.18)` : null);
		set("--dbtags-ac-count", c.count);
		set("--dbtags-ac-fuzzy", c.fuzzy);
		set("--dbtags-ac-fuzzy-bg", hexRgb(c.fuzzy) ? `rgba(${hexRgb(c.fuzzy)}, 0.14)` : null);
	};
	if (theme === "custom") {
		applyColors(getCustomColors());
	} else if (isUserTheme) {
		const preset = findUserTheme(theme);
		if (preset && preset.colors) applyColors({ ...CUSTOM_DEFAULT, ...preset.colors });
	}
	const w = Config.getNum("width", 340);
	const f = Config.getNum("font", 13);
	const op = Math.min(100, Math.max(25, Config.getNum("opacity", 100)));
	root.style.setProperty("--dbtags-ac-width", w + "px");
	root.style.setProperty("--dbtags-ac-font", f + "px");
	root.style.setProperty("--dbtags-ac-alpha", String(op / 100));
	// backdrop-filter costs real compositing even under a fully opaque panel:
	// auto-disable at 100% opacity, plus a manual kill-switch at any opacity
	root.classList.toggle("dbtags-noblur", op >= 100 || Config.get("blur", "true") === "false");
	++_themeEpoch;
	root.style.setProperty("--dbtags-ac-row-height", Config.getNum("rowH", 26) + "px");
	root.classList.toggle("dbtags-ac-onlight", isLightHex(
		getComputedStyle(root).getPropertyValue("--dbtags-ac-bg"),
	));
	syncPerfFromConfig();
	hudSync();
	const fam = Config.get("fontFamily", "").replace(/"/g, "");
	root.style.setProperty("--dbtags-ac-family", fam ? `"${fam}", sans-serif` : "sans-serif");
}

function dlog(phase, ...args) {
	if (!DEBUG && localStorage.getItem(ID + ".debug") !== "true") return;
	console.log(`[dbtags][${phase}]`, ...args);
}

/* ---- global error capture (P7): tag our errors with context ---- */
function errBar(msg) {
	const bar = $el("div.dbtags-errbar", { textContent: "[dbtags] " + msg });
	document.body.appendChild(bar);
	setTimeout(() => bar.remove(), 6000);
}

window.addEventListener("error", (e) => {
	if (!String(e.message).includes("dbtags")) return;
	console.error(`[dbtags][E] uncaught:`, e.message);
	if (DEBUG) errBar(e.message);
});
window.addEventListener("unhandledrejection", (e) => {
	const msg = String(e.reason?.message ?? e.reason);
	if (!msg.includes("dbtags")) return;
	console.error(`[dbtags][E] unhandledrejection:`, e.reason);
	if (DEBUG) errBar(msg);
});

function hasCJK(s) {
	return /[\u4e00-\u9fff]/.test(s);
}

function listField(value) {
	return Array.isArray(value) ? value : [];
}

// cached by applyConfig(): every lang write funnels through #set()/import,
// which always re-apply config, so the cache can never go stale. hot-path
// readers (wikiText/buildItemRow) called this 100+ times per rendered list.
let _langZh = true;
function langIsZh() {
	return _langZh;
}

/* text shaping prefs (cached with lang below: every #set/import/reset runs
applyConfig, so these can never go stale) */
let _insNoUnder = false;
let _showNoUnder = false;
let _escParens = true;
let _hudOn = false;

/* name as shown in lists/panels; underscore->space keeps 1:1 char
positions, so highlight offsets computed on either form stay valid */
function dispName(name) {
	return _showNoUnder ? name.replace(/_/g, " ") : name;
}
/* the exact text written into the input box */
function insertable(name) {
	let s = _escParens ? name.replace(/[()]/g, (c) => "\\" + c) : name;
	if (_insNoUnder) s = s.replace(/_/g, " ");
	return s;
}

function aliasTableOn() {
	return Config.get("aliasTable", "true") !== "false";
}

function wikiText(tag) {
	if (langIsZh() && typeof tag.wiki_zh === "string" && tag.wiki_zh) return tag.wiki_zh;
	return tag.summary || "";
}

/* zh display name of a link target (English tag), "" when unknown */
function zhNameOf(target) {
	if (!index) return "";
	const t = getTagMap().get(normName(target));
	return (t && typeof t.zhtag === "string") ? t.zhtag : "";
}

/* label for a wiki link chip: zh mode -> {main: 中文, en: english},
   en mode (or no zh available) -> {main: label, en: ""} */
function linkLabel(target, disp) {
	const plain = (disp && disp.trim()) || target;
	if (!langIsZh()) return { main: plain, en: "" };
	const cn = (disp && hasCJK(disp)) ? disp.trim() : zhNameOf(target);
	if (!cn) return { main: plain, en: "" };
	return { main: cn, en: target };
}

/* ---- pinyin (build-time py field, positionally parallel to zhSources) ---- */
function pyMode() {
	return Config.get("pyMode", "zh-first");
}

/* the Chinese strings behind tag.py, in the exact order build_index.py used */
function zhSources(tag) {
	return [tag.zhtag, ...listField(tag.aliases_zh), ...listField(tag.zh)]
		.filter(Boolean);
}

function isSubsequence(term, str) {
	// every char of `term` appears in `str` in order (loose chinese match)
	let i = 0;
	for (const c of str) {
		if (term[i] === c) i++;
		if (i === term.length) return true;
	}
	return false;
}

function fmtCount(n) {
	if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
	if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K";
	return String(n);
}

const TYPE_RANK = { name: 0, alias: 1, zhtag: 2, aliases_zh: 3, zh: 4, fuzzy: 5 };

/* pinyin sits between name and alias (拼音结果靠前) or below everything
   (英文结果靠前); everything else keeps the static table */
function typeRank(mt) {
	if (mt === "py") return pyMode() === "zh-first" ? 0.5 : 6;
	return mt in TYPE_RANK ? TYPE_RANK[mt] : 7;
}

/* ---- candidate list limits (P10) ---- */
function applyLimit(results) {
	if (Config.get("mode", "limit") === "all") {
		// show everything (safety cap 500), report the true total
		return { list: results.slice(0, 500), total: results.length };
	}
	// limit mode: heat filter (minPost, 0 = off) AND count cap, both always active
	const minPc = Config.getNum("minPost", 500);
	const filtered = minPc > 0 ? results.filter((r) => r.tag.post_count >= minPc) : results;
	const cap = Config.getNum("maxCount", 50);
	return { list: filtered.slice(0, cap), total: filtered.length, dropped: results.length - filtered.length, minPc };
}

/* ---- wiki-body content search（正文子串匹配） ---- */
let bodyDocs = null; // lowercased "summary + wiki_zh" per tag (lang-independent)

function buildBodyDocs() {
	bodyDocs = index.tags.map((t) =>
		((t.summary || "") + "\n" + (t.wiki_zh || "")).replace(/\s+/g, " ").toLowerCase());
}

function bodySearch(term) {
	const q = term.trim().replace(/\s+/g, " ").toLowerCase();
	if (!q) return [];
	if (!bodyDocs) buildBodyDocs();
	if (q.length < (hasCJK(q) ? 2 : 3)) return [];
	const hits = [];
	for (let i = 0; i < bodyDocs.length; i++) {
		if (bodyDocs[i].includes(q)) {
			hits.push({ tag: index.tags[i], score: 1, snippet: null, matchType: "fuzzy" });
		}
	}
	hits.sort((a, b) => b.tag.post_count - a.tag.post_count);
	if (hits.length > 20) hits.length = 20;
	for (const h of hits) h.snippet = makeSnippet(wikiText(h.tag), [q]);
	return hits;
}

function makeSnippet(summary, toks) {
	const lower = summary.toLowerCase();
	for (const tok of toks) {
		const i = lower.indexOf(tok);
		if (i < 0) continue;
		const start = Math.max(0, i - 25);
		const end = Math.min(summary.length, i + tok.length + 25);
		return {
			text: ((start > 0 ? "…" : "") + summary.slice(start, end) + (end < summary.length ? "…" : "")).replace(/\[\[|\]\]/g, ""),
			hiStart: i - start + (start > 0 ? 1 : 0),
			hiEnd: i - start + tok.length + (start > 0 ? 1 : 0),
		};
	}
	return null;
}

/* ---- perf sampling (fully switchable; zero extra work while off) ---- */
const PERF_MAX = 300;
let PERF_ON = false;
let _lastSeg = null;
const _perfListeners = [];
function pr1(x) { return Math.round(x * 10) / 10; }
function perfNow() { return PERF_ON ? performance.now() : 0; }
function syncPerfFromConfig() {
	const on = Config.get("perf", "off") === "on";
	if (on === PERF_ON) return;
	PERF_ON = on;
	if (!on) { Perf.samples = []; _lastSeg = null; }
	for (const cb of _perfListeners.slice()) {
		try {
			cb();
		} catch {
			void 0;
		}
	}
}
const Perf = {
	samples: [],
	indexMs: 0,
	benchTerms: [
		"1girl",
		"cat girl",
		"long hair",
		"blue_eyes_undies_",
		"seka",
		"hatsune miku project diva 2",
	],
	on(cb) { _perfListeners.push(cb); },
	emit() {
		for (const cb of _perfListeners.slice()) {
			try {
				cb();
			} catch {
				void 0;
			}
		}
	},
	push(sample) {
		if (!PERF_ON) return;
		Perf.samples.push(sample);
		if (Perf.samples.length > PERF_MAX) Perf.samples.shift();
		Perf.emit();
	},
	stats(n = 50) {
		const arr = Perf.samples.slice(-n).map((x) => x.ms).sort((x, y) => x - y);
		if (!arr.length) return null;
		const q = (pp) => arr[Math.min(arr.length - 1, Math.floor(pp * arr.length))];
		return {
			n: arr.length,
			avg: arr.reduce((x, y) => x + y, 0) / arr.length,
			p50: q(0.5),
			p95: q(0.95),
			max: arr[arr.length - 1],
		};
	},
	segAvg(n = 50) {
		const ss = Perf.samples.slice(-n);
		if (!ss.length) return null;
		const out = {};
		for (const k of ["scan", "sort", "fuzzyBody"]) {
			const vals = ss.map((x) => x.seg?.[k]).filter((x) => typeof x === "number");
			out[k] = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
		}
		return out;
	},
	async benchmark(onProgress) {
		const out = [];
		for (const term of Perf.benchTerms) {
			const msArr = [];
			let hits = 0;
			for (let i = 0; i < 20; i++) {
				const t = performance.now();
				hits = runQuery(term, term.replace(/\s+/g, "_")).total;
				msArr.push(performance.now() - t);
				if (i % 5 === 4) await new Promise((res) => setTimeout(res, 0));
			}
			msArr.sort((x, y) => x - y);
			const q = (pp) => msArr[Math.min(msArr.length - 1, Math.floor(pp * msArr.length))];
			out.push({ term, hits, p50: q(0.5), p95: q(0.95), max: msArr[msArr.length - 1] });
			if (onProgress) onProgress(out.slice());
		}
		return out;
	},
};

/* precomputed per-tag match strings (built once after index load) */
let _mc = null;
function buildMatchCache() {
	_mc = index.tags.map((t) => {
		const alRaw = listField(t.aliases);
		const alLow = [];
		for (let i = 0; i < alRaw.length; i++) {
			alLow.push(typeof alRaw[i] === "string" ? alRaw[i].toLowerCase() : null);
		}
		return {
			ln: (typeof t.name === "string" ? t.name : "").toLowerCase(),
			alRaw,
			alLow,
			pys: listField(t.py),
			zh0: typeof t.zhtag === "string" ? t.zhtag : "",
			alzh: listField(t.aliases_zh),
			zhl: listField(t.zh),
		};
	});
}

function searchTags(term) {
	const _pt = perfNow();
	const t = term.trim().toLowerCase();
	if (!t) return [];
	if (!_mc) buildMatchCache();
	if (!PERF_ON) _lastSeg = null;
	const cjk = hasCJK(t);
	// config reads hoisted out of the 30k loop (was per-tag localStorage hits)
	const pyOn = !cjk && pyMode() !== "off";
	const q = t.replace(/\s+/g, "");
	const pyMin = pyOn ? Config.getNum("pyMinLen", 4) : 0;
	const aliasOn = aliasTableOn();
	const out = [];
	const tags = index.tags;
	for (let i = 0; i < tags.length; i++) {
		const c = _mc[i];
		let matchType = null;
		let matchText = null;
		if (c.ln.includes(t)) {
			matchType = "name";
			matchText = tags[i].name;
		}
		if (!matchType && !cjk) {
			for (let j = 0; j < c.alLow.length; j++) {
				const al = c.alLow[j];
				if (al !== null && al.includes(t)) {
					matchType = "alias";
					matchText = c.alRaw[j];
					break;
				}
			}
		}
		if (!matchType && pyOn && q.length >= pyMin) {
			const pys = c.pys;
			for (let j = 0; j < pys.length; j++) {
				if (typeof pys[j] === "string" && pys[j].includes(q)) {
					matchType = "py";
					matchText = zhSources(tags[i])[j] || pys[j];
					break;
				}
			}
		}
		if (!matchType && cjk) {
			// loose chinese match: translated names first; the new-lib alias
			// table (aliases_zh from translations.jsonl) can be toggled off.
			// Japanese source aliases are NOT scanned for cjk queries.
			if (c.zh0 && isSubsequence(t, c.zh0)) {
				matchType = "zhtag";
				matchText = c.zh0;
			} else if (aliasOn) {
				const groups = [c.alzh, c.zhl];
				const kinds = ["aliases_zh", "zh"];
				for (let g = 0; g < 2 && !matchType; g++) {
					const values = groups[g];
					for (let j = 0; j < values.length; j++) {
						const z = values[j];
						if (typeof z !== "string") continue;
						if (isSubsequence(t, z)) {
							matchType = kinds[g];
							matchText = z;
							break;
						}
					}
				}
			}
		}
		if (matchType) out.push({ tag: tags[i], matchType, matchText, ln: c.ln });
	}
	const _ts = perfNow();
	for (const e of out) e.mtl = (e.matchText || "").toLowerCase();
	out.sort((a, b) => {
		// exact match first (term equals name or the matched alias/zh)
		const ea = a.ln === t || a.mtl === t ? 0 : 1;
		const eb = b.ln === t || b.mtl === t ? 0 : 1;
		if (ea !== eb) return ea - eb;
		const pa = a.ln.startsWith(t) ? 0 : 1;
		const pb = b.ln.startsWith(t) ? 0 : 1;
		if (pa !== pb) return pa - pb;
		const ra = typeRank(a.matchType);
		const rb = typeRank(b.matchType);
		if (ra !== rb) return ra - rb;
		return b.tag.post_count - a.tag.post_count;
	});
	if (PERF_ON) _lastSeg = { scan: _ts - _pt, sort: perfNow() - _ts };
	return out;
}

/* ---- caret helper (reused mirror div to avoid per-keystroke DOM churn) ---- */
let _caretMirror = null;
let _caretSpan = null;

function getCaretCoordinates(el, position) {
	const computed = getComputedStyle(el);
	if (!_caretMirror) {
		_caretMirror = document.createElement("div");
		_caretMirror.id = "dbtags-caret-mirror";
		_caretMirror.style.position = "absolute";
		_caretMirror.style.visibility = "hidden";
		_caretMirror.style.whiteSpace = "pre-wrap";
		_caretMirror.style.wordWrap = "break-word";
		_caretMirror.style.overflow = "hidden";
		// structure: [text node: before-caret text][span: after-caret text]
		_caretMirror.appendChild(document.createTextNode(""));
		_caretSpan = document.createElement("span");
		_caretMirror.appendChild(_caretSpan);
		document.body.appendChild(_caretMirror);
	}
	const st = _caretMirror.style;
	const isInput = el.nodeName === "INPUT";
	st.width = computed.width;
	st.boxSizing = computed.boxSizing;
	st.fontFamily = computed.fontFamily;
	st.fontSize = computed.fontSize;
	st.fontWeight = computed.fontWeight;
	st.fontStyle = computed.fontStyle;
	st.fontVariant = computed.fontVariant;
	st.letterSpacing = computed.letterSpacing;
	st.wordSpacing = computed.wordSpacing;
	st.textAlign = computed.textAlign;
	st.textIndent = computed.textIndent;
	st.textTransform = computed.textTransform;
	st.tabSize = computed.tabSize;
	st.borderTopWidth = computed.borderTopWidth;
	st.borderRightWidth = computed.borderRightWidth;
	st.borderBottomWidth = computed.borderBottomWidth;
	st.borderLeftWidth = computed.borderLeftWidth;
	st.borderStyle = computed.borderStyle;
	st.paddingTop = computed.paddingTop;
	st.paddingRight = computed.paddingRight;
	st.paddingBottom = computed.paddingBottom;
	st.paddingLeft = computed.paddingLeft;
	if (isInput) {
		const h = parseInt(computed.height);
		const outer = parseInt(computed.paddingTop) + parseInt(computed.paddingBottom) +
			parseInt(computed.borderTopWidth) + parseInt(computed.borderBottomWidth);
		const target = outer + parseInt(computed.lineHeight);
		st.lineHeight = h > target ? h - outer + "px" : h === target ? computed.lineHeight : "0";
	} else {
		st.lineHeight = computed.lineHeight;
	}
	let text = el.value.substring(0, position);
	if (isInput) text = text.replace(/\s/g, "\u00a0");
	_caretMirror.firstChild.textContent = text;
	_caretSpan.textContent = el.value.substring(position) || ".";
	return {
		top: _caretSpan.offsetTop + parseInt(computed.borderTopWidth || 0),
		left: _caretSpan.offsetLeft + parseInt(computed.borderLeftWidth || 0),
		height: parseInt(computed.lineHeight) || 20,
	};
}

class CaretHelper {
	constructor(el, getScale) {
		this.el = el;
		this.getScale = getScale;
	}
	#offset() {
		const rect = this.el.getBoundingClientRect();
		return { top: rect.top + window.pageYOffset, left: rect.left + window.pageXOffset };
	}
	getCursorOffset() {
		const scale = this.getScale();
		const off = this.#offset();
		const pos = getCaretCoordinates(this.el, this.el.selectionEnd);
		return {
			top: off.top - this.el.scrollTop * scale + (pos.top + pos.height) * scale,
			left: off.left - this.el.scrollLeft + pos.left,
		};
	}
	getBeforeCursor() {
		return this.el.selectionStart !== this.el.selectionEnd
			? null
			: this.el.value.substring(0, this.el.selectionEnd);
	}
	getAfterCursor() {
		return this.el.value.substring(this.el.selectionEnd);
	}
	insertAtCursor(value, offset) {
		const startPos = this.el.selectionStart;
		this.el.selectionStart = this.el.selectionStart + offset;
		let pasted = true;
		try {
			if (!document.execCommand("insertText", false, value)) pasted = false;
		} catch (e) {
			pasted = false;
		}
		if (!pasted) {
			this.el.setRangeText(value, this.el.selectionStart, this.el.selectionEnd, "end");
		}
		this.el.selectionStart = this.el.selectionEnd = startPos + value.length + offset;
		this.el.focus();
	}
}

/* ---- autocomplete overlay (list + info panel) ---- */
const AC_INSTANCES = new Set(); // live completions, for settings-driven refresh
let _activeAC = null; // the instance whose popup showed last (wiki-add target)

/* drop instances whose input left the document (node removed / workflow swap) */
function reapDetachedInstances() {
	for (const ac of [...AC_INSTANCES]) {
		try {
			if (!ac.el.isConnected) ac.destroy();
		} catch {
			void 0;
		}
	}
}

/* refresh every live instance; detached ones get reaped instead */
function refreshAllInstances() {
	for (const ac of [...AC_INSTANCES]) {
		try {
			if (!ac.el.isConnected) {
				ac.destroy();
				continue;
			}
			ac.refreshPrefs();
		} catch (e) {
			console.error("[dbtags] refreshPrefs failed:", e);
		}
	}
}

/* shared query pipeline (real popup + styler lab use this exact path) */
function runQuery(term, word) {
	const t0 = performance.now();
	const _pt0 = PERF_ON ? t0 : 0;
	let results = searchTags(word);
	const _tSearch = PERF_ON ? performance.now() : 0;
	let isFuzzy = false;
	const fuzzyMode = Config.get("fuzzy", "always");
	if (fuzzyMode !== "off") {
		const shouldFuzzy = fuzzyMode === "always" ||
			(!results.length && fuzzyMode === "fallback");
		if (shouldFuzzy) {
			const hits = bodySearch(term);
			if (results.length > 0 && fuzzyMode === "always") {
				const seen = new Set(results.map((r) => r.tag.name));
				for (const h of hits) {
					if (results.length >= 30) break;
					if (seen.has(h.tag.name)) continue;
					seen.add(h.tag.name);
					results.push(h);
					isFuzzy = true;
				}
			} else if (hits.length) {
				results = hits;
				isFuzzy = true;
			}
		}
	}
	if (PERF_ON) {
		const tEnd = performance.now();
		Perf.push({
			term,
			ms: pr1(tEnd - _pt0),
			hits: results.length,
			fuzzy: isFuzzy,
			seg: {
				scan: pr1(_lastSeg?.scan ?? 0),
				sort: pr1(_lastSeg?.sort ?? 0),
				fuzzyBody: pr1(tEnd - _tSearch),
			},
		});
	}
	dlog("D", `search "${term}" -> ${results.length}${isFuzzy ? " (body)" : ""} hits, ${Math.round((performance.now() - t0) * 10) / 10}ms`);
	if (!results.length) return { list: [], total: 0 };
	const lim = applyLimit(results);
	return { ...lim, isFuzzy };
}

/* one candidate row (no event wiring: caller adds onclick/hover) */
function buildItemRow(item, word) {
	const { tag, matchType, matchText, snippet } = item;
	const parts = [];
	if (matchType === "name") {
		const disp = dispName(tag.name);
		const needle = _showNoUnder ? word.replace(/_/g, " ") : word;
		const pos = disp.toLowerCase().indexOf(needle);
		parts.push(
			$el(
				"span.dbtags-ac-name",
				{},
				[
					$el("span", { textContent: disp.substr(0, pos) }),
					$el("span.dbtags-ac-highlight", { textContent: disp.substr(pos, needle.length) }),
					$el("span", { textContent: disp.substr(pos + needle.length) }),
				]
			)
		);
	} else {
		parts.push($el("span.dbtags-ac-name", { textContent: dispName(tag.name) }));
	}
	parts.push($el("span.dbtags-ac-count", { textContent: fmtCount(tag.post_count), title: String(tag.post_count) }));
	if (matchType === "fuzzy" && snippet) {
		const s = $el("span.dbtags-ac-snippet", { title: wikiText(tag).replace(/\[\[|\]\]/g, "") });
		if (snippet.hiStart != null && snippet.hiStart >= 0) {
			s.append(
				snippet.text.slice(0, snippet.hiStart),
				$el("span.dbtags-ac-snippet-hit", {
					textContent: snippet.text.slice(snippet.hiStart, snippet.hiEnd),
				}),
				snippet.text.slice(snippet.hiEnd)
			);
		} else {
			s.textContent = snippet.text;
		}
		parts.push(s);
	} else if (langIsZh()) {
		const ZH_HIT = { zhtag: "译名", aliases_zh: "新库别名", zh: "源站别名", py: "拼音命中" };
		const primary = tag.zhtag || listField(tag.aliases_zh)[0] || listField(tag.zh)[0] || "";
		parts.push($el("span.dbtags-ac-zh", { textContent: primary }));
		if (ZH_HIT[matchType] && matchText && matchText !== primary) {
			parts.push($el("span.dbtags-ac-zh-src", { textContent: ` ${matchText}`, title: `命中来源：${ZH_HIT[matchType]}` }));
		}
	}
	return $el("div.dbtags-ac-item" + (matchType === "fuzzy" ? ".dbtags-ac-item--fuzzy" : ""), {}, parts);
}

class DBTagsAutoComplete {
	constructor(el, widget) {
		this.el = el;
		this.widget = widget ?? null;
		this.helper = new CaretHelper(el, () => app.canvas.ds.scale);
		AC_INSTANCES.add(this);
		this.showSummary = Config.get("showSummary", "true") !== "false";
		this.showImage = Config.get("showImage", "true") !== "false";
		this.showLinks = Config.get("showLinks", "true") !== "false";
		this.showWiki = Config.get("showWiki", "true") !== "false";
		this.panelImg = Config.get("panelImg", "false") !== "false";
		this.list = $el("div.dbtags-ac-list");
		this.panelStack = $el("div.dbtags-ac-panelstack");
		this.mainPanel = this.#createPanel(false);
		this.navPanels = [];
		this.panelStack.append(this.mainPanel.el);
		this.wrap = $el("div.dbtags-ac-wrap", {}, [this.list, this.panelStack]);
		this.#syncPanelMode();
		if (!this.showWiki || _hudOn) this.panelStack.style.display = "none";
		this.selected = null;
		this.current = [];
		this._addedTags = new Set();
		this._previewEl = null;
		this._previewTimer = null;
		this._toastEl = null;
		this._toastTimer = null;
		this._hKeydown = this.#onKeyDown.bind(this);
		this._hKeyup = this.#onKeyUp.bind(this);
		this._hClick = this.#hide.bind(this);
		this._hBlur = () =>
			setTimeout(() => {
				// keep open when the click landed inside our own UI (toggles, image, HUD)
				if (this._lastDownTarget && (this.wrap.contains(this._lastDownTarget) || this._lastDownTarget.closest?.(".dbtags-ac-hud, .dbtags-ac-hud-ball"))) return;
				this.#hide();
			}, 150);
		this._hDocDown = this.#onDocDown.bind(this);
		this.el.addEventListener("keydown", this._hKeydown);
		this.el.addEventListener("keyup", this._hKeyup);
		this.el.addEventListener("click", this._hClick);
		this.el.addEventListener("blur", this._hBlur);
		document.addEventListener("mousedown", this._hDocDown);
	}

	destroy() {
		AC_INSTANCES.delete(this);
		if (_activeAC === this) _activeAC = null;
		clearTimeout(this._bodyTimer);
		this._bodyTimer = null;
		clearTimeout(this._previewTimer);
		this._previewTimer = null;
		this._previewEl?.remove();
		this._previewEl = null;
		this.el.removeEventListener("keydown", this._hKeydown);
		this.el.removeEventListener("keyup", this._hKeyup);
		this.el.removeEventListener("click", this._hClick);
		this.el.removeEventListener("blur", this._hBlur);
		document.removeEventListener("mousedown", this._hDocDown);
		this.#closeImageCard();
		this.wrap?.remove();
	}

	#createPanel(isNav) {
		const p = { el: $el("div.dbtags-ac-panel"), tag: null, _imgTimer: null };
		p.head = $el("div.dbtags-ac-panel-head");
		p.title = $el("div.dbtags-ac-panel-title");
		p.insert = $el("span.dbtags-ac-plus", {
			textContent: "+",
			title: "插入当前 tag 到输入框",
			onclick: (e) => {
				e.stopPropagation();
				if (p.tag) this.insertWikiTag(p.tag.name, p.insert);
			},
		});
		p.head.append(p.title, p.insert);
		if (isNav) {
			// nav panels have a close button (closes this panel and everything right of it)
			p.close = $el("button.dbtags-ac-close", {
				textContent: "×",
				title: "关闭此栏",
				onclick: (e) => {
					e.stopPropagation();
					this.#closeNavAt(p);
				},
			});
			p.head.append(p.close);
		}
		p.summary = $el("div.dbtags-ac-panel-summary");
		p.links = $el("div.dbtags-ac-panel-links");
		p.img = $el("img.dbtags-ac-panel-img");
		p.el.append(p.head, p.summary, p.links, p.img);
		return p;
	}

	#renderPanel(p, tag, hl) {
		if (!tag || _hudOn) return; // HUD mode: the floating window owns the wiki content
		p.tag = tag;
		p.title.textContent = `${dispName(tag.name)}  ${fmtCount(tag.post_count)}`;
		p.insert.textContent = this._addedTags.has(tag.name) ? "✓" : "+";
		if (this.showSummary) {
			this.#renderSummary(p, wikiText(tag) || "(无 wiki 正文)", hl || this._highlightTerms);
			p.summary.style.display = "";
		} else {
			p.summary.style.display = "none";
		}
		if (this.showLinks) {
			this.#renderLinks(p, tag);
		} else {
			p.links.replaceChildren();
			p.links.style.display = "none";
		}
		clearTimeout(p._imgTimer);
		if (this.showWiki) {
			p._imgTimer = setTimeout(() => this.#loadImage(p, tag), 120);
		} else {
			p.img.onload = p.img.onerror = null;
			p.img.onmouseenter = null;
			p.img.onmouseleave = null;
			p.img.src = "";
			p.img.style.display = "none";
		}
	}

	/* pull all panel prefs from storage and apply live (settings onChange path) */
	refreshPrefs() {
		const lang = Config.get("lang", "zh");
		const langChanged = this._lastLang !== lang;
		this._lastLang = lang;
		this.showSummary = Config.get("showSummary", "true") !== "false";
		this.showImage = Config.get("showImage", "true") !== "false";
		this.showLinks = Config.get("showLinks", "true") !== "false";
		this.showWiki = Config.get("showWiki", "true") !== "false";
		this.panelImg = Config.get("panelImg", "false") !== "false";
		this.panelStack.style.display = this.showWiki && !_hudOn ? "" : "none";
		this.#syncPanelMode();
		if (this.selected) this.#renderPanel(this.mainPanel, this.selected.tag);
		if (this.showWiki && this.#visible()) this.#place();
		// language switch swaps the wiki text under the same query term: rebuild
		// the open list + panel or stale zh snippets/zh column remain (wrong
		// highlight positions) and the panel cannot find the old-language term
		if (langChanged && this.#visible() && this.#token()) this.#update();
	}

	/* image-priority (old fixed quotas) vs text-priority (flex) panel layout */
	#syncPanelMode() {
		this.wrap.classList.toggle("dbtags-ac-imgprior", this.panelImg);
	}

	#renderLinks(p, tag) {
		p.links.replaceChildren();
		const links = tag.links || [];
		if (!links.length) {
			p.links.style.display = "none";
			return;
		}
		p.links.style.display = "";
		for (const l of links) {
			const lab = linkLabel(l.n, l.t);
			const cap = $el("span.dbtags-ac-link" + (this._addedTags.has(l.n) ? ".dbtags-ac-link--added" : ""), { title: l.n });
			const plus = $el("span.dbtags-ac-plus", {
				textContent: this._addedTags.has(l.n) ? "✓" : "+",
				title: "添加（光标处未完成的搜索词会被顶替）",
				onclick: (e) => {
					e.stopPropagation();
					this.insertWikiTag(l.n, plus);
				},
			});
			cap.append(plus, lab.main);
			if (lab.en) cap.append($el("span.dbtags-ac-link-en", { textContent: ` (${lab.en})` }));
			cap.addEventListener("click", (e) => {
				e.stopPropagation();
				if (e.ctrlKey || e.metaKey) this.insertWikiTag(l.n, plus);
				else this.#navTo(l.n);
			});
			cap.addEventListener("mouseenter", (e) => this.#showPreview(l.n, e));
			cap.addEventListener("mouseleave", () => this.#hidePreview());
			p.links.append(cap);
		}
	}

	/* quick-add (panel + buttons, HUD +, Ctrl/Cmd-click on any wiki link):
	a half-typed SEARCH FRAGMENT at the caret (e.g. 枪) is junk once a real
	tag is picked, so the add REPLACES it; but when the caret word is itself
	an existing tag (e.g. gun) the user meant it -> insert before it.
	plusEl = the chip to tick when given. */
	insertWikiTag(name, plusEl) {
		const caret = this.el.selectionStart;
		const before = this.el.value.substring(0, caret);
		const m = before.match(/([^,;"|{}()\n]+)$/);
		let tokenStart = m ? caret - m[0].length : caret;
		if (m) {
			// skip leading whitespace of the token so we insert right before the word
			const lead = m[0].match(/^\s+/);
			if (lead) tokenStart += lead[0].length;
		}
		const tokenRaw = this.el.value.slice(tokenStart, caret);
		const realTag = !!tokenRaw && !!index && getTagMap().has(normName(tokenRaw));
		const selEnd = tokenRaw && !realTag ? caret : tokenStart;
		const prevChar = before[tokenStart - 1];
		const sep = prevChar === " " || prevChar === "\t" ? ", " : ",";
		const ins = insertable(name) + sep;
		this.el.selectionStart = tokenStart;
		this.el.selectionEnd = selEnd;
		let pasted = true;
		try {
			if (!document.execCommand("insertText", false, ins)) pasted = false;
		} catch (e) {
			pasted = false;
		}
		if (!pasted) {
			this.el.setRangeText(ins, tokenStart, selEnd, "end");
		}
		this.el.selectionStart = this.el.selectionEnd = tokenStart + ins.length;
		this.el.focus();
		this.#sync();
		dlog("D", "insert ahead", name, "->", this.el.value);
		if (!plusEl) return;
		// mark as added (visited style) + short "已添加" hint, keep the panel open
		this._addedTags.add(name);
		plusEl.textContent = "✓";
		const cap = plusEl.closest(".dbtags-ac-link");
		if (cap) cap.classList.add("dbtags-ac-link--added");
		const tip = $el("span.dbtags-ac-added-tip", { textContent: "已添加" });
		plusEl.after(tip);
		setTimeout(() => tip.remove(), 1500);
	}

	#renderSummary(p, text, hl) {
		renderWikiBody(p.summary, text, hl || [], {
			onLink: (t, e) => {
				if (e && (e.ctrlKey || e.metaKey)) this.insertWikiTag(t);
				else this.#navTo(t);
			},
			onHover: (t, e) => (t ? this.#showPreview(t, e) : this.#hidePreview()),
		});
	}

	#loadImage(p, tag) {
		if (p.tag !== tag) return; // panel moved on meanwhile
		if (!this.showImage || !tag.images.length) {
			p.img.onload = p.img.onerror = null;
			p.img.onmouseenter = null;
			p.img.onmouseleave = null;
			p.img.onclick = null;
			p.img.src = "";
			p.img.style.display = "none";
			return;
		}
		const mode = Config.get("imgMode", "large");
		const base = `/dbtags/image?tag=${encodeURIComponent(tag.name)}&v=${VERSION}&size=`;
		const setSrc = (size) => {
			p.img.onload = () => { p.img.style.display = ""; };
			p.img.onerror = () => { p.img.style.display = "none"; };
			p.img.src = base + size;
		};
		p.img.onmouseenter = () => this.#imgHoverIn(tag, p.img);
		p.img.onmouseleave = () => this.#imgHoverOut();
		p.img.onclick = () => this.#openImageCard(tag, p.img);
		setSrc(mode === "small" ? "small" : "large");
	}

	#token() {
		const before = this.helper.getBeforeCursor();
		if (!before?.length) return null;
		const m = before.match(/([^,;"|{}()\n]+)$/);
		if (!m) return null;
		const raw = m[0].replace(/^\s+/, "");
		if (!raw) return null;
		// word: spaces -> underscores, used for tag-name matching
		// raw: original text kept for phrase/wiki matching
		return { raw, word: raw.replace(/\s/g, "_") };
	}

	#visible() {
		return this.wrap.isConnected && this.wrap.style.display !== "none";
	}

	#onKeyDown(e) {
		if (e.isComposing) return; // IME candidate stage owns the keys
		if (!this.#visible()) {
			// HUD 留空窗: the candidate popup is hidden but a list is still loaded,
			// so [ ] must keep moving the browsing position (the popup-visible gate
			// below would otherwise swallow them). Intercept ONLY the brackets —
			// arrows/caret keys stay native to the input in this state.
			if (_hudOn && this.current && this.current.length
				&& (e.key === "[" || e.key === "]")
				&& Config.get("bracketNav", "true") !== "false") {
				e.preventDefault();
				this.#move(e.key === "[" ? -1 : 1);
			}
			return;
		}
		switch (e.key) {
			case "ArrowUp":
				e.preventDefault();
				this.#move(-1);
				break;
			case "ArrowDown":
				e.preventDefault();
				this.#move(1);
				break;
			case "Home":
				e.preventDefault();
				if (this.current.length) this.#setSelected(this.current[0], true);
				break;
			case "End":
				e.preventDefault();
				if (this.current.length) this.#setSelected(this.current[this.current.length - 1], true);
				break;
			case "PageUp":
				e.preventDefault();
				this.#move(-8);
				break;
			case "PageDown":
				e.preventDefault();
				this.#move(8);
				break;
			case "[":
			case "]":
				// bracket nav: [ = up, ] = down (setting-off restores plain typing)
				if (Config.get("bracketNav", "true") === "false") break;
				e.preventDefault();
				this.#move(e.key === "[" ? -1 : 1);
				break;
			case "Tab":
				e.preventDefault();
				this.#insert();
				break;
			case "Enter":
				if (!e.ctrlKey) {
					e.preventDefault();
					this.#insert();
				}
				break;
		}
	}

	#onDocDown(e) {
		this._lastDownTarget = e.target;
		if (this._imgCard && !this._imgCard.contains(e.target)) this.#closeImageCard();
		// clicks on the persistent HUD (and its body bubble) must not close the popup
		if (e.target.closest && e.target.closest(".dbtags-ac-hud")) return;
		if (this.#visible() && !this.wrap.contains(e.target)) {
			this.#hide();
		}
	}

	#onKeyUp(e) {
		if (this.#visible() && e.key === "Escape") {
			e.preventDefault();
			if (this.navPanels.length) {
				// close the rightmost wiki panel first, hide on the next Escape
				this.#closeRightmost();
				return;
			}
			this.#hide();
			return;
		}
		if (e.key.length > 1 && e.key !== "Delete" && e.key !== "Backspace") {
			return;
		}
		// bracket nav eats the keydown; keyup must not re-run #update (it resets to first item)
		if ((e.key === "[" || e.key === "]") && Config.get("bracketNav", "true") !== "false") {
			return;
		}
		this.#scheduleUpdate();
	}

	#scheduleUpdate(delay = 80) {
		clearTimeout(this._updateTimer);
		this._updateTimer = setTimeout(() => this.#update(), delay);
	}

	#move(dir) {
		if (!this.current.length) return;
		let idx = this.selected ? this.current.indexOf(this.selected) : -1;
		idx = (idx + dir + this.current.length) % this.current.length;
		this.#setSelected(this.current[idx], true);
	}

	#setSelected(item, scrollTo = false) {
		if (this.selected) this.selected.el.classList.remove("dbtags-ac-item--selected");
		this.selected = item;
		this.selected.el.classList.add("dbtags-ac-item--selected");
		if (scrollTo) {
			// manual list scroll: scrollIntoView({inline}) horizontally scrolls the
			// whole document when the popup overflows the viewport (eats the left edge)
			const el = this.selected.el;
			const top = el.offsetTop;
			const bottom = top + el.offsetHeight;
			if (top < this.list.scrollTop) {
				this.list.scrollTop = top;
			} else if (bottom > this.list.scrollTop + this.list.clientHeight) {
				this.list.scrollTop = bottom - this.list.clientHeight;
			}
		}
		// main panel always follows the selected candidate; nav panels are independent
		this.#renderPanel(this.mainPanel, item.tag);
		hudFollow(item.tag, this._highlightTerms);
	}

	/* ---- wiki navigation (P14): A = expand panels to the right, B = replace ---- */
	#navTo(name) {
		if (_hudOn) {
			_hud?.navigate(name); // HUD replaces the panel: navigation goes to the floating window
			return;
		}
		if (!this.showWiki) return;
		const tag = getTagMap().get(normName(name));
		if (!tag) {
			// not in the local database -> notify
			this.#showToast(name, "该 tag 未收录本地数据库");
			return;
		}
		const mode = Config.get("navMode", "A");
		let panel;
		if (mode === "B") {
			// B mode: clicking a link replaces the current nav panel (keep one)
			while (this.navPanels.length > 1) this.#closeRightmost();
			if (this.navPanels.length) {
				panel = this.navPanels[0];
			} else {
				panel = this.#createPanel(true);
				this.navPanels.push(panel);
				this.panelStack.append(panel.el);
			}
		} else {
			// A mode: open a new panel to the right (depth cap 3)
			if (this.navPanels.length >= 3) {
				panel = this.navPanels[this.navPanels.length - 1];
			} else {
				panel = this.#createPanel(true);
				this.navPanels.push(panel);
				this.panelStack.append(panel.el);
			}
		}
		this.#renderPanel(panel, tag, [name]);
		this.panelStack.scrollLeft = this.panelStack.scrollWidth;
		this.#place();
	}

	#closeNavAt(panel) {
		const idx = this.navPanels.indexOf(panel);
		if (idx < 0) return;
		const removed = this.navPanels.splice(idx);
		for (const p of removed) {
			p.el.remove();
		}
		this.#place();
	}

	#closeRightmost() {
		if (!this.navPanels.length) return;
		const p = this.navPanels.pop();
		p.el.remove();
		this.#place();
	}

	#showPreview(name, event) {
		this.#hidePreview();
		// currentTarget is nulled by the browser once dispatch ends: capture the
		// anchor synchronously or the delayed read throws and the preview never
		// shows (and bail if the row was re-rendered away before the timer)
		const anchor = event.currentTarget || event.target;
		this._previewTimer = setTimeout(() => {
			this._previewTimer = null;
			if (!anchor || !anchor.isConnected) return;
			const tag = getTagMap().get(normName(name));
			if (!tag) return;
			if (!this._previewEl) {
				this._previewEl = $el("div.dbtags-ac-preview");
				document.body.append(this._previewEl);
			}
			this._previewEl.replaceChildren(
				$el("div.dbtags-ac-preview-title", { textContent: `${dispName(tag.name)}  ${fmtCount(tag.post_count)}` }),
				$el("div.dbtags-ac-preview-text", {
					textContent: wikiText(tag)
						? wikiText(tag).replace(/\[\[|\]\]/g, "").slice(0, 100) + (wikiText(tag).length > 100 ? "…" : "")
						: "(无 wiki 正文)",
				})
			);
			const r = anchor.getBoundingClientRect();
			this._previewEl.style.left = r.right + 10 + "px";
			this._previewEl.style.top = r.top + "px";
			this._previewEl.style.display = "";
		}, 250);
	}

	#hidePreview() {
		clearTimeout(this._previewTimer);
		this._previewTimer = null;
		if (this._previewEl) this._previewEl.style.display = "none";
	}

	#imgHoverIn(tag, img) {
		clearTimeout(this._imgCloseTimer);
		this._imgCloseTimer = null;
		if (this._imgHoverTimer) return;
		this._imgHoverTimer = setTimeout(() => {
			this._imgHoverTimer = null;
			this.#openImageCard(tag, img);
		}, 180);
	}

	#imgHoverOut() {
		clearTimeout(this._imgHoverTimer);
		this._imgHoverTimer = null;
		if (this._imgCard && !this._imgCloseTimer) {
			this._imgCloseTimer = setTimeout(() => {
				this._imgCloseTimer = null;
				this.#closeImageCard();
			}, 260);
		}
	}

	#openImageCard(tag, anchor) {
		this.#closeImageCard();
		const url = `/dbtags/image?tag=${encodeURIComponent(tag.name)}&v=${VERSION}&size=large`;
		const img = $el("img.dbtags-ac-imgcard-img", { src: url });
		img.onerror = () => this.#closeImageCard();
		const card = $el("div.dbtags-ac-imgcard", {}, [
			$el("div.dbtags-ac-imgcard-head", [
				$el("div.dbtags-ac-imgcard-title", { textContent: `${tag.name}  ${fmtCount(tag.post_count)}` }),
				$el("span.dbtags-ac-imgcard-x", { textContent: "×", onclick: () => this.#closeImageCard() }),
			]),
			img,
		]);
		card.onmouseenter = () => {
			clearTimeout(this._imgCloseTimer);
			this._imgCloseTimer = null;
		};
		card.onmouseleave = () => this.#imgHoverOut();
		document.body.append(card);
		this._imgCard = card;
		this.#placeImageCard(card, anchor);
		img.onload = () => {
			if (this._imgCard === card) this.#placeImageCard(card, anchor);
		};
		this._cardKey = (e) => {
			if (e.key === "Escape") this.#closeImageCard();
		};
		document.addEventListener("keydown", this._cardKey, true);
	}

	#placeImageCard(card, anchor) {
		const r = anchor.getBoundingClientRect();
		const cw = card.offsetWidth;
		const ch = card.offsetHeight;
		let left = r.right + 8;
		if (left + cw > innerWidth - 8) left = r.left - 8 - cw;
		if (left < 8) left = 8;
		card.style.left = left + "px";
		card.style.top = Math.min(Math.max(r.top, 8), Math.max(8, innerHeight - ch - 8)) + "px";
	}

	#closeImageCard() {
		clearTimeout(this._imgHoverTimer);
		clearTimeout(this._imgCloseTimer);
		this._imgHoverTimer = null;
		this._imgCloseTimer = null;
		this._imgCard?.remove();
		this._imgCard = null;
		if (this._cardKey) {
			document.removeEventListener("keydown", this._cardKey, true);
			this._cardKey = null;
		}
	}

	#showToast(title, text) {
		// independent element so mouseleave of the link can't close it
		clearTimeout(this._previewTimer);
		if (this._previewEl) this._previewEl.style.display = "none";
		if (!this._toastEl) {
			this._toastEl = $el("div.dbtags-ac-preview");
			document.body.append(this._toastEl);
		}
		this._toastEl.replaceChildren(
			$el("div.dbtags-ac-preview-title", { textContent: title }),
			$el("div.dbtags-ac-preview-text", { textContent: text })
		);
		const r = this.wrap.getBoundingClientRect();
		this._toastEl.style.left = (r.right + 10) + "px";
		this._toastEl.style.top = (r.top + 10) + "px";
		this._toastEl.style.display = "";
		clearTimeout(this._toastTimer);
		this._toastTimer = setTimeout(() => {
			if (this._toastEl) this._toastEl.style.display = "none";
		}, 1800);
	}

	/* programmatic inserts only update the DOM; the frontend may sync
	   widget.value (what gets serialized on queue) solely on blur/change,
	   leaving the old text to re-appear on run. mirror it immediately. */
	#sync() {
		const v = this.el.value;
		const w = this.widget;
		if (w && w.value !== v) {
			w.value = v;
			w.callback?.(v, app.canvas, w.node);
		}
		this.el.dispatchEvent(new Event("input", { bubbles: true }));
		this.el.dispatchEvent(new Event("change", { bubbles: true }));
	}

	#insert() {
		if (!this.selected) return;
		const tag = this.selected.tag;
		const token = this.#token();
		const after = this.helper.getAfterCursor();
		const sep = !after.trim().startsWith(SEPARATOR.trim()) ? SEPARATOR : "";
		const t0 = performance.now();
		this.helper.insertAtCursor(insertable(tag.name) + sep, -(token?.raw.length ?? 0));
		this.#sync();
		dlog("D", "insert", tag.name, "token was", token?.raw, "耗时", Math.round(performance.now() - t0) + "ms");
		hudTyped(tag);
		this.#hide();
		setTimeout(() => this.#update(), 120);
	}

	async #update() {
		// amortized zombie reaping (every 8th popup update, one instance does it
		// for the whole registry)
		this._reapTick = (this._reapTick || 0) + 1;
		if (this._reapTick % 8 === 0) reapDetachedInstances();
		const token = this.#token();
		if (!token) {
			this.#hide();
			return;
		}
		if (!index) {
			// still loading: queue one retry for when it lands (typing also re-fires)
			if (!this._idxWaitQueued) {
				this._idxWaitQueued = true;
				onIndexReady(() => {
					this._idxWaitQueued = false;
					this.#scheduleUpdate(0);
				});
			}
			return;
		}
		// legacy '[' brackets are ignored (phrase-exact mode removed); search is plain substring now
		const term = token.raw.replace(/\[|\]/g, "").trim();
		const word = term.replace(/\s+/g, "_");
		// terms used to highlight matches in the wiki panel
		this._highlightTerms = term ? [term] : [];
		this._querySeq = (this._querySeq || 0) + 1;
		const seq = this._querySeq;
		clearTimeout(this._bodyTimer);
		this._bodyTimer = null;
		// phase 1: field scan only — the far more expensive body scan waits
		// for a typing pause (see #bodyPass)
		const t0 = performance.now();
		const results = searchTags(word);
		if (PERF_ON) {
			Perf.push({
				term,
				ms: pr1(performance.now() - t0),
				hits: results.length,
				fuzzy: false,
				seg: { scan: pr1(_lastSeg?.scan ?? 0), sort: pr1(_lastSeg?.sort ?? 0), fuzzyBody: 0 },
			});
		}
		this._baseResults = results;
		const fuzzyMode = Config.get("fuzzy", "always");
		const wantBody = !!term && fuzzyMode !== "off"
			&& (fuzzyMode === "always" || !results.length);
		this._bodyPending = wantBody;
		dlog("D", `search "${term}" -> ${results.length} field hits, ${Math.round((performance.now() - t0) * 10) / 10}ms`);
		this.#renderResults(results, term, word, seq);
		if (wantBody) {
			this._bodyTimer = setTimeout(() => this.#bodyPass(seq, term, word), BODY_IDLE_MS);
		}
	}

	/* phase 2: wiki-body scan + the old merge rules (dedup, 30 cap, fallback) */
	#bodyPass(seq, term, word) {
		this._bodyTimer = null;
		this._bodyPending = false;
		if (seq !== this._querySeq || !index) return; // typing resumed -> discard
		const t0 = performance.now();
		const hits = bodySearch(term);
		let merged = this._baseResults;
		if (merged.length > 0) {
			const seen = new Set(merged.map((r) => r.tag.name));
			merged = merged.slice();
			for (const h of hits) {
				if (merged.length >= 30) break;
				if (seen.has(h.tag.name)) continue;
				seen.add(h.tag.name);
				merged.push(h);
			}
		} else if (hits.length) {
			merged = hits;
		}
		if (PERF_ON) {
			const ms = pr1(performance.now() - t0);
			Perf.push({ term, ms, hits: merged.length, fuzzy: true, seg: { scan: 0, sort: 0, fuzzyBody: ms } });
		}
		dlog("D", `body "${term}" -> ${merged.length} merged, ${Math.round((performance.now() - t0) * 10) / 10}ms`);
		this.#renderResults(merged, term, word, seq);
	}

	/* shared list renderer for both phases (seq-stale updates are dropped) */
	#renderResults(results, term, word, seq) {
		if (seq !== this._querySeq) return; // stale result, drop it
		const { list, total, dropped, minPc } = applyLimit(results);
		if (!list.length) {
			if (!total) {
				if (this._bodyPending) {
					// keep the box open with a hint; phase 2 replaces or hides it
					this.#showEmpty("无匹配 — 正在检索 wiki 正文…");
					return;
				}
				// mid-phrase typing (has a space): keep the panel open with a hint
				if (term.includes(" ") && Config.get("fuzzy", "always") !== "off") {
					this.#showEmpty(`无匹配 — 正文需输入完整短语（${term}）`);
					return;
				}
				this.#hide();
				return;
			}
			this.#showEmpty(this._bodyPending
				? "低于最低热度 — 正在检索 wiki 正文…"
				: "低于最低热度，换关键词或调低阈值（设置中心可调）");
			return;
		}
		this.current = list;
		const items = list.map((item) => {
			const row = buildItemRow(item, word);
			row.addEventListener("click", () => this.#insert());
			row.addEventListener("mouseenter", () => this.#setSelected(item));
			item.el = row;
			return row;
		});
		const rows = items;
		if (total > list.length) {
			rows.push($el("div.dbtags-ac-empty", {
				textContent: `共 ${total} 条，仅显示前 ${list.length} 条`,
			}));
		}
		if (dropped > 0) {
			rows.push($el("div.dbtags-ac-empty", {
				textContent: `另有 ${dropped} 条低于 ${minPc} 热度未显示（设置可调）`,
			}));
		}
		this.list.replaceChildren(...rows);
		if (!this.wrap.isConnected) {
			document.body.append(this.wrap);
		}
		this.wrap.style.display = "";
		_activeAC = this;
		this.#place();
		// keep the user's current selection across the phase-2 rebuild
		const keep = this.selected && this.current.find((it) => it.tag.name === this.selected.tag.name);
		this.#setSelected(keep || this.current[0]);
	}

	#showEmpty(msg) {
		this.current = [];
		this.selected = null;
		this.list.replaceChildren(
			$el("div.dbtags-ac-empty", { textContent: msg })
		);
		if (!this.wrap.isConnected) {
			document.body.append(this.wrap);
		}
		this.wrap.style.display = "";
		_activeAC = this;
		this.#place();
	}

	#place() {
		// floating at the caret, offset to the RIGHT of the text with a gap,
		// vertical: below the caret line, flip above only when needed (sticky)
		const pos = this.helper.getCursorOffset();
		const viewW = window.innerWidth;
		const viewH = window.innerHeight;
		// panel stack may only take what the viewport has left after the list
		// (list width is dynamic in fit mode, so the CSS 360px guess is replaced live)
		if (this.showWiki) {
			const stackMax = Math.max(290, viewW - this.list.offsetWidth - 24);
			this.panelStack.style.maxWidth = stackMax + "px";
		}
		// wrap.offsetWidth is shrink-to-fit capped (never exceeds viewport-left),
		// so measure the real children widths instead
		const estW = this.list.offsetWidth
			+ (this.showWiki && this.panelStack.style.display !== "none" ? this.panelStack.offsetWidth : 0)
			|| 340 + 290;
		const estH = this.wrap.offsetHeight || 120;
		let left = pos.left + 24;
		if (left + estW > viewW - 8) {
			left = Math.max(8, viewW - estW - 8);
		}
		this.wrap.style.left = left + "px";
		const spaceBelow = viewH - 8 - pos.top;
		const spaceAbove = pos.top - 8;
		let flip = this._flipUp;
		if (flip === undefined) flip = spaceBelow < estH;
		if (flip && spaceAbove < estH) flip = false;
		if (flip) {
			this._flipUp = true;
			this.wrap.style.top = Math.max(8, pos.top - estH) + "px";
			this.wrap.style.maxHeight = Math.max(80, spaceAbove) + "px";
		} else {
			this._flipUp = false;
			this.wrap.style.top = pos.top + "px";
			this.wrap.style.maxHeight = Math.max(80, spaceBelow) + "px";
		}
	}

	#hide() {
		clearTimeout(this._bodyTimer);
		this._bodyTimer = null;
		this._bodyPending = false;
		this.#closeImageCard();
		hudClear();
		// In HUD (留空窗) mode the window persists after the popup closes, so keep
		// the last candidate list alive: [ ] then keeps moving the browsing
		// position through it (hudFollow re-previews each) instead of dying the
		// moment #hide wiped it. Cleared normally on the next query or in card mode.
		if (!_hudOn) {
			this.selected = null;
			this.current = [];
		}
		this._flipUp = undefined;
		for (const p of this.navPanels) {
			p.el.remove();
		}
		this.navPanels = [];
		this.#hidePreview();
		clearTimeout(this._toastTimer);
		if (this._toastEl) this._toastEl.style.display = "none";
		if (this.wrap.isConnected) {
			this.wrap.style.display = "none";
		}
	}
}

/* ---- disable the pysssss autocompleter so only ours shows ---- */
async function disablePysssss() {
	try {
		const mod = await import(PYSSSSS_AUTO);
		if (mod.TextAreaAutoComplete) {
			mod.TextAreaAutoComplete.enabled = false;
			dlog("C", "pysssss autocomplete disabled");
			return;
		}
	} catch (e) {
		dlog("C", "pysssss import failed:", e.message);
	}
	installGuard();
}

function installGuard() {
	document.addEventListener(
		"keydown",
		(e) => {
			const dd = document.querySelector(".pysssss-autocomplete");
			if (dd && dd.parentElement && ["Tab", "ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) {
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		},
		true
	);
	// sweep whatever is already there, then remove future dropdowns as they
	// are inserted: only newly-added nodes are inspected, so the callback is
	// O(added) per mutation batch instead of a full-DOM query every 300ms
	document.querySelectorAll(".pysssss-autocomplete").forEach((dd) => dd.remove());
	new MutationObserver((muts) => {
		for (const m of muts) {
			for (const n of m.addedNodes) {
				if (n.nodeType !== 1) continue;
				if (n.classList?.contains("pysssss-autocomplete")) n.remove();
				else n.querySelector?.(".pysssss-autocomplete")?.remove();
			}
		}
	}).observe(document.body, { childList: true, subtree: true });
}

async function loadIndex() {
	const t0 = performance.now();
	// cache:"default" + ?v=VERSION -> repeat loads hit the HTTP cache instead
	// of re-transferring ~25MB; a VERSION bump is the invalidation switch
	const resp = await fetch(INDEX_URL);
	if (resp.status !== 200) {
		console.error(`[dbtags] index fetch failed: ${resp.status} ${resp.statusText}`);
		return false;
	}
	index = await resp.json();
	Perf.indexMs = Math.round(performance.now() - t0);
	dlog("C", `index loaded: ${index.count} tags, ${Perf.indexMs}ms`);
	for (const cb of _indexReadyCbs.splice(0)) {
		try {
			cb();
		} catch {
			void 0;
		}
	}
	return true;
}

/* full key list + defaults (P18: export/import contract) */
const SETTING_DEFS = {
	theme: "dark",
	opacity: 100,
	hudOpacity: "",
	hudFont: "",
	hiddenThemes: "",
	lang: "zh",
	aliasTable: "true",
	pyMode: "zh-first",
	pyMinLen: 4,
	fuzzy: "always",
	showWiki: "true",
	showSummary: "true",
	showImage: "true",
	showLinks: "true",
	panelImg: "false",
	blur: "true",
	bracketNav: "true",
	hudMode: "false",
	hudOnType: "clear",
	hudClose: "ball",
	hudKeepLast: "false",
	hudImg: "true",
	hudWiki: "true",
	hudImgPrior: "false",
	insNoUnder: "true",
	showNoUnder: "false",
	escParens: "true",
	debug: "false",
	mode: "limit",
	minPost: 500,
	maxCount: 50,
	imgMode: "large",
	hudImgMode: "large",
	navMode: "A",
	widthMode: "fit",
	fontFamily: "",
	rowH: 26,
	perf: "off",
	width: 340,
	font: 13,
	customVars: "",
};

const THEME_DESC = {
	scope: "ComfyUI-Easy-DanWiki 补全浮窗（custom 主题）",
	colors: {
		bg: "候选列表背景色（避免纯黑纯白，会叠毛玻璃透明度）",
		bg2: "wiki 面板背景色（建议与 bg 差一档明度做层次）",
		border: "边框色（介于背景与文字之间，保证轮廓清晰）",
		text: "主文字：标签名/面板标题（与 bg 对比度需 ≥ 4.5:1）",
		sub: "次要文字：列表中的中文小字",
		summary: "wiki 正文文字（建议中等亮度，长文可读优先）",
		highlight: "链接/强调色（wiki 内链、命中高亮，深底配亮色）",
		count: "帖数文字（药丸底为半透明白，需在该底色上仍清晰）",
		fuzzy: "正文匹配命中色（与 highlight 区分度要大）",
	},
	derived: "selected=highlight加18%透明, fuzzy-bg=fuzzy加14%透明, zh=sub, bg/bg2自动转rgb三元组",
	file_format: "{ schema, exported, settings:{全部键值}, theme_desc:{本说明} }；只改 settings.customVars 里的颜色即可换肤",
};
let _stylerMsg = null;

/* one highlighted run of wiki text, or null (module-level: shared by the
panel renderer and the HUD body bubble) */
function highlightSeg(text, terms) {
	if (!text || !terms.length) return null;
	const lower = text.toLowerCase();
	const term = terms.find((t) => lower.includes(t.toLowerCase()));
	if (!term) return null;
	const i = lower.indexOf(term.toLowerCase());
	return {
		before: text.slice(0, i),
		hit: $el("span.dbtags-ac-snippet-hit", { textContent: text.slice(i, i + term.length) }),
		after: text.slice(i + term.length),
	};
}

/* render wiki text into container: plain runs + clickable [[links]].
handlers: { onLink(target, event), onHover(target|null, event) } — optional;
onLink receives the click event so callers can honour Ctrl/Cmd = quick-add */
function renderWikiBody(container, text, terms, h) {
	container.replaceChildren();
	if (!text) return;
	terms = (terms || []).filter(Boolean);
	const pieces = [];
	let last = 0;
	for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
		if (m.index > last) pieces.push({ type: "text", text: text.slice(last, m.index) });
		pieces.push({ type: "link", target: m[1].trim(), label: (m[2] || m[1]).trim() });
		last = m.index + m[0].length;
	}
	if (last < text.length) pieces.push({ type: "text", text: text.slice(last) });
	for (const piece of pieces) {
		if (piece.type === "link") {
			const lab = linkLabel(piece.target, piece.label);
			const cap = $el("span.dbtags-ac-link", { title: piece.target });
			cap.append(lab.main);
			if (lab.en) cap.append($el("span.dbtags-ac-link-en", { textContent: ` (${lab.en})` }));
			cap.addEventListener("click", (e) => {
				e.stopPropagation();
				h.onLink?.(piece.target, e);
			});
			if (h.onHover) {
				cap.addEventListener("mouseenter", (e) => h.onHover(piece.target, e));
				cap.addEventListener("mouseleave", () => h.onHover(null));
			}
			container.append(cap);
		} else {
			const seg = highlightSeg(piece.text, terms || []);
			if (seg) container.append(seg.before, seg.hit, seg.after);
			else container.append(piece.text);
		}
	}
}

/* ================= detail HUD window =================
A persistent card window decoupled from the completion popup (hudMode
switch, default off). It follows whatever candidate is hovered/selected
in any list, can be dragged by its header and resized from the corner
(both persisted), and reveals a second bubble with the full wiki body
when the pointer rests on it; links inside that bubble navigate the HUD
itself (with a small back stack). */
let _hud = null;

function hudFollow(tag, terms) {
	if (_hud) _hud.show(tag, terms);
}

/* the completion popup closed WITHOUT typing: drop the preview, keep the
tabs. A parked ball means the session is still open, so leave it alone. */
function hudClear() {
	if (_hud && !_hud.collapsed()) _hud.sessionClosed();
}

/* quick-add from the HUD (global): route to the widget that last had a popup */
function hudInsertTag(name) {
	if (_activeAC && _activeAC.el.isConnected) {
		_activeAC.insertWikiTag(name);
		return;
	}
	console.warn("[dbtags] 暂无活动的补全输入框，无法加入标签:", name);
}

/* a tag was just inserted into the widget: 输入后 decides the tab fate */
function hudTyped(tag) {
	if (!_hud) return;
	const keep = Config.get("hudKeepLast", "false") === "true" && tag && tag.name;
	if (Config.get("hudOnType", "clear") === "clear") {
		_hud.sessionReset(keep ? tag : null);
	} else if (keep) {
		_hud.keepVisible(tag.name);
	}
}

/* getTagMap() needs the index; HUD tabs can be restored before it loads */
function lookupTag(name) {
	return index ? getTagMap().get(normName(name)) : null;
}

function hudSync() {
	const on = _hudOn;
	if (on && !_hud) {
		try {
			_hud = new Hud();
		} catch (e) {
			console.error("[dbtags] 详情悬浮窗初始化失败（悬浮窗与小球都不会出现，请把此报错反馈）:", e);
		}
	} else if (!on && _hud) {
		_hud.destroy();
		_hud = null;
	}
	// panelImg can flip while the HUD stays open: re-sync its layout every pass
	if (_hud) _hud.syncLayout();
	// hudClose can be flipped while a collapsed ball is on screen
	if (_hud && Config.get("hudClose", "ball") !== "ball") _hud.hideBall();
}

class Hud {
	constructor() {
		this.preview = null; // live-follow slot: whatever the popup currently highlights
		this.terms = []; //   ... and its highlight terms (preview-only)
		this.pins = []; //    tab list: real tag names
		this.active = null; // "__preview__" or a pinned tag name
		this._imgSeq = 0;
		this.title = $el("span.dbtags-ac-hud-title");
		this.count = $el("span.dbtags-ac-hud-count");
		const close = $el("span.dbtags-ac-hud-x.dbtags-ac-hud-btn", {
			textContent: "×",
			title: "关闭（收进小球；点小球恢复；右键小球关闭）",
		});
		close.onclick = (e) => {
			// stopPropagation: keep the raw click off any document-level handlers
			// (e.g. litegraph / ComfyUI UI listeners) while collapsing
			e.stopPropagation();
			this.#close();
		};
		const add = $el("span.dbtags-ac-hud-add.dbtags-ac-hud-btn", {
			textContent: "＋",
			title: "把当前标签加入输入框（正文里 Ctrl/Cmd+点任意链接同样可加词）",
		});
		add.onclick = (e) => {
			e.stopPropagation();
			const t = this.#current();
			if (t) hudInsertTag(t.name);
		};
		this.head = $el("div.dbtags-ac-hud-head", {}, [this.title, this.count, add, close]);
		// dblclick on the blank title bar = same as × (controls excluded)
		this.head.addEventListener("dblclick", (e) => {
			if (!e.target.closest(".dbtags-ac-hud-btn")) this.#close();
		});
		this.tabs = $el("div.dbtags-ac-hud-tabs");
		this.img = $el("img.dbtags-ac-hud-img");
		this.img.style.display = "none";
		this._imgShown = false;
		this.zh = $el("div.dbtags-ac-hud-zh");
		this.body = $el("div.dbtags-ac-hud-body");
		this.scroll = $el("div.dbtags-ac-hud-scroll", {}, [this.img, this.zh, this.body]);
		this.el = $el("div.dbtags-ac-hud.dbtags-ac-hud--empty", {}, [this.head, this.tabs, this.scroll]);
		// collapsed form: a small ball parked where the window used to be
		this.ball = $el("div.dbtags-ac-hud-ball", {
			textContent: "📖",
			title: "点击展开详情悬浮窗（右键关闭）",
		});
		this.ball.style.display = "none";
		this.ball.oncontextmenu = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.#hardClose();
		};
		this.ball.onclick = () => {
			// the 3px drag threshold below keeps a drag from counting as a click
			if (!moved) this.expand();
		};
		/* the ball is draggable; its parked spot doubles as the window's next
		origin. A 3px threshold separates a drag from a click-to-expand. */
		let sx = 0, sy = 0, ox = 0, oy = 0, on = false, moved = false;
		this.ball.addEventListener("pointerdown", (e) => {
			on = true;
			moved = false;
			sx = e.clientX;
			sy = e.clientY;
			ox = parseFloat(this.ball.style.left) || 0;
			oy = parseFloat(this.ball.style.top) || 0;
			this.ball.setPointerCapture(e.pointerId);
		});
		this.ball.addEventListener("pointermove", (e) => {
			if (!on) return;
			const dx = e.clientX - sx;
			const dy = e.clientY - sy;
			if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
			if (!moved) return;
			this.ball.style.left = Math.min(Math.max(4, ox + dx), window.innerWidth - 40) + "px";
			this.ball.style.top = Math.min(Math.max(4, oy + dy), window.innerHeight - 40) + "px";
		});
		const ballStop = () => {
			if (!on) return;
			on = false;
			if (moved) {
				Config.set("hud.x", parseFloat(this.ball.style.left) || 0);
				Config.set("hud.y", parseFloat(this.ball.style.top) || 0);
			}
		};
		this.ball.addEventListener("pointerup", ballStop);
		this.ball.addEventListener("pointercancel", ballStop);
		const num = (k, d) => {
			const v = parseFloat(Config.get(k, ""));
			return Number.isFinite(v) && v > 0 ? v : d;
		};
		this.el.style.width = num("hud.w", 250) + "px";
		this.el.style.height = num("hud.h", 320) + "px";
		this.el.style.left = num("hud.x", Math.max(8, window.innerWidth - 266)) + "px";
		this.el.style.top = num("hud.y", 84) + "px";
		document.body.append(this.el, this.ball);
		// the HUD is user-resizable; keep the image-priority cap in sync with the
		// window's own height whenever it is dragged larger/smaller
		this._ro = new ResizeObserver(() => this.#fitImg());
		this._ro.observe(this.el);
		// the strip has no visible scrollbar by design: wheel / trackpad pans it
		this.tabs.addEventListener(
			"wheel",
			(e) => {
				if (this.tabs.scrollWidth <= this.tabs.clientWidth) return;
				const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
				if (!dx) return;
				e.preventDefault();
				this.tabs.scrollLeft += dx;
			},
			{ passive: false }
		);
		this.#wireDrag();
		this.syncLayout();
		// restore tabs (kept tabs persist across restarts)
		this.pins = (Config.get("hud.tabs", "") || "").split("|").map((x) => x.trim()).filter(Boolean).slice(0, 60);
		const act = Config.get("hud.tabActive", "");
		this.active = this.pins.includes(act) ? act : this.pins[0] || null;
		this.#renderTabs();
		this.#renderCurrent();
		onIndexReady(() => {
			this.#renderTabs();
			this.#renderCurrent();
		});
	}

	/* the × button / title-bar dblclick: hudClose decides — park as a ball
	(default, current view intact) or hide + blank the frame */
	#close() {
		if (this.collapsed()) return; // double-fire guard (× + bubbling dblclick)
		if (Config.get("hudClose", "ball") === "ball") this.collapseToBall();
		else {
			this.#saveGeom();
			this.#closeImgCard();
			this.el.style.display = "none";
			this.el.classList.add("dbtags-ac-hud--empty");
			this.sessionClosed();
		}
	}

	collapseToBall() {
		this.#saveGeom(); // before hiding: offsetWidth/Height read 0 on a hidden box
		this.#closeImgCard();
		this.el.style.display = "none";
		this.el.classList.add("dbtags-ac-hud--empty");
		const x = Math.min(Math.max(4, parseFloat(this.el.style.left) || 4), window.innerWidth - 40);
		const y = Math.min(Math.max(4, parseFloat(this.el.style.top) || 4), window.innerHeight - 40);
		this.ball.style.left = x + "px";
		this.ball.style.top = y + "px";
		this.ball.style.display = "flex";
	}

	#hardClose() {
		this.ball.style.display = "none";
		this.sessionClosed();
	}

	hideBall() {
		this.ball.style.display = "none";
	}

	collapsed() {
		return this.ball.style.display !== "none";
	}

	expand() {
		this.ball.style.display = "none";
		this.el.style.display = "";
		// the window opens where its ball was parked (clamped back on screen)
		const bx = parseFloat(this.ball.style.left) || parseFloat(this.el.style.left) || 4;
		const by = parseFloat(this.ball.style.top) || parseFloat(this.el.style.top) || 4;
		this.el.style.left = Math.max(4, Math.min(bx, window.innerWidth - this.el.offsetWidth - 6)) + "px";
		this.el.style.top = Math.max(4, Math.min(by, window.innerHeight - 60)) + "px";
		this.#renderTabs();
		this.#renderCurrent();
		this.#saveGeom();
	}

	/* mirrors the panel's two modes: text-priority caps the image so the
	wiki body is visible without scrolling; image-priority shows it full-width */
	syncLayout() {
		const prior = Config.get("hudImgPrior", "false") === "true";
		this.el.classList.toggle("dbtags-ac-hud-imgprior", prior);
		// Drive HUD image sizing from JS so it (a) survives a stale cached
		// stylesheet and (b) is measured against the HUD's OWN height, not 96vh:
		// the window is user-resizable, so a viewport-based cap can overflow a
		// short HUD and push the name/body out of view (the "no effect" bug).
		// In image-priority the image becomes a flex item that grows to fill the
		// space left after the Chinese name + a small body footer (which scrolls
		// on its own), so both stay visible at any HUD size.
		if (this.img && this.scroll && this.zh && this.body) {
			const thumb = Config.get("hudImgMode", Config.get("imgMode", "large")) === "small";
			const st = (el, props) => {
				for (const [k, v] of Object.entries(props)) {
					if (v === null) el.style.removeProperty(k);
					else el.style.setProperty(k, v);
				}
			};
			if (thumb) {
				st(this.scroll, { overflow: null });
				st(this.img, { width: "auto", "max-width": "96px", "max-height": "96px", flex: null, "min-height": null });
				st(this.zh, { flex: null });
				st(this.body, { flex: null, "max-height": null, overflow: null });
			} else if (prior && this._imgShown) {
				// image-priority WITH an image: image spans the window width and is
				// capped to the window's own visible height (minus a reserve for the
				// name + a couple body lines). The WHOLE window scrolls together —
				// no pinned image, no separate tiny scroller.
				st(this.scroll, { overflow: null });
				st(this.img, { width: "100%", "max-width": null, flex: null, "min-height": null });
				st(this.zh, { flex: null });
				st(this.body, { flex: null, "max-height": null, overflow: null });
				this.#fitImg();
			} else {
				st(this.scroll, { overflow: null });
				st(this.img, { width: null, "max-width": null, "max-height": "min(240px, 36vh)", flex: null, "min-height": null });
				st(this.zh, { flex: null });
				st(this.body, { flex: null, "max-height": null, overflow: null });
			}
		}
		// scope a HUD-only font size over the inherited global one: every HUD
		// surface reads var(--dbtags-ac-font), so this one override rescales the
		// whole window (title/tabs/zh/body) without touching the candidate list
		this.el.style.setProperty("--dbtags-ac-font", hudFontVal() + "px");
		const a = hudOpacityVal() / 100;
		// always publish the alpha var too, so any stylesheet path that reads it
		// (including a stale cached CSS that predates the inline override) agrees
		this.el.style.setProperty("--dbtags-ac-hud-alpha", String(a));
		// The active theme hard-codes the HUD background (usually with !important),
		// so a plain alpha var never reaches it — that's the "hidden" transparency.
		// Capture the theme's own solid color once per theme, then recompose it at
		// the chosen opacity inline (!important beats the theme rule so the slider
		// finally drives the HUD). Re-capture whenever the theme/colors change.
		if (this._bgEpoch !== _themeEpoch) {
			this._bgEpoch = _themeEpoch;
			this._baseBg = null;
			this.el.style.removeProperty("background");
		}
		if (!this._baseBg) {
			const m = getComputedStyle(this.el).backgroundColor.match(/rgba?\(([^)]+)\)/);
			if (m) {
				const p = m[1].split(",").map(parseFloat);
				// fully transparent (glass) → nothing to tint; leave theme alone
				if (!(p.length >= 4 && p[3] === 0)) this._baseBg = p.slice(0, 3).join(",");
				else this._baseBg = "none";
			}
		}
		if (this._baseBg && this._baseBg !== "none") {
			this.el.style.setProperty("background", `rgba(${this._baseBg},${a})`, "important");
		} else {
			this.el.style.removeProperty("background");
			this.el.style.setProperty("--dbtags-ac-hud-alpha", String(a));
		}
		// frost only helps when the window is actually translucent
		this.el.classList.toggle("dbtags-hud-noblur", a >= 1 || Config.get("blur", "true") === "false");
	}

	/* cap the image-priority image to the window's own visible area so a big
	image still leaves the Chinese name + a couple body lines on first paint,
	while the whole window scrolls together (image is NOT pinned). Recomputed on
	resize by a ResizeObserver. */
	#fitImg() {
		if (!this._imgShown) return;
		if (Config.get("hudImgPrior", "false") !== "true") return;
		if (Config.get("hudImgMode", Config.get("imgMode", "large")) === "small") return;
		const f = hudFontVal();
		const reserve = (this.zh ? this.zh.offsetHeight : 0) + Math.round(f * 1.5 * 2) + 26;
		const cap = Math.max(160, this.scroll.clientHeight - reserve);
		const px = cap + "px";
		if (this.img.style.maxHeight !== px) this.img.style.setProperty("max-height", px);
	}

	/* live follow from the candidate list: preview steals the view while the
	popup is open (the tab stays behind, one click to get back) */
	show(tag, terms) {
		if (!tag) return;
		// any popup activity re-materialises a collapsed (ball) or closed window
		this.ball.style.display = "none";
		this.el.style.display = "";
		this.preview = tag;
		this.terms = terms || [];
		this.active = "__preview__";
		this.#renderTabs();
		this.#renderCurrent();
	}

	/* the popup closed WITHOUT typing: drop the live preview, keep the
	pinned tabs (the window itself always stays, or stays parked as a ball) */
	sessionClosed() {
		this.preview = null;
		this.terms = [];
		if (this.active !== "__preview__" && !this.pins.includes(this.active)) {
			this.active = this.pins[0] || null;
		}
		if (this.active === "__preview__") this.active = this.pins[0] || null;
		this.#syncTabs();
		this.#renderTabs();
		this.#renderCurrent();
	}

	pin() {
		const t = this.#current();
		if (!t) return;
		if (!this.pins.includes(t.name)) {
			this.pins.push(t.name);
			if (this.pins.length > 60) this.pins.shift();
		}
		this.active = t.name;
		this.#afterChange();
	}

	/* wiki link click, browser semantics: the source (if an unpinned preview)
	and the destination both become tabs, and the destination is activated */
	navigate(name) {
		const t = lookupTag(name);
		if (!t) return;
		const cur = this.#current();
		if (cur && cur.name !== t.name && !this.pins.includes(cur.name)) this.pins.push(cur.name);
		if (!this.pins.includes(t.name)) this.pins.push(t.name);
		if (this.pins.length > 60) this.pins.splice(0, this.pins.length - 60);
		this.active = t.name;
		this.#afterChange();
	}

	closeTab(name) {
		const i = this.pins.indexOf(name);
		if (i >= 0) this.pins.splice(i, 1);
		if (this.active === name) {
			this.active = this.pins[Math.min(i, this.pins.length - 1)] || (this.preview ? "__preview__" : null);
		}
		this.#afterChange();
	}

/* tag confirmed (typed into the widget): the scratch session is over.
hudKeepLast pins the just-inserted word so its wiki stays readable after the
留空窗 clear (a pin survives the following #hide/sessionClosed, a bare
preview would not). */
sessionReset(keepTag) {
	const keep = Config.get("hudKeepLast", "false") === "true" && keepTag && keepTag.name;
	this.pins = keep ? [keepTag.name] : [];
	this.preview = null;
	this.terms = [];
	this.active = keep ? keepTag.name : null;
	this.#syncTabs();
	this.#renderTabs();
	this.#renderCurrent();
}

/* 保留标签页 mode + hudKeepLast: hold the just-inserted word visible by
pinning it (so the coming #hide/sessionClosed can't drop the live preview). */
keepVisible(name) {
	const t = lookupTag(name);
	if (!t) return;
	if (!this.pins.includes(name)) {
		this.pins.push(name);
		if (this.pins.length > 60) this.pins.shift();
	}
	this.active = name;
	this.#afterChange();
}

	#current() {
		if (this.active === "__preview__") return this.preview;
		if (this.active) return lookupTag(this.active);
		return this.preview;
	}

	#afterChange() {
		this.#syncTabs();
		this.#renderTabs();
		this.#renderCurrent();
	}

	#syncTabs() {
		Config.set("hud.tabs", this.pins.join("|"));
		Config.set("hud.tabActive", this.active && this.active !== "__preview__" ? this.active : "");
	}

	#renderTabs() {
		this.tabs.replaceChildren();
		const live = this.preview && this.active === "__preview__";
		// browser model: the italic preview chip is the pin entry, so the strip
		// shows whenever there is anything to pin, even with zero tabs yet
		if (!this.pins.length && !live) {
			this.tabs.style.display = "none";
			return;
		}
		this.tabs.style.display = "";
		for (const name of this.pins) {
			const chip = $el("span.dbtags-ac-hud-tab" + (this.active === name ? ".dbtags-ac-hud-tab--active" : ""), { title: name });
			chip.append($el("span.dbtags-ac-hud-tab-lbl", { textContent: dispName(name) }));
			const x = $el("span.dbtags-ac-hud-tab-x", { textContent: "×" });
			x.onclick = (e) => {
				e.stopPropagation();
				this.closeTab(name);
			};
			chip.append(x);
			chip.onclick = () => {
				this.active = name;
				this.#renderTabs();
				this.#renderCurrent();
			};
			chip.onauxclick = (e) => {
				if (e.button === 1) this.closeTab(name);
			};
			this.tabs.append(chip);
		}
		if (live) {
			const pv = $el("span.dbtags-ac-hud-tab.dbtags-ac-hud-tab--preview.dbtags-ac-hud-tab--active", {
				title: "临时预览（悬停跟随中）——点击此标签即固定为正式标签",
			});
			pv.append($el("span.dbtags-ac-hud-tab-lbl", { textContent: dispName(this.preview.name) }));
			pv.onclick = () => this.pin();
			this.tabs.append(pv);
			this.tabs.scrollLeft = this.tabs.scrollWidth;
		}
	}

	#renderCurrent() {
		const tag = this.#current();
		if (!tag) {
			this.el.classList.add("dbtags-ac-hud--empty");
			this.title.textContent = "";
			this.count.textContent = "";
			this.zh.textContent = "";
			this.zh.style.display = "none";
			this.body.replaceChildren();
			this._imgSeq++; // invalidate any in-flight image load
			this.#closeImgCard();
			this.img.onload = this.img.onerror = null;
			this.img.onmouseenter = this.img.onmouseleave = this.img.onclick = null;
			this.img.classList.remove("dbtags-ac-hud-img--thumb");
			this.img.src = "";
			this.img.style.display = "none";
			return;
		}
		this.el.classList.remove("dbtags-ac-hud--empty");
		this.title.textContent = dispName(tag.name);
		this.count.textContent = fmtCount(tag.post_count);
		const primary = tag.zhtag || listField(tag.aliases_zh)[0] || listField(tag.zh)[0] || "";
		this.zh.textContent = primary;
		this.zh.style.display = primary ? "" : "none";
		if (Config.get("hudImg", "true") !== "false") {
			this.#loadImage(tag);
		} else {
			this._imgSeq++; // invalidate any in-flight image load
			this.#closeImgCard();
			this.img.onload = this.img.onerror = null;
			this.img.onmouseenter = this.img.onmouseleave = this.img.onclick = null;
			this.img.classList.remove("dbtags-ac-hud-img--thumb");
			this.img.src = "";
			this.img.style.display = "none";
		}
		const terms = this.active === "__preview__" ? this.terms : [];
		if (Config.get("hudWiki", "true") !== "false") {
			renderWikiBody(this.body, wikiText(tag) || "(无 wiki 正文)", terms, {
				onLink: (t, e) => {
					if (e && (e.ctrlKey || e.metaKey)) hudInsertTag(t);
					else this.navigate(t);
				},
			});
		} else {
			this.body.replaceChildren();
		}
	}

	destroy() {
		this.#closeImgCard();
		if (this._ro) this._ro.disconnect();
		this.el.remove();
		this.ball.remove();
	}

	#loadImage(tag) {
		this.#closeImgCard();
		if (!tag.images || !tag.images.length) {
			this.img.onload = this.img.onerror = null;
			this.img.onmouseenter = this.img.onmouseleave = this.img.onclick = null;
			this.img.classList.remove("dbtags-ac-hud-img--thumb");
			this.img.src = "";
			this.img.style.display = "none";
			if (this._imgShown !== false) { this._imgShown = false; this.syncLayout(); }
			return;
		}
		this._imgShown = true;
		const base = `/dbtags/image?tag=${encodeURIComponent(tag.name)}&v=${VERSION}&size=`;
		const small = Config.get("hudImgMode", Config.get("imgMode", "large")) === "small";
		const order = small ? ["small", "large"] : ["large", "small"];
		const my = ++this._imgSeq;
		let i = 0;
		const tryNext = () => {
			if (my !== this._imgSeq) return; // HUD already moved on
			if (i >= order.length) {
				this.img.src = "";
				this.img.style.display = "none";
				this._imgShown = false;
				this.syncLayout();
				return;
			}
			this.img.onload = () => {
				if (my === this._imgSeq) {
					this.img.style.display = "";
					this.#fitImg();
				}
			};
			this.img.onerror = tryNext;
			this.img.src = base + order[i++];
		};
		tryNext();
		this.img.classList.toggle("dbtags-ac-hud-img--thumb", small);
		this._imgCardTag = tag;
		if (small) {
			this.img.onmouseenter = () => this.#imgHoverIn();
			this.img.onmouseleave = () => this.#imgHoverOut();
			this.img.onclick = () => this.#openImgCard();
		} else {
			this.img.onmouseenter = this.img.onmouseleave = this.img.onclick = null;
		}
		// (re)apply the current 图片优先 layout for THIS tag deterministically:
		// without this the image-priority styles only appeared after an unrelated
		// resize/toggle, so it flickered between tags (the "不稳定" bug)
		this.syncLayout();
	}

	#imgHoverIn() {
		clearTimeout(this._imgCloseTimer);
		this._imgCloseTimer = null;
		if (this._imgHoverTimer || this._imgCard) return;
		this._imgHoverTimer = setTimeout(() => {
			this._imgHoverTimer = null;
			this.#openImgCard();
		}, 180);
	}

	#imgHoverOut() {
		clearTimeout(this._imgHoverTimer);
		this._imgHoverTimer = null;
		if (this._imgCard && !this._imgCloseTimer) {
			this._imgCloseTimer = setTimeout(() => {
				this._imgCloseTimer = null;
				this.#closeImgCard();
			}, 260);
		}
	}

	#openImgCard() {
		const tag = this._imgCardTag;
		if (!tag) return;
		this.#closeImgCard();
		const url = `/dbtags/image?tag=${encodeURIComponent(tag.name)}&v=${VERSION}&size=large`;
		const big = $el("img.dbtags-ac-imgcard-img", { src: url });
		big.onerror = () => this.#closeImgCard();
		const card = $el("div.dbtags-ac-imgcard", {}, [
			$el("div.dbtags-ac-imgcard-head", [
				$el("div.dbtags-ac-imgcard-title", { textContent: `${tag.name}  ${fmtCount(tag.post_count)}` }),
				$el("span.dbtags-ac-imgcard-x", { textContent: "×", onclick: () => this.#closeImgCard() }),
			]),
			big,
		]);
		card.onmouseenter = () => {
			clearTimeout(this._imgCloseTimer);
			this._imgCloseTimer = null;
		};
		card.onmouseleave = () => this.#imgHoverOut();
		document.body.append(card);
		this._imgCard = card;
		this.#placeImgCard(card);
		big.onload = () => {
			if (this._imgCard === card) this.#placeImgCard(card);
		};
		this._imgCardKey = (e) => {
			if (e.key === "Escape") this.#closeImgCard();
		};
		document.addEventListener("keydown", this._imgCardKey, true);
	}

	#placeImgCard(card) {
		const r = this.img.getBoundingClientRect();
		const cw = card.offsetWidth;
		const ch = card.offsetHeight;
		let left = r.right + 8;
		if (left + cw > innerWidth - 8) left = r.left - 8 - cw;
		if (left < 8) left = 8;
		card.style.left = left + "px";
		card.style.top = Math.min(Math.max(r.top, 8), Math.max(8, innerHeight - ch - 8)) + "px";
	}

	#closeImgCard() {
		clearTimeout(this._imgHoverTimer);
		clearTimeout(this._imgCloseTimer);
		this._imgHoverTimer = null;
		this._imgCloseTimer = null;
		this._imgCard?.remove();
		this._imgCard = null;
		if (this._imgCardKey) {
			document.removeEventListener("keydown", this._imgCardKey, true);
			this._imgCardKey = null;
		}
	}

	#wireDrag() {
		let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
		// head bar and empty tab-strip area are both drag surfaces; controls are not
		for (const surf of [this.head, this.tabs]) {
			surf.addEventListener("pointerdown", (e) => {
				if (e.target.closest(".dbtags-ac-hud-btn,.dbtags-ac-hud-tab")) return;
				on = true;
				sx = e.clientX;
				sy = e.clientY;
				ox = parseFloat(this.el.style.left) || 0;
				oy = parseFloat(this.el.style.top) || 0;
				surf.setPointerCapture(e.pointerId);
			});
			surf.addEventListener("pointermove", (e) => {
				if (!on) return;
				this.el.style.left = Math.max(-this.el.offsetWidth + 90, Math.min(window.innerWidth - 90, ox + e.clientX - sx)) + "px";
				this.el.style.top = Math.max(4, Math.min(window.innerHeight - 40, oy + e.clientY - sy)) + "px";
			});
			const stop = () => {
				if (!on) return;
				on = false;
				this.#saveGeom();
			};
			surf.addEventListener("pointerup", stop);
			surf.addEventListener("pointercancel", stop);
		}
		this.el.addEventListener("pointerup", (e) => {
			if (e.target === this.el) this.#saveGeom(); // the native resize handle lives on el itself
		});
	}

	#saveGeom() {
		Config.set("hud.x", parseFloat(this.el.style.left) || 0);
		Config.set("hud.y", parseFloat(this.el.style.top) || 0);
		Config.set("hud.w", this.el.offsetWidth);
		Config.set("hud.h", this.el.offsetHeight);
	}
}

/* ================= appearance styler (P16) ================= */
let _styler = null;

function openStyler() {
	if (_styler) {
		_styler.el.style.zIndex = "10002";
		return;
	}
	try {
		_styler = new Styler();
	} catch (err) {
		console.error("[dbtags] styler failed to open:", err);
		window.alert("外观定制器打开失败：" + (err && err.message ? err.message : err));
	}
}

/* Per-setting help text surfaced by the hover "?" badge on each row label.
Rows that pass an inline hint (boolRow) win over this map; the map is the
shared home for combo/slider help and the long paragraphs that used to be
dumped inline and wrecked the two-column readability. Keyed by config key.
NOTE: several of these are interim wording pending the final copy. */
const HELP = {
	carrier: "选中一个标签时在哪里显示它的详情：卡片面板＝在输入框旁的固定面板；详情悬浮窗＝跟随的悬浮窗口；关闭＝不显示详情。下方的具体设置会随这里所选的载体切换。",
	showSummary: "卡片内显示标签的 wiki 正文；不勾＝只看中文名和示例图。",
	showImage: "在卡片面板里显示标签的示例图。",
	imgMode: "大图＝卡片内直接铺示例图；缩略图＝显示小图，鼠标悬浮到大图上再看大图卡。",
	panelImg: "图片优先：开＝图占满卡片、文字挤到下方；关＝文字优先、图收在小窗里。",
	showLinks: "在详情底部显示相关标签的跳转胶囊（可点着连续浏览）。",
	navMode: "点跳转链接时：分栏展开＝右侧新开一栏并排看；替换当前栏＝在原栏内替换内容。",
	bracketNav: "用 [ ] 键切换「浏览位」——即卡片面板或悬浮窗当前正在显示的那个标签，无需点开候选列表。",
	hudOnType: "标签是输入确认前的暂存架：悬停＝斜体预览，点它或点正文内链才转正；确认输入时整桌清空（可改为保留）。这里设定插入标签后悬浮窗标签页的去留。",
	hudClose: "点 × 关闭悬浮窗时：收进小球＝缩成一颗悬浮小球、点小球恢复原画面；直接关闭＝彻底关掉，下次输入时再出现。",
	hudOpacity: "悬浮窗可独立于候选列表的不透明度（默认跟随全局）；调低＝半透明毛玻璃，100%＝不透明。",
	hudFont: "悬浮窗可独立于候选列表的字号（默认跟随全局字号），只缩放悬浮窗内文字。",
	hudImgMode: "大图＝悬浮窗内直接铺示例图；缩略图＝显示小图，鼠标悬浮到大图上再看大图卡。",
	hudImgPrior: "图片优先：开＝图铺满窗口、文字下移；关＝文字优先，图小、正文多。",
	fontFamily: "整个界面（候选列表、面板、悬浮窗与本设置窗）使用的字体；选「默认」即用系统 sans-serif。",
};

// shared floating "?" tooltip, lazily created and appended to <body> so it is
// never clipped by the styler's own overflow (native title is too slow/ugly
// for the long explanations we are moving off the rows)
let _stylerTipEl = null;

class Styler {
	constructor() {
		this.swatchEls = [];
		this.colorInputs = {};
		this.el = $el("div.dbtags-ac-styler");
		const head = $el("div.dbtags-ac-styler-head", { textContent: "ComfyUI-Easy-DanWiki 外观定制器" });
		head.append($el("button.dbtags-ac-close", {
			textContent: "×",
			title: "关闭",
			onclick: () => this.close(),
		}));
		this.body = $el("div.dbtags-ac-styler-body");
		this.ctrl = $el("div.dbtags-ac-styler-ctrl");
		this.prev = $el("div.dbtags-ac-styler-prev");
		this.body.append(this.ctrl, this.prev);
		this.el.append(head, this.body);
		this.#buildControls();
		this.#buildPreview();
		document.body.append(this.el);
		this.el.style.left = Math.max(8, (window.innerWidth - 860) / 2) + "px";
		this.el.style.top = "56px";
		this.#wireDrag(head);
		// a floating tooltip must not linger detached from its badge while the
		// control column scrolls out from under it
		this.ctrl.addEventListener("scroll", () => this.#tipHide(), true);
	}

	close() {
		this._fpsRun = false;
		this.demoAC?.destroy();
		this.demoAC = null;
		if (_stylerTipEl) { _stylerTipEl.remove(); _stylerTipEl = null; }
		this.el.remove();
		_styler = null;
	}

	/* every control write funnels through here: store -> re-apply -> live everywhere */
	#set(key, value) {
		Config.set(key, String(value));
		// preview panel syncs first and every stage is guarded: one throwing
		// consumer can no longer leave the wiki panel stuck hidden
		try {
			this.#syncPreviewPanel();
			this.#refreshPreviewPanel();
		} catch (e) {
			console.error("[dbtags] preview sync failed:", e);
		}
		try {
			applyConfig();
		} catch (e) {
			console.error("[dbtags] applyConfig failed:", e);
		}
		refreshAllInstances();
		try {
			this.#labRefresh();
		} catch (e) {
			console.error("[dbtags] lab refresh failed:", e);
		}
	}

	/* one label cell for every row builder: text + (optional) hover "?" badge.
	help text = an inline arg (boolRow) else the shared HELP[key]; rows with
	neither get no badge, so the "?" only lights up wherever text exists */
	#lab(label, key, helpText) {
		const s = $el("span.dbtags-ac-styler-label", { textContent: label });
		const txt = helpText || (key && HELP[key]);
		if (txt) {
			const q = $el("span.dbtags-ac-styler-help", { textContent: "?" });
			q.setAttribute("data-tip", txt);
			q.onmouseenter = () => this.#tipShow(q);
			q.onmouseleave = () => this.#tipHide();
			q.onfocus = () => this.#tipShow(q);
			q.onblur = () => this.#tipHide();
			s.append(q);
		}
		return s;
	}

	#tipShow(badge) {
		if (!_stylerTipEl) {
			_stylerTipEl = $el("div.dbtags-ac-tip");
			document.body.append(_stylerTipEl);
		}
		const t = _stylerTipEl;
		t.textContent = badge.getAttribute("data-tip") || "";
		t.classList.add("on");
		t.style.visibility = "hidden";
		const r = badge.getBoundingClientRect();
		const tw = t.offsetWidth;
		const th = t.offsetHeight;
		let x = r.left + r.width / 2 - tw / 2;
		x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
		let y = r.top - th - 8;
		if (y < 8) y = r.bottom + 8;
		t.style.left = x + "px";
		t.style.top = y + "px";
		t.style.visibility = "";
	}

	#tipHide() {
		if (_stylerTipEl) _stylerTipEl.classList.remove("on");
	}

	#comboRow(label, key, options, dflt) {
		const sel = $el("select");
		for (const [v, t] of options) {
			sel.append($el("option", { value: v, textContent: t }));
		}
		sel.value = Config.get(key, dflt);
		sel.onchange = () => this.#set(key, sel.value);
		return $el("div.dbtags-ac-styler-row", {}, [
			this.#lab(label, key), sel,
		]);
	}

	#boolRow(label, key, dflt = "true", hint) {
		const cb = $el("input", { type: "checkbox" });
		cb.checked = Config.get(key, dflt) !== "false";
		cb.onchange = () => this.#set(key, cb.checked);
		return $el("div.dbtags-ac-styler-row", {}, [this.#lab(label, key, hint), cb]);
	}

	#sliderRow(label, key, min, max, dflt, fmt) {
		const range = $el("input", { type: "range", min: String(min), max: String(max) });
		range.value = String(Config.getNum(key, dflt));
		const val = $el("span.dbtags-ac-styler-val");
		const show = () => val.textContent = (fmt || ((x) => x + ""))(range.value);
		range.oninput = () => { show(); this.#set(key, range.value); };
		show();
		return $el("div.dbtags-ac-styler-row", {}, [
			this.#lab(label, key), range, val,
		]);
	}

	#numRow(label, key, dflt, suffix) {
		const inp = $el("input.dbtags-ac-styler-num", { type: "number" });
		inp.value = String(Config.getNum(key, dflt));
		const row = $el("div.dbtags-ac-styler-row", {}, [
			this.#lab(label, key),
			inp,
			$el("span.dbtags-ac-styler-val", { textContent: suffix || "" }),
		]);
		inp.oninput = () => {
			const v = parseInt(inp.value, 10);
			if (!Number.isFinite(v) || v < (key === "minPost" ? 0 : 1)) return;
			this.#set(key, v);
		};
		return row;
	}

	#numSliderRow(label, key, min, max, dflt, suffix) {
		const range = $el("input.dbtags-ac-styler-slider", { type: "range", min: String(min), max: String(max) });
		const num = $el("input.dbtags-ac-styler-num", { type: "number" });
		range.value = String(Config.getNum(key, dflt));
		num.value = range.value;
		const val = $el("span.dbtags-ac-styler-val", { textContent: suffix || "" });
		range.oninput = () => {
			num.value = range.value;
			this.#set(key, parseInt(range.value, 10));
		};
		num.oninput = () => {
			const v = parseInt(num.value, 10);
			if (!Number.isFinite(v) || v < 1) return;
			range.value = String(Math.min(Math.max(v, min), max));
			this.#set(key, v);
		};
		return $el("div.dbtags-ac-styler-row", {}, [
			this.#lab(label, key), range, num, val,
		]);
	}

	#fontRow() {
		const sel = $el("select");
		const fams = () => _fontNames.map((n) => n.replace(/\.[a-z0-9]+$/i, ""));
		const fill = () => {
			const cur = Config.get("fontFamily", "").replace(/"/g, "");
			sel.replaceChildren(
				$el("option", { value: "", textContent: "默认（sans-serif）" }),
				...fams().map((f) => $el("option", { value: f, textContent: _loadedFams.has(f) ? f : `${f}（未加载）` })),
			);
			sel.value = !cur || fams().includes(cur) ? cur : "";
		};
		fill();
		onFontsReady(() => {
			if (sel.isConnected) fill();
		});
		sel.onchange = async () => {
			const fam = sel.value;
			if (fam && !_loadedFams.has(fam)) {
				const opt = sel.options[sel.selectedIndex];
				const orig = opt.textContent;
				sel.disabled = true;
				opt.textContent = "载入中…";
				try {
					await ensureFont(fam);
				} finally {
					sel.disabled = false;
					opt.textContent = orig;
				}
			}
			fill();
			this.#set("fontFamily", fam);
		};
		return $el("div.dbtags-ac-styler-row", {}, [
			this.#lab("界面字体", "fontFamily"), sel,
		]);
	}

	#refreshPreviewPanel() {
		if (!index) return;
		const tag = this._labTag || getTagMap().get(normName("1girl")) || index.tags[0];
		if (!tag) return;
		this.pTitle.textContent = `${tag.name}  ${fmtCount(tag.post_count)}`;
		const text = wikiText(tag).replace(/\[\[|\]\]/g, "");
		const term = (this.labInput?.value || "").replace(/\[|\]|\s+/g, " ").trim().toLowerCase();
		const lower = text.toLowerCase();
		const hit = term.length >= 2 ? lower.indexOf(term) : -1;
		if (hit >= 0) {
			this.pSummary.replaceChildren(
				document.createTextNode(text.slice(0, hit)),
				$el("span.dbtags-ac-snippet-hit", { textContent: text.slice(hit, hit + term.length) }),
				document.createTextNode(text.slice(hit + term.length)),
			);
		} else {
			this.pSummary.replaceChildren(document.createTextNode(text));
		}
		const pills = [];
		for (const l of (tag.links || []).slice(0, 4)) {
			const t = getTagMap().get(normName(l.n));
			pills.push($el("span.dbtags-ac-link", {
				textContent: t?.zhtag ? `${l.n}（${t.zhtag}）` : l.n,
			}));
		}
		if (pills.length) this.pLinks.replaceChildren(...pills);
	}

	#group(title) {
		const g = $el("div.dbtags-ac-styler-group");
		g.append($el("b", { textContent: title }));
		this.ctrl.append(g);
		return g;
	}

	#refreshSwatches() {
		const stored = Config.get("theme", "dark");
		// light the swatch of the theme actually rendered (removed themes map to
		// their fallback), so a user mid-migration still sees one highlighted
		const theme = REMOVED_THEMES[stored] || stored;
		for (const s of this.swatchEls) {
			s.classList.toggle("dbtags-ac-sw--on", s.dataset.v === theme);
		}
		const custom = this.swatchEls.find((s) => s.dataset.v === "custom");
		if (custom) {
			const cs = getComputedStyle(document.documentElement);
			const g = (n) => cs.getPropertyValue(n).trim();
			const card = custom.querySelector(".dbtags-ac-sw-card");
			card.style.background = g("--dbtags-ac-bg2");
			card.style.borderColor = g("--dbtags-ac-border");
			const rows = custom.querySelectorAll(".dbtags-ac-sw-row");
			rows[0].style.background = g("--dbtags-ac-selected");
			const bars0 = rows[0].querySelectorAll("i");
			bars0[0].style.background = g("--dbtags-ac-text");
			bars0[1].style.background = g("--dbtags-ac-count");
			rows[1].querySelectorAll("i")[0].style.background = g("--dbtags-ac-sub");
			rows[2].querySelectorAll("i")[0].style.background = g("--dbtags-ac-sub");
		}
		this.#syncPickers();
		this.#applyHiddenThemes();
	}

	/* ---- built-in theme visibility (hide clutter, restore later) ---- */
	#hiddenThemes() {
		const raw = Config.get("hiddenThemes", "");
		return new Set(raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : []);
	}
	#applyHiddenThemes() {
		const hidden = this.#hiddenThemes();
		for (const s of this.builtinSwEls || []) {
			s.classList.toggle("dbtags-ac-sw--hidden", hidden.has(s.dataset.v));
		}
	}
	#setThemeHidden(v, hide) {
		const hidden = this.#hiddenThemes();
		if (hide) hidden.add(v);
		else hidden.delete(v);
		this.#set("hiddenThemes", Array.from(hidden).join(","));
		if (hide && Config.get("theme", "dark") === v) {
			const visible = (this.builtinSwEls || [])
				.map((s) => s.dataset.v)
				.filter((id) => !hidden.has(id));
			this.#set("theme", visible[0] || "custom");
		}
		this.#applyHiddenThemes();
		this.#refreshSwatches();
	}
	#restoreAllThemes() {
		this.#set("hiddenThemes", "");
		this.#applyHiddenThemes();
		this.#refreshSwatches();
	}
	/* one mini-popup swatch button */
	#makeSwatch(v, t, c) {
		const sw = $el("button.dbtags-ac-sw", {
			onclick: () => {
				this.#set("theme", v);
				this.#refreshSwatches();
			},
		});
		sw.dataset.v = v;
		const card = $el("span.dbtags-ac-sw-card");
		card.style.background = c.bg;
		card.style.borderColor = c.border;
		const bar = (w, color) => {
			const b = $el("i.dbtags-ac-sw-bar");
			b.style.width = w;
			b.style.background = color;
			return b;
		};
		const selRow = $el("span.dbtags-ac-sw-row.dbtags-ac-sw-sel");
		selRow.style.background = c.sel;
		selRow.append(bar("44%", c.text), bar("14%", c.count));
		const row2 = $el("span.dbtags-ac-sw-row");
		row2.append(bar("62%", c.sub));
		const row3 = $el("span.dbtags-ac-sw-row");
		row3.append(bar("48%", c.sub));
		card.append(selRow, row2, row3);
		sw.append(card, $el("span.dbtags-ac-sw-name", { textContent: t }));
		return sw;
	}

	/* (re)render saved/imported presets as swatches in the theme row */
	#rebuildUserSwatches() {
		for (const el of this.userSwEls || []) el.remove();
		this.userSwEls = [];
		this.swatchEls = this.swatchEls.filter((s) => !(s.dataset.v || "").startsWith("up"));
		const list = getUserThemes();
		list.forEach((preset, i) => {
			const co = preset.colors || {};
			const c = {
				bg: co.bg2 || co.bg || "#dddddd",
				border: co.border || "#999999",
				sel: co.highlight ? `rgba(${hexRgb(co.highlight)}, 0.18)` : "rgba(127,127,127,0.15)",
				text: co.text || "#555555",
				sub: co.sub || "#888888",
				count: co.count || "#888888",
			};
			const sw = this.#makeSwatch(preset.id, preset.name || ("预设" + (i + 1)), c);
			const del = $el("button.dbtags-ac-sw-del", { textContent: "×" });
			del.title = "删除此预设";
			del.onclick = (e) => {
				e.stopPropagation();
				this.#deleteUserTheme(preset.id);
			};
			sw.append(del);
			this.userSwEls.push(sw);
			this.swatchEls.push(sw);
			this.themeSwRow.append(sw);
		});
		this.#refreshSwatches();
	}

	/* snapshot whatever theme is currently shown as a named preset */
	#saveCurrentTheme() {
		const name = prompt("预设名称：", "");
		if (!name) return;
		const cs = getComputedStyle(document.documentElement);
		const g = (n) => cs.getPropertyValue(n).trim();
		const colors = {
			bg: g("--dbtags-ac-bg"),
			bg2: g("--dbtags-ac-bg2"),
			border: g("--dbtags-ac-border"),
			text: g("--dbtags-ac-text"),
			sub: g("--dbtags-ac-sub"),
			summary: g("--dbtags-ac-summary"),
			highlight: g("--dbtags-ac-highlight"),
			count: g("--dbtags-ac-count"),
			fuzzy: g("--dbtags-ac-fuzzy"),
		};
		const list = getUserThemes();
		list.push({
			id: "up" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
			name,
			colors,
		});
		saveUserThemes(list);
		this.#rebuildUserSwatches();
	}

	/* import preset(s) from a JSON file: [{name,colors}] or {name,colors} */
	#importTheme() {
		const inp = $el("input", { type: "file", accept: ".json,application/json" });
		inp.onchange = () => {
			const f = inp.files && inp.files[0];
			if (!f) return;
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const data = JSON.parse(String(reader.result));
					const list = getUserThemes();
					const push = (it) => {
						const colors = it.colors || it;
						if (!colors || typeof colors !== "object") return;
						list.push({
							id: "up" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
							name: String(it.name || ("预设" + (list.length + 1))),
							colors,
						});
					};
					if (Array.isArray(data)) {
						for (const it of data) push(it);
					} else {
						push(data);
					}
					if (!list.length) throw new Error("empty");
					saveUserThemes(list);
					this.#rebuildUserSwatches();
				} catch {
					alert("导入失败：不是有效的预设 JSON（支持 {name,colors} 或 [{name,colors}]）");
				}
			};
			reader.readAsText(f);
		};
		inp.click();
	}

	#deleteUserTheme(id) {
		const list = getUserThemes().filter((p) => p && p.id !== id);
		saveUserThemes(list);
		if (Config.get("theme", "dark") === id) this.#set("theme", "dark");
		this.#rebuildUserSwatches();
	}

	#buildControls() {
		const gTheme = this.#group("主题");
		const swRow = $el("div.dbtags-ac-styler-swatches");
		this.themeSwRow = swRow;
		const SWATCH_COLORS = {
			dark:  { bg:"#33383f", border:"#7a8394", sel:"rgba(77,163,255,0.16)", text:"#e6e6e6", sub:"#b5bac2", count:"#a8c6a8" },
			light: { bg:"#f7f5f1", border:"#bdb6a8", sel:"rgba(30,111,217,0.12)", text:"#3b3b3b", sub:"#6f6f6f", count:"#4d7a4d" },
			pink:  { bg:"#fdf0f5", border:"#e38fba", sel:"rgba(236,98,161,0.18)", text:"#53263e", sub:"#8b4e6d", count:"#c34e81" },
			mint:  { bg:"#e8f8ec", border:"#93bca1", sel:"rgba(33,150,83,0.16)", text:"#1f4730", sub:"#5e8a6d", count:"#2f7d4f" },
			"amber-close": { bg:"#221002", border:"#7a4a08", sel:"rgba(255,159,0,0.18)", text:"#ffb84d", sub:"#e08a1f", count:"#ffcc66" },
			"retro-apple": { bg:"#f2f0e4", border:"#000000", sel:"rgba(15,95,255,0.18)", text:"#000000", sub:"#555555", count:"#006400" },
			"winxp": { bg:"#ece9d8", border:"#7a9cd3", sel:"rgba(49,106,197,0.25)", text:"#000000", sub:"#4a4a4a", count:"#008000" },
			"winxp-olive": { bg:"#f2f0e3", border:"#8aa552", sel:"rgba(77,99,36,0.25)", text:"#000000", sub:"#4a4a4a", count:"#006400" },
			"winxp-silver": { bg:"#f0f0ee", border:"#9caec2", sel:"rgba(58,90,117,0.22)", text:"#000000", sub:"#4a4a4a", count:"#006400" },
			"winxp-classic": { bg:"#c0c0c0", border:"#808080", sel:"rgba(0,0,128,0.3)", text:"#000000", sub:"#404040", count:"#008000" },
			"modern": { bg:"#ffffff", border:"#d1d5db", sel:"rgba(37,99,235,0.16)", text:"#1f2937", sub:"#6b7280", count:"#16a34a" },
			"modern-dark": { bg:"#1e1e2e", border:"#3f3f5a", sel:"rgba(34,211,238,0.18)", text:"#e2e8f0", sub:"#94a3b8", count:"#34d399" },
			"eye-care": { bg:"#f4ecd8", border:"#d6c9a8", sel:"rgba(107,124,74,0.20)", text:"#3d3426", sub:"#6b5e49", count:"#5f6e3e" },
			"eye-care-dark": { bg:"#1f1b17", border:"#3f382f", sel:"rgba(180,132,68,0.24)", text:"#d4c5b0", sub:"#9e8f79", count:"#a3a35a" },
			"nord": { bg:"#2e3440", border:"#4c566a", sel:"rgba(136,192,208,0.18)", text:"#d8dee9", sub:"#88c0d0", count:"#a3be8c" },
			"solarized": { bg:"#002b36", border:"#586e75", sel:"rgba(38,139,210,0.18)", text:"#839496", sub:"#93a1a1", count:"#2aa198" },
		};
		this.builtinSwEls = [];
		for (const [v, t] of [
			["dark", "黑灰"], ["light", "米白"], ["pink", "喵粉"],
			["mint", "薄荷绿"],
			["amber-close", "琥珀"],
			["retro-apple", "复古苹果"],
			["winxp", "Windows XP 蓝天"],
			["winxp-olive", "Windows XP 橄榄绿"],
			["winxp-silver", "Windows XP 银灰"],
			["winxp-classic", "Windows 经典灰"],
			["modern", "现代"],
			["modern-dark", "现代暗色"],
			["eye-care", "护眼纸"],
			["eye-care-dark", "暗色护眼"],
			["nord", "Nord 极地"],
			["solarized", "Solarized 暗色"],
			["custom", "自定义"],
		]) {
			const c = SWATCH_COLORS[v] || { bg: "#dddddd", border: "#999999", sel: "rgba(127,127,127,0.15)", text: "#555555", sub: "#888888", count: "#888888" };
			const sw = this.#makeSwatch(v, t, c);
			this.swatchEls.push(sw);
			swRow.append(sw);
			if (v !== "custom") {
				this.builtinSwEls.push(sw);
				const hide = $el("button.dbtags-ac-sw-del", { textContent: "−" });
				hide.title = "从选择器移除该内置主题（可用下方「恢复全部主题」找回）";
				hide.onclick = (e) => {
					e.stopPropagation();
					this.#setThemeHidden(v, true);
				};
				sw.append(hide);
			}
		}
		this.#applyHiddenThemes();
		this.#rebuildUserSwatches();
		const btnRow = $el("div.dbtags-ac-styler-btnrow");
		btnRow.append(
			$el("button.dbtags-ac-styler-btn", { textContent: "存为预设", onclick: () => this.#saveCurrentTheme() }),
			$el("button.dbtags-ac-styler-btn", { textContent: "导入预设", onclick: () => this.#importTheme() }),
			$el("button.dbtags-ac-styler-btn", { textContent: "恢复全部主题", onclick: () => this.#restoreAllThemes() }),
		);
		gTheme.append(swRow, btnRow, $el("div.dbtags-ac-styler-hint", {
			textContent: "点色卡右上角「−」可把不想要的内置主题从选择器移除；「恢复全部主题」全部找回；「存为预设」把当前配色保存为可复用预设",
		}));
		this.pickerBox = $el("div.dbtags-ac-styler-pickers");
		gTheme.append(this.pickerBox);
		this.#buildPickers();

		const gSize = this.#group("尺寸与不透明度");
		gSize.append(
			this.#sliderRow("不透明度", "opacity", 25, 100, 100, (x) => x + "%"),
			$el("div.dbtags-ac-styler-hint", {
				textContent: "100%＝完全不透明（此时背景模糊自动停用，最省 GPU）；调低才变半透明",
			}),
			this.#boolRow("背景模糊", "blur", "true", "毛玻璃 backdrop-filter：仅在半透明时有可见效果；不透明(100%)时本就被自动停用，关掉可强制省 GPU"),
			this.#numRow("字号", "font", 13, "px"),
			this.#fontRow(),
			this.#numSliderRow("行高", "rowH", 20, 60, 26, "px"),
			this.#comboRow("宽度模式", "widthMode", [["fit", "撑开（随内容）"], ["fixed", "固定"]], "fit"),
			this.#numSliderRow("列表宽度", "width", 240, 800, 340, "px"),
		);

		const gMatch = this.#group("匹配与搜索");
		gMatch.append(
			this.#comboRow("匹配语言", "lang", [["zh", "中文（回退英文）"], ["en", "English"]], "zh"),
			this.#boolRow("别名表", "aliasTable"),
			this.#comboRow("拼音命中", "pyMode", [["zh-first", "拼音结果靠前"], ["en-first", "英文结果靠前"], ["off", "关闭"]], "zh-first"),
			this.#sliderRow("拼音最小长度", "pyMinLen", 1, 12, 4),
			this.#comboRow("正文匹配", "fuzzy", [["always", "始终"], ["fallback", "兜底"], ["off", "关"]], "always"),
			this.#boolRow("转义括号", "escParens", "true", "插入时 star_(sky) → star \\(sky\\)，防止括号被权重语法吞掉"),
			this.#boolRow("插入去下划线", "insNoUnder", "true", "插入时 cat_ears → cat ears"),
			this.#boolRow("列表去下划线", "showNoUnder", "false", "仅显示层：候选列表与面板标题用空格，插入和匹配仍用下划线"),
		);

		const gMode = this.#group("候选与数据");
		gMode.append(
			this.#comboRow("显示范围", "mode", [["limit", "限量（热度过滤 + 数量上限）"], ["all", "全部显示（可能卡顿）"]], "limit"),
			this.#numRow("最低post数(0=关)", "minPost", 500),
			this.#numRow("最多候选数", "maxCount", 50),
			this.#boolRow("调试日志", "debug"),
		);
		this.dataHintEl = $el("div.dbtags-ac-styler-hint", { textContent: this.#dataInfo() });
		gMode.append(this.dataHintEl);
		onIndexReady(() => {
			if (this.dataHintEl?.isConnected) this.dataHintEl.textContent = this.#dataInfo();
		});

		const gPanel = this.#group("wiki 面板");
		this.gPanel = gPanel;
		const modeNow = () =>
			Config.get("hudMode", "false") === "true"
				? "hud"
				: Config.get("showWiki", "true") === "false"
					? "off"
					: "panel";
		/* 详情载体（panel/hud）互斥，各自的子设置只在选中时展开、互不影响；
		示例图尺寸也拆成两份（卡片 imgMode / 悬浮窗 hudImgMode），
		谁用哪个载体就只调那个，不再一个改动同时影响两边。 */
		const carrierSel = $el("select");
		for (const [v, t] of [
			["panel", "卡片面板"],
			["hud", "详情悬浮窗"],
			["off", "关闭"],
		]) carrierSel.append($el("option", { value: v, textContent: t }));
		const carrierRow = $el("div.dbtags-ac-styler-row", {}, [
			this.#lab("详情载体", "carrier"),
			carrierSel,
		]);
		const cardRows = $el("div.dbtags-ac-styler-subgroup");
		const hudRows = $el("div.dbtags-ac-styler-subgroup");
		const syncCarrier = () => {
			const m = modeNow();
			carrierSel.value = m;
			cardRows.style.display = m === "panel" ? "" : "none";
			hudRows.style.display = m === "hud" ? "" : "none";
		};
		carrierSel.onchange = () => {
			const v = carrierSel.value;
			this.#set("showWiki", v === "off" ? "false" : "true");
			this.#set("hudMode", v === "hud" ? "true" : "false");
			syncCarrier();
		};
		cardRows.append(
			this.#boolRow("wiki 正文", "showSummary", "true", "卡片内显示标签的 wiki 正文；不勾＝只看中文名和示例图"),
			this.#boolRow("示例图", "showImage"),
			this.#comboRow("示例图尺寸", "imgMode", [["large", "大图"], ["small", "缩略图（悬浮看大图卡）"]], "large"),
			this.#boolRow("图片优先", "panelImg", "false"),
			this.#boolRow("跳转胶囊", "showLinks"),
			this.#comboRow("跳转展开", "navMode", [["A", "分栏展开"], ["B", "替换当前栏"]], "A"),
		);
		const hudOpRow = this.#sliderRow("悬浮窗不透明度", "hudOpacity", 25, 100, hudOpacityVal(), (x) => x + "%");
		const hudOpRange = hudOpRow.querySelector("input");
		const hudOpValEl = hudOpRow.querySelector(".dbtags-ac-styler-val");
		const hudFontRow = this.#sliderRow("悬浮窗字号", "hudFont", 9, 28, hudFontVal(), (x) => x + "px");
		const hudFontRange = hudFontRow.querySelector("input");
		const hudFontValEl = hudFontRow.querySelector(".dbtags-ac-styler-val");
		// the "follow global" buttons sit on their OWN row: a range sharing a
		// flex row with an extra sibling collapses to just its thumb under
		// ComfyUI's global input styling, so keep the slider alone in its row.
		const hudFollowRow = (labelText, onclick) => $el("div.dbtags-ac-styler-row.dbtags-ac-styler-row--btn", {}, [
			$el("span.dbtags-ac-styler-label", { textContent: " " }),
			$el("button.dbtags-ac-styler-btn", { textContent: labelText, title: "取消独立设置，跟随候选列表", onclick }),
		]);
		hudRows.append(
			this.#comboRow("输入后", "hudOnType", [["clear", "清空标签页（留空窗）"], ["keep", "保留标签页"]], "clear"),
			this.#boolRow("输入后保留最后词", "hudKeepLast", "false", "插入标签后，把最后输入的词固定为标签页、wiki 保持可见（留空窗/保留标签页两种模式都生效）；关＝插入后不保留该词"),
			this.#comboRow("× 关闭时", "hudClose", [["ball", "收进小球（点小球恢复）"], ["clear", "直接关闭"]], "ball"),
			hudOpRow,
			hudFollowRow("跟随全局不透明度", () => {
				this.#set("hudOpacity", "");
				// update the readout in place: rebuilding the whole panel here is
				// what used to make the view jump back to the top
				const g = Config.getNum("opacity", 100);
				hudOpRange.value = String(g);
				hudOpValEl.textContent = g + "%";
			}),
			hudFontRow,
			hudFollowRow("跟随全局字号", () => {
				this.#set("hudFont", "");
				const g = Math.min(28, Math.max(9, Config.getNum("font", 13)));
				hudFontRange.value = String(g);
				hudFontValEl.textContent = g + "px";
			}),
			this.#boolRow("wiki 正文", "hudWiki", "true", "悬浮窗顶部显示标签的 wiki 正文；不勾＝只看图（图卡模式）"),
			this.#boolRow("示例图", "hudImg", "true", "悬浮窗顶部显示示例图；不勾＝只看中文名和 wiki 正文"),
			this.#comboRow("示例图尺寸", "hudImgMode", [["large", "大图"], ["small", "缩略图（悬浮看大图卡）"]], "large"),
			this.#comboRow("图片优先", "hudImgPrior", [["false", "关（文字优先，图小正文多）"], ["true", "开（图片优先，图铺满）"]], "false"),
		);
		gPanel.append(
			carrierRow,
			cardRows,
			hudRows,
			this.#boolRow("括号键导航", "bracketNav", "true", "[ ] 切换卡片面板或悬浮窗的浏览位"),
		);
		syncCarrier();
		const gDanger = this.#group("重置");
		gDanger.append($el("button.dbtags-ac-styler-reset", {
			textContent: "全部设置恢复默认（含自定义配色）",
			onclick: () => {
				if (!confirm(
					"⚠️ 危险操作：将清空全部 ComfyUI-Easy-DanWiki 设置并恢复出厂默认，" +
					"包括自定义配色、已保存的预设、已隐藏的主题与悬浮窗偏好。索引 / 翻译数据不受影响。\n\n此操作不可撤销，确定继续？"
				)) return;
				if (!confirm("再次确认：真的要恢复全部默认设置吗？已保存的配色预设将一并删除，无法找回。")) return;
				for (const k of Object.keys(localStorage)) {
					if (k.startsWith(ID + ".")) localStorage.removeItem(k);
				}
				getCustomColors.cache = null;
				applyConfig();
				refreshAllInstances();
				this.close();
				openStyler();
			},
		}));
		const gIO = this.#group("导出 / 导入");
		this.ioStatus = $el("div.dbtags-ac-styler-lab-stats");
		this.ta = $el("textarea.dbtags-ac-styler-ta", {
			placeholder: "粘贴导出的 / AI 生成的配置 JSON，点「应用粘贴配置」",
		});
		this.ta.rows = 5;
		this.fileInp = $el("input");
		this.fileInp.type = "file";
		this.fileInp.accept = ".json,application/json";
		this.fileInp.style.display = "none";
		this.fileInp.onchange = () => {
			const f = this.fileInp.files && this.fileInp.files[0];
			if (f) f.text().then((t) => this.#importText(t));
		};
		gIO.append(
			$el("div.dbtags-ac-styler-row", {}, [
				$el("button.dbtags-ac-styler-reset", { textContent: "导出 JSON 文件", onclick: () => this.#exportFile() }),
				$el("button.dbtags-ac-styler-reset", { textContent: "复制到剪贴板", onclick: () => this.#copyJson() }),
				$el("button.dbtags-ac-styler-reset", { textContent: "从文件导入", onclick: () => this.fileInp.click() }),
			]),
			this.ta,
			$el("div.dbtags-ac-styler-row", {}, [
				$el("button.dbtags-ac-styler-reset", { textContent: "应用粘贴配置", onclick: () => this.#importText(this.ta.value) }),
				this.ioStatus,
			]),
			this.fileInp,
		);
		const gPerf = this.#group("性能");
		const perfCb = $el("input", { type: "checkbox" });
		perfCb.checked = PERF_ON;
		perfCb.onchange = () => this.#set("perf", perfCb.checked ? "on" : "off");
		this.perfStats = $el("div.dbtags-ac-styler-hint");
		this.perfSeg = $el("div.dbtags-ac-styler-hint");
		this.perfBench = $el("div.dbtags-ac-styler-perf");
		this.perfFps = $el("div.dbtags-ac-styler-hint");
		this.perfBox = $el("div", {}, [
			this.perfFps,
			this.perfStats,
			this.perfSeg,
			$el("div.dbtags-ac-styler-row", {}, [
				$el("button.dbtags-ac-styler-reset", { textContent: "跑分基准", onclick: () => this.#runBench() }),
				$el("button.dbtags-ac-styler-reset", { textContent: "清空样本", onclick: () => { Perf.samples = []; _lastSeg = null; Perf.emit(); } }),
			]),
			this.perfBench,
		]);
		gPerf.append(
			$el("div.dbtags-ac-styler-row", {}, [
				$el("span.dbtags-ac-styler-label", { textContent: "记录性能数据" }), perfCb,
			]),
			$el("div.dbtags-ac-styler-hint", {
				textContent: "默认关。开启仅在当前页内存记录最近 300 次查询，关闭即清空；关闭状态下查询路径零额外开销。",
			}),
			this.perfBox,
		);
		this.perfRefresh = () => {
			if (!this.perfBox?.isConnected) return;
			perfCb.checked = PERF_ON;
			this.perfBox.style.display = PERF_ON ? "" : "none";
			if (!PERF_ON) {
				this.perfFps.textContent = "";
				this.perfStats.textContent = "";
				this.perfSeg.textContent = "";
				this.perfBench.replaceChildren();
				return;
			}
			this.#fpsMonitorStart();
			const st = Perf.stats();
			const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
			this.perfStats.textContent =
				`索引加载 ${Perf.indexMs || "—"}ms · JS堆 ${mem === null ? "—" : mem + "MB"} · 样本 ${Perf.samples.length}/${PERF_MAX}` +
				(st ? ` · 近${st.n}次 avg ${pr1(st.avg)} · P50 ${pr1(st.p50)} · P95 ${pr1(st.p95)} · max ${pr1(st.max)}ms` : " · 暂无样本");
			const sa = Perf.segAvg();
			this.perfSeg.textContent = sa && st
				? `阶段均值：扫描 ${pr1(sa.scan)}ms（含别名/拼音） · 排序 ${pr1(sa.sort)}ms · 正文匹配 ${pr1(sa.fuzzyBody)}ms`
				: "";
		};
		Perf.on(this.perfRefresh);
		this.perfRefresh();

		if (_stylerMsg) {
			this.ioStatus.textContent = _stylerMsg;
			_stylerMsg = null;
		}
		this.#refreshSwatches();
	}

	#exportJson() {
		const settings = {};
		for (const k of Object.keys(SETTING_DEFS)) settings[k] = Config.get(k, SETTING_DEFS[k]);
		try {
			settings.customVars = JSON.parse(Config.get("customVars", "")) || "";
		} catch {
			settings.customVars = "";
		}
		return JSON.stringify({
			schema: "dbtags-styler/1",
			exported: new Date().toISOString().slice(0, 10),
			settings,
			theme_desc: THEME_DESC,
		}, null, 2);
	}

	#exportFile() {
		const blob = new Blob([this.#exportJson()], { type: "application/json" });
		const a = $el("a", { href: URL.createObjectURL(blob), download: "dbtags-styler.json" });
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 2000);
		this.ioStatus.textContent = "已导出 dbtags-styler.json";
	}

	#copyJson() {
		const j = this.#exportJson();
		const fallback = () => {
			this.ta.value = j;
			this.ta.select();
			document.execCommand("copy");
			this.ioStatus.textContent = "已复制（textarea 后备方式）";
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(j).then(
				() => { this.ioStatus.textContent = "已复制完整配置，直接丢给 AI 即可"; },
				fallback
			);
		} else {
			fallback();
		}
	}

	#importText(text) {
		let obj = null;
		try {
			obj = JSON.parse(text);
		} catch {
			this.ioStatus.textContent = "JSON 解析失败";
			return;
		}
		const src = obj && typeof obj === "object" ? (obj.settings || obj) : null;
		if (!src) {
			this.ioStatus.textContent = "找不到 settings 字段";
			return;
		}
		const unknown = [];
		let n = 0;
		for (const [k, v] of Object.entries(src)) {
			if (!(k in SETTING_DEFS)) {
				unknown.push(k);
				continue;
			}
			Config.set(k, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
			n++;
		}
		if (!n) {
			this.ioStatus.textContent = "没有识别出任何配置键";
			return;
		}
		getCustomColors.cache = null;
		_stylerMsg = `已应用 ${n} 项配置` + (unknown.length ? `，忽略未知键：${unknown.join(", ")}` : "");
		applyConfig();
		refreshAllInstances();
		this.close();
		openStyler();
	}

	#buildPreview() {
		const mk = (cls, kids) => $el("div." + cls, {}, kids);
		this.labInput = $el("input.dbtags-ac-styler-lab-input", {
			placeholder: "像平时一样打字试匹配：girl / 美 / cha / nan…",
		});
		this.labInput.value = "cat girl";
		this.labInput.oninput = () => this.#labRefresh();
		this.labInput.onkeydown = (e) => {
			if (!this._labItems?.length) return;
			const n = this._labItems.length;
			let sel = this._labSel || 0;
			if (e.key === "ArrowDown") sel = Math.min(n - 1, sel + 1);
			else if (e.key === "ArrowUp") sel = Math.max(0, sel - 1);
			else return;
			e.preventDefault();
			this._labSel = sel;
			this.#labSyncSel();
		};
		this.labList = mk("dbtags-ac-list.dbtags-ac-styler-lab-list");
		this.labStats = $el("div.dbtags-ac-styler-lab-stats");
		const labHead = $el("div.dbtags-ac-styler-lab", {}, [
			$el("div.dbtags-ac-styler-lab-title", { textContent: "搜索试验台（与真实补全同一管线）" }),
			this.labInput,
		]);
		const labBody = mk("dbtags-ac-styler-duolist", [this.labList, this.labStats]);
		this.pTitle = $el("div.dbtags-ac-panel-title", { textContent: "1girl  8.3M" });
		this.pSummary = $el("div.dbtags-ac-panel-summary", { textContent: "（数据加载后显示真实词条）" });
		this.pLinks = mk("dbtags-ac-panel-links", []);
		this.pImg = $el("div.dbtags-ac-panel-img.dbtags-ac-fakeimg");
		const panel = mk("dbtags-ac-panel", [
			mk("dbtags-ac-panel-head", [this.pTitle, $el("span.dbtags-ac-plus", { textContent: "+" })]),
			this.pSummary, this.pLinks, this.pImg,
		]);
		this.panelWrap = mk("dbtags-ac-wrap.dbtags-ac-preview-wrap", [mk("dbtags-ac-panelstack", [panel])]);
		this.demoInput = $el("input.dbtags-ac-styler-demo-input", {
			placeholder: "在此打字实测：候选、方向键、[ ] 跳转展开、面板位置…",
			autocomplete: "off",
		});
		this.demoAC = new DBTagsAutoComplete(this.demoInput, { name: "styler-demo", type: "COMBO", options: {} });
		const demo = $el("div.dbtags-ac-styler-lab", {}, [
			$el("div.dbtags-ac-styler-lab-title", { textContent: "实际试用：真实补全实例（面板设置见左栏，即时生效）" }),
			this.demoInput,
		]);
		// the duo: input row sits above it so list and panel share one top edge;
		// every settings group (incl. wiki 面板) lives in the left column now,
		// so the right column is purely the live preview / testbed
		const duo = $el("div.dbtags-ac-styler-duo", {}, [labBody, this.panelWrap]);
		this.prev.append(labHead, duo, demo);
		this.#syncPreviewPanel();
		this.#refreshPreviewPanel();
		onIndexReady(() => {
			if (this.pTitle?.isConnected) this.#refreshPreviewPanel();
		});
		this.#labRefresh();
	}

	#labRefresh() {
		if (!this.labInput) return;
		const term = this.labInput.value.replace(/\[|\]/g, "").trim();
		if (!term) {
			this.labList.replaceChildren();
			this._labItems = [];
			this._labTag = null;
			this.labStats.textContent = "输入以测试";
			this.#refreshPreviewPanel();
			return;
		}
		if (!index) {
			this.labList.replaceChildren();
			this.labStats.textContent = "数据加载中…（就绪后自动刷新）";
			onIndexReady(() => this.#labRefresh());
			return;
		}
		const word = term.replace(/\s+/g, "_");
		const _lt0 = performance.now();
		const { list, total, dropped, minPc } = runQuery(term, word);
		const _ltMs = pr1(performance.now() - _lt0);
		this._labItems = list;
		if ((this._labSel || 0) >= list.length) this._labSel = 0;
		const rows = list.map((item, i) => {
			const row = buildItemRow(item, word);
			if (i === (this._labSel || 0)) row.classList.add("dbtags-ac-item--selected");
			row.onmousedown = () => {
				this._labSel = i;
				this.#labSyncSel();
			};
			return row;
		});
		if (total > list.length) {
			rows.push($el("div.dbtags-ac-empty", { textContent: `共 ${total} 条，仅显示前 ${list.length} 条` }));
		}
		if (dropped > 0) {
			rows.push($el("div.dbtags-ac-empty", { textContent: `另有 ${dropped} 条低于 ${minPc} 热度未显示` }));
		}
		this.labList.replaceChildren(...rows);
		const bodyHits = list.filter((i) => i.matchType === "fuzzy").length;
		this.labStats.textContent =
			`命中 ${total} · 显示 ${list.length}` +
			(dropped > 0 ? ` · 被热度过滤 ${dropped}` : "") +
			(bodyHits ? ` · 其中正文匹配 ${bodyHits}` : "") +
			(PERF_ON ? ` · 耗时 ${_ltMs}ms` : "");
		this.#labSyncSel();
	}

	/* cursor state of the lab list: drives the wiki preview panel beside it */
	#labSyncSel() {
		const sel = this._labSel || 0;
		const rows = this.labList ? this.labList.children : null;
		if (rows) {
			for (let i = 0; i < rows.length; i++) {
				if (rows[i].classList) rows[i].classList.toggle("dbtags-ac-item--selected", i === sel);
			}
		}
		const item = this._labItems ? this._labItems[sel] : null;
		this._labTag = (item && item.tag) || null;
		this.#refreshPreviewPanel();
	}

	#fpsMonitorStart() {
		if (this._fpsRun) return;
		this._fpsRun = true;
		this._ltN = 0;
		this._ltMs = 0;
		let po = null;
		if (typeof PerformanceObserver === "function") {
			try {
				po = new PerformanceObserver((list) => {
					for (const e of list.getEntries()) {
						this._ltN++;
						this._ltMs += e.duration;
					}
				});
				po.observe({ entryTypes: ["longtask"] });
			} catch {
				po = null;
			}
		}
		this._ltPo = po;
		let frames = 0;
		let last = performance.now();
		const tick = () => {
			if (!this._fpsRun || !PERF_ON || !this.perfBox?.isConnected) {
				this._fpsRun = false;
				if (this._ltPo) {
					try {
						this._ltPo.disconnect();
					} catch {
						void 0;
					}
					this._ltPo = null;
				}
				return;
			}
			frames++;
			const now = performance.now();
			if (now - last >= 1000) {
				const fps = Math.round((frames * 1000) / (now - last));
				this.perfFps.textContent =
					`实时 ${fps}fps · 主线程长任务(>50ms) 本次开面板累计 ${this._ltN} 次 / ${Math.round(this._ltMs)}ms` +
					(fps >= 55 && this._ltN === 0 ? "（健康）" : "（有掉帧，见下方定位建议或诊断日志）");
				frames = 0;
				last = now;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	#runBench() {
		this.perfBench.replaceChildren(
			$el("div.dbtags-ac-styler-hint", { textContent: "跑分中…（6 词 × 20 遍，约 2–5 秒）" }),
		);
		Perf.benchmark((partial) => this.#renderBench(partial)).then(
			(rows) => this.#renderBench(rows),
			(e) => this.perfBench.replaceChildren(
				$el("div.dbtags-ac-styler-hint", { textContent: `跑分失败：${e.message}` }),
			),
		);
	}

	#renderBench(rows) {
		if (!this.perfBench?.isConnected) return;
		const table = $el("table.dbtags-ac-styler-perf-table");
		const head = $el("tr");
		for (const h of ["查询", "命中", "P50", "P95", "max"]) head.append($el("th", { textContent: h }));
		table.append(head);
		for (const r of rows) {
			const tr = $el("tr");
			const cells = [
				`"${r.term}"`,
				String(r.hits),
				`${pr1(r.p50)}ms`,
				`${pr1(r.p95)}ms`,
				`${pr1(r.max)}ms`,
			];
			for (let i = 0; i < cells.length; i++) {
				const td = $el("td", { textContent: cells[i] });
				if (i >= 2 && r.p95 > 16) td.style.color = "#e5484d";
				tr.append(td);
			}
			table.append(tr);
		}
		this.perfBench.replaceChildren(table);
	}

	#syncPreviewPanel() {
		const on = (el, show) => { el.style.display = show ? "" : "none"; };
		on(this.pSummary, Config.get("showSummary", "true") !== "false");
		on(this.pLinks, Config.get("showLinks", "true") !== "false");
		on(this.pImg, Config.get("showImage", "true") !== "false");
		on(this.panelWrap, Config.get("showWiki", "true") !== "false");
		this.panelWrap.classList.toggle("dbtags-ac-imgprior", Config.get("panelImg", "false") !== "false");
	}
	#dataInfo() {
		if (!index) return `插件 ${VERSION} · 词库未加载`;
		let mn = Infinity;
		for (const t of index.tags) if (t.post_count < mn) mn = t.post_count;
		return `插件 ${VERSION} · 词库 v${index.version} · ${index.count} 标签 · 源站热度下限 ${mn} · 构建于 ${index.built_at}`;
	}

	#buildPickers() {
		const c0 = getCustomColors();
		for (const [k, label] of [
			["bg", "列表底色"],
			["bg2", "面板底色"],
			["border", "边框"],
			["text", "标签/标题文字"],
			["sub", "中文小字(列表)"],
			["summary", "wiki 正文"],
			["highlight", "链接/强调"],
			["count", "帖数计数"],
			["fuzzy", "正文命中"],
		]) {
			const inp = $el("input", { type: "color" });
			inp.value = c0[k];
			inp.oninput = () => {
				saveCustomColors({ ...getCustomColors(), [k]: inp.value });
				this.#refreshSwatches();
			};
			this.colorInputs[k] = inp;
			this.pickerBox.append($el("label.dbtags-ac-styler-pick", {}, [
				inp, $el("span", { textContent: label }),
			]));
		}
		this.pickerBox.append($el("button.dbtags-ac-styler-reset", {
			textContent: "重置自定义配色",
			onclick: () => {
				saveCustomColors({ ...CUSTOM_DEFAULT });
				this.#syncPickers();
				this.#refreshSwatches();
			},
		}));
		this.#syncPickers();
	}

	#syncPickers() {
		if (!this.pickerBox) return;
		const show = Config.get("theme", "dark") === "custom";
		this.pickerBox.classList.toggle("dbtags-ac-styler-pickers--on", show);
		if (!show) return;
		const c = getCustomColors();
		for (const [k, inp] of Object.entries(this.colorInputs)) inp.value = c[k];
	}

	#wireDrag(head) {
		let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
		head.addEventListener("pointerdown", (e) => {
			if (e.target.closest("button")) return;
			on = true;
			sx = e.clientX; sy = e.clientY;
			ox = parseFloat(this.el.style.left) || 0;
			oy = parseFloat(this.el.style.top) || 0;
			head.setPointerCapture(e.pointerId);
		});
		head.addEventListener("pointermove", (e) => {
			if (!on) return;
			this.el.style.left = Math.max(-this.el.offsetWidth + 90, Math.min(window.innerWidth - 90, ox + e.clientX - sx)) + "px";
			this.el.style.top = Math.max(4, Math.min(window.innerHeight - 40, oy + e.clientY - sy)) + "px";
		});
		head.addEventListener("pointerup", () => on = false);
	}
}

app.registerExtension({
	name: ID,
	init() {
		applyConfig();
		loadFonts();
		const STRING = ComfyWidgets.STRING;
		ComfyWidgets.STRING = function (node, inputName, inputData) {
			const r = STRING.apply(this, arguments);
			if (inputData[1]?.multiline) {
				const config = inputData[1]?.["pysssss.autocomplete"];
				if (config === false) return r;
				const id = `${node.comfyClass}.${inputName}`;
				if (SKIP_WIDGETS.has(id)) return r;
				const inputEl = r.widget.inputEl ?? r.widget.element;
				if (inputEl) {
					// widget rebuilt (resize/undo/copy): replace, never stack a
					// second instance on the same input
					r.widget._dbtagsAC?.destroy();
					r.widget._dbtagsAC = new DBTagsAutoComplete(inputEl, r.widget);
				}
			}
			return r;
		};

		// Single entry point — every setting lives in the styler window
		// (storage keys unchanged, existing values keep working).
		// `type` as a renderer function is supported by the frontend FormItem
		// (custom setting renderer): we draw a real push button in the panel.
		app.ui.settings.addSetting({
			id: ID + ".openStyler",
			category: ["ComfyUI-Easy-DanWiki", "外观定制器"],
			name: "打开外观定制器（主题/匹配/面板全部设置都在窗内）",
			type: () => {
				const btn = $el("button.dbtags-settings-btn", {
					type: "button",
					textContent: "打开",
					onclick: () => openStyler(),
				});
				// inline styles: the renderer element may land in a shadow DOM
				// where our stylesheet does not reach; hover via JS for the same reason
				const s = btn.style;
				s.padding = "0.3rem 1.2rem";
				s.borderRadius = "6px";
				s.border = "none";
				s.cursor = "pointer";
				s.fontSize = "0.875rem";
				s.background = "var(--p-primary-color, #00857e)";
				s.color = "var(--p-primary-contrast-color, #fff)";
				btn.addEventListener("mouseenter", () => { s.filter = "brightness(1.15)"; });
				btn.addEventListener("mouseleave", () => { s.filter = ""; });
				return btn;
			},
			defaultValue: false,
		});

		try {
			app.command?.add?.("DbTagsAutocomplete.OpenStyler", {
				name: "ComfyUI-Easy-DanWiki：打开外观定制器",
				description: "打开 ComfyUI-Easy-DanWiki 的外观与行为设置窗口",
				function: () => openStyler(),
			});
		} catch {
			void 0;
		}
		try {
			app.menu?.addSettingsMenu?.({
				id: "dbtags.openStyler.menu",
				title: "ComfyUI-Easy-DanWiki - 外观定制器",
				label: "ComfyUI-Easy-DanWiki - 外观定制器",
				icon: "pi pi-palette",
				callback: () => openStyler(),
			});
		} catch {
			void 0;
		}
	},
	setup() {
		console.log(`[ComfyUI-Easy-DanWiki] ${VERSION} loaded`);
		dlog("C", "extension loaded");
		// fire-and-forget: a ~25MB fetch + parse must not gate ComfyUI startup;
		// everything index-dependent is guarded (onIndexReady / #update)
		void loadIndex();
		// pysssss suppression is independent of the index (also fixes the old
		// failure path where a bad index left the other completer active)
		disablePysssss();
	},
});
