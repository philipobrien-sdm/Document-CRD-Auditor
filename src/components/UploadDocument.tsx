import React, { useState, useRef } from "react";
import { Upload, FileText, Clipboard, Trash2, ArrowRight, Loader2, File } from "lucide-react";

interface UploadDocumentProps {
  onDocumentCreated: (doc: any) => void;
  existingDocuments: any[];
  onSelectDocument: (docId: string) => void;
  onDeleteDocument: (docId: string) => void;
  activeDocId?: string;
}

export default function UploadDocument({
  onDocumentCreated,
  existingDocuments,
  onSelectDocument,
  onDeleteDocument,
  activeDocId,
}: UploadDocumentProps) {
  const [activeTab, setActiveTab] = useState<"upload" | "paste">("upload");
  const [docName, setDocName] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndSetFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    setError(null);
    const validTypes = ["application/pdf", "text/plain"];
    if (!validTypes.includes(file.type)) {
      setError("Unsupported file format. Please upload a PDF (.pdf) or Plain Text (.txt) file.");
      return;
    }
    setSelectedFile(file);
    if (!docName) {
      // Set default name without extension
      const defaultName = file.name.replace(/\.[^/.]+$/, "");
      setDocName(defaultName);
    }
  };

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:application/pdf;base64, prefix
        const base64Str = result.split(",")[1];
        resolve(base64Str);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // Submit document to backend
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!docName.trim()) {
      setError("Please specify a document name or title.");
      return;
    }

    if (activeTab === "paste" && !pastedText.trim()) {
      setError("Please paste some document content first.");
      return;
    }

    if (activeTab === "upload" && !selectedFile) {
      setError("Please select or drop a document file.");
      return;
    }

    setIsProcessing(true);

    try {
      let payload: any = {
        name: docName.trim(),
      };

      if (activeTab === "paste") {
        payload.mimeType = "text/plain";
        payload.content = pastedText;
      } else if (selectedFile) {
        payload.mimeType = selectedFile.type;
        if (selectedFile.type === "application/pdf") {
          const b64 = await fileToBase64(selectedFile);
          payload.base64 = b64;
        } else {
          // Plain Text file
          const text = await selectedFile.text();
          payload.content = text;
        }
      }

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to process document");
      }

      const newDoc = await res.json();
      onDocumentCreated(newDoc);
      // Reset form
      setDocName("");
      setPastedText("");
      setSelectedFile(null);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during processing.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="upload-document-section">
      {/* Upload/Paste Panel */}
      <div className="lg:col-span-2 bg-[#1E293B]/40 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100">1. Feed Reference Document</h2>
          <p className="text-xs text-slate-400 mt-1">
            Provide a system blueprint, design specification, technical guideline, or policy document. Gemini will automatically synthesize it into an interactive concept knowledge graph.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800">
          <button
            onClick={() => {
              setActiveTab("upload");
              setError(null);
            }}
            className={`flex items-center gap-2 pb-3 text-sm font-semibold transition-all border-b-2 px-1 ${
              activeTab === "upload"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Upload className="w-4 h-4" />
            File Upload (PDF / TXT)
          </button>
          <button
            onClick={() => {
              setActiveTab("paste");
              setError(null);
            }}
            className={`flex items-center gap-2 pb-3 text-sm font-semibold transition-all border-b-2 px-1 ml-6 ${
              activeTab === "paste"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Clipboard className="w-4 h-4" />
            Paste Text
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
              Document Name / Title
            </label>
            <input
              type="text"
              placeholder="e.g. System Security Requirements Spec"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              className="w-full border border-slate-800 rounded-lg text-sm px-3.5 py-2.5 bg-[#020617] text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              required
            />
          </div>

          {activeTab === "upload" ? (
            /* Upload box */
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragActive
                  ? "border-indigo-500 bg-indigo-500/10"
                  : selectedFile
                    ? "border-slate-700 bg-[#020617]/60"
                    : "border-slate-800 bg-[#020617]/30 hover:border-indigo-500/50 hover:bg-indigo-500/5"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                onChange={handleFileChange}
                className="hidden"
              />

              {selectedFile ? (
                <div className="space-y-2">
                  <FileText className="w-10 h-10 text-indigo-400 mx-auto" />
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{selectedFile.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.type === "application/pdf" ? "PDF Document" : "Plain Text"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setDocName("");
                    }}
                    className="text-xs font-medium text-rose-400 hover:text-rose-300 underline"
                  >
                    Remove file
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-10 h-10 text-slate-500 mx-auto" />
                  <div>
                    <p className="text-sm font-semibold text-slate-300">Drag and drop file here, or click to browse</p>
                    <p className="text-xs text-slate-500 mt-0.5">Supports PDF (.pdf) or Plain Text (.txt)</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Paste Box */
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Paste Content Here
              </label>
              <textarea
                placeholder="Paste the raw text of the document here..."
                rows={8}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                className="w-full border border-slate-800 rounded-lg text-sm px-3.5 py-2.5 bg-[#020617] text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-mono"
              />
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-950/25 border border-rose-900/50 rounded-xl space-y-3">
              <div className="text-xs text-rose-300 font-medium">
                <span className="font-bold">Error:</span> {error}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => handleSubmit(e)}
                  disabled={isProcessing}
                  className="px-3 py-1.5 bg-rose-600/35 hover:bg-rose-600/50 text-rose-200 border border-rose-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  Retry Process
                </button>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            {!error && (
              <button
                type="submit"
                disabled={isProcessing}
                className="flex items-center gap-1.5 bg-indigo-600 text-white font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    Synthesizing Knowledge Graph...
                  </>
                ) : (
                  <>
                    Process Document
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Existing Documents Library */}
      <div className="bg-[#1E293B]/40 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl p-6 flex flex-col justify-between h-full min-h-[360px]">
        <div className="space-y-4">
          <div>
            <h3 className="text-md font-bold text-slate-100">Reference Library</h3>
            <p className="text-xs text-slate-400 mt-1">Select a previously synthesized document to view its graph and run audits.</p>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {existingDocuments.length === 0 ? (
              <div className="text-center p-8 border border-dashed border-slate-800 rounded-xl text-slate-500">
                <File className="w-8 h-8 mx-auto text-slate-600 stroke-1 mb-2" />
                <p className="text-xs font-medium">No documents processed yet.</p>
              </div>
            ) : (
              existingDocuments.map((doc) => {
                const isActive = doc.id === activeDocId;
                return (
                  <div
                    key={doc.id}
                    onClick={() => onSelectDocument(doc.id)}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex items-start justify-between gap-2 group ${
                      isActive
                        ? "bg-indigo-500/10 border-indigo-500/80 ring-1 ring-indigo-500/80"
                        : "bg-[#020617]/50 border-slate-800/80 hover:border-slate-700 hover:bg-[#020617]/80"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-slate-200 group-hover:text-slate-100 truncate">{doc.name}</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span className="bg-slate-800 text-slate-300 border border-slate-700/50 px-1.5 py-0.5 rounded text-[9px] font-semibold font-mono">
                          {doc.nodeCount} Nodes
                        </span>
                        <span className="bg-slate-800 text-slate-300 border border-slate-700/50 px-1.5 py-0.5 rounded text-[9px] font-semibold font-mono">
                          {doc.edgeCount} Edges
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDocument(doc.id);
                      }}
                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {activeDocId && (
          <div className="pt-4 border-t border-slate-800/60 mt-4 text-center">
            <div className="text-[11px] text-indigo-300 font-bold bg-indigo-500/10 py-2 rounded-lg border border-indigo-500/20 shadow-sm">
              ✓ Active: {existingDocuments.find((d) => d.id === activeDocId)?.name}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
