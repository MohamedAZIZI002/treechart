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

function getStyle(vizData, id, fallback) {
  try {
    const s = vizData.style && vizData.style[id];
    if (s === undefined || s === null || s === "") return fallback;
    return s;
  } catch {
    return fallback;
  }
}

function buildHierarchy(rows, dimIds, metricId) {
  const root = { name: "root", children: [], value: 0 };

  const getOrCreateChild = (parent, name) => {
    if (!parent.children) parent.children = [];
    let c = parent.children.find((x) => x.name === name);
    if (!c) {
      c = { name, children: [], value: 0 };
      parent.children.push(c);
    }
    return c;
  };

  for (const r of rows) {
    let cur = root;
    for (const d of dimIds) {
      const val = r[d] && r[d].value != null ? String(r[d].value) : "(null)";
      cur = getOrCreateChild(cur, val);
    }
    const m = metricId ? Number(r[metricId]?.value) || 0 : 1;
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

  const dscc = window.dscc;
  if (!dscc) {
    rootEl.innerHTML =
      "<div style='padding:12px'>dscc introuvable. Vérifie que dscc.min.js est bien concaténé dans dist/viz.js.</div>";
    return;
  }

  const width = dscc.getWidth();
  const height = dscc.getHeight();

  const dims = vizData.fields?.dims || vizData.fields?.dimensions || [];
  const metrics = vizData.fields?.metric || vizData.fields?.metrics || [];

  const dimList = Array.isArray(dims) ? dims : [];
  const metricList = Array.isArray(metrics) ? metrics : [];

  const dimIds = dimList.map((d) => d.id);
  const metricId = metricList.length > 0 ? metricList[0].id : null;

  const rows = vizData.tables?.DEFAULT || [];

  if (!dimIds || dimIds.length < 2) {
    rootEl.innerHTML =
      "<div style='padding:12px'>Ajoute au moins <b>2 dimensions</b> pour construire l’arbre.</div>";
    return;
  }

  if (!rows.length) {
    rootEl.innerHTML = "<div style='padding:12px'>Aucune donnée.</div>";
    return;
  }

  const showValue = !!getStyle(vizData, "showValue", false);
  const fontSize = Number(getStyle(vizData, "fontSize", 12));
   const fontFamily = getStyle(vizData, "fontFamily", "Inter, Arial, sans-serif");
  const nodeRadius = Number(getStyle(vizData, "nodeRadius", 4));
  const indent = Number(getStyle(vizData, "indent", 180));
  const rowHeight = Number(getStyle(vizData, "rowHeight", 24));
   const linkWidth = Number(getStyle(vizData, "linkWidth", 1.5));
   const backgroundColor = getStyle(vizData, "backgroundColor", "#ffffff");
   const labelColor = getStyle(vizData, "labelColor", "#111111");
   const linkColor = getStyle(vizData, "linkColor", "#9aa4b5");
   const nodeColor = getStyle(vizData, "nodeColor", "#6c8cf5");
   const nodeCollapsedColor = getStyle(vizData, "nodeCollapsedColor", "#324679");

  const data = buildHierarchy(rows, dimIds, metricId);

  rootEl.style.background = backgroundColor;
  rootEl.style.color = labelColor;
  rootEl.style.fontFamily = fontFamily;

  const container = document.createElement("div");
  container.className = "viz-container";
  rootEl.appendChild(container);

  const meta = document.createElement("div");
  meta.className = "meta-panel";
  const dimBadges = dimIds.length
    ? dimIds
        .map((id) => `<span class="pill">${dimList.find((d) => d.id === id)?.name || id}</span>`)
        .join(" ")
    : '<span class="pill empty">Aucune dimension</span>';
  const metricBadge = metricId
    ? `<span class="pill metric">${metricList.find((m) => m.id === metricId)?.name || metricId}</span>`
    : '<span class="pill metric empty">Aucune métrique</span>';
  meta.innerHTML = `<strong>Dimensions :</strong> ${dimBadges} &nbsp; <strong>Métrique :</strong> ${metricBadge}`;
  container.appendChild(meta);

  const svg = d3.select(container).append("svg").attr("width", width);
  const g = svg.append("g").attr("transform", "translate(20,20)");

  const dx = rowHeight;
  const dy = indent;

  const root = d3.hierarchy(data);
  root.x0 = 0;
  root.y0 = 0;

  // collapse au-delà du niveau 1
  root.descendants().forEach((d) => {
    d.id = d.id || Math.random().toString(16).slice(2);
    d._children = d.children;
    if (d.depth > 1) d.children = null;
  });

  const tree = d3.tree().nodeSize([dx, dy]);

  function diagonal(d) {
    return d3.linkHorizontal().x((x) => x.y).y((y) => y.x)(d);
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

    // Espace disponible moins le panneau de métadonnées.
    const metaHeight = meta.offsetHeight || 0;
    const svgHeight = Math.max(height - metaHeight - 16, innerHeight);
    svg.attr("height", svgHeight);

    const node = g.selectAll("g.node").data(nodes, (d) => d.id);

    const nodeEnter = node
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", () => `translate(${source.y0},${source.x0})`)
      .on("click", (event, d) => {
        if (d.children) {
          d._children = d.children;
          d.children = null;
        } else {
          d.children = d._children;
          d._children = null;
        }
        update(d);
      });

    nodeEnter
      .append("circle")
      .attr("r", nodeRadius)
      .attr("fill", (d) => (d._children ? nodeCollapsedColor : nodeColor));

    nodeEnter
      .append("text")
      .attr("dy", "0.32em")
      .attr("x", (d) => (d._children ? -10 : 10))
      .attr("text-anchor", (d) => (d._children ? "end" : "start"))
      .style("font-size", `${fontSize}px`)
      .style("fill", labelColor)
      .style("font-family", fontFamily)
      .text((d) => {
        if (d.depth === 0) return "";
        const base = d.data.name;
        if (showValue) return `${base} (${d.value ?? 0})`;
        return base;
      });

    const nodeUpdate = nodeEnter.merge(node);
    nodeUpdate.transition().duration(250).attr("transform", (d) => `translate(${d.y},${d.x})`);
    nodeUpdate.select("circle").attr("fill", (d) => (d._children ? nodeCollapsedColor : nodeColor));

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

    linkEnter.merge(link).transition().duration(250).attr("d", diagonal).attr("stroke", linkColor).attr("stroke-width", linkWidth);

    link.exit()
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
}

(function subscribe() {
  const dscc = window.dscc;
  if (!dscc) return; // dscc dispo dans Looker Studio runtime
  dscc.subscribeToData(drawViz, { transform: dscc.objectTransform });
})();
