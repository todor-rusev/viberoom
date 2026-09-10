// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  const tokens = () => globalThis.VIBEROOM_TOKENS.current.elements.participant;

  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  function shade(hex, amount) {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amount));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amount));
    const b = Math.min(255, Math.max(0, (n & 255) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  function initials(name) {
    const parts = String(name).trim().split(/[\s_-]+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function avatarSvg(name, color, emoji, size) {
    const s = size || 40;
    const c1 = shade(color, 30);
    const c2 = shade(color, -25);
    const id = `g${hash(name + color).toString(36)}`;
    const label = emoji ? emoji : initials(name);
    const fontSize = emoji ? s * 0.55 : s * 0.42;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" role="img" aria-label="${escapeAttr(name)}">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="url(#${id})"/>
  <circle cx="${s / 2}" cy="${s * 0.36}" r="${s * 0.34}" fill="${tokens().avatarGloss}" opacity="0.10"/>
  <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, 'Segoe UI Emoji', sans-serif" font-size="${fontSize}" font-weight="700" fill="${tokens().avatarLabelInk}">${escapeText(label)}</text>
</svg>`;
  }

  function escapeText(value) {
    return String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  }
  function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function avatarHtml(participant, size, options) {
    const opts = options || {};
    const color = participant.color || tokens().avatarDefault;
    const s = size || 40;
    const emoji = participant.avatar;
    const label = emoji ? emoji : initials(participant.name);
    const fontSize = Math.round(emoji ? s * 0.56 : s * 0.38);
    const radius = Math.round(s * 0.32);
    const svg = `<span class="av-tile" role="img" aria-label="${escapeAttr(participant.name)}" style="background:color-mix(in srgb, ${escapeAttr(color)} 16%, ${tokens().avatarBlend});color:${escapeAttr(color)};font-size:${fontSize}px;border-radius:${radius}px">${escapeText(label)}</span>`;
    const status = opts.status ? `<span class="avatar-status status-${escapeAttr(participant.status || "idle")}"></span>` : "";
    let badge = "";
    if (opts.vendor && participant.kind === "agent") {
      const recipe = opts.recipes ? opts.recipes.find((r) => r.id === participant.agentType) : null;
      const letter = escapeText((participant.agentVendor || participant.agentType || "?").slice(0, 1).toUpperCase());
      const title = escapeAttr(participant.agentLabel || participant.agentType || "");
      badge = recipe && recipe.icon
        ? `<span class="avatar-badge" title="${title}"><img src="${escapeAttr(recipe.icon)}" alt="" onerror="this.replaceWith(document.createTextNode('${letter}'))"></span>`
        : `<span class="avatar-badge" title="${title}">${letter}</span>`;
    }
    if (opts.muted && participant.kind === "agent" && window.Icons) badge = `<span class="avatar-badge muted" title="muted: receives no prompts">${window.Icons.svg("mute")}</span>`;
    return `<span class="avatar" style="width:${size}px;height:${size}px">${svg}${badge}${status}</span>`;
  }

  const GALLERY = [
    "🦊", "🐼", "🦉", "🐯", "🐸", "🤖", "👩‍💻", "🧑‍🚀", "🧙", "🐙", "🦄", "🐺", "🧑‍🎨", "🕵️", "🧑‍🔬", "🐝", "🐧", "🦁", "🐨", "👾",
    "🐱", "🐶", "🦝", "🐢", "🐬", "🦋", "🦩", "🐲", "🦖", "🐳", "🦭", "🐹", "🦔", "🐻", "🐮", "🐵",
    "🧑‍🍳", "🧑‍🚒", "🧑‍⚕️", "🧑‍🏫", "🧑‍✈️", "🧛", "🧜", "🧞", "🦸", "🥷", "🤠", "👽", "👻", "🎃",
    "🌙", "⭐", "🔥", "🍀", "🌵", "🌈", "🎧", "🎸", "🚀", "🛸", "🧠", "🎯", "🧩", "💎", "🍕", "☕",
  ];

  const EMOJI_NAMES = {
    "🎭": "theatre masks drama roles", "🚀": "rocket launch ship", "🧪": "test tube experiment lab", "🛠️": "hammer and wrench tools",
    "🎨": "palette art design paint", "📚": "books library docs", "🧠": "brain mind thinking", "💬": "speech bubble chat talk",
    "🔬": "microscope science research", "🎯": "target goal focus aim", "🐙": "octopus github", "☕": "coffee cup break cafe",
    "🌈": "rainbow colors", "🏗️": "construction crane building site", "🎮": "game controller gaming play", "🔥": "fire hot flame",
    "🧩": "puzzle piece", "📈": "chart up growth trending", "🗺️": "world map", "🎧": "headphones audio music",
    "🌱": "seedling plant grow sprout", "🏠": "house home", "🛸": "flying saucer ufo", "🧭": "compass navigate direction",
    "🧑‍💻": "technologist developer coder programmer laptop", "⚒️": "hammer and pick tools forge", "🔨": "hammer build", "🔧": "wrench fix repair",
    "🔩": "nut and bolt hardware", "⚙️": "gear settings cog", "🧰": "toolbox tools kit", "🪛": "screwdriver",
    "🧱": "brick wall", "🏭": "factory plant", "🔌": "electric plug power", "🖥️": "desktop computer monitor screen",
    "💻": "laptop computer", "⌨️": "keyboard typing", "🤖": "robot bot ai", "🐛": "bug insect caterpillar",
    "🐞": "lady beetle ladybug bug", "⚡": "lightning bolt zap fast electric", "🔋": "battery energy charge", "📊": "bar chart data statistics",
    "📉": "chart down decline", "🧮": "abacus math calculate", "🔍": "magnifying glass search find zoom", "🔭": "telescope explore astronomy",
    "🧬": "dna genetics biology", "⚗️": "alembic chemistry", "🧲": "magnet attract", "📡": "satellite antenna signal radar",
    "🛰️": "satellite space orbit", "🗄️": "file cabinet archive storage", "💾": "floppy disk save storage", "🗃️": "card file box archive",
    "🌐": "globe web internet network", "🔗": "link chain url", "☁️": "cloud weather sky", "✍️": "writing hand write author",
    "📝": "memo note pencil notes", "📖": "open book read", "📰": "newspaper news", "📜": "scroll document parchment",
    "📎": "paperclip attach", "📌": "pushpin pin", "🗂️": "card index dividers files folders", "🏷️": "label tag price",
    "✉️": "envelope mail email letter", "📣": "megaphone announce loud", "🗣️": "speaking head talk speech", "🤝": "handshake deal agreement",
    "👥": "busts silhouette people team group", "🖌️": "paintbrush paint brush", "🖼️": "framed picture image painting", "📷": "camera photo",
    "🎬": "clapper board movie film", "🎥": "movie camera video", "🎵": "musical note music", "🎹": "piano keys music",
    "🎸": "guitar music rock", "🎤": "microphone sing karaoke", "🎲": "game die dice random", "♟️": "chess pawn strategy",
    "🧸": "teddy bear toy", "🎪": "circus tent", "🎁": "gift present wrapped", "📅": "calendar date schedule",
    "⏰": "alarm clock time", "⏳": "hourglass waiting time sand", "🗳️": "ballot box vote election", "⚖️": "balance scale justice law",
    "🧾": "receipt invoice bill", "💰": "money bag budget cash", "📦": "package box parcel delivery", "🚚": "delivery truck shipping",
    "🛒": "shopping cart", "🏦": "bank finance", "🏢": "office building company", "🎓": "graduation cap learn study",
    "🏫": "school", "🏁": "chequered flag finish race", "🏆": "trophy win award cup", "💎": "gem stone diamond",
    "🔐": "locked with key security", "🔑": "key access password", "🛡️": "shield protect security defense", "🚨": "police light alarm alert siren",
    "🚦": "traffic light", "🧯": "fire extinguisher", "🩺": "stethoscope health doctor medical", "🧹": "broom clean sweep",
    "♻️": "recycle recycling", "🧑‍🍳": "cook chef kitchen", "🧑‍🔬": "scientist lab", "🧑‍🎨": "artist painter",
    "🧑‍🏫": "teacher", "🧑‍🚀": "astronaut space", "🕵️": "detective spy investigate", "🧙": "mage wizard magic",
    "🦉": "owl wise night bird", "🦊": "fox", "🐼": "panda", "🐝": "honeybee bee",
    "🐢": "turtle slow tortoise", "🐬": "dolphin", "🦄": "unicorn", "🐲": "dragon face",
    "🌍": "earth globe world europe africa", "🌙": "crescent moon night", "⭐": "star", "🌊": "water wave ocean sea",
    "🏔️": "snow capped mountain", "🏝️": "desert island beach", "🌲": "evergreen tree forest pine", "🍀": "four leaf clover luck",
    "🌸": "cherry blossom flower spring", "🍕": "pizza", "🍎": "red apple fruit", "✨": "sparkles magic shiny",
    "💡": "light bulb idea", "🔮": "crystal ball fortune", "🪄": "magic wand", "❤️": "red heart love",
    "🐯": "tiger face", "🐸": "frog face", "👩‍💻": "woman technologist developer coder", "🐺": "wolf face",
    "🐧": "penguin", "🦁": "lion face", "🐨": "koala", "👾": "alien monster space invader pixel",
    "🐱": "cat face", "🐶": "dog face", "🦝": "raccoon", "🦋": "butterfly",
    "🦩": "flamingo", "🦖": "t-rex dinosaur", "🐳": "spouting whale", "🦭": "seal",
    "🐹": "hamster", "🦔": "hedgehog", "🐻": "bear face", "🐮": "cow face",
    "🐵": "monkey face", "🧑‍🚒": "firefighter", "🧑‍⚕️": "health worker doctor nurse", "🧑‍✈️": "pilot",
    "🧛": "vampire", "🧜": "merperson mermaid", "🧞": "genie", "🦸": "superhero",
    "🥷": "ninja", "🤠": "cowboy hat face", "👽": "alien", "👻": "ghost",
    "🎃": "jack-o-lantern pumpkin halloween", "🌵": "cactus",
    "😀": "grinning face smile happy", "😄": "grinning face smiling eyes happy", "😂": "face with tears of joy laugh lol", "🙂": "slightly smiling face",
    "😉": "winking face wink", "😍": "smiling face heart eyes love", "🤔": "thinking face hmm", "😎": "smiling face sunglasses cool",
    "🥳": "partying face party celebrate", "😅": "grinning face sweat nervous", "😢": "crying face sad tear", "😡": "pouting face angry mad",
    "👍": "thumbs up yes like ok", "👎": "thumbs down no dislike", "👋": "waving hand hello bye", "🙏": "folded hands thanks please pray",
    "👏": "clapping hands applause bravo", "💪": "flexed biceps strong muscle", "🎉": "party popper celebrate tada", "💜": "purple heart",
    "✅": "check mark button done yes", "❌": "cross mark no wrong", "⚠️": "warning caution", "🤫": "shushing face quiet hush",
  };
  function emojiName(emoji) {
    return EMOJI_NAMES[emoji] || "";
  }
  function emojiMatches(emoji, query) {
    return emoji === query || emojiName(emoji).includes(query);
  }

  function searchableGrid(list, current, onPick, none) {
    const wrap = document.createElement("div");
    wrap.className = "emoji-pick";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "emoji-search";
    search.placeholder = "Search by name…";
    search.autocomplete = "off";
    search.spellcheck = false;
    search.setAttribute("aria-label", "Search emoji by name");
    const grid = document.createElement("div");
    grid.className = "avatar-picker";
    let value = current || "";
    const button = (text, title, cls, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      if (title) b.title = title;
      b.className = cls;
      b.addEventListener("click", onClick);
      return b;
    };
    const render = () => {
      grid.innerHTML = "";
      const q = search.value.trim().toLowerCase();
      if (none && !q) {
        grid.appendChild(button(none.label, none.title, "none" + (!value ? " selected" : ""), () => {
          value = "";
          onPick("");
          render();
        }));
      }
      const shown = q ? list.filter((e) => emojiMatches(e, q)) : list;
      for (const e of shown) {
        grid.appendChild(button(e, emojiName(e), e === value ? "selected" : "", () => {
          value = e;
          onPick(e);
          render();
        }));
      }
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "emoji-none";
        empty.textContent = `No emoji called "${q}" here.`;
        grid.appendChild(empty);
      }
    };
    for (const type of ["input", "change"]) {
      search.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "input") render();
      });
    }
    search.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") e.preventDefault();
    });
    wrap.append(search, grid);
    render();
    wrap.setValue = (v) => {
      value = v || "";
      render();
    };
    return wrap;
  }

  function pickerElement(current, onPick) {
    return searchableGrid(GALLERY, current, onPick, { label: "Aa", title: "Initials" });
  }

  window.Avatars = { avatarSvg, avatarHtml, initials, pickerElement, searchableGrid, emojiName, GALLERY };
})();
