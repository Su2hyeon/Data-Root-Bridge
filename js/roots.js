// --- 1. Global control scale and state ---
const CURRENT_YEAR = 2026;
const START_YEAR = 2000;
const DEFAULT_BRIGHTNESS = 100;
const MAX_NODES = 760;
const CUMULATIVE_BASE_NODES = 210;
const MAX_LIVE_MICROBE_NODES = 280;
const LIVE_GROWTH_MIN_INTERVAL_MS = 420;
const INTERVENTION_COLOR = "#50ACFF";
const OLD_INTERVENTION_COLOR = "#8e969a";
const RECOVERY_COLOR = "#3f6f64";
const RECOVERY_OLD_COLOR = "#7b8d88";
const MAX_RECOVERY_ACTIONS = 180;
const RECOVERY_BURST_ROOTS = 30;
const RECOVERY_STRAND_SLOTS = 53; // Retire complete growth groups while allowing new roots.
const RECOVERY_DISSOLVE_NODES = 15;
const MAX_SUPPORT_UNDERGROWTH_NODES = 130;
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1200;
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
let lastStageOneRecoveryTarget = null;
let bulkRenderDepth = 0;
let lastColorStateKey = "";
let lastBrightnessStateKey = "";

function syncStageScale() {
    document.documentElement.style.setProperty("--stage-width", "100vw");
    document.documentElement.style.setProperty("--stage-height", "100vh");
    document.documentElement.style.setProperty("--stage-scale", "1");

    const infoRatio = 1512 / 850;
    const shouldNormalizeInfo = window.innerWidth >= 1600;
    const virtualInfoWidth = shouldNormalizeInfo
        ? Math.min(window.innerWidth, window.innerHeight * infoRatio)
        : window.innerWidth;
    const infoOffsetX = shouldNormalizeInfo
        ? Math.max(0, (window.innerWidth - virtualInfoWidth) / 2)
        : 0;

    document.documentElement.style.setProperty("--info-vw", `${virtualInfoWidth / 100}px`);
    document.documentElement.style.setProperty("--info-vh", "1vh");
    document.documentElement.style.setProperty("--info-offset-x", `${infoOffsetX}px`);
}

syncStageScale();
window.addEventListener("resize", syncStageScale);

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
    const collapseReduction = 1 - clamp(contractionStrength() * 0.42, 0, 0.46);
    return Math.round(clamp(
        (
            positiveInterventionCount() * 8 +
            Math.max(0, metrics.humanCo2Kg) * 0.42 +
            Math.max(0, metrics.plasticWasteKg) * 18
        ) * collapseReduction,
        0,
        96
    ));
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

function interventionPressureScale() {
    return clamp(positiveInterventionCount() / 10 + metrics.stressLevel * 0.55, 0, 1.1);
}

function contractionStrength() {
    if(positiveInterventionCount() <= 0) return 0;
    const manualCollapse = clamp(positiveInterventionCount() / 4.5, 0, 1);
    const humanLoad = clamp(Math.max(0, metrics.humanCo2Kg) / 22 + Math.max(0, metrics.plasticWasteKg) * 0.35, 0, 1);
    const backgroundStress = clamp((metrics.stressLevel - 0.72) * 0.28 + (metrics.decay - 0.62) * 0.18, 0, 0.18);
    const historicalRelief = clamp((1 - getYearProgress()) * 1.15, 0, 0.92);
    return clamp((manualCollapse * 0.78 + humanLoad * 0.28 + backgroundStress) * (1 - historicalRelief), 0, 1.2);
}

function interventionStepDetail() {
    return Math.log1p(Math.abs(manualInterventionCount()));
}

function recoveryCollapseFactor() {
    if(manualInterventionCount() <= -7) return 0;
    return clamp(contractionStrength() - negativeInterventionCount() * 0.08, 0, 1);
}

function shouldHideCollapsedRecovery(item) {
    if(!item || !item.recovery) return false;
    const collapse = recoveryCollapseFactor();
    if(collapse < 0.68) return false;
    const seed = item.seedKey || (item.source && item.source.seedKey) || item.id || "recovery";
    const threshold = item.recoveryOffshoot || item.kind === "recovery-offshoot" ? 0.68 : 0.28;
    return stableRand(seed, 118) < clamp((collapse - 0.68) / 0.32, 0, 1) * threshold;
}

function getLinkStrokeWidth(link, aged = false) {
    if(!link) return 0.6;
    if(link.target.upperBridgeTwig) return aged ? 0.58 : 0.8;
    const pressure = interventionPressureScale();
    if(link.intervention) return link.activeIntervention ? 1.12 + pressure * 0.26 : 0.58;
    if(link.recovery) return link.kind === "recovery-offshoot" ? 0.9 : 1.45;
    if(link.kind === "microbe") return aged ? 0.5 : 0.7 + metrics.stressLevel * 0.18;
    if(link.kind === "cross") return aged ? 0.38 : 0.46;
    return aged ? 0.82 + metrics.stressLevel * 0.16 : 1.18 + metrics.stressLevel * 0.46;
}

function getLinkStrokeOpacity(link, aged = false) {
    if(!link) return 0.2;
    if(link.source.upperBridgeRoot || link.target.upperBridgeRoot) return link.target.upperBridgeTwig ? (aged ? 0.18 : 0.27) : (aged ? 0.28 : 0.38);
    if(link.recovery) return (aged ? 0.48 : 0.78) * (1 - recoveryCollapseFactor() * (link.kind === "recovery-offshoot" ? 0.62 : 0.38));
    if(link.intervention) return interventionOpacity(aged ? "aged-line" : "line", link.activeIntervention);
    if((link.source && link.source.seedMode === "support-under") || (link.target && link.target.seedMode === "support-under")) return aged ? 0.5 : 0.72;
    if(link.kind === "microbe") return aged ? 0.34 : 0.48;
    if(link.kind === "cross") return aged ? 1 : 0.42;
    return aged ? getAgedRootOpacity() * 0.62 : 0.58 + metrics.stressLevel * 0.22;
}

function getSupportStrokeWidth(support) {
    if(!support) return 0.48;
    if(support.intervention) return support.activeIntervention ? 0.82 + interventionPressureScale() * 0.18 : 0.42;
    if(support.recovery) return 0.72;
    return support.supportUnder || support.seasonalBaseSupport ? 0.42 : 0.5;
}

function getSupportStrokeOpacity(support, aged = false) {
    if(!support) return 0.16;
    if(support.intervention) return interventionOpacity(aged ? "aged-support" : "support", support.activeIntervention);
    if(support.recovery) return (aged ? 0.32 : 0.4) * (1 - recoveryCollapseFactor() * 0.55);
    if(support.supportUnder || support.seasonalBaseSupport) return aged ? 0.52 : 0.74;
    return aged ? 0.14 : 0.22;
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

function biomeSignature(row) {
    const text = String(row && row.biome ? row.biome : "").toLowerCase();
    return {
        forest: /forest|wood|jungle|rainforest|taiga/.test(text),
        grass: /grass|savanna|shrub|prairie|steppe/.test(text),
        dry: /desert|arid|dry|xeric|sand/.test(text),
        water: /marine|freshwater|river|lake|wetland|aquatic|sediment/.test(text),
        urban: /urban|built|city|anthropogenic|settlement/.test(text),
        polar: /polar|tundra|ice|glacier|alpine/.test(text)
    };
}

function regionalGrowthProfile(row) {
    const adjusted = getHumanAdjustedMetrics();
    const biome = biomeSignature(row);
    const absLat = Math.abs(config.lat);
    const tropical = absLat < 23.5;
    const temperate = absLat >= 23.5 && absLat < 55;
    const polar = absLat >= 55 || biome.polar;
    const dry = biome.dry || adjusted.soilMoisture < 0.22;
    const wet = biome.water || adjusted.soilMoisture > 0.52;
    const forest = biome.forest || (tropical && wet);
    const urban = biome.urban || metrics.pm25 > 24;
    const locSeed = `${config.lat.toFixed(2)},${config.lon.toFixed(2)},${config.locName}`;
    const countryDrift = stableRand(locSeed, 4) - 0.5;

    let profile = {
        archWeight: 0.34,
        waveAmp: 44,
        verticalScatter: 54,
        horizontalScatter: 62,
        downwardBias: 0,
        progressWarp: 1,
        branchLift: 0,
        brokenness: 0.12,
        countryDrift
    };

    if(forest) {
        profile = { ...profile, archWeight: 0.18, waveAmp: 82, verticalScatter: 96, horizontalScatter: 78, downwardBias: 34, progressWarp: 0.82, branchLift: -18 };
    } else if(dry) {
        profile = { ...profile, archWeight: 0.08, waveAmp: 30, verticalScatter: 34, horizontalScatter: 116, downwardBias: 18, progressWarp: 1.35, brokenness: 0.42 };
    } else if(polar) {
        profile = { ...profile, archWeight: 0.06, waveAmp: 22, verticalScatter: 28, horizontalScatter: 92, downwardBias: -8, progressWarp: 1.12, brokenness: 0.28 };
    } else if(wet) {
        profile = { ...profile, archWeight: 0.22, waveAmp: 72, verticalScatter: 88, horizontalScatter: 58, downwardBias: 28, progressWarp: 0.9 };
    } else if(urban) {
        profile = { ...profile, archWeight: 0.12, waveAmp: 56, verticalScatter: 72, horizontalScatter: 104, downwardBias: -22, progressWarp: 1.22, brokenness: 0.36 };
    } else if(temperate) {
        profile = { ...profile, archWeight: 0.26, waveAmp: 52, verticalScatter: 62, horizontalScatter: 70, progressWarp: 1.0 };
    }

    if(tropical) profile.downwardBias += 18;
    profile.waveAmp += countryDrift * 34;
    profile.horizontalScatter += Math.abs(countryDrift) * 28;
    return profile;
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

    metrics.stressLevel = clamp((totalCo2 + accumulatedEnvironmentalLoad) / 34, 0, 1);
    metrics.decay = clamp((shoppingCo2 + deliveryCo2 + plasticWaste * 4 + temporalIntervention * 18) / 26, 0, 1);
    metrics.distortion = clamp((climateCo2 + deliveryCo2 + plasticWaste * 3 + temporalIntervention * 12) / 14, 0, 1);
    metrics.monopoly = clamp((transportCo2 + temporalIntervention * 10) / 10, 0, 1);
    metrics.growthPressure = clamp(((totalCo2 + accumulatedEnvironmentalLoad) * 1.8) + (config.streaming * 4.2), 0, 100);

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
        const text = await fetchOtuSummaryText();
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

async function fetchOtuSummaryText() {
    try {
        const response = await fetch("data/otu_summary.tsv.gz");
        if(!response.ok) throw new Error(`OTU gzip request failed: ${response.status}`);

        const contentEncoding = response.headers.get("content-encoding");
        if(contentEncoding && contentEncoding.includes("gzip")) return await response.text();
        if(!("DecompressionStream" in window) || !response.body) {
            throw new Error("This browser cannot decompress local gzip data.");
        }

        const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
        return await new Response(stream).text();
    } catch(gzipError) {
        console.warn("Falling back to uncompressed OTU data", gzipError);
        const response = await fetch("data/otu_summary.tsv");
        if(!response.ok) throw new Error(`OTU TSV request failed: ${response.status}`);
        return await response.text();
    }
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
let zoomingRoots = false;

function isCanvasBackgroundEvent(event) {
    return event.target === svg.node();
}

const zoom = d3.zoom()
    .filter(event => {
        if(draggingAnchor || draggingRoot) return false;
        if(event.type === "wheel" || event.type === "dblclick") return true;
        return isCanvasBackgroundEvent(event);
    })
    .scaleExtent([0.35, 3.5])
    .on("start", () => {
        zoomingRoots = true;
        if(typeof resetElasticPointer === "function") resetElasticPointer();
    })
    .on("end", () => { zoomingRoots = false; })
    .on("zoom", e => {
        if(draggingAnchor || draggingRoot) return;
        currentZoomTransform = e.transform;
        viewport.attr("transform", currentZoomTransform);
        document.getElementById("txt-zoom").innerText = `${Math.round(currentZoomTransform.k * 100)}%`;
    });
svg.call(zoom);
function cubicPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return {
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
    };
}

function distancePointToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if(lengthSq <= 0.0001) return distanceBetween(point, a);
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
    return distanceBetween(point, { x: a.x + dx * t, y: a.y + dy * t });
}

function linkShapeStress(link) {
    if(manualInterventionCount() <= -7) {
        if(!Number.isFinite(link.cleanShapeStress)) link.cleanShapeStress = metrics.stressLevel;
        return link.cleanShapeStress;
    }
    link.cleanShapeStress = metrics.stressLevel;
    return metrics.stressLevel;
}

function distanceToLinkCurve(point, link) {
    if(!link || !link.source || !link.target) return Number.POSITIVE_INFINITY;
    const { source, target, intervention, recovery } = link;
    const dx = target.x - source.x;
    const interventionSign = stableRand(`${source.id}-${target.id}`, 42) > 0.5 ? 1 : -1;
    const recoveryBend = interventionSign * (4 + stableRand(`${source.id}-${target.id}`, 44) * 8);
    const microbialBend = interventionSign * (22 + stableRand(`${source.id}-${target.id}`, 45) * 86);
    const bend = (recovery || source.upperBridgeRoot || target.upperBridgeRoot)
        ? recoveryBend
        : (intervention ? interventionSign * (35 + stableRand(`${source.id}-${target.id}`, 43) * 96) : (link.kind === "microbe" ? microbialBend : (link.kind === "cross" ? 7 : 18 * linkShapeStress(link))));
    const p0 = { x: source.x, y: source.y };
    const p1 = { x: source.x + dx * 0.34, y: source.y + bend };
    const p2 = { x: source.x + dx * 0.68, y: target.y - bend };
    const p3 = { x: target.x, y: target.y };
    let previous = p0;
    let best = Number.POSITIVE_INFINITY;
    for(let i = 1; i <= 22; i++) {
        const next = cubicPoint(p0, p1, p2, p3, i / 22);
        best = Math.min(best, distancePointToSegment(point, previous, next));
        previous = next;
    }
    return best;
}

function supportControlPoints(support) {
    const { source, target, seedKey, intervention, recovery } = support;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const side = stableRand(seedKey, 81) > 0.5 ? 1 : -1;
    const curl = (intervention ? 125 : recovery ? 44 : 72) * side;
    const lift = intervention ? -90 + stableRand(seedKey, 82) * 190 : 42 + stableRand(seedKey, 83) * 120;
    return [
        { x: source.x, y: source.y },
        { x: source.x + dx * 0.22 + curl * 0.35, y: source.y + dy * 0.18 + lift * 0.25 },
        { x: source.x + dx * 0.72 - curl, y: source.y + dy * 0.78 + lift },
        { x: target.x, y: target.y }
    ];
}

function distanceToSupportCurve(point, support) {
    if(!support || !support.source || !support.target) return Number.POSITIVE_INFINITY;
    const [p0, p1, p2, p3] = supportControlPoints(support);
    let previous = p0;
    let best = Number.POSITIVE_INFINITY;
    for(let i = 1; i <= 22; i++) {
        const next = cubicPoint(p0, p1, p2, p3, i / 22);
        best = Math.min(best, distancePointToSegment(point, previous, next));
        previous = next;
    }
    return best;
}

function setupInterventionTraceHover() {
    svg.on("mousemove.intervention-trace", function(event) {
        const target = event.target;
        if(target && target.closest && target.closest(".root-node-hit,.root-node,.root-dot-node")) return;
        const [sx, sy] = d3.pointer(event, svg.node());
        const point = currentZoomTransform.invert([sx, sy]);
        const worldPoint = { x: point[0], y: point[1] };
        let nearest = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        rootLinks.forEach(link => {
            if(!link) return;
            const distance = distanceToLinkCurve(worldPoint, link);
            if(distance < nearestDistance) {
                nearestDistance = distance;
                nearest = link;
            }
        });
        supportRoots.forEach(support => {
            if(!support) return;
            const distance = distanceToSupportCurve(worldPoint, support);
            if(distance < nearestDistance) {
                nearestDistance = distance;
                nearest = support;
            }
        });
        const threshold = 34 / Math.max(0.35, currentZoomTransform.k || 1);
        if(nearest && nearestDistance <= threshold) {
            tooltip.style("display", "block")
                .html(tooltipRows(lineTooltipRows(nearest)))
                .style("left", `${event.pageX + 14}px`)
                .style("top", `${event.pageY - 36}px`);
        } else if(target === svg.node()) {
            tooltip.style("display", "none");
        }
    });

    svg.on("mouseleave.intervention-trace", function() {
        tooltip.style("display", "none");
    });
}

setupInterventionTraceHover();


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
    const { leftX, rightX, midY } = getBridgeGeometry();
    const leftAnchor = rootNodes.find(node => node.layer === "anchorage" && node.side === "left");
    const rightAnchor = rootNodes.find(node => node.layer === "anchorage" && node.side === "right");
    const guideLeftX = leftAnchor ? leftAnchor.x : leftX;
    const guideRightX = rightAnchor ? rightAnchor.x : rightX;

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
        .filter(node => node.side === side && node.layer !== "anchorage" && !node.upperBridgeRoot)
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
        .filter(node => !node.upperBridgeRoot && (node.layer === layerName || node.layer === "primary"))
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
    const candidates = rootNodes.filter(node => !node.intervention && !node.upperBridgeRoot);
    if(!candidates.length) return getAnchorNode(stableSide(seedKey));
    return candidates[Math.floor(stableRand(seedKey, 12) * candidates.length)] || candidates[0];
}

function recoveryWindowStart(target) {
    // Retire whole anchor-rooted strands, preserving the parents of retained tips.
    return Math.floor(Math.max(0, target - MAX_RECOVERY_ACTIONS + RECOVERY_STRAND_SLOTS) / RECOVERY_STRAND_SLOTS) * RECOVERY_STRAND_SLOTS;
}

function getRecoveryParent(side, slot = recoveryActionCount) {
    const groupStart = Math.floor(slot / RECOVERY_STRAND_SLOTS) * RECOVERY_STRAND_SLOTS;
    const grownTips = rootNodes
        .filter(node => node.recovery && node.recoverySide === side && !node.recoveryOffshoot && node.recoverySlot >= groupStart && node.recoverySlot < slot)
        .sort((a, b) => b.id - a.id);
    if(grownTips.length && Math.random() > 0.28) {
        return grownTips[Math.floor(Math.random() * Math.min(grownTips.length, 4))] || grownTips[0];
    }
    const bridgeCandidates = rootNodes
        .filter(node => !node.intervention && !node.recovery && !node.upperBridgeRoot && node.layer !== "anchorage" && (node.side === side || !node.side))
        .sort((a, b) => b.id - a.id)
        .slice(0, 24);
    if(bridgeCandidates.length && Math.random() > 0.42) {
        return bridgeCandidates[Math.floor(Math.random() * bridgeCandidates.length)];
    }
    return getAnchorNode(side);
}

function connectStructuralNeighbors(node, isIntervened) {
    const instability = contractionStrength();
    const maxLinks = node.intervention
        ? Math.round(clamp(3 - instability * 0.8, 2, 3))
        : (isIntervened ? Math.round(clamp(3 + instability * 2, 3, 5)) : 3);
    const radius = node.intervention ? 180 + instability * 28 : (isIntervened ? 150 + metrics.meshAmplitude * 0.35 + instability * 52 : 168);
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

function syncUpperBridgeRoots() {
    const stage = colorScoreToStage(manualInterventionCount());
    const existing = rootNodes.filter(node => node.upperBridgeRoot);
    const isDefaultState = positiveInterventionCount() === 0 && negativeInterventionCount() === 0;
    if(isDefaultState || stage > 4) {
        removeNodesFromCanvas(new Set(existing));
        return;
    }
    const frame = getCurrentAnchorFrame();
    const span = frame.rightX - frame.leftX;
    const bridgeNodes = rootNodes.filter(node => node.layer !== "anchorage" && !node.intervention &&
        !node.upperBridgeRoot && node.seedMode !== "support-under" &&
        node.x > frame.leftX && node.x < frame.rightX && Math.abs(node.y - frame.midY) < height * 0.16);
    if(bridgeNodes.length < 2) return;
    const nearest = x => bridgeNodes.reduce((best, node) =>
        Math.abs(node.x - x) + Math.abs(node.y - frame.midY) * 0.5 <
        Math.abs(best.x - x) + Math.abs(best.y - frame.midY) * 0.5 ? node : best);
    const cleanSteps = Math.max(0, -manualInterventionCount());
    const target = stage === 1 ? 5 + Math.floor(Math.max(0, recoveryActionCount - 75) / 30)
        : cleanSteps > 0 ? Math.min(5, Math.max(0, cleanSteps - 1)) : stage <= 3 ? 5 : 4;
    const groups = new Set(existing.map(node => node.upperBridgeGroup));
    bulkRenderDepth += 1;
    try {
        for(let group = 0; group < target; group++) {
            if(groups.has(group)) continue;
            if(stage !== 1 && rootNodes.length + 20 > MAX_NODES) break;
            const seed = `upper-bridge-${config.lat.toFixed(3)}-${config.lon.toFixed(3)}-${group}`;
            const rand = salt => stableRand(seed, salt);
            // Overlapping irregular upper branches at varied heights and spans.
            const startProgress = group === 0 ? 0.02 : group === 1 ? 0.40 : 0.02 + rand(1) * 0.36;
            const endProgress = Math.min(0.98, startProgress + 0.42 + rand(2) * 0.3);
            const start = nearest(frame.leftX + span * startProgress);
            const end = nearest(frame.leftX + span * endProgress);
            if(start === end) continue;
            const rise = Math.min(height * (0.24 + rand(3) * 0.15), Math.min(start.y, end.y) - 70);
            if(rise < 25) continue;
            let elevation = 0.65 + rand(4) * 0.25;
            const lateralSpread = (group % 2 === 0 ? -1 : 1) * width * (0.05 + rand(5) * 0.07);
            const peaks = [];
            let parent = start;
            for(let step = 1; step <= 5; step++) {
                const t = step / 6;
                elevation = clamp(elevation + (rand(140 + step) - 0.45) * 0.34, 0.5, 0.98);
                const node = {
                    id: nextNodeId++, layer: "primary", side: t < 0.5 ? start.side : end.side,
                    x: clamp(start.x + (end.x - start.x) * t + lateralSpread * Math.sin(t * Math.PI) + (rand(10 + step) - 0.5) * 26, 72, width - 72),
                    y: start.y + (end.y - start.y) * t - rise * elevation + (rand(20 + step) - 0.5) * 14,
                    text: "[upper supporting root]", weight: 1.4, stage: 1,
                    source: "Upper aerial root supporting the central bridge",
                    seedMode: "upper-bridge", seedKey: `${seed}-${step}`,
                    upperBridgeRoot: true, upperBridgeGroup: group
                };
                node.baseX = node.x;
                node.baseY = node.y;
                rootNodes.push(node);
                addBridgeLink(parent, node, "primary");
                drawNode(node);
                peaks.push(node);
                parent = node;
            }
            addBridgeLink(parent, end, "primary");
            // Short hanging strands join the elevated roots back to the bridge mesh.
            [peaks[1], peaks[3]].forEach((top, index) => {
                const foot = nearest(top.x + (rand(30 + index) - 0.5) * span * 0.1);
                const node = {
                    id: nextNodeId++, layer: "mesh", side: foot.side,
                    x: top.x * 0.55 + foot.x * 0.45 + (rand(40 + index) - 0.5) * 22,
                    y: top.y * 0.45 + foot.y * 0.55,
                    text: "[hanging support root]", weight: 1, stage: 1,
                    source: "Hanging aerial root connected to the bridge mesh",
                    seedMode: "upper-bridge", seedKey: `${seed}-hanging-${index}`,
                    upperBridgeRoot: true, upperBridgeGroup: group
                };
                node.baseX = node.x; node.baseY = node.y;
                rootNodes.push(node);
                addBridgeLink(top, node, "primary");
                addBridgeLink(node, foot, "primary");
                drawNode(node);
            });
            peaks.forEach((joint, index) => {
                let tip;
                for(let fork = 0; fork < 2; fork++) {
                    const salt = 60 + index * 8 + fork * 3;
                    const direction = fork === 0 ? -1 : 1;
                    const node = {
                        id: nextNodeId++, layer: "mesh", side: joint.side,
                        x: joint.x + direction * (16 + rand(salt) * 38),
                        y: joint.y + (rand(salt + 1) - 0.35) * 62,
                        text: "[fine aerial root]", weight: 0.6, stage: 1,
                        source: "Fine branch of the upper supporting roots",
                        seedMode: "upper-bridge", seedKey: `${seed}-twig-${index}-${fork}`,
                        upperBridgeRoot: true, upperBridgeTwig: true, upperBridgeGroup: group
                    };
                    node.baseX = node.x; node.baseY = node.y;
                    rootNodes.push(node);
                    addBridgeLink(joint, node, "primary");
                    drawNode(node);
                    tip = node;
                }
                if(index % 2 === 0) {
                    const node = { ...tip, id: nextNodeId++,
                        x: tip.x + (rand(110 + index) - 0.5) * 42,
                        y: tip.y + 12 + rand(120 + index) * 26,
                        seedKey: `${seed}-terminal-${index}` };
                    node.baseX = node.x; node.baseY = node.y;
                    rootNodes.push(node);
                    addBridgeLink(tip, node, "primary");
                    drawNode(node);
                }
            });
        }
    } finally { bulkRenderDepth -= 1; }
    lastBrightnessStateKey = "";
    refreshFormMode();
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
        syncUpperBridgeRoots();
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
        .classed("active-intervention", d => !!(d && d.intervention && d.activeIntervention))
        .classed("trace-intervention", d => !!(d && d.intervention && !d.activeIntervention));
    supportLayer.selectAll(".edge-support-root")
        .classed("active-intervention", d => !!(d && d.intervention && d.activeIntervention))
        .classed("trace-intervention", d => !!(d && d.intervention && !d.activeIntervention));
    nodeLayer.selectAll(".root-node")
        .classed("active-intervention", d => !!(d && d.intervention && d.activeIntervention))
        .classed("trace-intervention", d => !!(d && d.intervention && !d.activeIntervention));
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
    linkLayer.selectAll(".root-link-hit").filter(d => removedNodes.has(d.source) || removedNodes.has(d.target)).remove();
    supportLayer.selectAll(".edge-support-root").filter(d => removedNodes.has(d.source)).remove();
    supportLayer.selectAll(".edge-support-root-hit").filter(d => removedNodes.has(d.source)).remove();
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

function cumulativeYearOffset(node, scale = 1) {
    const morph = yearMorphStrength();
    const seedKey = node.seedKey || node.id;
    const futureWeight = Number.isFinite(node.dataYear) && node.dataYear > config.year ? 1.35 : 0.7;
    const side = node.side === "left" ? -1 : node.side === "right" ? 1 : (stableRand(seedKey, 61) > 0.5 ? 1 : -1);
    return {
        x: side * (stableRand(seedKey, 62) * 42 + 14) * morph * futureWeight * scale,
        y: (stableRand(seedKey, 63) - 0.24) * 86 * morph * futureWeight * scale
    };
}

function applyCumulativeYearMorph() {
    const morph = yearMorphStrength();
    rootNodes.forEach(node => {
        ensureBasePosition(node);
        if(node.upperBridgeRoot) return;
        if(node.layer === "anchorage") return;
        if(node.intervention || node.recovery || node.upperBridgeRoot || node.seedMode === "support-under") {
            node.x = node.baseX;
            node.y = node.baseY;
            return;
        }
        const offset = cumulativeYearOffset(node);
        const driftX = offset.x;
        const driftY = offset.y;
        node.x = clamp(node.baseX + driftX, canvasMinX(), canvasMaxX());
        node.y = clamp(node.baseY + driftY, canvasMinY(), canvasMaxY());
    });

    applyBridgeStressMorph();
    renderBridgeGuides();
    nodeLayer.selectAll(".root-node").style("display", null);
    linkLayer.selectAll(".root-link").style("display", null);
    supportLayer.selectAll(".edge-support-root").style("display", null);
    rerenderNodes();
    rerenderLinks();
    rerenderSupportRoots();
}

function applyBridgeStressMorph() {
    // Stage 1 adds growth without re-deforming the bridge already on screen.
    if(manualInterventionCount() <= -7) return;
    const stress = contractionStrength();
    const stepDetail = interventionStepDetail();
    const stepPhase = manualInterventionCount() * 0.47;
    const recovery = bridgeGrowthState() === "recovery" ? clamp(negativeInterventionCount() / 8, 0, 1) : 0;
    const instability = clamp(stress * (1 - recovery * 0.68), 0, 1.35);
    const frame = getCurrentAnchorFrame();
    const centerX = frame.leftX + (frame.rightX - frame.leftX) * 0.5;
    const centerY = frame.midY - height * (0.04 + instability * 0.075) + Math.sin(stepPhase) * stepDetail * 4;
    const finalStagePull = clamp((manualInterventionCount() - 6) / 2, 0, 1) * 0.30;
    const anchorPull = clamp(instability * 0.42 + finalStagePull, 0, 0.68);

    rootNodes.forEach(node => {
        ensureBasePosition(node);
        if(node.layer === "anchorage") {
            const side = node.side === "left" ? -1 : 1;
            const verticalTension = Math.sin((node.id + config.year) * 0.5 + stepPhase) * (instability * 12 + stepDetail * 2.4);
            const lateralTension = side * Math.cos(stepPhase + node.id) * stepDetail * 3.2;
            node.x = clamp(node.baseX + (centerX - node.baseX) * anchorPull + lateralTension, 20, width - 20);
            node.y = clamp(node.baseY + (centerY - node.baseY) * anchorPull * 0.18 + verticalTension, 20, height - 20);
            return;
        }
        const seedKey = node.seedKey || node.id;
        const side = node.side === "left" ? -1 : node.side === "right" ? 1 : (stableRand(seedKey, 95) > 0.5 ? 1 : -1);
        const recoveryCollapse = node.recovery ? recoveryCollapseFactor() : 0;
        if(node.seedMode === "support-under") {
            const sideAnchor = node.side ? rootNodes.find(anchor => anchor.layer === "anchorage" && anchor.side === node.side) : null;
            const anchorDx = sideAnchor ? sideAnchor.x - sideAnchor.baseX : 0;
            const anchorDy = sideAnchor ? sideAnchor.y - sideAnchor.baseY : 0;
            const underWave = Math.sin((node.id + config.year) * 0.57 + stepPhase) * (instability * 7 + stepDetail * 1.4);
            const yearOffset = cumulativeYearOffset(node, 1.15);
            node.x = clamp(node.baseX + yearOffset.x + anchorDx * 0.92 + side * underWave, canvasMinX(), canvasMaxX());
            node.y = clamp(node.baseY + yearOffset.y + anchorDy * 0.82 + Math.abs(underWave) * 0.65, canvasMinY(), canvasMaxY());
            return;
        }
        const yearOffset = (!node.intervention && !node.recovery) ? cumulativeYearOffset(node) : { x: 0, y: 0 };
        const morphBaseX = node.baseX + yearOffset.x;
        const morphBaseY = node.baseY + yearOffset.y;
        const bridgeRole = node.recovery
            ? (node.recoveryOffshoot ? 0.62 : 0.76)
            : node.intervention ? 1.55 : node.seedMode === "support-under" ? 0.14 : node.layer === "primary" ? 1.05 : 0.84;
        const pull = clamp(instability * bridgeRole, 0, 0.76);
        const distanceFromCenter = morphBaseX - centerX;
        const knotWave = Math.sin((node.id + config.year) * 0.73 + stableRand(seedKey, 96) * Math.PI * 2 + stepPhase);
        const knotRadius = 1 - Math.min(1, Math.abs(distanceFromCenter) / Math.max(1, width * 0.48));
        const twist = knotWave * (instability * (node.recovery ? 24 : node.intervention ? 112 : 72) + stepDetail * (node.intervention ? 15 : 7));
        const crossTwist = Math.cos((node.id + config.month) * 1.17 + stableRand(seedKey, 97) * Math.PI + stepPhase * 0.7) * (instability * (node.recovery ? 18 : node.intervention ? 58 : 40) + stepDetail * (node.recovery ? 3 : 6));
        const sagLift = node.recovery ? height * recoveryCollapse * 0.018 : node.intervention ? -height * instability * 0.026 : height * instability * 0.035;

        node.x = clamp(morphBaseX + (centerX - morphBaseX) * pull + side * twist * knotRadius + crossTwist * 0.35, canvasMinX(), canvasMaxX());
        node.y = clamp(morphBaseY + (centerY - morphBaseY) * pull * 0.68 + sagLift + crossTwist, canvasMinY(), canvasMaxY());
        node.x += (centerX - node.x) * finalStagePull;
        node.y += (centerY - node.y) * finalStagePull;
    });
}

function freeActionNodeCapacity(requiredCount = 1) {
    if(manualInterventionCount() <= -7) return;
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
    if(manualInterventionCount() <= -7) {
        // Keep geometry, but refresh active/aged colors against the current state.
        refreshInterventionStyles();
        updateSystemMonitor();
        return;
    }
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
    syncRecoveryRootsToCount(lastStageOneRecoveryTarget ?? recoveryActionCount);
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
    if(rootNodes.length >= MAX_NODES && manualInterventionCount() > -7) return;
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
        recoverySlot: parentNode.recoverySlot,
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

function appendRecoveryRoots(type, amount) {
    syncRecoveryRootsToCount(recoveryActionCount + amount, type);
}

function growRecoveryBurst(type, amount = RECOVERY_BURST_ROOTS) {
    ageExistingRoots();
    const collapse = recoveryCollapseFactor();
    appendRecoveryRoots(type, Math.max(2, Math.round(amount * (1 - collapse * 0.42))));
}

function syncRecoveryRootsToCount(targetCount, type = "preview") {
    const requestedTarget = Math.max(0, Math.round(targetCount));
    const accumulate = manualInterventionCount() <= -7;
    const target = accumulate
        ? (lastStageOneRecoveryTarget === null ? Math.max(recoveryActionCount, requestedTarget)
            : recoveryActionCount + Math.max(0, requestedTarget - lastStageOneRecoveryTarget))
        : requestedTarget;
    lastStageOneRecoveryTarget = accumulate ? requestedTarget : null;
    const firstSlot = accumulate ? 0 : recoveryWindowStart(target);
    if(!accumulate) removeNodesFromCanvas(new Set(rootNodes.filter(node =>
        node.recovery && !node.timeRecovery && Number.isFinite(node.recoverySlot) &&
        (node.recoverySlot < firstSlot || node.recoverySlot >= target)
    )));
    if(target > 0) ensureRecoveryBridgeBase();
    const existingSlots = new Set(rootNodes.filter(node => node.recovery && !node.recoveryOffshoot && !node.timeRecovery).map(node => node.recoverySlot));
    for(let slot = firstSlot; slot < target; slot++) {
        if(existingSlots.has(slot)) continue;
        freeActionNodeCapacity(3);
        const node = createBridgeNode(null, "recovery", slot);
        if(node) {
            createRecoveryOffshoot(node, slot);
            if(recoveryCollapseFactor() < 0.72 && stableRand(`recovery-burst-extra-${slot}`, 6) > 0.32) {
                createRecoveryOffshoot(node, slot + 2000);
            }
        }
    }
    recoveryActionCount = target;
    // A stage's colors and clamped metrics can stay unchanged while roots grow.
    lastBrightnessStateKey = "";
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
    linkLayer.selectAll(".root-link-hit")
        .filter(d => d && (d.intervention || d.recovery || removedNodes.has(d.source) || removedNodes.has(d.target)))
        .remove();
    supportLayer.selectAll(".edge-support-root")
        .filter(d => d && (d.intervention || d.recovery || removedNodes.has(d.source)))
        .remove();
    supportLayer.selectAll(".edge-support-root-hit")
        .filter(d => d && (d.intervention || d.recovery || removedNodes.has(d.source)))
        .remove();
    refreshFormMode();
}

function removeInterventionActionRoots() {
    const removedNodes = new Set(rootNodes.filter(node => node.intervention));
    if(!removedNodes.size) return;

    rootNodes = rootNodes.filter(node => !removedNodes.has(node));
    rootLinks = rootLinks.filter(link =>
        !link.intervention &&
        !removedNodes.has(link.source) &&
        !removedNodes.has(link.target)
    );
    supportRoots = supportRoots.filter(support =>
        !support.intervention &&
        !removedNodes.has(support.source)
    );

    nodeLayer.selectAll(".root-node")
        .filter(d => removedNodes.has(d))
        .remove();
    linkLayer.selectAll(".root-link")
        .filter(d => d && (d.intervention || removedNodes.has(d.source) || removedNodes.has(d.target)))
        .remove();
    linkLayer.selectAll(".root-link-hit")
        .filter(d => d && (d.intervention || removedNodes.has(d.source) || removedNodes.has(d.target)))
        .remove();
    supportLayer.selectAll(".edge-support-root")
        .filter(d => d && (d.intervention || removedNodes.has(d.source)))
        .remove();
    supportLayer.selectAll(".edge-support-root-hit")
        .filter(d => d && (d.intervention || removedNodes.has(d.source)))
        .remove();
    refreshFormMode();
}

function resetActionMorphToBase() {
    rootNodes.forEach(node => {
        ensureBasePosition(node);
        if(node.layer === "anchorage") {
            node.x = node.baseX;
            node.y = node.baseY;
            return;
        }
        if(node.intervention || node.recovery) return;
        node.x = node.baseX;
        node.y = node.baseY;
    });
    rerenderNodes();
    rerenderLinks();
    rerenderSupportRoots();
    renderBridgeGuides();
    refreshFormMode();
}

// --- Core growth-rule engine ---
function createBridgeNode(seedRow = null, seedMode = "live", seedIndex = null) {
    if((seedMode === "intervention" || seedMode === "recovery") && rootNodes.length >= MAX_NODES) {
        freeActionNodeCapacity(1);
    }
    if(rootNodes.length >= MAX_NODES && !(seedMode === "recovery" && manualInterventionCount() <= -7)) {
        metrics.lastIntervention = "Root field is full; existing growth is preserved instead of being rebuilt.";
        if(!bulkRenderDepth) updateSystemMonitor();
        return null;
    }
    if(seedMode === "live" && rootNodes.filter(node => node.seedMode === "live").length >= MAX_LIVE_MICROBE_NODES) {
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
        const contraction = contractionStrength();
        const progress = clamp((strand + 0.5) / 9 + (rand(14) - 0.5) * 0.12, 0, 1);
        const knotProgress = 0.5 + (progress - 0.5) * (1 - contraction * 0.46);
        const upwardBurst = 18 + rung * (5 + contraction * 2) + rand(15) * (34 + contraction * 18);
        const violentOffset = Math.sin(slot * 1.71) * (22 + rung * 1.1 + contraction * 28) + (rand(16) - 0.5) * (112 - contraction * 36);
        x = leftX + (rightX - leftX) * knotProgress + violentOffset;
        y = clamp(midY - upwardBurst + Math.cos(slot * 1.19) * (18 + contraction * 22), midY - height * 0.18, midY + height * 0.08);
        textToken = `[${config.year}] human intervention pollution layer`;
        sourceLabel = `deformed growth layer: CO2e ${metrics.humanCo2Kg.toFixed(1)} kg / stress ${(metrics.stressLevel * 100).toFixed(0)}%`;
    }
    else if(seedMode === "recovery") {
        const side = seedIndex % 2 === 0 ? "left" : "right";
        const oppositeSide = side === "left" ? "right" : "left";
        const oppositeAnchor = getAnchorNode(oppositeSide);
        parentNode = getRecoveryParent(side, seedIndex);
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
        if(!isCumulativeSeed && seedMode === "live" && otu) {
            const liveParents = rootNodes
                .filter(node => node.layer !== "anchorage" && !node.intervention)
                .filter(node => node.seedMode !== "support-under")
                .slice(-96);
            parentNode = liveParents.length
                ? liveParents[Math.floor(rand(32) * liveParents.length)]
                : getBridgeParent("mesh", geometry.leftX + (geometry.rightX - geometry.leftX) * rand(33), geometry.midY);

            const richness = clamp(Math.log10((otu.totalObs || 1) + 1) / 7, 0.12, 1);
            const prevalence = clamp(Math.log10((otu.numSamples || 1) + 1) / 4, 0.1, 1);
            const parentSide = parentNode && parentNode.side ? parentNode.side : (rand(34) > 0.5 ? "left" : "right");
            const sideDrift = parentSide === "left" ? 1 : -1;
            const zigzagSign = rand(35) > 0.5 ? 1 : -1;
            const branchStep = 22 + richness * 58 + rand(36) * 44;
            const lateralJitter = (rand(37) - 0.5) * (52 + prevalence * 90);
            const verticalJitter = (rand(38) - 0.5) * (70 + metrics.meshAmplitude * 1.2);
            const sawOffset = zigzagSign * (18 + prevalence * 58 + rand(39) * 32);
            const awayFromDeck = parentNode && parentNode.y > geometry.midY ? -1 : 1;

            layerName = choose(["mesh", "mesh", "deck", "primary"]);
            x = parentNode.x + sideDrift * branchStep + lateralJitter;
            y = parentNode.y
                + verticalJitter
                + sawOffset
                + awayFromDeck * (rand(40) - 0.2) * 36
                + (growthState === "recovery" ? 16 : -metrics.stressLevel * 10);

            // Keep live microbes from collapsing back into the formal bridge deck.
            if(Math.abs(y - geometry.midY) < 18) y += zigzagSign * (26 + rand(41) * 34);

            textToken = getMetaphor(otu.taxonomy, otu.genus || "behavior bacteria");
            sourceLabel = `live microbial variation: ${otu.phylum || "atmospheric load"} / observations ${Math.round(otu.totalObs || 0)}`;
        } else {
            layerName = growthState === "recovery"
                ? (isCumulativeSeed ? cumulativeLayerFor(seedRow, "bridge") : choose(["primary", "mesh", "deck"]))
                : choose(["primary", "primary", "mesh"]);
            
            const rawProgress = isCumulativeSeed
                ? clamp(((seedRow.year || START_YEAR) - START_YEAR) / Math.max(1, CURRENT_YEAR - START_YEAR), 0, 1)
                : (rootNodes.length % 300) / 300;
            const profile = regionalGrowthProfile(seedRow);
            const progress = clamp(Math.pow(rawProgress, profile.progressWarp) + (rand(32) - 0.5) * profile.brokenness * 0.18, 0, 1);
            const left = geometry.leftX + 30;
            const right = geometry.rightX - 30;
            const archLift = Math.sin(progress * Math.PI) * profile.archWeight;
            const localWave = Math.sin(progress * Math.PI * (2.2 + rand(33) * 2.4) + profile.countryDrift * Math.PI * 2);
            const secondaryWave = Math.cos(progress * Math.PI * (3.1 + rand(34) * 1.8) + rand(35) * Math.PI);
            const contraction = growthState === "pollution" ? contractionStrength() : 0;
            const scatterX = (rand(4) - 0.5) * profile.horizontalScatter * (1 - contraction * 0.28);
            const scatterY = (rand(5) - 0.5) * profile.verticalScatter * (1 + contraction * 0.42);
            const climateLift = growthState === "pollution" ? -metrics.stressLevel * 18 : profile.branchLift;
            const pollutionLift = growthState === "pollution" ? height * 0.13 + metrics.meshAmplitude * 0.55 : 0;
            const recoveryDrop = growthState === "recovery" ? 22 : 0;

            x = left + (right - left) * (0.5 + (progress - 0.5) * (1 - contraction * 0.3)) + scatterX + localWave * profile.waveAmp * (0.32 + contraction * 0.18);
            y = geometry.midY
                - archLift * (height * 0.12 + metrics.meshAmplitude * 0.75)
                - pollutionLift * archLift
                + localWave * profile.waveAmp * (0.36 + contraction * 0.26)
                + secondaryWave * profile.waveAmp * (0.18 + contraction * 0.18)
                + scatterY
                + profile.downwardBias
                + climateLift
                + recoveryDrop;
            parentNode = getBridgeParent(layerName, x, y);
        }

        if (seedRow) {
            textToken = `[${seedRow.year}] ${seedRow.biome}`;
            sourceLabel = `cumulative EMP frame: ${seedRow.sampleId} / ${seedRow.biome}`;
        } else if (otu && seedMode !== "live") {
            // Replace Latin names with metaphorical ecological text.
            textToken = getMetaphor(otu.taxonomy, otu.genus || "behavior bacteria");
            sourceLabel = `intervention-induced ecosystem: ${otu.phylum || "atmospheric load"}`;
        } else if (!(seedMode === "live" && otu)) {
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
        recoverySlot: isRecoverySeed ? seedIndex : null,
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
        const linkKind = seedMode === "recovery"
            ? "recovery"
            : (seedMode === "live" && isIntervened ? "microbe" : (seedMode === "downward" || seedMode === "intervention" ? "cross" : (isIntervened ? "primary" : "cross")));
        addBridgeLink(parentNode, node, linkKind, node.intervention, node.activeIntervention, node.recovery);
    }
    if(!node.recovery && !(seedMode === "live" && isIntervened)) connectStructuralNeighbors(node, isIntervened);
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
    const microbialBend = interventionSign * (22 + stableRand(`${source.id}-${target.id}`, 45) * 86);
    const bend = (recovery || source.upperBridgeRoot || target.upperBridgeRoot)
        ? recoveryBend
        : (intervention ? interventionSign * (35 + stableRand(`${source.id}-${target.id}`, 43) * 96) : (kind === "microbe" ? microbialBend : (kind === "cross" ? 7 : 18 * linkShapeStress(link))));
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

function nodeMeaning(node) {
    if(!node) return "A data point translated into root growth.";
    if(node.layer === "anchorage") return "This support point holds the bridge shape in place.";
    if(node.intervention) return node.activeIntervention
        ? "Human pressure is bending this growth upward."
        : "A remaining trace of past human pressure.";
    if(node.recovery) return "A recovery action is reconnecting damaged strands.";
    if(node.seedMode === "support-under") return "A seasonal soil sample continues growth below the bridge.";
    if(node.seedMode === "downward") return "A nearby EMP soil sample grows as a downward root.";
    if(node.seedMode === "bridge") return "An EMP microbial sample becomes part of the bridge body.";
    if(node.seedMode === "live" && (String(node.source || "").includes("intervention-induced") || String(node.source || "").includes("live microbial variation"))) {
        return "An OTU microbial community appears through human pressure.";
    }
    return "Local air and soil conditions are translated into root growth.";
}

function lineMeaning(item) {
    if(item.supportUnder || item.seasonalBaseSupport) return "Archived seasonal soil growth.";
    if(item.recovery) return "Former recovery path reconnecting the bridge.";
    if(item.intervention) return item.activeIntervention
        ? "Human pressure is pulling this strand out of balance."
        : "Past human pressure, now fading into the bridge.";
    if(item.kind === "microbe") return "Live microbial values branch irregularly from existing roots.";
    if(item.kind === "cross") return "Archived microbial link between local samples.";
    return "Older structural strand in the root bridge.";
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
    const rows = [
        { label: "Meaning", value: nodeMeaning(node) },
        { label: "Root", value: dataKeywordForNode(node) },
        { label: "Place", value: config.locName }
    ];

    if(node && (node.seedMode === "bridge" || node.seedMode === "downward" || node.seedMode === "support-under")) {
        rows.push({ label: "Sample", value: readableNodeLabel(node) });
    } else if(node && node.intervention) {
        rows.push({ label: "Pressure", value: co2MetricValue() });
    } else if(node && node.recovery) {
        rows.push({ label: "Recovery", value: `${recoveryActionCount} clean roots` });
    }

    return tooltipRows(rows);
}

function lineTooltipTitle(item) {
    if(item.supportUnder) return "Seasonal EMP Sample";
    if(item.seasonalBaseSupport) return "Below-Support Growth";
    if(item.recovery) return "Recovery Root";
    if(item.intervention) return item.activeIntervention ? "Intervention Pollution Layer" : "Past Pollution Trace";
    if(item.kind === "microbe") return "Live Microbial Branch";
    if(item.kind === "cross") return "OTU / Microbial Link";
    return "Structural Link";
}

function lineTooltipRows(item) {
    const isSupportRoot = item && !item.kind && item.source && item.target;
    return [
        { label: "Meaning", value: lineMeaning(item) },
        { label: "Strand", value: isSupportRoot ? "Anchor / Structural Support" : lineTooltipTitle(item) },
        { label: "Place", value: config.locName }
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
    const path = linkLayer.append("path").datum(link).attr("class", `root-link root-fresh ${link.kind}-link${link.intervention ? " intervention-root" : ""}${link.activeIntervention ? " active-intervention" : ""}`).attr("d", linkPath(link))
        .attr("stroke", link.intervention ? getInterventionColor(link) : (link.recovery ? getRecoveryColor(link) : getRootStrokeColor()))
        .attr("stroke-width", getLinkStrokeWidth(link))
        .style("stroke-opacity", getLinkStrokeOpacity(link));

    attachLineTooltip(path);
    if(link.intervention && link.activeIntervention) path.raise();
    else path.lower();
    if(link.kind !== "microbe") {
        const hitPath = linkLayer.append("path").datum(link).attr("class", "root-link-hit").attr("d", linkPath(link))
            .attr("stroke", "rgba(0,0,0,0.001)")
            .attr("stroke-width", 18)
            .attr("fill", "none")
            .style("pointer-events", "stroke");

        attachLineTooltip(hitPath);
        hitPath.raise();
    }
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
        .attr("class", `edge-support-root root-fresh${support.intervention ? " intervention-root" : ""}${support.activeIntervention ? " active-intervention" : ""}`)
        .attr("d", supportPath)
        .attr("stroke", support.intervention ? getInterventionColor(support) : (support.recovery ? getRecoveryColor(support) : getRootStrokeColor()))
        .attr("stroke-width", getSupportStrokeWidth(support))
        .style("stroke-opacity", getSupportStrokeOpacity(support));

    const hitPath = supportLayer.append("path")
        .datum(support)
        .attr("class", "edge-support-root-hit")
        .attr("d", supportPath)
        .attr("stroke", "rgba(0,0,0,0.001)")
        .attr("stroke-width", 18)
        .attr("fill", "none")
        .style("pointer-events", "stroke");

    attachLineTooltip(path);
    attachLineTooltip(hitPath);
    if(support.intervention && support.activeIntervention) path.raise();
    else path.lower();
    hitPath.raise();
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
    supportLayer.selectAll(".edge-support-root-hit").attr("d", supportPath);
}

function rerenderLinks() {
    linkLayer.selectAll(".root-link").attr("d", linkPath);
    linkLayer.selectAll(".root-link-hit").attr("d", linkPath);
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
    const group = nodeLayer.append("g").datum(node).attr("class", `root-node root-fresh ${node.layer}-node${node.intervention ? " intervention-root" : ""}${node.activeIntervention ? " active-intervention" : ""}`).attr("transform", `translate(${node.x}, ${node.y})`);
    const interventionRadius = 3.25 + Math.max(0, 1 - contractionStrength()) * 0.65;
    const radius = node.upperBridgeRoot ? (node.upperBridgeTwig ? 1.6 : 2.6) : node.recovery ? (node.recoveryOffshoot ? 2.0 : 3.2) : (node.intervention ? interventionRadius : (node.layer === "anchorage" ? 5.5 : node.layer === "primary" ? 3.6 : node.layer === "mesh" ? 2.6 : 2.1));
    
    const hit = group.append("circle").attr("class", "root-node-hit")
        .attr("r", Math.max(13, radius * 3.6))
        .style("fill", "transparent")
        .style("stroke", "transparent")
        .style("pointer-events", "all");

    const dot = group.append("circle").attr("class", "root-dot-node root-fresh")
        .attr("r", radius)
        .style("fill", getNodeRootColor(node))
        .style("stroke", getNodeRootColor(node))
        .style("stroke-width", node.layer === "anchorage" ? 1.4 : 0.6)
        .style("opacity", getNodeOpacity(node))
        .style("pointer-events", "none");

    const showNodeTooltip = function(e, d) {
        dot.interrupt()
            .transition()
            .duration(130)
            .attr("r", d.layer === "anchorage" ? radius * 1.18 : radius * 1.25)
            .style("opacity", 1)
            .style("stroke-width", d.layer === "anchorage" ? 2.1 : 1.15);
        tooltip.style("display", "block").html(nodeTooltipHtml(d));
    };
    const moveNodeTooltip = function(e) {
        tooltip.style("left", `${e.pageX - 180}px`).style("top", `${e.pageY - 70}px`);
    };
    const hideNodeTooltip = function(e, d) {
        const parent = d3.select(this.parentNode);
        if(!parent.classed("anchor-dragging")) {
            dot.transition()
                .duration(160)
                .attr("r", radius)
                .style("opacity", getNodeOpacity(d))
                .style("stroke-width", d.layer === "anchorage" ? 1.4 : 0.6);
        }
        tooltip.style("display", "none");
    };

    hit.on("mouseover", showNodeTooltip)
        .on("mousemove", moveNodeTooltip)
        .on("mouseleave", hideNodeTooltip);

    if(node.layer === "anchorage") {
        let dragStart = null;
        let anchorMoved = false;
        group.style("cursor", "move")
            .on("pointerdown.block-zoom mousedown.block-zoom touchstart.block-zoom", function(event) {
                event.stopPropagation();
            })
            .call(d3.drag()
                .filter(event => !event.button && (event.detail || 0) < 2)
                .on("start", function(event) {
                    dragStart = { x: event.x, y: event.y };
                    anchorMoved = false;
                    if(typeof resetElasticPointer === "function") resetElasticPointer();
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
                    if(!anchorMoved && Math.hypot(event.x - dragStart.x, event.y - dragStart.y) * currentZoomTransform.k < 5) return;
                    anchorMoved = true;
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
                    if(anchorMoved) {
                        d.baseX = d.x;
                        d.baseY = d.y;
                    }
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
        .style("opacity", function(d) { return d && d.recovery ? getNodeOpacity(d) * 0.76 : (d && d.intervention ? interventionOpacity("aged-node", d.activeIntervention) : getAgedRootOpacity()); });

    svg.selectAll(".root-link.root-aged")
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, true) : getAgedRootColor()); })
        .attr("stroke-width", function(d) { return getLinkStrokeWidth(d, true); })
        .style("stroke-opacity", function(d) { return getLinkStrokeOpacity(d, true); });

    svg.selectAll(".edge-support-root.root-aged")
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, true) : getAgedRootColor()); })
        .attr("stroke-width", function(d) { return getSupportStrokeWidth(d); })
        .style("stroke-opacity", function(d) { return getSupportStrokeOpacity(d, true); });
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
    if(node && node.upperBridgeRoot) return node.upperBridgeTwig ? 0.28 : 0.46;
    if(node && node.recovery) return (node.recoveryOffshoot ? 0.64 : 0.82) * (1 - recoveryCollapseFactor() * (node.recoveryOffshoot ? 0.58 : 0.34));
    if(node && node.intervention) return interventionOpacity("node", node.activeIntervention);
    if(node && node.layer === "anchorage") return 1;
    if(node && node.layer === "primary") return 0.82;
    if(node && node.layer === "mesh") return 0.58;
    if(node && node.seedMode === "support-under") return 0.76;
    return 0.42;
}

function applyBrightness(restart = true) {
    const isDark = config.brightness < 40;
    const brightnessStateKey = `${config.brightness}:${manualInterventionCount()}:${lastColorStateKey}:${metrics.stressLevel.toFixed(3)}:${metrics.decay.toFixed(3)}:${metrics.plasticWasteKg.toFixed(3)}`;
    if(!restart && brightnessStateKey === lastBrightnessStateKey) return;
    lastBrightnessStateKey = brightnessStateKey;
    document.getElementById("right-panel").style.backgroundColor = "";
    if(!draggingAnchor && !draggingRoot) {
        applyBridgeStressMorph();
        rerenderNodes();
        renderBridgeGuides();
    }
    svg.selectAll(".root-dot-node")
        .style("fill", function(d) { return getNodeRootColor(d, d3.select(this).classed("root-aged")); })
        .style("stroke", function(d) { return getNodeRootColor(d, d3.select(this).classed("root-aged")); })
        .style("opacity", function(d) { return d && d.recovery ? (d3.select(this).classed("root-aged") ? getNodeOpacity(d) * 0.76 : getNodeOpacity(d)) : (d && d.intervention ? interventionOpacity(d3.select(this).classed("root-aged") ? "aged-node" : "node", d.activeIntervention) : (d3.select(this).classed("root-aged") ? getAgedRootOpacity() : getNodeOpacity(d))); });
    svg.selectAll(".root-link")
        .attr("d", linkPath)
        .style("display", function(d) { return shouldHideCollapsedRecovery(d) ? "none" : null; })
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, d3.select(this).classed("root-aged")) : (d3.select(this).classed("root-aged") ? getAgedRootColor() : getRootStrokeColor())); })
        .attr("stroke-width", function(d) { return getLinkStrokeWidth(d, d3.select(this).classed("root-aged")); })
        .style("stroke-opacity", function(d) { return getLinkStrokeOpacity(d, d3.select(this).classed("root-aged")); })
        .classed("active-intervention", d => !!(d && d.intervention && d.activeIntervention))
        .classed("trace-intervention", d => !!(d && d.intervention && !d.activeIntervention));
    svg.selectAll(".edge-support-root")
        .attr("d", supportPath)
        .style("display", function(d) { return shouldHideCollapsedRecovery(d) ? "none" : null; })
        .attr("stroke", function(d) { return d && d.intervention ? getInterventionColor(d) : (d && d.recovery ? getRecoveryColor(d, d3.select(this).classed("root-aged")) : (d3.select(this).classed("root-aged") ? getAgedRootColor() : getRootStrokeColor())); })
        .attr("stroke-width", function(d) { return getSupportStrokeWidth(d); })
        .style("stroke-opacity", function(d) { return getSupportStrokeOpacity(d, d3.select(this).classed("root-aged")); })
        .classed("active-intervention", d => !!(d && d.intervention && d.activeIntervention))
        .classed("trace-intervention", d => !!(d && d.intervention && !d.activeIntervention));
    svg.selectAll(".root-link-hit")
        .attr("d", linkPath)
        .style("display", function(d) { return shouldHideCollapsedRecovery(d) ? "none" : null; });
    svg.selectAll(".edge-support-root-hit")
        .attr("d", supportPath)
        .style("display", function(d) { return shouldHideCollapsedRecovery(d) ? "none" : null; });
    svg.selectAll(".root-node")
        .style("display", function(d) { return shouldHideCollapsedRecovery(d) ? "none" : null; })
        .classed("active-intervention", d => !!(d && d.intervention && d.activeIntervention))
        .classed("trace-intervention", d => !!(d && d.intervention && !d.activeIntervention));
    if(restart) updateGrowthEngine();
}

function updateGrowthEngine() {
    if(growInterval) clearInterval(growInterval); growInterval = null;
    if(config.paused) return;
    if(rootNodes.length >= MAX_NODES) return;
    if(rootNodes.filter(node => node.seedMode === "live").length >= MAX_LIVE_MICROBE_NODES) return;
    
    const modeBoost = config.growthMode === "dense" ? 2.2 : 0;
    const climateSpeed = clamp(0.28 + climateGrowthSuitability() * 1.12, 0.28, 1.35);
    const currentSpeed = clamp((1.2 + metrics.stressLevel * 5.0 + modeBoost) * climateSpeed, 0.25, 12);
    
    const intervalMs = Math.max(LIVE_GROWTH_MIN_INTERVAL_MS, 2800 / currentSpeed);
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
    const previousManualValue = manualInterventionCount();
    let previousOverlayCount = currentInterventionNodeCount();
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
    const currentManualValue = manualInterventionCount();
    if(currentManualValue > 0 && previousManualValue <= 0) {
        removeInterventionActionRoots();
        syncRecoveryRootsToCount(reliefRecoveryTargetForValue(currentManualValue), type);
        previousOverlayCount = 0;
    } else if(currentManualValue === 0) {
        removeInterventionActionRoots();
        syncRecoveryRootsToCount(reliefRecoveryTargetForValue(0), type);
        previousOverlayCount = 0;
        resetActionMorphToBase();
    }
    let nextOverlayCount = getInterventionOverlayCount();
    if(currentManualValue < 0) {
        nextOverlayCount = 0;
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
        syncRecoveryRootsToCount(recoveryRootTargetForValue(currentManualValue), type);
        dissolveInterventionRoots(Math.min(RECOVERY_DISSOLVE_NODES, Math.abs(currentManualValue) + 1));
    } else if(currentManualValue > 0 && delta > 0 && config[type] > 0) {
        nextOverlayCount = Math.max(nextOverlayCount, previousOverlayCount + 4);
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    } else if(currentManualValue > 0 && delta > 0 && nextOverlayCount <= previousOverlayCount) {
        nextOverlayCount = previousOverlayCount + 1;
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    } else if(currentManualValue > 0 && delta < 0) {
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
        syncRecoveryRootsToCount(reliefRecoveryTargetForValue(currentManualValue), type);
    } else {
        markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
        syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    }
    metrics.lastIntervention = alertMsg;
    syncUpperBridgeRoots();
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
        anchorPositions[node.side] = {
            x: Number.isFinite(node.baseX) ? node.baseX : node.x,
            y: Number.isFinite(node.baseY) ? node.baseY : node.y
        };
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
    slider.value = clamp(manualInterventionCount(), -8, 8);
}

function recoveryRootTargetForValue(value) {
    if(value >= 0) return 0;
    const cleanSteps = Math.abs(value);
    // Ease into recovery, meeting the existing target again at -6.
    if(cleanSteps < 6) return Math.round(8 + (cleanSteps - 1) * 58 / 5);
    return Math.round(12 + cleanSteps * 9);
}

function reliefRecoveryTargetForValue(value) {
    if(value < 0) return 0;
    if(value === 0) return 8;
    const stressValue = clamp(value, 0, 8);
    const relief = clamp((8 - stressValue) / 8, 0, 1);
    return Math.round(relief * 18);
}

function applyPollutionPreview(value) {
    const previousManualValue = manualInterventionCount();
    let previousOverlayCount = currentInterventionNodeCount();
    distributePollutionPreview(value);
    updateInterventionState();
    if(value > 0 && previousManualValue <= 0) {
        removeInterventionActionRoots();
        syncRecoveryRootsToCount(reliefRecoveryTargetForValue(value), "preview");
        previousOverlayCount = 0;
    } else if(value === 0) {
        removeInterventionActionRoots();
        syncRecoveryRootsToCount(reliefRecoveryTargetForValue(0), "preview");
        previousOverlayCount = 0;
        resetActionMorphToBase();
    }
    let nextOverlayCount = getInterventionOverlayCount();
    if(value > 0 && nextOverlayCount <= previousOverlayCount) {
        nextOverlayCount = previousOverlayCount + 1;
    }
    markLatestInterventionSlots(previousOverlayCount, nextOverlayCount);
    syncInterventionOverlay(previousOverlayCount, nextOverlayCount);
    if(value < 0) {
        const previewRecoveryCount = recoveryRootTargetForValue(value);
        syncRecoveryRootsToCount(previewRecoveryCount, "preview");
        dissolveInterventionRoots(Math.min(RECOVERY_DISSOLVE_NODES, Math.abs(value) + 1));
    } else if(value >= 0) {
        syncRecoveryRootsToCount(reliefRecoveryTargetForValue(value), "preview");
    }
    metrics.lastIntervention = `Preview pollution value ${value}: intervention counters distributed automatically.`;
    updateColorState();
    syncUpperBridgeRoots();
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
    // Reset human actions and rebuild the current baseline bridge.
    ["transport","climate","shopping","delivery","streaming"].forEach(k => { config[k]=0; document.getElementById(`val-${k}`).innerText=0; });
    activeInterventionStart = 0;
    activeInterventionEnd = 0;
    recoveryActionCount = 0;
    lastStageOneRecoveryTarget = null;
    updateInterventionState();
    clearAndResetCanvas();
    syncEmpMetrics();
    seedCumulativeBridge();
    updatePollutionMap();
    applyBrightness(false);
    updateMetricMonitor();
    updateCounterButtons();
    syncPollutionSlider();
    updateGrowthEngine();
});
