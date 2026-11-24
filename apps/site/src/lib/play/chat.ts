// wiring for <Chat />: render messages (textContent only), send, report, collapse on phones.
import type { ChatMsg } from "@edwrdq/rooms/protocol";
import { CHAT_MAX } from "@edwrdq/rooms/filter";

export function mountChat(root: HTMLElement, opts: { send: (text: string) => boolean; report: (id: number) => boolean }) {
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const log = $<HTMLOListElement>("[data-log]");
  const input = $<HTMLInputElement>("[data-say-in]");
  const sendBtn = $<HTMLButtonElement>("[data-say] button");
  const note = $("[data-note-text]");
  const count = $("[data-say-count]");
  const toggle = $<HTMLButtonElement>("[data-chat-toggle]");
  const body = $("[data-chat-body]");
  let me = -1;
  let unread = 0;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  const isOpen = () => !body.hidden;
  const setOpen = (open: boolean) => {
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector(".caret")!.textContent = open ? "−" : "+";
    if (open) {
      unread = 0;
      $("[data-unread]").textContent = "";
      log.scrollTop = log.scrollHeight;
    }
  };
  toggle.addEventListener("click", () => setOpen(!isOpen()));
  // on desktop the toggle is hidden and the chat is always open
  if (matchMedia("(min-width: 761px)").matches) setOpen(true);

  function line(m: ChatMsg) {
    const li = document.createElement("li");
    if (m.sys) {
      li.className = "sys";
      li.textContent = m.body;
      return li;
    }
    if (m.seat === me) li.className = "me";
    const who = Object.assign(document.createElement("span"), { className: "who", textContent: `${m.nick}: ` });
    const text = Object.assign(document.createElement("span"), { className: "body", textContent: m.body });
    li.append(who, text);
    if (m.seat !== me) {
      const rep = Object.assign(document.createElement("button"), { type: "button", className: "rep", textContent: "report" });
      rep.setAttribute("aria-label", `report message from ${m.nick}`);
      let t: ReturnType<typeof setTimeout> | undefined;
      rep.addEventListener("click", () => {
        if (!rep.dataset.armed) {
          rep.dataset.armed = "1";
          rep.textContent = "report? tap again";
          t = setTimeout(() => {
            delete rep.dataset.armed;
            rep.textContent = "report";
          }, 3000);
          return;
        }
        clearTimeout(t);
        if (opts.report(m.id)) {
          rep.textContent = "reported";
          rep.disabled = true;
        }
      });
      li.append(rep);
    }
    return li;
  }

  function add(m: ChatMsg) {
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.append(line(m));
    while (log.children.length > 100) log.firstElementChild!.remove();
    if (stick || m.seat === me) log.scrollTop = log.scrollHeight;
    if (!isOpen() && !m.sys) {
      unread++;
      $("[data-unread]").textContent = `${unread} new`;
    }
  }

  function flash(text: string) {
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (note.textContent = ""), 4000);
  }

  const updateCount = () => {
    const n = [...input.value].length;
    count.textContent = n > CHAT_MAX - 40 ? `${n}/${CHAT_MAX}` : "";
  };
  input.addEventListener("input", updateCount);
  $("[data-say]").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (opts.send(text)) {
      input.value = "";
      updateCount();
    } else flash("not connected.");
  });

  return {
    reset(list: ChatMsg[], you: number) {
      me = you;
      log.replaceChildren(...list.map(line));
      log.scrollTop = log.scrollHeight;
    },
    add,
    flash,
    enable(on: boolean, why = "") {
      input.disabled = sendBtn.disabled = !on;
      input.placeholder = on ? "say something" : why || "chat is off";
    },
  };
}
