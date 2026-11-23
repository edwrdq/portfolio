// shared by the later api, the /share page, and the tool page
export type Device = "phone" | "laptop";
export type Item = {
  id: number;
  url: string | null;
  title: string | null;
  site: string | null;
  excerpt: string | null;
  note: string | null;
  tags: string;
  status: "inbox" | "read" | "archived";
  sent_from: Device;
  created_at: number;
  read_at: number | null;
  has_text?: number;
};

export const deviceFromUA = (ua: string | null): Device =>
  /iphone|ipad|ipod|android|mobile|silk|kindle|blackberry|opera mini|iemobile/i.test(ua ?? "") ? "phone" : "laptop";

/** a pasted/shared string → a url (if it is, or contains, one) or a plain note */
export function classify(input: string): { url: string } | { note: string } {
  const s = input.trim();
  const only = s.match(/^https?:\/\/\S+$/i);
  if (only) return { url: only[0] };
  // "title — https://…" style shares: keep the link, the text is just its title
  const inside = s.match(/https?:\/\/[^\s<>"']+/i);
  if (inside && s.replace(inside[0], "").trim().length < 200 && s.split("\n").length <= 3) return { url: inside[0] };
  return { note: s };
}
