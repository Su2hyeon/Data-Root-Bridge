const monitorValueCache = {};
const monitorFlashTimers = {};

function setMonitorValue(id, value) {
    const text = String(value);
    const previous = monitorValueCache[id];
    setText(id, text);
    monitorValueCache[id] = text;

    const el = document.getElementById(id);
    if(!el || previous === undefined || previous === text) return;

    el.classList.remove("metric-changed");
    void el.offsetWidth;
    el.classList.add("metric-changed");
    if(monitorFlashTimers[id]) clearTimeout(monitorFlashTimers[id]);
    monitorFlashTimers[id] = setTimeout(() => {
        el.classList.remove("metric-changed");
    }, 900);
}

function updateMetricMonitor() {
    const adjusted = getHumanAdjustedMetrics();
    setMonitorValue("txt-selected-year", `${selectedMonthLabel()} ${config.year}`);
    setMonitorValue("txt-air", `${adjusted.airTemp.toFixed(1)} °C`);
    setMonitorValue("txt-pm25", `${adjusted.pm25.toFixed(1)} ㎍/㎥`);
    setMonitorValue("txt-soil", `${adjusted.soilTemp.toFixed(1)} °C`);
    setMonitorValue("txt-moist", `${adjusted.soilMoisture.toFixed(2)} eco-index`);
    setMonitorValue("txt-pm10", `${adjusted.pm10.toFixed(1)} ㎍/㎥`);
    const co2Amount = Math.abs(metrics.humanCo2Kg).toFixed(2);
    setMonitorValue("txt-human-co2", metrics.humanCo2Kg < 0 ? `${co2Amount} kg reduced` : `${co2Amount} kg CO2e`);
    setMonitorValue("txt-plastic", `${metrics.plasticWasteKg.toFixed(2)} kg PP/PS`);
    updateSystemMonitor();
    document.body.classList.add("metrics-ready");
}

function updateSystemMonitor() {
    setText("txt-nodes", `${rootNodes.length} nodes`);
    const hasHumanIntervention = hasManualIntervention();
    setText("txt-stage", hasHumanIntervention ? "Human intervention deformation mode" : `${START_YEAR}-${config.year} cumulative bridge mode`);
}

function setupInfoOverlay() {
    const logoBtn = document.getElementById("info-logo");
    const infoOverlay = document.getElementById("info-overlay");
    const overlayLogoBtn = document.getElementById("info-overlay-logo");
    const backdrop = document.querySelector(".info-backdrop");

    if (!infoOverlay || infoOverlay.dataset.ready === "true") return;
    infoOverlay.dataset.ready = "true";

    function openInfoOverlay() {
        infoOverlay.classList.add("active");
        document.body.classList.add("info-open");
    }

    function closeInfoOverlay() {
        infoOverlay.classList.remove("active");
        document.body.classList.remove("info-open");
        if (document.activeElement && infoOverlay.contains(document.activeElement)) {
            document.activeElement.blur();
        }
    }

    function toggleInfoOverlay() {
        if (infoOverlay.classList.contains("active")) closeInfoOverlay();
        else openInfoOverlay();
    }

    window.openDataRootInfo = openInfoOverlay;
    window.closeDataRootInfo = closeInfoOverlay;

    setTimeout(openInfoOverlay, 100);

    if (logoBtn) {
        logoBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleInfoOverlay();
        });

        logoBtn.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            toggleInfoOverlay();
        });
    }

    if (overlayLogoBtn) {
        overlayLogoBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeInfoOverlay();
        });

        overlayLogoBtn.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            closeInfoOverlay();
        });
    }

    if (backdrop) {
        backdrop.addEventListener("click", closeInfoOverlay);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupInfoOverlay);
} else {
    setupInfoOverlay();
}
