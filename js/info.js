function updateMetricMonitor() {
    const adjusted = getHumanAdjustedMetrics();
    setText("txt-selected-year", `${selectedMonthLabel()} ${config.year}`);
    setText("txt-air", `${adjusted.airTemp.toFixed(1)} °C`);
    setText("txt-pm25", `${adjusted.pm25.toFixed(1)} ㎍/㎥`);
    setText("txt-soil", `${adjusted.soilTemp.toFixed(1)} °C`);
    setText("txt-moist", `${adjusted.soilMoisture.toFixed(2)} eco-index`);
    setText("txt-pm10", `${adjusted.pm10.toFixed(1)} ㎍/㎥`);
    setText("txt-human-co2", `${metrics.humanCo2Kg.toFixed(2)} kg CO2e`);
    setText("txt-plastic", `${metrics.plasticWasteKg.toFixed(2)} kg PP/PS`);
    updateSystemMonitor();
    document.body.classList.add("metrics-ready");
}

function updateSystemMonitor() {
    setText("txt-nodes", `${rootNodes.length} nodes`);
    const hasHumanIntervention = hasManualIntervention();
    setText("txt-stage", hasHumanIntervention ? "Human intervention deformation mode" : `${START_YEAR}-${config.year} cumulative bridge mode`);
}
