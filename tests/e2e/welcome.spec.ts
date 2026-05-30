import { expect, test } from "@playwright/test";

test("shows the welcome screen without browser errors", async ({ page }) => {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "MyNote" })).toBeVisible();
  await expect(page.getByText("个人 Markdown 知识库")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建知识库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开知识库" })).toBeVisible();
  expect(errors).toEqual([]);
});