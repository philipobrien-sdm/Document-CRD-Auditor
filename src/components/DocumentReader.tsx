import React, { useState, useMemo, useRef, useEffect } from "react";
import { DocumentInfo } from "../types";
import {
  FileText,
  Search,
  Copy,
  Check,
  List,
  BookOpen,
  Eye,
  Code,
  Clock,
  ArrowUpRight,
  ChevronRight,
  Info,
  Layers,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

interface DocumentReaderProps {
  document: DocumentInfo;
}

interface HeadingItem {
  id: string;
  text: string;
  level: number;
}

export default function DocumentReader({ document: doc }: DocumentReaderProps) {
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeHeadingId, setActiveHeadingId] = useState<string>("");

  const readerContainerRef = useRef<HTMLDivElement>(null);

  // Helper to extract text content recursively from markdown node children
  const getHeadingText = (children: any): string => {
    if (!children) return "";
    if (typeof children === "string") return children;
    if (Array.isArray(children)) {
      return children.map(getHeadingText).join("");
    }
    if (children && typeof children === "object" && children.props) {
      return getHeadingText(children.props.children);
    }
    return "";
  };

  // Extract all headings from the raw markdown for the Table of Contents
  const headings = useMemo<HeadingItem[]>(() => {
    if (!doc.content) return [];
    
    const lines = doc.content.split("\n");
    const result: HeadingItem[] = [];
    
    lines.forEach((line) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        if (text) {
          result.push({ id, text, level });
        }
      }
    });
    
    return result;
  }, [doc.content]);

  // Document Stats
  const stats = useMemo(() => {
    const text = doc.content || "";
    const characters = text.length;
    const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim() !== "").length;
    const readingTime = Math.max(1, Math.ceil(words / 200)); // Average reading speed

    return {
      characters,
      words,
      paragraphs,
      readingTime,
    };
  }, [doc.content]);

  // Handle scroll inside reader to update active heading in Table of Contents
  useEffect(() => {
    const container = readerContainerRef.current;
    if (!container || viewMode !== "rendered") return;

    const handleScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      
      // Find the heading that is closest to the top of the container
      let currentActiveId = "";
      let minDistance = Infinity;

      headings.forEach((heading) => {
        if (!heading.id) return;
        const el = document.getElementById(heading.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          const distance = Math.abs(rect.top - containerTop - 20); // 20px offset
          if (rect.top - containerTop < 100 && distance < minDistance) {
            minDistance = distance;
            currentActiveId = heading.id;
          }
        }
      });

      if (currentActiveId) {
        setActiveHeadingId(currentActiveId);
      }
    };

    container.addEventListener("scroll", handleScroll);
    // Initial call
    handleScroll();

    return () => container.removeEventListener("scroll", handleScroll);
  }, [headings, viewMode]);

  // Jump to specific heading
  const handleJumpToHeading = (id: string) => {
    const container = readerContainerRef.current;
    if (!container || !id) return;

    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveHeadingId(id);
    }
  };

  // Copy raw markdown code
  const handleCopy = () => {
    navigator.clipboard.writeText(doc.content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter headings based on search term
  const filteredHeadings = useMemo(() => {
    if (!searchTerm.trim()) return headings;
    const term = searchTerm.toLowerCase();
    return headings.filter((h) => h.text.toLowerCase().includes(term));
  }, [headings, searchTerm]);

  // Match text occurrences for highlights or search list
  const searchMatches = useMemo(() => {
    if (!searchTerm.trim() || !doc.content) return [];
    
    const paragraphs = doc.content.split(/\n\s*\n/).filter(p => p.trim() !== "");
    const matches: { text: string; headingContext?: string }[] = [];
    const term = searchTerm.toLowerCase();

    paragraphs.forEach((p) => {
      if (p.toLowerCase().includes(term)) {
        // Find nearest heading above this paragraph to provide context
        let headingContext = "General";
        const pIndex = doc.content.indexOf(p);
        
        let bestHeading = null;
        let lastIndex = -1;

        headings.forEach((h) => {
          const hIdx = doc.content.indexOf(h.text);
          if (hIdx !== -1 && hIdx < pIndex && hIdx > lastIndex) {
            bestHeading = h.text;
            lastIndex = hIdx;
          }
        });

        if (bestHeading) {
          headingContext = bestHeading;
        }

        // Clean snippet
        const textClean = p.replace(/[#*`_\[\]]/g, " ").trim();
        const snippet = textClean.length > 140 
          ? textClean.substring(0, 140) + "..." 
          : textClean;

        matches.push({
          text: snippet,
          headingContext,
        });
      }
    });

    return matches.slice(0, 8); // Top 8 matches
  }, [doc.content, headings, searchTerm]);

  // Custom components for ReactMarkdown to integrate elegant Tailwind CSS
  const markdownComponents = useMemo(() => ({
    h1: ({ children, ...props }: any) => {
      const text = getHeadingText(children);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      return (
        <h1
          id={id}
          className="text-2xl font-extrabold text-slate-100 mt-8 mb-4 border-b border-slate-800/80 pb-2.5 tracking-tight flex items-center gap-2 group scroll-mt-6"
          {...props}
        >
          <span className="w-1.5 h-6 bg-indigo-500 rounded-full inline-block" />
          {children}
          <a href={`#${id}`} className="opacity-0 group-hover:opacity-100 text-indigo-400 text-sm font-medium ml-1.5 transition-opacity" title="Direct anchor link">
            #
          </a>
        </h1>
      );
    },
    h2: ({ children, ...props }: any) => {
      const text = getHeadingText(children);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      return (
        <h2
          id={id}
          className="text-lg font-bold text-slate-200 mt-6 mb-3 tracking-tight flex items-center gap-1.5 group scroll-mt-6"
          {...props}
        >
          <ChevronRight className="w-4 h-4 text-indigo-400 shrink-0" />
          {children}
          <a href={`#${id}`} className="opacity-0 group-hover:opacity-100 text-indigo-500 text-xs ml-1 transition-opacity">
            #
          </a>
        </h2>
      );
    },
    h3: ({ children, ...props }: any) => {
      const text = getHeadingText(children);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      return (
        <h3
          id={id}
          className="text-md font-semibold text-slate-300 mt-5 mb-2.5 border-l-2 border-slate-700 pl-2 scroll-mt-6"
          {...props}
        >
          {children}
        </h3>
      );
    },
    p: ({ children, ...props }: any) => (
      <p className="text-xs text-slate-300 leading-relaxed mb-4.5 font-normal" {...props}>
        {children}
      </p>
    ),
    ul: ({ children, ...props }: any) => (
      <ul className="list-disc pl-5 mb-4.5 space-y-1.5 text-xs text-slate-300" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }: any) => (
      <ol className="list-decimal pl-5 mb-4.5 space-y-1.5 text-xs text-slate-300" {...props}>
        {children}
      </ol>
    ),
    li: ({ children, ...props }: any) => (
      <li className="text-xs leading-relaxed" {...props}>
        {children}
      </li>
    ),
    code: ({ inline, children, ...props }: any) => {
      return inline ? (
        <code className="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-[11px] border border-slate-800" {...props}>
          {children}
        </code>
      ) : (
        <pre className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 overflow-x-auto text-[11px] font-mono text-indigo-200 leading-relaxed mb-4">
          <code {...props}>{children}</code>
        </pre>
      );
    },
    blockquote: ({ children, ...props }: any) => (
      <blockquote className="border-l-4 border-indigo-500 bg-indigo-500/5 pl-4 py-2.5 pr-2 rounded-r-xl text-slate-300 italic text-xs mb-4.5" {...props}>
        {children}
      </blockquote>
    ),
    table: ({ children, ...props }: any) => (
      <div className="overflow-x-auto mb-5 border border-slate-800/80 rounded-xl shadow-inner">
        <table className="w-full text-left text-xs border-collapse" {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }: any) => (
      <thead className="bg-[#020617] text-slate-400 uppercase font-bold text-[9px] tracking-wider border-b border-slate-800" {...props}>
        {children}
      </thead>
    ),
    tbody: ({ children, ...props }: any) => (
      <tbody className="divide-y divide-slate-800/50 bg-slate-900/10" {...props}>
        {children}
      </tbody>
    ),
    tr: ({ children, ...props }: any) => (
      <tr className="hover:bg-slate-800/10 transition-colors" {...props}>
        {children}
      </tr>
    ),
    th: ({ children, ...props }: any) => (
      <th className="px-4 py-2.5 font-semibold text-slate-300" {...props}>
        {children}
      </th>
    ),
    td: ({ children, ...props }: any) => (
      <td className="px-4 py-2.5 text-slate-300" {...props}>
        {children}
      </td>
    ),
  }), []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 bg-[#111827]/40 backdrop-blur-md rounded-2xl border border-slate-850 p-6 shadow-2xl">
      
      {/* 1. Sidebar Panel (TOC, Stats, Search Highlights) */}
      <div className="lg:col-span-1 space-y-6 flex flex-col h-[650px]">
        
        {/* Toggle Viewer Tabs & Metadata Stats */}
        <div className="space-y-4">
          <div className="bg-slate-900/60 p-1.5 rounded-xl border border-slate-800 flex gap-1">
            <button
              onClick={() => setViewMode("rendered")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                viewMode === "rendered"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/10"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Document View
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                viewMode === "raw"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/10"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              Markdown Code
            </button>
          </div>

          {/* Quick Metrics Dashboard */}
          <div className="bg-slate-900/30 border border-slate-800 rounded-xl p-3.5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Document Summary</span>
              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-slate-950/40 border border-slate-800/40 p-2.5 rounded-lg">
                <span className="block text-md font-bold text-slate-100 tracking-tight">{stats.words.toLocaleString()}</span>
                <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Words</span>
              </div>
              <div className="bg-slate-950/40 border border-slate-800/40 p-2.5 rounded-lg">
                <span className="block text-md font-bold text-indigo-400 tracking-tight">{stats.readingTime} min</span>
                <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Read Time</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/50 grid grid-cols-2 gap-1.5 text-[11px] text-slate-300 font-medium">
              <div className="flex items-center justify-between px-1">
                <span className="text-slate-500">Paragraphs</span>
                <span className="font-mono bg-slate-950/60 px-1.5 py-0.5 rounded text-slate-400 text-[10px]">{stats.paragraphs}</span>
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="text-slate-500">Headings</span>
                <span className="font-mono bg-slate-950/60 px-1.5 py-0.5 rounded text-slate-400 text-[10px]">{headings.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Table of Contents */}
        <div className="flex-1 bg-slate-900/30 border border-slate-800 rounded-xl overflow-hidden flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-950/30 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <List className="w-3.5 h-3.5 text-indigo-400" />
              Table of Contents
            </span>
            <span className="text-[9px] text-slate-500 font-mono">Found {filteredHeadings.length}</span>
          </div>

          {/* Search box for Table of Contents / Content Finder */}
          <div className="p-2.5 border-b border-slate-800/50 bg-slate-950/10 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Find in document..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
            </div>
          </div>

          {/* Table of Contents Scroll list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {viewMode === "raw" ? (
              <div className="text-center py-8 text-xs text-slate-500 space-y-2">
                <Info className="w-5 h-5 mx-auto opacity-40 text-indigo-400" />
                <p className="max-w-[150px] mx-auto leading-normal">
                  Table of Contents navigation is optimized for Document View.
                </p>
              </div>
            ) : filteredHeadings.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 italic">
                No headings match "{searchTerm}"
              </div>
            ) : (
              filteredHeadings.map((heading) => {
                const isActive = activeHeadingId === heading.id;
                return (
                  <button
                    key={heading.id}
                    onClick={() => handleJumpToHeading(heading.id)}
                    className={`w-full text-left rounded-lg p-2 text-xs font-medium transition-all flex items-start gap-1.5 hover:bg-slate-800/30 group ${
                      isActive
                        ? "bg-indigo-600/15 text-indigo-300 border-l-2 border-indigo-500 pl-1.5 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    style={{ paddingLeft: `${heading.level * 8}px` }}
                  >
                    <ChevronRight className={`w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 mt-0.5 shrink-0 transition-transform ${
                      isActive ? "rotate-90 text-indigo-400" : ""
                    }`} />
                    <span className="truncate">{heading.text}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Real-time search snippets context */}
        {searchTerm && searchMatches.length > 0 && viewMode === "rendered" && (
          <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-3 space-y-2 shrink-0">
            <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" />
              Keyword Highlights
            </span>
            <div className="space-y-2 max-h-[140px] overflow-y-auto">
              {searchMatches.map((m, idx) => (
                <div key={idx} className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/50 text-[10px] leading-relaxed">
                  <span className="font-bold text-slate-400 block text-[9px] uppercase tracking-wider mb-0.5 text-indigo-300/80">
                    Context: {m.headingContext}
                  </span>
                  <p className="text-slate-300">
                    {/* Basic replacement highlight for the searched term */}
                    {m.text.split(new RegExp(`(${searchTerm})`, "gi")).map((chunk, cIdx) => 
                      chunk.toLowerCase() === searchTerm.toLowerCase() ? (
                        <mark key={cIdx} className="bg-indigo-500/35 text-indigo-200 px-0.5 rounded font-bold">
                          {chunk}
                        </mark>
                      ) : (
                        chunk
                      )
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Main Content Display Panel */}
      <div className="lg:col-span-3 flex flex-col bg-[#0b0f19]/70 rounded-2xl border border-slate-850 h-[650px] overflow-hidden shadow-inner">
        {/* Header Action Strip */}
        <div className="px-5 py-3 border-b border-slate-850 bg-slate-950/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-500/10 text-indigo-400 p-1.5 rounded-lg border border-indigo-500/20">
              <FileText className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <span className="text-xs font-extrabold text-slate-200 block truncate max-w-[280px]">
                {doc.name}
              </span>
              <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">
                Processed Reference Document
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all"
              title="Copy Raw Markdown"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-indigo-400" />
                  Copy Markdown
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Body Pane */}
        <div
          ref={readerContainerRef}
          className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6"
        >
          {viewMode === "rendered" ? (
            <div className="markdown-body">
              <ReactMarkdown components={markdownComponents}>
                {doc.content || "*Empty document. No content was processed.*"}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="font-mono text-xs text-slate-300 bg-slate-950 p-4 rounded-xl border border-slate-800 whitespace-pre-wrap leading-relaxed select-all">
              {doc.content || "# Empty Document\n\nNo content available."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
