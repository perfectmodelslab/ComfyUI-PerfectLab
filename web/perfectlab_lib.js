// PerfectLab shared libraries -- the single source of truth for the
// shoot-parameter nodes and the Series preview. Mirrors shoot_nodes.py.
// Emotional arcs: named keypoint sequences over EXPRESSION_LIB indices, one
// curve per dramaturgy. Resampled to the session length, so any count keeps
// the arc's shape (a 5-shot session still ends on the climax). Mirrors ARCS
// in shoot_nodes.py -- edit both together.
// PerfectLab shared libraries -- the LISTS live in the generated
// perfectlab_libraries.js (built by tools/build_libraries.py from the
// Python engine sources); this file re-exports them and keeps the logic
// tables that mirror series_nodes.py.
import { POSE_LIB, EXPRESSION_LIB, FRAMING_LIB, FOCUS_LIB, FORMAT_LIB }
    from "./perfectlab_libraries.js?v=1.0.0";
export { POSE_LIB, EXPRESSION_LIB, FRAMING_LIB, FOCUS_LIB, FORMAT_LIB };

export const ARC_LIB = {
    "quiet to climax": [22, 26, 1, 3, 23, 0],
    "slow burn":       [13, 10, 14, 26, 9, 2],
    "first date":      [20, 26, 18, 4, 2, 15],
    "joy run":         [20, 1, 26, 12, 23, 0],
    "cold front":      [22, 19, 24, 6, 27, 21],
    "melancholy fade": [17, 10, 13, 25, 22, 8],
    "story wave":      [8, 22, 26, 3, 5, 23, 0, 12, 15, 2, 25, 17],
};
export const ARC_DESC = {
    "quiet to climax": "serene → curious → soft smile → half-smile → excited → laughing out loud",
    "slow burn":       "pensive → daydream → sideways glance → curious → smirk → biting her lip",
    "first date":      "shy smile → curious tilt → tongue-in-cheek → wink → biting her lip → a kiss",
    "joy run":         "shy smile → soft smile → curious → toothy grin → excited → laughing",
    "cold front":      "serene → chin up → skeptical → cold stare → steely → fierce glare",
    "melancholy fade": "tired gaze → daydream → pensive → melancholic → serene → eyes closed",
    "story wave":      "a full session: quiet → rise → laughter → playfulness → fall → tired stillness",
};
export const PLACEMENT_LIB = [
    "centered in frame", "on the left third", "on the right third", "close to the camera",
    "deep in the scene", "framed by the surroundings",
    "slightly off-center, looking into the empty space",
    "dominating the lower half of the frame",
];
export const TIERS = { "extreme close-up": "close", "close-up": "close", "portrait shot": "close",
                       "profile shot": "close",
                       "medium shot": "medium", "cowboy shot": "medium",
                       "over-the-shoulder shot": "medium", "low-angle shot": "medium",
                       "high-angle shot": "medium", "dutch-angle shot": "medium",
                       "full body shot": "figure", "wide shot": "figure" };
// framing labels with their camera-side wording -- mirrors FRAMING_TEXTS in
// series_nodes.py, proportions included, so the preview matches the server
export const FRAMING_TEXTS = {
    "extreme close-up": "extreme close-up shot",
    "close-up": "close-up shot",
    "portrait shot": "portrait shot, head and shoulders",
    "profile shot": "profile shot, exact side view, the contour of her face drawing the frame",
    "over-the-shoulder shot": "over-the-shoulder shot, the camera just behind her shoulder, her face and the far scene visible",
    "low-angle shot": "low-angle shot, the camera below eye level looking up, a heroic perspective, sky or ceiling behind the figure",
    "high-angle shot": "high-angle shot, the camera above eye level looking down, the ground visible behind the figure",
    "dutch-angle shot": "dutch-angle shot, the camera tilted, a dynamic diagonal horizon",
    "medium shot": "medium shot, waist up, natural head-to-body proportions, visible space around the subject",
    "cowboy shot": "cowboy shot, from mid-thigh up, realistic head-to-body proportions, clear space around the figure",
    "full body shot": "full body shot, entire figure visible head to toe, realistic head-to-body proportions with a proportionally small head",
    "wide shot": "environmental wide establishing shot, the figure small in the middle ground, ample negative space, realistic proportions",
};
export const framingText = (f) => FRAMING_TEXTS[f] || f;
// floor-level macro for shoe focus on a close framing -- mirrors MACRO_SHOES
export const MACRO_SHOES = ("extreme close-up macro shot at floor level, camera focused tightly "
    + "on the shoes and ankles, low angle");
// focus points that name the face -- filtered on figure tiers and back views
export const FACE_FOCUS = ["the face", "the eyes", "the lips", "the profile line"];
export const TIER_FALLBACK_FOCUS = { close: "the face", medium: "the face", figure: "the full figure" };
export const focusForShot = (focus, tier, pose) => {
    const back = (pose || "").includes("back to the camera");
    if (back && FACE_FOCUS.includes(focus)) return "the silhouette";
    if (tier === "figure" && FACE_FOCUS.includes(focus)) return TIER_FALLBACK_FOCUS[tier];
    return focus;
};
// the expression woven onto the persona's lead clause -- mirrors
// _subject_weave in series_nodes.py: article-led phrase takes "with",
// a participle appends, a bare absolute is set off by commas
const SUBJECT_ARTICLE = /^(?:a|an|the)\s+/i;
export const subjectWeave = (person, expression) => {
    const cut = person.indexOf(", ");
    const head = cut < 0 ? person : person.slice(0, cut);
    const rest = cut < 0 ? "" : person.slice(cut + 2);
    let woven;
    if (SUBJECT_ARTICLE.test(expression)) woven = `${head} with ${expression}`;
    else if (expression.split(" ")[0].endsWith("ing")) woven = `${head} ${expression}`;
    else woven = `${head}, ${expression}`;
    return rest ? `${woven}, ${rest}` : woven;
};
// ratios a tier can carry; a one-value feed is a pin and passes unfiltered
export const TIER_FORMATS = {
    "close": ["1:1", "4:5", "3:4", "2:3"],
    "medium": ["4:5", "3:4", "2:3", "1:1"],
    "figure": ["2:3", "3:4", "9:16", "4:5", "16:9"],
};
export const RATIOS = { "1:1": 1.0, "4:5": 0.8, "3:4": 0.75, "2:3": 2 / 3, "9:16": 0.5625, "3:2": 1.5, "16:9": 16 / 9 };
export const TIER_RATIOS = { close: "1:1", medium: "4:5", figure: "2:3" };

// {a|b|c} inline choices resolved the way the engine resolves them --
// the same FNV-1a pick (ASCII content; the libraries are English words),
// so the live preview shows the alternative the shot will actually carry
const fnv1a = (data) => {
    let h = 2166136261;
    for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
};
// __filename__ tokens resolve to a line of web/wildcards/filename.txt --
// the same FNV pick the engine runs, so the preview carries what the shot
// will carry. wcGet(name) returns the file's lines, null when the file is
// missing, undefined while it is still loading (the token then waits for
// the next render).
export const resolveWildcards = (text, seed, wcGet) => {
    text = String(text ?? "");
    if (!text.includes("__")) return text;
    return text.replace(/__([A-Za-z0-9_-]+)__/g, (m, name) => {
        const lines = wcGet ? wcGet(name) : null;
        if (!lines || !lines.length) return m;
        return lines[fnv1a(seed + "|__" + name + "__|wc") % lines.length];
    });
};

export const resolveChoices = (text, seed, salt = 0) => {
    text = String(text ?? "");
    if (!text.includes("{")) return text;
    let seen = 0;
    const pick = (m) => {
        const parts = m.split("|").map(x => x.trim()).filter(Boolean);
        if (parts.length <= 1) return m;
        seen++;
        return parts[fnv1a(seed + "|" + m + "|" + salt + "|" + seen) % parts.length];
    };
    let prev = null;
    const RE = /\{([^{}]+)\}/g;
    while (prev !== text) {
        prev = text;
        text = text.replace(RE, (_, c) => pick(c));
    }
    return text;
};

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export const stride = (n, salt) => {
    if (n <= 1) return 1;
    let k = 2 + (salt % 7);
    while (gcd(k, n) !== 1) k++;
    return k;
};
export const walk = (items, pin, count, salt) => {
    const arr = items.length ? items : [""];
    const n = arr.length;
    if (pin !== undefined && pin !== null) return Array(count).fill(arr[((pin % n) + n) % n]);
    return Array.from({ length: count }, (_, i) => arr[(i * stride(n, salt)) % n] ?? "");
};
// one expression per shot along an arc; keypoints resample proportionally,
// so the curve keeps its shape at any session length. The arc library reads
// through arcLib() so the user's own curves (userdata/perfectlab_arcs.json)
// ride the same resample as the built-ins
export const arcSeq = (arc, count) => {
    const kp = arcLib()[arc];
    if (!kp || !kp.length) return [];
    if (count <= 1) return [EXPRESSION_LIB[kp[0]]];
    return Array.from({ length: count }, (_, i) =>
        EXPRESSION_LIB[kp[Math.round((i * (kp.length - 1)) / (count - 1))]]);
};
// the same curves as energy, 0..1 per keypoint -- mirrors ARC_LEVELS in
// shoot_nodes.py; resampled with the same rounding as arcSeq so the tone
// stays in step with the expressions. No arc picked reads a flat 0.5
export const ARC_LEVELS = {
    "quiet to climax": [0.05, 0.25, 0.45, 0.65, 0.85, 1.0],
    "slow burn":       [0.1, 0.2, 0.4, 0.6, 0.85, 1.0],
    "first date":      [0.15, 0.3, 0.5, 0.7, 0.9, 1.0],
    "joy run":         [0.4, 0.5, 0.65, 0.8, 0.9, 1.0],
    "cold front":      [0.25, 0.4, 0.55, 0.75, 0.9, 1.0],
    "melancholy fade": [0.85, 0.7, 0.5, 0.35, 0.2, 0.05],
    "story wave":      [0.1, 0.3, 0.5, 0.75, 0.95, 1.0, 0.75, 0.55, 0.7, 0.9, 0.4, 0.1],
};
export const arcLevels = (arc, count) => {
    const lv = arcLevelsLib()[arc];
    const n = Math.max(1, count);
    if (!lv || !lv.length) return Array(n).fill(0.5);
    if (n <= 1) return [lv[0]];
    return Array.from({ length: n }, (_, i) =>
        lv[Math.round((i * (lv.length - 1)) / (n - 1))]);
};
// how many takes a shot renders when the arc leads the budget -- the same
// bands the light tone reads: a quiet point is certain enough to render
// once, a climax wants the full stack to pick from, the build-up keeps one
// spare. Mirrors _takes_for_level in series_nodes.py.
export const takeLadder = (lvl, budget) => {
    const T = Math.max(1, Math.min(4, parseInt(budget) || 1));
    return lvl <= TONE_QUIET_BAND ? 1 : (lvl >= TONE_BOLD_BAND ? T : Math.min(2, T));
};
// the user's own dramaturgies from userdata/perfectlab_arcs.json -- they
// merge over the built-in curves the same way _arc_tables does server-side:
// a user entry under a built-in name replaces it in place, a new name
// appends to the picker. A "note" field is kept for the chip tooltip only,
// the server ignores it
let USER_ARCS = null;
export const setUserArcs = (obj) => {
    const clean = {};
    for (const [name, spec] of Object.entries(obj || {})) {
        if (!name.trim() || !spec || typeof spec !== "object") continue;
        const kp = spec.kp, lv = spec.lv;
        if (!Array.isArray(kp) || !Array.isArray(lv)) continue;
        if (kp.length < 2 || kp.length > 12 || kp.length !== lv.length) continue;
        if (!kp.every(x => Number.isInteger(x) && x >= 0 && x < EXPRESSION_LIB.length)) continue;
        if (!lv.every(x => typeof x === "number" && x >= 0 && x <= 1)) continue;
        const note = typeof spec.note === "string" && spec.note.trim() ? spec.note.trim().slice(0, 80) : "";
        clean[name.trim()] = { kp, lv, note };
    }
    USER_ARCS = Object.keys(clean).length ? clean : null;
};
// the merged curve tables -- mirrors of _arc_tables' two dicts
export const arcLib = () => {
    if (!USER_ARCS) return ARC_LIB;
    const merged = { ...ARC_LIB };
    for (const [name, spec] of Object.entries(USER_ARCS)) merged[name] = spec.kp;
    return merged;
};
export const arcLevelsLib = () => {
    if (!USER_ARCS) return ARC_LEVELS;
    const merged = { ...ARC_LEVELS };
    for (const [name, spec] of Object.entries(USER_ARCS)) merged[name] = spec.lv;
    return merged;
};
// picker order: built-ins first, the user's own arcs after, overrides in place
export const arcList = () => Object.keys(arcLib());
export const arcNote = (name) => (USER_ARCS && USER_ARCS[name] && USER_ARCS[name].note)
    ? USER_ARCS[name].note
    : (ARC_DESC[name] || "");
export const isUserArc = (name) => !!(USER_ARCS && USER_ARCS[name] && !ARC_LIB[name]);
// how the light line's intensity words read at the arc's quiet and bold
// points -- mirrors LIGHT_TONE_SWAPS in series_nodes.py, order included (the
// joined pattern prefers the first key). Keys are [a-z ]+ only, so the
// pattern needs no escaping on either side
export const LIGHT_TONE_SWAPS = {
    "hard lighting": ["soft lighting", "hard lighting"],
    "strong highlights": ["gentle highlights", "strong highlights"],
    "sharp deep shadows": ["soft open shadows", "sharp deep shadows"],
    "high contrast": ["low contrast", "high contrast"],
    "vivid colors": ["muted colors", "vivid colors"],
    "bright exposure": ["balanced exposure", "bright exposure"],
    "dramatic lighting": ["understated lighting", "dramatic lighting"],
    "moody atmosphere": ["calm atmosphere", "moody atmosphere"],
    "dark surroundings": ["hushed surroundings", "dark surroundings"],
    "mysterious vibe": ["quiet vibe", "mysterious vibe"],
    "mystery mood": ["serene mood", "mystery mood"],
    "direct sunlight": ["filtered sunlight", "direct sunlight"],
    "dim lighting": ["dim lighting", "dramatic lighting"],
    "low contrast": ["low contrast", "high contrast"],
    "soft contrast": ["soft contrast", "strong contrast"],
    "soft shadows": ["soft shadows", "hard shadows"],
    "muted colors": ["muted colors", "vivid colors"],
    "diffuse illumination": ["diffuse illumination", "sculpted illumination"],
    "airy atmosphere": ["airy atmosphere", "electric atmosphere"],
    "balanced exposure": ["balanced exposure", "bold exposure"],
};
export const TONE_QUIET_BAND = 0.34;
export const TONE_BOLD_BAND = 0.66;
// How much motion each library pose carries, 0..1 -- mirrors POSE_ENERGY in
// series_nodes.py. A pose contradicting the arc's energy at that shot swaps
// for a compatible entry from the wired feed; the neutral middle and custom
// entries never move
export const POSE_ENERGY = {
    "standing relaxed": 0.1,
    "leaning against a wall": 0.15,
    "sitting on a stool": 0.1,
    "walking toward the camera": 0.5,
    "arms crossed": 0.2,
    "hands in pockets": 0.15,
    "looking over the shoulder": 0.4,
    "sitting on the floor, knees up": 0.1,
    "stretching arms overhead": 0.55,
    "crouching low": 0.45,
    "lying on the grass": 0.1,
    "mid-step turn": 0.6,
    "adjusting their hair": 0.3,
    "holding a coffee cup": 0.15,
    "back to the camera": 0.2,
    "reaching out toward the lens": 0.8,
    "one hand on the hip": 0.45,
    "leaning on a railing, looking into the distance": 0.2,
    "sitting sideways on steps": 0.15,
    "walking away, glancing back": 0.5,
    "twisting the torso toward the camera": 0.7,
    "leaning toward the camera with hands framing the face": 0.6,
    "jumping mid-air, hair flying": 1.0,
    "squatting on tiptoes": 0.55,
    "sitting cross-legged on the ground": 0.1,
    "lying on the stomach, propped on the elbows": 0.1,
    "leaning against a car door": 0.2,
    "brim of a hat pulled down with one hand": 0.4,
    "knee up on a bench, arms wrapped around it": 0.15,
    "shoulder against the wall, head tilted": 0.2,
    "blowing a kiss toward the camera": 0.75,
    "spinning on the spot, skirt in motion": 0.95,
};
// swap a pose that fights the arc's energy for a compatible one from the
// same wired feed -- mirror of _pose_for_level in series_nodes.py: same
// pools, same index-stable pick, so the preview matches the server prompt.
// Reads poseEnergy() so the user's overrides (perfectlab_energy.json) bend
// the preview exactly the way the server's merged table does
export const poseForLevel = (feed, pose, lvl, i) => {
    const pe = poseEnergy(pose);
    let pool;
    if (lvl <= TONE_QUIET_BAND && pe >= TONE_BOLD_BAND) {
        pool = feed.filter(p => poseEnergy(p) <= TONE_QUIET_BAND);
    } else if (lvl >= TONE_BOLD_BAND && pe <= TONE_QUIET_BAND) {
        pool = feed.filter(p => poseEnergy(p) >= TONE_BOLD_BAND);
    } else {
        return pose;
    }
    return pool.length ? pool[i % pool.length] : pose;
};
// How much stage presence each placement carries, 0..1 -- mirrors
// PLACEMENT_ENERGY in series_nodes.py. A placement contradicting the arc's
// energy at that shot swaps for a compatible one from the library list; the
// rule-of-thirds slots are neutral geometry and never move
export const PLACEMENT_ENERGY = {
    "centered in frame": 0.3,
    "on the left third": 0.45,
    "on the right third": 0.45,
    "close to the camera": 0.8,
    "deep in the scene": 0.15,
    "framed by the surroundings": 0.2,
    "slightly off-center, looking into the empty space": 0.25,
    "dominating the lower half of the frame": 0.9,
};
// the placements a close crop allows -- mirrors NEAR_PLACEMENTS
export const NEAR_PLACEMENTS = ["centered in frame", "on the left third", "on the right third", "close to the camera"];
// mirror of _placement_for_level in series_nodes.py: same pools, same
// index-stable pick; nearOnly keeps a close tier's pool inside the crop's
// legal set. Reads placementEnergy() so the user's overrides ride along
export const placementForLevel = (placement, lvl, i, nearOnly) => {
    const pe = placementEnergy(placement);
    let pool;
    if (lvl <= TONE_QUIET_BAND && pe >= TONE_BOLD_BAND) {
        pool = PLACEMENT_LIB.filter(p => placementEnergy(p) <= TONE_QUIET_BAND);
    } else if (lvl >= TONE_BOLD_BAND && pe <= TONE_QUIET_BAND) {
        pool = PLACEMENT_LIB.filter(p => placementEnergy(p) >= TONE_BOLD_BAND);
    } else {
        return placement;
    }
    if (nearOnly) pool = pool.filter(p => NEAR_PLACEMENTS.includes(p));
    return pool.length ? pool[i % pool.length] : placement;
};
// How much air each framing lets into the frame, 0..1 -- mirrors
// FRAMING_OPENNESS in series_nodes.py. A crop contradicting the arc's
// energy at that shot swaps for a compatible one from the camera feed;
// the middle framings and custom entries never move
export const FRAMING_OPENNESS = {
    "extreme close-up": 0.0,
    "close-up": 0.15,
    "portrait shot": 0.3,
    "profile shot": 0.35,
    "medium shot": 0.5,
    "dutch-angle shot": 0.5,
    "over-the-shoulder shot": 0.45,
    "low-angle shot": 0.6,
    "high-angle shot": 0.6,
    "cowboy shot": 0.65,
    "full body shot": 0.85,
    "wide shot": 1.0,
};
// swap a crop that fights the arc's energy for a compatible one from the
// same camera feed -- mirror of _framing_for_level in series_nodes.py:
// same pools, same index-stable pick, so the preview matches the server
// prompt. Reads framingEnergy() so the user's overrides (the "framings"
// section of perfectlab_energy.json) bend the preview exactly the way the
// server's merged table does
export const framingForLevel = (feed, framing, lvl, i) => {
    const fe = framingEnergy(framing);
    if (fe === undefined || fe === null) return framing;
    let pool;
    if (lvl <= TONE_QUIET_BAND && fe <= TONE_QUIET_BAND) {
        pool = feed.filter(f => framingEnergy(f) >= TONE_BOLD_BAND);
    } else if (lvl >= TONE_BOLD_BAND && fe >= TONE_BOLD_BAND) {
        pool = feed.filter(f => framingEnergy(f) <= TONE_QUIET_BAND);
    } else {
        return framing;
    }
    return pool.length ? pool[i % pool.length] : framing;
};
// How intimately each focus point pins the subject, 0..1 -- mirrors
// FOCUS_INTIMACY in series_nodes.py. A focus contradicting the arc's
// energy at that shot swaps for a compatible one from the camera's focus
// feed; the middle band and custom entries never move
export const FOCUS_INTIMACY = {
    "the lips": 1.0,
    "the eyes": 0.9,
    "the face": 0.8,
    "the profile line": 0.7,
    "the jewelry": 0.6,
    "the hair movement": 0.55,
    "the hands": 0.5,
    "the outfit": 0.45,
    "the full figure": 0.3,
    "the shoes": 0.2,
    "the silhouette": 0.1,
    "the background mood": 0.0,
};
// swap a focus that fights the arc's energy for a compatible one from
// the same camera feed -- mirror of _focus_for_level in series_nodes.py:
// same pools, same index-stable pick, so the preview matches the server
// prompt. Reads focusIntimacy() so the user's overrides (the "focuses"
// section of perfectlab_energy.json) bend the preview exactly the way
// the server's merged table does. The crop's law outranks the arc: the
// pool drops face focuses a wide tier or back view cannot carry
export const focusForLevel = (feed, focus, lvl, i, tier, pose) => {
    const fe = focusIntimacy(focus);
    if (fe === undefined || fe === null) return focus;
    let pool;
    if (lvl <= TONE_QUIET_BAND && fe >= TONE_BOLD_BAND) {
        pool = feed.filter(f => focusIntimacy(f) <= TONE_QUIET_BAND);
    } else if (lvl >= TONE_BOLD_BAND && fe <= TONE_QUIET_BAND) {
        pool = feed.filter(f => focusIntimacy(f) >= TONE_BOLD_BAND);
    } else {
        return focus;
    }
    const back = (pose || "").includes("back to the camera");
    if (back || tier === "figure") pool = pool.filter(f => !FACE_FOCUS.includes(f));
    return pool.length ? pool[i % pool.length] : focus;
};
// the arc's energy at this shot -> which side of the swap table to read;
// null = the neutral middle, the light line stays as written
export const toneForLevel = (lvl) =>
    lvl <= TONE_QUIET_BAND ? 0 : (lvl >= TONE_BOLD_BAND ? 1 : null);
// the user's overrides from userdata/perfectlab_tone.json, fetched by the
// Series panel -- they merge over the code table: the same key keeps its
// place in the order (the joined pattern prefers the first key), a new key
// appends. Mirrors _tone_tables in series_nodes.py
let USER_TONE = null;
const toneTable = () => USER_TONE ? { ...LIGHT_TONE_SWAPS, ...USER_TONE } : LIGHT_TONE_SWAPS;
export const setUserToneSwaps = (obj) => {
    const clean = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (/^[a-z ]+$/.test(k) && Array.isArray(v) && v.length === 2
            && v.every(x => typeof x === "string" && x.trim())) clean[k] = v;
    }
    USER_TONE = Object.keys(clean).length ? clean : null;
};
// the user's energy overrides from userdata/perfectlab_energy.json, fetched
// by the Series panel -- they merge over the code tables the same way
// _energy_tables does server-side: a custom library pose gets an energy and
// starts travelling along the arc, a built-in entry can be re-tuned in place,
// a custom framing gets an openness and starts riding the crop coupling, a
// custom focus gets an intimacy and starts following the focus coupling
let USER_ENERGY = null;
const energyTable = (part, code) => USER_ENERGY ? { ...code, ...USER_ENERGY[part] } : code;
export const setUserEnergy = (obj) => {
    const clean = { poses: {}, placements: {}, framings: {}, focuses: {} };
    const src = obj || {};
    for (const part of ["poses", "placements", "framings", "focuses"]) {
        const t = src[part];
        if (t && typeof t === "object" && !Array.isArray(t)) {
            for (const [k, v] of Object.entries(t)) {
                if (k.trim() && typeof v === "number" && v >= 0 && v <= 1) clean[part][k] = v;
            }
        }
    }
    USER_ENERGY = (Object.keys(clean.poses).length || Object.keys(clean.placements).length
        || Object.keys(clean.framings).length || Object.keys(clean.focuses).length) ? clean : null;
};
export const poseEnergy = (p) => energyTable("poses", POSE_ENERGY)[p] ?? 0.5;
export const placementEnergy = (p) => energyTable("placements", PLACEMENT_ENERGY)[p] ?? 0.5;
export const framingEnergy = (f) => energyTable("framings", FRAMING_OPENNESS)[f];
export const focusIntimacy = (f) => energyTable("focuses", FOCUS_INTIMACY)[f];
// did this entry's energy come from the user's file? the energies line and
// the swap badges read it server-side from META.srcs; the panel answers the
// same question locally, straight from the file it fetched on open
export const isUserEnergy = (part, key) =>
    !!(USER_ENERGY && USER_ENERGY[part] && Object.prototype.hasOwnProperty.call(USER_ENERGY[part], key));
// a thumb-size drawing of the run's ARC LEVEL: one point per shot, a dot on
// every shot the arc actually swapped something in -- the counter line next
// to it says how many, this one says where they condensed. Fewer than two
// points is not a curve and draws nothing
export const arcSparkline = (lvls, swapIdx) => {
    const pts = (lvls || []).filter((v) => typeof v === "number" && v >= 0 && v <= 1);
    if (pts.length < 2) return "";
    const w = 24 + pts.length * 10;
    const h = 18;
    const x = (i) => 4 + (i * (w - 8)) / (pts.length - 1);
    const y = (v) => 3 + (1 - v) * (h - 6);
    const path = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const dots = (swapIdx || []).filter((i) => pts[i] !== undefined)
        .map((i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(pts[i]).toFixed(1)}" r="2.4"/>`).join("");
    return `<svg class="plp-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${path}"/><g>${dots}</g></svg>`;
};
// the same curve as text: one block character per shot, scaled to the level,
// the current shot's cell a full block -- the arc_curve CSV column charts
// the dramaturgy in any spreadsheet without opening the sheet. Positions
// match the raw level list (a non-numeric slot stays a middle dot), fewer
// than two points is not a curve
const ARC_BLOCKS = "▁▂▃▄▅▆▇█";
export const arcAscii = (lvls, mark) => {
    const list = lvls || [];
    if (list.length < 2) return "";
    let out = "";
    for (let i = 0; i < list.length; i++) {
        if (i === mark) { out += "▓"; continue; }
        const v = list[i];
        out += (typeof v === "number" && isFinite(v))
            ? ARC_BLOCKS[Math.max(0, Math.min(7, Math.round(v * 7)))]
            : "·";
    }
    return out;
};
// bend the line's intensity words; single pass, so a flipped word is never
// flipped back by its own counterpart
export const toneLight = (line, side) => {
    if (!line) return { line, hits: 0 };
    const table = toneTable();
    const re = new RegExp(Object.keys(table).join("|"), "gi");
    let hits = 0;
    const out = line.replace(re, (m) => {
        const pair = table[m.toLowerCase()];
        if (!pair) return m;
        hits++;
        return pair[side];
    });
    return { line: out, hits };
};

// wardrobe look composer -- exact mirror of compose_look() in
// wardrobe_node.py: one wording for THIS LOOK, the Series preview and the
// real output. A "none" placeholder in any slot reads as empty.
const NONE_SET = ["— none —", "- none -", "none"];
const slotVal = (v) => {
    const s = (v || "").trim();
    return NONE_SET.includes(s.toLowerCase()) ? "" : s;
};
// exact mirror of compose_look() in wardrobe_node.py, quirks included:
// materials prefix the garment, colors ride "in", a look may be shoes- or
// hat- or accessories-only, and a hat color goes inside its article
const lkPiece = (name, color, material) => {
    let n = name;
    if (material) n = /^(a|an)\s/i.test(name)
        ? `${material} ${name.replace(/^(a|an)\s+/i, "")}` : `${material} ${name}`;
    return color ? `${n} in ${color}` : n;
};
export const composeLook = (l) => {
    if (!l) return "";
    const top = slotVal(l.top), bottom = slotVal(l.bottom);
    const shoes = slotVal(l.footwear);
    const headwear = slotVal(l.headwear);
    const acc = Array.isArray(l.accessories) ? l.accessories : (l.accessories || "").trim() ? [l.accessories] : [];
    const accClean = acc.map(a => (a || "").trim()).filter(a => a && !NONE_SET.includes(a.toLowerCase()));
    if (!top && !bottom && !shoes && !headwear && !accClean.length) return "";
    const tail = [];
    let t = "";
    if (top || bottom) {
        t = top && bottom
            ? `wearing ${lkPiece(top, slotVal(l.top_color), slotVal(l.top_material))} with ${lkPiece(bottom, slotVal(l.bottom_color), slotVal(l.bottom_material))}`
            : `wearing ${lkPiece(top || bottom, slotVal(top ? l.top_color : l.bottom_color), slotVal(top ? l.top_material : l.bottom_material))}`;
        const outer = slotVal(l.outerwear);
        if (outer) t += `, layered with ${outer}`;
    }
    if (shoes) tail.push(lkPiece(shoes, slotVal(l.footwear_color), slotVal(l.footwear_material)));
    if (accClean.length) {
        const withColor = slotVal(l.acc_color)
            ? accClean.map(a => `${a} in ${slotVal(l.acc_color)}`) : accClean;
        tail.push(withColor.join(" and "));
    }
    if (headwear) {
        const c = slotVal(l.headwear_color);
        const m = headwear.match(/^(a|an|the)\s+(.*)$/i);
        tail.push(`wearing ${c ? (m ? `${m[1]} ${c} ${m[2]}` : `${c} ${headwear}`) : headwear}`);
    }
    if (slotVal(l.details)) tail.push(slotVal(l.details));
    return [t, ...tail].filter(Boolean).join(", ");
};
