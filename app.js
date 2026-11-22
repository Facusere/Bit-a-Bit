/**
 * @fileoverview Bit a Bit — Lector visual de Hacker News en JavaScript puro.
 * Combina las APIs de Firebase HN y Algolia HN Search con modo lectura (r.jina.ai + Microlink),
 * reproductores embebidos de video/podcast, sanitización XSS y fondo animado en canvas.
 */
"use strict";

const API = "https://hacker-news.firebaseio.com/v0/";
const ALG = "https://hn.algolia.com/api/v1/";
const PAGE = 20;
const TABS = {
  top: "Top",
  new: "Nuevas",
  best: "Mejores",
  ask: "Ask",
  show: "Show",
  video: "▶ Videos",
  podcast: "🎙 Podcasts"
};

/**
 * Escapa caracteres especiales HTML para prevenir inyecciones en plantillas.
 * @param {unknown} s
 * @returns {string}
 */
const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

/**
 * Formatea un timestamp UNIX (en segundos) a tiempo relativo legible.
 * @param {number} t
 * @returns {string}
 */
const ago = t => {
  const s = Date.now() / 1e3 - t;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min";
  if (s < 86400) return Math.round(s / 3600) + " h";
  return Math.round(s / 86400) + " d";
};

/**
 * Extrae el dominio sin prefijo "www." desde una URL; usa HN como respaldo.
 * @param {string|undefined} u
 * @returns {string}
 */
const host = u => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "news.ycombinator.com";
  }
};

/**
 * Valida que una URL utilice protocolo http(s) seguro; devuelve cadena vacía en caso contrario.
 * @param {string|undefined} raw
 * @returns {string}
 */
const safeUrl = raw => {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
};

/**
 * Extrae el ID de 11 caracteres de un enlace de YouTube (watch, youtu.be, shorts, live, embed).
 * @param {string|undefined} u
 * @returns {string}
 */
const ytId = u => {
  if (!u) return "";
  try {
    const p = new URL(u);
    const h = p.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (h === "youtu.be") {
      id = p.pathname.split("/").filter(Boolean)[0] || "";
    } else if (h === "youtube.com" || h === "m.youtube.com" || h === "youtube-nocookie.com") {
      if (p.pathname === "/watch") {
        id = p.searchParams.get("v") || "";
      } else {
        const seg = p.pathname.split("/").filter(Boolean);
        if (seg[0] === "shorts" || seg[0] === "live" || seg[0] === "embed") {
          id = seg[1] || "";
        }
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
};

/**
 * Detecta enlaces multimedia reproducibles (YouTube, Spotify Podcasts, Apple Podcasts)
 * y devuelve la configuración del reproductor embebido.
 * @param {string|undefined} u
 * @returns {{kind: "video"|"podcast", src: string}|null}
 */
const mediaEmbed = u => {
  const valid = safeUrl(u);
  if (!valid) return null;
  const vid = ytId(valid);
  if (vid) {
    return { kind: "video", src: `https://www.youtube-nocookie.com/embed/${vid}` };
  }
  try {
    const p = new URL(valid);
    const h = p.hostname.toLowerCase();
    if (h === "open.spotify.com") {
      const m = p.pathname.match(/\/(episode|show)\/([A-Za-z0-9]+)/);
      if (m) return { kind: "podcast", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
    }
    if (h === "podcasts.apple.com" && p.pathname.includes("/podcast/")) {
      return {
        kind: "podcast",
        src: `https://embed.podcasts.apple.com${p.pathname}${p.search}`
      };
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Normaliza un ítem obtenido de la API oficial de Firebase HN.
 * @param {object|null} i
 * @returns {object|null}
 */
const normF = i =>
  !i || i.dead || i.deleted || !i.title
    ? null
    : {
        id: i.id,
        title: i.title,
        url: i.url,
        points: i.score ?? 0,
        author: i.by,
        time: i.time,
        comments: i.descendants ?? 0
      };

/**
 * Normaliza un resultado devuelto por Algolia HN Search API.
 * @param {object} h
 * @returns {object|null}
 */
const normA = h =>
  h.title
    ? {
        id: +h.objectID,
        title: h.title,
        url: h.url,
        points: h.points ?? 0,
        author: h.author,
        time: h.created_at_i,
        comments: h.num_comments ?? 0
      }
    : null;

/**
 * Sanitiza HTML (comentarios o artículos) mediante lista blanca de etiquetas y protocolos http(s).
 * @param {string} html
 * @returns {string}
 */
function clean(html) {
  const d = new DOMParser().parseFromString(html || "", "text/html");
  const ok = new Set([
    "P",
    "I",
    "B",
    "EM",
    "STRONG",
    "A",
    "PRE",
    "CODE",
    "BR",
    "H2",
    "H3",
    "H4",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE"
  ]);

  (function walk(n) {
    [...n.childNodes].forEach(c => {
      if (c.nodeType === 1) {
        walk(c);
        if (!ok.has(c.tagName)) {
          c.replaceWith(...c.childNodes);
        } else {
          [...c.attributes].forEach(a => {
            if (!(c.tagName === "A" && a.name === "href")) c.removeAttribute(a.name);
          });
          if (c.tagName === "A") {
            if (/^https?:\/\//i.test(c.getAttribute("href") || "")) {
              c.target = "_blank";
              c.rel = "noopener noreferrer nofollow";
            } else {
              c.removeAttribute("href");
            }
          }
        }
      } else if (c.nodeType !== 3) {
        c.remove();
      }
    });
  })(d.body);

  return d.body.innerHTML;
}

/**
 * Extrae el contenido legible principal de una página HTML externa y lo sanitiza con clean().
 * @param {string} html
 * @param {string} [baseUrl]
 * @returns {string}
 */
function extractArticle(html, baseUrl = "") {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  doc
    .querySelectorAll("script,style,noscript,nav,header,footer,aside,form,svg,iframe,button")
    .forEach(el => el.remove());

  const candidates = [...doc.querySelectorAll("article, main, [role='main']")];
  const root =
    candidates.sort((a, b) => b.textContent.trim().length - a.textContent.trim().length)[0] ||
    doc.body;
  if (!root) return "";

  if (baseUrl) {
    root.querySelectorAll("a[href]").forEach(a => {
      try {
        const abs = new URL(a.getAttribute("href"), baseUrl);
        if (abs.protocol === "http:" || abs.protocol === "https:") {
          a.setAttribute("href", abs.href);
        }
      } catch {
        // Ignora enlaces relativos malformados; clean() eliminará los inválidos.
      }
    });
  }

  const blocks = [...root.querySelectorAll("h2,h3,h4,p,blockquote,pre,ul,ol")].filter(el => {
    const parentBlock = el.parentElement?.closest("blockquote,pre,ul,ol");
    if (parentBlock && root.contains(parentBlock)) return false;
    return el.textContent.trim().length > 0;
  });

  const rawHtml = blocks.length ? blocks.map(el => el.outerHTML).join("") : root.innerHTML;
  const sanitized = clean(rawHtml);
  const plainLen = (
    new DOMParser().parseFromString(sanitized, "text/html").body.textContent || ""
  )
    .replace(/\s+/g, " ")
    .trim().length;

  return plainLen >= 100 ? sanitized : "";
}

/**
 * Convierte contenido Markdown limpio (encabezados, párrafos, listas, citas, enlaces y código)
 * a HTML seguro escapando el texto con esc() y validando enlaces con safeUrl().
 * @param {string} md
 * @returns {string}
 */
function mdToHtml(md) {
  const inline = txt => {
    const cleaned = String(txt ?? "")
      .replace(/\u0000/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\s*\]\([^)]*\)/g, "");
    const tokens = [];
    const tokenized = cleaned.replace(
      /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g,
      (_, code, label, href) => {
        const idx = tokens.length;
        if (code !== undefined) {
          tokens.push(`<code>${esc(code)}</code>`);
        } else {
          const valid = safeUrl(href.trim());
          tokens.push(
            valid
              ? `<a href="${esc(valid)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>`
              : esc(label)
          );
        }
        return `\u0000T${idx}\u0000`;
      }
    );
    const formatted = esc(tokenized)
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    return formatted.replace(/\u0000T(\d+)\u0000/g, (_, i) => tokens[+i]);
  };

  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let paraBuf = [];
  let listType = "";
  let listItems = [];
  let quoteBuf = [];

  const flushPara = () => {
    if (!paraBuf.length) return;
    const html = inline(paraBuf.join(" ")).trim();
    if (html) out.push(`<p>${html}</p>`);
    paraBuf = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems.map(item => inline(item).trim()).filter(Boolean);
    if (items.length) out.push(`<${listType}>${items.map(i => `<li>${i}</li>`).join("")}</${listType}>`);
    listType = "";
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteBuf.length) return;
    const html = inline(quoteBuf.join(" ")).trim();
    if (html) out.push(`<blockquote><p>${html}</p></blockquote>`);
    quoteBuf = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      flushAll();
      if (!inCode) {
        inCode = true;
        codeBuf = [];
      } else {
        out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (paraBuf.length === 1 && /^([=-])\1{2,}\s*$/.test(line)) {
      const tag = line[0] === "=" ? "h2" : "h3";
      const text = inline(paraBuf.pop()).trim();
      if (text) out.push(`<${tag}>${text}</${tag}>`);
      continue;
    }

    if (/^\s*$/.test(line) || /^[-*_]{3,}\s*$/.test(line.trim())) {
      flushAll();
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      flushAll();
      const tag = "h" + Math.min(4, Math.max(2, h[1].length));
      const text = inline(h[2].replace(/\s+#+\s*$/, "").trim()).trim();
      if (text) out.push(`<${tag}>${text}</${tag}>`);
      continue;
    }

    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      quoteBuf.push(q[1]);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      flushQuote();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ul[1]);
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      flushQuote();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ol[1]);
      continue;
    }

    flushList();
    flushQuote();
    paraBuf.push(line.trim());
  }

  if (inCode && codeBuf.length) {
    out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
  }
  flushAll();
  return out.join("");
}

/**
 * Renderiza recursivamente un nodo del árbol de comentarios usando <details>.
 * @param {object} c
 * @param {(html: string) => string} [fn]
 * @param {number} [d]
 * @returns {string}
 */
function comment(c, fn = clean, d = 0) {
  const kids = (c.children || []).map(k => comment(k, fn, d + 1)).join("");
  if (!c.text && !kids) return "";
  return `<details class="cm"${d < 3 ? " open" : ""}><summary><b>${esc(c.author || "[borrado]")}</b> · hace ${ago(c.created_at_i)}</summary><div class="tx">${c.text ? fn(c.text) : "<i>[eliminado]</i>"}</div>${kids}</details>`;
}

/**
 * Cuenta de forma recursiva el total de comentarios con contenido dentro de un árbol.
 * @param {object} n
 * @returns {number}
 */
const countC = n =>
  (n.children || []).reduce((s, k) => s + (k.text ? 1 : 0) + countC(k), 0);

/**
 * Realiza una petición GET esperando JSON y lanza error ante respuestas HTTP no exitosas.
 * @param {string} u
 * @param {AbortSignal} [signal]
 * @returns {Promise<any>}
 */
async function j(u, signal) {
  const r = await fetch(u, signal ? { signal } : undefined);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

/**
 * Realiza una petición fetch con tiempo límite sin romper una señal AbortSignal externa.
 * @param {string} u
 * @param {RequestInit} [opts]
 * @param {number} [ms]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(u, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const extSignal = opts.signal;
  if (extSignal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  const onAbort = () => ctrl.abort();
  extSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(u, { ...opts, signal: ctrl.signal });
  } catch (err) {
    if (extSignal?.aborted) throw err;
    if (err.name === "AbortError") throw new Error("Timeout");
    throw err;
  } finally {
    clearTimeout(timer);
    extSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Wrapper seguro sobre localStorage con respaldo en caso de bloqueo o cuota llena.
 */
const store = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // Ignora errores de almacenamiento (modo privado o cuota excedida).
    }
  }
};

/**
 * Inicializa el fondo animado en canvas con ceros y unos en capas de profundidad,
 * oscilación sinusoidal, cambio ocasional de bit y reacción sutil al puntero.
 * Se pausa en pestañas ocultas y respeta prefers-reduced-motion.
 */
function bg() {
  const c = document.getElementById("bg");
  const x = c.getContext("2d");
  if (!x) return;

  const rm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ptr = { x: -9999, y: -9999, active: false };
  let W = 0;
  let H = 0;
  let dpr = 1;
  let lastInnerW = 0;
  let P = [];
  let on = false;
  let accentColor = "#5b3df5";

  const updateAccent = () => {
    accentColor =
      getComputedStyle(document.documentElement).getPropertyValue("--ac").trim() || "#5b3df5";
  };

  const size = () => {
    const nextDpr = devicePixelRatio || 1;
    const nextW = innerWidth * nextDpr;
    const nextH = innerHeight * nextDpr;
    const widthChanged = innerWidth !== lastInnerW;

    if (!P.length || widthChanged) {
      dpr = nextDpr;
      W = c.width = nextW;
      H = c.height = nextH;
      lastInnerW = innerWidth;
      const count = Math.max(24, Math.round(innerWidth / 18));

      P = Array.from({ length: count }, () => {
        const z = 0.4 + Math.random() * 0.6;
        return {
          x: Math.random() * W,
          y: Math.random() * H,
          z,
          v: (0.18 + z * 0.55) * dpr,
          s: (9 + z * 13) * dpr,
          b: Math.random() < 0.5 ? "0" : "1",
          a: 0.06 + z * 0.18,
          phase: Math.random() * Math.PI * 2,
          freq: 0.6 + Math.random() * 0.8,
          amp: (0.12 + z * 0.25) * dpr,
          pulse: 0
        };
      });
    } else {
      // Reescale proporcional cuando solo cambia el alto (ej. barra móvil al hacer scroll).
      const sx = W ? nextW / W : 1;
      const sy = H ? nextH / H : 1;
      const sd = dpr ? nextDpr / dpr : 1;
      dpr = nextDpr;
      W = c.width = nextW;
      H = c.height = nextH;
      for (const p of P) {
        p.x *= sx;
        p.y *= sy;
        if (sd !== 1) {
          p.v *= sd;
          p.s *= sd;
          p.amp *= sd;
        }
      }
    }
  };

  const draw = t => {
    const radius = 110 * dpr;
    const radius2 = radius * radius;
    x.clearRect(0, 0, W, H);
    x.fillStyle = accentColor;

    for (const p of P) {
      let ox = 0;
      let oy = 0;
      let boost = 0;

      if (!rm) {
        p.y -= p.v;
        p.x += Math.sin(t * 0.0015 * p.freq + p.phase) * p.amp;

        if (Math.random() < 0.0015) {
          p.b = p.b === "0" ? "1" : "0";
          p.pulse = 1;
        }
        if (p.pulse > 0) {
          p.pulse = Math.max(0, p.pulse - 0.03);
        }

        if (ptr.active) {
          const dx = p.x - ptr.x;
          const dy = p.y - ptr.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > 1 && dist2 < radius2) {
            const dist = Math.sqrt(dist2);
            const f = 1 - dist / radius;
            ox = (dx / dist) * f * 18 * dpr;
            oy = (dy / dist) * f * 18 * dpr;
            boost = f * 0.28;
          }
        }

        if (p.y < -p.s) {
          p.y = H + p.s;
          p.x = Math.random() * W;
          p.b = Math.random() < 0.5 ? "0" : "1";
        }
        if (p.x < -p.s) p.x = W + p.s;
        else if (p.x > W + p.s) p.x = -p.s;
      }

      x.globalAlpha = Math.min(0.65, p.a + p.pulse * 0.25 + boost);
      x.font = `700 ${p.s}px ui-monospace, Consolas, monospace`;
      x.fillText(p.b, p.x + ox, p.y + oy);
    }
    x.globalAlpha = 1;
  };

  const loop = t => {
    draw(t || performance.now());
    if (rm || document.hidden) {
      on = false;
      return;
    }
    requestAnimationFrame(loop);
  };

  const start = () => {
    if (!on) {
      on = true;
      loop(performance.now());
    }
  };

  // Sincroniza el color cacheado cuando cambia el tema (data-theme).
  new MutationObserver(() => {
    updateAccent();
    if (rm || document.hidden) draw(performance.now());
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });

  addEventListener(
    "pointermove",
    e => {
      ptr.x = e.clientX * dpr;
      ptr.y = e.clientY * dpr;
      ptr.active = true;
    },
    { passive: true }
  );
  addEventListener("pointerleave", () => {
    ptr.active = false;
  });
  document.addEventListener("pointerleave", () => {
    ptr.active = false;
  });
  addEventListener("blur", () => {
    ptr.active = false;
  });

  addEventListener("resize", () => {
    size();
    draw(performance.now());
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) start();
  });

  updateAccent();
  size();
  start();
}

/**
 * Inicializa la interfaz de usuario, eventos, paginación y visor de comentarios.
 */
function init() {
  bg();

  const $ = id => document.getElementById(id);
  const list = $("list");
  const dlg = $("dlg");
  const body = $("dbody");
  const S = { tab: "top", q: "", ids: {}, pos: 0, page: 0, done: false, busy: false, gen: 0 };
  const read = new Set(store.get("bab-read", []));
  const itemCache = new Map();
  const algCache = new Map();
  const articleCache = new Map();
  const storyMap = new Map();
  let listCtrl = null;
  let dlgCtrl = null;
  let dlgToken = 0;

  $("tabs").innerHTML = Object.entries(TABS)
    .map(
      ([k, v]) =>
        `${k === "video" ? '<span class="tab-sep" aria-hidden="true"></span>' : ""}<button type="button" data-t="${k}" aria-pressed="false">${v}</button>`
    )
    .join("");

  // Logo binario: "01000010" representa la letra 'B' en código ASCII.
  document.querySelector(".logo").innerHTML = [..."01000010"]
    .map(b => `<i${b === "1" ? ' class="on"' : ""}></i>`)
    .join("");

  /**
   * Aplica y persiste el tema visual ("light" o "dark") sincronizando aria-pressed.
   * @param {"light"|"dark"} t
   */
  const setTheme = t => {
    const isDark = t === "dark";
    document.documentElement.dataset.theme = t;
    store.set("bab-theme", t);
    $("theme").textContent = isDark ? "Modo claro" : "Modo oscuro";
    $("theme").setAttribute("aria-pressed", String(isDark));
  };

  setTheme(
    store.get("bab-theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
  $("theme").onclick = () =>
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

  /**
   * Construye la portada visual (miniatura de YouTube o thum.io con respaldo procedural)
   * e insignia multimedia cuando corresponde a Video o Podcast.
   * @param {{title?: string, url?: string}} s
   * @returns {string}
   */
  const cover = s => {
    const h = host(s.url);
    const hue = [...h].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const valid = safeUrl(s.url);
    const vid = ytId(valid);
    const embed = mediaEmbed(valid);
    let thumb = "";
    if (vid) {
      thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    } else if (valid) {
      const u = new URL(valid);
      // Limpia query string y hash para evitar conflictos con el endpoint por ruta de thum.io.
      u.search = "";
      u.hash = "";
      thumb = `https://image.thum.io/get/width/600/crop/340/${u.href}`;
    }

    let badge = "";
    if (embed?.kind === "video" || S.tab === "video") {
      badge = '<span class="badge-media">▶ Video</span>';
    } else if (
      embed?.kind === "podcast" ||
      S.tab === "podcast" ||
      /\bpodcast\b/i.test(`${s.title || ""} ${s.url || ""}`)
    ) {
      badge = '<span class="badge-media">🎙 Podcast</span>';
    }

    return `<div class="cv"><div class="ph" style="--h:${hue}"><span>${esc(h.charAt(0).toUpperCase())}</span><small>${esc(h)}</small></div>${thumb ? `<img loading="lazy" alt="" src="${esc(thumb)}" onload="this.classList.add('ok')" onerror="this.remove()">` : ""}${badge}</div>`;
  };

  /**
   * Genera el marcado HTML de una tarjeta de historia o multimedia interactiva.
   * Al pulsarla abre la ventana modal centrada en lugar de salir directamente del sitio.
   * @param {object} s
   * @param {number} i
   * @returns {string}
   */
  const card = (s, i) => {
    const h = host(s.url);
    return `<article class="s${read.has(s.id) ? " read" : ""}" data-id="${s.id}" style="--i:${i}">
      ${cover(s)}
      <div class="bd">
        <div class="s-head">
          <i class="bit" aria-hidden="true"></i>
          <span class="host">${esc(h)}</span>
          <span class="age">hace ${ago(s.time)}</span>
        </div>
        <a class="t" href="#/item/${s.id}" data-open="${s.id}">${esc(s.title)}</a>
        <div class="ft">
          <span>${s.points} pts · ${esc(s.author || "anónimo")}</span>
          <button type="button" class="cb" data-c="${s.id}">${s.comments} comentarios</button>
        </div>
      </div>
    </article>`;
  };

  /**
   * Marca una historia como leída en memoria, localStorage y en la tarjeta visible.
   * @param {number} id
   */
  const markRead = id => {
    read.add(id);
    store.set("bab-read", [...read].slice(-1000));
    const a = list.querySelector(`[data-id="${id}"]`);
    if (a) a.classList.add("read");
  };

  /**
   * Obtiene el siguiente lote de historias (desde Algolia para búsqueda o Firebase para pestañas).
   * @param {AbortSignal} signal
   * @returns {Promise<object[]>}
   */
  async function fetchBatch(signal) {
    if (S.q) {
      const r = await j(
        `${ALG}search?tags=story&hitsPerPage=${PAGE}&page=${S.page}&query=${encodeURIComponent(S.q)}`,
        signal
      );
      S.page++;
      S.done = S.page >= r.nbPages;
      return r.hits.map(normA).filter(Boolean);
    }
    if (S.tab === "video" || S.tab === "podcast") {
      const params =
        S.tab === "video"
          ? "tags=story&numericFilters=points>10&restrictSearchableAttributes=url&query=youtube.com"
          : "tags=story&numericFilters=points>5&restrictSearchableAttributes=title,url&query=podcast";
      const r = await j(
        `${ALG}search_by_date?${params}&hitsPerPage=${PAGE}&page=${S.page}`,
        signal
      );
      S.page++;
      S.done = S.page >= r.nbPages;
      return r.hits.map(normA).filter(Boolean);
    }
    if (!S.ids[S.tab]) {
      S.ids[S.tab] = await j(`${API}${S.tab}stories.json`, signal);
    }
    const ids = S.ids[S.tab];
    const slice = ids.slice(S.pos, S.pos + PAGE);
    const fetched = await Promise.all(
      slice.map(async id => {
        if (itemCache.has(id)) return itemCache.get(id);
        return j(`${API}item/${id}.json`, signal)
          .then(raw => {
            if (raw) {
              if (itemCache.size >= 1000) itemCache.delete(itemCache.keys().next().value);
              itemCache.set(id, raw);
            }
            return raw;
          })
          .catch(err => {
            if (err.name === "AbortError") throw err;
            return null;
          });
      })
    );
    S.pos += PAGE;
    S.done = S.pos >= ids.length;
    return fetched.map(normF).filter(Boolean);
  }

  /**
   * Carga un nuevo lote de historias en la grilla gestionando skeletons, caché y AbortController.
   * @param {boolean} reset
   */
  async function load(reset) {
    if (S.busy && !reset) return;
    if (reset) {
      if (listCtrl) listCtrl.abort();
      S.gen++;
      S.pos = 0;
      S.page = 0;
      S.done = false;
      S.busy = false;
      list.innerHTML = "";
      $("status").textContent = S.q ? `Resultados para «${S.q}»` : "";
    }
    if (S.done) return;

    S.busy = true;
    list.setAttribute("aria-busy", "true");
    const g = S.gen;
    const ctrl = new AbortController();
    listCtrl = ctrl;
    $("more").hidden = true;
    list.insertAdjacentHTML("beforeend", '<div class="sk"></div>'.repeat(reset ? 8 : 3));

    try {
      const items = await fetchBatch(ctrl.signal);
      if (g !== S.gen) return;
      items.forEach(s => {
        if (storyMap.size >= 1000) storyMap.delete(storyMap.keys().next().value);
        storyMap.set(s.id, s);
      });
      list.querySelectorAll(".sk").forEach(e => e.remove());
      list.insertAdjacentHTML(
        "beforeend",
        items.map((s, i) => card(s, Math.min(i, 10))).join("")
      );
      if (!list.children.length) $("status").textContent = "No hay resultados.";
      $("more").hidden = S.done;
    } catch (e) {
      if (e.name === "AbortError" || g !== S.gen) return;
      list.querySelectorAll(".sk").forEach(x => x.remove());
      $("status").innerHTML =
        `<span class="err">No se pudo cargar (${esc(e.message)}). <button type="button" id="retry">Reintentar</button></span>`;
      $("retry").onclick = () => {
        $("status").textContent = "";
        load(false);
      };
    } finally {
      if (g === S.gen) {
        S.busy = false;
        list.setAttribute("aria-busy", "false");
      }
    }
  }

  /**
   * Cambia a una pestaña de Hacker News, limpia la búsqueda y recarga el feed.
   * @param {string} t
   */
  const pick = t => {
    S.tab = t;
    S.q = "";
    $("q").value = "";
    document.querySelectorAll("#tabs button").forEach(b => {
      const active = b.dataset.t === t;
      b.classList.toggle("on", active);
      b.setAttribute("aria-pressed", String(active));
    });
    load(true);
  };

  $("tabs").onclick = e => {
    const t = e.target.dataset.t;
    if (t) pick(t);
  };

  $("sf").onsubmit = e => {
    e.preventDefault();
    const q = $("q").value.trim();
    if (!q) return pick(S.tab);
    S.q = q;
    document.querySelectorAll("#tabs button").forEach(b => {
      b.classList.remove("on");
      b.setAttribute("aria-pressed", "false");
    });
    load(true);
  };

  // Al limpiar el buscador con una búsqueda activa, vuelve automáticamente a la pestaña elegida.
  $("q").addEventListener("input", () => {
    if (!$("q").value.trim() && S.q) pick(S.tab);
  });

  $("more").onclick = () => load(false);

  new IntersectionObserver(
    en => {
      if (en[0].isIntersecting && !S.busy && !S.done && list.children.length) {
        load(false);
      }
    },
    { rootMargin: "400px" }
  ).observe($("sentinel"));

  /**
   * Obtiene y cachea el ítem completo de Algolia (texto propio y árbol de comentarios).
   * @param {number} id
   * @param {AbortSignal} signal
   * @returns {Promise<object>}
   */
  async function fetchAlgItem(id, signal) {
    if (algCache.has(id)) return algCache.get(id);
    const it = await j(ALG + "items/" + id, signal);
    if (algCache.size >= 200) algCache.delete(algCache.keys().next().value);
    algCache.set(id, it);
    return it;
  }

  /**
   * Descarga y extrae el contenido legible de una noticia externa vía Jina Reader JSON
   * con respaldo en Microlink y tiempo límite de 6 segundos por endpoint.
   * @param {string} url
   * @param {AbortSignal} signal
   * @returns {Promise<string>}
   */
  async function fetchArticleHtml(url, signal) {
    if (articleCache.has(url)) return articleCache.get(url);

    // Intento 1 (principal): Jina Reader en JSON (rápido y con CORS para http(s) y file://).
    try {
      const r = await fetchWithTimeout(
        `https://r.jina.ai/${url}`,
        { headers: { Accept: "application/json" }, signal },
        6000
      );
      if (r.ok) {
        const data = (await r.json())?.data;
        const md = (data?.content || data?.description || "").trim();
        if (md) {
          const rawHtml = mdToHtml(md);
          const html = typeof DOMParser !== "undefined" ? clean(rawHtml) : rawHtml;
          const plainLen = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
          if (plainLen >= 80) {
            if (articleCache.size >= 200) articleCache.delete(articleCache.keys().next().value);
            articleCache.set(url, html);
            return html;
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") throw err;
    }

    // Intento 2 (respaldo): Microlink HTML selector / descripción.
    try {
      const endpoint =
        `https://api.microlink.io/?url=${encodeURIComponent(url)}` +
        "&data.html.selector=article,main,body&data.html.type=html";
      const r = await fetchWithTimeout(endpoint, { signal }, 6000);
      if (r.ok) {
        const data = (await r.json())?.data;
        let html = data?.html ? extractArticle(data.html, url) : "";
        if (!html && data?.description) {
          html = clean(`<p>${esc(data.description)}</p>`);
        }
        if (html) {
          if (articleCache.size >= 200) articleCache.delete(articleCache.keys().next().value);
          articleCache.set(url, html);
          return html;
        }
      }
    } catch (err) {
      if (err.name === "AbortError") throw err;
    }

    return "";
  }

  /**
   * Determina la etiqueta de encabezado del modal según el tipo de contenido.
   * @param {object|undefined} s
   * @returns {"Video"|"Podcast"|"Noticia"}
   */
  const storyKindLabel = s => {
    const em = mediaEmbed(s?.url);
    if (em?.kind === "video") return "Video";
    if (
      em?.kind === "podcast" ||
      S.tab === "podcast" ||
      /\bpodcast\b/i.test(`${s?.title || ""} ${s?.url || ""}`)
    ) {
      return "Podcast";
    }
    return "Noticia";
  };

  /**
   * Construye la cabecera de la ventana modal según el modo ("story" o "comments").
   * @param {object} s
   * @param {"story"|"comments"} view
   * @returns {string}
   */
  const renderModalHead = (s, view) => {
    const extUrl = safeUrl(s.url);
    const embed = mediaEmbed(extUrl);
    const hnUrl = `https://news.ycombinator.com/item?id=${s.id}`;
    const ageText = s.time ? `hace ${ago(s.time)}` : "";

    const actions =
      view === "story"
        ? `${
            extUrl
              ? `<a class="btn-primary" href="${esc(extUrl)}" target="_blank" rel="noopener noreferrer">Ir a la página oficial ↗</a>`
              : ""
          }
           <button type="button" class="${extUrl ? "btn-ghost" : "btn-primary"}" id="btn-comments">Ver comentarios (${s.comments ?? 0})</button>
           <a class="btn-ghost" href="${hnUrl}" target="_blank" rel="noopener noreferrer">Ver en Hacker News ↗</a>`
        : `<button type="button" class="btn-primary" id="btn-story">${embed?.kind === "video" ? "Ver video" : "Leer noticia"}</button>
           ${
             extUrl
               ? `<a class="btn-ghost" href="${esc(extUrl)}" target="_blank" rel="noopener noreferrer">Ir a la página oficial ↗</a>`
               : ""
           }
           <a class="btn-ghost" href="${hnUrl}" target="_blank" rel="noopener noreferrer">Ver en Hacker News ↗</a>`;

    const modeSwitch =
      view === "story" && extUrl && embed?.kind !== "video"
        ? `<div class="mode-switch" role="group" aria-label="Modo de visualización">
             <button type="button" id="mode-reader" class="on" aria-pressed="true">Modo lectura</button>
             <button type="button" id="mode-web" aria-pressed="false">Vista web</button>
           </div>`
        : "";

    return `<article class="story-view">
      <h2>${esc(s.title || "Sin título")}</h2>
      <div class="story-meta">
        <span>${esc(host(extUrl))}</span>
        <span>${s.points ?? 0} pts</span>
        <span>por ${esc(s.author || "anónimo")}</span>
        ${ageText ? `<span>${ageText}</span>` : ""}
      </div>
      <div class="story-actions">${actions}</div>
      ${modeSwitch}
    </article>`;
  };

  /**
   * Abre la ventana modal en modo "story" (noticia/video/podcast) o "comments" (solo comentarios).
   * @param {number} id
   * @param {"story"|"comments"} [view]
   */
  async function openItem(id, view = "story") {
    if (dlgCtrl) dlgCtrl.abort();
    const ctrl = new AbortController();
    dlgCtrl = ctrl;
    const token = ++dlgToken;
    const known = storyMap.get(id);

    $("dlg-title").textContent = view === "comments" ? "Comentarios" : storyKindLabel(known);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;

    const targetHash = view === "comments" ? `#/item/${id}/comments` : `#/item/${id}`;
    if (location.hash !== targetHash) {
      history.pushState(null, "", targetHash);
    }
    markRead(id);

    let activeMode = "reader";
    let articleLoaded = false;
    let cachedArticle = "";

    const renderStoryBody = s => {
      const extUrl = safeUrl(s.url);
      const embed = mediaEmbed(extUrl);

      if (embed?.kind === "video") {
        body.innerHTML = `${renderModalHead(s, "story")}
          <div id="story-content">
            <iframe class="video-player" src="${esc(embed.src)}" title="${esc(s.title || "Reproductor de video")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          </div>
          <div id="story-hn-text"></div>`;
        $("btn-comments").onclick = () => openItem(id, "comments");
        return;
      }

      const podcastPlayer =
        embed?.kind === "podcast"
          ? `<div id="podcast-slot"><iframe class="podcast-player" src="${esc(embed.src)}" title="${esc(s.title || "Reproductor de podcast")}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe></div>`
          : "";

      body.innerHTML = `${renderModalHead(s, "story")}
        ${podcastPlayer}
        <div id="story-hn-text"></div>
        <div id="story-content">${extUrl ? '<p class="m">Cargando contenido completo…</p>' : ""}</div>`;

      $("btn-comments").onclick = () => openItem(id, "comments");

      if (!extUrl) return;

      const btnReader = $("mode-reader");
      const btnWeb = $("mode-web");
      const content = $("story-content");

      const showWeb = note => {
        content.innerHTML = `<div class="story-frame-wrap">
          <iframe class="story-frame" src="${esc(extUrl)}" title="${esc("Vista web de " + host(extUrl))}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" loading="lazy" referrerpolicy="no-referrer"></iframe>
          <p class="frame-note">${esc(note || "Algunos sitios bloquean la carga en marcos embebidos por seguridad; si ves el recuadro vacío, usá «Ir a la página oficial ↗».")}</p>
        </div>`;
      };

      const setMode = (mode, note = "") => {
        activeMode = mode;
        btnReader.classList.toggle("on", mode === "reader");
        btnReader.setAttribute("aria-pressed", String(mode === "reader"));
        btnWeb.classList.toggle("on", mode === "web");
        btnWeb.setAttribute("aria-pressed", String(mode === "web"));

        if (mode === "web") {
          showWeb(note);
        } else if (articleLoaded) {
          content.innerHTML = cachedArticle
            ? `<div class="reader-body tx">${cachedArticle}</div>`
            : '<p class="m">No se pudo extraer texto legible de esta página. Probá con «Vista web» o «Ir a la página oficial ↗».</p>';
        } else {
          content.innerHTML = '<p class="m">Cargando contenido completo…</p>';
        }
      };

      btnReader.onclick = () => setMode("reader");
      btnWeb.onclick = () => setMode("web");

      fetchArticleHtml(extUrl, ctrl.signal)
        .then(html => {
          if (token !== dlgToken) return;
          articleLoaded = true;
          cachedArticle = html;
          if (activeMode !== "reader") return;
          if (html) {
            content.innerHTML = `<div class="reader-body tx">${html}</div>`;
          } else if (embed?.kind === "podcast") {
            content.innerHTML =
              '<p class="m">Reproducí el episodio arriba o usá «Vista web» / «Ir a la página oficial ↗».</p>';
          } else {
            setMode(
              "web",
              "Esta página no expone un artículo de texto plano; mostrando Vista web integrada."
            );
          }
        })
        .catch(err => {
          if (err.name === "AbortError" || token !== dlgToken) return;
          articleLoaded = true;
          cachedArticle = "";
          if (activeMode !== "reader") return;
          if (embed?.kind === "podcast") {
            content.innerHTML =
              '<p class="m">Reproducí el episodio arriba o usá «Ir a la página oficial ↗» para ver notas adicionales.</p>';
          } else {
            setMode("web", "No se pudo cargar el modo lectura; mostrando Vista web integrada.");
          }
        });
    };

    const renderCommentsBody = (s, it) => {
      if (!$("dlg-comments")) {
        body.innerHTML = `${renderModalHead(s, "comments")}<section id="dlg-comments" class="comments-sec"></section>`;
        $("btn-story").onclick = () => openItem(id, "story");
      }
      const kids = (it.children || []).map(c => comment(c)).join("");
      $("dlg-comments").innerHTML =
        `<h3>${countC(it)} comentarios</h3>${kids || "<p>Todavía no hay comentarios.</p>"}`;
    };

    if (view === "story") {
      if (known) {
        renderStoryBody(known);
      } else {
        body.innerHTML = '<p class="m">Cargando contenido…</p>';
      }

      try {
        const it = await fetchAlgItem(id, ctrl.signal);
        if (token !== dlgToken) return;

        const totalComments = countC(it);
        const merged = {
          id,
          title: it.title || known?.title || "Sin título",
          url: it.url || known?.url || "",
          points: it.points ?? known?.points ?? 0,
          author: it.author || known?.author || "",
          time: it.created_at_i ?? known?.time ?? 0,
          comments: known?.comments ?? totalComments
        };
        storyMap.set(id, merged);
        $("dlg-title").textContent = storyKindLabel(merged);

        if (!known) renderStoryBody(merged);

        const cBtn = $("btn-comments");
        if (cBtn) cBtn.textContent = `Ver comentarios (${totalComments})`;

        const hnText = $("story-hn-text");
        const textHtml = it.text ? clean(it.text) : "";
        if (hnText && textHtml) {
          hnText.innerHTML = `<div class="reader-body tx">${textHtml}</div>`;
        } else if (!safeUrl(merged.url) && !textHtml && $("story-content")) {
          $("story-content").innerHTML =
            '<p class="m">Esta publicación no incluye texto ni enlace externo. Podés revisar los comentarios con el botón superior.</p>';
        }
      } catch (e) {
        if (e.name === "AbortError" || token !== dlgToken) return;
        if (!known) {
          body.innerHTML =
            '<p class="err">No se pudo cargar la noticia. <button type="button" id="rc">Reintentar</button></p>';
          $("rc").onclick = () => openItem(id, "story");
        }
      }
      return;
    }

    // Modo "comments": muestra únicamente el hilo de comentarios (con opción para volver a la noticia).
    if (known) {
      body.innerHTML = `${renderModalHead(known, "comments")}<section id="dlg-comments" class="comments-sec"><p class="m">Cargando comentarios…</p></section>`;
      $("btn-story").onclick = () => openItem(id, "story");
    } else {
      body.innerHTML = '<section id="dlg-comments"><p class="m">Cargando comentarios…</p></section>';
    }

    try {
      const it = await fetchAlgItem(id, ctrl.signal);
      if (token !== dlgToken) return;

      const merged = {
        id,
        title: it.title || known?.title || "Sin título",
        url: it.url || known?.url || "",
        points: it.points ?? known?.points ?? 0,
        author: it.author || known?.author || "",
        time: it.created_at_i ?? known?.time ?? 0,
        comments: known?.comments ?? countC(it)
      };
      storyMap.set(id, merged);
      renderCommentsBody(merged, it);
    } catch (e) {
      if (e.name === "AbortError" || token !== dlgToken) return;
      const target = $("dlg-comments") || body;
      target.innerHTML =
        '<p class="err">No se pudieron cargar los comentarios. <button type="button" id="rc">Reintentar</button></p>';
      $("rc").onclick = () => openItem(id, "comments");
    }
  }

  /**
   * Sincroniza la apertura o cierre de la ventana modal según el hash actual de la URL.
   */
  const syncHash = () => {
    const m = location.hash.match(/^#\/item\/(\d+)(\/comments)?/);
    if (m) {
      openItem(+m[1], m[2] ? "comments" : "story");
    } else if (dlg.open) {
      dlg.close();
    }
  };

  list.onclick = e => {
    const commentBtn = e.target.closest("[data-c]");
    if (commentBtn) return openItem(+commentBtn.dataset.c, "comments");

    const link = e.target.closest("a.t");
    if (link) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
    }

    const cardEl = e.target.closest(".s");
    if (cardEl) openItem(+cardEl.dataset.id, "story");
  };

  $("close").onclick = () => dlg.close();
  dlg.onclick = e => {
    if (e.target === dlg) dlg.close();
  };
  dlg.onclose = () => {
    if (dlgCtrl) {
      dlgCtrl.abort();
      dlgCtrl = null;
    }
    if (location.hash.startsWith("#/item/")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  };

  // Atajos de teclado globales: "/" enfoca el buscador; "T" o "Alt+T" alterna el tema.
  addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey) return;
    const el = e.target;
    const editing =
      el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable);

    if (e.key === "/" && !e.altKey && !editing) {
      e.preventDefault();
      $("q").focus();
      $("q").select();
    } else if ((e.key === "t" || e.key === "T") && (e.altKey || !editing)) {
      if (e.altKey) e.preventDefault();
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    }
  });

  addEventListener("hashchange", syncHash);

  pick("top");
  syncHash();
}

if (typeof document !== "undefined") {
  init();
} else {
  module.exports = {
    esc,
    ago,
    host,
    safeUrl,
    normF,
    normA,
    comment,
    countC,
    clean,
    extractArticle,
    mdToHtml,
    ytId,
    mediaEmbed
  };
}
