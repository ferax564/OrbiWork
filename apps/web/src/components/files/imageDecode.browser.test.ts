import { expect, it } from "vite-plus/test";
import photoUrl from "../../../test/fixtures/images/photo.heic?url";

import { decodeImagePreview } from "./decodeImagePreview";

it("decodes HEIC previews through the attachment converter", async () => {
  const blob = await decodeImagePreview(photoUrl, true, new AbortController().signal);
  expect(blob.type).toBe("image/jpeg");
  const bitmap = await createImageBitmap(blob);
  expect([bitmap.width, bitmap.height]).toEqual([128, 128]);
  bitmap.close();
});
