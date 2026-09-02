// ======================================================
// EXTRACTOR CUALITATIVO V4 — VERSIÓN PARA AUTOMATIZACIÓN (PLAYWRIGHT)
// Misma lógica de detección/limpieza que EXTRACTOR_CUALITATIVO_V4_PARA_CONVERSACIONES_CHATGPT.js
// Único cambio: en vez de generar y descargar un .json, expone
// window.__extractConversation() como función async que RETORNA
// el objeto de salida (o {error, stack} si algo falla), para que
// Playwright lo recoja con page.evaluate().
// ======================================================

window.__extractConversation = async function () {
  const CONFIG = {
    include_html: false,
    include_raw_html_for_audit: false,
    assistant_context_mode: "between_user_turns",
    remove_interface_noise: true,
    remove_download_lines: true,
    remove_citation_pills: true,
    scroll: {
      enabled: true,
      step_ratio: 0.35,
      wait_after_step_ms: 320,
      settle_wait_ms: 550,
      max_iterations: 900,
      stable_rounds_to_stop: 4
    },
    verbose_diagnostics: true
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeWhitespace(text) {
    return String(text || "")
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function uniqueBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const key = keyFn(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function simpleHash(str) {
    let hash = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  async function expandCollapsedUserMessages() {
    const buttons = Array.from(document.querySelectorAll("button"));
    const expandButtons = buttons.filter(btn => {
      const text = normalizeWhitespace(btn.innerText).toLowerCase();
      const expanded = btn.getAttribute("aria-expanded");
      return (
        expanded === "false" &&
        (text.includes("ver más") || text.includes("mostrar más") || text.includes("show more"))
      );
    });
    for (const btn of expandButtons) {
      try {
        btn.click();
        await sleep(80);
      } catch {}
    }
    return expandButtons.length;
  }

  function getMessageElements() {
    const rawByRole = Array.from(document.querySelectorAll("[data-message-author-role]"));
    const byRole = rawByRole.filter(el => {
      let parent = el.parentElement;
      while (parent) {
        if (parent.matches && parent.matches("[data-message-author-role]")) return false;
        parent = parent.parentElement;
      }
      return true;
    });
    if (byRole.length) return { method: "data-message-author-role", elements: byRole };

    const articles = Array.from(document.querySelectorAll("article"));
    if (articles.length) return { method: "article-fallback", elements: articles };

    const turnTestIds = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"]'));
    if (turnTestIds.length) return { method: "conversation-turn-testid-fallback", elements: turnTestIds };

    return { method: "main-fallback", elements: [document.querySelector("main") || document.body] };
  }

  function detectRole(el) {
    const attr = el.getAttribute("data-message-author-role") || el.dataset?.messageAuthorRole || "";
    if (attr === "user") return "user";
    if (attr === "assistant") return "assistant";
    if (attr === "tool" || attr === "system") return "assistant";

    const nested = el.querySelector && el.querySelector("[data-message-author-role]");
    if (nested) {
      const nestedAttr = nested.getAttribute("data-message-author-role");
      if (nestedAttr === "user") return "user";
      if (nestedAttr === "assistant") return "assistant";
    }

    const txt = normalizeWhitespace(el.innerText).toLowerCase();
    if (txt.startsWith("you said:")) return "user";
    if (txt.startsWith("chatgpt said:")) return "assistant";
    if (txt.startsWith("tú dijiste:")) return "user";
    if (txt.startsWith("tu dijiste:")) return "user";
    if (txt.startsWith("dijiste:")) return "user";
    if (txt.startsWith("chatgpt dijo:")) return "assistant";
    if (txt.startsWith("chatgpt ha dicho:")) return "assistant";

    return "unknown";
  }

  function roleLabel(role) {
    if (role === "user") return "Usuario";
    if (role === "assistant") return "Asistente";
    return "Desconocido";
  }

  function getMessageKey(el, roleGuess, turnPositionIndex) {
    const directId = el.getAttribute("data-message-id");
    if (directId) return `id:${directId}`;
    const nestedWithId = el.querySelector && el.querySelector("[data-message-id]");
    if (nestedWithId) {
      const nid = nestedWithId.getAttribute("data-message-id");
      if (nid) return `id:${nid}`;
    }
    // Prioriza el número de posición de ChatGPT (conversation-turn-N)
    // ANTES que un hash de contenido: ese número identifica el mismo
    // turno sin importar si su texto todavía se está escribiendo o ya
    // terminó, así que capturas sucesivas del mismo turno (con texto
    // parcial y luego completo) caen bajo la MISMA llave y se
    // fusionan correctamente en vez de crear entradas separadas.
    if (turnPositionIndex !== null && turnPositionIndex !== undefined) {
      return `turnpos:${turnPositionIndex}`;
    }
    const testId = el.getAttribute("data-testid");
    if (testId) return `testid:${testId}`;
    const txt = normalizeWhitespace(el.innerText);
    const snippet = `${roleGuess}|${txt.slice(0, 80)}|${txt.slice(-80)}|${txt.length}`;
    return `hash:${simpleHash(snippet)}`;
  }

  // ------------------------------------------------------------
  // NUEVO: ChatGPT envuelve cada turno en un contenedor con
  // data-testid="conversation-turn-N", donde N es un número de
  // posición que ChatGPT mismo asigna de forma secuencial y estable
  // (nunca se salta ni se repite). Usamos ese número como fuente de
  // verdad del ORDEN real de la conversación, en vez de confiar en
  // "el orden en que lo descubrimos mientras hacíamos scroll" — que
  // puede desincronizarse por la virtualización del DOM (reciclado
  // de nodos) y desplazar contenido entre turnos.
  // ------------------------------------------------------------
  function getConversationTurnIndex(el) {
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      if (node.getAttribute) {
        const testId = node.getAttribute("data-testid");
        if (testId) {
          const match = testId.match(/conversation-turn-(\d+)/);
          if (match) return parseInt(match[1], 10);
        }
      }
      node = node.parentElement;
    }
    if (el.querySelector) {
      const nested = el.querySelector('[data-testid^="conversation-turn-"]');
      if (nested) {
        const match = nested.getAttribute("data-testid").match(/conversation-turn-(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }
    return null;
  }

  // NUEVO: guarda contra capturar texto A MEDIO RENDERIZAR (típico en
  // turnos cortos, que terminan de pintarse casi instantáneo pero a
  // veces alcanzamos a leerlos en el frame anterior). Lee el texto,
  // espera un poco, vuelve a leer; si cambió, reintenta unas veces
  // más antes de aceptarlo como definitivo.
  async function readStableText(el, maxRetries = 6, waitMs = 180) {
    let previous = normalizeWhitespace(el.innerText);
    for (let i = 0; i < maxRetries; i++) {
      await sleep(waitMs);
      const current = normalizeWhitespace(el.innerText);
      if (current === previous && current.length > 0) return current;
      previous = current;
    }
    return previous;
  }

  function findScrollContainer(sampleMessageEl) {
    let node = sampleMessageEl ? sampleMessageEl.parentElement : null;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      const canScroll = (overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 10;
      if (canScroll) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function extractAttachments(el) {
    const candidates = Array.from(
      el.querySelectorAll(
        '[role="group"][aria-label], button[aria-label], [data-testid*="attachment"], [data-testid*="file"], a[href*="/files/"], a[href*="/backend-api/estuary"]'
      )
    );
    const files = [];
    for (const node of candidates) {
      const ariaName = normalizeWhitespace(node.getAttribute("aria-label") || "");
      const textName = normalizeWhitespace(node.innerText || "");
      const name = ariaName || textName;
      if (!name) continue;
      const looksLikeFile =
        /\.(docx|doc|pptx|ppt|xlsx|xls|csv|json|pdf|txt|md|zip|png|jpg|jpeg|webp|gif)$/i.test(name) ||
        /\b(hoja de cálculo|spreadsheet|presentación|presentation|documento|document|imagen|image|archivo|file)\b/i.test(name);
      if (!looksLikeFile) continue;
      const lines = normalizeWhitespace(node.innerText).split("\n").map(x => x.trim()).filter(Boolean);
      const nameLine = lines.find(l => /\.[a-z0-9]{2,5}$/i.test(l)) || name;
      const typeLine = lines.find(line => line !== nameLine) || null;
      files.push({ name: nameLine, type: typeLine, source: "dom_file_tile" });
    }
    return uniqueBy(files, f => f.name);
  }

  function extractFilesMentioned(text) {
    const pattern = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _.,()\-]+?\.(docx|doc|pptx|ppt|xlsx|xls|csv|json|pdf|txt|md|zip|png|jpg|jpeg|webp)\b/gi;
    const matches = String(text || "").match(pattern) || [];
    return uniqueBy(matches.map(m => ({ name: normalizeWhitespace(m), source: "text_regex" })), f => f.name);
  }

  function extractLinks(el) {
    const links = Array.from(el.querySelectorAll("a[href]"))
      .map(a => ({ text: normalizeWhitespace(a.innerText), href: a.href }))
      .filter(l => l.href);
    return uniqueBy(links, l => l.href);
  }

  function removeNoiseNodes(clone) {
    const selectorsToRemove = [
      "script", "style", "svg", "button",
      "[data-testid='webpage-citation-pill']",
      "[data-testid*='writing-block-header']",
      "[data-testid*='composer']",
      "[aria-label='Copiar']", "[aria-label='Copy']", "[aria-label='Abrir editor']"
    ];
    for (const selector of selectorsToRemove) {
      clone.querySelectorAll(selector).forEach(n => n.remove());
    }
    return clone;
  }

  function extractBestText(el, role) {
    if (role === "user") {
      const collapsible = el.querySelector("[data-testid='collapsible-user-message-content']");
      if (collapsible) return normalizeWhitespace(collapsible.innerText);
      const userText = el.querySelector(".whitespace-pre-wrap");
      if (userText) return normalizeWhitespace(userText.innerText);
    }
    if (role === "assistant") {
      const markdown = el.querySelector(".markdown");
      if (markdown) {
        const clone = markdown.cloneNode(true);
        removeNoiseNodes(clone);
        return normalizeWhitespace(clone.innerText);
      }
    }
    const clone = el.cloneNode(true);
    removeNoiseNodes(clone);
    return normalizeWhitespace(clone.innerText);
  }

  // ------------------------------------------------------------
  // NUEVO: captura la estructura real del DOM (párrafos, listas con
  // viñetas, listas numeradas, tablas) en vez de aplanar todo a texto
  // plano con innerText. Se usa además de text_clean (no la reemplaza),
  // para poder reconstruir listas/tablas reales en el Doc de salida.
  // ------------------------------------------------------------
  function getContentContainer(el, role) {
    if (role === "assistant") {
      const markdown = el.querySelector(".markdown");
      if (markdown) return markdown;
    }
    if (role === "user") {
      const collapsible = el.querySelector("[data-testid='collapsible-user-message-content']");
      if (collapsible) return collapsible;
      const userText = el.querySelector(".whitespace-pre-wrap");
      if (userText) return userText;
    }
    return null;
  }

  function extractContentBlocks(containerEl) {
    if (!containerEl) return null;

    const clone = containerEl.cloneNode(true);
    removeNoiseNodes(clone);

    const blocks = [];
    const blockTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);

    function cleanItemText(text) {
      const cleaned = cleanText(text, [], []);
      return cleaned;
    }

    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = normalizeWhitespace(node.textContent);
        if (text) blocks.push({ type: "paragraph", text: cleanItemText(text) });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      if (tag === "ul" || tag === "ol") {
        const items = Array.from(node.querySelectorAll(":scope > li"))
          .map(li => cleanItemText(normalizeWhitespace(li.innerText)))
          .filter(Boolean);
        if (items.length) {
          blocks.push({ type: tag === "ol" ? "ordered_list" : "bulleted_list", items });
        }
        return;
      }

      if (tag === "table") {
        const rows = Array.from(node.querySelectorAll("tr"))
          .map(tr =>
            Array.from(tr.querySelectorAll("th,td"))
              .map(cell => normalizeWhitespace(cell.innerText))
              .join(" | ")
          )
          .filter(Boolean);
        if (rows.length) blocks.push({ type: "table", rows });
        return;
      }

      if (blockTags.has(tag)) {
        const text = normalizeWhitespace(node.innerText);
        if (text) blocks.push({ type: "paragraph", text: cleanItemText(text) });
        return;
      }

      // Contenedor genérico (div, span, etc.): recorre sus hijos.
      if (node.childNodes && node.childNodes.length) {
        Array.from(node.childNodes).forEach(walk);
      } else {
        const text = normalizeWhitespace(node.innerText || node.textContent || "");
        if (text) blocks.push({ type: "paragraph", text: cleanItemText(text) });
      }
    }

    Array.from(clone.childNodes).forEach(walk);

    // Fusiona bloques de tipo "table" consecutivos en uno solo (rara vez
    // aplica, pero evita fragmentar una misma tabla si el DOM la parte).
    const merged = [];
    for (const block of blocks) {
      const prev = merged[merged.length - 1];
      if (prev && prev.type === "table" && block.type === "table") {
        prev.rows.push(...block.rows);
      } else {
        merged.push(block);
      }
    }

    return merged.length ? merged : null;
  }

  function cleanText(text, attachments = [], filesMentioned = []) {
    let cleaned = normalizeWhitespace(text);
    const exactNoise = new Set([
      "Ver más", "Mostrar menos", "Mostrar más", "Show more", "Show less",
      "Editar", "Edit", "Copiar", "Copy", "Abrir editor",
      "Hoja de cálculo", "Presentación", "Documento", "PDF", "Imagen", "Archivo",
      "PMC", "PubMed Central", "International Diabetes Federation", "diabetesjournals.org",
      "+1", "+2", "+3"
    ]);
    const fileNames = [...attachments.map(a => a.name), ...filesMentioned.map(f => f.name)].filter(Boolean);
    const lines = cleaned.split("\n").map(line => line.trim()).filter(line => {
      if (!line) return false;
      if (CONFIG.remove_interface_noise && exactNoise.has(line)) return false;
      if (/^\+\d+$/.test(line)) return false;
      if (CONFIG.remove_download_lines && /^descargar\b/i.test(line)) return false;
      if (fileNames.includes(line)) return false;
      return true;
    });
    cleaned = lines.join("\n");
    cleaned = cleaned
      .replace(/\bVer más\b/g, "")
      .replace(/\bMostrar menos\b/g, "")
      .replace(/\bShow more\b/g, "")
      .replace(/\bShow less\b/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return cleaned;
  }

  async function processMessageElement(el, orderHint, turnPositionIndex) {
    const role = detectRole(el);
    const domTurnIndex = turnPositionIndex !== undefined ? turnPositionIndex : getConversationTurnIndex(el);

    // Espera a que el texto se estabilice antes de leerlo, para no
    // capturar contenido a medio renderizar (el disparador típico
    // del bug de turnos cortos que aparecen y desaparecen rápido).
    await readStableText(el);

    const rawText = normalizeWhitespace(el.innerText);
    const attachments = extractAttachments(el);
    const filesMentioned = extractFilesMentioned(rawText);
    const links = extractLinks(el);
    const selectedText = extractBestText(el, role);
    const clean = cleanText(selectedText || rawText, attachments, filesMentioned);

    const contentContainer = getContentContainer(el, role);
    const contentBlocks = extractContentBlocks(contentContainer);

    return {
      order_hint: orderHint,
      dom_turn_index: domTurnIndex,
      role,
      role_label: roleLabel(role),
      text_raw: rawText,
      text_selected: selectedText,
      text_clean: clean,
      content_blocks: contentBlocks,
      attachments,
      files_mentioned: filesMentioned,
      links,
      char_count_clean: clean.length,
      word_count_clean: clean ? clean.split(/\s+/).length : 0
    };
  }

  async function collectAllTurnsWithScroll() {
    const collected = new Map();
    let orderCounter = 0;
    let scrollContainer = null;
    let method = null;

    async function captureCurrentlyVisible() {
      const detection = getMessageElements();
      method = detection.method;
      for (const el of detection.elements) {
        const roleGuess = detectRole(el);
        const turnPositionIndex = getConversationTurnIndex(el);
        const key = getMessageKey(el, roleGuess, turnPositionIndex);
        if (!collected.has(key)) {
          const turn = await processMessageElement(el, orderCounter++, turnPositionIndex);
          collected.set(key, turn);
        } else {
          const existing = collected.get(key);
          const fresh = await processMessageElement(el, existing.order_hint, turnPositionIndex);
          if (fresh.text_clean && fresh.text_clean.length > existing.text_clean.length) {
            collected.set(key, fresh);
          }
        }
      }
      return detection.elements.length;
    }

    if (!CONFIG.scroll.enabled) {
      await captureCurrentlyVisible();
      return { turns: orderedTurns(collected), method, scrollPasses: 1 };
    }

    const anyElement = getMessageElements().elements[0];
    scrollContainer = findScrollContainer(anyElement);

    scrollContainer.scrollTop = 0;
    await sleep(CONFIG.scroll.settle_wait_ms);
    await captureCurrentlyVisible();

    let stableRounds = 0;
    let iterations = 0;
    let lastSize = collected.size;

    while (iterations < CONFIG.scroll.max_iterations) {
      iterations++;
      const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 4;

      if (atBottom) {
        await sleep(CONFIG.scroll.settle_wait_ms);
        await captureCurrentlyVisible();
        if (collected.size === lastSize) {
          stableRounds++;
        } else {
          stableRounds = 0;
          lastSize = collected.size;
        }
        if (stableRounds >= CONFIG.scroll.stable_rounds_to_stop) break;
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        continue;
      }

      const step = scrollContainer.clientHeight * CONFIG.scroll.step_ratio;
      scrollContainer.scrollTop = Math.min(scrollContainer.scrollTop + step, scrollContainer.scrollHeight);
      await sleep(CONFIG.scroll.wait_after_step_ms);
      await captureCurrentlyVisible();

      if (collected.size === lastSize) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastSize = collected.size;
      }
    }

    scrollContainer.scrollTop = 0;
    await sleep(CONFIG.scroll.settle_wait_ms);
    await captureCurrentlyVisible();

    return { turns: orderedTurns(collected), method, scrollPasses: iterations, uniqueKeysFound: collected.size };
  }

  function orderedTurns(collectedMap) {
    const turns = Array.from(collectedMap.values());
    // Prioriza el número real de turno que ChatGPT asigna
    // (data-testid="conversation-turn-N") sobre nuestro propio orden
    // de descubrimiento durante el scroll — es la fuente de verdad
    // real del orden cuando está disponible, y evita que la
    // virtualización del DOM desplace contenido entre turnos.
    const allHaveDomIndex = turns.every(t => t.dom_turn_index !== null && t.dom_turn_index !== undefined);
    if (allHaveDomIndex) {
      return turns.sort((a, b) => a.dom_turn_index - b.dom_turn_index);
    }
    return turns.sort((a, b) => {
      if (a.dom_turn_index !== null && b.dom_turn_index !== null &&
          a.dom_turn_index !== undefined && b.dom_turn_index !== undefined) {
        return a.dom_turn_index - b.dom_turn_index;
      }
      return a.order_hint - b.order_hint;
    });
  }

  function previousUserIndex(turns, currentIndex) {
    for (let i = currentIndex - 1; i >= 0; i--) if (turns[i].role === "user") return i;
    return -1;
  }
  function nextUserIndex(turns, currentIndex) {
    for (let i = currentIndex + 1; i < turns.length; i++) if (turns[i].role === "user") return i;
    return turns.length;
  }
  function assistantContextBefore(turns, currentIndex) {
    const prevUser = previousUserIndex(turns, currentIndex);
    return turns.slice(prevUser + 1, currentIndex).filter(t => t.role === "assistant").map(t => ({
      turn_id: t.turn_id, turn_index: t.turn_index, text_clean: t.text_clean, files_mentioned: t.files_mentioned, links: t.links
    }));
  }
  function assistantContextAfter(turns, currentIndex) {
    const nextUser = nextUserIndex(turns, currentIndex);
    return turns.slice(currentIndex + 1, nextUser).filter(t => t.role === "assistant").map(t => ({
      turn_id: t.turn_id, turn_index: t.turn_index, text_clean: t.text_clean, files_mentioned: t.files_mentioned, links: t.links
    }));
  }
  function classifyPosition(userSeq, totalUserTurns) {
    if (userSeq === 1) return "inicio";
    if (userSeq === totalUserTurns) return "cierre";
    return "intermedio";
  }

  function buildAnalysisUnits(turns) {
    const userTurns = turns.filter(t => t.role === "user");
    const totalUserTurns = userTurns.length;
    let userSeq = 0;

    return turns
      .map((turn, absoluteIndex) => ({ turn, absoluteIndex }))
      .filter(item => item.turn.role === "user")
      .map(item => {
        userSeq += 1;
        const before = assistantContextBefore(turns, item.absoluteIndex);
        const after = assistantContextAfter(turns, item.absoluteIndex);
        return {
          unit_id: `U${String(userSeq).padStart(4, "0")}`,
          unit_type: "user_turn",
          user_turn_sequence: userSeq,
          conversation_position: classifyPosition(userSeq, totalUserTurns),
          source_turn: {
            turn_id: item.turn.turn_id,
            turn_index: item.turn.turn_index,
            text_raw: item.turn.text_raw,
            text_clean: item.turn.text_clean,
            attachments: item.turn.attachments,
            files_mentioned: item.turn.files_mentioned,
            links: item.turn.links
          },
          assistant_context_before: before,
          assistant_response_after: after,
          immediate_context: {
            previous_assistant_turn_id: before.length ? before[before.length - 1].turn_id : null,
            next_assistant_turn_id: after.length ? after[0].turn_id : null
          },
          coding_template: {
            fase_autorregulacion: null,
            proceso_cognitivo_observable: null,
            indicador_discursivo: null,
            evidencia_textual_usuario: null,
            uso_del_contexto_del_agente: null,
            interpretacion_analitica: null,
            confianza_codificacion: null,
            requiere_revision: null,
            notas_codificador: null
          }
        };
      });
  }

  function extractPageMetadata() {
    function metaContent(selector) {
      const node = document.querySelector(selector);
      return node ? normalizeWhitespace(node.getAttribute("content")) : null;
    }
    const ogTitle = metaContent('meta[property="og:title"]');
    const description = metaContent('meta[name="description"]') || metaContent('meta[property="og:description"]');
    const h1 = document.querySelector("h1");
    const genericSharePlaceholder = /^(mira este chat|look at this chat|check out this( chatgpt)? conversation|compartir chat|shared conversation)\b/i;
    const docTitleClean = document.title.replace(/^ChatGPT\s*-\s*/i, "").trim();
    const h1Clean = h1 ? normalizeWhitespace(h1.innerText) : null;

    let conversationTitle = null;
    if (docTitleClean && !genericSharePlaceholder.test(docTitleClean)) {
      conversationTitle = docTitleClean;
    } else if (h1Clean && !genericSharePlaceholder.test(h1Clean)) {
      conversationTitle = h1Clean;
    } else if (ogTitle && !genericSharePlaceholder.test(ogTitle)) {
      conversationTitle = ogTitle.replace(/^ChatGPT\s*-\s*/i, "").trim() || ogTitle;
    } else {
      conversationTitle = docTitleClean || h1Clean || ogTitle || null;
    }

    return { conversation_title: conversationTitle || null, page_description: description || null, og_title_raw: ogTitle || null };
  }

  function buildQualityReport(turnsWithIds, analysisUnits, extractionMethod, expandedCount, scrollInfo) {
    const countByRole = turnsWithIds.reduce((acc, t) => {
      acc[t.role] = (acc[t.role] || 0) + 1;
      return acc;
    }, {});
    const emptyCleanTurns = turnsWithIds.filter(t => !t.text_clean).map(t => t.turn_id);
    const userTurnsWithAttachments = turnsWithIds
      .filter(t => t.role === "user" && t.attachments.length)
      .map(t => ({ turn_id: t.turn_id, attachments: t.attachments }));

    return {
      extraction_method: extractionMethod,
      expanded_collapsed_messages: expandedCount,
      scroll_enabled: CONFIG.scroll.enabled,
      scroll_passes: scrollInfo.scrollPasses,
      unique_message_keys_found: scrollInfo.uniqueKeysFound ?? turnsWithIds.length,
      total_turns: turnsWithIds.length,
      total_analysis_units_user_turns: analysisUnits.length,
      count_by_role: countByRole,
      empty_clean_turns: emptyCleanTurns,
      user_turns_with_attachments: userTurnsWithAttachments,
      warnings: [
        extractionMethod === "main-fallback" ? "No se detectaron contenedores de mensajes; la segmentación puede ser poco confiable." : null,
        countByRole.unknown ? "Hay turnos con rol desconocido; revisar manualmente (posible cambio de estructura en la página)." : null,
        emptyCleanTurns.length ? "Hay turnos sin texto limpio; pueden ser mensajes solo con adjuntos o un problema de selector." : null
      ].filter(Boolean)
    };
  }

  // ======================================================
  // PROCESO PRINCIPAL — retorna el objeto en vez de descargarlo
  // ======================================================
  try {
    const expandedCount = await expandCollapsedUserMessages();
    await sleep(200);

    const { turns: rawTurns, method, scrollPasses, uniqueKeysFound } = await collectAllTurnsWithScroll();

    const filteredTurns = rawTurns.filter(t => t.text_clean || t.attachments.length || t.files_mentioned.length || t.links.length);

    const turns = filteredTurns.map((t, index) => ({
      turn_index: index + 1,
      turn_id: `T${String(index + 1).padStart(4, "0")}`,
      ...t
    }));
    turns.forEach(t => delete t.order_hint);

    const analysisUnits = buildAnalysisUnits(turns);
    const pageMetadata = extractPageMetadata();

    const conversationId =
      location.pathname.split("/").filter(Boolean).pop()?.replace(/[^a-zA-Z0-9_-]/g, "_") || "sin_id";

    const scrollInfo = { scrollPasses, uniqueKeysFound };

    const output = {
      export_metadata: {
        exported_at: new Date().toISOString(),
        source_url: location.href,
        page_title: document.title,
        conversation_title: pageMetadata.conversation_title,
        page_description: pageMetadata.page_description,
        extractor_name: "chatgpt_qualitative_dom_extractor",
        extractor_version: "4.0-playwright",
        note: "Extracción desde el DOM visible, con scroll incremental para superar la virtualización de mensajes."
      },
      qualitative_design: {
        unit_of_analysis: "turno_del_usuario",
        agent_role: "contexto_conversacional",
        recommended_use: "Codificar procesos cognitivos o autorregulatorios en los turnos del usuario usando las respuestas del agente como contexto."
      },
      conversation_metadata: {
        conversation_id: conversationId,
        total_turns: turns.length,
        total_user_turns: turns.filter(t => t.role === "user").length,
        total_assistant_turns: turns.filter(t => t.role === "assistant").length
      },
      quality_report: buildQualityReport(turns, analysisUnits, method, expandedCount, scrollInfo),
      turns,
      analysis_units: analysisUnits
    };

    return output;
  } catch (error) {
    return { error: String(error && error.message ? error.message : error), stack: error && error.stack ? error.stack : null };
  }
};

// Señal de que la función quedó lista para que Playwright la invoque.
"extractor_ready";
