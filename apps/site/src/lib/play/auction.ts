// auction screen. the server sends a full view after every change; this redraws it.
// everything goes on the page with textContent, never as html.
import { carName, DAMAGE_LABEL, disaster, fees, INCREMENTS, type AuctionView } from "@edwrdq/rooms/auction";
import { carSvg } from "./car-art";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const PHASE: Record<AuctionView["phase"], string> = {
  intro: "first lot coming up",
  preview: "preview · inspect now",
  bidding: "bidding open",
  sold: "hammer down",
  done: "auction over",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: (string | Node | null | false)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== false) e.append(k);
  return e;
}

export function mountAuction(root: HTMLElement, send: (x: Record<string, unknown>) => void) {
  let v: AuctionView | null = null;
  let offset = 0; // server clock − ours
  let lastKey = "";
  let carKey = "";

  const head = el("div", "a-head");
  const phase = el("p", "label a-phase");
  const timer = el("p", "a-timer");
  head.append(phase, timer);
  const art = el("div", "a-art");
  const sheet = el("div", "a-sheet");
  const bidBox = el("div", "a-bid");
  const reveal = el("div", "a-reveal");
  const board = el("div", "a-board");
  root.replaceChildren(head, art, sheet, bidBox, reveal, board);

  function nick(seat: number) {
    return v?.players.find((p) => p.seat === seat)?.nick ?? `seat ${seat + 1}`;
  }

  setInterval(() => {
    if (!v || v.phase === "done") return void (timer.textContent = "");
    const left = Math.max(0, v.ends - (Date.now() + offset));
    timer.textContent = `0:${String(Math.ceil(left / 1000)).padStart(2, "0")}`;
    timer.classList.toggle("hot", v.phase === "bidding" && left < 5000);
  }, 150);

  function drawSheet() {
    const l = v!.lot;
    const key = `${v!.lotNo}:${l.damage}:${l.body}`;
    if (key !== carKey) {
      carKey = key;
      art.replaceChildren(carSvg(l.body, l.damage));
    }
    const rows: [string, string][] = [
      ["odometer", `${l.miles.toLocaleString("en-US")} mi`],
      ["title", l.title],
      ["damage", DAMAGE_LABEL[l.damage]],
      ["est. retail", `${money(l.retail)} (clean, before damage)`],
      ["opening bid", money(l.open)],
    ];
    const canInspect = v!.phase === "preview" && v!.you && v!.you.inspected === null;
    sheet.replaceChildren(
      el("p", "label", `LOT ${v!.lotNo} / ${v!.lots}`),
      el("h2", "a-car", carName(l)),
      el("dl", "a-dl", ...rows.flatMap(([k, val]) => [el("dt", "", k), el("dd", "", val)])),
      el("p", "label a-cr", "CONDITION REPORT"),
      el(
        "ul",
        "a-items",
        ...l.items.map((it, i) => {
          const li = el("li", it.mine ? "mine" : "", el("span", "a-k", it.label), el("span", it.text === null ? "a-q" : it.bad ? "a-bad" : "a-ok", it.text === null ? "???" : it.text.replace(/^[^:]+:\s*/, "")));
          if (it.text === null && canInspect) {
            const b = el("button", "btn xs", `INSPECT ${money(it.cost)}`) as HTMLButtonElement;
            b.type = "button";
            b.addEventListener("click", () => send({ a: "inspect", item: i }));
            li.append(b);
          }
          if (it.mine) li.append(el("span", "a-tag", "you inspected"));
          return li;
        }),
      ),
    );
    if (v!.phase === "preview")
      sheet.append(el("p", "a-hint", v!.you?.inspected === null ? "pay to see one ??? before bidding opens. only you see it." : "you've used your inspection for this lot."));
  }

  function drawBid() {
    const show = v!.phase === "bidding" || v!.phase === "preview";
    bidBox.hidden = !show;
    if (!show) return;
    const h = v!.high;
    const me = v!.you;
    const next = (inc: number) => (h ? h.amount + inc : v!.lot.open);
    const kids: Node[] = [
      el("p", "label", "HIGH BID"),
      el("p", "a-high", h ? money(h.amount) : "no bids"),
      el("p", "a-by", h ? (h.seat === me?.seat ? "you're winning" : nick(h.seat)) : `opens at ${money(v!.lot.open)}`),
    ];
    if (me) {
      const btns = el("div", "a-incs");
      for (const inc of INCREMENTS) {
        const amount = next(inc);
        const b = el("button", "btn", h ? `+${money(inc)}` : `BID ${money(amount)}`) as HTMLButtonElement;
        b.type = "button";
        b.disabled = v!.phase !== "bidding" || h?.seat === me.seat || amount > me.maxBid;
        b.addEventListener("click", () => send({ a: "bid", inc }));
        btns.append(b);
        if (!h) break; // the opening bid is one button
      }
      kids.push(btns);
      const n = next(100);
      kids.push(el("p", "a-hint", `your cash ${money(me.cash)} · fees on ${money(n)}: +${money(fees(n).total)}`));
    }
    if (v!.bids.length) kids.push(el("ol", "a-bids", ...[...v!.bids].reverse().slice(0, 5).map((b) => el("li", "", el("span", "", nick(b.seat)), el("span", "", money(b.amount))))));
    bidBox.replaceChildren(...kids);
  }

  function drawReveal() {
    const s = v!.sale;
    reveal.hidden = !s;
    if (!s) return;
    const lines = el(
      "table",
      "a-bill",
      el("tr", "", el("th", "", "repair"), el("th", "", "parts"), el("th", "", "labor")),
      ...s.lines.map((l) => el("tr", "", el("td", "", l.part), el("td", "", money(l.parts)), el("td", "", money(l.labor)))),
      el("tr", "a-sum", el("td", "", "repairs"), el("td", "", ""), el("td", "", money(s.repairs))),
    );
    const head =
      s.seat === null
        ? el("p", "a-sold", "no sale.")
        : el("p", "a-sold", `sold to ${s.seat === v!.you?.seat ? "you" : nick(s.seat)} for ${money(s.price)}`);
    const sums: [string, string][] =
      s.seat === null
        ? [
            ["would've cost to fix", money(s.repairs)],
            ["would've sold for", money(s.resale)],
          ]
        : [
            ["hammer", money(s.price)],
            ["buyer fees", `${money(s.fees)} (buyer ${money(s.feeBreakdown!.buyer)} · online ${money(s.feeBreakdown!.online)} · gate ${money(s.feeBreakdown!.gate)} · env ${money(s.feeBreakdown!.env)})`],
            ["repairs", `${money(s.repairs)} · ${s.days} days in the shop`],
            ["sold it for", money(s.resale)],
          ];
    reveal.replaceChildren(
      head,
      lines,
      el("dl", "a-dl", ...sums.flatMap(([k, val]) => [el("dt", "", k), el("dd", "", val)])),
      s.seat !== null ? el("p", `a-profit ${s.profit >= 0 ? "up" : "down"}`, `${s.profit >= 0 ? "profit" : "loss"} ${money(s.profit)}`) : el("p", "a-hint", s.resale - s.repairs > 0 ? "someone left money on the table." : "nobody bit. smart."),
    );
  }

  function drawBoard() {
    const ps = [...v!.players].sort((a, b) => b.profit - a.profit);
    const rows = ps.map((p, i) =>
      el(
        "tr",
        p.seat === v!.you?.seat ? "me" : "",
        el("td", "", String(i + 1).padStart(2, "0")),
        el("td", "", p.nick + (p.bot ? " (bot)" : "")),
        el("td", "", money(p.cash)),
        el("td", p.profit > 0 ? "up" : p.profit < 0 ? "down" : "", money(p.profit)),
        el("td", "", String(p.won)),
      ),
    );
    const kids: Node[] = [];
    if (v!.results) {
      const sold = v!.results.sales.filter((x) => x.seat !== null);
      const best = [...sold].sort((a, b) => b.profit - a.profit)[0];
      const worst = [...sold].sort((a, b) => a.profit - b.profit)[0];
      kids.push(el("p", "a-sold", ps[0] ? `${ps[0].seat === v!.you?.seat ? "you win" : `${ps[0].nick} wins`} with ${money(ps[0].profit)}.` : "auction over."));
      if (best) kids.push(el("p", "a-hint", `best flip: ${nick(best.seat!)} · ${best.car} · ${money(best.profit)}`));
      if (worst && worst.profit < 0) kids.push(el("p", "a-hint", `worst disaster: ${nick(worst.seat!)} · ${disaster(worst)} (${money(worst.profit)})`));
    }
    kids.push(
      el("p", "label", v!.results ? "FINAL" : "STANDINGS"),
      el("table", "a-table", el("tr", "", ...["#", "player", "cash", "profit", "cars"].map((h) => el("th", "", h))), ...rows),
    );
    board.replaceChildren(...kids);
  }

  return {
    update(next: AuctionView) {
      v = next;
      offset = next.now - Date.now();
      phase.textContent = `${PHASE[next.phase]}${next.phase !== "done" ? ` · lot ${next.lotNo}/${next.lots}` : ""}`;
      root.dataset.phase = next.phase;
      const key = `${next.lotNo}:${next.phase}`;
      if (key !== lastKey && next.phase === "bidding") navigator.vibrate?.(30);
      lastKey = key;
      sheet.hidden = art.hidden = next.phase === "done";
      if (next.phase !== "done") drawSheet();
      drawBid();
      drawReveal();
      drawBoard();
    },
  };
}
