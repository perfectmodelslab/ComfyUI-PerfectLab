// PerfectLab Studio -- the single photoshoot node and its panel.
//
// One fixed-height panel: a left rail of sections, a center editor for
// the active section, a right LIVE TEXT column and a pinned bottom
// PREVIEW dock with 8 tiles per page. The height never changes, so
// ComfyUI plays no slow collapse animation. SINGLE SHOT / SESSION in the
// header; START SHOOT queues the current graph through the API and fills
// the dock with the rendered frames.
import { app } from "../../scripts/app.js";
import { chipGrid, tile, itemImg, fitNode, toggleFav, attachPresets,
         libAdd, libImgPut, libChips, wireLib, libSync }
    from "./perfectlab_panel_factory.js?v=1.0.0";
import { POSE_LIB, EXPRESSION_LIB, FRAMING_LIB, FOCUS_LIB, FORMAT_LIB,
         ARC_LIB, ARC_DESC, framingText, resolveChoices, resolveWildcards }
    from "./perfectlab_lib.js?v=1.0.0";
import { PERSONA_FIELDS, TOPS_LIB, BOTTOMS_LIB, FOOTWEAR_LIB, HEADWEAR_LIB,
         ACCESSORIES_LIB, LOOK_COLORS, FOOTWEAR_COLORS, HEADWEAR_COLORS,
         ACC_COLORS, FOOTWEAR_MATERIALS, MATERIALS, MAT_EXTRA, MATERIAL_TINT,
         LIGHT_SETUPS, STYLES, FILMS, LOCATIONS, WEATHER,
         LENS_LIB, NEG_PRESETS } from "./perfectlab_libraries.js?v=1.0.0";

// the kit's stylesheet rides along with this module
{
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("styles.css", import.meta.url).href + "?v=1.0.0";
    document.head.append(link);
}

const GUIDE_V = "1.0.0";





// every section: key, label, the tile category the dock previews, and a
// center-render function producing HTML
const E = { "&": "&" + "amp;", "<": "&" + "lt;", ">": "&" + "gt;", '"': "&" + "quot;", "'": "&" + "#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => E[c]);
const uid = () => Math.random().toString(36).slice(2, 10);

// the global search index: every pickable word of every library, one row.
// persona / look / scene / style ride by value label, the walks by index --
// the click-through finds the chip by its visible label either way.
const searchIndex = () => {
    const out = [];
    const add = (sec, sub, lib, cat) => lib.forEach((label, idx) => out.push({ sec, sub, label, idx, cat }));
    PERSONA_FIELDS.forEach(f => add("persona", f.key, f.options, f.imgcat));
    add("look", "top", TOPS_LIB, "tops");
    add("look", "bottom", BOTTOMS_LIB, "bottoms");
    add("look", "footwear", FOOTWEAR_LIB, "footwear");
    add("look", "headwear", HEADWEAR_LIB, "headwear");
    add("look", "accessories", ACCESSORIES_LIB, null);
    add("scene", "location", LOCATIONS, "location");
    add("scene", "weather", WEATHER, "weather");
    add("scene", "light", LIGHT_SETUPS, "lighting");
    add("style", "grade", STYLES, "style");
    add("style", "film", FILMS, "film");
    add("camera", "framings", FRAMING_LIB, "framing");
    add("camera", "focus", FOCUS_LIB, "focus");
    add("camera", "lens", LENS_LIB, "lens");
    add("pose", "walk", POSE_LIB, "pose");
    add("expression", "walk", EXPRESSION_LIB, "expression");
    return out;
};

const DEFAULT_STATE = () => ({
    _v: 2, off: [], negative: { enabled: false, text: "", presets: [] },
    persona: { trigger: "", fields: {} },
    look: { looks: [{ name: "Look 1", top: "", top_color: "", top_material: "",
                      bottom: "", bottom_color: "", bottom_material: "",
                      footwear: "", footwear_color: "", footwear_material: "",
                      headwear: "", headwear_color: "", headwear_material: "",
                      accessories: [], acc_color: "", details: "" }] },
    scene: { location: "", weather: "", details: "" },
    light: { setup: "", hour: -1 },
    style: { grade: "", film: "", palette: "" },
    pose: { poses: { mode: "all", set: [], pin: null } },
    expression: { arc: "", expressions: { mode: "all", set: [], pin: null } },
    camera: { framings: { mode: "all", set: [], pin: null },
              focus: { mode: "all", set: [], pin: null },
              formats: { mode: "pin", set: [], pin: 0 },
              framing_order: "", lens: "" },
    shot: { main_prompt: "", custom: "", style_mode: "natural" },
    session: { count: 6, takes: 1, mood_subject: true, takes_arc: false,
               pose_arc: false, place_arc: false, crop_arc: false, focus_arc: false,
               look_rotation: "blocks", reshoot_shot: 0 },
});

function readState(node) {
    try {
        const raw = node.widgets?.find(w => w.name === "node_data")?.value;
        const s = raw ? JSON.parse(raw) : null;
        if (s && s._v === 2) return s;
        }
    } catch (e) { /* fall through */ }
    return DEFAULT_STATE();
}
const writeState = (node, s) => {
    const w = node.widgets?.find(w => w.name === "node_data");
    if (w) w.value = JSON.stringify(s);
};

// ---- center editors ----------------------------------------------------

const grid = (options, sel, imgcat, multi, scopeKey) =>
    chipGrid({ options, imgs: imgcat, cell: "1 / 1", sel,
               scope: "plx." + scopeKey, multi, base: options.length });

const personaEditor = (s, active) => {
    const f = s.persona.fields || {};
    const field = PERSONA_FIELDS.find(x => x.key === active.personaField) || PERSONA_FIELDS[0];
    const vals = f[field.key];
    const have = Array.isArray(vals) ? vals : (vals ? [vals] : []);
    const chips = field.options.map((o, i) => `
        <div class="plx-chip ${have.includes(o) ? "act" : ""}" data-val="${esc(o)}" data-multi="${field.multi}">
            ${tile(o, field.imgcat, i)}
            <span>${esc(o)}</span>
        </div>`).join("");
    return `
    <div class="plx-hint">the words switch off nothing -- a picked value replaces, ＋ picks toggle${field.multi ? " (multi)" : ""}</div>
    <div class="plx-chips">${chips || '<div class="plx-hint">no library</div>'}</div>
    <div class="plx-row">
        <input class="plx-inp" data-own="${field.key}" placeholder="own ${field.label.toLowerCase()} line…"
               value="${esc(Array.isArray(vals) ? "" : (vals && !field.options.includes(vals) ? vals : ""))}">
        <button class="plx-btn plx-clear" data-clear="${field.key}" title="X -- clear this field">✕ clear</button>
    </div>`;
};


// swatch libraries: colors render as real CSS swatches, materials as tinted chips
// the footwear and headwear slots offer their own materials (canvas, patent
// leather, rubber, straw, felt, tweed) -- every material anywhere resolves
// to one photo tile through this index
const MAT_INDEX = {};
[...MATERIALS, ...MAT_EXTRA].forEach((m, i) => { MAT_INDEX[m] = i; });
// the tile of a picked garment -- the library index gives the photo, custom
// entries fall back to the branded letter tile
const slotTile = (value, imgcat, lib) => {
    const i = lib.indexOf(value);
    if (i >= 0 && imgcat) return `<img draggable="false" src="${itemImg(imgcat, i)}">`;
    const letters = (value || "?").replace(/^(a|an|the) /i, "").slice(0, 2).toUpperCase();
    return `<span class="plp-tile">${esc(letters)}</span>`;
};

const lookEditor = (s) => `
    <div class="plx-hint">one look per block -- a look replaces the whole outfit between shots; the preview strip shows the picked pieces</div>
    ${(s.look.looks || []).map((l, li) => `
    <div class="plx-look" data-li-card="${li}">
        <div class="plx-look-head">
            <div class="plx-look-strip" title="the picked pieces">
                ${slotTile(l.top, "tops", TOPS_LIB)}
                ${slotTile(l.bottom, "bottoms", BOTTOMS_LIB)}
                ${slotTile(l.footwear, "footwear", FOOTWEAR_LIB)}
            </div>
            <input class="plx-inp plx-name" data-li="${li}" data-k="name" value="${esc(l.name)}" placeholder="look name">
            <button class="plx-btn warn" data-dellook="${li}">✕</button>
        </div>
        <div class="plx-grid2">
            ${[["top", "top", TOPS_LIB], ["bottom", "bottom", BOTTOMS_LIB],
               ["footwear", "footwear", FOOTWEAR_LIB], ["accessories", "accessories, comma-separated", null],
               ["details", "free line", null]]
              .map(([k, ph, list]) => `
              <div><label>${k}</label><input class="plx-inp" data-li="${li}" data-k="${k}"
                    list="${list ? "plx-" + k : ""}" value="${esc((k === "accessories" && Array.isArray(l.accessories)) ? l.accessories.join(", ") : (l[k] || ""))}" placeholder="${ph}">${["top", "bottom", "footwear"].includes(k) ? `<button class="plx-btn" data-shoottile="wardrobe__${k}" title="shoot a preview tile for this piece with your graph">🎬</button>` : ""}</div>`).join("")}
        </div>
        <div class="plx-sub">pick pieces <span class="plx-dim">click a tile to fill the slot, click again to clear</span></div>
        ${[["top", TOPS_LIB, "tops"], ["bottom", BOTTOMS_LIB, "bottoms"],
           ["footwear", FOOTWEAR_LIB, "footwear"]].map(([k, lib, cat]) => `
            <div class="plx-chips tight">${lib.map((o, i) => `
                <div class="plx-chip ${l[k] === o ? "act" : ""}" data-pick="${k}" data-val="${esc(o)}">
                    ${tile(o, cat, i)}<span>${esc(o.replace(/^(a|an|the) /, ""))}</span></div>`).join("")}</div>`).join("")}
        <div class="plx-chips tight">${ACCESSORIES_LIB.map((o, i) => `
            <div class="plx-chip ${(Array.isArray(l.accessories) && l.accessories.includes(o)) ? "act" : ""}" data-pick-acc="${esc(o)}">
                ${tile(o, "accessories", i)}<span>${esc(o)}</span></div>`).join("")}</div>
        <div class="plx-sub">top color / material</div>
        <div class="plx-swatches">${LOOK_COLORS.map(([n, hex]) => `
            <button class="plx-swatch ${l.top_color === n ? "act" : ""}" data-li="${li}" data-ck="top_color" data-color="${esc(n)}"
                style="--sw:${hex}" title="${esc(n)}"></button>`).join("")}</div>
        <div class="plx-chips tight">${MATERIALS.map(m => `
            <div class="plx-chip plain ${l.top_material === m ? "act" : ""}" data-li="${li}" data-ck="top_material" data-mat="${esc(m)}">
                ${tile(m, "materials", (MAT_INDEX[m] ?? -1))}<span>${esc(m)}</span></div>`).join("")}</div>
        <div class="plx-sub">bottom color / material</div>
        <div class="plx-swatches">${LOOK_COLORS.map(([n, hex]) => `
            <button class="plx-swatch ${l.bottom_color === n ? "act" : ""}" data-li="${li}" data-ck="bottom_color" data-color="${esc(n)}"
                style="--sw:${hex}" title="${esc(n)}"></button>`).join("")}</div>
        <div class="plx-chips tight">${MATERIALS.map(m => `
            <div class="plx-chip plain ${l.bottom_material === m ? "act" : ""}" data-li="${li}" data-ck="bottom_material" data-mat="${esc(m)}">
                ${tile(m, "materials", (MAT_INDEX[m] ?? -1))}<span>${esc(m)}</span></div>`).join("")}</div>
    </div>`).join("")}
    <datalist id="plx-top">${TOPS_LIB.map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    <datalist id="plx-bottom">${BOTTOMS_LIB.map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    <datalist id="plx-footwear">${FOOTWEAR_LIB.map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    <button class="plx-btn" data-addlook>＋ add look</button>`;

const sceneEditor = (s) => `
    <div class="plx-sub">location</div>
    <div class="plx-chips">${LOCATIONS.map((o, i) => `
        <div class="plx-chip ${s.scene.location === o ? "act" : ""}" data-val="${esc(o)}" data-t="location">
            ${tile(o, "location", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    <div class="plx-row"><input class="plx-inp" data-ownscene="location" value="${esc(s.scene.location && !LOCATIONS.includes(s.scene.location) ? s.scene.location : "")}" placeholder="own location…"></div>
    <div class="plx-sub">weather</div>
    <div class="plx-chips">${WEATHER.map((o, i) => `
        <div class="plx-chip ${s.scene.weather === o ? "act" : ""}" data-val="${esc(o)}" data-t="weather">
            ${tile(o, "weather", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    <div class="plx-row"><input class="plx-inp" data-ownscene="details" value="${esc(s.scene.details)}" placeholder="free scene line…"></div>
    <div class="plx-sub">light setup</div>
    <div class="plx-chips">${LIGHT_SETUPS.map((o, i) => `
        <div class="plx-chip ${s.light.setup === o ? "act" : ""}" data-val="${esc(o)}" data-t="setup">
            ${tile(o, "lighting", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    <div class="plx-row">
        <input class="plx-inp" type="number" min="-1" max="24" data-hour value="${s.light.hour ?? -1}" title="hour of the day: -1 = off">
        <input class="plx-inp" data-ownlight="setup" value="${esc(s.light.setup && !LIGHT_SETUPS.includes(s.light.setup) ? s.light.setup : "")}" placeholder="own setup line…">
    </div>`;

const PALETTE_MODS = ["neon", "pastel", "matte", "metallic", "earthy"];
// the palette line reads "mod color, color" -- these keep the chips in sync
const paletteColors = (s) => (s.style.palette || "")
    .replace(/^(neon|pastel|matte|metallic|earthy)\s+/, "").replace(/^color palette:\s*/i, "")
    .split(",").map(x => x.trim()).filter(Boolean).slice(0, 5);
const paletteMod = (s) => {
    const m = (s.style.palette || "").match(/^(neon|pastel|matte|metallic|earthy)\b/);
    return m ? m[1] : "";
};
const paletteBlock = (s) => `
    <div class="plx-sub">palette <span class="plx-dim">up to 5 colors + a modifier</span></div>
    <div class="plx-swatches">${LOOK_COLORS.map(([n, hex]) => `
        <button class="plx-swatch ${paletteColors(s).includes(n) ? "act" : ""}" data-pal="${esc(n)}"
            style="--sw:${hex}" title="${esc(n)}"></button>`).join("")}</div>
    <div class="plx-chips tight">${PALETTE_MODS.map(m => `
        <div class="plx-chip plain ${paletteMod(s) === m ? "act" : ""}" data-palmod="${esc(m)}">${esc(m)}</div>`).join("")}
        <div class="plx-chip plain ${!paletteMod(s) ? "act" : ""}" data-palmod="">none</div></div>
    <div class="plx-row"><input class="plx-inp" data-ownstyle="palette" value="${esc(s.style.palette)}" placeholder="own palette line…"></div>`;

const styleEditor = (s) => `
    <div class="plx-sub">grade</div>
    <div class="plx-chips">${STYLES.map((o, i) => `
        <div class="plx-chip ${s.style.grade === o ? "act" : ""}" data-val="${esc(o)}" data-t="grade">
            ${tile(o, "style", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    <div class="plx-sub">film</div>
    <div class="plx-chips">${FILMS.map((o, i) => `
        <div class="plx-chip ${s.style.film === o ? "act" : ""}" data-val="${esc(o)}" data-t="film">
            ${tile(o, "film", i)}<span>${esc(o)}</span></div>`).join("")}
    ${paletteBlock(s)}`;

// an aspect-ratio box drawn in CSS -- the format's real preview
const ratioBox = (fmt) => {
    const map = { "follows framing": "16/9", "1:1": "1/1", "4:5": "4/5", "3:4": "3/4",
                  "2:3": "2/3", "9:16": "9/16", "3:2": "3/2", "16:9": "16/9" };
    const ratio = map[fmt] || "1/1";
    const isFollow = fmt === "follows framing";
    return `<span class="plx-ratio ${isFollow ? "follow" : ""}" style="aspect-ratio:${ratio}"></span>`;
};
const cameraEditor = (s) => `
    <div class="plx-sub">framing <span class="plx-dim">the seven crops, readable wording under each</span></div>
    <div class="plx-chips">${FRAMING_LIB.map((f, i) => `
        <div class="plx-chip ${s.camera.framings.mode === "pin" && s.camera.framings.pin === i ? "act" : ""}
             ${s.camera.framings.mode === "multi" && (s.camera.framings.set || []).includes(i) ? "act" : ""}"
             data-fr="${i}">
            ${tile(f, "framing", i)}<span><b>${esc(f)}</b><br><i class="plx-dim">${esc(framingText(f).split(",").slice(1).join(",").trim() || "the classic crop")}</i></span></div>`).join("")}</div>
    <div class="plx-sub">focus</div>
    ${grid(FOCUS_LIB, s.camera.focus, "focus", true, "cam.focus")}
    <div class="plx-sub">format</div>
    <div class="plx-chips">${FORMAT_LIB.map((f, i) => `
        <div class="plx-chip ${s.camera.formats.mode === "pin" && s.camera.formats.pin === i ? "act" : ""}" data-fmt="${i}">
            ${ratioBox(f)}<span>${esc(f)}</span></div>`).join("")}</div>
    <div class="plx-row"><label class="plx-check"><input type="checkbox" data-order ${s.camera.framing_order ? "checked" : ""}> open wide, end on the closest crop</label></div>`;

const poseEditor = (s) => grid(POSE_LIB, s.pose.poses, "pose", true, "poses");

const expressionEditor = (s) => grid(EXPRESSION_LIB, s.expression.expressions, "expression", true, "expressions");

const sessionEditor = (s) => `
    <div class="plx-grid2">
        <div><label>shots</label><input class="plx-inp" type="number" min="1" max="100" data-count value="${s.session.count}"></div>
        <div><label>takes per shot</label><input class="plx-inp" type="number" min="1" max="4" data-takes value="${s.session.takes}"></div>
    </div>
    <div class="plx-grid2">
        <div><label>look rotation</label><select class="plx-inp" data-rotation>
            <option ${s.session.look_rotation === "blocks" ? "selected" : ""}>blocks</option>
            <option ${s.session.look_rotation === "mixed" ? "selected" : ""}>mixed</option></select></div>
        <div><label>token guard</label><select class="plx-inp" data-token disabled><option>off</option></select></div>
    </div>
    <div class="plx-sub">expression placement</div>
    ${[["mood_subject", "mood on the subject line", "the expression rides the persona's lead clause instead of standing after the crop -- moods read stronger"]]
      .map(([k, t, d]) => `<label class="plx-check"><input type="checkbox" data-coup="${k}" ${s.session[k] ? "checked" : ""}> <b>${t}</b><br><i class="plx-dim">${d}</i></label>`).join("")}
    <div class="plx-sub">what a run does</div>
    <div class="plx-session">
        START SHOOT queues <b>${s.session.count}</b> shot${s.session.count > 1 ? "s" : ""} × <b>${s.session.takes}</b>
        take${s.session.takes > 1 ? "s" : ""}${(s.look.looks || []).length > 1 ? ` across <b>${(s.look.looks || []).length}</b> looks in ${esc(s.session.look_rotation)} rotation` : ""}.

    </div>`;

const NEGATIVE = (s) => `
    <div class="plx-row"><label class="plx-check"><input type="checkbox" data-negon ${s.negative.enabled ? "checked" : ""}> negative</label></div>
    <div class="plx-sub">common guards <span class="plx-dim">toggle into the negative line</span></div>
    <div class="plx-chips tight">${NEG_PRESETS.map(p => `
        <div class="plx-chip plain ${((s.negative.presets || []).includes(p)) ? "act" : ""}" data-negp="${esc(p)}">${esc(p)}</div>`).join("")}</div>
    <div class="plx-row"><input class="plx-inp" data-neg value="${esc(s.negative.text)}" placeholder="own negative line…"></div>`;

const SECTIONS = [
    { key: "persona", label: "PERSONA", imgcat: "body",
      render: (s, ui) => personaEditor(s, ui) },
    { key: "look", label: "LOOK", imgcat: "outfit", render: lookEditor },
    { key: "scene", label: "SCENE", imgcat: "location", render: sceneEditor },
    { key: "style", label: "STYLE", imgcat: "style", render: styleEditor },
    { key: "camera", label: "CAMERA", imgcat: "framing", render: cameraEditor },
    { key: "pose", label: "POSE", imgcat: "pose", render: poseEditor },
    { key: "expression", label: "EXPRESSION", imgcat: "expression", render: expressionEditor },
    { key: "session", label: "SESSION", imgcat: null, render: sessionEditor },
];

// ---- wildcard files ----------------------------------------------------
// web/wildcards/*.txt serves statically; __name__ tokens fetch their file
// once and the right column re-renders when the lines arrive. The engine
// reads the same folder from disk and re-reads on file change.
const WC_CACHE = new Map();   // name -> string[] (loaded) | null (missing)
let wcRerender = () => {};    // set by the panel once renderRight exists
const wcGet = (name) => {
    if (WC_CACHE.has(name)) return WC_CACHE.get(name);
    WC_CACHE.set(name, null);   // missing until proven otherwise
    fetch(`/extensions/PerfectLab/wildcards/${encodeURIComponent(name)}.txt`)
        .then(r => (r.ok ? r.text() : null))
        .then(t => {
            if (t) {
                WC_CACHE.set(name, t.split("\n").map(x => x.trim())
                    .filter(x => x && !x.startsWith("#")));
                wcRerender();
            }
        }).catch(() => {});
    return null;
};

// ---- LIVE TEXT estimate -------------------------------------------------

const liveText = (s, seed = 0) => {
    const f = s.persona.fields || {};
    // the engine's rule: a set trigger leads and drops the face
    // blocks; no trigger, no prefix
    const FACE_KEYS = ["hair", "hair_color", "eyes", "makeup", "skin"];
    const perVals = s.persona.trigger
        ? Object.entries(f).filter(([k]) => !FACE_KEYS.includes(k)).map(([, v]) => v)
        : Object.values(f);
    const per = perVals.flat().filter(Boolean).join(", ");
    const look0 = (s.look.looks || [])[0] || {};
    const piece = (name, color, material) =>
        [material, name].filter(Boolean).join(" ") + (color ? ` in ${color}` : "");
    const wearing = [look0.top && piece(look0.top, look0.top_color, look0.top_material),
                     look0.bottom && piece(look0.bottom, look0.bottom_color, look0.bottom_material)]
                    .filter(Boolean).join(" with ");
    const shoePiece = (l) => [l.footwear_material, l.footwear].filter(Boolean).join(" ")
        + (l.footwear_color ? ` in ${l.footwear_color}` : "");
    const extras = [look0.footwear && shoePiece(look0),
                     look0.headwear && (look0.headwear_color ? look0.headwear_color + " " : "") + look0.headwear,
                     Array.isArray(look0.accessories) && look0.accessories.length
                       ? look0.accessories.join(", ") + (look0.acc_color ? ` in ${look0.acc_color}` : "")
                       : "",
                     look0.details].filter(Boolean).join(", ");
    const poses = (s.pose.poses.mode === "pin" ? [POSE_LIB[s.pose.poses.pin]] :
                    s.pose.poses.set || []).map(i => POSE_LIB[i]).filter(Boolean);
    const framings = (s.camera.framings.mode === "pin"
                       ? [FRAMING_LIB[s.camera.framings.pin]]
                       : (s.camera.framings.set || []).map(i => FRAMING_LIB[i])).filter(Boolean);
    const focus = (s.camera.focus.mode === "pin" ? [FOCUS_LIB[s.camera.focus.pin]]
                   : (s.camera.focus.set || []).map(i => FOCUS_LIB[i])).filter(Boolean);
    const fmtSel = s.camera.formats;
    const fmt = (fmtSel.set || (fmtSel.mode === "pin" ? [fmtSel.pin] : []))
        .map(i => FORMAT_LIB[i]).filter(f => f && f !== "follows framing");
    const light = s.light.setup || (s.light.hour >= 0 ? `hour ${s.light.hour}: the clock lighting` : "");
    const expressions = (s.expression.expressions.mode === "pin"
        ? [s.expression.expressions.pin] : (s.expression.expressions.set || []))
        .map(i => EXPRESSION_LIB[i]).filter(Boolean);
    // SDXL tag mode: a flat comma list, no prose labels -- the same shape
    // the engine's tag branch produces
    if ((s.shot.style_mode || "natural") === "tags") {
        const tags = [
            s.shot.main_prompt,
            per && (s.persona.trigger ? `(${s.persona.trigger}) ${per}` : per),
            (wearing || extras) && (wearing
                ? `${wearing}${extras ? ", " + extras : ""}`.replace("wearing ", "")
                : extras),
            s.scene.location, s.scene.weather, s.scene.details,
            light, [s.style.grade, s.style.style_film || s.style.film, s.style.palette].filter(Boolean).join(", "),
            framings.join(", "),
            focus.join(", "),
            poses.join(", "),
            expressions.join(", "),
            s.camera.lens,
            s.shot.custom,
        ].filter(Boolean);
        const rawTags = tags.join(", ");
        const textTags = resolveChoices(resolveWildcards(rawTags, seed, wcGet), seed);
        return { text: textTags, raw: rawTags, parts: tags.filter(Boolean),
                 tokens: Math.max(1, Math.round(textTags.length / 3.6)) };
    }
    const parts = [
        s.shot.main_prompt,
        per && (s.persona.trigger ? `(${s.persona.trigger}) ${per}` : per),
        (wearing || extras) && (wearing
            ? `wearing ${wearing}${extras ? ", " + extras : ""}`
            : extras),
        s.scene.location, s.scene.weather, s.scene.details,
        light, [s.style.grade, s.style.style_film || s.style.film, s.style.palette].filter(Boolean).join(", "),
        framings.length && `framings: ${framings.join(", ")}`,
        focus.length && `focus: ${focus.join(", ")}`,
        fmt.length && `format: ${fmt.join(", ")}${s.camera.framing_order ? " (wide to close)" : ""}`,
        s.camera.lens && `lens: ${s.camera.lens}`,
        poses.length && `poses: ${poses.join(", ")}`,
        expressions.length && `expressions: ${expressions.join(", ")}`,
        s.shot.custom,
    ].filter(Boolean);
    const raw = parts.join("\n\n");
    const text = resolveChoices(resolveWildcards(raw, seed, wcGet), seed);
    return { text, raw, parts: parts.filter(Boolean),
             tokens: Math.max(1, Math.round(text.length / 3.6)) };
};


// ---- the picks of a section, as one line of tiles ----
// every section shows what its subsections have picked, the same way the
// look strip does -- one glance answers "what is already chosen here"
const pickThumb = (value, imgcat, lib) => {
    const i = lib ? lib.indexOf(value) : -1;
    if (i >= 0 && imgcat) return `<img draggable="false" src="${itemImg(imgcat, i)}" title="${esc(value)}">`;
    const letters = (value || "?").replace(/^(a|an|the) /i, "").slice(0, 2).toUpperCase();
    return `<span class="plx-pick-letter" title="${esc(value)}">${esc(letters)}</span>`;
};
const swatchThumb = (name, hex) => hex
    ? `<span class="plx-pick-swatch" style="background:${hex}" title="${esc(name)}"></span>`
    : "";
const matThumb = (name) => {
    if (!name) return "";
    const idx = MAT_INDEX[name] ?? -1;
    if (idx >= 0)
        return `<img src="${itemImg("materials", idx)}" title="${esc(name)}" style="width:56px;height:56px;border-radius:50%;border:3px solid #33290f;object-fit:cover;display:inline-block">`;
    return `<span class="plx-pick-mat" title="${esc(name)}">${esc(name)}</span>`;
};

const sectionPicks = (secKey, s) => {
    const out = [];
    const push = (html) => { if (html) out.push(html); };
    if (secKey === "persona") {
        PERSONA_FIELDS.forEach(fd => {
            const v = (s.persona.fields || {})[fd.key];
            (Array.isArray(v) ? v : v ? [v] : []).forEach(val =>
                push(pickThumb(val, fd.imgcat, fd.options)));
        });
    } else if (secKey === "look") {
        (s.look.looks || []).forEach(l => {
            push(pickThumb(l.top, "tops", TOPS_LIB));
            push(pickThumb(l.bottom, "bottoms", BOTTOMS_LIB));
            push(pickThumb(l.footwear, "footwear", FOOTWEAR_LIB));
            (Array.isArray(l.accessories) ? l.accessories : []).forEach(a =>
                push(pickThumb(a, "accessories", ACCESSORIES_LIB)));
            push(swatchThumb(l.top_color, (LOOK_COLORS.find(c => c[0] === l.top_color) || [])[1]));
            push(matThumb(l.top_material));
            push(swatchThumb(l.bottom_color, (LOOK_COLORS.find(c => c[0] === l.bottom_color) || [])[1]));
            push(matThumb(l.bottom_material));
        });
    } else if (secKey === "scene") {
        push(pickThumb(s.scene.location, "location", LOCATIONS));
        push(pickThumb(s.scene.weather, "weather", WEATHER));
        push(s.scene.details ? `<span class="plx-pick-letter" title="${esc(s.scene.details)}">···</span>` : "");
        push(pickThumb(s.light.setup, "lighting", LIGHT_SETUPS));
        push(s.light.hour >= 0 ? `<span class="plx-pick-letter" title="hour ${s.light.hour}">${s.light.hour}h</span>` : "");
    } else if (secKey === "style") {
        push(pickThumb(s.style.grade, "style", STYLES));
        push(pickThumb(s.style.film, "film", FILMS));
    } else if (secKey === "camera") {
        const fSel = s.camera.framings, foSel = s.camera.focus;
        (fSel.mode === "pin" ? [fSel.pin] : (fSel.set || [])).forEach(i =>
            push(pickThumb(FRAMING_LIB[i], "framing", FRAMING_LIB)));
        (foSel.mode === "pin" ? [foSel.pin] : (foSel.set || [])).forEach(i =>
            push(pickThumb(FOCUS_LIB[i], "focus", FOCUS_LIB)));
        if (s.camera.lens) push(pickThumb(s.camera.lens, "lens", LENS_LIB));
        if (s.camera.formats.mode === "pin") push(
            `<span class="plx-pick-letter" title="${esc(FORMAT_LIB[s.camera.formats.pin] || "")}">${esc((FORMAT_LIB[s.camera.formats.pin] || "?").replace("follows framing", "auto"))}</span>`);
    } else if (secKey === "pose") {
        const sel = s.pose.poses;
        (sel.mode === "pin" ? [sel.pin] : (sel.set || [])).forEach(i =>
            push(pickThumb(POSE_LIB[i], "pose", POSE_LIB)));
    } else if (secKey === "expression") {
        const sel = s.expression.expressions;
        (sel.mode === "pin" ? [sel.pin] : (sel.set || [])).forEach(i =>
            push(pickThumb(EXPRESSION_LIB[i], "expression", EXPRESSION_LIB)));
    }
    return out;
};

// ---- sub-section cards -------------------------------------------------
// one card per rail subsection: the center never stacks tile streams, every
// card says its combining rule and carries its own clear
const card = (title, rule, bodyHtml, clearKey) => `
    <div class="plx-card">
        <div class="plx-card-head">
            <span class="plx-card-title">${title}</span>
            <span class="plx-dim">${rule}</span>
            <button class="plx-btn plx-roll" data-reroll="${clearKey}" title="random pick in this card">🎲</button>
            <button class="plx-btn plx-clear" data-clearsub="${clearKey}" title="X -- clear this card">✕ clear card</button>
        </div>
        ${bodyHtml}
    </div>`;

const personaSub = (s, ui, fieldKey) => {
    const field = PERSONA_FIELDS.find(x => x.key === fieldKey) || PERSONA_FIELDS[0];
    const f = s.persona.fields || {};
    const vals = f[field.key];
    const have = Array.isArray(vals) ? vals : (vals ? [vals] : []);
    const body = `
        <div class="plx-chips">${field.options.map((o, i) => `
            <div class="plx-chip ${have.includes(o) ? "act" : ""}" data-val="${esc(o)}" data-multi="${field.multi}">
                ${tile(o, field.imgcat, i)}<span>${esc(o)}</span></div>`).join("")}</div>
        <div class="plx-row"><input class="plx-inp" data-own="${field.key}"
            placeholder="own ${field.label.toLowerCase()} line…"
            value="${esc(Array.isArray(vals) ? "" : (vals && !field.options.includes(vals) ? vals : ""))}"></div>`;
    return card(field.label,
        field.multi ? "combines: every picked value joins the persona" :
            "one pick: the value replaces the field",
        body, "persona." + field.key);
};

const lookPiecesSub = (s) => card("PIECES",
    "replaces: one garment per slot -- a look replaces the whole outfit",
    (s.look.looks || []).map((l, li) => `
    <div class="plx-look" data-li-card="${li}">
        <div class="plx-look-head">
            <div class="plx-look-strip">
                ${slotTile(l.top, "tops", TOPS_LIB)}
                ${slotTile(l.bottom, "bottoms", BOTTOMS_LIB)}
                ${slotTile(l.footwear, "footwear", FOOTWEAR_LIB)}
            </div>
            <input class="plx-inp plx-name" data-li="${li}" data-k="name" value="${esc(l.name)}" placeholder="look name">
            <button class="plx-btn warn" data-dellook="${li}">✕</button>
        </div>
        ${[["top", TOPS_LIB, "tops"], ["bottom", BOTTOMS_LIB, "bottoms"],
           ["footwear", FOOTWEAR_LIB, "footwear"]].map(([k, lib, cat]) => `
            <div class="plx-chips tight">${lib.map((o, i) => `
                <div class="plx-chip ${l[k] === o ? "act" : ""}" data-pick="${k}" data-val="${esc(o)}">
                    ${tile(o, cat, i)}<span>${esc(o.replace(/^(a|an|the) /, ""))}</span></div>`).join("")}</div>`).join("")}
        <div class="plx-row">
            <input class="plx-inp" data-li="${li}" data-k="details" value="${esc(l.details || "")}" placeholder="free line (fit, state, texture note)…">
        </div>
    </div>`).join("") + `<button class="plx-btn" data-addlook>＋ add look</button>`,
    "look.pieces");

const lookColorsSub = (s) => card("COLORS & MATERIALS",
    "rides the picked garment -- 'silk satin slip dress in champagne gold'",
    (s.look.looks || []).map((l, li) => `
    <div class="plx-look" data-li-card="${li}">
        <div class="plx-look-head"><span class="plx-card-title">${esc(l.name || "Look " + (li + 1))}</span></div>
        <div class="plx-sub">top color / material</div>
        <div class="plx-swatches">${LOOK_COLORS.map(([n, hex]) => `
            <button class="plx-swatch ${l.top_color === n ? "act" : ""}" data-li="${li}" data-ck="top_color" data-color="${esc(n)}" style="--sw:${hex}" title="${esc(n)}"></button>`).join("")}</div>
        <div class="plx-chips tight">${MATERIALS.map(m => `
            <div class="plx-chip plain ${l.top_material === m ? "act" : ""}" data-li="${li}" data-ck="top_material" data-mat="${esc(m)}">
                ${tile(m, "materials", (MAT_INDEX[m] ?? -1))}<span>${esc(m)}</span></div>`).join("")}</div>
        <div class="plx-sub">bottom color / material</div>
        <div class="plx-swatches">${LOOK_COLORS.map(([n, hex]) => `
            <button class="plx-swatch ${l.bottom_color === n ? "act" : ""}" data-li="${li}" data-ck="bottom_color" data-color="${esc(n)}" style="--sw:${hex}" title="${esc(n)}"></button>`).join("")}</div>
        <div class="plx-chips tight">${MATERIALS.map(m => `
            <div class="plx-chip plain ${l.bottom_material === m ? "act" : ""}" data-li="${li}" data-ck="bottom_material" data-mat="${esc(m)}">
                ${tile(m, "materials", (MAT_INDEX[m] ?? -1))}<span>${esc(m)}</span></div>`).join("")}</div>
    </div>`).join(""),
    "look.colors");

const lookAccSub = (s) => card("ACCESSORIES",
    "combines: every picked accessory joins the look",
    (s.look.looks || []).map((l, li) => `
    <div class="plx-look" data-li-card="${li}">
        <div class="plx-look-head"><span class="plx-card-title">${esc(l.name || "Look " + (li + 1))}</span></div>
        <div class="plx-chips tight">${ACCESSORIES_LIB.map((o, i) => `
            <div class="plx-chip ${(Array.isArray(l.accessories) && l.accessories.includes(o)) ? "act" : ""}" data-pick-acc="${esc(o)}">
                ${tile(o, "accessories", i)}<span>${esc(o)}</span></div>`).join("")}</div>
        <div class="plx-row"><input class="plx-inp" data-li="${li}" data-k="accessories"
            value="${esc(Array.isArray(l.accessories) ? l.accessories.join(", ") : "")}" placeholder="own accessories, comma-separated…"></div>
    </div>`).join(""),
    "look.accessories");

const sceneLocSub = (s) => card("LOCATION", "one pick: click again to clear", `
    <div class="plx-chips">${LOCATIONS.map((o, i) => `
        <div class="plx-chip ${s.scene.location === o ? "act" : ""}" data-val="${esc(o)}" data-t="location">
            ${tile(o, "location", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    <div class="plx-row"><input class="plx-inp" data-ownscene="location"
        value="${esc(s.scene.location && !LOCATIONS.includes(s.scene.location) ? s.scene.location : "")}" placeholder="own location…"></div>`,
    "scene.location");

const sceneWeatherSub = (s) => card("WEATHER", "one pick: click again to clear", `
    <div class="plx-chips">${WEATHER.map((o, i) => `
        <div class="plx-chip ${s.scene.weather === o ? "act" : ""}" data-val="${esc(o)}" data-t="weather">
            ${tile(o, "weather", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    <div class="plx-row"><input class="plx-inp" data-ownscene="details" value="${esc(s.scene.details)}" placeholder="free scene line…"></div>`,
    "scene.weather");

const sceneLightSub = (s) => card("LIGHT", "one setup or the clock hour", `
    <div class="plx-chips">${LIGHT_SETUPS.map((o, i) => `
        <div class="plx-chip ${s.light.setup === o ? "act" : ""}" data-val="${esc(o)}" data-t="setup">
            ${tile(o, "lighting", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    <div class="plx-row">
        <input class="plx-inp" type="number" min="-1" max="24" data-hour value="${s.light.hour ?? -1}" title="hour of the day: -1 = off">
        <input class="plx-inp" data-ownlight="setup" value="${esc(s.light.setup && !LIGHT_SETUPS.includes(s.light.setup) ? s.light.setup : "")}" placeholder="own setup line…">
    </div>`,
    "scene.light");

const styleGradeSub = (s) => card("GRADE", "one pick: the whole-image aesthetic", `
    <div class="plx-chips">${STYLES.map((o, i) => `
        <div class="plx-chip ${s.style.grade === o ? "act" : ""}" data-val="${esc(o)}" data-t="grade">
            ${tile(o, "style", i)}<span>${esc(o)}</span></div>`).join("")}</div>`,
    "style.grade");

const styleFilmSub = (s) => card("FILM LOOK", "one pick: the film stock feel", `
    <div class="plx-chips">${FILMS.map((o, i) => `
        <div class="plx-chip ${s.style.film === o ? "act" : ""}" data-val="${esc(o)}" data-t="film">
            ${tile(o, "film", i)}<span>${esc(o)}</span></div>`).join("")}</div>
    ${paletteBlock(s)}`,
    "style.film");

const camFramingSub = (s) => card("FRAMING", "walk: the session walks the picked crops; pin for one", `
    <div class="plx-chips">${FRAMING_LIB.map((f, i) => `
        <div class="plx-chip ${s.camera.framings.mode === "pin" && s.camera.framings.pin === i ? "act" : ""}
             ${s.camera.framings.mode === "multi" && (s.camera.framings.set || []).includes(i) ? "act" : ""}" data-fr="${i}">
            ${tile(f, "framing", i)}<span><b>${esc(f)}</b><br><i class="plx-dim">${esc(framingText(f).split(",").slice(1).join(",").trim() || "the classic crop")}</i></span></div>`).join("")}</div>
    <div class="plx-row"><label class="plx-check"><input type="checkbox" data-order ${s.camera.framing_order ? "checked" : ""}> open wide, end on the closest crop</label></div>`,
    "camera.framings");

const camFocusSub = (s) => card("FOCUS", "walk: where the eye lands, per shot", `
    ${grid(FOCUS_LIB, s.camera.focus, "focus", true, "cam.focus")}`,
    "camera.focus");

const camFormatSub = (s) => {
    const fSel = s.camera.formats;
    const active = (i) => (fSel.mode === "pin" && fSel.pin === i)
        || (fSel.mode === "multi" && (fSel.set || []).includes(i));
    return card("FORMAT", "multi: each frame takes the next picked ratio; empty = follows the framing", `
        <div class="plx-chips">${FORMAT_LIB.map((f, i) => `
            <div class="plx-chip ${active(i) ? "act" : ""}" data-fmt="${i}">
                ${ratioBox(f)}<span>${esc(f)}</span></div>`).join("")}</div>`,
        "camera.formats");
};

const camLensSub = (s) => card("LENS", "replaces: the lens line of every shot; click again to clear", `
    <div class="plx-chips">${LENS_LIB.map((o, i) => `
        <div class="plx-chip ${s.camera.lens === o ? "act" : ""}" data-lens="${esc(o)}">
            ${tile(o, "lens", i)}<span>${esc(o.replace(/^(a|an) /, ""))}</span></div>`).join("")}</div>`,
    "camera.lens");

const poseSub = (s) => card("POSES", "walk: the session walks the picked set", `
    ${grid(POSE_LIB, s.pose.poses, "pose", true, "poses")}`,
    "pose.poses");

const exprWalkSub = (s) => card("EXPRESSIONS", "walk: the expressions the session repeats", `
    ${grid(EXPRESSION_LIB, s.expression.expressions, "expression", true, "expressions")}`,
    "expression.expressions");

const sessionSub = (s) => card("SESSION", "what a run renders", sessionEditor(s), "session");

// the rail map: section -> its subsections, in order; a section with one
// group keeps a single sub so the center stays one-card-at-a-time
const SUBS = {
    persona: PERSONA_FIELDS.map(fd => ({ key: fd.key, label: fd.label })),
    look: [{ key: "top", label: "Tops" }, { key: "bottom", label: "Bottoms" },
           { key: "footwear", label: "Footwear" }, { key: "headwear", label: "Headwear" },
           { key: "accessories", label: "Accessories" }],
    scene: [{ key: "location", label: "Location" }, { key: "weather", label: "Weather" },
            { key: "light", label: "Light" }],
    style: [{ key: "grade", label: "Grade" }, { key: "film", label: "Film" }],
    camera: [{ key: "framings", label: "Framing" }, { key: "focus", label: "Focus" },
             { key: "lens", label: "Lens" }, { key: "formats", label: "Format" }],
    pose: [{ key: "walk", label: "The 32-pose walk" }],
    expression: [{ key: "walk", label: "Expressions" }],
    session: [{ key: "main", label: "Session" }],
};

const lookSlotSub = (slot, lib, cat, title) => (s) => card(title,
    "replaces: one pick per slot -- the latest click wins",
    (s.look.looks || []).map((l, li) => `
    <div class="plx-look" data-li-card="${li}" data-slot-card="${slot}">
        <div class="plx-look-head">
            <div class="plx-look-strip">${slotTile(l[slot], cat, lib)}</div>
            <span class="plx-card-title">${esc(l.name || "Look " + (li + 1))}</span>
            <input class="plx-inp plx-name" data-li="${li}" data-k="${slot}" list="plx-${slot}"
                   value="${esc(l[slot] || "")}" placeholder="own line…">
            <button class="plx-btn" data-shoottile="wardrobe__${slot}" title="shoot a preview tile for this piece with your graph">🎬</button>
        </div>
        <div class="plx-chips tight">${lib.map((o, i) => `
            <div class="plx-chip ${l[slot] === o ? "act" : ""}" data-pick="${slot}" data-val="${esc(o)}">
                ${tile(o, cat, i)}<span>${esc(o.replace(/^(a|an|the) /, ""))}</span></div>`).join("")}</div> ${libChips("wardrobe__" + slot, { act: o => l[slot] === o })}
    </div>`).join("") +
    `<datalist id="plx-top">${TOPS_LIB.map(o => `<option value="${esc(o)}">`).join("")}</datalist>` +
    `<datalist id="plx-bottom">${BOTTOMS_LIB.map(o => `<option value="${esc(o)}">`).join("")}</datalist>` +
    `<datalist id="plx-footwear">${FOOTWEAR_LIB.map(o => `<option value="${esc(o)}">`).join("")}</datalist>`,
    "look." + slot);
const lookTopSub = lookSlotSub("top", TOPS_LIB, "tops", "TOPS");
const lookBottomSub = lookSlotSub("bottom", BOTTOMS_LIB, "bottoms", "BOTTOMS");
const lookFootwearSub = lookSlotSub("footwear", FOOTWEAR_LIB, "footwear", "FOOTWEAR");

// the colors live in the garment's own card: pick the piece first, its color
// swatches and materials sit right under the grid
const slotColorBlock = (l, li, slotKey, colors, materials, matKey, colorCat) => `
    <div class="plx-sub">color / material of this piece</div>
    <div class="plx-swatches">${colors.map(([n, hex], ci) => `
        <button class="plx-swatch ${l[slotKey + "_color"] === n ? "act" : ""}"
            data-li="${li}" data-ck="${slotKey}_color" data-color="${esc(n)}"
            style="--sw:${hex}; background-image:url('${colorCat ? itemImg(colorCat, ci) : ""}')"
            title="${esc(n)}"></button>`).join("")}</div>
    <div class="plx-chips tight">${materials.map(m => `
        <div class="plx-chip plain ${l[matKey] === m ? "act" : ""}" data-li="${li}" data-ck="${matKey}" data-mat="${esc(m)}">
            ${tile(m, "materials", (MAT_INDEX[m] ?? -1))}<span>${esc(m)}</span></div>`).join("")}</div>`;
const lookSlotWithColors = (base, slotKey, colors, materials, matKey, colorCat) => (s) => {
    const inner = base(s);
    const blocks = (s.look.looks || []).map((l, li) =>
        slotColorBlock(l, li, slotKey, colors, materials, matKey, colorCat)).join("");
    const at = inner.lastIndexOf("</div>");
    return inner.slice(0, at) + blocks + inner.slice(at);
};
const lookTopColored = lookSlotWithColors(lookTopSub, "top", LOOK_COLORS, MATERIALS, "top_material", "look_color");
const lookBottomColored = lookSlotWithColors(lookBottomSub, "bottom", LOOK_COLORS, MATERIALS, "bottom_material", "look_color");
const lookFootwearColored = lookSlotWithColors(lookFootwearSub, "footwear", FOOTWEAR_COLORS, FOOTWEAR_MATERIALS, "footwear_material", "footwear_color");
const lookHeadwearSub = lookSlotSub("headwear", HEADWEAR_LIB, "headwear", "HEADWEAR");
const lookHeadwearColored = lookSlotWithColors(lookHeadwearSub, "headwear", HEADWEAR_COLORS,
    ["knit", "wool", "cotton", "leather", "silk", "straw", "denim", "felt", "corduroy", "velvet", "tweed"],
    "headwear_material", "headwear_color");
// accessories: the pick grid plus one color swatch row for the whole set
const lookAccColoredSub = (s) => {
    const base = lookAccSub(s);
    const blocks = (s.look.looks || []).map((l, li) => `
        <div class="plx-sub">accessory color <span class="plx-dim">applies to every picked accessory</span></div>
        <div class="plx-swatches">${ACC_COLORS.map(([n, hex], ci) => `
            <button class="plx-swatch ${l.acc_color === n ? "act" : ""}"
                data-li="${li}" data-ck="acc_color" data-color="${esc(n)}"
                style="--sw:${hex}; background-image:url('${itemImg("acc_color", ci)}')"
                title="${esc(n)}"></button>`).join("")}</div>`).join("");
    const at = base.lastIndexOf("</div>");
    return base.slice(0, at) + blocks + base.slice(at);
};

const SUB_RENDER = {
    look: { top: lookTopColored, bottom: lookBottomColored, footwear: lookFootwearColored,
            headwear: lookHeadwearColored, accessories: lookAccColoredSub },
    scene: { location: sceneLocSub, weather: sceneWeatherSub, light: sceneLightSub },
    style: { grade: styleGradeSub, film: styleFilmSub },
    camera: { framings: camFramingSub, focus: camFocusSub, lens: camLensSub, formats: camFormatSub },
    pose: { walk: poseSub },
    expression: { walk: exprWalkSub },
    session: { main: sessionSub },
};

// ---- panel --------------------------------------------------------------

function buildPanel(node) {
    const state = readState(node);
    // the panel opens on the photo-rich hair field -- the value-only fields
    // (who, age) sit further along the tab row
    const ui = { section: "persona", personaField: "hair", dockPage: 0, results: null };

    const el = document.createElement("div");
    el.className = "plx";
    el.addEventListener("mousedown", e => e.stopPropagation());
    el.addEventListener("wheel", e => e.stopPropagation());

    const rail = document.createElement("div");
    const center = document.createElement("div");
    const right = document.createElement("div");
    const dock = document.createElement("div");
    rail.className = "plx-rail"; center.className = "plx-center";
    right.className = "plx-right"; dock.className = "plx-dock";
    const mid = document.createElement("div");
    mid.className = "plx-mid";
    mid.append(rail, center, right);
    el.append(mid, dock);

    const widget = node.addDOMWidget("plx_panel", "plx_panel", el,
                                    { serialize: false, hideOnZoom: false });
    const i = node.widgets.indexOf(widget);
    if (i > 0) { node.widgets.splice(i, 1); node.widgets.unshift(widget); }

    // the panel header owns the controls -- the native widgets only carry
    // values into the queue, so they leave the visual surface
    node.widgets.forEach(w => {
        if (["node_data", "mode", "stage", "seed", "variations"].includes(w.name))
            w.type = "hidden";
    });

    // a fixed height -- no grow/shrink, no collapse animation
    const H = 720;
    el.style.height = H + "px";
    node.size = [790, H + 60];

    // proportional scaling: the panel's base font tracks the node width and
    // the em-sized controls (buttons, rail, cards, captions) grow with it --
    // stretch the node and the whole UI grows, not just the preview tiles
    const syncFont = () => {
        const wpx = el.getBoundingClientRect().width;
        if (wpx < 10) return;
        const base = Math.max(11, Math.min(19, Math.round(wpx / 58)));
        if (el.style.fontSize !== base + "px") el.style.fontSize = base + "px";
    };
    // the panel box is exact: the DOM widget reports its own height and the
    // node grows to fit -- the kit's proven fitNode formula, no scale math
    const syncSize = () => {
        syncFont();
        fitNode(node, el, widget);
        // generous slack: the panel sits fully inside the node box even when
        // the frontend's own row heights drift -- a taller box is harmless,
        // a clipped panel is not
        const need = el.scrollHeight + 160;
        if (node.size[1] < need) node.setSize([node.size[0], need]);
        // tiles breathe: a panel narrower than this squeezes the 4-column
        // chip grid to thumbnails, so the node gets a floor width
        if (node.size[0] < 1200) node.setSize([1200, node.size[1]]);
    };
    requestAnimationFrame(() => requestAnimationFrame(syncSize));
    setTimeout(syncSize, 400);
    setTimeout(syncSize, 1200);
    const sizeObs = new ResizeObserver(() => requestAnimationFrame(syncSize));
    sizeObs.observe(el);

    const header = document.createElement("div");
    header.className = "plx-head";
    el.prepend(header);

    // ---- undo/redo: every mutation lands in sync(); the previous snapshot
    // rides onto the undo stack the moment the state actually changed ----
    const undoStack = [];
    const redoStack = [];
    let lastSnapshot = JSON.stringify(state);
    const sync = () => {
        const snap = JSON.stringify(state);
        if (snap !== lastSnapshot) {
            undoStack.push(lastSnapshot);
            if (undoStack.length > 50) undoStack.shift();
            redoStack.length = 0;
            lastSnapshot = snap;
        }
        writeState(node, state);
        renderAll();
    };
    const undo = () => {
        if (!undoStack.length) return;
        redoStack.push(JSON.stringify(state));
        Object.assign(state, JSON.parse(undoStack.pop()));
        lastSnapshot = JSON.stringify(state);
        writeState(node, state);
        renderAll();
    };
    const redo = () => {
        if (!redoStack.length) return;
        undoStack.push(JSON.stringify(state));
        Object.assign(state, JSON.parse(redoStack.pop()));
        lastSnapshot = JSON.stringify(state);
        writeState(node, state);
        renderAll();
    };

    // ---- clearing: one card, one section, or the whole preset ----
    // ---- reroll: a random pick inside one card ----
    const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const rndN = (arr, n) => {
        const a = [...arr];
        const out = [];
        while (out.length < Math.min(n, a.length)) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
        return out;
    };
    const rndPersona = (key, multi) => {
        const field = PERSONA_FIELDS.find(f => f.key === key);
        if (!field) return;
        state.persona.fields[key] = multi ? rndN(field.options, 2) : rnd(field.options);
    };
    const reroll = (subKey) => {
        const [sec, sub] = subKey.split(".");
        const s = state;
        if (sec === "persona") {
            const multi = ["makeup", "signature", "figure"].includes(sub);
            rndPersona(sub, multi);
        } else if (sec === "look") {
            (s.look.looks || []).forEach(l => {
                if (sub === "top" || sub === "bottom" || sub === "footwear" || sub === "headwear") {
                    const lib = { top: TOPS_LIB, bottom: BOTTOMS_LIB, footwear: FOOTWEAR_LIB, headwear: HEADWEAR_LIB }[sub];
                    l[sub] = rnd(lib);
                    l[sub + "_color"] = rnd({ top: LOOK_COLORS, bottom: LOOK_COLORS,
                        footwear: FOOTWEAR_COLORS, headwear: HEADWEAR_COLORS }[sub])[0];
                    l[sub + "_material"] = rnd({ top: MATERIALS, bottom: MATERIALS,
                        footwear: FOOTWEAR_MATERIALS, headwear: ["knit", "wool", "cotton", "leather", "silk", "straw"] }[sub]);
                }
                if (sub === "accessories") {
                    l.accessories = rndN(ACCESSORIES_LIB, 2);
                    l.acc_color = rnd(ACC_COLORS)[0];
                }
            });
        } else if (sec === "scene") {
            if (sub === "location") s.scene.location = rnd(LOCATIONS);
            if (sub === "weather") s.scene.weather = rnd(WEATHER);
            if (sub === "light") s.light.setup = rnd(LIGHT_SETUPS);
        } else if (sec === "style") {
            if (sub === "grade") s.style.grade = rnd(STYLES);
            if (sub === "film") s.style.film = rnd(FILMS);
        } else if (sec === "camera") {
            if (sub === "framings") s.camera.framings = { mode: "multi", set: rndN(FRAMING_LIB.map((_, i) => i), 2), pin: null };
            if (sub === "focus") s.camera.focus = { mode: "multi", set: rndN(FOCUS_LIB.map((_, i) => i), 2), pin: null };
            if (sub === "lens") s.camera.lens = rnd(LENS_LIB);
            else if (sub === "formats") s.camera.formats = { mode: "multi", set: rndN(FORMAT_LIB.map((_, i) => i), 2), pin: 0 };
        } else if (sec === "pose") {
            s.pose.poses = { mode: "multi", set: rndN(POSE_LIB.map((_, i) => i), 3), pin: null };
        } else if (sec === "expression") {
            s.expression.expressions = { mode: "multi", set: rndN(EXPRESSION_LIB.map((_, i) => i), 2), pin: null };
        }
        sync();
    };

    const clearSub = (subKey) => {
        const [sec, sub] = subKey.split(".");
        const s = state;
        if (sec === "persona") { delete s.persona.fields[sub]; }
        else if (sec === "look") {
            (s.look.looks || []).forEach(l => {
                if (sub === "top" || sub === "bottom" || sub === "footwear") {
                    l[sub] = "";
                    l[sub + "_color"] = "";
                    l[sub + "_material"] = "";
                }
                if (sub === "headwear") { l.headwear = ""; l.headwear_color = ""; l.headwear_material = ""; }
                if (sub === "accessories") { l.accessories = []; l.acc_color = ""; }
            });
        }
        else if (sec === "scene") {
            if (sub === "light") { s.light.setup = ""; s.light.hour = -1; }
            else if (sub === "location") s.scene.location = "";
            else if (sub === "weather") { s.scene.weather = ""; s.scene.details = ""; }
        }
        else if (sec === "style") { s.style[sub] = ""; }
        else if (sec === "camera") {
            if (sub === "formats") s.camera.formats = { mode: "multi", set: [0], pin: 0 };
            else if (sub === "lens") s.camera.lens = "";
            else s.camera[sub] = { mode: "all", set: [], pin: null };
        }
        else if (sec === "pose") s.pose.poses = { mode: "all", set: [], pin: null };
        else if (sec === "expression") {
            s.expression.expressions = { mode: "all", set: [], pin: null };
        }
        sync();
    };
    const clearSection = (secKey) => {
        (SUBS[secKey] || []).forEach(sb => clearSub(secKey + "." + sb.key));
    };
    const resetAll = () => {
        Object.assign(state, DEFAULT_STATE());
        writeState(node, state);
        renderAll();
    };
    const hotkeys = (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
        const k = (e.key || "").toLowerCase();
        if (e.ctrlKey && k === "z") {
            e.preventDefault(); e.stopPropagation();
            e.shiftKey ? redo() : undo(); return;
        }
        if (e.ctrlKey && k === "y") {
            e.preventDefault(); e.stopPropagation(); redo(); return;
        }
        if (k !== "x") return;
        e.preventDefault();
        if (e.altKey) resetAll();
        else if (e.shiftKey) clearSection(ui.section);
        else {
            const subKey = ui.section === "persona" ? "persona." + ui.sub : ui.section + "." + ui.sub;
            if (ui.section === "session" || ui.section === "__neg") return;
            clearSub(subKey);
        }
    };
    el.addEventListener("keydown", hotkeys);
    el.tabIndex = 0;

    function renderAll() { renderHeader(); renderRail(); renderCenter(); renderRight(); renderDock(); }

    function renderHeader() {
        const seedW = node.widgets.find(w => w.name === "seed");
        const modes = [["single shot", "SINGLE SHOT"], ["session", "SESSION"]];
        const cur = node.widgets.find(w => w.name === "mode")?.value || "single shot";
        header.innerHTML = `
            <div class="plx-brand">PERFECTLAB STUDIO</div>
            <div class="plx-seg">${modes.map(([v, l]) =>
                `<button class="plx-seg-b ${cur === v ? "act" : ""}" data-mode="${v}">${l}</button>`).join("")}</div>
            <div class="plx-spacer"></div>
            <button class="plx-lint" data-lint style="display:none" title="prompt issues"></button>
            <input class="plx-inp" data-search placeholder="🔍 search libraries…" style="width:150px">
            ${cur === "single shot" ? `<input class="plx-inp tiny" type="number" min="1" max="100" data-variations title="variations" value="${node.widgets.find(w => w.name === "variations")?.value || 1}">` : ""}
            <button class="plx-go" data-shoot>● START SHOOT</button>
            <button class="plx-reset" data-undo title="Ctrl+Z -- undo the last pick">↶</button>
            <button class="plx-reset" data-redo title="Ctrl+Shift+Z -- redo">↷</button>
            <button class="plx-reset plx-reset-all" data-resetall title="Alt+X -- clear every pick">↺ RESET ALL</button>`;
        header.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
            const w = node.widgets.find(w => w.name === "mode");
            if (w) w.value = b.dataset.mode;
            renderHeader();
            renderCenter();
        });
        const varIn = header.querySelector("[data-variations]");
        if (varIn) varIn.onchange = () => {
            const w = node.widgets.find(w => w.name === "variations");
            if (w) w.value = Math.max(1, +varIn.value || 1);
        };
        header.querySelector("[data-shoot]").onclick = () => startShoot();
        const sbox = header.querySelector("[data-search]");
        if (sbox) {
            sbox.oninput = () => renderSearch(sbox.value);
            sbox.onkeydown = (e) => { if (e.key === "Escape") { sbox.value = ""; hideSearch(); } };
        }
        header.querySelector("[data-resetall]").onclick = () => { resetAll(); };
        header.querySelector("[data-undo]").onclick = () => undo();
        header.querySelector("[data-redo]").onclick = () => redo();
    }

    // does the section carry any active pick? the dot turns amber when it does
    const hasPicks = (sec) => {
        const s = state;
        switch (sec.key) {
            case "persona": return Object.values(s.persona.fields || {}).some(v =>
                Array.isArray(v) ? v.length : v);
            case "look": { const l = (s.look.looks || [])[0] || {};
                return !!(l.top || l.bottom || l.footwear || (l.accessories || []).length); }
            case "scene": return !!(s.scene.location || s.scene.weather || s.scene.details
                                    || s.light.setup || s.light.hour >= 0);
            case "style": return !!(s.style.grade || s.style.film || s.style.palette);
            case "camera": return s.camera.framings.mode !== "all" || s.camera.focus.mode !== "all"
                                    || (s.camera.formats.pin || 0) > 0 || !!s.camera.framing_order
                                    || !!s.camera.lens;
            case "pose": return s.pose.poses.mode !== "all";
            case "expression": return s.expression.expressions.mode !== "all";
            default: return false;
        }
    };

    // presets row (userdata-backed, the panel factory helper): lives once,
    // re-attached at the end of every rail render
    const presetsHost = document.createElement("div");
    presetsHost.className = "plx-presets-host";
    attachPresets(node, presetsHost, "node_data", "plstudio");
    node._plpReload = () => {
        const w = node.widgets.find(w2 => w2.name === "node_data");
        try { Object.assign(state, JSON.parse(w.value)); } catch (e) {}
        lastSnapshot = JSON.stringify(state);
        renderAll();
    };

    function renderRail() {
        rail.innerHTML = `<div>
                <div class="plx-rail-i overview ${ui.section === "__overview" ? "act" : ""}" data-sec="__overview" title="every pick of every section, one wall">
                    <span class="plx-tw"></span>
                    <span class="plx-rail-label">◈ OVERVIEW</span>
                </div>
            </div>` + SECTIONS.map(sec => {
            const off = (state.off || []).includes(sec.key);
            const on = ui.section === sec.key;
            const hot = !off && hasPicks(sec);
            const pickCount = sec.key === "persona" || sec.key === "look" || sec.key === "scene"
                || sec.key === "style" || sec.key === "camera" || sec.key === "pose"
                || sec.key === "expression"
                ? sectionPicks(sec.key, state).length : 0;
            const open = ui.railOpen === sec.key;
            const subsList = SUBS[sec.key] || [];
            const subs = open ? subsList.map(sb => `
                <div class="plx-rail-sub ${on && ui.sub === sb.key ? "act" : ""}"
                     data-subnav="${sb.key}">${sb.label}</div>`).join("") : "";
            return `<div data-sec="${sec.key}">
                <div class="plx-rail-i ${on ? "act" : ""}" data-sec="${sec.key}" title="click: open the section${subsList.length ? " and its subsections" : ""}">
                    <span class="plx-tw ${open ? "open" : ""} ${subsList.length ? "has" : ""}">${subsList.length ? "▸" : ""}</span>
                    <span class="plx-rail-label">${sec.label}</span>
                    ${pickCount ? `<span class="plx-rail-count" title="${pickCount} picked">${pickCount}</span>` : ""}
                    ${sec.key !== "session" ? `<button class="plx-dot ${off ? "" : hot ? "hot" : "on"}" data-off="${sec.key}" title="${off ? "off" : hot ? "picks active" : "on"}"></button>` : ""}
                </div>
                ${open && subsList.length > 1 ? `<div class="plx-rail-subs">${subs}</div>` : ""}
            </div>`;
        }).join("") + `<div class="plx-rail-i dim" data-sec="__neg">NEGATIVE</div>
        <a class="plx-tg" href="https://t.me/PerfectJohny" target="_blank" rel="noopener"
           title="author & support">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M21.9 4.6c.3-1.3-.8-2-1.9-1.6L2.7 9.7c-1.3.5-1.2 1.9-.1 2.3l4.4 1.4 1.7 5.2c.3.9 1.5 1.2 2.2.5l2.3-2.1 4.4 3.2c.9.6 2.1.2 2.3-.9l3.3-14.7zM8.2 12.9l9.4-5.9c.4-.3.8.2.5.6l-7.7 7-.3 3.1-1.9-4.8z"/></svg>
            @PerfectJohny</a>
        <div class="plx-rail-keys">X · clear card<br>Shift+X · clear section<br>Alt+X · reset all</div>
        <div class="plx-rail-ver">PerfectLab v1.0.0</div>`;
        // the category row: one click opens (and selects); a second closes
        rail.querySelectorAll("[data-sec]").forEach(r => r.onclick = e => {
            if (e.target.dataset.off !== undefined || e.target.dataset.subnav) return;
            const key = r.dataset.sec;
            if (key === "__neg" || key === "__overview") { ui.section = key; renderAll(); return; }
            ui.section = key;
            ui.railOpen = key;
            const subsList = SUBS[key] || [];
            if (!subsList.some(sb => sb.key === ui.sub)) ui.sub = subsList[0]?.key || "";
            if (key === "persona" && subsList.some(sb => sb.key === ui.sub)) ui.personaField = ui.sub;
            renderAll();
        });
        rail.querySelectorAll("[data-subnav]").forEach(f => f.onclick = e => {
            e.stopPropagation();
            ui.section = f.closest("[data-sec]")?.dataset.sec || ui.section;
            ui.sub = f.dataset.subnav;
            if (ui.section === "persona") ui.personaField = ui.sub;
            ui.railOpen = ui.section;
            renderAll();
        });
        rail.appendChild(presetsHost);
        rail.querySelectorAll("[data-off]").forEach(d => d.onclick = e => {
            e.stopPropagation();
            const k = d.dataset.off;
            state.off = state.off || [];
            const i2 = state.off.indexOf(k);
            if (i2 >= 0) state.off.splice(i2, 1); else state.off.push(k);
            sync();
        });
    }

    // the overview screen: every pick of every section on one wall --
    // the visual picture of the assembled tags
    const renderOverview = () => {
        const rows = SECTIONS.filter(sec => sec.key !== "session").map(sec => {
            const picks = sectionPicks(sec.key, state);
            if (!picks.length) return "";
            return `<div class="plx-ov-row">
                <div class="plx-ov-label" data-sec="${sec.key}">${sec.label}</div>
                <div class="plx-ov-picks">${picks.join("")}</div>
            </div>`;
        }).join("");
        const anyPicks = SECTIONS.some(sec =>
            sectionPicks(sec.key, state).length);
        center.innerHTML = `
            <div class="plx-sec-head">
                <div class="plx-sec-title">THE SHOOT AT A GLANCE</div>
                <button class="plx-btn warn" data-clearall title="Alt+X">reset everything</button>
            </div>
            ${anyPicks ? rows : `<div class="plx-stage-hint">Nothing picked yet. Walk the sections on the left -- every tile you click lands here, one line per section, the whole shoot on one wall.</div>`}
            <div class="plx-stage-hint">Press ● START SHOOT in the header when the picture looks right.</div>`;
        center.querySelectorAll("[data-clearall]").forEach(b => b.onclick = () => resetAll());
        center.querySelectorAll(".plx-ov-label").forEach(l => l.onclick = () => {
            ui.section = l.dataset.sec;
            ui.railOpen = ui.section;
            const subsList = SUBS[ui.section] || [];
            if (!subsList.some(sb => sb.key === ui.sub)) ui.sub = subsList[0]?.key || "";
            renderAll();
        });
    };

    function renderCenter() {
        if (ui.section === "__overview") { renderOverview(); return; }
        const sec = SECTIONS.find(s2 => s2.key === ui.section);
        const stageHints = null;
        const stage = null;
        if (!sec) { center.innerHTML = NEGATIVE(state); wireCenter(); return; }
        const subsList = SUBS[sec.key] || [];
        if (!ui.sub || !subsList.some(sb => sb.key === ui.sub)) ui.sub = subsList[0]?.key || "";
        let body;
        if (sec.key === "persona") body = personaSub(state, ui, ui.sub);
        else body = (SUB_RENDER[sec.key] && SUB_RENDER[sec.key][ui.sub])
            ? SUB_RENDER[sec.key][ui.sub](state, ui) : sec.render(state, ui);
        const picks = sectionPicks(sec.key, state);
        const picksLine = sec.key === "session"
            ? "" : (picks.length
                ? `<div class="plx-picks-line" title="what this section has picked so far">${picks.join("")}</div>`
                : `<div class="plx-picks-line empty">nothing picked yet -- the subsections below are all yours</div>`);
        center.innerHTML = `
            ${stageHints ? `<div class="plx-stage-hint">${stageHints[stage] || ""}</div>` : ""}
            ${picksLine}
            <div class="plx-sec-head">
                <div class="plx-sec-title">${sec.label}</div>
                <button class="plx-btn warn" data-clearsec="${sec.key}" title="Shift+X">clear ${sec.label.toLowerCase()}</button>
            </div>
            ${body}`;
        wireCenter();
    }

    function wireCenter() {
        // persona
        center.querySelectorAll("[data-field]").forEach(b => b.onclick = () => {
            ui.personaField = b.dataset.field; renderCenter(); renderDock(); });
        center.querySelectorAll(".plx-chip[data-val]").forEach(c => c.onclick = () => {
            const v = c.dataset.val;
            if (ui.section === "persona") {
                const key = ui.personaField;
                const multi = c.dataset.multi === "true";
                const cur = state.persona.fields[key];
                if (multi) {
                    const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
                    const i2 = arr.indexOf(v);
                    if (i2 >= 0) arr.splice(i2, 1); else arr.push(v);
                    state.persona.fields[key] = arr;
                } else {
                    state.persona.fields[key] = state.persona.fields[key] === v ? "" : v;
                }
            } else if (ui.section === "scene") {
                const t = c.dataset.t;
                if (t === "setup") state.light.setup = state.light.setup === v ? "" : v;
                else state.scene[t] = state.scene[t] === v ? "" : v;
            } else if (ui.section === "style") {
                state.style[c.dataset.t] = state.style[c.dataset.t] === v ? "" : v;
                ui.styleCat = c.dataset.t === "film" ? "film" : "style";
            }
            sync();
        });
        // chipGrid pins/multis (camera, pose, expression) -- identify the
        // grid by its position among the section's chip grids. The card
        // layout has no .plx-sec-body anymore -- the section owns its grids.
        // Camera keeps one walk grid (focus), pose its 32, expression its 28.
        center.querySelectorAll(".plp-chip[data-i]").forEach(c => c.onclick = e => {
            if (e.target.dataset.fav !== undefined) return;
            const idx = +c.dataset.i;
            const gridEl = c.closest(".plp-chips");
            if (!gridEl || !center.contains(gridEl)) return;
            let selObj, multi;
            if (ui.section === "camera") {
                selObj = state.camera.focus; multi = true;
            } else if (ui.section === "pose") {
                selObj = state.pose.poses; multi = true;
            } else {
                selObj = state.expression.expressions; multi = true;
            }
            if (!selObj) return;
            if (multi) {
                selObj.mode = "multi";
                selObj.set = selObj.set || [];
                const i2 = selObj.set.indexOf(idx);
                if (i2 >= 0) selObj.set.splice(i2, 1); else selObj.set.push(idx);
            } else {
                selObj.mode = "pin"; selObj.pin = idx;
            }
            sync();
        });
        center.querySelectorAll('[data-mode="all"]').forEach(b => b.onclick = e => {
            e.stopPropagation();
            if (!center.contains(b.closest(".plp-chips"))) return;
            if (ui.section === "camera") {
                state.camera.focus = { mode: "all", set: [], pin: null };
            } else if (ui.section === "pose") {
                state.pose.poses = { mode: "all", set: [], pin: null };
            } else {
                state.expression.expressions = { mode: "all", set: [], pin: null };
            }
            sync();
        });
        // inputs
        center.querySelectorAll("[data-own]").forEach(inp => inp.onchange = () => {
            const key = inp.dataset.own;
            if (inp.value.trim()) state.persona.fields[key] = inp.value.trim();
            else if (PERSONA_FIELDS.find(f2 => f2.key === key) && !PERSONA_FIELDS.find(f2 => f2.key === key).options.includes(state.persona.fields[key]))
                state.persona.fields[key] = "";
            sync();
        });
        center.querySelectorAll("[data-clear]").forEach(b => b.onclick = () => {
            delete state.persona.fields[b.dataset.clear]; sync(); });
        center.querySelectorAll("[data-ownscene]").forEach(inp => inp.onchange = () => {
            state.scene[inp.dataset.ownscene] = inp.value.trim(); sync(); });
        center.querySelectorAll("[data-ownlight]").forEach(inp => inp.onchange = () => {
            state.light.setup = inp.value.trim(); sync(); });
        center.querySelectorAll("[data-ownstyle]").forEach(inp => inp.onchange = () => {
            state.style[inp.dataset.ownstyle] = inp.value.trim(); sync(); });
        // the v1 palette, back: swatch picks + modifier presets write the line
        center.querySelectorAll("[data-pal]").forEach(b => b.onclick = () => {
            const cur = paletteColors(state);
            const n = b.dataset.pal;
            const next = cur.includes(n) ? cur.filter(x => x !== n)
                : (cur.length >= 5 ? cur : [...cur, n]);
            state.style.palette = (paletteMod(state) ? paletteMod(state) + " " : "") + next.join(", ");
            sync(); });
        center.querySelectorAll("[data-palmod]").forEach(c => c.onclick = () => {
            const colors = paletteColors(state).join(", ");
            state.style.palette = c.dataset.palmod
                ? c.dataset.palmod + " " + colors : colors;
            sync(); });
        center.querySelectorAll("[data-hour]").forEach(inp => inp.onchange = () => {
            state.light.hour = Math.max(-1, Math.min(24, +inp.value || -1)); sync(); });
        center.querySelectorAll("[data-li]").forEach(inp => inp.onchange = () => {
            const k = inp.dataset.k;
            const value = inp.value.trim();
            if (k === "accessories") {
                state.look.looks[+inp.dataset.li].accessories =
                    value ? value.split(",").map(x => x.trim()).filter(Boolean) : [];
            } else {
                state.look.looks[+inp.dataset.li][k] = value;
            }
            if (k === "name") sync(); else { writeState(node, state); renderRight(); renderCenter(); } });
        // garment picks: click a tile -> fill the slot; click again -> clear
        center.querySelectorAll("[data-pick]").forEach(gc => gc.onclick = () => {
            const l = state.look.looks[+gc.closest(".plx-look").dataset.liCard];
            l[gc.dataset.pick] = l[gc.dataset.pick] === gc.dataset.val ? "" : gc.dataset.val;
            sync(); });
        // the LIBRARY row: typed-before entries with their shot/photo tiles
        center.querySelectorAll(".plx-look").forEach(card => {
            const slotName = card.dataset.slotCard;
            if (!slotName) return;
            const li = +card.dataset.liCard;
            wireLib(card, "wardrobe__" + slotName,
                (entry) => { state.look.looks[li][slotName] = entry; sync(); },
                () => { renderCenter(); });
            libSync("wardrobe__" + slotName, card, () => renderCenter());
        });
        center.querySelectorAll("[data-pick-acc]").forEach(gc => gc.onclick = () => {
            const l = state.look.looks[+gc.closest(".plx-look").dataset.liCard];
            const arr = Array.isArray(l.accessories) ? l.accessories : [];
            const v = gc.dataset.pickAcc;
            const j = arr.indexOf(v);
            if (j >= 0) arr.splice(j, 1); else arr.push(v);
            l.accessories = arr;
            sync(); });
        // color swatches and material chips on a look
        center.querySelectorAll("[data-color]").forEach(sw => sw.onclick = () => {
            const l = state.look.looks[+sw.dataset.li];
            l[sw.dataset.ck] = l[sw.dataset.ck] === sw.dataset.color ? "" : sw.dataset.color;
            sync(); });
        center.querySelectorAll("[data-mat]").forEach(mc => mc.onclick = () => {
            const l = state.look.looks[+mc.dataset.li];
            l[mc.dataset.ck] = l[mc.dataset.ck] === mc.dataset.mat ? "" : mc.dataset.mat;
            sync(); });
        // format chips: multi-select -- each frame takes the next picked ratio
        center.querySelectorAll("[data-fmt]").forEach(fc => fc.onclick = () => {
            const idx = +fc.dataset.fmt;
            const sel = state.camera.formats;
            sel.mode = "multi";
            sel.set = sel.set || [];
            const j = sel.set.indexOf(idx);
            if (j >= 0) sel.set.splice(j, 1); else sel.set.push(idx);
            if (!sel.set.length) sel.set = [idx];   // never empty: one pick remains
            sync(); });
        // framing chips: multi-select walk (same contract as the other walks)
        center.querySelectorAll("[data-fr]").forEach(fc => fc.onclick = () => {
            const sel = state.camera.framings;
            const idx = +fc.dataset.fr;
            sel.mode = "multi";
            sel.set = sel.set || [];
            const j = sel.set.indexOf(idx);
            if (j >= 0) sel.set.splice(j, 1); else sel.set.push(idx);
            sync(); });
        // favourites: the star works again -- stable scope per grid
        const favScope = () => {
            if (ui.section === "camera") return ["plx.cam.framings", "plx.cam.focus"];
            if (ui.section === "pose") return ["plx.poses"];
            return ["plx.expressions"];
        };
        center.querySelectorAll(".plp-star").forEach(st => st.onclick = (e) => {
            e.stopPropagation();
            const gi = [...center.querySelectorAll(".plp-chips")]
                .indexOf(st.closest(".plp-chips"));
            const scopes = favScope();
            const scope = scopes[Math.min(gi, scopes.length - 1)];
            toggleFav(scope, +st.dataset.fav);
            renderCenter(); renderDock();
        });
        center.querySelectorAll("[data-addlook]").forEach(b => b.onclick = () => {
            state.look.looks.push({ name: "Look " + (state.look.looks.length + 1),
                                    top: "", bottom: "", footwear: "", details: "" }); sync(); });
        center.querySelectorAll("[data-dellook]").forEach(b => b.onclick = () => {
            state.look.looks.splice(+b.dataset.dellook, 1);
            if (!state.look.looks.length) state.look.looks.push({ name: "Look 1" });
            sync(); });
        center.querySelectorAll("[data-clearsub]").forEach(b => b.onclick = () => clearSub(b.dataset.clearsub));
        center.querySelectorAll("[data-reroll]").forEach(b => b.onclick = () => reroll(b.dataset.reroll));
        center.querySelectorAll("[data-clearsec]").forEach(b => b.onclick = () => clearSection(b.dataset.clearsec));
        center.querySelectorAll("[data-order]").forEach(c => c.onchange = () => {
            state.camera.framing_order = c.checked ? "wide-to-close" : ""; sync(); });
        center.querySelectorAll("[data-count]").forEach(inp => inp.onchange = () => {
            state.session.count = Math.max(1, Math.min(100, +inp.value || 1)); sync(); });
        center.querySelectorAll("[data-takes]").forEach(inp => inp.onchange = () => {
            state.session.takes = Math.max(1, Math.min(4, +inp.value || 1)); sync(); });
        center.querySelectorAll("[data-rotation]").forEach(inp => inp.onchange = () => {
            state.session.look_rotation = inp.value; sync(); });
        center.querySelectorAll("[data-coup]").forEach(c => c.onchange = () => {
            state.session[c.dataset.coup] = c.checked; sync(); });
        center.querySelectorAll("[data-negon]").forEach(c => c.onchange = () => {
            state.negative.enabled = c.checked; sync(); });
        center.querySelectorAll("[data-neg]").forEach(inp => inp.onchange = () => {
            state.negative.text = inp.value; writeState(node, state); });
        center.querySelectorAll("[data-negp]").forEach(c => c.onclick = () => {
            const list = state.negative.presets || [];
            state.negative.presets = list.includes(c.dataset.negp)
                ? list.filter(x => x !== c.dataset.negp)
                : [...list, c.dataset.negp];
            sync(); });
        center.querySelectorAll("[data-lens]").forEach(c => c.onclick = () => {
            state.camera.lens = state.camera.lens === c.dataset.lens ? "" : c.dataset.lens;
            sync(); });
        center.querySelectorAll("[data-shoottile]").forEach(b => b.onclick = () => {
            const v = (b.parentElement.querySelector("input")?.value || "").trim();
            if (v) shootTile(b.dataset.shoottile, v); });
    }

    // ---- the prompt linter: token budget, duplicates, brace balance,
    // choice syntax, wildcard names ----------------------------------------
    function lintPrompt(lt, s) {
        const issues = [];
        if (lt.tokens > 400) issues.push({
            t: "tokens", d: `${lt.tokens} tokens -- over the Z-Image budget (400). Trim picks, or the engine's guard drops slots.` });
        // duplicates: same value picked twice (a pick and a typed copy)
        const seen = new Set();
        for (const part of lt.parts) {
            const k = (part || "").toLowerCase().replace(/[.,]/g, "").trim();
            if (k.length < 4 || k.includes(":") || k.includes("\n")) continue;
            if (seen.has(k)) issues.push({ t: "duplicate", d: `"${k}" appears twice in the prompt.` });
            seen.add(k);
        }
        // unbalanced braces: leftovers after both resolvers ran
        if ((lt.text.match(/\{/g) || []).length !== (lt.text.match(/\}/g) || []).length)
            issues.push({ t: "braces", d: "Unbalanced { } in the prompt -- a choice or wildcard never resolved." });
        // a choice without a pipe is not a choice
        const pointless = (lt.raw || "").match(/\{[^{}|]+\}/g);
        if (pointless) issues.push({
            t: "choice", d: `"${pointless[0]}" has no | -- drop the braces or add alternatives.` });
        // a wildcard token that stayed after resolution
        const wc = lt.text.match(/__([A-Za-z0-9_-]+)__/g);
        if (wc) issues.push({
            t: "wildcard", d: `__${wc[0].replace(/__/g, "")}__ has no file in web/wildcards/ -- the token goes to the model as-is.` });
        // negative enabled but empty
        if (s.negative.enabled && !s.negative.text
            && !(s.negative.presets || []).length)
            issues.push({ t: "negative", d: "The negative is ON but empty -- pick guards or write a line." });
        return issues;
    }

    function renderRight() {
        const lt = liveText(state,
            +node.widgets.find(w => w.name === "seed")?.value || 0);
        const { text, tokens } = lt;
        const issues = lintPrompt(lt, state);
        right.innerHTML = `
            <div class="plx-sub">trigger / prefix</div>
            <div class="plx-row"><input class="plx-inp" data-trigger value="${esc(state.persona.trigger)}" placeholder="LoRA trigger (JW…)"></div>
            <div class="plx-row"><input class="plx-inp" data-main value="${esc(state.shot.main_prompt)}" placeholder="prefix / trigger line (JW, JWBody, …)"></div>
            <div class="plx-sub">own prompt additions <span class="plx-dim">appended to every shot</span></div>
            <div class="plx-row"><textarea class="plx-inp plx-wide" data-custom rows="4"
                placeholder="anything you want in every prompt: quality tags, camera quirks, extra words…">${esc(state.shot.custom || "")}</textarea></div>
            <div class="plx-sub">prompt style <span class="plx-dim">SDXL reads tags, not sentences</span></div>
            <div class="plx-row"><select class="plx-inp" data-stylemode>
                <option value="natural" ${(state.shot.style_mode || "natural") === "natural" ? "selected" : ""}>natural language (Flux / Z-Image)</option>
                <option value="tags" ${(state.shot.style_mode || "natural") === "tags" ? "selected" : ""}>SDXL tags (comma list)</option>
            </select></div>
            <div class="plx-sub">LIVE TEXT <span class="plx-dim ${tokens > 400 ? "over" : ""}">estimate · ${tokens} tok${tokens > 400 ? " -- over the Z-Image budget, trim picks or the guard drops slots" : ""}</span></div>
            <div class="plx-live">${esc(text)}</div>
            <div class="plx-sub">SESSION PLAN</div>
            <div class="plx-session">
                One START SHOOT renders <b>${state.session.count * state.session.takes}</b> frame${state.session.count * state.session.takes > 1 ? "s" : ""}
                (<b>${state.session.count}</b> shot${state.session.count > 1 ? "s" : ""}, <b>${state.session.takes}</b> take${state.session.takes > 1 ? "s" : ""} each).<br>
                ${(state.look.looks || []).length > 1 ? `${(state.look.looks || []).length} looks rotate ${esc(state.session.look_rotation)}.` : "One look for the whole session."}<br>
            </div>`;
        // the linter badge: amber when issues exist, its title carries the list
        const lintBtn = header.querySelector("[data-lint]");
        if (lintBtn) {
            lintBtn.style.display = issues.length ? "" : "none";
            lintBtn.textContent = `⚠ ${issues.length}`;
            lintBtn.className = `plx-lint ${issues.length ? "on" : ""}`;
            lintBtn.onclick = () => {
                lintOverlay.innerHTML = issues.map(i =>
                    `<div class="plx-sr"><span class="plx-lint-tag">${esc(i.t)}</span>${esc(i.d)}</div>`).join("");
                lintOverlay.style.display = lintOverlay.style.display === "none" ? "" : "none";
            };
        }
        right.querySelector("[data-main]").onchange = e => {
            state.shot.main_prompt = e.target.value; writeState(node, state); renderRight(); };
        right.querySelector("[data-custom]").onchange = e => {
            state.shot.custom = e.target.value; writeState(node, state); renderRight(); };
        right.querySelector("[data-stylemode]").onchange = e => {
            state.shot.style_mode = e.target.value; writeState(node, state); renderRight(); };
        right.querySelector("[data-trigger]").onchange = e => {
            state.persona.trigger = e.target.value; writeState(node, state); renderRight(); };
    }

    // ---- preview dock: 8 tiles, paging ---------------------------------
    function dockItems() {
        if (ui.results) return { imgs: ui.results, label: "LAST SHOOT" };
        const sec = SECTIONS.find(s2 => s2.key === ui.section);
        if (!sec) return { imgs: [], label: "PREVIEW" };
        const label = sec.label + " · PREVIEW";
        const CAT_COUNT = { gender: 5, age: 5, hairstyle: 24, hair_color: 14, eyes: 10, makeup: 20,
                            skin: 8, signature: 12, body: 22, accessories: 28, headwear: 13, look_color: 17, footwear_color: 12, headwear_color: 14, acc_color: 8, outfit: 14,
                            location: 23, weather: 10, lighting: 19, style: 16,
                            film: 10, framing: 12, lens: 5, pose: 36, expression: 28 };
        let imgcat, count;
        if (sec.key === "persona") {
            const f = PERSONA_FIELDS.find(x => x.key === ui.personaField);
            imgcat = f.imgcat; count = CAT_COUNT[f.imgcat] || 0;
        } else if (sec.key === "style") {
            imgcat = ui.styleCat || "style"; count = CAT_COUNT[imgcat] || 0;
        } else {
            imgcat = sec.imgcat; count = CAT_COUNT[sec.imgcat] || 0;
        }
        if (!imgcat || !count) return { imgs: [], label: sec.label + " · no tiles" };
        return { imgs: Array.from({ length: count }, (_, i) => itemImg(imgcat, i)), label };
    }

    function renderDock() {
        // the dock exists for ONE thing: the frames the last START SHOOT
        // rendered (and their re-shoot clicks). While planning, it stays out
        // of the way and the editor takes its space.
        if (!ui.results || !ui.results.length) { dock.style.display = "none"; return; }
        dock.style.display = "";
        const { imgs, label } = dockItems();
        const per = 8;   // one page: a 4x2 grid of large tiles
        const pages = Math.max(1, Math.ceil(imgs.length / per));
        ui.dockPage = Math.min(ui.dockPage, pages - 1);
        const slice = imgs.slice(ui.dockPage * per, ui.dockPage * per + per);
        const reshootable = node.widgets.find(w => w.name === "mode")?.value === "session";
        dock.innerHTML = `
            <div class="plx-dock-bar">
                <span class="plx-dock-label">${label}</span>
                <div class="plx-dots">${Array.from({ length: pages }, (_, p) =>
                    `<i class="${p === ui.dockPage ? "on" : ""}" data-page="${p}"></i>`).join("")}</div>
                <button class="plx-nav" data-prev>‹</button>
                <button class="plx-nav" data-next>›</button>
            </div>
            <div class="plx-dock-tiles" style="grid-template-columns:repeat(${Math.min(4, slice.length || 1)}, 1fr)">${slice.map((src, k) => `
                <div class="plx-tile ${ui.results && reshootable ? "pick" : ""}" data-t="${ui.dockPage * per + k}" title="${ui.results ? "re-shoot this frame" : ""}">
                    ${src.startsWith("data:") || src.includes("/view?") || src.includes("filename=")
                        ? `<img src="${src}">` : `<img src="${src}?v=${GUIDE_V}">`}
                </div>`).join("")}</div>`;
        dock.querySelector("[data-prev]").onclick = () => { ui.dockPage = Math.max(0, ui.dockPage - 1); renderDock(); };
        dock.querySelector("[data-next]").onclick = () => { ui.dockPage = Math.min(pages - 1, ui.dockPage + 1); renderDock(); };
        dock.querySelectorAll("[data-page]").forEach(d => d.onclick = () => { ui.dockPage = +d.dataset.page; renderDock(); });
        dock.querySelectorAll(".plx-tile.pick").forEach(t => t.onclick = () => {
            state.session.reshoot_shot = +t.dataset.t;
            writeState(node, state);
            renderHeader();
            startShoot();
        });
    }

    // ---- START SHOOT ---------------------------------------------------
    async function startShoot() {
        writeState(node, state);
        let p;
        try { p = await app.graphToPrompt(); }
        catch (e) { console.warn("PerfectLab: graphToPrompt failed", e); return; }
        const body = JSON.stringify({ prompt: p.output, client_id: "plx-" + uid() });
        const r = await fetch("/prompt", { method: "POST",
            headers: { "Content-Type": "application/json" }, body });
        const { prompt_id, error } = await r.json().catch(() => ({}));
        if (!prompt_id) { console.warn("PerfectLab: queue failed", error); return; }
        dock.querySelector(".plx-dock-label").textContent = "SHOOTING…";
        const t0 = Date.now();
        const poll = async () => {
            let hist;
            try { hist = await (await fetch("/history/" + prompt_id)).json(); }
            catch (e) { return setTimeout(poll, 1000); }
            const h = hist[prompt_id];
            if (!h) return setTimeout(poll, 800);
            const imgs = [];
            for (const out of Object.values(h.outputs || {}))
                for (const im of out.images || [])
                    imgs.push(`/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || "")}&type=${im.type || "output"}`);
            ui.results = imgs;
            ui.dockPage = 0;
            dock.querySelector(".plx-dock-label").textContent = `SHOT ${imgs.length} · ${Math.round((Date.now() - t0) / 1000)}s`;
            renderDock();
        };
        poll();
    }

    // ---- library search: every list on one type ------------------------
    const searchOverlay = document.createElement("div");
    searchOverlay.className = "plx-searchbox";
    searchOverlay.style.display = "none";
    el.appendChild(searchOverlay);
    // the linter's issue list rides the same overlay style
    const lintOverlay = document.createElement("div");
    lintOverlay.className = "plx-searchbox plx-lintbox";
    lintOverlay.style.display = "none";
    el.appendChild(lintOverlay);
    document.addEventListener("mousedown", (e) => {
        if (!lintOverlay.contains(e.target)) lintOverlay.style.display = "none";
    }, true);
    const SEARCH_INDEX = searchIndex();
    function hideSearch() { searchOverlay.style.display = "none"; }
    function renderSearch(q) {
        q = (q || "").trim().toLowerCase();
        if (q.length < 2) { hideSearch(); return; }
        const hits = SEARCH_INDEX.filter(r => r.label.toLowerCase().includes(q)).slice(0, 24);
        if (!hits.length) { hideSearch(); return; }
        searchOverlay.innerHTML = hits.map(r => `
            <div class="plx-sr" data-sr='${esc(JSON.stringify(r))}'>
                ${r.cat ? `<img draggable="false" src="${itemImg(r.cat, r.idx)}">`
                        : `<span class="plx-pick-letter">${esc(r.label.slice(0, 2).toUpperCase())}</span>`}
                <span>${esc(r.label)}</span>
                <span class="plx-sr-sec">${r.sec} · ${r.sub}</span>
            </div>`).join("");
        searchOverlay.style.display = "";
        searchOverlay.querySelectorAll("[data-sr]").forEach(rowEl => rowEl.onclick = () => {
            const r = JSON.parse(rowEl.dataset.sr);
            hideSearch();
            ui.section = r.sec;
            ui.sub = r.sub;
            if (r.sec === "persona") ui.personaField = r.sub;
            renderCenter(); renderRail();
            setTimeout(() => {
                const chip = [...document.querySelectorAll(".plx-center .plx-chip, .plx-center .plp-chip")]
                    .find(c => (c.dataset.val || (c.querySelector("span")?.textContent.trim() || "")) === r.label);
                if (chip) chip.click();
            }, 80);
        });
    }
    document.addEventListener("mousedown", (e) => {
        if (!searchOverlay.contains(e.target) && e.target?.dataset?.search === undefined) hideSearch();
    }, true);

    // ---- shoot a preview tile for a custom wardrobe entry ---------------
    // one catalog-style frame through the CURRENT graph (your models, your
    // LoRAs), cropped 240x240 and stored beside the attach-a-photo flow,
    // so the entry's chip shows a real tile in the LIBRARY row.
    async function shootTile(scope, entry) {
        libAdd(scope, entry);
        const cur = JSON.stringify(state);
        const tileState = JSON.parse(cur);
        Object.assign(tileState, {
            negative: { enabled: false, text: "", presets: [] },
            persona: { trigger: "", fields: {} },
            look: { looks: [{ name: "tile" }] },
            scene: { location: "", weather: "", details: "" },
            light: { setup: "", hour: -1 },
            style: { grade: "", film: "", palette: "" },
            pose: { poses: { mode: "all", set: [], pin: null } },
            expression: { arc: "", expressions: { mode: "all", set: [], pin: null } },
            camera: { framings: { mode: "all", set: [], pin: null },
                      focus: { mode: "all", set: [], pin: null },
                      formats: { mode: "pin", set: [], pin: 0 },
                      framing_order: "", lens: "" },
            shot: { main_prompt: "A clean catalog photograph demonstrating: " + entry +
                    ", photorealistic, plain warm light-grey seamless backdrop, the subject alone" +
                    " centered and filling the frame, bright even light, no text, no watermark",
                    custom: "", style_mode: "natural" },
            session: { count: 1, takes: 1, mood_subject: true, takes_arc: false,
                       pose_arc: false, place_arc: false, crop_arc: false, focus_arc: false,
                       look_rotation: "blocks", reshoot_shot: 0 }
        });
        writeState(node, tileState);
        let p;
        try { p = await app.graphToPrompt(); }
        catch (e) { console.warn("PerfectLab: tile graphToPrompt failed", e); writeState(node, JSON.parse(cur)); return; }
        writeState(node, JSON.parse(cur));
        const r = await fetch("/prompt", { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: p.output, client_id: "plx-" + uid() }) });
        const { prompt_id } = await r.json().catch(() => ({}));
        if (!prompt_id) return;
        const poll = async () => {
            let hist;
            try { hist = await (await fetch("/history/" + prompt_id)).json(); }
            catch (e) { return setTimeout(poll, 1000); }
            const h = hist[prompt_id];
            if (!h) return setTimeout(poll, 800);
            let url = null;
            for (const out of Object.values(h.outputs || {}))
                for (const im of out.images || []) {
                    url = "/view?filename=" + encodeURIComponent(im.filename) +
                        "&subfolder=" + encodeURIComponent(im.subfolder || "") +
                        "&type=" + (im.type || "output");
                    break;
                }
            if (!url) return;
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = async () => {
                const S = 240, m = Math.min(img.width, img.height);
                const c = document.createElement("canvas");
                c.width = S; c.height = S;
                c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
                c.toBlob(async (blob) => {
                    if (blob && await libImgPut(scope, entry, blob)) renderCenter();
                }, "image/jpeg", 0.88);
            };
            img.src = url;
        };
        poll();
    }

    renderAll();
    wcRerender = renderRight;

    const onConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
        Object.assign(state, readState(this));
        renderAll();
        requestAnimationFrame(syncSize);
        return r;
    };
    node._plxState = state;
}

app.registerExtension({
    name: "PerfectLab.Studio",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PerfectLabStudio") return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            buildPanel(this);
            return r;
        };
    },
});
