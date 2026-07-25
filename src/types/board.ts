export interface Board {
  id: string;
  name: string;
  slug: string;
  kind: string;
  position: number;
}

export interface Item {
  id: string;
  board_id: string;
  raw_text: string;
  title: string | null;
  due_at: string | null;
  amount_minor: number | null;
  currency: string | null;
  source: string;
  created_at: string;
}
