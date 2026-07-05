import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { KnowledgeGraph, KnowledgeNode, KnowledgeEdge, NodeType } from "../types";
import { ZoomIn, ZoomOut, RotateCcw, Filter, Search, Info, LayoutGrid, Eye } from "lucide-react";

interface KnowledgeGraphViewerProps {
  graph: KnowledgeGraph;
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string;
}

const TYPE_COLORS: Record<NodeType, { bg: string; text: string; stroke: string; dot: string }> = {
  System: { bg: "bg-blue-500/10", text: "text-blue-400", stroke: "#3b82f6", dot: "#60a5fa" },
  Requirement: { bg: "bg-emerald-500/10", text: "text-emerald-400", stroke: "#10b981", dot: "#34d399" },
  Module: { bg: "bg-purple-500/10", text: "text-purple-400", stroke: "#8b5cf6", dot: "#a78bfa" },
  "User Role": { bg: "bg-amber-500/10", text: "text-amber-400", stroke: "#f59e0b", dot: "#fbbf24" },
  Constraint: { bg: "bg-rose-500/10", text: "text-rose-400", stroke: "#f43f5e", dot: "#f87171" },
  Feature: { bg: "bg-cyan-500/10", text: "text-cyan-400", stroke: "#06b6d4", dot: "#22d3ee" },
  Process: { bg: "bg-indigo-500/10", text: "text-indigo-400", stroke: "#6366f1", dot: "#818cf8" },
  General: { bg: "bg-slate-500/10", text: "text-slate-400", stroke: "#64748b", dot: "#94a3b8" },
};

export default function KnowledgeGraphViewer({ graph, onSelectNode, selectedNodeId }: KnowledgeGraphViewerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Search and Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<NodeType[]>([]);
  const [activeNode, setActiveNode] = useState<KnowledgeNode | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");

  // Filter lists
  const availableTypes: NodeType[] = [
    "System",
    "Requirement",
    "Module",
    "User Role",
    "Constraint",
    "Feature",
    "Process",
    "General",
  ];

  // Sync external selectedNodeId
  useEffect(() => {
    if (selectedNodeId) {
      const node = graph.nodes.find((n) => n.id === selectedNodeId);
      if (node) setActiveNode(node);
    }
  }, [selectedNodeId, graph.nodes]);

  // Handle Type Toggle Filter
  const toggleTypeFilter = (type: NodeType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // Filter nodes & edges
  const filteredNodes = graph.nodes.filter((node) => {
    const matchesSearch =
      node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = selectedTypes.length === 0 || selectedTypes.includes(node.type);
    return matchesSearch && matchesType;
  });

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = graph.edges.filter(
    (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
  );

  // Render D3 Force Directed Simulation
  useEffect(() => {
    if (viewMode !== "graph" || !svgRef.current || !containerRef.current) return;

    // Clear previous SVG contents
    d3.select(svgRef.current).selectAll("*").remove();

    const width = containerRef.current.clientWidth || 800;
    const height = 580;

    const svg = d3
      .select(svgRef.current)
      .attr("width", "100%")
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    // Create a container group for zooming
    const g = svg.append("g");

    // Add zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Zoom buttons handler
    d3.select("#zoom-in").on("click", () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1.3);
    });
    d3.select("#zoom-out").on("click", () => {
      svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3);
    });
    d3.select("#zoom-reset").on("click", () => {
      svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
    });

    // Node & Edge Data formatted for D3
    const d3Nodes = filteredNodes.map((n) => ({ ...n }));
    const d3Links = filteredEdges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      description: e.description,
    }));

    // Create simulation - configured to spread out and utilize space beautifully
    const simulation = d3
      .forceSimulation<any>(d3Nodes)
      .force(
        "link",
        d3
          .forceLink<any, any>(d3Links)
          .id((d) => d.id)
          .distance(180) // Spreads out connected nodes further
      )
      .force("charge", d3.forceManyBody().strength(-600)) // Stronger repulsion force to disperse nodes
      .force("center", d3.forceCenter(width / 2, height / 2)) // Pulls everything to the expanded center
      .force("collide", d3.forceCollide().radius(75)); // Generous collision radius to prevent text/bubble clumping

    // Define arrow markers for directed relationships
    svg
      .append("defs")
      .selectAll("marker")
      .data(["arrow"])
      .enter()
      .append("marker")
      .attr("id", (d) => d)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 26) // Position marker relative to node center
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("fill", "#475569")
      .attr("d", "M0,-5L10,0L0,5");

    // Render edges/links
    const link = g
      .append("g")
      .attr("stroke", "#334155")
      .attr("stroke-opacity", 0.8)
      .selectAll("line")
      .data(d3Links)
      .enter()
      .append("line")
      .attr("stroke-width", 2)
      .attr("marker-end", "url(#arrow)")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("stroke", "#818cf8").attr("stroke-width", 3.5);
      })
      .on("mouseout", function (event, d) {
        d3.select(this).attr("stroke", "#334155").attr("stroke-width", 2);
      });

    // Render link relationship labels
    const linkText = g
      .append("g")
      .selectAll("text")
      .data(d3Links)
      .enter()
      .append("text")
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", "9px")
      .attr("fill", "#94a3b8")
      .attr("text-anchor", "middle")
      .text((d) => d.relation.replace("_", " "));

    // Drag behavior
    const drag = d3
      .drag<SVGGElement, any>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // Render nodes
    const node = g
      .append("g")
      .selectAll("g")
      .data(d3Nodes)
      .enter()
      .append("g")
      .attr("class", "node-group cursor-pointer")
      .call(drag as any)
      .on("click", (event, d) => {
        const fullNode = graph.nodes.find((n) => n.id === d.id);
        if (fullNode) {
          setActiveNode(fullNode);
          if (onSelectNode) onSelectNode(fullNode.id);
        }
      });

    // Add circular backgrounds
    node
      .append("circle")
      .attr("r", 18)
      .attr("fill", "#020617")
      .attr("stroke", (d) => TYPE_COLORS[d.type as NodeType]?.stroke || "#475569")
      .attr("stroke-width", (d) => (d.id === activeNode?.id ? 4 : 2))
      .attr("class", "transition-all duration-200");

    // Add icon placeholder dots
    node
      .append("circle")
      .attr("r", 4)
      .attr("fill", (d) => TYPE_COLORS[d.type as NodeType]?.dot || "#64748b");

    // Add labels
    node
      .append("text")
      .attr("dy", 32)
      .attr("text-anchor", "middle")
      .attr("font-family", "Outfit, Inter, sans-serif")
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("fill", (d) => (d.id === activeNode?.id ? "#f8fafc" : "#94a3b8"))
      .text((d) => d.label);

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      linkText
        .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
        .attr("y", (d: any) => (d.source.y + d.target.y) / 2 - 4);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [filteredNodes, filteredEdges, activeNode, viewMode]);

  return (
    <div className="space-y-4" id="knowledge-graph-viewer">
      {/* Search and Quick Filters */}
      <div className="bg-[#1E293B]/40 backdrop-blur-md p-4 rounded-xl border border-slate-800 shadow-xl space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search concepts, labels, or descriptions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-800 rounded-lg text-sm bg-[#020617] text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("graph")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                viewMode === "graph"
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  : "bg-transparent text-slate-400 border-transparent hover:bg-[#020617]/50 hover:text-slate-200"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Graph Visualizer
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                viewMode === "list"
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  : "bg-transparent text-slate-400 border-transparent hover:bg-[#020617]/50 hover:text-slate-200"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              List Nodes ({filteredNodes.length})
            </button>
          </div>
        </div>

        {/* Type Badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500 flex items-center gap-1 mr-1">
            <Filter className="w-3 h-3" /> Filters:
          </span>
          {availableTypes.map((type) => {
            const count = graph.nodes.filter((n) => n.type === type).length;
            if (count === 0) return null;

            const isSelected = selectedTypes.includes(type);
            const style = TYPE_COLORS[type];

            return (
              <button
                key={type}
                onClick={() => toggleTypeFilter(type)}
                className={`px-2.5 py-1 rounded-full font-medium transition-all ${
                  isSelected
                    ? `${style.bg} ${style.text} ring-1 ring-inset ring-indigo-500/30`
                    : "bg-[#020617]/60 text-slate-400 border border-slate-800 hover:bg-[#020617] hover:text-slate-200"
                }`}
              >
                {type} <span className="opacity-60">({count})</span>
              </button>
            );
          })}
          {selectedTypes.length > 0 && (
            <button
              onClick={() => setSelectedTypes([])}
              className="text-rose-400 hover:text-rose-300 underline font-medium text-[11px] ml-1"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Main Layout (Split Graph & Details) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Graph Render Panel */}
        <div className="lg:col-span-2 bg-slate-950 rounded-2xl border border-slate-900 shadow-sm overflow-hidden relative min-h-[580px]">
          {viewMode === "graph" ? (
            <div ref={containerRef} className="w-full h-[580px]">
              {/* Graph Toolbar */}
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-1.5">
                <button
                  id="zoom-in"
                  title="Zoom In"
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  id="zoom-out"
                  title="Zoom Out"
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  id="zoom-reset"
                  title="Reset Zoom"
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              {/* D3 SVG Canvas */}
              <svg ref={svgRef} className="w-full h-full bg-radial from-slate-950 to-slate-900"></svg>

              {/* Mini legend */}
              <div className="absolute bottom-4 left-4 bg-slate-900/95 backdrop-blur-xs border border-slate-800 rounded-lg p-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
                <span className="font-semibold text-slate-300">Legend:</span>
                {availableTypes.map((type) => {
                  const style = TYPE_COLORS[type];
                  return (
                    <span key={type} className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: style.stroke }} />
                      {type}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            /* List view */
            <div className="p-5 h-[580px] overflow-y-auto bg-slate-900 space-y-2">
              <div className="text-xs text-slate-400 pb-2">Showing {filteredNodes.length} nodes matched</div>
              {filteredNodes.map((node) => {
                const style = TYPE_COLORS[node.type];
                const isActive = node.id === activeNode?.id;

                return (
                  <div
                    key={node.id}
                    onClick={() => {
                      setActiveNode(node);
                      if (onSelectNode) onSelectNode(node.id);
                    }}
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                      isActive
                        ? "bg-slate-800 border-emerald-500 shadow-md"
                        : "bg-slate-950 border-slate-800 hover:bg-slate-800/50 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${style.bg} ${style.text}`}>
                          {node.type}
                        </span>
                        <h4 className="text-sm font-semibold text-slate-200">{node.label}</h4>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">ID: {node.id}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{node.description}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Node Details Side drawer */}
        <div className="bg-[#1E293B]/40 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl p-5 flex flex-col h-full min-h-[580px]">
          {activeNode ? (
            <div className="space-y-4 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${TYPE_COLORS[activeNode.type].bg} ${TYPE_COLORS[activeNode.type].text}`}
                  >
                    {activeNode.type}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                      activeNode.importance === "High"
                        ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        : activeNode.importance === "Medium"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-slate-800 text-slate-400 border border-slate-700/50"
                    }`}
                  >
                    {activeNode.importance} Priority
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Node ID</span>
                    <span className="text-xs font-mono font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                      {activeNode.id}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Label</span>
                    <h3 className="text-lg font-bold text-slate-100">{activeNode.label}</h3>
                  </div>

                  <div>
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Description</span>
                    <p className="text-sm text-slate-300 mt-1 leading-relaxed whitespace-pre-line bg-[#020617]/50 p-3 rounded-lg border border-slate-800/60">
                      {activeNode.description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Connections list */}
              <div className="border-t border-slate-800 pt-4 mt-4">
                <span className="text-xs font-bold text-indigo-400 block mb-2 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-indigo-400/80" /> Active Connections
                </span>
                <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-1">
                  {graph.edges.filter((e) => e.source === activeNode.id || e.target === activeNode.id).length === 0 ? (
                    <div className="text-xs text-slate-500 italic">No connections registered.</div>
                  ) : (
                    graph.edges
                      .filter((e) => e.source === activeNode.id || e.target === activeNode.id)
                      .map((edge, idx) => {
                        const isSource = edge.source === activeNode.id;
                        const partnerId = isSource ? edge.target : edge.source;
                        const partner = graph.nodes.find((n) => n.id === partnerId);

                        return (
                          <div
                            key={idx}
                            onClick={() => {
                              if (partner) {
                                setActiveNode(partner);
                                if (onSelectNode) onSelectNode(partner.id);
                              }
                            }}
                            className="p-2 rounded bg-[#020617]/50 border border-slate-800 hover:border-indigo-500/30 hover:bg-[#020617]/80 transition-all cursor-pointer text-left flex items-center justify-between"
                          >
                            <div className="text-xs">
                              <span className="font-semibold text-emerald-400 font-mono">
                                {edge.relation.replace("_", " ")}
                              </span>{" "}
                              <span className="text-slate-500">{isSource ? "→" : "←"}</span>{" "}
                              <span className="font-bold text-slate-200">{partner?.label || partnerId}</span>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500 border border-dashed border-slate-800 rounded-xl">
              <LayoutGrid className="w-8 h-8 stroke-1 text-slate-600 mb-2" />
              <p className="text-sm font-medium text-slate-400">Select a node in the graph to inspect details, links, and map reviews.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
