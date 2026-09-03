import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";
import { $el } from "../../../scripts/ui.js";

/*
  Danbooru bilingual autocomplete (P3: core completion).
  ...same doc...
*/

// stylesheet: load dbtags_autocomplete.css (same dir as this file)
{
	const url = new URL("./dbtags_autocomplete.css", import.meta.url);
	$el("link", { parent: document.head, rel: "stylesheet", type: "text/css", href: url });
}

const ID = "dbtags.autocomplete";
const SKIP_WIDGETS = new Set(["ttN xyPlot.x_values", "ttN xyPlot.y_values"]);
const INDEX_URL = new URL("./data/tags_index.json", import.meta.url).href;
const PYSSSSS_AUTO = "/extensions/comfyui-custom-scripts/js/common/autocomplete.js";
const SEPARATOR = ", ";
const DEBUG = new URLSearchParams(location.search).has("dbtags_debug") ||
		localStorage.getItem(ID + ".debug") === "true";

let index = null;
const _indexReadyCbs = [];
function onIndexReady(cb) {
	if (index) cb();
	else _indexReadyCbs.push(cb);
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
		return Number.isFinite(v) && v > 0 ? v : dflt;
	},
};

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
	for (const ac of AC_INSTANCES) ac.refreshPrefs();
}

function applyConfig() {
	const root = document.documentElement;
	const theme = Config.get("theme", "dark");
	root.classList.toggle("dbtags-theme-dark", theme === "dark");
	root.classList.toggle("dbtags-theme-light", theme === "light");
	root.classList.toggle("dbtags-theme-pink", theme === "pink");
	root.classList.toggle("dbtags-theme-custom", theme === "custom");
	root.classList.toggle("dbtags-width-fixed", Config.get("widthMode", "fit") === "fixed");
	// inline custom vars beat any theme class block; wipe first so built-ins stay clean
	for (const v of CUSTOM_INLINE_VARS) root.style.removeProperty(v);
	if (theme === "custom") {
		const c = getCustomColors();
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
	}
	const w = Config.getNum("width", 340);
	const f = Config.getNum("font", 13);
	const op = Math.min(100, Math.max(25, Config.getNum("opacity", 100)));
	root.style.setProperty("--dbtags-ac-width", w + "px");
	root.style.setProperty("--dbtags-ac-font", f + "px");
	root.style.setProperty("--dbtags-ac-alpha", String(op / 100));
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

function langIsZh() {
	return Config.get("lang", "zh") === "zh";
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
	const mode = Config.get("mode", "pc");
	if (mode === "all") {
		// show everything (safety cap 500), report the true total
		return { list: results.slice(0, 500), total: results.length };
	}
	if (mode === "count") {
		const cap = Config.getNum("maxCount", 30);
		return { list: results.slice(0, cap), total: results.length };
	}
	// post_count priority: drop tags below the threshold, render up to 50
	const minPc = Config.getNum("minPost", 500);
	const filtered = results.filter((r) => r.tag.post_count >= minPc);
	return { list: filtered.slice(0, 50), total: filtered.length, dropped: results.length - filtered.length, minPc };
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

function searchTags(term) {
	const t = term.trim().toLowerCase();
	if (!t) return [];
	const cjk = hasCJK(t);
	const out = [];
	for (const tag of index.tags) {
		const name = tag.name.toLowerCase();
		let matchType = null;
		let matchText = null;
		if (name.includes(t)) {
			matchType = "name";
			matchText = tag.name;
		}
		if (!matchType && !cjk) {
			for (const a of listField(tag.aliases)) {
				if (a.toLowerCase().includes(t)) {
					matchType = "alias";
					matchText = a;
					break;
				}
			}
		}
		if (!matchType && !cjk && pyMode() !== "off") {
			// latin input >= pyMinLen chars: match toneless pinyin of the zh layer
			const q = t.replace(/\s+/g, "");
			if (q.length >= Config.getNum("pyMinLen", 4)) {
				const pys = listField(tag.py);
				for (let i = 0; i < pys.length; i++) {
					if (typeof pys[i] === "string" && pys[i].includes(q)) {
						matchType = "py";
						matchText = zhSources(tag)[i] || pys[i];
						break;
					}
				}
			}
		}
		if (!matchType && cjk) {
			// loose chinese match: translated names first; the new-lib alias
			// table (aliases_zh from translations.jsonl) can be toggled off.
			// Japanese source aliases are NOT scanned for cjk queries.
			const fields = [["zhtag", [tag.zhtag]]];
			if (aliasTableOn()) {
				fields.push(["aliases_zh", listField(tag.aliases_zh)]);
				fields.push(["zh", listField(tag.zh)]);
			}
			for (const [kind, values] of fields) {
				for (const z of values) {
					if (typeof z !== "string") continue;
					if (isSubsequence(t, z)) {
						matchType = kind;
						matchText = z;
						break;
					}
				}
				if (matchType) break;
			}
		}
		if (matchType) out.push({ tag, matchType, matchText });
	}
	out.sort((a, b) => {
		// exact match first (term equals name or the matched alias/zh)
		const ea = a.tag.name.toLowerCase() === t || a.matchText.toLowerCase() === t ? 0 : 1;
		const eb = b.tag.name.toLowerCase() === t || b.matchText.toLowerCase() === t ? 0 : 1;
		if (ea !== eb) return ea - eb;
		const pa = a.tag.name.toLowerCase().startsWith(t) ? 0 : 1;
		const pb = b.tag.name.toLowerCase().startsWith(t) ? 0 : 1;
		if (pa !== pb) return pa - pb;
		const ra = typeRank(a.matchType);
		const rb = typeRank(b.matchType);
		if (ra !== rb) return ra - rb;
		return b.tag.post_count - a.tag.post_count;
	});
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

/* shared query pipeline (real popup + styler lab use this exact path) */
function runQuery(term, word) {
	const t0 = performance.now();
	let results = searchTags(word);
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
		const lower = tag.name.toLowerCase();
		const pos = lower.indexOf(word);
		parts.push(
			$el(
				"span.dbtags-ac-name",
				{},
				[
					$el("span", { textContent: tag.name.substr(0, pos) }),
					$el("span.dbtags-ac-highlight", { textContent: tag.name.substr(pos, word.length) }),
					$el("span", { textContent: tag.name.substr(pos + word.length) }),
				]
			)
		);
	} else {
		parts.push($el("span.dbtags-ac-name", { textContent: tag.name }));
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
		if (!this.showWiki) this.panelStack.style.display = "none";
		this.selected = null;
		this.current = [];
		this._addedTags = new Set();
		this._previewEl = null;
		this._previewTimer = null;
		this._toastEl = null;
		this._toastTimer = null;
		this.el.addEventListener("keydown", this.#onKeyDown.bind(this));
		this.el.addEventListener("keyup", this.#onKeyUp.bind(this));
		this.el.addEventListener("click", this.#hide.bind(this));
		this.el.addEventListener("blur", () =>
			setTimeout(() => {
				// keep open when the click landed inside our own UI (toggles, image)
				if (this._lastDownTarget && this.wrap.contains(this._lastDownTarget)) return;
				this.#hide();
			}, 150)
		);
		document.addEventListener("mousedown", this.#onDocDown.bind(this));
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
				if (p.tag) this.#insertTagAhead(p.tag.name, p.insert);
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
		if (!tag) return;
		p.tag = tag;
		p.title.textContent = `${tag.name}  ${fmtCount(tag.post_count)}`;
		p.insert.textContent = this._addedTags.has(tag.name) ? "✓" : "+";
		if (this.showSummary) {
			this.#renderSummary(p, wikiText(tag) || "(无 wiki 释义)", hl || this._highlightTerms);
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
		this.showSummary = Config.get("showSummary", "true") !== "false";
		this.showImage = Config.get("showImage", "true") !== "false";
		this.showLinks = Config.get("showLinks", "true") !== "false";
		this.showWiki = Config.get("showWiki", "true") !== "false";
		this.panelImg = Config.get("panelImg", "false") !== "false";
		this.panelStack.style.display = this.showWiki ? "" : "none";
		this.#syncPanelMode();
		if (this.selected) this.#renderPanel(this.mainPanel, this.selected.tag);
		if (this.showWiki && this.#visible()) this.#place();
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
				title: "插入到当前词前方",
				onclick: (e) => {
					e.stopPropagation();
					this.#insertTagAhead(l.n, plus);
				},
			});
			cap.append(plus, lab.main);
			if (lab.en) cap.append($el("span.dbtags-ac-link-en", { textContent: ` (${lab.en})` }));
			cap.addEventListener("click", (e) => {
				e.stopPropagation();
				this.#navTo(l.n);
			});
			cap.addEventListener("mouseenter", (e) => this.#showPreview(l.n, e));
			cap.addEventListener("mouseleave", () => this.#hidePreview());
			p.links.append(cap);
		}
	}

	/* insert the tag right BEFORE the current word at the caret (no hiding) */
	#insertTagAhead(name, plusEl) {
		const caret = this.el.selectionStart;
		const before = this.el.value.substring(0, caret);
		const m = before.match(/([^,;"|{}()\n]+)$/);
		let tokenStart = m ? caret - m[0].length : caret;
		if (m) {
			// skip leading whitespace of the token so we insert right before the word
			const lead = m[0].match(/^\s+/);
			if (lead) tokenStart += lead[0].length;
		}
		const prevChar = before[tokenStart - 1];
		const sep = prevChar === " " || prevChar === "\t" ? ", " : ",";
		const ins = name + sep;
		this.el.selectionStart = this.el.selectionEnd = tokenStart;
		let pasted = true;
		try {
			if (!document.execCommand("insertText", false, ins)) pasted = false;
		} catch (e) {
			pasted = false;
		}
		if (!pasted) {
			this.el.setRangeText(ins, tokenStart, tokenStart, "end");
		}
		this.el.selectionStart = this.el.selectionEnd = tokenStart + ins.length;
		this.el.focus();
		this.#sync();
		dlog("D", "insert ahead", name, "->", this.el.value);
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
		p.summary.replaceChildren();
		if (!text) return;
		const terms = (hl || []).filter(Boolean);
		// split into text runs and clickable [[...]] links
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
					this.#navTo(piece.target);
				});
				cap.addEventListener("mouseenter", (e) => this.#showPreview(piece.target, e));
				cap.addEventListener("mouseleave", () => this.#hidePreview());
				p.summary.append(cap);
			} else {
				const seg = this.#highlightSeg(piece.text, terms);
				if (seg) {
					p.summary.append(seg.before, seg.hit, seg.after);
				} else {
					p.summary.append(piece.text);
				}
			}
		}
	}

	#highlightSeg(text, terms) {
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
		const base = `/dbtags/image?tag=${encodeURIComponent(tag.name)}&size=`;
		const setSrc = (size) => {
			p.img.onload = () => { p.img.style.display = ""; };
			p.img.onerror = () => { p.img.style.display = "none"; };
			p.img.src = base + size;
		};
		p.img.onclick = () => window.open(base + "large", "_blank");
		p.img.onmouseenter = null;
		p.img.onmouseleave = null;
		if (mode === "small") {
			p.img.onmouseenter = () => setSrc("large");
			p.img.onmouseleave = () => setSrc("small");
			setSrc("small");
		} else {
			setSrc("large");
		}
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
		if (!this.#visible()) return;
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
	}

	/* ---- wiki navigation (P14): A = expand panels to the right, B = replace ---- */
	#navTo(name) {
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
		this._previewTimer = setTimeout(() => {
			const tag = getTagMap().get(normName(name));
			if (!tag) return;
			if (!this._previewEl) {
				this._previewEl = $el("div.dbtags-ac-preview");
				document.body.append(this._previewEl);
			}
			this._previewEl.replaceChildren(
				$el("div.dbtags-ac-preview-title", { textContent: `${tag.name}  ${fmtCount(tag.post_count)}` }),
				$el("div.dbtags-ac-preview-text", {
					textContent: wikiText(tag)
						? wikiText(tag).replace(/\[\[|\]\]/g, "").slice(0, 100) + (wikiText(tag).length > 100 ? "…" : "")
						: "(无 wiki 释义)",
				})
			);
			const r = event.currentTarget.getBoundingClientRect();
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
		this.helper.insertAtCursor(tag.name + sep, -(token?.raw.length ?? 0));
		this.#sync();
		dlog("D", "insert", tag.name, "token was", token?.raw, "耗时", Math.round(performance.now() - t0) + "ms");
		this.#hide();
		setTimeout(() => this.#update(), 120);
	}

	async #update() {
		const token = this.#token();
		if (!token) {
			this.#hide();
			return;
		}
		// legacy '[' brackets are ignored (phrase-exact mode removed); search is plain substring now
		const term = token.raw.replace(/\[|\]/g, "").trim();
		const word = term.replace(/\s+/g, "_");
		// terms used to highlight matches in the wiki panel
		this._highlightTerms = term ? [term] : [];
		this._querySeq = (this._querySeq || 0) + 1;
		const seq = this._querySeq;
		const { list, total, dropped, minPc, isFuzzy } = runQuery(term, word);
		if (seq !== this._querySeq) return; // stale result, drop it
		if (!list.length) {
			if (!total) {
				// mid-phrase typing (has a space): keep the panel open with a hint
				if (term.includes(" ") && Config.get("fuzzy", "always") !== "off") {
					this.#showEmpty(`无匹配 — 正文需输入完整短语（${term}）`);
					return;
				}
				this.#hide();
				return;
			}
			this.#showEmpty(`低于最低热度，换关键词或调低阈值（设置中心可调）`);
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
		this.#place();
		const prev = this.selected;
		this.#setSelected(items.indexOf(prev?.el) >= 0 ? prev : this.current[0]);
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
		this.selected = null;
		this.current = [];
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
	setInterval(() => {
		document.querySelectorAll(".pysssss-autocomplete").forEach((dd) => dd.remove());
	}, 300);
}

async function loadIndex() {
	const t0 = performance.now();
	const resp = await fetch(INDEX_URL, { cache: "no-store" });
	if (resp.status !== 200) {
		console.error(`[dbtags] index fetch failed: ${resp.status} ${resp.statusText}`);
		return false;
	}
	index = await resp.json();
	dlog("C", `index loaded: ${index.count} tags, ${Math.round(performance.now() - t0)}ms`);
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
	bracketNav: "true",
	debug: "false",
	mode: "pc",
	minPost: 500,
	maxCount: 30,
	imgMode: "large",
	navMode: "A",
	widthMode: "fit",
	width: 340,
	font: 13,
	customVars: "",
};

const THEME_DESC = {
	scope: "Danbooru 补全浮窗（custom 主题）",
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

class Styler {
	constructor() {
		this.swatchEls = [];
		this.colorInputs = {};
		this.el = $el("div.dbtags-ac-styler");
		const head = $el("div.dbtags-ac-styler-head", { textContent: "外观定制器" });
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
	}

	close() {
		this.el.remove();
		_styler = null;
	}

	/* every control write funnels through here: store -> re-apply -> live everywhere */
	#set(key, value) {
		Config.set(key, String(value));
		applyConfig();
		for (const ac of AC_INSTANCES) ac.refreshPrefs();
		this.#syncPreviewPanel();
		this.#labRefresh();
	}

	#comboRow(label, key, options, dflt) {
		const sel = $el("select");
		for (const [v, t] of options) {
			sel.append($el("option", { value: v, textContent: t }));
		}
		sel.value = Config.get(key, dflt);
		sel.onchange = () => this.#set(key, sel.value);
		return $el("div.dbtags-ac-styler-row", {}, [
			$el("span.dbtags-ac-styler-label", { textContent: label }), sel,
		]);
	}

	#boolRow(label, key, dflt = "true") {
		const cb = $el("input", { type: "checkbox" });
		cb.checked = Config.get(key, dflt) !== "false";
		cb.onchange = () => this.#set(key, cb.checked);
		return $el("div.dbtags-ac-styler-row", {}, [
			$el("span.dbtags-ac-styler-label", { textContent: label }), cb,
		]);
	}

	#sliderRow(label, key, min, max, dflt, fmt) {
		const range = $el("input", { type: "range", min: String(min), max: String(max) });
		range.value = String(Config.getNum(key, dflt));
		const val = $el("span.dbtags-ac-styler-val");
		const show = () => val.textContent = (fmt || ((x) => x + ""))(range.value);
		range.oninput = () => { show(); this.#set(key, range.value); };
		show();
		return $el("div.dbtags-ac-styler-row", {}, [
			$el("span.dbtags-ac-styler-label", { textContent: label }), range, val,
		]);
	}

	#group(title) {
		const g = $el("div.dbtags-ac-styler-group");
		g.append($el("b", { textContent: title }));
		this.ctrl.append(g);
		return g;
	}

	#refreshSwatches() {
		const theme = Config.get("theme", "dark");
		for (const s of this.swatchEls) {
			s.classList.toggle("dbtags-ac-sw--on", s.dataset.v === theme);
		}
		const custom = this.swatchEls.find((s) => s.dataset.v === "custom");
		if (custom) {
			const c = getCustomColors();
			custom.style.background = `linear-gradient(135deg, ${c.bg} 45%, ${c.highlight} 45%)`;
		}
		this.#syncPickers();
	}

	#buildControls() {
		const gTheme = this.#group("主题");
		const swRow = $el("div.dbtags-ac-styler-row");
		for (const [v, t, bg, ac] of [
			["dark", "黑灰", "#33383f", "#4da3ff"],
			["light", "米白", "#f1eee9", "#1e6fd9"],
			["pink", "喵粉", "#f8e7ee", "#ec62a1"],
			["custom", "自定义", "", ""],
		]) {
			const sw = $el("button.dbtags-ac-sw", {
				textContent: t,
				onclick: () => {
					this.#set("theme", v);
					this.#refreshSwatches();
				},
			});
			sw.dataset.v = v;
			if (v !== "custom") sw.style.background = `linear-gradient(135deg, ${bg} 45%, ${ac} 45%)`;
			this.swatchEls.push(sw);
			swRow.append(sw);
		}
		gTheme.append(swRow, $el("div.dbtags-ac-styler-hint", {
			textContent: "选「自定义」后可逐色取色，改动即时生效",
		}));
		this.pickerBox = $el("div.dbtags-ac-styler-pickers");
		gTheme.append(this.pickerBox);
		this.#buildPickers();

		const gSize = this.#group("尺寸与透明度");
		gSize.append(
			this.#sliderRow("透明度", "opacity", 25, 100, 100, (x) => x + "%"),
			this.#sliderRow("字号", "font", 11, 18, 13, (x) => x + "px"),
			this.#comboRow("宽度模式", "widthMode", [["fit", "撑开（随内容）"], ["fixed", "固定"]], "fit"),
			this.#sliderRow("列表宽度", "width", 240, 800, 340, (x) => x + "px"),
		);

		const gMatch = this.#group("匹配与搜索");
		gMatch.append(
			this.#comboRow("匹配语言", "lang", [["zh", "中文（回退英文）"], ["en", "English"]], "zh"),
			this.#boolRow("别名表", "aliasTable"),
			this.#comboRow("拼音命中", "pyMode", [["zh-first", "拼音结果靠前"], ["en-first", "英文结果靠前"], ["off", "关闭"]], "zh-first"),
			this.#sliderRow("拼音最小长度", "pyMinLen", 1, 12, 4),
			this.#comboRow("正文匹配", "fuzzy", [["always", "始终"], ["fallback", "兜底"], ["off", "关"]], "always"),
			this.#sliderRow("最低post数", "minPost", 1, 2000, 500),
			this.#sliderRow("最多候选数", "maxCount", 10, 60, 30),
		);

		const gMode = this.#group("候选与数据");
		gMode.append(
			this.#comboRow("候选模式", "mode", [["pc", "post_count 优先（过滤低热度）"], ["count", "数量优先（最多 N 个）"], ["all", "全部显示（可能卡顿）"]], "pc"),
			this.#boolRow("调试日志", "debug"),
		);
		this.dataHintEl = $el("div.dbtags-ac-styler-hint", { textContent: this.#dataInfo() });
		gMode.append(this.dataHintEl);
		onIndexReady(() => {
			if (this.dataHintEl?.isConnected) this.dataHintEl.textContent = this.#dataInfo();
		});

		const gPanel = this.#group("wiki 面板");
		gPanel.append(
			this.#boolRow("打开面板", "showWiki"),
			this.#boolRow("释义", "showSummary"),
			this.#boolRow("示例图", "showImage"),
			this.#boolRow("跳转胶囊", "showLinks"),
			this.#boolRow("图片优先", "panelImg", "false"),
			this.#comboRow("示例图尺寸", "imgMode", [["large", "大图"], ["small", "缩略图(悬停放大)"]], "large"),
			this.#comboRow("跳转展开", "navMode", [["A", "分栏展开"], ["B", "替换当前栏"]], "A"),
			this.#boolRow("括号键导航", "bracketNav"),
		);
		const gDanger = this.#group("重置");
		gDanger.append($el("button.dbtags-ac-styler-reset", {
			textContent: "全部设置恢复默认（含自定义配色）",
			onclick: () => {
				if (!confirm("清空全部 Danbooru 补全设置并恢复默认？不影响索引/翻译数据。")) return;
				for (const k of Object.keys(localStorage)) {
					if (k.startsWith(ID + ".")) localStorage.removeItem(k);
				}
				getCustomColors.cache = null;
				applyConfig();
				for (const ac of AC_INSTANCES) ac.refreshPrefs();
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
		for (const ac of AC_INSTANCES) ac.refreshPrefs();
		this.close();
		openStyler();
	}

	#buildPreview() {
		const mk = (cls, kids) => $el("div." + cls, {}, kids);
		this.labInput = $el("input.dbtags-ac-styler-lab-input", {
			placeholder: "像平时一样打字试匹配：girl / 美 / cha / nan…",
		});
		this.labInput.value = "girl";
		this.labInput.oninput = () => this.#labRefresh();
		this.labList = mk("dbtags-ac-list.dbtags-ac-styler-lab-list");
		this.labStats = $el("div.dbtags-ac-styler-lab-stats");
		const lab = $el("div.dbtags-ac-styler-lab", {}, [
			$el("div.dbtags-ac-styler-lab-title", { textContent: "搜索试验台（与真实补全同一管线）" }),
			this.labInput, this.labList, this.labStats,
		]);
		this.pSummary = $el("div.dbtags-ac-panel-summary", {}, [
			document.createTextNode("只包含一名女性角色的图像。另见 "),
			$el("span.dbtags-ac-link", { textContent: "solo" }),
			document.createTextNode(" 、 "),
			$el("span.dbtags-ac-link.dbtags-ac-link--added", { textContent: "looking_at_viewer" }),
			document.createTextNode(" 。示例图展示持伞回眸的猫耳少女，霓虹雨夜氛围。"),
		]);
		this.pLinks = mk("dbtags-ac-panel-links", [
			$el("span.dbtags-ac-link", { textContent: "+ cat_ears（猫耳）" }),
			$el("span.dbtags-ac-link", { textContent: "+ holding_umbrella（撑伞）" }),
		]);
		this.pImg = $el("div.dbtags-ac-panel-img.dbtags-ac-fakeimg");
		const panel = mk("dbtags-ac-panel", [
			mk("dbtags-ac-panel-head", [
				$el("div.dbtags-ac-panel-title", { textContent: "1girl  8.3M" }),
				$el("span.dbtags-ac-plus", { textContent: "+" }),
			]),
			this.pSummary, this.pLinks, this.pImg,
		]);
		this.panelWrap = mk("dbtags-ac-wrap.dbtags-ac-preview-wrap", [mk("dbtags-ac-panelstack", [panel])]);
		this.prev.append(lab, this.panelWrap);
		this.#syncPreviewPanel();
		this.#labRefresh();
	}

	#labRefresh() {
		if (!this.labInput) return;
		const term = this.labInput.value.replace(/\[|\]/g, "").trim();
		if (!term) {
			this.labList.replaceChildren();
			this.labStats.textContent = "输入以测试";
			return;
		}
		if (!index) {
			this.labList.replaceChildren();
			this.labStats.textContent = "数据加载中…（就绪后自动刷新）";
			onIndexReady(() => this.#labRefresh());
			return;
		}
		const word = term.replace(/\s+/g, "_");
		const { list, total, dropped, minPc } = runQuery(term, word);
		const rows = list.map((item, i) => {
			const row = buildItemRow(item, word);
			if (i === 0) row.classList.add("dbtags-ac-item--selected");
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
			(bodyHits ? ` · 其中正文匹配 ${bodyHits}` : "");
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
		if (!index) return "数据未加载";
		let mn = Infinity;
		for (const t of index.tags) if (t.post_count < mn) mn = t.post_count;
		return `数据：v${index.version} · ${index.count} 标签 · 源站热度下限 ${mn} · 构建于 ${index.built_at}`;
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
					new DBTagsAutoComplete(inputEl, r.widget);
				}
			}
			return r;
		};

		// P17: single entry point — every setting lives in the styler window
		// (storage keys unchanged, existing values keep working)
		app.ui.settings.addSetting({
			id: ID + ".openStyler",
			name: "Danbooru 补全 - 外观定制器",
			type: "combo",
			defaultValue: "",
			options: [
				{ value: "", text: "（选择以打开）" },
				{ value: "open", text: "打开外观定制器" },
			],
			onChange: (value) => {
				if (value !== "open") return;
				openStyler();
				try { app.ui.settings.setSettingValue?.(ID + ".openStyler", ""); } catch { void 0; }
			},
		});
	},
	async setup() {
		dlog("C", "extension loaded");
		const ok = await loadIndex();
		if (!ok) return;
		disablePysssss();
	},
});
