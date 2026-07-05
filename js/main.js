const COLOR_STAGE_MIN = 1;
const COLOR_STAGE_MAX = 7;
const COLOR_STAGE_NORMAL = 4;
const COLOR_SCORE_RANGE = 7.5;

function colorScoreToStage(score) {
    const stageOffset = (clamp(score, -COLOR_SCORE_RANGE, COLOR_SCORE_RANGE) / COLOR_SCORE_RANGE) * (COLOR_STAGE_MAX - COLOR_STAGE_NORMAL);
    return Math.round(clamp(COLOR_STAGE_NORMAL + stageOffset, COLOR_STAGE_MIN, COLOR_STAGE_MAX));
}

function getColorScore() {
    const manualScore = manualInterventionCount();
    const historicalRecovery = Math.round((1 - getYearProgress()) * 9);
    return manualScore - historicalRecovery;
}

function updateColorState() {
    const colorScore = getColorScore();
    const colorStage = colorScoreToStage(colorScore);
    const colorStateKey = `${colorStage}`;
    if(colorStateKey === lastColorStateKey) return;
    lastColorStateKey = colorStateKey;
    lastBrightnessStateKey = "";
    document.documentElement.dataset.colorStage = String(colorStage);
}

function copySvgComputedStyles(sourceNode, targetNode) {
    if (sourceNode.nodeType !== Node.ELEMENT_NODE || targetNode.nodeType !== Node.ELEMENT_NODE) return;

    const computed = window.getComputedStyle(sourceNode);
    [
        "fill",
        "fill-opacity",
        "stroke",
        "stroke-opacity",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "opacity",
        "font-family",
        "font-size",
        "font-weight",
        "text-anchor",
        "dominant-baseline"
    ].forEach(prop => targetNode.style.setProperty(prop, computed.getPropertyValue(prop)));

    Array.from(sourceNode.children).forEach((child, index) => {
        copySvgComputedStyles(child, targetNode.children[index]);
    });
}

function exportRootImage() {
    const sourceSvg = document.querySelector("#root-canvas svg");
    if (!sourceSvg) return;

    const clonedSvg = sourceSvg.cloneNode(true);
    copySvgComputedStyles(sourceSvg, clonedSvg);
    clonedSvg.querySelectorAll(".pixel-root-number").forEach(label => label.remove());
    clonedSvg.querySelectorAll(".anchor-label").forEach(label => label.remove());

    const exportWidth = sourceSvg.clientWidth || width;
    const exportHeight = sourceSvg.clientHeight || height;
    clonedSvg.setAttribute("width", exportWidth);
    clonedSvg.setAttribute("height", exportHeight);
    clonedSvg.setAttribute("viewBox", `0 0 ${exportWidth} ${exportHeight}`);
    clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const serializedSvg = new XMLSerializer().serializeToString(clonedSvg);
    const svgBlob = new Blob([serializedSvg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = exportWidth;
        canvas.height = exportHeight;

        const context = canvas.getContext("2d");
        context.fillStyle = window.getComputedStyle(document.documentElement).getPropertyValue("--bg-white").trim() || "#ffffff";
        context.fillRect(0, 0, exportWidth, exportHeight);
        context.drawImage(image, 0, 0);
        URL.revokeObjectURL(svgUrl);

        const link = document.createElement("a");
        link.download = `data-root-bridge-${config.year}-${String(config.month).padStart(2, "0")}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    };

    image.onerror = () => URL.revokeObjectURL(svgUrl);
    image.src = svgUrl;
}

function setupRootExportButton() {
    const saveButton = document.getElementById("btn-save-root");
    if (!saveButton) return;
    saveButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        exportRootImage();
    });
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
    setupRootExportButton();
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
