// --- 1. Global control scale and state ---
const CURRENT_YEAR = 2026;
const START_YEAR = 2000;
const DEFAULT_BRIGHTNESS = 100;
const MAX_NODES = 760;
const CUMULATIVE_BASE_NODES = 210;
const INTERVENTION_COLOR = "#50ACFF";
const OLD_INTERVENTION_COLOR = "#8e969a";
const RECOVERY_COLOR = "#3f6f64";
const RECOVERY_OLD_COLOR = "#7b8d88";
const MAX_RECOVERY_ACTIONS = 180;
const RECOVERY_BURST_ROOTS = 10;
const RECOVERY_DISSOLVE_NODES = 12;
const MAX_SUPPORT_UNDERGROWTH_NODES = 80;
const EMISSION_FACTORS = {
    transportKmPerUse: 10,
    carKgCo2PerKm: 0.21,
    transitKgCo2PerKm: 0.03,
    climateKgCo2PerHour: 0.7,
    shoppingKgCo2PerItem: 15,
    deliveryKgCo2PerOrder: 1.2,
    deliveryPlasticKgPerOrder: 0.2,
    streamingKgCo2PerHour: 0.075
};

// Object for storing human intervention values
let config = {
    lat: 50.9803,
    lon: 11.3290,
    locName: "Weimar, Germany",
    year: CURRENT_YEAR,
    month: new Date().getMonth() + 1,
    brightness: DEFAULT_BRIGHTNESS,
    growthMode: "auto",
    paused: false,
    
    // Intervention counter values
    transport: 0,
    climate: 0,
    shopping: 0,
    delivery: 0,
    streaming: 0
};

let metrics = {
    airTemp: 16.0,
    pm25: 12.0,
    soilTemp: 14.5,
    soilMoisture: 0.28,
    pm10: 22.0,
    otuCount: 0,
    bridgeSpan: 0.78,
    bridgeSag: 0.05,
    bridgeWidth: 0.22,
    meshAmplitude: 26,
    deckDensity: 52,
    anchorSpread: 58,
    stressLevel: 0,
    decay: 0,
    distortion: 0,
    monopoly: 0,
    growthPressure: 0,
    humanCo2Kg: 0,
    transportCo2Kg: 0,
    climateCo2Kg: 0,
    shoppingCo2Kg: 0,
    deliveryCo2Kg: 0,
    streamingCo2Kg: 0,
    plasticWasteKg: 0,
    indirectPmIndex: 0,
    humanPm25Proxy: 0,
    humanPm10Proxy: 0,
    temporalIntervention: 0,
    lastIntervention: "Monitoring live atmosphere..."
};

let rootNodes = [];
let rootLinks = [];
let supportRoots = [];
let growInterval = null;
let empRows = [];
let otuRows = [];
let sensorController = null;
let environmentRefreshTimer = null;
let bridgeRebuildTimer = null;
let nextNodeId = 0;
let otuCursor = 0;
let stableBridgeSeedRows = [];
let locationBridgeRefreshPending = false;
let draggingAnchor = false;
let draggingRoot = false;
let anchorPositions = { left: null, right: null };
let activeInterventionStart = 0;
let activeInterventionEnd = 0;
let recoveryActionCount = 0;
let bulkRenderDepth = 0;
let lastColorStateKey = "";
let lastBrightnessStateKey = "";
let baseBridgeShape = {
    bridgeSpan: metrics.bridgeSpan,
    bridgeSag: metrics.bridgeSag,
    bridgeWidth: metrics.bridgeWidth,
    meshAmplitude: metrics.meshAmplitude,
    deckDensity: metrics.deckDensity,
    anchorSpread: metrics.anchorSpread
};

// --- Dictionary that translates microbial taxa into metaphorical personas ---
const TRANSLATION_MAP = {
    "p__Firmicutes": "shield bacteria enduring severe pollution",
    "p__Proteobacteria": "asphalt-dominant bacteria feeding on urban exhaust",
    "p__Actinobacteria": "restorative bacteria attempting to heal dry soil",
    "p__Bacteroidetes": "cleaner bacteria decomposing human byproducts",
    "p__Acidobacteria": "climate-threshold bacteria reacting to acidity",
    "p__Verrucomicrobia": "hidden helper bacteria wrapping plant roots",
    "p__Cyanobacteria": "photosynthetic pioneer bacteria seeking light"
};

function getMetaphor(phylumString, fallbackText) {
    const matched = Object.keys(TRANSLATION_MAP).find(key => phylumString.includes(key));
    return matched ? TRANSLATION_MAP[matched] : `${fallbackText} ecological lineage`;
}

// --- 2. Map initialization ---
const map = L.map("map", { zoomControl: false }).setView([config.lat, config.lon], 4);
window.map = map;
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
let mapMarker = L.marker([config.lat, config.lon]).addTo(map);
let pollutionLayer = L.layerGroup().addTo(map);

map.on("click", async function(e) {
    config.lat = e.latlng.lat;
    config.lon = e.latlng.lng;
    mapMarker.setLatLng(e.latlng);
    config.locName = "Finding Country";
    setText("txt-loc", config.locName);
    await resolveSelectedPlaceName();
    locationBridgeRefreshPending = true;
    await fetchEnvironmentData();
});

function getYearProgress() {
    return clamp((config.year - START_YEAR) / Math.max(1, CURRENT_YEAR - START_YEAR), 0, 1);
}

function hasManualIntervention() {
    return positiveInterventionCount() > 0;
}

function manualInterventionCount() {
    return config.transport + config.climate + config.shopping + config.delivery + config.streaming;
}

function positiveInterventionCount() {
    return ["transport", "climate", "shopping", "delivery", "streaming"]
        .reduce((sum, key) => sum + Math.max(0, config[key]), 0);
}

function negativeInterventionCount() {
    return ["transport", "climate", "shopping", "delivery", "streaming"]
        .reduce((sum, key) => sum + Math.max(0, -config[key]), 0);
}

function bridgeGrowthState() {
    const total = manualInterventionCount();
    if(total < 0) return "recovery";
    if(positiveInterventionCount() > 0) return "pollution";
    return "neutral";
}

function getInterventionOverlayCount() {
    if(!hasManualIntervention()) return 0;
    return Math.round(clamp(positiveInterventionCount() * 4 + Math.max(0, metrics.humanCo2Kg) * 0.2, 0, 90));
}

function currentInterventionNodeCount() {
    return rootNodes.filter(node => node.intervention).length;
}

function isActiveInterventionSlot(index) {
    return index >= activeInterventionStart && index < activeInterventionEnd;
}

function getInterventionColor(d) {
    return d && d.activeIntervention
        ? cssColor("--root-intervention-color", INTERVENTION_COLOR)
        : cssColor("--root-intervention-old-color", OLD_INTERVENTION_COLOR);
}

function getRecoveryColor(d, aged = false) {
    if(!d || !d.recovery) return aged ? getAgedRootColor() : getRootStrokeColor();
    return aged
        ? cssColor("--root-recovery-old-color", RECOVERY_OLD_COLOR)
        : cssColor("--root-recovery-color", RECOVERY_COLOR);
}

function markLatestInterventionSlots(previousCount, nextCount) {
    if(nextCount <= 0) {
        activeInterventionStart = 0;
        activeInterventionEnd = 0;
        return;
    }

    const changedCount = Math.abs(nextCount - previousCount);
    const visibleLatestCount = clamp(Math.max(changedCount, 6), 1, 12);
    activeInterventionEnd = nextCount;
    activeInterventionStart = Math.max(0, nextCount - visibleLatestCount);
}

function pollutionScore(row) {
    const diversityStress = 1 - clamp((row.shannon || 4) / 8, 0, 1);
    const otuStress = 1 - clamp(Math.log10((row.otus || 30) + 10) / 3.2, 0, 1);
    const tempStress = clamp(((row.temp || 12) - 10) / 28, 0, 1);
    return diversityStress * 0.5 + otuStress * 0.25 + tempStress * 0.25;
}

function updatePollutionMap() {
    if(!pollutionLayer) return;
    pollutionLayer.clearLayers();
    if(!empRows.length) return;

    const progress = getYearProgress();
    const rows = empRows
        .filter(row => row.year >= START_YEAR && row.year <= config.year)
        .filter(row => Number.isFinite(row.lat) && Number.isFinite(row.lon))
        .map(row => ({ row, score: pollutionScore(row) }))
        .filter(item => item.score > 0.42)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.round(12 + progress * 90));

    rows.forEach(item => {
        const interventionColor = cssColor("--root-intervention-color", INTERVENTION_COLOR);
        L.circleMarker([item.row.lat, item.row.lon], {
            radius: 2.5 + item.score * 5,
            color: interventionColor,
            weight: 1,
            fillColor: interventionColor,
            fillOpacity: 0.08 + progress * item.score * 0.72,
            opacity: 0.18 + progress * 0.65
        }).addTo(pollutionLayer);
    });
}

// --- 3. Utilities ---
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function canvasMinX() { return -width * 0.38; }
function canvasMaxX() { return width * 1.38; }
function canvasMinY() { return -height * 0.18; }
function canvasMaxY() { return height * 2.8; }
function toNumber(value) { const number = parseFloat(value); return Number.isFinite(number) ? number : null; }
function mean(values) {
    const valid = values.filter(value => Number.isFinite(value));
    if(!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
function getCollectionYear(value) {
    const match = String(value || "").match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
}
function choose(list) { return list[Math.floor(Math.random() * list.length)]; }
function stableRand(seed, salt = 0) {
    const raw = Math.sin(String(seed).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) * 12.9898 + salt * 78.233) * 43758.5453;
    return raw - Math.floor(raw);
}
function stableSide(seed) { return stableRand(seed, 91) > 0.5 ? "left" : "right"; }
function setText(id, value) {
    const el = document.getElementById(id);
    if(!el) return;
    const text = String(value);
    if(el.classList.contains("val")) {
        const parts = text.trim().split(/\s+/).filter(Boolean);
        el.replaceChildren(...parts.map(part => {
            const span = document.createElement("span");
            span.textContent = part;
            return span;
        }));
        el.setAttribute("aria-label", text);
        return;
    }
    el.innerText = text;
}

function cssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function cssNumber(name, fallback) {
    const value = parseFloat(cssColor(name, fallback));
    return Number.isFinite(value) ? value : fallback;
}

function interventionOpacity(kind, active) {
    return cssNumber(`--intervention-${kind}-${active ? "active" : "trace"}-opacity`, active ? 0.9 : 0.12);
}

function nextOtu() {
    if(!otuRows.length) return null;
    const row = otuRows[otuCursor % otuRows.length];
    otuCursor += 1;
    return row;
}

function taxonomyRank(taxonomy, prefix) {
    const part = String(taxonomy || "").split(";").map(item => item.trim()).find(item => item.startsWith(prefix));
    return part ? part.replace(prefix, "").trim() : "";
}

function locationNameFallback() {
    if(config.lat <= -60) return "Antarctica";
    return "Unknown Country";
}

function formatPlaceNameFromAddress(address = {}, fallback = "") {
    const country = address.country || "";
    const primary =
        address.city ||
        address.town ||
        address.village ||
        address.hamlet ||
        address.municipality ||
        address.county ||
        address.state_district ||
        address.state ||
        address.region ||
        address.province ||
        address.island ||
        address.archipelago ||
        address.ocean ||
        address.sea ||
        country ||
        fallback;
    if(primary === country) return country || fallback;
    return [primary, country].filter(Boolean).join(", ");
}

function selectedMonthLabel() {
    return new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2000, config.month - 1, 1));
}

async function resolveSelectedPlaceName() {
    const fallback = locationNameFallback();
    try {
        const baseUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${config.lat.toFixed(5)}&lon=${config.lon.toFixed(5)}&addressdetails=1&accept-language=en`;
        let response = await fetch(`${baseUrl}&zoom=8`, { headers: { "Accept-Language": "en" } });
        if(response.ok) {
            const data = await response.json();
            const nextName = formatPlaceNameFromAddress(data.address, data.name || data.display_name || fallback);
            config.locName = nextName || fallback;
            setText("txt-loc", config.locName);
            return;
        }

        response = await fetch(`${baseUrl}&zoom=3`, { headers: { "Accept-Language": "en" } });
        if(!response.ok) {
            config.locName = fallback;
            setText("txt-loc", config.locName);
            return;
        }
        const data = await response.json();
        const nextName = formatPlaceNameFromAddress(data.address, fallback);
        config.locName = nextName || fallback;
        setText("txt-loc", config.locName);
    } catch(e) {
        config.locName = fallback;
        setText("txt-loc", config.locName);
    }
}

function historicalWeatherDateFor(year) {
    const today = new Date();
    const day = today.getDate();
    const month = config.month;
    const safeDay = Math.min(day, new Date(year, month, 0).getDate());
    const monthText = String(month).padStart(2, "0");
    const dayText = String(safeDay).padStart(2, "0");
    return `${year}-${monthText}-${dayText}`;
}

function isHistoricalWeatherSelection() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    return config.year < currentYear || (config.year === currentYear && config.month < currentMonth);
}

function maxSelectableMonth() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    return config.year >= currentYear ? currentMonth : 12;
}

function syncMonthParameterLimit() {
    const monthSlider = document.getElementById("param-month");
    if(!monthSlider) return;
    const maxMonth = maxSelectableMonth();
    monthSlider.max = maxMonth;
    if(config.month > maxMonth) config.month = maxMonth;
    monthSlider.value = config.month;
}

function distanceToCurrent(row) {
    if(!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) return Number.POSITIVE_INFINITY;
    return Math.sqrt(Math.pow(row.lat - config.lat, 2) + Math.pow(row.lon - config.lon, 2));
}

function shapeNoise(index, scale = 1) {
    const raw = Math.sin((CURRENT_YEAR * 12.9898) + (index * 78.233)) * 43758.5453;
    return (raw - Math.floor(raw)) * scale;
}

function getHumanAdjustedMetrics() {
    const co2Heat = metrics.humanCo2Kg * 0.006;
    const actionHeat =
        (config.transport * 0.08) +
        (config.climate * 0.16) +
        (config.shopping * 0.07) +
        (config.delivery * 0.06) +
        (config.streaming * 0.025);
    const soilHeat = (config.climate * 0.11) + (config.delivery * 0.04) + (config.shopping * 0.035);
    const soilDryness =
        (config.climate * 0.018) +
        (config.shopping * 0.012) +
        (config.delivery * 0.016) +
        (config.streaming * 0.004) +
        (metrics.plasticWasteKg * 0.045);

    return {
        airTemp: clamp(metrics.airTemp + co2Heat + actionHeat, -60, 65),
        pm25: clamp(metrics.pm25 + metrics.humanPm25Proxy, 0, 150),
        soilTemp: clamp(metrics.soilTemp + co2Heat * 0.7 + soilHeat, -60, 65),
        soilMoisture: clamp(metrics.soilMoisture - soilDryness, 0.02, 0.95),
        pm10: clamp(metrics.pm10 + metrics.humanPm10Proxy, 0, 230)
    };
}

function microbialSeasonActivity() {
    const adjusted = getHumanAdjustedMetrics();
    const summerMonth = config.lat >= 0 ? 7 : 1;
    const seasonalWarmth = (Math.cos(((config.month - summerMonth) / 12) * Math.PI * 2) + 1) * 0.5;
    const seasonalPulse = Math.pow(seasonalWarmth, 1.7);
    const tempSuitability = clamp(1 - Math.abs(adjusted.soilTemp - 24) / 24, 0, 1);
    const moistureSuitability = clamp(1 - Math.abs(adjusted.soilMoisture - 0.48) / 0.48, 0, 1);
    return clamp(seasonalPulse * 0.76 + tempSuitability * 0.16 + moistureSuitability * 0.08, 0, 1);
}

function climateGrowthSuitability() {
    const adjusted = getHumanAdjustedMetrics();
    const airScore = clamp(1 - Math.abs(adjusted.airTemp - 18) / 30, 0, 1);
    const soilScore = clamp(1 - Math.abs(adjusted.soilTemp - 16) / 26, 0, 1);
    const moistureScore = clamp(1 - Math.abs(adjusted.soilMoisture - 0.46) / 0.46, 0, 1);
    const polarScore = clamp((82 - Math.abs(config.lat)) / 32, 0.16, 1);
    const climateScore = airScore * 0.42 + soilScore * 0.34 + moistureScore * 0.24;
    return clamp(climateScore * (0.42 + polarScore * 0.58), 0.08, 1);
}

function seasonalSupportUndergrowthCount() {
    const activity = microbialSeasonActivity();
    if(activity < 0.22) return 0;
    if(activity < 0.45) return 2;
    if(activity < 0.68) return 4;
    if(activity < 0.86) return 6;
    return 8;
}

function counterImpactLabel(type) {
    if(type === "transport") {
        const carKg = EMISSION_FACTORS.transportKmPerUse * EMISSION_FACTORS.carKgCo2PerKm;
        const transitKg = EMISSION_FACTORS.transportKmPerUse * EMISSION_FACTORS.transitKgCo2PerKm;
        return `car ${EMISSION_FACTORS.transportKmPerUse} km +${carKg.toFixed(2)} kg CO2e / transit baseline ${transitKg.toFixed(2)} kg`;
    }
    if(type === "climate") return `heating/cooling 1 hour +${EMISSION_FACTORS.climateKgCo2PerHour.toFixed(2)} kg CO2e`;
    if(type === "shopping") return `new item +${EMISSION_FACTORS.shoppingKgCo2PerItem.toFixed(1)} kg CO2e`;
    if(type === "delivery") return `delivery order +${EMISSION_FACTORS.deliveryKgCo2PerOrder.toFixed(1)} kg CO2e / plastic +${EMISSION_FACTORS.deliveryPlasticKgPerOrder.toFixed(1)} kg`;
    if(type === "streaming") return `digital use 1 hour +${EMISSION_FACTORS.streamingKgCo2PerHour.toFixed(3)} kg CO2e`;
    return "intervention value recalculated";
}

// Converts intervention counts into estimated pollution using the supplied emission factors.
function updateInterventionState() {
    const transportCo2 = config.transport * EMISSION_FACTORS.transportKmPerUse * EMISSION_FACTORS.carKgCo2PerKm;
    const climateCo2 = config.climate * EMISSION_FACTORS.climateKgCo2PerHour;
    const shoppingCo2 = config.shopping * EMISSION_FACTORS.shoppingKgCo2PerItem;
    const deliveryCo2 = config.delivery * EMISSION_FACTORS.deliveryKgCo2PerOrder;
    const streamingCo2 = config.streaming * EMISSION_FACTORS.streamingKgCo2PerHour;
    const plasticWaste = config.delivery * EMISSION_FACTORS.deliveryPlasticKgPerOrder;
    const totalCo2 = transportCo2 + climateCo2 + shoppingCo2 + deliveryCo2 + streamingCo2;
    const indirectPmIndex =
        (config.transport * 2.2) +
        (config.climate * 1.35) +
        (config.delivery * 1.15) +
        (config.shopping * 0.55) +
        (config.streaming * 0.22);
    const temporalIntervention = getYearProgress();
    const accumulatedEnvironmentalLoad = temporalIntervention * 28;

    metrics.transportCo2Kg = transportCo2;
    metrics.climateCo2Kg = climateCo2;
    metrics.shoppingCo2Kg = shoppingCo2;
    metrics.deliveryCo2Kg = deliveryCo2;
    metrics.streamingCo2Kg = streamingCo2;
    metrics.humanCo2Kg = totalCo2;
    metrics.plasticWasteKg = plasticWaste;
    metrics.indirectPmIndex = indirectPmIndex;
    metrics.humanPm25Proxy = indirectPmIndex * 0.42;
    metrics.humanPm10Proxy = indirectPmIndex * 0.86;
    metrics.temporalIntervention = temporalIntervention;

    metrics.stressLevel = clamp((totalCo2 + accumulatedEnvironmentalLoad) / 60, 0, 1);
    metrics.decay = clamp((shoppingCo2 + deliveryCo2 + plasticWaste * 4 + temporalIntervention * 18) / 45, 0, 1);
    metrics.distortion = clamp((climateCo2 + deliveryCo2 + plasticWaste * 3 + temporalIntervention * 12) / 24, 0, 1);
    metrics.monopoly = clamp((transportCo2 + temporalIntervention * 10) / 18, 0, 1);
    metrics.growthPressure = clamp(((totalCo2 + accumulatedEnvironmentalLoad) * 1.25) + (config.streaming * 3), 0, 100);

    metrics.bridgeSpan = baseBridgeShape.bridgeSpan;
    metrics.bridgeSag = baseBridgeShape.bridgeSag;
    metrics.bridgeWidth = baseBridgeShape.bridgeWidth;
    metrics.meshAmplitude = baseBridgeShape.meshAmplitude;
    metrics.deckDensity = baseBridgeShape.deckDensity;
    metrics.anchorSpread = baseBridgeShape.anchorSpread;
    updateColorState();
}

function updateBridgeShapeFromYear(selected, avgShannon, avgOtus, avgTemp, biomeCounts) {
    const sampleFactor = clamp(Math.log10(selected.length + 1) / 3.8, 0.1, 1);
    const diversityFactor = clamp((avgShannon || 3.5) / 8, 0.12, 1);
    const otuFactor = clamp(Math.log10((avgOtus || 80) + 10) / 3.2, 0.18, 1);
    const tempFactor = clamp(((avgTemp || 12) + 5) / 35, 0.1, 1);
    const biomeVariety = clamp((biomeCounts ? biomeCounts.size : 1) / 16, 0.08, 1);

    metrics.bridgeSpan = clamp(0.58 + sampleFactor * 0.28 + shapeNoise(1, 0.04), 0.55, 0.9);
    metrics.bridgeSag = clamp(0.025 + (1 - diversityFactor) * 0.095 + tempFactor * 0.025 + shapeNoise(2, 0.025), 0.02, 0.16);
    metrics.bridgeWidth = clamp(0.13 + diversityFactor * 0.19 + biomeVariety * 0.05, 0.14, 0.38);
    metrics.meshAmplitude = clamp(8 + diversityFactor * 42 + otuFactor * 18 + shapeNoise(3, 8), 10, 72);
    metrics.deckDensity = Math.round(clamp(24 + sampleFactor * 58 + otuFactor * 38, 20, 120));
    metrics.anchorSpread = clamp(32 + sampleFactor * 82 + biomeVariety * 38, 30, 150);
    baseBridgeShape = {
        bridgeSpan: metrics.bridgeSpan,
        bridgeSag: metrics.bridgeSag,
        bridgeWidth: metrics.bridgeWidth,
        meshAmplitude: metrics.meshAmplitude,
        deckDensity: metrics.deckDensity,
        anchorSpread: metrics.anchorSpread
    };
    
    updateInterventionState();
}

function getBridgeGeometry() {
    const spanPx = width * metrics.bridgeSpan;
    const leftX = (width - spanPx) / 2;
    const rightX = leftX + spanPx;
    const startY = parseFloat(cssColor("--bridge-start-y", "0.5"));
    const midY = height * (startY + (metrics.bridgeSag * 0.25));
    const halfWidth = height * metrics.bridgeWidth * 0.5;

    return {
        leftX, rightX, midY,
        topY: midY - halfWidth,
        deckY: midY + halfWidth
    };
}

// --- 4. Data loading and synchronization ---
async function loadEmpRows() {
    if(empRows.length) return;
    try {
        const rows = await d3.tsv("data/emp_qiime_mapping.tsv");
        empRows = rows.map(row => ({
            sampleId: row["#SampleID"] || row.SampleID || "EMP",
            year: getCollectionYear(row.collection_timestamp),
            lat: toNumber(row.latitude_deg),
            lon: toNumber(row.longitude_deg),
            biome: row.env_biome || row.empo_3 || "unknown biome",
            shannon: toNumber(row.adiv_shannon),
            otus: toNumber(row.adiv_observed_otus),
            temp: toNumber(row.temperature_deg_c),
            ph: toNumber(row.ph)
        })).filter(row => Number.isFinite(row.year));
    } catch(error) { console.warn("Failed to load EMP data", error); }
}

async function loadOtuRows() {
    if(otuRows.length) return;
    try {
        const response = await fetch("data/otu_summary.tsv");
        const text = await response.text();
        const lines = text.split("\n").slice(0, 760);
        const rows = d3.tsvParseRows(lines.join("\n"));
        const headers = rows[0];
        const indexFor = name => headers.indexOf(name);

        otuRows = rows.slice(1).map(row => {
            const taxonomy = row[indexFor("taxonomy")] || "";
            return {
                sequence: row[indexFor("sequence")] || "",
                numSamples: toNumber(row[indexFor("num_samples")]) || 0,
                totalObs: toNumber(row[indexFor("total_obs")]) || 0,
                taxonomy,
                phylum: taxonomyRank(taxonomy, "p__"),
                genus: taxonomyRank(taxonomy, "g__")
            };
        }).filter(row => row.sequence && row.totalObs > 0)
          .sort((a, b) => b.totalObs - a.totalObs);

        if(otuRows.length) metrics.otuCount = otuRows.length;
    } catch(error) { console.warn("Failed to load OTU data", error); }
}

function syncEmpMetrics() {
    if(!empRows.length) return;
    const rangeRows = empRows.filter(row => row.year >= START_YEAR && row.year <= config.year);
    const fallbackRows = empRows.filter(row => row.year >= config.year && row.year <= CURRENT_YEAR).slice(0, 900);
    const baseRows = rangeRows.length ? rangeRows : fallbackRows;
    const localRows = baseRows.filter(row => Number.isFinite(row.lat) && Number.isFinite(row.lon))
                               .map(row => ({ row, distance: distanceToCurrent(row) }))
                               .sort((a, b) => a.distance - b.distance)
                               .slice(0, 260)
                               .map(item => item.row);
    const selected = localRows.length ? localRows : baseRows.slice(0, 260);
    if(locationBridgeRefreshPending || !stableBridgeSeedRows.length || rootNodes.length <= 2) {
        stableBridgeSeedRows = selected;
    }

    const avgTemp = mean(selected.map(row => row.temp));
    const avgShannon = mean(selected.map(row => row.shannon));
    const avgOtus = mean(selected.map(row => row.otus));
    const biomeCounts = d3.rollup(selected, g => g.length, row => row.biome);

    updateBridgeShapeFromYear(selected, avgShannon, avgOtus, avgTemp, biomeCounts);

    if(avgTemp !== null) { metrics.airTemp = avgTemp; metrics.soilTemp = avgTemp * 0.85; }
    if(avgShannon !== null) metrics.soilMoisture = clamp(avgShannon / 9, 0.08, 0.76);
    if(avgOtus !== null) {
        const archivePressure = getYearProgress();
        metrics.pm25 = clamp(4 + (8 - (avgShannon || 4)) * 1.1 + archivePressure * 14, 4, 150);
        metrics.pm10 = clamp(8 + (8 - (avgShannon || 4)) * 2.2 + archivePressure * 26, 8, 230);
    }
    updatePollutionMap();
    updateColorState();
}

async function syncSensorCommunity() {
    if(config.year < CURRENT_YEAR) return;
    if(sensorController) sensorController.abort();
    sensorController = new AbortController();
    try {
        const url = `https://data.sensor.community/airrohr/v1/filter/area=${config.lat.toFixed(4)},${config.lon.toFixed(4)},10`;
        const response = await fetch(url, { signal: sensorController.signal });
        if(!response.ok) return;
        const rows = await response.json();
        const dustRows = rows.filter(row => row.sensordatavalues && (row.sensordatavalues.find(i=>i.value_type==="P1") || row.sensordatavalues.find(i=>i.value_type==="P2")));
        if(dustRows.length) {
            const p1 = mean(dustRows.slice(0,5).map(r => parseFloat(r.sensordatavalues.find(i=>i.value_type==="P1")?.value)));
            const p2 = mean(dustRows.slice(0,5).map(r => parseFloat(r.sensordatavalues.find(i=>i.value_type==="P2")?.value)));
            if(p2 !== null) metrics.pm25 = clamp(p2, 0, 150);
            if(p1 !== null) metrics.pm10 = clamp(p1, 0, 230);
        }
    } catch(e) {}
}

async function fetchEnvironmentData() {
    const shouldSeedBridge = rootNodes.length <= 2;

    await loadEmpRows();
    await loadOtuRows();
    if(locationBridgeRefreshPending) {
        updateInterventionState();
        resetCanvasForLocationChange();
        syncEmpMetrics();
        otuCursor = Math.floor(stableRand(`${config.lat.toFixed(3)},${config.lon.toFixed(3)}`, 17) * Math.max(1, otuRows.length));
        seedCumulativeBridge({ baseFrameOnly: true });
        seedInterventionOverlay();
        seedRecoveryRoots();
        locationBridgeRefreshPending = false;
        applyBrightness(false);
    } else if(shouldSeedBridge) {
        syncEmpMetrics();
        seedCumulativeBridge();
        applyBrightness(false);
    } else {
        syncEmpMetrics();
    }

    const isHist = isHistoricalWeatherSelection();
    const historicalDate = historicalWeatherDateFor(config.year);
    const url = isHist
        ? `https://archive-api.open-meteo.com/v1/archive?latitude=${config.lat}&longitude=${config.lon}&start_date=${historicalDate}&end_date=${historicalDate}&hourly=temperature_2m,soil_temperature_0_to_7cm,soil_moisture_0_to_7cm`
        : `https://api.open-meteo.com/v1/forecast?latitude=${config.lat}&longitude=${config.lon}&current=temperature_2m&hourly=soil_temperature_0cm,soil_moisture_0_to_1cm&forecast_days=1`;
    try {
        const res = await fetch(url); const data = await res.json();
        if(isHist && data.hourly) {
            metrics.airTemp = data.hourly.temperature_2m[0] || metrics.airTemp;
            metrics.soilTemp = data.hourly.soil_temperature_0_to_7cm[0] || metrics.soilTemp;
            metrics.soilMoisture = data.hourly.soil_moisture_0_to_7cm[0] || metrics.soilMoisture;
        } else if(data.current) {
            metrics.airTemp = data.current.temperature_2m;
            metrics.soilTemp = data.hourly && data.hourly.soil_temperature_0cm ? data.hourly.soil_temperature_0cm[0] : metrics.soilTemp;
            metrics.soilMoisture = data.hourly && data.hourly.soil_moisture_0_to_1cm ? data.hourly.soil_moisture_0_to_1cm[0] : metrics.soilMoisture;
        }
    } catch(e) {}

    await syncSensorCommunity();
    refreshSupportUndergrowthForSeason();
    updateColorState();
    updateMetricMonitor();
    updateGrowthEngine();
}

// --- 5. D3 bridge canvas and zoom ---
const panel = document.getElementById("right-panel");
let width = panel.clientWidth; let height = panel.clientHeight;
const svg = d3.select("#root-canvas").append("svg").attr("width", width).attr("height", height);
const viewport = svg.append("g").attr("class", "bridge-viewport");
const guideLayer = viewport.append("g").attr("class", "guide-layer");
const supportLayer = viewport.append("g").attr("class", "support-layer");
const linkLayer = viewport.append("g").attr("class", "link-layer");
const nodeLayer = viewport.append("g").attr("class", "node-layer");
const tooltip = d3.select("#custom-tooltip");
let currentZoomTransform = d3.zoomIdentity;

function isCanvasBackgroundEvent(event) {
    return event.target === svg.node();
}

const zoom = d3.zoom()
    .filter(event => {
        if(draggingAnchor || draggingRoot) return false;
        if(event.type === "wheel") return true;
        return isCanvasBackgroundEvent(event);
    })
    .scaleExtent([0.35, 3.5])
    .on("zoom", e => {
        if(draggingAnchor || draggingRoot) return;
        currentZoomTransform = e.transform;
        viewport.attr("transform", currentZoomTransform);
        document.getElementById("txt-zoom").innerText = `${Math.round(currentZoomTransform.k * 100)}%`;
    });
svg.call(zoom);

function setupDragZoomControl() {
    const zoomControl = document.getElementById("txt-zoom");
    if(!zoomControl) return;
    let dragging = false;
    let startX = 0;
    let startScale = 1;

    zoomControl.addEventListener("pointerdown", event => {
        event.preventDefault();
        dragging = true;
        startX = event.clientX;
        startScale = currentZoomTransform.k || 1;
        zoomControl.setPointerCapture(event.pointerId);
        zoomControl.classList.add("dragging");
    });

    zoomControl.addEventListener("pointermove", event => {
        if(!dragging) return;
        event.preventDefault();
        const delta = (event.clientX - startX) * 0.006;
        const nextScale = clamp(startScale + delta, 0.35, 3.5);
        svg.transition().duration(0).call(zoom.scaleTo, nextScale);
    });

    const endDrag = event => {
        if(!dragging) return;
        dragging = false;
        zoomControl.classList.remove("dragging");
        if(event.pointerId !== undefined && zoomControl.hasPointerCapture(event.pointerId)) {
            zoomControl.releasePointerCapture(event.pointerId);
        }
    };

    zoomControl.addEventListener("pointerup", endDrag);
    zoomControl.addEventListener("pointercancel", endDrag);
    zoomControl.addEventListener("lostpointercapture", endDrag);
}

setupDragZoomControl();

function resizeCanvas() {
    width = panel.clientWidth;
    height = panel.clientHeight;
    svg.attr("width", width).attr("height", height);
    renderBridgeGuides();
}

window.addEventListener("resize", resizeCanvas);

// --- 6. Bridge structure guide rendering ---
function renderBridgeGuides() {
    guideLayer.selectAll("*").remove();
    const { leftX, rightX, topY, midY, deckY } = getBridgeGeometry();
    const leftAnchor = rootNodes.find(node => node.layer === "anchorage" && node.side === "left");
    const rightAnchor = rootNodes.find(node => node.layer === "anchorage" && node.side === "right");
    const guideLeftX = leftAnchor ? leftAnchor.x : leftX;
    const guideRightX = rightAnchor ? rightAnchor.x : rightX;
    const guideMidY = mean([leftAnchor ? leftAnchor.y : midY, rightAnchor ? rightAnchor.y : midY]) || midY;
    const sagPx = height * metrics.bridgeSag;
    const growthState = bridgeGrowthState();

    // Guide lines become more visible once human intervention is present.
    const guideOpacity = growthState === "recovery" ? 0.16 : (growthState === "pollution" ? 0.08 : 0.012);

    [topY, midY, deckY].forEach((y) => {
        const offsetY = y - midY;
        guideLayer.append("path")
            .attr("class", "bridge-guide")
            .attr("d", `M${guideLeftX},${guideMidY + offsetY} C${width * 0.34},${guideMidY + offsetY + sagPx} ${width * 0.66},${guideMidY + offsetY + sagPx} ${guideRightX},${guideMidY + offsetY}`)
            .style("stroke-opacity", guideOpacity);
    });

    [
        { x: guideLeftX, y: leftAnchor ? leftAnchor.y : midY, label: "ANCHOR_TREE_LEFT", side: "left" },
        { x: guideRightX, y: rightAnchor ? rightAnchor.y : midY, label: "ANCHOR_TREE_RIGHT", side: "right" }
    ].forEach(anchor => {
        guideLayer.append("circle").attr("class", "anchor-ring").attr("cx", anchor.x).attr("cy", anchor.y).attr("r", 28);
        guideLayer.append("text").attr("class", "anchor-label").attr("x", anchor.x).attr("y", anchor.y + 45).attr("text-anchor", "middle").text(anchor.label);
    });
}

function refreshFormMode() {
    if(typeof refreshRootFormMode === "function") refreshRootFormMode();
}

function getAnchorNode(side) {
    const existing = rootNodes.find(node => node.layer === "anchorage" && node.side === side);
    if(existing) return existing;
    const { leftX, rightX, midY } = getBridgeGeometry();
    const centerX = (leftX + rightX) / 2;
    const anchorSpanScale = 0.65;
    const defaultX = side === "left"
        ? centerX + (leftX - centerX) * anchorSpanScale
        : centerX + (rightX - centerX) * anchorSpanScale;
    const saved = anchorPositions[side];
    const node = {
        id: nextNodeId++, layer: "anchorage", side,
        x: saved ? saved.x : defaultX, y: saved ? saved.y : midY,
        text: side === "left" ? "CORE_ANCHOR_L" : "CORE_ANCHOR_R",
        weight: 4, stage: 1, source: "Anchorage core tree"
    };
    rootNodes.push(node); drawNode(node); return node;
}

function distanceBetween(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

function getDownwardRootParent(side, seedKey = null) {
    const anchor = getAnchorNode(side);
    const candidates = rootNodes
        .filter(node => node.side === side && node.layer !== "anchorage")
        .filter(node => !seedKey || Number.isFinite(node.dataYear))
        .sort((a, b) => (b.y + Math.abs(b.x - anchor.x) * 0.42) - (a.y + Math.abs(a.x - anchor.x) * 0.42));
    const pool = candidates.slice(0, 24);
    if(!pool.length) return anchor;
    const pick = seedKey
        ? Math.floor(stableRand(seedKey, 43) * pool.length)
        : Math.floor(Math.random() * pool.length);
    return pool[pick] || anchor;
}

function getBridgeParent(layerName, x, y) {
    const anchors = rootNodes.filter(node => node.layer === "anchorage");
    if(rootNodes.length <= 2) return anchors[0] || getAnchorNode("left");

    const layerCandidates = rootNodes
        .filter(node => node.layer === layerName || node.layer === "primary")
        .sort((a, b) => distanceBetween(a, { x, y }) - distanceBetween(b, { x, y }));

    return layerCandidates[0] || choose(rootNodes);
}

function getCurrentAnchorFrame() {
    const geometry = getBridgeGeometry();
    const leftAnchor = rootNodes.find(node => node.layer === "anchorage" && node.side === "left");
    const rightAnchor = rootNodes.find(node => node.layer === "anchorage" && node.side === "right");
    const leftX = leftAnchor ? leftAnchor.x : geometry.leftX;
    const rightX = rightAnchor ? rightAnchor.x : geometry.rightX;
    const midY = mean([
        leftAnchor ? leftAnchor.y : geometry.midY,
        rightAnchor ? rightAnchor.y : geometry.midY
    ]) || geometry.midY;

    return { ...geometry, leftX, rightX, midY };
}

function getInterventionParent(seedKey) {
    const candidates = rootNodes.filter(node => !node.intervention);
    if(!candidates.length) return getAnchorNode(stableSide(seedKey));
    return candidates[Math.floor(stableRand(seedKey, 12) * candidates.length)] || candidates[0];
}

function getRecoveryParent(side) {
    const grownTips = rootNodes
        .filter(node => node.recovery && node.recoverySide === side && !node.recoveryOffshoot)
        .sort((a, b) => b.id - a.id);
    if(grownTips.length && Math.random() > 0.28) {
        return grownTips[Math.floor(Math.random() * Math.min(grownTips.length, 4))] || grownTips[0];
    }
    const bridgeCandidates = rootNodes
        .filter(node => !node.intervention && node.layer !== "anchorage" && (node.side === side || !node.side))
        .sort((a, b) => b.id - a.id)
        .slice(0, 24);
    if(bridgeCandidates.length && Math.random() > 0.42) {
        return bridgeCandidates[Math.floor(Math.random() * bridgeCandidates.length)];
    }
    return getAnchorNode(side);
}

function connectStructuralNeighbors(node, isIntervened) {
    const maxLinks = node.intervention ? 2 : (isIntervened ? 3 : 3);
    const radius = node.intervention ? 190 : (isIntervened ? 150 + metrics.meshAmplitude * 0.35 : 168);
    const candidates = rootNodes
        .filter(other => other.id !== node.id && other.layer !== "anchorage")
        .filter(other => isIntervened || other.side === node.side)
        .filter(other => Math.abs(other.x - node.x) < radius && Math.abs(other.y - node.y) < radius)
        .map(other => ({ node: other, distance: distanceBetween(node, other) }))
        .filter(item => item.distance > (node.intervention ? 10 : 22) && item.distance < radius)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxLinks);

    candidates.forEach(item => addBridgeLink(item.node, node, "cross", node.intervention || item.node.intervention, node.activeIntervention || item.node.activeIntervention));
}

function cumulativeLayerFor(row, mode) {
    if(mode === "downward") return "deck";
    const ageRatio = clamp((((row && row.year) || config.year) - START_YEAR) / (CURRENT_YEAR - START_YEAR), 0, 1);
    if(ageRatio < 0.22) return "primary";
    if(ageRatio < 0.72) return "mesh";
    return stableRand((row && row.sampleId) || config.year, 31) > 0.35 ? "deck" : "mesh";
}

function seedCumulativeBridge(options = {}) {
    if(!stableBridgeSeedRows.length) return;
    const growthState = options.baseFrameOnly ? "neutral" : bridgeGrowthState();
    const climateFit = climateGrowthSuitability();
    const climateDensity = clamp(0.22 + climateFit * 1.08, 0.22, 1.18);
    const targetCount = growthState === "neutral"
        ? Math.round(CUMULATIVE_BASE_NODES * 0.38 * climateDensity)
        : Math.round(CUMULATIVE_BASE_NODES * clamp(0.48 + climateFit * 0.62, 0.48, 1.08));
    const eligibleRows = stableBridgeSeedRows.filter(row => row.year <= CURRENT_YEAR);
    const stride = Math.max(1, Math.floor(eligibleRows.length / targetCount));
    const seedRows = eligibleRows
        .filter((_, index) => index % stride === 0)
        .slice(0, targetCount);
    const neutralExtraStride = climateFit > 0.74 ? 2 : climateFit > 0.48 ? 3 : climateFit > 0.28 ? 5 : 0;

    bulkRenderDepth += 1;
    try {
        seedRows.forEach((row, index) => {
            if(growthState === "neutral") {
                createBridgeNode(row, "downward", index);
                if(neutralExtraStride && index % neutralExtraStride === 0) createBridgeNode(row, "downward", index + targetCount);
                return;
            }

            createBridgeNode(row, "bridge");
            if(index % (growthState === "recovery" ? 3 : 5) === 0) createBridgeNode(row, "downward");
        });
        if(!options.baseFrameOnly) {
            seedInterventionOverlay();
            seedRecoveryRoots();
        }
    } finally {
        bulkRenderDepth -= 1;
    }

    ageExistingRoots();
    applyCumulativeYearMorph();
    refreshFormMode();
    updateSystemMonitor();
    metrics.lastIntervention = `Displaying the ${config.year} intervention layer over the ${START_YEAR}-${CURRENT_YEAR} stable bridge frame.`;
}

function seedInterventionOverlay() {
    if(!hasManualIntervention()) return;
    const overlayCount = getInterventionOverlayCount();
    for(let i = 0; i < overlayCount; i++) createBridgeNode(null, "intervention", i);
}

function refreshInterventionStyles() {
    rootNodes.forEach(node => {
        if(node.intervention) node.activeIntervention = !node.resolvedIntervention && isActiveInterventionSlot(node.interventionSlot);
    });

    rootLinks.forEach(link => {
        if(link.intervention) {
            link.activeIntervention = [link.source, link.target]
                .some(node => node && node.intervention && !node.resolvedIntervention && isActiveInterventionSlot(node.interventionSlot));
        }
    });

    supportRoots.forEach(support => {
        if(support.intervention) {
            support.activeIntervention = support.source && support.source.intervention && !support.source.resolvedIntervention && isActiveInterventionSlot(support.source.interventionSlot);
        }
    });

    applyBrightness(false);
    linkLayer.selectAll(".root-link")
        .filter(d => d && d.intervention && d.activeIntervention)
        .raise();
    nodeLayer.selectAll(".root-node")
        .filter(d => d && d.intervention && d.activeIntervention)
        .raise();
    supportLayer.selectAll(".edge-support-root")
        .filter(d => d && d.intervention && d.activeIntervention)
        .raise();
    raiseAnchorNodes();
}

function raiseAnchorNodes() {
    nodeLayer.selectAll(".root-node")
        .filter(d => d && d.layer === "anchorage")
        .raise();
}

function removeNodesFromCanvas(removedNodes) {
    if(!removedNodes || !removedNodes.size) return;
    rootNodes = rootNodes.filter(node => !removedNodes.has(node));
    rootLinks = rootLinks.filter(link => !removedNodes.has(link.source) && !removedNodes.has(link.target));
    supportRoots = supportRoots.filter(support => !removedNodes.has(support.source));
    nodeLayer.selectAll(".root-node").filter(d => removedNodes.has(d)).remove();
    linkLayer.selectAll(".root-link").filter(d => removedNodes.has(d.source) || removedNodes.has(d.target)).remove();
    supportLayer.selectAll(".edge-support-root").filter(d => removedNodes.has(d.source)).remove();
    refreshFormMode();
}

function ensureBasePosition(item) {
    if(!item) return;
    if(!Number.isFinite(item.baseX)) item.baseX = item.x;
    if(!Number.isFinite(item.baseY)) item.baseY = item.y;
}

function yearMorphStrength() {
    return 1 - getYearProgress();
}

function applyCumulativeYearMorph() {
    const morph = yearMorphStrength();
    rootNodes.forEach(node => {
        ensureBasePosition(node);
        if(node.layer === "anchorage") return;
        if(node.intervention || node.recovery || node.seedMode === "support-under") {
            node.x = node.baseX;
            node.y = node.baseY;
            return;
        }
        const seedKey = node.seedKey || node.id;
        const futureWeight = Number.isFinite(node.dataYear) && node.dataYear > config.year ? 1.35 : 0.7;
        const side = node.side === "left" ? -1 : node.side === "right" ? 1 : (stableRand(seedKey, 61) > 0.5 ? 1 : -1);
        const driftX = side * (stableRand(seedKey, 62) * 28 + 8) * morph * futureWeight;
        const driftY = (stableRand(seedKey, 63) - 0.24) * 54 * morph * futureWeight;
        node.x = clamp(node.baseX + driftX, canvasMinX(), canvasMaxX());
        node.y = clamp(node.baseY + driftY, canvasMinY(), canvasMaxY());
    });

    nodeLayer.selectAll(".root-node").style("display", null);
    linkLayer.selectAll(".root-link").style("display", null);
    supportLayer.selectAll(".edge-support-root").style("display", null);
    rerenderNodes();
    rerenderLinks();
    rerenderSupportRoots();
}

function freeActionNodeCapacity(requiredCount = 1) {
    const overflow = rootNodes.length + requiredCount - MAX_NODES;
    if(overflow <= 0) return;
    const removedNodes = new Set(rootNodes
        .filter(node => node.layer !== "anchorage" && !node.activeIntervention)
        .sort((a, b) => {
            const priority = node => {
                if(!node.intervention && !node.recovery) return 0;
                if(node.intervention && node.resolvedIntervention) return 1;
                if(node.recovery && node.recoveryOffshoot) return 2;
                if(node.recovery) return 3;
                return 4;
            };
            return priority(a) - priority(b) || a.id - b.id;
        })
        .slice(0, overflow + 6));
    removeNodesFromCanvas(removedNodes);
}

function syncInterventionOverlay(previousCount, nextCount) {
    if(nextCount > previousCount) {
        freeActionNodeCapacity(nextCount - previousCount);
        for(let i = previousCount; i < nextCount; i++) createBridgeNode(null, "intervention", i);
    } else if(nextCount < previousCount) {
        const removedNodes = new Set(rootNodes.filter(node => node.intervention && node.interventionSlot >= nextCount));
        removeNodesFromCanvas(removedNodes);
    }

    refreshInterventionStyles();
    updateSystemMonitor();
}

function seedRecoveryRoots() {
    const count = Math.min(recoveryActionCount, MAX_RECOVERY_ACTIONS);
    for(let i = 0; i < count; i++) {
        const node = createBridgeNode(null, "recovery", i);
        if(node && (i % 2 === 1 || stableRand(`recovery-seed-offshoot-${i}`, 2) > 0.62)) {
            createRecoveryOffshoot(node, i);
            if(stableRand(`recovery-seed-double-${i}`, 5) > 0.76) createRecoveryOffshoot(node, i + 1000);
        }
    }
}

function ensureRecoveryBridgeBase() {
    const visibleBridgeNodes = rootNodes.filter(node => node.layer !== "anchorage" && !node.intervention && !node.recovery);
    if(visibleBridgeNodes.length >= 16) return;
    getAnchorNode("left");
    getAnchorNode("right");
    const needed = 16 - visibleBridgeNodes.length;
    for(let i = 0; i < needed; i++) {
        const progress = needed <= 1 ? 0 : i / (needed - 1);
        const year = Math.round(START_YEAR + progress * (CURRENT_YEAR - START_YEAR));
        createBridgeNode({
            sampleId: `recovery-base-${year}-${i}`,
            year,
            biome: "protective baseline bridge",
            shannon: 5.5,
            otus: 120,
            temp: metrics.airTemp
        }, "bridge");
        if(i % 4 === 0) {
            createBridgeNode({
                sampleId: `recovery-base-down-${year}-${i}`,
                year,
                biome: "protective downward root",
                shannon: 5.5,
                otus: 120,
                temp: metrics.soilTemp
            }, "downward");
        }
    }
    ageExistingRoots();
    lastBrightnessStateKey = "";
}

function createRecoveryOffshoot(parentNode, seedIndex) {
    if(!parentNode) return;
    if(rootNodes.length >= MAX_NODES) freeActionNodeCapacity(1);
    if(rootNodes.length >= MAX_NODES) return;
    const seedKey = `recovery-offshoot-${seedIndex}-${parentNode.id}`;
    const sideDrift = parentNode.recoverySide === "left" ? 1 : -1;
    const forkDirection = stableRand(seedKey, 9) > 0.42 ? sideDrift : -sideDrift;
    const length = 14 + stableRand(seedKey, 3) * 42;
    const lift = (stableRand(seedKey, 8) - 0.45) * 38;
    const node = {
        id: nextNodeId++,
        layer: "mesh",
        x: clamp(parentNode.x + forkDirection * (12 + stableRand(seedKey, 4) * 56), canvasMinX(), canvasMaxX()),
        y: clamp(parentNode.y + length + lift, canvasMinY(), canvasMaxY()),
        side: parentNode.side,
        text: "[terminal root from recovery action]",
        weight: 1.2,
        stage: 2,
        source: "Protective recovery root: stable branch growing from the root tip",
        intervention: false,
        activeIntervention: false,
        recovery: true,
        recoveryOffshoot: true,
        recoverySide: parentNode.recoverySide
    };
    node.baseX = node.x;
    node.baseY = node.y;

    rootNodes.push(node);
    addBridgeLink(parentNode, node, "recovery-offshoot", false, false, true);
    drawNode(node);
    return node;
}

function growRecoveryBurst(type, amount = RECOVERY_BURST_ROOTS) {
    ageExistingRoots();
    for(let i = 0; i < amount && recoveryActionCount < MAX_RECOVERY_ACTIONS; i++) {
        const newRecoveryIndex = recoveryActionCount;
        recoveryActionCount += 1;
        const node = createBridgeNode(null, "recovery", newRecoveryIndex);
        if(node) {
            createRecoveryOffshoot(node, newRecoveryIndex);
            if(stableRand(`recovery-burst-extra-${newRecoveryIndex}`, 6) > 0.58) {
                createRecoveryOffshoot(node, newRecoveryIndex + 2000);
            }
        }
    }
    metrics.lastIntervention = `Protective action reducing ${counterImpactLabel(type)}: recovery roots expand while deformed blue strands dissolve.`;
}

function removeTemporalRecoveryRoots() {
    const removedNodes = new Set(rootNodes.filter(node => node.timeRecovery));
    removeNodesFromCanvas(removedNodes);
}

function refreshTemporalRecoveryRoots() {
    removeTemporalRecoveryRoots();
    const pastFactor = yearMorphStrength();
    const cleanActionWeight = negativeInterventionCount() * 10 + recoveryActionCount * 1.2;
    const count = Math.round(clamp(cleanActionWeight * pastFactor, 0, 90));
    if(count <= 0) return;

    ensureRecoveryBridgeBase();
    bulkRenderDepth += 1;
    try {
        for(let i = 0; i < count && rootNodes.length < MAX_NODES; i++) {
            const seedIndex = 50000 + i;
            const node = createBridgeNode(null, "recovery", seedIndex);
            if(!node) continue;
            node.timeRecovery = true;
            node.text = "[past clean recovery root]";
            node.source = "Past cleaner baseline: recovery root appears stronger in the selected year";
            if(i % 2 === 0 || stableRand(`time-recovery-offshoot-${i}`, 7) > 0.48) {
                const offshoot = createRecoveryOffshoot(node, seedIndex);
                if(offshoot) offshoot.timeRecovery = true;
            }
        }
    } finally {
        bulkRenderDepth -= 1;
    }
    ageExistingRoots();
}

function dissolveInterventionRoots(amount = RECOVERY_DISSOLVE_NODES) {
    const resolvedNodes = new Set(rootNodes
        .filter(node => node.intervention && !node.resolvedIntervention)
        .sort((a, b) => (b.interventionSlot ?? b.id) - (a.interventionSlot ?? a.id))
        .slice(0, amount));

    if(!resolvedNodes.size) return;

    resolvedNodes.forEach(node => {
        node.resolvedIntervention = true;
        node.activeIntervention = false;
    });

    rootLinks.forEach(link => {
        if(link.intervention && (resolvedNodes.has(link.source) || resolvedNodes.has(link.target))) {
            link.activeIntervention = false;
        }
    });

    supportRoots.forEach(support => {
        if(support.intervention && resolvedNodes.has(support.source)) {
            support.activeIntervention = false;
        }
    });

    nodeLayer.selectAll(".root-node")
        .filter(d => resolvedNodes.has(d))
        .select(".root-dot-node")
        .attr("r", 1.2)
        .style("opacity", 0.18);

    refreshInterventionStyles();
}

function removeHumanActionRoots() {
    const removedNodes = new Set(rootNodes.filter(node => node.intervention || node.recovery));
    if(!removedNodes.size) return;

    rootNodes = rootNodes.filter(node => !removedNodes.has(node));
    rootLinks = rootLinks.filter(link =>
        !link.intervention &&
        !link.recovery &&
        !removedNodes.has(link.source) &&
        !removedNodes.has(link.target)
    );
    supportRoots = supportRoots.filter(support =>
        !support.intervention &&
        !support.recovery &&
        !removedNodes.has(support.source)
    );

    nodeLayer.selectAll(".root-node")
        .filter(d => removedNodes.has(d))
        .remove();
    linkLayer.selectAll(".root-link")
        .filter(d => d && (d.intervention || d.recovery || removedNodes.has(d.source) || removedNodes.has(d.target)))
        .remove();
    supportLayer.selectAll(".edge-support-root")
        .filter(d => d && (d.intervention || d.recovery || removedNodes.has(d.source)))
        .remove();
}

// --- Core growth-rule engine ---
function createBridgeNode(seedRow = null, seedMode = "live", seedIndex = null) {
    if((seedMode === "intervention" || seedMode === "recovery") && rootNodes.length >= MAX_NODES) {
        freeActionNodeCapacity(1);
    }
    if(rootNodes.length >= MAX_NODES) {
        metrics.lastIntervention = "Root field is full; existing growth is preserved instead of being rebuilt.";
        if(!bulkRenderDepth) updateSystemMonitor();
        return null;
    }

    const growthState = bridgeGrowthState();
    const hasHumanIntervention = hasManualIntervention();
    const isCumulativeSeed = !!seedRow;
    const isInterventionSeed = seedMode === "intervention";
    const isRecoverySeed = seedMode === "recovery";
    const buildsBridge = isCumulativeSeed && seedMode === "bridge";
    const isIntervened = hasHumanIntervention || isInterventionSeed || buildsBridge || isRecoverySeed;
    const otu = nextOtu();
    const geometry = getCurrentAnchorFrame();

    let layerName = "mesh";
    let x = 0, y = 0;
    let parentNode = null;
    let textToken = "ROOT";
    let sourceLabel = "baseline aerial atmosphere root";
    const seedKey = seedRow
        ? `${seedRow.sampleId}-${seedRow.year}-${seedMode}-${seedIndex ?? "base"}`
        : (seedMode === "intervention" || seedMode === "recovery" ? `${seedMode}-${seedIndex}` : `live-${nextNodeId}-${seedMode}`);
    const rand = salt => (seedRow || seedMode === "intervention" || seedMode === "recovery") ? stableRand(seedKey, salt) : Math.random();

    // Rule 1: no human intervention -> roots descend as lower aerial roots.
    if(seedMode === "intervention") {
        layerName = "mesh";
        parentNode = getInterventionParent(seedKey);
        const { leftX, rightX, midY } = geometry;
        const slot = Number.isFinite(seedIndex) ? seedIndex : 0;
        const strand = slot % 9;
        const rung = Math.floor(slot / 9);
        const progress = clamp((strand + 0.5) / 9 + (rand(14) - 0.5) * 0.12, 0, 1);
        const upwardBurst = 54 + rung * 14 + rand(15) * 92;
        const violentOffset = Math.sin(slot * 1.71) * (26 + rung * 1.4) + (rand(16) - 0.5) * 132;
        x = leftX + (rightX - leftX) * progress + violentOffset;
        y = Math.max(canvasMinY() + height * 0.16, midY - upwardBurst + Math.cos(slot * 1.19) * 24);
        textToken = `[${config.year}] human intervention pollution layer`;
        sourceLabel = `deformed growth layer: CO2e ${metrics.humanCo2Kg.toFixed(1)} kg / stress ${(metrics.stressLevel * 100).toFixed(0)}%`;
    }
    else if(seedMode === "recovery") {
        const side = seedIndex % 2 === 0 ? "left" : "right";
        const oppositeSide = side === "left" ? "right" : "left";
        const oppositeAnchor = getAnchorNode(oppositeSide);
        parentNode = getRecoveryParent(side);
        const tipCount = rootNodes.filter(node => node.recovery && node.recoverySide === side && !node.recoveryOffshoot).length;
        const step = 0.08 + rand(17) * 0.16;
        const dx = oppositeAnchor.x - parentNode.x;
        const dy = oppositeAnchor.y - parentNode.y;
        const sideDrift = side === "left" ? 1 : -1;
        const wave = Math.sin((tipCount + 1) * 0.92 + rand(20) * 2.2);
        const lateralBloom = sideDrift * wave * (18 + rand(21) * 46);
        const verticalBloom = Math.cos((tipCount + 1) * 0.71 + rand(22) * 1.8) * (8 + rand(23) * 28);

        layerName = rand(24) > 0.68 ? "mesh" : "primary";
        x = parentNode.x + dx * step + lateralBloom;
        y = parentNode.y + dy * step + verticalBloom;
        textToken = rand(25) > 0.52 ? "[protective recovery root]" : "[clean branching root]";
        sourceLabel = "protective action: irregular recovery root reconnecting and branching through the bridge";
    }
    else if (!isIntervened || seedMode === "downward") {
        const side = seedRow ? stableSide(seedKey) : (Math.random() > 0.5 ? "left" : "right");
        parentNode = getDownwardRootParent(side, seedRow ? seedKey : null);
        
        // Environmental data roots extend downward from existing tips.
        const sideDrift = side === "left" ? -1 : 1;
        const rootDepth = rootNodes.filter(node => node.side === side).length;
        x = parentNode.x + (rand(1) - 0.5) * 130 + Math.sin(rootDepth * 0.68) * 40 + sideDrift * rand(2) * 26;
        y = parentNode.y + 14 + rand(3) * 24 + Math.min(rootDepth * 0.045, 20);
        layerName = cumulativeLayerFor(seedRow, "downward");
        
        // Hide Latin taxonomy names and map live values into compact metaphors.
        textToken = seedRow ? `[${seedRow.year}] ${seedRow.biome}` : choose([`[air-quality-index:${metrics.pm25.toFixed(0)}]`, `[live-temp:${metrics.airTemp.toFixed(1)}°C]`, `[stable_eco_index]`]);
        sourceLabel = seedRow ? `cumulative environmental data downward root: ${seedRow.year} / ${seedRow.biome}` : "native lower aerial root, no human intervention";
    } 
    // Rule 2: once intervention exists, the airborne bridge system is activated.
    else {
        layerName = growthState === "recovery"
            ? (isCumulativeSeed ? cumulativeLayerFor(seedRow, "bridge") : choose(["primary", "mesh", "deck"]))
            : choose(["primary", "primary", "mesh"]);
        
        const progress = isCumulativeSeed
            ? clamp(((seedRow.year || START_YEAR) - START_YEAR) / Math.max(1, CURRENT_YEAR - START_YEAR), 0, 1)
            : (rootNodes.length % 300) / 300;
        const left = geometry.leftX + 30;
        const right = geometry.rightX - 30;
        const archLift = Math.sin(progress * Math.PI);
        
        x = left + (right - left) * progress + (rand(4) - 0.5) * (isCumulativeSeed ? 70 : 40);
        if(growthState === "neutral") {
            y = geometry.midY
                - archLift * (height * 0.018 + metrics.meshAmplitude * 0.22)
                + (rand(5) - 0.5) * (height * metrics.bridgeWidth * 0.16);
        } else if(growthState === "pollution") {
            y = geometry.midY
                - archLift * (height * 0.22 + metrics.meshAmplitude * 0.9)
                + (rand(5) - 0.5) * (height * metrics.bridgeWidth * 0.46)
                - metrics.stressLevel * 18;
        } else {
            y = geometry.midY
                - archLift * (height * 0.045)
                + (rand(5) - 0.5) * (height * metrics.bridgeWidth * 0.24);
        }
        parentNode = getBridgeParent(layerName, x, y);

        if (seedRow) {
            textToken = `[${seedRow.year}] ${seedRow.biome}`;
            sourceLabel = `cumulative EMP frame: ${seedRow.sampleId} / ${seedRow.biome}`;
        } else if (otu) {
            // Replace Latin names with metaphorical ecological text.
            textToken = getMetaphor(otu.taxonomy, otu.genus || "behavior bacteria");
            sourceLabel = `intervention-induced ecosystem: ${otu.phylum || "atmospheric load"}`;
        } else {
            textToken = "[stress-induced connective tissue]";
        }
    }

    const node = {
        id: nextNodeId++, layer: layerName, x: clamp(x, canvasMinX(), canvasMaxX()), y: clamp(y, canvasMinY(), canvasMaxY()),
        side: parentNode ? parentNode.side : null,
        text: textToken, weight: 1 + metrics.stressLevel * 4, stage: (isIntervened && growthState !== "neutral" ? 3 : 1), source: sourceLabel,
        intervention: isInterventionSeed,
        interventionSlot: isInterventionSeed ? seedIndex : null,
        activeIntervention: isInterventionSeed ? isActiveInterventionSlot(seedIndex) : false,
        recovery: isRecoverySeed,
        recoverySide: isRecoverySeed ? (seedIndex % 2 === 0 ? "left" : "right") : null,
        dataYear: seedRow ? seedRow.year : null,
        seedMode,
        seedKey
    };
    node.baseX = node.x;
    node.baseY = node.y;

    if(!bulkRenderDepth) ageExistingRoots();
    rootNodes.push(node);
    if(parentNode) {
        const linkKind = seedMode === "recovery" ? "recovery" : (seedMode === "downward" || seedMode === "intervention" ? "cross" : (isIntervened ? "primary" : "cross"));
        addBridgeLink(parentNode, node, linkKind, node.intervention, node.activeIntervention, node.recovery);
    }
    if(!node.recovery) connectStructuralNeighbors(node, isIntervened);
    drawNode(node);
    if(shouldGrowSupportRoot(node, seedMode, seedRow, seedIndex)) addSupportRoot(node, seedMode, seedIndex);
    if(!bulkRenderDepth) {
        refreshFormMode();
        updateSystemMonitor();
    }
    return node;
}

function addBridgeLink(source, target, kind, intervention = false, activeIntervention = false, recovery = false) {
    const link = { source, target, kind, intervention, activeIntervention, recovery };
    rootLinks.push(link);
    drawLink(link);
}

function linkPath(link) {
    const { source, target, kind, intervention, recovery } = link;
    const dx = target.x - source.x;
    const interventionSign = stableRand(`${source.id}-${target.id}`, 42) > 0.5 ? 1 : -1;
    const recoveryBend = interventionSign * (4 + stableRand(`${source.id}-${target.id}`, 44) * 8);
    const bend = recovery ? recoveryBend : (intervention ? interventionSign * (35 + stableRand(`${source.id}-${target.id}`, 43) * 96) : (kind === "cross" ? 7 : 18 * metrics.stressLevel));
    return `M${source.x},${source.y} C${source.x + dx*0.34},${source.y + bend} ${source.x + dx*0.68},${target.y - bend} ${target.x},${target.y}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function tooltipRows(rows) {
    return rows
        .filter(row => row && row.value !== null && row.value !== undefined && row.value !== "")
        .map(row => `<div><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</div>`)
        .join("");
}

function percent(value) {
    return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function monthName(value) {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[clamp(Math.round(value || 1), 1, 12) - 1];
}

function co2MetricLabel() {
    return metrics.humanCo2Kg < 0 ? "CO2e Reduction" : "CO2e Added";
}

function co2MetricValue() {
    const amount = Math.abs(metrics.humanCo2Kg).toFixed(1);
    return metrics.humanCo2Kg < 0 ? `${amount} kg avoided` : `${amount} kg`;
}

function dataKeywordForNode(node) {
    if(!node) return "Data";
    if(node.layer === "anchorage") return "Anchor / Structural Support";
    if(node.intervention) return node.activeIntervention ? "Intervention Pollution Layer" : "Past Pollution Trace";
    if(node.recovery) return "Recovery Root";
    if(node.seedMode === "support-under") return "Seasonal EMP Sample";
    if(node.seedMode === "downward") return "EMP Microbial Sample";
    if(node.seedMode === "bridge") return "Cumulative EMP Sample";
    if(node.seedMode === "live") {
        return String(node.source || "").includes("intervention-induced")
            ? "OTU / Microbial Community"
            : "Local Environmental Value";
    }
    return "Environmental Data";
}

function readableNodeLabel(node) {
    if(!node) return "";
    if(node.layer === "anchorage") return node.side === "left" ? "Left support" : "Right support";
    return String(node.text || "")
        .replace(/^\[|\]$/g, "")
        .replace(/^protective recovery root$/, "clean action")
        .replace(/^clean branching root$/, "clean branch")
        .replace(/^stress-induced connective tissue$/, "microbial link");
}

function nodeTooltipHtml(node) {
    const keyword = dataKeywordForNode(node);
    const rows = [
        { label: "Data Type", value: keyword },
        { label: "Sample", value: readableNodeLabel(node) },
        { label: "Location", value: config.locName },
        { label: "Year / Month", value: `${node.dataYear || config.year} / ${monthName(config.month)}` }
    ];

    if(node.layer === "anchorage") {
        rows.push(
            { label: "Role", value: "Fixed point holding the bridge shape" },
            { label: "Support Spread", value: `${Math.round(metrics.anchorSpread)}px` }
        );
    } else if(node.intervention) {
        rows.push(
            { label: co2MetricLabel(), value: co2MetricValue() },
            { label: "Pollution Pressure", value: percent(metrics.stressLevel) }
        );
    } else if(node.recovery) {
        rows.push(
            { label: "Positive Action", value: `${recoveryActionCount} roots` },
            { label: "Pollution Pressure", value: percent(metrics.stressLevel) }
        );
    } else {
        rows.push(
            { label: "Temperature", value: `${metrics.airTemp.toFixed(1)}°C` },
            { label: "Fine Dust", value: `${metrics.pm25.toFixed(1)} µg/m³` },
            { label: "Coarse Dust", value: `${metrics.pm10.toFixed(1)} µg/m³` },
            { label: "Climate Growth", value: percent(climateGrowthSuitability()) }
        );
        if(node.seedMode === "support-under") {
            rows.push({ label: "Seasonal Activity", value: percent(microbialSeasonActivity()) });
        }
    }

    return tooltipRows(rows);
}

function lineTooltipTitle(item) {
    if(item.supportUnder) return "Seasonal EMP Sample";
    if(item.seasonalBaseSupport) return "Below-Support Growth";
    if(item.recovery) return "Recovery Root";
    if(item.intervention) return item.activeIntervention ? "Intervention Pollution Layer" : "Past Pollution Trace";
    if(item.kind === "cross") return "OTU / Microbial Link";
    return "Structural Link";
}

function lineTooltipRows(item) {
    const isSupportRoot = item && !item.kind && item.source && item.target;
    if(item.supportUnder || item.seasonalBaseSupport) {
        return [
            { label: "Data Type", value: lineTooltipTitle(item) },
            { label: "Seasonal Activity", value: percent(microbialSeasonActivity()) },
            { label: "Month", value: monthName(config.month) }
        ];
    }
    if(item.recovery) {
        return [
            { label: "Data Type", value: "Recovery Root" },
            { label: "Positive Action", value: `${recoveryActionCount} roots` },
            { label: "State", value: "Reconnecting while reducing pollution traces" }
        ];
    }
    if(item.intervention) {
        return [
            { label: "Data Type", value: item.activeIntervention ? "Intervention Pollution Layer" : "Past Pollution Trace" },
            { label: co2MetricLabel(), value: co2MetricValue() },
            { label: "Pollution Pressure", value: percent(metrics.stressLevel) }
        ];
    }
    if(isSupportRoot) {
        return [
            { label: "Data Type", value: "Anchor / Structural Support" },
            { label: "Role", value: "Support line holding the bridge shape" },
            { label: "Climate Growth", value: percent(climateGrowthSuitability()) }
        ];
    }
    return [
        { label: "Data Type", value: item.kind === "cross" ? "OTU / Microbial Link" : "Cumulative EMP Link" },
        { label: "Temperature", value: `${metrics.airTemp.toFixed(1)}°C` },
        { label: "Fine Dust", value: `${metrics.pm25.toFixed(1)} µg/m³` },
        { label: "Coarse Dust", value: `${metrics.pm10.toFixed(1)} µg/m³` },
        { label: "Climate Growth", value: percent(climateGrowthSuitability()) }
    ];
}

function attachLineTooltip(pathSelection) {
    pathSelection
        .on("mouseover", function(event, d) {
            tooltip.style("display", "block")
                .html(tooltipRows(lineTooltipRows(d)));
        })
        .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 14}px`).style("top", `${event.pageY - 36}px`);
        })
        .on("mouseleave", function() {
            tooltip.style("display", "none");
        });
}

function drawLink(link) {
    const path = linkLayer.append("path").datum(link).attr("class", `root-link root-fresh ${link.kind}-link`).attr("d", linkPath(link))
        .attr("stroke", link.intervention ? getInterventionColor(link) : (link.recovery ? getRecoveryColor(link) : getRootStrokeColor()))
        .attr("stroke-width", link.recovery ? (link.kind === "recovery-offshoot" ? 0.9 : 1.45) : (link.intervention ? (link.activeIntervention ? 1.25 : 0.85) : (link.kind === "cross" ? 0.68 : 1.28 + metrics.stressLevel * 0.7)))
        .style("stroke-opacity", link.recovery ? 0.86 : (link.intervention ? interventionOpacity("line", link.activeIntervention) : (link.kind === "cross" ? 0.34 : 0.64)));

    attachLineTooltip(path);
    if(link.intervention && link.activeIntervention) path.raise();
    else path.lower();
}

function supportTargetFor(node, seedKey, mode) {
    const edgePick = stableRand(seedKey, 71);
    const isIntervention = mode === "intervention";
    const isRecovery = mode === "recovery";
    const preferBottom = mode === "live" || mode === "downward";
    const margin = 60 + stableRand(seedKey, 72) * 180;

    if(preferBottom && edgePick < 0.64) {
        return {
            x: clamp(node.x + (stableRand(seedKey, 73) - 0.5) * width * 0.42, -margin, width + margin),
            y: height + margin
        };
    }

    if(isIntervention && edgePick < 0.5) {
        return {
            x: stableRand(seedKey, 74) > 0.5 ? width + margin : -margin,
            y: clamp(node.y + (stableRand(seedKey, 75) - 0.5) * height * 0.86, -margin, height + margin)
        };
    }

    if(isRecovery) {
        return {
            x: node.recoverySide === "left" ? -margin : width + margin,
            y: clamp(node.y + (stableRand(seedKey, 76) - 0.5) * height * 0.32, 0, height)
        };
    }

    if(edgePick < 0.5) {
        return { x: -margin, y: clamp(node.y + (stableRand(seedKey, 77) - 0.5) * height * 0.5, -margin, height + margin) };
    }

    return { x: width + margin, y: clamp(node.y + (stableRand(seedKey, 78) - 0.5) * height * 0.5, -margin, height + margin) };
}

function supportPath(support) {
    const { source, target, seedKey, intervention, recovery } = support;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const side = stableRand(seedKey, 81) > 0.5 ? 1 : -1;
    const curl = (intervention ? 125 : recovery ? 44 : 72) * side;
    const lift = intervention ? -90 + stableRand(seedKey, 82) * 190 : 42 + stableRand(seedKey, 83) * 120;

    const c1x = source.x + dx * 0.22 + curl * 0.35;
    const c1y = source.y + dy * 0.18 + lift * 0.25;
    const c2x = source.x + dx * 0.72 - curl;
    const c2y = source.y + dy * 0.78 + lift;
    return `M${source.x},${source.y} C${c1x},${c1y} ${c2x},${c2y} ${target.x},${target.y}`;
}

function shouldGrowSupportRoot(node, seedMode, seedRow, seedIndex = null) {
    if(!node) return false;
    if(seedRow) return false;
    if(!(seedMode === "live" || seedMode === "downward" || seedMode === "intervention" || seedMode === "recovery")) return false;

    const supportKey = `support-ratio-${node.id}-${seedMode}-${seedIndex ?? "live"}`;
    return stableRand(supportKey, 91) < 0.35;
}

function addSupportRoot(node, seedMode, seedIndex = null) {
    const seedKey = `support-${node.id}-${seedMode}-${seedIndex ?? nextNodeId}`;
    const support = {
        source: node,
        target: supportTargetFor(node, seedKey, seedMode),
        seedKey,
        intervention: node.intervention,
        activeIntervention: node.activeIntervention,
        recovery: node.recovery
    };
    supportRoots.push(support);
    drawSupportRoot(support);
    growSupportUnderground(support, seedMode);
}

function drawSupportRoot(support) {
    const path = supportLayer.append("path")
        .datum(support)
        .attr("class", "edge-support-root root-fresh")
        .attr("d", supportPath)
        .attr("stroke", support.intervention ? getInterventionColor(support) : (support.recovery ? getRecoveryColor(support) : getRootStrokeColor()))
        .attr("stroke-width", support.intervention ? 0.82 : (support.recovery ? 0.72 : 0.58))
        .style("stroke-opacity", support.intervention ? interventionOpacity("support", support.activeIntervention) : (support.recovery ? 0.42 : 0.26));

    attachLineTooltip(path);
    if(support.intervention && support.activeIntervention) path.raise();
    else path.lower();
}

function supportUnderDataRow(seedKey, index) {
    if(!stableBridgeSeedRows.length) return null;
    const locationKey = `${config.lat.toFixed(3)},${config.lon.toFixed(3)},${config.year},${config.month}`;
    const pick = Math.floor(stableRand(`${locationKey}-${seedKey}-${index}`, 29) * stableBridgeSeedRows.length);
    return stableBridgeSeedRows[pick] || null;
}

function removeSupportUndergrowth() {
    const removedNodes = new Set(rootNodes.filter(node => node.seedMode === "support-under"));
    removeNodesFromCanvas(removedNodes);
    supportRoots = supportRoots.filter(support => !support.supportUnder && !support.seasonalBaseSupport);
    supportLayer.selectAll(".edge-support-root")
        .filter(d => d && (d.supportUnder || d.seasonalBaseSupport))
        .remove();
}

function seasonalSupportTargetFor(node, seedKey) {
    const margin = 100 + stableRand(seedKey, 72) * 120;
    return {
        x: clamp(node.x + (stableRand(seedKey, 73) - 0.5) * width * 0.3, -margin, width + margin),
        y: height + margin
    };
}

function seasonalSupportSourceNodes(activity) {
    const targetCount = activity < 0.22 ? 0 : activity < 0.45 ? 4 : activity < 0.68 ? 7 : activity < 0.86 ? 10 : 12;
    if(!targetCount) return [];
    return ["left", "right"].flatMap(side => {
        const anchor = rootNodes.find(node => node.layer === "anchorage" && node.side === side);
        if(!anchor) return [];
        return rootNodes
            .filter(node =>
                node.layer !== "anchorage" &&
                !node.intervention &&
                !node.recovery &&
                node.side === side &&
                node.y > anchor.y + 18
            )
            .sort((a, b) => b.y - a.y)
            .slice(0, Math.ceil(targetCount / 2));
    }).slice(0, targetCount);
}

function seedSeasonalBaseSupports(activity) {
    seasonalSupportSourceNodes(activity).forEach((node, index) => {
        const seedKey = `seasonal-support-${config.lat.toFixed(3)}-${config.lon.toFixed(3)}-${config.month}-${node.id}-${index}`;
        const support = {
            source: node,
            target: seasonalSupportTargetFor(node, seedKey),
            seedKey,
            intervention: false,
            activeIntervention: false,
            recovery: false,
            seasonalBaseSupport: true
        };
        supportRoots.push(support);
        drawSupportRoot(support);
    });
}

function refreshSupportUndergrowthForSeason() {
    removeSupportUndergrowth();
    const activity = microbialSeasonActivity();
    seedSeasonalBaseSupports(activity);
    const baseSupports = supportRoots.filter(support =>
        support &&
        !support.supportUnder &&
        !support.intervention &&
        !support.recovery &&
        support.source &&
        rootNodes.includes(support.source)
    );
    baseSupports.forEach(support => growSupportUnderground(support, support.source.seedMode || "live"));
    applyBrightness(false);
    updateSystemMonitor();
}

function growSupportUnderground(support, seedMode) {
    if(!support || !support.source || support.intervention || support.recovery || support.supportUnder) return;
    if(!(seedMode === "live" || seedMode === "downward")) return;
    const sideAnchor = support.source.side ? rootNodes.find(node => node.layer === "anchorage" && node.side === support.source.side) : null;
    if(!sideAnchor) return;
    if(!support.seasonalBaseSupport && support.source.y < sideAnchor.y + 64) return;
    if(support.target.y <= support.source.y) return;
    const seasonalCount = seasonalSupportUndergrowthCount();
    if(seasonalCount <= 0) return;
    const seasonalLimit = Math.round(MAX_SUPPORT_UNDERGROWTH_NODES * microbialSeasonActivity());
    if(rootNodes.filter(node => node.seedMode === "support-under").length >= seasonalLimit) return;
    if(rootNodes.length >= MAX_NODES - seasonalCount) freeActionNodeCapacity(seasonalCount);
    if(!rootNodes.includes(support.source)) return;
    if(rootNodes.length >= MAX_NODES - 1) return;

    let parentNode = support.source;
    const baseX = support.target.x;
    const baseY = Math.max(support.source.y + 72, support.target.y - 80);
    for(let i = 0; i < seasonalCount && rootNodes.length < MAX_NODES; i++) {
        const seedRow = supportUnderDataRow(support.seedKey, i);
        const seedKey = `${support.seedKey}-under-${config.lat.toFixed(3)}-${config.lon.toFixed(3)}-${seedRow ? seedRow.sampleId : "local"}-${i}`;
        const wave = (stableRand(seedKey, 4) - 0.5) * (34 + i * 16);
        const node = {
            id: nextNodeId++,
            layer: "deck",
            x: clamp(baseX + wave, canvasMinX(), canvasMaxX()),
            y: clamp(baseY + i * 54 + stableRand(seedKey, 3) * 38, canvasMinY(), canvasMaxY()),
            side: support.source.side,
            text: seedRow ? `[${seedRow.year}] ${seedRow.biome}` : (i === 0 ? "[support-below data root]" : "[deep support data root]"),
            weight: 1 + metrics.stressLevel * 2.2,
            stage: 1,
            source: seedRow ? `below-support EMP sample: ${seedRow.sampleId} / ${seedRow.biome}` : "Environmental data continuing below the support root",
            dataYear: seedRow ? seedRow.year : null,
            seedMode: "support-under",
            seedKey
        };
        node.baseX = node.x;
        node.baseY = node.y;

        rootNodes.push(node);
        addBridgeLink(parentNode, node, "cross");
        drawNode(node);
        parentNode = node;
    }

    const extensionKey = `${support.seedKey}-under-extension-${config.lat.toFixed(3)}-${config.lon.toFixed(3)}`;
    const extension = {
        source: parentNode,
        target: {
            x: clamp(parentNode.x + (stableRand(extensionKey, 5) - 0.5) * width * 0.3, canvasMinX(), canvasMaxX()),
            y: clamp(parentNode.y + 120 + stableRand(extensionKey, 6) * 260, canvasMinY(), canvasMaxY())
        },
        seedKey: extensionKey,
        intervention: false,
        activeIntervention: false,
        recovery: false,
        supportUnder: true
    };
    supportRoots.push(extension);
    drawSupportRoot(extension);
}

function rerenderSupportRoots() {
    supportLayer.selectAll(".edge-support-root").attr("d", supportPath);
}

function rerenderLinks() {
    linkLayer.selectAll(".root-link").attr("d", linkPath);
}

function rerenderNodes() {
    nodeLayer.selectAll(".root-node")
        .attr("transform", d => `translate(${d.x}, ${d.y})`);
    refreshFormMode();
}

function pullRootsWithAnchor(anchorNode, dx, dy) {
    const oppositeSide = anchorNode.side === "left" ? "right" : "left";
    const oppositeAnchor = rootNodes.find(node => node.layer === "anchorage" && node.side === oppositeSide);
    const span = oppositeAnchor ? Math.max(1, distanceBetween(anchorNode, oppositeAnchor)) : Math.max(width * 0.5, 1);

    rootNodes.forEach(node => {
        if(node.id === anchorNode.id || node.layer === "anchorage") return;

        const belongsToAnchor = node.side === anchorNode.side || node.recoverySide === anchorNode.side;
        const anchorDistance = distanceBetween(node, anchorNode);
        const distanceInfluence = clamp(1 - anchorDistance / span, 0.08, 0.82);
        const structuralInfluence = belongsToAnchor ? distanceInfluence : distanceInfluence * 0.18;
        const recoveryBoost = node.recovery ? 1.12 : 1;
        const influence = clamp(structuralInfluence * recoveryBoost, 0.04, 0.9);

        node.x = clamp(node.x + dx * influence, canvasMinX(), canvasMaxX());
        node.y = clamp(node.y + dy * influence, canvasMinY(), canvasMaxY());
    });
}

function drawNode(node) {
    const group = nodeLayer.append("g").datum(node).attr("class", `root-node root-fresh ${node.layer}-node`).attr("transform", `translate(${node.x}, ${node.y})`);
    const radius = node.recovery ? (node.recoveryOffshoot ? 2.0 : 3.2) : (node.intervention ? 4.1 : (node.layer === "anchorage" ? 5.5 : node.layer === "primary" ? 3.6 : node.layer === "mesh" ? 2.6 : 2.1));
    
    const dot = group.append("circle").attr("class", "root-dot-node root-fresh")
        .attr("r", radius)
        .style("fill", getNodeRootColor(node))
        .style("stroke", getNodeRootColor(node))
        .style("stroke-width", node.layer === "anchorage" ? 1.4 : 0.6)
        .style("opacity", getNodeOpacity(node))
        .on("mouseover", function(e, d) {
            d3.select(this)
                .interrupt()
                .transition()
                .duration(130)
                .attr("r", d.layer === "anchorage" ? radius * 1.18 : radius)
                .style("opacity", 1)
                .style("stroke-width", d.layer === "anchorage" ? 2.1 : 1.15);
            tooltip.style("display", "block").html(nodeTooltipHtml(d));
        })
        .on("mousemove", function(e) { tooltip.style("left", `${e.pageX - 180}px`).style("top", `${e.pageY - 70}px`); })
        .on("mouseleave", function(e, d) {
            const parent = d3.select(this.parentNode);
            if(!parent.classed("anchor-dragging")) {
                d3.select(this)
                    .transition()
                    .duration(160)
                    .attr("r", radius)
                    .style("opacity", getNodeOpacity(d))
                    .style("stroke-width", d.layer === "anchorage" ? 1.4 : 0.6);
            }
            tooltip.style("display", "none");
        });

    if(node.layer === "anchorage") {
        group.style("cursor", "move")
            .on("pointerdown.block-zoom mousedown.block-zoom touchstart.block-zoom", function(event) {
                event.stopPropagation();
            })
            .call(d3.drag()
                .on("start", function(event) {
                    if(event.sourceEvent) event.sourceEvent.stopPropagation();
                    draggingAnchor = true;
                    d3.select(this)
                        .classed("anchor-dragging", true)
                        .raise()
                        .select(".root-dot-node")
                        .interrupt()
                        .style("opacity", 1)
                        .style("stroke-width", 2.1);
                })
                .on("drag", function(event, d) {
                    if(event.sourceEvent) event.sourceEvent.stopPropagation();
                    const nextX = clamp(event.x, 20, width - 20);
                    const nextY = clamp(event.y, 20, height - 20);
                    const dx = nextX - d.x;
                    const dy = nextY - d.y;
                    d.x = nextX;
                    d.y = nextY;
                    anchorPositions[d.side] = { x: d.x, y: d.y };
                    pullRootsWithAnchor(d, dx, dy);
                    rerenderNodes();
                    rerenderLinks();
                    rerenderSupportRoots();
                    renderBridgeGuides();
                    raiseAnchorNodes();
                    refreshFormMode();
                })
                .on("end", function(event, d) {
                    if(event.sourceEvent) event.sourceEvent.stopPropagation();
                    draggingAnchor = false;
                    d3.select(this)
                        .classed("anchor-dragging", false)
                        .select(".root-dot-node")
                        .transition()
                        .duration(180)
                        .attr("r", radius)
                        .style("opacity", getNodeOpacity(d))
                        .style("stroke-width", 1.4);
                    svg.call(zoom.transform, currentZoomTransform);
                    raiseAnchorNodes();
                }));
        group.raise();
    } else {
        group.style("cursor", "default");
    }
    raiseAnchorNodes();
}

function ageExistingRoots() {
    svg.selectAll(".root-fresh")
        .classed("root-fresh", false)
        .classed("root-aged", true);

    svg.selectAll(".root-dot-node.root-aged")
        .style("fill", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, true) : getAgedRootColor()); })
        .style("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, true) : getAgedRootColor()); })
        .style("opacity", function(d) { return d && d.recovery ? 0.62 : (d && d.intervention ? interventionOpacity("aged-node", d.activeIntervention) : getAgedRootOpacity()); });

    svg.selectAll(".root-link.root-aged")
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, true) : getAgedRootColor()); })
        .attr("stroke-width", function(d) {
            if(d && d.intervention) return d.activeIntervention ? 1.25 : 0.85;
            if(d && d.recovery) return d.kind === "recovery-offshoot" ? 0.9 : 1.45;
            return d && d.kind === "cross" ? 0.68 : 1.28 + metrics.stressLevel * 0.7;
        })
        .style("stroke-opacity", function(d) { return d && d.recovery ? 0.5 : (d && d.intervention ? interventionOpacity("aged-line", d.activeIntervention) : getAgedRootOpacity() * 0.68); });

    svg.selectAll(".edge-support-root.root-aged")
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, true) : getAgedRootColor()); })
        .style("stroke-opacity", function(d) { return d && d.intervention ? interventionOpacity("aged-support", d.activeIntervention) : (d && d.recovery ? 0.34 : 0.22); });
}

// --- 7. Environmental control feedback interactions ---
function getBrightnessRatio() { return config.brightness / 100; }
function getRootTextOpacity() { return getBrightnessRatio() * 0.8 + 0.2; }
function getRootStrokeColor() {
    return config.brightness < 40
        ? cssColor("--root-fresh-dark-color", "#9aa1a3")
        : cssColor("--root-fresh-color", "#5f6668");
}
function getAgedRootColor() {
    return config.brightness < 40
        ? cssColor("--root-aged-dark-color", "#6f777a")
        : cssColor("--root-aged-color", "#92999c");
}
function getAgedRootOpacity() { return config.brightness < 40 ? 0.34 : 0.52; }

function getNodeRootColor(node, aged = false) {
    if(node && node.layer === "anchorage") return cssColor("--anchor-root-color", getRootStrokeColor());
    if(node && node.intervention) return getInterventionColor(node);
    if(node && node.recovery) return getRecoveryColor(node, aged);
    return aged ? getAgedRootColor() : getRootStrokeColor();
}

function getNodeOpacity(node) {
    if(node && node.recovery) return 0.82;
    if(node && node.intervention) return interventionOpacity("node", node.activeIntervention);
    return getRootTextOpacity();
}

function applyBrightness(restart = true) {
    const isDark = config.brightness < 40;
    const brightnessStateKey = `${config.brightness}:${lastColorStateKey}:${metrics.stressLevel.toFixed(3)}`;
    if(!restart && brightnessStateKey === lastBrightnessStateKey) return;
    lastBrightnessStateKey = brightnessStateKey;
    document.getElementById("right-panel").style.backgroundColor = "";
    svg.selectAll(".root-dot-node")
        .style("fill", function(d) { return getNodeRootColor(d, d3.select(this).classed("root-aged")); })
        .style("stroke", function(d) { return getNodeRootColor(d, d3.select(this).classed("root-aged")); })
        .style("opacity", function(d) { return d && d.recovery ? (d3.select(this).classed("root-aged") ? 0.62 : 0.82) : (d && d.intervention ? interventionOpacity(d3.select(this).classed("root-aged") ? "aged-node" : "node", d.activeIntervention) : (d3.select(this).classed("root-aged") ? getAgedRootOpacity() : getRootTextOpacity())); });
    svg.selectAll(".root-link")
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, d3.select(this).classed("root-aged")) : (d3.select(this).classed("root-aged") ? getAgedRootColor() : getRootStrokeColor())); })
        .attr("stroke-width", function(d) {
            if(d && d.intervention) return d.activeIntervention ? 1.25 : 0.85;
            if(d && d.recovery) return d.kind === "recovery-offshoot" ? 0.9 : 1.45;
            return d && d.kind === "cross" ? 0.68 : 1.28 + metrics.stressLevel * 0.7;
        })
        .style("stroke-opacity", function(d) {
            if(d && d.recovery) return d3.select(this).classed("root-aged") ? 0.5 : 0.74;
            if(d && d.intervention) return interventionOpacity(d3.select(this).classed("root-aged") ? "aged-line" : "line", d.activeIntervention);
            if(d3.select(this).classed("root-aged")) return getAgedRootOpacity() * 0.68;
            return d && d.kind === "cross" ? 0.22 : 0.52 + metrics.stressLevel * 0.4;
        });
    svg.selectAll(".edge-support-root")
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, d3.select(this).classed("root-aged")) : (d3.select(this).classed("root-aged") ? getAgedRootColor() : getRootStrokeColor())); })
        .style("stroke-opacity", function(d) {
            if(d && d.intervention) return interventionOpacity(d3.select(this).classed("root-aged") ? "aged-support" : "support", d.activeIntervention);
            if(d && d.recovery) return 0.38;
            return d3.select(this).classed("root-aged") ? 0.2 : 0.28;
        });
    if(restart) updateGrowthEngine();
}

function updateGrowthEngine() {
    if(growInterval) clearInterval(growInterval); growInterval = null;
    if(config.paused) return;
    if(rootNodes.length >= MAX_NODES) return;
    
    const modeBoost = config.growthMode === "dense" ? 2.2 : config.growthMode === "quiet" ? -0.7 : 0;
    const climateSpeed = clamp(0.28 + climateGrowthSuitability() * 1.12, 0.28, 1.35);
    const currentSpeed = clamp((1.2 + metrics.stressLevel * 5.0 + modeBoost) * climateSpeed, 0.25, 12);
    
    const intervalMs = 2800 / currentSpeed;
    growInterval = setInterval(() => createBridgeNode(null, "live"), intervalMs);
}

function triggerRecoveryAction(type) {
    const msg = `Protective action reducing ${counterImpactLabel(type)}: recovery roots expand while blue intervention strands dissolve.`;
    metrics.lastIntervention = msg;
    pushInterventionLog(msg);
    updateInterventionState();
    ensureRecoveryBridgeBase();
    growRecoveryBurst(type, RECOVERY_BURST_ROOTS);
    dissolveInterventionRoots(RECOVERY_DISSOLVE_NODES);
    metrics.lastIntervention = msg;
    updatePollutionMap();
    applyBrightness(false);
    updateMetricMonitor();
    updateCounterButtons();
    syncPollutionSlider();
    updateGrowthEngine();
}

function handleCounterChange(type, delta) {
    const previousOverlayCount = currentInterventionNodeCount();
    const previousValue = config[type];
    config[type] = config[type] + delta;
    if(delta === 0 || config[type] === previousValue) return;
    document.getElementById(`val-${type}`).innerText = config[type];
    
    // Real-time log feedback for user interventions.
    let alertMsg = "";
    const impact = counterImpactLabel(type);
    if(delta > 0 && config[type] > 0 && type === "transport") alertMsg = `${impact}: primary roots thicken and both anchors become congested.`;
    else if(delta > 0 && config[type] > 0 && type === "delivery") alertMsg = `${impact}: foreign deck nodes lodge into the bridge surface and twist the root mesh.`;
    else if(delta > 0 && config[type] > 0 && type === "climate") alertMsg = `${impact}: handrails and trusses sag under thermal stress.`;
    else if(delta > 0 && config[type] > 0 && type === "shopping") alertMsg = `${impact}: deck density rises and decay nodes multiply.`;
    else if(delta > 0 && config[type] > 0 && type === "streaming") alertMsg = `${impact}: thin data aerial roots multiply rapidly.`;
    else if(delta > 0) alertMsg = `${impact}: positive action value decreased; clean pressure recalculated.`;
    else alertMsg = `${impact}: intervention value decreased; growth pressure recalculated.`;

    metrics.lastIntervention = alertMsg;
    pushInterventionLog(alertMsg);

    updateInterventionState();
    let nextOverlayCount = getInterventionOverlayCount();
    if(delta > 0 && config[type] > 0) {
        nextOverlayCount = Math.max(nextOverlayCount, previousOverlayCount + 4);
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    } else if(delta > 0 && nextOverlayCount <= previousOverlayCount) {
        nextOverlayCount = previousOverlayCount + 1;
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    } else if(delta < 0) {
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
        ensureRecoveryBridgeBase();
        growRecoveryBurst(type, RECOVERY_BURST_ROOTS);
        dissolveInterventionRoots(RECOVERY_DISSOLVE_NODES);
    } else {
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    }
    metrics.lastIntervention = alertMsg;
    updatePollutionMap();
    applyBrightness(false);
    updateMetricMonitor();
    updateCounterButtons();
    syncPollutionSlider();
    updateGrowthEngine();
}

function updateCounterButtons() {
    document.querySelectorAll(".cnt-btn").forEach(btn => {
        btn.disabled = false;
    });
}

function pushInterventionLog(msg) {
    const log = document.getElementById("reaction-log");
    if(log) { log.innerText = msg; log.classList.add("active"); setTimeout(() => log.classList.remove("active"), 3000); }
}

function clearAndResetCanvas() {
    rootNodes.filter(node => node.layer === "anchorage").forEach(node => {
        anchorPositions[node.side] = { x: node.x, y: node.y };
    });
    rootNodes = []; rootLinks = []; supportRoots = []; nextNodeId = 0;
    supportLayer.selectAll("*").remove(); linkLayer.selectAll("*").remove(); nodeLayer.selectAll("*").remove();
    getAnchorNode("left"); getAnchorNode("right");
    renderBridgeGuides(); applyBrightness(false);
    refreshFormMode();
    updateSystemMonitor();
}

function resetCanvasForLocationChange() {
    anchorPositions = { left: null, right: null };
    rootNodes = [];
    rootLinks = [];
    supportRoots = [];
    nextNodeId = 0;
    supportLayer.selectAll("*").remove();
    linkLayer.selectAll("*").remove();
    nodeLayer.selectAll("*").remove();
    getAnchorNode("left");
    getAnchorNode("right");
    renderBridgeGuides();
    applyBrightness(false);
    refreshFormMode();
    updateSystemMonitor();
}

// --- 8. Event bindings ---
function rebuildBridgeLayers() {
    updateInterventionState();
    clearAndResetCanvas();
    syncEmpMetrics();
    seedCumulativeBridge();
    updatePollutionMap();
    applyBrightness(false);
    updateMetricMonitor();
}

function updateBridgeForYearChange(nextYear) {
    updateInterventionState();
    syncEmpMetrics();
    updatePollutionMap();
    applyBrightness(false);
    updateMetricMonitor();
    refreshTemporalRecoveryRoots();
    applyCumulativeYearMorph();
}

function scheduleBridgeYearUpdate(nextYear) {
    if(bridgeRebuildTimer) clearTimeout(bridgeRebuildTimer);
    bridgeRebuildTimer = setTimeout(() => {
        bridgeRebuildTimer = null;
        updateBridgeForYearChange(nextYear);
    }, 70);
}

function scheduleEnvironmentRefresh() {
    if(environmentRefreshTimer) clearTimeout(environmentRefreshTimer);
    environmentRefreshTimer = setTimeout(() => {
        environmentRefreshTimer = null;
        fetchEnvironmentData();
    }, 280);
}

function setCounterValue(type, value) {
    config[type] = value;
    const el = document.getElementById(`val-${type}`);
    if(el) el.innerText = value;
}

function distributePollutionPreview(total) {
    const types = ["transport", "climate", "shopping", "delivery", "streaming"];
    const sign = total < 0 ? -1 : 1;
    let remaining = Math.abs(total);
    types.forEach(type => setCounterValue(type, 0));
    for(let i = 0; i < remaining; i++) {
        const type = types[i % types.length];
        setCounterValue(type, config[type] + sign);
    }
}

function syncPollutionSlider() {
    const slider = document.getElementById("param-pollution");
    if(!slider) return;
    slider.value = clamp(manualInterventionCount(), -6, 6);
}

function applyPollutionPreview(value) {
    const previousOverlayCount = currentInterventionNodeCount();
    distributePollutionPreview(value);
    updateInterventionState();
    let nextOverlayCount = getInterventionOverlayCount();
    if(value > 0 && nextOverlayCount <= previousOverlayCount) {
        nextOverlayCount = previousOverlayCount + 1;
    }
    markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
    syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    if(value < 0) {
        const previewRecoveryCount = Math.min(RECOVERY_BURST_ROOTS, Math.max(2, Math.abs(value) * 2));
        ensureRecoveryBridgeBase();
        growRecoveryBurst("preview", previewRecoveryCount);
        dissolveInterventionRoots(Math.min(RECOVERY_DISSOLVE_NODES, Math.abs(value) + 1));
    }
    metrics.lastIntervention = `Preview pollution value ${value}: intervention counters distributed automatically.`;
    updatePollutionMap();
    applyBrightness(false);
    updateMetricMonitor();
    updateCounterButtons();
    updateGrowthEngine();
}

document.getElementById("param-pollution").addEventListener("input", e => {
    applyPollutionPreview(parseInt(e.target.value, 10));
});

document.getElementById("param-time").addEventListener("input", e => {
    config.year = parseInt(e.target.value, 10);
    syncMonthParameterLimit();
    activeInterventionStart = 0;
    activeInterventionEnd = 0;
    scheduleBridgeYearUpdate(config.year);
    scheduleEnvironmentRefresh();
});

document.getElementById("param-month").addEventListener("input", e => {
    config.month = parseInt(e.target.value, 10);
    syncMonthParameterLimit();
    updateMetricMonitor();
    refreshSupportUndergrowthForSeason();
    scheduleEnvironmentRefresh();
});

document.querySelectorAll(".cnt-btn").forEach(btn => {
    btn.addEventListener("click", e => {
        e.preventDefault();
        const type = btn.dataset.type; const delta = parseInt(btn.dataset.delta, 10);
        handleCounterChange(type, delta);
    });
});
updateCounterButtons();

document.querySelectorAll(".mode-btn[data-value]").forEach(btn => {
    btn.addEventListener("click", () => {
        config.growthMode = btn.dataset.value;
        document.querySelectorAll(".mode-btn[data-value]").forEach(item => item.classList.toggle("active", item === btn));
        updateGrowthEngine();
    });
});

document.getElementById("btn-pause-growth").addEventListener("click", () => {
    config.paused = !config.paused;
    const pauseButton = document.getElementById("btn-pause-growth");
    pauseButton.classList.toggle("active", config.paused);
    pauseButton.innerText = config.paused ? "RESUME" : "PAUSE";
    updateGrowthEngine();
});
document.getElementById("btn-clear-bridge").addEventListener("click", () => {
    // Reset human actions while preserving the current base bridge.
    ["transport","climate","shopping","delivery","streaming"].forEach(k => { config[k]=0; document.getElementById(`val-${k}`).innerText=0; });
    activeInterventionStart = 0;
    activeInterventionEnd = 0;
    recoveryActionCount = 0;
    updateInterventionState();
    removeHumanActionRoots();
    updatePollutionMap();
    applyBrightness(false);
    updateMetricMonitor();
    updateCounterButtons();
    syncPollutionSlider();
    updateGrowthEngine();
});
