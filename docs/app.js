"use strict";

// Reference UI: Opencc-Fmmseg WASM demo. Engine: unmodified opencc_purepy 1.5.3.
// Pyodide is intentionally NOT downloaded until Initialize Pyodide is clicked.
import {detectCjkEncoding} from "./cjkEncodingDetector.js";

const $ = id => document.getElementById(id);
const PACKAGE_VERSION = "1.5.3b1";
const PYPI_VERSION = "1.5.2";
const WHEEL_NAME = `opencc_purepy-${PACKAGE_VERSION}-py3-none-any.whl`;
const PYODIDE_VERSION = "314.0.8";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let pyodide = null;
let ready = false;
let busy = false;
let dictionaryCardId = 0;
let availableDictionarySlots = [];
let fileName = "";
let fileBytes = null;
let preservingFile = false;
let officeDownloadUrl = null;
let officeDownloadName = "";
let editorLeft;
let editorRight;

const configDescriptions = {
    s2t: "Simplified Chinese → Traditional Chinese",
    t2s: "Traditional Chinese → Simplified Chinese",
    s2tw: "Simplified Chinese → Traditional Chinese (Taiwan)",
    s2twp: "Simplified Chinese → Traditional Chinese (Taiwan, phrases)",
    tw2s: "Traditional Chinese (Taiwan) → Simplified Chinese",
    tw2sp: "Traditional Chinese (Taiwan, phrases) → Simplified Chinese",
    s2hk: "Simplified Chinese → Traditional Chinese (Hong Kong)",
    s2hkp: "Simplified Chinese → Traditional Chinese (Hong Kong, phrases)",
    hk2s: "Traditional Chinese (Hong Kong) → Simplified Chinese",
    hk2sp: "Traditional Chinese (Hong Kong, phrases) → Simplified Chinese",
    t2tw: "Traditional Chinese → Traditional Chinese (Taiwan)",
    t2twp: "Traditional Chinese → Traditional Chinese (Taiwan, phrases)",
    tw2t: "Traditional Chinese (Taiwan) → Traditional Chinese",
    tw2tp: "Traditional Chinese (Taiwan, phrases) → Traditional Chinese",
    t2hk: "Traditional Chinese → Traditional Chinese (Hong Kong)",
    t2hkp: "Traditional Chinese → Traditional Chinese (Hong Kong, phrases)",
    hk2t: "Traditional Chinese (Hong Kong) → Traditional Chinese",
    hk2tp: "Traditional Chinese (Hong Kong, phrases) → Traditional Chinese",
    t2jp: "Traditional Chinese → Japanese Shinjitai",
    jp2t: "Japanese Shinjitai → Traditional Chinese",
    s2seal: "Simplified Chinese → Small Seal Script",
    t2seal: "Traditional Chinese → Small Seal Script",
    seal2s: "Small Seal Script → Simplified Chinese",
    seal2t: "Small Seal Script → Traditional Chinese"
};

const fmtCount = text => Array.from(text).length.toLocaleString();
const errorText = error => error instanceof Error ? error.message : String(error);

function log(message) {
    const area = $("out");
    area.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
    if (area.textContent.length > 45000) area.textContent = area.textContent.slice(-30000);
    area.scrollTop = area.scrollHeight;
}

function status(message) {
    $("engineStatus").textContent = message;
    log(message);
}

function info(message) {
    log(message);
}

function updateConfigDescription() {
    $("configDescription").textContent = configDescriptions[$("config").value] ?? "";
}

function refresh() {
    $("initialize").disabled = busy || ready;
    $("initialize").textContent = ready ? "Initialized" : busy && !ready ? "Initializing…" : "Initialize Pyodide";
    for (const id of ["btn", "config", "normalizeBtn", "deTofuBtn", "smoke", "large", "addDictionaryBtn", "applyDictionariesBtn", "resetDictionariesBtn"])
        $(id).disabled = busy || !ready;
    $("officeDrop").classList.toggle("disabled", busy || !ready);
    $("officeDrop").setAttribute("aria-disabled", String(busy || !ready));
    $("inputCount").textContent = fmtCount(editorLeft.get());
    $("outputCount").textContent = fmtCount(editorRight.get());
}

async function runBusy(action) {
    if (busy) return;
    busy = true;
    refresh();
    try {
        await action();
    } catch (error) {
        info(`ERROR: ${errorText(error)}`);
        console.error(error);
    } finally {
        busy = false;
        refresh();
    }
}

function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function pyResult(name) {
    return pyodide.globals.get(name);
}

async function pyRun(code) {
    return pyodide.runPythonAsync(code);
}

function setPy(name, value) {
    pyodide.globals.set(name, value);
}

function initializeTheme() {
    const root = document.documentElement;
    const button = $("themeToggle");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let preference = null;
    try {
        preference = localStorage.getItem("opencc-theme");
    } catch (_) { /* optional */
    }
    if (preference !== "light" && preference !== "dark") preference = null;

    function apply() {
        const dark = preference ? preference === "dark" : media.matches;
        root.dataset.theme = dark ? "dark" : "light";
        button.textContent = dark ? "☀ Light" : "☾ Dark";
        button.setAttribute("aria-pressed", String(dark));
        button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    }

    button.addEventListener("click", () => {
        preference = root.dataset.theme === "dark" ? "light" : "dark";
        try {
            localStorage.setItem("opencc-theme", preference);
        } catch (_) { /* optional */
        }
        apply();
    });
    if (media.addEventListener) media.addEventListener("change", () => {
        if (!preference) apply();
    });
    else if (media.addListener) media.addListener(() => {
        if (!preference) apply();
    });
    apply();
}

// The reference demo uses CodeMirror with line numbers. Keep an editable
// textarea fallback if the external editor CDN is unavailable/offline.
async function makeEditors() {
    const initialText = "汉字转换测试：计算机软件和网络。";

    function makeFallback(id, value, readOnly, onChange) {
        const field = document.createElement("textarea");
        field.className = "editor-textarea-fallback";
        field.value = value;
        field.readOnly = readOnly;
        field.spellcheck = false;
        $(id).appendChild(field);
        field.addEventListener("input", onChange);
        return {
            get: () => field.value, set: text => {
                field.value = text;
                onChange?.();
            }, focus: () => field.focus()
        };
    }

    // Render native editors immediately; CodeMirror progressively enhances them.
    editorLeft = makeFallback("editor-left", initialText, false, onInputChanged);
    editorRight = makeFallback("editor-right", "", true, onOutputChanged);
    refresh();
    try {
        const [{EditorState}, {EditorView, keymap, lineNumbers}, {
            defaultKeymap,
            history,
            historyKeymap
        }] = await Promise.all([
            import("https://esm.sh/@codemirror/state"),
            import("https://esm.sh/@codemirror/view"),
            import("https://esm.sh/@codemirror/commands")
        ]);

        function create(id, value, readOnly, onChange) {
            const view = new EditorView({
                parent: $(id),
                state: EditorState.create({
                    doc: value,
                    extensions: [
                        lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
                        EditorView.lineWrapping, EditorView.editable.of(!readOnly),
                        EditorState.readOnly.of(readOnly),
                        EditorView.updateListener.of(update => {
                            if (update.docChanged) onChange?.();
                        })
                    ]
                })
            });
            return {
                get: () => view.state.doc.toString(),
                set: text => view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: text}}),
                focus: () => view.focus()
            };
        }

        const currentInput = editorLeft.get();
        const currentOutput = editorRight.get();
        $("editor-left").replaceChildren();
        $("editor-right").replaceChildren();
        editorLeft = create("editor-left", currentInput, false, onInputChanged);
        editorRight = create("editor-right", currentOutput, true, onOutputChanged);
    } catch (error) {
        console.warn("CodeMirror unavailable; keeping native textareas", error);
        info("CodeMirror CDN unavailable; using native textareas.");
    }
    refresh();
}

function clearOpenedTextFile() {
    fileName = "";
    fileBytes = null;
    $("openedFileName").textContent = "";
}

function onInputChanged() {
    if (!preservingFile) clearOpenedTextFile();
    if (editorLeft) $("inputCount").textContent = fmtCount(editorLeft.get());
}

function onOutputChanged() {
    if (editorRight) $("outputCount").textContent = fmtCount(editorRight.get());
}

function setInput(text, preserveFile = false) {
    preservingFile = preserveFile;
    try {
        editorLeft.set(text);
    } finally {
        preservingFile = false;
    }
}

function setOutput(text) {
    editorRight.set(text);
}

function loadPyodideScript() {
    if (typeof window.loadPyodide === "function") return Promise.resolve();
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `${PYODIDE_CDN}pyodide.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not download Pyodide. Check CDN/network access."));
        document.head.appendChild(script);
    });
}

async function initialize() {
    await runBusy(async () => {
        status(`Loading Pyodide ${PYODIDE_VERSION}...`);
        await loadPyodideScript();
        pyodide = await window.loadPyodide({indexURL: PYODIDE_CDN});
        status("Loading micropip...");
        await pyodide.loadPackage("micropip");
        const url = new URL(`./wheels/${WHEEL_NAME}`, location.href).href;
        let haveLocalWheel = false;
        try {
            const response = await fetch(url, {method: "HEAD"});
            haveLocalWheel = response.ok;
        } catch (_) { /* hosted wheel absent; install official PyPI wheel */
        }
        if (haveLocalWheel) {
            status(`Installing local wheel (${WHEEL_NAME})...`);
            setPy("_web_wheel_url", url);
            await pyRun("import micropip\nawait micropip.install(_web_wheel_url)");
        } else {
            status(`Local wheel absent; installing opencc-purepy==${PYPI_VERSION} from PyPI...`);
            setPy("_web_package_spec", `opencc-purepy==${PYPI_VERSION}`);
            await pyRun("import micropip\nawait micropip.install(_web_package_spec)");
        }
        status("Importing engine and loading dictionaries...");
        await pyRun(String.raw`
import json
from opencc_purepy import OpenCC, DictSlot
from opencc_purepy.dictionary_lib import DictionaryMaxlength
_web_cc = OpenCC("s2t")
assert _web_cc.get_last_error() is None, _web_cc.get_last_error()
_web_configs = OpenCC.supported_configs()
_web_slots = OpenCC.available_slots()

def _web_replace_dictionaries(json_specs, reset=False):
    global _web_cc
    current = _web_cc.get_config()
    if reset:
        replacement = OpenCC(current)
    else:
        # Always build a fresh, private container. Never mutate the shared provider.
        dictionary = DictionaryMaxlength.from_json()
        for spec in json.loads(json_specs):
            pairs = dict(spec["pairs"])
            if spec["mode"] == "override":
                dictionary.with_custom_dicts(overrides={spec["slot"]: pairs})
            elif spec["mode"] == "append":
                dictionary.with_custom_dicts(appends={spec["slot"]: pairs})
            else:
                raise ValueError("Invalid custom dictionary mode: " + spec["mode"])
        replacement = OpenCC(current, dictionary=dictionary)
    if replacement.get_last_error():
        raise RuntimeError(replacement.get_last_error())
    _web_cc = replacement
`);
        const configsProxy = pyResult("_web_configs");
        const slotsProxy = pyResult("_web_slots");
        const configs = configsProxy.toJs();
        availableDictionarySlots = slotsProxy.toJs();
        configsProxy.destroy();
        slotsProxy.destroy();
        $("config").replaceChildren(...configs.map(config => {
            const option = document.createElement("option");
            option.value = option.textContent = config;
            return option;
        }));
        $("config").value = "s2t";
        updateConfigDescription();
        $("supported").textContent = configs.join(", ");
        ready = true;
        await pyRun(`
from importlib.metadata import version
_web_version = version("opencc-purepy")
`);
        const installedVersion = pyResult("_web_version");
        $("packageVersion").textContent = installedVersion;
        status(`Ready: ${configs.length} configs; wheel ${installedVersion}; ${availableDictionarySlots.length} dictionary slots`);
    });
}

async function convert(text, config, punctuation) {
    setPy("_web_input", text);
    setPy("_web_config", config);
    setPy("_web_punctuation", punctuation);
    await pyRun(String.raw`
_web_cc.set_config(_web_config)
_web_result = _web_cc.convert(_web_input, punctuation=_web_punctuation)
assert not _web_result.startswith("Conversion failed:"), _web_result
`);
    return pyResult("_web_result");
}

async function doConvert() {
    await runBusy(async () => {
        const input = editorLeft.get();
        if (!input) return info("Convert: input is empty.");
        const config = $("config").value;
        const punctuation = $("punctuation").checked;
        info(`Converting (${config})...`);
        await nextPaint();
        const start = performance.now();
        const converted = await convert(input, config, punctuation);
        const elapsed = performance.now() - start;
        setPy("_web_result", converted);
        await pyRun("_web_check = _web_cc.zho_check(_web_result)");
        const kind = pyResult("_web_check");
        const language = kind === 1 ? "Traditional Chinese" : kind === 2 ? "Simplified Chinese" : "Other";
        const charsPerSecond = elapsed > 0 ? Array.from(input).length / (elapsed / 1000) : 0;
        info(`Config: ${config}\nPunctuation: ${punctuation ? "enabled" : "disabled"}\nCharacters processed: ${fmtCount(input)}\nOutput characters: ${fmtCount(converted)}\nConversion time: ${elapsed.toFixed(2)} ms\nThroughput: ${(charsPerSecond / 1e6).toFixed(2)}M chars/sec\nOutput language detected: ${language}`);
        await nextPaint();
        setOutput(converted);
    });
}

async function smoke() {
    await runBusy(async () => {
        info("Running smoke tests...");
        const activeConfig = $("config").value;
        try {
            for (const [config, input, expected] of [["s2t", "汉字", "漢字"], ["t2s", "漢字", "汉字"]]) {
                const actual = await convert(input, config, false);
                if (actual !== expected) throw new Error(`${config}: expected ${expected}, got ${actual}`);
                info(`PASS ${config}: ${input} → ${actual}`);
            }
        } finally {
            setPy("_web_restore_config", activeConfig);
            await pyRun("_web_cc.set_config(_web_restore_config)");
        }
        const configsProxy = pyResult("_web_configs");
        const count = configsProxy.toJs().length;
        configsProxy.destroy();
        if (count !== 24) throw new Error(`Expected 24 configs, got ${count}`);
        info("Smoke tests passed (2 conversions + 24-config count).");
    });
}

async function largeTest() {
    await runBusy(async () => {
        const sample = "汉 ".repeat(600000);
        info(`Large test: ${sample.length.toLocaleString()} characters; >1,000 ranges...`);
        await nextPaint();
        const start = performance.now();
        const activeConfig = $("config").value;
        let result;
        try {
            result = await convert(sample, "s2t", false);
        } finally {
            setPy("_web_restore_config", activeConfig);
            await pyRun("_web_cc.set_config(_web_restore_config)");
        }
        if (!result.startsWith("漢 ") || result.length !== sample.length || result !== "漢 ".repeat(600000))
            throw new Error("Large test output mismatch");
        info(`Large test PASS in ${((performance.now() - start) / 1000).toFixed(2)} s (full output verified, not displayed)`);
    });
}

function addDictionaryCard() {
    if (!ready) return;
    const id = ++dictionaryCardId;
    const card = document.createElement("div");
    card.className = "dictionary-card";
    card.dataset.dictionaryId = String(id);
    card.innerHTML = `
      <div class="dictionary-fields">
        <strong>Dictionary ${id}</strong>
        <label for="dictionarySlot${id}">Slot <select id="dictionarySlot${id}" class="dictionary-slot"></select></label>
        <label for="dictionaryMode${id}">Mode <select id="dictionaryMode${id}" class="dictionary-mode"><option value="append">append</option><option value="override">override</option></select></label>
        <button type="button" class="dictionary-remove" aria-label="Remove dictionary ${id}">Remove</button>
      </div>
      <div class="dictionary-entries-heading">
        <label for="dictionaryPairs${id}">Entries</label>
        <button type="button" class="dictionary-insert-tab">Insert Tab at cursor</button>
      </div>
      <textarea id="dictionaryPairs${id}" aria-describedby="dictionaryHelp" spellcheck="false" placeholder="source&#9;target"></textarea>`;
    const slotSelect = card.querySelector(".dictionary-slot");
    for (const slot of availableDictionarySlots) {
        const option = document.createElement("option");
        option.value = option.textContent = slot;
        slotSelect.appendChild(option);
    }
    const used = new Set(Array.from($("dictionaryCards").querySelectorAll(".dictionary-slot"), el => el.value));
    slotSelect.value = availableDictionarySlots.find(slot => !used.has(slot)) ?? availableDictionarySlots[0];
    card.querySelector(".dictionary-remove").addEventListener("click", () => card.remove());
    const textarea = card.querySelector("textarea");
    const tabButton = card.querySelector(".dictionary-insert-tab");
    tabButton.addEventListener("pointerdown", event => event.preventDefault());
    tabButton.addEventListener("click", () => {
        const {selectionStart, selectionEnd} = textarea;
        textarea.focus({preventScroll: true});
        textarea.setRangeText("\t", selectionStart, selectionEnd, "end");
    });
    let escapeTab = false;
    textarea.addEventListener("keydown", event => {
        if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !escapeTab) {
            event.preventDefault();
            textarea.setRangeText("\t", textarea.selectionStart, textarea.selectionEnd, "end");
        }
        escapeTab = event.key === "Escape";
    });
    $("dictionaryCards").appendChild(card);
    slotSelect.focus();
}

function parseDictionaryCards() {
    const specs = [];
    const seen = new Set();
    for (const card of $("dictionaryCards").children) {
        const title = `Dictionary ${card.dataset.dictionaryId}`;
        const slot = card.querySelector(".dictionary-slot").value;
        const mode = card.querySelector(".dictionary-mode").value;
        if (!availableDictionarySlots.includes(slot)) throw new Error(`${title}: invalid slot ${slot}`);
        if (mode !== "append" && mode !== "override") throw new Error(`${title}: invalid mode ${mode}`);
        if (seen.has(slot)) throw new Error(`${title}: duplicate slot ${slot}. Use one card per slot.`);
        seen.add(slot);
        const pairs = [];
        for (const [i, raw] of card.querySelector("textarea").value.split(/\r?\n/).entries()) {
            let line = raw;
            if (i === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
            line = line.trimEnd();
            if (!line || line.trimStart().startsWith("#")) continue;
            const tab = line.indexOf("\t");
            if (tab < 0) throw new Error(`${title}, line ${i + 1}: missing TAB separator`);
            const source = line.slice(0, tab).trim();
            const target = line.slice(tab + 1).trim().split(/\s+/)[0] || "";
            if (!source || !target) throw new Error(`${title}, line ${i + 1}: empty source or target`);
            pairs.push([source, target]);
        }
        if (!pairs.length) throw new Error(`${title}: no usable entries. Enter source-TAB-target pairs.`);
        specs.push({slot, mode, pairs});
    }
    if (!specs.length) throw new Error("Add a dictionary before applying, or use Reset to Default.");
    return specs;
}

async function replaceDictionaries(reset = false) {
    await runBusy(async () => {
        const specs = reset ? [] : parseDictionaryCards();
        const json = JSON.stringify(specs);
        setPy("_web_dictionary_json", json);
        setPy("_web_dictionary_reset", reset);
        info(reset ? "Restoring default dictionaries..." : "Applying custom dictionaries...");
        await nextPaint();
        // Atomic swap: _web_cc changes only after every dictionary is parsed/loaded.
        await pyRun("_web_replace_dictionaries(_web_dictionary_json, _web_dictionary_reset)");
        const entries = specs.reduce((sum, spec) => sum + spec.pairs.length, 0);
        const label = reset ? "Default" : `Custom (${specs.length} ${specs.length === 1 ? "slot" : "slots"} - ${entries} ${entries === 1 ? "entry" : "entries"})`;
        $("dictionaryStatus").textContent = label;
        info(reset ? "Default dictionaries restored. Draft cards retained." : `Custom dictionaries applied. ${label}`);
    });
}

function decodeTextBytes(bytes, encoding) {
    return new TextDecoder(encoding, {fatal: false}).decode(bytes);
}

function refreshOpenedTextFile() {
    if (!fileBytes) return;
    try {
        const text = decodeTextBytes(fileBytes, $("textEncoding").value);
        setInput(text, true);
        editorLeft.focus();
        info(`Opened ${fileName} as ${$("textEncoding").selectedOptions[0].text} (${fmtCount(text)} characters).`);
    } catch (error) {
        info(`Failed to decode file: ${errorText(error)}`);
    }
}

async function openTextFile(file) {
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const detected = detectCjkEncoding(bytes);
        fileBytes = bytes;
        fileName = file.name;
        $("openedFileName").textContent = fileName;
        if (detected.detected) $("textEncoding").value = detected.encoding;
        refreshOpenedTextFile();
    } catch (error) {
        clearOpenedTextFile();
        info(`Failed to open file: ${errorText(error)}`);
    }
}

function repairGbMojibake(text) {
    const normalized = text.normalize("NFC");
    const cp1252 = new Map([
        [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
        [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
        [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
        [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
        [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
        [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
        [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]
    ]);
    const bytes = Uint8Array.from([...normalized], ch => {
        const codepoint = ch.codePointAt(0);
        if (codepoint <= 0xff) return codepoint;
        const byte = cp1252.get(codepoint);
        if (byte !== undefined) return byte;
        throw new Error(`Cannot recover byte from U+${codepoint.toString(16).toUpperCase()}`);
    });
    return new TextDecoder("gb18030", {fatal: true}).decode(bytes);
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function clearOfficeResult() {
    if (officeDownloadUrl) URL.revokeObjectURL(officeDownloadUrl);
    officeDownloadUrl = null;
    officeDownloadName = "";
    $("officeResult").hidden = true;
    $("officeResultText").textContent = "";
}

const mime = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    epub: "application/epub+zip",
    txt: "text/plain;charset=utf-8",
    md: "text/markdown;charset=utf-8"
};

function convertedFileName(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)}_converted${name.slice(dot)}` : `${name}_converted`;
}

async function convertDocument(file) {
    if (!ready) return info("Initialize Pyodide before converting files.");
    await runBusy(async () => {
        const format = file.name.split(".").pop().toLowerCase();
        if (!(format in mime)) throw new Error(`Unsupported file type: ${format}`);
        clearOfficeResult();
        const bytes = new Uint8Array(await file.arrayBuffer());
        let outputBytes;
        info(`Converting ${file.name} (${$("config").value})...`);
        await nextPaint();
        const start = performance.now();
        if (format === "txt" || format === "md") {
            let encoding = $("textEncoding").value;
            if ($("autoDetectDropEncoding").checked) {
                const detected = detectCjkEncoding(bytes);
                if (!detected.detected) throw new Error("Unable to detect encoding. Disable auto-detect and select one manually.");
                encoding = detected.encoding;
            }
            const text = decodeTextBytes(bytes, encoding);
            const converted = await convert(text, $("config").value, $("punctuation").checked);
            outputBytes = new TextEncoder().encode(converted);
            info(`Text encoding: ${encoding}`);
        } else {
            // Browser file bytes are placed in Pyodide's private in-memory FS.
            // This uses the package's existing Office/EPUB helper unchanged.
            const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const sourcePath = `/tmp/purepy_${id}_input.${format}`;
            const outputPath = `/tmp/purepy_${id}_output.${format}`;
            pyodide.FS.writeFile(sourcePath, bytes);
            try {
                setPy("_web_office_source", sourcePath);
                setPy("_web_office_output", outputPath);
                setPy("_web_office_format", format);
                setPy("_web_office_config", $("config").value);
                setPy("_web_office_punctuation", $("punctuation").checked);
                await pyRun(String.raw`
from opencc_purepy.office_helper import convert_office_doc
_web_cc.set_config(_web_office_config)
def _web_text_converter(text):
    return _web_cc.convert(
        text,
        punctuation=_web_office_punctuation
    )

_web_office_ok, _web_office_message = convert_office_doc(
    _web_office_source,
    _web_office_output,
    _web_office_format,
    _web_text_converter,
    keep_font=True
)
if not _web_office_ok:
    raise RuntimeError(_web_office_message)
`);
                outputBytes = pyodide.FS.readFile(outputPath);
                info(String(pyResult("_web_office_message")));
            } finally {
                for (const path of [sourcePath, outputPath]) {
                    try {
                        pyodide.FS.unlink(path);
                    } catch (_) { /* may not exist */
                    }
                }
            }
        }
        const outputName = convertedFileName(file.name);
        officeDownloadUrl = URL.createObjectURL(new Blob([outputBytes], {type: mime[format]}));
        officeDownloadName = outputName;
        $("officeResultText").textContent = `Ready: ${outputName} `;
        $("officeResult").hidden = false;
        info(`Document conversion completed: ${outputName}\nConversion time: ${(performance.now() - start).toFixed(2)} ms`);
    });
}

function wireUI() {
    $("initialize").addEventListener("click", initialize);
    $("btn").addEventListener("click", doConvert);
    $("smoke").addEventListener("click", smoke);
    $("large").addEventListener("click", largeTest);
    $("clearLogs").addEventListener("click", () => {
        $("out").textContent = "";
    });
    $("config").addEventListener("change", () => {
        updateConfigDescription();
        info(`Current config: ${$("config").value}`);
    });
    $("addDictionaryBtn").addEventListener("click", addDictionaryCard);
    $("applyDictionariesBtn").addEventListener("click", () => replaceDictionaries());
    $("resetDictionariesBtn").addEventListener("click", () => replaceDictionaries(true));
    $("pasteBtn").addEventListener("click", async () => {
        try {
            setInput(await navigator.clipboard.readText());
            $("textEncoding").value = "utf-8";
            info("Pasted clipboard text.");
        } catch (error) {
            info(`Paste failed: ${errorText(error)}`);
        }
    });
    $("copyBtn").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(editorRight.get());
            info("Copied output.");
        } catch (error) {
            info(`Copy failed: ${errorText(error)}`);
        }
    });
    $("clearInputBtn").addEventListener("click", () => {
        setInput("");
        $("textEncoding").value = "utf-8";
        info("Input cleared.");
    });
    $("clearOutputBtn").addEventListener("click", () => {
        setOutput("");
        info("Output cleared.");
    });
    $("downloadOutputBtn").addEventListener("click", () => {
        const text = editorRight.get();
        if (!text) return info("Download: output is empty.");
        downloadBlob(new Blob([text], {type: "text/plain;charset=utf-8"}), "opencc_output.txt");
        info("Output downloaded.");
    });
    $("normalizeBtn").addEventListener("click", () => runBusy(async () => {
        const input = editorLeft.get();
        if (!input) return info("Normalize: input is empty.");
        setPy("_web_input", input);
        await pyRun("_web_normalized = OpenCC.normalize_compat_extended(_web_input)");
        setInput(pyResult("_web_normalized"));
        editorLeft.focus();
        info("Input normalized with extended Unicode compatibility normalization.");
    }));
    $("gbMojibakeBtn").addEventListener("click", () => {
        try {
            const input = editorLeft.get();
            const fixed = repairGbMojibake(input);
            if (fixed === input) return info("GB Mojibake: nothing to repair.");
            setInput(fixed);
            editorLeft.focus();
            info("Input repaired from GB Mojibake.");
        } catch (_) {
            info("GB Mojibake: nothing to repair.");
        }
    });
    $("deTofuBtn").addEventListener("click", () => runBusy(async () => {
        const text = editorRight.get();
        if (!text) return info("DeTofu: output is empty.");
        setPy("_web_output", text);
        await pyRun("_web_detofued = OpenCC.detofu(_web_output, 'ext-b')");
        setOutput(pyResult("_web_detofued"));
        editorRight.focus();
        info("Output processed with DeTofu (ExtB).");
    }));
    $("openFileBtn").addEventListener("click", () => $("textFile").click());
    $("textFile").addEventListener("change", async event => {
        const file = event.target.files?.[0];
        if (file) await openTextFile(file);
        event.target.value = "";
    });
    $("textEncoding").addEventListener("change", refreshOpenedTextFile);
    const drop = $("officeDrop");
    const choose = () => {
        if (ready && !busy) $("officeFile").click(); else info("Initialize Pyodide to convert documents.");
    };
    drop.addEventListener("click", choose);
    drop.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose();
        }
    });
    drop.addEventListener("dragover", event => {
        event.preventDefault();
        if (ready && !busy) drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", event => {
        event.preventDefault();
        drop.classList.remove("dragover");
        if (event.dataTransfer?.files?.[0]) void convertDocument(event.dataTransfer.files[0]);
    });
    $("officeFile").addEventListener("change", event => {
        if (event.target.files?.[0]) void convertDocument(event.target.files[0]);
        event.target.value = "";
    });
    $("officeDownloadBtn").addEventListener("click", () => {
        if (!officeDownloadUrl) return;
        const a = document.createElement("a");
        a.href = officeDownloadUrl;
        a.download = officeDownloadName;
        a.click();
    });
    window.addEventListener("beforeunload", clearOfficeResult);
}

initializeTheme();
wireUI();
void makeEditors();
