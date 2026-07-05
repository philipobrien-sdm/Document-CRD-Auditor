import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { DocumentInfo, EvaluationSheet, EvaluationRow, CommentRow, CommentAnalysis } from "../types";
import {
  Upload,
  Play,
  Pause,
  RefreshCw,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Eye,
  Settings,
  BrainCircuit,
  BarChart4,
  Check,
  ChevronRight,
  TrendingUp,
  Download,
  Search,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

interface CommentEvaluatorProps {
  document: DocumentInfo;
  onEvaluationCreated: (sheet: EvaluationSheet) => void;
  activeEvaluation: EvaluationSheet | null;
  onSelectEvaluation: (evalId: string) => void;
  onDeleteEvaluation: (evalId: string) => void;
  allEvaluations: EvaluationSheet[];
  onHighlightNode?: (nodeId: string) => void;
}

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: "#10b981", // Emerald
  Negative: "#f43f5e", // Rose
  Neutral: "#64748b", // Slate
  Mixed: "#f59e0b", // Amber
};

const BENEFIT_COLORS: Record<string, string> = {
  "High Benefit": "#10b981",
  "Medium Benefit": "#3b82f6",
  "No Benefit": "#94a3b8",
  Detrimental: "#e11d48",
};

export default function CommentEvaluator({
  document,
  onEvaluationCreated,
  activeEvaluation,
  onSelectEvaluation,
  onDeleteEvaluation,
  allEvaluations,
  onHighlightNode,
}: CommentEvaluatorProps) {
  // Spreadsheet Parsing & Mapping States
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileRows, setFileRows] = useState<any[][]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState({
    id: "",
    author: "",
    comment: "",
    response: "",
    proposedAction: "",
    stakeholder: "",
    section: "",
  });
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active Processing Loop States
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [currentlyProcessingIdx, setCurrentlyProcessingIdx] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState<EvaluationRow | null>(null);

  // Dynamic Filtering States
  const [stakeholderFilter, setStakeholderFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchFilter, setSearchFilter] = useState("");

  // Calculate unique list of stakeholders for drop-down filter
  const uniqueStakeholders = React.useMemo(() => {
    if (!activeEvaluation) return [];
    const set = new Set<string>();
    activeEvaluation.rows.forEach((r) => {
      const sh = r.comment.stakeholder || r.comment.author;
      if (sh) set.add(sh);
    });
    return Array.from(set).sort();
  }, [activeEvaluation]);

  // Calculate unique list of sections for drop-down filter
  const uniqueSections = React.useMemo(() => {
    if (!activeEvaluation) return [];
    const set = new Set<string>();
    activeEvaluation.rows.forEach((r) => {
      const sec = r.comment.section;
      if (sec) set.add(sec);
    });
    return Array.from(set).sort();
  }, [activeEvaluation]);

  // Filter rows based on active dropdowns and search term
  const filteredRows = React.useMemo(() => {
    if (!activeEvaluation) return [];
    return activeEvaluation.rows.filter((row) => {
      // 1. Stakeholder Filter
      if (stakeholderFilter !== "all") {
        const sh = row.comment.stakeholder || row.comment.author;
        if (sh !== stakeholderFilter) return false;
      }
      // 2. Section Filter
      if (sectionFilter !== "all") {
        if (row.comment.section !== sectionFilter) return false;
      }
      // 3. Status Filter
      if (statusFilter !== "all") {
        if (row.status !== statusFilter) return false;
      }
      // 4. Free-text Search Filter
      if (searchFilter.trim() !== "") {
        const q = searchFilter.toLowerCase();
        const matchesAuthor = (row.comment.author || "").toLowerCase().includes(q);
        const matchesComment = (row.comment.comment || "").toLowerCase().includes(q);
        const matchesResponse = (row.comment.response || "").toLowerCase().includes(q);
        const matchesAction = (row.comment.proposedAction || "").toLowerCase().includes(q);
        const matchesStakeholder = (row.comment.stakeholder || "").toLowerCase().includes(q);
        const matchesSection = (row.comment.section || "").toLowerCase().includes(q);
        const matchesReflection = row.analysis ? (row.analysis.reflection || "").toLowerCase().includes(q) : false;
        
        if (
          !matchesAuthor && 
          !matchesComment && 
          !matchesResponse && 
          !matchesAction && 
          !matchesStakeholder && 
          !matchesSection && 
          !matchesReflection
        ) {
          return false;
        }
      }
      return true;
    });
  }, [activeEvaluation, stakeholderFilter, sectionFilter, statusFilter, searchFilter]);

  const isAutoRunningRef = useRef(false);
  const latestEvaluationRef = useRef(activeEvaluation);
  latestEvaluationRef.current = activeEvaluation;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Handle spreadsheet file upload
  const handleSpreadsheetUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (!e.target.files || !e.target.files[0]) return;

    const file = e.target.files[0];
    setIsParsing(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Parse to raw array of arrays
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
        if (rows.length < 2) {
          throw new Error("Spreadsheet must contain at least a header row and one data row.");
        }

        const headers = rows[0].map((h: any) => String(h || "").trim());
        setFileHeaders(headers);
        setFileRows(rows.slice(1));
        setSheetName(file.name.replace(/\.[^/.]+$/, "") + " Run");

        // Attempt smart default mapping based on keywords
        const autoMap = { id: "", author: "", comment: "", response: "", proposedAction: "", stakeholder: "", section: "" };
        headers.forEach((h, idx) => {
          const l = h.toLowerCase();
          const strIdx = String(idx);
          if (l.includes("id") || l.includes("index") || l.includes("number")) autoMap.id = strIdx;
          else if (l.includes("stakeholder") || l.includes("org") || l.includes("group") || l.includes("entity") || l.includes("dept") || l.includes("department"))
            autoMap.stakeholder = strIdx;
          else if (l.includes("author") || l.includes("name") || l.includes("user") || l.includes("commenter"))
            autoMap.author = strIdx;
          else if (l.includes("section") || l.includes("page") || l.includes("chapter") || l.includes("part") || l.includes("clause"))
            autoMap.section = strIdx;
          else if (l.includes("comment") || l.includes("feedback") || l.includes("concern"))
            autoMap.comment = strIdx;
          else if (l.includes("response") || l.includes("reply") || l.includes("team"))
            autoMap.response = strIdx;
          else if (l.includes("action") || l.includes("proposed") || l.includes("change") || l.includes("mitigation"))
            autoMap.proposedAction = strIdx;
        });

        // Set state
        setMapping(autoMap);
      } catch (err: any) {
        setError(err.message || "Failed to parse spreadsheet file.");
      } finally {
        setIsParsing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Create audit run on server
  const handleCreateEvaluationRun = async () => {
    setError(null);
    if (!sheetName.trim()) {
      setError("Please specify a name for this evaluation run.");
      return;
    }
    if (!mapping.comment || !mapping.response || !mapping.proposedAction) {
      setError("Please map the required Comment, Response, and Proposed Action columns.");
      return;
    }

    try {
      // Map rows from raw excel representation to clean JSON CommentRows
      const cleanRows = fileRows
        .filter((r) => r.length > 0)
        .map((r) => {
          const commentVal = mapping.comment ? r[parseInt(mapping.comment, 10)] : "";
          const responseVal = mapping.response ? r[parseInt(mapping.response, 10)] : "";
          const actionVal = mapping.proposedAction ? r[parseInt(mapping.proposedAction, 10)] : "";

          // Only import rows that actually have comments/data
          if (!commentVal && !responseVal && !actionVal) return null;

          const stakeholderVal = mapping.stakeholder ? String(r[parseInt(mapping.stakeholder, 10)] || "") : "";
          const sectionVal = mapping.section ? String(r[parseInt(mapping.section, 10)] || "") : "";

          // Capture all other columns as metadata
          const metadata: Record<string, string> = {};
          fileHeaders.forEach((h, hIdx) => {
            const strIdx = String(hIdx);
            if (
              strIdx !== mapping.id &&
              strIdx !== mapping.author &&
              strIdx !== mapping.comment &&
              strIdx !== mapping.response &&
              strIdx !== mapping.proposedAction &&
              strIdx !== mapping.stakeholder &&
              strIdx !== mapping.section
            ) {
              const val = r[hIdx];
              if (val !== undefined && val !== null && String(val).trim() !== "") {
                metadata[h] = String(val);
              }
            }
          });

          return {
            id: mapping.id ? String(r[parseInt(mapping.id, 10)] || "") : "",
            author: mapping.author ? String(r[parseInt(mapping.author, 10)] || "Anonymous") : "Anonymous",
            comment: String(commentVal || ""),
            response: String(responseVal || ""),
            proposedAction: String(actionVal || ""),
            stakeholder: stakeholderVal || undefined,
            section: sectionVal || undefined,
            metadata,
          };
        })
        .filter((r) => r !== null);

      if (cleanRows.length === 0) {
        throw new Error("No valid rows containing comments and responses found.");
      }

      const res = await fetch(`/api/documents/${document.id}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sheetName.trim(), rows: cleanRows }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to initialize audit run.");
      }

      const sheet: EvaluationSheet = await res.json();
      onEvaluationCreated(sheet);

      // Clear parsing states
      setFileHeaders([]);
      setFileRows([]);
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    }
  };

  // Export active evaluation run insights to a highly organized, traceable, standalone HTML file
  const handleExportHtmlReport = () => {
    if (!activeEvaluation) return;

    const docName = document.name;
    const runName = activeEvaluation.name;
    const runDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    // Calculate Stats
    const totalRows = activeEvaluation.rows.length;
    const completedRows = activeEvaluation.rows.filter((r) => r.status === "completed");
    const completedCount = completedRows.length;

    // Sentiments
    const sentimentCounts = { Positive: 0, Negative: 0, Neutral: 0, Mixed: 0 };
    // Benefit
    const benefitCounts = { "High Benefit": 0, "Medium Benefit": 0, "No Benefit": 0, Detrimental: 0 };
    // Resolutions
    const resolutionCounts = {
      "Fully Addressed": 0,
      "Partially Addressed": 0,
      "Not Addressed": 0,
      "Rejected with Good Reason": 0,
      "Rejected with Weak Reason": 0,
      "Ignored": 0,
    };

    // Quality issues count
    let totalIssues = 0;
    const issueCounts: Record<string, number> = {};

    // Map of nodes to comments (traceability backlink)
    const nodeBacklinks: Record<string, { commentIdx: number; author: string; comment: string }[]> = {};

    completedRows.forEach((r) => {
      if (r.analysis) {
        const s = r.analysis.sentiment;
        if (s in sentimentCounts) sentimentCounts[s as keyof typeof sentimentCounts]++;

        const b = r.analysis.proposedActionBenefit;
        if (b in benefitCounts) benefitCounts[b as keyof typeof benefitCounts]++;

        const res = r.analysis.resolutionScore;
        if (res in resolutionCounts) resolutionCounts[res as keyof typeof resolutionCounts]++;

        if (r.analysis.issues && Array.isArray(r.analysis.issues)) {
          r.analysis.issues.forEach((issue) => {
            totalIssues++;
            issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
          });
        }

        if (r.analysis.mappedNodes && Array.isArray(r.analysis.mappedNodes)) {
          r.analysis.mappedNodes.forEach((nodeId) => {
            if (!nodeBacklinks[nodeId]) {
              nodeBacklinks[nodeId] = [];
            }
            nodeBacklinks[nodeId].push({
              commentIdx: r.comment.index,
              author: r.comment.author || "Anonymous",
              comment: r.comment.comment,
            });
          });
        }
      }
    });

    const getPercent = (count: number) => {
      if (completedCount === 0) return 0;
      return Math.round((count / completedCount) * 100);
    };

    // Generate trace items
    const nodesInGraph = document.knowledgeGraph?.nodes || [];
    const traceabilityHtml = nodesInGraph
      .map((node) => {
        const links = nodeBacklinks[node.id] || [];
        if (links.length === 0) return ""; // Only show affected nodes
        return `
          <div class="node-card">
            <div class="node-card-header">
              <span class="node-badge node-type-${node.type.toLowerCase().replace(/\s+/g, '-')}">${node.type}</span>
              <span class="node-title">${node.label}</span>
              <span class="node-id font-mono">ID: ${node.id}</span>
              <span class="affected-count font-bold">${links.length} Comment${links.length > 1 ? "s" : ""} Mapped</span>
            </div>
            <p class="node-desc">${node.description || "No description provided."}</p>
            <div class="mapped-comments">
              <div class="mapped-comments-title">Traceable Feedbacks Mapping to this Node:</div>
              <ul class="mapped-comments-list">
                ${links
                  .map(
                    (link) => `
                  <li>
                    <strong>Row #${link.commentIdx} - ${link.author}:</strong> 
                    <span class="italic text-slate-600">"${link.comment}"</span>
                  </li>
                `
                  )
                  .join("")}
              </ul>
            </div>
          </div>
        `;
      })
      .filter((html) => html !== "")
      .join("");

    // Quality Issues html section
    const issuesHtml = completedRows
      .filter((r) => r.analysis?.issues && r.analysis.issues.length > 0)
      .map((r) => {
        return r.analysis!.issues.map((issue) => `
          <div class="issue-log-item severity-${issue.severity.toLowerCase()}">
            <div class="issue-log-header">
              <span class="issue-type-tag">${issue.type}</span>
              <span class="issue-severity-badge">${issue.severity} Severity</span>
              <span class="issue-row-number">Row #${r.comment.index} (By ${r.comment.author || "Anonymous"})</span>
            </div>
            <p class="issue-comment"><strong>Comment:</strong> "${r.comment.comment}"</p>
            <p class="issue-desc"><strong>Auditor Finding:</strong> ${issue.description}</p>
          </div>
        `).join("");
      })
      .join("");

    // Details Table Rows html section
    const tableRowsHtml = completedRows
      .map((r) => {
        const a = r.analysis!;
        
        // Mapped Nodes for this specific row
        const mappedNodesHtml = (a.mappedNodes || [])
          .map((id) => {
            const graphNode = nodesInGraph.find((n) => n.id === id);
            const label = graphNode ? graphNode.label : id;
            const type = graphNode ? graphNode.type : "General";
            return `<span class="row-node-badge node-type-${type.toLowerCase().replace(/\s+/g, '-')}">${label}</span>`;
          })
          .join(" ");

        // Parse markdown lists/bolding inside reflection
        const reflectionHtml = (a.reflection || "")
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .split("\n")
          .map((line) => {
            const t = line.trim();
            if (t.startsWith("- ") || t.startsWith("* ")) {
              return `<li class="ml-4 list-disc text-xs text-slate-700">${t.substring(2)}</li>`;
            }
            return t ? `<p class="text-xs text-slate-700 my-1">${t}</p>` : "";
          })
          .join("");

        const sentimentClass = `badge-sentiment-${a.sentiment.toLowerCase()}`;
        const resolutionClass = `badge-res-${a.resolutionScore.toLowerCase().replace(/\s+/g, '-')}`;
        const benefitClass = `badge-benefit-${a.proposedActionBenefit.toLowerCase().replace(/\s+/g, '-')}`;

        return `
          <tr>
            <td class="text-center font-bold">#${r.comment.index}</td>
            <td>
              <div class="font-bold text-slate-800">${r.comment.author || "Anonymous"}</div>
              <div class="text-[10px] text-slate-500 mt-0.5">ID: ${r.comment.id || "N/A"}</div>
            </td>
            <td>
              <div class="feedback-bubble bg-slate-50 border-l-4 border-slate-300 p-2 text-xs text-slate-800 rounded">
                <strong>Comment:</strong> "${r.comment.comment}"
              </div>
              <div class="feedback-bubble bg-indigo-50/50 border-l-4 border-indigo-400 p-2 text-xs text-slate-800 rounded mt-1.5">
                <strong>Response:</strong> "${r.comment.response}"
              </div>
              <div class="feedback-bubble bg-emerald-50/50 border-l-4 border-emerald-400 p-2 text-xs text-slate-800 rounded mt-1.5">
                <strong>Action:</strong> "${r.comment.proposedAction}"
              </div>
            </td>
            <td>
              <div class="flex flex-wrap gap-1.5 mb-2">
                <span class="badge ${sentimentClass}">${a.sentiment}</span>
                <span class="badge badge-intent">${a.intent}</span>
                <span class="badge ${resolutionClass}">${a.resolutionScore}</span>
                <span class="badge ${benefitClass}">${a.proposedActionBenefit}</span>
              </div>
              <div class="reflection-box">
                ${reflectionHtml}
              </div>
            </td>
            <td class="trace-cell">
              ${mappedNodesHtml || '<span class="text-slate-400 italic text-[11px]">No Mapped Nodes</span>'}
            </td>
          </tr>
        `;
      })
      .join("");

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Audit Alignment Report - ${runName}</title>
  <style>
    :root {
      --primary: #4f46e5;
      --indigo-light: #e0e7ff;
      --slate-50: #f8fafc;
      --slate-100: #f1f5f9;
      --slate-200: #e2e8f0;
      --slate-300: #cbd5e1;
      --slate-700: #334155;
      --slate-800: #1e293b;
      --slate-900: #0f172a;
      --emerald-600: #059669;
      --emerald-50: #ecfdf5;
      --rose-600: #e11d48;
      --rose-50: #fff1f2;
      --amber-600: #d97706;
      --amber-50: #fef3c7;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--slate-800);
      background-color: #fcfcfd;
      margin: 0;
      padding: 0;
      line-height: 1.5;
    }
    .container {
      max-width: 1200px;
      margin: 40px auto;
      padding: 0 24px;
    }
    header {
      background: linear-gradient(135deg, var(--slate-900), var(--slate-800));
      color: white;
      padding: 40px 32px;
      border-radius: 20px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.1);
      margin-bottom: 32px;
    }
    header h1 {
      margin: 0 0 8px 0;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.025em;
    }
    header p {
      margin: 0;
      font-size: 14px;
      opacity: 0.85;
      font-weight: 500;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 12px;
    }
    .meta-item strong {
      display: block;
      color: var(--slate-300);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 32px;
    }
    @media (max-width: 768px) {
      .kpi-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .kpi-card {
      background: white;
      border: 1px solid var(--slate-200);
      padding: 24px;
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.03);
    }
    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--slate-700);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .kpi-value {
      font-size: 32px;
      font-weight: 800;
      color: var(--slate-900);
      line-height: 1;
    }
    .section-card {
      background: white;
      border: 1px solid var(--slate-200);
      border-radius: 20px;
      padding: 32px;
      margin-bottom: 32px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.03);
    }
    .section-title {
      font-size: 18px;
      font-weight: 800;
      color: var(--slate-900);
      margin: 0 0 20px 0;
      border-bottom: 2px solid var(--slate-100);
      padding-bottom: 12px;
    }
    .analytics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    @media (max-width: 768px) {
      .analytics-grid {
        grid-template-columns: 1fr;
      }
    }
    .stat-row {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      font-size: 12px;
    }
    .stat-label {
      width: 140px;
      font-weight: 600;
      color: var(--slate-700);
    }
    .stat-bar-container {
      flex: 1;
      height: 8px;
      background-color: var(--slate-100);
      border-radius: 4px;
      overflow: hidden;
      margin-right: 12px;
    }
    .stat-bar {
      height: 100%;
      border-radius: 4px;
    }
    .stat-value {
      width: 65px;
      text-align: right;
      font-weight: 700;
      font-family: monospace;
    }
    .bg-indigo { background-color: var(--primary); }
    .bg-emerald { background-color: var(--emerald-600); }
    .bg-rose { background-color: var(--rose-600); }
    .bg-amber { background-color: var(--amber-600); }
    .bg-slate { background-color: var(--slate-700); }

    /* Traceability Node Map */
    .node-card {
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      background-color: var(--slate-50);
    }
    .node-card-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 8px;
    }
    .node-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--slate-900);
    }
    .node-id {
      font-size: 11px;
      color: var(--slate-700);
      background: var(--slate-200);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .affected-count {
      font-size: 11px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      padding: 2px 8px;
      border-radius: 99px;
      margin-left: auto;
    }
    .node-desc {
      font-size: 12px;
      color: var(--slate-700);
      margin: 0 0 12px 0;
    }
    .mapped-comments {
      background: white;
      border: 1px solid var(--slate-200);
      border-radius: 8px;
      padding: 12px;
    }
    .mapped-comments-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--slate-700);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 6px;
    }
    .mapped-comments-list {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
    }
    .mapped-comments-list li {
      margin-bottom: 4px;
    }

    /* Node types */
    .node-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      color: white;
    }
    .node-type-system { background-color: #4f46e5; }
    .node-type-requirement { background-color: #0284c7; }
    .node-type-module { background-color: #8b5cf6; }
    .node-type-user-role { background-color: #ec4899; }
    .node-type-constraint { background-color: #f43f5e; }
    .node-type-feature { background-color: #10b981; }
    .node-type-process { background-color: #f59e0b; }
    .node-type-general { background-color: #64748b; }

    /* Issue log item */
    .issue-log-item {
      border-left: 4px solid var(--rose-600);
      background-color: var(--rose-50);
      border-radius: 0 12px 12px 0;
      padding: 16px;
      margin-bottom: 12px;
    }
    .issue-log-item.severity-medium {
      border-left-color: var(--amber-600);
      background-color: var(--amber-50);
    }
    .issue-log-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 11px;
    }
    .issue-type-tag {
      font-weight: 800;
      color: var(--rose-600);
      text-transform: uppercase;
    }
    .issue-log-item.severity-medium .issue-type-tag {
      color: var(--amber-600);
    }
    .issue-severity-badge {
      font-weight: 700;
      background: white;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid rgba(0,0,0,0.1);
    }
    .issue-row-number {
      font-weight: 600;
      color: var(--slate-700);
      margin-left: auto;
    }
    .issue-comment {
      font-size: 12px;
      color: var(--slate-700);
      margin: 0 0 6px 0;
    }
    .issue-desc {
      font-size: 12px;
      color: var(--slate-900);
      font-weight: 500;
      margin: 0;
    }

    /* Table Styles */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
    }
    th, td {
      padding: 16px;
      text-align: left;
      border-bottom: 1px solid var(--slate-200);
      vertical-align: top;
    }
    th {
      background-color: var(--slate-900);
      color: white;
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    th:first-child { border-top-left-radius: 12px; }
    th:last-child { border-top-right-radius: 12px; }
    
    .badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 99px;
      color: white;
    }
    .row-node-badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      color: white;
      margin-bottom: 4px;
    }
    .badge-sentiment-positive { background-color: #10b981; }
    .badge-sentiment-negative { background-color: #f43f5e; }
    .badge-sentiment-neutral { background-color: #64748b; }
    .badge-sentiment-mixed { background-color: #f59e0b; }
    .badge-intent { background-color: #3b82f6; }
    
    .badge-res-fully-addressed { background-color: #059669; }
    .badge-res-partially-addressed { background-color: #10b981; }
    .badge-res-not-addressed { background-color: #dc2626; }
    .badge-res-rejected-with-good-reason { background-color: #2563eb; }
    .badge-res-rejected-with-weak-reason { background-color: #f59e0b; }
    .badge-res-ignored { background-color: #78716c; }

    .badge-benefit-high-benefit { background-color: #059669; }
    .badge-benefit-medium-benefit { background-color: #3b82f6; }
    .badge-benefit-no-benefit { background-color: #64748b; }
    .badge-benefit-detrimental { background-color: #dc2626; }

    .feedback-bubble {
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .reflection-box {
      background: var(--slate-50);
      border: 1px solid var(--slate-200);
      border-radius: 8px;
      padding: 10px 14px;
      margin-top: 8px;
    }
    .reflection-box p {
      margin: 4px 0;
    }
    .trace-cell {
      max-width: 160px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Audit Alignment Insights Report</h1>
      <p>A rigorous quality audit evaluation comparing commenter review submissions against the system knowledge graph architecture.</p>
      
      <div class="meta-grid">
        <div class="meta-item">
          <strong>Document Title</strong>
          ${docName}
        </div>
        <div class="meta-item">
          <strong>Evaluation Run</strong>
          ${runName}
        </div>
        <div class="meta-item">
          <strong>Exported At</strong>
          ${runDate}
        </div>
        <div class="meta-item">
          <strong>Traceability Engine</strong>
          Gemini Cognitive Audit Layer
        </div>
      </div>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Rows</div>
        <div class="kpi-value">${totalRows}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Audited Rows</div>
        <div class="kpi-value">${completedCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Quality Alerts</div>
        <div class="kpi-value" style="color: ${totalIssues > 0 ? 'var(--rose-600)' : 'var(--emerald-600)'}">${totalIssues}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Comprehension %</div>
        <div class="kpi-value">${getPercent(completedCount)}%</div>
      </div>
    </div>

    ${completedCount > 0 ? `
    <div class="section-card">
      <h3 class="section-title">Statistical Alignment Overview</h3>
      <div class="analytics-grid">
        <div>
          <h4 style="font-size: 13px; text-transform: uppercase; color: var(--slate-700); margin-bottom: 16px;">Sentiment Distribution</h4>
          <div class="stat-row">
            <span class="stat-label">Positive</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-emerald" style="width: ${getPercent(sentimentCounts.Positive)}%"></div>
            </div>
            <span class="stat-value">${sentimentCounts.Positive} (${getPercent(sentimentCounts.Positive)}%)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Mixed</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-amber" style="width: ${getPercent(sentimentCounts.Mixed)}%"></div>
            </div>
            <span class="stat-value">${sentimentCounts.Mixed} (${getPercent(sentimentCounts.Mixed)}%)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Neutral</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-slate" style="width: ${getPercent(sentimentCounts.Neutral)}%"></div>
            </div>
            <span class="stat-value">${sentimentCounts.Neutral} (${getPercent(sentimentCounts.Neutral)}%)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Negative</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-rose" style="width: ${getPercent(sentimentCounts.Negative)}%"></div>
            </div>
            <span class="stat-value">${sentimentCounts.Negative} (${getPercent(sentimentCounts.Negative)}%)</span>
          </div>
        </div>

        <div>
          <h4 style="font-size: 13px; text-transform: uppercase; color: var(--slate-700); margin-bottom: 16px;">Proposed Action Benefit</h4>
          <div class="stat-row">
            <span class="stat-label">High Benefit</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-emerald" style="width: ${getPercent(benefitCounts["High Benefit"])}%"></div>
            </div>
            <span class="stat-value">${benefitCounts["High Benefit"]} (${getPercent(benefitCounts["High Benefit"])}%)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Medium Benefit</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-indigo" style="width: ${getPercent(benefitCounts["Medium Benefit"])}%"></div>
            </div>
            <span class="stat-value">${benefitCounts["Medium Benefit"]} (${getPercent(benefitCounts["Medium Benefit"])}%)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">No Benefit</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-slate" style="width: ${getPercent(benefitCounts["No Benefit"])}%"></div>
            </div>
            <span class="stat-value">${benefitCounts["No Benefit"]} (${getPercent(benefitCounts["No Benefit"])}%)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Detrimental</span>
            <div class="stat-bar-container">
              <div class="stat-bar bg-rose" style="width: ${getPercent(benefitCounts.Detrimental)}%"></div>
            </div>
            <span class="stat-value">${benefitCounts.Detrimental} (${getPercent(benefitCounts.Detrimental)}%)</span>
          </div>
        </div>
      </div>
    </div>
    ` : ""}

    ${traceabilityHtml ? `
    <div class="section-card">
      <h3 class="section-title">Knowledge Graph Affected Node Matrix (System Traceability)</h3>
      <p style="font-size: 12px; color: var(--slate-700); margin-bottom: 20px;">The matrix below tracks how feedback mapping ties directly into active architecture Nodes. Perfect for ensuring feedback concerns map directly to core system blocks.</p>
      <div class="traceability-list">
        ${traceabilityHtml}
      </div>
    </div>
    ` : ""}

    ${issuesHtml ? `
    <div class="section-card">
      <h3 class="section-title" style="color: var(--rose-600);">Audit Flags & Quality Alert Logs</h3>
      <p style="font-size: 12px; color: var(--slate-700); margin-bottom: 20px;">Rigorous evaluation detected critical process quality issues listed below (nonsense comments, hollow reply placeholders, missing details, or misaligned requirements):</p>
      <div class="issues-list">
        ${issuesHtml}
      </div>
    </div>
    ` : ""}

    <div class="section-card" style="padding: 16px; overflow-x: auto;">
      <h3 class="section-title" style="padding: 16px 16px 12px 16px; margin: 0;">Comprehensive Audit Records Log</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 60px;">Index</th>
            <th style="width: 140px;">Commenter</th>
            <th>Review Text, Team Response & Proposed Action</th>
            <th>Auditor Alignment Judgment & Reflection</th>
            <th style="width: 180px;">Trace Node Matrix</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml || `<tr><td colspan="5" style="text-align: center; color: var(--slate-700); padding: 40px 0;">No comments audited in this run yet. Please auto-run audits to generate insights.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

    // Trigger download
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `audit-alignment-insights-report-${runName.toLowerCase().replace(/\s+/g, '-')}.html`;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Process a specific single row via API
  const processSingleRow = async (rowIndex: number, currentSheet: EvaluationSheet) => {
    try {
      setCurrentlyProcessingIdx(rowIndex);
      const res = await fetch(
        `/api/documents/${document.id}/evaluations/${currentSheet.id}/rows/${rowIndex}/process`,
        { method: "POST" }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed processing row ${rowIndex}`);
      }

      const data = await res.json();

      // Update active evaluation's single row locally using the freshest sheet
      if (currentSheet) {
        const updatedRows = currentSheet.rows.map((row) =>
          row.comment.index === rowIndex ? data.row : row
        );

        // Update sheet state
        const updatedSheet = {
          ...currentSheet,
          rows: updatedRows,
          stats: data.stats,
        };

        // Propagate updated sheet
        onEvaluationCreated(updatedSheet);

        // Update details panel selection if active
        if (selectedRow && selectedRow.comment.index === rowIndex) {
          setSelectedRow(data.row);
        }
      }
      return true;
    } catch (err) {
      console.error(`Error processing row ${rowIndex}:`, err);
      return false;
    } finally {
      setCurrentlyProcessingIdx(null);
    }
  };

  // Acknowledge/Reset a failed row to pending status so the error indicator is cleared
  const acknowledgeRowError = async (rowIndex: number) => {
    if (!activeEvaluation) return;
    try {
      setCurrentlyProcessingIdx(rowIndex);
      const res = await fetch(
        `/api/documents/${document.id}/evaluations/${activeEvaluation.id}/rows/${rowIndex}/reset`,
        { method: "POST" }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed resetting row ${rowIndex}`);
      }

      const data = await res.json();

      // Update active evaluation's single row locally
      if (activeEvaluation) {
        const updatedRows = activeEvaluation.rows.map((row) =>
          row.comment.index === rowIndex ? data.row : row
        );

        const updatedSheet = {
          ...activeEvaluation,
          rows: updatedRows,
          stats: data.stats,
        };

        // Propagate updated sheet
        onEvaluationCreated(updatedSheet);

        // Update details panel selection if active
        if (selectedRow && selectedRow.comment.index === rowIndex) {
          setSelectedRow(data.row);
        }
      }
    } catch (err) {
      console.error(`Error resetting row ${rowIndex}:`, err);
    } finally {
      setCurrentlyProcessingIdx(null);
    }
  };

  // Auto-run loop manager
  const startAutoRun = async (sheet: EvaluationSheet) => {
    if (isAutoRunningRef.current) {
      isAutoRunningRef.current = false;
      setIsAutoRunning(false);
      return;
    }

    isAutoRunningRef.current = true;
    setIsAutoRunning(true);

    // Find next pending/error row using the latest evaluation state
    let nextRow = (latestEvaluationRef.current || sheet).rows.find((r) => r.status === "pending" || r.status === "error");

    while (nextRow && isAutoRunningRef.current) {
      const currentSheet = latestEvaluationRef.current || sheet;
      // Process it
      const success = await processSingleRow(nextRow.comment.index, currentSheet);
      if (!success) {
        // Stop auto run on first crash to prevent loop hammering
        isAutoRunningRef.current = false;
        setIsAutoRunning(false);
        break;
      }

      // Fetch fresh sheet state (updated by React after processSingleRow propagates the state)
      const freshSheet = latestEvaluationRef.current;
      if (!freshSheet) break;

      nextRow = freshSheet.rows.find((r) => r.status === "pending" || r.status === "error");
    }

    isAutoRunningRef.current = false;
    setIsAutoRunning(false);
  };

  // Recharts Chart Formats
  const getPieData = () => {
    if (!activeEvaluation) return [];
    const counts = activeEvaluation.stats.sentimentCounts;
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0);
  };

  const getBarData = () => {
    if (!activeEvaluation) return [];
    const counts = activeEvaluation.stats.resolutionCounts;
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  };

  const getBenefitData = () => {
    if (!activeEvaluation) return [];
    const counts = activeEvaluation.stats.benefitCounts;
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  };

  return (
    <div className="space-y-6" id="comment-evaluator-section">
      {/* Upload comment sheet & mapping section */}
      {fileHeaders.length > 0 ? (
        <div className="bg-[#1E293B]/40 backdrop-blur-md p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              <h3 className="text-lg font-bold text-slate-100">2. Configure Spreadsheet Audit Mapping</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Select which spreadsheet columns correspond to the reviewer feedback, the team's official response, and any proposed corrective action.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Audit Name / Run Identifier
              </label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                className="w-full border border-slate-800 rounded-lg text-sm px-3.5 py-2.5 bg-[#020617] text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-semibold"
                placeholder="e.g., Public Consultations Phase 2"
              />
            </div>

            <div className="text-xs text-slate-400 bg-[#020617]/50 p-3 rounded-lg border border-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6 text-indigo-400 shrink-0" />
              <div>
                <span className="font-bold text-slate-200 block">Spreadsheet Read Successfully</span>
                {fileRows.length} data rows imported.
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-4 mt-2">
            <h4 className="text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider">Map Headers</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
              {/* Optional ID */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Row/Comment ID</label>
                <select
                  value={mapping.id}
                  onChange={(e) => setMapping({ ...mapping, id: e.target.value })}
                  className="w-full border border-slate-800 rounded-lg text-xs p-2 bg-[#020617] text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="" className="bg-slate-900">-- Auto Index --</option>
                  {fileHeaders.map((h, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900">
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Optional Author */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Author / Org</label>
                <select
                  value={mapping.author}
                  onChange={(e) => setMapping({ ...mapping, author: e.target.value })}
                  className="w-full border border-slate-800 rounded-lg text-xs p-2 bg-[#020617] text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="" className="bg-slate-900">-- Anonymous --</option>
                  {fileHeaders.map((h, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900">
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Optional Stakeholder */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Stakeholder</label>
                <select
                  value={mapping.stakeholder}
                  onChange={(e) => setMapping({ ...mapping, stakeholder: e.target.value })}
                  className="w-full border border-slate-800 rounded-lg text-xs p-2 bg-[#020617] text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="" className="bg-slate-900">-- Defaults to Author --</option>
                  {fileHeaders.map((h, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900">
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Optional Section */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Section / Page</label>
                <select
                  value={mapping.section}
                  onChange={(e) => setMapping({ ...mapping, section: e.target.value })}
                  className="w-full border border-slate-800 rounded-lg text-xs p-2 bg-[#020617] text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="" className="bg-slate-900">-- None --</option>
                  {fileHeaders.map((h, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900">
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Required Comment */}
              <div>
                <label className="text-[10px] font-bold text-rose-400 uppercase block mb-1">
                  Comment Text <span className="text-rose-400">*</span>
                </label>
                <select
                  value={mapping.comment}
                  onChange={(e) => setMapping({ ...mapping, comment: e.target.value })}
                  className="w-full border border-rose-900/50 rounded-lg text-xs p-2 bg-[#020617] text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                  required
                >
                  <option value="" className="bg-slate-900">-- Select Column --</option>
                  {fileHeaders.map((h, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900">
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Required Response */}
              <div>
                <label className="text-[10px] font-bold text-rose-400 uppercase block mb-1">
                  Team Response <span className="text-rose-400">*</span>
                </label>
                <select
                  value={mapping.response}
                  onChange={(e) => setMapping({ ...mapping, response: e.target.value })}
                  className="w-full border border-rose-900/50 rounded-lg text-xs p-2 bg-[#020617] text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                  required
                >
                  <option value="" className="bg-slate-900">-- Select Column --</option>
                  {fileHeaders.map((h, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900">
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Required Proposed Action */}
              <div>
                <label className="text-[10px] font-bold text-rose-400 uppercase block mb-1">
                  Proposed Action <span className="text-rose-400">*</span>
                </label>
                <select
                  value={mapping.proposedAction}
                  onChange={(e) => setMapping({ ...mapping, proposedAction: e.target.value })}
                  className="w-full border border-rose-900/50 rounded-lg text-xs p-2 bg-[#020617] text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                  required
                >
                  <option value="" className="bg-slate-900">-- Select Column --</option>
                  {fileHeaders.map((h, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900">
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {error && <div className="p-3 text-xs bg-rose-950/40 text-rose-300 border border-rose-900/50 rounded-lg font-medium">{error}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              onClick={() => {
                setFileHeaders([]);
                setFileRows([]);
              }}
              className="px-4 py-2 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateEvaluationRun}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-indigo-500/20"
            >
              Create Audit Run
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* Standard Selection Panel if no spreadsheet is uploaded */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#1E293B]/40 backdrop-blur-md p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-100">2. Upload Comments Spreadsheet</h2>
              <p className="text-xs text-slate-400 mt-1">
                Upload a CSV, XLS, or XLSX document containing comment responses. The engine audits comments line-by-line, determining sentiment and intent, matching to knowledge graph nodes, and evaluating resolution quality and corrective action benefits.
              </p>
            </div>

            {/* Upload Area */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-800 bg-[#020617]/40 hover:border-indigo-500/50 hover:bg-indigo-500/5 rounded-xl p-8 text-center cursor-pointer transition-all"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleSpreadsheetUpload}
                className="hidden"
              />
              <FileSpreadsheet className="w-10 h-10 text-slate-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-200">Select or drop comments file</p>
              <p className="text-xs text-slate-500 mt-0.5">Supports Microsoft Excel (.xlsx, .xls) and CSV (.csv)</p>
            </div>
          </div>

          {/* Evaluations Library */}
          <div className="bg-[#1E293B]/40 backdrop-blur-md p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-between h-full min-h-[240px]">
            <div className="space-y-4">
              <h3 className="text-md font-bold text-slate-100">Evaluation Runs</h3>
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                {allEvaluations.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
                    No evaluations created yet.
                  </div>
                ) : (
                  allEvaluations.map((ev) => {
                    const isActive = ev.id === activeEvaluation?.id;
                    const completionRate = ev.stats.total > 0 ? (ev.stats.completed / ev.stats.total) * 100 : 0;

                    return (
                      <div
                        key={ev.id}
                        onClick={() => onSelectEvaluation(ev.id)}
                        className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between ${
                          isActive
                            ? "bg-indigo-500/10 border-indigo-500/80"
                            : "bg-[#020617]/50 border-slate-800/80 hover:border-slate-700 hover:bg-[#020617]/85"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-bold text-slate-200 truncate">{ev.name}</h4>
                          <div className="flex items-center gap-2 mt-1 text-[9px] font-semibold text-slate-500">
                            <span>{ev.stats.completed}/{ev.stats.total} audited</span>
                            <span>•</span>
                            <span>{completionRate.toFixed(0)}%</span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteEvaluation(ev.id);
                          }}
                          className="text-xs font-bold text-slate-500 hover:text-rose-400 pl-2"
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Evaluation Execution Console */}
      {activeEvaluation && (
        <div className="space-y-6">
          {/* Progress / Control Bar */}
          <div className="bg-[#020617]/90 text-slate-100 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-indigo-400 animate-pulse" />
                <h3 className="text-sm font-bold">{activeEvaluation.name}</h3>
                <span className="text-xs bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-300">
                  {activeEvaluation.stats.completed} of {activeEvaluation.stats.total} Audited
                </span>
              </div>

              {/* Progress Line */}
              <div className="flex items-center gap-3">
                <div className="w-full bg-[#020617] h-2 rounded-full overflow-hidden border border-slate-850">
                  <div
                    className="bg-indigo-500 h-full transition-all duration-300 shadow-md shadow-indigo-500/50"
                    style={{
                      width: `${(activeEvaluation.stats.completed / activeEvaluation.stats.total) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-[11px] font-mono font-bold text-slate-400 shrink-0">
                  {((activeEvaluation.stats.completed / activeEvaluation.stats.total) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Run Controls */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={() => startAutoRun(activeEvaluation)}
                className={`flex items-center gap-1.5 font-bold text-xs px-4 py-2 rounded-lg transition-all shadow-md ${
                  isAutoRunning
                    ? "bg-rose-600 hover:bg-rose-700 text-white"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20"
                }`}
              >
                {isAutoRunning ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    Pause Audits
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Auto Run Audits
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  // Reset processing
                  const freshRow = activeEvaluation.rows.find((r) => r.status === "pending" || r.status === "error");
                  if (freshRow) processSingleRow(freshRow.comment.index, activeEvaluation);
                }}
                disabled={isAutoRunning || currentlyProcessingIdx !== null}
                className="flex items-center gap-1.5 bg-[#1E293B] border border-slate-800 hover:bg-slate-800 text-slate-200 font-bold text-xs px-3.5 py-2 rounded-lg disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${currentlyProcessingIdx !== null ? "animate-spin" : ""}`} />
                Step Next
              </button>

              <button
                onClick={handleExportHtmlReport}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2 rounded-lg transition-all shadow-md shadow-emerald-500/10 pointer-events-auto cursor-pointer"
                title="Export detailed traceable insights to a responsive HTML report file"
              >
                <Download className="w-3.5 h-3.5 text-white" />
                Export HTML Report
              </button>
            </div>
          </div>

          {/* Graphical Analytics Dashboard */}
          {activeEvaluation.stats.completed > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Sentiment Pie */}
              <div className="bg-[#1E293B]/30 backdrop-blur-md p-4 rounded-xl border border-slate-800/80 shadow-lg">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-indigo-400" /> Sentiment Analysis
                </h4>
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                         data={getPieData()}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {getPieData().map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={SENTIMENT_COLORS[entry.name] || "#cbd5e1"} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={24} iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Resolution Stats Bar */}
              <div className="bg-[#1E293B]/30 backdrop-blur-md p-4 rounded-xl border border-slate-800/80 shadow-lg">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" /> Team Resolution Score
                </h4>
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={getBarData()} layout="vertical" margin={{ left: -10, right: 10 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} width={90} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Action Benefit Stats Bar */}
              <div className="bg-[#1E293B]/30 backdrop-blur-md p-4 rounded-xl border border-slate-800/80 shadow-lg">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <BarChart4 className="w-3.5 h-3.5 text-indigo-400" /> Proposed Action Benefit
                </h4>
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={getBenefitData()} margin={{ top: 10, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 8, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 8, fill: "#94a3b8" }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={16}>
                        {getBenefitData().map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={BENEFIT_COLORS[entry.name] || "#6366f1"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Table list & Audit inspection splits */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Rows list */}
            <div className="lg:col-span-2 bg-[#1E293B]/40 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col h-[520px]">
              <div className="bg-[#020617]/50 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Comment List</span>
                <span className="text-[10px] text-slate-500 font-mono">Showing {filteredRows.length} of {activeEvaluation.rows.length} rows</span>
              </div>

              {/* Dynamic Filters Bar */}
              <div className="bg-slate-900/30 px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap gap-2.5 items-center text-[11px]">
                {/* Search box */}
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search comments..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full pl-8 pr-2 py-1 bg-slate-950/80 border border-slate-800 rounded-lg text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Stakeholder dropdown */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Stakeholder:</span>
                  <select
                    value={stakeholderFilter}
                    onChange={(e) => setStakeholderFilter(e.target.value)}
                    className="bg-slate-950/80 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 text-[11px] focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all">All</option>
                    {uniqueStakeholders.map(sh => (
                      <option key={sh} value={sh}>{sh}</option>
                    ))}
                  </select>
                </div>

                {/* Section dropdown */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Section:</span>
                  <select
                    value={sectionFilter}
                    onChange={(e) => setSectionFilter(e.target.value)}
                    className="bg-slate-950/80 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 text-[11px] focus:outline-none focus:border-indigo-500 max-w-[120px] truncate"
                  >
                    <option value="all">All</option>
                    {uniqueSections.map(sec => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                </div>

                {/* Status dropdown */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-slate-950/80 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 text-[11px] focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all">All</option>
                    <option value="completed">Completed</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="error">Error</option>
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
                {filteredRows.map((row) => {
                  const isActive = row.comment.index === selectedRow?.comment.index;
                  const isProcessing = currentlyProcessingIdx === row.comment.index;

                  return (
                    <div
                      key={row.comment.index}
                      onClick={() => setSelectedRow(row)}
                      className={`p-3.5 text-left cursor-pointer transition-colors flex items-start gap-3 ${
                        isActive ? "bg-indigo-500/5 border-l-4 border-indigo-500" : "hover:bg-slate-800/10"
                      }`}
                    >
                      {/* Status indicator */}
                      <div className="pt-0.5 shrink-0">
                        {row.status === "completed" && (
                          <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                        )}
                        {row.status === "processing" && (
                          <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                        )}
                        {row.status === "pending" && (
                          <HelpCircle className="w-4 h-4 text-slate-600" />
                        )}
                        {row.status === "error" && (
                          <AlertTriangle className="w-4 h-4 text-rose-500" />
                        )}
                      </div>

                      {/* Comment text snippet */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-slate-200 truncate block">
                            {row.comment.author} <span className="text-slate-500 font-normal">({row.comment.id || `Row ${row.comment.index + 1}`})</span>
                          </span>

                          <div className="flex items-center gap-1 shrink-0">
                            {row.analysis && (
                              <>
                                {row.analysis.issues && row.analysis.issues.length > 0 && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-0.5" title={`${row.analysis.issues.length} audit issue(s) flagged`}>
                                    <AlertTriangle className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                                    {row.analysis.issues.length} Flag{row.analysis.issues.length > 1 ? "s" : ""}
                                  </span>
                                )}
                                <span
                                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white"
                                  style={{ backgroundColor: SENTIMENT_COLORS[row.analysis.sentiment] }}
                                >
                                  {row.analysis.sentiment}
                                </span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  {row.analysis.intent}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-slate-300 line-clamp-1">
                          <span className="font-semibold text-slate-500">C:</span> {row.comment.comment}
                        </p>
                        <p className="text-xs text-slate-400/80 line-clamp-1 italic">
                          <span className="font-semibold text-slate-500">R:</span> {row.comment.response}
                        </p>
                      </div>

                      {/* Trigger button */}
                      {row.status === "error" ? (
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              processSingleRow(row.comment.index, activeEvaluation);
                            }}
                            disabled={isProcessing || isAutoRunning}
                            className="px-2 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 border border-rose-500/30 text-rose-200 transition-colors disabled:opacity-40 text-[9px] font-bold cursor-pointer"
                            title="Retry the evaluation"
                          >
                            Retry
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              acknowledgeRowError(row.comment.index);
                            }}
                            disabled={isProcessing || isAutoRunning}
                            className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-40 text-[9px] font-bold cursor-pointer"
                            title="Acknowledge and clear error"
                          >
                            Ack
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            processSingleRow(row.comment.index, activeEvaluation);
                          }}
                          disabled={isProcessing || isAutoRunning}
                          className="px-2.5 py-1 rounded bg-[#020617] border border-slate-800 text-slate-400 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-colors disabled:opacity-40 text-[10px] font-bold shrink-0 cursor-pointer"
                        >
                          {row.status === "completed" ? "Re-Audit" : "Audit"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected Row Audit Inspector Panel */}
            <div className="bg-[#1E293B]/40 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl flex flex-col h-[520px] overflow-hidden">
              <div className="bg-[#020617]/50 border-b border-slate-800 px-4 py-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Audit Inspector</span>
              </div>

              {selectedRow ? (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Review inputs */}
                  <div className="space-y-2 bg-[#020617]/40 p-3 rounded-lg border border-slate-800/60 text-xs">
                    <div className="flex flex-wrap gap-1.5 items-center mb-1.5">
                      <div>
                        <span className="font-bold text-slate-500">Author:</span> <span className="text-slate-300 font-semibold">{selectedRow.comment.author}</span>
                      </div>
                      {selectedRow.comment.stakeholder && selectedRow.comment.stakeholder !== selectedRow.comment.author && (
                        <div className="bg-slate-800/60 text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-700">
                          <span className="text-slate-500 font-bold">Stakeholder:</span> {selectedRow.comment.stakeholder}
                        </div>
                      )}
                      {selectedRow.comment.section && (
                        <div className="bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-500/20">
                          <span className="text-indigo-400 font-bold">Section:</span> {selectedRow.comment.section}
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <span className="font-bold text-slate-500 block mb-1">Comment:</span>
                      <p className="text-slate-300 bg-[#020617]/80 p-2 rounded border border-slate-800/80 font-medium">
                        "{selectedRow.comment.comment}"
                      </p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-500 block mb-1">Team Response:</span>
                      <p className="text-slate-400 italic bg-[#020617]/80 p-2 rounded border border-slate-800/80 font-medium">
                        "{selectedRow.comment.response || "No response provided"}"
                      </p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-500 block mb-1">Proposed Action:</span>
                      <p className="text-slate-300 bg-[#020617]/80 p-2 rounded border border-slate-800/80 font-medium">
                        "{selectedRow.comment.proposedAction || "No action proposed"}"
                      </p>
                    </div>

                    {/* Dynamic Metadata */}
                    {selectedRow.comment.metadata && Object.keys(selectedRow.comment.metadata).length > 0 && (
                      <div className="pt-2 border-t border-slate-800/60 flex flex-wrap gap-1.5 items-center">
                        <span className="font-bold text-slate-500 block text-[9px] uppercase tracking-wider">Sheet Metadata:</span>
                        {Object.entries(selectedRow.comment.metadata).map(([key, val]) => (
                          <div key={key} className="bg-slate-900/80 px-1.5 py-0.5 rounded text-[10px] border border-slate-800 text-slate-400" title={`${key}: ${val}`}>
                            <span className="text-slate-600 font-semibold">{key}:</span> {val}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Audit Outputs */}
                  {selectedRow.status === "completed" && selectedRow.analysis ? (
                    <div className="space-y-4 pt-1 border-t border-slate-800/60">
                      
                      {/* Issues & Quality Flags Caught */}
                      {selectedRow.analysis.issues && selectedRow.analysis.issues.length > 0 && (
                        <div className="space-y-2 bg-rose-500/5 border border-rose-500/20 p-3 rounded-xl">
                          <span className="text-[10px] text-rose-400 block font-bold uppercase tracking-wider flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Audit Flags Caught ({selectedRow.analysis.issues.length})
                          </span>
                          <div className="space-y-1.5">
                            {selectedRow.analysis.issues.map((issue, idx) => (
                              <div key={idx} className="text-xs bg-slate-950/40 p-2.5 rounded-lg border border-rose-500/10">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-rose-300">{issue.type}</span>
                                  <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                    issue.severity === "High" ? "bg-rose-500 text-white" : "bg-amber-500 text-slate-950"
                                  }`}>
                                    {issue.severity} Severity
                                  </span>
                                </div>
                                <p className="text-slate-300 mt-1 text-[11px] leading-normal font-medium">{issue.description}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-xs">
                          <span className="text-[10px] text-slate-500 block font-bold uppercase">Sentiment</span>
                          <span
                            className="text-xs font-bold px-2 py-0.5 rounded-full text-white inline-block mt-0.5"
                            style={{ backgroundColor: SENTIMENT_COLORS[selectedRow.analysis.sentiment] }}
                          >
                            {selectedRow.analysis.sentiment}
                          </span>
                        </div>

                        <div className="text-xs">
                          <span className="text-[10px] text-slate-500 block font-bold uppercase">Intent</span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 inline-block mt-0.5">
                            {selectedRow.analysis.intent}
                          </span>
                        </div>
                      </div>

                      {/* Resolution Assessment */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 block font-bold uppercase">Resolution Quality</span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs font-bold px-2.5 py-0.5 rounded-lg border ${
                              selectedRow.analysis.resolutionScore.includes("Fully")
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : selectedRow.analysis.resolutionScore.includes("Partially")
                                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            }`}
                          >
                            {selectedRow.analysis.resolutionScore}
                          </span>
                        </div>
                      </div>

                      {/* Proposed Action Benefit */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 block font-bold uppercase">Proposed Action Benefit</span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-xs font-bold px-2.5 py-0.5 rounded-lg border"
                            style={{
                              backgroundColor: BENEFIT_COLORS[selectedRow.analysis.proposedActionBenefit] + "10",
                              color: BENEFIT_COLORS[selectedRow.analysis.proposedActionBenefit],
                              borderColor: BENEFIT_COLORS[selectedRow.analysis.proposedActionBenefit] + "30",
                            }}
                          >
                            {selectedRow.analysis.proposedActionBenefit}
                          </span>
                        </div>
                      </div>

                      {/* Two-Pass RAG Search Telemetry */}
                      {selectedRow.analysis.knowledgeRequest && (
                        <div className="bg-[#020617]/40 p-3 rounded-lg border border-indigo-500/10 space-y-2 text-xs">
                          <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block flex items-center gap-1">
                            <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
                            Two-Pass RAG Audit Telemetry
                          </span>
                          
                          <div className="text-[11px] text-slate-400 space-y-1 leading-normal font-medium">
                            <div>
                              <span className="font-bold text-slate-500">Requested headings/sections:</span>{" "}
                              {selectedRow.analysis.knowledgeRequest.requestedPagesOrSections && selectedRow.analysis.knowledgeRequest.requestedPagesOrSections.length > 0 ? (
                                <span className="text-indigo-300 font-semibold">
                                  {selectedRow.analysis.knowledgeRequest.requestedPagesOrSections.join(", ")}
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">No specific heading requested</span>
                              )}
                            </div>
                            <div>
                              <span className="font-bold text-slate-500">Search Keywords:</span>{" "}
                              <code className="bg-slate-950 px-1 py-0.5 rounded font-mono text-[10px] text-indigo-400">
                                "{selectedRow.analysis.knowledgeRequest.searchQuery}"
                              </code>
                            </div>
                            <div>
                              <span className="font-bold text-slate-500">Lookup Reason:</span>{" "}
                              <span className="italic">"{selectedRow.analysis.knowledgeRequest.reason}"</span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 block font-bold uppercase">Retrieved Context Snippets</span>
                            <div className="text-[11px] leading-relaxed text-slate-300 bg-slate-950 p-2.5 rounded border border-slate-800 max-h-[140px] overflow-y-auto font-mono whitespace-pre-wrap">
                              {selectedRow.analysis.retrievedContext || "No matching reference document text was found."}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Mapped Nodes */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 block font-bold uppercase">Mapped Knowledge Nodes</span>
                        <div className="flex flex-wrap gap-1">
                          {selectedRow.analysis.mappedNodes.length === 0 ? (
                            <span className="text-xs text-slate-500 italic">No node mappings identified</span>
                          ) : (
                            selectedRow.analysis.mappedNodes.map((nId) => {
                              const node = document.knowledgeGraph.nodes.find((kn) => kn.id === nId);
                              return (
                                <button
                                  key={nId}
                                  onClick={() => onHighlightNode && onHighlightNode(nId)}
                                  className="text-[10px] font-bold bg-[#020617] text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/30 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                                  title="Click to view and highlight node in graph"
                                >
                                  {node ? node.label : nId}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Reflection */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 block font-bold uppercase">Critical Audit Reflection</span>
                        <div className="text-xs text-slate-300 bg-[#020617]/60 border border-slate-800/80 p-3 rounded-lg leading-relaxed whitespace-pre-wrap font-medium">
                          {selectedRow.analysis.reflection}
                        </div>
                      </div>
                    </div>
                  ) : selectedRow.status === "processing" ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
                      <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                      <span className="text-xs font-semibold">Gemini is auditing this entry...</span>
                    </div>
                  ) : selectedRow.status === "error" ? (
                    <div className="bg-rose-950/20 border border-rose-900/50 p-5 rounded-xl text-center text-rose-400 space-y-4 mt-4">
                      <div className="space-y-1">
                        <AlertTriangle className="w-8 h-8 mx-auto text-rose-500 animate-pulse" />
                        <p className="text-sm font-bold text-rose-300">Audit Evaluation Failed</p>
                        <p className="text-[11px] opacity-80 max-w-sm mx-auto">{selectedRow.error || "Failed to receive response from the LLM endpoint"}</p>
                      </div>
                      
                      <div className="flex items-center justify-center gap-3 pt-2">
                        <button
                          onClick={() => processSingleRow(selectedRow.comment.index, activeEvaluation)}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-lg shadow-rose-600/20"
                        >
                          Retry Audit
                        </button>
                        <button
                          onClick={() => acknowledgeRowError(selectedRow.comment.index)}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors border border-slate-700 hover:border-slate-600 cursor-pointer"
                        >
                          Acknowledge Error
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-xl mt-4">
                      <Play className="w-8 h-8 text-slate-600 stroke-1 mb-2" />
                      <p className="text-xs font-semibold text-slate-400">Pending Audit</p>
                      <button
                        onClick={() => processSingleRow(selectedRow.comment.index, activeEvaluation)}
                        className="mt-3 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-lg shadow-indigo-500/20 cursor-pointer"
                      >
                        Audit Entry
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <Eye className="w-8 h-8 stroke-1 text-slate-600 mb-2" />
                  <p className="text-xs font-semibold text-slate-400">Select a comment row to inspect the full review audit detail and critical reflections.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
