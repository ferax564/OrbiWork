import {
  audioMimeTypeFromExtension,
  isWorkspaceImagePreviewPath,
  mediaMimeTypeFromExtension,
} from "./mediaPreview.ts";
export {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  mediaKindFromPath,
} from "./mediaPreview.ts";
import { GENERIC_MIME_TYPES } from "./image.ts";
import { videoMimeType } from "./video.ts";

export type FilePreviewKind =
  | "image"
  | "video"
  | "audio"
  | "html"
  | "markdown"
  | "mermaid"
  | "font"
  | "archive"
  | "text"
  | "unsupported";

export function filePreviewKind(
  file: { readonly name: string; readonly mimeType?: string },
  options?: { readonly richDocuments?: boolean },
): FilePreviewKind {
  const mime = file.mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const name = file.name.toLowerCase();
  const extension = name.slice(name.lastIndexOf("."));
  const generic = !mime || GENERIC_MIME_TYPES.has(mime) || mime === "text/plain";
  const richDocuments = options?.richDocuments !== false;
  if (binaryPreviewKind(file)) return "archive";
  if (mime === "text/html") return "html";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (richDocuments && mime === "text/vnd.mermaid") return "mermaid";
  if (richDocuments && mime.startsWith("font/")) return "font";
  // Linux's MIME database also assigns .otf to OpenDocument formula templates.
  // FontFace validates the actual bytes before a specimen is shown.
  if (
    richDocuments &&
    extension === ".otf" &&
    mime === "application/vnd.oasis.opendocument.formula-template"
  )
    return "font";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/") && !generic) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (generic) {
    if (/^\.html?$/.test(extension)) return "html";
    if (/^\.(md|markdown|mdown|mkd|mdx)$/.test(extension)) return "markdown";
    if (richDocuments && /^\.(mmd|mermaid)$/.test(extension)) return "mermaid";
    if (richDocuments && isWorkspaceFontPreviewPath(name)) return "font";
    if (extension === ".rtf" || extension === ".ipynb") return "text";
    const media = mediaMimeTypeFromExtension(extension);
    if (media?.startsWith("image/")) return "image";
    if (media?.startsWith("video/")) return "video";
    if (audioMimeTypeFromExtension(extension) !== null) return "audio";
    if (
      /^\.(txt|log|json|jsonc|jsonl|ndjson|yaml|yml|toml|ini|conf|config|env|csv|tsv|xml|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|mts|cts|py|pyi|rb|go|rs|swift|kt|kts|java|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|gql|vue|svelte|r|lua|ex|exs|erl|hs|clj|dart|diff|patch|lock|properties|gradle)$/.test(
        extension,
      ) ||
      /^(dockerfile|makefile|gemfile|rakefile|license|readme|\.gitignore|\.gitattributes|\.editorconfig|\.env)(\.|$)/i.test(
        name.split(/[\\/]/).at(-1) ?? "",
      )
    )
      return "text";
  }
  if (
    mime.startsWith("text/") ||
    /^(application\/(json|.*\+json|rtf|xml|.*\+xml|javascript|x-javascript|yaml|x-yaml|toml|sql))$/.test(
      mime,
    )
  )
    return "text";
  return "unsupported";
}

const BINARY_MIME_TYPES = new Map([
  [".zip", "application/zip"],
  [".jar", "application/java-archive"],
  [".tar", "application/x-tar"],
  [".gz", "application/gzip"],
  [".tgz", "application/gzip"],
]);

export function binaryPreviewKind(file: {
  readonly name: string;
  readonly mimeType?: string;
}): "archive" | null {
  const mime = file.mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    [
      "application/zip",
      "application/x-zip-compressed",
      "application/java-archive",
      "application/x-java-archive",
      "application/x-tar",
      "application/gzip",
      "application/x-gzip",
      "application/x-compressed-tar",
    ].includes(mime)
  )
    return "archive";
  if (mime && !GENERIC_MIME_TYPES.has(mime) && mime !== "text/plain") return null;
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return BINARY_MIME_TYPES.has(extension) ? "archive" : null;
}

export const FILE_TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export function decodeFilePreviewText(bytes: Uint8Array, truncated = false) {
  const bounded = bytes.subarray(0, FILE_TEXT_PREVIEW_MAX_BYTES);
  if (bounded.some((byte) => byte === 0))
    throw new Error("This file contains binary data and cannot be shown as text.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return {
      text: decoder.decode(bounded, { stream: truncated || bytes.length > bounded.length }),
      truncated: truncated || bytes.length > bounded.length,
    };
  } catch {
    throw new Error("This file is not UTF-8 text. Open it in another app to view its contents.");
  }
}

export const WORKSPACE_BROWSER_PREVIEW_EXTENSIONS = [".htm", ".html"] as const;

const BROWSER_MIME_TYPE_BY_EXTENSION = new Map([
  [".htm", "text/html"],
  [".html", "text/html"],
]);

const FONT_MIME_TYPE_BY_EXTENSION = new Map([
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export function isWorkspaceFontPreviewPath(path: string): boolean {
  return /\.(ttf|otf|woff2?)$/i.test(path);
}

export function hostPreviewMimeTypeFromExtension(extension: string): string | null {
  if (!/^\.[a-z0-9-]+$/i.test(extension)) return null;
  return (
    mediaMimeTypeFromExtension(extension) ??
    audioMimeTypeFromExtension(extension) ??
    BROWSER_MIME_TYPE_BY_EXTENSION.get(extension.toLowerCase()) ??
    FONT_MIME_TYPE_BY_EXTENSION.get(extension.toLowerCase()) ??
    BINARY_MIME_TYPES.get(extension.toLowerCase()) ??
    null
  );
}

function hasPreviewExtension(path: string, extensions: ReadonlyArray<string>): boolean {
  const literalPath = path.toLowerCase();
  return extensions.some((extension) => literalPath.endsWith(extension));
}

function isWorkspaceBrowserPreviewPath(path: string): boolean {
  return hasPreviewExtension(path, WORKSPACE_BROWSER_PREVIEW_EXTENSIONS);
}

/** File viewers receive literal filesystem paths, not Markdown URLs. */
export function isWorkspaceVideoPreviewPath(path: string): boolean {
  return videoMimeType({ name: path, mimeType: "" }) !== null;
}

export function isWorkspacePreviewEntryPath(path: string): boolean {
  return (
    isWorkspaceBrowserPreviewPath(path) ||
    isWorkspaceImagePreviewPath(path) ||
    isWorkspaceFontPreviewPath(path) ||
    binaryPreviewKind({ name: path }) !== null
  );
}
