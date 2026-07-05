export type NodeType =
  | "System"
  | "Requirement"
  | "Module"
  | "User Role"
  | "Constraint"
  | "Feature"
  | "Process"
  | "General";

export type RelationType =
  | "depends_on"
  | "implements"
  | "affects"
  | "contains"
  | "restricts"
  | "associated_with";

export interface KnowledgeNode {
  id: string;
  label: string;
  type: NodeType;
  description: string;
  importance: "High" | "Medium" | "Low";
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  relation: RelationType;
  description: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface DocumentInfo {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  knowledgeGraph: KnowledgeGraph;
}

export interface CommentRow {
  index: number;
  id: string;
  author: string;
  comment: string;
  response: string;
  proposedAction: string;
  stakeholder?: string;
  section?: string;
  metadata?: Record<string, string>;
}

export interface AuditIssue {
  type: "Nonsense Comment" | "Missing Info" | "Incomplete Response" | "Detrimental Action" | "Misalignment" | "No Core Address" | "None";
  severity: "High" | "Medium" | "Low" | "None";
  description: string;
}

export interface CommentAnalysis {
  sentiment: "Positive" | "Negative" | "Neutral" | "Mixed";
  intent: "Question" | "Feature Request" | "Objection" | "Bug/Typo" | "Praise" | "Misunderstanding" | "Other";
  mappedNodes: string[]; // List of KnowledgeNode IDs
  resolutionScore: "Fully Addressed" | "Partially Addressed" | "Not Addressed" | "Rejected with Good Reason" | "Rejected with Weak Reason" | "Ignored";
  proposedActionBenefit: "High Benefit" | "Medium Benefit" | "No Benefit" | "Detrimental";
  reflection: string; // Explaining why the response succeeded/failed and action benefit
  issues?: AuditIssue[]; // Issues like nonsense, missing info, incomplete response, etc.
  knowledgeRequest?: {
    requestedPagesOrSections: string[];
    searchQuery: string;
    reason: string;
  };
  retrievedContext?: string;
}

export interface EvaluationRow {
  comment: CommentRow;
  analysis: CommentAnalysis | null;
  status: "pending" | "processing" | "completed" | "error";
  error?: string;
}

export interface EvaluationStats {
  total: number;
  completed: number;
  sentimentCounts: Record<string, number>;
  intentCounts: Record<string, number>;
  resolutionCounts: Record<string, number>;
  benefitCounts: Record<string, number>;
}

export interface EvaluationSheet {
  id: string;
  documentId: string;
  name: string;
  createdAt: string;
  rows: EvaluationRow[];
  stats: EvaluationStats;
}
