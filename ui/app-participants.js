// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function rows(h) {
    const { doc, UI, avatar, meAvatarData, vendorLoggedOut, troubleHtml, shownStatus, isSelected, wakeWord, patchLifeRing, STATUS_LABEL, STATUS_TONE } = h;
    return {
      key: "id",
      id: (p) => p.id,
      make: () => doc.createElement("li"),
      fill: (li, p, _at, fresh) => {
        const selected = isSelected(p);
        const asleep = p.kind === "agent" && (p.status === "offline" || p.status === "left");
        const mutedStartup = p.status === "offline" && p.muted && p.startupSkipped === "muted";
        const unstaffed = p.kind === "agent" && p.status === "unstaffed";
        const shown = shownStatus(p);
        const className = (p.kind === "human" ? "me" : "") + (selected ? " selected" : "") + (asleep ? " offline" : "") + (unstaffed ? " unstaffed" : "");
        const subHtml = p.kind === "human" ? "you, the human" : [p.tagline ? `<span class="p-vibe">${esc(p.tagline)}</span>` : "", esc([p.agentVendor || p.agentLabel, p.model].filter(Boolean).join(" · "))].filter(Boolean).join(" · ");
        const working = p.kind === "agent" && (p.status === "thinking" || p.status === "queued");
        const troubled = p.kind === "agent" && !working && p.trouble && (p.status === "error" || p.trouble.stage === "turn" || (p.trouble.actions && p.trouble.actions.length > 0));
        const unplugged = vendorLoggedOut(p);
        const loginRow = unplugged && p.status === "offline" && !troubled ? `<div class="p-fix">${UI.html("button", { label: "Log in", kind: "primary", size: "xs", act: "open-login-dialog", icon: "lock", title: `${p.agentVendor || "The vendor"} is not logged in: log in, and ${p.name} comes back`, data: { recipe: p.agentType, purpose: "login" } })}</div>` : "";
        const warn = mutedStartup ? `<div class="p-warn muted-start" title="Unmute and wake it up when you want this vibemate to return">${esc(p.statusDetail || "Not summoned — muted")}</div>` : p.status === "offline" && p.asleep ? `<div class="p-warn muted-start" title="Wake it up when you want it back">${esc(p.statusDetail || "Asleep")}</div>` : troubled ? troubleHtml(p) : working ? "" : p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<div class="p-warn" title="${esc(p.statusDetail)}">${esc(p.statusDetail)}</div>${loginRow}` : loginRow;
        const status = unstaffed
          ? UI.html("badge", { label: "summon", tone: "attention", title: "Click to summon this vibemate: pick the coding agent that runs it" })
          : asleep
          ? `<span class="zzz" title="${esc(STATUS_LABEL[p.status] || p.status)}">zzz</span>`
          : p.kind === "agent" && p.status !== "idle" ? UI.html("badge", { label: STATUS_LABEL[shown] || shown, tone: STATUS_TONE[shown] || "plain", dot: p.status === "thinking" }) : "";
        const avatarHtml = avatar(p.kind === "human" ? meAvatarData() : p, 44, { vendor: true, muted: p.muted, unplugged, me: p.kind === "human", alert: p.kind === "agent" && (p.status === "error" || (p.status === "offline" && !!(p.trouble && p.trouble.actions && p.trouble.actions.length))), dim: unstaffed ? "unstaffed" : asleep ? "asleep" : undefined });
        const statusValue = p.kind === "agent" ? (shown === "working" ? "writing" : shown) || "idle" : "";
        const bodyHtml = `<div class="p-body">
            <div class="p-name"><span>${esc(p.name)}</span>${p.muted ? UI.html("badge", { label: "muted", tone: "muted" }) : ""}${status}</div>
            <div class="p-sub">${subHtml}</div>
            ${p.kind === "agent" && p.folderPending ? '<div class="p-folder-pending" title="Restart this vibemate to use the room’s selected folder">Folder change · restart pending</div>' : ""}
            ${warn}
          </div>
          <div class="p-actions">
            ${p.kind === "agent" && p.status === "offline" && !unplugged ? UI.html("row-button", { icon: wakeWord(p) === "Wake up" ? "sun" : "refresh", title: wakeWord(p) === "Wake up" ? `Wake ${p.name} up` : `Reconnect ${p.name}: it fell`, act: "wake" }) : ""}
          </div>`;
        if (fresh) {
          li.innerHTML = avatarHtml + bodyHtml + (p.kind === "agent" ? UI.html("row-button", { icon: "settings", title: `Open ${p.name}'s panel`, act: "panel" }) + UI.html("row-button", { icon: "go-to-message", title: `Go to ${p.name}'s last reply`, act: "last-reply" }) : "");
          li.dataset.avatar = avatarHtml;
          if (statusValue) li.querySelector(".avatar").insertAdjacentHTML("beforeend", `<span class="status" data-status="${esc(statusValue)}"></span>`);
          li.dataset.body = bodyHtml;
        } else {
          if (li.dataset.avatar !== avatarHtml) {
            li.querySelector(".avatar").outerHTML = avatarHtml;
            li.dataset.avatar = avatarHtml;
          }
          const dot = li.querySelector(".avatar .status");
          if (statusValue && dot && dot.dataset.status !== statusValue) dot.dataset.status = statusValue;
          else if (statusValue && !dot) li.querySelector(".avatar").insertAdjacentHTML("beforeend", `<span class="status" data-status="${esc(statusValue)}"></span>`);
          if (li.dataset.body !== bodyHtml) {
            li.querySelectorAll(".p-body, .p-actions").forEach((el) => el.remove());
            li.insertAdjacentHTML("beforeend", bodyHtml);
            li.dataset.body = bodyHtml;
          }
        }
        if (li.className !== className) li.className = className;
        if (p.kind === "agent" && !unstaffed) patchLifeRing(li, p);
      },
    };
  }

  function patch(meList, list, participants, spec, keyed = root.KeyedList) {
    keyed.patch(meList, participants.filter((p) => p.kind === "human"), spec);
    keyed.patch(list, participants.filter((p) => p.kind === "agent"), spec);
  }
  root.VIBEROOM_PARTICIPANTS = Object.freeze({ rows, patch });
})(typeof window !== "undefined" ? window : globalThis);
