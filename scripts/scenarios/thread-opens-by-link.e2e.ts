import { expect } from "e2e";

import { test, WEB } from "./orbi.ts";

test(
  "A seeded thread opens by its link and shows its history",
  WEB,
  async ({ orbi, app, screen }) => {
    const project = await orbi.project("demo");
    const thread = await orbi.thread({
      project,
      title: "Earlier work",
      messages: ["first", "second"],
    });
    await orbi.open(thread);

    await expect(screen.getByText("second fixture turn complete", { exact: false })).toBeVisible();
    await app.screenshot("thread");
  },
);
