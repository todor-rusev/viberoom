// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export function chatCompletionsUrl(baseUrl: string): URL {
  return new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
}
