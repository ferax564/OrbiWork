import { errorDisplayMessage } from "@orbiwork/client-runtime/errors";
import { isZipError } from "@orbiwork/client-runtime/zip/error";
import { ZIP_ERROR_MESSAGES } from "@orbiwork/client-runtime/zip/error-messages";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

import { isPreviewError, type PreviewFailure } from "./previewFailure";

const PREVIEW_FAILURE_MESSAGES = {
  ...ZIP_ERROR_MESSAGES,
  "file-load-failed": msg("The file could not be loaded. Close it and try again."),
  "file-unavailable": msg("The file is unavailable."),
  "preview-failed": msg("Could not preview this file."),
  "read-failed": msg("Could not read this file."),
  "tar-numeric-format": msg("This TAR uses an unsupported numeric format."),
  "tar-header-damaged": msg("The TAR header is damaged."),
  "archive-entry-damaged": msg("An archive entry is too large or damaged."),
  "archive-metadata-too-large": msg("Archive metadata is too large."),
  "tar-metadata-damaged": msg("The TAR metadata is damaged."),
  "archive-empty": msg("This archive has no readable entries."),
  "archive-entry-unavailable": msg("This archive entry is unavailable."),
  "archive-entry-too-large": msg("Entry previews are limited to 10 MB."),
  "text-too-large": msg("Text previews support files up to 256 MB."),
  "text-binary": msg("This file contains binary data."),
  "text-line-too-long": msg("A line or record exceeds the 1 MB preview limit."),
  "text-too-many-rows": msg("Text previews support up to 5 million rows."),
  "text-download-incomplete": msg("The file download was incomplete. Close it and try again."),
  "text-copy-before-loaded": msg("Wait for the file to finish loading before copying."),
  "xml-invalid": msg("This document contains invalid or unsupported XML."),
  "rendered-too-large": msg("The rendered document is too large to preview."),
  "notebook-unsupported": msg("Preview supports version 4 notebooks with up to 500 cells."),
  "rtf-too-many-pages": msg("Rich text preview limited to 500 pages."),
  "rtf-code-page": msg("This rich text code page is not supported."),
  "tiff-metadata-invalid": msg("Invalid TIFF metadata."),
  "tiff-metadata-truncated": msg("This TIFF has too much or truncated metadata."),
  "tiff-metadata-type": msg("Unsupported TIFF metadata type."),
  "tiff-metadata-pointer": msg("Invalid TIFF metadata pointer."),
  "image-too-large": msg("Image previews are limited to 32 megapixels and 16,384 pixels per side."),
  "tiff-strip-invalid-or-oversized": msg("Invalid or oversized TIFF strip."),
  "tiff-lzw-invalid": msg("Invalid TIFF LZW dictionary."),
  "tiff-strip-truncated": msg("Truncated TIFF strip."),
  "tiff-strip-layout": msg("Unsupported TIFF strip layout."),
  "tiff-strip-invalid": msg("Invalid TIFF strip."),
  "tiff-strip-oversized": msg("Oversized TIFF strip."),
  "tiff-compression": msg("This TIFF compression is not supported."),
  "tiff-data-too-large": msg("This TIFF has too much image data."),
  "tiff-no-image": msg("This TIFF has no readable image."),
  "tiff-orientation": msg("This TIFF orientation is not supported."),
  "tiff-color-format": msg("This TIFF color format is not supported."),
  "image-decoding-unavailable": msg("Image decoding is unavailable."),
  "image-decode-failed": msg("Could not decode this image."),
} as const;

export type PreviewFailureCode = keyof typeof PREVIEW_FAILURE_MESSAGES;

export function previewFailureText(failure: PreviewFailure, resolve: MessageResolver = m): string {
  return failure.code ? resolve(PREVIEW_FAILURE_MESSAGES[failure.code]) : failure.message;
}

export function previewErrorText(cause: unknown, fallback: string): string {
  if (isPreviewError(cause) || isZipError(cause)) return m(PREVIEW_FAILURE_MESSAGES[cause.code]);
  return errorDisplayMessage(cause, m) ?? fallback;
}
