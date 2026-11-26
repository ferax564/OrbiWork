import { act, fakeTimers, render, stubGlobal, type Screen } from "../../../test/render";
import { EnvironmentId, ThreadId } from "@orbiwork/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";

// Prepare the real worker before tests; Vite's worker transform adds a large inline source map.
const { refresh, assetUrlState } = vi.hoisted(() => ({
  refresh: vi.fn<() => Promise<string | null>>(),
  assetUrlState: vi.fn<() => import("~/assets/assetUrls").AssetUrlState>(),
}));

// Like the real hook, the callback is a new function whenever its resource object is.
const refreshers = new WeakMap<object, () => Promise<string | null>>();
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlRefresh: (_environmentId, resource) => {
    if (!resource) return refresh;
    let callback = refreshers.get(resource);
    if (!callback) refreshers.set(resource, (callback = () => refresh()));
    return callback;
  },
  useAssetUrlState: assetUrlState,
}));
// The real source view highlights through a worker pool; the text it receives is what matters here.
// Never load the original: its highlighter graph can outlast waitFor on a cold CI browser.
vi.mock(import("./ReadOnlySourcePreview"), () => ({
  default: ({ text, wordWrap }: { text: string; wordWrap?: boolean }) => (
    <pre data-word-wrap={String(wordWrap)}>{text}</pre>
  ),
}));

import { __setClientSettingsForTests, getClientSettings } from "~/hooks/useSettings";
import { AttachmentFilePreview } from "./AttachmentFilePreview";
import LargeTextViewer from "./LargeTextViewer";
import VirtualTablePreview from "./VirtualTablePreview";
import { MermaidFilePreview } from "./MermaidFilePreview";
import JSZip from "jszip";
import { boundedZip } from "@orbiwork/client-runtime/zip/bounded-zip";
import BinaryViewer from "./BinaryViewer";
import { decodeImagePreview } from "./decodeImagePreview";
import type { BinaryWorkerResult } from "./binaryPreviewProtocol";
import type { TextPreviewResult } from "./largeTextProtocol";

// Real worker imports and WASM initialization can exceed waitFor's default second
// when the full browser project runs concurrently on CI.
describe("bounded binary previews", () => {
  it("preserves length-delimited local and global PAX attributes", async () => {
    const encode = (value: string) => new TextEncoder().encode(value);
    const block = (
      name: string,
      content: Uint8Array,
      type = "0",
      size = content.length,
      linkname = "",
    ) => {
      const bytes = new Uint8Array(512 + Math.ceil(content.length / 512) * 512);
      const write = (offset: number, value: string) => bytes.set(encode(value), offset);
      write(0, name);
      write(124, size.toString(8).padStart(11, "0") + "\0");
      bytes.fill(32, 148, 156);
      write(156, type);
      write(157, linkname);
      write(
        148,
        bytes
          .subarray(0, 512)
          .reduce((sum, byte) => sum + byte, 0)
          .toString(8)
          .padStart(6, "0") + "\0 ",
      );
      bytes.set(content, 512);
      return bytes;
    };
    const attributes = (values: Record<string, string>) =>
      encode(
        Object.entries(values)
          .map(([key, value]) => {
            const payload = ` ${key}=${value}\n`;
            let record = `${encode(payload).length + 1}${payload}`;
            while (encode(record).length !== Number.parseInt(record, 10))
              record = `${encode(record).length}${payload}`;
            return record;
          })
          .join(""),
      );
    const chunks = [
      block("Global", attributes({ size: "5", mtime: "-86400" }), "g"),
      block("Local", attributes({ path: "café\n9 size=1\nname.txt" }), "x"),
      block("first.txt", encode("hello"), "0", 0),
      block("world.txt", encode("world"), "0", 0),
      block("Local", attributes({ size: "3", mtime: "-172800" }), "x"),
      block("short.txt", encode("bye"), "0", 0),
      block("again.txt", encode("again"), "0", 0),
      block("Global", attributes({ size: "", mtime: "" }), "g"),
      block("original.txt", encode("hello world")),
      block("alias.txt", encode(""), "1", 0, "original.txt"),
      block("chain.txt", encode(""), "1", 0, "alias.txt"),
      block("Local", attributes({ linkpath: "original.txt" }), "x"),
      block("pax-link.txt", encode(""), "1", 0, "wrong-target"),
      block("LongLink", encode("original.txt\0"), "K"),
      block("gnu-link.txt", encode(""), "1", 0, "wrong-target"),
      block("original.txt", encode("replacement")),
      new Uint8Array(1024),
    ];
    const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const worker = new Worker(new URL("./binaryPreview.worker.ts", import.meta.url), {
      type: "module",
    });
    const request = (input: object) =>
      new Promise<BinaryWorkerResult>((resolve, reject) => {
        worker.addEventListener("message", (event) => resolve(event.data), { once: true });
        worker.addEventListener("error", reject, { once: true });
        worker.postMessage(input, []);
      });
    try {
      const result = await request({
        type: "open",
        name: "pax.tar",
        bytes: bytes.buffer,
      });
      expect(result.type).toBe("archive");
      if (result.type !== "archive") throw new Error("Expected archive");
      expect(result.entries.map((entry) => [entry.path, entry.size, entry.modified])).toEqual([
        ["café\n9 size=1\nname.txt", 5, "1969-12-31T00:00:00.000Z"],
        ["world.txt", 5, "1969-12-31T00:00:00.000Z"],
        ["short.txt", 3, "1969-12-30T00:00:00.000Z"],
        ["again.txt", 5, "1969-12-31T00:00:00.000Z"],
        ...[
          "original.txt",
          "alias.txt",
          "chain.txt",
          "pax-link.txt",
          "gnu-link.txt",
          "original.txt",
        ].map((path) => [path, 11, "1970-01-01T00:00:00.000Z"]),
      ]);
      const entry = await request({ type: "entry", path: "café\n9 size=1\nname.txt" });
      if (entry.type !== "entry") throw new Error("Expected entry");
      expect(new TextDecoder().decode(entry.bytes)).toBe("hello");
      expect(entry.bytes.buffer.byteLength).toBe(5);
      entry.bytes[0] = 0;
      const reopened = await request({ type: "entry", path: entry.path });
      if (reopened.type !== "entry") throw new Error("Expected entry");
      expect(new TextDecoder().decode(reopened.bytes)).toBe("hello");
      expect(reopened.bytes.buffer.byteLength).toBe(5);
      for (const path of ["alias.txt", "chain.txt", "pax-link.txt", "gnu-link.txt"]) {
        const linked = await request({ type: "entry", path });
        if (linked.type !== "entry") throw new Error("Expected hard link entry");
        expect(new TextDecoder().decode(linked.bytes)).toBe("hello world");
      }
      const unresolved = new Uint8Array(
        await new Blob([
          block("missing.txt", encode(""), "1", 0, "nowhere.txt"),
          block("early.txt", encode(""), "1", 0, "later.txt"),
          block("later.txt", encode("hello")),
          block("folder/", encode(""), "5"),
          block("to-folder.txt", encode(""), "1", 0, "folder/"),
          block("replaced.txt", encode("stale")),
          block("replaced.txt", encode(""), "2", 0, "elsewhere.txt"),
          block("to-replaced.txt", encode(""), "1", 0, "replaced.txt"),
          block("Local", attributes({ linkpath: "" }), "x"),
          block("emptied.txt", encode(""), "1", 0, "later.txt"),
          new Uint8Array(1024),
        ]).arrayBuffer(),
      );
      const skipped = await request({
        type: "open",
        name: "links.tar",
        bytes: unresolved.buffer,
      });
      if (skipped.type !== "archive") throw new Error("Expected archive");
      expect(skipped.entries.map((entry) => entry.path)).toEqual([
        "later.txt",
        "folder/",
        "replaced.txt",
      ]);
      expect(await request({ type: "entry", path: "replaced.txt" })).toEqual({
        type: "error",
        code: "archive-entry-unavailable",
        message: "archive-entry-unavailable",
      });
    } finally {
      worker.terminate();
    }
  });

  it("names archive folders whose paths have leading or repeated slashes", async () => {
    const bytes = new Uint8Array(2048);
    const write = (offset: number, value: string) =>
      bytes.set(new TextEncoder().encode(value), offset);
    const member = (offset: number, name: string, content: string) => {
      write(offset, name);
      write(offset + 124, content.length.toString(8).padStart(11, "0") + "\0");
      bytes.fill(32, offset + 148, offset + 156);
      write(offset + 156, "0");
      write(
        offset + 148,
        bytes
          .subarray(offset, offset + 512)
          .reduce((sum, byte) => sum + byte, 0)
          .toString(8)
          .padStart(6, "0") + "\0 ",
      );
      write(offset + 512, content);
    };
    member(0, "/a//hello.txt", "nested hello");
    member(1024, "a/hello.txt", "plain hello");
    const src = URL.createObjectURL(new Blob([bytes]));
    try {
      await using screen = await render(<BinaryViewer src={src} name="paths.tar" />);
      const buttons = () => [
        ...screen.container.querySelectorAll<HTMLButtonElement>("tbody button"),
      ];
      const rows = () => buttons().map((button) => button.textContent);
      const back = () =>
        screen.container.querySelector<HTMLButtonElement>('[aria-label="Back to archive"]')!;
      const preview = () => screen.container.querySelector("pre")?.textContent;
      await vi.waitFor(() => expect(rows()).toEqual(["a"]), 10_000);
      await act(() => buttons()[0]!.click());
      await vi.waitFor(() => expect(rows()).toEqual(["hello.txt", "hello.txt"]));
      await act(() => buttons()[0]!.click());
      await vi.waitFor(() => expect(preview()).toContain("nested hello"), 10_000);
      await act(() => back().click());
      await act(() => buttons()[1]!.click());
      await vi.waitFor(() => expect(preview()).toContain("plain hello"), 10_000);
      await act(() => back().click());
      await vi.waitFor(() => expect(rows()).toEqual(["hello.txt", "hello.txt"]));
      const parent = () =>
        screen.container.querySelector<HTMLButtonElement>('[aria-label="Parent folder"]')!;
      await act(() => parent().click());
      expect(parent().disabled).toBe(true);
      expect(rows()).toEqual(["a"]);
    } finally {
      URL.revokeObjectURL(src);
    }
  });

  it("uses a PAX size override for the following TAR payload and bounds it", async () => {
    const archive = (size: string) => {
      const header = (name: string, size: number, type: string) => {
        const bytes = new Uint8Array(512);
        const write = (offset: number, value: string) =>
          bytes.set(new TextEncoder().encode(value), offset);
        write(0, name);
        write(124, size.toString(8).padStart(11, "0") + "\0");
        bytes.fill(32, 148, 156);
        write(156, type);
        write(
          148,
          bytes
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, "0") + "\0 ",
        );
        return bytes;
      };
      const payload = ` size=${size}\n`;
      let record = `${payload.length + 1}${payload}`;
      while (record.length !== Number.parseInt(record, 10)) record = `${record.length}${payload}`;
      const bytes = new Uint8Array(3072);
      bytes.set(header("PaxHeader", record.length, "x"));
      bytes.set(new TextEncoder().encode(record), 512);
      bytes.set(header("hello.txt", 0, "0"), 1024);
      bytes.set(new TextEncoder().encode("hello"), 1536);
      return bytes;
    };
    for (const size of ["5", "999999999999999999999"]) {
      const src = URL.createObjectURL(new Blob([archive(size)]));
      try {
        await using screen = await render(<BinaryViewer src={src} name="pax.tar" />);
        if (size === "5") {
          await vi.waitFor(
            () =>
              expect(screen.container.querySelector("tbody button")?.textContent).toBe("hello.txt"),
            10_000,
          );
          await act(() =>
            screen.container.querySelector<HTMLButtonElement>("tbody button")!.click(),
          );
          await vi.waitFor(
            () => expect(screen.container.querySelector("pre")?.textContent).toBe("hello"),
            10_000,
          );
        } else {
          await vi.waitFor(
            () =>
              expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain(
                "too large or damaged",
              ),
            10_000,
          );
        }
      } finally {
        URL.revokeObjectURL(src);
      }
    }
  });

  it("reauthorizes a failed image when retry is clicked", async () => {
    const image =
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>';
    refresh
      .mockReset()
      .mockResolvedValueOnce("data:image/png;base64,broken")
      .mockResolvedValue(image);
    await using screen = await render(
      <AttachmentFilePreview
        name="photo.png"
        mimeType="image/png"
        sizeBytes={100}
        asset={{ environmentId: EnvironmentId.make("test-environment"), attachmentId: "image" }}
      />,
    );
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain(
        "Unable to load image.",
      ),
    );
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    await vi.waitFor(() =>
      expect(screen.container.querySelector("img")?.getAttribute("src")).toBe(image),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reads a small ZIP64 archive and rejects understated directory counts", async () => {
    const zip = new JSZip().file("readme.txt", "hello");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const end = bytes.length - 22;
    const legacy = new DataView(bytes.buffer);
    const extended = new Uint8Array(bytes.length + 76);
    extended.set(bytes.subarray(0, end));
    extended.set(bytes.subarray(end), end + 76);
    const view = new DataView(extended.buffer);
    view.setUint32(end, 0x06064b50, true);
    view.setBigUint64(end + 4, 44n, true);
    view.setBigUint64(end + 24, 1n, true);
    view.setBigUint64(end + 32, 1n, true);
    view.setBigUint64(end + 40, BigInt(legacy.getUint32(end + 12, true)), true);
    view.setBigUint64(end + 48, BigInt(legacy.getUint32(end + 16, true)), true);
    view.setUint32(end + 56, 0x07064b50, true);
    view.setBigUint64(end + 64, BigInt(end), true);
    view.setUint32(end + 72, 1, true);
    view.setUint16(end + 76 + 10, 0xffff, true);
    expect(
      new TextDecoder().decode((await boundedZip(extended.buffer)).get("readme.txt")?.bytes),
    ).toBe("hello");

    const redirected = new Uint8Array(extended.length + 56);
    redirected.set(extended.subarray(0, end + 56));
    redirected.set(extended.subarray(end + 56), end + 112);
    const redirect = new DataView(redirected.buffer);
    redirect.setUint32(end + 56, 0x06064b50, true);
    redirect.setBigUint64(end + 60, 44n, true);
    redirect.setBigUint64(end + 104, BigInt(end), true);
    await expect(boundedZip(redirected.buffer)).rejects.toThrow("Unsupported ZIP64 directory");

    const commented = new Uint8Array(extended.length + 20);
    commented.set(extended);
    const comment = new DataView(commented.buffer);
    comment.setUint16(extended.length - 2, 20, true);
    comment.setUint32(extended.length, 0x07064b50, true);
    comment.setBigUint64(extended.length + 8, BigInt(end), true);
    comment.setUint32(extended.length + 16, 1, true);
    const load = vi.spyOn(JSZip, "loadAsync");
    try {
      await expect(boundedZip(commented.buffer)).rejects.toThrow("Unsupported ZIP64 directory");
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }

    const many = new JSZip();
    for (let i = 0; i < 2049; i++) many.file(`file-${i}`, "");
    const crowded = await many.generateAsync({ type: "arraybuffer" });
    new DataView(crowded).setUint16(crowded.byteLength - 12, 1, true);
    await expect(boundedZip(crowded)).rejects.toThrow("more than 2,048 entries");
  });

  it("keeps a file and directory with the same basename accessible", async () => {
    const bytes = await new JSZip()
      .file("foo.txt", "root file")
      .file("foo.txt/bar.txt", "child")
      .generateAsync({ type: "arraybuffer" });
    const src = URL.createObjectURL(new Blob([bytes]));
    try {
      await using screen = await render(<BinaryViewer src={src} name="names.zip" />);
      await vi.waitFor(
        () => expect(screen.container.querySelectorAll("tbody button")).toHaveLength(2),
        10_000,
      );
      const buttons = [...screen.container.querySelectorAll<HTMLButtonElement>("tbody button")];
      expect(buttons.map((button) => button.textContent)).toEqual(["foo.txt", "foo.txt"]);
      await act(() => buttons[1]!.click());
      await vi.waitFor(() => expect(screen.container.textContent).toContain("root file"), 10_000);
    } finally {
      URL.revokeObjectURL(src);
    }
  });

  it("keeps WhiteIsZero TIFF brightness and alpha with SubIFDs and type-13 ExifIFD pointers and rejects invalid metadata before decoding", async () => {
    let bytes = new ArrayBuffer(0);
    let exifEntry = 0;
    for (const { pixels, expected } of [
      { pixels: [0, 255], expected: [255, 255, 255, 255, 0, 0, 0, 255] },
      { pixels: [0, 255, 255, 0], expected: [255, 255, 255, 255, 0, 0, 0, 0] },
    ]) {
      const samples = pixels.length / 2;
      const start = samples === 2 ? 170 : 158;
      const exif = start + pixels.length;
      const tags = [
        [256, 2],
        [257, 1],
        [258, 8],
        [259, 1],
        [262, 0],
        [273, start],
        [277, samples],
        [278, 1],
        [279, pixels.length],
        [284, 1],
        [330, 0, 13],
        ...(samples === 2 ? [[338, 2]] : []),
        [34665, exif, 13],
      ];
      exifEntry = 10 + (tags.length - 1) * 12;
      bytes = new ArrayBuffer(exif + 8);
      const view = new DataView(bytes);
      view.setUint16(0, 0x4949);
      view.setUint16(2, 42, true);
      view.setUint32(4, 8, true);
      view.setUint16(8, tags.length, true);
      tags.forEach(([tag, value, type = 4], index) => {
        const offset = 10 + index * 12;
        view.setUint16(offset, tag!, true);
        view.setUint16(offset + 2, type, true);
        view.setUint32(offset + 4, 1, true);
        view.setUint32(offset + 8, value!, true);
      });
      new Uint8Array(bytes, start).set(pixels);
      const src = URL.createObjectURL(new Blob([bytes]));
      try {
        const blob = await decodeImagePreview(src, false, new AbortController().signal);
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(2, 1);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        expect([...context.getImageData(0, 0, 2, 1).data]).toEqual(expected);
        bitmap.close();
      } finally {
        URL.revokeObjectURL(src);
      }
    }
    for (const [mutate, message] of [
      [
        (view: DataView) => view.setUint16(exifEntry + 2, 3, true),
        "Invalid TIFF metadata pointer.",
      ],
      [
        (view: DataView) => view.setUint32(exifEntry + 4, 2, true),
        "Invalid TIFF metadata pointer.",
      ],
      [
        (view: DataView) => view.setUint32(14, 1_000_000, true),
        "This TIFF has too much or truncated metadata.",
      ],
    ] as const) {
      const copy = bytes.slice(0);
      mutate(new DataView(copy));
      const invalid = URL.createObjectURL(new Blob([copy]));
      try {
        await expect(
          decodeImagePreview(invalid, false, new AbortController().signal),
        ).rejects.toThrow(message);
      } finally {
        URL.revokeObjectURL(invalid);
      }
    }
  });
});

describe("large text preview recovery", () => {
  it("retains the workspace viewer across URL renewals and reloads revisions and manual refreshes", async () => {
    const { WorkspaceLargeTextPreview } = await import("./FilePreviewPanel");
    const original = URL.createObjectURL(new Blob(["original\n".repeat(1000)]));
    const changed = URL.createObjectURL(new Blob(["changed\n".repeat(1000)]));
    const workers: Worker[] = [];
    const indexed: Promise<void>[] = [];
    using _worker = stubGlobal(
      "Worker",
      class extends Worker {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          workers.push(this);
          indexed.push(
            new Promise((resolve) =>
              this.addEventListener("message", (event: MessageEvent<TextPreviewResult>) => {
                if (event.data.type === "meta" && event.data.complete) resolve();
              }),
            ),
          );
        }
      },
    );
    const preview = (mutation: string, key = 0) => (
      <div style={{ display: "flex", flexDirection: "column", height: 400, width: 600 }}>
        <WorkspaceLargeTextPreview
          key={key}
          environmentId={EnvironmentId.make("test")}
          threadRef={{ environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") }}
          absolutePath="/repo/large.txt"
          draftCwd={null}
          name="large.txt"
          delimiter={null}
          markdownCwd={null}
          copyContents={{ current: null }}
          preview=""
          // Past the highlighted-source cap, so the worker-backed viewer under test renders.
          sizeBytes={128 * 1024 * 1024}
          workspaceMutationId={mutation}
          revealLine={null}
          revealRequestId={0}
          wordWrap
        />
      </div>
    );
    const state = (url: string, fileRevision?: string) =>
      assetUrlState.mockReturnValue({
        _tag: "Success",
        url,
        expiresAt: Date.now() + 3_600_000,
        ...(fileRevision === undefined ? {} : { fileRevision }),
      });
    refresh.mockResolvedValue(`${original}#renewed`);
    try {
      state(`${original}#initial`, "one");
      await using screen = await render(preview("first"));
      await vi.waitFor(() => expect(workers).toHaveLength(1));
      await vi.waitFor(() => expect(screen.container.textContent).toContain("original"));
      // A cold worker can take longer than waitFor allows to load and index on CI.
      await indexed[0];
      await vi.waitFor(() => expect(screen.container.textContent).toContain("1,000 lines"));
      const viewport = screen.container.querySelector<HTMLElement>('[tabindex="0"]')!;
      await act(() =>
        viewport.dispatchEvent(
          new WheelEvent("wheel", { deltaY: 250, bubbles: true, cancelable: true }),
        ),
      );
      await vi.waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(0));
      const scrollTop = viewport.scrollTop;
      state(`${original}#renewed`, "one");
      await screen.rerender(preview("unrelated-command"));
      expect(screen.container.querySelector('[tabindex="0"]')).toBe(viewport);
      expect(viewport.scrollTop).toBe(scrollTop);
      expect(workers).toHaveLength(1);
      state(`${changed}#updated`, "two");
      await screen.rerender(preview("file-edit"));
      // The prefetched first screen paints before the worker starts, so wait for the worker itself.
      await vi.waitFor(() => expect(workers).toHaveLength(2));
      await vi.waitFor(() => expect(screen.container.textContent).toContain("changed"));
      await screen.rerender(preview("file-edit", 1));
      await vi.waitFor(() => expect(workers).toHaveLength(3));
      await vi.waitFor(() => expect(screen.container.textContent).toContain("changed"));
      state(`${original}#legacy`);
      await screen.rerender(preview("legacy-edit", 1));
      await vi.waitFor(() => expect(workers).toHaveLength(4));
      await vi.waitFor(() => expect(screen.container.textContent).toContain("original"));
      assetUrlState.mockReturnValue({ _tag: "Failure" });
      await screen.rerender(preview("legacy-edit", 1));
      expect(screen.container.textContent).toContain("Unable to load file preview.");
      refresh.mockClear();
      refresh.mockImplementation(async () => {
        state(`${changed}#retried`);
        return changed;
      });
      await screen.getByRole("button", { name: "Try again" }).click();
      expect(refresh).toHaveBeenCalledOnce();
      await screen.rerender(preview("legacy-edit", 1));
      await vi.waitFor(() => expect(screen.container.textContent).toContain("changed"));
      expect(screen.container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      URL.revokeObjectURL(original);
      URL.revokeObjectURL(changed);
    }
  });

  it("scrolls within a wrapped row when the row-count track is shorter than the viewport", async () => {
    await using screen = await render(
      <div style={{ display: "flex", height: 400, width: 600 }}>
        <VirtualTablePreview
          name="one.txt"
          count={1}
          columns={1}
          source
          wrap
          getRows={() => [["wrapped source text ".repeat(500)]]}
        />
      </div>,
    );
    const row = () => screen.container.querySelector<HTMLElement>('[data-preview-row="0"]')!;
    const viewport = () => screen.container.querySelector<HTMLElement>('[tabindex="0"]')!;
    await vi.waitFor(() => expect(row()?.offsetHeight).toBeGreaterThan(1000));
    await act(() =>
      viewport().dispatchEvent(
        new WheelEvent("wheel", { deltaY: 150, bubbles: true, cancelable: true }),
      ),
    );
    await vi.waitFor(() => {
      const offset = viewport().getBoundingClientRect().top - row().getBoundingClientRect().top;
      expect(offset).toBeGreaterThan(50);
      expect(offset).toBeLessThan(300);
    });
    await act(() =>
      viewport().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    await vi.waitFor(() =>
      expect(
        Math.abs(row().getBoundingClientRect().bottom - viewport().getBoundingClientRect().bottom),
      ).toBeLessThan(2),
    );
    await act(() =>
      viewport().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
    );
    await vi.waitFor(() =>
      expect(row().getBoundingClientRect().top).toBe(viewport().getBoundingClientRect().top),
    );
  });

  it("scrolls every tall row in the final virtual viewport", async () => {
    const view = (loaded: boolean) => (
      <div style={{ display: "flex", height: 400, width: 600 }}>
        <VirtualTablePreview
          name="tail.txt"
          count={100}
          columns={1}
          source
          wrap
          getRows={(page) =>
            !loaded && page > 0
              ? undefined
              : Array.from({ length: 32 }, (_, i) => [
                  "line-" + (page * 32 + i + 1) + " wrapped source text".repeat(500),
                ])
          }
        />
      </div>
    );
    await using screen = await render(view(false));
    const viewport = () => screen.container.querySelector<HTMLElement>('[tabindex="0"]')!;
    const row = (index: number) =>
      screen.container.querySelector<HTMLElement>('[data-preview-row="' + index + '"]')!;
    await vi.waitFor(() => expect(row(0)?.offsetHeight).toBeGreaterThan(1000));
    await act(() =>
      viewport().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    await vi.waitFor(() => expect(row(99)).not.toBeNull());
    await screen.rerender(view(true));
    await vi.waitFor(() =>
      expect(
        Math.abs(
          row(99).getBoundingClientRect().bottom - viewport().getBoundingClientRect().bottom,
        ),
      ).toBeLessThan(2),
    );
    await act(() =>
      viewport().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
    );
    await vi.waitFor(() => expect(row(0)).not.toBeNull());
    await act(() => {
      viewport().scrollTop = 100 * 29 - viewport().clientHeight;
      viewport().dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const checkTop = (index: number) =>
      expect(
        Math.abs(row(index).getBoundingClientRect().top - viewport().getBoundingClientRect().top),
      ).toBeLessThan(2);
    await vi.waitFor(() => checkTop(87));
    for (let index = 88; index < 100; index++) {
      await act(() =>
        viewport().dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: row(index - 1).offsetHeight,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      if (index < 99) await vi.waitFor(() => checkTop(index));
    }
    await act(() =>
      viewport().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    await vi.waitFor(() =>
      expect(
        Math.abs(
          row(99).getBoundingClientRect().bottom - viewport().getBoundingClientRect().bottom,
        ),
      ).toBeLessThan(2),
    );
  });

  it("rejects malformed UTF-8 bytes through the real text worker", async () => {
    const src = URL.createObjectURL(new Blob([new Uint8Array([0xe9, 10])]));
    try {
      await using screen = await render(
        <LargeTextViewer src={src} name="latin.txt" delimiter={null} />,
      );
      await vi.waitFor(
        () => expect(screen.container.querySelector('[role="alert"]')).not.toBeNull(),
        10_000,
      );
    } finally {
      URL.revokeObjectURL(src);
    }
  });

  it("replaces both prefetched pages with the worker's current file version", async () => {
    const old = Array.from({ length: 64 }, (_, i) => "old-" + i).join("\n") + "\n";
    const current = Array.from({ length: 100 }, (_, i) => "current-" + i).join("\n");
    const src = URL.createObjectURL(new Blob([current]));
    using _fetch = stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(old, {
          status: 206,
          headers: {
            "content-length": String(old.length),
            "content-range": "bytes 0-" + (old.length - 1) + "/100000",
          },
        }),
      ),
    );
    try {
      await using screen = await render(
        <div style={{ display: "flex", height: 2000, width: 600 }}>
          <LargeTextViewer src={src} name="log.txt" delimiter={null} />
        </div>,
      );
      await vi.waitFor(() => expect(screen.container.textContent).toContain("current-40"), 10_000);
      expect(screen.container.textContent).not.toContain("old-");
    } finally {
      URL.revokeObjectURL(src);
    }
  });

  it("fills the horizontal viewport using measured column widths", async () => {
    const header = Array.from({ length: 20 }, (_, i) => "C" + i);
    await using screen = await render(
      <div style={{ display: "flex", height: 400, width: 400 }}>
        <VirtualTablePreview
          name="wide.csv"
          count={2}
          columns={20}
          header={header}
          getRows={() => [header, header]}
        />
      </div>,
    );
    const outer = () => screen.container.querySelector('[role="table"]')!.parentElement!;
    const check = () => {
      const cells = screen.container.querySelectorAll('[role="columnheader"]');
      expect(cells.length).toBeGreaterThan(0);
      expect(cells[cells.length - 1]!.getBoundingClientRect().right).toBeGreaterThanOrEqual(
        outer().getBoundingClientRect().right - 1,
      );
    };
    await vi.waitFor(check);
    await act(() => {
      outer().scrollLeft = outer().scrollWidth;
      outer().dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await vi.waitFor(check);
    expect(screen.container.textContent).toContain("C19");
  });

  it("keeps row height and vertical position stable across horizontal scroll, fresh row arrays, resize, and typography changes", async () => {
    const columns = 35;
    const header = Array.from({ length: columns }, (_, i) => `Col ${i}`);
    const forcedEightLines = Array.from({ length: 8 }, (_, i) => `L${i + 1}`).join("\n");
    const wrappedTwelveWords = Array.from({ length: 12 }, (_, i) => `segment${i + 1}`).join(" ");
    const makeRows = () => [
      header,
      ...Array.from({ length: 24 }, (_, rowIndex) =>
        Array.from({ length: columns }, (_, columnIndex) => {
          if (rowIndex === 0) {
            if (columnIndex >= 10 && columnIndex < 28) return forcedEightLines;
            if (columnIndex === 34) return wrappedTwelveWords;
          }
          if (columnIndex === 33 && rowIndex % 3 === 1) return forcedEightLines;
          // Wide lowercase glyphs that wrap without spaces or newlines.
          if (rowIndex === 2 && columnIndex === 34) return "m".repeat(11);
          return `r${rowIndex + 1}-c${columnIndex}`;
        }),
      ),
    ];
    const view = (width: number) => (
      <div style={{ display: "flex", height: 320, width }}>
        <VirtualTablePreview
          name="wide-wrapped.csv"
          count={25}
          columns={columns}
          header={header}
          // Fresh arrays per call must not loop or lose measured row heights.
          getRows={(page) => (page === 0 ? makeRows() : undefined)}
        />
      </div>
    );
    const previousSettings = getClientSettings();
    const previousRootFontSize = document.documentElement.style.fontSize;
    try {
      await using screen = await render(view(420));
      const horizontal = () => screen.container.querySelector('[role="table"]')!.parentElement!;
      const vertical = () => screen.container.querySelector<HTMLElement>('[tabindex="0"]')!;
      const row = (index: number) =>
        screen.container.querySelector<HTMLElement>(`[data-preview-row="${index}"]`)!;

      await vi.waitFor(() => {
        expect(row(1)).not.toBeNull();
        expect(row(1).getBoundingClientRect().height).toBeGreaterThan(150);
      });

      const initialRow1Height = row(1).getBoundingClientRect().height;
      const initialRow2Height = row(2).getBoundingClientRect().height;
      const initialRow3Height = row(3).getBoundingClientRect().height;
      const initialRow4Top = row(4).getBoundingClientRect().top;

      // Scroll to the far right where the word-wrapped column 34 mounts after 18 newline cells.
      await act(() => {
        horizontal().scrollLeft = horizontal().scrollWidth;
        horizontal().dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await vi.waitFor(() => expect(screen.container.textContent).toContain("segment12"));

      expect(Math.abs(row(1).getBoundingClientRect().height - initialRow1Height)).toBeLessThan(1);
      expect(Math.abs(row(2).getBoundingClientRect().height - initialRow2Height)).toBeLessThan(1);
      expect(row(3).getBoundingClientRect().height).toBeGreaterThan(40);
      expect(Math.abs(row(3).getBoundingClientRect().height - initialRow3Height)).toBeLessThan(1);
      expect(Math.abs(row(4).getBoundingClientRect().top - initialRow4Top)).toBeLessThan(1);

      // Scroll vertically into the table, then sweep horizontally back to the left edge.
      await act(() => {
        vertical().scrollTop = 120;
        vertical().dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await vi.waitFor(() => expect(row(5)).not.toBeNull());
      const scrolledRow5Top = row(5).getBoundingClientRect().top;
      const scrolledRow5Height = row(5).getBoundingClientRect().height;

      await act(() => {
        horizontal().scrollLeft = 0;
        horizontal().dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await vi.waitFor(() => expect(screen.container.textContent).toContain("r6-c0"));

      expect(Math.abs(row(5).getBoundingClientRect().height - scrolledRow5Height)).toBeLessThan(1);
      expect(Math.abs(row(5).getBoundingClientRect().top - scrolledRow5Top)).toBeLessThan(1);

      // Widening the container widens each uniform column, reducing wrapped line count.
      await screen.rerender(view(1600));
      await vi.waitFor(() =>
        expect(row(1).getBoundingClientRect().height).toBeLessThan(initialRow1Height),
      );
      const widenedRow1Height = row(1).getBoundingClientRect().height;

      // Typography changes invalidate cached minimums even at the same container width.
      await act(() => {
        document.documentElement.style.fontSize = "20px";
        __setClientSettingsForTests({
          ...previousSettings,
          fontSizeInterface: previousSettings.fontSizeInterface + 4,
        });
      });
      await vi.waitFor(() =>
        expect(row(1).getBoundingClientRect().height).toBeGreaterThan(widenedRow1Height),
      );
    } finally {
      document.documentElement.style.fontSize = previousRootFontSize;
      __setClientSettingsForTests(previousSettings);
    }
  });

  it("reveals and highlights requested source lines again for a new request", async () => {
    const view = (line: number, request: number, loaded = true) => (
      <div style={{ display: "flex", height: 400, width: 600 }}>
        <VirtualTablePreview
          name="log.txt"
          count={1000}
          columns={1}
          source
          wrap
          revealLine={line}
          revealRequestId={request}
          getRows={(page) =>
            loaded || page === 0
              ? Array.from({ length: 32 }, (_, i) => [
                  "line-" + (page * 32 + i + 1) + " wrapped source text".repeat(20),
                ])
              : undefined
          }
        />
      </div>
    );
    await using screen = await render(view(500, 1, false));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-preview-reveal="true"]')?.textContent).toBe(
        "500",
      ),
    );
    await screen.rerender(view(500, 1));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-preview-reveal="true"]')?.textContent).toContain(
        "line-500",
      ),
    );
    const checkVisible = () => {
      const row = screen.container.querySelector<HTMLElement>('[data-preview-reveal="true"]')!;
      const viewport = screen.container.querySelector<HTMLElement>('[tabindex="0"]')!;
      expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        viewport.getBoundingClientRect().top - 1,
      );
      expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        viewport.getBoundingClientRect().bottom + 1,
      );
    };
    await vi.waitFor(checkVisible);
    await screen.rerender(view(900, 2));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-preview-reveal="true"]')?.textContent).toContain(
        "line-900",
      ),
    );
    await vi.waitFor(checkVisible);
    await screen.rerender(view(999, 3));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-preview-reveal="true"]')?.textContent).toContain(
        "line-999",
      ),
    );
    await vi.waitFor(checkVisible);
  });

  it.each(
    [5, 100, 10_000].flatMap((count) => [false, true].map((mixed) => [count, mixed] as const)),
  )(
    "preserves the source row when indexing grows beyond %i lines (mixed heights: %s)",
    async (count, mixed) => {
      const view = (count: number) => (
        <div style={{ display: "flex", height: 400, width: 600 }}>
          <VirtualTablePreview
            name="growing.txt"
            count={count}
            columns={1}
            source
            wrap
            getRows={(page) =>
              Array.from({ length: 32 }, (_, i) => [
                `line-${page * 32 + i + 1} ` +
                  "wrapped source text ".repeat(mixed ? 5 + (i % 4) * 20 : 20),
              ])
            }
          />
        </div>
      );
      await using screen = await render(view(count));
      const viewport = () => screen.container.querySelector<HTMLElement>('[tabindex="0"]')!;
      await vi.waitFor(() => expect(viewport()?.scrollHeight).toBeGreaterThan(400));
      await act(() => {
        viewport().scrollTop = count === 100 ? 100 * 29 - 400 + 1200 : 1200;
        viewport().dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      const visibleRow = () =>
        [...screen.container.querySelectorAll<HTMLElement>("[data-preview-row]")].find(
          (row) => row.getBoundingClientRect().bottom > viewport().getBoundingClientRect().top + 1,
        )!;
      await vi.waitFor(() => expect(visibleRow()).toBeDefined());
      const before = visibleRow().dataset.previewRow;
      const offset =
        visibleRow().getBoundingClientRect().top - viewport().getBoundingClientRect().top;
      await screen.rerender(view(1_000_000));
      await vi.waitFor(() => {
        expect(visibleRow().dataset.previewRow).toBe(before);
        expect(
          Math.abs(
            visibleRow().getBoundingClientRect().top -
              viewport().getBoundingClientRect().top -
              offset,
          ),
        ).toBeLessThan(Math.max(5, visibleRow().offsetHeight / 29 + 1));
      });
    },
  );

  it("recovers from a failed worker load when its source changes", async () => {
    await using screen = await render(
      <LargeTextViewer name="log.txt" text={"bad\0text"} delimiter={null} />,
    );
    await vi.waitFor(
      () => expect(screen.container.textContent).toContain("This file contains binary data."),
      10_000,
    );
    await screen.rerender(<LargeTextViewer name="log.txt" text="" delimiter={null} />);
    await vi.waitFor(
      () => expect(screen.container.textContent).toContain("This file is empty."),
      10_000,
    );
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  });

  it("reloads a partial page when the indexed row count grows", async () => {
    const load = vi.fn();
    const rows = [["first"]];
    const view = (count: number) => (
      <div style={{ display: "flex", height: 400, width: 600 }}>
        <VirtualTablePreview
          name="log.txt"
          count={count}
          columns={1}
          source
          getRows={() => rows}
          loadPage={load}
        />
      </div>
    );
    await using screen = await render(view(1));
    await vi.waitFor(() => expect(screen.container.textContent).toContain("first"));
    expect(load).not.toHaveBeenCalled();
    await screen.rerender(view(2));
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(0));
  });
});
describe("standalone Mermaid previews", () => {
  it.each([
    'A@{ "img": "//attacker.invalid/pixel.png" }',
    'A@{ "im\\u0067": "/pixel.png" }',
    "A@{ label: &key img, *key: '/pixel.png' }",
    'A["<img src=//attacker.invalid/pixel.png>"]',
  ])("rejects resource syntax before Mermaid lays out %s", async (node) => {
    using imageSource = vi
      .spyOn(HTMLImageElement.prototype, "src", "set")
      .mockImplementation(() => {});
    await using screen = await render(<MermaidFilePreview text={`flowchart LR\n${node}`} />);
    // The first case loads the Mermaid viewer chunk, which can take over a second on a slow runner.
    await vi.waitFor(
      () =>
        expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain(
          "Show Mermaid source",
        ),
      { timeout: 10_000 },
    );
    expect(imageSource).not.toHaveBeenCalled();
    expect(screen.container.querySelector("svg")).toBeNull();
  });

  it.each(["<-->", "<==>", "<-.->", "-->"])("renders the %s arrow", async (arrow) => {
    await using screen = await render(<MermaidFilePreview text={`flowchart LR\nA ${arrow} B`} />);
    await vi.waitFor(
      () => {
        const diagram = screen.container.querySelector("svg");
        expect(diagram?.querySelector("path")).not.toBeNull();
        expect(diagram?.textContent).toContain("A");
        expect(diagram?.textContent).toContain("B");
      },
      { timeout: 10_000 },
    );
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("attachment HTML preview recovery", () => {
  const originalUrl = "data:text/html,original";
  const renewedUrl = "data:text/html,renewed";

  function setup() {
    refresh.mockReset().mockResolvedValueOnce(originalUrl).mockResolvedValue(renewedUrl);
  }

  const openRemote = () =>
    render(
      <AttachmentFilePreview
        name="document.html"
        mimeType="text/html"
        sizeBytes={100}
        asset={{ environmentId: EnvironmentId.make("test-environment"), attachmentId: "html" }}
      />,
    );

  const toggleMode = async (screen: Screen, label: string) => {
    const button = screen.container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(button, label).not.toBeNull();
    await act(async () => button!.click());
  };
  const alert = (screen: Screen) => screen.container.querySelector('[role="alert"]');
  // The app's connection runtime keeps polling environment discovery through the same global
  // fetch while these tests run, so only the attachment's own requests are counted.
  const attachmentFetches = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([url]) => url)
      .filter((url) => typeof url === "string" && url.startsWith("data:text/html"));

  it("keeps a renewed URL for subsequent rendered and source views", async () => {
    setup();
    let now = 0;
    using _now = vi.spyOn(Date, "now").mockImplementation(() => now);
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>Captured HTML</p>")),
    );
    await using screen = await openRemote();
    expect(screen.container.querySelector("iframe")?.getAttribute("src")).toBe(originalUrl);
    now = 61 * 60_000;
    await toggleMode(screen, "Show HTML source");
    await act(async () => {
      await import("./ReadOnlySourcePreview");
    });
    expect(attachmentFetches()).toEqual([renewedUrl]);
    await vi.waitFor(() =>
      expect(screen.container.querySelector("pre")?.textContent).toBe("<p>Captured HTML</p>"),
    );

    await toggleMode(screen, "Show rendered page");
    expect(screen.container.querySelector("iframe")?.getAttribute("src")).toBe(renewedUrl);
    await toggleMode(screen, "Show HTML source");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(attachmentFetches()).toEqual([renewedUrl, renewedUrl]);
  });

  it("does not fetch or mark an expired URL fresh when reauthorization is unavailable", async () => {
    setup();
    let now = 0;
    using _now = vi.spyOn(Date, "now").mockImplementation(() => now);
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>Captured HTML</p>")),
    );
    await using screen = await openRemote();
    now = 61 * 60_000;
    refresh.mockResolvedValue(null);
    await toggleMode(screen, "Show HTML source");
    expect(attachmentFetches()).toEqual([]);
    expect(alert(screen)?.textContent).toContain("Reconnect to the environment and try again.");

    await toggleMode(screen, "Show rendered page");
    await toggleMode(screen, "Show HTML source");
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(attachmentFetches()).toEqual([]);
  });

  it("can return to rendered HTML after local source decoding fails", async () => {
    setup();
    let now = 0;
    using _now = vi.spyOn(Date, "now").mockImplementation(() => now);
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>Captured HTML</p>")),
    );
    const file = new Blob([new Uint8Array([0x3c, 0x70, 0x3e, 0xe9])], { type: "text/html" });
    await using screen = await render(
      <AttachmentFilePreview
        name="document.html"
        mimeType="text/html"
        sizeBytes={file.size}
        file={file}
      />,
    );
    await toggleMode(screen, "Show HTML source");
    await vi.waitFor(() => expect(alert(screen)?.textContent).toContain("not UTF-8"));

    await toggleMode(screen, "Show rendered page");
    expect(alert(screen)).toBeNull();
    expect(screen.container.querySelector("iframe")?.title).toBe("document.html");
  });
});

it("keeps an attachment URL when the parent passes a fresh asset object for the same attachment", async () => {
  const url = URL.createObjectURL(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
  refresh.mockReset().mockResolvedValue(url);
  const preview = () => (
    <AttachmentFilePreview
      name="report.pdf"
      mimeType="application/pdf"
      sizeBytes={8}
      asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "report" }}
    />
  );
  try {
    await using screen = await render(preview());
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // FilePreviewPanel rebuilds `asset` when an agent command completes.
    await screen.rerender(preview());
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    URL.revokeObjectURL(url);
  }
});

it("opens a known empty attachment even when its range response is inaccessible", async () => {
  refresh.mockResolvedValue("https://unreachable.invalid/empty.txt");
  await using screen = await render(
    <AttachmentFilePreview
      name="empty.txt"
      mimeType="text/plain"
      sizeBytes={0}
      asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "empty" }}
    />,
  );
  await vi.waitFor(
    () => expect(screen.container.textContent).toContain("This file is empty."),
    10_000,
  );
});

it.each(["draft", "thread"] as const)(
  "reads an unknown-size %s workspace file instead of treating it as empty",
  async (source) => {
    refresh.mockResolvedValue("https://example.test/binary.txt");
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid\0text")),
    );
    await using screen = await render(
      <AttachmentFilePreview
        name="binary.txt"
        mimeType="application/octet-stream"
        sizeBytes={0}
        asset={{
          environmentId: EnvironmentId.make("test"),
          resource:
            source === "draft"
              ? { _tag: "draft-workspace-file", cwd: "/repo", path: "/repo/binary.txt" }
              : { _tag: "media-file", threadId: ThreadId.make("test"), path: "/repo/binary.txt" },
        }}
      />,
    );
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain(
        "This file contains binary data and cannot be shown as text.",
      ),
    );
    expect(fetch).toHaveBeenCalled();
    expect(screen.container.textContent).not.toContain("This file is empty.");
  },
);

it("refreshes authorization and retries a failed streamed attachment", async () => {
  const bad = URL.createObjectURL(new Blob(["invalid\0text"]));
  const good = URL.createObjectURL(new Blob(["recovered text\n"]));
  refresh.mockReset().mockResolvedValueOnce(bad).mockResolvedValue(good);
  try {
    await using screen = await render(
      <AttachmentFilePreview
        name="retry.txt"
        mimeType="text/plain"
        sizeBytes={2_000_000}
        asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "retry" }}
      />,
    );
    // A cold large-text worker can take longer than waitFor's default to boot on CI.
    await vi.waitFor(
      () => expect(screen.container.textContent).toContain("This file contains binary data."),
      { timeout: 10_000 },
    );
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    await vi.waitFor(() => expect(screen.container.textContent).toContain("recovered text"));
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    URL.revokeObjectURL(bad);
    URL.revokeObjectURL(good);
  }
});

it("copies every indexed line rather than the mounted preview rows", async () => {
  const text = Array.from({ length: 10_000 }, (_, i) => `line-${i}`).join("\n");
  const copyContents = { current: null as (() => Promise<string>) | null };
  await using screen = await render(
    <LargeTextViewer name="whole.txt" text={text} delimiter={null} copyContents={copyContents} />,
  );
  await vi.waitFor(() => expect(screen.container.textContent).toContain("line-0"));
  // Copy rejects until the worker finishes indexing, which a cold worker can delay past waitFor's default on CI.
  await vi.waitFor(async () => expect(await copyContents.current!()).toBe(text), {
    timeout: 10_000,
  });
  const first = copyContents.current!();
  await expect(copyContents.current!()).rejects.toThrow("Another copy is in progress.");
  expect(await first).toBe(text);
  expect(await copyContents.current!()).toBe(text);
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

it.each([
  ["one.csv", "text/csv", "name\nAda\n", "1 row · 1 column ·"],
  ["two.csv", "text/csv", "name,count\nAda,1\nGrace,2\n", "2 rows · 2 columns ·"],
  ["one.tsv", "text/tab-separated-values", "name\nAda\n", "1 row · 1 column ·"],
  ["one.txt", "text/plain", "a".repeat(1024 * 1024) + "\n", "1 line ·"],
  ["two.txt", "text/plain", ("a".repeat(512 * 1024) + "\n").repeat(2), "2 lines ·"],
] as const)("labels the counts of %s in the status line", async (name, mimeType, text, label) => {
  const file = new Blob([text], { type: mimeType });
  await using screen = await render(
    <AttachmentFilePreview name={name} mimeType={mimeType} sizeBytes={file.size} file={file} />,
  );
  const status = () => screen.container.querySelector('[role="status"]')?.textContent ?? "";
  // A cold large-text worker can take longer than waitFor's default to boot on CI.
  await vi.waitFor(() => expect(status()).toMatch(/ [KM]?B$/), { timeout: 10_000 });
  expect(status()).toContain(label);
});

it("reauthorizes and retries a failed archive attachment", async () => {
  const bad = URL.createObjectURL(new Blob(["invalid"]));
  const bytes = new Uint8Array(
    await new JSZip().file("recovered.txt", "ok").generateAsync({ type: "uint8array" }),
  );
  const good = URL.createObjectURL(new Blob([bytes]));
  refresh.mockReset().mockResolvedValueOnce(bad).mockResolvedValue(good);
  try {
    await using screen = await render(
      <AttachmentFilePreview
        name="retry.zip"
        mimeType="application/octet-stream"
        sizeBytes={bytes.length}
        asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "retry" }}
      />,
    );
    await vi.waitFor(
      () => expect(screen.container.querySelector('[role="alert"] button')).not.toBeNull(),
      10_000,
    );
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    await vi.waitFor(() => expect(screen.container.textContent).toContain("recovered.txt"), 10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    URL.revokeObjectURL(bad);
    URL.revokeObjectURL(good);
  }
});

it("loads a font attachment through the lazy preview", async () => {
  const { default: fontUrl } =
    await import("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url");
  const file = await (await fetch(fontUrl)).blob();
  await using screen = await render(
    <AttachmentFilePreview
      name="Inter.woff2"
      mimeType="font/woff2"
      sizeBytes={file.size}
      file={file}
    />,
  );
  // Two cold lazy chunks plus decoding a 600 KB font can take longer than waitFor's default on CI.
  await vi.waitFor(
    () => {
      const frame = screen.container.querySelector("iframe");
      expect(frame?.title).toBe("Inter.woff2");
      expect(frame?.srcdoc).toContain("@font-face");
      expect(frame?.srcdoc).toContain("The quick brown fox");
    },
    { timeout: 10_000 },
  );
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

it("toggles a Mermaid attachment between diagram and source through the lazy preview", async () => {
  const text = "flowchart LR\nA --> B";
  const file = new Blob([text], { type: "text/vnd.mermaid" });
  await using screen = await render(
    <AttachmentFilePreview
      name="diagram.mmd"
      mimeType={file.type}
      sizeBytes={file.size}
      file={file}
    />,
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-markdown-mermaid] svg path")).not.toBeNull(),
  );
  await screen.getByRole("button", { name: "Expand diagram" }).click();
  await vi.waitFor(() => {
    const image = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    expect(image?.alt).toBe("Mermaid diagram");
    expect(image?.naturalWidth).toBeGreaterThan(0);
  });
  await page.getByRole("button", { name: "Close image preview" }).click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await screen.getByRole("button", { name: "Show Mermaid source" }).click();
  await vi.waitFor(() => expect(screen.container.querySelector("pre")?.textContent).toBe(text));
  await screen.getByRole("button", { name: "Show rendered diagram" }).click();
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-markdown-mermaid] svg path")).not.toBeNull(),
  );
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

it("loads an edited HTML file outside the workspace from a renewed URL", async () => {
  const { WorkspaceBrowserPreview } = await import("./FilePreviewPanel");
  const preview = (mutation: string) => (
    <WorkspaceBrowserPreview
      environmentId={EnvironmentId.make("test")}
      threadRef={{ environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") }}
      draft={false}
      workspaceRoot="/repo"
      absolutePath="/tmp/report.html"
      title="Report"
      workspaceMutationId={mutation}
    />
  );
  assetUrlState.mockReturnValue({ _tag: "Success", url: "data:text/html,original", expiresAt: 0 });
  await using screen = await render(preview("first"));
  const opened = screen.container.querySelector("iframe");
  expect(opened?.getAttribute("src")).toMatch(/^data:text\/html,original/);

  assetUrlState.mockReturnValue({
    _tag: "Success",
    url: "data:text/html,original",
    expiresAt: 0,
    waiting: true,
  });
  await screen.rerender(preview("second"));
  expect(assetUrlState).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), "second");
  expect(screen.container.querySelector("iframe")).toBe(opened);

  assetUrlState.mockReturnValue({ _tag: "Success", url: "data:text/html,edited", expiresAt: 0 });
  await screen.rerender(preview("second"));
  expect(screen.container.querySelector("iframe")?.getAttribute("src")).toMatch(
    /^data:text\/html,edited/,
  );
});

it("keeps an unchanged workspace HTML page loaded across commands and renews its grant", async () => {
  const { WorkspaceBrowserPreview } = await import("./FilePreviewPanel");
  const preview = (mutation: string) => (
    <WorkspaceBrowserPreview
      environmentId={EnvironmentId.make("test")}
      threadRef={{ environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") }}
      draft={false}
      workspaceRoot="/repo"
      absolutePath="/repo/report.html"
      title="Report"
      workspaceMutationId={mutation}
    />
  );
  const minted = (url: string, fileRevision: string, expiresAt: number) =>
    assetUrlState.mockReturnValue({ _tag: "Success", url, expiresAt, fileRevision });
  const shownSrc = (screen: Screen) =>
    screen.container.querySelector("iframe")?.getAttribute("src");
  refresh.mockReset();
  using _timers = fakeTimers();
  vi.setSystemTime(0);
  const expiresAt = 60 * 60_000;
  minted("data:text/html,original", "one", expiresAt);
  await using screen = await render(preview("first"));
  const opened = screen.container.querySelector("iframe");
  expect(shownSrc(screen)).toMatch(/^data:text\/html,original/);

  // Agent commands re-mint the URL; the page and everything it loaded are unchanged.
  minted("data:text/html,renewed", "one", expiresAt + 30 * 60_000);
  await screen.rerender(preview("second"));
  await screen.rerender(preview("third"));
  expect(screen.container.querySelector("iframe")).toBe(opened);
  expect(shownSrc(screen)).toMatch(/^data:text\/html,original/);
  expect(refresh).not.toHaveBeenCalled();

  // Its grant is about to expire, so the page moves to the URL minted since.
  await act(() => vi.advanceTimersByTime(59 * 60_000));
  expect(shownSrc(screen)).toMatch(/^data:text\/html,renewed/);
  expect(refresh).not.toHaveBeenCalled();

  // With no command since, the page asks for a fresh URL itself and moves to it.
  refresh.mockResolvedValue(null);
  await act(() => vi.advanceTimersByTime(30 * 60_000));
  expect(refresh).toHaveBeenCalledTimes(1);
  minted("data:text/html,renewed-again", "one", expiresAt + 90 * 60_000);
  await screen.rerender(preview("third"));
  expect(shownSrc(screen)).toMatch(/^data:text\/html,renewed-again/);

  minted("data:text/html,edited", "two", expiresAt + 90 * 60_000);
  await screen.rerender(preview("fourth"));
  expect(shownSrc(screen)).toMatch(/^data:text\/html,edited/);
});

it("unwraps one text attachment without turning off the word wrap setting", async () => {
  const file = new Blob(["a long line"], { type: "text/plain" });
  await using screen = await render(
    <AttachmentFilePreview
      name="notes.txt"
      mimeType={file.type}
      sizeBytes={file.size}
      file={file}
    />,
  );
  await screen.getByRole("button", { name: "Disable word wrap" }).click();
  await expect.element(screen.getByRole("button", { name: "Enable word wrap" })).toBeVisible();
  expect(getClientSettings().wordWrap).toBe(true);
  expect(screen.container.querySelector("pre")?.dataset.wordWrap).toBe("false");
});
