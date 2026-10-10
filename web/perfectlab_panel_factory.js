// Shared panel kit: favourites, multi-select, presets, uniform tiles and
// height fitting -- one implementation used by every PerfectLab sub-node.

const FAV_KEY = "pl_panel_favs";
export const readFavs = () => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || {}; } catch (e) { return {}; }
};
export const writeFavs = (f) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch (e) {} };
export const favList = (scope) => readFavs()[scope] || [];
export const isFav = (scope, idx) => favList(scope).includes(idx);
export const toggleFav = (scope, idx) => {
    const all = readFavs();
    const cur = all[scope] || [];
    all[scope] = cur.includes(idx) ? cur.filter(x => x !== idx) : [...cur, idx];
    writeFavs(all);
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ---- shared custom-entry library ----
// Entries typed through "＋ custom…" are also written under ComfyUI userdata,
// one flat file per list. A piece typed once follows into every new node and
// workflow: the LIBRARY row in each chip grid collects it, a click imports,
// the ✕ removes. Scope names are semantic ("framing", "wardrobe__top") so
// the Camera node and the Shot Series -- which walk the same lists -- pool
// their entries together.
const LIB_DIR = "perfectlab_library";
const libStore = new Map();   // scope -> string[]
const libFetched = new Set(); // scopes whose file was read at least once
const libSeen = new Set();    // scopes already shown by some render

export const libList = (scope) => (libFetched.has(scope) ? libStore.get(scope) || [] : []);

export function libLoad(scope) {
    if (libFetched.has(scope)) return Promise.resolve();
    libFetched.add(scope);
    return plRead(`${LIB_DIR}/${scope}.json`)
        .then(t => { try { return JSON.parse(t); } catch (e) { return []; } })
        .catch(() => [])
        .then(arr => {
            libStore.set(scope, (Array.isArray(arr) ? arr : [])
                .filter(x => typeof x === "string" && x.trim()));
        });
}

// some 0.11.1 installs serve the stock {file} userdata routes as 404/405
// for every file; stock API first (healthy builds), PerfectLab's own
// endpoint as the fallback -- the panel only ever runs with our Python
// loaded, so the fallback is always there
const PL_UD = "/api/perfectlab/userdata";
const plRead = (file) =>
    fetch(`/api/userdata/${file}`)
        .then(r => r.ok ? r.text() : Promise.reject(r))
        .catch(() => fetch(`${PL_UD}?file=${encodeURIComponent(file)}`)
            .then(r => r.ok ? r.text() : Promise.reject(r)));
const plWrite = (file, body) =>
    fetch(`/api/userdata/${file}`, { method: "POST", body })
        .then(r => (r.ok && r.status !== 405) ? r : Promise.reject(r))
        .catch(() => fetch(`${PL_UD}?file=${encodeURIComponent(file)}`,
            { method: "POST", body }));
const plDrop = (file) =>
    fetch(`/api/userdata/${file}`, { method: "DELETE" })
        .then(r => (r.ok || r.status === 404) ? r : Promise.reject(r))
        .catch(() => fetch(`${PL_UD}?file=${encodeURIComponent(file)}`,
            { method: "DELETE" }));
const libWrite = (scope) => plWrite(`${LIB_DIR}/${scope}.json`,
    JSON.stringify(libStore.get(scope) || []));

export function libAdd(scope, entry) {
    libLoad(scope).then(() => {
        const cur = libStore.get(scope) || [];
        if (cur.includes(entry)) return;
        libStore.set(scope, [...cur, entry]);
        libWrite(scope);
    });
}

// store a generated frame as the entry's photo tile (the shoot-a-tile flow)
export async function libImgPut(scope, entry, blob) {
    const f = imgFile(scope, entry);
    try {
        await plWrite(f, blob);
        imgBust.set(f, Date.now());
        return true;
    } catch (e) { return false; }
}

export function libDrop(scope, entry) {
    libLoad(scope).then(() => {
        const cur = libStore.get(scope) || [];
        if (!cur.includes(entry)) return;
        libStore.set(scope, cur.filter(x => x !== entry));
        libWrite(scope);
        // its photo, if one was attached, goes with it
        const f = imgFile(scope, entry);
        imgBust.set(f, Date.now());
        plDrop(f).catch(() => {});
    });
}

// ---- photos for own entries ----
// A typed entry can carry a reference photo: the chip then shows a real
// tile instead of two letters, next to the built-in photos. The picture is
// cropped to a 240x240 square in the browser and stored under userdata as
// one small jpeg per scope+entry; no photo -> the same letter tile as
// before (the <img> swaps itself on error).
const IMG_DIR = "perfectlab_library_imgs";
const imgBust = new Map(); // file -> stamp; one forced refetch after a PUT/DELETE
const libHash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
};
const imgFile = (scope, entry) => `${IMG_DIR}/${scope}__${libHash(scope + "/" + entry)}.jpg`;
const letters = (label) =>
    esc(label.replace(/^(a|an|the) /i, "").replace(/'/g, "")).slice(0, 2).toUpperCase();

export const libTile = (scope, entry) => {
    const f = imgFile(scope, entry);
    return `<img draggable="false" loading="lazy" src="${PL_UD}?file=${encodeURIComponent(f)}${imgBust.has(f) ? "&t=" + imgBust.get(f) : ""}"
         onerror="this.outerHTML='<span class=\\'plp-tile\\'>${letters(entry)}</span>'">`;
};

const CAM_SVG = `<svg viewBox="0 0 16 12" width="9" height="7"><rect x="0.8" y="0.8" width="14.4" height="10.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 8.2 6.2 5l2.3 2.5L10.4 6l2.1 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="11.3" cy="4.1" r=".9" fill="currentColor"/></svg>`;

export const libCam = (entry) =>
    `<button class="plp-lib-cam" data-libimg="${esc(entry)}" title="attach / replace a photo tile (240×240)">${CAM_SVG}</button>`;

export function pickLibImg(scope, entry, rerender) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const S = 240, m = Math.min(img.width, img.height);
            const c = document.createElement("canvas");
            c.width = S; c.height = S;
            c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
            c.toBlob(async (blob) => {
                if (!blob) return;
                try {
                    const f = imgFile(scope, entry);
                    await plWrite(f, blob);
                    imgBust.set(f, Date.now());
                    rerender();
                } catch (e) { /* userdata unavailable -- letters stay */ }
            }, "image/jpeg", 0.88);
        };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
    };
    input.click();
}

/** LIBRARY chip row for a grid; entries already in the list are skipped */
export const libChips = (scope, { imgs, cell, act, skip, limit = 18 } = {}) => {
    const entries = libList(scope).filter(o => !(skip || []).includes(o));
    if (!entries.length) return "";
    libSeen.add(scope);
    return `<div class="plp-chips-head">YOUR PIECES — typed in this slot before, kept on this machine. 📷 attach a photo, 🎬 shoot one through your graph. Click to use, ✕ to remove.</div>` +
        `<div class="plp-chips ${imgs ? "has-img" : ""}" style="--cell:${cell || "1 / 1"}">` +
        entries.slice(0, limit).map(o =>
            `<div class="plp-chip imgchip lib ${act && act(o) ? "act" : ""}" data-lib="${esc(o)}" title="${esc(o)} — click to use">
                ${libTile(scope, o)}
                <span>${esc(o)}</span>
                ${libCam(o)}
                <button class="plp-lib-x" data-libx="${esc(o)}" title="remove from the library">✕</button>
            </div>`).join("") + `</div>`;
};

/** wire the LIBRARY row: chip click imports, ✕ drops and rerenders,
 * the camera button attaches a photo to the entry */
export const wireLib = (host, scope, onPick, rerender) => {
    host.querySelectorAll("[data-lib]").forEach(ch => {
        ch.onclick = (e) => {
            e.stopPropagation();
            if (e.target.classList.contains("plp-lib-x")) return;
            onPick(ch.dataset.lib);
        };
    });
    host.querySelectorAll("[data-libx]").forEach(x => {
        x.onclick = (e) => {
            e.stopPropagation();
            libDrop(scope, x.dataset.libx);
            rerender();
        };
    });
    host.querySelectorAll("[data-libimg]").forEach(b => {
        b.onclick = (e) => {
            e.stopPropagation();
            pickLibImg(scope, b.dataset.libimg, rerender);
        };
    });
};

/** make the scope's file land before the user opens the grid; when entries
 *  arrive after a grid was already drawn, redraw it once (libSeen guards
 *  the loop: a render that showed the row never asks again) */
export const libSync = (scope, host, rerender) => {
    libLoad(scope).then(() => {
        if (!libSeen.has(scope) && libList(scope).length &&
            host && host.isConnected && host.style.display !== "none") rerender();
    });
};

const GUIDE_V = "1.0.1";
export const itemImg = (cat, i) =>
    `extensions/PerfectLab/guide/items/${cat}/${String(i).padStart(2, "0")}.jpg?v=${GUIDE_V}`;

// a uniform tile: the real preview when it exists, a branded letter tile
// until it does; broken images swap themselves over
export const tile = (label, img, i) => img
    ? `<img draggable="false" loading="lazy" src="${itemImg(img, i)}"
         onerror="this.outerHTML='<span class=\\'plp-tile\\'>${esc(label.replace(/^(a|an|the) /i, "").replace(/'/g, "")).slice(0, 2).toUpperCase()}</span>'">`
    : `<span class="plp-tile">${esc(label.replace(/^(a|an|the) /i, "")).slice(0, 2).toUpperCase()}</span>`;

/**
 * chip grid for one section.
 * sel: { mode: "all"|"multi"|"pin", set: [idx], pin: idx }
 * scope: favourites namespace (nodeType + section key)
 * lib: library scope -- entries typed in any panel walking the same list
 */
export const chipGrid = ({ options, base, imgs, cell, sel, scope, multi, search, lib }) => {
    // base: how many of the options are built-in; the rest are the user's
    // own entries and may carry their own photo (same file as the library)
    const builtins = base ?? options.length;
    const favs = favList(scope);
    const picked = sel.mode === "pin" ? [sel.pin % Math.max(options.length, 1)] : (sel.set || []);
    const rows = [];
    if (favs.length) {
        rows.push(`<div class="plp-chips has-img" style="--cell:${cell}">` +
            favs.map(i => chip(options[i], i, options, imgs, sel, scope, multi)).join("") +
            `</div><div class="plp-chips-head">ALL</div>`);
    }
    if (lib) rows.push(libChips(lib, { skip: options }));
    rows.push(`<div class="plp-chips has-img" style="--cell:${cell}">
        <div class="plp-chip walk ${sel.mode === "all" ? "act" : ""}" data-mode="all">◇ all</div>
        ${options.map((o, i) => chip(o, i, options, imgs, sel, scope, multi, i < builtins ? null : lib)).join("")}
        <div class="plp-chip walk" data-add>＋ custom…</div>
    </div>`);
    return rows.join("");
};

const chip = (o, i, options, imgs, sel, scope, multi, lib) => {
    const act = sel.mode === "pin"
        ? sel.pin % options.length === i
        : (sel.set || []).includes(i);
    const star = `<button class="plp-star ${isFav(scope, i) ? "on" : ""}" data-fav="${i}" title="favourite">★</button>`;
    return `<div class="plp-chip imgchip ${act ? "act" : ""}" data-i="${i}" title="${esc(o)}">
        ${lib ? libTile(lib, o) + libCam(o) : tile(o, imgs, i)}
        <span>${esc(o)}</span>
        ${multi ? `<span class="plp-multi ${act ? "" : "dim"}">${act ? "✓" : "+"}</span>` : ""}
        ${star}
    </div>`;
};

/** section summary text for the collapsed row */
export const sectionSummary = (label, options, sel, customs) => {
    const items = [...options, ...(customs || [])];
    if (sel.mode === "pin" && sel.pin !== undefined && sel.pin !== null) {
        return "pin: " + items[((sel.pin % items.length) + items.length) % items.length];
    }
    if (sel.mode === "multi" && (sel.set || []).length) {
        return sel.set.length + " selected";
    }
    return "walk all " + items.length;
};

/** userdata-backed presets row: save / load / delete under a node name */
export const attachPresets = (node, el, widgetName, presetName) => {
    const UD = "perfectlab_presets";
    const row = document.createElement("div");
    row.className = "plp-util";
    row.innerHTML = `
        <button class="plp-util-btn" data-act="psave">SAVE</button>
        <button class="plp-util-btn" data-act="pload">LOAD</button>
        <select class="plp-sessions"><option value="">presets…</option></select>
        <button class="plp-util-btn" data-act="pdel">✕</button>`;
    row.addEventListener("mousedown", e => e.stopPropagation());
    const sel = row.querySelector("select");
    const list = async () => {
        try {
            const d = await (await fetch(`/api/userdata?dir=${UD}&recurse=false&split=false&full_info=false`)).json();
            const mine = (d.tracks || []).filter(t => t.startsWith(presetName + "__"));
            sel.innerHTML = '<option value="">presets…</option>' +
                mine.map(t => `<option value="${t}">${t.replace(presetName + "__", "").replace(/\.json$/, "")}</option>`).join("");
        } catch (e) {}
    };
    const dataWidget = node.widgets.find(w => w.name === widgetName);
    row.querySelector('[data-act="psave"]').onclick = async (e) => {
        e.stopPropagation();
        const name = prompt("Preset name:", "");
        if (!name) return;
        await plWrite(`${UD}/${presetName}__${encodeURIComponent(name)}.json`, dataWidget?.value || "{}");
        list();
    };
    sel.onchange = async (e) => {
        e.stopPropagation();
        if (!sel.value) return;
        try {
            const v = await plRead(`${UD}/${sel.value}`);
            if (dataWidget) dataWidget.value = v;
            node._plpReload && node._plpReload();
        } catch (e) {}
    };
    row.querySelector('[data-act="pdel"]').onclick = async (e) => {
        e.stopPropagation();
        if (!sel.value) return;
        await plDrop(`${UD}/${sel.value}`);
        list();
    };
    (el.querySelector(".plp-util-host") || el).prepend(row);
    list();
};

/** size the node so the whole panel and the native widgets are visible */
export const fitNode = (node, el, widget, extraNative) => {
    if (!el.isConnected) return;
    const h = el.scrollHeight;
    if (h < 40) return;
    widget.computeSize = (wd) => [wd, h + 4];
    const native = (node.widgets || [])
        .filter(w => !w.hidden && w.type !== "hidden" && w.computeSize && w.name !== widget.name)
        .reduce((sum, w) => sum + (w.computeSize ? w.computeSize(node.size[0])[1] : 22), 0);
    const need = h + 34 + Math.max(native, extraNative || 0);
    if (node.size[1] < need || node.size[1] > need + 120) node.setSize([node.size[0], need]);
};

/** uniform brand footer: signature on every panel */
export const addFooter = (el) => {
    const f = document.createElement("div");
    f.className = "plp-footer-sig";
    f.innerHTML = `PERFECT.LAB · <a href="https://t.me/PerfectJohny" target="_blank" rel="noopener">@PerfectJohny</a>`;
    f.addEventListener("mousedown", e => e.stopPropagation());
    el.appendChild(f);
};
