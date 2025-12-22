import * as d3 from "d3";

function ensureRoot() {
  let root = document.getElementById("viz");
  if (!root) {
    root = document.createElement("div");
    root.id = "viz";
    document.body.appendChild(root);
  }
  return root;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function unwrapStyleValue(entry) {
  try {
    let current = entry;
    const seen = new Set();

    while (current && typeof current === "object" && !Array.isArray(current)) {
      if (seen.has(current)) break;
      seen.add(current);

      if (current.value !== undefined && current.value !== "") {
        current = current.value;
        continue;
      }
      if (current.color !== undefined && current.color !== "") {
        current = current.color;
        continue;
      }
      if (current.defaultValue !== undefined && current.defaultValue !== "") {
        return current.defaultValue;
      }
      if ("opacity" in current && current.opacity !== undefined && current.opacity !== "") {
        return current;
      }

      break;
    }

    return current;
  } catch {
    return entry;
  }
}

function getStyle(vizData, id, fallback) {
  const style = vizData?.style;

  try {
    const findEntry = (obj) => {
      if (obj == null) return undefined;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const nested = findEntry(item);
          if (nested !== undefined) return nested;
        }
        return undefined;
      }
      if (typeof obj !== "object") return undefined;

      if (id in obj) return obj[id];
      if (obj?.id === id) return obj;

      for (const key of Object.keys(obj)) {
        const nested = findEntry(obj[key]);
        if (nested !== undefined) return nested;
      }
      return undefined;
    };

    const entry = findEntry(style);
    const unwrapped = unwrapStyleValue(entry);
    if (unwrapped === undefined || unwrapped === null || unwrapped === "") return fallback;

    return unwrapped;
  } catch {
    return fallback;
  }
}

function toCssColor(value, fallback) {
  try {
    const resolved = unwrapStyleValue(value);
    if (typeof resolved === "string" && resolved.trim() !== "") return resolved;

    const c = typeof resolved === "object" && resolved !== null ? unwrapStyleValue(resolved.color) || resolved : null;
    if (typeof c === "string" && c.trim() !== "") return c;

    const hasRGB = c && typeof c === "object" && ["r", "g", "b"].every((k) => c[k] !== undefined && c[k] !== null);

    if (hasRGB) {
      const clampByte = (n) => Math.max(0, Math.min(255, Number(n) || 0));
      const alphaFromValue = Number.isFinite(resolved?.opacity) ? Number(resolved.opacity) : undefined;
      const alpha = Number.isFinite(c.a)
        ? Math.max(0, Math.min(1, c.a))
        : Math.max(0, Math.min(1, alphaFromValue ?? 1));
      return `rgba(${clampByte(c.r)}, ${clampByte(c.g)}, ${clampByte(c.b)}, ${alpha})`;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function getColor(vizData, id, fallback) {
  const raw = getStyle(vizData, id, fallback);
  return toCssColor(raw, fallback);
}

function resolveConfigIds(vizData, dimList, metricList) {
  const fields = vizData?.fields || {};
  const keys = Object.keys(fields);

  const firstDimId = dimList?.[0]?.id;
  const firstMetricId = metricList?.[0]?.id;

  const dimension =
    keys.find((k) => Array.isArray(fields[k]) && fields[k].some((f) => f.id === firstDimId)) || "dims";

  const metric =
    firstMetricId
      ? keys.find((k) => Array.isArray(fields[k]) && fields[k].some((f) => f.id === firstMetricId)) || "metric"
      : "metric";

  return { dimension, metric };
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseMetricValue(metricCell, fallback = 0) {
  try {
    let raw = metricCell;

    if (raw && typeof raw === "object") {
      if ("rawValue" in raw && raw.rawValue !== undefined) raw = raw.rawValue;
      else if ("value" in raw && raw.value !== undefined) raw = raw.value;
      else if ("formattedValue" in raw && raw.formattedValue !== undefined) raw = raw.formattedValue;
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric;

    if (typeof raw === "string") {
      const normalized = raw.replace(/[\s,\u00a0]/g, "");
      const normalizedNumber = Number(normalized);
      if (Number.isFinite(normalizedNumber)) return normalizedNumber;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function cellValue(cell) {
  if (cell == null) return null;
  if (typeof cell === "object") {
    if ("value" in cell && cell.value !== undefined) return cell.value;
    if ("formattedValue" in cell && cell.formattedValue !== undefined)
      return cell.formattedValue;
  }
  return cell;
}

function buildHierarchy(rows, dimFields, metricField, configIds) {
  const root = { name: "root", children: [], value: 0 };

  const dimConfigId = configIds?.dimension || "dims";
  const metricConfigId = configIds?.metric || "metric";

  const dimCount = Array.isArray(dimFields) ? dimFields.length : 0;

  const getOrCreateChild = (parent, name, rawValue) => {
    if (!parent.children) parent.children = [];
    let c = parent.children.find((x) => x.name === name);
    if (!c) {
      c = { name, rawValue, children: [], value: 0 };
      parent.children.push(c);
    } else if (!("rawValue" in c)) {
      c.rawValue = rawValue;
    }
    return c;
  };

  for (const r of rows) {
    let cur = root;
    for (let i = 0; i < dimCount; i++) {
      const field = dimFields[i];

      const fromConfig = Array.isArray(r[dimConfigId]) ? r[dimConfigId][i] : undefined;
      const fromFieldId = r[field?.id];
      const fromFieldArray = Array.isArray(fromFieldId) ? fromFieldId[i] : fromFieldId;

      const resolved = cellValue(fromConfig ?? fromFieldArray);
      const isMissing = resolved === null || resolved === undefined || resolved === "";
      if (isMissing) break;

      const rawValue = resolved;
      const val = String(resolved);
      cur = getOrCreateChild(cur, val, rawValue);
    }

    const metricCell = metricField
      ? Array.isArray(r[metricConfigId])
        ? r[metricConfigId][0]
        : r[metricField.id]
      : null;

    const m = metricField ? parseMetricValue(metricCell, 0) : 1;
    cur.value += m;
  }

  function roll(node) {
    if (!node.children || node.children.length === 0) return node.value || 0;
    let sum = 0;
    for (const c of node.children) sum += roll(c);
    node.value = sum;
    return sum;
  }
  roll(root);

  return root;
}

function drawViz(vizData) {
  const rootEl = ensureRoot();
  clear(rootEl);

  try {
    const dscc = window.dscc;
    if (!dscc) {
      rootEl.innerHTML =
        "<div class='empty-state'>dscc introuvable. Vérifie que dscc.min.js est bien concaténé dans dist/viz.js.</div>";
      return;
    }

    const d3lib = d3 || window.d3;

    if (!d3lib || typeof d3lib.hierarchy !== "function") {
      rootEl.innerHTML =
        "<div class='empty-state'>La librairie D3 n’a pas été chargée. Recharge la page ou rebuild le bundle.</div>";
      return;
    }

    const width = toNumber(dscc.getWidth(), 800);
    const height = toNumber(dscc.getHeight(), 600);

    const dims = vizData?.fields?.dims || vizData?.fields?.dimensions || [];
    const metrics = vizData?.fields?.metric || vizData?.fields?.metrics || [];

    const dimList = Array.isArray(dims) ? dims : [];
    const metricList = Array.isArray(metrics) ? metrics : [];

    const dimIds = dimList.map((d) => d.id).filter(Boolean);
    const metricId = metricList.length > 0 ? metricList[0].id : null;

    const configIds = resolveConfigIds(vizData, dimList, metricList);

    const rows = Array.isArray(vizData?.tables?.DEFAULT) ? vizData.tables.DEFAULT : [];

    if (!dimIds || dimIds.length < 2) {
      rootEl.innerHTML =
        "<div class='empty-state'>Ajoute au moins <b>2 dimensions</b> pour construire l’arbre.</div>";
      return;
    }

    if (!rows.length) {
      rootEl.innerHTML = "<div class='empty-state'>Aucune donnée.</div>";
      return;
    }

    const showLabels = Boolean(getStyle(vizData, "showLabels", true));
    const showValues = Boolean(getStyle(vizData, "showValues", false));
    const showValue = Boolean(getStyle(vizData, "showValue", showValues));
    const rootLabelRaw = getStyle(vizData, "rootLabel", "root");
    const rootLabel = rootLabelRaw == null ? "" : String(rootLabelRaw);
    const fontSize = toNumber(getStyle(vizData, "fontSize", 12), 12);
    const fontFamily = getStyle(vizData, "fontFamily", "Inter, Arial, sans-serif");
    const nodeRadius = toNumber(getStyle(vizData, "nodeRadius", 4), 4);
    const indent = toNumber(getStyle(vizData, "indent", 180), 180);
    const rowHeight = toNumber(getStyle(vizData, "rowHeight", 24), 24);
    const linkWidth = toNumber(getStyle(vizData, "linkWidth", 1.5), 1.5);
    const backgroundColor = getColor(vizData, "backgroundColor", "#ffffff");
    const labelColor = getColor(vizData, "labelColor", "#111111");
    const linkColor = getColor(vizData, "linkColor", "#9aa4b5");
    const nodeColor = getColor(vizData, "nodeColor", "#6c8cf5");
    const nodeCollapsedColor = getColor(vizData, "nodeCollapsedColor", "#324679");
    const showLegend = Boolean(getStyle(vizData, "showLegend", true));
    const enableZoom = Boolean(getStyle(vizData, "enableZoom", true));
    const enablePan = Boolean(getStyle(vizData, "enablePan", true));
    const showTooltip = Boolean(getStyle(vizData, "showTooltip", true));
    const interactions = vizData?.interactions || {};
    const filterAction = dscc?.InteractionType?.FILTER || "FILTER";
    const clickInteractionId = "click";
    const supportsFiltering = Array.isArray(interactions[clickInteractionId]?.supportedActions)
      ? interactions[clickInteractionId].supportedActions.includes(filterAction)
      : false;

    const data = buildHierarchy(rows, dimList, metricList[0], configIds) || { name: "root", children: [], value: 0 };

    rootEl.style.background = backgroundColor;
    rootEl.style.color = labelColor;
    rootEl.style.fontFamily = fontFamily;

    const container = document.createElement("div");
    container.className = "viz-container";
    rootEl.appendChild(container);

    const meta = document.createElement("div");
    meta.className = "meta-panel";
    meta.style.color = labelColor;
    meta.style.fontFamily = fontFamily;
    const dimBadges = dimIds.length
      ? dimIds
          .map((id) => `<span class=\"pill\">${dimList.find((d) => d.id === id)?.name || id}</span>`)
          .join(" ")
      : '<span class="pill empty">Aucune dimension</span>';
    const metricBadge = metricId
      ? `<span class="pill metric">${metricList.find((m) => m.id === metricId)?.name || metricId}</span>`
      : '<span class="pill metric empty">Aucune métrique</span>';
    meta.innerHTML = `<strong>Dimensions :</strong> ${dimBadges} &nbsp; <strong>Métrique :</strong> ${metricBadge}`;

    if (showLegend) {
      const legend = document.createElement("div");
      legend.className = "legend";
      legend.innerHTML = `
        <span class="legend-item"><span class="legend-swatch" style="background:${nodeColor}"></span> Ouvert</span>
        <span class="legend-item"><span class="legend-swatch" style="background:${nodeCollapsedColor}"></span> Fermé</span>
        <span class="legend-item"><span class="legend-swatch" style="background:${linkColor}; border-radius: 3px; height: 6px;"></span> Liens</span>
      `;
      meta.appendChild(legend);
    }

    container.appendChild(meta);

    const tooltip = showTooltip ? document.createElement("div") : null;
    if (tooltip) {
      tooltip.className = "tooltip";
      rootEl.appendChild(tooltip);
    }

    const svg = d3lib
      .select(container)
      .append("svg")
      .attr("width", width)
      .style("background", backgroundColor);
    const zoomLayer = svg.append("g").attr("class", "zoom-layer");
    const g = zoomLayer.append("g").attr("class", "viz-layer");

    const baseTransform = d3lib.zoomIdentity.translate(20, 20);
    if (enableZoom || enablePan) {
      const zoom = d3lib
        .zoom()
        .scaleExtent(enableZoom ? [0.5, 4] : [1, 1])
        .on("zoom", (event) => zoomLayer.attr("transform", event.transform));

      svg.call(zoom);
      svg.call(zoom.transform, baseTransform);
      if (!enablePan) svg.on("wheel.zoom", null).on("mousedown.zoom", null);
    } else {
      zoomLayer.attr("transform", baseTransform);
    }

    const dx = rowHeight;
    const dy = indent;
    const caretPath = "M -4 -4 L 4 0 L -4 4 Z";

    const root = d3lib.hierarchy(data);
    root.x0 = 0;
    root.y0 = 0;

    root.descendants().forEach((d) => {
      d.id = d.id || Math.random().toString(16).slice(2);
      d._children = null;
    });

    const tree = d3lib.tree().nodeSize([dx, dy]);

    const emitFilter = (node) => {
      if (!supportsFiltering) return;

      const path = node.ancestors().reverse().slice(1);

      if (!path.length) {
        dscc.clearInteraction(clickInteractionId, filterAction);
        return;
      }

      const concepts = dimList.slice(0, path.length).map((d) => d.id);
      const values = path.map((p) => (p?.data?.rawValue !== undefined ? p.data.rawValue : p.data?.name || ""));

      dscc.sendInteraction(clickInteractionId, filterAction, { concepts, values: [values] });
    };

    function diagonal(d) {
      return d3lib.linkHorizontal().x((x) => x.y).y((y) => y.x)(d);
    }

    function update(source) {
      const nodes = root.descendants();
      const links = root.links();

      tree(root);

      let left = root;
      let right = root;
      root.eachBefore((n) => {
        if (n.x < left.x) left = n;
        if (n.x > right.x) right = n;
      });

      const innerHeight = right.x - left.x + 40;
      const maxY = d3lib.max(nodes, (d) => d.y) || 0;

      // Espace disponible moins le panneau de métadonnées.
      const metaHeight = meta.offsetHeight || 0;
      const svgHeight = Math.max(height - metaHeight - 16, innerHeight);
      const contentWidth = maxY + dy + 60;
      svg.attr("height", svgHeight);
      svg.attr("width", width);
      svg.attr("viewBox", `0 0 ${Math.max(width, contentWidth)} ${svgHeight}`);

      const node = g.selectAll("g.node").data(nodes, (d) => d.id);

      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node")
        .attr("transform", () => `translate(${source.y0},${source.x0})`)
        .on("click", (event, d) => {
          if (event.detail > 1) return;

          if (d.children) {
            d._children = d.children;
            d.children = null;
          } else {
            d.children = d._children;
            d._children = null;
          }
          update(d);
        })
        .on("dblclick", (event, d) => {
          event.preventDefault();
          emitFilter(d);
        })
        .on("mouseenter", (event, d) => {
          if (!tooltip) return;
          const displayName = d.depth === 0 ? rootLabel : d.data.name || "";
          const val = d.value != null ? d.value : "";
          tooltip.innerHTML = `<div>${displayName}</div>${val !== "" ? `<div class="value">${val}</div>` : ""}`;
          tooltip.style.opacity = "1";
          tooltip.style.left = `${event.clientX + 12}px`;
          tooltip.style.top = `${event.clientY + 12}px`;
        })
        .on("mousemove", (event) => {
          if (!tooltip) return;
          tooltip.style.left = `${event.clientX + 12}px`;
          tooltip.style.top = `${event.clientY + 12}px`;
        })
        .on("mouseleave", () => {
          if (!tooltip) return;
          tooltip.style.opacity = "0";
        });

      nodeEnter
        .append("circle")
        .attr("r", nodeRadius)
        .attr("fill", (d) => (d._children && !d.children ? nodeCollapsedColor : nodeColor));

      nodeEnter
        .append("path")
        .attr("class", "caret")
        .attr("d", caretPath)
        .attr("fill", labelColor)
        .attr("transform", (d) =>
          `translate(${d._children || d.children ? -nodeRadius - 10 : -1000},0) rotate(${d.children ? 90 : 0})`
        );

      nodeEnter
        .append("text")
        .attr("dy", "0.32em")
        .attr("x", (d) => (d._children ? -10 : 10))
        .attr("text-anchor", (d) => (d._children ? "end" : "start"))
        .style("font-size", `${fontSize}px`)
        .style("fill", labelColor)
        .style("font-family", fontFamily)
        .text((d) => {
          if (!showLabels) return "";

          const base = d.depth === 0 ? rootLabel : d.data.name || "";
          if (showValue) {
            const valueText = d.value ?? 0;
            return base ? `${base} (${valueText})` : `${valueText}`;
          }
          return base;
        });

      const nodeUpdate = nodeEnter.merge(node);
      nodeUpdate.transition().duration(250).attr("transform", (d) => `translate(${d.y},${d.x})`);
      nodeUpdate
        .select("circle")
        .attr("fill", (d) => (d._children && !d.children ? nodeCollapsedColor : nodeColor));
      nodeUpdate
        .select("path.caret")
        .attr("fill", labelColor)
        .attr("transform", (d) =>
          `translate(${d._children || d.children ? -nodeRadius - 10 : -1000},0) rotate(${d.children ? 90 : 0})`
        )
        .attr("opacity", (d) => (d._children || d.children ? 1 : 0));

      node.exit().transition().duration(250).attr("transform", () => `translate(${source.y},${source.x})`).remove();

      const link = g.selectAll("path.link").data(links, (d) => d.target.id);

      const linkEnter = link
        .enter()
        .append("path")
        .attr("class", "link")
        .attr("stroke", linkColor)
        .attr("stroke-width", linkWidth)
        .attr("d", () => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o });
        });

      linkEnter
        .merge(link)
        .transition()
        .duration(250)
        .attr("d", diagonal)
        .attr("stroke", linkColor)
        .attr("stroke-width", linkWidth);

      link
        .exit()
        .transition()
        .duration(250)
        .attr("d", () => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o });
        })
        .remove();

      root.eachBefore((d) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    update(root);
  } catch (err) {
    console.error(err);
    rootEl.innerHTML =
      "<div class='empty-state'>Une erreur est survenue dans la visualisation (voir la console). Vérifie tes dimensions/métriques et rebuild le package.</div>";
  }
}

(function subscribe() {
  const dscc = window.dscc;
  if (!dscc) return; // dscc dispo dans Looker Studio runtime
  dscc.subscribeToData(drawViz, { transform: dscc.objectTransform });
})();
