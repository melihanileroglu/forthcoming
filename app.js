// app.js (TAM VE GÜNCEL VERSİYON - LEJANT DAHİL)
console.log("VERSİYON: LEJANTLI GÜNCEL KOD YÜKLENDİ ✅");

import { auth } from "./firebase.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/* =========================================================
   AUTH UI
========================================================= */
const authScreen = document.getElementById("authScreen");
const appRoot = document.getElementById("appRoot");

const loginForm = document.getElementById("loginForm");
const authMsg = document.getElementById("authMsg");
const forgotBtn = document.getElementById("forgotBtn");

function setAuthMsg(msg){ authMsg.textContent = msg; }

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  try{
    setAuthMsg("Giriş yapılıyor...");
    await signInWithEmailAndPassword(auth, email, pass);
    setAuthMsg("Giriş başarılı ✅");
  }catch(err){
    console.error(err);
    setAuthMsg("Giriş hatası ❌");
    alert(err?.message || "Giriş yapılamadı.");
  }
});

forgotBtn.addEventListener("click", async () => {
  const email = (document.getElementById("loginEmail").value || "").trim();
  if (!email) { alert("Önce e-posta gir."); return; }
  try{
    setAuthMsg("Sıfırlama maili gönderiliyor...");
    await sendPasswordResetEmail(auth, email);
    setAuthMsg("Sıfırlama maili gönderildi ✅");
    alert("Şifre sıfırlama maili gönderildi.");
  }catch(err){
    console.error(err);
    setAuthMsg("Sıfırlama hatası ❌");
    alert(err?.message || "Mail gönderilemedi.");
  }
});

/* =========================================================
   APP (Leaflet + UI)
========================================================= */

const statusbar = document.getElementById("statusbar");
function setStatus(msg){ statusbar.textContent = msg; }

// ================= MAP =================
const map = L.map("map", { zoomControl:false }).setView([41.02, 28.78], 12);
L.control.zoom({ position:"topleft" }).addTo(map);
map.doubleClickZoom.disable();

// =============== BASEMAPS ==============
const basemaps = {
  osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20 }),
  cartoLight: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 20 }),
  esriSat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 })
};
let currentBasemap = basemaps.osm;
currentBasemap.addTo(map);

document.querySelectorAll("input[name='basemap']").forEach(radio => {
  radio.addEventListener("change", e => {
    if (currentBasemap) map.removeLayer(currentBasemap);
    currentBasemap = basemaps[e.target.value];
    currentBasemap.addTo(map);
  });
});

function refreshLeafletAfterShow(){
  requestAnimationFrame(() => {
    map.invalidateSize(true);
    requestAnimationFrame(() => map.invalidateSize(true));
  });
}

// ================== TABS ==================
const tabs = document.querySelectorAll(".tab");
const panels = {
  layers: document.getElementById("tab-layers"),
  basemaps: document.getElementById("tab-basemaps"),
  import: document.getElementById("tab-import")
};
function openTab(key){
  tabs.forEach(b => b.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${key}"]`)?.classList.add("active");
  Object.values(panels).forEach(p => p.classList.remove("active"));
  panels[key]?.classList.add("active");
}
tabs.forEach(btn => btn.addEventListener("click", () => openTab(btn.dataset.tab)));

// ================== STATE ==================
const groupListEl = document.getElementById("groupList");
const newGroupNameEl = document.getElementById("newGroupName");
const addGroupBtn = document.getElementById("addGroupBtn");

const layerStore = {};
const groupOrder = [];
const groups = {};
const importedIds = new Set();

function resetAppLayersOnly(){
  for (const id of Object.keys(layerStore)) {
    try { map.removeLayer(layerStore[id].leaflet); } catch(e){}
    delete layerStore[id];
  }
  groupOrder.length = 0;
  for (const k of Object.keys(groups)) delete groups[k];
  importedIds.clear();
  window.__didFit = false;
  refreshAttrLayerSelect();
  renderLegend(); // SIFIRLAMA SONRASI LEJANT GÜNCELLE
}

// ================== HELPERS ==================
function safeStr(v){
  if (v === null || v === undefined) return "";
  return String(v);
}

function detectGeomFromGeojson(geojson){
  try{
    const f = geojson?.features?.[0];
    const t = f?.geometry?.type;
    if (!t) return "unknown";
    if (t.includes("Point")) return "point";
    if (t.includes("LineString")) return "line";
    if (t.includes("Polygon")) return "polygon";
  }catch(e){}
  return "unknown";
}

function dashArrayFromType(type){
  if (type === "dash") return "8 6";
  if (type === "dot") return "2 6";
  if (type === "dashdot") return "10 5 2 5";
  return null;
}

function normalizeGeoJSON(raw){
  if (!raw) return { type:"FeatureCollection", features:[] };
  if (Array.isArray(raw)) {
    if (raw.length && raw[0]?.type === "Feature") return { type:"FeatureCollection", features: raw };
    if (raw.length && raw[0]?.type === "FeatureCollection") return raw[0];
    return { type:"FeatureCollection", features:[] };
  }
  if (!raw.features && raw.Features && Array.isArray(raw.Features)) return { type:"FeatureCollection", features: raw.Features };
  if (raw.type === "Feature") return { type:"FeatureCollection", features:[raw] };
  if (raw.type === "FeatureCollection") { raw.features = raw.features || []; return raw; }
  if (raw.type && raw.coordinates) return { type: "FeatureCollection", features: [{ type:"Feature", properties:{}, geometry: raw }] };
  return { type:"FeatureCollection", features: raw.features || [] };
}

// ================== CRS FIX (TM30 -> WGS84) ==================
function looksProjected(geojson){
  try{
    const f = geojson?.features?.find(x => x?.geometry?.coordinates);
    if (!f) return false;
    let c = f.geometry.coordinates;
    while (Array.isArray(c)) c = c[0];
    const x = Number(c?.[0]);
    const y = Number(c?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return (Math.abs(x) > 180 || Math.abs(y) > 90);
  }catch(e){ return false; }
}

function deepMapCoords(coords, fn){
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") return fn(coords);
  return coords.map(c => deepMapCoords(c, fn));
}

function reprojectGeoJSONToWGS84(geojson){
  if (typeof proj4 === "undefined") return geojson;
  const TM30_5254 = "+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
  const TM30_2320 = "+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs";

  function tryTransform(fromDef){
    const out = JSON.parse(JSON.stringify(geojson));
    out.features = (out.features || []).map(feat => {
      if (!feat?.geometry?.coordinates) return feat;
      feat.geometry.coordinates = deepMapCoords(feat.geometry.coordinates, ([x,y]) => {
        const p = proj4(fromDef, "WGS84", [x, y]); 
        return [p[0], p[1]];
      });
      return feat;
    });
    try{
      const f = out.features.find(x => x?.geometry?.coordinates);
      let c = f.geometry.coordinates;
      while (Array.isArray(c)) c = c[0];
      const lon = Number(c?.[0]);
      const lat = Number(c?.[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) return out;
    }catch(e){}
    return null;
  }
  return tryTransform(TM30_5254) || tryTransform(TM30_2320) || geojson;
}

// ================== POPUP CONTENT GENERATOR ==================
function createFriendlyPopupContent(layerName, properties) {
  const blacklist = ["_fid", "OBJECTID", "GlobalID", "Shape_Length", "Shape_Area", "SHAPE_LEN", "SHAPE_AREA", "FID"];
  let title = layerName; 
  
  const nameCandidates = ["AD", "ADI", "ISIM", "NAME", "TESIS_ADI", "KURUM_ADI", "MAHALLE_ADI"];
  for (const candidate of nameCandidates) {
    const key = Object.keys(properties).find(k => k.toUpperCase() === candidate);
    if (key && properties[key]) {
      title = properties[key]; 
      break; 
    }
  }

  let rowsHtml = "";
  for (const [key, val] of Object.entries(properties)) {
    if (blacklist.includes(key)) continue;
    if (val === null || val === undefined || val === "") continue;

    let label = key;
    label = label.replace(/_/g, " ");
    label = label.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    
    if (key.toUpperCase().includes("ALAN") && key.toUpperCase() !== "ALAN_ADI") label = "Alan";
    if (key.toUpperCase().includes("CEVRE")) label = "Çevre";
    if (key.toUpperCase().includes("UZUNLUK")) label = "Uzunluk";

    let displayVal = val;
    if (typeof val === "number") {
      if (Math.abs(val) > 180) { 
        displayVal = val.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      }
    }

    if (key.toUpperCase().includes("ALAN") && key.toUpperCase() !== "ALAN_ADI") displayVal += " m²";
    else if (key.toUpperCase().includes("CEVRE") || key.toUpperCase().includes("UZUNLUK")) displayVal += " m";

    rowsHtml += `
      <div class="popup-row">
        <span class="popup-label">${label}</span>
        <span class="popup-val">${displayVal}</span>
      </div>
    `;
  }

  return `
    <div class="popup-head">
      <div class="popup-layername">${layerName}</div>
      <div class="popup-title">${title}</div>
    </div>
    <div class="popup-body">${rowsHtml}</div>
  `;
}

// ================== LEGEND (LEJANT) MODULE ==================
// Yeni eklenen Lejant Fonksiyonları
const legendBox = document.getElementById("legendBox");
const legendContent = document.getElementById("legendContent");
const legendToggle = document.getElementById("legendToggle");

if (legendToggle) {
    legendToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        legendBox.classList.toggle("collapsed");
        legendToggle.textContent = legendBox.classList.contains("collapsed") ? "+" : "_";
    });
}
if (document.querySelector(".legend-head")) {
    document.querySelector(".legend-head").addEventListener("click", () => {
        if(legendBox) {
            legendBox.classList.toggle("collapsed");
            legendToggle.textContent = legendBox.classList.contains("collapsed") ? "+" : "_";
        }
    });
}

function renderLegend() {
  if (!legendContent || !legendBox) return;
  legendContent.innerHTML = "";
  const activeLayers = [];

  Object.keys(layerStore).forEach(id => {
    const item = layerStore[id];
    if (item.leaflet && map.hasLayer(item.leaflet)) {
      activeLayers.push(item);
    }
  });

  if (activeLayers.length === 0) {
    legendBox.classList.add("hidden");
    return;
  }
  legendBox.classList.remove("hidden");

  activeLayers.forEach(item => {
    const name = item.def.name;
    const geom = item.def.geom; 
    const s = item.style;
    let iconHtml = "";
    
    if (geom === "point") {
      iconHtml = `<span class="leg-icon point" style="background:${s.lineColor}; border:1px solid rgba(255,255,255,0.5);"></span>`;
    } 
    else if (geom === "line") {
        const dashStyle = s.dash === "dot" ? "dotted" : (s.dash === "dash" ? "dashed" : "solid");
        iconHtml = `<span class="leg-icon line" style="border-top-color:${s.lineColor}; border-top-width:${Math.min(s.weight, 4)}px; border-top-style:${dashStyle};"></span>`;
    } 
    else {
      // Polygon
      iconHtml = `<span class="leg-icon polygon" style="border-color:${s.lineColor}; background:${s.fillColor}; opacity:${s.fillOpacity + 0.4};"></span>`;
    }

    const row = document.createElement("div");
    row.className = "leg-item";
    row.innerHTML = `
      <div class="leg-symbol">${iconHtml}</div>
      <div class="leg-text">${name}</div>
    `;
    legendContent.appendChild(row);
  });
}


// ================== Leaflet GeoJSON creation ==================
function makeLeafletGeoJsonLayer(layerId){
  const item = layerStore[layerId];
  const { geojson } = item;
  const geom = item.def.geom || detectGeomFromGeojson(geojson);
  item.def.geom = geom;
  const style = item.style;

  const leaflet = L.geoJSON(geojson, {
    style: () => ({
      color: style.lineColor,
      weight: style.weight,
      dashArray: dashArrayFromType(style.dash),
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity
    }),
    pointToLayer: (f, latlng) => {
      return L.circleMarker(latlng, {
        radius: 6,
        color: style.lineColor,
        weight: Math.max(1, style.weight),
        fillColor: style.fillColor || style.lineColor,
        fillOpacity: 0.9
      });
    },
    onEachFeature: (f, l) => {
      const fid = f?.properties?._fid ?? null;
      if (fid !== null) item.byFid[fid] = l;

      l.on("click", () => {
        if (activeAttrLayerId === layerId) {
          selectedFeatureKey = `${layerId}::${fid}`;
          renderAttributeTable(layerId);
        }
      });

      if (f.properties) {
        const content = createFriendlyPopupContent(item.def.name, f.properties);
        l.bindPopup(content);
      }
    }
  });

  return leaflet;
}

function applyStyleToLeaflet(layerId){
  const item = layerStore[layerId];
  if (!item?.leaflet) return;
  const s = item.style;

  item.leaflet.setStyle && item.leaflet.setStyle({
    color: s.lineColor,
    weight: s.weight,
    dashArray: dashArrayFromType(s.dash),
    fillColor: s.fillColor,
    fillOpacity: s.fillOpacity
  });

  item.leaflet.eachLayer(l => {
    if (l instanceof L.CircleMarker) {
      l.setStyle({
        color: s.lineColor,
        weight: Math.max(1, s.weight),
        fillColor: s.fillColor || s.lineColor,
        fillOpacity: 0.9
      });
    }
  });
}

// ================== LOAD / INIT LAYERS ==================
function initLayer(def, geojson, isImported=false){
  geojson = normalizeGeoJSON(geojson);
  let fid = 0;
  geojson.features = geojson.features || [];
  geojson.features.forEach(f => {
    f.properties = f.properties || {};
    if (f.properties._fid === undefined) f.properties._fid = fid++;
  });

  layerStore[def.id] = {
    def: {
      id: def.id,
      name: def.name,
      group: def.group || (isImported ? "İçe Aktarılanlar" : "Genel"),
      geom: def.geom || detectGeomFromGeojson(geojson)
    },
    geojson,
    byFid: {},
    style: {
      lineColor: def.color || "#2563eb",
      fillColor: def.fillColor || (def.color || "#2563eb"),
      fillOpacity: (def.fillOpacity ?? 0.2),
      weight: (def.weight ?? 2),
      dash: (def.dash ?? "solid")
    },
    leaflet: null,
    isImported 
  };

  const item = layerStore[def.id];
  item.leaflet = makeLeafletGeoJsonLayer(def.id);

  ensureGroup(item.def.group);
  groups[item.def.group].push(def.id);
  
  if (isImported) {
    map.addLayer(item.leaflet);
    renderLegend(); // İçe aktarılan katman eklendiğinde lejantı güncelle
  }

  if (!window.__didFit) {
    const b = item.leaflet.getBounds?.();
    if (b && b.isValid()) {
      window.__didFit = true;
      map.fitBounds(b, { padding:[20,20] });
    }
  }
  rebuildGroupsUI();
  refreshAttrLayerSelect();
}

async function loadDefaultLayersFromDataFolder(){
  const defs = await fetch("data/layers.json").then(r => r.json());
  const failed = [];
  const loaded = [];
  for (const def of defs) {
    try {
      const res = await fetch(`data/${def.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} - data/${def.file}`);
      const raw = await res.json();
      let geojson = normalizeGeoJSON(raw);
      if (looksProjected(geojson)) geojson = reprojectGeoJSONToWGS84(geojson);
      initLayer(def, geojson, false);
      loaded.push(def.id);
    } catch (err) {
      console.error("Layer load failed:", def?.id, def?.file, err);
      failed.push(def?.file || def?.id || "unknown");
    }
  }
  if (loaded.length) setStatus(`${loaded.length} katman yüklendi ✅`);
  if (failed.length) setStatus(`Bazı katman dosyaları yüklenemedi: ${failed.slice(0,3).join(", ")}${failed.length>3 ? "..." : ""}`);
  
  renderLegend(); // Varsayılan katmanlar yüklendikten sonra lejantı güncelle
}

// ================== ATTRIBUTE TABLE & UI ==================
const attrDrawer = document.getElementById("attrDrawer");
const attrLayerSelect = document.getElementById("attrLayerSelect");
const attrFilterCol = document.getElementById("attrFilterCol");
const attrFilterOp = document.getElementById("attrFilterOp");
const attrFilterVal = document.getElementById("attrFilterVal");
const attrApplyFilter = document.getElementById("attrApplyFilter");

const attrTable = document.getElementById("attrTable");
const attrSub = document.getElementById("attrSub");
const attrCount = document.getElementById("attrCount");
const attrClose = document.getElementById("attrClose");
const attrGoLayers = document.getElementById("attrGoLayers");
const attrClearFilter = document.getElementById("attrClearFilter");
const attrAddField = document.getElementById("attrAddField");
const attrExportCsv = document.getElementById("attrExportCsv");
const attrZoomSel = document.getElementById("attrZoomSel");
const attrClearSel = document.getElementById("attrClearSel");

let activeAttrLayerId = null;
let selectedFeatureKey = null;

// Style Modal
const styleModal = document.getElementById("styleModal");
const styleTitle = document.getElementById("styleTitle");
const styleClose = document.getElementById("styleClose");
const styleReset = document.getElementById("styleReset");
const styleApply = document.getElementById("styleApply");
const lineColorEl = document.getElementById("lineColor");
const fillColorEl = document.getElementById("fillColor");
const fillOpacityEl = document.getElementById("fillOpacity");
const fillOpacityVal = document.getElementById("fillOpacityVal");
const lineWeightEl = document.getElementById("lineWeight");
const lineWeightVal = document.getElementById("lineWeightVal");
const lineDashEl = document.getElementById("lineDash");
let activeStyleLayerId = null;

// Global Menu
const globalMenu = document.createElement("div");
globalMenu.className = "global-menu hidden";
globalMenu.innerHTML = `
  <button data-act="style" type="button"><span>🎨 Stil</span><small>çizgi/dolgu</small></button>
  <button data-act="attr" type="button"><span>▦ Öznitelik</span><small>tablo</small></button>
  <button data-act="zoom" type="button"><span>↗ Katmana Git</span><small>zoom</small></button>
`;
document.body.appendChild(globalMenu);
let globalMenuCtx = { layerId:null };
function closeGlobalMenu(){ globalMenu.classList.add("hidden"); globalMenuCtx.layerId = null; }

document.addEventListener("pointerdown", (e) => {
  if (globalMenu.classList.contains("hidden")) return;
  const insideMenu = globalMenu.contains(e.target);
  const clickedMore = e.target.closest?.(".morebtn");
  if (!insideMenu && !clickedMore) closeGlobalMenu();
});
window.addEventListener("resize", closeGlobalMenu);
window.addEventListener("scroll", closeGlobalMenu, true);

globalMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  const btn = e.target.closest("button");
  if (!btn) return;
  const act = btn.dataset.act;
  const layerId = globalMenuCtx.layerId;
  if (!layerId || !layerStore[layerId]) return;

  if (act === "style") openStyleModal(layerId);
  if (act === "attr") openAttributeTable(layerId);
  if (act === "zoom") {
    const item = layerStore[layerId];
    if (item?.leaflet && !map.hasLayer(item.leaflet)) {
      map.addLayer(item.leaflet);
      const cb = document.querySelector(`input[data-layercheck="${layerId}"]`);
      if (cb) cb.checked = true;
      renderLegend(); // Katman açıldığı için lejantı güncelle
    }
    const b = item?.leaflet?.getBounds?.();
    if (b && b.isValid()) map.fitBounds(b, { padding:[20,20] });
  }
  closeGlobalMenu();
});

function openGlobalMenuAt(btnEl, layerId){
  globalMenuCtx.layerId = layerId;
  const r = btnEl.getBoundingClientRect();
  const menuW = 240; const menuH = 160;
  let left = r.right - menuW; left = Math.min(window.innerWidth - menuW - 10, left); left = Math.max(10, left);
  let top = r.bottom + 8; if (top + menuH > window.innerHeight - 10){ top = r.top - menuH - 8; } top = Math.max(10, top);
  globalMenu.style.left = `${left}px`; globalMenu.style.top = `${top}px`;
  globalMenu.classList.remove("hidden");
}

function ensureGroup(name){
  if (!groups[name]) groups[name] = [];
  if (!groupOrder.includes(name)) groupOrder.push(name);
}

// ✅ YENİ: GRUP SİLME VE YENİLEME MANTIĞI
function rebuildGroupsUI(){
  groupListEl.innerHTML = "";
  groupOrder.forEach(groupName => {
    const card = document.createElement("div");
    card.className = "group-card";
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `
      <div class="group-title">${groupName}</div>
      <div class="group-actions">
        <button class="pill" data-act="toggleAll">Hepsini Kapat</button>
        <button class="pill" data-act="hide">Gizle</button>
        <button class="pill danger" data-act="delete">Sil</button>
      </div>
    `;
    const drop = document.createElement("div");
    drop.className = "group-drop";
    drop.dataset.group = groupName;

    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("dragover");
      const layerId = e.dataTransfer.getData("text/layerId");
      if (!layerId) return;
      moveLayerToGroup(layerId, groupName);
    });

    head.querySelector('[data-act="hide"]').addEventListener("click", () => drop.classList.toggle("hidden"));
    
    // 🔥 SİLME BUTONU MANTIĞI 🔥
    head.querySelector('[data-act="delete"]').addEventListener("click", () => {
      const ids = groups[groupName] || [];
      const hasSystemLayer = ids.some(id => {
        const item = layerStore[id];
        return item && !item.isImported;
      });

      if (hasSystemLayer) {
        alert("Bu varsayılan bir sistem grubudur, bütünlüğü bozmamak için silinemez.");
        return;
      }

      if (ids.length > 0) {
        if (!confirm(`"${groupName}" grubu ve içindeki ${ids.length} katman tamamen silinecek. Onaylıyor musun?`)) return;
      }

      ids.forEach(id => {
        const item = layerStore[id];
        if (item) {
          if (item.leaflet) map.removeLayer(item.leaflet);
          if (item.isImported) importedIds.delete(id);
        }
        delete layerStore[id];
      });

      delete groups[groupName];
      const idx = groupOrder.indexOf(groupName);
      if (idx >= 0) groupOrder.splice(idx, 1);
      
      rebuildGroupsUI(); 
      refreshAttrLayerSelect();
      renderLegend(); // Grup silinince lejantı güncelle
    });
    
    const toggleAllBtn = head.querySelector('[data-act="toggleAll"]');
    toggleAllBtn.addEventListener("click", () => {
      const ids = groups[groupName] || [];
      if (!ids.length) return;
      const anyVisible = ids.some(id => map.hasLayer(layerStore[id]?.leaflet));
      ids.forEach(id => {
        const item = layerStore[id];
        if (!item?.leaflet) return;
        if (anyVisible) map.removeLayer(item.leaflet); else map.addLayer(item.leaflet);
        const cb = document.querySelector(`input[data-layercheck="${id}"]`);
        if (cb) cb.checked = !anyVisible;
      });
      toggleAllBtn.textContent = anyVisible ? "Hepsini Aç" : "Hepsini Kapat";
      renderLegend(); // Toplu aç/kapat sonrası lejantı güncelle
    });

    card.appendChild(head); card.appendChild(drop); groupListEl.appendChild(card);
    (groups[groupName] || []).forEach(layerId => {
      const row = buildLayerRow(layerId);
      drop.appendChild(row);
    });
  });
}

function moveLayerToGroup(layerId, newGroup){
  Object.keys(groups).forEach(g => {
    const idx = groups[g].indexOf(layerId);
    if (idx >= 0) groups[g].splice(idx, 1);
  });
  ensureGroup(newGroup); groups[newGroup].push(layerId);
  layerStore[layerId].def.group = newGroup;
  rebuildGroupsUI(); refreshAttrLayerSelect();
}

function geomIconClass(geom){
  if (geom === "point") return "geom-icon point";
  if (geom === "line") return "geom-icon line";
  if (geom === "polygon") return "geom-icon poly";
  return "geom-icon";
}

function buildLayerRow(layerId){
  const item = layerStore[layerId];
  const def = item.def;
  const row = document.createElement("div");
  row.className = "layer-row";
  row.draggable = true;
  row.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/layerId", layerId));
  row.innerHTML = `
    <div class="layer-left">
      <input class="layer-check" data-layercheck="${layerId}" type="checkbox" ${map.hasLayer(item.leaflet) ? "checked": ""}/>
      <span class="${geomIconClass(def.geom)}"></span>
      <span class="swatch" style="background:${item.style.lineColor}"></span>
      <span class="layer-name" title="${def.name}">${def.name}</span>
    </div>
    <div class="layer-right">
      <button class="editbtn" title="Bu katmana çizim ekle" type="button">✏️</button>
      <button class="morebtn" title="İşlemler" type="button">⋯</button>
    </div>
  `;
  const cb = row.querySelector(".layer-check");
  cb.addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(item.leaflet); else map.removeLayer(item.leaflet);
    renderLegend(); // Checkbox değişince lejantı güncelle
  });
  row.querySelector(".editbtn").addEventListener("click", (e) => { e.stopPropagation(); startEditLayer(layerId); });
  const moreBtn = row.querySelector(".morebtn");
  moreBtn.addEventListener("click", (e) => { e.stopPropagation(); openGlobalMenuAt(moreBtn, layerId); });
  return row;
}

// ================== TOOLBAR ==================
document.getElementById("zoomToAll").onclick = () => {
  const group = L.featureGroup(Object.values(layerStore).map(x => x.leaflet));
  if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding:[20,20] });
};
document.getElementById("clearImports").onclick = () => {
  for (const id of importedIds) {
    const item = layerStore[id];
    if (!item) continue;
    map.removeLayer(item.leaflet);
    Object.keys(groups).forEach(g => {
      const idx = groups[g].indexOf(id);
      if (idx >= 0) groups[g].splice(idx, 1);
    });
    delete layerStore[id];
  }
  importedIds.clear(); rebuildGroupsUI(); refreshAttrLayerSelect();
  renderLegend(); // Temizleme sonrası lejantı güncelle
};
document.getElementById("geojsonFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try{
    const raw = JSON.parse(await file.text());
    let geojson = normalizeGeoJSON(raw);
    if (looksProjected(geojson)) geojson = reprojectGeoJSONToWGS84(geojson);
    const id = `import_${Date.now()}`;
    importedIds.add(id);
    initLayer({ id, name: file.name, group: "İçe Aktarılanlar", color:"#2563eb" }, geojson, true);
    e.target.value = "";
  }catch(err){ console.error(err); alert("GeoJSON okunamadı."); }
});
document.getElementById("shpZipFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try{
    const arrayBuffer = await file.arrayBuffer();
    const raw = await shp(arrayBuffer);
    let geojson = normalizeGeoJSON(raw);
    if (looksProjected(geojson)) geojson = reprojectGeoJSONToWGS84(geojson);
    const id = `import_${Date.now()}`;
    importedIds.add(id);
    initLayer({ id, name: file.name, group: "İçe Aktarılanlar", color:"#16a34a" }, geojson, true);
    e.target.value = "";
  }catch(err){ console.error(err); alert("Shapefile ZIP okunamadı."); }
});
addGroupBtn.addEventListener("click", () => {
  const name = (newGroupNameEl.value || "").trim(); if (!name) return;
  ensureGroup(name); rebuildGroupsUI(); refreshAttrLayerSelect(); newGroupNameEl.value = "";
});

// ================== STYLE MODAL ==================
function openStyleModal(layerId){
  activeStyleLayerId = layerId;
  const item = layerStore[layerId]; if (!item) return;
  styleTitle.textContent = item.def.name;
  lineColorEl.value = item.style.lineColor; fillColorEl.value = item.style.fillColor;
  fillOpacityEl.value = item.style.fillOpacity; fillOpacityVal.textContent = Number(item.style.fillOpacity).toFixed(2);
  lineWeightEl.value = item.style.weight; lineWeightVal.textContent = String(item.style.weight);
  lineDashEl.value = item.style.dash;
  styleModal.classList.remove("hidden");
}
styleClose.addEventListener("click", () => styleModal.classList.add("hidden"));
fillOpacityEl.addEventListener("input", () => fillOpacityVal.textContent = Number(fillOpacityEl.value).toFixed(2));
lineWeightEl.addEventListener("input", () => lineWeightVal.textContent = String(lineWeightEl.value));
styleReset.addEventListener("click", () => {
  const item = layerStore[activeStyleLayerId]; if (!item) return;
  item.style.lineColor = "#2563eb"; item.style.fillColor = "#2563eb";
  item.style.fillOpacity = 0.2; item.style.weight = 2; item.style.dash = "solid";
  openStyleModal(activeStyleLayerId);
});
styleApply.addEventListener("click", () => {
  const item = layerStore[activeStyleLayerId]; if (!item) return;
  item.style.lineColor = lineColorEl.value; item.style.fillColor = fillColorEl.value;
  item.style.fillOpacity = Number(fillOpacityEl.value); item.style.weight = Number(lineWeightEl.value);
  item.style.dash = lineDashEl.value;
  applyStyleToLeaflet(activeStyleLayerId);
  document.querySelectorAll(`input[data-layercheck="${activeStyleLayerId}"]`).forEach(cb => {
    const row = cb.closest(".layer-row"); const sw = row?.querySelector(".swatch");
    if (sw) sw.style.background = item.style.lineColor;
  });
  styleModal.classList.add("hidden");
  renderLegend(); // Stil değişince lejantı güncelle
});

// ================== ATTRIBUTE TABLE ==================
function populateFilterColumns(layerId) {
  const item = layerStore[layerId]; if (!item) return;
  attrFilterCol.innerHTML = '<option value="">(Kolon Seç)</option>';
  const features = item.geojson.features || [];
  const cols = getAllColumns(features); 
  cols.forEach(col => {
    const opt = document.createElement("option");
    opt.value = col; opt.textContent = col;
    attrFilterCol.appendChild(opt);
  });
}
function refreshAttrLayerSelect(){
  const ids = Object.keys(layerStore);
  const current = attrLayerSelect.value || activeAttrLayerId;
  attrLayerSelect.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id; opt.textContent = layerStore[id].def.name;
    attrLayerSelect.appendChild(opt);
  });
  if (current && layerStore[current]) attrLayerSelect.value = current;
}
function openAttributeTable(layerId){
  activeAttrLayerId = layerId; refreshAttrLayerSelect(); attrLayerSelect.value = layerId;
  populateFilterColumns(layerId); 
  attrFilterCol.value = ""; attrFilterVal.value = "";
  renderAttributeTable(layerId); attrDrawer.classList.remove("hidden");
}
function closeAttributeTable(){
  activeAttrLayerId = null; selectedFeatureKey = null; attrDrawer.classList.add("hidden");
}
attrClose.addEventListener("click", closeAttributeTable);
attrGoLayers.addEventListener("click", () => openTab("layers"));
attrLayerSelect.addEventListener("change", () => {
  activeAttrLayerId = attrLayerSelect.value; selectedFeatureKey = null;
  populateFilterColumns(activeAttrLayerId); renderAttributeTable(activeAttrLayerId);
});
attrApplyFilter.addEventListener("click", () => renderAttributeTable(activeAttrLayerId));
attrFilterVal.addEventListener("keydown", (e) => { if (e.key === "Enter") renderAttributeTable(activeAttrLayerId); });
attrClearFilter.addEventListener("click", () => {
  attrFilterCol.value = ""; attrFilterVal.value = ""; attrFilterOp.value = "contains";
  renderAttributeTable(activeAttrLayerId);
});
attrClearSel.addEventListener("click", () => { selectedFeatureKey = null; renderAttributeTable(activeAttrLayerId); });
attrZoomSel.addEventListener("click", () => {
  if (!selectedFeatureKey) return;
  const [lid, fidStr] = selectedFeatureKey.split("::"); const fid = Number(fidStr);
  const item = layerStore[lid]; const lyr = item?.byFid?.[fid]; if (!lyr) return;
  const b = lyr.getBounds?.();
  if (b && b.isValid()) map.fitBounds(b, { padding:[20,20] }); else if (lyr.getLatLng) map.setView(lyr.getLatLng(), Math.max(map.getZoom(), 16));
});

function featurePassesFilter(f) {
  const col = attrFilterCol.value;
  const op = attrFilterOp.value;
  const valStr = attrFilterVal.value.trim().toLowerCase();
  if (!col || valStr === "") return true;
  const props = f.properties || {};
  let rawProp = props[col]; 
  if (rawProp === undefined || rawProp === null) rawProp = "";
  if (op === "contains") return String(rawProp).toLowerCase().includes(valStr);
  if (op === "eq") return String(rawProp).toLowerCase() == valStr;
  const numProp = parseFloat(rawProp); const numVal = parseFloat(valStr);
  if (isNaN(numProp) || isNaN(numVal)) return false;
  if (op === "gt") return numProp > numVal;
  if (op === "lt") return numProp < numVal;
  if (op === "gte") return numProp >= numVal;
  if (op === "lte") return numProp <= numVal;
  return true;
}

function getAllColumns(features){
  const set = new Set();
  features.forEach(f => {
    Object.keys(f.properties || {}).forEach(k => { if (k !== "_fid") set.add(k); });
  });
  return Array.from(set);
}

function renderAttributeTable(layerId){
  const item = layerStore[layerId]; if (!item) return;
  const all = item.geojson.features || [];
  const rows = all.filter(f => featurePassesFilter(f));
  const cols = getAllColumns(rows.length ? rows : all);
  attrSub.textContent = `${item.def.name} • ${rows.length}/${all.length} kayıt`;
  attrCount.textContent = `${rows.length} kayıt`;
  const thead = `<thead><tr><th style="width:42px;">#</th>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead>`;
  const tbodyRows = rows.map((f, idx) => {
    const fid = f.properties?._fid; const key = `${layerId}::${fid}`;
    const selClass = (selectedFeatureKey === key) ? "selected" : "";
    return `<tr class="${selClass}" data-fid="${fid}"><td class="no-edit">${idx+1}</td>${cols.map(c => `<td data-col="${c}" title="${safeStr(f.properties?.[c])}">${safeStr(f.properties?.[c])}</td>`).join("")}</tr>`;
  }).join("");
  attrTable.innerHTML = thead + `<tbody>${tbodyRows}</tbody>`;

  attrTable.querySelectorAll("tbody tr").forEach(tr => {
    tr.addEventListener("click", (e) => {
      if (e.target.tagName === 'INPUT') return;
      const fid = Number(tr.dataset.fid); selectedFeatureKey = `${layerId}::${fid}`;
      const lyr = item.byFid?.[fid]; if (lyr) { try{ lyr.openPopup?.(); }catch(e){} }
      attrTable.querySelectorAll("tbody tr").forEach(r => r.classList.remove("selected"));
      tr.classList.add("selected");
    });
  });

  attrTable.querySelectorAll("tbody td").forEach(td => {
    if (td.classList.contains("no-edit")) return;
    td.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const tr = td.parentElement; const fid = Number(tr.dataset.fid); const col = td.getAttribute("data-col"); 
      if(col) makeCellEditable(td, layerId, fid, col);
    });
  });
}

function toCsv(rows, cols){
  const esc = (v) => {
    const s = safeStr(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  const header = cols.map(esc).join(",");
  const body = rows.map(f => cols.map(c => esc(f.properties?.[c])).join(",")).join("\n");
  return header + "\n" + body;
}

attrExportCsv.addEventListener("click", () => {
  const layerId = activeAttrLayerId || attrLayerSelect.value;
  const item = layerStore[layerId]; if (!item) return;
  const all = item.geojson.features || [];
  const rows = all.filter(f => featurePassesFilter(f));
  const cols = getAllColumns(rows.length ? rows : all);
  const csv = toCsv(rows, cols);
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `${item.def.name}_attribute_table.csv`;
  document.body.appendChild(a); a.click(); a.remove();
});

// ================== FIELD ADD ==================
const addFieldModal = document.getElementById("addFieldModal");
const addFieldClose = document.getElementById("addFieldClose");
const createFieldConfirm = document.getElementById("createFieldConfirm");
const newFieldNameEl = document.getElementById("newFieldName");
const newFieldTypeEl = document.getElementById("newFieldType");
const newFieldDefEl = document.getElementById("newFieldDef");

attrAddField.addEventListener("click", () => {
  newFieldNameEl.value = ""; newFieldTypeEl.value = "string"; newFieldDefEl.value = "";
  addFieldModal.classList.remove("hidden"); newFieldNameEl.focus();
});
addFieldClose.addEventListener("click", () => addFieldModal.classList.add("hidden"));
createFieldConfirm.addEventListener("click", () => {
  const layerId = activeAttrLayerId || attrLayerSelect.value; const item = layerStore[layerId];
  if (!item) { alert("Seçili bir katman yok!"); return; }
  let name = newFieldNameEl.value.trim(); name = name.replace(/\s+/g, "_"); 
  if (!name) { alert("Lütfen bir kolon adı girin."); return; }
  const sampleProps = item.geojson.features[0]?.properties || {};
  if (Object.prototype.hasOwnProperty.call(sampleProps, name)) { alert(`"${name}" adında bir kolon zaten mevcut.`); return; }
  const type = newFieldTypeEl.value; const rawDef = newFieldDefEl.value.trim();
  let finalValue;
  if (type === "int") { finalValue = rawDef === "" ? 0 : parseInt(rawDef); if (isNaN(finalValue)) finalValue = 0; } 
  else if (type === "float") { finalValue = rawDef === "" ? 0.0 : parseFloat(rawDef); if (isNaN(finalValue)) finalValue = 0.0; } 
  else if (type === "bool") { finalValue = (rawDef.toLowerCase() === "true"); } 
  else { finalValue = rawDef; }
  item.geojson.features.forEach(f => { f.properties = f.properties || {}; f.properties[name] = finalValue; });
  populateFilterColumns(layerId); renderAttributeTable(layerId); addFieldModal.classList.add("hidden");
});

// ================== TOOLBOX ==================
const toolbox = document.getElementById("toolbox");
const toolsBtn = document.getElementById("toolsBtn");
const toolboxClose = document.getElementById("toolboxClose");
const toolboxBody = document.getElementById("toolboxBody");
const toolStatus = document.getElementById("toolStatus");

toolsBtn.addEventListener("click", () => toolbox.classList.toggle("hidden"));
toolboxClose.addEventListener("click", () => toolbox.classList.add("hidden"));

function renderToolbox(){
  toolboxBody.innerHTML = `
    <div class="tb-group">
      <button class="tb-group-head" type="button"><span class="caret">▾</span> Ölçüm</button>
      <div class="tb-items">
        <button class="tb-item" data-tool="measureDistance" type="button"><span class="tb-ico">📏</span><span class="tb-text">Mesafe Ölç</span></button>
        <button class="tb-item" data-tool="measureArea" type="button"><span class="tb-ico">📐</span><span class="tb-text">Alan Ölç</span></button>
        <button class="tb-item danger" data-tool="clearToolDraw" type="button"><span class="tb-ico">🧹</span><span class="tb-text">Çizimleri Temizle</span></button>
      </div>
    </div>
    <div class="tb-group">
      <button class="tb-group-head" type="button"><span class="caret">▾</span> Yeni Katman</button>
      <div class="tb-items">
        <div class="tb-form">
          <label class="tb-label">Katman adı</label>
          <input id="newEditLayerName" class="tb-input" placeholder="örn: test"/>
          <label class="tb-label">Geometri tipi</label>
          <select id="newEditGeom" class="tb-select"><option value="point">Nokta</option><option value="line">Çizgi</option><option value="polygon">Poligon</option></select>
          <button id="createEditLayerBtn" class="btn primary tb-create" type="button">Oluştur</button>
          <div class="tb-mini">Oluşturduktan sonra Katmanlar sekmesinde görünecek.</div>
        </div>
      </div>
    </div>
  `;
  const caretButtons = toolboxBody.querySelectorAll(".tb-group-head");
  caretButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const items = btn.parentElement.querySelector(".tb-items");
      items.classList.toggle("hidden");
      btn.querySelector(".caret").textContent = items.classList.contains("hidden") ? "▸" : "▾";
    });
  });
  toolboxBody.querySelectorAll(".tb-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tool;
      if (t === "clearToolDraw") { clearToolDraw(); toolStatus.textContent = "Temizlendi"; setStatus("Ölçüm çizimleri temizlendi"); return; }
      if (t === "measureDistance" || t === "measureArea") { cancelEdit(); setActiveTool(t); toolStatus.textContent = `Seçildi: ${t}`; setStatus(`Araç: ${t} • Haritada tıkla, çift tıkla bitir`); return; }
    });
  });
  const createBtn = toolboxBody.querySelector("#createEditLayerBtn");
  createBtn.addEventListener("click", () => {
    const name = (toolboxBody.querySelector("#newEditLayerName").value || "").trim();
    const geom = toolboxBody.querySelector("#newEditGeom").value;
    if (!name) { alert("Katman adı gir."); return; }
    const id = `edit_${Date.now()}`;
    const geojson = { type:"FeatureCollection", features:[] };
    // IMPORTED = true olarak işaretleniyor ki silinebilsin
    initLayer({ id, name, group: "İçe Aktarılanlar", geom, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.2, weight: 2, dash: "solid" }, geojson, true);
    openTab("layers"); toolbox.classList.add("hidden");
  });
}
renderToolbox();

// ================== MEASURE TOOL ==================
let activeTool = null;
let drawLayer = L.featureGroup().addTo(map);
let drawPoints = [];
let tempLine = null; let tempPoly = null; let tempMarkers = []; let previewPoint = null;

function clearToolDraw() {
  activeTool = null; drawPoints = []; drawLayer.clearLayers();
  tempLine = null; tempPoly = null; tempMarkers = []; previewPoint = null;
}
function setActiveTool(tool) {
  activeTool = tool; drawPoints = []; previewPoint = null;
  if (tempLine) { drawLayer.removeLayer(tempLine); tempLine = null; }
  if (tempPoly) { drawLayer.removeLayer(tempPoly); tempPoly = null; }
  tempMarkers.forEach(m => drawLayer.removeLayer(m)); tempMarkers = [];
}
function distMeters(a, b) { return map.distance(a, b); }
function polygonAreaM2(latlngs) {
  const pts = latlngs.map(ll => map.options.crs.project(ll));
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(area / 2);
}
function fmtDistance(m) { return (m >= 1000) ? (m/1000).toFixed(2) + " km" : Math.round(m) + " m"; }
function fmtArea(m2) { return (m2 >= 1e6) ? (m2/1e6).toFixed(2) + " km²" : (m2 >= 1e4 ? (m2/1e4).toFixed(2) + " ha" : Math.round(m2) + " m²"); }

function updateMeasurePreview(mouseLatLng){
  if (!activeTool || !drawPoints.length) return;
  previewPoint = mouseLatLng;
  if (activeTool === "measureDistance") {
    const pts = [...drawPoints, previewPoint];
    if (!tempLine) { tempLine = L.polyline(pts, { weight: 3 }); drawLayer.addLayer(tempLine); } else { tempLine.setLatLngs(pts); }
    let total = 0; for (let i = 1; i < pts.length; i++) total += distMeters(pts[i-1], pts[i]);
    setStatus(`Mesafe: ${fmtDistance(total)} • Çift tıkla bitir`); toolStatus.textContent = `Mesafe: ${fmtDistance(total)}`;
  }
  if (activeTool === "measureArea") {
    const pts = [...drawPoints, previewPoint];
    if (!tempPoly) { tempPoly = L.polygon(pts, { weight: 3, fillOpacity: 0.15 }); drawLayer.addLayer(tempPoly); } else { tempPoly.setLatLngs(pts); }
    if (pts.length >= 3) {
      const a = polygonAreaM2(pts); setStatus(`Alan: ${fmtArea(a)} • Çift tıkla bitir`); toolStatus.textContent = `Alan: ${fmtArea(a)}`;
    } else {
      setStatus(`Alan ölçümü: en az 3 nokta • Çift tıkla bitir`); toolStatus.textContent = `Alan: —`;
    }
  }
}

// ================== EDIT TOOL ==================
let activeEdit = null;
function cancelMeasureToolIfAny(){ if (activeTool) clearToolDraw(); }
function cancelEdit(){
  if (activeEdit?.tempLine) drawLayer.removeLayer(activeEdit.tempLine);
  if (activeEdit?.tempPoly) drawLayer.removeLayer(activeEdit.tempPoly);
  (activeEdit?.markers || []).forEach(m => drawLayer.removeLayer(m));
  activeEdit = null; setStatus("Hazır"); toolStatus.textContent = "Hazır";
}
function startEditLayer(layerId){
  const item = layerStore[layerId]; if (!item) return;
  cancelMeasureToolIfAny();
  activeEdit = { layerId, geom: item.def.geom, points: [], tempLine: null, tempPoly: null, previewPoint: null, markers: [] };
  setStatus(`Düzenleme: ${item.def.name} • Tıkla çiz • Çift tıkla bitir • ESC iptal`); toolStatus.textContent = `Edit: ${item.def.geom}`;
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (activeEdit) cancelEdit(); if (activeTool) clearToolDraw(); }
});
function nextFidForLayer(layerId){
  const item = layerStore[layerId]; let max = -1;
  (item.geojson.features || []).forEach(f => {
    const fid = Number(f?.properties?._fid); if (!Number.isNaN(fid)) max = Math.max(max, fid);
  });
  return max + 1;
}
function addFeatureToLayer(layerId, feature){
  const item = layerStore[layerId]; if (!item) return;
  feature.properties = feature.properties || {}; feature.properties._fid = nextFidForLayer(layerId);
  item.geojson.features = item.geojson.features || []; item.geojson.features.push(feature);
  item.leaflet.addData(feature);
  item.leaflet.eachLayer(l => {
    const f = l.feature; const fid = f?.properties?._fid;
    if (fid !== undefined) item.byFid[fid] = l;
  });
  rebuildGroupsUI(); refreshAttrLayerSelect();
}
function updateEditPreview(mouseLatLng){
  if (!activeEdit) return; if (activeEdit.geom === "point") return; if (!activeEdit.points.length) return;
  activeEdit.previewPoint = mouseLatLng;
  if (activeEdit.geom === "line"){
    const pts = [...activeEdit.points, activeEdit.previewPoint];
    if (!activeEdit.tempLine) { activeEdit.tempLine = L.polyline(pts, { weight: 3 }); drawLayer.addLayer(activeEdit.tempLine); } else { activeEdit.tempLine.setLatLngs(pts); }
  }
  if (activeEdit.geom === "polygon"){
    const pts = [...activeEdit.points, activeEdit.previewPoint];
    if (!activeEdit.tempPoly) { activeEdit.tempPoly = L.polygon(pts, { weight: 3, fillOpacity: 0.15 }); drawLayer.addLayer(activeEdit.tempPoly); } else { activeEdit.tempPoly.setLatLngs(pts); }
  }
}

// ================== MAP EVENTS ==================
map.on("mousemove", (e) => { if (activeTool) updateMeasurePreview(e.latlng); if (activeEdit) updateEditPreview(e.latlng); });
map.on("click", (e) => {
  if (activeEdit){
    const ll = e.latlng;
    if (activeEdit.geom === "point"){
      const feature = { type:"Feature", properties: { name:"" }, geometry: { type:"Point", coordinates:[ll.lng, ll.lat] } };
      addFeatureToLayer(activeEdit.layerId, feature); cancelEdit(); return;
    }
    activeEdit.points.push(ll);
    const mk = L.circleMarker(ll, { radius: 5, weight: 2, fillOpacity: 0.9 });
    activeEdit.markers.push(mk); drawLayer.addLayer(mk); updateEditPreview(ll); return;
  }
  if (!activeTool) return;
  const ll = e.latlng; drawPoints.push(ll);
  const mk = L.circleMarker(ll, { radius: 5, weight: 2, fillOpacity: 0.9 });
  tempMarkers.push(mk); drawLayer.addLayer(mk); updateMeasurePreview(ll);
});

// Çift Tıklama Mantığı (Ölçüm Bitişi)
map.on("dblclick", (e) => {
  if (activeEdit){
    L.DomEvent.stop(e);
    const lid = activeEdit.layerId; const geom = activeEdit.geom;
    if (geom === "line" && activeEdit.points.length >= 2){
      const coords = activeEdit.points.map(p => [p.lng, p.lat]);
      const feature = { type:"Feature", properties: { name:"" }, geometry: { type:"LineString", coordinates: coords } };
      addFeatureToLayer(lid, feature);
    }
    if (geom === "polygon" && activeEdit.points.length >= 3){
      const ring = activeEdit.points.map(p => [p.lng, p.lat]); ring.push([activeEdit.points[0].lng, activeEdit.points[0].lat]);
      const feature = { type:"Feature", properties: { name:"" }, geometry: { type:"Polygon", coordinates:[ring] } };
      addFeatureToLayer(lid, feature);
    }
    cancelEdit(); return;
  }
  
  if (!activeTool) return;
  L.DomEvent.stop(e);

  if (activeTool === "measureDistance") {
    if (tempLine && drawPoints.length >= 2) {
       const pts = [...drawPoints]; let total = 0; for (let i = 1; i < pts.length; i++) total += distMeters(pts[i-1], pts[i]);
       tempLine.setLatLngs(pts); tempLine.bindPopup(`Mesafe: <b>${fmtDistance(total)}</b>`).openPopup();
    } else { if(tempLine) drawLayer.removeLayer(tempLine); }
  }

  if (activeTool === "measureArea") {
    if (tempPoly && drawPoints.length >= 3) {
      const pts = [...drawPoints]; const a = polygonAreaM2(pts);
      tempPoly.setLatLngs(pts); tempPoly.bindPopup(`Alan: <b>${fmtArea(a)}</b>`).openPopup();
    } else { if(tempPoly) drawLayer.removeLayer(tempPoly); }
  }

  tempMarkers.forEach(m => drawLayer.removeLayer(m));
  
  activeTool = null; drawPoints = []; tempLine = null; tempPoly = null; tempMarkers = []; previewPoint = null;
  toolStatus.textContent = "Hazır"; setStatus("Ölçüm tamamlandı");
});

// ================== AUTH STATE ==================
let currentUser = null;
const userLine = document.getElementById("userLine");
const logoutBtn = document.getElementById("logoutBtn");
logoutBtn.addEventListener("click", async () => {
  try{ await signOut(auth); alert("Çıkış yapıldı."); }catch(e){ console.error(e); alert("Çıkış yapılamadı."); }
});
onAuthStateChanged(auth, async (u) => {
  currentUser = u || null;
  if (!u) {
    resetAppLayersOnly(); authScreen.style.display = "grid"; appRoot.style.display = "none";
    userLine.textContent = "—"; setStatus("Hazır"); return;
  }
  authScreen.style.display = "none"; appRoot.style.display = "grid";
  userLine.textContent = u.email || u.uid;
  resetAppLayersOnly(); refreshLeafletAfterShow();
  try{
    setStatus("Katmanlar yükleniyor..."); await loadDefaultLayersFromDataFolder(); setStatus("Varsayılan katmanlar yüklendi ✅");
  }catch(err){ console.error(err); setStatus("Yükleme hatası ❌"); }
  refreshLeafletAfterShow();
});

// ✅ MAKE CELL EDITABLE (HELPER)
function makeCellEditable(td, layerId, fid, col) {
  const item = layerStore[layerId]; if (!item) return;
  const feature = item.geojson.features.find(f => f.properties._fid === fid); if (!feature) return;
  const currentVal = feature.properties[col]; const originalHtml = td.innerHTML; 
  td.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text"; input.value = (currentVal === undefined || currentVal === null) ? "" : currentVal;
  input.className = "attr-edit-input"; td.appendChild(input); input.focus();
  const save = () => {
    const rawVal = input.value; let finalVal = rawVal;
    if (typeof currentVal === "number") {
      if (rawVal.includes(".")) finalVal = parseFloat(rawVal); else finalVal = parseInt(rawVal);
      if (isNaN(finalVal)) finalVal = 0; 
    } else if (typeof currentVal === "boolean") { finalVal = (rawVal.toLowerCase() === "true"); }
    feature.properties[col] = finalVal;
    
    // YENİ POPUP İÇERİĞİNİ GÜNCELLE
    const lyr = item.byFid[fid];
    if (lyr && lyr.bindPopup) {
       lyr.bindPopup(createFriendlyPopupContent(item.def.name, feature.properties));
    }
    renderAttributeTable(layerId);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save(); if (e.key === "Escape") td.innerHTML = originalHtml; 
  });
  input.addEventListener("blur", () => save());
}

/* =========================================================
   YENİ EKLENENLER: UI ETKİLEŞİMLERİ (SIDEBAR & DRAG)
========================================================= */

/* =========================================================
   SIDEBAR TOGGLE (KESİN ÇÖZÜM)
========================================================= */
const toggleBtn = document.getElementById("sidebarToggle");
const appContainer = document.querySelector(".app");

if (toggleBtn && appContainer) {
  toggleBtn.addEventListener("click", () => {
    // 1. Sınıfı ekle/çıkar (CSS grid'i 0px yapar)
    appContainer.classList.toggle("sidebar-closed");
    
    // 2. Butonun ok yönünü değiştir
    if (appContainer.classList.contains("sidebar-closed")) {
      toggleBtn.textContent = "▶"; // Sağa bak
    } else {
      toggleBtn.textContent = "◀"; // Sola bak
    }

    // 3. Leaflet haritasını güncelle (bozulmaması için)
    setTimeout(() => {
      if (typeof map !== "undefined") {
        map.invalidateSize();
      }
    }, 350); // CSS transition süresi kadar bekle (0.3s)
  });
}

// 2. DRAGGABLE (Sürüklenebilir) ÖZNİTELİK TABLOSU
const dragItem = document.getElementById("attrDrawer");
const dragHandle = document.querySelector(".attr-head");

if (dragItem && dragHandle) {
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  dragHandle.addEventListener("mousedown", (e) => {
    // Sadece başlığa tıklayınca sürükle, butonlara tıklayınca değil
    if(e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    // Mevcut konumu al
    const rect = dragItem.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    
    dragHandle.style.cursor = "grabbing";
    
    // Pencereyi en öne getir (Z-Index)
    dragItem.style.zIndex = "2000";
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    dragItem.style.left = `${initialLeft + dx}px`;
    dragItem.style.top = `${initialTop + dy}px`;
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      dragHandle.style.cursor = "grab";
      dragItem.style.zIndex = ""; // Eski haline dönebilir veya kalabilir
    }
  });
}

/* =========================================================
   3. RESIZABLE (BOYUTLANDIRILABİLİR) PENCERE MANTIĞI
========================================================= */
function makeResizable(el) {
  if (!el) return;

  // 1. Tutamaçları (Resizers) Otomatik Oluştur ve Ekle
  const resizers = {
    r: document.createElement("div"),  // Sağ
    b: document.createElement("div"),  // Alt
    br: document.createElement("div")  // Köşe
  };

  resizers.r.className = "resizer resizer-r";
  resizers.b.className = "resizer resizer-b";
  resizers.br.className = "resizer resizer-br";

  el.appendChild(resizers.r);
  el.appendChild(resizers.b);
  el.appendChild(resizers.br);

  // 2. Boyutlandırma Fonksiyonu
  const initResize = (e) => {
    // Mobilde veya PC'de tıklama/dokunma koordinatını al
    // Sadece mouse için basit tutuyoruz:
    e.preventDefault();
    
    const type = e.target.classList.contains("resizer-r") ? "w" : 
                 (e.target.classList.contains("resizer-b") ? "h" : "both");
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = parseInt(document.defaultView.getComputedStyle(el).width, 10);
    const startH = parseInt(document.defaultView.getComputedStyle(el).height, 10);

    const doResize = (moveEvent) => {
      if (type === "w" || type === "both") {
        el.style.width = (startW + moveEvent.clientX - startX) + "px";
      }
      if (type === "h" || type === "both") {
        el.style.height = (startH + moveEvent.clientY - startY) + "px";
      }
      
      // Leaflet haritası varsa ve pencere harita üzerindeyse gerek yok ama
      // tablo içindeki kolonlar sıkışırsa diye bir şey yapmaya gerek yok, flex hallediyor.
    };

    const stopResize = () => {
      window.removeEventListener("mousemove", doResize);
      window.removeEventListener("mouseup", stopResize);
      document.body.style.cursor = "default";
      el.style.userSelect = "auto"; // Metin seçimini geri aç
    };

    window.addEventListener("mousemove", doResize);
    window.addEventListener("mouseup", stopResize);
    
    // Sürüklerken metin seçimi olmasın diye
    document.body.style.cursor = type === "w" ? "col-resize" : (type === "h" ? "row-resize" : "nwse-resize");
    el.style.userSelect = "none";
  };

  // 3. Event Listener'ları Bağla
  Object.values(resizers).forEach(div => {
    div.addEventListener("mousedown", initResize);
  });
}

// Fonksiyonu Öznitelik Tablosu (attrDrawer) için çalıştır
const drawerEl = document.getElementById("attrDrawer");
if (drawerEl) {
  makeResizable(drawerEl);
}

/* =========================================================
   4. CANLI KOORDİNAT & SAĞ TIK MENÜSÜ (CONTEXT MENU)
========================================================= */

// --- Değişkenler ---
const coordBox = document.getElementById("coordBox");
const ctxMenu = document.getElementById("contextMenu");
const ctxZoom = document.getElementById("ctxZoom");
const ctxCopy = document.getElementById("ctxCopy");
const ctxGoogle = document.getElementById("ctxGoogle");
const ctxCenter = document.getElementById("ctxCenter");

// Sağ tıklandığında koordinatı hafızada tutmak için
let clickedLatLng = null;

// 1. Mouse Hareketinde Koordinat Gösterimi
if (map && coordBox) {
  map.on("mousemove", (e) => {
    // 5 haneli hassasiyet (yaklaşık 1 metre)
    const lat = e.latlng.lat.toFixed(5);
    const lng = e.latlng.lng.toFixed(5);
    coordBox.textContent = `${lat}, ${lng}`;
  });
}

// 2. Sağ Tık Menüsünü Açma
if (map && ctxMenu) {
  map.on("contextmenu", (e) => {
    // Tarayıcının kendi menüsünü engelle
    // (Leaflet bunu otomatik yapmazsa e.originalEvent.preventDefault() gerekebilir)
    
    clickedLatLng = e.latlng; // Tıklanan yeri kaydet

    // Menüyü farenin olduğu yere taşı
    const x = e.containerPoint.x + map.getContainer().offsetLeft;
    const y = e.containerPoint.y + map.getContainer().offsetTop;
    
    ctxMenu.style.left = `${e.originalEvent.pageX}px`;
    ctxMenu.style.top = `${e.originalEvent.pageY}px`;
    
    ctxMenu.classList.remove("hidden");
  });

  // Haritada başka yere tıklayınca menüyü kapat
  map.on("mousedown", () => ctxMenu.classList.add("hidden"));
  map.on("dragstart", () => ctxMenu.classList.add("hidden"));
  map.on("zoomstart", () => ctxMenu.classList.add("hidden"));
}

// 3. Menü İşlevleri

// A) Buraya Odaklan (Zoom)
ctxZoom.addEventListener("click", () => {
  if (clickedLatLng) {
    map.flyTo(clickedLatLng, 15); // Havalı uçuş animasyonu
    ctxMenu.classList.add("hidden");
  }
});

// B) Koordinatı Kopyala
ctxCopy.addEventListener("click", () => {
  if (clickedLatLng) {
    const text = `${clickedLatLng.lat.toFixed(6)}, ${clickedLatLng.lng.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => {
      setStatus(`Koordinat kopyalandı: ${text}`);
    });
    ctxMenu.classList.add("hidden");
  }
});

// C) Google Maps'te Aç
ctxGoogle.addEventListener("click", () => {
  if (clickedLatLng) {
    const url = `https://www.google.com/maps?q=${clickedLatLng.lat},${clickedLatLng.lng}`;
    window.open(url, "_blank");
    ctxMenu.classList.add("hidden");
  }
});

// D) Merkezi Burası Yap (Pan)
ctxCenter.addEventListener("click", () => {
  if (clickedLatLng) {
    map.panTo(clickedLatLng);
    ctxMenu.classList.add("hidden");
  }
});
