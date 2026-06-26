let pixelFormLayer = null;
let pixelFormEnabled = false;
let pixelFormFrame = null;
const PIXEL_GRID = 13;

function pixelRootIndex(node, fallbackIndex = 0) {
    if(!node || node.layer === "anchorage") return fallbackIndex;
    return Number.isFinite(node.pixelOrder) ? node.pixelOrder : fallbackIndex;
}

function pixelBlockSize(node, index) {
    if(node.layer === "anchorage") return { width: 22, height: 22 };
    if(node.intervention) return { width: 32, height: 32 };
    if(node.recovery) return { width: 22, height: 22 };
    const sequence = pixelRootIndex(node, index) % 5;
    if(sequence === 0) return { width: 65, height: 26 };
    if(sequence === 2) return { width: 52, height: 26 };
    return { width: 30, height: 30 };
}

function pixelBlockPosition(node, index) {
    const size = pixelBlockSize(node, index);
    const x = Math.round((node.x - size.width / 2) / PIXEL_GRID) * PIXEL_GRID;
    const y = Math.round((node.y - size.height / 2) / PIXEL_GRID) * PIXEL_GRID;
    return { x, y, width: size.width, height: size.height };
}

function ensurePixelFormLayer() {
    if(pixelFormLayer) return pixelFormLayer;
    if(typeof viewport === "undefined") return null;
    pixelFormLayer = viewport.append("g").attr("class", "pixel-form-layer");
    return pixelFormLayer;
}

function pixelFormNodes() {
    if(typeof rootNodes === "undefined") return [];
    return rootNodes.filter(Boolean);
}

function pixelFormNodeNumber(node) {
    if(!node || node.layer === "anchorage") return "";
    return pixelRootIndex(node) + 1;
}

function preparePixelFormNodes() {
    const nodes = pixelFormNodes();
    let rootOrder = 0;
    nodes.forEach(node => {
        node.pixelOrder = node.layer === "anchorage" ? -1 : rootOrder++;
    });
    return nodes;
}

function pixelFormSegments() {
    if(typeof rootLinks === "undefined") return [];
    const segments = [];
    rootLinks
        .filter(link => link && link.source && link.target)
        .forEach((link, linkIndex) => {
            const x1 = Math.round(link.source.x / PIXEL_GRID) * PIXEL_GRID;
            const y1 = Math.round(link.source.y / PIXEL_GRID) * PIXEL_GRID;
            const x2 = Math.round(link.target.x / PIXEL_GRID) * PIXEL_GRID;
            const y2 = Math.round(link.target.y / PIXEL_GRID) * PIXEL_GRID;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const steps = Math.max(1, Math.ceil((Math.abs(dx) + Math.abs(dy)) / (PIXEL_GRID * 3.2)));

            for(let i = 1; i < steps; i++) {
                const progress = i / steps;
                const steppedX = Math.round((x1 + dx * progress) / PIXEL_GRID) * PIXEL_GRID;
                const steppedY = Math.round((y1 + dy * progress) / PIXEL_GRID) * PIXEL_GRID;
                const horizontal = Math.abs(dx) >= Math.abs(dy);
                segments.push({
                    id: `${linkIndex}-${i}`,
                    x: steppedX - (horizontal ? PIXEL_GRID : PIXEL_GRID * 0.5),
                    y: steppedY - (horizontal ? PIXEL_GRID * 0.5 : PIXEL_GRID),
                    width: horizontal ? PIXEL_GRID * 2 : PIXEL_GRID,
                    height: horizontal ? PIXEL_GRID : PIXEL_GRID * 2,
                    intervention: link.intervention,
                    activeIntervention: link.activeIntervention
                });
            }
        });
    return segments;
}

function refreshRootFormMode() {
    if(pixelFormFrame) return;
    pixelFormFrame = requestAnimationFrame(() => {
        pixelFormFrame = null;
        drawPixelFormMode();
    });
}

function drawPixelFormMode() {
    const layer = ensurePixelFormLayer();
    if(!layer) return;
    const canvas = document.getElementById("root-canvas");
    if(canvas) {
        canvas.classList.toggle("pixel-form-active", pixelFormEnabled);
        canvas.classList.toggle("root-form-active", pixelFormEnabled);
    }
    layer.style("display", pixelFormEnabled ? null : "none");
    if(!pixelFormEnabled) return;

    const nodes = preparePixelFormNodes();
    
    const blobLayer = layer.selectAll(".pixel-blob-layer")
        .data([null])
        .join("g")
        .attr("class", "pixel-blob-layer")
        .style("filter", null);

    const segments = pixelFormSegments();
    const segmentRects = blobLayer.selectAll(".pixel-root-segment")
        .data(segments, segment => segment.id);

    segmentRects.exit().remove();

    segmentRects.enter()
        .append("rect")
        .attr("class", "pixel-root-segment")
        .merge(segmentRects)
        .attr("x", segment => segment.x)
        .attr("y", segment => segment.y)
        .attr("width", segment => segment.width)
        .attr("height", segment => segment.height)
        .attr("rx", 0)
        .attr("ry", 0)
        .style("opacity", segment => segment.intervention && !segment.activeIntervention ? 0.32 : 0.72);

    const pixelBlocks = blobLayer.selectAll(".pixel-root-block")
        .data(nodes, node => node.id);

    pixelBlocks.exit().remove();

    pixelBlocks.enter()
        .append("rect")
        .attr("class", "pixel-root-block")
        .merge(pixelBlocks)
        .classed("pixel-anchor-block", node => node.layer === "anchorage")
        .attr("x", (node, index) => pixelBlockPosition(node, index).x)
        .attr("y", (node, index) => pixelBlockPosition(node, index).y)
        .attr("width", (node, index) => pixelBlockSize(node, index).width)
        .attr("height", (node, index) => pixelBlockSize(node, index).height)
        .attr("rx", 0)
        .attr("ry", 0)
        .style("opacity", node => node.intervention && !node.activeIntervention ? 0.52 : 0.9);

    const labels = layer.selectAll(".pixel-root-number")
        .data(nodes, node => node.id);

    labels.exit().remove();

    labels.enter()
        .append("text")
        .attr("class", "pixel-root-number")
        .merge(labels)
        .attr("x", (node, index) => {
            const box = pixelBlockPosition(node, index);
            return box.x + box.width / 2;
        })
        .attr("y", (node, index) => {
            const box = pixelBlockPosition(node, index);
            return box.y + box.height / 2;
        })
        .text(node => pixelFormNodeNumber(node));

    layer.raise();
}

function setPixelFormMode(enabled) {
    pixelFormEnabled = enabled;
    const button = document.getElementById("btn-pixel-form");
    if(button) button.classList.toggle("active", pixelFormEnabled);
    refreshRootFormMode();
}

function setupPixelFormToggle() {
    const pixelButton = document.getElementById("btn-pixel-form");
    if(pixelButton) pixelButton.addEventListener("click", () => {
        setPixelFormMode(!pixelFormEnabled);
    });
}
