// shared by the api and the page script
export const STATUSES = ["raw", "thinking", "doing", "dead"] as const;
export type IdeaStatus = (typeof STATUSES)[number];

export type Idea = {
  id: number;
  body: string;
  tags: string; // comma list
  status: IdeaStatus;
  pinned: number;
  created_at: number;
  updated_at: number;
  notes: number;
};

/** #tag words → lowercase unique list. letters, digits, - and _ ; up to 32 chars. */
export function extractTags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu)) out.add(m[1].toLowerCase());
  return [...out];
}
