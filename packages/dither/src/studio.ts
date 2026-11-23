// client side of <Studio>. everything runs in the browser: the photo is decoded, cropped, resized
// and dithered on a canvas, and nothing is uploaded. the admin page layers presets + publish on top
// through the returned handle.
import { DEFAULTS, clean, ditherWidth, hexToRgb, run, type Params } from "./index.ts";

type Crop = { x: number; y: number; w: number; h: number }; // source px

export type Studio = {
  readonly params: Params;
  set(patch: Partial<Params>): void;
  load(file: Blob, name?: string): Promise<void>;
  pngBlob(): Promise<Blob>;
  readonly fileBase: string;
  status(msg: string): void;
};

export type StudioOptions = {
  initial?: Partial<Params>;
  /** colour image to load right away (public page) */
  sample?: string;
  /** called after a new image is loaded (not for the sample) */
  onLoad?: (fileBase: string) => void;
};

export function createStudio(root: HTMLElement, opts: StudioOptions = {}): Studio {
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const $$ = <T extends HTMLElement>(s: string) => [...root.querySelectorAll<T>(s)];
  const has = (s: string) => !!root.querySelector(s);

  let params: Params = clean(opts.initial ?? DEFAULTS);
  const css = getComputedStyle(document.documentElement);
  const colors = { bone: hexToRgb(css.getPropertyValue("--bone")), acid: hexToRgb(css.getPropertyValue("--acid")), bg: hexToRgb(css.getPropertyValue("--bg")) };
  const statusEl = $("[data-status]");
  const status = (m: string) => (statusEl.textContent = m);

  let src: ImageBitmap | null = null;
  let crop: Crop = { x: 0, y: 0, w: 1, h: 1 };
  let aspect: number | null = null; // w/h, null = free
  let fileBase = "dithered";
  let cache: { key: string; data: Uint8ClampedArray; w: number; h: number } | null = null;

  // ---------------- ui sync
  function syncUI() {
    for (const b of $$<HTMLButtonElement>("[data-p]")) b.setAttribute("aria-pressed", String(String((params as any)[b.dataset.p!]) === b.dataset.v));
    for (const r of $$<HTMLInputElement>("[data-r]")) {
      r.value = String((params as any)[r.dataset.r!]);
      $(`[data-val="${r.dataset.r}"]`).textContent = r.dataset.r === "gamma" ? Number(r.value).toFixed(2) : r.value;
    }
    for (const c of $$<HTMLInputElement>("[data-c]")) c.value = (params as any)[c.dataset.c!];
    $<HTMLInputElement>("[data-norm]").checked = params.normalize;
    $("[data-thr]").classList.toggle("off", params.algo !== "threshold");
    $<HTMLInputElement>('[data-r="threshold"]').disabled = params.algo !== "threshold";
  }
  const set = (patch: Partial<Params>) => {
    params = clean({ ...params, ...patch });
    syncUI();
    schedule();
  };

  // ---------------- processing
  async function resized(dw: number, dh: number) {
    const key = `${crop.x},${crop.y},${crop.w},${crop.h}->${dw}x${dh}`;
    if (cache?.key === key) return cache;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(src!, crop.x, crop.y, crop.w, crop.h, { resizeWidth: dw, resizeHeight: dh, resizeQuality: "high" });
    } catch {
      // fallback: halve step by step, then a final draw (keeps quality on big downscales)
      let c = document.createElement("canvas");
      c.width = crop.w;
      c.height = crop.h;
      c.getContext("2d")!.drawImage(src!, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
      while (c.width / 2 > dw) {
        const n = document.createElement("canvas");
        n.width = Math.round(c.width / 2);
        n.height = Math.round(c.height / 2);
        const x = n.getContext("2d")!;
        x.imageSmoothingQuality = "high";
        x.drawImage(c, 0, 0, n.width, n.height);
        c = n;
      }
      bmp = await createImageBitmap(c, { resizeWidth: dw, resizeHeight: dh, resizeQuality: "high" }).catch(() => createImageBitmap(c));
    }
    const c = document.createElement("canvas");
    c.width = dw;
    c.height = dh;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, dw, dh);
    bmp.close();
    cache = { key, data: ctx.getImageData(0, 0, dw, dh).data, w: dw, h: dh };
    return cache;
  }

  let pending = false;
  const schedule = () => {
    if (pending || !src) return;
    pending = true;
    requestAnimationFrame(async () => {
      pending = false;
      await process();
    });
  };
  async function process() {
    if (!src) return;
    const dw = ditherWidth(params, crop.w);
    const dh = Math.max(1, Math.round((crop.h * dw) / crop.w));
    const px = await resized(dw, dh);
    const t0 = performance.now();
    const out = run(px.data, px.w, px.h, 4, params, colors, 4);
    const c = $<HTMLCanvasElement>("[data-out]");
    c.width = out.width;
    c.height = out.height;
    c.getContext("2d")!.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
    // swap the static placeholder for the live canvas once there's something real to show
    if (has("[data-ph]")) $("[data-ph]").remove();
    if (view.hidden) c.hidden = false;
    $("[data-info]").textContent = `${out.width}×${out.height} · ${Math.round(performance.now() - t0)}ms`;
  }

  // ---------------- loading
  async function load(file: Blob, name = (file as File).name ?? "image", isSample = false) {
    if (!file.type.startsWith("image/")) return void status("that's not an image.");
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      return void status("couldn't read that image (heic? try a jpg or png export).");
    }
    src?.close();
    src = bmp;
    fileBase = name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dithered";
    crop = { x: 0, y: 0, w: src.width, h: src.height };
    aspect = null;
    $$("[data-aspect]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aspect === "free")));
    cache = null;
    $("[data-ws]").hidden = false;
    status(isSample ? "" : "loaded. nothing was uploaded.");
    setCropMode(false);
    syncUI();
    await process();
    if (!isSample) opts.onLoad?.(fileBase);
  }
  const zone = $("[data-zone]");
  $<HTMLInputElement>("[data-file]").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) load(f);
    (e.target as HTMLInputElement).value = "";
  });
  for (const ev of ["dragenter", "dragover"]) zone.addEventListener(ev, (e) => (e.preventDefault(), zone.classList.add("over")));
  for (const ev of ["dragleave", "drop"]) zone.addEventListener(ev, () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) load(f);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f?.type.startsWith("image/")) load(f);
  });
  // paste an image from the clipboard anywhere on the page (text pastes into fields are left alone)
  document.addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
    if (!f) return;
    e.preventDefault();
    load(f, f.name && f.name !== "image.png" ? f.name : "pasted");
  });

  // ---------------- controls
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-p]");
    if (!b) return;
    const k = b.dataset.p as keyof Params;
    const v = b.dataset.v!;
    set({ [k]: k === "width" || k === "scale" ? Number(v) : v } as Partial<Params>);
  });
  for (const r of $$<HTMLInputElement>("[data-r]")) r.addEventListener("input", () => set({ [r.dataset.r!]: Number(r.value) }));
  // picking a colour switches to the custom palette
  for (const c of $$<HTMLInputElement>("[data-c]")) c.addEventListener("input", () => set({ [c.dataset.c!]: c.value, palette: "custom" }));
  if (has("[data-swap]")) $("[data-swap]").addEventListener("click", () => set({ ink: params.paper, paper: params.ink, palette: "custom" }));
  $<HTMLInputElement>("[data-norm]").addEventListener("change", (e) => set({ normalize: (e.target as HTMLInputElement).checked }));
  $("[data-reset]").addEventListener("click", () => set({ ...DEFAULTS, ink: params.ink, paper: params.paper }));

  // before/after: hold to see the original (cropped, same size, full colour)
  const hold = $("[data-hold]");
  const showOrig = (on: boolean) => {
    const o = $<HTMLCanvasElement>("[data-orig]");
    const out = $<HTMLCanvasElement>("[data-out]");
    if (on && src) {
      o.width = out.width;
      o.height = out.height;
      const ctx = o.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, o.width, o.height);
    }
    o.hidden = !on || !src;
    out.hidden = on && !!src;
  };
  hold.addEventListener("pointerdown", (e) => (e.preventDefault(), showOrig(true)));
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) hold.addEventListener(ev, () => showOrig(false));
  hold.addEventListener("keydown", (e) => e.key === " " && showOrig(true));
  hold.addEventListener("keyup", (e) => e.key === " " && showOrig(false));

  $("[data-zoom]").addEventListener("click", (e) => {
    const on = $("[data-stage]").classList.toggle("zoomed");
    (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(on));
  });

  // ---------------- crop
  const view = $("[data-cropview]");
  const rectEl = $("[data-rect]");
  const srcView = $<HTMLCanvasElement>("[data-srcview]");
  function setCropMode(on: boolean) {
    view.hidden = !on;
    $<HTMLCanvasElement>("[data-out]").hidden = on || has("[data-ph]");
    $("[data-aspects]").hidden = !on;
    $("[data-crop]").setAttribute("aria-pressed", String(on));
    $("[data-crop]").textContent = on ? "DONE" : "CROP";
    if (on && src) {
      const scale = Math.min(1, 1400 / src.width);
      srcView.width = Math.round(src.width * scale);
      srcView.height = Math.round(src.height * scale);
      srcView.getContext("2d")!.drawImage(src, 0, 0, srcView.width, srcView.height);
      drawRect();
    }
    if (!on) {
      cache = null;
      schedule();
    }
  }
  const drawRect = () => {
    if (!src) return;
    rectEl.style.left = `${(crop.x / src.width) * 100}%`;
    rectEl.style.top = `${(crop.y / src.height) * 100}%`;
    rectEl.style.width = `${(crop.w / src.width) * 100}%`;
    rectEl.style.height = `${(crop.h / src.height) * 100}%`;
  };
  const fitAspect = (a: number | null) => {
    if (!src || a === null) return;
    let w = src.width;
    let h = Math.round(w / a);
    if (h > src.height) (h = src.height), (w = Math.round(h * a));
    crop = { x: Math.round((src.width - w) / 2), y: Math.round((src.height - h) / 2), w, h };
  };
  $("[data-crop]").addEventListener("click", () => src && setCropMode(view.hidden));
  root.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-aspect]");
    if (a) {
      const [x, y] = a.dataset.aspect!.split(":").map(Number);
      aspect = a.dataset.aspect === "free" ? null : x / y;
      $$("[data-aspect]").forEach((b) => b.setAttribute("aria-pressed", String(b === a)));
      fitAspect(aspect);
      drawRect();
    }
    if ((e.target as HTMLElement).closest("[data-crop-reset]") && src) {
      aspect = null;
      $$("[data-aspect]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aspect === "free")));
      crop = { x: 0, y: 0, w: src.width, h: src.height };
      drawRect();
    }
  });
  let drag: { mode: "move" | "size"; sx: number; sy: number; start: Crop; k: number } | null = null;
  view.addEventListener("pointerdown", (e) => {
    if (!src) return;
    const target = e.target as HTMLElement;
    if (!target.closest("[data-rect]")) return;
    e.preventDefault();
    view.setPointerCapture(e.pointerId);
    const k = src.width / view.getBoundingClientRect().width; // screen px → source px
    drag = { mode: target.closest("[data-handle]") ? "size" : "move", sx: e.clientX, sy: e.clientY, start: { ...crop }, k };
  });
  view.addEventListener("pointermove", (e) => {
    if (!drag || !src) return;
    const dx = (e.clientX - drag.sx) * drag.k;
    const dy = (e.clientY - drag.sy) * drag.k;
    const s = drag.start;
    const min = Math.max(16, Math.round(src.width * 0.04));
    if (drag.mode === "move") {
      crop = { ...s, x: Math.round(Math.min(Math.max(0, s.x + dx), src.width - s.w)), y: Math.round(Math.min(Math.max(0, s.y + dy), src.height - s.h)) };
    } else {
      let w = Math.min(Math.max(min, s.w + dx), src.width - s.x);
      let h = aspect ? w / aspect : Math.min(Math.max(min, s.h + dy), src.height - s.y);
      if (aspect && s.y + h > src.height) (h = src.height - s.y), (w = h * aspect);
      crop = { ...s, w: Math.round(w), h: Math.round(h) };
    }
    drawRect();
  });
  const endDrag = () => (drag = null);
  view.addEventListener("pointerup", endDrag);
  view.addEventListener("pointercancel", endDrag);

  // ---------------- export (the png is made here, in the browser)
  const pngBlob = () =>
    new Promise<Blob>((res, rej) => {
      if (!src) return rej(new Error("load an image first."));
      $<HTMLCanvasElement>("[data-out]").toBlob((b) => (b ? res(b) : rej(new Error("export failed."))), "image/png");
    });
  $("[data-download]").addEventListener("click", async () => {
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await pngBlob());
      a.download = `${root.querySelector<HTMLInputElement>("[data-iname]")?.value.trim() || fileBase}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      status((e as Error).message);
    }
  });
  if (has("[data-clip]") && "ClipboardItem" in window && navigator.clipboard?.write) {
    const clip = $<HTMLButtonElement>("[data-clip]");
    clip.hidden = false;
    clip.addEventListener("click", async () => {
      try {
        // pass the promise straight in so safari keeps the user gesture
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob() })]);
        clip.textContent = "COPIED";
        setTimeout(() => (clip.textContent = "COPY IMAGE"), 1000);
      } catch {
        status("your browser blocked the copy. use download instead.");
      }
    });
  }

  syncUI();
  if (opts.sample)
    fetch(opts.sample)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => (src ? undefined : load(b, "sample", true)))
      .catch(() => {});

  return {
    get params() {
      return params;
    },
    set,
    load: (f, n) => load(f, n),
    pngBlob,
    get fileBase() {
      return fileBase;
    },
    status,
  };
}
