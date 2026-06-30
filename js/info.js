function updateMetricMonitor() {
    const adjusted = getHumanAdjustedMetrics();
    setText("txt-selected-year", `${selectedMonthLabel()} ${config.year}`);
    setText("txt-air", `${adjusted.airTemp.toFixed(1)} °C`);
    setText("txt-pm25", `${adjusted.pm25.toFixed(1)} ㎍/㎥`);
    setText("txt-soil", `${adjusted.soilTemp.toFixed(1)} °C`);
    setText("txt-moist", `${adjusted.soilMoisture.toFixed(2)} eco-index`);
    setText("txt-pm10", `${adjusted.pm10.toFixed(1)} ㎍/㎥`);
    const co2Amount = Math.abs(metrics.humanCo2Kg).toFixed(2);
    setText("txt-human-co2", metrics.humanCo2Kg < 0 ? `${co2Amount} kg reduced` : `${co2Amount} kg CO2e`);
    setText("txt-plastic", `${metrics.plasticWasteKg.toFixed(2)} kg PP/PS`);
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
    const backdrop = document.querySelector(".info-backdrop");

    if (!infoOverlay || infoOverlay.dataset.ready === "true") return;
    infoOverlay.dataset.ready = "true";

    function openInfoOverlay() {
        infoOverlay.classList.add("active");
    }

    function closeInfoOverlay() {
        infoOverlay.classList.remove("active");
        if (document.activeElement && infoOverlay.contains(document.activeElement)) {
            document.activeElement.blur();
        }
    }

    window.openDataRootInfo = openInfoOverlay;
    window.closeDataRootInfo = closeInfoOverlay;

    setTimeout(openInfoOverlay, 100);

    if (logoBtn) {
        logoBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openInfoOverlay();
        });

        logoBtn.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            openInfoOverlay();
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
