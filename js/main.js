function stagedColor(prefix, position, fallback) {
    const value = clamp(position, 1, 5);
    const lowerStage = Math.floor(value);
    const upperStage = Math.ceil(value);
    const lowerColor = cssColor(`--${prefix}-stage-${lowerStage}`, fallback);
    const upperColor = cssColor(`--${prefix}-stage-${upperStage}`, lowerColor);
    if(lowerStage === upperStage) return lowerColor;
    return mixCssColor(lowerColor, upperColor, value - lowerStage);
}

function colorScoreToStage(score) {
    if(score >= 5) return 5;
    if(score === 4) return 4;
    if(score <= -5) return 1;
    if(score === -4) return 2;
    return 3;
}

function colorScoreToPosition(score) {
    return colorScoreToStage(score);
}

function getColorScore() {
    const manualScore = manualInterventionCount();
    const historicalRecovery = Math.round((1 - getYearProgress()) * 9);
    return manualScore - historicalRecovery;
}

function updateColorState() {
    const colorScore = getColorScore();
    const colorStage = colorScoreToStage(colorScore);
    const colorPosition = colorScoreToPosition(colorScore);
    const colorStateKey = `${colorStage}:${colorPosition.toFixed(3)}`;
    if(colorStateKey === lastColorStateKey) return;
    lastColorStateKey = colorStateKey;
    lastBrightnessStateKey = "";
    const rootColor = stagedColor("root", colorPosition, "#FF5E63");
    const interventionRootColor = stagedColor("root-intervention", colorPosition, rootColor);
    const recoveryRootColor = stagedColor("root-recovery", colorPosition, rootColor);
    const pixelRootColor = stagedColor("pixel-root", colorPosition, rootColor);
    const root = document.documentElement;
    root.style.setProperty("--bg-white", cssColor(`--bg-stage-${colorStage}`, cssColor("--bg-stage-3", "#f0f0f0")));
    root.style.setProperty("--text-main", stagedColor("text", colorPosition, "#a7a7a7"));
    root.style.setProperty("--text-dark", stagedColor("text", colorPosition, "#a7a7a7"));
    root.style.setProperty("--muted", stagedColor("text", colorPosition, "#a7a7a7"));
    root.style.setProperty("--globe-brown", stagedColor("globe", colorPosition, "#A7BA70"));
    root.style.setProperty("--root-fresh-color", rootColor);
    root.style.setProperty("--root-fresh-dark-color", rootColor);
    root.style.setProperty("--root-aged-color", rootColor);
    root.style.setProperty("--root-aged-dark-color", rootColor);
    root.style.setProperty("--root-intervention-color", interventionRootColor);
    root.style.setProperty("--root-intervention-old-color", rootColor);
    root.style.setProperty("--root-recovery-color", recoveryRootColor);
    root.style.setProperty("--root-recovery-old-color", rootColor);
    root.style.setProperty("--pixel-root-color", pixelRootColor);
    root.style.setProperty("--pixel-anchor-color", `color-mix(in srgb, ${pixelRootColor} 60%, black)`);
    root.style.setProperty("--pixel-number-color", stagedColor("pixel-number", colorPosition, "#3f3f3f"));
    root.style.setProperty("--border-color", "rgba(79, 164, 246, 0.22)");
}

window.onload = async () => {
    syncMonthParameterLimit();
    resizeCanvas();
    clearAndResetCanvas();
    await fetchEnvironmentData();
    updateCounterButtons();
    syncPollutionSlider();
    setupPixelFormToggle();
    setupInfoPanelToggle();
    setupMapToggle();
    setupEcosystemInteractions();
};

function setupInfoPanelToggle() {
    const toggleButton = document.getElementById("info-toggle");
    const wrapper = document.getElementById("app-wrapper");
    if(!toggleButton || !wrapper) return;

    toggleButton.addEventListener("click", () => {
        const collapsed = wrapper.classList.toggle("info-collapsed");
        toggleButton.textContent = collapsed ? "INFO +" : "INFO";
        setTimeout(() => {
            resizeCanvas();
        }, 260);
    });
}

function setupMapToggle() {
    const mapButton = document.getElementById("map-toggle");
    const wrapper = document.getElementById("app-wrapper");
    if(!mapButton || !wrapper) return;

    mapButton.addEventListener("click", () => {
        wrapper.classList.toggle("map-open");
        setTimeout(() => {
            if(window.map && typeof window.map.invalidateSize === "function") {
                window.map.invalidateSize();
            }
        }, 260);
    });
}

let ecosystemInteractionReady = false;
let elasticFrame = null;
let elasticPointer = null;

function ecosystemStressRatio() {
    return clamp((getColorScore() + 6) / 12, 0, 1);
}

function ecosystemFlexRatio() {
    return clamp(1 - ecosystemStressRatio(), 0.08, 1);
}

function elasticLinkPath(link, offsets) {
    const sourceOffset = offsets.get(link.source.id) || { x: 0, y: 0 };
    const targetOffset = offsets.get(link.target.id) || { x: 0, y: 0 };
    const source = { ...link.source, x: link.source.x + sourceOffset.x, y: link.source.y + sourceOffset.y };
    const target = { ...link.target, x: link.target.x + targetOffset.x, y: link.target.y + targetOffset.y };
    return linkPath({ ...link, source, target });
}

function applyElasticPointer() {
    elasticFrame = null;
    if(typeof draggingAnchor !== "undefined" && draggingAnchor) return;
    if(typeof draggingRoot !== "undefined" && draggingRoot) return;
    if(!elasticPointer || typeof nodeLayer === "undefined" || typeof linkLayer === "undefined") return;

    const flex = ecosystemFlexRatio();
    const radius = 165;
    const offsets = new Map();

    rootNodes.forEach(node => {
        const dx = node.x - elasticPointer.x;
        const dy = node.y - elasticPointer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if(distance > radius || node.layer === "anchorage") return;
        const force = Math.pow(1 - distance / radius, 1.7) * flex;
        offsets.set(node.id, {
            x: dx * force * 0.16,
            y: dy * force * 0.16 + Math.sin(Date.now() * 0.006 + node.id) * force * 5
        });
    });

    nodeLayer.selectAll(".root-node")
        .attr("transform", d => {
            const offset = offsets.get(d.id) || { x: 0, y: 0 };
            return `translate(${d.x + offset.x}, ${d.y + offset.y})`;
        });

    linkLayer.selectAll(".root-link")
        .attr("d", d => elasticLinkPath(d, offsets));
}

function setupElasticPointer() {
    if(typeof svg === "undefined" || typeof currentZoomTransform === "undefined") return;
    svg.on("mousemove.elastic", event => {
        const [screenX, screenY] = d3.pointer(event, svg.node());
        const point = currentZoomTransform.invert([screenX, screenY]);
        elasticPointer = { x: point[0], y: point[1] };
        if(!elasticFrame) elasticFrame = requestAnimationFrame(applyElasticPointer);
    });

    svg.on("mouseleave.elastic", () => {
        elasticPointer = null;
        if(typeof rerenderNodes === "function") rerenderNodes();
        if(typeof rerenderLinks === "function") rerenderLinks();
    });
}

function setupEcosystemInteractions() {
    if(ecosystemInteractionReady) return;
    ecosystemInteractionReady = true;
    setupElasticPointer();
}
