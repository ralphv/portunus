// "Password manager UX", "Site icons" and "Password strength meter": the
// entry editor's fields and helpers, and the list's search, label filters,
// sort order and quick-copy buttons.

import {
  ENTRY,
  ENTRY_SORT_KEY,
  addEntry,
  assert,
  clipboardText,
  closeEntry,
  entryCount,
  entryNames,
  entryRow,
  field,
  lockAndReload,
  notesField,
  openEntry,
  passwordMask,
  revealPassword,
  save,
  storage,
  unlock,
} from "../helpers.mjs";

const SEARCH = "Search entries…";
const labelFilter = (page, label) =>
  page.getByRole("group", { name: "Filter by label" }).getByRole("button", { name: label, exact: true });

async function expectList(page, names) {
  const shown = await entryNames(page);
  assert(
    JSON.stringify(shown) === JSON.stringify(names),
    `expected entries ${JSON.stringify(names)}, list shows ${JSON.stringify(shown)}`,
  );
}

async function addLabel(row, label) {
  const input = row.getByLabel("Add label");
  await input.fill(label);
  await input.press("Enter");
  await row.getByRole("button", { name: `Remove label ${label}` }).waitFor();
}

export const entryTests = [
  {
    name: "entry editor fields",
    async run({ page, state }) {
      const row = await addEntry(page, { name: "GitHub", username: "octocat@example.com" });
      // Leaving the username field copies an email-shaped username to Email.
      await field(row, "URL").fill("https://github.com");
      const email = await field(row, "Email").inputValue();
      assert(email === "octocat@example.com", `email not filled from the username: "${email}"`);
      await notesField(row).fill("smoke note text");
      await addLabel(row, "dev");
      state.secrets.push("octocat@example.com", "smoke note text");
    },
  },
  {
    name: "password generator and strength meter",
    async run({ page }) {
      const row = page.locator('li[id^="entry-"]').first();
      await row.getByRole("button", { name: "Generate" }).click();
      await passwordMask(row).waitFor();
      await row.getByText(/to crack/).waitFor({ timeout: 30_000 });
      const score = Number(await row.getByRole("meter", { name: "Password strength" }).getAttribute("aria-valuenow"));
      assert(score >= 4, `generated password scored only ${score}/5`);
      await row.getByText(/^(Strong|Excellent)$/).waitFor();
      await closeEntry(row);
    },
  },
  {
    name: "site icon from the URL",
    async run({ page }) {
      await entryRow(page, "GitHub").getByRole("img", { name: "GitHub" }).waitFor();
      const row = await openEntry(page, "GitHub");
      const picker = row.getByRole("button", { name: "Choose icon" });
      assert((await picker.textContent()).includes("Auto (GitHub)"), "icon picker doesn't say Auto (GitHub)");
      await closeEntry(row);
    },
  },
  {
    name: "SSO provider chip",
    async run({ page, state }) {
      const row = await addEntry(page, { name: "Notion", username: "me@example.com", url: "https://www.notion.so" });
      await field(row, "SSO provider").fill("Google");
      await addLabel(row, "work");
      await closeEntry(row);
      await entryRow(page, "Notion").getByText("sso · Google").waitFor();
      state.secrets.push("me@example.com");
    },
  },
  {
    name: "stray spaces highlighted and trimmed",
    async run({ page }) {
      const row = await addEntry(page, { name: "  Spacey  " });
      await row.getByText("2 leading spaces · 2 trailing spaces").waitFor();
      await row.getByRole("button", { name: "trim" }).click();
      const name = await field(row, "Name").inputValue();
      assert(name === "Spacey", `trim left "${name}"`);
      assert(!(await row.getByText(/leading space|trailing space/).count()), "space warning still shown");
    },
  },
  {
    name: "monogram and icon override",
    async run({ page }) {
      const row = page.locator('li[id^="entry-"]').first();
      const picker = row.getByRole("button", { name: "Choose icon" });
      // No URL and no matching name: a letter monogram, "Auto".
      assert((await picker.textContent()).trim().startsWith("SAuto"), "unmatched entry isn't on the monogram");
      await picker.click();
      await page.getByPlaceholder("Search icons…").fill("gitlab");
      await row.locator('button[title="GitLab"]').click();
      assert((await picker.textContent()).includes("GitLab"), "icon override not applied");
      await closeEntry(row);
      await entryRow(page, "Spacey").getByRole("img", { name: "GitLab" }).waitFor();
    },
  },
  {
    name: "duplicate warning",
    async run({ page }) {
      const row = await addEntry(page, { name: "GitHub", username: "octocat@example.com" });
      await row.getByText("duplicate?").waitFor();
      const status = await row.getByRole("status").textContent();
      assert(/You already have\s*GitHub/.test(status), `unexpected duplicate notice: ${status}`);
      await row.getByRole("button", { name: "Delete" }).click(); // confirm() is accepted
      await row.waitFor({ state: "detached" });
      await expectList(page, ["Spacey", "Notion", "GitHub", ENTRY]);
    },
  },
  {
    name: "save new entries",
    async run({ page }) {
      await save(page);
    },
  },
  {
    name: "multi-term search",
    async run({ page }) {
      const search = page.getByPlaceholder(SEARCH);
      await search.fill("git octo");
      await expectList(page, ["GitHub"]);
      assert((await entryCount(page).textContent()) === "1 entry", "entry count doesn't say 1 entry");
      await search.fill("google"); // the SSO provider is searchable
      await expectList(page, ["Notion"]);
      await search.fill("octo notion");
      await page.getByText("No entries match your search.").waitFor();
      await search.fill("");
      assert((await entryCount(page).textContent()) === "4 entries", "entry count doesn't say 4 entries");
    },
  },
  {
    name: "label filters",
    async run({ page }) {
      await labelFilter(page, "work").click();
      await expectList(page, ["Notion"]);
      // Several labels narrow further: an entry needs all of them.
      await labelFilter(page, "dev").click();
      await expectList(page, []);
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expectList(page, ["Spacey", "Notion", "GitHub", ENTRY]);
      // A label chip on a collapsed row filters too.
      await entryRow(page, "GitHub").getByRole("button", { name: "dev", exact: true }).click();
      await expectList(page, ["GitHub"]);
      await page.getByRole("button", { name: "Clear", exact: true }).click();
    },
  },
  {
    name: "sort order, remembered per device",
    async run({ page, state }) {
      const sort = page.getByLabel("Sort entries");
      await sort.selectOption("name-asc");
      await expectList(page, ["GitHub", "Notion", ENTRY, "Spacey"]);
      await sort.selectOption("created-asc");
      await expectList(page, [ENTRY, "GitHub", "Notion", "Spacey"]);
      await sort.selectOption("name-desc");
      await expectList(page, ["Spacey", ENTRY, "Notion", "GitHub"]);
      assert((await storage(page, ENTRY_SORT_KEY)) === "name-desc", "sort order not stored on the device");
      await lockAndReload(page);
      await unlock(page, state, { pickFile: false });
      assert((await sort.inputValue()) === "name-desc", "sort order not restored after reload");
      await expectList(page, ["Spacey", ENTRY, "Notion", "GitHub"]);
      await sort.selectOption("vault");
      await expectList(page, ["Spacey", "Notion", "GitHub", ENTRY]);
    },
  },
  {
    name: "quick copy",
    async run({ page, state }) {
      const row = entryRow(page, "GitHub");
      // A copy button is renamed "Copied" once the clipboard write is done.
      const copy = async (name) => {
        const button = row.getByRole("button", { name });
        await button.click();
        await button.waitFor({ state: "detached" });
        return clipboardText(page);
      };
      assert((await copy("Copy username")) === "octocat@example.com", "username not copied");
      assert(
        (await row.getByRole("button", { name: "Copy email" }).count()) === 0,
        "email copy button shown although the email equals the username",
      );
      let opened = await openEntry(page, "GitHub");
      await field(opened, "Email").fill("octo@example.org");
      await closeEntry(opened);
      assert((await copy("Copy email")) === "octo@example.org", "email not copied");
      opened = await openEntry(page, "GitHub");
      await field(opened, "Email").fill("octocat@example.com");
      await closeEntry(opened);
      const copied = await copy("Copy password");
      opened = await openEntry(page, "GitHub");
      const shown = await revealPassword(opened);
      assert(copied === shown && copied.length >= 16, "copied password differs from the stored one");
      state.githubPassword = shown;
      state.secrets.push(shown);
      await closeEntry(opened);
    },
  },
];
