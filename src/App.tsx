import React, { useEffect, useState } from "react";
import { DocumentInfo, EvaluationSheet } from "./types";
import UploadDocument from "./components/UploadDocument";
import KnowledgeGraphViewer from "./components/KnowledgeGraphViewer";
import CommentEvaluator from "./components/CommentEvaluator";
import DocumentReader from "./components/DocumentReader";
import SettingsModal from "./components/SettingsModal";
import {
  FileText,
  Network,
  ClipboardList,
  Cpu,
  RefreshCw,
  HelpCircle,
  TrendingUp,
  Settings,
  HelpCircle as InfoIcon,
} from "lucide-react";

export default function App() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentInfo | null>(null);
  const [allEvaluations, setAllEvaluations] = useState<EvaluationSheet[]>([]);
  const [activeEval, setActiveEval] = useState<EvaluationSheet | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Tabs: "document" (Reference Document), "graph" (Document Graph Viewer) or "audits" (Review Comment Auditing)
  const [activeTab, setActiveTab] = useState<"document" | "graph" | "audits">("document");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

  // Global loading/error
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isApiOnline, setIsApiOnline] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Check backend health on mount
  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (res.ok) setIsApiOnline(true);
        else setIsApiOnline(false);
      })
      .catch(() => setIsApiOnline(false));

    loadDocuments();
  }, []);

  // Load documents list (metadata only)
  const loadDocuments = async () => {
    setIsLoadingDocs(true);
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error("Failed to load documents list");
      const list = await res.json();
      setDocuments(list);

      // Default select the first document if available and nothing is selected yet
      if (list.length > 0 && !activeDoc) {
        handleSelectDocument(list[0].id);
      }
    } catch (err: any) {
      setApiError(err.message || "Could not retrieve document list.");
    } finally {
      setIsLoadingDocs(false);
    }
  };

  // Select a document & load full details + its evaluations
  const handleSelectDocument = async (docId: string) => {
    try {
      setApiError(null);
      const res = await fetch(`/api/documents/${docId}`);
      if (!res.ok) throw new Error("Failed to load document details");
      const fullDoc = await res.json();
      setActiveDoc(fullDoc);

      // Load associated evaluation sheets
      const evalRes = await fetch(`/api/documents/${docId}/evaluations`);
      if (!evalRes.ok) throw new Error("Failed to load evaluations list");
      const evals: EvaluationSheet[] = await evalRes.json();
      setAllEvaluations(evals);

      // Auto-activate first evaluation sheet if available, else null
      if (evals.length > 0) {
        setActiveEval(evals[0]);
      } else {
        setActiveEval(null);
      }

      // Reset graph highlights
      setSelectedNodeId(undefined);
    } catch (err: any) {
      setApiError(err.message || "Failed to switch active document.");
    }
  };

  // Delete document
  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Are you sure you want to delete this document and all its associated comment audits? This cannot be undone.")) return;

    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete document");

      // Reload
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      if (activeDoc?.id === docId) {
        setActiveDoc(null);
        setAllEvaluations([]);
        setActiveEval(null);
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete document");
    }
  };

  // Handle document creation
  const handleDocumentCreated = (newDoc: DocumentInfo) => {
    setDocuments((prev) => [
      {
        id: newDoc.id,
        name: newDoc.name,
        createdAt: newDoc.createdAt,
        nodeCount: newDoc.knowledgeGraph.nodes.length,
        edgeCount: newDoc.knowledgeGraph.edges.length,
      },
      ...prev,
    ]);
    setActiveDoc(newDoc);
    setAllEvaluations([]);
    setActiveEval(null);
    setSelectedNodeId(undefined);
    setActiveTab("graph"); // Switch to graph to see the newly generated visualizer immediately
  };

  // Handle evaluation creation
  const handleEvaluationCreated = (newSheet: EvaluationSheet) => {
    setAllEvaluations((prev) => {
      const index = prev.findIndex((e) => e.id === newSheet.id);
      if (index > -1) {
        // Replace existing
        const copy = [...prev];
        copy[index] = newSheet;
        return copy;
      } else {
        return [newSheet, ...prev];
      }
    });
    setActiveEval(newSheet);
  };

  // Select evaluation
  const handleSelectEvaluation = (evalId: string) => {
    const sheet = allEvaluations.find((e) => e.id === evalId);
    if (sheet) setActiveEval(sheet);
  };

  // Delete evaluation
  const handleDeleteEvaluation = async (evalId: string) => {
    if (!confirm("Are you sure you want to delete this audit run?")) return;

    try {
      const res = await fetch(`/api/documents/${activeDoc?.id}/evaluations/${evalId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete audit");

      setAllEvaluations((prev) => prev.filter((e) => e.id !== evalId));
      if (activeEval?.id === evalId) {
        setActiveEval(null);
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete audit");
    }
  };

  // Highlight a node on the graph from the review table mappings
  const handleHighlightNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setActiveTab("graph"); // Switch to the graph visualizer
    // Scroll to graph viewer section smoothly
    const graphElem = document.getElementById("knowledge-graph-viewer");
    if (graphElem) {
      graphElem.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col font-sans" id="app-root">
      {/* Sticky App Header */}
      <header className="sticky top-0 z-40 bg-[#020617]/90 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 text-white p-2 rounded-xl shadow-lg shadow-indigo-500/20 shrink-0 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-md font-extrabold text-slate-100 tracking-tight">
              Document Knowledge Graph & Comment Audit Tool
            </h1>
            <p className="text-[11px] text-slate-400 font-medium">
              Line-by-line review alignment evaluation powered by Gemini AI
            </p>
          </div>
        </div>

        {/* API Connection Indicator & Settings */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {isApiOnline === true ? (
              <span className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Engine Online
              </span>
            ) : isApiOnline === false ? (
              <span className="flex items-center gap-1.5 bg-rose-500/10 text-rose-400 text-[10px] font-bold px-2.5 py-1 rounded-full border border-rose-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                Engine Offline
              </span>
            ) : (
              <span className="flex items-center gap-1.5 bg-slate-800 text-slate-400 text-[10px] font-bold px-2.5 py-1 rounded-full border border-slate-700">
                <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                Connecting...
              </span>
            )}
          </div>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-bold transition-all pointer-events-auto cursor-pointer"
            title="Configure Models & Settings"
          >
            <Settings className="w-3.5 h-3.5 text-indigo-400" />
            Settings
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-8">
        {/* Error Notification */}
        {apiError && (
          <div className="bg-rose-950/40 border border-rose-900/50 text-rose-200 p-4 rounded-xl text-xs font-semibold shadow-sm">
            {apiError}
          </div>
        )}

        {/* 1. Document Feeding Section */}
        <section className="space-y-4">
          <UploadDocument
            onDocumentCreated={handleDocumentCreated}
            existingDocuments={documents}
            onSelectDocument={handleSelectDocument}
            onDeleteDocument={handleDeleteDocument}
            activeDocId={activeDoc?.id}
          />
        </section>

        {/* Action Panel: Interactive Visualizer & Comment Auditing */}
        {activeDoc ? (
          <section className="space-y-6">
            {/* Tab Navigation Menu */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-px">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab("document")}
                  className={`flex items-center gap-2 pb-3.5 text-sm font-bold transition-all border-b-2 px-1 ${
                    activeTab === "document"
                      ? "border-indigo-500 text-indigo-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Reference Document Reader
                </button>
                <button
                  onClick={() => setActiveTab("graph")}
                  className={`flex items-center gap-2 pb-3.5 text-sm font-bold transition-all border-b-2 px-1 ${
                    activeTab === "graph"
                      ? "border-indigo-500 text-indigo-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Network className="w-4 h-4" />
                  Reference Knowledge Graph
                </button>
                <button
                  onClick={() => setActiveTab("audits")}
                  className={`flex items-center gap-2 pb-3.5 text-sm font-bold transition-all border-b-2 px-1 ${
                    activeTab === "audits"
                      ? "border-indigo-500 text-indigo-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  Review Comment Audits
                  {allEvaluations.length > 0 && (
                    <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">
                      {allEvaluations.length}
                    </span>
                  )}
                </button>
              </div>

              <div className="text-xs text-slate-400 font-medium bg-slate-900/50 border border-slate-800 px-3 py-1 rounded-lg">
                Active Context: <span className="font-bold text-indigo-400">{activeDoc.name}</span>
              </div>
            </div>

            {/* Dynamic Views */}
            <div className="transition-all duration-300">
              {activeTab === "document" ? (
                <DocumentReader document={activeDoc} />
              ) : activeTab === "graph" ? (
                <div className="space-y-4">
                  <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl text-xs text-slate-300 flex items-start gap-2.5">
                    <TrendingUp className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-indigo-300 block mb-0.5">Interactive Concept Knowledge Graph Ready</span>
                      Select any concept node in the visualizer to explore its description and connections, search for specific terms, or filter by classifications.
                    </div>
                  </div>
                  <KnowledgeGraphViewer
                    graph={activeDoc.knowledgeGraph}
                    onSelectNode={setSelectedNodeId}
                    selectedNodeId={selectedNodeId}
                  />
                </div>
              ) : (
                <CommentEvaluator
                  document={activeDoc}
                  onEvaluationCreated={handleEvaluationCreated}
                  activeEvaluation={activeEval}
                  onSelectEvaluation={handleSelectEvaluation}
                  onDeleteEvaluation={handleDeleteEvaluation}
                  allEvaluations={allEvaluations}
                  onHighlightNode={handleHighlightNode}
                />
              )}
            </div>
          </section>
        ) : (
          /* Empty State Guard */
          <section className="bg-slate-900/40 rounded-2xl border border-slate-800/80 p-12 text-center max-w-xl mx-auto shadow-xl border-dashed space-y-3">
            <FileText className="w-12 h-12 text-slate-500 mx-auto stroke-1" />
            <h3 className="text-md font-bold text-slate-300">No Document Active</h3>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
              Feed or select a reference document at the top. The engine will synthesize its contents, creating organized concept nodes and paving the way to run line-by-line feedback alignment audits.
            </p>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#020617] border-t border-slate-900 py-6 text-center text-xs text-slate-500 mt-auto">
        Document Knowledge Graph & Comment Audit Tool • Crafted with Enterprise-grade Gemini AI Intelligence
      </footer>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
