import type { PreviewFailure } from "./previewFailure";
import { ARCHIVE_MAX_BYTES } from "@orbiwork/client-runtime/zip/bounded-zip";

export {
  ARCHIVE_ENTRY_MAX_BYTES,
  ARCHIVE_MAX_ENTRIES,
  ARCHIVE_MAX_RATIO,
} from "@orbiwork/client-runtime/zip/bounded-zip";
export const BINARY_PREVIEW_MAX_BYTES = ARCHIVE_MAX_BYTES;

export interface ArchiveEntry {
  path: string;
  size: number;
  modified: string | null;
  directory: boolean;
}

export type BinaryWorkerRequest =
  | { type: "open"; name: string; bytes: ArrayBuffer }
  | { type: "entry"; path: string };

export type BinaryWorkerResult =
  | ({ type: "error" } & PreviewFailure)
  | { type: "archive"; entries: ArchiveEntry[] }
  | { type: "entry"; path: string; bytes: Uint8Array<ArrayBuffer> };
