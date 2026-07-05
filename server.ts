import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";
import dotenv from "dotenv";
import { DocumentInfo, EvaluationSheet, KnowledgeGraph, CommentRow, CommentAnalysis, EvaluationRow, EvaluationStats } from "./src/types.js";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up body parser with increased limit to handle PDF base64 payloads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Path to persistent data store file
const DATA_STORE_PATH = path.join(process.cwd(), "data-store.json");

// Default application settings
const DEFAULT_SETTINGS = {
  localLlmAddress: "http://localhost:11434",
  kbModel: "gemini-3.5-flash",
  auditModel: "gemini-3.5-flash",
  selectedLocalModel: "",
};

// Helper to read persistent store
function readStore() {
  try {
    if (fs.existsSync(DATA_STORE_PATH)) {
      const data = fs.readFileSync(DATA_STORE_PATH, "utf-8");
      const parsed = JSON.parse(data);
      // Ensure settings exists
      if (!parsed.settings) {
        parsed.settings = { ...DEFAULT_SETTINGS };
      }
      return parsed;
    }
  } catch (error) {
    console.error("Error reading data store, returning empty:", error);
  }
  return { documents: [], evaluations: [], settings: { ...DEFAULT_SETTINGS } };
}

// Helper to write to persistent store
function writeStore(data: { documents: any[]; evaluations: any[]; settings?: any }) {
  try {
    if (!data.settings) {
      data.settings = { ...DEFAULT_SETTINGS };
    }
    fs.writeFileSync(DATA_STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing to data store:", error);
  }
}

// Lazy initialization of GoogleGenAI SDK
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please add it in the Secrets / Env Panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Density-based keyword and section heuristic RAG retriever
function retrieveContext(docContent: string, query: string, pagesOrSections: string[]): string {
  if (!docContent) return "No reference document content available.";
  
  // Split docContent into paragraphs/sections
  const paragraphs = docContent.split(/\n\s*\n/);
  const searchTerms = [
    ...(query ? query.toLowerCase().split(/\s+/).filter(w => w.length > 3) : []),
    ...(pagesOrSections || []).map(p => p.toLowerCase().trim())
  ].filter(Boolean);

  if (searchTerms.length === 0) {
    // Return first 1500 characters if no specific query or pages are requested
    return docContent.substring(0, 1500) + "\n\n[Showing default starting document chunk...]";
  }

  // Score each paragraph/section based on density of match
  const scored = paragraphs.map((p) => {
    let score = 0;
    const lowerP = p.toLowerCase();
    
    // Exact phrase match for sections or pages
    if (pagesOrSections && pagesOrSections.length > 0) {
      pagesOrSections.forEach(pos => {
        const cleanedPos = pos.toLowerCase().trim();
        if (cleanedPos && lowerP.includes(cleanedPos)) {
          score += 25; // High weight for precise section/page mentions
          // Extra weight if the section number is near the beginning of paragraph (headers)
          if (lowerP.indexOf(cleanedPos) < 50) {
            score += 15;
          }
        }
      });
    }

    // Keyword match
    searchTerms.forEach((term) => {
      if (term.length > 2 && lowerP.includes(term)) {
        score += 5;
        const occurrences = lowerP.split(term).length - 1;
        score += Math.min(occurrences, 3) * 2;
      }
    });

    return { paragraph: p, score };
  });

  // Sort by score descending and take the top ones
  const topScored = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (topScored.length === 0) {
    return docContent.substring(0, 1500) + "\n\n[Keywords not found. Showing default starting document chunk...]";
  }

  return topScored.map(item => item.paragraph).join("\n\n---\n\n");
}

// Helper to calculate statistics for an evaluation sheet
function calculateStats(rows: EvaluationRow[]): EvaluationStats {
  const total = rows.length;
  const completed = rows.filter((r) => r.status === "completed").length;

  const sentimentCounts: Record<string, number> = { Positive: 0, Negative: 0, Neutral: 0, Mixed: 0 };
  const intentCounts: Record<string, number> = {
    Question: 0,
    "Feature Request": 0,
    Objection: 0,
    "Bug/Typo": 0,
    Praise: 0,
    Misunderstanding: 0,
    Other: 0,
  };
  const resolutionCounts: Record<string, number> = {
    "Fully Addressed": 0,
    "Partially Addressed": 0,
    "Not Addressed": 0,
    "Rejected with Good Reason": 0,
    "Rejected with Weak Reason": 0,
    Ignored: 0,
  };
  const benefitCounts: Record<string, number> = {
    "High Benefit": 0,
    "Medium Benefit": 0,
    "No Benefit": 0,
    Detrimental: 0,
  };

  rows.forEach((row) => {
    if (row.status === "completed" && row.analysis) {
      const { sentiment, intent, resolutionScore, proposedActionBenefit } = row.analysis;
      if (sentiment in sentimentCounts) sentimentCounts[sentiment]++;
      if (intent in intentCounts) intentCounts[intent]++;
      if (resolutionScore in resolutionCounts) resolutionCounts[resolutionScore]++;
      if (proposedActionBenefit in benefitCounts) benefitCounts[proposedActionBenefit]++;
    }
  });

  return {
    total,
    completed,
    sentimentCounts,
    intentCounts,
    resolutionCounts,
    benefitCounts,
  };
}

// --- API ROUTES ---

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Helper to fetch models from local LLM address
async function fetchLocalModels(address: string): Promise<string[]> {
  const cleanAddress = address.trim().replace(/\/$/, "");
  
  // 1. Try Ollama tags API first
  try {
    const response = await fetch(`${cleanAddress}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json() as any;
      if (data && Array.isArray(data.models)) {
        return data.models.map((m: any) => m.name);
      }
    }
  } catch (error) {
    console.log("Ollama tags fetch skipped/failed:", error instanceof Error ? error.message : error);
  }

  // 2. Try standard OpenAI-compatible v1/models API
  try {
    const response = await fetch(`${cleanAddress}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json() as any;
      if (data && Array.isArray(data.data)) {
        return data.data.map((m: any) => m.id);
      }
    }
  } catch (error) {
    console.log("OpenAI models fetch skipped/failed:", error instanceof Error ? error.message : error);
  }

  return [];
}

// Helper to convert Google GenAI Schema types (e.g. UPPERCASE) to standard JSON schema types (lowercase)
function toStandardJsonSchema(schema: any): any {
  if (!schema) return schema;
  if (Array.isArray(schema)) {
    return schema.map(toStandardJsonSchema);
  }
  if (typeof schema === "object") {
    const copy: any = {};
    for (const [key, val] of Object.entries(schema)) {
      if (key === "type" && typeof val === "string") {
        copy[key] = val.toLowerCase();
      } else {
        copy[key] = toStandardJsonSchema(val);
      }
    }
    return copy;
  }
  return schema;
}

// Turn counter for local LLM model reload/memory reset
let localLlmTurns = 0;

// Helper to unload local Ollama model to free memory and prevent context saturation
async function unloadLocalModel(address: string, modelName: string): Promise<void> {
  const cleanAddress = address.trim().replace(/\/$/, "");
  console.log(`Unloading local model '${modelName}' to force reload (Turn Counter reset)...`);
  try {
    await fetch(`${cleanAddress}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        keep_alive: 0,
      }),
      signal: AbortSignal.timeout(5000),
    });
    console.log(`Ollama unload request for model '${modelName}' dispatched successfully.`);
  } catch (err: any) {
    console.log(`Ollama unload request skipped or failed: ${err.message || err}`);
  }
}

// Helper to execute completion via local LLM (OpenAI-compatible /v1/chat/completions or Ollama fallback)
async function generateLocalLlmContent(
  address: string,
  modelName: string,
  systemInstruction: string,
  prompt: string,
  responseSchema?: any
): Promise<string> {
  const cleanAddress = address.trim().replace(/\/$/, "");
  
  const openaiUrl = `${cleanAddress}/v1/chat/completions`;
  const openaiBody: any = {
    model: modelName,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt }
    ],
    temperature: 0.1,
  };

  // Build primary response_format using strict 'json_schema' to satisfy local vLLM / LiteLLM / Ollama servers
  if (responseSchema) {
    openaiBody.response_format = {
      type: "json_schema",
      json_schema: {
        name: "evaluation_result",
        strict: false,
        schema: toStandardJsonSchema(responseSchema),
      },
    };
    openaiBody.messages[1].content += `\n\nCRITICAL: Return ONLY a valid JSON object matching this schema. No markdown backticks, no comments, and no text outside the JSON:\n${JSON.stringify(responseSchema, null, 2)}`;
  }

  let openaiSuccess = false;
  let openaiResult = "";
  let isConnectionError = false;

  try {
    let response = await fetch(openaiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(openaiBody),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const statusText = await response.text();
      console.log(`Primary OpenAI compatible call failed (status ${response.status}): ${statusText}`);

      const lowerStatus = statusText.toLowerCase();
      const isResponseFormatError = 
        response.status === 400 && 
        (lowerStatus.includes("response_format") || 
         lowerStatus.includes("json_schema") || 
         lowerStatus.includes("json_object") || 
         lowerStatus.includes("type' must be") ||
         lowerStatus.includes("type must be") ||
         lowerStatus.includes("unsupported_media_type"));

      if (isResponseFormatError) {
        console.log("Retrying OpenAI compatible call with simpler 'json_object' response format...");
        const retryBody = { ...openaiBody };
        retryBody.response_format = { type: "json_object" };

        response = await fetch(openaiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(retryBody),
          signal: AbortSignal.timeout(45000),
        });

        if (!response.ok) {
          const secondStatusText = await response.text();
          console.log(`Retry with json_object also failed: ${secondStatusText}. Retrying without any response_format as last resort...`);
          
          const fallbackBody = { ...openaiBody };
          delete fallbackBody.response_format;

          response = await fetch(openaiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fallbackBody),
            signal: AbortSignal.timeout(45000),
          });
        }
      } else {
        throw new Error(`OpenAI API returned non-ok status: ${statusText}`);
      }
    }

    if (response.ok) {
      const data = await response.json() as any;
      if (data && data.choices && data.choices[0] && data.choices[0].message) {
        const msg = data.choices[0].message;
        const text = (msg.content || "").trim();
        if (text) {
          openaiResult = text;
          openaiSuccess = true;
        } else if (msg.reasoning_content && msg.reasoning_content.trim()) {
          openaiResult = msg.reasoning_content.trim();
          openaiSuccess = true;
        } else {
          throw new Error("OpenAI API call succeeded but returned empty content and reasoning_content.");
        }
      } else {
        throw new Error(`OpenAI API response layout unexpected: ${JSON.stringify(data)}`);
      }
    } else {
      throw new Error(`OpenAI API final retry also failed with status ${response.status}`);
    }
  } catch (error: any) {
    console.log("OpenAI chat endpoint failed or returned empty content:", error?.message || error);
    const errStr = String(error?.message || error).toLowerCase();
    if (errStr.includes("fetch") || errStr.includes("conn") || errStr.includes("timeout") || errStr.includes("refused") || errStr.includes("abort")) {
      isConnectionError = true;
    }
  }

  if (openaiSuccess) {
    // Model reload logic: Unload every 10 successful turns to stop it from saturating
    localLlmTurns++;
    console.log(`Local LLM Turn Count: ${localLlmTurns}/10`);
    if (localLlmTurns >= 10) {
      localLlmTurns = 0;
      unloadLocalModel(address, modelName).catch((err) => {
        console.log("Background model unload failed:", err);
      });
    }
    return openaiResult;
  }

  // Only fall back to direct Ollama generate API if we encountered actual connection errors
  if (!isConnectionError) {
    throw new Error(`Failed to communicate with OpenAI-compatible Local LLM endpoint at ${address}. Please check the server logs for model '${modelName}'.`);
  }

  console.log("Attempting direct Ollama generate API fallback due to connection/protocol mismatch...");

  // Direct Ollama generate API fallback
  try {
    const ollamaUrl = `${cleanAddress}/api/generate`;
    const ollamaBody = {
      model: modelName,
      prompt: `${systemInstruction}\n\nUser Prompt:\n${prompt}`,
      system: systemInstruction,
      stream: false,
      options: {
        temperature: 0.1,
      },
      format: responseSchema ? "json" : undefined,
    };

    const response = await fetch(ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaBody),
      signal: AbortSignal.timeout(45000),
    });

    if (response.ok) {
      const data = await response.json() as any;
      if (data && data.error) {
        throw new Error(`Ollama API error: ${JSON.stringify(data.error)}`);
      }
      if (data && typeof data.response === "string" && data.response.trim()) {
        localLlmTurns++;
        console.log(`Local LLM Turn Count (Ollama fallback): ${localLlmTurns}/10`);
        if (localLlmTurns >= 10) {
          localLlmTurns = 0;
          unloadLocalModel(address, modelName).catch((err) => {
            console.log("Background model unload failed:", err);
          });
        }
        return data.response.trim();
      }
      throw new Error(`Ollama API response field missing or empty: ${JSON.stringify(data)}`);
    } else {
      const statusText = await response.text();
      throw new Error(`Direct Ollama generate failed with status ${response.status}: ${statusText}`);
    }
  } catch (error: any) {
    throw new Error(`Failed to communicate with Local LLM at ${address} for model ${modelName}. Details: ${error.message || error}`);
  }
}

// Clean model JSON outputs which might have markdown or leading/trailing commentary
function cleanAndParseJson(text: string): any {
  if (!text || typeof text !== "string") {
    throw new Error("Received an empty or invalid text response from the model.");
  }

  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, "");
    cleaned = cleaned.replace(/\n```$/, "");
  }
  cleaned = cleaned.trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) {
    throw new Error(`The model response did not contain a valid JSON block enclosed in curly braces. Raw response:\n${text.substring(0, 500)}${text.length > 500 ? "..." : ""}`);
  }

  try {
    return JSON.parse(cleaned);
  } catch (parseError: any) {
    throw new Error(`Failed to parse model's JSON block. Error: ${parseError.message}. Extracted JSON block:\n${cleaned}`);
  }
}

// Wrapper for local LLM with automatic JSON validation & repair retry
async function generateLocalLlmContentWithRetry(
  address: string,
  modelName: string,
  systemInstruction: string,
  prompt: string,
  responseSchema?: any,
  maxRetries = 2
): Promise<any> {
  let currentPrompt = prompt;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const responseText = await generateLocalLlmContent(
        address,
        modelName,
        systemInstruction,
        currentPrompt,
        responseSchema
      );
      const parsed = cleanAndParseJson(responseText);
      return parsed;
    } catch (error: any) {
      console.log(`Local LLM attempt ${attempt} failed JSON validation/call: ${error.message}`);
      if (attempt > maxRetries) {
        throw error;
      }
      currentPrompt = `${prompt}\n\nCRITICAL: Your previous response failed JSON validation or parsing with error: ${error.message}.\nPlease return ONLY a valid, corrected JSON object conforming strictly to the requested schema structure. Do NOT wrap it in any comments or extra text. Output exactly the requested JSON layout.`;
    }
  }
  throw new Error("Failed to generate valid local LLM response after retries");
}

// Wrapper for Gemini API with automatic JSON validation & repair retry
async function generateGeminiContentWithRetry(
  model: string,
  contents: any,
  systemInstruction: string,
  responseSchema: any,
  maxRetries = 2
): Promise<any> {
  const ai = getGeminiClient();
  let currentContents = Array.isArray(contents) ? JSON.parse(JSON.stringify(contents)) : contents;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: currentContents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const jsonText = response.text || "{}";
      const parsed = cleanAndParseJson(jsonText);
      return parsed;
    } catch (error: any) {
      console.log(`Gemini API call attempt ${attempt} failed JSON validation: ${error.message}`);
      if (attempt > maxRetries) {
        throw error;
      }
      const repairPrompt = `\n\nCRITICAL: Your previous response caused a JSON parsing or validation error: ${error.message}. Please generate a corrected, strictly compliant JSON output matching the schema. No commentary, just valid JSON.`;
      if (Array.isArray(currentContents)) {
        const lastPart = currentContents[currentContents.length - 1];
        if (lastPart && typeof lastPart === "object" && "text" in lastPart) {
          lastPart.text += repairPrompt;
        } else {
          currentContents.push({ text: repairPrompt });
        }
      } else if (typeof currentContents === "string") {
        currentContents += repairPrompt;
      } else {
        currentContents = [
          { text: "Original Request failed. Try again with strict compliance." },
          { text: repairPrompt }
        ];
      }
    }
  }
  throw new Error("Failed to generate valid Gemini response after retries");
}

// GET Settings
app.get("/api/settings", (req, res) => {
  const store = readStore();
  res.json(store.settings);
});

// GET export database as backup
app.get("/api/backup", (req, res) => {
  const store = readStore();
  res.json(store);
});

// POST restore database from backup
app.post("/api/restore", (req, res) => {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data.documents) || !Array.isArray(data.evaluations)) {
      return res.status(400).json({ error: "Invalid backup format. Must contain 'documents' and 'evaluations'." });
    }
    writeStore(data);
    res.json({ status: "success", message: "Database restored successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to restore database." });
  }
});

// POST Settings
app.post("/api/settings", (req, res) => {
  const { localLlmAddress, kbModel, auditModel, selectedLocalModel } = req.body;
  const store = readStore();
  
  store.settings = {
    localLlmAddress: localLlmAddress || "http://localhost:11434",
    kbModel: kbModel || "gemini-3.5-flash",
    auditModel: auditModel || "gemini-3.5-flash",
    selectedLocalModel: selectedLocalModel || "",
  };
  
  writeStore(store);
  res.json(store.settings);
});

// POST Query local models available
app.post("/api/local-llm/models", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }
    const models = await fetchLocalModels(address);
    res.json({ models });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to query local models" });
  }
});

// GET list of documents
app.get("/api/documents", (req, res) => {
  const store = readStore();
  // Return metadata without raw text to keep payloads small
  const docs = store.documents.map((d: any) => ({
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    nodeCount: d.knowledgeGraph?.nodes?.length || 0,
    edgeCount: d.knowledgeGraph?.edges?.length || 0,
  }));
  res.json(docs);
});

// GET single document with graph and associated evaluation counts
app.get("/api/documents/:id", (req, res) => {
  const store = readStore();
  const doc = store.documents.find((d: any) => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: "Document not found" });
  }
  res.json(doc);
});

// DELETE single document and evaluations
app.delete("/api/documents/:id", (req, res) => {
  const store = readStore();
  store.documents = store.documents.filter((d: any) => d.id !== req.params.id);
  store.evaluations = store.evaluations.filter((e: any) => e.documentId !== req.params.id);
  writeStore(store);
  res.json({ success: true });
});

// POST Upload & process document (TXT or PDF base64)
app.post("/api/documents", async (req, res) => {
  try {
    const { name, content, mimeType, base64 } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Document name is required" });
    }

    const store = readStore();
    const settings = store.settings;
    const kbModel = settings.kbModel || "gemini-3.5-flash";

    let graph: KnowledgeGraph;

    const systemInstruction = `You are an expert system architect and knowledge engineer. Your goal is to parse documents and synthesize them into cohesive, high-fidelity knowledge graphs.
Identify all primary topics, business/technical requirements, constraints, system modules, processes, and roles.
Each extracted node must have:
- id: A unique string ID (concise, kebab-case, e.g. "user-authentication", "data-encryption").
- label: Title of the node.
- type: Exactly one of ["System", "Requirement", "Module", "User Role", "Constraint", "Feature", "Process", "General"].
- description: A detailed summary explaining the node's scope, objectives, or logic.
- importance: Exactly one of ["High", "Medium", "Low"].

Each edge must represent a real dependency or logical flow:
- source: The starting node ID.
- target: The ending node ID.
- relation: Exactly one of ["depends_on", "implements", "affects", "contains", "restricts", "associated_with"].
- description: A single concise sentence explaining the connection (e.g., "The payment service depends on user authentication to verify user identities").`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        nodes: {
          type: Type.ARRAY,
          description: "Array of extracted concepts/nodes.",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              label: { type: Type.STRING },
              type: {
                type: Type.STRING,
                enum: ["System", "Requirement", "Module", "User Role", "Constraint", "Feature", "Process", "General"],
              },
              description: { type: Type.STRING },
              importance: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            },
            required: ["id", "label", "type", "description", "importance"],
          },
        },
        edges: {
          type: Type.ARRAY,
          description: "Array of relationships between the nodes.",
          items: {
            type: Type.OBJECT,
            properties: {
              source: { type: Type.STRING },
              target: { type: Type.STRING },
              relation: {
                type: Type.STRING,
                enum: ["depends_on", "implements", "affects", "contains", "restricts", "associated_with"],
              },
              description: { type: Type.STRING },
            },
            required: ["source", "target", "relation", "description"],
          },
        },
      },
      required: ["nodes", "edges"],
    };

    let finalContent = content || "";

    // 1. PDF to Markdown conversion
    if (mimeType === "application/pdf") {
      if (!base64) {
        return res.status(400).json({ error: "Base64 encoded PDF data is required" });
      }
      try {
        console.log("Converting PDF to high-fidelity Markdown...");
        const ai = getGeminiClient();
        const conversionResponse = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            {
              inlineData: {
                mimeType: "application/pdf",
                data: base64,
              },
            },
            "Convert this PDF document into a clean, complete, and highly structured Markdown document. Preserve all sections, tables, headers, lists, and context exactly as they appear in the PDF. Do not summarize or emit commentary; output ONLY the converted markdown text.",
          ],
        });
        finalContent = conversionResponse.text || "";
        if (!finalContent) {
          throw new Error("Empty markdown text returned by PDF converter");
        }
      } catch (err: any) {
        console.error("PDF to Markdown conversion failed, using fallback placeholder:", err);
        finalContent = content || "PDF Document content processed by LLM";
      }
    } 
    // 2. Word document to Markdown conversion (DOCX and DOC)
    else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword" ||
      name.endsWith(".docx") ||
      name.endsWith(".doc")
    ) {
      if (!base64) {
        return res.status(400).json({ error: "Base64 encoded Word document data is required" });
      }
      try {
        console.log("Converting DOCX/DOC to Markdown...");
        const buffer = Buffer.from(base64, "base64");
        const mammothResult = await mammoth.extractRawText({ buffer });
        const rawText = mammothResult.value || "";

        if (rawText.trim()) {
          const ai = getGeminiClient();
          const formatResponse = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: [
              `Please organize and format the following raw text into structured, elegant Markdown. Retain all original information, requirements, sections, lists, and numbers exactly as they are. Fix any line wrapping or formatting glitches that resulted from text extraction. Do not add any conversational remarks or summaries; return ONLY the clean markdown output.

Raw Text:
${rawText}`
            ],
          });
          finalContent = formatResponse.text || rawText;
        } else {
          finalContent = "Empty Word document";
        }
      } catch (err: any) {
        console.error("Word to Markdown conversion failed:", err);
        return res.status(500).json({ error: "Failed to extract text from Word document: " + err.message });
      }
    }

    // 3. Generate Knowledge Graph from the clean Markdown content
    if (kbModel.startsWith("local:")) {
      const localModelName = kbModel.replace("local:", "");
      const promptText = `Analyze the following document and turn its content into a highly organized knowledge graph.
Document Title: ${name}
Document Content:
${finalContent}

Provide the output strictly in the requested JSON structure.`;

      graph = await generateLocalLlmContentWithRetry(
        settings.localLlmAddress,
        localModelName,
        systemInstruction,
        promptText,
        responseSchema
      );
    } else {
      const promptText = `Analyze the following document and turn its content into a highly organized knowledge graph.
Identify the main concepts, requirements, modules, constraints, processes, and user roles as Nodes.
Establish clear and meaningful Edges (relationships) between these nodes.

Document Title: ${name}
Document Content:
${finalContent}

Provide the output strictly in the requested JSON structure.`;

      graph = await generateGeminiContentWithRetry(
        kbModel,
        promptText,
        systemInstruction,
        responseSchema
      );
    }

    // Basic cleaning of graph (ensure no broken edges)
    const validNodeIds = new Set(graph.nodes.map((n) => n.id));
    graph.edges = graph.edges.filter((e) => validNodeIds.has(e.source) && validNodeIds.has(e.target));

    const newDoc: DocumentInfo = {
      id: "doc_" + Math.random().toString(36).substring(2, 11),
      name,
      content: finalContent,
      createdAt: new Date().toISOString(),
      knowledgeGraph: graph,
    };

    store.documents.push(newDoc);
    writeStore(store);

    res.json(newDoc);
  } catch (error: any) {
    console.error("Error creating document graph:", error);
    res.status(500).json({ error: error.message || "Failed to analyze document" });
  }
});

// GET all evaluations for a document
app.get("/api/documents/:docId/evaluations", (req, res) => {
  const store = readStore();
  const evals = store.evaluations.filter((e: any) => e.documentId === req.params.docId);
  res.json(evals);
});

// POST Create a new evaluation sheet
app.post("/api/documents/:docId/evaluations", (req, res) => {
  const { name, rows } = req.body;
  const docId = req.params.docId;

  if (!name || !rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: "Sheet name and rows are required" });
  }

  const store = readStore();
  const doc = store.documents.find((d: any) => d.id === docId);
  if (!doc) {
    return res.status(404).json({ error: "Parent document not found" });
  }

  // Map rows to structured EvaluationRow
  const evalRows: EvaluationRow[] = rows.map((row: any, idx: number) => ({
    comment: {
      index: idx,
      id: row.id || `C-${idx + 1}`,
      author: row.author || "Anonymous",
      comment: row.comment || "",
      response: row.response || "",
      proposedAction: row.proposedAction || "",
      stakeholder: row.stakeholder || row.author || "Anonymous",
      section: row.section || "",
      metadata: row.metadata || {},
    },
    analysis: null,
    status: "pending",
  }));

  const newSheet: EvaluationSheet = {
    id: "eval_" + Math.random().toString(36).substring(2, 11),
    documentId: docId,
    name,
    createdAt: new Date().toISOString(),
    rows: evalRows,
    stats: calculateStats(evalRows),
  };

  store.evaluations.push(newSheet);
  writeStore(store);

  res.json(newSheet);
});

// POST Process a single evaluation row line-by-line
app.post("/api/documents/:docId/evaluations/:evalId/rows/:rowIndex/process", async (req, res) => {
  try {
    const { docId, evalId, rowIndex } = req.params;
    const rIdx = parseInt(rowIndex, 10);

    const store = readStore();
    const doc = store.documents.find((d: any) => d.id === docId);
    const sheet = store.evaluations.find((e: any) => e.id === evalId);

    if (!doc || !sheet) {
      return res.status(404).json({ error: "Document or evaluation sheet not found" });
    }

    const row = sheet.rows.find((r: any) => r.comment.index === rIdx);
    if (!row) {
      return res.status(404).json({ error: "Row index not found in sheet" });
    }

    row.status = "processing";
    writeStore(store);

    // Get settings
    const settings = store.settings || {
      localLlmAddress: "http://localhost:11434",
      kbModel: "gemini-3.5-flash",
      auditModel: "gemini-3.5-flash",
      selectedLocalModel: "",
    };
    const auditModel = settings.auditModel || "gemini-3.5-flash";

    // Prepare node lists for Gemini/Local LLM to reference
    const nodeDetails = doc.knowledgeGraph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      description: n.description,
    }));

    // --- PASS 1: PREPROCESSING (INFORMATION REQUEST) ---
    let knowledgeRequest = {
      requestedPagesOrSections: [] as string[],
      searchQuery: "",
      reason: "",
    };
    let retrievedContext = "";

    try {
      const prepSystemInstruction = `You are a professional requirements and contract auditor. Your task is to identify what specific pages, sections, requirements, or keywords we should retrieve from the reference document to properly audit the following feedback row.
Return your answer strictly as a JSON object adhering to the schema.`;

      const prepPrompt = `FEEDBACK ROW TO EVALUATE:
- Commenter: ${row.comment.author || "Anonymous"}
- Comment: "${row.comment.comment}"
- Response: "${row.comment.response}"
- Action: "${row.comment.proposedAction}"

KNOWLEDGE GRAPH NODES AVAILABLE:
${JSON.stringify(nodeDetails, null, 2)}

What specific clauses, section numbers (e.g. "Section 4.1"), page numbers, headings, or topics should we lookup in our reference document text to verify if the team's response and proposed action are correct and complete?
Provide your request strictly in the requested JSON structure.`;

      const prepSchema = {
        type: Type.OBJECT,
        properties: {
          requestedPagesOrSections: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "A list of specific sections, headings, or page numbers (e.g. ['Section 3.2', 'Page 15', 'Database Setup'])."
          },
          searchQuery: {
            type: Type.STRING,
            description: "Keywords or search query to find matching paragraphs in the reference text."
          },
          reason: {
            type: Type.STRING,
            description: "A single sentence explaining why this extra context is needed."
          }
        },
        required: ["requestedPagesOrSections", "searchQuery", "reason"]
      };

      if (auditModel.startsWith("local:")) {
        const localModelName = auditModel.replace("local:", "");
        knowledgeRequest = await generateLocalLlmContentWithRetry(
          settings.localLlmAddress,
          localModelName,
          prepSystemInstruction,
          prepPrompt,
          prepSchema
        );
      } else {
        knowledgeRequest = await generateGeminiContentWithRetry(
          auditModel,
          prepPrompt,
          prepSystemInstruction,
          prepSchema
        );
      }

      // Execute RAG retrieval against our preserved Markdown document content
      retrievedContext = retrieveContext(doc.content, knowledgeRequest.searchQuery, knowledgeRequest.requestedPagesOrSections);
      console.log(`[RAG Retrieve Successful] Requested: ${JSON.stringify(knowledgeRequest.requestedPagesOrSections)}, Query: "${knowledgeRequest.searchQuery}"`);
    } catch (err: any) {
      console.error("Pass 1 preprocessing/retrieval failed, falling back to default document chunk:", err);
      retrievedContext = doc.content ? doc.content.substring(0, 2000) + "\n\n[RAG failed, showing default starting document chunk...]" : "No document content available.";
      knowledgeRequest = {
        requestedPagesOrSections: [],
        searchQuery: "",
        reason: "RAG preprocessing failed or timed out. Falling back to default document chunk.",
      };
    }

    // --- PASS 2: FULL CONTEXT-AWARE AUDIT ---
    const systemInstruction = "You are an objective third-party auditor. Assess comments and response alignments. Be critically constructive. Highlight if the team brushed off a concern or if the proposed action is actually detrimental or highly beneficial. Ensure you thoroughly scan for quality issues such as nonsense comments, missing information, or incomplete/TODO responses.";

    const promptText = `Review the following feedback entry and evaluate it line-by-line against the document's knowledge nodes and the retrieved context from the reference document.

RETRIEVED REFERENCE DOCUMENT CONTEXT (RAG):
${retrievedContext}

CONTEXT KNOWLEDGE NODES AVAILABLE:
${JSON.stringify(nodeDetails, null, 2)}

FEEDBACK ENTRY TO AUDIT:
- Commenter: ${row.comment.author || "Anonymous"}
- Initial Comment: "${row.comment.comment}"
- Team Response: "${row.comment.response}"
- Proposed Action: "${row.comment.proposedAction}"

TASK:
1. Assess the Initial Comment's sentiment (Positive, Negative, Neutral, Mixed).
2. Classify commenter's intent (Question, Feature Request, Objection, Bug/Typo, Praise, Misunderstanding, Other).
3. Map the comment back to the most relevant Node IDs from the document's knowledge nodes. Choose ONLY from the provided node IDs. If none match, keep it empty.
4. Reflect on the Team Response. Does it successfully address the user's core concern based on the retrieved document context?
5. Reflect on the Proposed Action. Will this action benefit the document/system, or is it unhelpful/detrimental?
6. Identify specific issues/flags with this feedback entry, such as:
   - "Nonsense Comment": If the comment is gibberish, letters like "asdfghjk", empty, or completely off-topic relative to the system/document.
   - "Missing Info": If the comment is vague, lacks context or specifics, e.g. "I found a problem on that page" without specifying what page or what problem.
   - "Incomplete Response": If the team response is empty, contains "TODO", or "[Insert Response]", or is just placeholders or "will check" without actual resolution detail.
   - "Detrimental Action": If the proposed action is unhelpful or would actively harm the system or break requirements.
   - "Misalignment": If the response and proposed action are contradictory.
7. Formulate a critical reflection summarizing your evaluation. Use the retrieved context to verify accuracy.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        sentiment: {
          type: Type.STRING,
          enum: ["Positive", "Negative", "Neutral", "Mixed"],
        },
        intent: {
          type: Type.STRING,
          enum: ["Question", "Feature Request", "Objection", "Bug/Typo", "Praise", "Misunderstanding", "Other"],
        },
        mappedNodes: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Array of node IDs that this comment relates to. Only use IDs from the provided list.",
        },
        resolutionScore: {
          type: Type.STRING,
          enum: ["Fully Addressed", "Partially Addressed", "Not Addressed", "Rejected with Good Reason", "Rejected with Weak Reason", "Ignored"],
        },
        proposedActionBenefit: {
          type: Type.STRING,
          enum: ["High Benefit", "Medium Benefit", "No Benefit", "Detrimental"],
        },
        reflection: {
          type: Type.STRING,
          description: "A professional markdown-styled critical audit summarizing why the response succeeds or fails, and how the proposed action impacts the document.",
        },
        issues: {
          type: Type.ARRAY,
          description: "Array of detected audit issues/flags for this entry. If there are no issues, keep this array empty.",
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                enum: ["Nonsense Comment", "Missing Info", "Incomplete Response", "Detrimental Action", "Misalignment", "No Core Address", "None"],
              },
              severity: {
                type: Type.STRING,
                enum: ["High", "Medium", "Low", "None"],
              },
              description: {
                type: Type.STRING,
                description: "Details of the issue or why it was flagged.",
              },
            },
            required: ["type", "severity", "description"],
          },
        },
      },
      required: ["sentiment", "intent", "mappedNodes", "resolutionScore", "proposedActionBenefit", "reflection", "issues"],
    };

    let analysis: CommentAnalysis;

    if (auditModel.startsWith("local:")) {
      const localModelName = auditModel.replace("local:", "");
      analysis = await generateLocalLlmContentWithRetry(
        settings.localLlmAddress,
        localModelName,
        systemInstruction,
        promptText,
        responseSchema
      );
    } else {
      analysis = await generateGeminiContentWithRetry(
        auditModel,
        promptText,
        systemInstruction,
        responseSchema
      );
    }

    // Ensure issues is always an array
    if (!analysis.issues) {
      analysis.issues = [];
    }

    // Attach Pass 1 Preprocessing and RAG context telemetry to the analysis
    analysis.knowledgeRequest = knowledgeRequest;
    analysis.retrievedContext = retrievedContext;

    // Update row state
    row.analysis = analysis;
    row.status = "completed";
    row.error = undefined;

    // Recalculate sheet statistics
    sheet.stats = calculateStats(sheet.rows);
    writeStore(store);

    res.json({ row, stats: sheet.stats });
  } catch (error: any) {
    console.error("Error processing row:", error);
    // Find the row and mark as error
    const store = readStore();
    const sheet = store.evaluations.find((e: any) => e.id === req.params.evalId);
    if (sheet) {
      const row = sheet.rows.find((r: any) => r.comment.index === parseInt(req.params.rowIndex, 10));
      if (row) {
        row.status = "error";
        row.error = error.message || "Failed to parse API response";
        writeStore(store);
      }
    }
    res.status(500).json({ error: error.message || "Processing failed" });
  }
});

// POST Reset/Acknowledge a single evaluation row back to pending status
app.post("/api/documents/:docId/evaluations/:evalId/rows/:rowIndex/reset", (req, res) => {
  try {
    const { docId, evalId, rowIndex } = req.params;
    const rIdx = parseInt(rowIndex, 10);

    const store = readStore();
    const sheet = store.evaluations.find((e: any) => e.id === evalId);

    if (!sheet) {
      return res.status(404).json({ error: "Evaluation sheet not found" });
    }

    const row = sheet.rows.find((r: any) => r.comment.index === rIdx);
    if (!row) {
      return res.status(404).json({ error: "Row index not found in sheet" });
    }

    row.status = "pending";
    row.error = undefined;
    row.analysis = undefined;

    sheet.stats = calculateStats(sheet.rows);
    writeStore(store);

    res.json({ row, stats: sheet.stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to reset row" });
  }
});

// DELETE evaluation sheet
app.delete("/api/documents/:docId/evaluations/:evalId", (req, res) => {
  const store = readStore();
  store.evaluations = store.evaluations.filter((e: any) => e.id !== req.params.evalId);
  writeStore(store);
  res.json({ success: true });
});


// --- VITE DEV / PRODUCTION HANDLERS ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
