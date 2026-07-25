export type Intent = "capture" | "query" | "command";

export interface CaptureFields {
  board: string;
  title: string;
  due_at: string | null; // ISO 8601
  amount_minor: number | null;
  currency: string | null;
  tags: string[];
}

export interface RouteResult {
  intent: Intent;
  confidence: number; // 0–1
  capture: CaptureFields | null; // present only when intent === "capture"
  command: string | null; // present only when intent === "command"
}

export interface AnswerResult {
  text: string;
  citedItemIds: string[];
}

export interface EmbedResult {
  dense: number[]; // 1024-dim, BGE-M3 dense
  sparse: Record<number, number>; // token-id -> weight, BGE-M3 sparse (lexical)
}
