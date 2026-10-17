(function (root) {
  "use strict";

  const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function resolveUrl(value, base) {
    if (/[\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value, base);
      const baseUrl = new URL(base);
      const bundledAsset = baseUrl.protocol === "tauri:" && url.protocol === "tauri:" && url.host === baseUrl.host;
      return ["http:", "https:"].includes(url.protocol) || bundledAsset ? url.href : null;
    } catch (_) { return null; }
  }

  function inline(source, base) {
    const tokens = /(`[^`]+`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*)/g;
    let result = "", end = 0;
    for (const token of source.matchAll(tokens)) {
      result += escape(source.slice(end, token.index));
      if (token[0].startsWith("`")) result += `<code>${escape(token[0].slice(1, -1))}</code>`;
      else if (token[0].startsWith("**")) result += `<strong>${escape(token[6])}</strong>`;
      else {
        const isImage = token[2] !== undefined;
        const href = resolveUrl(isImage ? token[3] : token[5], base);
        const label = isImage ? token[2] : token[4];
        if (!href) result += escape(label);
        else if (isImage) result += `<img src="${escape(href)}" alt="${escape(label)}" loading="lazy">`;
        else {
          const url = new URL(href), baseUrl = new URL(base);
          const isLesson = url.origin === baseUrl.origin && url.pathname.startsWith(baseUrl.pathname.slice(0, baseUrl.pathname.lastIndexOf("/") + 1)) && /\.md$/.test(url.pathname);
          if (isLesson) result += `<a href="#${escape(url.pathname.split("/").pop().replace(/\.md$/, ""))}">${escape(label)}</a>`;
          else result += `<a href="${escape(href)}"${url.origin !== baseUrl.origin ? ' target="_blank" rel="noopener noreferrer"' : /\.(?:json|zip)$/.test(url.pathname) ? ' download' : ''}>${escape(label)}</a>`;
        }
      }
      end = token.index + token[0].length;
    }
    return result + escape(source.slice(end));
  }

  function highlight(source, language) {
    if (!["c", "cpp"].includes(language)) return escape(source);
    const tokens = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:if|else|for|while|switch|case|default|break|continue|return|static|const|volatile|void|int|char|unsigned|long|uint\d+_t|int\d+_t|sizeof|typedef|struct)\b|\b(?:0x[0-9a-fA-F]+|\d+)(?:U|UL|L)?\b)/g;
    let html = "", end = 0;
    for (const token of source.matchAll(tokens)) {
      const value = token[0];
      const kind = value.startsWith("/") ? "comment" : /^["']/.test(value) ? "string" : /^\d/.test(value) ? "number" : "keyword";
      html += escape(source.slice(end, token.index)) + `<span class="syntax-${kind}">${escape(value)}</span>`;
      end = token.index + value.length;
    }
    return html + escape(source.slice(end));
  }

  function render(source, base) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const html = [], headings = [];
    const beginsBlock = line => /^(?:#{1,6} |```|\| |!\[|\d+\. |[-*] )/.test(line.trim());
    let i = 0, section = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }
      if (/^# /.test(line)) { i++; continue; }
      const heading = /^(#{2,6}) (.+)$/.exec(line);
      if (heading) {
        const level = heading[1].length, id = `section-${++section}`, text = heading[2];
        headings.push({ level, id, text });
        html.push(`<h${level} id="${id}">${inline(text, base)}</h${level}>`); i++; continue;
      }
      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        const code = [];
        while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
        html.push(`<div class="code-block"><div class="code-header"><span>${escape(lang || "代码")}</span><button type="button" class="copy-code" aria-label="复制这段代码">复制</button></div><pre><code>${highlight(code.join("\n"), lang)}</code></pre></div>`);
        i++; continue;
      }
      if (line.startsWith("|")) {
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          const cells = lines[i++].trim().replace(/^\||\|$/g, "").split("|").map(s => s.trim());
          if (!cells.every(cell => /^:?-+:?$/.test(cell))) rows.push(cells);
        }
        html.push('<div class="table-scroll" role="region" aria-label="参数或测试表" tabindex="0"><table>');
        rows.forEach((row, index) => html.push(`${index === 0 ? '<thead>' : index === 1 ? '<tbody>' : ''}<tr>${row.map(cell => `<${index === 0 ? 'th scope="col"' : 'td'}>${inline(cell, base)}</${index === 0 ? 'th' : 'td'}>`).join("")}</tr>${index === 0 ? '</thead>' : ''}`));
        html.push(`${rows.length > 1 ? '</tbody>' : ''}</table></div>`); continue;
      }
      if (/^!\[/.test(line)) {
        const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line);
        if (image) {
          html.push(`<figure>${inline(line, base)}<figcaption>${escape(image[1])}</figcaption></figure>`);
          i++; continue;
        }
      }
      const ordered = /^\d+\. /.test(line), unordered = /^[-*] /.test(line);
      if (ordered || unordered) {
        const items = [], pattern = ordered ? /^\d+\. (.*)/ : /^[-*] (.*)/;
        while (i < lines.length) {
          const match = pattern.exec(lines[i].trim());
          if (!match) break;
          items.push(`<li>${inline(match[1], base)}</li>`); i++;
        }
        html.push(`<${ordered ? 'ol' : 'ul'}>${items.join("")}</${ordered ? 'ol' : 'ul'}>`); continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !beginsBlock(lines[i])) paragraph.push(lines[i++].trim());
      html.push(`<p>${inline(paragraph.join(" "), base)}</p>`);
    }
    return { html: html.join("\n"), headings };
  }

  const api = { render, escape, resolveUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AliceTutorialMarkdown = api;
})(typeof window !== "undefined" ? window : globalThis);
