import React, { useState, useEffect } from "react";
import { Settings, Cpu, Save, X, RefreshCw, CheckCircle, HelpCircle, AlertCircle, Download, Upload } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved?: () => void;
}

export default function SettingsModal({ isOpen, onClose, onSettingsSaved }: SettingsModalProps) {
  const [localLlmAddress, setLocalLlmAddress] = useState("http://localhost:11434");
  const [kbModel, setKbModel] = useState("gemini-3.5-flash");
  const [auditModel, setAuditModel] = useState("gemini-3.5-flash");
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  
  // Backup & Restore states
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });

  // Load existing settings on open
  useEffect(() => {
    if (isOpen) {
      fetch("/api/settings")
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error("Failed to load settings");
        })
        .then((data) => {
          if (data) {
            setLocalLlmAddress(data.localLlmAddress || "http://localhost:11434");
            setKbModel(data.kbModel || "gemini-3.5-flash");
            setAuditModel(data.auditModel || "gemini-3.5-flash");
          }
        })
        .catch((err) => console.error("Error loading settings:", err));
    }
  }, [isOpen]);

  // Handle fetching models from local address
  const handleFetchLocalModels = async () => {
    setIsFetchingModels(true);
    setFetchStatus({ type: null, message: "" });
    try {
      const res = await fetch("/api/local-llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: localLlmAddress }),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to fetch models");
      }
      
      const data = await res.json();
      if (data && Array.isArray(data.models)) {
        setLocalModels(data.models);
        if (data.models.length > 0) {
          setFetchStatus({
            type: "success",
            message: `Successfully connected! Found ${data.models.length} model(s).`,
          });
        } else {
          setFetchStatus({
            type: "error",
            message: "Connected, but no models were returned. Check your Ollama/Local LLM tags.",
          });
        }
      }
    } catch (err: any) {
      setFetchStatus({
        type: "error",
        message: err.message || "Failed to connect to local LLM. Ensure server is running and CORS is enabled.",
      });
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Handle settings save
  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localLlmAddress,
          kbModel,
          auditModel,
        }),
      });

      if (!res.ok) throw new Error("Failed to save settings");

      setShowSavedToast(true);
      if (onSettingsSaved) {
        onSettingsSaved();
      }
      setTimeout(() => {
        setShowSavedToast(false);
        onClose();
      }, 1200);
    } catch (err: any) {
      alert("Error saving settings: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Export full JSON database backup
  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error("Failed to download database state.");
      const data = await res.json();
      
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(data, null, 2)
      )}`;
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", jsonString);
      downloadAnchor.setAttribute("download", `knowledge-audit-backup-${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err: any) {
      alert("Error exporting backup: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Import JSON database backup
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus({ type: null, message: "" });

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsedData = JSON.parse(event.target?.result as string);
        if (!parsedData || !Array.isArray(parsedData.documents) || !Array.isArray(parsedData.evaluations)) {
          throw new Error("Invalid schema structure. Must contain 'documents' and 'evaluations' arrays.");
        }

        const res = await fetch("/api/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsedData),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to restore backup");
        }

        setImportStatus({
          type: "success",
          message: "Database restored successfully! Reloading application...",
        });

        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } catch (err: any) {
        setImportStatus({
          type: "error",
          message: err.message || "Failed to read backup file.",
        });
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in" id="settings-modal-overlay">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-400" />
            <h2 className="text-md font-extrabold text-slate-100 tracking-tight">AI Orchestration Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1 hover:bg-slate-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Section 1: Local LLM Configuration */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-indigo-400" />
              Local LLM Service Configuration
            </h3>
            
            <p className="text-xs text-slate-400 leading-relaxed">
              If running an offline or local LLM server (like Ollama, LM Studio, or LLaMA.cpp), specify its endpoint address to fetch available models.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={localLlmAddress}
                onChange={(e) => setLocalLlmAddress(e.target.value)}
                placeholder="e.g. http://localhost:11434"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <button
                onClick={handleFetchLocalModels}
                disabled={isFetchingModels}
                className="bg-indigo-600/10 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 font-bold px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                {isFetchingModels ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Connect & Fetch
              </button>
            </div>

            {/* Fetch Status Messages */}
            {fetchStatus.type && (
              <div
                className={`p-3 rounded-xl text-xs flex items-start gap-2.5 ${
                  fetchStatus.type === "success"
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                    : "bg-amber-500/10 border border-amber-500/20 text-amber-300"
                }`}
              >
                {fetchStatus.type === "success" ? (
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span className="leading-normal">{fetchStatus.message}</span>
              </div>
            )}

            {/* Ollama Tips */}
            <div className="bg-slate-950/40 border border-slate-800/80 p-3 rounded-xl space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <HelpCircle className="w-3 h-3 text-indigo-400" />
                OLLAMA CORS SETUP TIP
              </span>
              <p className="text-[10px] text-slate-500 leading-normal">
                By default, Ollama blocks cross-origin requests. Enable access by starting it with:
                <code className="block bg-slate-950 text-indigo-400 p-1.5 rounded border border-slate-800 mt-1 font-mono text-[9px]">
                  OLLAMA_ORIGINS="*" ollama serve
                </code>
              </p>
            </div>
          </div>

          <hr className="border-slate-800" />

          {/* Section 2: Task specific configurations */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Task-Specific Model Mapping
            </h3>

            {/* Task A: Knowledge Graph Extraction */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex justify-between">
                <span>Task 1: Knowledge Graph Extraction</span>
                <span className="text-[10px] font-normal text-indigo-400">Smaller models perform well here</span>
              </label>
              <select
                value={kbModel}
                onChange={(e) => setKbModel(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <optgroup label="Cloud Models (Enterprise Gemini)">
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash (Default - Balanced)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Comprehension)</option>
                </optgroup>
                {localModels.length > 0 && (
                  <optgroup label="Offline Local Models (Retrieved)">
                    {localModels.map((m) => (
                      <option key={`kb-${m}`} value={`local:${m}`}>
                        Local LLM: {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Fallback option if user knows local model name without querying */}
                <optgroup label="Custom Options">
                  <option value="local:custom">Local LLM: Enter Name Below</option>
                </optgroup>
              </select>
              {kbModel === "local:custom" && (
                <input
                  type="text"
                  placeholder="Enter exact local model name (e.g. llama3)"
                  onChange={(e) => setKbModel(`local:${e.target.value}`)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none mt-1.5"
                />
              )}
            </div>

            {/* Task B: Review Comment Auditing */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex justify-between">
                <span>Task 2: Line-by-Line Comment Auditing</span>
                <span className="text-[10px] font-normal text-indigo-400">Requires high reasoning logic</span>
              </label>
              <select
                value={auditModel}
                onChange={(e) => setAuditModel(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <optgroup label="Cloud Models (Enterprise Gemini)">
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash (Default - Fast)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (Audit Specialist)</option>
                </optgroup>
                {localModels.length > 0 && (
                  <optgroup label="Offline Local Models (Retrieved)">
                    {localModels.map((m) => (
                      <option key={`audit-${m}`} value={`local:${m}`}>
                        Local LLM: {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Custom Options">
                  <option value="local:custom">Local LLM: Enter Name Below</option>
                </optgroup>
              </select>
              {auditModel === "local:custom" && (
                <input
                  type="text"
                  placeholder="Enter exact local model name (e.g. mistral)"
                  onChange={(e) => setAuditModel(`local:${e.target.value}`)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none mt-1.5"
                />
              )}
            </div>
          </div>

          <hr className="border-slate-800" />

          {/* Section 3: Save & Load State from JSON */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Download className="w-4 h-4 text-indigo-400" />
              Backup & Restore (Save/Load State)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Export the full database state (uploaded documents, audited comments, ratings, metrics) as a JSON backup, or load an existing state.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={handleExportBackup}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 hover:border-slate-700 hover:bg-slate-900 rounded-xl px-4 py-2.5 text-xs text-slate-300 font-bold transition-all"
              >
                {isExporting ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                ) : (
                  <Download className="w-4 h-4 text-indigo-400" />
                )}
                Export DB JSON
              </button>

              <label className="flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 hover:border-slate-700 hover:bg-slate-900 rounded-xl px-4 py-2.5 text-xs text-slate-300 font-bold transition-all cursor-pointer">
                {isImporting ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                ) : (
                  <Upload className="w-4 h-4 text-indigo-400" />
                )}
                Import DB JSON
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportBackup}
                  disabled={isImporting}
                  className="hidden"
                />
              </label>
            </div>

            {/* Import Status Messages */}
            {importStatus.type && (
              <div
                className={`p-3 rounded-xl text-xs flex items-start gap-2.5 ${
                  importStatus.type === "success"
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                    : "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                }`}
              >
                {importStatus.type === "success" ? (
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span className="leading-normal">{importStatus.message}</span>
              </div>
            )}
          </div>

        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 px-6 py-4 bg-slate-900/60 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-300 hover:text-white font-bold px-4 py-2 rounded-xl text-xs transition-all"
          >
            Cancel
          </button>
          
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/10 disabled:opacity-50"
          >
            {showSavedToast ? (
              <>
                <CheckCircle className="w-4 h-4 text-white" />
                Settings Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Preferences
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
