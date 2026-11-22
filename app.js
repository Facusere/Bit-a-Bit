"use strict";

const API = "https://hacker-news.firebaseio.com/v0/";
const ALG = "https://hn.algolia.com/api/v1/";
const PAGE = 20;
const TABS = { top: "Top", new: "Nuevas", best: "Mejores", ask: "Ask", show: "Show" };

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
 * Sanitiza el HTML de un comentario mediante lista blanca de etiquetas y protocolos http(s).
 * @param {string} html
 * @returns {string}
 */
function clean(html) {
  const d = new DOMParser().parseFromString(html || "", "text/html");
  const ok = new Set(["P", "I", "B", "EM", "STRONG", "A", "PRE", "CODE", "BR"]);

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
  const storyMap = new Map();
  let listCtrl = null;
  let dlgCtrl = null;
  let dlgToken = 0;

  $("tabs").innerHTML = Object.entries(TABS)
    .map(([k, v]) => `<button type="button" data-t="${k}" aria-pressed="false">${v}</button>`)
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
   * Construye la portada visual (miniatura vía thum.io con respaldo procedural por dominio).
   * @param {{url?: string}} s
   * @returns {string}
   */
  const cover = s => {
    const h = host(s.url);
    const hue = [...h].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const valid = safeUrl(s.url);
    let thumb = "";
    if (valid) {
      const u = new URL(valid);
      // Limpia query string y hash para evitar conflictos con el endpoint por ruta de thum.io.
      u.search = "";
      u.hash = "";
      thumb = `https://image.thum.io/get/width/600/crop/340/${u.href}`;
    }
    return `<div class="cv"><div class="ph" style="--h:${hue}"><span>${esc(h.charAt(0).toUpperCase())}</span><small>${esc(h)}</small></div>${thumb ? `<img loading="lazy" alt="" src="${esc(thumb)}" onload="this.classList.add('ok')" onerror="this.remove()">` : ""}</div>`;
  };

  /**
   * Genera el marcado HTML de una tarjeta de historia interactiva.
   * Al pulsarla abre la ventana deslizante en lugar de salir directamente del sitio.
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
   * Renderiza la ficha completa de la noticia dentro de la ventana deslizante,
   * incluyendo botones para abrir el sitio externo o previsualizarlo embebido.
   * @param {object} s
   * @param {string} [textHtml]
   * @returns {string}
   */
  const renderStoryShell = (s, textHtml = "") => {
    const extUrl = safeUrl(s.url);
    const hnUrl = `https://news.ycombinator.com/item?id=${s.id}`;
    const ageText = s.time ? `hace ${ago(s.time)}` : "";
    return `<article class="story-view">
      <div class="story-cover">${cover(s)}</div>
      <h2>${esc(s.title || "Sin título")}</h2>
      <div class="story-meta">
        <span>${esc(host(extUrl))}</span>
        <span>${s.points ?? 0} pts</span>
        <span>por ${esc(s.author || "anónimo")}</span>
        ${ageText ? `<span>${ageText}</span>` : ""}
      </div>
      <div class="story-actions">
        ${
          extUrl
            ? `<a class="btn-primary" href="${esc(extUrl)}" target="_blank" rel="noopener noreferrer">Ir al sitio original ↗</a>
               <button type="button" class="btn-ghost" id="toggle-frame" aria-expanded="false">Previsualizar sitio aquí</button>`
            : ""
        }
        <a class="${extUrl ? "btn-ghost" : "btn-primary"}" href="${hnUrl}" target="_blank" rel="noopener noreferrer">Ver en Hacker News ↗</a>
      </div>
      ${textHtml ? `<div class="story-text tx">${textHtml}</div>` : ""}
      ${extUrl ? `<div id="frame-slot" class="story-frame-wrap" hidden></div>` : ""}
    </article>`;
  };

  /**
   * Conecta el botón de previsualización web embebida dentro de la ventana deslizante.
   * @param {string} extUrl
   */
  const bindFrameToggle = extUrl => {
    const btn = $("toggle-frame");
    const slot = $("frame-slot");
    if (!btn || !slot || !extUrl) return;
    btn.onclick = () => {
      const open = slot.hidden;
      slot.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Ocultar previsualización" : "Previsualizar sitio aquí";
      if (open && !slot.firstChild) {
        slot.innerHTML = `<iframe class="story-frame" src="${esc(extUrl)}" title="${esc("Previsualización de " + host(extUrl))}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" loading="lazy" referrerpolicy="no-referrer"></iframe>
          <p class="frame-note">Nota: algunos sitios bloquean su carga dentro de marcos embebidos por seguridad; si ves el recuadro vacío, usá «Ir al sitio original ↗».</p>`;
      }
    };
  };

  /**
   * Abre la ventana deslizante con el detalle de la noticia y carga su árbol de comentarios.
   * @param {number} id
   */
  async function openItem(id) {
    if (dlgCtrl) dlgCtrl.abort();
    const ctrl = new AbortController();
    dlgCtrl = ctrl;
    const token = ++dlgToken;
    const known = storyMap.get(id);

    if (known) {
      body.innerHTML = `${renderStoryShell(known)}<section id="dlg-comments" class="comments-sec"><p>Cargando comentarios…</p></section>`;
      bindFrameToggle(safeUrl(known.url));
    } else {
      body.innerHTML = `<section id="dlg-comments"><p>Cargando noticia y comentarios…</p></section>`;
    }

    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    if (location.hash !== `#/item/${id}`) {
      history.pushState(null, "", `#/item/${id}`);
    }
    markRead(id);

    try {
      const it = await j(ALG + "items/" + id, ctrl.signal);
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
      const textHtml = it.text ? clean(it.text) : "";

      if (!known) {
        body.innerHTML = `${renderStoryShell(merged, textHtml)}<section id="dlg-comments" class="comments-sec"></section>`;
        bindFrameToggle(safeUrl(merged.url));
      } else if (textHtml) {
        const view = body.querySelector(".story-view");
        if (view && !view.querySelector(".story-text")) {
          const slot = $("frame-slot");
          const html = `<div class="story-text tx">${textHtml}</div>`;
          if (slot) slot.insertAdjacentHTML("beforebegin", html);
          else view.insertAdjacentHTML("beforeend", html);
        }
      }

      const kids = (it.children || []).map(c => comment(c)).join("");
      $("dlg-comments").innerHTML =
        `<h3>${countC(it)} comentarios</h3>${kids || "<p>Todavía no hay comentarios.</p>"}`;
    } catch (e) {
      if (e.name === "AbortError" || token !== dlgToken) return;
      const target = $("dlg-comments") || body;
      target.innerHTML =
        '<p class="err">No se pudieron cargar los comentarios. <button type="button" id="rc">Reintentar</button></p>';
      $("rc").onclick = () => openItem(id);
    }
  }

  /**
   * Sincroniza la apertura o cierre del panel deslizante según el hash actual de la URL.
   */
  const syncHash = () => {
    const m = location.hash.match(/^#\/item\/(\d+)/);
    if (m) {
      openItem(+m[1]);
    } else if (dlg.open) {
      dlg.close();
    }
  };

  list.onclick = e => {
    const link = e.target.closest("a.t");
    if (link) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
    }
    const cardEl = e.target.closest(".s");
    if (cardEl) openItem(+cardEl.dataset.id);
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
  module.exports = { esc, ago, host, safeUrl, normF, normA, comment, countC, clean };
}
